// AuthScreen — logged-out /pelaa: create an account, sign in or reset the password
// (email + Google / Apple). Remember-me is automatic (the session persists).
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { INVITE_CODE_KEY, authStore, peekAfterAuth } from '../../app/App.jsx';
import { useRoute } from '../../app/router.js';
import { AppleMark, Avatar, Button, Field, GoogleMark, Icon, Illustration, Input, Segmented } from '../../ui/index.js';
import { LegalSheet } from '../shared/LegalSheet.jsx';
import { AuthLayout, AuthLinks, Wordmark } from './AuthHero.jsx';
import { useInviter } from './useInviter.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

const MODES = [
  { value: 'register', label: 'Luo tili' },
  { value: 'login', label: 'Kirjaudu' },
];

const COPY = {
  register: { title: 'Hei, tervetuloa! 👋', lead: 'Luo tili ja löydä pelikaveri jo tällä viikolla.', submit: 'Luo tili' },
  login: { title: 'Kiva nähdä taas! 🎾', lead: 'Kirjaudu sisään ja katso, kuka pelaa tällä viikolla.', submit: 'Kirjaudu sisään' },
  reset: { title: 'Unohtuiko salasana?', lead: 'Kirjoita tilisi sähköposti, niin lähetämme linkin uuden salasanan asettamiseen.', submit: 'Lähetä palautuslinkki' },
};

function Alert({ tone, children }) {
  return (
    <div className={cx('auth-alert', `auth-alert-${tone}`)} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={tone === 'error' ? 'alert' : 'check-circle'} size={18} className="auth-alert-icon" />
      <span>{children}</span>
    </div>
  );
}

export function AuthScreen() {
  const route = useRoute();
  const [mode, setMode] = useState(() => (route.state?.authMode === 'login' ? 'login' : 'register'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(null); // 'form' | 'google' | 'apple' | null
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [sentTo, setSentTo] = useState(null);
  const [legal, setLegal] = useState({ open: false, doc: 'terms' });
  const emailRef = useRef(null);
  const pwRef = useRef(null);
  const oauthTimer = useRef(null);

  const inviteCode = authStore.get(INVITE_CODE_KEY);
  const { inviterName } = useInviter(inviteCode);
  const headingToGame = String(peekAfterAuth() || '').startsWith('/pelaa/peli/');

  useEffect(() => () => clearTimeout(oauthTimer.current), []);

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setInfo('');
    if (next === 'reset') setTimeout(() => emailRef.current?.focus(), 60);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setInfo('');
    const mail = email.trim();
    if (!EMAIL_RE.test(mail)) {
      setError(mail ? 'Tarkista sähköpostiosoite — siitä puuttuu jotain.' : 'Kirjoita sähköpostiosoitteesi.');
      emailRef.current?.focus();
      return;
    }
    if (mode !== 'reset' && !password) {
      setError('Kirjoita salasana.');
      pwRef.current?.focus();
      return;
    }
    if (mode === 'register' && password.length < MIN_PASSWORD) {
      setError(`Salasanan pitää olla vähintään ${MIN_PASSWORD} merkkiä.`);
      pwRef.current?.focus();
      return;
    }
    setBusy('form');
    try {
      if (mode === 'login') {
        await api.auth.signInWithPassword(mail, password);
      } else if (mode === 'register') {
        const res = await api.auth.signUp(mail, password);
        if (res?.needsConfirmation) setSentTo(mail);
      } else {
        await api.auth.resetPassword(mail);
        setInfo(`Palautuslinkki on matkalla osoitteeseen ${mail}. Avaa se samalla laitteella.`);
      }
    } catch (err) {
      if (err?.code === 'already_registered') { setMode('login'); setPassword(''); }
      setError(err?.userMessage || 'Jokin meni pieleen. Yritä hetken päästä uudelleen.');
    } finally {
      setBusy(null);
    }
  };

  const oauth = async (provider) => {
    if (busy) return;
    setError('');
    setInfo('');
    setBusy(provider);
    try {
      await api.auth.signInWithOAuth(provider);
      // The browser leaves for the provider; if it somehow doesn't, release the button.
      oauthTimer.current = setTimeout(() => setBusy(null), 10000);
    } catch (err) {
      setError(err?.userMessage || 'Kirjautuminen ei onnistunut. Yritä uudelleen.');
      setBusy(null);
    }
  };

  const openLegal = (doc) => setLegal({ open: true, doc });
  const copy = COPY[mode];
  const pwOk = password.length >= MIN_PASSWORD;

  const hero = (
    <div className="auth-hero-brand">
      {inviterName && (
        <div className="auth-hero-invite pop">
          <Avatar name={inviterName} color="green" size={26} />
          <span><strong>{inviterName}</strong> kutsui sinut Krossiin 🎾</span>
        </div>
      )}
      <Wordmark />
      <p className="auth-tagline">Löydä pelikaveri. Sovi peli. Pelaa.</p>
    </div>
  );

  return (
    <AuthLayout hero={hero} pitch>
      <div className="auth-card">
        {sentTo ? (
          <div className="auth-sent rise">
            <Illustration name="mail" size={150} className="auth-sent-art" />
            <h1 className="auth-title">Tarkista sähköpostisi 📬</h1>
            <p className="auth-lead">
              Lähetimme vahvistuslinkin osoitteeseen <strong className="auth-sent-mail">{sentTo}</strong> Avaa linkki, niin pääset tekemään profiilisi.
            </p>
            <p className="auth-sent-tip">
              <Icon name="info" size={16} />
              <span>Eikö viestiä näy parin minuutin päästä? Kurkkaa roskapostikansio.</span>
            </p>
            <div className="auth-sent-actions">
              <Button variant="dark" size="lg" block onClick={() => { setSentTo(null); switchMode('login'); }}>
                Vahvistin jo — kirjaudu sisään
              </Button>
              <Button variant="ghost" block onClick={() => { setSentTo(null); setPassword(''); }}>
                Väärä osoite? Korjaa se
              </Button>
            </div>
          </div>
        ) : (
          <div key={mode === 'reset' ? 'reset' : 'main'} className="auth-form-wrap route-fade">
            {mode === 'reset' && (
              <button type="button" className="auth-back-link" onClick={() => switchMode('login')}>
                <Icon name="arrow-left" size={16} /> Takaisin kirjautumiseen
              </button>
            )}
            <header className="auth-head">
              <h1 className="auth-title">{copy.title}</h1>
              <p className="auth-lead">{copy.lead}</p>
              {headingToGame && mode !== 'reset' && (
                <p className="auth-context"><Icon name="ball" size={16} /> Kirjaudu tai luo tili, niin pääset suoraan peliin.</p>
              )}
            </header>

            {mode !== 'reset' && (
              <>
                <Segmented options={MODES} value={mode} onChange={switchMode} ariaLabel="Luo tili tai kirjaudu" className="auth-modes" />
                <div className="auth-oauth">
                  <button type="button" className={cx('btn btn-outline btn-lg btn-block auth-oauth-btn', busy === 'google' && 'is-loading')} onClick={() => oauth('google')} disabled={!!busy} aria-busy={busy === 'google' || undefined}>
                    <GoogleMark size={19} />
                    <span className="btn-label">{busy === 'google' ? 'Avataan Googlea…' : 'Jatka Googlella'}</span>
                  </button>
                  <button type="button" className={cx('btn btn-outline btn-lg btn-block auth-oauth-btn', busy === 'apple' && 'is-loading')} onClick={() => oauth('apple')} disabled={!!busy} aria-busy={busy === 'apple' || undefined}>
                    <AppleMark size={19} />
                    <span className="btn-label">{busy === 'apple' ? 'Avataan Applea…' : 'Jatka Applella'}</span>
                  </button>
                </div>
                <div className="auth-divider" role="separator"><span>tai sähköpostilla</span></div>
              </>
            )}

            {error && <Alert tone="error">{error}</Alert>}
            {info && <Alert tone="success">{info}</Alert>}

            <form className="auth-form" onSubmit={submit} noValidate>
              <Field label="Sähköposti" htmlFor="auth-email">
                <Input
                  ref={emailRef}
                  id="auth-email"
                  icon="mail"
                  size="lg"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="nimi@esimerkki.fi"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              {mode !== 'reset' && (
                <Field
                  label="Salasana"
                  htmlFor="auth-password"
                  hint={mode === 'register' ? (
                    <span className={cx('auth-pw-rule', pwOk && 'is-ok')}>
                      <Icon key={pwOk ? 'ok' : 'no'} name={pwOk ? 'check-circle' : 'info'} size={14} className={pwOk ? 'pop' : undefined} />
                      Vähintään {MIN_PASSWORD} merkkiä. Käytä salasanaa, jota et käytä muualla.
                    </span>
                  ) : null}
                >
                  <div className="auth-pw">
                    <Input
                      ref={pwRef}
                      id="auth-password"
                      icon="lock"
                      size="lg"
                      type={showPw ? 'text' : 'password'}
                      autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                      placeholder={mode === 'register' ? 'Keksi salasana' : 'Salasanasi'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="auth-pw-toggle"
                      onClick={() => setShowPw((v) => !v)}
                      aria-label={showPw ? 'Piilota salasana' : 'Näytä salasana'}
                      aria-pressed={showPw}
                    >
                      <Icon name={showPw ? 'eye-off' : 'eye'} size={19} />
                    </button>
                  </div>
                </Field>
              )}
              {mode === 'login' && (
                <div className="auth-forgot">
                  <button type="button" className="auth-textlink" onClick={() => switchMode('reset')}>Unohditko salasanan?</button>
                </div>
              )}
              <Button type="submit" variant="lime" size="lg" block loading={busy === 'form'} disabled={!!busy && busy !== 'form'} iconRight={mode === 'reset' ? 'send' : 'arrow-right'} className="auth-submit">
                {copy.submit}
              </Button>
            </form>

            {mode !== 'reset' && (
              <p className="auth-terms">
                Jatkamalla hyväksyt Krossin{' '}
                <button type="button" className="auth-textlink" onClick={() => openLegal('terms')}>käyttöehdot</button>
                {' '}ja{' '}
                <button type="button" className="auth-textlink" onClick={() => openLegal('privacy')}>tietosuojaselosteen</button>.
              </p>
            )}
          </div>
        )}
      </div>
      <AuthLinks />
      <LegalSheet open={legal.open} doc={legal.doc} onClose={() => setLegal((l) => ({ ...l, open: false }))} />
    </AuthLayout>
  );
}
