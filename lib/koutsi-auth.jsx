// koutsi-auth.jsx — shared Supabase auth + lightweight profile onboarding for the real
// Koutsi app (koutsi-valmentaja.html / koutsi-pelaaja.html). Same Supabase project, same
// auth.users/profiles table as the main Krossi app (lib/krossi-web-app.jsx) — a coach or
// player who signs up here already has a Krossi account, ready for matchmaking later.
// Mirrors krossi-web-app.jsx's auth mechanics exactly (same OAuth providers, same
// signUp/signInWithPassword calls) but themed to match Koutsi's own visual language
// instead of importing the main app's CSS classes.

const KOUTSI_SUPABASE_URL = 'https://hhybjpgrvlbazbqiaaao.supabase.co';
const KOUTSI_SUPABASE_ANON_KEY = 'sb_publishable_IKLRGbstMLfxKeXwBTavSA_UVYyMgTL';
const koutsiSupabase = window.supabase.createClient(KOUTSI_SUPABASE_URL, KOUTSI_SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
});

const KOUTSI_AREA_OPTIONS = ['Lahti', 'Turku', 'Helsinki', 'Tampere', 'Oulu', 'Jyväskylä', 'Pori', 'Kuopio'];
const KOUTSI_AGE_RANGES = [
  { value: 'alle20', label: 'Alle 20' },
  { value: '20-30', label: '20–30' },
  { value: '30-40', label: '30–40' },
  { value: '40-50', label: '40–50' },
  { value: '50-60', label: '50–60' },
  { value: '60+', label: '60+' },
];
const KOUTSI_AGE_RANGE_VALUES = new Set(KOUTSI_AGE_RANGES.map((range) => range.value));
function koutsiOptionalAgeValid(value) {
  if (!value) return true;
  if (KOUTSI_AGE_RANGE_VALUES.has(value)) return true;
  const exact = Number(value);
  return /^\d{1,3}$/.test(value) && Number.isInteger(exact) && exact >= 1 && exact < 120;
}
const KOUTSI_PILOT_TERMS_VERSION = '2026-08-24-junior-pilot';
const KOUTSI_PILOT_PRIVACY_VERSION = '2026-08-24-junior-pilot';

// The phrasebook lives in koutsi-data.js, which loads after this file; guarded so a
// half-loaded page still says something in Finnish instead of a raw Postgres sentence.
function koutsiAuthErrorText(err, fallback) {
  if (window.koutsiErrorText) return window.koutsiErrorText(err, fallback);
  return (typeof err === 'string' ? err : err?.message) || fallback || 'Jokin meni pieleen. Yritä uudelleen.';
}
function koutsiAuthRawMessage(err) {
  return (typeof err === 'string' ? err : (err?.message || err?.error_description || '')) || '';
}

// Supabase bounces a dead confirmation / recovery link back here with the reason in the
// URL fragment and no session. Without reading it the person just lands on the login form
// again with no idea why the link did nothing — so say it, and point at the way forward.
// Safe to clear the fragment here: this only runs once the auth screen renders, i.e. after
// the client has already had its chance to exchange any real tokens in the URL.
function koutsiAuthLinkError() {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  const params = new URLSearchParams(hash || window.location.search.slice(1));
  const code = params.get('error_code') || '';
  const desc = params.get('error_description') || params.get('error') || '';
  if (!code && !desc) return '';
  window.history.replaceState(null, '', window.location.pathname);
  if (/expired|otp_expired/i.test(`${code} ${desc}`)) return 'Linkki on vanhentunut tai se on jo käytetty. Pyydä uusi linkki alta.';
  if (/access_denied/i.test(`${code} ${desc}`)) return 'Kirjautuminen peruuntui. Yritä uudelleen.';
  return 'Linkki ei kelvannut. Yritä kirjautua sisään tai pyydä uusi linkki alta.';
}

function koutsiAuthAvatarUrl(path) {
  return path ? (path.startsWith('http') ? path : `${KOUTSI_SUPABASE_URL}/storage/v1/object/public/profile-avatars/${path}`) : null;
}

// ── Auth context ─────────────────────────────────────────
// `profile` here is the person's shared Krossi profiles row (name/avatar) — not their
// Koutsi coach/student row, which each app's own root component queries separately
// once this gate is past (see koutsi-valmentaja-app.jsx / koutsi-pelaaja-app.jsx).
const KoutsiAuthContext = React.createContext(null);
function KoutsiAuthProvider({ children }) {
  const [session, setSession] = React.useState(null);
  const [profile, setProfile] = React.useState(null);
  const [pilotAccepted, setPilotAccepted] = React.useState(false);
  const [pilotAgeGroup, setPilotAgeGroup] = React.useState(null);
  const [pilotError, setPilotError] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  // Supabase turns a recovery link into a real session before firing PASSWORD_RECOVERY.
  // Without this flag the person would simply land in the app, still holding the old
  // password they came here to change — which is exactly what used to happen.
  const [recoveryMode, setRecoveryMode] = React.useState(
    () => window.location.hash.includes('type=recovery') || new URLSearchParams(window.location.search).get('type') === 'recovery'
  );
  // A failed profile fetch is not the same thing as "no profile yet": treating a dropped
  // connection as "new user" used to push an existing coach into onboarding, and a hard
  // failure left the gates spinning forever. Both now end up on KoutsiErrorScreen.
  const [profileError, setProfileError] = React.useState(false);
  const loadProfile = React.useCallback(async (uid) => {
    if (!uid) { setProfile(null); setProfileError(false); return; }
    try {
      const { data, error } = await koutsiSupabase.from('profiles').select('id, name, avatar_url, avatar_color').eq('id', uid).maybeSingle();
      if (error) throw error;
      setProfile(data || null);
      setProfileError(false);
    } catch { setProfile(null); setProfileError(true); }
  }, []);
  const loadPilotAcknowledgement = React.useCallback(async (uid) => {
    if (!uid) { setPilotAccepted(false); setPilotAgeGroup(null); setPilotError(false); return; }
    try {
      const { data, error } = await koutsiSupabase.from('koutsi_pilot_acknowledgements')
        .select('terms_version, privacy_version, age_group, adult_confirmed_at, junior_privacy_confirmed_at, guardian_approval_verified_at, restricted_data_rules_confirmed_at')
        .eq('user_id', uid)
        .maybeSingle();
      if (error) throw error;
      const ageGroup = data?.age_group || null;
      const ageConfirmed = ageGroup === 'adult'
        ? Boolean(data?.adult_confirmed_at)
        : Boolean(data?.junior_privacy_confirmed_at)
          && (ageGroup !== 'child_under_13' || Boolean(data?.guardian_approval_verified_at));
      setPilotAccepted(Boolean(
        data
        && data.terms_version === KOUTSI_PILOT_TERMS_VERSION
        && data.privacy_version === KOUTSI_PILOT_PRIVACY_VERSION
        && ageConfirmed
        && data.restricted_data_rules_confirmed_at
      ));
      setPilotAgeGroup(ageGroup);
      setPilotError(false);
    } catch {
      setPilotAccepted(false);
      setPilotAgeGroup(null);
      setPilotError(true);
    }
  }, []);
  // Supabase re-validates the stored session every time the tab becomes visible again and
  // reports it as a fresh SIGNED_IN — same person, same session, nothing to do. Acting on
  // it flipped `loading` back on, and since the roots render a loading screen instead of
  // their children, that unmounted the entire app: a coach who switched windows came back
  // to a spinner, then to the first tab with every dialog closed and all data re-fetched.
  // So the gate only reacts when the signed-in user actually changes. `undefined` means
  // no session has been applied yet, which is distinct from a signed-out `null`.
  const appliedUid = React.useRef(undefined);
  const applySession = React.useCallback((s) => {
    setSession(s);
    const uid = s?.user?.id || null;
    if (uid === appliedUid.current) return; // same person returning — keep the app mounted
    appliedUid.current = uid;
    if (uid) {
      setLoading(true);
      Promise.all([loadProfile(uid), loadPilotAcknowledgement(uid)]).finally(() => setLoading(false));
    } else {
      setProfile(null);
      setPilotAccepted(false);
      setPilotAgeGroup(null);
      setPilotError(false);
      setLoading(false);
    }
  }, [loadProfile, loadPilotAcknowledgement]);
  React.useEffect(() => {
    koutsiSupabase.auth.getSession()
      .then(({ data: { session: s } }) => applySession(s))
      .catch(() => setLoading(false)); // no session beats an eternal spinner
    const { data: { subscription } } = koutsiSupabase.auth.onAuthStateChange((ev, s) => {
      if (ev === 'PASSWORD_RECOVERY') { setSession(s); setRecoveryMode(true); setLoading(false); return; }
      if (ev === 'TOKEN_REFRESHED' || ev === 'USER_UPDATED') { setSession(s); return; }
      applySession(s);
    });
    return () => subscription.unsubscribe();
  }, [applySession]);
  const refreshProfile = React.useCallback(async () => { if (session?.user?.id) await loadProfile(session.user.id); }, [session, loadProfile]);
  const retryProfile = React.useCallback(async () => {
    if (!session?.user?.id) return;
    setLoading(true);
    await loadProfile(session.user.id);
    setLoading(false);
  }, [session, loadProfile]);
  const retryPilot = React.useCallback(async () => {
    if (!session?.user?.id) return;
    setLoading(true);
    await loadPilotAcknowledgement(session.user.id);
    setLoading(false);
  }, [session, loadPilotAcknowledgement]);
  const acceptPilot = React.useCallback(async (ageGroup = 'adult') => {
    const uid = session?.user?.id;
    if (!uid) throw new Error('Kirjaudu uudelleen ennen jatkamista.');
    if (!['adult', 'junior_13_17', 'child_under_13'].includes(ageGroup)) {
      throw new Error('Valitse ikäryhmä ennen jatkamista.');
    }
    const now = new Date().toISOString();
    const { error } = await koutsiSupabase.from('koutsi_pilot_acknowledgements').upsert({
      user_id: uid,
      terms_version: KOUTSI_PILOT_TERMS_VERSION,
      privacy_version: KOUTSI_PILOT_PRIVACY_VERSION,
      age_group: ageGroup,
      adult_confirmed_at: ageGroup === 'adult' ? now : null,
      junior_privacy_confirmed_at: ageGroup === 'adult' ? null : now,
      guardian_approval_verified_at: null,
      restricted_data_rules_confirmed_at: now,
      updated_at: now,
    }, { onConflict: 'user_id' });
    if (error) throw error;
    setPilotAccepted(true);
    setPilotAgeGroup(ageGroup);
    setPilotError(false);
  }, [session]);
  const value = React.useMemo(() => ({
    session, profile, loading,
    needsOnboarding: Boolean(session?.user && !profile && !profileError && !loading),
    profileError, retryProfile,
    pilotAccepted, pilotAgeGroup, pilotError, retryPilot, acceptPilot,
    recoveryMode,
    endRecovery: () => {
      setRecoveryMode(false);
      // drop the recovery fragment so a refresh doesn't reopen the reset screen
      window.history.replaceState(null, '', window.location.pathname);
    },
    refreshProfile,
    signOut: () => koutsiSupabase.auth.signOut(),
  }), [session, profile, loading, profileError, retryProfile, pilotAccepted, pilotAgeGroup, pilotError, retryPilot, acceptPilot, recoveryMode, refreshProfile]);
  return <KoutsiAuthContext.Provider value={value}>{children}</KoutsiAuthContext.Provider>;
}
function useKoutsiAuth() { return React.useContext(KoutsiAuthContext); }

// ── Auth screen ──────────────────────────────────────────
function KoutsiAuthScreen() {
  // A dead link means they already have an account, so open on the login form — that is
  // also where "Unohditko salasanan?" lives, which is what a stale recovery link needs.
  const [linkError] = React.useState(koutsiAuthLinkError);
  const [mode, setMode] = React.useState(() => {
    if (linkError) return 'login';
    const requestedMode = new URLSearchParams(window.location.search).get('auth');
    return requestedMode === 'login' || requestedMode === 'reset' ? requestedMode : 'register';
  });
  const [email, setEmail] = React.useState('');
  const [pw, setPw] = React.useState('');
  const [error, setError] = React.useState(linkError);
  const [info, setInfo] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [adultDeclared, setAdultDeclared] = React.useState(false);
  // Shown after a sign-up, and after a login that failed only because the address is
  // still unconfirmed — without it a lost confirmation mail is the end of the road.
  const [canResend, setCanResend] = React.useState(false);

  const pageParams = new URLSearchParams(window.location.search);
  const inviteCode = pageParams.get('koodi');
  const inviteStudentId = pageParams.get('oppilas');
  const redirectPath = window.location.pathname.startsWith('/pelaaja') ? '/pelaaja' : '/valmentaja';
  const isCoachRoute = redirectPath === '/valmentaja';
  const registrationAgeReady = !isCoachRoute || adultDeclared;
  const playerInviteParams = new URLSearchParams();
  if (inviteCode) playerInviteParams.set('koodi', inviteCode);
  if (inviteStudentId) playerInviteParams.set('oppilas', inviteStudentId);
  const playerInviteQuery = playerInviteParams.toString();
  const redirectTo = window.location.origin + redirectPath + (!isCoachRoute && playerInviteQuery ? `?${playerInviteQuery}` : '');
  const coachKeyEmailHref = 'mailto:eelispuro@gmail.com?subject=Valmentaja-avain%20Koutsiin&body=Moi%20Eelis%2C%0A%0ATarvitsisin%20valmentaja-avaimen%20Koutsiin.%0A%0ATerveisin%2C%0A%5BOma%20nimi%5D';
  const roleHref = (role) => {
    const path = role === 'coach' ? '/valmentaja' : '/pelaaja';
    const params = new URLSearchParams();
    if (mode !== 'register') params.set('auth', mode);
    if (inviteCode) params.set('koodi', inviteCode);
    if (inviteStudentId) params.set('oppilas', inviteStudentId);
    const query = params.toString();
    return `${path}${query ? `?${query}` : ''}`;
  };

  const signInWithGoogle = async () => {
    if (mode === 'register' && !registrationAgeReady) { setError('Valmentajatilin käyttäjän pitää olla vähintään 18-vuotias.'); return; }
    setError(''); setBusy(true);
    try {
      const { error: e } = await koutsiSupabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
      if (e) throw e;
    } catch (err) { setError(koutsiAuthErrorText(err, 'Google-kirjautuminen epäonnistui')); setBusy(false); }
  };
  const signInWithApple = async () => {
    if (mode === 'register' && !registrationAgeReady) { setError('Valmentajatilin käyttäjän pitää olla vähintään 18-vuotias.'); return; }
    setError(''); setBusy(true);
    try {
      const { error: e } = await koutsiSupabase.auth.signInWithOAuth({ provider: 'apple', options: { redirectTo } });
      if (e) throw e;
    } catch (err) { setError(koutsiAuthErrorText(err, 'Apple-kirjautuminen epäonnistui')); setBusy(false); }
  };
  const submit = async (e) => {
    e.preventDefault(); setError(''); setInfo(''); setCanResend(false); setBusy(true);
    try {
      if (mode === 'login') {
        const { error } = await koutsiSupabase.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
      } else if (mode === 'register') {
        if (!registrationAgeReady) throw new Error('Valmentajatilin käyttäjän pitää olla vähintään 18-vuotias.');
        const { data, error } = await koutsiSupabase.auth.signUp({ email, password: pw, options: { emailRedirectTo: redirectTo } });
        if (error) throw error;
        if (data.user && !data.session) {
          setInfo('Vahvistusviesti lähetetty sähköpostiisi. Tarkista myös roskaposti.');
          setCanResend(true);
        }
      } else {
        const { error } = await koutsiSupabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
        setInfo('Palautuslinkki lähetetty. Avaa se samalla laitteella ja aseta uusi salasana.');
      }
    } catch (err) {
      setError(koutsiAuthErrorText(err));
      if (/email not confirmed/i.test(koutsiAuthRawMessage(err))) setCanResend(true);
    } finally { setBusy(false); }
  };
  const resendConfirmation = async () => {
    setError(''); setInfo(''); setBusy(true);
    try {
      const { error } = await koutsiSupabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo } });
      if (error) throw error;
      setInfo('Uusi vahvistusviesti lähetetty. Tarkista myös roskaposti.');
    } catch (err) { setError(koutsiAuthErrorText(err, 'Viestin lähetys ei onnistunut')); } finally { setBusy(false); }
  };

  const oauthBtnStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%',
    padding: '13px 16px', borderRadius: 14, border: '1px solid var(--line)', background: '#fff',
    cursor: 'pointer', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, color: '#111',
  };
  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--green-deep)' }}>
      <a href="https://koutsi.krossi.app" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textDecoration: 'none', marginBottom: 24 }}>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7 }}>
          <span style={{ fontWeight: 800, fontSize: 30, color: 'var(--lime)', letterSpacing: -1 }}>Krossi</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>Koutsi</span>
        </span>
        <span style={{ padding: '5px 14px', borderRadius: 999, background: 'rgba(207,228,20,0.12)', border: '1px solid rgba(207,228,20,0.5)', color: 'var(--lime)', fontSize: 11.5, fontWeight: 800, letterSpacing: 0.7 }}>
          {isCoachRoute ? 'VALMENTAJA' : 'PELAAJA'}
        </span>
      </a>
      <div className="k-card" style={{ width: 'min(400px, 100%)', padding: '30px 28px', boxShadow: '0 22px 55px -28px rgba(0,0,0,0.65)' }}>
        <div role="tablist" aria-label="Valitse rooli" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, padding: 4, marginBottom: 22, borderRadius: 14, background: '#f1efe8', border: '1px solid var(--line)' }}>
          {[
            { role: 'coach', label: 'Valmentaja', selected: isCoachRoute },
            { role: 'player', label: 'Pelaaja', selected: !isCoachRoute },
          ].map((item) => (
            <a
              key={item.role}
              href={roleHref(item.role)}
              role="tab"
              aria-selected={item.selected}
              onClick={(e) => { if (item.selected) e.preventDefault(); }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 40, padding: '9px 12px', borderRadius: 10, background: item.selected ? 'var(--green-deep)' : 'transparent', color: item.selected ? '#fff' : '#6b665c', fontSize: 13.5, fontWeight: 800, textDecoration: 'none', boxShadow: item.selected ? '0 5px 14px -9px rgba(14,59,44,0.8)' : 'none' }}>
              {item.label}
            </a>
          ))}
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: isCoachRoute ? 12 : 18, color: '#111' }}>
          {mode === 'login' ? 'Kirjaudu sisään' : mode === 'register' ? 'Luo tili' : 'Palauta salasana'}
        </h2>
        {isCoachRoute && (
          <div style={{ background: 'rgba(207,228,20,0.12)', border: '1px solid rgba(207,228,20,0.4)', borderRadius: 12, padding: '11px 14px', fontSize: 12.5, color: '#5c6b06', lineHeight: 1.5, marginBottom: 18 }}>
            <strong style={{ display: 'block', marginBottom: 4 }}>Onko sinulla valmentaja-avain?</strong>
            Jos ei ole, <a href={coachKeyEmailHref} style={{ color: 'inherit', fontWeight: 700 }}>pyydä se täältä</a>.
            <span style={{ display: 'block', marginTop: 6 }}>
              Tarvitset sitä kirjautumisen jälkeen.
            </span>
          </div>
        )}
        {error && <div style={{ background: 'rgba(161,59,47,0.08)', border: '1px solid rgba(161,59,47,0.25)', color: '#a13b2f', padding: '10px 14px', borderRadius: 12, fontSize: 13, marginBottom: 14 }}>{error}</div>}
        {info && <div style={{ background: 'rgba(14,59,44,0.08)', border: '1px solid rgba(14,59,44,0.25)', color: 'var(--green-deep)', padding: '10px 14px', borderRadius: 12, fontSize: 13, marginBottom: 14 }}>{info}</div>}
        {canResend && email.trim() && (
          <button onClick={resendConfirmation} disabled={busy} style={{ background: 'none', border: 'none', color: 'var(--green-deep)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', padding: 0, marginBottom: 14, textAlign: 'left' }}>
            Eikö viesti tullut perille? Lähetä vahvistusviesti uudelleen
          </button>
        )}

        {mode !== 'reset' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            <button style={oauthBtnStyle} onClick={signInWithGoogle} disabled={busy || (mode === 'register' && !registrationAgeReady)}>
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" /><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" /><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.0 24.0 0 0 0 0 21.56l7.98-6.19z" /><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" /></svg>
              Jatka Googlella
            </button>
            <button style={oauthBtnStyle} onClick={signInWithApple} disabled={busy || (mode === 'register' && !registrationAgeReady)}>
              <svg width="16" height="20" viewBox="0 0 20 24" fill="#111"><path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.7-3-2-3.7-2-1.6-.2-3 .9-3.8.9s-2-.9-3.3-.9c-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.5 1.3-.1 1.8-.8 3.3-.8s2 .8 3.3.8c1.4 0 2.2-1.2 3.1-2.5.7-1 1-2 1-2-.1 0-2-.8-2-3.3zM13.9 3.5c.7-.9 1.2-2.1 1-3.3-1 0-2.3.7-3 1.5-.7.8-1.3 2-1.1 3.2 1.1.1 2.3-.6 3.1-1.4z" /></svg>
              Jatka Applella
            </button>
          </div>
        )}
        {mode !== 'reset' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
            <span style={{ fontSize: 12, color: '#a8a297', fontWeight: 600 }}>tai sähköpostilla</span>
            <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
          </div>
        )}
        {mode === 'register' && isCoachRoute && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 12px', marginBottom: 12, borderRadius: 12, background: '#f7f5ef', color: '#514c42', fontSize: 12.5, lineHeight: 1.45, cursor: 'pointer' }}>
            <input type="checkbox" checked={adultDeclared} onChange={(e) => setAdultDeclared(e.target.checked)} style={{ marginTop: 2, accentColor: 'var(--green-deep)' }} />
            <span>Vahvistan olevani vähintään 18-vuotias. Tämä vahvistus koskee valmentajatiliä.</span>
          </label>
        )}
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input style={inputStyle} type="email" placeholder="Sähköposti" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {mode !== 'reset' && <input style={inputStyle} type="password" placeholder="Salasana" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} />}
          <button className="btn-dark" type="submit" disabled={busy || (mode === 'register' && !registrationAgeReady)} style={{ padding: '13px 0', opacity: (busy || (mode === 'register' && !registrationAgeReady)) ? 0.6 : 1 }}>
            {busy ? 'Odota...' : mode === 'login' ? 'Kirjaudu' : mode === 'register' ? 'Luo tili' : 'Lähetä linkki'}
          </button>
        </form>
        {mode === 'register' && (
          <p style={{ marginTop: 14, fontSize: 11.5, color: '#8a857a', lineHeight: 1.5, textAlign: 'center' }}>
            Luomalla tilin hyväksyt <a href="/kayttoehdot" target="_blank" rel="noopener" style={{ color: 'var(--green-deep)', fontWeight: 700 }}>käyttöehdot</a> ja{' '}
            <a href="/tietosuoja" target="_blank" rel="noopener" style={{ color: 'var(--green-deep)', fontWeight: 700 }}>tietosuojaselosteen</a>. Pelaaja valitsee ikäryhmänsä käyttöönotossa. Terveystietoja ei saa kirjata Koutsiin.
          </p>
        )}
        <div style={{ marginTop: 18, textAlign: 'center', fontSize: 13 }}>
          {mode === 'login' ? (
            <React.Fragment>
              <span style={{ color: '#8a857a' }}>Eikö sinulla ole vielä tiliä?</span>{' '}
              <button onClick={() => { setMode('register'); setError(''); setInfo(''); setCanResend(false); }} style={{ background: 'none', border: 'none', color: 'var(--green-deep)', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Luo tili</button>
              <span style={{ color: '#c5c0b5', margin: '0 8px' }}>·</span>
              <button onClick={() => { setMode('reset'); setError(''); setInfo(''); setCanResend(false); }} style={{ background: 'none', border: 'none', color: '#8a857a', cursor: 'pointer', fontFamily: 'inherit' }}>Unohditko salasanan?</button>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <span style={{ color: '#8a857a' }}>Onko sinulla jo tili?</span>{' '}
              <button onClick={() => { setMode('login'); setError(''); setInfo(''); setCanResend(false); }} style={{ background: 'none', border: 'none', color: 'var(--green-deep)', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Kirjaudu sisään</button>
            </React.Fragment>
          )}
        </div>
      </div>
      <a href="https://koutsi.krossi.app" style={{ color: 'rgba(255,255,255,0.68)', marginTop: 22, fontSize: 13, textDecoration: 'none' }}>← Takaisin etusivulle</a>
    </div>
  );
}

// ── Lightweight profile onboarding ──────────────────────
// Only collects what `profiles` requires (name and area) plus optional age and avatar. Age
// can be omitted, expressed as a privacy-friendly range, or supplied as an exact number.
// The full matchmaking onboarding (skill level, availability, bio) is
// the main Krossi app's concern, not duplicated here. hidden_from_feed defaults to true:
// someone who joined through a coach shouldn't unexpectedly show up in the "find a
// playing partner" feed until they choose to complete a real player profile.
function KoutsiProfileOnboarding() {
  const { session, refreshProfile, signOut } = useKoutsiAuth();
  const isPlayerRoute = window.location.pathname.startsWith('/pelaaja');
  const [name, setName] = React.useState('');
  const [age, setAge] = React.useState('');
  const [area, setArea] = React.useState('');
  const [avatarFile, setAvatarFile] = React.useState(null);
  const [avatarPreview, setAvatarPreview] = React.useState(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const avatarInputRef = React.useRef(null);
  const onAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };
  const ageValid = koutsiOptionalAgeValid(age);
  const exactAge = /^\d+$/.test(age) ? age : '';
  const ready = name.trim() && area && ageValid;
  const save = async () => {
    if (!ready) return;
    setError(''); setBusy(true);
    try {
      const uid = session.user.id;
      let avatarPath = null;
      if (avatarFile) {
        const ext = (avatarFile.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${uid}/${Date.now()}.${ext}`;
        const { error: upErr } = await koutsiSupabase.storage.from('profile-avatars').upload(path, avatarFile, { upsert: true });
        if (upErr) throw upErr;
        avatarPath = path;
      }
      const { error: upsertErr } = await koutsiSupabase.from('profiles').upsert({
        id: uid, name: name.trim(), age: age || null, area, hidden_from_feed: true, playing_this_week: false,
        ...(isPlayerRoute ? { is_discoverable: false } : {}),
        ...(avatarPath ? { avatar_url: avatarPath } : {}),
      });
      if (upsertErr) throw upsertErr;
      await koutsiSupabase.auth.updateUser({ data: { display_name: name.trim(), full_name: name.trim() } });
      await refreshProfile();
    } catch (err) { setError(koutsiAuthErrorText(err, 'Tallennus epäonnistui')); } finally { setBusy(false); }
  };
  const chipStyle = (active) => ({
    padding: '8px 14px', borderRadius: 999, border: active ? 'none' : '1px solid #d8d4ca',
    background: active ? 'var(--lime)' : '#fff', color: active ? '#101a08' : '#3c382f',
    fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
  });
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--sand)' }}>
      <div className="k-card" style={{ width: 'min(440px, 100%)', padding: '30px 28px' }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6, color: '#111' }}>Luo profiilisi</h2>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 20, lineHeight: 1.5 }}>
          {isPlayerRoute
            ? 'Profiilisi ei näy julkisena eikä muiden käyttäjien haussa. Valmentajasi näkee vain valmennuksessa tarvittavat tiedot.'
            : 'Sama profiili näkyy koko Krossissa. Voit täydentää valmentajatietosi myöhemmin.'}
        </p>
        {error && <div style={{ background: 'rgba(161,59,47,0.08)', border: '1px solid rgba(161,59,47,0.25)', color: '#a13b2f', padding: '10px 14px', borderRadius: 12, fontSize: 13, marginBottom: 14 }}>{error}</div>}
        {!isPlayerRoute && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
            <div onClick={() => avatarInputRef.current?.click()} style={{ position: 'relative', cursor: 'pointer', width: 84, height: 84 }}>
              {avatarPreview ? (
                <img src={avatarPreview} alt="" style={{ width: 84, height: 84, borderRadius: '50%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: 84, height: 84, borderRadius: '50%', background: 'radial-gradient(120% 120% at 30% 20%, hsl(150 55% 62%), hsl(174 60% 38%))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 28, fontWeight: 700 }}>+</div>
              )}
              <div style={{ position: 'absolute', bottom: 0, right: 0, width: 26, height: 26, borderRadius: '50%', background: 'var(--green-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M3 7h3l2-3h8l2 3h3v13H3z" /><circle cx="12" cy="13" r="4" /></svg>
              </div>
            </div>
            <input ref={avatarInputRef} type="file" accept="image/*" hidden onChange={onAvatarChange} />
          </div>
        )}
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Nimi</div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Etunimi" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff', marginBottom: 16 }} />
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 9 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5 }}>Ikä (valinnainen)</div>
          {age && <button type="button" onClick={() => setAge('')} style={{ border: 'none', background: 'none', padding: 0, color: '#8a857a', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}>Tyhjennä</button>}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {KOUTSI_AGE_RANGES.map((r) => <button key={r.value} type="button" onClick={() => setAge(r.value)} style={chipStyle(age === r.value)}>{r.label}</button>)}
        </div>
        <input
          value={exactAge}
          onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
          inputMode="numeric"
          placeholder="Tai tarkka ikä, esim. 24"
          aria-label="Tarkka ikä"
          style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${ageValid ? '#d8d4ca' : '#c2543f'}`, borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff', marginBottom: ageValid ? 16 : 6 }}
        />
        {!ageValid && <div style={{ fontSize: 12, color: '#c2543f', marginBottom: 16 }}>Jos annat tarkan iän, sen pitää olla 1–119 vuotta.</div>}
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Kotikaupunki</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 22 }}>
          {KOUTSI_AREA_OPTIONS.map((a) => <button key={a} type="button" onClick={() => setArea(a)} style={chipStyle(area === a)}>{a}</button>)}
        </div>
        <button onClick={save} className="btn-dark" disabled={!ready || busy} style={{ width: '100%', padding: '13px 0', border: 'none', opacity: (!ready || busy) ? 0.45 : 1, cursor: (!ready || busy) ? 'default' : 'pointer' }}>
          {busy ? 'Tallennetaan...' : 'Jatka'}
        </button>
        <button onClick={signOut} style={{ background: 'none', border: 'none', color: '#8a857a', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', marginTop: 16, width: '100%' }}>
          Kirjaudu ulos
        </button>
      </div>
    </div>
  );
}

// ── Set a new password ───────────────────────────────────
// Reached only from a "unohditko salasanan" email. Supabase has already exchanged the
// link for a session by the time this renders, so updateUser is all that is left; the
// screen exists because without it that session would silently drop the person into the
// app with their old password unchanged.
function KoutsiPasswordResetScreen() {
  const { endRecovery, signOut } = useKoutsiAuth();
  const [pw, setPw] = React.useState('');
  const [pw2, setPw2] = React.useState('');
  const [error, setError] = React.useState('');
  const [done, setDone] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const tooShort = pw.length > 0 && pw.length < 8;
  const mismatch = pw2.length > 0 && pw !== pw2;
  const ready = pw.length >= 8 && pw === pw2;
  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setError(''); setBusy(true);
    try {
      const { error: err } = await koutsiSupabase.auth.updateUser({ password: pw });
      if (err) throw err;
      setDone(true);
      setTimeout(() => endRecovery(), 1200);
    } catch (err) {
      setError(window.koutsiErrorText ? window.koutsiErrorText(err) : (err.message || 'Salasanan vaihto epäonnistui'));
    } finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--sand)' }}>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7, marginBottom: 28 }}>
        <span style={{ fontWeight: 800, fontSize: 30, color: 'var(--green-deep)', letterSpacing: -1 }}>Krossi</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#8a857a' }}>Koutsi</span>
      </span>
      <div className="k-card" style={{ width: 'min(400px, 100%)', padding: '30px 28px' }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6, color: '#111' }}>Aseta uusi salasana</h2>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 18, lineHeight: 1.5 }}>Vähintään 8 merkkiä. Uusi salasana tulee voimaan heti.</p>
        {error && <div style={{ background: 'rgba(161,59,47,0.08)', border: '1px solid rgba(161,59,47,0.25)', color: '#a13b2f', padding: '10px 14px', borderRadius: 12, fontSize: 13, marginBottom: 14 }}>{error}</div>}
        {done ? (
          <div style={{ background: 'rgba(14,59,44,0.08)', border: '1px solid rgba(14,59,44,0.25)', color: 'var(--green-deep)', padding: '12px 14px', borderRadius: 12, fontSize: 13.5, fontWeight: 600 }}>
            Salasana vaihdettu. Siirrytään Koutsiin…
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input style={inputStyle} type="password" placeholder="Uusi salasana" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus required minLength={8} autoComplete="new-password" />
            {tooShort && <div style={{ fontSize: 12, color: '#a13b2f' }}>Salasanan pitää olla vähintään 8 merkkiä.</div>}
            <input style={inputStyle} type="password" placeholder="Uusi salasana uudelleen" value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={8} autoComplete="new-password" />
            {mismatch && <div style={{ fontSize: 12, color: '#a13b2f' }}>Salasanat eivät täsmää.</div>}
            <button className="btn-dark" type="submit" disabled={!ready || busy} style={{ padding: '13px 0', border: 'none', opacity: (!ready || busy) ? 0.45 : 1, cursor: (!ready || busy) ? 'default' : 'pointer' }}>
              {busy ? 'Tallennetaan...' : 'Tallenna salasana'}
            </button>
          </form>
        )}
        {!done && (
          <button onClick={() => { signOut(); endRecovery(); }} style={{ background: 'none', border: 'none', color: '#8a857a', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', marginTop: 16, width: '100%' }}>Peruuta</button>
        )}
      </div>
    </div>
  );
}

// Every gate in both apps waits on a fetch that can fail on hall wifi. Before this, a
// single rejected promise left the person on the spinner with no way forward but guessing
// that a manual reload might help. Same visual language as the loading screen, but with
// the two exits that were missing: try again, or get out.
function KoutsiErrorScreen({ title, message, onRetry, onSignOut }) {
  const [busy, setBusy] = React.useState(false);
  const retry = async () => {
    if (!onRetry) return;
    setBusy(true);
    try { await onRetry(); } finally { setBusy(false); }
  };
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--sand)' }}>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7, marginBottom: 28 }}>
        <span style={{ fontWeight: 800, fontSize: 30, color: 'var(--green-deep)', letterSpacing: -1 }}>Krossi</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#8a857a' }}>Koutsi</span>
      </span>
      <div className="k-card" style={{ width: 'min(400px, 100%)', padding: '30px 28px' }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8, color: '#111' }}>{title || 'Tietojen haku ei onnistunut'}</h2>
        <p style={{ fontSize: 13.5, color: '#8a857a', lineHeight: 1.55, marginBottom: 20 }}>
          {message || 'Tarkista verkkoyhteys ja yritä uudelleen. Jos ongelma jatkuu, kirjaudu ulos ja takaisin sisään.'}
        </p>
        {onRetry && (
          <button onClick={retry} className="btn-dark" disabled={busy} style={{ width: '100%', padding: '13px 0', border: 'none', opacity: busy ? 0.5 : 1, marginBottom: 10 }}>
            {busy ? 'Yritetään...' : 'Yritä uudelleen'}
          </button>
        )}
        {onSignOut && (
          <button onClick={onSignOut} className="btn-outline" style={{ width: '100%', padding: '13px 0' }}>Kirjaudu ulos</button>
        )}
      </div>
      <a href="https://koutsi.krossi.app" style={{ color: '#8a857a', marginTop: 22, fontSize: 13, textDecoration: 'none' }}>← Takaisin etusivulle</a>
    </div>
  );
}

function KoutsiAuthLoadingScreen() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--sand)' }}>
      <span style={{ fontWeight: 800, fontSize: 30, color: 'var(--green-deep)', letterSpacing: -1 }}>Krossi Koutsi</span>
      <div style={{ marginTop: 20, width: 28, height: 28, border: '3px solid var(--line)', borderTopColor: 'var(--green-deep)', borderRadius: '50%', animation: 'kcSpin .7s linear infinite' }} />
      <style>{'@keyframes kcSpin { to { transform: rotate(360deg); } }'}</style>
    </div>
  );
}

// Closed-pilot gate. This is an acknowledgement of the pilot's scope, not consent to
// process health data: health data is expressly excluded and its dedicated inputs are
// disabled elsewhere in the app and database.
function KoutsiPilotGate() {
  const { acceptPilot, signOut } = useKoutsiAuth();
  const isCoachRoute = window.location.pathname.startsWith('/valmentaja');
  const [ageGroup, setAgeGroup] = React.useState(isCoachRoute ? 'adult' : '');
  const [ageConfirmed, setAgeConfirmed] = React.useState(false);
  const [rules, setRules] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const isJunior = ageGroup === 'junior_13_17' || ageGroup === 'child_under_13';
  const ready = Boolean(ageGroup && ageConfirmed && rules && !busy);
  const submit = async () => {
    if (!ready) return;
    setBusy(true); setError('');
    try { await acceptPilot(ageGroup); }
    catch (err) { setError(koutsiAuthErrorText(err, 'Vahvistusta ei voitu tallentaa.')); setBusy(false); }
  };
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--sand)' }}>
      <div className="k-card" style={{ width: 'min(470px, 100%)', padding: '30px 28px' }}>
        <div style={{ display: 'inline-flex', padding: '5px 10px', marginBottom: 14, borderRadius: 999, background: 'rgba(207,228,20,0.18)', color: '#526006', fontSize: 11.5, fontWeight: 800 }}>SULJETTU BETA</div>
        <h2 style={{ fontSize: 21, fontWeight: 800, marginBottom: 9, color: '#111' }}>Ennen kuin jatkat</h2>
        <p style={{ fontSize: 14, color: '#6b665c', lineHeight: 1.55, marginBottom: 18 }}>
          {isCoachRoute
            ? 'Valmentajana voit lisätä kaikenikäisiä pelaajia. Alaikäisen ja tarvittaessa huoltajan pitää tietää käytöstä. Terveystietoja ei tallenneta Koutsiin.'
            : 'Valitse ikäryhmäsi. Kysymme vain ikäryhmän — emme syntymäaikaa tai henkilöllisyystodistusta.'}
        </p>
        {error && <div style={{ background: 'rgba(161,59,47,0.08)', border: '1px solid rgba(161,59,47,0.25)', color: '#a13b2f', padding: '10px 14px', borderRadius: 12, fontSize: 13, marginBottom: 14 }}>{error}</div>}
        {!isCoachRoute && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
            {[
              ['adult', '18 vuotta tai yli'],
              ['junior_13_17', '13–17 vuotta'],
              ['child_under_13', 'Alle 13 vuotta'],
            ].map(([value, label]) => (
              <button key={value} type="button" onClick={() => { setAgeGroup(value); setAgeConfirmed(false); setError(''); }}
                style={{ minHeight: 58, padding: '9px 8px', borderRadius: 12, border: ageGroup === value ? '2px solid var(--green-deep)' : '1px solid var(--line)', background: ageGroup === value ? 'rgba(207,228,20,0.14)' : '#fff', color: '#26231e', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
                {label}
              </button>
            ))}
          </div>
        )}
        {isJunior && (
          <div style={{ padding: '13px 14px', marginBottom: 12, borderRadius: 12, background: 'rgba(14,59,44,0.06)', border: '1px solid rgba(14,59,44,0.18)', color: '#304a40', fontSize: 13, lineHeight: 1.55 }}>
            <strong style={{ display: 'block', marginBottom: 4 }}>Juniorin tietosuoja selkeästi</strong>
            Koutsi näyttää sinulle valmentajasi lisäämät treenit, tehtävät ja palautteet. Profiilisi ei ole julkinen. Älä kirjoita sovellukseen vammoja, sairauksia tai muita terveystietoja. Sinä tai huoltajasi voitte pyytää tiedot nähtäväksi tai poistettavaksi.
            {ageGroup === 'child_under_13' && <span style={{ display: 'block', marginTop: 6, fontWeight: 700 }}>Tilin aktivointi onnistuu vain, jos valmentaja on vahvistanut huoltajan hyväksynnän.</span>}
          </div>
        )}
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '12px 13px', marginBottom: 10, borderRadius: 12, border: '1px solid var(--line)', cursor: 'pointer', fontSize: 13.5, lineHeight: 1.45 }}>
          <input type="checkbox" checked={ageConfirmed} onChange={(e) => setAgeConfirmed(e.target.checked)} disabled={!ageGroup} style={{ marginTop: 2, accentColor: 'var(--green-deep)' }} />
          <span>{ageGroup === 'adult'
            ? 'Vahvistan olevani vähintään 18-vuotias.'
            : ageGroup === 'child_under_13'
              ? 'Olen lukenut juniorin tietosuojan. Huoltajani on hyväksynyt Koutsin käytön valmentajan kautta.'
              : ageGroup === 'junior_13_17'
                ? 'Olen lukenut ja ymmärtänyt juniorin tietosuojan.'
                : 'Valitse ensin ikäryhmäsi.'}</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '12px 13px', marginBottom: 16, borderRadius: 12, border: '1px solid var(--line)', cursor: 'pointer', fontSize: 13.5, lineHeight: 1.45 }}>
          <input type="checkbox" checked={rules} onChange={(e) => setRules(e.target.checked)} style={{ marginTop: 2, accentColor: 'var(--green-deep)' }} />
          <span>Ymmärrän, ettei Koutsiin saa kirjata vammoja, sairauksia, diagnooseja, lääkityksiä tai muita terveystietoja.</span>
        </label>
        <p style={{ fontSize: 11.5, color: '#8a857a', lineHeight: 1.5, marginBottom: 16 }}>
          Vahvistus tallennetaan käyttäjätilillesi. Lue myös <a href="/kayttoehdot" target="_blank" rel="noopener" style={{ color: 'var(--green-deep)', fontWeight: 700 }}>käyttöehdot</a> ja{' '}
          <a href="/tietosuoja" target="_blank" rel="noopener" style={{ color: 'var(--green-deep)', fontWeight: 700 }}>tietosuojaseloste</a>.
        </p>
        <button onClick={submit} disabled={!ready} className="btn-dark" style={{ width: '100%', padding: '13px 0', opacity: ready ? 1 : 0.45 }}>
          {busy ? 'Tallennetaan…' : 'Vahvista ja jatka'}
        </button>
        <button onClick={signOut} disabled={busy} style={{ width: '100%', marginTop: 14, background: 'none', border: 'none', color: '#8a857a', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>Kirjaudu ulos</button>
      </div>
    </div>
  );
}

// KOUTSI_SUPABASE_ANON_KEY is exported (not just a top-level const) because the bundled
// build wraps each file in its own scope — koutsi-data.js reaches it through window.
Object.assign(window, {
  koutsiSupabase, KOUTSI_SUPABASE_URL, KOUTSI_SUPABASE_ANON_KEY,
  koutsiAuthAvatarUrl,
  KoutsiAuthProvider, useKoutsiAuth,
  KoutsiAuthScreen, KoutsiProfileOnboarding, KoutsiAuthLoadingScreen, KoutsiPasswordResetScreen, KoutsiPilotGate,
  KoutsiErrorScreen,
});
