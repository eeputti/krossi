// AccountSheet — "Luo tili" / "Kirjaudu" on the booking site (krossi.app/varaa): Google, Apple or
// email + password, the same choices as the account page. The demo's visitor gets the account right
// here (nothing is checked) and the site carries on signed in: the booking goes to the account and
// "Etsi pelikaveri" opens. The real Krossi uses the account page instead (goToAccount), which comes
// back to the booking site once the account is ready.
import { useEffect, useState } from 'react';
import { rememberAfterAuth } from '../../app/App.jsx';
import { navigate } from '../../app/router.js';
import { signInDemoSite } from '../../app/siteAccount.js';
import { AppleMark, Button, GoogleMark, Input, Sheet } from '../../ui/index.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

/** The real account page: 'register' (Luo tili) or 'login' (Kirjaudu), then back to `back`. */
export function goToAccount(mode, back) {
  if (back) rememberAfterAuth(back);
  navigate('/pelaa/koti', { state: { authMode: mode } });
}

export function AccountSheet({ open, mode: firstMode = 'register', title, subtitle, email: knownEmail = '', onClose, onDone }) {
  const [mode, setMode] = useState(firstMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(null); // 'google' | 'apple' | 'form' | null

  useEffect(() => {
    if (!open) return;
    setMode(firstMode || 'register');
    setBusy(null);
    // The email a guest booked with is the likely one for the account too.
    if (knownEmail) setEmail((e) => e || knownEmail.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, firstMode]);

  const register = mode === 'register';
  const formOk = EMAIL_RE.test(email.trim()) && password.length >= (register ? MIN_PASSWORD : 1);

  const finish = async (how) => {
    setBusy(how);
    await new Promise((r) => setTimeout(r, 500));
    signInDemoSite();
    setBusy(null);
    onDone?.();
  };

  const oauth = (provider, Mark, label) => (
    <button
      type="button"
      className={cx('btn btn-outline btn-lg btn-block auth-oauth-btn', busy === provider && 'is-loading')}
      onClick={() => finish(provider)}
      disabled={Boolean(busy)}
      aria-busy={busy === provider || undefined}
    >
      <Mark size={19} />
      <span className="btn-label">{label}</span>
    </button>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title || (register ? 'Luo tili' : 'Kirjaudu')}
      subtitle={register ? subtitle : undefined}
      size="sm"
      className="acct-sheet"
    >
      <div className="acct">
        <div className="auth-oauth">
          {oauth('google', GoogleMark, 'Jatka Googlella')}
          {oauth('apple', AppleMark, 'Jatka Applella')}
        </div>
        <div className="auth-divider" role="separator"><span>tai sähköpostilla</span></div>
        <form className="acct-form" noValidate onSubmit={(e) => { e.preventDefault(); if (formOk && !busy) finish('form'); }}>
          <Input
            aria-label="Sähköposti"
            icon="mail"
            size="lg"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Sähköposti"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            aria-label="Salasana"
            icon="lock"
            size="lg"
            type="password"
            autoComplete={register ? 'new-password' : 'current-password'}
            placeholder={register ? `Salasana (vähintään ${MIN_PASSWORD} merkkiä)` : 'Salasana'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" variant="lime" size="lg" block loading={busy === 'form'} disabled={!formOk || (Boolean(busy) && busy !== 'form')}>
            {register ? 'Luo tili' : 'Kirjaudu'}
          </Button>
        </form>
        <p className="acct-switch">
          {register ? 'Onko sinulla jo tili?' : 'Ei vielä tiliä?'}{' '}
          <button type="button" className="bk-terms-inline" onClick={() => setMode(register ? 'login' : 'register')}>
            {register ? 'Kirjaudu' : 'Luo tili'}
          </button>
        </p>
      </div>
    </Sheet>
  );
}
