// password.jsx — Profiili → Tili → Salasana: change the password (the current one is asked first),
// or set a first one on a Google / Apple account so e-mail + password works too. A forgotten
// current password gets the same reset link as the sign-in page.
import { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { Button, Field, Icon, Input, ListRow, Sheet, useToast } from '../ui/index.js';

const MIN = 8;

function PasswordInput({ id, value, onChange, show, onToggle, autoComplete, placeholder }) {
  return (
    <div className="auth-pw">
      <Input id={id} icon="lock" type={show ? 'text' : 'password'} autoComplete={autoComplete} placeholder={placeholder}
        value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="auth-pw-toggle" onClick={onToggle} aria-label={show ? 'Piilota salasana' : 'Näytä salasana'} aria-pressed={show}>
        <Icon name={show ? 'eye-off' : 'eye'} size={19} />
      </button>
    </div>
  );
}

/** `hasPassword` false = a Google / Apple account without one: only the new password is asked. */
export function PasswordSheet({ open, onClose, hasPassword, email, home, onDone }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(null); // 'save' | 'reset'
  const [error, setError] = useState(null);
  useEffect(() => { if (open) { setCurrent(''); setNext(''); setShow(false); setError(null); } }, [open]);

  const missing = hasPassword && !current ? 'Kirjoita nykyinen salasanasi.'
    : next.length < MIN ? `Uudessa salasanassa pitää olla vähintään ${MIN} merkkiä.` : null;

  const save = async () => {
    if (missing || busy) return;
    setBusy('save');
    setError(null);
    try {
      await api.auth.changePassword({ current: hasPassword ? current : null, next });
      toast(hasPassword ? 'Salasana vaihdettu.' : 'Salasana asetettu. Voit nyt kirjautua myös sähköpostilla ja salasanalla.');
      onDone?.();
      onClose();
    } catch (err) {
      setError(err);
    } finally { setBusy(null); }
  };
  const sendReset = async () => {
    if (busy || !email) return;
    setBusy('reset');
    try {
      await api.auth.resetPassword(email, `${window.location.origin}${home}`);
      toast(`Lähetimme osoitteeseen ${email} linkin, josta voit asettaa uuden salasanan.`);
      onClose();
    } catch (err) { toast(err); } finally { setBusy(null); }
  };

  const wrongCurrent = error?.code === 'wrong_password';
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} size="sm" title={hasPassword ? 'Vaihda salasana' : 'Aseta salasana'}
      subtitle={hasPassword ? 'Kirjoita ensin nykyinen salasanasi ja sitten uusi.' : 'Kirjaudut nyt Googlella tai Applella. Salasanalla pääset sisään myös sähköpostillasi.'}
      dismissible={!busy} confirmClose={Boolean(current || next)}
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose} disabled={Boolean(busy)}>Peruuta</Button><Button variant="dark" size="lg" missing={missing} loading={busy === 'save'} onClick={save}>Tallenna</Button></div>}>
      <form className="stack-4" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        {hasPassword && (
          <Field label="Nykyinen salasana" htmlFor="pw-current" error={wrongCurrent ? error.userMessage : null}>
            <PasswordInput id="pw-current" value={current} onChange={(v) => { setCurrent(v); if (wrongCurrent) setError(null); }}
              show={show} onToggle={() => setShow((v) => !v)} autoComplete="current-password" placeholder="Nykyinen salasanasi" />
          </Field>
        )}
        <Field label="Uusi salasana" htmlFor="pw-new" error={error && !wrongCurrent ? error.userMessage : null}
          hint={error && !wrongCurrent ? null : `Vähintään ${MIN} merkkiä. Käytä salasanaa, jota et käytä muualla.`}>
          <PasswordInput id="pw-new" value={next} onChange={(v) => { setNext(v); if (error && !wrongCurrent) setError(null); }}
            show={show} onToggle={() => setShow((v) => !v)} autoComplete="new-password" placeholder="Keksi uusi salasana" />
        </Field>
        {hasPassword && email && (
          <button type="button" className="k-textlink k-pw-forgot" onClick={sendReset} disabled={Boolean(busy)}>
            {busy === 'reset' ? 'Lähetetään…' : 'Unohditko nykyisen salasanan?'}
          </button>
        )}
      </form>
    </Sheet>
  );
}

/** The Salasana row of the Tili list, with its sheet. `home` = /valmentaja or /pelaaja (the reset link returns there). */
export function PasswordRow({ home }) {
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    api.auth.getPasswordState().then((s) => alive && setState(s)).catch(() => alive && setState(null));
    return () => { alive = false; };
  }, []);
  if (!state) return null;
  return (
    <>
      <ListRow icon="lock" title="Salasana"
        subtitle={state.hasPassword ? '••••••••' : 'Ei asetettu'}
        onClick={() => setOpen(true)}
        right={<span className="k-textlink">{state.hasPassword ? 'Vaihda' : 'Aseta'}</span>} />
      <PasswordSheet open={open} onClose={() => setOpen(false)} hasPassword={state.hasPassword} email={state.email} home={home}
        onDone={() => setState((s) => ({ ...s, hasPassword: true }))} />
    </>
  );
}
