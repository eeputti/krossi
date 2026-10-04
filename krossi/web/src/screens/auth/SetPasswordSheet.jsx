// SetPasswordSheet — shown when the user arrives through a password-reset email link
// (supabase-js emits PASSWORD_RECOVERY). Without this the reset link only signed them in
// once and the forgotten password stayed unchanged.
import { useState } from 'react';
import { api } from '../../api/index.js';
import { useSession } from '../../app/session.jsx';
import { Button, Field, Input, Sheet, useToast } from '../../ui/index.js';

export function SetPasswordSheet() {
  const { recovery, endRecovery } = useSession();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (e) => {
    e?.preventDefault();
    setError('');
    if (password.length < 8) { setError('Vähintään 8 merkkiä.'); return; }
    setBusy(true);
    try {
      await api.auth.updatePassword(password);
      toast('Uusi salasana tallennettu 🔒', { icon: 'check-circle' });
      endRecovery();
    } catch (err) {
      setError(err.userMessage || 'Salasanan vaihto epäonnistui.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={recovery}
      onClose={endRecovery}
      size="sm"
      title="Aseta uusi salasana"
      subtitle="Valitse salasana, jolla kirjaudut jatkossa — myös mobiilisovellukseen."
      footer={<Button variant="dark" size="lg" block loading={busy} onClick={save}>Tallenna salasana</Button>}
    >
      <form onSubmit={save}>
        <Field label="Uusi salasana" hint="Vähintään 8 merkkiä. Käytä salasanaa, jota et käytä muualla." error={error} htmlFor="new-password">
          <Input
            id="new-password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </Field>
        <Button variant="ghost" size="sm" icon={show ? 'eye-off' : 'eye'} onClick={() => setShow((v) => !v)}>{show ? 'Piilota salasana' : 'Näytä salasana'}</Button>
      </form>
    </Sheet>
  );
}
