// krossi-web-app.jsx — Browser-based Krossi with desktop layout
// Uses same Supabase project as the mobile app

const SUPABASE_URL = 'https://hhybjpgrvlbazbqiaaao.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_IKLRGbstMLfxKeXwBTavSA_UVYyMgTL';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
});

// ── Constants ──────────────────────────────────────────
const AREA_OPTIONS = ['Lahti', 'Turku', 'Helsinki', 'Tampere', 'Oulu', 'Jyväskylä', 'Pori', 'Kuopio', 'Rovaniemi', 'Mikkeli'];
const VISIBLE_AREAS = AREA_OPTIONS;
const PLAIN_SKILL_LEVELS = ['aloittelija', 'keskitaso', 'edistynyt', 'kilpapelaaja'];
const PLAY_STYLES = ['pallottelu', 'treenit', 'matsit', 'kaksinpeli', 'nelinpeli', 'kaikki käy'];
const MATCH_TYPES = ['kaksinpeli', 'nelinpeli', 'pallottelu'];
const GENDERS = ['mies', 'nainen'];
const COURT_SURFACES = ['kova', 'massa', 'nurmi', 'asfaltti'];
const CHALLENGE_DURATION_HOURS = 3; // haaste vanhenee feedistä tämän jälkeen sovitusta ajankohdasta
const OPEN_CHALLENGE_TTL_HOURS = 48; // "aika avoin" -haasteille, joilla ei ole kellonaikaa
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
function ageRangeLabel(v) {
  if (!v) return '';
  if (/^\d{2,3}$/.test(v)) return `${v} v`;
  const r = AGE_RANGES.find(a => a.value === v);
  return r ? r.label : v;
}
function profileNameWithAge(profile) {
  const age = ageRangeLabel(profile?.ika);
  return `${profile?.nimi || 'Pelaaja'}${age ? `, ${age}` : ''}`;
}
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
// Muiden osallistujien profiilit tuoreena — kutsuja ei luota conversation-olion
// mahdollisesti puuttuvaan/vanhaan participantProfiles-listaan.
async function fetchConversationParticipants(conversationId, uid) {
  const { data } = await supabase.from('conversation_participants')
    .select('user_id,profile:profiles!conversation_participants_user_id_fkey(id,name,avatar_url,avatar_color)')
    .eq('conversation_id', conversationId);
  return (data||[]).filter(p=>p.user_id!==uid && p.profile)
    .map(p=>({ userId:p.profile.id, name:p.profile.name, avatarUrl:p.profile.avatar_url, avatarColor:p.profile.avatar_color||'blue' }));
}
async function fetchPlayerProfile(id) {
  const { data, error } = await supabase.from('profiles').select(PROFILE_SELECT).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapProfile(data) : null;
}
function mapMatchResult(row) {
  return { id:row.id, createdAt:row.created_at, gameType:row.game_type, format:row.format, partnerName:row.partner_name, opponentName:row.opponent_name, oppPartnerName:row.opp_partner_name, sets:row.sets||[], won:row.won };
}
async function fetchMatchResultsWeb() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  // created_by-rajaus on pakollinen: match_results on luettavissa kaikille kirjautuneille,
  // jotta ottelut näkyvät myös toisen pelaajan profiilissa.
  const { data, error } = await supabase.from('match_results').select('*').eq('created_by',user.id).order('created_at',{ascending:false}).limit(50);
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
// Hauskoja lisätilastoja profiiliin: voitot/häviöt pelihistoriasta, järkätyt
// pelit (luodut haasteet) ja pelatut pelit (haasteet joiden lopputulos on 'played').
async function fetchPlayerStatsWeb() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { organized: 0, played: 0 };
  const uid = user.id;
  const [{ count: organized }, { data: joinedRows }, { count: createdPlayed }] = await Promise.all([
    supabase.from('challenges').select('id', { count: 'exact', head: true }).eq('creator_id', uid),
    supabase.from('challenge_participants').select('challenge:challenges!challenge_participants_challenge_id_fkey(id,outcome)').eq('user_id', uid),
    supabase.from('challenges').select('id', { count: 'exact', head: true }).eq('creator_id', uid).eq('outcome', 'played'),
  ]);
  const joinedPlayedIds = new Set((joinedRows || []).filter(r => r.challenge?.outcome === 'played').map(r => r.challenge.id));
  return { organized: organized || 0, played: (createdPlayed || 0) + joinedPlayedIds.size };
}
// ── Push-ilmoitukset ───────────────────────────────────
// Sama send-push-notification -edge function ja sama tapahtumamuoto kuin
// mobiilisovelluksen triggerPushNotification (src/services/notifications.ts).
// Ilman näitä webistä lähetetty viesti tai luotu haaste ei ilmoittanut
// mobiilikäyttäjälle mitään. Vastaanottajien valinta ja käyttäjän
// ilmoitusasetusten kunnioittaminen tapahtuu edge functionissa.
async function triggerPush(event) {
  try {
    const { error } = await supabase.functions.invoke('send-push-notification', { body: event });
    if (error) console.warn('Push-ilmoituksen lähetys epäonnistui', error);
  } catch (err) {
    // Push ei saa koskaan kaataa itse toimintoa, joka onnistui jo.
    console.warn('Push-ilmoituksen lähetys epäonnistui', err);
  }
}

// ── Esto, ilmoitukset ja tilin poisto ──────────────────
async function fetchBlockedIds(uid) {
  if (!uid) return new Set();
  const { data } = await supabase.from('blocked_profiles').select('blocked_id').eq('blocker_id', uid);
  return new Set((data || []).map(r => r.blocked_id));
}
async function fetchBlockedProfiles(uid) {
  const { data, error } = await supabase
    .from('blocked_profiles')
    .select('id,blocked_id,created_at,profile:profiles!blocked_profiles_blocked_id_fkey(name,avatar_url,avatar_color)')
    .eq('blocker_id', uid).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(r => ({
    rowId: r.id, userId: r.blocked_id, name: r.profile?.name || 'Pelaaja',
    avatarUrl: r.profile?.avatar_url, avatarColor: r.profile?.avatar_color || 'blue',
  }));
}
async function blockProfile(uid, blockedId) {
  const { error } = await supabase.from('blocked_profiles').insert({ blocker_id: uid, blocked_id: blockedId });
  // uniikkirajoite: jo estetty -> ei virhettä käyttäjälle
  if (error && !String(error.message || '').includes('duplicate')) throw error;
}
async function unblockProfile(rowId) {
  const { error } = await supabase.from('blocked_profiles').delete().eq('id', rowId);
  if (error) throw error;
}
// Liitetään ilmoitukseen yhteinen keskustelu jos sellainen on, jotta
// ilmoituksen käsittelijä näkee kontekstin.
async function findSharedConversationId(uid, otherId) {
  const { data: mine } = await supabase.from('conversation_participants').select('conversation_id').eq('user_id', uid);
  const ids = (mine || []).map(r => r.conversation_id);
  if (ids.length === 0) return null;
  const { data: shared } = await supabase.from('conversation_participants')
    .select('conversation_id').eq('user_id', otherId).in('conversation_id', ids).limit(1);
  return shared?.[0]?.conversation_id || null;
}
async function reportProfile(uid, reportedId, reason) {
  const conversationId = await findSharedConversationId(uid, reportedId).catch(() => null);
  const { data, error } = await supabase.from('reports').insert({
    reporter_id: uid, reported_id: reportedId, reason: reason.trim(), conversation_id: conversationId,
  }).select('id').single();
  if (error) throw error;
  // Ilmoitus menee pushina ylläpidolle — reports-taulua ei voi lukea sovelluksesta.
  if (data?.id) triggerPush({ type:'account_report', reportId:data.id, reporterId:uid, reportedId });
}
async function deleteOwnAccount() {
  const { error } = await supabase.functions.invoke('delete-account', { body: {} });
  if (error) throw error;
  await supabase.auth.signOut();
}

async function recordChallengeOutcome(challengeId, outcome) {
  // Suora UPDATE ei mene läpi: challenges-taulun UPDATE-policy vaatii status = 'cancelled'.
  // record_challenge_outcome on SECURITY DEFINER -RPC, joka sallii vastauksen sekä
  // haasteen luojalle että osallistujille.
  const { error } = await supabase.rpc('record_challenge_outcome', {
    challenge_id_input: challengeId,
    outcome_input: outcome,
  });
  if (error) throw error;
}
// Haaste on "ohi" kun päättymisaika on mennyt. Osalla haasteista ei ole
// expires_at-arvoa lainkaan, jolloin peliaika ratkaisee — muuten niistä ei
// koskaan kysyttäisi lopputulosta.
function challengeIsPast(c, nowIso) {
  if (c.expires_at) return c.expires_at < nowIso;
  if (c.scheduled_at) return c.scheduled_at < nowIso;
  return false;
}
async function fetchPendingOutcomeChallenges(uid) {
  const nowIso = new Date().toISOString();
  const cols = 'id,creator_id,location,location_type,scheduled_at,expires_at,match_type,title';
  const [{ data: created }, { data: joinedRows }] = await Promise.all([
    supabase.from('challenges').select(cols).eq('creator_id', uid).in('status', ['open', 'filled']).is('outcome', null),
    supabase.from('challenge_participants').select(`challenge:challenges!challenge_participants_challenge_id_fkey(${cols},status,outcome)`).eq('user_id', uid),
  ]);
  const mine = (created || []).filter(c => challengeIsPast(c, nowIso));
  const joined = (joinedRows || []).map(r => r.challenge).filter(c => c && ['open', 'filled'].includes(c.status) && c.outcome == null && challengeIsPast(c, nowIso));
  const merged = new Map();
  [...mine, ...joined].forEach(c => merged.set(c.id, c));
  const list = [...merged.values()];
  if (list.length === 0) return [];
  const ids = list.map(c => c.id);
  const creatorIds = [...new Set(list.map(c => c.creator_id))];
  const [{ data: pR }, { data: cR }] = await Promise.all([
    supabase.from('challenge_participants').select('challenge_id,user_id,profile:profiles!challenge_participants_user_id_fkey(name,avatar_url,avatar_color)').in('challenge_id', ids),
    supabase.from('profiles').select('id,name,avatar_url,avatar_color').in('id', creatorIds),
  ]);
  const cm = new Map(); (cR || []).forEach(c => cm.set(c.id, c));
  const pm = new Map(); (pR || []).forEach(p => { const a = pm.get(p.challenge_id) || []; if (p.profile) a.push({ userId: p.user_id, name: p.profile.name, avatarUrl: p.profile.avatar_url, avatarColor: p.profile.avatar_color || 'blue' }); pm.set(p.challenge_id, a); });
  return list.map(c => {
    const creator = cm.get(c.creator_id);
    return {
      id: c.id, location: c.location, locationType: c.location_type, scheduledAt: c.scheduled_at, matchType: c.match_type, title: c.title,
      creatorId: c.creator_id, creatorName: creator?.name || 'Pelaaja', creatorAvatarUrl: creator?.avatar_url, creatorAvatarColor: creator?.avatar_color || 'blue',
      participants: pm.get(c.id) || [],
    };
  });
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
    paidAt: d.paid_at || null,
  };
}
const PROFILE_SELECT = 'id, name, age, gender, area, bio, avatar_url, avatar_color, playing_this_week, hidden_from_feed, paid_at, tennis_preferences(skill_level, play_style, handedness, backhand_type), availability(slot)';

// ── Maksumuuri (Stripe) ─────────────────────────────────
async function startCheckout() {
  try {
    const { data, error } = await supabase.functions.invoke('stripe-checkout', { method: 'POST' });
    if (error) throw error;
    if (data?.url) { window.location.href = data.url; return; }
    if (data?.error) { alert(data.error); return; }
    throw new Error('unexpected response');
  } catch (err) { console.error('Maksun aloitus epäonnistui', err); alert('Maksun aloitus epäonnistui. Yritä hetken päästä uudelleen.'); }
}
function PaywallModal({ onClose }) {
  const [starting, setStarting] = React.useState(false);
  const pay = async () => { setStarting(true); await startCheckout(); setStarting(false); };
  return <div className="modal-overlay">
    <div className="modal-sheet" style={{ position:'relative', textAlign:'center' }}>
      <button className="icon-btn" onClick={onClose} aria-label="Sulje" style={{ position:'absolute', top:16, right:16, fontSize:18 }}>✕</button>
      <div style={{ fontSize:32, marginBottom:8 }}>🎾</div>
      <h3 style={{ margin:'0 0 8px', fontSize:19, fontWeight:800, color:'var(--ink)' }}>Kokeile Krossin täyttä versiota</h3>
      <p style={{ margin:'0 0 20px', fontSize:13, color:'var(--text-muted)', lineHeight:1.5 }}>Näet muiden pelaajien profiilit, voit liittyä haasteisiin ja luoda omia. Maksa vain kerran — ei tilausta, ei toistuvaa laskutusta.</p>
      <button className="btn btn-lime btn-lg btn-full" disabled={starting} onClick={pay}>{starting?'Avataan maksua...':'Maksa 8,99 € — pelit voi alkaa!'}</button>
    </div>
  </div>;
}

// ── Confirm modal (replaces window.confirm) ─────────────
function ConfirmModal({ title, message, confirmLabel='Vahvista', cancelLabel='Peruuta', danger=false, busy=false, onConfirm, onCancel }) {
  return <div className="modal-overlay" onClick={busy?undefined:onCancel}>
    <div className="modal-sheet" style={{ maxWidth:380 }} onClick={e=>e.stopPropagation()}>
      <h3 style={{ margin:'0 0 8px', fontSize:17, fontWeight:800, color:'var(--ink)' }}>{title}</h3>
      <p style={{ margin:'0 0 18px', fontSize:14, color:'var(--text-muted)', lineHeight:1.5 }}>{message}</p>
      <div style={{ display:'flex', gap:8 }}>
        <button className="btn btn-outline-d btn-md" style={{ flex:1 }} onClick={onCancel} disabled={busy}>{cancelLabel}</button>
        <button className={`btn ${danger?'btn-danger':'btn-dark'} btn-md`} style={{ flex:1 }} onClick={onConfirm} disabled={busy}>{busy?'Hetki...':confirmLabel}</button>
      </div>
    </div>
  </div>;
}

// ── Filter modal (shared shell for list filters) ────────
function FilterModal({ title, onClose, onClear, children }) {
  return <div className="modal-overlay" onClick={onClose}>
    <div className="modal-sheet" onClick={e=>e.stopPropagation()}>
      <h3 style={{ margin:'0 0 14px', fontSize:17, fontWeight:800, color:'var(--ink)' }}>{title}</h3>
      {children}
      <div style={{ display:'flex', gap:8, marginTop:18 }}>
        <button className="btn btn-outline-d btn-md" style={{ flex:1 }} onClick={onClear}>Tyhjennä</button>
        <button className="btn btn-lime btn-md" style={{ flex:1 }} onClick={onClose}>Valmis</button>
      </div>
    </div>
  </div>;
}

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
function FilterIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16M7 12h10M11 19h2" /></svg>; }
function BackArrowIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>; }
function ChevronRightIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>; }
function UsersIcon({ size = 12 }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>; }
function Toggle({ on, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!on)} style={{ width: 48, height: 28, borderRadius: 14, border: 'none', padding: 2, cursor: 'pointer', background: on ? 'var(--green-deep)' : 'var(--border)', position: 'relative', flexShrink: 0, transition: 'background .2s' }}>
      <span style={{ display: 'block', width: 24, height: 24, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.2)', transition: 'transform .2s', transform: on ? 'translateX(20px)' : 'translateX(0)' }} />
    </button>
  );
}
function AvatarPicker({ preview, onPick }) {
  const inputRef = React.useRef(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div className="hover-lift" onClick={() => inputRef.current?.click()} style={{ position: 'relative', cursor: 'pointer', width: 88, height: 88, borderRadius: '50%' }}>
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
  const [showTerms, setShowTerms] = React.useState(false);
  const [showPrivacy, setShowPrivacy] = React.useState(false);
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
    e.preventDefault(); setError(''); setInfo(''); setBusy(true);
    try {
      if (mode === 'login') { const { error } = await supabase.auth.signInWithPassword({ email, password: pw }); if (error) throw error; }
      else if (mode === 'register') {
        if (pw.length < 8) throw new Error('Salasanan pitää olla vähintään 8 merkkiä.');
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
    width:'100%', padding:'12px 16px', borderRadius:12, border:'1px solid var(--border)',
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
        <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800 }}>
          {mode === 'login' ? 'Kirjaudu sisään' : mode === 'register' ? 'Luo tili' : 'Palauta salasana'}
        </h2>
        {mode === 'register' && (
          <p style={{ margin:'0 0 16px', fontSize:12.5, color:'var(--text-muted)', lineHeight:1.5 }}>
            Luomalla tilin hyväksyt Krossin{' '}
            <button type="button" onClick={() => setShowTerms(true)} style={{ background:'none', border:'none', padding:0, color:'var(--green-deep)', fontWeight:700, cursor:'pointer', fontFamily:'inherit', fontSize:'inherit', textDecoration:'underline' }}>käyttöehdot</button>
            {' '}ja{' '}
            <button type="button" onClick={() => setShowPrivacy(true)} style={{ background:'none', border:'none', padding:0, color:'var(--green-deep)', fontWeight:700, cursor:'pointer', fontFamily:'inherit', fontSize:'inherit', textDecoration:'underline' }}>tietosuojaselosteen</button>.
          </p>
        )}
        {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
        {info && <div className="alert alert-success" style={{ marginBottom: 12 }}>{info}</div>}

        {mode !== 'reset' && (
          <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:16 }}>
            <button className="hover-lift" style={oauthBtnStyle} onClick={signInWithGoogle} disabled={busy}>
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.0 24.0 0 0 0 0 21.56l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              Jatka Googlella
            </button>
            <button className="hover-lift" style={oauthBtnStyle} onClick={signInWithApple} disabled={busy}>
              <svg width="16" height="20" viewBox="0 0 20 24" fill="#111"><path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.7-3-2-3.7-2-1.6-.2-3 .9-3.8.9s-2-.9-3.3-.9c-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.5 1.3-.1 1.8-.8 3.3-.8s2 .8 3.3.8c1.4 0 2.2-1.2 3.1-2.5.7-1 1-2 1-2-.1 0-2-.8-2-3.3zM13.9 3.5c.7-.9 1.2-2.1 1-3.3-1 0-2.3.7-3 1.5-.7.8-1.3 2-1.1 3.2 1.1.1 2.3-.6 3.1-1.4z"/></svg>
              Jatka Applella
            </button>
          </div>
        )}

        {mode !== 'reset' && (
          <div style={{ display:'flex', alignItems:'center', gap:12, margin:'0 0 14px' }}>
            <div style={{ flex:1, height:1, background:'var(--border)' }} />
            <span style={{ fontSize:12, color:'#999', fontWeight:500 }}>tai sähköpostilla</span>
            <div style={{ flex:1, height:1, background:'var(--border)' }} />
          </div>
        )}

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input className="input" type="email" placeholder="Sähköposti" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
          {mode !== 'reset' && <input className="input" type="password" placeholder="Salasana" value={pw} onChange={e => setPw(e.target.value)} required minLength={mode === 'register' ? 8 : undefined} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />}
          {mode === 'register' && <div style={{ fontSize:12, color:'var(--text-muted)', lineHeight:1.4 }}>Vähintään 8 merkkiä. Käytä uniikkia salasanaa, jota et käytä muissa palveluissa.</div>}
          <button className="btn btn-dark btn-lg btn-full" type="submit" disabled={busy}>
            {busy ? 'Odota...' : mode === 'login' ? 'Kirjaudu' : mode === 'register' ? 'Luo tili' : 'Lähetä linkki'}
          </button>
        </form>
        <div style={{ marginTop: 16, textAlign: 'center', fontSize: 13 }}>
          {mode === 'login' ? <>
            <button onClick={() => { setMode('register'); setError(''); setInfo(''); }} style={{ background:'none',border:'none',color:'var(--green-deep)',fontWeight:600,cursor:'pointer',fontFamily:'inherit' }}>Luo uusi tili</button>
            <span style={{ color: '#999', margin: '0 8px' }}>·</span>
            <button onClick={() => { setMode('reset'); setError(''); setInfo(''); }} style={{ background:'none',border:'none',color:'#888',cursor:'pointer',fontFamily:'inherit' }}>Unohditko salasanan?</button>
          </> : <button onClick={() => { setMode('login'); setError(''); setInfo(''); }} style={{ background:'none',border:'none',color:'var(--green-deep)',fontWeight:600,cursor:'pointer',fontFamily:'inherit' }}>Kirjaudu sisään</button>}
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
      <LegalSection title="Evästeet ja vastaavat tekniikat">
        Käytämme välttämättömiä evästeitä ja selaimen paikallista tallennustilaa kirjautumisen ylläpitämiseen — näitä ei voi kytkeä pois, koska palvelu ei toimi ilman niitä, eivätkä ne vaadi suostumusta. Lisäksi sekä markkinointisivustolla että selainsovelluksessa voidaan käyttää Metan (Facebook) analytiikka- ja markkinointievästeitä. Ne ladataan vasta, jos annat siihen nimenomaisen suostumuksen evästebannerissa.
      </LegalSection>
      <LegalSection title="Suostumuksen peruuttaminen">
        Voit muuttaa tai peruuttaa evästesuostumuksesi milloin tahansa kohdasta Profiili → Asetukset → Evästeasetukset. Peruuttaminen ei vaikuta ennen peruutusta tehdyn käsittelyn lainmukaisuuteen.
      </LegalSection>
      <LegalSection title="Automaattinen päätöksenteko">
        Emme tee tietojesi perusteella automaattista päätöksentekoa tai profilointia, jolla olisi sinuun oikeusvaikutuksia. Emme myöskään siirrä tietoja EU- tai ETA-alueen ulkopuolelle muutoin kuin siltä osin kuin käyttämäsi kirjautumis- tai markkinointipalvelu sitä omien ehtojensa mukaisesti edellyttää.
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
      await supabase.auth.updateUser({ data: { display_name: form.nimi.trim(), full_name: form.nimi.trim() } });
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
                <button key={s.value} type="button" className="hover-lift" onClick={()=>set('pelitaso',s.value)} style={{
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

// ── Ikonit ─────────────────────────────────────────────
function GearIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
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
      <div className="sidebar-name">{profileNameWithAge(profile)}</div>
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
      <button className="sidebar-edit" onClick={onEdit} title="Profiilin asetukset" aria-label="Profiilin asetukset" style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
        <GearIcon size={15} />
        Asetukset
      </button>
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
            <span style={{ color:'var(--ink)',fontWeight:700,fontSize:15 }}>{profileNameWithAge(player)}</span>
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
  const [showReport, setShowReport] = React.useState(false);
  const [reportText, setReportText] = React.useState('');
  const [busyAction, setBusyAction] = React.useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = React.useState(false);
  const doBlock = async () => {
    setBusyAction(true);
    try { await blockProfile(currentUserId, player.id); onBack(); }
    catch (err) { alert(err.message); setBusyAction(false); setShowBlockConfirm(false); }
  };
  const submitReport = async () => {
    setBusyAction(true);
    try {
      await reportProfile(currentUserId, player.id, reportText);
      setShowReport(false); setReportText('');
      setToast('Ilmoitus lähetetty. Kiitos.'); setTimeout(()=>setToast(''),3000);
    } catch (err) { alert(err.message); } finally { setBusyAction(false); }
  };
  const send = async () => {
    setSending(true);
    try {
      const { error } = await supabase.from('connection_requests').insert({ sender_id:currentUserId, receiver_id:player.id, message:reqText });
      if (error) throw error;
      triggerPush({ type:'play_request', senderId:currentUserId, receiverId:player.id });
      setShowReq(false); setToast('Pelipyyntö lähetetty!'); setTimeout(()=>setToast(''),2500);
    } catch (err) { alert(err.message); } finally { setSending(false); }
  };
  return (
    <div style={{ position:'relative' }}>
      <button className="icon-btn" onClick={onBack} aria-label="Sulje" style={{ position:'absolute', top:-8, right:-8, fontSize:18 }}>✕</button>
      <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:8,margin:'4px auto 24px' }}>
        <Avatar uri={player.avatarUrl} name={player.nimi} color={player.avatarColor} size={84} />
        <h2 style={{ color:'var(--ink)',fontWeight:800,fontSize:22,margin:0 }}>{profileNameWithAge(player)}</h2>
        <p style={{ color:'var(--text-muted)',fontSize:14 }}>{player.alue.join(', ')}</p>
        {player.playingThisWeek && <span className="chip chip-active">Tällä viikolla</span>}
      </div>
      <div className="detail-field"><div className="detail-label">Pelitaso</div><div className="detail-value">{formatSkillLevels(player.pelitaso)}</div></div>
      <div className="detail-field"><div className="detail-label">Pelimuoto</div><div className="detail-value">{player.pelimuoto.map(titleCase).join(', ')}</div></div>
      {player.saatavuus?.length>0 && <div className="detail-field"><div className="detail-label">Saatavuus</div><div className="detail-value">{player.saatavuus.map(s=><div key={s}>{slotLabel(s)}</div>)}</div></div>}
      {player.katisyys && <div className="detail-field"><div className="detail-label">Kätisyys</div><div className="detail-value">{titleCase(player.katisyys)}</div></div>}
      {player.bio && <div className="detail-field"><div className="detail-label">Bio</div><div className="detail-value">{player.bio}</div></div>}
      {currentUserId && currentUserId !== player.id && <button className="btn btn-lime btn-lg btn-full" style={{marginTop:20}} onClick={()=>{setReqText('Lähtisitkö pelaamaan?');setShowReq(true);}}>Pyydä pelaamaan</button>}
      {currentUserId && currentUserId !== player.id && (
        <div style={{display:'flex',gap:8,marginTop:10}}>
          <button className="btn btn-outline-d btn-sm" style={{flex:1}} disabled={busyAction} onClick={()=>setShowReport(true)}>Ilmoita</button>
          <button className="btn btn-outline-d btn-sm" style={{flex:1,color:'var(--danger)',borderColor:'var(--danger)'}} disabled={busyAction} onClick={()=>setShowBlockConfirm(true)}>Estä</button>
        </div>
      )}
      {showReq && <div className="modal-overlay" onClick={()=>setShowReq(false)}><div className="modal-sheet" onClick={e=>e.stopPropagation()}>
        <h3 style={{margin:'0 0 12px',fontSize:17,fontWeight:800}}>Pyyntö: {player.nimi}</h3>
        <textarea className="input" rows={3} value={reqText} onChange={e=>setReqText(e.target.value)}/>
        <div style={{display:'flex',gap:8,marginTop:12}}><button className="btn btn-outline-d btn-md" onClick={()=>setShowReq(false)}>Peruuta</button><button className="btn btn-dark btn-lg" style={{flex:1}} onClick={send} disabled={sending||!reqText.trim()}>{sending?'Lähetetään...':'Lähetä'}</button></div>
      </div></div>}
      {showReport && <div className="modal-overlay" onClick={()=>setShowReport(false)}><div className="modal-sheet" onClick={e=>e.stopPropagation()}>
        <h3 style={{margin:'0 0 6px',fontSize:17,fontWeight:800}}>Ilmoita käyttäjästä</h3>
        <p style={{margin:'0 0 12px',fontSize:13,color:'var(--text-muted)',lineHeight:1.5}}>Kerro lyhyesti mistä on kyse. Ilmoitus välitetään Krossin ylläpidolle, eikä {player.nimi} saa siitä tietoa.</p>
        <textarea className="input" rows={4} value={reportText} onChange={e=>setReportText(e.target.value)} placeholder="Mitä tapahtui?"/>
        <div style={{display:'flex',gap:8,marginTop:12}}>
          <button className="btn btn-outline-d btn-md" onClick={()=>setShowReport(false)}>Peruuta</button>
          <button className="btn btn-dark btn-lg" style={{flex:1}} onClick={submitReport} disabled={busyAction||!reportText.trim()}>{busyAction?'Lähetetään...':'Lähetä ilmoitus'}</button>
        </div>
      </div></div>}
      {showBlockConfirm && <ConfirmModal
        title={`Estetäänkö ${player.nimi}?`}
        message="Hän katoaa pelaajalistaltasi. Voit purkaa eston profiilisi asetuksista."
        confirmLabel="Estä" danger busy={busyAction}
        onConfirm={doBlock} onCancel={()=>setShowBlockConfirm(false)}
      />}
      <Toast show={!!toast} text={toast}/>
    </div>
  );
}

// ── Estetyt profiilit ──────────────────────────────────
function BlockedProfilesScreen({ onBack }) {
  const { session } = useAuth();
  const uid = session?.user?.id;
  const [list, setList] = React.useState(null);
  const [busy, setBusy] = React.useState(null);
  const load = React.useCallback(async () => {
    if (!uid) return;
    try { setList(await fetchBlockedProfiles(uid)); } catch (e) { console.error(e); setList([]); }
  }, [uid]);
  React.useEffect(() => { load(); }, [load]);
  const remove = async (row) => {
    setBusy(row.rowId);
    try { await unblockProfile(row.rowId); await load(); }
    catch (err) { alert(err.message); } finally { setBusy(null); }
  };
  return <div className="clay-bg" style={{minHeight:'100%',padding:'20px 24px 60px'}}>
    <button className="back-btn" onClick={onBack}>← Takaisin</button>
    <div style={{maxWidth:500,margin:'24px auto 0'}}>
      <h2 style={{color:'var(--ink)',fontWeight:800,fontSize:22,marginBottom:6}}>Estetyt profiilit</h2>
      <p style={{color:'var(--text-muted)',fontSize:13,marginBottom:18,lineHeight:1.5}}>Estetyt pelaajat eivät näy pelaajalistallasi.</p>
      {list === null && <Spinner/>}
      {list !== null && list.length === 0 && <div className="card" style={{color:'var(--text-muted)',fontSize:14}}>Et ole estänyt ketään.</div>}
      {(list||[]).map(row => (
        <div key={row.rowId} className="card" style={{display:'flex',alignItems:'center',gap:12,marginBottom:8}}>
          <Avatar uri={row.avatarUrl} name={row.name} color={row.avatarColor} size={38}/>
          <span style={{flex:1,color:'var(--ink)',fontWeight:600,fontSize:15}}>{row.name}</span>
          <button className="btn btn-outline-d btn-sm" disabled={busy===row.rowId} onClick={()=>remove(row)}>{busy===row.rowId?'Puretaan...':'Poista esto'}</button>
        </div>
      ))}
    </div>
  </div>;
}

// ── Locked content preview (teaser shown before payment) ──
function LockedContentPreview({ title, description, ctaLabel='Aloita pelit', onUnlock, children }) {
  return (
    <div style={{ position:'relative', overflow:'hidden', borderRadius:18 }}>
      <div aria-hidden="true" style={{ filter:'blur(7px)', pointerEvents:'none', userSelect:'none' }}>
        {children}
      </div>
      <div style={{
        position:'absolute', inset:0, display:'flex', alignItems:'flex-end', justifyContent:'center',
        padding:'0 16px 16px',
        background:'linear-gradient(180deg, rgba(247,245,239,0) 0%, rgba(247,245,239,0.75) 38%, var(--paper) 76%)',
      }}>
        <div style={{
          background:'#fff', border:'1px solid var(--border)', borderRadius:18,
          boxShadow:'0 14px 32px -12px rgba(20,15,5,0.18)', padding:'22px 24px',
          textAlign:'center', maxWidth:340, width:'100%',
        }}>
          <div style={{ fontSize:26, marginBottom:6 }}>🔒</div>
          <p style={{ fontSize:15, fontWeight:700, color:'var(--ink)', margin:'0 0 4px' }}>{title}</p>
          <p style={{ fontSize:13, color:'var(--text-muted)', margin:'0 0 16px', lineHeight:1.5 }}>{description}</p>
          <button className="btn btn-lime btn-md btn-full" onClick={onUnlock}>{ctaLabel}</button>
        </div>
      </div>
    </div>
  );
}
const LOCKED_PREVIEW_PLAYERS = [
  { nimi:'Aleksi', ika:'30-40', pelitaso:['keskitaso'], pelimuoto:['pallottelu','nelinpeli'], avatarColor:'blue', playingThisWeek:true },
  { nimi:'Emilia', ika:'20-30', pelitaso:['edistynyt'], pelimuoto:['matsit'], avatarColor:'red', playingThisWeek:false },
  { nimi:'Joonas', ika:'40-50', pelitaso:['aloittelija'], pelimuoto:['pallottelu'], avatarColor:'green', playingThisWeek:false },
  { nimi:'Sofia', ika:'20-30', pelitaso:['kilpapelaaja'], pelimuoto:['kaksinpeli'], avatarColor:'yellow', playingThisWeek:true },
  { nimi:'Miika', ika:'30-40', pelitaso:['keskitaso'], pelimuoto:['kaikki käy'], avatarColor:'blue', playingThisWeek:false },
];
function LockedPlayersPreview({ onUnlock }) {
  return (
    <LockedContentPreview
      title="Pelaajat ovat lukittuna"
      description="Maksa kertamaksu 8,99 € ja näet alueesi pelaajat profiileineen. Saat koko Krossin käyttöön ja voit löytää pelit helpommin kuin koskaan ennen."
      onUnlock={onUnlock}
    >
      {LOCKED_PREVIEW_PLAYERS.map((p,i) => <PlayerCard key={i} player={p} onClick={()=>{}}/>)}
    </LockedContentPreview>
  );
}
const LOCKED_PREVIEW_CHALLENGES = [
  { scheduledAt:null, matchType:'kaksinpeli', creatorName:'Ville', creatorAvatarColor:'blue', location:'Kisapuisto', locationType:'ulkotennis', participants:[], title:'Rento pallottelu illalla' },
  { scheduledAt:null, matchType:'nelinpeli', creatorName:'Noora', creatorAvatarColor:'yellow', location:'Tennishalli', locationType:'sisätennis', participants:[{userId:'p1',name:'Eero',avatarColor:'green'}], title:'' },
  { scheduledAt:null, matchType:'pallottelu', creatorName:'Petri', creatorAvatarColor:'red', location:'Radiomäki', locationType:'ulkotennis', participants:[], title:'Etsin pallottelukaveria' },
];
function LockedChallengesPreview({ onUnlock }) {
  return (
    <LockedContentPreview
      title="Haasteet ovat lukittuna"
      description="Maksa kertamaksu 8,99 € ja näet alueesi avoimet haasteet. Saat koko Krossin käyttöön ja voit löytää pelit helpommin kuin koskaan ennen."
      onUnlock={onUnlock}
    >
      {LOCKED_PREVIEW_CHALLENGES.map((c,i) => <ChallengeCard key={i} challenge={c} onClick={()=>{}}/>)}
    </LockedContentPreview>
  );
}

// ── Players Screen ─────────────────────────────────────
function PlayersScreen({ onOpenPlayer }) {
  const { session, profile } = useAuth();
  const [players, setPlayers] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState({ skill:'', playStyles:[], gender:'' });
  const [showFilterModal, setShowFilterModal] = React.useState(false);
  const [showPaywall, setShowPaywall] = React.useState(false);
  const load = React.useCallback(async () => {
    try {
      const uid = session?.user?.id;
      const [{ data }, blocked] = await Promise.all([
        supabase.from('profiles').select(PROFILE_SELECT).eq('hidden_from_feed',false).order('playing_this_week',{ascending:false}).order('updated_at',{ascending:false}),
        fetchBlockedIds(uid),
      ]);
      setPlayers((data||[]).map(mapProfile).filter(p=>p.id!==uid && !blocked.has(p.id)));
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
      if (filter.playStyles.length>0 && !filter.playStyles.some(s=>p.pelimuoto.includes(s))) return false;
      if (filter.gender && p.sukupuoli!==filter.gender) return false;
      return true;
    });
  }, [players,filter,profile]);
  const extraFilterCount = (filter.playStyles.length>0?1:0) + (filter.gender?1:0);
  const togglePlayStyle = s => setFilter(f=>({...f, playStyles: f.playStyles.includes(s)?f.playStyles.filter(x=>x!==s):[...f.playStyles,s]}));
  return (
    <div className="page">
      <div className="page-header"><h2 className="page-title">Pelaajat</h2></div>
      <div className="filter-bar" style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
        <button className={`filter-chip ${!filter.skill?'active':''}`} onClick={()=>setFilter(f=>({...f,skill:''}))}>Kaikki</button>
        {PLAIN_SKILL_LEVELS.map(l=><button key={l} className={`filter-chip ${filter.skill===l?'active':''}`} onClick={()=>setFilter(f=>({...f,skill:f.skill===l?'':l}))}>{titleCase(l)}</button>)}
        <button className={`filter-btn ${extraFilterCount>0?'has-filters':''}`} style={{marginLeft:'auto'}} onClick={()=>setShowFilterModal(true)}>
          <FilterIcon/> Suodata{extraFilterCount>0 && <span className="filter-btn-badge">{extraFilterCount}</span>}
        </button>
      </div>
      {loading ? <Spinner/> : !profile?.paidAt
        ? <LockedPlayersPreview onUnlock={()=>setShowPaywall(true)}/>
        : filtered.length===0 ? <Empty title="Ei pelaajia näillä suodattimilla."/> :
        filtered.map(p=><PlayerCard key={p.id} player={p} onClick={()=>onOpenPlayer(p)}/>)}
      {showPaywall && <PaywallModal onClose={()=>setShowPaywall(false)}/>}
      {showFilterModal && <FilterModal title="Suodata pelaajia" onClose={()=>setShowFilterModal(false)} onClear={()=>setFilter(f=>({...f,playStyles:[],gender:''}))}>
        <div className="field"><div className="detail-label">Pelityyli</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {PLAY_STYLES.map(s=><button key={s} className={`filter-chip ${filter.playStyles.includes(s)?'active':''}`} onClick={()=>togglePlayStyle(s)}>{titleCase(s)}</button>)}
        </div></div>
        <div className="field"><div className="detail-label">Sukupuoli</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          <button className={`filter-chip ${!filter.gender?'active':''}`} onClick={()=>setFilter(f=>({...f,gender:''}))}>Kaikki</button>
          {GENDERS.map(g=><button key={g} className={`filter-chip ${filter.gender===g?'active':''}`} onClick={()=>setFilter(f=>({...f,gender:f.gender===g?'':g}))}>{titleCase(g)}</button>)}
        </div></div>
      </FilterModal>}
    </div>
  );
}

// ── Challenge Card ─────────────────────────────────────
function ChallengeCard({ challenge, onClick }) {
  const need = slotsNeeded(challenge.matchType);
  const joined = challenge.participants.slice(0, need);
  const openSlots = Math.max(0, need - joined.length);
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
          {joined.map(p => <Avatar key={p.userId} uri={p.avatarUrl} name={p.name} color={p.avatarColor} size={20}/>)}
          {Array.from({length:openSlots}).map((_,i)=>
            <span key={i} style={{width:20,height:20,borderRadius:'50%',border:'1.5px dashed #c5c0b5'}}/>
          )}
        </div>
      </div>
      {challenge.title && <p style={{ color:'var(--text-muted)',fontSize:12,marginTop:6 }}>{challenge.title}</p>}
    </button>
  );
}

// ── Challenge Detail ───────────────────────────────────
function ChallengeDetail({ challenge, onBack, onOpenChat, currentUserId }) {
  const { profile } = useAuth();
  const [joining, setJoining] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [toast, setToast] = React.useState('');
  const [showPaywall, setShowPaywall] = React.useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = React.useState(false);
  const join = async () => {
    if (!profile?.paidAt) { setShowPaywall(true); return; }
    setJoining(true);
    try { const {data:convId,error}=await supabase.rpc('join_challenge',{challenge_id_input:challenge.id}); if(error) throw error;
      triggerPush({ type:'challenge_join', challengeId:challenge.id, challengeCreatorId:challenge.creatorId, joinerId:currentUserId });
      if (convId && onOpenChat) {
        const isGroup = challenge.participants.length >= 1;
        onOpenChat({
          id: convId, isGroup,
          otherUserId: challenge.creatorId, otherUserName: challenge.creatorName,
          otherUserAvatarUrl: challenge.creatorAvatarUrl, otherUserAvatarColor: challenge.creatorAvatarColor,
          displayName: isGroup ? 'Ryhmäkeskustelu' : challenge.creatorName,
        });
      } else {
        setToast('Liityit haasteeseen!'); setTimeout(()=>setToast(''),2500);
      }
    } catch(err) {
      if (err.message==='Payment required') setShowPaywall(true);
      else { console.error('Haasteeseen liittyminen epäonnistui', err); alert('Haasteeseen liittyminen epäonnistui. Yritä hetken päästä uudelleen.'); }
    } finally { setJoining(false); }
  };
  const cancel = async () => {
    setCancelling(true);
    try { const {error}=await supabase.from('challenges').update({ status:'cancelled' }).eq('id',challenge.id); if(error) throw error;
      triggerPush({ type:'challenge_cancelled', challengeId:challenge.id, creatorId:currentUserId });
      onBack();
    } catch(err) { alert(err.message); setCancelling(false); setShowCancelConfirm(false); }
  };
  const isMine = challenge.creatorId===currentUserId;
  const joined = challenge.participants.some(p=>p.userId===currentUserId);
  const full = challenge.participants.length>=slotsNeeded(challenge.matchType);
  return (
    <div style={{ position:'relative' }}>
      <button className="icon-btn" onClick={onBack} aria-label="Sulje" style={{ position:'absolute', top:-8, right:-8, fontSize:18 }}>✕</button>
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
      {isMine && challenge.status!=='cancelled' && <button className="btn btn-outline-d btn-md btn-full" style={{marginTop:20,color:'var(--danger)',borderColor:'var(--danger)'}} onClick={()=>setShowCancelConfirm(true)} disabled={cancelling}>{cancelling?'Perutaan...':'Peruuta haaste'}</button>}
      <Toast show={!!toast} text={toast}/>
      {showPaywall && <PaywallModal onClose={()=>setShowPaywall(false)}/>}
      {showCancelConfirm && <ConfirmModal
        title="Perutaanko haaste?"
        message="Se poistuu avoimista haasteista eikä sitä voi palauttaa."
        cancelLabel="Älä peruuta" confirmLabel="Kyllä, peruuta" danger busy={cancelling}
        onConfirm={cancel} onCancel={()=>setShowCancelConfirm(false)}
      />}
    </div>
  );
}

// ── Challenges Screen ──────────────────────────────────
const SKILL_ORDER = ['aloittelija', 'keskitaso', 'edistynyt', 'kilpapelaaja'];
function ChallengesScreen({ onOpenChallenge, onCreateChallenge, refreshKey }) {
  const { profile } = useAuth();
  const [list, setList] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState({ matchType:'', locationType:'', courtSurface:'', minSkillLevel:'' });
  const [showFilterModal, setShowFilterModal] = React.useState(false);
  const [showPaywall, setShowPaywall] = React.useState(false);
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
          return {id:r.id,creatorId:r.creator_id,creatorName:cr?.name||'Pelaaja',creatorAvatarUrl:cr?.avatar_url,creatorAvatarColor:cr?.avatar_color||'blue',creatorArea:parseAreas(cr?.area||''),creatorSkillLevel:parseSkillLevels(pf?.skill_level),location:r.location,locationType:r.location_type,courtSurface:r.court_surface||'',minSkillLevel:r.min_skill_level||'',scheduledAt:r.scheduled_at,matchType:r.match_type,status:r.status,challengeType:r.challenge_type||'open',participants:pm.get(r.id)||[],title:r.title,description:r.description};}));
      } catch {} finally { setLoading(false); }
    })();
  }, [refreshKey]);
  const filtered = React.useMemo(() => list.filter(c => {
    if (filter.matchType && c.matchType!==filter.matchType) return false;
    if (filter.locationType && c.locationType!==filter.locationType) return false;
    if (filter.courtSurface && c.courtSurface!==filter.courtSurface) return false;
    if (filter.minSkillLevel && c.minSkillLevel && SKILL_ORDER.indexOf(c.minSkillLevel) > SKILL_ORDER.indexOf(filter.minSkillLevel)) return false;
    return true;
  }), [list, filter]);
  const extraFilterCount = Object.values(filter).filter(Boolean).length;
  const setF = (k,v) => setFilter(f=>({...f,[k]:f[k]===v?'':v}));
  return <div className="page">
    <div className="page-header"><h2 className="page-title">Avoimet</h2><button className="btn btn-lime btn-sm" onClick={onCreateChallenge}>+ Luo haaste</button></div>
    <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
      <button className={`filter-btn ${extraFilterCount>0?'has-filters':''}`} onClick={()=>setShowFilterModal(true)}>
        <FilterIcon/> Suodata{extraFilterCount>0 && <span className="filter-btn-badge">{extraFilterCount}</span>}
      </button>
    </div>
    {loading ? <Spinner/> : !profile?.paidAt
      ? <LockedChallengesPreview onUnlock={()=>setShowPaywall(true)}/>
      : list.length===0?<Empty title="Ei avoimia haasteita." action="Luo ensimmäinen" onAction={onCreateChallenge}/>
      :filtered.length===0?<Empty title="Ei haasteita näillä suodattimilla."/>
      :filtered.map(c=><ChallengeCard key={c.id} challenge={c} onClick={()=>onOpenChallenge(c)}/>)}
    {showPaywall && <PaywallModal onClose={()=>setShowPaywall(false)}/>}
    {showFilterModal && <FilterModal title="Suodata haasteita" onClose={()=>setShowFilterModal(false)} onClear={()=>setFilter({matchType:'',locationType:'',courtSurface:'',minSkillLevel:''})}>
      <div className="field"><div className="detail-label">Pelityyppi</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{MATCH_TYPES.map(t=><button key={t} className={`filter-chip ${filter.matchType===t?'active':''}`} onClick={()=>setF('matchType',t)}>{titleCase(t)}</button>)}</div></div>
      <div className="field"><div className="detail-label">Sijainti</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{LOCATION_TYPES.map(t=><button key={t} className={`filter-chip ${filter.locationType===t?'active':''}`} onClick={()=>setF('locationType',t)}>{titleCase(t)}</button>)}</div></div>
      <div className="field"><div className="detail-label">Kenttäpinta</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{COURT_SURFACES.map(s=><button key={s} className={`filter-chip ${filter.courtSurface===s?'active':''}`} onClick={()=>setF('courtSurface',s)}>{titleCase(s)}</button>)}</div></div>
      <div className="field"><div className="detail-label">Vastustajan enimmäistaso</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{PLAIN_SKILL_LEVELS.map(l=><button key={l} className={`filter-chip ${filter.minSkillLevel===l?'active':''}`} onClick={()=>setF('minSkillLevel',l)}>{titleCase(l)}</button>)}</div></div>
    </FilterModal>}
  </div>;
}

// ── Create Challenge ───────────────────────────────────
function CreateChallengeScreen({ onBack, onCreated }) {
  const { session, profile } = useAuth();
  const [form, setForm] = React.useState({matchType:'kaksinpeli',locationType:'sisätennis',location:'',scheduledAt:'',title:'',description:'',courtSurface:'',minSkillLevel:'',courtPrice:'',creatorCoversFull:false});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [showPaywall, setShowPaywall] = React.useState(false);
  const set = (k,v)=>setForm(p=>({...p,[k]:v}));
  const homeCity = profile?.alue?.[0]||'Lahti';
  const venues = INDOOR_VENUES.filter(v=>v.city===homeCity);
  const create = async () => {
    if (!profile?.paidAt) { setShowPaywall(true); return; }
    setError(''); setBusy(true);
    try {
      const scheduledAtDate = form.scheduledAt ? new Date(form.scheduledAt) : null;
      const expiresAt = scheduledAtDate
        ? new Date(scheduledAtDate.getTime() + CHALLENGE_DURATION_HOURS*60*60*1000)
        : new Date(Date.now() + OPEN_CHALLENGE_TTL_HOURS*60*60*1000);
      const payload = {creator_id:session.user.id,location:form.location||'Avoin',location_type:form.locationType,city:homeCity,scheduled_at:scheduledAtDate?scheduledAtDate.toISOString():null,expires_at:expiresAt.toISOString(),match_type:form.matchType,challenge_type:'open',title:form.title.trim()||null,description:form.description.trim()||null};
      if (form.courtSurface) payload.court_surface = form.courtSurface;
      if (form.minSkillLevel) payload.min_skill_level = form.minSkillLevel;
      if (form.courtPrice) payload.court_price = Number(form.courtPrice);
      if (form.creatorCoversFull) payload.creator_covers_full = true;
      const {data:created,error}=await supabase.from('challenges').insert(payload).select('id').single();
      if(error) throw error;
      if(created?.id) triggerPush({ type:'new_area_challenge', challengeId:created.id, creatorId:session.user.id, area:homeCity });
      onCreated();
    } catch(err) {
      if (/row-level security/i.test(err.message||'')) setShowPaywall(true);
      else { console.error('Haasteen luonti epäonnistui', err); setError('Haasteen luonti epäonnistui. Yritä hetken päästä uudelleen.'); }
    } finally { setBusy(false); }
  };
  return <div style={{position:'relative'}}>
    <button className="icon-btn" onClick={onBack} aria-label="Sulje" style={{position:'absolute',top:-8,right:-8,fontSize:18}}>✕</button>
    <h2 style={{color:'var(--ink)',fontWeight:800,fontSize:22,margin:'4px 0 18px'}}>Luo haaste</h2>
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
    {showPaywall && <PaywallModal onClose={()=>setShowPaywall(false)}/>}
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
  const [removeTarget, setRemoveTarget] = React.useState(null);
  const [removing, setRemoving] = React.useState(false);
  const doRemove = async () => {
    const c = removeTarget;
    setRemoving(true);
    try{ await supabase.rpc('delete_conversation_for_all',{conversation_id_input:c.id}); setRemoveTarget(null); load(); }
    catch(e){ alert(e.message||'Keskustelua ei voitu poistaa.'); }
    finally { setRemoving(false); }
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
        <img src="/assets/no-messages-yet.png" alt="" className="empty-hero-img" />
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
            <button className="icon-btn icon-btn-danger" title="Poista" onClick={()=>setRemoveTarget(c)}><TrashIcon/></button>
          </div>
        </div>)}
    {removeTarget && <ConfirmModal
      title="Poistetaanko keskustelu?"
      message={`${removeTarget.displayName}-keskustelu poistuu kaikilta osapuolilta.`}
      confirmLabel="Poista" danger busy={removing}
      onConfirm={doRemove} onCancel={()=>setRemoveTarget(null)}
    />}
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
  const [removeTarget, setRemoveTarget] = React.useState(null);
  const [removing, setRemoving] = React.useState(false);
  const doRemove = async () => {
    const c = removeTarget;
    setRemoving(true);
    try {
      await supabase.rpc('delete_conversation_for_all',{conversation_id_input:c.id});
      const next = getArchivedIds(uid).filter(id=>id!==c.id);
      saveArchivedIds(uid,next); setConvos(prev=>prev.filter(x=>x.id!==c.id));
      setRemoveTarget(null);
    } catch(e) { alert(e.message||'Keskustelua ei voitu poistaa.'); }
    finally { setRemoving(false); }
  };
  if (loading) return <div className="page"><Spinner/></div>;
  return <div className="page">
    <div style={{padding:'16px 0 4px'}}><button className="back-btn" onClick={onBack}>← Takaisin</button></div>
    <div className="page-header"><h2 className="page-title">Arkisto</h2></div>
    {convos.length>0 && <p style={{color:'var(--text-muted)',fontSize:13,margin:'-8px 0 14px',lineHeight:1.5}}>Arkistoidut keskustelut. Voit palauttaa ne takaisin tai poistaa pysyvästi.</p>}
    {convos.length===0
      ? <Empty title="Arkisto on tyhjä."/>
      : convos.map(c=><div key={c.id} className="msg-row">
          <div className="msg-row-main" onClick={()=>onOpenChat(c)}>
            <Avatar uri={c.otherUserAvatarUrl} name={c.otherUserName} color={c.otherUserAvatarColor} size={42}/>
            <div style={{flex:1,minWidth:0}}><div style={{color:'var(--ink)',fontWeight:700,fontSize:14}}>{c.displayName}</div><div style={{color:'var(--text-muted)',fontSize:12,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.lastMessage||'Aloita keskustelu'}</div></div>
          </div>
          <div className="msg-row-actions">
            <button className="icon-btn" title="Palauta" onClick={()=>unarchive(c)}><UndoIcon/></button>
            <button className="icon-btn icon-btn-danger" title="Poista" onClick={()=>setRemoveTarget(c)}><TrashIcon/></button>
          </div>
        </div>)}
    {removeTarget && <ConfirmModal
      title="Poistetaanko keskustelu pysyvästi?"
      message={`${removeTarget.displayName}-keskustelu poistetaan pysyvästi eikä sitä voi palauttaa.`}
      confirmLabel="Poista pysyvästi" danger busy={removing}
      onConfirm={doRemove} onCancel={()=>setRemoveTarget(null)}
    />}
  </div>;
}

// ── Chat Screen ────────────────────────────────────────
function ChatScreen({ conversation, onBack }) {
  const { session } = useAuth();
  const [msgs, setMsgs] = React.useState([]);
  const [text, setText] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [sending, setSending] = React.useState(false);
  const [participants, setParticipants] = React.useState(null);
  const [loadingParticipants, setLoadingParticipants] = React.useState(false);
  const [showParticipants, setShowParticipants] = React.useState(false);
  const [viewProfile, setViewProfile] = React.useState(null);
  const [loadingProfile, setLoadingProfile] = React.useState(false);
  const btm = React.useRef(null);
  const uid = session?.user?.id;
  const isGroup = conversation.isGroup;
  React.useEffect(() => {
    if (!isGroup) return;
    let cancelled = false;
    setLoadingParticipants(true);
    fetchConversationParticipants(conversation.id, uid)
      .then(list => { if (!cancelled) setParticipants(list); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingParticipants(false); });
    return () => { cancelled = true; };
  }, [conversation.id, isGroup, uid]);
  const openProfile = async (id) => {
    setLoadingProfile(true);
    try {
      const p = await fetchPlayerProfile(id);
      if (p) setViewProfile(p); else alert('Profiilia ei löytynyt.');
    } catch (e) { alert(e.message); } finally { setLoadingProfile(false); }
  };
  const openHeaderProfile = () => {
    if (!isGroup) { openProfile(conversation.otherUserId); return; }
    setShowParticipants(true);
  };
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
    try{
      await supabase.from('messages').insert({conversation_id:conversation.id,content:text.trim()});
      setText('');
      triggerPush({type:'new_message',conversationId:conversation.id,senderId:uid,hasImage:false,isThumbsUp:false});
    }catch(e){alert(e.message);}finally{setSending(false);}
  };
  const thumbs = async () => {
    setSending(true);try{
      await supabase.from('messages').insert({conversation_id:conversation.id,content:JSON.stringify({__type:'thumbs_up'})});
      triggerPush({type:'new_message',conversationId:conversation.id,senderId:uid,hasImage:false,isThumbsUp:true});
    }catch(e){alert(e.message);}finally{setSending(false);}
  };
  const extraCount = isGroup ? Math.max((participants||[]).length - 2, 0) : 0;
  return <div className="clay-bg" style={{display:'flex',flexDirection:'column',height:'100%'}}>
    <div className="chat-header" style={{display:'flex',alignItems:'center',gap:8,padding:'10px 16px'}}>
      <button className="chat-back-btn" onClick={onBack} aria-label="Takaisin"><BackArrowIcon/></button>
      <button className="chat-header-id" onClick={openHeaderProfile} disabled={loadingParticipants||loadingProfile}
        aria-label={isGroup?'Näytä osallistujat':'Näytä profiili'}>
        {isGroup ? (
          <div className="avatar-stack">
            {(participants||[]).slice(0,2).map(p=><div key={p.userId} className="avatar-ring"><Avatar uri={p.avatarUrl} name={p.name} color={p.avatarColor} size={36}/></div>)}
            {(participants===null)&&<div className="avatar-ring"><Avatar name="?" color="blue" size={36}/></div>}
            {extraCount>0&&<span className="group-badge">+{extraCount}</span>}
          </div>
        ) : <div className="avatar-ring"><Avatar uri={conversation.otherUserAvatarUrl} name={conversation.otherUserName} color={conversation.otherUserAvatarColor} size={36}/></div>}
        <div style={{flex:1,minWidth:0}}>
          <div style={{color:'var(--ink)',fontWeight:700,fontSize:15,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{conversation.displayName}</div>
          {isGroup && <div style={{color:'var(--text-muted)',fontSize:11,display:'flex',alignItems:'center',gap:4}}><UsersIcon size={11}/>{participants?`${participants.length+1} pelaajaa`:'Ladataan...'}</div>}
        </div>
        {(loadingParticipants||loadingProfile)?<div className="spinner" style={{width:14,height:14,borderWidth:2,flexShrink:0}}/>:<span className="chat-header-chevron"><ChevronRightIcon/></span>}
      </button>
    </div>
    <div style={{flex:1,overflowY:'auto',padding:16,display:'flex',flexDirection:'column',gap:8}}>
      {loading?<Spinner/>:msgs.map(m=>{
        const mine=m.senderId===uid;
        let dc=m.content,isThumb=false;try{const p=JSON.parse(m.content);if(p.__type==='thumbs_up'){dc='👍';isThumb=true;}if(p.__type==='challenge_join')dc=`${p.joinerName} liittyi peliin!`;}catch{}
        const showSender = !mine && isGroup;
        return <div key={m.id} style={{alignSelf:mine?'flex-end':'flex-start',maxWidth:'80%'}}>
          {showSender
            ? <div className="chat-sender-row">
                <div className="avatar-ring"><Avatar uri={m.senderAvatarUrl} name={m.senderName} color={m.senderAvatarColor} size={22}/></div>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--text-muted)',marginBottom:2}}>{m.senderName}</div>
                  {m.imageUrl&&<img src={chatImgUrl(m.imageUrl)} alt="" style={{maxWidth:200,borderRadius:10,display:'block',marginBottom:dc?4:0}}/>}
                  {dc&&(isThumb
                    ? <div className="chat-thumb" aria-label="Peukku">👍</div>
                    : <div className="chat-bubble chat-theirs">{dc}</div>)}
                </div>
              </div>
            : <>
                {m.imageUrl&&<img src={chatImgUrl(m.imageUrl)} alt="" style={{maxWidth:200,borderRadius:10}}/>}
                {dc&&(isThumb
                  ? <div className="chat-thumb" style={{textAlign:mine?'right':'left'}} aria-label="Peukku">👍</div>
                  : <div className={`chat-bubble ${mine?'chat-mine':'chat-theirs'}`}>{dc}</div>)}
              </>}
        </div>;
      })}
      <div ref={btm}/>
    </div>
    <div style={{display:'flex',gap:8,padding:'10px 16px',borderTop:'1px solid var(--border)',flexShrink:0,alignItems:'center'}}>
      <input className="input input-dark" style={{flex:1,borderRadius:999,padding:'10px 16px'}} placeholder="Kirjoita viesti..." value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}}/>
      {text.trim()?<button className="btn btn-lime" onClick={send} disabled={sending} style={{width:38,height:38,borderRadius:'50%',padding:0}}><svg width="18" height="18" viewBox="0 0 22 22"><path d="M20 2L2 9.5l7 2.5 2.5 7L20 2z" fill="none" stroke="#101a08" strokeWidth="1.8" strokeLinejoin="round"/></svg></button>
      :<button className="btn" onClick={thumbs} disabled={sending} style={{width:38,height:38,borderRadius:'50%',padding:0,fontSize:20,background:'#f4f2ec',border:'1px solid var(--border)'}}>👍</button>}
    </div>
    {showParticipants&&<div className="modal-overlay" onClick={()=>setShowParticipants(false)}>
      <div className="modal-sheet" style={{maxWidth:380,position:'relative'}} onClick={e=>e.stopPropagation()}>
        <button className="icon-btn" onClick={()=>setShowParticipants(false)} aria-label="Sulje" style={{position:'absolute',top:16,right:16}}>✕</button>
        <h3 style={{margin:'0 2px 2px',fontSize:17,fontWeight:800,color:'var(--ink)'}}>Osallistujat</h3>
        <p style={{margin:'0 2px 16px',fontSize:13,color:'var(--text-muted)'}}>{participants?`${participants.length+1} pelaajaa ryhmässä`:'Ladataan...'}</p>
        {loadingParticipants && !participants ? <Spinner/> : (participants||[]).length===0
          ? <p style={{color:'var(--text-muted)',fontSize:14}}>Ei muita osallistujia.</p>
          : <div>
              {participants.map(p=><button key={p.userId} className="participant-row" onClick={()=>{setShowParticipants(false);openProfile(p.userId);}}>
                <div className="avatar-ring"><Avatar uri={p.avatarUrl} name={p.name} color={p.avatarColor} size={38}/></div>
                <span style={{color:'var(--ink)',fontWeight:700,fontSize:14}}>{p.name}</span>
                <span className="participant-row-chevron"><ChevronRightIcon/></span>
              </button>)}
            </div>}
      </div>
    </div>}
    {viewProfile&&<div className="modal-overlay" onClick={()=>setViewProfile(null)}>
      <div className="modal-sheet" style={{maxWidth:520}} onClick={e=>e.stopPropagation()}>
        <PlayerDetail player={viewProfile} onBack={()=>setViewProfile(null)} currentUserId={uid}/>
      </div>
    </div>}
  </div>;
}

// ── Match History ──────────────────────────────────────
const MATCH_GAME_TYPES = [['sets','Erät'],['tiebreak','Tie-break'],['full_match','Kunnon matsi']];

function MatchResultModal({ editingResult, prefill, title, onClose, onSaved }) {
  const initial = editingResult || prefill || {};
  const [format, setFormat] = React.useState(initial.format || 'singles');
  const [gameType, setGameType] = React.useState(initial.gameType || 'sets');
  const [opponentName, setOpponentName] = React.useState(initial.opponentName || '');
  const [partnerName, setPartnerName] = React.useState(initial.partnerName || '');
  const [oppPartnerName, setOppPartnerName] = React.useState(initial.oppPartnerName || '');
  const [sets, setSets] = React.useState(initial.sets?.length ? initial.sets : [{my:0,opp:0}]);
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
    <div className="modal-sheet" style={{position:'relative'}} onClick={e=>e.stopPropagation()}>
      <button className="icon-btn" onClick={onClose} aria-label="Sulje" style={{position:'absolute',top:16,right:16,fontSize:18}}>✕</button>
      <h3 style={{margin:'0 16px 16px 0',fontSize:18,fontWeight:800,color:'var(--ink)'}}>{title || (editingResult?'Muokkaa tulosta':'Lisää tulos')}</h3>
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

function PlayerStatsSection() {
  const [stats, setStats] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    fetchPlayerStatsWeb().then(s => { if (!cancelled) setStats(s); }).catch(() => { if (!cancelled) setStats({ organized:0, played:0 }); });
    return () => { cancelled = true; };
  }, []);
  if (!stats) return null;
  const tiles = [
    { label: 'Pelatut pelit', value: stats.played },
    { label: 'Järkätyt pelit', value: stats.organized },
  ];
  return <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:16}}>
    {tiles.map(t => <div key={t.label} className="card" style={{textAlign:'center'}}>
      <div style={{color:'var(--text-muted)',fontSize:10,fontWeight:700,textTransform:'uppercase',marginBottom:3}}>{t.label}</div>
      <div style={{color:'var(--ink)',fontWeight:800,fontSize:22}}>{t.value}</div>
    </div>)}
  </div>;
}

function MatchHistorySection() {
  const [results, setResults] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const load = React.useCallback(async () => {
    try { setResults(await fetchMatchResultsWeb()); } catch(e){ console.error('Pelihistorian lataus epäonnistui', e); } finally { setLoading(false); }
  }, []);
  React.useEffect(()=>{ load(); }, [load]);
  const [removeId, setRemoveId] = React.useState(null);
  const [removing, setRemoving] = React.useState(false);
  const doRemove = async () => {
    setRemoving(true);
    try { await deleteMatchResultWeb(removeId); setRemoveId(null); load(); }
    catch(e){ alert(e.message||'Tulosta ei voitu poistaa.'); }
    finally { setRemoving(false); }
  };
  const summary = loading ? 'Ladataan...' : results.length===0 ? 'Ei vielä pelihistoriaa' : `${results.length} ottelua`;
  return <>
    <h3 style={{fontSize:13,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:0.5,margin:'20px 0 8px'}}>Pelihistoria</h3>
    <button className="card hover-lift" onClick={()=>setHistoryOpen(true)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',width:'100%',marginBottom:14,cursor:'pointer',fontFamily:'inherit',fontSize:14,fontWeight:600,color:'var(--ink)'}}>
      <span>{summary}</span><span style={{color:'var(--text-muted)'}}>→</span>
    </button>
    {historyOpen && <div className="modal-overlay" onClick={()=>setHistoryOpen(false)}>
      <div className="modal-sheet" onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
          <h3 style={{margin:0,fontSize:18,fontWeight:800,color:'var(--ink)'}}>Pelihistoria</h3>
          <button className="btn btn-outline-d btn-sm" onClick={()=>{setEditing(null);setModalOpen(true);}}>+ Lisää tulos</button>
        </div>
        {results.length===0
          ? <div className="card" style={{color:'var(--text-muted)',fontSize:13}}>Pelihistoria tulee tähän, kun matseja pelataan.</div>
          : <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {results.map(r => <MatchResultCard key={r.id} result={r} onEdit={()=>{setEditing(r);setModalOpen(true);}} onDelete={()=>setRemoveId(r.id)}/>)}
            </div>}
        <button className="btn btn-outline-d btn-md btn-full" style={{marginTop:16}} onClick={()=>setHistoryOpen(false)}>Sulje</button>
      </div>
    </div>}
    {modalOpen && <MatchResultModal editingResult={editing} onClose={()=>setModalOpen(false)} onSaved={()=>{setModalOpen(false);load();}}/>}
    {removeId && <ConfirmModal
      title="Poistetaanko tulos?"
      message="Ottelutulos poistetaan pelihistoriastasi eikä sitä voi palauttaa."
      confirmLabel="Poista" danger busy={removing}
      onConfirm={doRemove} onCancel={()=>setRemoveId(null)}
    />}
  </>;
}

// ── Haasteen lopputulos-kysely ─────────────────────────
function ChallengeOutcomeModal({ challenge, onAnswer, onDismiss }) {
  const [busy, setBusy] = React.useState(false);
  const people = [
    { userId: challenge.creatorId, name: challenge.creatorName, avatarUrl: challenge.creatorAvatarUrl, avatarColor: challenge.creatorAvatarColor },
    ...challenge.participants,
  ];
  const answer = async (outcome) => {
    setBusy(true);
    try { await recordChallengeOutcome(challenge.id, outcome); onAnswer(outcome); }
    catch (e) { alert(e.message || 'Virhe'); setBusy(false); }
  };
  return <div className="modal-overlay">
    <div className="modal-sheet" style={{ position:'relative', textAlign:'center' }}>
      <button className="icon-btn" onClick={onDismiss} aria-label="Sulje" style={{ position:'absolute', top:16, right:16, fontSize:18 }}>✕</button>
      <div style={{ display:'flex', justifyContent:'center', marginBottom:14 }}>
        {people.map((p,i) => <div key={p.userId||i} style={{ marginLeft: i>0?-12:0, border:'2px solid var(--paper)', borderRadius:'50%' }}><Avatar uri={p.avatarUrl} name={p.name} color={p.avatarColor} size={44}/></div>)}
      </div>
      <h3 style={{ margin:'0 0 6px', fontSize:18, fontWeight:800, color:'var(--ink)' }}>Pelasitteko?</h3>
      <p style={{ margin:'0 0 20px', fontSize:13, color:'var(--text-muted)' }}>
        {challenge.scheduledAt ? formatDate(challenge.scheduledAt) : 'Aika avoin'}
        {challenge.location ? ` · ${challenge.location}` : ''}
        {challenge.locationType ? ` · ${titleCase(challenge.locationType)}` : ''}
      </p>
      <div style={{ display:'flex', gap:8 }}>
        <button className="btn btn-outline-d btn-md" style={{ flex:1 }} disabled={busy} onClick={()=>answer('not_played')}>Ei</button>
        <button className="btn btn-lime btn-lg" style={{ flex:1 }} disabled={busy} onClick={()=>answer('played')}>Kyllä</button>
      </div>
    </div>
  </div>;
}
function PendingOutcomeCheck() {
  const { session } = useAuth();
  const uid = session?.user?.id;
  const [queue, setQueue] = React.useState(null);
  const [stage, setStage] = React.useState('ask');
  React.useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    fetchPendingOutcomeChallenges(uid).then(list => { if (!cancelled) setQueue(list); }).catch(() => { if (!cancelled) setQueue([]); });
    return () => { cancelled = true; };
  }, [uid]);
  const advance = () => { setQueue(q => q.slice(1)); setStage('ask'); };
  const current = queue && queue.length > 0 ? queue[0] : null;
  if (!current) return null;
  if (stage === 'ask') {
    return <ChallengeOutcomeModal challenge={current} onDismiss={advance} onAnswer={outcome => outcome === 'played' ? setStage('addResult') : advance()} />;
  }
  return <MatchResultModal
    title="Haluatko lisätä tuloksen?"
    prefill={{ format: current.matchType === 'nelinpeli' ? 'doubles' : 'singles', opponentName: current.creatorId === uid ? (current.participants[0]?.name || '') : current.creatorName }}
    onClose={advance}
    onSaved={advance}
  />;
}

// ── Profile (full page) ────────────────────────────────
const HANDEDNESS = ['oikeakätinen','vasenkätinen'];
const BACKHAND_TYPES = ['yhden käden','kahden käden'];

function ProfileFullScreen({ onOpenBlocked }) {
  const { session, profile, refreshProfile } = useAuth();
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState('');
  const [identities, setIdentities] = React.useState([]);
  const [legal, setLegal] = React.useState(null); // null | 'terms' | 'privacy'
  const [deleting, setDeleting] = React.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);

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
      await supabase.auth.updateUser({ data: { display_name: form.nimi.trim(), full_name: form.nimi.trim() } });
      await supabase.from('tennis_preferences').upsert({user_id:uid,skill_level:form.pelitaso.join(','),play_style:form.pelimuoto.join(', '),handedness:form.katisyys||null,backhand_type:form.rysty||null});
      await supabase.from('availability').delete().eq('user_id',uid);
      if(form.saatavuus.length>0) await supabase.from('availability').insert(form.saatavuus.map(s=>({user_id:uid,slot:s})));
      await refreshProfile(); setEditing(false); setForm(null);
      setToast('Profiili päivitetty!'); setTimeout(()=>setToast(''),2500);
    } catch(e){alert(e.message);}finally{setBusy(false);}
  };

  const signOut = ()=>supabase.auth.signOut();
  const deleteAccount = async () => {
    setDeleting(true);
    try { await deleteOwnAccount(); }
    catch (e) { alert(e.message || 'Tilin poisto epäonnistui'); setDeleting(false); setShowDeleteConfirm(false); }
  };
  if(!profile) return <div className="page"><Spinner/></div>;
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const tog=(k,v)=>setForm(p=>({...p,[k]:p[k].includes(v)?p[k].filter(x=>x!==v):[...p[k],v]}));

  const SectionTitle = ({children})=><h3 style={{fontSize:13,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:0.5,margin:'20px 0 8px'}}>{children}</h3>;
  const SettingsRow = ({label,value,onClick,danger,valueColor})=>(
    <button className="hover-lift" onClick={onClick} style={{display:'flex',alignItems:'center',justifyContent:'space-between',width:'100%',padding:'12px 16px',background:'#fff',border:'1px solid var(--border)',borderRadius:12,cursor:'pointer',fontFamily:'inherit',fontSize:14,color:danger?'var(--danger)':'var(--ink)',fontWeight:500,marginBottom:6,textAlign:'left'}}>
      <span>{label}</span>
      <span style={{color:valueColor||'var(--text-muted)',fontSize:13,fontWeight:valueColor?700:400}}>{value||'→'}</span>
    </button>
  );

  const legalModal = legal && (
    <div className="modal-overlay" onClick={()=>setLegal(null)}>
      <div className="modal-sheet" onClick={e=>e.stopPropagation()}>
        {legal==='terms' ? <TermsContent/> : <PrivacyContent/>}
        <button className="btn btn-outline-d btn-md btn-full" style={{marginTop:16}} onClick={()=>setLegal(null)}>Sulje</button>
      </div>
    </div>
  );

  if(editing&&form) return <div className="page" style={{paddingBottom:40}}>
    <div className="page-header"><h2 className="page-title">Profiilin asetukset</h2><button className="btn btn-outline-d btn-sm" onClick={()=>{setEditing(false);setForm(null);}}>Peruuta</button></div>
    <SectionTitle>Profiilin tiedot</SectionTitle>
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
      <div className="field"><div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}><span style={{fontSize:14,fontWeight:600,color:'var(--ink)'}}>Piilota profiilini pelaajasyötteestä</span><button onClick={()=>set('hiddenFromFeed',!form.hiddenFromFeed)} style={{width:48,height:28,borderRadius:14,border:'none',padding:2,cursor:'pointer',background:form.hiddenFromFeed?'var(--green-deep)':'var(--border)',transition:'background .2s',position:'relative',flexShrink:0}}><span style={{display:'block',width:24,height:24,borderRadius:'50%',background:'#fff',boxShadow:'0 1px 3px rgba(0,0,0,.2)',transition:'transform .2s',transform:form.hiddenFromFeed?'translateX(20px)':'translateX(0)'}}/></button></div></div>
      <button className="btn btn-dark btn-lg btn-full" onClick={save} disabled={busy}>{busy?'Tallennetaan...':'Tallenna muutokset'}</button>
    </div>

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

    <SectionTitle>Tietosuoja ja ehdot</SectionTitle>
    <SettingsRow label="Käyttöehdot" onClick={()=>setLegal('terms')}/>
    <SettingsRow label="Tietosuojaseloste" onClick={()=>setLegal('privacy')}/>
    <SettingsRow label="Evästeasetukset" onClick={()=>{
      if(typeof window.krossiOpenCookieSettings==='function') window.krossiOpenCookieSettings();
      else alert('Evästeasetuksia ei voitu avata.');
    }}/>
    <SettingsRow label="Omat tiedot ja poistopyynnöt" onClick={()=>window.open('mailto:eelispuro@gmail.com?subject=Tietosuojapyyntö')}/>
    <p style={{fontSize:12,color:'var(--text-muted)',lineHeight:1.55,margin:'8px 2px 0'}}>
      Sinulla on oikeus tarkastaa, oikaista ja poistaa omat tietosi sekä siirtää ne toiseen palveluun.
      Tiedot käsitellään EU-alueella. Lue tarkemmin tietosuojaselosteesta.
    </p>

    <SectionTitle>Muut</SectionTitle>
    <SettingsRow label="Estetyt profiilit" onClick={onOpenBlocked}/>
    <SettingsRow label="Ota yhteyttä tukeen" onClick={()=>window.open('mailto:eelispuro@gmail.com')}/>
    <button className="btn btn-outline-d btn-md btn-full" onClick={signOut} style={{marginTop:16}}>Kirjaudu ulos</button>

    <SectionTitle>Tili</SectionTitle>
    <SettingsRow label={deleting?'Poistetaan tiliä...':'Poista tili pysyvästi'} danger onClick={deleting?undefined:()=>setShowDeleteConfirm(true)}/>
    <p style={{fontSize:12,color:'var(--text-muted)',lineHeight:1.55,margin:'2px 2px 0'}}>
      Poistaa profiilisi, haasteesi, viestisi ja ottelutuloksesi lopullisesti. Toimintoa ei voi perua.
    </p>
    {legalModal}
    {showDeleteConfirm && <ConfirmModal
      title="Poistetaanko tilisi pysyvästi?"
      message="Profiilisi, haasteesi, viestisi ja ottelutuloksesi poistetaan lopullisesti. Tätä ei voi perua."
      confirmLabel="Poista tili pysyvästi" danger busy={deleting}
      onConfirm={deleteAccount} onCancel={()=>setShowDeleteConfirm(false)}
    />}
  </div>;

  return <div className="page" style={{paddingBottom:40}}>
    <div className="page-header">
      <h2 className="page-title">Profiili</h2>
      <button className="icon-btn" onClick={()=>setEditing(true)} title="Profiilin asetukset" aria-label="Profiilin asetukset"><GearIcon size={19}/></button>
    </div>
    {!profile.paidAt && <div className="card" style={{marginBottom:16,padding:16,textAlign:'center'}}>
      <div style={{fontWeight:700,color:'var(--ink)',marginBottom:4}}>Profiilisi ei ole vielä viimeistelty</div>
      <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:12}}>Kertamaksu 8,99 € avaa pelaajien profiilit ja haasteet.</div>
      <button className="btn btn-lime btn-md" onClick={startCheckout}>Maksa 8,99 €</button>
    </div>}
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,marginBottom:24}}>
      <Avatar uri={profile.avatarUrl} name={profile.nimi} color={profile.avatarColor} size={76}/>
      <h3 style={{color:'var(--ink)',fontWeight:800,fontSize:20,margin:0}}>{profileNameWithAge(profile)}</h3>
      {profile.bio&&<p style={{color:'var(--text-muted)',fontSize:13,textAlign:'center'}}>{profile.bio}</p>}
    </div>
    <PlayerStatsSection/>
    <div style={{display:'flex',gap:8,justifyContent:'center',marginBottom:16}}>{profile.alue.map(a=><span key={a} className="sidebar-area">{a}</span>)}</div>
    <div style={{display:'flex',gap:10,marginBottom:14}}>
      <div className="card" style={{flex:1,textAlign:'center'}}><div style={{color:'var(--text-muted)',fontSize:10,fontWeight:700,textTransform:'uppercase',marginBottom:3}}>Pelitaso</div><div style={{color:'var(--ink)',fontWeight:700,fontSize:15}}>{formatSkillLevels(profile.pelitaso)}</div></div>
      <div className="card" style={{flex:1,textAlign:'center'}}><div style={{color:'var(--text-muted)',fontSize:10,fontWeight:700,textTransform:'uppercase',marginBottom:3}}>Pelimuoto</div><div style={{color:'var(--ink)',fontWeight:700,fontSize:15}}>{profile.pelimuoto.map(titleCase).join(', ')}</div></div>
    </div>
    {profile.saatavuus.length>0&&<div className="card" style={{marginBottom:14}}><div style={{color:'var(--text-muted)',fontSize:10,fontWeight:700,textTransform:'uppercase',marginBottom:6}}>Ajankohdat</div>{profile.saatavuus.map(s=><div key={s} style={{color:'var(--ink)',fontSize:13,padding:'2px 0'}}>{slotLabel(s)}</div>)}</div>}
    {(profile.katisyys||profile.rysty)&&<div className="card" style={{marginBottom:14}}><div style={{color:'var(--text-muted)',fontSize:10,fontWeight:700,textTransform:'uppercase',marginBottom:6}}>Tyyli</div>{profile.katisyys&&<div style={{color:'var(--ink)',fontSize:13,padding:'2px 0'}}>{titleCase(profile.katisyys)}</div>}{profile.rysty&&<div style={{color:'var(--ink)',fontSize:13,padding:'2px 0'}}>{titleCase(profile.rysty)} rysty</div>}</div>}

    <MatchHistorySection/>

    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,marginTop:20,padding:'12px 16px',background:'#fff',border:'1px solid var(--border)',borderRadius:12}}>
      <div>
        <div style={{fontSize:14,fontWeight:600,color:'var(--ink)'}}>Näkyvyys pelaajasyötteessä</div>
        <div style={{fontSize:12,color:'var(--text-muted)',marginTop:2}}>{profile.hiddenFromFeed?'Profiilisi on piilotettu muilta.':'Profiilisi näkyy muille pelaajille.'}</div>
      </div>
      <span style={{fontSize:13,fontWeight:700,color:profile.hiddenFromFeed?'var(--danger)':'#2d7a4d',whiteSpace:'nowrap'}}>{profile.hiddenFromFeed?'Piilotettu':'Näkyvissä'}</span>
    </div>
    <button className="btn btn-outline-d btn-md btn-full" onClick={()=>setEditing(true)} style={{marginTop:10,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
      <GearIcon size={16}/>
      Profiilin asetukset
    </button>
    <Toast show={!!toast} text={toast}/>
    {legalModal}
  </div>;
}

// ── Top Nav ────────────────────────────────────────────
function TopNav({ tab, onTabChange }) {
  const { profile } = useAuth();
  const links = [
    { id: 'players', label: 'Pelaajat', icon: '/assets/ball-tight.png' },
    { id: 'challenges', label: 'Avoimet', icon: '/assets/avoimet-tight.png' },
    { id: 'messages', label: 'Viestit', icon: '/assets/viestit-tight.png' },
  ];
  return (
    <nav className="top-nav">
      <a href="/" className="top-nav-logo">Krossi</a>
      <div className="top-nav-links">
        {links.map(l => (
          <button key={l.id} className={`top-nav-link ${tab === l.id ? 'active' : ''}`} onClick={() => onTabChange(l.id)}>
            <img src={l.icon} alt="" />
            {l.label}
          </button>
        ))}
      </div>
      <button className={`top-nav-profile ${tab === 'profile' ? 'active' : ''}`} onClick={() => onTabChange('profile')}>
        <Avatar uri={profile?.avatarUrl} name={profile?.nimi} color={profile?.avatarColor} size={30} />
        <span>{profile?.nimi || 'Profiili'}</span>
      </button>
    </nav>
  );
}

// ── App Shell ──────────────────────────────────────────
const TAB_SLUGS = { players: 'pelaajat', challenges: 'avoimet', messages: 'viestit', profile: 'profiili' };
const SLUG_TABS = { pelaajat: 'players', avoimet: 'challenges', viestit: 'messages', profiili: 'profile' };
function tabFromPath(pathname) {
  const slug = pathname.replace(/^\/pelaa\/?/, '').replace(/\/$/, '');
  return SLUG_TABS[slug] || 'players';
}

const POPUP_SCREEN_TYPES = ['playerDetail', 'challengeDetail', 'createChallenge'];
function AppShell() {
  const { session, profile } = useAuth();
  const [tab, setTab] = React.useState(() => tabFromPath(window.location.pathname));
  const [screen, setScreen] = React.useState({ type: 'tab' });
  const [challengesRefreshKey, setChallengesRefreshKey] = React.useState(0);
  const back = () => setScreen({ type: 'tab' });
  const navigateTab = React.useCallback(t => {
    setTab(t);
    setScreen({ type: 'tab' });
    const path = `/pelaa/${TAB_SLUGS[t]}`;
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
  }, []);
  React.useEffect(() => {
    const path = window.location.pathname;
    if (path === '/pelaa' || path === '/pelaa/') window.history.replaceState(null, '', `/pelaa/${TAB_SLUGS[tab]}`);
    const onPopState = () => { setTab(tabFromPath(window.location.pathname)); setScreen({ type: 'tab' }); };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const showSidebar = tab === 'players' || tab === 'challenges' || tab === 'messages';
  const popup = POPUP_SCREEN_TYPES.includes(screen.type) ? screen : null;

  if (screen.type === 'chat') return <div className="app-shell"><TopNav tab={tab} onTabChange={navigateTab}/><div className="app-body"><div className="app-full" style={{display:'flex',flexDirection:'column'}}><ChatScreen conversation={screen.conversation} onBack={back}/></div></div></div>;
  if (screen.type === 'blocked') return <div className="app-shell"><TopNav tab={tab} onTabChange={navigateTab}/><div className="app-body"><div className="app-full clay-bg"><BlockedProfilesScreen onBack={back}/></div></div></div>;
  if (screen.type === 'archive') return <div className="app-shell"><TopNav tab={tab} onTabChange={navigateTab}/><div className="app-body"><div className="app-full"><ArchivedConversationsScreen onBack={back} onOpenChat={c => setScreen({ type: 'chat', conversation: c })}/></div></div></div>;

  return (
    <div className="app-shell">
      <TopNav tab={tab} onTabChange={navigateTab} />
      <div className="app-body clay-bg">
        {showSidebar && (
          <div className="app-sidebar">
            <SidebarProfile onEdit={() => navigateTab('profile')} />
          </div>
        )}
        <div className="app-main">
          {tab === 'players' && <PlayersScreen onOpenPlayer={p => setScreen({ type: 'playerDetail', player: p })} />}
          {tab === 'challenges' && <ChallengesScreen refreshKey={challengesRefreshKey} onOpenChallenge={c => setScreen({ type: 'challengeDetail', challenge: c })} onCreateChallenge={() => setScreen({ type: 'createChallenge' })} />}
          {tab === 'messages' && <MessagesScreen onOpenChat={c => setScreen({ type: 'chat', conversation: c })} onCreateChallenge={() => setScreen({ type: 'createChallenge' })} onOpenArchive={() => setScreen({ type: 'archive' })} />}
          {tab === 'profile' && <ProfileFullScreen onOpenBlocked={() => setScreen({ type: 'blocked' })} />}
        </div>
      </div>
      {popup?.type === 'playerDetail' && <div className="modal-overlay" onClick={back}>
        <div className="modal-sheet" style={{ maxWidth:520 }} onClick={e=>e.stopPropagation()}>
          <PlayerDetail player={popup.player} onBack={back} currentUserId={session?.user?.id}/>
        </div>
      </div>}
      {popup?.type === 'challengeDetail' && <div className="modal-overlay" onClick={back}>
        <div className="modal-sheet" style={{ maxWidth:520 }} onClick={e=>e.stopPropagation()}>
          <ChallengeDetail challenge={popup.challenge} onBack={back} onOpenChat={c => setScreen({ type: 'chat', conversation: c })} currentUserId={session?.user?.id}/>
        </div>
      </div>}
      {popup?.type === 'createChallenge' && <div className="modal-overlay" onClick={back}>
        <div className="modal-sheet" style={{ maxWidth:520 }} onClick={e=>e.stopPropagation()}>
          <CreateChallengeScreen onBack={back} onCreated={()=>{ back(); setChallengesRefreshKey(k=>k+1); }}/>
        </div>
      </div>}
    </div>
  );
}

// ── Root ───────────────────────────────────────────────
function KrossiWebApp() {
  const { session, loading, needsOnboarding, refreshProfile } = useAuth();
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('stripe')) return;
    if (params.get('stripe') === 'success') refreshProfile();
    params.delete('stripe');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, [refreshProfile]);
  if (loading) return <div className="auth-shell clay-bg"><span style={{fontSize:40,fontWeight:800,color:'var(--lime)',letterSpacing:-1.5}}>Krossi</span><div style={{marginTop:20}}><div className="spinner"/></div></div>;
  if (!session) return <AuthScreen />;
  if (needsOnboarding) return <OnboardingScreen />;
  return <><AppShell /><PendingOutcomeCheck /></>;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <AuthProvider><KrossiWebApp /></AuthProvider>
);
