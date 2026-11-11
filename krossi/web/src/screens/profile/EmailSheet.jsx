// EmailSheet — Asetukset → Sähköposti: the address the player signs in with and gets Krossi's
// e-mails at. The change takes effect at once (sign-ups confirm themselves, and so does this).
import { useEffect, useState } from 'react';
import { api } from '../../api/index.js';
import { Button, Field, Input, Sheet, useToast } from '../../ui/index.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `onChanged(email)` once the new address is on the account. */
export function EmailSheet({ open, onClose, current, onChanged }) {
  const toast = useToast();
  const [value, setValue] = useState(current || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { if (open) { setValue(current || ''); setError(null); } }, [open, current]);
  const next = value.trim().toLowerCase();
  const same = next === String(current || '').trim().toLowerCase();

  const save = async () => {
    if (!next || same || busy) return;
    if (!EMAIL_RE.test(next)) { setError('Tarkista sähköpostiosoite.'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await api.auth.updateEmail(next);
      if (res.pending) toast(`Avaa linkki, jonka lähetimme osoitteeseen ${res.pending}. Siihen asti kirjaudut vanhalla osoitteella.`);
      else {
        onChanged?.(res.email || next);
        toast(`Sähköposti vaihdettu. Kirjaudu jatkossa osoitteella ${res.email || next}.`, { icon: 'mail' });
      }
      onClose();
    } catch (err) {
      setError(err?.userMessage || 'Sähköpostia ei voitu vaihtaa. Yritä hetken päästä uudelleen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={() => !busy && onClose()} size="sm" title="Vaihda sähköposti"
      subtitle="Kirjaudut tällä osoitteella, ja Krossin sähköpostit tulevat tänne."
      dismissible={!busy}
      footer={(
        <div className="sheet-actions">
          <Button variant="outline" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button>
          <Button variant="dark" size="lg" disabled={!next || same} loading={busy} onClick={save}>Tallenna</Button>
        </div>
      )}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <Field label="Sähköposti" htmlFor="settings-email" error={error}
          hint={error ? null : 'Uusi osoite on käytössä heti. Salasana ja muut kirjautumistavat toimivat kuten ennenkin.'}>
          <Input id="settings-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            value={value} onChange={(e) => { setValue(e.target.value); if (error) setError(null); }} maxLength={254} />
        </Field>
      </form>
    </Sheet>
  );
}
