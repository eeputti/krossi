// AccountSheet — "Luo tili" / "Kirjaudu" on the booking site (krossi.app/varaa) without leaving it:
// Google, Apple, or a name + email + password. The quick account is just a name (api.profile.createForBooking):
// enough to book with the account, while the rest of the profile waits until the player looks for a
// partner (onboarding). The booking sheet stays open behind it and carries on as the account.
//
// Google and Apple leave the page: the booking page's path (`back`) waits in this tab and the Gate
// comes back to it (app/bookingAccount.js). The demo's visitor gets the account on the spot (nothing
// is checked, app/siteAccount.js).
import { useEffect, useState } from 'react';
import { api, isDemo } from '../../api/index.js';
import { rememberAfterAuth } from '../../app/App.jsx';
import { rememberBookingReturn } from '../../app/bookingAccount.js';
import { navigate } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { signInDemoSite } from '../../app/siteAccount.js';
import { AppleMark, Button, GoogleMark, Icon, Input, Sheet } from '../../ui/index.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

/** The account page itself ('register' / 'login'), then back to `back`. */
export function goToAccount(mode, back) {
  if (back) rememberAfterAuth(back);
  navigate('/pelaa/koti', { state: { authMode: mode } });
}

/**
 * `city`: the hall's city for the new profile; `back`: where Google / Apple come back to; `name`,
 * `email`: what the visitor already typed as a guest. onDone runs once signed in (a new account
 * has its name saved by then).
 */
export function AccountSheet({
  open, mode: firstMode = 'register', title, subtitle, name: knownName = '', email: knownEmail = '', city, back, onClose, onDone,
}) {
  const { setProfile } = useSession();
  const [mode, setMode] = useState(firstMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(null); // 'google' | 'apple' | 'form' | 'reset' | null
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode(firstMode || 'register');
    setBusy(null);
    setError('');
    setInfo('');
    // What a guest already typed is the likely account too.
    if (knownName) setName((n) => n || knownName.trim());
    if (knownEmail) setEmail((e) => e || knownEmail.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, firstMode]);

  const register = mode === 'register';
  const nameOk = !register || name.trim().length >= 2;
  const formOk = nameOk && EMAIL_RE.test(email.trim()) && password.length >= (register ? MIN_PASSWORD : 1);

  const switchMode = (next) => { setMode(next); setError(''); setInfo(''); };

  const demoFinish = async (how) => {
    setBusy(how);
    await new Promise((r) => setTimeout(r, 500));
    signInDemoSite();
    setBusy(null);
    onDone?.();
  };

  const submit = async () => {
    if (!formOk || busy) return;
    if (isDemo) { demoFinish('form'); return; }
    setBusy('form');
    setError('');
    setInfo('');
    try {
      if (register) {
        const { needsConfirmation } = await api.auth.signUp(email, password);
        if (needsConfirmation) {
          setInfo(`Vahvista tilisi linkistä, jonka lähetimme osoitteeseen ${email.trim()}. Voit varata jo nyt ilman tiliä.`);
          setBusy(null);
          return;
        }
        setProfile(await api.profile.createForBooking({ name, city }));
      } else {
        await api.auth.signInWithPassword(email, password);
      }
      setBusy(null);
      onDone?.();
    } catch (err) {
      setBusy(null);
      if (err?.code === 'already_registered') switchMode('login');
      setError(err?.userMessage || err?.message || 'Jokin meni pieleen. Yritä uudelleen.');
    }
  };

  const oauth = async (provider) => {
    if (isDemo) { demoFinish(provider); return; }
    setBusy(provider);
    setError('');
    rememberBookingReturn(back);
    try {
      await api.auth.signInWithOAuth(provider); // leaves the page
    } catch (err) {
      setBusy(null);
      setError(err?.userMessage || 'Kirjautuminen epäonnistui.');
    }
  };

  const resetPassword = async () => {
    if (!EMAIL_RE.test(email.trim())) { setError('Kirjoita ensin sähköpostiosoitteesi.'); return; }
    setBusy('reset');
    setError('');
    try {
      if (!isDemo) await api.auth.resetPassword(email);
      setInfo(`Lähetimme linkin uuden salasanan asettamiseen osoitteeseen ${email.trim()}.`);
    } catch (err) {
      setError(err?.userMessage || 'Linkin lähetys epäonnistui.');
    } finally {
      setBusy(null);
    }
  };

  const oauthButton = (provider, Mark, label) => (
    <button
      type="button"
      className={cx('btn btn-outline btn-lg btn-block auth-oauth-btn', busy === provider && 'is-loading')}
      onClick={() => oauth(provider)}
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
          {oauthButton('google', GoogleMark, 'Jatka Googlella')}
          {oauthButton('apple', AppleMark, 'Jatka Applella')}
        </div>
        <div className="auth-divider" role="separator"><span>tai sähköpostilla</span></div>
        <form className="acct-form" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {register && (
            <Input
              aria-label="Nimi"
              icon="user"
              size="lg"
              autoComplete="name"
              maxLength={80}
              placeholder="Nimi"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
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
          {error && <p className="acct-msg is-error" role="alert"><Icon name="alert" size={16} />{error}</p>}
          {info && <p className="acct-msg" role="status"><Icon name="check-circle" size={16} />{info}</p>}
          <Button type="submit" variant="lime" size="lg" block loading={busy === 'form'} disabled={!formOk || (Boolean(busy) && busy !== 'form')}>
            {register ? 'Luo tili' : 'Kirjaudu'}
          </Button>
        </form>
        <p className="acct-switch">
          {register ? 'Onko sinulla jo tili?' : 'Ei vielä tiliä?'}{' '}
          <button type="button" className="bk-terms-inline" onClick={() => switchMode(register ? 'login' : 'register')}>
            {register ? 'Kirjaudu' : 'Luo tili'}
          </button>
          {!register && (
            <>
              <br />
              <button type="button" className="bk-terms-inline" disabled={busy === 'reset'} onClick={resetPassword}>Unohtuiko salasana?</button>
            </>
          )}
        </p>
      </div>
    </Sheet>
  );
}
