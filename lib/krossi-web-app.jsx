// krossi-web-app.jsx — Browser-based Krossi with desktop layout
// Uses same Supabase project as the mobile app

const SUPABASE_URL = 'https://hhybjpgrvlbazbqiaaao.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_IKLRGbstMLfxKeXwBTavSA_UVYyMgTL';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
});

// ── Constants ──────────────────────────────────────────
const AREA_OPTIONS = ['Lahti', 'Turku', 'Helsinki', 'Tampere', 'Oulu', 'Jyväskylä', 'Pori', 'Kuopio'];
const VISIBLE_AREAS = AREA_OPTIONS;
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
  { name: 'Tampereen Tenniskeskus', city: 'Tampere' }, { name: 'Oulun Tenniskeskus', city: 'Oulu' },
  { name: 'Jyväskylän Tenniskeskus', city: 'Jyväskylä' }, { name: 'Porin Tenniskeskus', city: 'Pori' },
  { name: 'Kuopion Tenniskeskus', city: 'Kuopio' },
];
const SKILL_LEVEL_INFO = [
  { value: 'aloittelija', label: 'Aloittelija', desc: 'Olet juuri aloittamassa tai pelannut vasta muutaman kerran.' },
  { value: 'keskitaso', label: 'Keskitaso', desc: 'Hallitset perusliikkeet ja pystyt pitämään pisteen yllä.' },
  { value: 'edistynyt', label: 'Edistynyt', desc: 'Pelaat säännöllisesti ja hallitset taktiikkaa sekä eri lyöntejä.' },
  { value: 'kilpapelaaja', label: 'Kilpapelaaja', desc: 'Pelaat tai olet pelannut kilpaa, ja sinulla on kilpailuluokka.' },
];
const COMPETITION_CLASSES = ['A1','A2','A3','B1','B2','B3','C1','C2','C3','D1','D2','D3','E1','E2','E3'];
const GAME_TYPES = ['pallottelu', 'treenit', 'matsit'];
const MATCH_FORMATS = ['kaksinpeli', 'nelinpeli', 'kaikki käy'];
const AGE_RANGES = [
  { value: 'alle20', label: 'Alle 20' },
  { value: '20-30', label: '20–30' },
  { value: '30-40', label: '30–40' },
  { value: '40-50', label: '40–50' },
  { value: '50-60', label: '50–60' },
  { value: '60+', label: '60+' },
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
function storageUrl(path) { return path ? (path.startsWith('http') ? path : `${SUPABASE_URL}/storage/v1/object/public/profile-avatars/${path}`) : null; }
function chatImgUrl(path) { return path ? (path.startsWith('http') ? path : `${SUPABASE_URL}/storage/v1/object/public/chat-images/${path}`) : null; }
function fmtLastMsg(raw) {
  if (!raw) return { text: null }; try { const p = JSON.parse(raw);
    if (p.__type==='challenge_join') return { text: `${p.joinerName} liittyi peliin!` };
    if (p.__type==='thumbs_up') return { text: '👍' };
  } catch {} return { text: raw };
}
function slotLabel(v) { const s = AVAILABILITY_SLOTS.find(a => a.value === v); return s ? (s.time ? `${s.label} ${s.time}` : s.label) : v; }
function ageRangeLabel(v) { const r = AGE_RANGES.find(a => a.value === v); return r ? r.label : v; }
function archivedStorageKey(uid) { return `krossi_archived_conversations_${uid}`; }
function getArchivedIds(uid) {
  if (!uid) return [];
  try { return JSON.parse(localStorage.getItem(archivedStorageKey(uid)) || '[]'); } catch { return []; }
}
function saveArchivedIds(uid, ids) {
  if (!uid) return;
  try { localStorage.setItem(archivedStorageKey(uid), JSON.stringify(ids)); } catch {}
}
async function fetchWebConversations(uid) {
  const { data: cpD } = await supabase.from('conversation_participants').select('conversation_id,last_read_at,conversation:conversations(id,updated_at,last_message,challenge_id)').eq('user_id',uid);
  const rows = cpD || []; const cids = rows.map(r=>r.conversation_id);
  if (cids.length === 0) return [];
  const [{data:ap},{data:lm}] = await Promise.all([
    supabase.from('conversation_participants').select('conversation_id,user_id,profile:profiles!conversation_participants_user_id_fkey(id,name,avatar_url,avatar_color)').in('conversation_id',cids),
    supabase.from('messages').select('conversation_id,sender_id,created_at').in('conversation_id',cids).order('created_at',{ascending:false}),
  ]);
  const pm=new Map(); (ap||[]).forEach(i=>{const a=pm.get(i.conversation_id)||[];if(i.profile)a.push({userId:i.profile.id,name:i.profile.name,avatarUrl:i.profile.avatar_url,avatarColor:i.profile.avatar_color||'blue'});pm.set(i.conversation_id,a);});
  const lmm=new Map(); (lm||[]).forEach(i=>{if(!lmm.has(i.conversation_id))lmm.set(i.conversation_id,{senderId:i.sender_id,createdAt:i.created_at});});
  return rows.map(r=>{
    const others=(pm.get(r.conversation_id)||[]).filter(p=>p.userId!==uid);const o=others[0];
    if(!r.conversation||!o)return null;
    const lt=lmm.get(r.conversation_id);const lr=r.last_read_at;
    const unread=lt?.senderId&&lt.senderId!==uid&&(!lr||new Date(lt.createdAt)>new Date(lr));
    return {id:r.conversation_id,otherUserId:o.userId,otherUserName:o.name,otherUserAvatarUrl:o.avatarUrl,otherUserAvatarColor:o.avatarColor,displayName:others.length>1?'Ryhmäkeskustelu':o.name,isGroup:others.length>1,participantProfiles:others,lastMessage:fmtLastMsg(r.conversation.last_message).text,updatedAt:r.conversation.updated_at,hasUnread:unread};
  }).filter(Boolean).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
}
function mapMatchResult(row) {
  return { id:row.id, createdAt:row.created_at, gameType:row.game_type, format:row.format, partnerName:row.partner_name, opponentName:row.opponent_name, oppPartnerName:row.opp_partner_name, sets:row.sets||[], won:row.won };
}
async function fetchMatchResultsWeb() {
  const { data, error } = await supabase.from('match_results').select('*').order('created_at',{ascending:false}).limit(50);
  if (error) throw error;
  return (data||[]).map(mapMatchResult);
}
async function saveMatchResultWeb(id, payload) {
  const row = { game_type:payload.gameType, format:payload.format, partner_name:payload.partnerName||null, opponent_name:payload.opponentName||null, opp_partner_name:payload.oppPartnerName||null, sets:payload.sets, won:payload.won };
  if (id) { const {error}=await supabase.from('match_results').update(row).eq('id',id); if(error) throw error; }
  else {
    const { data: { user } } = await supabase.auth.getUser();
    const {error}=await supabase.from('match_results').insert({...row, created_by:user.id}); if(error) throw error;
  }
}
async function deleteMatchResultWeb(id) {
  const { error } = await supabase.from('match_results').delete().eq('id', id);
  if (error) throw error;
}
function calculateMatchWon(sets) {
  const won = sets.filter(s=>s.my>s.opp).length;
  const lost = sets.filter(s=>s.opp>s.my).length;
  return won>lost;
}

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
  return <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
    <p style={{ fontSize: 15, marginBottom: 16 }}>{title}</p>
    {action && <button className="btn btn-lime btn-md" onClick={onAction}>{action}</button>}
  </div>;
}
function TrashIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M10 11v6M14 11v6" /></svg>; }
function ArchiveIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" /></svg>; }
function UndoIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9h11a5 5 0 0 1 0 10h-2M3 9l5-5M3 9l5 5" /></svg>; }
function Toggle({ on, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!on)} style={{ width: 48, height: 28, borderRadius: 14, border: 'none', padding: 2, cursor: 'pointer', background: on ? 'var(--green-deep)' : '#ccc', position: 'relative', flexShrink: 0, transition: 'background .2s' }}>
      <span style={{ display: 'block', width: 24, height: 24, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.2)', transition: 'transform .2s', transform: on ? 'translateX(20px)' : 'translateX(0)' }} />
    </button>
  );
}
function AvatarPicker({ preview, onPick }) {
  const inputRef = React.useRef(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div onClick={() => inputRef.current?.click()} style={{ position: 'relative', cursor: 'pointer', width: 88, height: 88 }}>
        {preview
          ? <img src={preview} alt="" style={{ width: 88, height: 88, borderRadius: '50%', objectFit: 'cover' }} />
          : <div className="avatar avatar-blue" style={{ width: 88, height: 88, fontSize: 30 }}>+</div>}
        <div style={{ position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: '50%', background: 'var(--green-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M3 7h3l2-3h8l2 3h3v13H3z" /><circle cx="12" cy="13" r="4" /></svg>
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={onPick} />
      <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 260, margin: 0 }}>Auta muita pelaajia tietämään kuka on vastassa</p>
    </div>
  );
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
  const [mode, setMode] = React.useState('register');
  const [email, setEmail] = React.useState('');
  const [pw, setPw] = React.useState('');
  const [error, setError] = React.useState('');
  const [info, setInfo] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [agreed, setAgreed] = React.useState(false);
  const [showTerms, setShowTerms] = React.useState(false);
  const [showPrivacy, setShowPrivacy] = React.useState(false);
  const needsConsent = mode === 'register' && !agreed;
  const signInWithGoogle = async () => {
    setError(''); setBusy(true);
    try {
      const { error: e } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + '/pelaa' },
      });
      if (e) throw e;
    } catch (err) { setError(err.message || 'Google-kirjautuminen epäonnistui'); setBusy(false); }
  };

  const signInWithApple = async () => {
    setError(''); setBusy(true);
    try {
      const { error: e } = await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: { redirectTo: window.location.origin + '/pelaa' },
      });
      if (e) throw e;
    } catch (err) { setError(err.message || 'Apple-kirjautuminen epäonnistui'); setBusy(false); }
  };

  const submit = async (e) => {
    e.preventDefault(); setError(''); setInfo('');
    if (needsConsent) { setError('Hyväksy käyttöehdot ja tietosuojaseloste jatkaaksesi.'); return; }
    setBusy(true);
    try {
      if (mode === 'login') { const { error } = await supabase.auth.signInWithPassword({ email, password: pw }); if (error) throw error; }
      else if (mode === 'register') {
        const { data, error } = await supabase.auth.signUp({ email, password: pw, options: { emailRedirectTo: window.location.origin + '/pelaa' } });
        if (error) throw error;
        if (typeof fbq !== 'undefined') fbq('track', 'Lead');
        if (data.user && !data.session) setInfo('Vahvistusviesti lähetetty sähköpostiisi.');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/pelaa' });
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
    <div className="auth-shell" style={{ background: 'var(--paper)' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <span style={{ fontSize: 72, fontWeight: 800, color: 'var(--lime)', letterSpacing: -2.5 }}>Krossi</span>
        <p style={{ color: 'var(--text-muted)', marginTop: 6, fontSize: 14 }}>Löydä pelikavereita tennikseen</p>
      </div>
      <div className="auth-card">
        <h2 style={{ margin: '0 0 18px', fontSize: 20, fontWeight: 800 }}>
          {mode === 'login' ? 'Kirjaudu sisään' : mode === 'register' ? 'Luo tili' : 'Palauta salasana'}
        </h2>
        {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
        {info && <div className="alert alert-success" style={{ marginBottom: 12 }}>{info}</div>}

        {mode !== 'reset' && (
          <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:16 }}>
            <button style={oauthBtnStyle} onClick={signInWithGoogle} disabled={busy || needsConsent}>
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.0 24.0 0 0 0 0 21.56l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              Jatka Googlella
            </button>
            <button style={oauthBtnStyle} onClick={signInWithApple} disabled={busy || needsConsent}>
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
          {mode === 'register' && (
            <label style={{ display:'flex', alignItems:'flex-start', gap:8, fontSize:13, color:'var(--text-muted)', cursor:'pointer', lineHeight:1.45 }}>
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{ width:18, height:18, marginTop:1, flexShrink:0, accentColor:'var(--green-deep)' }} />
              <span>
                Hyväksyn Krossin{' '}
                <button type="button" onClick={() => setShowTerms(true)} style={{ background:'none', border:'none', padding:0, color:'var(--green-deep)', fontWeight:700, cursor:'pointer', fontFamily:'inherit', fontSize:'inherit', textDecoration:'underline' }}>käyttöehdot</button>
                {' '}ja{' '}
                <button type="button" onClick={() => setShowPrivacy(true)} style={{ background:'none', border:'none', padding:0, color:'var(--green-deep)', fontWeight:700, cursor:'pointer', fontFamily:'inherit', fontSize:'inherit', textDecoration:'underline' }}>tietosuojaselosteen</button>
              </span>
            </label>
          )}
          <button className="btn btn-dark btn-lg btn-full" type="submit" disabled={busy || needsConsent}>
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
      <a href="/" style={{ color:'var(--text-muted)',marginTop:20,fontSize:13,textDecoration:'none' }}>← Takaisin etusivulle</a>
      {(showTerms || showPrivacy) && (
        <div className="modal-overlay" onClick={() => { setShowTerms(false); setShowPrivacy(false); }}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            {showTerms ? <TermsContent /> : <PrivacyContent />}
            <button className="btn btn-outline-d btn-md btn-full" style={{ marginTop:16 }} onClick={() => { setShowTerms(false); setShowPrivacy(false); }}>Sulje</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Käyttöehdot & tietosuojaseloste (in-app popupit) ────
function LegalSection({ title, children }) {
  return (
    <div style={{ marginBottom:14 }}>
      <div style={{ fontWeight:800, fontSize:14, color:'var(--ink)', marginBottom:4 }}>{title}</div>
      <div style={{ fontSize:13, color:'var(--text-muted)', lineHeight:1.55 }}>{children}</div>
    </div>
  );
}
function TermsContent() {
  return (
    <div>
      <h3 style={{ margin:'0 0 4px', fontSize:18, fontWeight:800 }}>Krossin käyttöehdot</h3>
      <p style={{ fontSize:12, color:'var(--text-muted)', marginBottom:16 }}>Voimassa 9.7.2026 alkaen</p>
      <LegalSection title="1. Palvelun kuvaus">
        Krossi on palvelu, jonka avulla käyttäjät löytävät pelikavereita tennikseen: selaavat pelaajaprofiileja, sopivat pelejä ja liittyvät toisten luomiin haasteisiin. Krossi ei omista kenttiä eikä ole osapuolena käyttäjien välisissä peleissä tai tapaamisissa.
      </LegalSection>
      <LegalSection title="2. Käyttäjätili">
        Tilin luominen edellyttää, että annat itsestäsi oikeat tiedot etkä esiinny toisena henkilönä. Palvelu on tarkoitettu vähintään 16-vuotiaille. Vastaat itse tilisi ja salasanasi säilyttämisestä.
      </LegalSection>
      <LegalSection title="3. Käyttäytyminen">
        Käytä palvelua asiallisesti. Häirintä, uhkailu, syrjivä käytös tai väärän tiedon antaminen muista käyttäjistä ei ole sallittua. Voit ilmoittaa sopimattomasta käytöksestä palvelun sisäisellä ilmoitustoiminnolla, ja Krossi voi tämän perusteella rajoittaa tai poistaa käyttöoikeuden.
      </LegalSection>
      <LegalSection title="4. Tapaamiset ja vastuu">
        Krossi ei tarkista käyttäjien taustoja. Tapaamisia toisten käyttäjien kanssa varten kannattaa käyttää tervettä järkeä, esimerkiksi sopia ensimmäinen tapaaminen julkiselle kentälle. Krossi ei vastaa käyttäjien välisistä sopimuksista, peleistä tai niiden aikana sattuneista vahingoista.
      </LegalSection>
      <LegalSection title="5. Sisältö">
        Vastaat itse jakamastasi sisällöstä (profiilikuva, bio, viestit). Et saa jakaa laitonta, loukkaavaa tai muiden oikeuksia loukkaavaa sisältöä.
      </LegalSection>
      <LegalSection title="6. Tilin poistaminen">
        Voit poistaa tilisi milloin tahansa ottamalla yhteyttä alla olevaan osoitteeseen. Krossi voi sulkea tilin, jos näitä ehtoja rikotaan.
      </LegalSection>
      <LegalSection title="7. Muutokset">
        Näitä ehtoja voidaan päivittää palvelun kehittyessä. Olennaisista muutoksista pyritään ilmoittamaan palvelussa.
      </LegalSection>
      <LegalSection title="8. Yhteystiedot">
        Kysymykset: <a href="mailto:eelispuro@gmail.com" style={{ color:'var(--green-deep)', fontWeight:700 }}>eelispuro@gmail.com</a>
      </LegalSection>
    </div>
  );
}
function PrivacyContent() {
  return (
    <div>
      <h3 style={{ margin:'0 0 4px', fontSize:18, fontWeight:800 }}>Tietosuojaseloste</h3>
      <p style={{ fontSize:12, color:'var(--text-muted)', marginBottom:16 }}>Voimassa 9.7.2026 alkaen</p>
      <LegalSection title="Rekisterinpitäjä">
        Krossi. Yhteydenotot tietosuoja-asioissa: <a href="mailto:eelispuro@gmail.com" style={{ color:'var(--green-deep)', fontWeight:700 }}>eelispuro@gmail.com</a>
      </LegalSection>
      <LegalSection title="Mitä tietoja käsittelemme">
        Tiliin liittyvät tiedot (sähköposti), profiilitiedot (nimi, ikäryhmä, kotikaupunki, profiilikuva, pelitaso, kilpailuluokka, pelitoiveet, saatavuus, bio), sekä palvelun käytöstä syntyvä data: viestit muiden käyttäjien kanssa, pelipyynnöt, haasteet ja niihin osallistuminen, ottelutulokset sekä mahdolliset ilmoitukset sopimattomasta käytöksestä.
      </LegalSection>
      <LegalSection title="Käsittelyn tarkoitus ja peruste">
        Käsittelemme tietoja tarjotaksemme palvelun ydintoiminnon: sopivien pelikavereiden löytämisen ja pelien sopimisen. Käsittelyn peruste on käyttäjän kanssa tehtävän sopimuksen täytäntöönpano sekä rekisteröitymisen yhteydessä annettu suostumus.
      </LegalSection>
      <LegalSection title="Tietojen säilytys">
        Säilytämme tietoja niin kauan kuin tilisi on aktiivinen. Kun poistat tilisi, tiedot poistetaan kohtuullisessa ajassa, ellei laki edellytä pidempää säilytystä.
      </LegalSection>
      <LegalSection title="Kenelle tietoja luovutetaan">
        Tietoja käsitellään Supabase-alustalla (tietokanta ja tiedostojen tallennus, EU-alueella sijaitsevat palvelimet). Jos kirjaudut Google- tai Apple-tunnuksilla, kyseinen palveluntarjoaja käsittelee kirjautumiseen tarvittavat tiedot omien ehtojensa mukaisesti. Profiilitietojasi ei myydä eikä luovuteta markkinointitarkoituksiin kolmansille osapuolille.
      </LegalSection>
      <LegalSection title="Oikeutesi">
        Sinulla on oikeus tarkastaa, oikaista ja pyytää poistettavaksi omat tietosi, rajoittaa niiden käsittelyä, siirtää tiedot toiseen palveluun sekä vastustaa käsittelyä. Voit käyttää oikeuksiasi yllä olevasta sähköpostiosoitteesta. Sinulla on myös oikeus tehdä valitus tietosuojavaltuutetun toimistolle.
      </LegalSection>
      <LegalSection title="Evästeet">
        Krossin markkinointisivustolla käytetään erikseen evästesuostumuksella hallittavia analytiikka- ja markkinointievästeitä. Tämä ei koske sovelluksen sisäisiä profiilitietoja.
      </LegalSection>
    </div>
  );
}

// ── Onboarding ─────────────────────────────────────────
function OnboardingScreen() {
  const { session, refreshProfile } = useAuth();
  const [step, setStep] = React.useState(1);
  const [form, setForm] = React.useState({
    nimi:'', ika:'', alue:'', pelitaso:'', kilpaluokat:[], pelimuoto:[], otteluTyyppi:[], bio:'',
    saatavuus:[], playingThisWeek:true, hiddenFromFeed:false,
  });
  const [avatarFile, setAvatarFile] = React.useState(null);
  const [avatarPreview, setAvatarPreview] = React.useState(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const set = (k,v) => setForm(p => ({...p,[k]:v}));
  const tog = (k,v) => setForm(p => ({...p,[k]:p[k].includes(v)?p[k].filter(x=>x!==v):[...p[k],v]}));
  const onAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };
  const save = async () => {
    setError(''); setBusy(true);
    try {
      const uid = session.user.id;
      let avatarPath = null;
      if (avatarFile) {
        const ext = (avatarFile.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${uid}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('profile-avatars').upload(path, avatarFile, { upsert: true });
        if (upErr) throw upErr;
        avatarPath = path;
      }
      const skillLevels = form.pelitaso === 'kilpapelaaja' && form.kilpaluokat.length > 0
        ? [form.pelitaso, ...form.kilpaluokat] : [form.pelitaso];
      await supabase.from('profiles').upsert({
        id:uid, name:form.nimi.trim(), age:form.ika, area:form.alue, bio:form.bio.trim()||null,
        playing_this_week:form.playingThisWeek, hidden_from_feed:form.hiddenFromFeed,
        ...(avatarPath ? { avatar_url: avatarPath } : {}),
      });
      await supabase.from('tennis_preferences').upsert({
        user_id:uid, skill_level:skillLevels.join(','),
        play_style:[...form.pelimuoto, ...form.otteluTyyppi].join(', '),
      });
      await supabase.from('availability').delete().eq('user_id',uid);
      if (form.saatavuus.length>0) await supabase.from('availability').insert(form.saatavuus.map(s=>({user_id:uid,slot:s})));
      if (typeof fbq !== 'undefined') fbq('track', 'CompleteRegistration');
      await refreshProfile();
    } catch (err) { setError(err.message||'Tallennus epäonnistui'); } finally { setBusy(false); }
  };
  return (
    <div className="onboard-shell clay-bg">
      <div className="onboard-card">
        <h2 style={{ margin:'0 0 4px', fontSize:20, fontWeight:800 }}>Luo profiilisi</h2>
        <p style={{ color:'var(--text-muted)', fontSize:13, marginBottom:16 }}>Vaihe {step}/3</p>
        {error && <div className="alert alert-error" style={{ marginBottom:12 }}>{error}</div>}
        {step===1 && <div style={{ display:'flex',flexDirection:'column',gap:14 }}>
          <AvatarPicker preview={avatarPreview} onPick={onAvatarChange} />
          <div className="field"><div className="field-label">Nimi</div><input className="input" placeholder="Etunimi" value={form.nimi} onChange={e=>set('nimi',e.target.value)}/></div>
          <div className="field"><div className="field-label">Ikä</div><div className="select-chips">{AGE_RANGES.map(r=><button key={r.value} type="button" className={`select-chip ${form.ika===r.value?'selected':''}`} onClick={()=>set('ika',r.value)}>{r.label}</button>)}</div></div>
          <div className="field"><div className="field-label">Kotikaupunki</div><div className="select-chips">{AREA_OPTIONS.map(a=><button key={a} type="button" className={`select-chip ${form.alue===a?'selected':''}`} onClick={()=>set('alue',a)}>{a}</button>)}</div></div>
          <button className="btn btn-dark btn-lg btn-full" disabled={!form.nimi||!form.ika||!form.alue} onClick={()=>setStep(2)}>Seuraava</button>
        </div>}
        {step===2 && <div style={{ display:'flex',flexDirection:'column',gap:14 }}>
          <div className="field">
            <div className="field-label">Pelitaso</div>
            <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
              {SKILL_LEVEL_INFO.map(s => (
                <button key={s.value} type="button" onClick={()=>set('pelitaso',s.value)} style={{
                  textAlign:'left', padding:'10px 14px', borderRadius:12, cursor:'pointer', fontFamily:'inherit',
                  border: form.pelitaso===s.value ? '1.5px solid var(--green-deep)' : '1.5px solid var(--border)',
                  background: form.pelitaso===s.value ? 'rgba(14,59,44,0.06)' : '#fff',
                }}>
                  <div style={{ fontWeight:700, fontSize:14, color:'var(--ink)' }}>{s.label}</div>
                  <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>{s.desc}</div>
                </button>
              ))}
            </div>
          </div>
          {form.pelitaso==='kilpapelaaja' && (
            <div className="field">
              <div className="field-label">Kilpailuluokka</div>
              <div className="select-chips">{COMPETITION_CLASSES.map(c=><button key={c} className={`select-chip ${form.kilpaluokat.includes(c)?'selected':''}`} onClick={()=>tog('kilpaluokat',c)}>{c}</button>)}</div>
            </div>
          )}
          <div className="field"><div className="field-label">Millaista peliä haet?</div><div className="select-chips">{GAME_TYPES.map(g=><button key={g} className={`select-chip ${form.pelimuoto.includes(g)?'selected':''}`} onClick={()=>tog('pelimuoto',g)}>{titleCase(g)}</button>)}</div></div>
          <div className="field"><div className="field-label">Ottelumuoto</div><div className="select-chips">{MATCH_FORMATS.map(m=><button key={m} className={`select-chip ${form.otteluTyyppi.includes(m)?'selected':''}`} onClick={()=>tog('otteluTyyppi',m)}>{titleCase(m)}</button>)}</div></div>
          <div className="field"><div className="field-label">Bio</div><textarea className="input" placeholder="Esim. Etsin pallottelua tai kevyitä matseja arki-iltoihin." value={form.bio} onChange={e=>set('bio',e.target.value)} rows={3}/></div>
          <div style={{ display:'flex',gap:8 }}><button className="btn btn-outline-d btn-md" onClick={()=>setStep(1)}>Takaisin</button><button className="btn btn-dark btn-lg" style={{flex:1}} disabled={!form.pelitaso} onClick={()=>setStep(3)}>Seuraava</button></div>
        </div>}
        {step===3 && <div style={{ display:'flex',flexDirection:'column',gap:14 }}>
          <div className="field"><div className="field-label">Milloin ehdit pelaamaan?</div><div className="select-chips">{AVAILABILITY_SLOTS.map(s=><button key={s.value} className={`select-chip ${form.saatavuus.includes(s.value)?'selected':''}`} onClick={()=>tog('saatavuus',s.value)}>{s.label}{s.time?` ${s.time}`:''}</button>)}</div></div>
          <div className="field" style={{ display:'flex',alignItems:'center',justifyContent:'space-between' }}>
            <div style={{ fontWeight:700, fontSize:14, color:'var(--ink)' }}>Pelaan tällä viikolla</div>
            <Toggle on={form.playingThisWeek} onChange={v=>set('playingThisWeek',v)} />
          </div>
          <div className="field" style={{ display:'flex',alignItems:'center',justifyContent:'space-between' }}>
            <div style={{ flex:1, paddingRight:12 }}>
              <div style={{ fontWeight:700, fontSize:14, color:'var(--ink)' }}>Piilota profiilini pelaajafeedistä</div>
              <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>Et näy muille pelaajille, mutta voit silti luoda haasteita.</div>
            </div>
            <Toggle on={form.hiddenFromFeed} onChange={v=>set('hiddenFromFeed',v)} />
          </div>
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
      <div className="sidebar-name">{profile.nimi}, {ageRangeLabel(profile.ika)}</div>
      {profile.bio && <div className="sidebar-bio">{profile.bio}</div>}
      <div className="sidebar-areas">
        {profile.alue.map(a => <span key={a} className="sidebar-area">{a}</span>)}
      </div>
      <button className={`sidebar-live ${profile.playingThisWeek ? 'on' : 'off'}`} onClick={toggleLive}>
        <span className="sidebar-dot" style={{ background: profile.playingThisWeek ? '#7ee06a' : '#ccc' }} />
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
            <span style={{ color:'var(--ink)',fontWeight:700,fontSize:15 }}>{player.nimi}, {ageRangeLabel(player.ika)}</span>
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
        <h2 style={{ color:'var(--ink)',fontWeight:800,fontSize:22,margin:0 }}>{player.nimi}, {ageRangeLabel(player.ika)}</h2>
        <p style={{ color:'var(--text-muted)',fontSize:14 }}>{player.alue.join(', ')}</p>
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
        <span style={{ color:'var(--ink)',fontWeight:700,fontSize:13 }}>{challenge.scheduledAt?formatDate(challenge.scheduledAt):'Aika avoin'}</span>
        <span className="chip chip-outline">{titleCase(challenge.matchType)}</span>
      </div>
      <div style={{ display:'flex',alignItems:'center',gap:10 }}>
        <Avatar uri={challenge.creatorAvatarUrl} name={challenge.creatorName} color={challenge.creatorAvatarColor} size={40}/>
        <div style={{ flex:1,minWidth:0 }}>
          <div style={{ color:'var(--ink)',fontWeight:700,fontSize:15 }}>{challenge.creatorName}</div>
          <div style={{ color:'var(--text-muted)',fontSize:12 }}>{challenge.location} · {titleCase(challenge.locationType)}</div>
        </div>
        <div style={{ display:'flex',gap:3 }}>
          {Array.from({length:Math.max(0,slotsNeeded(challenge.matchType)-challenge.participants.length)}).map((_,i)=>
            <span key={i} style={{width:20,height:20,borderRadius:'50%',border:'1.5px dashed #c5c0b5'}}/>
          )}
        </div>
      </div>
      {challenge.title && <p style={{ color:'var(--text-muted)',fontSize:12,marginTop:6 }}>{challenge.title}</p>}
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
          <div><h2 style={{color:'var(--ink)',fontWeight:800,fontSize:20,margin:0}}>{challenge.creatorName}</h2><p style={{color:'var(--text-muted)',fontSize:13,margin:0}}>{challenge.creatorArea?.join(', ')}</p></div>
        </div>
        {challenge.title && <p style={{color:'var(--ink)',fontSize:15,fontWeight:600,marginBottom:14}}>{challenge.title}</p>}
        {challenge.description && <p style={{color:'#6b665c',fontSize:13,marginBottom:18,lineHeight:1.5}}>{challenge.description}</p>}
        <div className="detail-field"><div className="detail-label">Aika</div><div className="detail-value">{challenge.scheduledAt?formatDate(challenge.scheduledAt):'Aika avoin'}</div></div>
        <div className="detail-field"><div className="detail-label">Paikka</div><div className="detail-value">{challenge.location}</div></div>
        <div className="detail-field"><div className="detail-label">Tyyppi</div><div className="detail-value">{titleCase(challenge.matchType)} · {titleCase(challenge.locationType)}</div></div>
        {challenge.participants.length>0 && <div className="detail-field"><div className="detail-label">Osallistujat</div><div style={{display:'flex',gap:6,marginTop:4}}>{challenge.participants.map(p=><div key={p.userId} style={{display:'flex',alignItems:'center',gap:5}}><Avatar uri={p.avatarUrl} name={p.name} color={p.avatarColor} size={26}/><span style={{color:'#6b665c',fontSize:12}}>{p.name}</span></div>)}</div></div>}
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
    <div className="page-header"><h2 className="page-title">Avoimet</h2><button className="btn btn-lime btn-sm" onClick={onCreateChallenge}>+ Luo haaste</button></div>
    {loading?<Spinner/>:list.length===0?<Empty title="Ei avoimia haasteita." action="Luo ensimmäinen" onAction={onCreateChallenge}/>:list.map(c=><ChallengeCard key={c.id} challenge={c} onClick={()=>onOpenChallenge(c)}/>)}
  </div>;
}

// ── Create Challenge ───────────────────────────────────
function CreateChallengeScreen({ onBack, onCreated }) {
  const { session, profile } = useAuth();
  const COURT_SURFACES = ['kova','massa','nurmi','asfaltti'];
  const [form, setForm] = React.useState({matchType:'kaksinpeli',locationType:'sisätennis',location:'',scheduledAt:'',title:'',description:'',courtSurface:'',minSkillLevel:'',courtPrice:'',creatorCoversFull:false});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const set = (k,v)=>setForm(p=>({...p,[k]:v}));
  const homeCity = profile?.alue?.[0]||'Lahti';
  const venues = INDOOR_VENUES.filter(v=>v.city===homeCity);
  const create = async () => {
    setError(''); setBusy(true);
    try {
      const payload = {creator_id:session.user.id,location:form.location||'Avoin',location_type:form.locationType,city:homeCity,scheduled_at:form.scheduledAt?new Date(form.scheduledAt).toISOString():null,match_type:form.matchType,challenge_type:'open',title:form.title.trim()||null,description:form.description.trim()||null};
      if (form.courtSurface) payload.court_surface = form.courtSurface;
      if (form.minSkillLevel) payload.min_skill_level = form.minSkillLevel;
      if (form.courtPrice) payload.court_price = Number(form.courtPrice);
      if (form.creatorCoversFull) payload.creator_covers_full = true;
      const {error}=await supabase.from('challenges').insert(payload);
      if(error) throw error; onCreated();
    } catch(err) { setError(err.message||'Virhe'); } finally { setBusy(false); }
  };
  return <div className="clay-bg" style={{minHeight:'100%',padding:'20px 24px'}}>
    <button className="back-btn" onClick={onBack}>← Takaisin</button>
    <div style={{maxWidth:480,margin:'24px auto 0'}}>
      <h2 style={{color:'var(--ink)',fontWeight:800,fontSize:22,marginBottom:18}}>Luo haaste</h2>
      {error && <div className="alert alert-error" style={{marginBottom:12}}>{error}</div>}
      <div className="field"><div className="detail-label">Pelityyppi</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{MATCH_TYPES.map(t=><button key={t} className={`filter-chip ${form.matchType===t?'active':''}`} onClick={()=>set('matchType',t)}>{titleCase(t)}</button>)}</div></div>
      <div className="field"><div className="detail-label">Sijainti</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{LOCATION_TYPES.map(t=><button key={t} className={`filter-chip ${form.locationType===t?'active':''}`} onClick={()=>set('locationType',t)}>{titleCase(t)}</button>)}</div></div>
      {form.locationType==='sisätennis'&&venues.length>0 ? <div className="field"><div className="detail-label">Halli</div><select className="input input-dark" value={form.location} onChange={e=>set('location',e.target.value)}><option value="">Valitse</option>{venues.map(v=><option key={v.name} value={v.name}>{v.name}</option>)}</select></div>
      : <div className="field"><div className="detail-label">Paikka</div><input className="input input-dark" placeholder="Esim. Mukkulan kentät" value={form.location} onChange={e=>set('location',e.target.value)}/></div>}
      <div className="field"><div className="detail-label">Kenttäpinta</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{COURT_SURFACES.map(s=><button key={s} className={`filter-chip ${form.courtSurface===s?'active':''}`} onClick={()=>set('courtSurface',form.courtSurface===s?'':s)}>{titleCase(s)}</button>)}</div></div>
      <div className="field"><div className="detail-label">Ajankohta</div><input className="input input-dark" type="datetime-local" value={form.scheduledAt} onChange={e=>set('scheduledAt',e.target.value)}/></div>
      <div className="field"><div className="detail-label">Vastustajan minimitaso</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{PLAIN_SKILL_LEVELS.map(l=><button key={l} className={`filter-chip ${form.minSkillLevel===l?'active':''}`} onClick={()=>set('minSkillLevel',form.minSkillLevel===l?'':l)}>{titleCase(l)}</button>)}</div></div>
      <div className="field"><div className="detail-label">Otsikko</div><input className="input input-dark" placeholder="Vapaaehtoinen" value={form.title} onChange={e=>set('title',e.target.value)}/></div>
      <div className="field"><div className="detail-label">Lisätietoja</div><textarea className="input input-dark" rows={3} placeholder="Vapaaehtoinen kuvaus" value={form.description} onChange={e=>set('description',e.target.value)}/></div>
      <div className="field"><div className="detail-label">Kenttävuoron hinta (€)</div><input className="input input-dark" type="number" placeholder="Esim. 28" value={form.courtPrice} onChange={e=>set('courtPrice',e.target.value)}/></div>
      <div className="field"><label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:14,color:'var(--ink)'}}><input type="checkbox" checked={form.creatorCoversFull} onChange={e=>set('creatorCoversFull',e.target.checked)} style={{width:18,height:18,accentColor:'var(--green-deep)'}}/>Tarjoan koko kenttävuoron</label></div>
      <button className="btn btn-dark btn-lg btn-full" onClick={create} disabled={busy}>{busy?'Luodaan...':'Julkaise haaste'}</button>
    </div>
  </div>;
}

// ── Messages Screen ────────────────────────────────────
function MessagesScreen({ onOpenChat, onCreateChallenge, onOpenArchive }) {
  const { session } = useAuth();
  const uid = session?.user?.id;
  const [convos, setConvos] = React.useState([]);
  const [reqs, setReqs] = React.useState([]);
  const [archivedIds, setArchivedIdsState] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const load = React.useCallback(async () => {
    if (!uid) return;
    try {
      const [nextConvos, { data: rD }] = await Promise.all([
        fetchWebConversations(uid),
        supabase.from('connection_requests').select('id,sender_id,message,created_at,sender:profiles!connection_requests_sender_id_fkey(name,avatar_url,avatar_color)').eq('receiver_id',uid).eq('status','pending').order('created_at',{ascending:false}),
      ]);
      setConvos(nextConvos);
      setReqs((rD||[]).map(r=>({id:r.id,senderId:r.sender_id,message:r.message,senderName:r.sender?.name||'Pelaaja',senderAvatarUrl:r.sender?.avatar_url,senderAvatarColor:r.sender?.avatar_color||'blue'})));
      setArchivedIdsState(getArchivedIds(uid));
    } catch (e) { console.error('Viestien lataus epäonnistui', e); } finally { setLoading(false); }
  }, [uid]);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    if(!uid)return;
    const ch=supabase.channel('msg-web').on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},()=>load()).on('postgres_changes',{event:'*',schema:'public',table:'conversations'},()=>load()).subscribe();
    return ()=>{supabase.removeChannel(ch);};
  }, [load,uid]);
  const accept = async id => { try{await supabase.rpc('accept_connection_request',{request_id_input:id});load();}catch(e){alert(e.message);} };
  const ignore = async id => { try{await supabase.rpc('ignore_connection_request',{request_id_input:id});load();}catch(e){alert(e.message);} };
  const remove = async c => {
    if(!window.confirm(`${c.displayName}-keskustelu poistuu kaikilta osapuolilta. Poistetaanko?`)) return;
    try{ await supabase.rpc('delete_conversation_for_all',{conversation_id_input:c.id}); load(); }
    catch(e){ alert(e.message||'Keskustelua ei voitu poistaa.'); }
  };
  const archive = c => {
    const next=[...new Set([...archivedIds,c.id])];
    setArchivedIdsState(next); saveArchivedIds(uid,next);
  };
  const activeConvos = convos.filter(c=>!archivedIds.includes(c.id));
  if (loading) return <div className="page"><Spinner/></div>;
  if (reqs.length===0 && activeConvos.length===0 && archivedIds.length===0) {
    return <div className="page">
      <div className="empty-hero">
        <img src="assets/no-messages-yet.png" alt="" className="empty-hero-img" />
        <h2 className="empty-hero-title">Ei vielä viestejä.<br/>Muttei hätää!</h2>
        <p className="empty-hero-subtitle">Voit luoda oman haasteen, jonka muut pelaajat näkevät.</p>
        <button className="btn btn-lime btn-lg btn-full" onClick={onCreateChallenge}>Luo oma haaste</button>
      </div>
    </div>;
  }
  return <div className="page">
    <div className="page-header"><h2 className="page-title">Viestit</h2></div>
    {reqs.length>0 && <>
      <h3 style={{color:'var(--lime)',fontSize:14,fontWeight:800,marginBottom:8}}>Uudet pelipyynnöt</h3>
      {reqs.map(r=><div key={r.id} className="card" style={{marginBottom:10}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:6}}><Avatar uri={r.senderAvatarUrl} name={r.senderName} color={r.senderAvatarColor} size={32}/><span style={{color:'var(--ink)',fontWeight:700,fontSize:14}}>{r.senderName}</span></div>
        <p style={{color:'var(--text-muted)',fontSize:13,marginBottom:10,lineHeight:1.4}}>{r.message}</p>
        <div style={{display:'flex',gap:6}}><button className="btn btn-lime btn-sm" style={{flex:1}} onClick={()=>accept(r.id)}>Hyväksy</button><button className="btn btn-outline-w btn-sm" style={{flex:1}} onClick={()=>ignore(r.id)}>Ohita</button></div>
      </div>)}
    </>}
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',margin:'14px 0 6px'}}>
      <h3 style={{color:'var(--lime)',fontSize:14,fontWeight:800}}>Keskustelut</h3>
      <button className="archive-link-btn" onClick={onOpenArchive}><ArchiveIcon/>Arkisto{archivedIds.length>0?` (${archivedIds.length})`:''}</button>
    </div>
    {activeConvos.length===0
      ? <Empty title="Ei keskusteluja vielä. Hyväksytyt pelipyynnöt näkyvät täällä."/>
      : activeConvos.map(c=><div key={c.id} className="msg-row">
          <div className="msg-row-main" onClick={()=>onOpenChat(c)}>
            <Avatar uri={c.otherUserAvatarUrl} name={c.otherUserName} color={c.otherUserAvatarColor} size={42}/>
            <div style={{flex:1,minWidth:0}}><div style={{color:'var(--ink)',fontWeight:700,fontSize:14}}>{c.displayName}</div><div style={{color:'var(--text-muted)',fontSize:12,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.lastMessage||'Aloita keskustelu'}</div></div>
            <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:3}}><span style={{color:'#aaa',fontSize:11}}>{timeAgo(c.updatedAt)}</span>{c.hasUnread&&<span style={{width:8,height:8,borderRadius:'50%',background:'var(--lime)'}}/>}</div>
          </div>
          <div className="msg-row-actions">
            <button className="icon-btn" title="Arkistoi" onClick={()=>archive(c)}><ArchiveIcon/></button>
            <button className="icon-btn" title="Poista" onClick={()=>remove(c)}><TrashIcon/></button>
          </div>
        </div>)}
  </div>;
}

// ── Archived Conversations Screen ───────────────────────
function ArchivedConversationsScreen({ onBack, onOpenChat }) {
  const { session } = useAuth();
  const uid = session?.user?.id;
  const [convos, setConvos] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const load = React.useCallback(async () => {
    if (!uid) return;
    try {
      const all = await fetchWebConversations(uid);
      const ids = new Set(getArchivedIds(uid));
      setConvos(all.filter(c=>ids.has(c.id)));
    } catch (e) { console.error('Arkiston lataus epäonnistui', e); } finally { setLoading(false); }
  }, [uid]);
  React.useEffect(() => { load(); }, [load]);
  const unarchive = c => {
    const next = getArchivedIds(uid).filter(id=>id!==c.id);
    saveArchivedIds(uid,next); setConvos(prev=>prev.filter(x=>x.id!==c.id));
  };
  const remove = async c => {
    if(!window.confirm(`${c.displayName}-keskustelu poistetaan pysyvästi. Jatketaanko?`)) return;
    try {
      await supabase.rpc('delete_conversation_for_all',{conversation_id_input:c.id});
      const next = getArchivedIds(uid).filter(id=>id!==c.id);
      saveArchivedIds(uid,next); setConvos(prev=>prev.filter(x=>x.id!==c.id));
    } catch(e) { alert(e.message||'Keskustelua ei voitu poistaa.'); }
  };
  if (loading) return <div className="page"><Spinner/></div>;
  return <div className="page">
    <div style={{padding:'16px 0 4px'}}><button className="back-btn" onClick={onBack}>← Takaisin</button></div>
    <div className="page-header"><h2 className="page-title">Arkisto</h2></div>
    {convos.length===0
      ? <Empty title="Arkisto on tyhjä."/>
      : convos.map(c=><div key={c.id} className="msg-row">
          <div className="msg-row-main" onClick={()=>onOpenChat(c)}>
            <Avatar uri={c.otherUserAvatarUrl} name={c.otherUserName} color={c.otherUserAvatarColor} size={42}/>
            <div style={{flex:1,minWidth:0}}><div style={{color:'var(--ink)',fontWeight:700,fontSize:14}}>{c.displayName}</div><div style={{color:'var(--text-muted)',fontSize:12,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.lastMessage||'Aloita keskustelu'}</div></div>
          </div>
          <div className="msg-row-actions">
            <button className="icon-btn" title="Palauta" onClick={()=>unarchive(c)}><UndoIcon/></button>
            <button className="icon-btn" title="Poista" onClick={()=>remove(c)}><TrashIcon/></button>
          </div>
        </div>)}
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
  React.useEffect(()=>{if(uid)(async()=>{try{await supabase.rpc('mark_conversation_read',{p_conversation_id:conversation.id,p_user_id:uid});}catch{}})();},[conversation.id,uid,msgs.length]);
  const send = async () => {
    if(!text.trim()||sending)return; setSending(true);
    try{await supabase.from('messages').insert({conversation_id:conversation.id,content:text.trim()});setText('');}catch(e){alert(e.message);}finally{setSending(false);}
  };
  const thumbs = async () => {
    setSending(true);try{await supabase.from('messages').insert({conversation_id:conversation.id,content:JSON.stringify({__type:'thumbs_up'})});}catch(e){alert(e.message);}finally{setSending(false);}
  };
  return <div className="clay-bg" style={{display:'flex',flexDirection:'column',height:'100%'}}>
    <div style={{display:'flex',alignItems:'center',gap:10,padding:'12px 16px',borderBottom:'1px solid var(--border)',flexShrink:0}}>
      <button onClick={onBack} style={{background:'none',border:'none',color:'var(--ink)',cursor:'pointer',fontSize:18,padding:0}}>←</button>
      <Avatar uri={conversation.otherUserAvatarUrl} name={conversation.otherUserName} color={conversation.otherUserAvatarColor} size={36}/>
      <span style={{color:'var(--ink)',fontWeight:700,fontSize:15}}>{conversation.displayName}</span>
    </div>
    <div style={{flex:1,overflowY:'auto',padding:16,display:'flex',flexDirection:'column',gap:6}}>
      {loading?<Spinner/>:msgs.map(m=>{
        const mine=m.senderId===uid;
        let dc=m.content;try{const p=JSON.parse(m.content);if(p.__type==='thumbs_up')dc='👍';if(p.__type==='challenge_join')dc=`${p.joinerName} liittyi peliin!`;}catch{}
        return <div key={m.id} style={{alignSelf:mine?'flex-end':'flex-start'}}>
          {!mine&&conversation.isGroup&&<span style={{fontSize:10,color:'#aaa',marginLeft:4}}>{m.senderName}</span>}
          {m.imageUrl&&<img src={chatImgUrl(m.imageUrl)} alt="" style={{maxWidth:200,borderRadius:10}}/>}
          {dc&&<div className={`chat-bubble ${mine?'chat-mine':'chat-theirs'}`}>{dc}</div>}
        </div>;
      })}
      <div ref={btm}/>
    </div>
    <div style={{display:'flex',gap:8,padding:'10px 16px',borderTop:'1px solid var(--border)',flexShrink:0,alignItems:'center'}}>
      <input className="input input-dark" style={{flex:1,borderRadius:999,padding:'10px 16px'}} placeholder="Kirjoita viesti..." value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}}/>
      {text.trim()?<button className="btn btn-lime" onClick={send} disabled={sending} style={{width:38,height:38,borderRadius:'50%',padding:0}}><svg width="18" height="18" viewBox="0 0 22 22"><path d="M20 2L2 9.5l7 2.5 2.5 7L20 2z" fill="none" stroke="#101a08" strokeWidth="1.8" strokeLinejoin="round"/></svg></button>
      :<button className="btn" onClick={thumbs} disabled={sending} style={{width:38,height:38,borderRadius:'50%',padding:0,fontSize:20,background:'#f4f2ec',border:'1px solid var(--border)'}}>👍</button>}
    </div>
  </div>;
}

// ── Match History ──────────────────────────────────────
const MATCH_GAME_TYPES = [['sets','Erät'],['tiebreak','Tie-break'],['full_match','Kunnon matsi']];

function MatchResultModal({ editingResult, onClose, onSaved }) {
  const [format, setFormat] = React.useState(editingResult?.format || 'singles');
  const [gameType, setGameType] = React.useState(editingResult?.gameType || 'sets');
  const [opponentName, setOpponentName] = React.useState(editingResult?.opponentName || '');
  const [partnerName, setPartnerName] = React.useState(editingResult?.partnerName || '');
  const [oppPartnerName, setOppPartnerName] = React.useState(editingResult?.oppPartnerName || '');
  const [sets, setSets] = React.useState(editingResult?.sets?.length ? editingResult.sets : [{my:0,opp:0}]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const isTiebreak = gameType === 'tiebreak';

  const changeGameType = v => { setGameType(v); setSets([{my:0,opp:0}]); };
  const updateSet = (i,field,v) => {
    const n = Math.max(0, Math.min(99, parseInt(v,10)||0));
    setSets(s=>s.map((row,idx)=>idx===i?{...row,[field]:n}:row));
  };
  const addSet = () => { if (sets.length<5) setSets(s=>[...s,{my:0,opp:0}]); };
  const removeSet = i => { if (sets.length>1) setSets(s=>s.filter((_,idx)=>idx!==i)); };

  const save = async () => {
    setError('');
    const validSets = sets.filter(s=>s.my>0||s.opp>0);
    if (gameType!=='tiebreak' && validSets.length===0) { setError('Syötä vähintään yhden erän tulos.'); return; }
    if (gameType==='tiebreak' && sets[0].my===0 && sets[0].opp===0) { setError('Syötä tie-break tulos.'); return; }
    const finalSets = gameType==='tiebreak' ? sets.slice(0,1) : validSets;
    const won = calculateMatchWon(finalSets);
    setSaving(true);
    try {
      await saveMatchResultWeb(editingResult?.id, { gameType, format, partnerName: format==='doubles'?partnerName||null:null, opponentName: opponentName||null, oppPartnerName: format==='doubles'?oppPartnerName||null:null, sets: finalSets, won });
      onSaved();
    } catch(e) { setError(e.message||'Tuloksen tallennus epäonnistui.'); } finally { setSaving(false); }
  };

  return <div className="modal-overlay" onClick={onClose}>
    <div className="modal-sheet" onClick={e=>e.stopPropagation()}>
      <h3 style={{margin:'0 0 16px',fontSize:18,fontWeight:800,color:'var(--ink)'}}>{editingResult?'Muokkaa tulosta':'Lisää tulos'}</h3>
      {error && <div className="alert alert-error" style={{marginBottom:12}}>{error}</div>}
      <div className="field"><div className="detail-label">Pelimuoto</div><div style={{display:'flex',gap:6}}>
        <button className={`filter-chip ${format==='singles'?'active':''}`} onClick={()=>setFormat('singles')}>Kaksinpeli</button>
        <button className={`filter-chip ${format==='doubles'?'active':''}`} onClick={()=>setFormat('doubles')}>Nelinpeli</button>
      </div></div>
      <div className="field"><div className="detail-label">Pelityyppi</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
        {MATCH_GAME_TYPES.map(([v,l])=><button key={v} className={`filter-chip ${gameType===v?'active':''}`} onClick={()=>changeGameType(v)}>{l}</button>)}
      </div></div>
      <div className="field"><div className="detail-label">Vastustaja</div><input className="input" placeholder="Vastustajan nimi" value={opponentName} onChange={e=>setOpponentName(e.target.value)}/></div>
      {format==='doubles' && <>
        <div className="field"><div className="detail-label">Parisi</div><input className="input" placeholder="Parisi nimi" value={partnerName} onChange={e=>setPartnerName(e.target.value)}/></div>
        <div className="field"><div className="detail-label">Vastustajan pari</div><input className="input" placeholder="Vastustajan parin nimi" value={oppPartnerName} onChange={e=>setOppPartnerName(e.target.value)}/></div>
      </>}
      <div className="field">
        <div className="detail-label">{isTiebreak?'Tie-break tulos':'Erien tulokset'}</div>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {sets.map((s,i)=>
            <div key={i} style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{width:54,fontSize:12,color:'var(--text-muted)',fontWeight:700}}>{isTiebreak?'TB':`Erä ${i+1}`}</span>
              <input className="input" type="number" min="0" max="99" style={{width:60,textAlign:'center'}} value={s.my||''} placeholder="0" onChange={e=>updateSet(i,'my',e.target.value)}/>
              <span style={{color:'var(--text-muted)'}}>–</span>
              <input className="input" type="number" min="0" max="99" style={{width:60,textAlign:'center'}} value={s.opp||''} placeholder="0" onChange={e=>updateSet(i,'opp',e.target.value)}/>
              {!isTiebreak && sets.length>1 && <button onClick={()=>removeSet(i)} style={{background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',fontSize:16}}>✕</button>}
            </div>)}
        </div>
        {!isTiebreak && sets.length<5 && <button className="btn btn-outline-d btn-sm" style={{marginTop:8}} onClick={addSet}>+ Lisää erä</button>}
      </div>
      <div style={{display:'flex',gap:8,marginTop:16}}>
        <button className="btn btn-outline-d btn-md" onClick={onClose}>Peruuta</button>
        <button className="btn btn-dark btn-lg" style={{flex:1}} onClick={save} disabled={saving}>{saving?'Tallennetaan...':editingResult?'Tallenna muutokset':'Tallenna tulos'}</button>
      </div>
    </div>
  </div>;
}

function MatchResultCard({ result, onEdit, onDelete }) {
  const gameTypeLabel = result.gameType==='sets'?'Erät':result.gameType==='tiebreak'?'Tie-break':'Kunnon matsi';
  const formatLabel = result.format==='singles'?'Kaksinpeli':'Nelinpeli';
  const date = new Date(result.createdAt);
  const dateText = `${date.getDate()}.${date.getMonth()+1}.${date.getFullYear()}`;
  const totalMy = result.sets.reduce((sum,s)=>sum+s.my,0);
  const totalOpp = result.sets.reduce((sum,s)=>sum+s.opp,0);
  const isDraw = totalMy===totalOpp;
  const outcomeLabel = isDraw?'Tasapeli':result.won?'Voitto':'Tappio';
  const outcomeColor = isDraw?'#8a7f5c':result.won?'#2d7a4d':'var(--danger)';
  const outcomeBg = isDraw?'#f4f0e2':result.won?'rgba(70,166,109,0.1)':'rgba(161,59,47,0.1)';
  const myLabel = result.format==='doubles' && result.partnerName ? `Sinä & ${result.partnerName}` : 'Sinä';
  const oppLabel = result.format==='doubles' && result.oppPartnerName ? `${result.opponentName||'Vastustaja'} & ${result.oppPartnerName}` : (result.opponentName||'Vastustaja');
  return <div className="card">
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8,flexWrap:'wrap',gap:6}}>
      <span className="chip" style={{background:outcomeBg,color:outcomeColor,fontWeight:700}}>{outcomeLabel}</span>
      <span style={{fontSize:12,color:'var(--text-muted)'}}>{formatLabel} · {gameTypeLabel}</span>
      <span style={{fontSize:11,color:'#aaa'}}>{dateText}</span>
    </div>
    <div style={{display:'flex',flexDirection:'column',gap:4,marginBottom:10}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:10,fontWeight:!isDraw&&result.won?700:500,color:!isDraw&&result.won?'#2d7a4d':'var(--ink)'}}>
        <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{myLabel}</span><span style={{display:'flex',gap:10,flexShrink:0}}>{result.sets.map((s,i)=><span key={i}>{s.my}</span>)}</span>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',gap:10,fontWeight:!isDraw&&!result.won?700:500,color:!isDraw&&!result.won?'var(--danger)':'var(--ink)'}}>
        <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{oppLabel}</span><span style={{display:'flex',gap:10,flexShrink:0}}>{result.sets.map((s,i)=><span key={i}>{s.opp}</span>)}</span>
      </div>
    </div>
    <div style={{display:'flex',gap:6}}>
      <button className="btn btn-outline-d btn-sm" style={{flex:1}} onClick={onEdit}>Muokkaa</button>
      <button className="btn btn-outline-d btn-sm" style={{flex:1,color:'var(--danger)'}} onClick={onDelete}>Poista</button>
    </div>
  </div>;
}

function MatchHistorySection() {
  const [results, setResults] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const load = React.useCallback(async () => {
    try { setResults(await fetchMatchResultsWeb()); } catch(e){ console.error('Pelihistorian lataus epäonnistui', e); } finally { setLoading(false); }
  }, []);
  React.useEffect(()=>{ load(); }, [load]);
  const remove = async (id) => {
    if(!window.confirm('Haluatko poistaa tämän tuloksen?')) return;
    try { await deleteMatchResultWeb(id); load(); } catch(e){ alert(e.message||'Tulosta ei voitu poistaa.'); }
  };
  return <>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',margin:'20px 0 8px'}}>
      <h3 style={{fontSize:13,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:0.5}}>Pelihistoria</h3>
      <button className="btn btn-outline-d btn-sm" onClick={()=>{setEditing(null);setModalOpen(true);}}>+ Lisää tulos</button>
    </div>
    {loading ? <Spinner/> : results.length===0
      ? <div className="card" style={{marginBottom:14,color:'var(--text-muted)',fontSize:13}}>Pelihistoria tulee tähän, kun matseja pelataan.</div>
      : <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:14}}>
          {results.map(r => <MatchResultCard key={r.id} result={r} onEdit={()=>{setEditing(r);setModalOpen(true);}} onDelete={()=>remove(r.id)}/>)}
        </div>}
    {modalOpen && <MatchResultModal editingResult={editing} onClose={()=>setModalOpen(false)} onSaved={()=>{setModalOpen(false);load();}}/>}
  </>;
}

// ── Profile (full page) ────────────────────────────────
const HANDEDNESS = ['oikeakätinen','vasenkätinen'];
const BACKHAND_TYPES = ['yhden käden','kahden käden'];

function ProfileFullScreen() {
  const { session, profile, refreshProfile } = useAuth();
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState('');
  const [identities, setIdentities] = React.useState([]);

  React.useEffect(() => {
    if(profile&&!form) setForm({
      nimi:profile.nimi,ika:profile.ika,sukupuoli:profile.sukupuoli||'',
      alue:profile.alue,pelitaso:profile.pelitaso,pelimuoto:profile.pelimuoto,
      saatavuus:profile.saatavuus,bio:profile.bio||'',
      katisyys:profile.katisyys||'',rysty:profile.rysty||'',
      hiddenFromFeed:profile.hiddenFromFeed,
    });
  }, [profile,form]);

  React.useEffect(() => {
    supabase.auth.getUser().then(({data})=>{
      setIdentities((data?.user?.identities||[]).map(i=>i.provider));
    });
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const uid=session.user.id;
      await supabase.from('profiles').upsert({id:uid,name:form.nimi.trim(),age:form.ika,gender:form.sukupuoli||null,area:form.alue.join(', '),bio:form.bio.trim()||null,hidden_from_feed:form.hiddenFromFeed});
      await supabase.from('tennis_preferences').upsert({user_id:uid,skill_level:form.pelitaso.join(','),play_style:form.pelimuoto.join(', '),handedness:form.katisyys||null,backhand_type:form.rysty||null});
      await supabase.from('availability').delete().eq('user_id',uid);
      if(form.saatavuus.length>0) await supabase.from('availability').insert(form.saatavuus.map(s=>({user_id:uid,slot:s})));
      await refreshProfile(); setEditing(false); setForm(null);
      setToast('Profiili päivitetty!'); setTimeout(()=>setToast(''),2500);
    } catch(e){alert(e.message);}finally{setBusy(false);}
  };

  const toggleHidden = async () => {
    await supabase.from('profiles').update({hidden_from_feed:!profile.hiddenFromFeed}).eq('id',session.user.id);
    refreshProfile();
  };

  const signOut = ()=>supabase.auth.signOut();
  if(!profile) return <div className="page"><Spinner/></div>;
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const tog=(k,v)=>setForm(p=>({...p,[k]:p[k].includes(v)?p[k].filter(x=>x!==v):[...p[k],v]}));

  const SectionTitle = ({children})=><h3 style={{fontSize:13,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:0.5,margin:'20px 0 8px'}}>{children}</h3>;
  const SettingsRow = ({label,value,onClick,danger,valueColor})=>(
    <button onClick={onClick} style={{display:'flex',alignItems:'center',justifyContent:'space-between',width:'100%',padding:'12px 16px',background:'#fff',border:'1px solid var(--border)',borderRadius:12,cursor:'pointer',fontFamily:'inherit',fontSize:14,color:danger?'var(--danger)':'var(--ink)',fontWeight:500,marginBottom:6,textAlign:'left'}}>
      <span>{label}</span>
      <span style={{color:valueColor||'var(--text-muted)',fontSize:13,fontWeight:valueColor?700:400}}>{value||'→'}</span>
    </button>
  );

  if(editing&&form) return <div className="page" style={{paddingBottom:40}}>
    <div className="page-header"><h2 className="page-title">Muokkaa profiilia</h2><button className="btn btn-outline-d btn-sm" onClick={()=>{setEditing(false);setForm(null);}}>Peruuta</button></div>
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div className="field"><div className="detail-label">Nimi</div><input className="input input-dark" value={form.nimi} onChange={e=>set('nimi',e.target.value)}/></div>
      <div className="field"><div className="detail-label">Ikä</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{AGE_RANGES.map(r=><button key={r.value} className={`filter-chip ${form.ika===r.value?'active':''}`} onClick={()=>set('ika',r.value)}>{r.label}</button>)}</div></div>
      <div className="field"><div className="detail-label">Bio</div><textarea className="input input-dark" rows={3} value={form.bio} onChange={e=>set('bio',e.target.value)}/></div>
      <div className="field"><div className="detail-label">Sukupuoli</div><div style={{display:'flex',gap:6}}>{['mies','nainen'].map(g=><button key={g} className={`filter-chip ${form.sukupuoli===g?'active':''}`} onClick={()=>set('sukupuoli',form.sukupuoli===g?'':g)}>{titleCase(g)}</button>)}</div></div>
      <div className="field"><div className="detail-label">Kotikaupunki</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{VISIBLE_AREAS.map(a=><button key={a} className={`filter-chip ${form.alue.includes(a)?'active':''}`} onClick={()=>tog('alue',a)}>{a}</button>)}</div></div>
      <div className="field"><div className="detail-label">Pelitaso</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{PLAIN_SKILL_LEVELS.map(l=><button key={l} className={`filter-chip ${form.pelitaso.includes(l)?'active':''}`} onClick={()=>tog('pelitaso',l)}>{titleCase(l)}</button>)}</div></div>
      <div className="field"><div className="detail-label">Pelimuoto</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{PLAY_STYLES.map(s=><button key={s} className={`filter-chip ${form.pelimuoto.includes(s)?'active':''}`} onClick={()=>tog('pelimuoto',s)}>{titleCase(s)}</button>)}</div></div>
      <div className="field"><div className="detail-label">Kätisyys</div><div style={{display:'flex',gap:6}}>{HANDEDNESS.map(h=><button key={h} className={`filter-chip ${form.katisyys===h?'active':''}`} onClick={()=>set('katisyys',form.katisyys===h?'':h)}>{titleCase(h)}</button>)}</div></div>
      <div className="field"><div className="detail-label">Rysty</div><div style={{display:'flex',gap:6}}>{BACKHAND_TYPES.map(b=><button key={b} className={`filter-chip ${form.rysty===b?'active':''}`} onClick={()=>set('rysty',form.rysty===b?'':b)}>{titleCase(b)}</button>)}</div></div>
      <div className="field"><div className="detail-label">Sopivat ajankohdat</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{AVAILABILITY_SLOTS.map(s=><button key={s.value} className={`filter-chip ${form.saatavuus.includes(s.value)?'active':''}`} onClick={()=>tog('saatavuus',s.value)}>{s.label}</button>)}</div></div>
      <div className="field"><div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}><span style={{fontSize:14,fontWeight:600,color:'var(--ink)'}}>Piilota profiilini pelaajasyötteestä</span><button onClick={()=>set('hiddenFromFeed',!form.hiddenFromFeed)} style={{width:48,height:28,borderRadius:14,border:'none',padding:2,cursor:'pointer',background:form.hiddenFromFeed?'var(--green-deep)':'#ccc',transition:'background .2s',position:'relative',flexShrink:0}}><span style={{display:'block',width:24,height:24,borderRadius:'50%',background:'#fff',boxShadow:'0 1px 3px rgba(0,0,0,.2)',transition:'transform .2s',transform:form.hiddenFromFeed?'translateX(20px)':'translateX(0)'}}/></button></div></div>
      <button className="btn btn-dark btn-lg btn-full" onClick={save} disabled={busy}>{busy?'Tallennetaan...':'Tallenna muutokset'}</button>
    </div>
  </div>;

  return <div className="page" style={{paddingBottom:40}}>
    <div className="page-header"><h2 className="page-title">Profiili</h2><button className="btn btn-outline-d btn-sm" onClick={()=>setEditing(true)}>Muokkaa profiilia</button></div>
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,marginBottom:24}}>
      <Avatar uri={profile.avatarUrl} name={profile.nimi} color={profile.avatarColor} size={76}/>
      <h3 style={{color:'var(--ink)',fontWeight:800,fontSize:20,margin:0}}>{profile.nimi}, {ageRangeLabel(profile.ika)}</h3>
      {profile.bio&&<p style={{color:'var(--text-muted)',fontSize:13,textAlign:'center'}}>{profile.bio}</p>}
    </div>
    <div style={{display:'flex',gap:8,justifyContent:'center',marginBottom:16}}>{profile.alue.map(a=><span key={a} className="sidebar-area">{a}</span>)}</div>
    <div style={{display:'flex',gap:10,marginBottom:14}}>
      <div className="card" style={{flex:1,textAlign:'center'}}><div style={{color:'var(--text-muted)',fontSize:10,fontWeight:700,textTransform:'uppercase',marginBottom:3}}>Pelitaso</div><div style={{color:'var(--ink)',fontWeight:700,fontSize:15}}>{formatSkillLevels(profile.pelitaso)}</div></div>
      <div className="card" style={{flex:1,textAlign:'center'}}><div style={{color:'var(--text-muted)',fontSize:10,fontWeight:700,textTransform:'uppercase',marginBottom:3}}>Pelimuoto</div><div style={{color:'var(--ink)',fontWeight:700,fontSize:15}}>{profile.pelimuoto.map(titleCase).join(', ')}</div></div>
    </div>
    {profile.saatavuus.length>0&&<div className="card" style={{marginBottom:14}}><div style={{color:'var(--text-muted)',fontSize:10,fontWeight:700,textTransform:'uppercase',marginBottom:6}}>Ajankohdat</div>{profile.saatavuus.map(s=><div key={s} style={{color:'var(--ink)',fontSize:13,padding:'2px 0'}}>{slotLabel(s)}</div>)}</div>}
    {(profile.katisyys||profile.rysty)&&<div className="card" style={{marginBottom:14}}><div style={{color:'var(--text-muted)',fontSize:10,fontWeight:700,textTransform:'uppercase',marginBottom:6}}>Tyyli</div>{profile.katisyys&&<div style={{color:'var(--ink)',fontSize:13,padding:'2px 0'}}>{titleCase(profile.katisyys)}</div>}{profile.rysty&&<div style={{color:'var(--ink)',fontSize:13,padding:'2px 0'}}>{titleCase(profile.rysty)} rysty</div>}</div>}

    <MatchHistorySection/>

    <SectionTitle>Asetukset</SectionTitle>
    <SettingsRow label="Piilota profiili feedistä" value={profile.hiddenFromFeed?'Päällä':'Pois'} valueColor={profile.hiddenFromFeed?'#2d7a4d':'#c0392b'} onClick={toggleHidden}/>

    <SectionTitle>Kirjautumistavat</SectionTitle>
    <div className="card" style={{marginBottom:6}}>
      <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:8}}>Linkitetyt tilit</div>
      {['google','apple','email'].map(p=>{
        const linked = p==='email' || identities.includes(p);
        return <div key={p} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid #f0ede6'}}>
          <span style={{fontSize:14,fontWeight:600,color:'var(--ink)'}}>{p==='google'?'Google':p==='apple'?'Apple':'Sähköposti'}</span>
          <span style={{fontSize:12,fontWeight:600,color:linked?'#2d7a4d':'var(--text-muted)'}}>{linked?'Linkitetty':'Ei linkitetty'}</span>
        </div>;
      })}
    </div>

    <SectionTitle>Muut</SectionTitle>
    <SettingsRow label="Estetyt profiilit" onClick={()=>alert('Estetyt profiilit -näkymä tulossa.')}/>
    <SettingsRow label="Ota yhteyttä tukeen" onClick={()=>window.open('mailto:eelispuro@gmail.com')}/>
    <button className="btn btn-outline-d btn-md btn-full" onClick={signOut} style={{marginTop:16}}>Kirjaudu ulos</button>
    <Toast show={!!toast} text={toast}/>
  </div>;
}

// ── Top Nav ────────────────────────────────────────────
function TopNav({ tab, setTab }) {
  const { profile } = useAuth();
  const links = [
    { id: 'players', label: 'Pelaajat', icon: 'assets/ball-tight.png' },
    { id: 'challenges', label: 'Avoimet', icon: 'assets/avoimet-tight.png' },
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
  const showSidebar = tab === 'players' || tab === 'challenges' || tab === 'messages';
  const showFullPage = screen.type !== 'tab';

  if (screen.type === 'playerDetail') return <div className="app-shell"><TopNav tab={tab} setTab={t=>{setTab(t);setScreen({type:'tab'});}}/><div className="app-body"><div className="app-full clay-bg"><PlayerDetail player={screen.player} onBack={back} currentUserId={session?.user?.id}/></div></div></div>;
  if (screen.type === 'challengeDetail') return <div className="app-shell"><TopNav tab={tab} setTab={t=>{setTab(t);setScreen({type:'tab'});}}/><div className="app-body"><div className="app-full clay-bg"><ChallengeDetail challenge={screen.challenge} onBack={back} currentUserId={session?.user?.id}/></div></div></div>;
  if (screen.type === 'createChallenge') return <div className="app-shell"><TopNav tab={tab} setTab={t=>{setTab(t);setScreen({type:'tab'});}}/><div className="app-body"><div className="app-full"><CreateChallengeScreen onBack={back} onCreated={()=>{back();setTab('challenges');}}/></div></div></div>;
  if (screen.type === 'chat') return <div className="app-shell"><TopNav tab={tab} setTab={t=>{setTab(t);setScreen({type:'tab'});}}/><div className="app-body"><div className="app-full" style={{display:'flex',flexDirection:'column'}}><ChatScreen conversation={screen.conversation} onBack={back}/></div></div></div>;
  if (screen.type === 'archive') return <div className="app-shell"><TopNav tab={tab} setTab={t=>{setTab(t);setScreen({type:'tab'});}}/><div className="app-body"><div className="app-full"><ArchivedConversationsScreen onBack={back} onOpenChat={c => setScreen({ type: 'chat', conversation: c })}/></div></div></div>;

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
          {tab === 'messages' && <MessagesScreen onOpenChat={c => setScreen({ type: 'chat', conversation: c })} onCreateChallenge={() => setScreen({ type: 'createChallenge' })} onOpenArchive={() => setScreen({ type: 'archive' })} />}
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
