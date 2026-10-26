// gates.jsx — the screens between "opened the app" and "inside the app", shared by both roles:
// splash, gate errors, sign-in/up, password reset, the profile, and the pilot acknowledgement.
// Behaviour follows the old lib/koutsi-auth.jsx screen by screen; the look follows Krossi.

import { useEffect, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useSession } from '../app/session.jsx';
import { AREA_OPTIONS, SUPPORT_EMAIL } from '../lib/constants.js';
import {
  AppleMark, Button, ChipSelect, ErrorState, Field, GoogleMark, Icon, Illustration, Input, Segmented, TennisBall,
} from '../ui/index.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const COURT_IMG = '/assets/clay-court.jpg';

export function KoutsiWordmark({ size = 'lg' }) {
  return (
    <span className={`auth-wordmark auth-wordmark-${size} k-wordmark`} aria-label="Krossi Koutsi">
      <span aria-hidden="true">Krossi</span>
      <span className="auth-wordmark-ball"><TennisBall size={size === 'lg' ? 22 : 12} /></span>
      <span className="k-wordmark-sub" aria-hidden="true">Koutsi</span>
    </span>
  );
}

export function Splash({ label = 'Ladataan Koutsia' }) {
  return (
    <div className="splash" aria-label={label}>
      <TennisBall size={52} motion="bounce" shadow />
      <div className="splash-word">Koutsi</div>
    </div>
  );
}

/** A gate whose fetch failed: never an endless spinner — retry, or get out. */
export function GateError({ title = 'Tietojen haku ei onnistunut', message, error, onRetry, onSignOut }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="gate-error">
      <div className="k-gate-card">
        <ErrorState
          title={title}
          error={{ userMessage: message || error?.userMessage || 'Tarkista verkkoyhteys ja yritä uudelleen. Jos ongelma jatkuu, kirjaudu ulos ja takaisin sisään.' }}
          onRetry={onRetry ? async () => { setBusy(true); try { await onRetry(); } finally { setBusy(false); } } : undefined}
        />
        {busy && <p className="k-gate-busy">Yritetään…</p>}
        {onSignOut && <Button variant="ghost" block onClick={onSignOut}>Kirjaudu ulos</Button>}
      </div>
    </div>
  );
}

function Alert({ tone, children }) {
  return (
    <div className={cx('auth-alert', `auth-alert-${tone}`)} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={tone === 'error' ? 'alert' : 'check-circle'} size={18} className="auth-alert-icon" />
      <span>{children}</span>
    </div>
  );
}

function AuthLayout({ role, children, lead }) {
  return (
    <div className="auth">
      <section className="auth-hero on-dark">
        <img className="auth-hero-img" src={COURT_IMG} alt="" aria-hidden="true" decoding="async" />
        <div className="auth-hero-shade" aria-hidden="true" />
        <div className="auth-hero-top">
          <a className="auth-hero-back" href="https://koutsi.krossi.app">
            <Icon name="arrow-left" size={15} strokeWidth={2.4} />
            koutsi.krossi.app
          </a>
          <span className="k-role-pill">{role === 'coach' ? 'Valmentaja' : 'Pelaaja'}</span>
        </div>
        <div className="auth-hero-body">
          <div className="auth-hero-brand">
            <KoutsiWordmark />
            <p className="auth-tagline">{lead}</p>
          </div>
        </div>
      </section>
      <div className="auth-panel">
        <div className="auth-panel-inner">{children}</div>
      </div>
    </div>
  );
}

// Supabase sends a dead confirmation / recovery link back with the reason in the URL and no
// session. Say so, instead of silently showing the login form again.
function readLinkError() {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  const params = new URLSearchParams(hash || window.location.search.slice(1));
  const code = params.get('error_code') || '';
  const desc = params.get('error_description') || params.get('error') || '';
  if (!code && !desc) return '';
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search.replace(/[?&]error[^&]*/g, ''));
  if (/expired|otp_expired/i.test(`${code} ${desc}`)) return 'Linkki on vanhentunut tai se on jo käytetty. Pyydä uusi linkki alta.';
  if (/access_denied/i.test(`${code} ${desc}`)) return 'Kirjautuminen peruuntui. Yritä uudelleen.';
  return 'Linkki ei kelvannut. Yritä kirjautua sisään tai pyydä uusi linkki alta.';
}

const MODES = [{ value: 'register', label: 'Luo tili' }, { value: 'login', label: 'Kirjaudu' }];

/**
 * Sign in / sign up / reset for /valmentaja and /pelaaja. Keeps a player's invite (?koodi,
 * ?oppilas) through OAuth and email links, like the old screen. A coach account needs an
 * 18+ confirmation before registering; the coach key is asked after signing in.
 */
export function AuthScreen({ role }) {
  const isCoach = role === 'coach';
  const [linkError] = useState(readLinkError);
  const [mode, setMode] = useState(() => {
    if (linkError) return 'login';
    const asked = new URLSearchParams(window.location.search).get('auth');
    return asked === 'login' || asked === 'reset' ? asked : 'register';
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(null); // 'form' | 'google' | 'apple' | 'resend'
  const [error, setError] = useState(linkError);
  const [info, setInfo] = useState('');
  const [sentTo, setSentTo] = useState(null);
  const [canResend, setCanResend] = useState(false);
  const emailRef = useRef(null);

  const params = new URLSearchParams(window.location.search);
  const inviteCode = params.get('koodi');
  const inviteStudent = params.get('oppilas');
  const inviteQuery = new URLSearchParams([...(inviteCode ? [['koodi', inviteCode]] : []), ...(inviteStudent ? [['oppilas', inviteStudent]] : [])]).toString();
  const redirectTo = `${window.location.origin}${isCoach ? '/valmentaja' : '/pelaaja'}${!isCoach && inviteQuery ? `?${inviteQuery}` : ''}`;
  const roleHref = (target) => {
    const q = new URLSearchParams();
    if (mode !== 'register') q.set('auth', mode);
    if (inviteCode) q.set('koodi', inviteCode);
    if (inviteStudent) q.set('oppilas', inviteStudent);
    const s = q.toString();
    return `${target === 'coach' ? '/valmentaja' : '/pelaaja'}${s ? `?${s}` : ''}`;
  };
  const ageReady = !isCoach || adult;

  const switchMode = (next) => {
    setMode(next); setError(''); setInfo(''); setCanResend(false);
    if (next === 'reset') setTimeout(() => emailRef.current?.focus(), 60);
  };

  const oauth = async (provider) => {
    if (busy) return;
    if (mode === 'register' && !ageReady) { setError('Valmentajatilin käyttäjän pitää olla vähintään 18-vuotias.'); return; }
    setError(''); setBusy(provider);
    try {
      await api.auth.signInWithOAuth(provider, redirectTo);
      setTimeout(() => setBusy(null), 10000); // the browser normally leaves before this
    } catch (err) {
      setError(err.userMessage); setBusy(null);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError(''); setInfo(''); setCanResend(false);
    const mail = email.trim();
    if (!EMAIL_RE.test(mail)) { setError(mail ? 'Tarkista sähköpostiosoite — siitä puuttuu jotain.' : 'Kirjoita sähköpostiosoitteesi.'); return; }
    if (mode !== 'reset' && !password) { setError('Kirjoita salasana.'); return; }
    if (mode === 'register' && password.length < MIN_PASSWORD) { setError(`Salasanan pitää olla vähintään ${MIN_PASSWORD} merkkiä.`); return; }
    if (mode === 'register' && !ageReady) { setError('Valmentajatilin käyttäjän pitää olla vähintään 18-vuotias.'); return; }
    setBusy('form');
    try {
      if (mode === 'login') await api.auth.signInWithPassword(mail, password);
      else if (mode === 'register') {
        const res = await api.auth.signUp(mail, password, redirectTo);
        if (res?.needsConfirmation) { setSentTo(mail); setCanResend(true); }
      } else {
        await api.auth.resetPassword(mail, redirectTo);
        setInfo('Palautuslinkki lähetetty. Avaa se samalla laitteella ja aseta uusi salasana.');
      }
    } catch (err) {
      if (err.code === 'already_registered') { setMode('login'); setPassword(''); }
      if (err.code === 'email_unconfirmed') setCanResend(true);
      setError(err.userMessage);
    } finally {
      setBusy(null);
    }
  };

  const resend = async () => {
    setError(''); setInfo(''); setBusy('resend');
    try {
      await api.auth.resendConfirmation(email.trim(), redirectTo);
      setInfo('Uusi vahvistusviesti lähetetty. Tarkista myös roskaposti.');
    } catch (err) { setError(err.userMessage); } finally { setBusy(null); }
  };

  const lead = isCoach ? 'Valmentajan viikko yhdessä paikassa.' : 'Viikon teema, treenit ja oma kehityksesi.';
  const copy = {
    register: { title: isCoach ? 'Luo valmentajatili' : 'Luo tili', lead: isCoach ? 'Ryhmät, viikon teemat ja pelaajien kehitys yhdessä paikassa.' : 'Näet ryhmäsi viikon teeman ja treenit ja voit seurata omaa kehitystäsi.', submit: 'Luo tili' },
    login: { title: 'Kirjaudu sisään', lead: 'Kiva nähdä taas!', submit: 'Kirjaudu sisään' },
    reset: { title: 'Unohtuiko salasana?', lead: 'Kirjoita tilisi sähköposti, niin lähetämme linkin uuden salasanan asettamiseen.', submit: 'Lähetä palautuslinkki' },
  }[mode];

  return (
    <AuthLayout role={role} lead={lead}>
      <div className="auth-card">
        <div className="k-role-switch" role="tablist" aria-label="Valitse rooli">
          <a href={roleHref('coach')} role="tab" aria-selected={isCoach} className={cx('k-role-switch-btn', isCoach && 'is-on')} onClick={(e) => { if (isCoach) e.preventDefault(); }}>Valmentaja</a>
          <a href={roleHref('player')} role="tab" aria-selected={!isCoach} className={cx('k-role-switch-btn', !isCoach && 'is-on')} onClick={(e) => { if (!isCoach) e.preventDefault(); }}>Pelaaja</a>
        </div>
        {sentTo ? (
          <div className="auth-sent rise">
            <Illustration name="mail" size={140} className="auth-sent-art" />
            <h1 className="auth-title">Tarkista sähköpostisi</h1>
            <p className="auth-lead">Lähetimme vahvistuslinkin osoitteeseen <strong className="auth-sent-mail">{sentTo}</strong>. Avaa linkki, niin pääset jatkamaan.</p>
            {error && <Alert tone="error">{error}</Alert>}
            {info && <Alert tone="success">{info}</Alert>}
            <div className="auth-sent-actions">
              <Button variant="dark" size="lg" block onClick={() => { setSentTo(null); switchMode('login'); }}>Vahvistin jo — kirjaudu sisään</Button>
              {canResend && <Button variant="ghost" block loading={busy === 'resend'} onClick={resend}>Eikö viesti tullut? Lähetä uudelleen</Button>}
            </div>
          </div>
        ) : (
          <div key={mode === 'reset' ? 'reset' : 'main'} className="auth-form-wrap route-fade">
            {mode === 'reset' && (
              <button type="button" className="auth-back-link" onClick={() => switchMode('login')}><Icon name="arrow-left" size={16} /> Takaisin kirjautumiseen</button>
            )}
            <header className="auth-head">
              <h1 className="auth-title">{copy.title}</h1>
              <p className="auth-lead">{copy.lead}</p>
              {inviteCode && !isCoach && mode !== 'reset' && (
                <p className="auth-context"><Icon name="users" size={16} /> Sinulla on valmentajan kutsulinkki — luo tili tai kirjaudu, niin liityt heti.</p>
              )}
            </header>
            {isCoach && mode !== 'reset' && (
              <div className="k-note k-note-lime">
                <strong>Onko sinulla valmentaja-avain?</strong> Tarvitset sen kirjautumisen jälkeen.
                {' '}Jos ei ole, <a href={`mailto:${SUPPORT_EMAIL}?subject=Valmentaja-avain%20Koutsiin`}>pyydä se täältä</a>.
              </div>
            )}
            {mode !== 'reset' && (
              <>
                <Segmented options={MODES} value={mode} onChange={switchMode} ariaLabel="Luo tili tai kirjaudu" className="auth-modes" />
                {mode === 'register' && isCoach && (
                  <label className="k-check">
                    <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
                    <span>Vahvistan olevani vähintään 18-vuotias. Tämä vahvistus koskee valmentajatiliä.</span>
                  </label>
                )}
                <div className="auth-oauth">
                  <button type="button" className={cx('btn btn-outline btn-lg btn-block auth-oauth-btn', busy === 'google' && 'is-loading')} onClick={() => oauth('google')} disabled={!!busy}>
                    <GoogleMark size={19} /><span className="btn-label">{busy === 'google' ? 'Avataan Googlea…' : 'Jatka Googlella'}</span>
                  </button>
                  <button type="button" className={cx('btn btn-outline btn-lg btn-block auth-oauth-btn', busy === 'apple' && 'is-loading')} onClick={() => oauth('apple')} disabled={!!busy}>
                    <AppleMark size={19} /><span className="btn-label">{busy === 'apple' ? 'Avataan Applea…' : 'Jatka Applella'}</span>
                  </button>
                </div>
                <div className="auth-divider" role="separator"><span>tai sähköpostilla</span></div>
              </>
            )}
            {error && <Alert tone="error">{error}</Alert>}
            {info && <Alert tone="success">{info}</Alert>}
            {canResend && email.trim() && !sentTo && (
              <button type="button" className="auth-textlink k-resend" onClick={resend} disabled={busy === 'resend'}>Eikö vahvistusviesti tullut perille? Lähetä se uudelleen</button>
            )}
            <form className="auth-form" onSubmit={submit} noValidate>
              <Field label="Sähköposti" htmlFor="auth-email">
                <Input ref={emailRef} id="auth-email" icon="mail" size="lg" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
                  placeholder="nimi@esimerkki.fi" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              {mode !== 'reset' && (
                <Field label="Salasana" htmlFor="auth-password" hint={mode === 'register' ? `Vähintään ${MIN_PASSWORD} merkkiä. Käytä salasanaa, jota et käytä muualla.` : null}>
                  <div className="auth-pw">
                    <Input id="auth-password" icon="lock" size="lg" type={showPw ? 'text' : 'password'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                      placeholder={mode === 'register' ? 'Keksi salasana' : 'Salasanasi'} value={password} onChange={(e) => setPassword(e.target.value)} />
                    <button type="button" className="auth-pw-toggle" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Piilota salasana' : 'Näytä salasana'} aria-pressed={showPw}>
                      <Icon name={showPw ? 'eye-off' : 'eye'} size={19} />
                    </button>
                  </div>
                </Field>
              )}
              {mode === 'login' && (
                <div className="auth-forgot"><button type="button" className="auth-textlink" onClick={() => switchMode('reset')}>Unohditko salasanan?</button></div>
              )}
              <Button type="submit" variant="lime" size="lg" block loading={busy === 'form'} disabled={!!busy && busy !== 'form'} missing={mode === 'register' && !ageReady ? 'Vahvista ensin yllä, että olet vähintään 18-vuotias.' : null} iconRight={mode === 'reset' ? 'send' : 'arrow-right'} className="auth-submit">
                {copy.submit}
              </Button>
            </form>
            {mode === 'register' && (
              <p className="auth-terms">
                Luomalla tilin hyväksyt <a className="auth-textlink" href="/kayttoehdot" target="_blank" rel="noopener">käyttöehdot</a> ja{' '}
                <a className="auth-textlink" href="/tietosuoja" target="_blank" rel="noopener">tietosuojaselosteen</a>. Ikä on pelaajalle vapaaehtoinen. Terveystietoja ei saa kirjata Koutsiin.
              </p>
            )}
          </div>
        )}
      </div>
      <nav className="auth-links" aria-label="Muut vaihtoehdot">
        <a className="auth-demo-link" href={`https://demo.koutsi.krossi.app${isCoach ? '/valmentaja' : '/pelaaja'}?uusi=1`}>
          <span className="auth-demo-link-icon"><Icon name="play" size={16} /></span>
          <span className="auth-demo-link-text">
            <span className="auth-demo-link-title">Kokeile ensin demoa</span>
            <span className="auth-demo-link-sub">{isCoach ? 'Katso valmentajan viikko ilman tiliä' : 'Katso pelaajan näkymä ilman tiliä'}</span>
          </span>
          <Icon name="arrow-right" size={18} className="auth-demo-link-arrow" />
        </a>
      </nav>
    </AuthLayout>
  );
}

/** Reached from a "unohditko salasanan" email: Supabase has already signed the person in. */
export function SetPasswordScreen() {
  const { endRecovery, signOut } = useSession();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const ready = pw.length >= MIN_PASSWORD && pw === pw2;
  const submit = async (e) => {
    e.preventDefault();
    if (!ready || busy) return;
    setError(''); setBusy(true);
    try {
      await api.auth.updatePassword(pw);
      setDone(true);
      setTimeout(() => endRecovery(), 1200);
    } catch (err) { setError(err.userMessage); } finally { setBusy(false); }
  };
  return (
    <div className="k-center-page">
      <div className="k-gate-card">
        <KoutsiWordmark size="sm" />
        <h1 className="k-gate-title">Aseta uusi salasana</h1>
        <p className="k-gate-lead">Vähintään {MIN_PASSWORD} merkkiä. Uusi salasana tulee voimaan heti.</p>
        {error && <Alert tone="error">{error}</Alert>}
        {done ? <Alert tone="success">Salasana vaihdettu. Siirrytään Koutsiin…</Alert> : (
          <form className="auth-form" onSubmit={submit}>
            <Field label="Uusi salasana" htmlFor="pw1" error={pw && pw.length < MIN_PASSWORD ? `Vähintään ${MIN_PASSWORD} merkkiä.` : null}>
              <Input id="pw1" type="password" size="lg" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
            </Field>
            <Field label="Uusi salasana uudelleen" htmlFor="pw2" error={pw2 && pw !== pw2 ? 'Salasanat eivät täsmää.' : null}>
              <Input id="pw2" type="password" size="lg" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </Field>
            <Button type="submit" variant="dark" size="lg" block missing={pw.length < MIN_PASSWORD ? `Salasanassa pitää olla vähintään ${MIN_PASSWORD} merkkiä.` : pw !== pw2 ? 'Salasanat eivät täsmää.' : null} loading={busy}>Tallenna salasana</Button>
            <Button variant="ghost" block onClick={() => { signOut(); endRecovery(); }}>Peruuta</Button>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * First-time profile on the shared profiles row. Name and home area are required (the
 * shared row needs them), exact age is optional, a coach can add a photo. A player's profile
 * is never shown in Krossi's player search.
 */
export function OnboardingScreen({ role }) {
  const { uid, refreshProfile, signOut } = useSession();
  const isPlayer = role === 'player';
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [area, setArea] = useState('');
  const [avatarFile, setAvatarFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const ageValid = !age || (/^\d{1,3}$/.test(age) && Number(age) >= 1 && Number(age) < 120);
  const ready = name.trim() && area && ageValid;
  const save = async () => {
    if (!ready || busy) return;
    setError(''); setBusy(true);
    try {
      await api.account.createProfile(uid, { name, age: age || null, area, avatarFile, role });
      await refreshProfile();
    } catch (err) { setError(err.userMessage); setBusy(false); }
  };
  return (
    <div className="k-center-page">
      <div className="k-gate-card k-gate-card-wide">
        <KoutsiWordmark size="sm" />
        <h1 className="k-gate-title">Luo profiilisi</h1>
        <p className="k-gate-lead">{isPlayer
          ? 'Profiilisi ei näy julkisena eikä muiden käyttäjien haussa. Valmentajasi näkee vain valmennuksessa tarvittavat tiedot.'
          : 'Sama profiili näkyy koko Krossissa. Voit täydentää valmentajatietosi myöhemmin.'}</p>
        {error && <Alert tone="error">{error}</Alert>}
        {!isPlayer && (
          // a label around the input: every phone opens its picker from a tap on it
          <label className="k-avatar-pick" aria-label="Valitse profiilikuva">
            {preview ? <img src={preview} alt="" /> : <Icon name="camera" size={26} />}
            <span className="k-avatar-pick-badge"><Icon name="plus" size={14} /></span>
            <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setAvatarFile(f); setPreview(URL.createObjectURL(f)); } }} />
          </label>
        )}
        <div className="stack-4">
          <Field label="Nimi" htmlFor="onb-name"><Input id="onb-name" size="lg" value={name} onChange={(e) => setName(e.target.value)} placeholder="Etunimi Sukunimi" autoComplete="name" /></Field>
          <Field label="Ikä" optional htmlFor="onb-age" error={!ageValid ? 'Jos annat iän, sen pitää olla 1–119 vuotta.' : null}>
            <Input id="onb-age" size="lg" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} placeholder="Esim. 24" />
          </Field>
          <Field label="Kotikaupunki">
            <ChipSelect options={AREA_OPTIONS.map((a) => ({ value: a, label: a }))} value={area} onChange={setArea} ariaLabel="Kotikaupunki" />
          </Field>
        </div>
        <Button variant="dark" size="lg" block missing={!name.trim() ? 'Kirjoita nimesi.' : !area ? 'Valitse kotikaupunki.' : !ageValid ? 'Iän pitää olla 1–119 vuotta (tai jätä tyhjäksi).' : null} loading={busy} onClick={save} className="k-gate-cta">Jatka</Button>
        <Button variant="ghost" block onClick={signOut}>Kirjaudu ulos</Button>
      </div>
    </div>
  );
}

/** Closed-pilot acknowledgement: no health data may be recorded. Versions match the old app. */
export function PilotGate({ role }) {
  const { acceptPilot, signOut } = useSession();
  const [rules, setRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (!rules || busy) return;
    setBusy(true); setError('');
    try { await acceptPilot(); } catch (err) { setError(err.userMessage || 'Vahvistusta ei voitu tallentaa.'); setBusy(false); }
  };
  return (
    <div className="k-center-page">
      <div className="k-gate-card k-gate-card-wide">
        <span className="chip chip-lime chip-sm">Suljettu beta</span>
        <h1 className="k-gate-title">Ennen kuin jatkat</h1>
        <p className="k-gate-lead">{role === 'coach'
          ? 'Voit lisätä pelaajan pelkällä nimellä. Ikä on vapaaehtoinen, eikä terveystietoja tallenneta Koutsiin.'
          : 'Ikää ei tarvitse ilmoittaa. Voit lisätä tarkan iän profiiliisi myöhemmin tai käyttää Koutsia kokonaan ilman ikätietoa.'}</p>
        {error && <Alert tone="error">{error}</Alert>}
        <label className="k-check k-check-boxed">
          <input type="checkbox" checked={rules} onChange={(e) => setRules(e.target.checked)} />
          <span>Ymmärrän, ettei Koutsiin saa kirjata vammoja, sairauksia, diagnooseja, lääkityksiä tai muita terveystietoja.</span>
        </label>
        <p className="k-fine">Vahvistus tallennetaan käyttäjätilillesi. Lue myös <a href="/kayttoehdot" target="_blank" rel="noopener">käyttöehdot</a> ja <a href="/tietosuoja" target="_blank" rel="noopener">tietosuojaseloste</a>.</p>
        <Button variant="dark" size="lg" block missing={!rules ? 'Rastita ensin yllä oleva kohta.' : null} loading={busy} onClick={submit}>Vahvista ja jatka</Button>
        <Button variant="ghost" block onClick={signOut} disabled={busy}>Kirjaudu ulos</Button>
      </div>
    </div>
  );
}
