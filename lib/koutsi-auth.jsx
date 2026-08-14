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
  const [loading, setLoading] = React.useState(true);
  const loadProfile = React.useCallback(async (uid) => {
    if (!uid) { setProfile(null); return; }
    try {
      const { data, error } = await koutsiSupabase.from('profiles').select('id, name, avatar_url, avatar_color').eq('id', uid).maybeSingle();
      if (error) throw error;
      setProfile(data || null);
    } catch { setProfile(null); }
  }, []);
  React.useEffect(() => {
    koutsiSupabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s?.user?.id) loadProfile(s.user.id).finally(() => setLoading(false));
      else setLoading(false);
    });
    const { data: { subscription } } = koutsiSupabase.auth.onAuthStateChange((ev, s) => {
      setSession(s);
      if (ev === 'TOKEN_REFRESHED' || ev === 'USER_UPDATED') return;
      if (s?.user?.id) { setLoading(true); loadProfile(s.user.id).finally(() => setLoading(false)); }
      else { setProfile(null); setLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, [loadProfile]);
  const refreshProfile = React.useCallback(async () => { if (session?.user?.id) await loadProfile(session.user.id); }, [session, loadProfile]);
  const value = React.useMemo(() => ({
    session, profile, loading,
    needsOnboarding: Boolean(session?.user && !profile && !loading),
    refreshProfile,
    signOut: () => koutsiSupabase.auth.signOut(),
  }), [session, profile, loading, refreshProfile]);
  return <KoutsiAuthContext.Provider value={value}>{children}</KoutsiAuthContext.Provider>;
}
function useKoutsiAuth() { return React.useContext(KoutsiAuthContext); }

// ── Auth screen ──────────────────────────────────────────
function KoutsiAuthScreen() {
  const [mode, setMode] = React.useState('register');
  const [email, setEmail] = React.useState('');
  const [pw, setPw] = React.useState('');
  const [error, setError] = React.useState('');
  const [info, setInfo] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const redirectPath = window.location.pathname.startsWith('/pelaaja') ? '/pelaaja' : '/valmentaja';
  const redirectTo = window.location.origin + redirectPath;

  const signInWithGoogle = async () => {
    setError(''); setBusy(true);
    try {
      const { error: e } = await koutsiSupabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
      if (e) throw e;
    } catch (err) { setError(err.message || 'Google-kirjautuminen epäonnistui'); setBusy(false); }
  };
  const signInWithApple = async () => {
    setError(''); setBusy(true);
    try {
      const { error: e } = await koutsiSupabase.auth.signInWithOAuth({ provider: 'apple', options: { redirectTo } });
      if (e) throw e;
    } catch (err) { setError(err.message || 'Apple-kirjautuminen epäonnistui'); setBusy(false); }
  };
  const submit = async (e) => {
    e.preventDefault(); setError(''); setInfo(''); setBusy(true);
    try {
      if (mode === 'login') {
        const { error } = await koutsiSupabase.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
      } else if (mode === 'register') {
        const { data, error } = await koutsiSupabase.auth.signUp({ email, password: pw, options: { emailRedirectTo: redirectTo } });
        if (error) throw error;
        if (data.user && !data.session) setInfo('Vahvistusviesti lähetetty sähköpostiisi.');
      } else {
        const { error } = await koutsiSupabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
        setInfo('Palautuslinkki lähetetty.');
      }
    } catch (err) { setError(err.message || 'Virhe'); } finally { setBusy(false); }
  };

  const oauthBtnStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%',
    padding: '13px 16px', borderRadius: 14, border: '1px solid var(--line)', background: '#fff',
    cursor: 'pointer', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, color: '#111',
  };
  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--sand)' }}>
      <a href="https://koutsi.krossi.app" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7, textDecoration: 'none', marginBottom: 28 }}>
        <span style={{ fontWeight: 800, fontSize: 30, color: 'var(--green-deep)', letterSpacing: -1 }}>Krossi</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#8a857a' }}>Koutsi</span>
      </a>
      <div className="k-card" style={{ width: 'min(400px, 100%)', padding: '30px 28px' }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6, color: '#111' }}>
          {mode === 'login' ? 'Kirjaudu sisään' : mode === 'register' ? 'Luo tili' : 'Palauta salasana'}
        </h2>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 18, lineHeight: 1.5 }}>
          Sama tili toimii koko Krossissa — jos sinulla on jo Krossi-tili, kirjaudu samoilla tunnuksilla.
        </p>
        {error && <div style={{ background: 'rgba(161,59,47,0.08)', border: '1px solid rgba(161,59,47,0.25)', color: '#a13b2f', padding: '10px 14px', borderRadius: 12, fontSize: 13, marginBottom: 14 }}>{error}</div>}
        {info && <div style={{ background: 'rgba(14,59,44,0.08)', border: '1px solid rgba(14,59,44,0.25)', color: 'var(--green-deep)', padding: '10px 14px', borderRadius: 12, fontSize: 13, marginBottom: 14 }}>{info}</div>}

        {mode !== 'reset' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            <button style={oauthBtnStyle} onClick={signInWithGoogle} disabled={busy}>
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" /><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" /><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.0 24.0 0 0 0 0 21.56l7.98-6.19z" /><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" /></svg>
              Jatka Googlella
            </button>
            <button style={oauthBtnStyle} onClick={signInWithApple} disabled={busy}>
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
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input style={inputStyle} type="email" placeholder="Sähköposti" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {mode !== 'reset' && <input style={inputStyle} type="password" placeholder="Salasana" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} />}
          <button className="btn-dark" type="submit" disabled={busy} style={{ padding: '13px 0', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Odota...' : mode === 'login' ? 'Kirjaudu' : mode === 'register' ? 'Luo tili' : 'Lähetä linkki'}
          </button>
        </form>
        <div style={{ marginTop: 18, textAlign: 'center', fontSize: 13 }}>
          {mode === 'login' ? (
            <React.Fragment>
              <button onClick={() => { setMode('register'); setError(''); setInfo(''); }} style={{ background: 'none', border: 'none', color: 'var(--green-deep)', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Luo uusi tili</button>
              <span style={{ color: '#c5c0b5', margin: '0 8px' }}>·</span>
              <button onClick={() => { setMode('reset'); setError(''); setInfo(''); }} style={{ background: 'none', border: 'none', color: '#8a857a', cursor: 'pointer', fontFamily: 'inherit' }}>Unohditko salasanan?</button>
            </React.Fragment>
          ) : (
            <button onClick={() => { setMode('login'); setError(''); setInfo(''); }} style={{ background: 'none', border: 'none', color: 'var(--green-deep)', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Kirjaudu sisään</button>
          )}
        </div>
      </div>
      <a href="https://koutsi.krossi.app" style={{ color: '#8a857a', marginTop: 22, fontSize: 13, textDecoration: 'none' }}>← Takaisin etusivulle</a>
    </div>
  );
}

// ── Lightweight profile onboarding ──────────────────────
// Only collects what `profiles` requires (name, age bucket, area are NOT NULL) plus an
// optional avatar — the full matchmaking onboarding (skill level, availability, bio) is
// the main Krossi app's concern, not duplicated here. hidden_from_feed defaults to true:
// someone who joined through a coach shouldn't unexpectedly show up in the "find a
// playing partner" feed until they choose to complete a real player profile.
function KoutsiProfileOnboarding() {
  const { session, refreshProfile } = useKoutsiAuth();
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
  const ready = name.trim() && age && area;
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
        id: uid, name: name.trim(), age, area, hidden_from_feed: true, playing_this_week: false,
        ...(avatarPath ? { avatar_url: avatarPath } : {}),
      });
      if (upsertErr) throw upsertErr;
      await koutsiSupabase.auth.updateUser({ data: { display_name: name.trim(), full_name: name.trim() } });
      await refreshProfile();
    } catch (err) { setError(err.message || 'Tallennus epäonnistui'); } finally { setBusy(false); }
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
          Sama profiili näkyy koko Krossissa. Voit täydentää pelaajatietosi (pelitaso, saatavuus) myöhemmin, jos haluat etsiä peliseuraa Krossista.
        </p>
        {error && <div style={{ background: 'rgba(161,59,47,0.08)', border: '1px solid rgba(161,59,47,0.25)', color: '#a13b2f', padding: '10px 14px', borderRadius: 12, fontSize: 13, marginBottom: 14 }}>{error}</div>}
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
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Nimi</div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Etunimi" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff', marginBottom: 16 }} />
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Ikä</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {KOUTSI_AGE_RANGES.map((r) => <button key={r.value} type="button" onClick={() => setAge(r.value)} style={chipStyle(age === r.value)}>{r.label}</button>)}
        </div>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Kotikaupunki</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 22 }}>
          {KOUTSI_AREA_OPTIONS.map((a) => <button key={a} type="button" onClick={() => setArea(a)} style={chipStyle(area === a)}>{a}</button>)}
        </div>
        <button onClick={save} className="btn-dark" disabled={!ready || busy} style={{ width: '100%', padding: '13px 0', border: 'none', opacity: (!ready || busy) ? 0.45 : 1, cursor: (!ready || busy) ? 'default' : 'pointer' }}>
          {busy ? 'Tallennetaan...' : 'Jatka'}
        </button>
      </div>
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

Object.assign(window, {
  koutsiSupabase, KOUTSI_SUPABASE_URL,
  koutsiAuthAvatarUrl,
  KoutsiAuthProvider, useKoutsiAuth,
  KoutsiAuthScreen, KoutsiProfileOnboarding, KoutsiAuthLoadingScreen,
});
