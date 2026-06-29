// krossi-web-app.jsx — Browser-based Krossi with desktop layout
// Uses same Supabase project as the mobile app

const SUPABASE_URL = 'https://hhybjpgrvlbazbqiaaao.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_IKLRGbstMLfxKeXwBTavSA_UVYyMgTL';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
});

// ── Constants ──────────────────────────────────────────
const AREA_OPTIONS = ['Helsinki', 'Espoo', 'Vantaa', 'Lahti', 'Turku', 'Tampere'];
const VISIBLE_AREAS = ['Lahti', 'Turku'];
const PLAIN_SKILL_LEVELS = ['aloittelija', 'keskitaso', 'edistynyt', 'kilpapelaaja'];
const PLAY_STYLES = ['pallottelu', 'treenit', 'matsit', 'kaksinpeli', 'nelinpeli', 'kaikki käy'];
const MATCH_TYPES = ['kaksinpeli', 'nelinpeli', 'pallottelu'];
const LOCATION_TYPES = ['sisätennis', 'ulkotennis', 'missä vain'];
const AVAILABILITY_SLOTS = [
  { value: 'aamuvirkku', label: 'Aamuvirkku', time: '6-9' },
  { value: 'arkiaamut', label: 'Arkiaamut', time: '9-12' },
  { value: 'arkipäivät', label: 'Arkipäivät', time: '12-15' },
  { value: 'arki-iltapäivät', label: 'Arki-iltapäivät', time: '15-18' },
  { value: 'arki-illat', label: 'Arki-illat', time: '19-22' },
  { value: 'viikonloppuaamut', label: 'Viikonloppuaamut', time: '9-12' },
  { value: 'viikonloppupäivät', label: 'Viikonloppupäivät', time: '12-15' },
  { value: 'viikonloppuiltapäivät', label: 'Viikonloppuiltapäivät', time: '15-18' },
  { value: 'viikonloppuillat', label: 'Viikonloppuillat', time: '19-22' },
  { value: 'joustavasti', label: 'Joustavasti', time: '' },
];
const INDOOR_VENUES = [
  { name: 'Janus Areena', city: 'Lahti' }, { name: 'Kispi Areena', city: 'Lahti' },
  { name: 'Jarkko Nieminen Areena', city: 'Turku' }, { name: 'Bo Arena', city: 'Turku' },
  { name: 'Kerttulantenniskeskus', city: 'Turku' }, { name: 'Smash Center', city: 'Helsinki' },
  { name: 'Talin Tenniskeskus', city: 'Helsinki' }, { name: 'Tennis Tower Helsinki', city: 'Helsinki' },
  { name: 'Tapiolan Tennispuisto', city: 'Espoo' }, { name: 'Tampereen Tenniskeskus', city: 'Tampere' },
];

// ── Helpers ────────────────────────────────────────────
function parseSkillLevels(raw) {
  if (!raw) return ['keskitaso'];
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  const valid = parts.filter(p => PLAIN_SKILL_LEVELS.includes(p) || /^[A-E][1-3]$/.test(p));
  return valid.length > 0 ? valid : ['keskitaso'];
}
function formatSkillLevels(levels) {
  if (!levels || levels.length === 0) return '';
  const comp = levels.filter(l => /^[A-E][1-3]$/.test(l));
  if (comp.length === 0) return titleCase(levels[0]);
  if (comp.length === 1) return comp[0];
  return `${comp[comp.length - 1]}-${comp[0]}`;
}
function parsePlayStyles(raw) {
  if (!raw) return ['kaikki käy'];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}
function parseAreas(raw) {
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(s => AREA_OPTIONS.includes(s));
}
function titleCase(s) { return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s; }
function timeAgo(dateStr) {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return 'Nyt'; if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60); if (h < 24) return `${h} t`;
  const d = Math.floor(h / 24); return d === 1 ? 'Eilen' : `${d} pv`;
}
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${'SuMaTiKeToToLa'.match(/../g)[d.getDay()]} ${d.getDate()}.${d.getMonth()+1}. klo ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function slotsNeeded(mt) { return mt === 'nelinpeli' ? 3 : 1; }
function storageUrl(path) { return path ? (path.startsWith('http') ? path : `${SUPABASE_URL}/storage/v1/object/public/avatars/${path}`) : null; }
function chatImgUrl(path) { return path ? (path.startsWith('http') ? path : `${SUPABASE_URL}/storage/v1/object/public/chat-images/${path}`) : null; }
function fmtLastMsg(raw) {
  if (!raw) return { text: null }; try { const p = JSON.parse(raw);
    if (p.__type==='challenge_join') return { text: `${p.joinerName} liittyi peliin!` };
    if (p.__type==='thumbs_up') return { text: '👍' };
  } catch {} return { text: raw };
}
function slotLabel(v) { const s = AVAILABILITY_SLOTS.find(a => a.value === v); return s ? (s.time ? `${s.label} ${s.time}` : s.label) : v; }

function mapProfile(d) {
  return {
    id: d.id, nimi: d.name, ika: d.age, sukupuoli: d.gender || null,
    alue: parseAreas(d.area), bio: d.bio, avatarUrl: d.avatar_url,
    avatarColor: d.avatar_color || 'blue',
    pelitaso: parseSkillLevels(d.tennis_preferences?.skill_level),
    pelimuoto: parsePlayStyles(d.tennis_preferences?.play_style),
    saatavuus: (d.availability || []).map(a => a.slot),
    katisyys: d.tennis_preferences?.handedness || null,
    rysty: d.tennis_preferences?.backhand_type || null,
    playingThisWeek: d.playing_this_week || false, hiddenFromFeed: d.hidden_from_feed || false,
  };
}
const PROFILE_SELECT = 'id, name, age, gender, area, bio, avatar_url, avatar_color, playing_this_week, hidden_from_feed, tennis_preferences(skill_level, play_style, handedness, backhand_type), availability(slot)';

// ── Tiny components ────────────────────────────────────
function Avatar({ uri, name, color = 'blue', size = 44 }) {
  if (uri) return <img src={storageUrl(uri)} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  return <div className={`avatar avatar-${color}`} style={{ width: size, height: size, fontSize: size * 0.4 }}>{(name||'?')[0].toUpperCase()}</div>;
}
function Toast({ show, text }) { return show ? <div className="toast">{text}</div> : null; }
function Spinner() { return <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><div className="spinner" /></div>; }
function Empty({ title, action, onAction }) {
  return <div style={{ textAlign: 'center', padding: '40px 20px', color: 'rgba(255,255,255,0.5)' }}>
    <p style={{ fontSize: 15, marginBottom: 16 }}>{title}</p>
    {action && <button className="btn btn-lime btn-md" onClick={onAction}>{action}</button>}
  </div>;
}

// ── Auth Context ───────────────────────────────────────
const AuthContext = React.createContext(null);
function AuthProvider({ children }) {
  const [session, setSession] = React.useState(null);
  const [profile, setProfile] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const loadProfile = React.useCallback(async (uid) => {
    if (!uid) { setProfile(null); return; }
    try {
      const { data, error } = await supabase.from('profiles').select(PROFILE_SELECT).eq('id', uid).maybeSingle();
      if (error) throw error;
      setProfile(data ? mapProfile(data) : null);
    } catch { setProfile(null); }
  }, []);
  React.useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s?.user?.id) loadProfile(s.user.id).finally(() => setLoading(false));
      else setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((ev, s) => {
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
    needsOnboarding: Boolean(session?.user && !profile && !loading), refreshProfile,
  }), [session, profile, loading, refreshProfile]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
function useAuth() { return React.useContext(AuthContext); }

// ── Auth Screen ────────────────────────────────────────
function AuthScreen() {
  const [mode, setMode] = React.useState('login');
  const [email, setEmail] = React.useState('');
  const [pw, setPw] = React.useState('');
  const [error, setError] = React.useState('');
  const [info, setInfo] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const signInWithOAuth = async (provider) => {
    setError(''); setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin + '/app' },
      });
      if (error) throw error;
    } catch (err) { setError(err.message || 'Kirjautuminen epäonnistui'); setBusy(false); }
  };

  const submit = async (e) => {
    e.preventDefault(); setError(''); setInfo(''); setBusy(true);
    try {
      if (mode === 'login') { const { error } = await supabase.auth.signInWithPassword({ email, password: pw }); if (error) throw error; }
      else if (mode === 'register') {
        const { data, error } = await supabase.auth.signUp({ email, password: pw, options: { emailRedirectTo: window.location.origin + '/app' } });
        if (error) throw error;
        if (data.user && !data.session) setInfo('Vahvistusviesti lähetetty sähköpostiisi.');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/app' });
        if (error) throw error; setInfo('Palautuslinkki lähetetty.');
      }
    } catch (err) { setError(err.message || 'Virhe'); } finally { setBusy(false); }
  };

  const oauthBtnStyle = {
    display:'flex', alignItems:'center', justifyContent:'center', gap:10,
    width:'100%', padding:'12px 16px', borderRadius:12, border:'1px solid #e0ddd6',
    background:'#fff', cursor:'pointer', fontFamily:'inherit', fontSize:14, fontWeight:600,
    color:'var(--ink)', transition:'background .15s, border-color .15s',
  };

  return (
    <div className="auth-shell clay-bg">
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <span style={{ fontSize: 40, fontWeight: 800, color: 'var(--lime)', letterSpacing: -1.5 }}>Krossi</span>
        <p style={{ color: 'rgba(255,255,255,0.65)', marginTop: 6, fontSize: 14 }}>Löydä pelikavereita tennikseen</p>
      </div>
      <div className="auth-card">
        <h2 style={{ margin: '0 0 18px', fontSize: 20, fontWeight: 800 }}>
          {mode === 'login' ? 'Kirjaudu sisään' : mode === 'register' ? 'Luo tili' : 'Palauta salasana'}
        </h2>
        {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
        {info && <div className="alert alert-success" style={{ marginBottom: 12 }}>{info}</div>}

        {mode !== 'reset' && (
          <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:16 }}>
            <button style={oauthBtnStyle} onClick={() => signInWithOAuth('google')} disabled={busy}>
              <svg width="18" height="18" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/><path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/></svg>
              Jatka Googlella
            </button>
            <button style={oauthBtnStyle} onClick={() => signInWithOAuth('apple')} disabled={busy}>
              <svg width="16" height="20" viewBox="0 0 20 24" fill="#111"><path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.7-3-2-3.7-2-1.6-.2-3 .9-3.8.9s-2-.9-3.3-.9c-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.5 1.3-.1 1.8-.8 3.3-.8s2 .8 3.3.8c1.4 0 2.2-1.2 3.1-2.5.7-1 1-2 1-2-.1 0-2-.8-2-3.3zM13.9 3.5c.7-.9 1.2-2.1 1-3.3-1 0-2.3.7-3 1.5-.7.8-1.3 2-1.1 3.2 1.1.1 2.3-.6 3.1-1.4z"/></svg>
              Jatka Applella
            </button>
          </div>
        )}

        {mode !== 'reset' && (
          <div style={{ display:'flex', alignItems:'center', gap:12, margin:'0 0 14px' }}>
            <div style={{ flex:1, height:1, background:'#e0ddd6' }} />
            <span style={{ fontSize:12, color:'#999', fontWeight:500 }}>tai sähköpostilla</span>
            <div style={{ flex:1, height:1, background:'#e0ddd6' }} />
          </div>
        )}

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input className="input" type="email" placeholder="Sähköposti" value={email} onChange={e => setEmail(e.target.value)} required />
          {mode !== 'reset' && <input className="input" type="password" placeholder="Salasana" value={pw} onChange={e => setPw(e.target.value)} required minLength={6} />}
          <button className="btn btn-dark btn-lg btn-full" type="submit" disabled={busy}>
            {busy ? 'Odota...' : mode === 'login' ? 'Kirjaudu' : mode === 'register' ? 'Luo tili' : 'Lähetä linkki'}
          </button>
        </form>
        <div style={{ marginTop: 16, textAlign: 'center', fontSize: 13 }}>
          {mode === 'login' ? <>
            <button onClick={() => { setMode('register'); setError(''); setInfo(''); }} style={{ background:'none',border:'none',color:'var(--green-deep)',fontWeight:600,cursor:'pointer',fontFamily:'inherit' }}>Luo uusi tili</button>
            <span style={{ color: '#999', margin: '0 8px' }}>·</span>
            <button onClick={() => { setMode('reset'); setError(''); setInfo(''); }} style={{ background:'none',border:'none',color:'#888',cursor:'pointer',fontFamily:'inherit' }}>Unohditko salasanan?</button>
          </> : <button onClick={() => { setMode('login'); setError(''); setInfo(''); }} style={{ background:'none',border:'none',color:'var(--green-deep)',fontWeight:600,cursor:'pointer',fontFamily:'inherit' }}>Takaisin kirjautumiseen</button>}
        </div>
      </div>
      <a href="/" style={{ color:'rgba(255,255,255,0.5)',marginTop:20,fontSize:13,textDecoration:'none' }}>← Takaisin etusivulle</a>
    </div>
  );
}

// ── Onboarding ─────────────────────────────────────────
function OnboardingScreen() {
  const { session, refreshProfile } = useAuth();
  const [step, setStep] = React.useState(1);
  const [form, setForm] = React.useState({ nimi:'',ika:'',sukupuoli:'',alue:[],pelitaso:[],pelimuoto:[],saatavuus:[],bio:'' });
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const set = (k,v) => setForm(p => ({...p,[k]:v}));
  const tog = (k,v) => setForm(p => ({...p,[k]:p[k].includes(v)?p[k].filter(x=>x!==v):[...p[k],v]}));
  const save = async () => {
    setError(''); setBusy(true);
    try {
      const uid = session.user.id;
      await supabase.from('profiles').upsert({ id:uid, name:form.nimi.trim(), age:Number(form.ika), gender:form.sukupuoli||null, area:form.alue.join(', '), bio:form.bio.trim()||null });
      await supabase.from('tennis_preferences').upsert({ user_id:uid, skill_level:form.pelitaso.join(','), play_style:form.pelimuoto.join(', ') });
      await supabase.from('availability').delete().eq('user_id',uid);
      if (form.saatavuus.length>0) await supabase.from('availability').insert(form.saatavuus.map(s=>({user_id:uid,slot:s})));
      await refreshProfile();
    } catch (err) { setError(err.message||'Tallennus epäonnistui'); } finally { setBusy(false); }
  };
  return (
    <div className="onboard-shell clay-bg">
      <div className="onboard-card">
        <h2 style={{ margin:'0 0 4px', fontSize:20, fontWeight:800 }}>Luo profiilisi</h2>
        <p style={{ color:'var(--text-muted)', fontSize:13, marginBottom:16 }}>Vaihe {step}/3</p>
        {error && <div className="alert alert-error" style={{ marginBottom:12 }}>{error}</div>}
        {step===1 && <div style={{ display:'flex',flexDirection:'column',gap:12 }}>
          <div className="field"><div className="field-label">Nimi</div><input className="input" placeholder="Etunimi" value={form.nimi} onChange={e=>set('nimi',e.target.value)}/></div>
          <div className="field"><div className="field-label">Ikä</div><input className="input" type="number" placeholder="25" min="16" max="100" value={form.ika} onChange={e=>set('ika',e.target.value)}/></div>
          <div className="field"><div className="field-label">Sukupuoli</div><div style={{ display:'flex',gap:7 }}>{['mies','nainen'].map(g=><button key={g} className={`select-chip ${form.sukupuoli===g?'selected':''}`} onClick={()=>set('sukupuoli',form.sukupuoli===g?'':g)}>{titleCase(g)}</button>)}</div></div>
          <div className="field"><div className="field-label">Kaupunki</div><div className="select-chips">{VISIBLE_AREAS.map(a=><button key={a} className={`select-chip ${form.alue.includes(a)?'selected':''}`} onClick={()=>tog('alue',a)}>{a}</button>)}</div></div>
          <button className="btn btn-dark btn-lg btn-full" disabled={!form.nimi||!form.ika||form.alue.length===0} onClick={()=>setStep(2)}>Seuraava</button>
        </div>}
        {step===2 && <div style={{ display:'flex',flexDirection:'column',gap:12 }}>
          <div className="field"><div className="field-label">Pelitaso</div><div className="select-chips">{PLAIN_SKILL_LEVELS.map(l=><button key={l} className={`select-chip ${form.pelitaso.includes(l)?'selected':''}`} onClick={()=>tog('pelitaso',l)}>{titleCase(l)}</button>)}</div></div>
          <div className="field"><div className="field-label">Pelimuoto</div><div className="select-chips">{PLAY_STYLES.map(s=><button key={s} className={`select-chip ${form.pelimuoto.includes(s)?'selected':''}`} onClick={()=>tog('pelimuoto',s)}>{titleCase(s)}</button>)}</div></div>
          <div style={{ display:'flex',gap:8 }}><button className="btn btn-outline-d btn-md" onClick={()=>setStep(1)}>Takaisin</button><button className="btn btn-dark btn-lg" style={{flex:1}} disabled={form.pelitaso.length===0} onClick={()=>setStep(3)}>Seuraava</button></div>
        </div>}
        {step===3 && <div style={{ display:'flex',flexDirection:'column',gap:12 }}>
          <div className="field"><div className="field-label">Saatavuus</div><div className="select-chips">{AVAILABILITY_SLOTS.map(s=><button key={s.value} className={`select-chip ${form.saatavuus.includes(s.value)?'selected':''}`} onClick={()=>tog('saatavuus',s.value)}>{s.label}{s.time?` ${s.time}`:''}</button>)}</div></div>
          <div className="field"><div className="field-label">Bio</div><textarea className="input" placeholder="Kerro itsestäsi..." value={form.bio} onChange={e=>set('bio',e.target.value)} rows={3}/></div>
          <div style={{ display:'flex',gap:8 }}><button className="btn btn-outline-d btn-md" onClick={()=>setStep(2)}>Takaisin</button><button className="btn btn-lime btn-lg" style={{flex:1}} onClick={save} disabled={busy}>{busy?'Tallennetaan...':'Aloita Krossin käyttö'}</button></div>
        </div>}
      </div>
    </div>
  );
}

// ── Sidebar Profile ────────────────────────────────────
function SidebarProfile({ onEdit }) {
  const { session, profile, refreshProfile } = useAuth();
  if (!profile) return null;
  const toggleLive = async () => {
    await supabase.from('profiles').update({ playing_this_week: !profile.playingThisWeek }).eq('id', session.user.id);
    refreshProfile();
  };
  return (
    <div className="sidebar-profile">
      <Avatar uri={profile.avatarUrl} name={profile.nimi} color={profile.avatarColor} size={64} />
      <div className="sidebar-name">{profile.nimi}, {profile.ika}</div>
      {profile.bio && <div className="sidebar-bio">{profile.bio}</div>}
      <div className="sidebar-areas">
        {profile.alue.map(a => <span key={a} className="sidebar-area">{a}</span>)}
      </div>
      <button className={`sidebar-live ${profile.playingThisWeek ? 'on' : 'off'}`} onClick={toggleLive}>
        <span className="sidebar-dot" style={{ background: profile.playingThisWeek ? '#7ee06a' : 'rgba(255,255,255,0.3)' }} />
        Pelaan tällä viikolla
        <span style={{ marginLeft:'auto', fontSize:12 }}>{profile.playingThisWeek ? 'Päällä' : 'Pois'}</span>
      </button>
      <div className="sidebar-stats">
        <div className="sidebar-stat"><div className="sidebar-stat-label">Pelitaso</div><div className="sidebar-stat-value">{formatSkillLevels(profile.pelitaso)}</div></div>
        <div className="sidebar-stat"><div className="sidebar-stat-label">Pelimuoto</div><div className="sidebar-stat-value">{profile.pelimuoto.map(titleCase).join(', ')}</div></div>
      </div>
      {profile.saatavuus.length > 0 && <>
        <div className="sidebar-divider" />
        <div className="sidebar-avail">
          <div className="sidebar-avail-title">Ajankohdat</div>
          {profile.saatavuus.map(s => <div key={s} className="sidebar-avail-item">{slotLabel(s)}</div>)}
        </div>
      </>}
      <div className="sidebar-divider" />
      <button className="sidebar-edit" onClick={onEdit}>Muokkaa profiilia</button>
    </div>
  );
}

// ── Player Card ────────────────────────────────────────
function PlayerCard({ player, onClick }) {
  return (
    <button onClick={onClick} className="card" style={{ display:'block',width:'100%',textAlign:'left',cursor:'pointer',marginBottom:10 }}>
      <div style={{ display:'flex',alignItems:'center',gap:12 }}>
        <Avatar uri={player.avatarUrl} name={player.nimi} color={player.avatarColor} size={42} />
        <div style={{ flex:1,minWidth:0 }}>
          <div style={{ display:'flex',alignItems:'center',gap:8,flexWrap:'wrap' }}>
            <span style={{ color:'#fff',fontWeight:700,fontSize:15 }}>{player.nimi}, {player.ika}</span>
            {player.playingThisWeek && <span className="chip chip-active" style={{padding:'2px 7px',fontSize:11}}><span style={{width:5,height:5,borderRadius:'50%',background:'#7ee06a'}}/>Tällä viikolla</span>}
          </div>
          <div style={{ display:'flex',flexWrap:'wrap',gap:4,marginTop:3 }}>
            <span className="chip chip-outline" style={{padding:'2px 7px',fontSize:11}}>{formatSkillLevels(player.pelitaso)}</span>
            {player.pelimuoto.map(m => <span key={m} className="chip chip-outline" style={{padding:'2px 7px',fontSize:11}}>{titleCase(m)}</span>)}
          </div>
        </div>
      </div>
    </button>
  );
}

// ── Player Detail ──────────────────────────────────────
function PlayerDetail({ player, onBack, currentUserId }) {
  const [reqText, setReqText] = React.useState('');
  const [showReq, setShowReq] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [toast, setToast] = React.useState('');
  const send = async () => {
    setSending(true);
    try {
      const { error } = await supabase.from('connection_requests').insert({ sender_id:currentUserId, receiver_id:player.id, message:reqText });
      if (error) throw error;
      setShowReq(false); setToast('Pelipyyntö lähetetty!'); setTimeout(()=>setToast(''),2500);
    } catch (err) { alert(err.message); } finally { setSending(false); }
  };
  return (
    <div className="clay-bg" style={{ minHeight:'100%',padding:'20px 24px 100px' }}>
      <button className="back-btn" onClick={onBack}>← Takaisin</button>
      <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:8,margin:'24px auto',maxWidth:500 }}>
        <Avatar uri={player.avatarUrl} name={player.nimi} color={player.avatarColor} size={84} />
        <h2 style={{ color:'#fff',fontWeight:800,fontSize:22,margin:0 }}>{player.nimi}, {player.ika}</h2>
        <p style={{ color:'rgba(255,255,255,0.55)',fontSize:14 }}>{player.alue.join(', ')}</p>
        {player.playingThisWeek && <span className="chip chip-active">Tällä viikolla</span>}
      </div>
      <div style={{ maxWidth:500,margin:'0 auto' }}>
        <div className="detail-field"><div className="detail-label">Pelitaso</div><div className="detail-value">{formatSkillLevels(player.pelitaso)}</div></div>
        <div className="detail-field"><div className="detail-label">Pelimuoto</div><div className="detail-value">{player.pelimuoto.map(titleCase).join(', ')}</div></div>
        {player.saatavuus?.length>0 && <div className="detail-field"><div className="detail-label">Saatavuus</div><div className="detail-value">{player.saatavuus.map(s=><div key={s}>{slotLabel(s)}</div>)}</div></div>}
        {player.katisyys && <div className="detail-field"><div className="detail-label">Kätisyys</div><div className="detail-value">{titleCase(player.katisyys)}</div></div>}
        {player.bio && <div className="detail-field"><div className="detail-label">Bio</div><div className="detail-value">{player.bio}</div></div>}
        {currentUserId && currentUserId !== player.id && <button className="btn btn-lime btn-lg btn-full" style={{marginTop:20}} onClick={()=>{setReqText('Lähtisitkö pelaamaan?');setShowReq(true);}}>Pyydä pelaamaan</button>}
      </div>
      {showReq && <div className="modal-overlay" onClick={()=>setShowReq(false)}><div className="modal-sheet" onClick={e=>e.stopPropagation()}>
        <h3 style={{margin:'0 0 12px',fontSize:17,fontWeight:800}}>Pyyntö: {player.nimi}</h3>
        <textarea className="input" rows={3} value={reqText} onChange={e=>setReqText(e.target.value)}/>
        <div style={{display:'flex',gap:8,marginTop:12}}><button className="btn btn-outline-d btn-md" onClick={()=>setShowReq(false)}>Peruuta</button><button className="btn btn-dark btn-lg" style={{flex:1}} onClick={send} disabled={sending||!reqText.trim()}>{sending?'Lähetetään...':'Lähetä'}</button></div>
      </div></div>}
      <Toast show={!!toast} text={toast}/>
    </div>
  );
}

// ── Players Screen ─────────────────────────────────────
function PlayersScreen({ onOpenPlayer }) {
  const { session, profile } = useAuth();
  const [players, setPlayers] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState({ skill:'', style:'' });
  const load = React.useCallback(async () => {
    try {
      const { data } = await supabase.from('profiles').select(PROFILE_SELECT).eq('hidden_from_feed',false).order('playing_this_week',{ascending:false}).order('updated_at',{ascending:false});
      setPlayers((data||[]).map(mapProfile).filter(p=>p.id!==session?.user?.id));
    } catch {} finally { setLoading(false); }
  }, [session]);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    const ch = supabase.channel('players-web').on('postgres_changes',{event:'*',schema:'public',table:'profiles'},()=>load()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);
  const filtered = React.useMemo(() => {
    const home = profile?.alue?.[0];
    return players.filter(p => {
      if (home && !p.alue.includes(home)) return false;
      if (filter.skill && !p.pelitaso.includes(filter.skill)) return false;
      return true;
    });
  }, [players,filter,profile]);
  return (
    <div className="page">
      <div className="page-header"><h2 className="page-title">Pelaajat</h2></div>
      <div className="filter-bar">
        <button className={`filter-chip ${!filter.skill?'active':''}`} onClick={()=>setFilter({skill:''})}>Kaikki</button>
        {PLAIN_SKILL_LEVELS.map(l=><button key={l} className={`filter-chip ${filter.skill===l?'active':''}`} onClick={()=>setFilter(f=>({...f,skill:f.skill===l?'':l}))}>{titleCase(l)}</button>)}
      </div>
      {loading ? <Spinner/> : filtered.length===0 ? <Empty title="Ei pelaajia vielä tässä kaupungissa."/> :
        filtered.map(p=><PlayerCard key={p.id} player={p} onClick={()=>onOpenPlayer(p)}/>)}
    </div>
  );
}

// ── Challenge Card ─────────────────────────────────────
function ChallengeCard({ challenge, onClick }) {
  return (
    <button onClick={onClick} className="card" style={{ display:'block',width:'100%',textAlign:'left',cursor:'pointer',marginBottom:10 }}>
      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8 }}>
        <span style={{ color:'#fff',fontWeight:700,fontSize:13 }}>{challenge.scheduledAt?formatDate(challenge.scheduledAt):'Aika avoin'}</span>
        <span className="chip chip-outline">{titleCase(challenge.matchType)}</span>
      </div>
      <div style={{ display:'flex',alignItems:'center',gap:10 }}>
        <Avatar uri={challenge.creatorAvatarUrl} name={challenge.creatorName} color={challenge.creatorAvatarColor} size={40}/>
        <div style={{ flex:1,minWidth:0 }}>
          <div style={{ color:'#fff',fontWeight:700,fontSize:15 }}>{challenge.creatorName}</div>
          <div style={{ color:'rgba(255,255,255,0.55)',fontSize:12 }}>{challenge.location} · {titleCase(challenge.locationType)}</div>
        </div>
        <div style={{ display:'flex',gap:3 }}>
          {Array.from({length:Math.max(0,slotsNeeded(challenge.matchType)-challenge.participants.length)}).map((_,i)=>
            <span key={i} style={{width:20,height:20,borderRadius:'50%',border:'1.5px dashed rgba(255,255,255,0.4)'}}/>
          )}
        </div>
      </div>
      {challenge.title && <p style={{ color:'rgba(255,255,255,0.65)',fontSize:12,marginTop:6 }}>{challenge.title}</p>}
    </button>
  );
}

// ── Challenge Detail ───────────────────────────────────
function ChallengeDetail({ challenge, onBack, currentUserId }) {
  const [joining, setJoining] = React.useState(false);
  const [toast, setToast] = React.useState('');
  const join = async () => {
    setJoining(true);
    try { const {error}=await supabase.rpc('join_challenge',{challenge_id_input:challenge.id}); if(error) throw error;
      setToast('Liityit haasteeseen!'); setTimeout(()=>setToast(''),2500);
    } catch(err) { alert(err.message); } finally { setJoining(false); }
  };
  const isMine = challenge.creatorId===currentUserId;
  const joined = challenge.participants.some(p=>p.userId===currentUserId);
  const full = challenge.participants.length>=slotsNeeded(challenge.matchType);
  return (
    <div className="clay-bg" style={{ minHeight:'100%',padding:'20px 24px 100px' }}>
      <button className="back-btn" onClick={onBack}>← Takaisin</button>
      <div style={{ maxWidth:500,margin:'24px auto 0' }}>
        <div style={{ display:'flex',alignItems:'center',gap:12,marginBottom:18 }}>
          <Avatar uri={challenge.creatorAvatarUrl} name={challenge.creatorName} color={challenge.creatorAvatarColor} size={48}/>
          <div><h2 style={{color:'#fff',fontWeight:800,fontSize:20,margin:0}}>{challenge.creatorName}</h2><p style={{color:'rgba(255,255,255,0.5)',fontSize:13,margin:0}}>{challenge.creatorArea?.join(', ')}</p></div>
        </div>
        {challenge.title && <p style={{color:'#fff',fontSize:15,fontWeight:600,marginBottom:14}}>{challenge.title}</p>}
        {challenge.description && <p style={{color:'rgba(255,255,255,0.75)',fontSize:13,marginBottom:18,lineHeight:1.5}}>{challenge.description}</p>}
        <div className="detail-field"><div className="detail-label">Aika</div><div className="detail-value">{challenge.scheduledAt?formatDate(challenge.scheduledAt):'Aika avoin'}</div></div>
        <div className="detail-field"><div className="detail-label">Paikka</div><div className="detail-value">{challenge.location}</div></div>
        <div className="detail-field"><div className="detail-label">Tyyppi</div><div className="detail-value">{titleCase(challenge.matchType)} · {titleCase(challenge.locationType)}</div></div>
        {challenge.participants.length>0 && <div className="detail-field"><div className="detail-label">Osallistujat</div><div style={{display:'flex',gap:6,marginTop:4}}>{challenge.participants.map(p=><div key={p.userId} style={{display:'flex',alignItems:'center',gap:5}}><Avatar uri={p.avatarUrl} name={p.name} color={p.avatarColor} size={26}/><span style={{color:'rgba(255,255,255,0.75)',fontSize:12}}>{p.name}</span></div>)}</div></div>}
        {currentUserId && !isMine && !joined && !full && <button className="btn btn-lime btn-lg btn-full" style={{marginTop:20}} onClick={join} disabled={joining}>{joining?'Liitytään...':'Liity haasteeseen'}</button>}
      </div>
      <Toast show={!!toast} text={toast}/>
    </div>
  );
}

// ── Challenges Screen ──────────────────────────────────
function ChallengesScreen({ onOpenChallenge, onCreateChallenge }) {
  const [list, setList] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    (async () => {
      try {
        const cols = 'id, creator_id, location, location_type, court_surface, city, scheduled_at, expires_at, match_type, status, challenge_type, title, description, min_skill_level, time_slots';
        const { data: rows } = await supabase.from('challenges').select(cols).in('status',['open','filled']).eq('challenge_type','open').or('expires_at.is.null,expires_at.gt.now()').order('scheduled_at',{ascending:true});
        if (!rows?.length) { setList([]); setLoading(false); return; }
        const ids = rows.map(r=>r.id); const cids = [...new Set(rows.map(r=>r.creator_id))];
        const [{data:pR},{data:cR}] = await Promise.all([
          supabase.from('challenge_participants').select('challenge_id,user_id,profile:profiles!challenge_participants_user_id_fkey(name,avatar_url,avatar_color,age)').in('challenge_id',ids),
          supabase.from('profiles').select('id,name,avatar_url,avatar_color,age,gender,area,tennis_preferences(skill_level,play_style)').in('id',cids),
        ]);
        const cm=new Map(); (cR||[]).forEach(c=>cm.set(c.id,c));
        const pm=new Map(); (pR||[]).forEach(p=>{const a=pm.get(p.challenge_id)||[];if(p.profile)a.push({userId:p.user_id,name:p.profile.name,avatarUrl:p.profile.avatar_url,avatarColor:p.profile.avatar_color||'blue',age:p.profile.age});pm.set(p.challenge_id,a);});
        setList(rows.map(r=>{const cr=cm.get(r.creator_id);const pf=Array.isArray(cr?.tennis_preferences)?cr.tennis_preferences[0]:cr?.tennis_preferences;
          return {id:r.id,creatorId:r.creator_id,creatorName:cr?.name||'Pelaaja',creatorAvatarUrl:cr?.avatar_url,creatorAvatarColor:cr?.avatar_color||'blue',creatorArea:parseAreas(cr?.area||''),creatorSkillLevel:parseSkillLevels(pf?.skill_level),location:r.location,locationType:r.location_type,scheduledAt:r.scheduled_at,matchType:r.match_type,status:r.status,challengeType:r.challenge_type||'open',participants:pm.get(r.id)||[],title:r.title,description:r.description};}));
      } catch {} finally { setLoading(false); }
    })();
  }, []);
  return <div className="page">
    <div className="page-header"><h2 className="page-title">Avoimet haasteet</h2><button className="btn btn-lime btn-sm" onClick={onCreateChallenge}>+ Luo haaste</button></div>
    {loading?<Spinner/>:list.length===0?<Empty title="Ei avoimia haasteita." action="Luo ensimmäinen" onAction={onCreateChallenge}/>:list.map(c=><ChallengeCard key={c.id} challenge={c} onClick={()=>onOpenChallenge(c)}/>)}
  </div>;
}

// ── Create Challenge ───────────────────────────────────
function CreateChallengeScreen({ onBack, onCreated }) {
  const { session, profile } = useAuth();
  const [form, setForm] = React.useState({matchType:'kaksinpeli',locationType:'sisätennis',location:'',scheduledAt:'',title:'',description:''});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const set = (k,v)=>setForm(p=>({...p,[k]:v}));
  const homeCity = profile?.alue?.[0]||'Lahti';
  const venues = INDOOR_VENUES.filter(v=>v.city===homeCity);
  const create = async () => {
    setError(''); setBusy(true);
    try {
      const {error}=await supabase.from('challenges').insert({creator_id:session.user.id,location:form.location||'Avoin',location_type:form.locationType,city:homeCity,scheduled_at:form.scheduledAt?new Date(form.scheduledAt).toISOString():null,match_type:form.matchType,challenge_type:'open',title:form.title.trim()||null,description:form.description.trim()||null});
      if(error) throw error; onCreated();
    } catch(err) { setError(err.message||'Virhe'); } finally { setBusy(false); }
  };
  return <div className="clay-bg" style={{minHeight:'100%',padding:'20px 24px'}}>
    <button className="back-btn" onClick={onBack}>← Takaisin</button>
    <div style={{maxWidth:480,margin:'24px auto 0'}}>
      <h2 style={{color:'#fff',fontWeight:800,fontSize:22,marginBottom:18}}>Luo haaste</h2>
      {error && <div className="alert alert-error" style={{marginBottom:12}}>{error}</div>}
      <div className="field"><div className="detail-label">Pelityyppi</div><div style={{display:'flex',gap:6}}>{MATCH_TYPES.map(t=><button key={t} className={`filter-chip ${form.matchType===t?'active':''}`} onClick={()=>set('matchType',t)}>{titleCase(t)}</button>)}</div></div>
      <div className="field"><div className="detail-label">Paikka</div><div style={{display:'flex',gap:6}}>{LOCATION_TYPES.map(t=><button key={t} className={`filter-chip ${form.locationType===t?'active':''}`} onClick={()=>set('locationType',t)}>{titleCase(t)}</button>)}</div></div>
      {form.locationType==='sisätennis'&&venues.length>0 ? <div className="field"><div className="detail-label">Halli</div><select className="input input-dark" value={form.location} onChange={e=>set('location',e.target.value)}><option value="">Valitse</option>{venues.map(v=><option key={v.name} value={v.name}>{v.name}</option>)}</select></div>
      : <div className="field"><div className="detail-label">Paikka</div><input className="input input-dark" placeholder="Esim. Mukkulan kentät" value={form.location} onChange={e=>set('location',e.target.value)}/></div>}
      <div className="field"><div className="detail-label">Ajankohta</div><input className="input input-dark" type="datetime-local" value={form.scheduledAt} onChange={e=>set('scheduledAt',e.target.value)}/></div>
      <div className="field"><div className="detail-label">Otsikko</div><input className="input input-dark" placeholder="Vapaaehtoinen" value={form.title} onChange={e=>set('title',e.target.value)}/></div>
      <div className="field"><div className="detail-label">Kuvaus</div><textarea className="input input-dark" rows={3} placeholder="Vapaaehtoinen" value={form.description} onChange={e=>set('description',e.target.value)}/></div>
      <button className="btn btn-lime btn-lg btn-full" onClick={create} disabled={busy}>{busy?'Luodaan...':'Julkaise haaste'}</button>
    </div>
  </div>;
}

// ── Messages Screen ────────────────────────────────────
function MessagesScreen({ onOpenChat }) {
  const { session } = useAuth();
  const [convos, setConvos] = React.useState([]);
  const [reqs, setReqs] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const load = React.useCallback(async () => {
    if (!session?.user?.id) return;
    const uid = session.user.id;
    try {
      const { data: cpD } = await supabase.from('conversation_participants').select('conversation_id,last_read_at,conversation:conversations(id,updated_at,last_message,challenge_id)').eq('user_id',uid);
      const rows = cpD || []; const cids = rows.map(r=>r.conversation_id);
      if (cids.length > 0) {
        const [{data:ap},{data:lm}] = await Promise.all([
          supabase.from('conversation_participants').select('conversation_id,user_id,profile:profiles!conversation_participants_user_id_fkey(id,name,avatar_url,avatar_color)').in('conversation_id',cids),
          supabase.from('messages').select('conversation_id,sender_id,created_at').in('conversation_id',cids).order('created_at',{ascending:false}),
        ]);
        const pm=new Map(); (ap||[]).forEach(i=>{const a=pm.get(i.conversation_id)||[];if(i.profile)a.push({userId:i.profile.id,name:i.profile.name,avatarUrl:i.profile.avatar_url,avatarColor:i.profile.avatar_color||'blue'});pm.set(i.conversation_id,a);});
        const lmm=new Map(); (lm||[]).forEach(i=>{if(!lmm.has(i.conversation_id))lmm.set(i.conversation_id,{senderId:i.sender_id,createdAt:i.created_at});});
        setConvos(rows.map(r=>{
          const others=(pm.get(r.conversation_id)||[]).filter(p=>p.userId!==uid);const o=others[0];
          if(!r.conversation||!o)return null;
          const lt=lmm.get(r.conversation_id);const lr=r.last_read_at;
          const unread=lt?.senderId&&lt.senderId!==uid&&(!lr||new Date(lt.createdAt)>new Date(lr));
          return {id:r.conversation_id,otherUserId:o.userId,otherUserName:o.name,otherUserAvatarUrl:o.avatarUrl,otherUserAvatarColor:o.avatarColor,displayName:others.length>1?'Ryhmäkeskustelu':o.name,isGroup:others.length>1,participantProfiles:others,lastMessage:fmtLastMsg(r.conversation.last_message).text,updatedAt:r.conversation.updated_at,hasUnread:unread};
        }).filter(Boolean).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)));
      }
      const { data: rD } = await supabase.from('connection_requests').select('id,sender_id,message,created_at,sender:profiles!connection_requests_sender_id_fkey(name,avatar_url,avatar_color)').eq('receiver_id',uid).eq('status','pending').order('created_at',{ascending:false});
      setReqs((rD||[]).map(r=>({id:r.id,senderId:r.sender_id,message:r.message,senderName:r.sender?.name||'Pelaaja',senderAvatarUrl:r.sender?.avatar_url,senderAvatarColor:r.sender?.avatar_color||'blue'})));
    } catch {} finally { setLoading(false); }
  }, [session]);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    if(!session?.user?.id)return;
    const ch=supabase.channel('msg-web').on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},()=>load()).on('postgres_changes',{event:'*',schema:'public',table:'conversations'},()=>load()).subscribe();
    return ()=>{supabase.removeChannel(ch);};
  }, [load,session]);
  const accept = async id => { try{await supabase.rpc('accept_connection_request',{request_id_input:id});load();}catch(e){alert(e.message);} };
  const ignore = async id => { try{await supabase.rpc('ignore_connection_request',{request_id_input:id});load();}catch(e){alert(e.message);} };
  if (loading) return <div className="page"><Spinner/></div>;
  return <div className="page">
    <div className="page-header"><h2 className="page-title">Viestit</h2></div>
    {reqs.length>0 && <>
      <h3 style={{color:'var(--lime)',fontSize:14,fontWeight:800,marginBottom:8}}>Uudet pelipyynnöt</h3>
      {reqs.map(r=><div key={r.id} className="card" style={{marginBottom:10}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:6}}><Avatar uri={r.senderAvatarUrl} name={r.senderName} color={r.senderAvatarColor} size={32}/><span style={{color:'#fff',fontWeight:700,fontSize:14}}>{r.senderName}</span></div>
        <p style={{color:'rgba(255,255,255,0.78)',fontSize:13,marginBottom:10,lineHeight:1.4}}>{r.message}</p>
        <div style={{display:'flex',gap:6}}><button className="btn btn-lime btn-sm" style={{flex:1}} onClick={()=>accept(r.id)}>Hyväksy</button><button className="btn btn-outline-w btn-sm" style={{flex:1}} onClick={()=>ignore(r.id)}>Ohita</button></div>
      </div>)}
    </>}
    {convos.length>0 && <>
      <h3 style={{color:'var(--lime)',fontSize:14,fontWeight:800,margin:'14px 0 6px'}}>Keskustelut</h3>
      {convos.map(c=><div key={c.id} className="msg-row" onClick={()=>onOpenChat(c)}>
        <Avatar uri={c.otherUserAvatarUrl} name={c.otherUserName} color={c.otherUserAvatarColor} size={42}/>
        <div style={{flex:1,minWidth:0}}><div style={{color:'#fff',fontWeight:700,fontSize:14}}>{c.displayName}</div><div style={{color:'rgba(255,255,255,0.5)',fontSize:12,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.lastMessage||'Aloita keskustelu'}</div></div>
        <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:3}}><span style={{color:'rgba(255,255,255,0.4)',fontSize:11}}>{timeAgo(c.updatedAt)}</span>{c.hasUnread&&<span style={{width:8,height:8,borderRadius:'50%',background:'var(--lime)'}}/>}</div>
      </div>)}
    </>}
    {convos.length===0&&reqs.length===0&&<Empty title="Ei vielä viestejä."/>}
  </div>;
}

// ── Chat Screen ────────────────────────────────────────
function ChatScreen({ conversation, onBack }) {
  const { session } = useAuth();
  const [msgs, setMsgs] = React.useState([]);
  const [text, setText] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [sending, setSending] = React.useState(false);
  const btm = React.useRef(null);
  const uid = session?.user?.id;
  const load = React.useCallback(async () => {
    try {
      const { data } = await supabase.from('messages').select('id,sender_id,content,image_url,created_at,profile:profiles!messages_sender_id_fkey(name,avatar_url,avatar_color)').eq('conversation_id',conversation.id).order('created_at',{ascending:true});
      setMsgs((data||[]).map(m=>({id:m.id,senderId:m.sender_id,content:m.content,imageUrl:m.image_url,createdAt:m.created_at,senderName:m.profile?.name||'Pelaaja',senderAvatarUrl:m.profile?.avatar_url,senderAvatarColor:m.profile?.avatar_color||'blue'})));
    } catch {} finally { setLoading(false); }
  }, [conversation.id]);
  React.useEffect(()=>{load();},[load]);
  React.useEffect(()=>{
    const ch=supabase.channel(`chat-${conversation.id}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`conversation_id=eq.${conversation.id}`},()=>load()).subscribe();
    return ()=>{supabase.removeChannel(ch);};
  },[conversation.id,load]);
  React.useEffect(()=>{btm.current?.scrollIntoView({behavior:'smooth'});},[msgs]);
  React.useEffect(()=>{if(uid)supabase.rpc('mark_conversation_read',{p_conversation_id:conversation.id,p_user_id:uid}).catch(()=>{});},[conversation.id,uid,msgs.length]);
  const send = async () => {
    if(!text.trim()||sending)return; setSending(true);
    try{await supabase.from('messages').insert({conversation_id:conversation.id,content:text.trim()});setText('');}catch(e){alert(e.message);}finally{setSending(false);}
  };
  const thumbs = async () => {
    setSending(true);try{await supabase.from('messages').insert({conversation_id:conversation.id,content:JSON.stringify({__type:'thumbs_up'})});}catch(e){alert(e.message);}finally{setSending(false);}
  };
  return <div className="clay-bg" style={{display:'flex',flexDirection:'column',height:'100%'}}>
    <div style={{display:'flex',alignItems:'center',gap:10,padding:'12px 16px',borderBottom:'1px solid rgba(255,255,255,0.08)',flexShrink:0}}>
      <button onClick={onBack} style={{background:'none',border:'none',color:'#fff',cursor:'pointer',fontSize:18,padding:0}}>←</button>
      <Avatar uri={conversation.otherUserAvatarUrl} name={conversation.otherUserName} color={conversation.otherUserAvatarColor} size={36}/>
      <span style={{color:'#fff',fontWeight:700,fontSize:15}}>{conversation.displayName}</span>
    </div>
    <div style={{flex:1,overflowY:'auto',padding:16,display:'flex',flexDirection:'column',gap:6}}>
      {loading?<Spinner/>:msgs.map(m=>{
        const mine=m.senderId===uid;
        let dc=m.content;try{const p=JSON.parse(m.content);if(p.__type==='thumbs_up')dc='👍';if(p.__type==='challenge_join')dc=`${p.joinerName} liittyi peliin!`;}catch{}
        return <div key={m.id} style={{alignSelf:mine?'flex-end':'flex-start'}}>
          {!mine&&conversation.isGroup&&<span style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginLeft:4}}>{m.senderName}</span>}
          {m.imageUrl&&<img src={chatImgUrl(m.imageUrl)} alt="" style={{maxWidth:200,borderRadius:10}}/>}
          {dc&&<div className={`chat-bubble ${mine?'chat-mine':'chat-theirs'}`}>{dc}</div>}
        </div>;
      })}
      <div ref={btm}/>
    </div>
    <div style={{display:'flex',gap:8,padding:'10px 16px',borderTop:'1px solid rgba(255,255,255,0.08)',flexShrink:0,alignItems:'center'}}>
      <input className="input input-dark" style={{flex:1,borderRadius:999,padding:'10px 16px'}} placeholder="Kirjoita viesti..." value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}}/>
      {text.trim()?<button className="btn btn-lime" onClick={send} disabled={sending} style={{width:38,height:38,borderRadius:'50%',padding:0}}><svg width="18" height="18" viewBox="0 0 22 22"><path d="M20 2L2 9.5l7 2.5 2.5 7L20 2z" fill="none" stroke="#101a08" strokeWidth="1.8" strokeLinejoin="round"/></svg></button>
      :<button className="btn" onClick={thumbs} disabled={sending} style={{width:38,height:38,borderRadius:'50%',padding:0,fontSize:20,background:'rgba(255,255,255,0.08)',border:'1px solid rgba(255,255,255,0.15)'}}>👍</button>}
    </div>
  </div>;
}

// ── Profile (full page, for editing) ───────────────────
function ProfileFullScreen() {
  const { session, profile, refreshProfile } = useAuth();
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState('');
  React.useEffect(() => { if(profile&&!form) setForm({nimi:profile.nimi,ika:String(profile.ika),sukupuoli:profile.sukupuoli||'',alue:profile.alue,pelitaso:profile.pelitaso,pelimuoto:profile.pelimuoto,saatavuus:profile.saatavuus,bio:profile.bio||''}); }, [profile,form]);
  const save = async () => {
    setBusy(true);
    try {
      const uid=session.user.id;
      await supabase.from('profiles').upsert({id:uid,name:form.nimi.trim(),age:Number(form.ika),gender:form.sukupuoli||null,area:form.alue.join(', '),bio:form.bio.trim()||null});
      await supabase.from('tennis_preferences').upsert({user_id:uid,skill_level:form.pelitaso.join(','),play_style:form.pelimuoto.join(', ')});
      await supabase.from('availability').delete().eq('user_id',uid);
      if(form.saatavuus.length>0) await supabase.from('availability').insert(form.saatavuus.map(s=>({user_id:uid,slot:s})));
      await refreshProfile(); setEditing(false); setForm(null);
      setToast('Profiili päivitetty!'); setTimeout(()=>setToast(''),2500);
    } catch(e){alert(e.message);}finally{setBusy(false);}
  };
  const signOut = ()=>supabase.auth.signOut();
  if(!profile) return <div className="page"><Spinner/></div>;
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const tog=(k,v)=>setForm(p=>({...p,[k]:p[k].includes(v)?p[k].filter(x=>x!==v):[...p[k],v]}));
  if(editing&&form) return <div className="page" style={{paddingBottom:40}}>
    <div className="page-header"><h2 className="page-title">Muokkaa profiilia</h2><button className="btn btn-outline-w btn-sm" onClick={()=>{setEditing(false);setForm(null);}}>Peruuta</button></div>
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div className="field"><div className="detail-label">Nimi</div><input className="input input-dark" value={form.nimi} onChange={e=>set('nimi',e.target.value)}/></div>
      <div className="field"><div className="detail-label">Ikä</div><input className="input input-dark" type="number" value={form.ika} onChange={e=>set('ika',e.target.value)}/></div>
      <div className="field"><div className="detail-label">Kaupunki</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{VISIBLE_AREAS.map(a=><button key={a} className={`filter-chip ${form.alue.includes(a)?'active':''}`} onClick={()=>tog('alue',a)}>{a}</button>)}</div></div>
      <div className="field"><div className="detail-label">Pelitaso</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{PLAIN_SKILL_LEVELS.map(l=><button key={l} className={`filter-chip ${form.pelitaso.includes(l)?'active':''}`} onClick={()=>tog('pelitaso',l)}>{titleCase(l)}</button>)}</div></div>
      <div className="field"><div className="detail-label">Pelimuoto</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{PLAY_STYLES.map(s=><button key={s} className={`filter-chip ${form.pelimuoto.includes(s)?'active':''}`} onClick={()=>tog('pelimuoto',s)}>{titleCase(s)}</button>)}</div></div>
      <div className="field"><div className="detail-label">Saatavuus</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{AVAILABILITY_SLOTS.map(s=><button key={s.value} className={`filter-chip ${form.saatavuus.includes(s.value)?'active':''}`} onClick={()=>tog('saatavuus',s.value)}>{s.label}</button>)}</div></div>
      <div className="field"><div className="detail-label">Bio</div><textarea className="input input-dark" rows={3} value={form.bio} onChange={e=>set('bio',e.target.value)}/></div>
      <button className="btn btn-lime btn-lg btn-full" onClick={save} disabled={busy}>{busy?'Tallennetaan...':'Tallenna'}</button>
    </div>
  </div>;
  return <div className="page" style={{paddingBottom:40}}>
    <div className="page-header"><h2 className="page-title">Profiili</h2><button className="btn btn-outline-w btn-sm" onClick={()=>setEditing(true)}>Muokkaa</button></div>
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,marginBottom:24}}>
      <Avatar uri={profile.avatarUrl} name={profile.nimi} color={profile.avatarColor} size={76}/>
      <h3 style={{color:'#fff',fontWeight:800,fontSize:20,margin:0}}>{profile.nimi}, {profile.ika}</h3>
      {profile.bio&&<p style={{color:'rgba(255,255,255,0.6)',fontSize:13,textAlign:'center'}}>{profile.bio}</p>}
    </div>
    <div style={{display:'flex',gap:8,justifyContent:'center',marginBottom:16}}>{profile.alue.map(a=><span key={a} className="sidebar-area">{a}</span>)}</div>
    <div style={{display:'flex',gap:10,marginBottom:14}}>
      <div className="card" style={{flex:1,textAlign:'center'}}><div style={{color:'rgba(255,255,255,0.45)',fontSize:10,fontWeight:700,textTransform:'uppercase',marginBottom:3}}>Pelitaso</div><div style={{color:'#fff',fontWeight:700,fontSize:15}}>{formatSkillLevels(profile.pelitaso)}</div></div>
      <div className="card" style={{flex:1,textAlign:'center'}}><div style={{color:'rgba(255,255,255,0.45)',fontSize:10,fontWeight:700,textTransform:'uppercase',marginBottom:3}}>Pelimuoto</div><div style={{color:'#fff',fontWeight:700,fontSize:15}}>{profile.pelimuoto.map(titleCase).join(', ')}</div></div>
    </div>
    {profile.saatavuus.length>0&&<div className="card" style={{marginBottom:14}}><div style={{color:'rgba(255,255,255,0.45)',fontSize:10,fontWeight:700,textTransform:'uppercase',marginBottom:6}}>Ajankohdat</div>{profile.saatavuus.map(s=><div key={s} style={{color:'#fff',fontSize:13,padding:'2px 0'}}>{slotLabel(s)}</div>)}</div>}
    <button className="btn btn-outline-w btn-md btn-full" onClick={signOut} style={{marginTop:16}}>Kirjaudu ulos</button>
    <Toast show={!!toast} text={toast}/>
  </div>;
}

// ── Top Nav ────────────────────────────────────────────
function TopNav({ tab, setTab }) {
  const { profile } = useAuth();
  const links = [
    { id: 'players', label: 'Pelaajat', icon: 'assets/ball-tight.png' },
    { id: 'challenges', label: 'Avoimet haasteet', icon: 'assets/avoimet-tight.png' },
    { id: 'messages', label: 'Viestit', icon: 'assets/viestit-tight.png' },
  ];
  return (
    <nav className="top-nav">
      <a href="/" className="top-nav-logo">Krossi</a>
      <div className="top-nav-links">
        {links.map(l => (
          <button key={l.id} className={`top-nav-link ${tab === l.id ? 'active' : ''}`} onClick={() => setTab(l.id)}>
            <img src={l.icon} alt="" />
            {l.label}
          </button>
        ))}
      </div>
      <button className={`top-nav-profile ${tab === 'profile' ? 'active' : ''}`} onClick={() => setTab('profile')}>
        <Avatar uri={profile?.avatarUrl} name={profile?.nimi} color={profile?.avatarColor} size={30} />
        <span>{profile?.nimi || 'Profiili'}</span>
      </button>
    </nav>
  );
}

// ── App Shell ──────────────────────────────────────────
function AppShell() {
  const { session, profile } = useAuth();
  const [tab, setTab] = React.useState('players');
  const [screen, setScreen] = React.useState({ type: 'tab' });
  const back = () => setScreen({ type: 'tab' });
  const showSidebar = tab === 'players' || tab === 'challenges';
  const showFullPage = screen.type !== 'tab';

  if (screen.type === 'playerDetail') return <div className="app-shell"><TopNav tab={tab} setTab={t=>{setTab(t);setScreen({type:'tab'});}}/><div className="app-body"><div className="app-full clay-bg"><PlayerDetail player={screen.player} onBack={back} currentUserId={session?.user?.id}/></div></div></div>;
  if (screen.type === 'challengeDetail') return <div className="app-shell"><TopNav tab={tab} setTab={t=>{setTab(t);setScreen({type:'tab'});}}/><div className="app-body"><div className="app-full clay-bg"><ChallengeDetail challenge={screen.challenge} onBack={back} currentUserId={session?.user?.id}/></div></div></div>;
  if (screen.type === 'createChallenge') return <div className="app-shell"><TopNav tab={tab} setTab={t=>{setTab(t);setScreen({type:'tab'});}}/><div className="app-body"><div className="app-full"><CreateChallengeScreen onBack={back} onCreated={()=>{back();setTab('challenges');}}/></div></div></div>;
  if (screen.type === 'chat') return <div className="app-shell"><TopNav tab={tab} setTab={t=>{setTab(t);setScreen({type:'tab'});}}/><div className="app-body"><div className="app-full" style={{display:'flex',flexDirection:'column'}}><ChatScreen conversation={screen.conversation} onBack={back}/></div></div></div>;

  return (
    <div className="app-shell">
      <TopNav tab={tab} setTab={t => { setTab(t); setScreen({ type: 'tab' }); }} />
      <div className="app-body clay-bg">
        {showSidebar && (
          <div className="app-sidebar">
            <SidebarProfile onEdit={() => setTab('profile')} />
          </div>
        )}
        <div className="app-main">
          {tab === 'players' && <PlayersScreen onOpenPlayer={p => setScreen({ type: 'playerDetail', player: p })} />}
          {tab === 'challenges' && <ChallengesScreen onOpenChallenge={c => setScreen({ type: 'challengeDetail', challenge: c })} onCreateChallenge={() => setScreen({ type: 'createChallenge' })} />}
          {tab === 'messages' && <MessagesScreen onOpenChat={c => setScreen({ type: 'chat', conversation: c })} />}
          {tab === 'profile' && <ProfileFullScreen />}
        </div>
      </div>
    </div>
  );
}

// ── Root ───────────────────────────────────────────────
function KrossiWebApp() {
  const { session, loading, needsOnboarding } = useAuth();
  if (loading) return <div className="auth-shell clay-bg"><span style={{fontSize:40,fontWeight:800,color:'var(--lime)',letterSpacing:-1.5}}>Krossi</span><div style={{marginTop:20}}><div className="spinner"/></div></div>;
  if (!session) return <AuthScreen />;
  if (needsOnboarding) return <OnboardingScreen />;
  return <AppShell />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <AuthProvider><KrossiWebApp /></AuthProvider>
);
