// koutsi-valmentaja-app.jsx — full-page coach web app for koutsi.krossi.app/valmentaja.
// Reads/writes the real Supabase-backed store from koutsi-data.js (see koutsi-auth.jsx
// for the login/onboarding gate this file is mounted behind), so changes made here show
// up on the player's device too, live. The sales demo at demo.koutsi.krossi.app runs this
// very file — lib/koutsi-demo-backend.jsx swaps an in-memory store in underneath
// koutsi-data.js.

const TAG_LABELS = { kaikki: 'Kaikki', syotto: 'Syöttö', liikkuminen: 'Liikkuminen', pistepeli: 'Pistepeli', verkkopeli: 'Verkkopeli', tekniikka: 'Tekniikka', lammittely: 'Lämmittely', fysiikka: 'Fysiikka', drilli: 'Drilli' };
const EXERCISE_TAGS = ['kaikki', 'syotto', 'liikkuminen', 'pistepeli', 'verkkopeli', 'tekniikka', 'lammittely', 'fysiikka', 'drilli'];
const CAL_WEEKDAY_LABELS = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];
// Every training slot is quarter-hour, so the same list of lengths works for a 45 min
// junior session all the way up to a 3 h camp block.
const PLAYER_COUNT_FILTERS = [
  { key: 'kaikki', label: 'Kaikki' },
  { key: 1, label: '1 pelaaja' },
  { key: 2, label: '2 pelaajaa' },
  { key: 3, label: '3 pelaajaa' },
  { key: 4, label: '4+ pelaajaa' },
];
function playerAgeLabel(player) {
  return player.ageLabel || (player.age == null ? '' : `${player.age} v`);
}

// `src` on profiilikuva, jos sellainen on ladattu; ilman sitä (tai jos kuva ei lataudu)
// näytetään sama nimikirjain-ympyrä kuin ennenkin.
function Avatar({ initial, hue = 150, size = 44, ring = false, src = '' }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { setFailed(false); }, [src]);
  const shell = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
    background: `radial-gradient(120% 120% at 30% 20%, hsl(${hue} 55% 62%), hsl(${hue + 24} 60% 38%))`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#fff', fontWeight: 700, fontSize: size * 0.38,
    boxShadow: ring ? '0 0 0 3px var(--lime)' : 'none', letterSpacing: 0.3,
  };
  return (
    <div style={shell}>
      {src && !failed
        ? <img src={src} alt="" onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        : initial}
    </div>
  );
}
function AvatarStack({ members, size = 34, max = 4 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {members.slice(0, max).map((m, i) => (
        <div key={m.id} style={{ marginLeft: i > 0 ? -Math.round(size * 0.28) : 0, position: 'relative', zIndex: max - i }}>
          <Avatar src={m.avatarUrl} initial={m.initial} hue={m.hue} size={size} ring />
        </div>
      ))}
    </div>
  );
}

function PageHeader({ title, sub, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 22, gap: 16, flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.5, color: 'var(--green-deep)' }}>{title}</h1>
        {sub && <p style={{ fontSize: 14.5, color: '#8a857a', marginTop: 4 }}>{sub}</p>}
      </div>
      {action}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontWeight: 800, fontSize: 12.5, color: 'var(--green-deep)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>{label}</div>
      {children}
    </div>
  );
}

// Bucket on yksityinen, joten toisto hakee allekirjoitetun linkin klikattaessa.
function VideoPlayerModal({ video, onClose }) {
  const [url, setUrl] = React.useState(null);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    let cancelled = false;
    if (!video.storagePath) { setUrl(null); return; }
    window.koutsiVideoUrl(video.storagePath)
      .then((u) => { if (!cancelled) setUrl(u); })
      .catch((e) => { if (!cancelled) setError(e.message || 'Videota ei voitu avata'); });
    return () => { cancelled = true; };
  }, [video.storagePath]);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(10,15,10,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(760px, 100%)' }}>
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 15, marginBottom: 10 }}>{video.title}</div>
        {error && <div style={{ background: '#fff', borderRadius: 12, padding: 16, color: '#a13b2f', fontSize: 13.5 }}>{error}</div>}
        {!error && !url && video.storagePath && <div style={{ background: '#fff', borderRadius: 12, padding: 16, color: '#8a857a', fontSize: 13.5 }}>Avataan videota…</div>}
        {url && <video src={url} controls autoPlay playsInline style={{ width: '100%', borderRadius: 14, background: '#000', maxHeight: '75vh' }} />}
        {!video.storagePath && video.externalUrl && (
          <div style={{ background: '#fff', borderRadius: 12, padding: 18 }}>
            <div style={{ fontSize: 13.5, color: '#514c42', marginBottom: 12 }}>Tämä video on jaettu linkkinä.</div>
            <a href={video.externalUrl} target="_blank" rel="noopener noreferrer" className="btn-dark" style={{ display: 'inline-block', textDecoration: 'none', padding: '11px 18px' }}>Avaa video</a>
          </div>
        )}
        <button onClick={onClose} className="btn-outline" style={{ marginTop: 12, background: '#fff' }}>Sulje</button>
      </div>
    </div>
  );
}

// A video is now either an uploaded file (private bucket, opened through a signed URL)
// or an external link. Both are actually openable — previously the tile was decorative.
function VideoTile({ video, onDelete, onEditAudience }) {
  const [playing, setPlaying] = React.useState(false);
  const opening = false;
  const playable = Boolean(video.storagePath || video.externalUrl);
  const open = () => setPlaying(true);

  return (
    <div style={{ width: 150, flexShrink: 0 }}>
      {playing && <VideoPlayerModal video={video} onClose={() => setPlaying(false)} />}
      <button onClick={playable ? open : undefined} disabled={!playable || opening} style={{
        width: '100%', aspectRatio: '4/3', borderRadius: 14, position: 'relative', overflow: 'hidden', padding: 0,
        border: 'none', cursor: playable ? 'pointer' : 'default', fontFamily: 'inherit',
        background: `radial-gradient(120% 120% at 30% 20%, hsl(${video.hue} 55% 45%), hsl(${video.hue + 24} 60% 22%))`,
      }}>
        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ width: 38, height: 38, borderRadius: '50%', background: playable ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {opening
              ? <span style={{ width: 15, height: 15, border: '2px solid rgba(0,0,0,0.25)', borderTopColor: '#101a08', borderRadius: '50%', animation: 'kcSpin .7s linear infinite' }} />
              : <svg width="13" height="15" viewBox="0 0 12 14"><path d="M1 1v12l10-6L1 1z" fill="#101a08" /></svg>}
          </span>
        </span>
        {video.addedBy === 'player' && <span style={{ position: 'absolute', left: 7, top: 7, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6 }}>Pelaaja</span>}
        {video.externalUrl && <span style={{ position: 'absolute', right: 7, top: 7, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6 }}>Linkki</span>}
      </button>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 7 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: '#111', fontSize: 12.5, fontWeight: 600, lineHeight: 1.35 }}>{video.title}</div>
          <div style={{ color: '#8a857a', fontSize: 11, marginTop: 2 }}>{window.koutsiFmtShortDate(video.date)}</div>
        </div>
        {video.addedBy === 'coach' && (onDelete || onEditAudience) && (
          <window.KoutsiRowActions
            onEdit={onEditAudience ? () => onEditAudience(video) : null}
            onDelete={onDelete ? () => onDelete(video) : null}
            editLabel="Muokkaa videon näkyvyyttä"
            deleteLabel="Poista jako tältä pelaajalta" />
        )}
      </div>
      {video.addedBy === 'coach' && video.recipientIds?.length > 0 && (
        <div style={{ color: '#6f6a60', fontSize: 10.5, marginTop: 4 }}>
          Näkyy {video.recipientIds.length === 1 ? '1 pelaajalle' : `${video.recipientIds.length} pelaajalle`}
        </div>
      )}
      {video.tags && video.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          {video.tags.map((t) => <span key={t} className="k-chip" style={{ padding: '2px 8px', fontSize: 10.5 }}>{window.KOUTSI_TAG_LABELS[t] || t}</span>)}
        </div>
      )}
    </div>
  );
}

function VideoRow({ videos, onDelete, onEditAudience }) {
  if (!videos.length) return <div style={{ color: '#8a857a', fontSize: 14 }}>Ei vielä jaettuja videoita.</div>;
  return (
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 2 }}>
      {videos.map((v) => <VideoTile key={v.id} video={v} onDelete={onDelete} onEditAudience={onEditAudience} />)}
    </div>
  );
}

function CloseButton({ onClick }) {
  return (
    <button onClick={onClick} aria-label="Sulje" style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid var(--line)', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="14" height="14" viewBox="0 0 14 14"><path d="M1 1l12 12M13 1L1 13" stroke="#111" strokeWidth="1.6" strokeLinecap="round" /></svg>
    </button>
  );
}
function ChevronRight() {
  return <svg width="8" height="14" viewBox="0 0 8 14" style={{ flexShrink: 0 }}><path d="M1 1l6 6-6 6" stroke="#c5c0b5" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function LevelChip({ level }) {
  const c = window.koutsiLevelColor(level);
  return <span style={{ display: 'inline-flex', alignItems: 'center', padding: '5px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, lineHeight: 1, background: c.bg, color: c.fg, border: `1px solid ${c.border}` }}>{level}</span>;
}
function PlayerAppStatus({ isPlaceholder, compact = false }) {
  const waiting = Boolean(isPlaceholder);
  return (
    <span title={waiting ? 'Pelaaja on tallennettu nimellä, mutta ei ole vielä lunastanut profiiliaan.' : 'Pelaaja on lunastanut profiilinsa ja käyttää pelaajasovellusta.'} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, width: 'fit-content',
      padding: compact ? '4px 8px' : '5px 10px', borderRadius: 999,
      fontSize: compact ? 10.5 : 11.5, fontWeight: 750, lineHeight: 1.1,
      color: waiting ? '#8a5a12' : '#2f7d54',
      background: waiting ? 'rgba(214,140,44,0.12)' : 'rgba(47,125,84,0.10)',
      border: `1px solid ${waiting ? 'rgba(214,140,44,0.30)' : 'rgba(47,125,84,0.24)'}`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: waiting ? '#d68c2c' : '#46a66d', flexShrink: 0 }} />
      {waiting ? 'Ei vielä kirjautunut' : 'Pelaajasovellus käytössä'}
    </span>
  );
}
// `label` distinguishes the theme running this week from one planned for a later week.
function PlayerAppStatus({ isPlaceholder, compact = false }) {
  const waiting = Boolean(isPlaceholder);
  return (
    <span title={waiting ? 'Pelaaja on tallennettu nimellä, mutta ei ole vielä lunastanut profiiliaan.' : 'Pelaaja on lunastanut profiilinsa ja käyttää pelaajasovellusta.'} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, width: 'fit-content',
      padding: compact ? '4px 8px' : '5px 10px', borderRadius: 999,
      fontSize: compact ? 10.5 : 11.5, fontWeight: 750, lineHeight: 1.1,
      color: waiting ? '#8a5a12' : '#2f7d54',
      background: waiting ? 'rgba(214,140,44,0.12)' : 'rgba(47,125,84,0.10)',
      border: `1px solid ${waiting ? 'rgba(214,140,44,0.30)' : 'rgba(47,125,84,0.24)'}`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: waiting ? '#d68c2c' : '#46a66d', flexShrink: 0 }} />
      {waiting ? 'Ei vielä kirjautunut' : 'Pelaajasovellus käytössä'}
    </span>
  );
}

function GroupThemeBanner({ theme, label }) {
  if (!theme) return null;
  return (
    <div className="k-card" style={{ padding: '16px 18px', background: 'linear-gradient(135deg, rgba(207,228,20,0.16), rgba(14,59,44,0.05))', borderColor: 'rgba(14,59,44,0.14)' }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--green-deep)', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 5 }}>
        {label || 'Viikon teema'}{theme.week ? ` · vko ${theme.week}` : ''}
      </div>
      <div style={{ fontSize: 15.5, fontWeight: 800, color: '#111', marginBottom: 4 }}>{theme.title}</div>
      {theme.lead && <div style={{ fontSize: 13, color: '#514c42', lineHeight: 1.5 }}>{theme.lead}</div>}
    </div>
  );
}

// ── Oppilaat ─────────────────────────────────────────────
function InviteStudentModal({ coachId, coachName, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(420px, 100%)', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 6 }}>Kutsu uusi oppilas</h3>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 16, lineHeight: 1.5 }}>Pelaaja voi liittyä tällä koodilla ilman ikätietoa. Henkilökohtainen linkki syntyy, kun lisäät pelaajan ensin nimellä oppilaslistaan.</p>
        <InviteCodeBox coachId={coachId} coachName={coachName} groupId={null} groupName={null} />
        <button onClick={onClose} className="btn-outline" style={{ width: '100%', padding: '13px 0', marginTop: 16 }}>Sulje</button>
      </div>
    </div>
  );
}

// Pelaajan lisäys pelkällä nimellä: valmentaja pääsee heti töihin, eikä
// pelaajan tarvitse luoda tiliä. Pelaaja voi myöhemmin lunastaa profiilin
// valmentajan koodilla, jolloin kaikki kirjattu työ seuraa mukana.
function AddPlayerModal({ onClose, onSave }) {
  const [name, setName] = React.useState('');
  const [age, setAge] = React.useState('');
  const [level, setLevel] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const parsedAge = age ? Number(age) : null;
  const ageValid = parsedAge == null || (Number.isInteger(parsedAge) && parsedAge >= 1 && parsedAge < 120);
  const ready = name.trim() && ageValid && !busy;
  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };
  const label = { fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 };
  const submit = async () => {
    if (!ready) return;
    setBusy(true); setError('');
    try { await onSave({
      name: name.trim(), age: parsedAge, level: level.trim() || null,
    }); }
    catch (err) { setError(window.koutsiErrorText(err, 'Pelaajan lisäys epäonnistui')); setBusy(false); }
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(440px, 100%)', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 6 }}>Lisää pelaaja</h3>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 16, lineHeight: 1.5 }}>
          Nimi riittää. Iän voi lisätä nyt tai myöhemmin, mutta sen voi myös jättää kokonaan kertomatta.
          Älä kirjoita terveystietoja.
        </p>
        {error && <div style={{ background: 'rgba(161,59,47,0.08)', border: '1px solid rgba(161,59,47,0.25)', color: '#a13b2f', padding: '10px 14px', borderRadius: 12, fontSize: 13, marginBottom: 14 }}>{error}</div>}
        <div style={label}>Nimi</div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Esim. Onni Virtanen" style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={label}>Ikä (valinnainen)</div>
        <input value={age} onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="24" style={{ ...inputStyle, marginBottom: age && !ageValid ? 6 : 16, borderColor: age && !ageValid ? '#c2543f' : '#d8d4ca' }} />
        {age && !ageValid && <div style={{ fontSize: 12, color: '#c2543f', marginBottom: 16 }}>Iän pitää olla väliltä 1–119 vuotta.</div>}
        <div style={label}>Taso (valinnainen)</div>
        <input value={level} onChange={(e) => setLevel(e.target.value)} placeholder="Aloittelija" style={{ ...inputStyle, marginBottom: 20 }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={busy} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={submit} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: ready ? 1 : 0.45, cursor: ready ? 'pointer' : 'default' }}>{busy ? 'Lisätään…' : 'Lisää'}</button>
        </div>
      </div>
    </div>
  );
}

// The fast start keeps the coach's hand-entered players, groups and weekly themes in one
// reviewed transaction. A shared workbook can be sent alongside them for admin review.
function BulkSetupModal({ groups, coachId, onClose, onSave }) {
  const now = window.koutsiCurrentIsoWeek();
  const groupSeq = React.useRef(2);
  const slotSeq = React.useRef(1);
  const playerSeq = React.useRef(5);
  const themeSeq = React.useRef(1);
  const [step, setStep] = React.useState(0);
  const [newGroups, setNewGroups] = React.useState(() => groups.length ? [] : [
    { key: 'new-1', name: '', level: '', day: 'Ma', time: '', duration: 60, extraSlots: [] },
  ]);
  const [players, setPlayers] = React.useState(() => Array.from({ length: 4 }, (_, i) => ({
    key: `player-${i + 1}`, name: '', age: '', level: '', groupKey: '',
  })));
  const [themeRows, setThemeRows] = React.useState([]);
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [pasteText, setPasteText] = React.useState('');
  const [pasteGroupKey, setPasteGroupKey] = React.useState('');
  const [sharedPlanBusy, setSharedPlanBusy] = React.useState(false);
  const [sharedPlanSent, setSharedPlanSent] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [result, setResult] = React.useState(null);

  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 12, padding: '10px 11px', fontSize: 13.5, fontFamily: 'inherit', color: '#111', background: '#fff' };
  const labelStyle = { fontSize: 11, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5 };
  const days = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];
  const steps = ['Ryhmät', 'Pelaajat', 'Viikkoteemat', 'Tarkista'];

  const startedGroups = newGroups.filter((g) => g.name.trim() || g.level.trim() || g.time);
  const incompleteGroup = startedGroups.some((g) => !g.name.trim() || !g.time || (g.extraSlots || []).some((s) => !s.time));
  const filledPlayers = players.filter((p) => p.name.trim());
  const invalidPlayerAge = filledPlayers.some((p) => {
    if (!p.age) return false;
    const value = Number(p.age);
    return !Number.isInteger(value) || value < 1 || value >= 120;
  });
  const duplicatePlayerNames = (() => {
    const seen = new Set();
    return filledPlayers.some((p) => {
      const key = p.name.trim().toLocaleLowerCase('fi');
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    });
  })();
  const groupOptions = [
    ...groups.map((g) => ({ key: `existing:${g.id}`, name: g.name, existing: true, group: g })),
    ...startedGroups.filter((g) => g.name.trim() && g.time).map((g) => ({ key: g.key, name: g.name.trim(), existing: false, group: g })),
  ];
  const groupOptionByKey = new Map(groupOptions.map((g) => [g.key, g]));

  const updateGroup = (key, patch) => setNewGroups((prev) => prev.map((g) => g.key === key ? { ...g, ...patch } : g));
  const addGroup = () => setNewGroups((prev) => [...prev, { key: `new-${groupSeq.current++}`, name: '', level: '', day: 'Ma', time: '', duration: 60, extraSlots: [] }]);
  const removeGroup = (key) => {
    setNewGroups((prev) => prev.filter((g) => g.key !== key));
    setPlayers((prev) => prev.map((p) => p.groupKey === key ? { ...p, groupKey: '' } : p));
    setThemeRows((prev) => prev.filter((r) => r.groupKey !== key));
  };
  // A group in the wizard can already get a second (or third) weekly time here, instead
  // of only through the group's own page after the fact.
  const addGroupExtraSlot = (groupKey) => setNewGroups((prev) => prev.map((g) => g.key === groupKey
    ? { ...g, extraSlots: [...(g.extraSlots || []), { id: `slot-${slotSeq.current++}`, day: 'Ma', time: '', duration: 60 }] }
    : g));
  const updateGroupExtraSlot = (groupKey, slotId, patch) => setNewGroups((prev) => prev.map((g) => g.key === groupKey
    ? { ...g, extraSlots: (g.extraSlots || []).map((s) => s.id === slotId ? { ...s, ...patch } : s) }
    : g));
  const removeGroupExtraSlot = (groupKey, slotId) => setNewGroups((prev) => prev.map((g) => g.key === groupKey
    ? { ...g, extraSlots: (g.extraSlots || []).filter((s) => s.id !== slotId) }
    : g));
  const updatePlayer = (key, patch) => setPlayers((prev) => prev.map((p) => p.key === key ? { ...p, ...patch } : p));
  const addPlayerRow = (defaults = {}) => setPlayers((prev) => [...prev, {
    key: `player-${playerSeq.current++}`, name: '', age: '', level: '', groupKey: '', ...defaults,
  }]);
  const removePlayer = (key) => setPlayers((prev) => prev.filter((p) => p.key !== key));

  const importNames = () => {
    const names = window.koutsiParseNameList(pasteText);
    if (!names.length) { setError('Liitä vähintään yksi nimi omalle rivilleen.'); return; }
    const empty = players.filter((p) => !p.name.trim());
    let emptyIndex = 0;
    const additions = [];
    const updates = new Map();
    names.forEach((name) => {
      if (emptyIndex < empty.length) {
        updates.set(empty[emptyIndex].key, { name, groupKey: pasteGroupKey });
        emptyIndex += 1;
      } else additions.push({ key: `player-${playerSeq.current++}`, name, age: '', level: '', groupKey: pasteGroupKey });
    });
    setPlayers((prev) => [...prev.map((p) => updates.has(p.key) ? { ...p, ...updates.get(p.key) } : p), ...additions]);
    setPasteText(''); setPasteOpen(false); setError('');
  };
  const sendSharedPlan = async (file) => {
    if (!file) return;
    setSharedPlanBusy(true); setError('');
    try {
      await window.koutsiUploadSharedAnnualPlan(coachId, file);
      setSharedPlanSent(file.name);
    } catch (err) {
      setError(window.koutsiErrorText(err, 'Vuosisuunnitelman lähetys epäonnistui.'));
    } finally { setSharedPlanBusy(false); }
  };

  const involvedGroupKeys = React.useMemo(() => {
    const keys = new Set(startedGroups.filter((g) => g.name.trim() && g.time).map((g) => g.key));
    filledPlayers.forEach((p) => { if (p.groupKey && groupOptionByKey.has(p.groupKey)) keys.add(p.groupKey); });
    themeRows.forEach((r) => { if (r.title.trim() && groupOptionByKey.has(r.groupKey)) keys.add(r.groupKey); });
    return [...keys];
  }, [startedGroups, filledPlayers, themeRows, groupOptions]);

  const ensureThemeRows = () => {
    setThemeRows((prev) => {
      const next = prev.slice();
      involvedGroupKeys.forEach((groupKey) => {
        if (next.some((r) => r.groupKey === groupKey)) return;
        const option = groupOptionByKey.get(groupKey);
        const existing = option?.existing
          ? (option.group.themes || []).find((t) => t.year === now.year && t.week === now.week)
          : null;
        next.push({
          key: `theme-${themeSeq.current++}`, groupKey, year: now.year, week: now.week,
          title: existing?.title || '', lead: existing?.lead || '',
        });
      });
      return next;
    });
  };
  const weekOptions = React.useMemo(() => {
    const years = [...new Set([now.year, now.year + 1, ...themeRows.map((row) => row.year)])].sort((a, b) => a - b);
    return years.flatMap((year) => Array.from({ length: window.koutsiWeeksInIsoYear(year) }, (_, index) => ({
      year, week: index + 1, isNow: year === now.year && index + 1 === now.week,
    })));
  }, [now.year, now.week, themeRows]);
  const addThemeWeek = (groupKey) => {
    const rows = themeRows.filter((r) => r.groupKey === groupKey).sort(window.koutsiCompareIsoWeeks);
    const nextWeek = rows.length ? window.koutsiAddIsoWeeks(rows[rows.length - 1], 1) : now;
    setThemeRows((prev) => [...prev, { key: `theme-${themeSeq.current++}`, groupKey, ...nextWeek, title: '', lead: '' }]);
  };
  const updateTheme = (key, patch) => setThemeRows((prev) => prev.map((r) => r.key === key ? { ...r, ...patch } : r));
  const removeTheme = (key) => setThemeRows((prev) => prev.filter((r) => r.key !== key));
  const filledThemes = themeRows.filter((r) => r.title.trim() && groupOptionByKey.has(r.groupKey));
  const duplicateThemeWeeks = (() => {
    const seen = new Set();
    return filledThemes.some((r) => {
      const key = `${r.groupKey}:${r.year}-${r.week}`;
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    });
  })();

  const payload = React.useMemo(() => {
    const used = new Set(involvedGroupKeys);
    const importGroups = groupOptions.filter((g) => used.has(g.key)).map((option) => option.existing ? {
      client_id: option.key, existing_id: option.group.id,
    } : {
      client_id: option.key, existing_id: null, name: option.group.name.trim(),
      level: option.group.level.trim() || null, day: option.group.day, time: option.group.time,
      duration_minutes: option.group.duration || 60,
    });
    return {
      groups: importGroups,
      players: filledPlayers.map((p) => ({
        name: p.name.trim(), age: p.age ? Number(p.age) : null, level: p.level.trim() || null,
        group_refs: p.groupKey && used.has(p.groupKey) ? [p.groupKey] : [],
      })),
      themes: filledThemes.map((r) => ({
        group_ref: r.groupKey, year: r.year, week: r.week,
        title: r.title.trim(), lead: r.lead.trim() || null,
      })),
      // Extra weekly times only apply to groups this wizard is creating (not reused
      // existing ones) — attached client-side after the group exists, via its real id.
      extraSlots: groupOptions
        .filter((g) => used.has(g.key) && !g.existing && (g.group.extraSlots || []).some((s) => s.time))
        .map((g) => ({
          clientId: g.key,
          slots: g.group.extraSlots.filter((s) => s.time).map((s) => ({ day: s.day, time: s.time, duration: s.duration || 60 })),
        })),
    };
  }, [groupOptions, involvedGroupKeys, filledPlayers, filledThemes]);

  const next = () => {
    setError('');
    if (step === 0 && incompleteGroup) { setError('Täytä uuden ryhmän nimi ja kellonaika tai poista keskeneräinen rivi.'); return; }
    if (step === 1 && filledPlayers.length === 0 && groupOptions.length === 0) { setError('Lisää vähintään yksi pelaaja tai ryhmä.'); return; }
    if (step === 1 && invalidPlayerAge) { setError('Iän pitää olla väliltä 1–119 vuotta. Iän voi myös jättää tyhjäksi.'); return; }
    if (step === 1 && duplicatePlayerNames) { setError('Samanniminen pelaaja on listalla kahdesti. Tarkista nimet ennen jatkamista.'); return; }
    if (step === 1) ensureThemeRows();
    if (step === 2 && duplicateThemeWeeks) { setError('Samalle ryhmälle on kaksi teemaa samalla viikolla.'); return; }
    setStep((s) => Math.min(3, s + 1));
  };
  const save = async () => {
    setBusy(true); setError('');
    try {
      const saved = await onSave(payload);
      setResult(saved || {
        players_created: payload.players.length,
        groups_created: payload.groups.filter((g) => !g.existing_id).length,
        groups_reused: payload.groups.filter((g) => g.existing_id).length,
        themes_saved: payload.themes.length,
      });
    } catch (err) {
      setError(window.koutsiErrorText(err, 'Käyttöönoton tallennus epäonnistui.'));
    } finally { setBusy(false); }
  };

  const modalHeader = (
    <div style={{ padding: '22px 26px 16px', borderBottom: '1px solid var(--line)', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 5 }}>Nopea käyttöönotto</div>
          <h2 style={{ fontSize: 21, fontWeight: 800, color: 'var(--green-deep)' }}>Lisää monta kerralla</h2>
        </div>
        <CloseButton onClick={onClose} />
      </div>
      {!result && (
        <div className="kv-bulk-progress" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 18 }}>
          {steps.map((title, i) => (
            <div key={title} style={{ minWidth: 0 }}>
              <div style={{ height: 4, borderRadius: 999, background: i <= step ? 'var(--green-deep)' : '#e8e4da', marginBottom: 7 }} />
              <div style={{ fontSize: 11.5, fontWeight: i === step ? 800 : 650, color: i <= step ? 'var(--green-deep)' : '#a8a297' }}>{i + 1}. {title}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 85, background: 'rgba(10,15,10,0.52)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" role="dialog" aria-modal="true" aria-label="Lisää monta kerralla" style={{ width: 'min(920px, 100%)', height: 'min(760px, calc(100vh - 32px))', overflow: 'hidden', display: 'flex', flexDirection: 'column', animation: 'kFadeIn .2s ease' }}>
        {modalHeader}

        {result ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: '34px 28px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 'min(560px, 100%)', textAlign: 'center' }}>
              <div style={{ width: 58, height: 58, borderRadius: '50%', margin: '0 auto 17px', background: 'var(--lime)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="25" height="20" viewBox="0 0 24 19"><path d="M2 9.5l6.2 6.2L22 2" fill="none" stroke="#101a08" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
              <h3 style={{ fontSize: 24, fontWeight: 800, color: 'var(--green-deep)', marginBottom: 8 }}>Hyvä — pohjat ovat valmiina!</h3>
              <p style={{ fontSize: 14.5, color: '#514c42', lineHeight: 1.6, margin: '0 auto 22px', maxWidth: 500 }}>
                Ryhmät, pelaajat ja viikkoteemat on tallennettu. Voit suunnitella treenejä heti ja lähettää mahdolliset liittymiskutsut myöhemmin.
              </p>
              <div className="kv-bulk-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 22 }}>
                {[
                  ['Pelaajia', result.players_created || 0],
                  ['Uusia ryhmiä', result.groups_created || 0],
                  ['Viikkoteemoja', result.themes_saved || 0],
                ].map(([title, count]) => (
                  <div key={title} className="k-card" style={{ padding: '15px 10px' }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#111' }}>{count}</div>
                    <div style={{ fontSize: 11.5, color: '#8a857a', marginTop: 3 }}>{title}</div>
                  </div>
                ))}
              </div>
              <div className="k-card" style={{ padding: '14px 16px', textAlign: 'left', background: 'rgba(214,140,44,0.08)', borderColor: 'rgba(214,140,44,0.26)', marginBottom: 22 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#8a5a12', marginBottom: 4 }}>Kutsut voi lähettää myöhemmin</div>
                <div style={{ fontSize: 13, color: '#514c42', lineHeight: 1.5 }}>Oppilaslistassa näet merkinnästä, kuka ei ole vielä kirjautunut. Avaa pelaajan kortti, kun haluat kopioida hänelle liittymisviestin.</div>
              </div>
              <button onClick={onClose} className="btn-dark" style={{ padding: '13px 26px' }}>Siirry oppilaslistaan</button>
            </div>
          </div>
        ) : (
          <React.Fragment>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '22px 26px 28px', background: '#fbfaf7' }}>
              {error && <div role="alert" style={{ background: 'rgba(161,59,47,0.08)', border: '1px solid rgba(161,59,47,0.25)', color: '#a13b2f', padding: '10px 14px', borderRadius: 12, fontSize: 13, marginBottom: 16 }}>{error}</div>}

              {step === 0 && (
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 5 }}>Mitkä ryhmät ovat käytössä?</h3>
                  <p style={{ fontSize: 13.5, color: '#514c42', lineHeight: 1.55, marginBottom: 18 }}>Olemassa olevat ryhmät ovat heti valittavissa pelaajariveillä. Luo tässä vain puuttuvat ryhmät — yksityisoppilaan voi jättää ilman ryhmää.</p>
                  {groups.length > 0 && (
                    <div className="k-card" style={{ padding: '14px 16px', marginBottom: 18 }}>
                      <div style={{ ...labelStyle, marginBottom: 9 }}>Olemassa olevat ryhmät ({groups.length})</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                        {groups.map((g) => <span key={g.id} className="k-chip">{g.name} · {g.day} {window.koutsiTimeRangeLabel(g.time, g.durationMinutes)}</span>)}
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {newGroups.map((g, index) => (
                      <div key={g.key} className="k-card" style={{ padding: '13px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 9 }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--green-deep)' }}>Uusi ryhmä {index + 1}</div>
                          <button onClick={() => removeGroup(g.key)} aria-label="Poista ryhmärivi" style={{ border: 'none', background: 'transparent', color: '#8a857a', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Poista</button>
                        </div>
                        <div className="kv-bulk-group-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 1.6fr) minmax(130px, 1fr) 92px 112px 120px', gap: 9 }}>
                          <div><div style={{ ...labelStyle, marginBottom: 6 }}>Ryhmän nimi *</div><input value={g.name} onChange={(e) => updateGroup(g.key, { name: e.target.value })} placeholder="Esim. Tiistain aikuiset" style={inputStyle} /></div>
                          <div><div style={{ ...labelStyle, marginBottom: 6 }}>Taso</div><input value={g.level} onChange={(e) => updateGroup(g.key, { level: e.target.value })} placeholder="Keskitaso" style={inputStyle} /></div>
                          <div><div style={{ ...labelStyle, marginBottom: 6 }}>Päivä</div><select value={g.day} onChange={(e) => updateGroup(g.key, { day: e.target.value })} style={inputStyle}>{days.map((d) => <option key={d}>{d}</option>)}</select></div>
                          <div><div style={{ ...labelStyle, marginBottom: 6 }}>Klo *</div><input type="time" step={900} value={g.time} onChange={(e) => updateGroup(g.key, { time: window.koutsiRoundTimeToQuarterHour(e.target.value) })} onClick={(e) => e.currentTarget.showPicker?.()} style={inputStyle} /></div>
                          <div><div style={{ ...labelStyle, marginBottom: 6 }}>Kesto (min)</div><input type="number" inputMode="numeric" min={15} max={480} step={15} value={g.duration || 60} onChange={(e) => updateGroup(g.key, { duration: e.target.value === '' ? '' : Number(e.target.value) })} onBlur={() => updateGroup(g.key, { duration: window.koutsiRoundToQuarterHourMinutes(g.duration || 60) })} style={inputStyle} /></div>
                        </div>
                        {g.time && <div style={{ fontSize: 11.5, color: '#8a857a', marginTop: 7 }}>Treenit ilmestyvät kalenteriin: {g.day} klo {window.koutsiTimeRangeLabel(g.time, g.duration || 60)} viikoittain</div>}
                        {(g.extraSlots || []).map((slot) => (
                          <div key={slot.id} className="kv-bulk-group-row" style={{ display: 'grid', gridTemplateColumns: '92px 112px 120px 60px', gap: 9, marginTop: 9, alignItems: 'end' }}>
                            <div><div style={{ ...labelStyle, marginBottom: 6 }}>Lisäpäivä</div><select value={slot.day} onChange={(e) => updateGroupExtraSlot(g.key, slot.id, { day: e.target.value })} style={inputStyle}>{days.map((d) => <option key={d}>{d}</option>)}</select></div>
                            <div><div style={{ ...labelStyle, marginBottom: 6 }}>Klo *</div><input type="time" step={900} value={slot.time} onChange={(e) => updateGroupExtraSlot(g.key, slot.id, { time: window.koutsiRoundTimeToQuarterHour(e.target.value) })} onClick={(e) => e.currentTarget.showPicker?.()} style={inputStyle} /></div>
                            <div><div style={{ ...labelStyle, marginBottom: 6 }}>Kesto (min)</div><input type="number" inputMode="numeric" min={15} max={480} step={15} value={slot.duration || 60} onChange={(e) => updateGroupExtraSlot(g.key, slot.id, { duration: e.target.value === '' ? '' : Number(e.target.value) })} onBlur={() => updateGroupExtraSlot(g.key, slot.id, { duration: window.koutsiRoundToQuarterHourMinutes(slot.duration || 60) })} style={inputStyle} /></div>
                            <button onClick={() => removeGroupExtraSlot(g.key, slot.id)} aria-label="Poista lisäaika" style={{ border: 'none', background: 'transparent', color: '#8a857a', cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: '10px 0' }}>Poista</button>
                          </div>
                        ))}
                        <button onClick={() => addGroupExtraSlot(g.key)} className="btn-outline btn-sm" style={{ marginTop: 9 }}>+ Toinen harjoitusaika</button>
                      </div>
                    ))}
                  </div>
                  <button onClick={addGroup} className="btn-outline btn-sm" style={{ marginTop: 12 }}>+ Lisää uusi ryhmä</button>
                </div>
              )}

              {step === 1 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                    <div>
                      <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 5 }}>Kirjoita pelaajat riveille</h3>
                      <p style={{ fontSize: 13.5, color: '#514c42', lineHeight: 1.55 }}>Nimi riittää. Iän voi lisätä nyt tai myöhemmin, mutta sen voi myös jättää kokonaan kertomatta.</p>
                    </div>
                    <button onClick={() => { setPasteOpen((v) => !v); setError(''); }} className="btn-outline btn-sm">Liitä nimilista</button>
                  </div>
                  {pasteOpen && (
                    <div className="k-card" style={{ padding: '14px 16px', marginBottom: 14, background: 'rgba(14,59,44,0.03)' }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--green-deep)', marginBottom: 5 }}>Yksi nimi per rivi</div>
                      <p style={{ fontSize: 12.5, color: '#8a857a', lineHeight: 1.45, marginBottom: 10 }}>Voit kopioida nimet suoraan sähköpostista, Excelistä tai joukkueen listasta.</p>
                      <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={5} placeholder={'Onni Virtanen\nAino Laine\nLeevi Niemi'} style={{ ...inputStyle, resize: 'vertical', marginBottom: 9 }} autoFocus />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                        <select value={pasteGroupKey} onChange={(e) => setPasteGroupKey(e.target.value)} aria-label="Nimilistan ryhmä" style={{ ...inputStyle, width: 'min(280px, 100%)' }}>
                          <option value="">Ei ryhmää vielä</option>
                          {groupOptions.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
                        </select>
                        <button onClick={importNames} className="btn-dark btn-sm">Lisää nimet riveiksi</button>
                      </div>
                    </div>
                  )}
                  <div className="kv-bulk-player-head" style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 1.35fr) 76px minmax(120px, .9fr) minmax(160px, 1.15fr) 36px', gap: 8, padding: '0 11px 7px' }}>
                    {['Nimi *', 'Ikä', 'Taso', 'Ryhmä', ''].map((h, i) => <div key={`${h}-${i}`} style={labelStyle}>{h}</div>)}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {players.map((p, index) => (
                      <div key={p.key} className="k-card kv-bulk-player-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 1.35fr) 76px minmax(120px, .9fr) minmax(160px, 1.15fr) 36px', gap: 8, padding: '10px 11px', alignItems: 'center' }}>
                        <input aria-label={`Pelaajan ${index + 1} nimi`} value={p.name} onChange={(e) => updatePlayer(p.key, { name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && index === players.length - 1) { e.preventDefault(); addPlayerRow({ groupKey: p.groupKey }); } }} placeholder="Pelaajan nimi" style={inputStyle} />
                        <input aria-label={`Pelaajan ${index + 1} ikä`} value={p.age} onChange={(e) => updatePlayer(p.key, { age: e.target.value.replace(/[^0-9]/g, '').slice(0, 3) })} inputMode="numeric" placeholder="24" style={inputStyle} />
                        <input aria-label={`Pelaajan ${index + 1} taso`} value={p.level} onChange={(e) => updatePlayer(p.key, { level: e.target.value })} placeholder="Keskitaso" style={inputStyle} />
                        <select aria-label={`Pelaajan ${index + 1} ryhmä`} value={p.groupKey} onChange={(e) => updatePlayer(p.key, { groupKey: e.target.value })} style={inputStyle}>
                          <option value="">Ei ryhmää vielä</option>
                          {groupOptions.map((g) => <option key={g.key} value={g.key}>{g.name}{g.existing ? ' (nykyinen)' : ' (uusi)'}</option>)}
                        </select>
                        <button onClick={() => removePlayer(p.key)} aria-label={`Poista pelaaja ${index + 1}`} style={{ width: 32, height: 32, border: 'none', borderRadius: '50%', background: '#f4f2ec', color: '#8a857a', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => addPlayerRow()} className="btn-outline btn-sm" style={{ marginTop: 12 }}>+ Lisää pelaajarivi</button>
                  <div style={{ fontSize: 12.5, color: '#8a857a', marginTop: 10 }}>{filledPlayers.length} pelaajaa valmiina · Tyhjä ikä tallennetaan tuntemattomana</div>
                </div>
              )}

              {step === 2 && (
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 5 }}>Suunnittele viikkoteemat</h3>
                  <p style={{ fontSize: 13.5, color: '#514c42', lineHeight: 1.55, marginBottom: 14 }}>Lisää teemat käsin tai lähetä usean ryhmän yhteinen Excel ylläpidon tarkistettavaksi.</p>
                  <div className="k-card" style={{ padding: '14px 16px', marginBottom: 16, background: 'rgba(14,59,44,0.035)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
                      <div style={{ flex: '1 1 330px' }}>
                        <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--green-deep)', marginBottom: 3 }}>Onko kaikki ryhmät samassa Excelissä?</div>
                        <div style={{ fontSize: 12.5, color: '#514c42', lineHeight: 1.5 }}>Lähetä `.xlsx` ylläpidolle. Se ei muuta teemoja automaattisesti, vaan ylläpito saa sähköposti-ilmoituksen ja käy tiedoston läpi.</div>
                      </div>
                      <label className="btn-dark btn-sm" style={{ cursor: sharedPlanBusy ? 'default' : 'pointer', opacity: sharedPlanBusy ? 0.55 : 1 }}>
                        {sharedPlanBusy ? 'Lähetetään…' : (sharedPlanSent ? 'Lähetä uusi versio' : 'Lähetä Excel')}
                        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={sharedPlanBusy} style={{ display: 'none' }}
                          onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; sendSharedPlan(file); }} />
                      </label>
                    </div>
                    {sharedPlanSent && <div style={{ marginTop: 9, fontSize: 12.5, color: '#0e5b42', fontWeight: 750 }}>{sharedPlanSent} lähetetty ylläpidolle.</div>}
                  </div>
                  {involvedGroupKeys.length === 0 && <div className="k-card" style={{ padding: 18, color: '#8a857a', fontSize: 14 }}>Pelaajia ei ole liitetty ryhmiin, joten viikkoteemoja ei tarvitse lisätä.</div>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {involvedGroupKeys.map((groupKey) => {
                      const option = groupOptionByKey.get(groupKey);
                      const rows = themeRows.filter((r) => r.groupKey === groupKey).sort(window.koutsiCompareIsoWeeks);
                      if (!option) return null;
                      return (
                        <div key={groupKey} className="k-card" style={{ padding: '15px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 11 }}>
                            <div><span style={{ fontSize: 15, fontWeight: 800, color: '#111' }}>{option.name}</span> <span style={{ fontSize: 11.5, color: '#8a857a' }}>{option.existing ? 'nykyinen ryhmä' : 'uusi ryhmä'}</span></div>
                            <button onClick={() => addThemeWeek(groupKey)} className="btn-outline btn-sm" style={{ padding: '7px 12px', fontSize: 12 }}>+ Viikko</button>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {rows.map((r) => (
                              <div key={r.key} className="kv-bulk-theme-row" style={{ display: 'grid', gridTemplateColumns: '175px minmax(180px, 1fr) minmax(180px, 1.2fr) 34px', gap: 8, alignItems: 'center' }}>
                                <select value={window.koutsiIsoWeekKey(r)} onChange={(e) => { const w = weekOptions.find((o) => window.koutsiIsoWeekKey(o) === e.target.value); if (w) updateTheme(r.key, { year: w.year, week: w.week }); }} style={inputStyle} aria-label="Teeman viikko">
                                  {weekOptions.map((w) => <option key={window.koutsiIsoWeekKey(w)} value={window.koutsiIsoWeekKey(w)}>vko {w.week}/{w.year} · {window.koutsiIsoWeekRangeLabel(w.year, w.week)}{w.isNow ? ' (nyt)' : ''}</option>)}
                                </select>
                                <input value={r.title} onChange={(e) => updateTheme(r.key, { title: e.target.value })} placeholder="Viikon teema" style={inputStyle} aria-label="Viikon teema" />
                                <input value={r.lead} onChange={(e) => updateTheme(r.key, { lead: e.target.value })} placeholder="Tarkennus (vapaaehtoinen)" style={inputStyle} aria-label="Teeman tarkennus" />
                                <button onClick={() => removeTheme(r.key)} aria-label="Poista viikkoteema" style={{ width: 32, height: 32, border: 'none', borderRadius: '50%', background: '#f4f2ec', color: '#8a857a', cursor: 'pointer', fontSize: 18 }}>×</button>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {step === 3 && (
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 5 }}>Tarkista ennen tallennusta</h3>
                  <p style={{ fontSize: 13.5, color: '#514c42', lineHeight: 1.55, marginBottom: 18 }}>Mitään kutsuja ei lähetetä. Pelaajat näkyvät oppilaslistassasi heti ja voivat liittyä omille tunnuksilleen myöhemmin.</p>
                  <div className="kv-bulk-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 18 }}>
                    {[
                      ['Pelaajia', payload.players.length],
                      ['Uusia ryhmiä', payload.groups.filter((g) => !g.existing_id).length],
                      ['Viikkoteemoja', payload.themes.length],
                    ].map(([title, count]) => <div key={title} className="k-card" style={{ padding: '14px 15px' }}><div style={{ fontSize: 22, fontWeight: 800 }}>{count}</div><div style={{ fontSize: 12, color: '#8a857a', marginTop: 2 }}>{title}</div></div>)}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {payload.players.map((p, index) => {
                      const source = filledPlayers[index];
                      const assigned = source?.groupKey ? groupOptionByKey.get(source.groupKey) : null;
                      return (
                        <div key={`${p.name}-${index}`} className="k-card" style={{ padding: '12px 15px', display: 'flex', alignItems: 'center', gap: 12 }}>
                          <Avatar initial={p.name.charAt(0).toUpperCase()} hue={120 + index * 23} size={36} />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 14.5, fontWeight: 750, color: '#111' }}>{p.name}{p.age ? `, ${p.age}` : ''}</div>
                            <div style={{ fontSize: 12.5, color: '#8a857a', marginTop: 2 }}>
                              {assigned ? assigned.name : 'Ei ryhmää vielä'}{p.level ? ` · ${p.level}` : ''}
                            </div>
                          </div>
                          <PlayerAppStatus isPlaceholder compact />
                        </div>
                      );
                    })}
                  </div>
                  {payload.themes.length > 0 && (
                    <div className="k-card" style={{ padding: '14px 16px', marginTop: 14 }}>
                      <div style={{ ...labelStyle, marginBottom: 9 }}>Tallennettavat viikkoteemat</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {payload.themes.map((t, i) => <div key={`${t.group_ref}-${t.year}-${t.week}-${i}`} style={{ fontSize: 13.5, color: '#3c382f' }}><b style={{ color: 'var(--green-deep)' }}>{groupOptionByKey.get(t.group_ref)?.name} · vko {t.week}</b> — {t.title}</div>)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ padding: '14px 26px 18px', borderTop: '1px solid var(--line)', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <button onClick={step === 0 ? onClose : () => { setStep((s) => s - 1); setError(''); }} disabled={busy} className="btn-outline" style={{ padding: '12px 20px' }}>{step === 0 ? 'Peruuta' : 'Takaisin'}</button>
              <div style={{ fontSize: 12.5, color: '#8a857a', textAlign: 'center' }}>{step === 1 ? `${filledPlayers.length} pelaajaa` : step === 2 ? `${filledThemes.length} teemaa` : ''}</div>
              {step < 3
                ? <button onClick={next} className="btn-dark" style={{ padding: '12px 22px' }}>Jatka</button>
                : <button onClick={save} disabled={busy} className="btn-dark" style={{ padding: '12px 22px', opacity: busy ? 0.6 : 1 }}>{busy ? 'Tallennetaan…' : 'Tallenna kaikki'}</button>}
            </div>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

// Days since this student's last self-logged practice, or null if they've never logged
// one. Shared by the roster card badge and the "Ei omatoimista viikkoon" filter, so both
// agree on what "inactive" means.
function koutsiDaysSinceSelfLog(state, studentId) {
  const todayStr = window.koutsiTodayStr();
  const last = window.koutsiTrainingsForStudent(state, studentId)
    .filter((t) => t.loggedBy === 'player' && t.date <= todayStr)
    .sort((a, b) => b.date.localeCompare(a.date))[0] || null;
  if (!last) return null;
  return Math.round((window.koutsiDateFromStr(todayStr) - window.koutsiDateFromStr(last.date)) / 86400000);
}
function ActivityBadge({ daysSince }) {
  const inactive = daysSince == null || daysSince >= 7;
  const text = daysSince == null ? 'Ei omatoimisia merkintöjä' : daysSince === 0 ? 'Omatoiminen tänään' : `Omatoiminen ${daysSince} pv sitten`;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: inactive ? '#a13b2f' : '#2f7d54' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: inactive ? '#a13b2f' : '#2f7d54', flexShrink: 0 }} />
      {text}
    </span>
  );
}
function StudentsView({ students, groups, state, coachId, coachName, onOpen, trainingCount, onAddTraining, onAddPlayer, onBulkSetup }) {
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [bulkOpen, setBulkOpen] = React.useState(false);
  // A search box only earns its space once the list stops fitting on one screen.
  const [search, setSearch] = React.useState('');
  const [onlyInactive, setOnlyInactive] = React.useState(false);
  const q = search.trim().toLowerCase();
  const withActivity = students.map((s) => ({ s, daysSince: koutsiDaysSinceSelfLog(state, s.id) }));
  const shown = withActivity
    .filter(({ daysSince }) => !onlyInactive || daysSince == null || daysSince >= 7)
    .filter(({ s }) => !q || `${s.name} ${s.goal || ''} ${s.focus || ''} ${s.level || ''}`.toLowerCase().includes(q));
  return (
    <div>
      <PageHeader title="Oppilaani" sub={`${students.length} valmennettavaa`} action={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setAddOpen(true)} className="btn-outline btn-sm">+ Lisää yksi</button>
          <button onClick={() => setInviteOpen(true)} className="btn-outline btn-sm">Kutsu oppilas</button>
          <button onClick={() => setBulkOpen(true)} className="btn-dark btn-sm">+ Lisää monta</button>
        </div>
      } />
      <GettingStarted
        studentCount={students.length} trainingCount={trainingCount}
        onBulkSetup={() => setBulkOpen(true)} onAddTraining={onAddTraining} />
      {students.length > 5 && (
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Hae oppilaan nimellä tai tavoitteella…"
          style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '12px 15px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff', marginBottom: 12 }} />
      )}
      {students.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
          <button onClick={() => setOnlyInactive(false)} style={{ padding: '8px 14px', borderRadius: 999, border: onlyInactive ? '1px solid #d8d4ca' : 'none', background: onlyInactive ? '#fff' : 'var(--lime)', color: onlyInactive ? '#3c382f' : '#101a08', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>Kaikki</button>
          <button onClick={() => setOnlyInactive(true)} style={{ padding: '8px 14px', borderRadius: 999, border: onlyInactive ? 'none' : '1px solid #d8d4ca', background: onlyInactive ? 'var(--lime)' : '#fff', color: onlyInactive ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>Ei omatoimista viikkoon</button>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 18 }}>
        {shown.map(({ s, daysSince }) => (
          <button key={s.id} onClick={() => onOpen(s.id)} className="k-card" style={{ textAlign: 'left', cursor: 'pointer', padding: '20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar src={s.avatarUrl} initial={s.initial} hue={s.hue} size={48} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ color: '#111', fontWeight: 700, fontSize: 16.5 }}>{s.name}{playerAgeLabel(s) ? `, ${playerAgeLabel(s)}` : ''}</span>
                  {s.diary.length > 0 && <span title="Uusi merkintä" style={{ width: 7, height: 7, borderRadius: '50%', background: '#46a66d', flexShrink: 0 }} />}
                </div>
                <div style={{ marginTop: 7, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}><LevelChip level={s.level || 'Ei asetettu'} /><PlayerAppStatus isPlaceholder={s.isPlaceholder} compact /></div>
              </div>
            </div>
            <div style={{ fontSize: 13.5, color: '#3c382f', lineHeight: 1.5 }}><b style={{ color: 'var(--green-deep)' }}>Tavoite:</b> {s.goal || 'Ei vielä tavoitetta'}</div>
            <div style={{ fontSize: 12.5, color: '#8a857a', lineHeight: 1.5 }}>Seuraavaksi: {s.focus || '—'}</div>
            <ActivityBadge daysSince={daysSince} />
          </button>
        ))}
        {students.length === 0 && <div style={{ color: '#8a857a', fontSize: 14.5 }}>Ei vielä oppilaita — kutsu ensimmäinen yllä olevasta linkistä.</div>}
        {students.length > 0 && shown.length === 0 && <div style={{ color: '#8a857a', fontSize: 14.5 }}>Ei osumia{onlyInactive ? ' suodattimella' : search.trim() ? ` haulla "${search.trim()}"` : ''}.</div>}
      </div>
      {addOpen && <AddPlayerModal onClose={() => setAddOpen(false)} onSave={async (data) => { await onAddPlayer(data); setAddOpen(false); }} />}
      {bulkOpen && <BulkSetupModal groups={groups} coachId={coachId} onClose={() => setBulkOpen(false)} onSave={onBulkSetup} />}
      {inviteOpen && <InviteStudentModal coachId={coachId} coachName={coachName} onClose={() => setInviteOpen(false)} />}
    </div>
  );
}

// Absences were listed one by one with no total, which is the number a coach is actually
// asked for at the end of a season. Only past sessions count — a season planned ahead
// would otherwise read as one long absence.
function AttendanceCard({ attendance }) {
  const [open, setOpen] = React.useState(false);
  const { studentId, total, present, absent, rate, events } = attendance;
  const tone = rate >= 85 ? '#2f7d54' : rate >= 70 ? '#8a6a12' : '#a13b2f';
  return (
    <Field label="Läsnäolo">
      <div className="k-card" style={{ padding: '15px 17px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 26, fontWeight: 800, color: tone, letterSpacing: -0.5 }}>{rate}%</span>
          <span style={{ fontSize: 13, color: '#8a857a' }}>{present}/{total} pidetystä treenistä</span>
        </div>
        <div style={{ display: 'flex', height: 7, borderRadius: 999, overflow: 'hidden', background: '#f0ede5', marginBottom: 12 }}>
          <span style={{ width: `${total ? (present / total) * 100 : 0}%`, background: '#2f7d54' }} />
          <span style={{ width: `${total ? (absent / total) * 100 : 0}%`, background: '#a8a297' }} />
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12.5, color: '#514c42' }}>
          <span><b style={{ color: '#2f7d54' }}>{present}</b> paikalla</span>
          <span><b style={{ color: '#6b665c' }}>{absent}</b> poissa</span>
        </div>
        {events.length > 0 && (
          <React.Fragment>
            <button onClick={() => setOpen((v) => !v)} style={{ background: 'none', border: 'none', padding: '10px 0 0', color: 'var(--green-deep)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              {open ? 'Piilota erittely' : `Näytä ${events.length} poissaoloa`}
            </button>
            {open && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                {events.map(({ training, reportedBy }) => (
                  <div key={training.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 12px', borderRadius: 10, background: 'rgba(138,133,122,0.1)' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#8a857a', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: '#3c382f', flex: 1 }}>
                      <span style={{ display: 'block' }}>{window.koutsiFmtShortDate(training.date)} — {training.type}</span>
                      {reportedBy && <span style={{ display: 'block', color: '#9a958a', fontSize: 11.5, marginTop: 2 }}>{reportedBy === studentId ? 'Pelaajan ilmoittama' : 'Valmentajan kirjaama'}</span>}
                    </span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: '#6b665c' }}>Poissa</span>
                  </div>
                ))}
              </div>
            )}
          </React.Fragment>
        )}
      </div>
    </Field>
  );
}

// A plain month-by-month overview of what this player has actually done outside
// coaching — no grid, just the numbers: how many self-directed sessions, how many hours,
// broken down by kind, plus whether they've gone quiet. Reuses koutsiMonthlySummary
// (built for the player's own Strava-style view in koutsi-pelaaja-app.jsx).
function PlayerActivityCard({ state, student }) {
  const todayStr = window.koutsiTodayStr();
  const todayDate = window.koutsiDateFromStr(todayStr);
  const [viewYear, setViewYear] = React.useState(todayDate.getFullYear());
  const [viewMonth, setViewMonth] = React.useState(todayDate.getMonth());
  const prevMonth = () => { if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); } else setViewMonth((m) => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); } else setViewMonth((m) => m + 1); };

  const summary = React.useMemo(() => window.koutsiMonthlySummary(state, student.id, viewYear, viewMonth), [state, student.id, viewYear, viewMonth]);
  const lastSelf = window.koutsiTrainingsForStudent(state, student.id)
    .filter((t) => t.loggedBy === 'player' && t.date <= todayStr).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
  const daysSince = lastSelf ? Math.round((window.koutsiDateFromStr(todayStr) - window.koutsiDateFromStr(lastSelf.date)) / 86400000) : null;
  const inactive = daysSince == null || daysSince >= 7;
  const active = summary.categories.filter((c) => c.count > 0);
  const matches = summary.categories.find((c) => c.key === 'ottelu');

  return (
    <Field label="Pelaajan omatoimisuus">
      <div style={{ padding: '9px 12px', borderRadius: 10, background: inactive ? 'rgba(161,59,47,0.08)' : 'rgba(47,125,84,0.08)', color: inactive ? '#a13b2f' : '#2f7d54', fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>
        {lastSelf
          ? (daysSince === 0 ? 'Viimeisin omatoiminen merkintä tänään.' : `Viimeisin omatoiminen merkintä ${daysSince} pv sitten.`)
          : 'Ei vielä yhtään omatoimista merkintää.'}
      </div>
      <div className="k-card" style={{ padding: '15px 17px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <button onClick={prevMonth} aria-label="Edellinen kuukausi" style={{ width: 26, height: 26, borderRadius: '50%', border: '1px solid var(--line)', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="6" height="11" viewBox="0 0 8 14"><path d="M7 1L1 7l6 6" stroke="#111" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div style={{ fontWeight: 800, fontSize: 14, color: '#111', textTransform: 'capitalize' }}>{window.KOUTSI_MONTHS[viewMonth]} {viewYear}</div>
          <button onClick={nextMonth} aria-label="Seuraava kuukausi" style={{ width: 26, height: 26, borderRadius: '50%', border: '1px solid var(--line)', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="6" height="11" viewBox="0 0 8 14"><path d="M1 1l6 6-6 6" stroke="#111" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
        {active.length === 0 ? (
          <div style={{ fontSize: 12.5, color: '#a8a294' }}>Ei merkintöjä tälle kuukaudelle.</div>
        ) : (
          <React.Fragment>
            <div style={{ fontSize: 12.5, color: '#8a857a', marginBottom: 10 }}>{summary.totalSessions} suoritusta{summary.totalMinutes ? ` · ${window.koutsiFmtDuration(summary.totalMinutes)}` : ''}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {active.map((c) => (
                <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: '#3c382f' }}>
                  <span>{c.label}</span>
                  <span style={{ fontWeight: 700, color: '#111' }}>{c.count}{c.minutes > 0 ? ` · ${window.koutsiFmtDuration(c.minutes)}` : ''}</span>
                </div>
              ))}
              {matches?.count > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: '#3c382f' }}>
                  <span>Ottelutulos</span>
                  <span style={{ fontWeight: 700, color: '#111' }}>{summary.matchWins}V – {summary.matchLosses}T</span>
                </div>
              )}
            </div>
          </React.Fragment>
        )}
      </div>
    </Field>
  );
}

function StudentAttendanceEditor({ student, state, trainings, onEdit }) {
  const nowWeek = window.koutsiCurrentIsoWeek();
  // Player-logged practice isn't a session the coach is running, so it has no attendance to take.
  const sorted = (trainings || []).filter((t) => t.loggedBy !== 'player').slice().sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  const thisWeek = sorted.filter((t) => {
    const w = window.koutsiIsoWeekOfDateStr(t.date);
    return w.year === nowWeek.year && w.week === nowWeek.week;
  });
  const today = window.koutsiTodayStr();
  const fallback = [
    ...sorted.filter((t) => t.date < today).slice(-2),
    ...sorted.filter((t) => t.date >= today).slice(0, 3),
  ];
  const shown = (thisWeek.length ? thisWeek : fallback)
    .filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i)
    .slice(0, 5);
  if (shown.length === 0) return null;
  return (
    <Field label="Kirjaa läsnäolo">
      <div style={{ fontSize: 12.5, color: '#8a857a', lineHeight: 1.45, marginBottom: 9 }}>
        {thisWeek.length ? 'Tämän viikon treenit' : 'Viimeisimmät ja seuraavat treenit'} — syy on aina valinnainen.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shown.map((t) => {
          const entry = (t.absences || []).find((a) => a.studentId === student.id);
          const group = t.groupId != null ? window.koutsiGroupById(state, t.groupId) : null;
          return (
            <div key={t.id} className="k-card" style={{ padding: '11px 13px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: '#111', fontWeight: 700 }}>{window.koutsiFmtShortDate(t.date)} · {t.time}</div>
                <div style={{ fontSize: 12, color: '#8a857a', marginTop: 2 }}>{group ? group.name : t.type}</div>
                {entry?.note && <div style={{ fontSize: 12, color: '#6b665c', lineHeight: 1.4, marginTop: 4 }}>{entry.note}</div>}
              </div>
              <window.KoutsiAttendanceBadge entry={entry} compact onClick={() => onEdit(t, student.id)} />
            </div>
          );
        })}
      </div>
    </Field>
  );
}

function ClubEventModal({ editing, defaultDate, onClose, onSave }) {
  const isEdit = Boolean(editing);
  const [title, setTitle] = React.useState(() => (editing ? editing.title : ''));
  const [date, setDate] = React.useState(() => (editing ? editing.date : (defaultDate || window.koutsiTodayStr())));
  const [endDate, setEndDate] = React.useState(() => (editing ? editing.endDate || '' : ''));
  const [kind, setKind] = React.useState(() => (editing ? editing.kind || 'seura' : 'seura'));
  const endDateValid = !endDate || endDate >= date;
  const ready = title.trim() && date && endDateValid;
  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };
  const label = { fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(440px, 100%)', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 6 }}>{isEdit ? 'Muokkaa tapahtumaa' : 'Uusi tapahtuma'}</h3>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 18, lineHeight: 1.5 }}>Kilpailut, leirit ja muut merkinnät näkyvät kalenterissa sinulle ja oppilaillesi.</p>
        <div style={label}>Otsikko</div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Esim. Seuran kevätkisat" autoFocus style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginBottom: endDateValid ? 16 : 6 }}>
          <div>
            <div style={label}>Alkaa</div>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={label}>Päättyy (valinnainen)</div>
            <input type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} style={{ ...inputStyle, borderColor: endDateValid ? '#d8d4ca' : '#a13b2f' }} />
          </div>
        </div>
        {!endDateValid && <div style={{ color: '#a13b2f', fontSize: 12.5, marginBottom: 16 }}>Päättymispäivä ei voi olla ennen alkamispäivää.</div>}
        <div style={label}>Tyyppi</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {window.KOUTSI_EVENT_KINDS.map((k) => (
            <button key={k.value} onClick={() => setKind(k.value)} style={{ padding: '8px 14px', borderRadius: 999, border: kind === k.value ? 'none' : '1px solid #d8d4ca', background: kind === k.value ? 'var(--lime)' : '#fff', color: kind === k.value ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>{k.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={() => ready && onSave({ title: title.trim(), date, endDate: endDate || null, kind })} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: ready ? 1 : 0.45, cursor: ready ? 'pointer' : 'default' }}>{isEdit ? 'Tallenna' : 'Lisää'}</button>
        </div>
      </div>
    </div>
  );
}

// How the player has felt after their sessions. The coach could not see this at all
// before, which made the player's "pidä omana tietona" choice meaningless. Rows the player
// hid never reach the coach's query in the first place — RLS filters them — so this list
// only ever renders what the player chose to share.
function MoodTrend({ moods }) {
  const shared = (moods || []).filter((m) => !m.hiddenFromCoach);
  if (shared.length === 0) return <div style={{ color: '#8a857a', fontSize: 14 }}>Pelaaja ei ole jakanut fiiliksiä.</div>;
  const avg = shared.reduce((sum, m) => sum + m.score, 0) / shared.length;
  const labels = { 1: 'Raskas', 2: 'Vaisu', 3: 'Ihan ok', 4: 'Hyvä', 5: 'Loistava' };
  return (
    <div className="k-card" style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: 13, color: '#514c42', marginBottom: 11 }}>
        Keskiarvo <b style={{ color: '#111' }}>{avg.toFixed(1)}</b> · {shared.length} merkintää
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shared.slice(0, 6).map((m) => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <span style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, background: m.score <= 2 ? 'rgba(194,59,40,0.14)' : 'var(--lime)', color: m.score <= 2 ? '#a13b2f' : '#101a08' }}>{m.score}</span>
            <div style={{ minWidth: 0, flex: 1, fontSize: 13.5, color: '#3c382f', lineHeight: 1.45 }}>
              <b style={{ color: '#111' }}>{labels[m.score]}</b>{m.note ? ` — ${m.note}` : ''}
            </div>
            <span style={{ fontSize: 11.5, color: '#a8a294', flexShrink: 0 }}>{window.koutsiFmtEventDate(m.at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Where a player's goal has travelled. A coach preparing a session cares less about the
// current sentence than about the fact that it used to say something else — that is the
// clearest read on whether the season is moving.
function GoalHistory({ history }) {
  const [open, setOpen] = React.useState(false);
  const past = (history || []).filter((h) => h.previousValue);
  if (past.length === 0) return null;
  return (
    <div style={{ borderTop: '1px dashed #e3dfd4', paddingTop: 9 }}>
      <button onClick={() => setOpen((v) => !v)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--green-deep)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
        {open ? 'Piilota tavoitehistoria' : `Tavoite on muuttunut ${past.length} kertaa — näytä historia`}
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {past.map((h) => (
            <div key={h.id} style={{ fontSize: 13, lineHeight: 1.5 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#a8a294', textTransform: 'uppercase', letterSpacing: 0.5 }}>{window.koutsiFmtEventDate(h.at)}</div>
              <div style={{ color: '#111' }}>{h.value}</div>
              <div style={{ color: '#8a857a' }}>aiemmin: {h.previousValue}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Valmentaja voi lisätä pelaajan pelkällä nimellä, jolloin takana ei ole Krossi-tiliä.
// Ilman tätä huomautusta ero näkyy vasta siinä, ettei pelaaja koskaan vastaa mihinkään:
// kortti näyttää samalta kuin liittyneellä pelaajalla. Koodi haetaan tähän mukaan, koska
// juuri se on ainoa asia, jolla valmentaja saa pelaajan liittymään.
function PlaceholderNotice({ student, coach }) {
  const [code, setCode] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    window.koutsiMyJoinCode(coach.id).then((c) => { if (alive) setCode(c || null); }).catch(() => {});
    return () => { alive = false; };
  }, [coach.id]);
  const firstName = (student.name || '').split(' ')[0] || 'Pelaaja';
  const link = code ? window.koutsiInviteLink(code, student.id) : '';
  const message = code ? window.koutsiInviteMessage(code, coach.name, null, student.id) : '';
  return (
    <div className="k-card" style={{ padding: '15px 17px', marginBottom: 22, background: 'rgba(214,140,44,0.10)', borderColor: 'rgba(214,140,44,0.35)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6.6" stroke="#8a5a12" strokeWidth="1.4" />
          <path d="M8 4.8v3.6M8 11.1h.01" stroke="#8a5a12" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span style={{ fontSize: 11, fontWeight: 800, color: '#8a5a12', textTransform: 'uppercase', letterSpacing: 0.5 }}>Ei vielä Krossissa</span>
      </div>
      <div style={{ fontSize: 13.5, color: '#514c42', lineHeight: 1.55 }}>
        {firstName} ei ole vielä liittynyt Krossiin. Voit silti kirjata hänelle treenejä, päiväkirjamerkintöjä
        ja läksyjä. Kun hän liittyy alla olevasta linkistä, kirjaukset siirtyvät hänen tililleen.
      </div>
      {code && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(214,140,44,0.3)' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#8a5a12', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Liittymiskoodisi</div>
          <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: 3, color: '#111', marginBottom: 10 }}>{code}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <window.KoutsiCopyButton text={message} label="Kopioi viesti" copiedLabel="Viesti kopioitu!" className="btn-dark btn-sm" />
            <window.KoutsiCopyButton text={link} label="Kopioi linkki" />
          </div>
        </div>
      )}
    </div>
  );
}

function StudentDetail({ student, coach, state, trainings, group, groupCoach, upcoming, attendance, onClose, onAddEntry, onToggleHomework, onOpenGroup, onAddHomework, onAddVideo, onEditAttendance, onSetLevel, onEditEntry, onDeleteEntry, onEditHomework, onDeleteHomework, onDeleteVideo, onEditVideoAudience, onEndCoaching }) {
  const [levelPickerOpen, setLevelPickerOpen] = React.useState(false);
  const [editingHomework, setEditingHomework] = React.useState(null); // homework id being renamed
  const [homeworkDraft, setHomeworkDraft] = React.useState('');
  const levelOptions = ['Aloittelija', 'Keskitaso', 'Edistynyt', 'Kilpapelaaja'];
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(10,15,10,0.35)', animation: 'kFadeIn .2s ease' }} />
      <div style={{ position: 'relative', width: 'min(480px, 100%)', height: '100%', background: '#fff', boxShadow: '-16px 0 40px -20px rgba(0,0,0,0.35)', overflowY: 'auto', animation: 'kSlideIn .25s ease' }}>
        <div style={{ padding: '26px 28px 0', display: 'flex', justifyContent: 'flex-end' }}>
          <CloseButton onClick={onClose} />
        </div>
        <div style={{ padding: '10px 28px 120px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, marginBottom: 24 }}>
            <Avatar src={student.avatarUrl} initial={student.initial} hue={student.hue} size={84} ring />
            <div style={{ color: '#111', fontWeight: 800, fontSize: 22 }}>{student.name}{playerAgeLabel(student) ? `, ${playerAgeLabel(student)}` : ''}</div>
            <PlayerAppStatus isPlaceholder={student.isPlaceholder} />
            <button onClick={() => setLevelPickerOpen((v) => !v)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
              <LevelChip level={student.level || 'Aseta taso'} />
            </button>
            {levelPickerOpen && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 2 }}>
                {levelOptions.map((lv) => (
                  <button key={lv} onClick={() => { onSetLevel(lv); setLevelPickerOpen(false); }} style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid #d8d4ca', background: student.level === lv ? 'var(--lime)' : '#fff', color: '#3c382f', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>{lv}</button>
                ))}
              </div>
            )}
          </div>

          {student.isPlaceholder && <PlaceholderNotice student={student} coach={coach} />}

          <Field label="Tavoite ja seuraava askel">
            <div className="k-card" style={{ padding: '15px 17px', display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ fontSize: 14, lineHeight: 1.5 }}><b style={{ color: 'var(--green-deep)' }}>Tavoite:</b> {student.goal} <span style={{ color: '#8a857a', fontSize: 12 }}>(pelaajan asettama)</span></div>
              <div style={{ fontSize: 14, lineHeight: 1.5 }}><b style={{ color: 'var(--green-deep)' }}>Viime treenissä:</b> {student.lastSession}</div>
              <div style={{ fontSize: 14, lineHeight: 1.5 }}><b style={{ color: 'var(--green-deep)' }}>Seuraavaksi:</b> {student.focus}</div>
              <GoalHistory history={student.goalHistory} />
            </div>
          </Field>

          <Field label="Kotiläksyt">
            {student.homework.length === 0 && <div style={{ color: '#8a857a', fontSize: 14, marginBottom: 10 }}>Ei vielä kotiläksyjä.</div>}
            {student.homework.map((h, i) => (
              editingHomework === h.id ? (
                <div key={h.id} style={{ display: 'flex', gap: 8, padding: '7px 0' }}>
                  <input value={homeworkDraft} onChange={(e) => setHomeworkDraft(e.target.value)} autoFocus
                    onKeyDown={(e) => { if (e.key === 'Escape') setEditingHomework(null); }}
                    style={{ flex: 1, boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 12, padding: '9px 12px', fontSize: 13.5, fontFamily: 'inherit', color: '#111', background: '#fff' }} />
                  <button onClick={() => { if (homeworkDraft.trim()) { onEditHomework(h, homeworkDraft.trim()); setEditingHomework(null); } }} className="btn-dark btn-sm">Tallenna</button>
                  <button onClick={() => setEditingHomework(null)} className="btn-outline btn-sm">Peru</button>
                </div>
              ) : (
                <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '7px 0' }}>
                  <button onClick={() => onToggleHomework(i)} aria-label={h.done ? 'Merkitse tekemättömäksi' : 'Merkitse tehdyksi'} style={{ display: 'flex', alignItems: 'center', gap: 11, flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
                    <span style={{ width: 19, height: 19, borderRadius: 6, border: '1.5px solid ' + (h.done ? 'var(--green-deep)' : '#c5c0b5'), background: h.done ? 'var(--green-deep)' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {h.done && <svg width="11" height="9" viewBox="0 0 10 8"><path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                    </span>
                    <span style={{ fontSize: 14.5, color: '#111', textDecoration: h.done ? 'line-through' : 'none', opacity: h.done ? 0.55 : 1 }}>{h.text}</span>
                  </button>
                  <window.KoutsiRowActions
                    onEdit={() => { setEditingHomework(h.id); setHomeworkDraft(h.text); }}
                    onDelete={() => onDeleteHomework(h)} />
                </div>
              )
            ))}
          </Field>

          <StudentAttendanceEditor student={student} state={state} trainings={trainings} onEdit={onEditAttendance} />

          {attendance && attendance.total > 0 && <AttendanceCard attendance={attendance} />}

          <PlayerActivityCard state={state} student={student} />

          {group && (
            <Field label="Valmennusryhmä">
              <button onClick={onOpenGroup} className="k-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '13px 15px', width: '100%', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', marginBottom: group.theme ? 10 : 0 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14.5, color: '#111' }}>{group.name}</div>
                  <div style={{ fontSize: 12.5, color: '#8a857a', marginTop: 2 }}>{group.day} klo {group.time} viikoittain{groupCoach ? ` · ${groupCoach.name}` : ''}</div>
                </div>
                <ChevronRight />
              </button>
              <GroupThemeBanner theme={group.theme} />
            </Field>
          )}

          <Field label="Videot">
            <VideoRow videos={student.videos} onDelete={onDeleteVideo} onEditAudience={onEditVideoAudience} />
            <button onClick={onAddVideo} className="btn-outline btn-sm" style={{ marginTop: 12 }}>+ Lisää video</button>
          </Field>

          <Field label="Päiväkirja">
            {student.diary.length === 0 && <div style={{ color: '#8a857a', fontSize: 14 }}>Ei vielä merkintöjä.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {student.diary.map((d) => (
                <div key={d.id} className="k-card" style={{ padding: '12px 15px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ color: '#111', fontSize: 14, lineHeight: 1.5 }}>{d.text}</div>
                    <div style={{ marginTop: 6, fontSize: 12, color: '#8a857a', fontWeight: 600 }}>{d.date}</div>
                  </div>
                  <window.KoutsiRowActions onEdit={() => onEditEntry(d)} onDelete={() => onDeleteEntry(d)} />
                </div>
              ))}
            </div>
          </Field>

          {(student.playerNote || student.playerWish) && (
            <Field label="Pelaajalta">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {student.playerWish && (
                  <div className="k-card" style={{ padding: '12px 15px', background: 'rgba(207,228,20,0.08)', borderColor: 'rgba(207,228,20,0.4)' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--green-deep)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Toivoo seuraavalle kerralle</div>
                    <div style={{ color: '#111', fontSize: 14, lineHeight: 1.5 }}>&ldquo;{student.playerWish}&rdquo;</div>
                  </div>
                )}
                {student.playerNote && (
                  <div className="k-card" style={{ padding: '12px 15px' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Oma kommentti</div>
                    <div style={{ color: '#111', fontSize: 14, lineHeight: 1.5, fontStyle: 'italic' }}>&ldquo;{student.playerNote}&rdquo;</div>
                  </div>
                )}
              </div>
            </Field>
          )}

          <Field label="Fiilikset treenien jälkeen">
            <MoodTrend moods={student.moods} />
          </Field>

          <Field label="Ottelumuistiinpanot">
            {(student.matchNotes || []).length === 0 ? (
              <div style={{ color: '#8a857a', fontSize: 14 }}>Ei vielä ottelumuistiinpanoja.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {student.matchNotes.map((n) => (
                  <div key={n.id} className="k-card" style={{ padding: '13px 15px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: n.note ? 6 : 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{n.opponentName}</div>
                      <div style={{ fontSize: 11.5, color: '#8a857a', flexShrink: 0 }}>{window.koutsiFmtShortDate(n.date)}</div>
                    </div>
                    {n.note && <div style={{ fontSize: 13.5, color: '#3c382f', lineHeight: 1.5 }}>{n.note}</div>}
                  </div>
                ))}
              </div>
            )}
          </Field>

          {upcoming.length > 0 && (
            <Field label="Tulevat treenit">
              {upcoming.map((t) => (
                <div key={t.id} style={{ fontSize: 14.5, color: '#3c382f', padding: '4px 0' }}>{window.koutsiFmtShortDate(t.date)} · {t.time} — {t.type}</div>
              ))}
            </Field>
          )}

          <Field label="Valmennussuhde">
            <p style={{ fontSize: 13, color: '#8a857a', lineHeight: 1.5, marginBottom: 10 }}>
              Päättäminen poistaa pelaajan oppilaslistaltasi ja ryhmistäsi. Aiemmat merkinnät säilyvät pelaajan omassa näkymässä.
            </p>
            <button onClick={onEndCoaching} className="btn-outline btn-sm" style={{ color: '#8f2f24', borderColor: '#e3c9c4' }}>Päätä valmennussuhde</button>
          </Field>
        </div>
        <div style={{ position: 'sticky', bottom: 0, left: 0, right: 0, padding: '18px 28px', background: 'linear-gradient(to top, #fff 60%, transparent)', display: 'flex', gap: 8 }}>
          <button onClick={onAddHomework} className="btn-dark btn-lg" style={{ flex: 1, padding: '14px 18px', fontSize: 14.5 }}>+ Kotiläksy</button>
          <button onClick={onAddEntry} className="btn-lime btn-lg" style={{ flex: 1, padding: '14px 18px', fontSize: 14.5 }}>+ Päiväkirja</button>
        </div>
      </div>
    </div>
  );
}

function HomeworkModal({ student, onClose, onSend }) {
  const [val, setVal] = React.useState('');
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(460px, 100%)', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 16 }}>Uusi kotiläksy — {student.name}</h3>
        <textarea autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder="Esim. 20 rystylyöntiä seinää vasten…" rows={3}
          style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', resize: 'none', marginBottom: 16, background: '#fff' }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={() => val.trim() && onSend(val.trim())} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: val.trim() ? 1 : 0.45, cursor: val.trim() ? 'pointer' : 'default' }}>Tallenna</button>
        </div>
      </div>
    </div>
  );
}

function EntryModal({ student, entry, onClose, onSend }) {
  const [val, setVal] = React.useState(() => (entry ? entry.text : ''));
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(460px, 100%)', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 16 }}>{entry ? 'Muokkaa merkintää' : 'Päiväkirja'} — {student.name}</h3>
        <textarea autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder="Esim. Hyvä nousu syötössä tällä viikolla…" rows={4}
          style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', resize: 'none', marginBottom: 8, background: '#fff' }} />
        <div style={{ fontSize: 11.5, color: '#8f2f24', lineHeight: 1.45, marginBottom: 16 }}>Älä kirjoita merkintään vammoja, sairauksia, diagnooseja, lääkityksiä tai muita terveystietoja.</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={() => val.trim() && onSend(val.trim())} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: val.trim() ? 1 : 0.45, cursor: val.trim() ? 'pointer' : 'default' }}>Tallenna</button>
        </div>
      </div>
    </div>
  );
}

function VideoModal({ students, groups, initialStudentId, onClose, onSave }) {
  const [shareId] = React.useState(() => window.koutsiRandomUuid());
  const [title, setTitle] = React.useState('');
  const [date, setDate] = React.useState(window.koutsiTodayStr());
  const [tags, setTags] = React.useState([]);
  const [studentIds, setStudentIds] = React.useState(initialStudentId != null ? [initialStudentId] : []);
  const [file, setFile] = React.useState(null);
  const [externalUrl, setExternalUrl] = React.useState('');
  const [source, setSource] = React.useState('link'); // 'file' | 'link'
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [error, setError] = React.useState('');
  const fileRef = React.useRef(null);
  const toggleTag = (t) => setTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
  const toggleStudent = (id) => setStudentIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const pickFile = (e) => {
    const f = e.target.files?.[0];
    setError('');
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) {
      setFile(null);
      setSource('link');
      setError(`${Math.round(f.size / 1048576)} Mt tiedosto on pitkäksi suoraksi lataukseksi liian suuri. Lataa se YouTubeen tai Driveen rajatulla näkyvyydellä ja liitä linkki tähän.`);
      return;
    }
    setFile(f);
    if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };
  const hasSource = source === 'file' ? Boolean(file) : /^https?:\/\//i.test(externalUrl.trim());
  const ready = title.trim() && date && studentIds.length > 0 && hasSource && !busy;
  const submit = async () => {
    if (!ready) return;
    setBusy(true); setProgress(0); setError('');
    try {
      await onSave({
        shareId, title: title.trim(), date, tags, studentIds,
        file: source === 'file' ? file : null,
        externalUrl: source === 'link' ? externalUrl.trim() : null,
        onProgress: setProgress,
      });
    } catch (err) { setError(window.koutsiErrorText(err, 'Videon tallennus epäonnistui')); setBusy(false); }
  };
  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };
  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(460px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 6 }}>Lisää video</h3>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 16, lineHeight: 1.5 }}>Video näkyy vain valituille pelaajille. Pitkä pelianalyysi kannattaa jakaa rajattuna YouTube- tai Drive-linkkinä; Koutsi ei silloin tallenna eikä välitä raskasta videotiedostoa.</p>
        {error && <div style={{ background: 'rgba(161,59,47,0.08)', border: '1px solid rgba(161,59,47,0.25)', color: '#a13b2f', padding: '10px 14px', borderRadius: 12, fontSize: 13, marginBottom: 14 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {[['link', 'Pitkä video linkkinä'], ['file', 'Lyhyt klippi tiedostona']].map(([key, label]) => (
            <button key={key} onClick={() => { setSource(key); setError(''); }} disabled={busy} style={{ padding: '9px 15px', borderRadius: 999, border: source === key ? 'none' : '1px solid #d8d4ca', background: source === key ? 'var(--lime)' : '#fff', color: source === key ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 13, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}>{label}</button>
          ))}
        </div>
        {source === 'file' ? (
          <React.Fragment>
            <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/webm,video/x-m4v,video/mpeg" onChange={pickFile} style={{ display: 'none' }} />
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="btn-outline" style={{ width: '100%', padding: '13px 0', marginBottom: 16 }}>
              {file ? `${file.name} (${Math.max(1, Math.round(file.size / 1048576))} Mt)` : 'Valitse enintään 50 Mt video…'}
            </button>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <input value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://youtube.com/... tai https://drive.google.com/..." style={{ ...inputStyle, marginBottom: 9 }} />
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16, fontSize: 12.5 }}>
              <a href="https://studio.youtube.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green-deep)', fontWeight: 700 }}>Avaa YouTube Studio ↗</a>
              <a href="https://drive.google.com/drive/my-drive" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green-deep)', fontWeight: 700 }}>Avaa Drive ↗</a>
            </div>
            <div style={{ color: '#8a857a', fontSize: 11.5, lineHeight: 1.45, margin: '-8px 0 16px' }}>Koutsi rajaa, kenelle linkki näkyy sovelluksessa. Aseta lisäksi videon omat YouTube- tai Drive-oikeudet huolellisesti, koska ulkopuolelle kopioitua linkkiä Koutsi ei voi suojata.</div>
          </React.Fragment>
        )}
        {busy && source === 'file' && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b665c', marginBottom: 6 }}><span>Suora lataus Storageen</span><b>{progress}%</b></div>
            <div style={{ height: 7, borderRadius: 999, overflow: 'hidden', background: '#ebe8df' }}><div style={{ height: '100%', width: `${progress}%`, background: 'var(--lime)', transition: 'width .2s ease' }} /></div>
          </div>
        )}
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Otsikko</div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Esim. Syöttöanalyysi" style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Päivämäärä</div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Aihe</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {window.KOUTSI_TAGS.map((t) => (
            <button key={t} onClick={() => toggleTag(t)} disabled={busy} style={{ padding: '8px 14px', borderRadius: 999, border: tags.includes(t) ? 'none' : '1px solid #d8d4ca', background: tags.includes(t) ? 'var(--lime)' : '#fff', color: tags.includes(t) ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 12.5, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}>{window.KOUTSI_TAG_LABELS[t]}</button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 9 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5 }}>Näkyvyys ({studentIds.length} valittu)</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setStudentIds(students.map((s) => s.id))} disabled={busy} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--green-deep)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Valitse kaikki</button>
            <button onClick={() => setStudentIds([])} disabled={busy} style={{ background: 'none', border: 'none', padding: 0, color: '#8a857a', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Tyhjennä</button>
          </div>
        </div>
        {(groups || []).length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {groups.map((g) => (
              <button key={g.id} onClick={() => setStudentIds((prev) => Array.from(new Set([...prev, ...g.memberIds])))} disabled={busy}
                style={{ padding: '7px 13px', borderRadius: 999, border: '1px solid #d8d4ca', background: '#fff', color: '#3c382f', fontWeight: 700, fontSize: 12, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                + {g.name} ({g.memberIds.length})
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20, maxHeight: 220, overflowY: 'auto' }}>
          {students.map((s) => (
            <button key={s.id} onClick={() => toggleStudent(s.id)} disabled={busy} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 12, border: studentIds.includes(s.id) ? '2px solid var(--lime)' : '1px solid #d8d4ca', background: studentIds.includes(s.id) ? 'rgba(207,228,20,0.1)' : '#fff', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%' }}>
              <Avatar src={s.avatarUrl} initial={s.initial} hue={s.hue} size={30} />
              <span style={{ fontWeight: 600, fontSize: 13.5, color: '#111', flex: 1 }}>{s.name}</span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={busy} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={submit} disabled={!ready} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: ready ? 1 : 0.45, cursor: ready ? 'pointer' : 'default' }}>{busy ? (source === 'file' ? `Ladataan ${progress}%` : 'Jaetaan…') : `Jaa (${studentIds.length})`}</button>
        </div>
      </div>
    </div>
  );
}

function VideoAudienceModal({ video, students, onClose, onSave }) {
  const [studentIds, setStudentIds] = React.useState(() => video.recipientIds || []);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const toggleStudent = (id) => setStudentIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const submit = async () => {
    if (studentIds.length === 0 || busy) return;
    setBusy(true); setError('');
    try { await onSave(video, studentIds); }
    catch (err) { setError(window.koutsiErrorText(err, 'Näkyvyyden tallennus epäonnistui')); setBusy(false); }
  };
  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 82, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(440px, 100%)', maxHeight: '88vh', overflowY: 'auto', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 6 }}>Videon näkyvyys</h3>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 16, lineHeight: 1.5 }}><b style={{ color: '#3c382f' }}>{video.title}</b> säilyy yhtenä tiedostona. Tässä muutetaan vain, ketkä pelaajat saavat nähdä sen.</p>
        {error && <div style={{ background: 'rgba(161,59,47,0.08)', border: '1px solid rgba(161,59,47,0.25)', color: '#a13b2f', padding: '10px 14px', borderRadius: 12, fontSize: 13, marginBottom: 14 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5 }}>{studentIds.length} valittu</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setStudentIds(students.map((s) => s.id))} disabled={busy} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--green-deep)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Kaikki</button>
            <button onClick={() => setStudentIds([])} disabled={busy} style={{ background: 'none', border: 'none', padding: 0, color: '#8a857a', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Tyhjennä</button>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20, maxHeight: 330, overflowY: 'auto' }}>
          {students.map((s) => (
            <button key={s.id} onClick={() => toggleStudent(s.id)} disabled={busy} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 12, border: studentIds.includes(s.id) ? '2px solid var(--lime)' : '1px solid #d8d4ca', background: studentIds.includes(s.id) ? 'rgba(207,228,20,0.1)' : '#fff', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%' }}>
              <Avatar src={s.avatarUrl} initial={s.initial} hue={s.hue} size={30} />
              <span style={{ fontWeight: 600, fontSize: 13.5, color: '#111', flex: 1 }}>{s.name}</span>
              <span aria-hidden="true" style={{ color: studentIds.includes(s.id) ? 'var(--green-deep)' : '#c5c0b5', fontWeight: 900 }}>{studentIds.includes(s.id) ? '✓' : ''}</span>
            </button>
          ))}
        </div>
        {studentIds.length === 0 && <div style={{ color: '#a13b2f', fontSize: 12.5, margin: '-10px 0 14px' }}>Valitse vähintään yksi pelaaja tai poista video erikseen.</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={busy} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={submit} disabled={studentIds.length === 0 || busy} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: studentIds.length > 0 && !busy ? 1 : 0.45 }}>{busy ? 'Tallennetaan…' : 'Tallenna näkyvyys'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Ryhmät ───────────────────────────────────────────────
function SharedAnnualPlanSubmissionCard({ coachId }) {
  const toast = window.useKoutsiToast();
  const [submissions, setSubmissions] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    window.koutsiAnnualPlanSubmissions(coachId).then(setSubmissions).catch(() => setSubmissions([]));
  }, [coachId]);
  React.useEffect(() => { load(); }, [load]);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    const sent = await toast.run(
      () => window.koutsiUploadSharedAnnualPlan(coachId, file),
      'Vuosisuunnitelma lähetetty ylläpidolle.',
    );
    if (sent) load();
    setBusy(false);
  };
  const open = async (submission) => {
    try {
      const url = await window.koutsiAnnualPlanUrl(submission.storagePath);
      if (!url) throw new Error('Tiedostoa ei löytynyt.');
      window.open(url, '_blank', 'noopener');
    } catch (err) { toast.error(window.koutsiErrorText(err, 'Tiedostoa ei saatu auki.')); }
  };

  return (
    <div className="k-card" style={{ padding: '18px 20px', marginBottom: 18, background: 'rgba(14,59,44,0.035)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 330px' }}>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: 'var(--green-deep)', marginBottom: 5 }}>Lähetä yhteinen vuosisuunnitelma</div>
          <div style={{ fontSize: 13, color: '#514c42', lineHeight: 1.5 }}>
            Jos samassa Excelissä on usean ryhmän viikkoteemat, lähetä se tästä ylläpidolle. Tiedosto ei muuta teemoja automaattisesti — ylläpito saa ilmoituksen ja käy suunnitelman läpi.
          </div>
        </div>
        <label className="btn-dark btn-sm" style={{ cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.55 : 1 }}>
          {busy ? 'Lähetetään…' : 'Lähetä Excel'}
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} style={{ display: 'none' }}
            onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; upload(file); }} />
        </label>
      </div>
      {submissions === null && <div style={{ marginTop: 12, color: '#8a857a', fontSize: 12.5 }}>Ladataan lähetyksiä…</div>}
      {submissions && submissions.slice(0, 3).map((submission) => {
        const pending = submission.status === 'pending';
        return (
          <div key={submission.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 11, padding: '10px 12px', borderRadius: 11, border: '1px solid var(--line)', background: '#fff', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 210px', minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 750, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{submission.filename}</div>
              <div style={{ fontSize: 11.5, color: '#8a857a', marginTop: 2 }}>{new Date(submission.uploadedAt).toLocaleDateString('fi-FI')} · {adminFormatBytes(submission.sizeBytes)}</div>
            </div>
            <span style={{ borderRadius: 999, padding: '5px 9px', fontSize: 10.5, fontWeight: 800, color: pending ? '#7a4c1e' : '#0e5b42', background: pending ? 'rgba(199,123,46,0.12)' : 'rgba(47,125,84,0.11)', border: `1px solid ${pending ? 'rgba(199,123,46,0.3)' : 'rgba(47,125,84,0.25)'}` }}>
              {pending ? 'Odottaa ylläpitoa' : 'Käsitelty'}
            </span>
            <button type="button" onClick={() => open(submission)} className="btn-outline btn-sm">Avaa</button>
          </div>
        );
      })}
    </div>
  );
}

function GroupsView({ groups, students, coachId, acting, onOpen, onCreate }) {
  return (
    <div>
      <PageHeader title="Ryhmät" sub={`${groups.length} valmennusryhmää`} action={<button onClick={onCreate} className="btn-dark btn-sm">+ Uusi ryhmä</button>} />
      {!acting && <SharedAnnualPlanSubmissionCard coachId={coachId} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 18 }}>
        {groups.map((g) => {
          const members = g.memberIds.map((id) => students.find((s) => s.id === id)).filter(Boolean);
          return (
            <button key={g.id} onClick={() => onOpen(g.id)} className="k-card" style={{ textAlign: 'left', cursor: 'pointer', padding: '20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ color: '#111', fontWeight: 700, fontSize: 17 }}>{g.name}</div>
                <div style={{ marginTop: 6 }}><LevelChip level={g.level} /></div>
              </div>
              <div style={{ fontSize: 13, color: '#8a857a' }}>{g.day} klo {window.koutsiTimeRangeLabel(g.time, g.durationMinutes)} viikoittain</div>
              {g.theme
                ? <div style={{ fontSize: 12.5, color: '#3c382f' }}><b style={{ color: 'var(--green-deep)' }}>Viikon teema:</b> {g.theme.title}</div>
                : (g.upcomingThemes || []).length > 0
                  ? <div style={{ fontSize: 12.5, color: '#8a857a' }}><b style={{ color: 'var(--green-deep)' }}>Vko {g.upcomingThemes[0].week}:</b> {g.upcomingThemes[0].title}</div>
                  : <div style={{ fontSize: 12.5, color: '#a8a297' }}>Ei viikon teemaa</div>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <AvatarStack members={members} size={32} />
                <span style={{ fontSize: 12.5, color: '#8a857a', fontWeight: 600 }}>{members.length} pelaajaa</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// A theme belongs to a week, and a coach plans a term, not a Monday: this editor holds
// every planned week at once, adds a whole run of empty weeks in one click, and saves the
// lot with one Tallenna. It replaces the single-theme dialog that had to be retyped weekly.
function WeeklyThemeRow({ row, weekOptions, onChange, onRemove }) {
  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 12, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', color: '#111', background: '#fff' };
  return (
    <div className="k-card" style={{ padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <select value={window.koutsiIsoWeekKey(row)} onChange={(e) => {
          const opt = weekOptions.find((o) => window.koutsiIsoWeekKey(o) === e.target.value);
          if (opt) onChange({ ...row, year: opt.year, week: opt.week });
        }} style={{ ...inputStyle, width: 'auto', flex: 1, cursor: 'pointer', fontWeight: 700 }}>
          {weekOptions.map((o) => (
            <option key={window.koutsiIsoWeekKey(o)} value={window.koutsiIsoWeekKey(o)}>
              vko {o.week} · {window.koutsiIsoWeekRangeLabel(o.year, o.week)}{o.isNow ? ' (tämä viikko)' : ''}
            </option>
          ))}
        </select>
        <window.KoutsiRowActions onDelete={onRemove} deleteLabel="Poista tämän viikon teema" />
      </div>
      <input value={row.title} onChange={(e) => onChange({ ...row, title: e.target.value })} placeholder="Teema, esim. Kämmenen pelitila" style={inputStyle} />
      <textarea value={row.lead} onChange={(e) => onChange({ ...row, lead: e.target.value })} rows={2} placeholder="Mihin tällä viikolla keskitytään? (vapaaehtoinen)" style={{ ...inputStyle, resize: 'none' }} />
    </div>
  );
}

function WeeklyThemesModal({ group, onClose, onSave }) {
  const toast = window.useKoutsiToast();
  const now = window.koutsiCurrentIsoWeek();
  const [rows, setRows] = React.useState(() => {
    const existing = (group.themes || []).map((t) => ({ key: t.id, id: t.id, year: t.year, week: t.week, title: t.title, lead: t.lead }));
    return existing.length ? existing : [{ key: 'uusi-0', id: null, year: now.year, week: now.week, title: '', lead: '' }];
  });
  const [removedIds, setRemovedIds] = React.useState([]);
  const [addCount, setAddCount] = React.useState(4);
  const [busy, setBusy] = React.useState(false);
  const nextKey = React.useRef(1);

  // one year forward, one week back — enough to plan a season, short enough to scan
  const weekOptions = React.useMemo(() => {
    const out = [];
    for (let i = -1; i <= 52; i++) {
      const w = window.koutsiAddIsoWeeks(now, i);
      out.push({ ...w, isNow: i === 0 });
    }
    return out;
  }, [now.year, now.week]);

  const sorted = rows.slice().sort(window.koutsiCompareIsoWeeks);
  const lastWeek = sorted.length ? sorted[sorted.length - 1] : window.koutsiAddIsoWeeks(now, -1);

  const addWeeks = (count) => {
    const added = [];
    let cursor = rows.length ? lastWeek : window.koutsiAddIsoWeeks(now, -1);
    for (let i = 0; i < count; i++) {
      cursor = window.koutsiAddIsoWeeks(cursor, 1);
      added.push({ key: `uusi-${nextKey.current++}`, id: null, year: cursor.year, week: cursor.week, title: '', lead: '' });
    }
    setRows((prev) => [...prev, ...added]);
  };
  const updateRow = (key, next) => setRows((prev) => prev.map((r) => (r.key === key ? next : r)));
  const removeRow = (row) => {
    if (row.id) setRemovedIds((prev) => [...prev, row.id]);
    setRows((prev) => prev.filter((r) => r.key !== row.key));
  };

  const filled = rows.filter((r) => r.title.trim());
  const duplicate = (() => {
    const seen = new Set();
    return filled.some((r) => {
      const k = window.koutsiIsoWeekKey(r);
      if (seen.has(k)) return true;
      seen.add(k);
      return false;
    });
  })();
  const ready = !busy && (filled.length > 0 || removedIds.length > 0) && !duplicate;

  const save = async () => {
    if (duplicate) { toast.error('Kahdella rivillä on sama viikko. Valitse eri viikot.'); return; }
    setBusy(true);
    await onSave({ rows: filled, removedIds });
    setBusy(false);
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(520px, 100%)', maxHeight: 'calc(100vh - 40px)', padding: 0, display: 'flex', flexDirection: 'column', animation: 'kFadeIn .2s ease' }}>
        <div style={{ padding: '24px 26px 14px', borderBottom: '1px solid var(--line)' }}>
          <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 5 }}>Viikon teemat</h3>
          <p style={{ fontSize: 13, color: '#8a857a', lineHeight: 1.5 }}>{group.name} — jokaiselle viikolle oma teema. Pelaajat näkevät aina kuluvan viikon teeman.</p>
        </div>

        <div style={{ padding: '16px 26px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sorted.map((row) => (
            <WeeklyThemeRow key={row.key} row={row} weekOptions={weekOptions}
              onChange={(next) => updateRow(row.key, next)} onRemove={() => removeRow(row)} />
          ))}
          {rows.length === 0 && <div style={{ color: '#8a857a', fontSize: 14 }}>Ei yhtään viikkoa. Lisää alta.</div>}
        </div>

        <div style={{ padding: '14px 26px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => addWeeks(1)} className="btn-outline btn-sm">+ Lisää viikko</button>
          <span style={{ fontSize: 13, color: '#8a857a' }}>tai</span>
          <input type="number" min={2} max={26} value={addCount} aria-label="Montako viikkoa lisätään kerralla"
            onChange={(e) => setAddCount(Math.max(2, Math.min(26, Number(e.target.value) || 2)))}
            style={{ width: 58, boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 10, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit', color: '#111', background: '#fff' }} />
          <button onClick={() => addWeeks(addCount)} className="btn-outline btn-sm">+ Lisää {addCount} viikkoa kerralla</button>
        </div>

        <div style={{ padding: '14px 26px 22px', borderTop: '1px solid var(--line)' }}>
          {duplicate && <div style={{ fontSize: 12.5, color: '#8f2f24', marginBottom: 10, fontWeight: 600 }}>Kahdella rivillä on sama viikko.</div>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
            <button onClick={() => ready && save()} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: ready ? 1 : 0.45, cursor: ready ? 'pointer' : 'default' }}>
              {busy ? 'Tallennetaan…' : `Tallenna ${filled.length} viikkoa`}
            </button>
          </div>
          <div style={{ fontSize: 12, color: '#a8a297', marginTop: 9, textAlign: 'center' }}>Rivit ilman teemaa jätetään tallentamatta.</div>
        </div>
      </div>
    </div>
  );
}

// Codes now come from the server (unique, always with an expiry and a use limit) and are
// presented as the three things a coach actually needs on court: a tap-through link, a QR
// to hold up, and a ready-written message to paste into WhatsApp.
function InviteCodeBox({ coachId, coachName, groupId, groupName }) {
  const toast = window.useKoutsiToast();
  const confirm = window.useKoutsiConfirm();
  const [issued, setIssued] = React.useState(null);
  const [codes, setCodes] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [showExisting, setShowExisting] = React.useState(false);
  const [maxUses, setMaxUses] = React.useState(1);
  // Valmentajatason koodi on pysyvä: yksi per valmentaja, ei vanhene eikä kulu.
  // Ryhmäkohtaiset koodit ovat eri asia ja käyttävät yhä luontivirtaa.
  const isPermanent = !groupId;
  const [permanentCode, setPermanentCode] = React.useState(null);
  const [codeError, setCodeError] = React.useState('');

  const loadCodes = React.useCallback(async () => {
    if (isPermanent) {
      try {
        const code = await window.koutsiMyJoinCode(coachId);
        if (code) { setPermanentCode(code); setCodeError(''); }
        else setCodeError('Liittymiskoodia ei löytynyt. Päivitä sivu tai ota yhteyttä tukeen.');
      } catch (err) {
        setCodeError(window.koutsiErrorText(err, 'Liittymiskoodin haku epäonnistui.'));
      }
      return;
    }
    try {
      const all = await window.koutsiListInviteCodes(coachId);
      setCodes(all.filter((c) => c.active && c.groupId === groupId));
    } catch { /* the generate button still works without the list */ }
  }, [coachId, groupId, isPermanent]);

  React.useEffect(() => { loadCodes(); }, [loadCodes]);

  const generate = async () => {
    setBusy(true);
    const ok = await toast.run(async () => {
      const result = await window.koutsiCreateInviteCode(groupId, { expiresDays: 14, maxUses, coachId });
      setIssued(result);
      await loadCodes();
    });
    if (!ok) setIssued(null);
    setBusy(false);
  };

  const revoke = async (code) => {
    const ok = await confirm({
      title: `Poista koodi ${code} käytöstä?`,
      body: 'Koodi lakkaa toimimasta heti. Jo liittyneet pelaajat pysyvät valmennuksessasi.',
      confirmLabel: 'Poista käytöstä', danger: true,
    });
    if (!ok) return;
    await toast.run(async () => { await window.koutsiRevokeInviteCode(code); await loadCodes(); }, 'Koodi poistettu käytöstä.');
  };

  const active = isPermanent ? permanentCode : (issued ? issued.code : null);

  if (isPermanent && !active) {
    return (
      <div className="k-card" style={{ padding: '14px 16px', marginTop: 4, fontSize: 13.5, color: codeError ? '#8f2f24' : '#8a857a' }}>
        {codeError || 'Haetaan liittymiskoodia…'}
      </div>
    );
  }

  if (!active) {
    return (
      <div style={{ marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: 12.5, color: '#8a857a', fontWeight: 600 }}>Koodi kelpaa</span>
          {[[1, 'yhdelle'], [5, 'viidelle'], [20, 'koko ryhmälle']].map(([n, label]) => (
            <button key={n} onClick={() => setMaxUses(n)} style={{
              padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              border: maxUses === n ? 'none' : '1px solid #d8d4ca',
              background: maxUses === n ? 'var(--lime)' : '#fff', color: maxUses === n ? '#101a08' : '#3c382f',
            }}>{label}</button>
          ))}
        </div>
        <button onClick={generate} disabled={busy} className="btn-dark btn-sm" style={{ opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Luodaan…' : 'Luo liittymislinkki'}
        </button>
        {codes.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <button onClick={() => setShowExisting((v) => !v)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--green-deep)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              {showExisting ? 'Piilota' : `Voimassa olevat koodit (${codes.length})`}
            </button>
            {showExisting && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {codes.map((c) => (
                  <div key={c.code} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px', borderRadius: 10, background: '#f7f5ef', border: '1px solid var(--line)' }}>
                    <span style={{ fontWeight: 800, letterSpacing: 1.5, fontSize: 13.5, color: '#111' }}>{c.code}</span>
                    <span style={{ fontSize: 11.5, color: '#8a857a', flex: 1 }}>
                      {c.useCount}/{c.maxUses ?? '∞'} käytetty
                      {c.expiresAt ? ` · voimassa ${window.koutsiFmtShortDate(c.expiresAt.slice(0, 10))} asti` : ''}
                    </span>
                    <button onClick={() => setIssued({ code: c.code })} className="btn-outline btn-sm" style={{ padding: '5px 10px', fontSize: 11.5 }}>Näytä</button>
                    <button onClick={() => revoke(c.code)} className="btn-outline btn-sm" style={{ padding: '5px 10px', fontSize: 11.5, color: '#8f2f24', borderColor: '#e3c9c4' }}>Poista</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const link = window.koutsiInviteLink(active);
  const message = window.koutsiInviteMessage(active, coachName, groupName);
  return (
    <div className="k-card" style={{ padding: '16px 17px', marginTop: 4, background: 'rgba(207,228,20,0.08)', borderColor: 'rgba(207,228,20,0.4)' }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--green-deep)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
        {isPermanent ? 'Oma liittymiskoodisi' : `Liittymislinkki${groupName ? ` — ${groupName}` : ''}`}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <window.KoutsiQrCode text={link} size={148} />
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div style={{ fontSize: 12, color: '#8a857a', fontWeight: 700, marginBottom: 3 }}>Koodi</div>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: 3.5, color: '#111', marginBottom: 10 }}>{active}</div>
          <div style={{ fontSize: 12, color: '#514c42', wordBreak: 'break-all', marginBottom: 12, lineHeight: 1.4 }}>{link}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <window.KoutsiCopyButton text={message} label="Kopioi viesti" copiedLabel="Viesti kopioitu!" className="btn-dark btn-sm" />
            <window.KoutsiCopyButton text={link} label="Kopioi linkki" />
          </div>
        </div>
      </div>
      <p style={{ fontSize: 12, color: '#514c42', lineHeight: 1.5, marginTop: 12 }}>
        {isPermanent
          ? 'Tämä on pysyvä koodisi aikuiselle uutena liittymiseen. Alaikäinen lisätään ensin nimellä oppilaslistaan, minkä jälkeen lähetät hänen pelaajakortiltaan henkilökohtaisen liittymislinkin.'
          : `Pelaaja avaa linkin, kirjautuu tai luo Krossi-tilin ja liittyy${groupName ? ' suoraan tähän ryhmään' : ' valmennettavaksesi'} — koodia ei tarvitse näpytellä.${issued && issued.expires_at ? ` Linkki on voimassa ${window.koutsiFmtShortDate(String(issued.expires_at).slice(0, 10))} asti.` : ''}`}
      </p>
      <p style={{ fontSize: 12, color: '#8f2f24', lineHeight: 1.5, marginTop: 8, fontWeight: 700 }}>
        Älä jaa koodia julkisesti. Alaikäiselle käytetään aina pelaajakortin henkilökohtaista linkkiä sekä tarvittavia vahvistuksia.
      </p>
      {!isPermanent && <button onClick={() => setIssued(null)} className="btn-outline btn-sm" style={{ marginTop: 10 }}>Valmis</button>}
    </div>
  );
}

function GroupFormModal({ students, editing, onClose, onSave, zIndex = 80 }) {
  const isEdit = Boolean(editing);
  const [name, setName] = React.useState(() => (editing ? editing.name : ''));
  const [level, setLevel] = React.useState(() => (editing ? editing.level || '' : ''));
  const [day, setDay] = React.useState(() => (editing ? editing.day || 'Ma' : 'Ma'));
  const [time, setTime] = React.useState(() => (editing ? editing.time || '' : ''));
  const [duration, setDuration] = React.useState(() => (editing ? editing.durationMinutes || 60 : 60));
  const [memberIds, setMemberIds] = React.useState([]);
  const toggleMember = (id) => setMemberIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const ready = name.trim() && time.trim();
  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };
  const label = { fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 };
  const days = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(480px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 16 }}>{isEdit ? 'Muokkaa ryhmää' : 'Uusi ryhmä'}</h3>
        <div style={label}>Nimi</div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Esim. Iltaryhmä" style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={label}>Taso</div>
        <input value={level} onChange={(e) => setLevel(e.target.value)} placeholder="Esim. Keskitaso" style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={label}>Viikonpäivä</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
          {days.map((d) => (
            <button key={d} onClick={() => setDay(d)} style={{ padding: '8px 13px', borderRadius: 999, border: day === d ? 'none' : '1px solid #d8d4ca', background: day === d ? 'var(--lime)' : '#fff', color: day === d ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>{d}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 6 }}>
          <div style={{ flex: 1 }}>
            <div style={label}>Kellonaika</div>
            <input type="time" step={900} value={time}
              onChange={(e) => setTime(window.koutsiRoundTimeToQuarterHour(e.target.value))}
              onClick={(e) => e.currentTarget.showPicker?.()}
              style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={label}>Kesto (min)</div>
            <input type="number" inputMode="numeric" min={15} max={480} step={15} value={duration}
              onChange={(e) => setDuration(e.target.value === '' ? '' : Number(e.target.value))}
              onBlur={() => setDuration((d) => window.koutsiRoundToQuarterHourMinutes(d))}
              style={inputStyle} />
          </div>
        </div>
        {time && <div style={{ fontSize: 12.5, color: '#8a857a', marginBottom: 20 }}>{day} klo {window.koutsiTimeRangeLabel(time, duration)} viikoittain</div>}
        {!time && <div style={{ marginBottom: 20 }} />}
        {!isEdit && <div style={label}>Pelaajat ({memberIds.length} valittu)</div>}
        <div style={{ display: isEdit ? 'none' : 'flex', flexDirection: 'column', gap: 8, marginBottom: 10, maxHeight: 220, overflowY: 'auto' }}>
          {students.map((s) => (
            <button key={s.id} onClick={() => toggleMember(s.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 12, border: memberIds.includes(s.id) ? '2px solid var(--lime)' : '1px solid #d8d4ca', background: memberIds.includes(s.id) ? 'rgba(207,228,20,0.1)' : '#fff', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%' }}>
              <Avatar src={s.avatarUrl} initial={s.initial} hue={s.hue} size={30} />
              <span style={{ fontWeight: 600, fontSize: 13.5, color: '#111', flex: 1 }}>{s.name}</span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={() => ready && onSave({ name: name.trim(), level: level.trim() || 'Kaikki tasot', day, time: time.trim(), durationMinutes: duration, memberIds })} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: ready ? 1 : 0.45, cursor: ready ? 'pointer' : 'default' }}>{isEdit ? 'Tallenna' : 'Luo ryhmä'}</button>
        </div>
        {!isEdit && <p style={{ fontSize: 12, color: '#8a857a', marginTop: 12, lineHeight: 1.5 }}>Viikoittaiset treenit ilmestyvät kalenteriin automaattisesti vuodeksi eteenpäin. Voit kutsua uusia pelaajia liittymislinkillä ryhmän luomisen jälkeen.</p>}
      </div>
    </div>
  );
}

// A second (or third) weekly training time for a group that already has its primary
// slot — e.g. a group that meets both Tuesday and Thursday. Same day/time/duration inputs
// as the group form's own schedule fields, just for one extra slot at a time.
function GroupSlotModal({ onClose, onSave }) {
  const [day, setDay] = React.useState('Ma');
  const [time, setTime] = React.useState('');
  const [duration, setDuration] = React.useState(60);
  const [busy, setBusy] = React.useState(false);
  const days = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];
  const ready = time.trim();
  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };
  const label = { fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 };
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    await onSave({ day, time: time.trim(), durationMinutes: duration });
  };
  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(420px, 100%)', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 6 }}>Lisää harjoitusaika</h3>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 18, lineHeight: 1.5 }}>Toinen viikoittainen aika samalle ryhmälle — treenit ilmestyvät kalenteriin vuodeksi eteenpäin, kuten ryhmän pääaikakin.</p>
        <div style={label}>Viikonpäivä</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
          {days.map((d) => (
            <button key={d} onClick={() => setDay(d)} style={{ padding: '8px 13px', borderRadius: 999, border: day === d ? 'none' : '1px solid #d8d4ca', background: day === d ? 'var(--lime)' : '#fff', color: day === d ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>{d}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <div style={label}>Kellonaika</div>
            <input type="time" step={900} value={time} onClick={(e) => e.currentTarget.showPicker?.()}
              onChange={(e) => setTime(window.koutsiRoundTimeToQuarterHour(e.target.value))} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={label}>Kesto (min)</div>
            <input type="number" inputMode="numeric" min={15} max={480} step={15} value={duration}
              onChange={(e) => setDuration(e.target.value === '' ? '' : Number(e.target.value))}
              onBlur={() => setDuration((d) => window.koutsiRoundToQuarterHourMinutes(d))}
              style={inputStyle} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={busy} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={submit} disabled={!ready || busy} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: (ready && !busy) ? 1 : 0.45, cursor: (ready && !busy) ? 'pointer' : 'default' }}>{busy ? 'Tallennetaan…' : 'Lisää'}</button>
        </div>
      </div>
    </div>
  );
}

function AddMembersModal({ coachId, coachName, group, allStudents, onClose, onSave, onCreatePlayer }) {
  const available = allStudents.filter((s) => !group.memberIds.includes(s.id));
  const [selected, setSelected] = React.useState([]);
  const [quickCreateOpen, setQuickCreateOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [age, setAge] = React.useState('');
  const [level, setLevel] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState('');
  const nameInputRef = React.useRef(null);
  const toggle = (id) => setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const parsedAge = age ? Number(age) : null;
  const ageValid = parsedAge == null || (Number.isInteger(parsedAge) && parsedAge >= 1 && parsedAge < 120);
  const createReady = name.trim() && ageValid && !creating;
  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 12, padding: '11px 12px', fontSize: 13.5, fontFamily: 'inherit', color: '#111', background: '#fff' };
  const openQuickCreate = () => {
    setQuickCreateOpen(true);
    setCreateError('');
    window.setTimeout(() => nameInputRef.current?.focus(), 0);
  };
  const createPlayer = async (event) => {
    event.preventDefault();
    if (!createReady) return;
    setCreating(true);
    setCreateError('');
    try {
      await onCreatePlayer({ name: name.trim(), age: parsedAge, level: level.trim() || null });
      setName(''); setAge(''); setLevel('');
      window.setTimeout(() => nameInputRef.current?.focus(), 0);
    } catch (err) {
      setCreateError(window.koutsiErrorText(err, 'Pelaajan luonti epäonnistui'));
    } finally {
      setCreating(false);
    }
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(500px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 4 }}>Lisää pelaajia</h3>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 16 }}>{group.name}</p>

        {!quickCreateOpen ? (
          <button onClick={openQuickCreate} className="btn-outline" style={{ width: '100%', padding: '12px 14px', marginBottom: 18 }}>
            + Luo uusi pelaaja tähän ryhmään
          </button>
        ) : (
          <form onSubmit={createPlayer} className="k-card" style={{ padding: '15px', marginBottom: 18, background: 'rgba(207,228,20,0.08)', borderColor: 'rgba(14,59,44,0.16)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--green-deep)' }}>Uusi pelaaja tähän ryhmään</div>
                <div style={{ fontSize: 11.5, color: '#8a857a', marginTop: 2 }}>Nimi riittää. Ikä ja taso ovat valinnaisia.</div>
              </div>
              <button type="button" onClick={() => { setQuickCreateOpen(false); setCreateError(''); }} disabled={creating} aria-label="Sulje uuden pelaajan luonti" style={{ width: 30, height: 30, border: 'none', borderRadius: '50%', background: '#f1eee5', color: '#514c42', cursor: creating ? 'default' : 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
            </div>
            {createError && <div style={{ background: 'rgba(161,59,47,0.08)', border: '1px solid rgba(161,59,47,0.25)', color: '#a13b2f', padding: '9px 11px', borderRadius: 10, fontSize: 12.5, marginBottom: 10 }}>{createError}</div>}
            <input ref={nameInputRef} aria-label="Uuden pelaajan nimi" value={name} onChange={(e) => setName(e.target.value)} placeholder="Pelaajan nimi" maxLength={120} style={{ ...inputStyle, marginBottom: 8 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '95px minmax(0, 1fr)', gap: 8, marginBottom: age && !ageValid ? 5 : 10 }}>
              <input aria-label="Uuden pelaajan ikä" value={age} onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="Ikä" style={{ ...inputStyle, borderColor: age && !ageValid ? '#c2543f' : '#d8d4ca' }} />
              <input aria-label="Uuden pelaajan taso" value={level} onChange={(e) => setLevel(e.target.value)} placeholder="Taso, esim. Aloittelija" maxLength={80} style={inputStyle} />
            </div>
            {age && !ageValid && <div style={{ fontSize: 12, color: '#c2543f', marginBottom: 10 }}>Iän pitää olla väliltä 1–119 vuotta.</div>}
            <button type="submit" disabled={!createReady} className="btn-dark btn-sm" style={{ width: '100%', opacity: createReady ? 1 : 0.45, cursor: createReady ? 'pointer' : 'default' }}>
              {creating ? 'Luodaan ja lisätään…' : 'Luo ja lisää ryhmään'}
            </button>
          </form>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ height: 1, background: '#e3dfd5', flex: 1 }} />
          <span style={{ fontSize: 10.5, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5 }}>Valitse nykyisistä oppilaista</span>
          <span style={{ height: 1, background: '#e3dfd5', flex: 1 }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10, maxHeight: 260, overflowY: 'auto' }}>
          {available.map((s) => (
            <button key={s.id} onClick={() => toggle(s.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 12, border: selected.includes(s.id) ? '2px solid var(--lime)' : '1px solid #d8d4ca', background: selected.includes(s.id) ? 'rgba(207,228,20,0.1)' : '#fff', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%' }}>
              <Avatar src={s.avatarUrl} initial={s.initial} hue={s.hue} size={30} />
              <span style={{ fontWeight: 600, fontSize: 13.5, color: '#111', flex: 1 }}>{s.name}</span>
            </button>
          ))}
          {available.length === 0 && <div style={{ color: '#8a857a', fontSize: 14 }}>Kaikki oppilaasi ovat jo tässä ryhmässä.</div>}
        </div>
        <InviteCodeBox coachId={coachId} coachName={coachName} groupId={group.id} groupName={group.name} />
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={() => selected.length > 0 && onSave(selected)} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: selected.length ? 1 : 0.45, cursor: selected.length ? 'pointer' : 'default' }}>Lisää ({selected.length})</button>
        </div>
      </div>
    </div>
  );
}

// The annual plan is a real object in a private Supabase bucket now, so it can be opened
// and replaced. This supersedes two earlier stopgaps: the original version stored only a
// filename (the coach saw a document listed that nobody could open), and the mailto form
// that replaced it asked the coach to email the file to support.
function AnnualPlanCard({ group, onUploadPlan, onRemovePlan }) {
  const toast = window.useKoutsiToast();
  const confirm = window.useKoutsiConfirm();
  const [busy, setBusy] = React.useState(false);
  const [selectedFile, setSelectedFile] = React.useState(null);
  const plan = group.annualPlan;
  const inReview = plan && plan.status !== 'published';

  const send = async () => {
    if (!selectedFile || busy) return;
    setBusy(true);
    const sent = await toast.run(
      () => onUploadPlan(group.id, selectedFile),
      'Vuosisuunnitelma lähetetty ylläpidolle. Ilmoitamme sinulle, kun se on päivitetty ryhmällesi.',
    );
    if (sent) setSelectedFile(null);
    setBusy(false);
  };
  const open = async () => {
    if (!plan?.storagePath) { toast.info('Tästä suunnitelmasta ei ole tallennettua tiedostoa — lataa se uudelleen.'); return; }
    setBusy(true);
    try {
      const url = await window.koutsiAnnualPlanUrl(plan.storagePath);
      window.open(url, '_blank', 'noopener');
    } catch (err) { toast.error(window.koutsiErrorText(err)); } finally { setBusy(false); }
  };
  const remove = async () => {
    const ok = await confirm({
      title: 'Peruuta vuosisuunnitelman lähetys?',
      body: `${plan.filename} poistetaan pysyvästi.`,
      confirmLabel: 'Poista', danger: true,
    });
    if (!ok) return;
    await toast.run(() => onRemovePlan(group.id, plan.storagePath), 'Vuosisuunnitelma poistettu.');
  };

  const betaNote = (
    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '13px 14px', borderRadius: 13, background: 'rgba(214,140,44,0.10)', border: '1px solid rgba(214,140,44,0.28)', marginBottom: 14 }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, color: '#8a5a12', background: 'rgba(214,140,44,0.22)', borderRadius: 999, padding: '3px 8px', flexShrink: 0, marginTop: 1 }}>BETA</span>
      <div style={{ fontSize: 12.5, color: '#6b4a12', lineHeight: 1.5 }}>
        <div style={{ fontWeight: 800, marginBottom: 5 }}>Näin vuosisuunnitelman lähetys toimii</div>
        <ol style={{ margin: 0, paddingLeft: 18 }}>
          <li>Valitse tiedosto tähän.</li>
          <li>Paina <b>Lähetä vuosisuunnitelma</b>. Tiedosto tallentuu ja ylläpito saa tiedon uudesta suunnitelmasta.</li>
          <li>Päivityksessä kestää hetki. Ylläpito lisää suunnitelman ryhmällesi ja ilmoittaa, kun se on valmis.</li>
        </ol>
      </div>
    </div>
  );

  const uploadForm = (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 9 }}>
        <label className="btn-outline btn-sm" style={{ cursor: busy ? 'default' : 'pointer', display: 'inline-block', opacity: busy ? 0.6 : 1 }}>
          {selectedFile ? 'Vaihda tiedosto' : 'Valitse tiedosto'}
          <input type="file" accept=".pdf,.csv,.xls,.xlsx" style={{ display: 'none' }} disabled={busy}
            onChange={(e) => { setSelectedFile(e.target.files[0] || null); e.target.value = ''; }} />
        </label>
        <span style={{ fontSize: 12, color: '#a8a297' }}>PDF, CSV tai Excel, enintään 20 Mt.</span>
      </div>
      {selectedFile && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, padding: '10px 12px', borderRadius: 12, background: '#f7f6f2', border: '1px solid #e4e0d7' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, color: '#8a857a', marginBottom: 2 }}>Valittu tiedosto</div>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedFile.name}</div>
          </div>
          <button type="button" onClick={() => setSelectedFile(null)} disabled={busy} aria-label="Poista valittu tiedosto"
            style={{ border: 'none', background: 'none', color: '#6f695f', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 12, padding: 5 }}>Poista</button>
        </div>
      )}
      <button type="button" onClick={send} disabled={!selectedFile || busy} className="btn-dark btn-sm"
        style={{ marginTop: 10, opacity: selectedFile && !busy ? 1 : 0.45, cursor: selectedFile && !busy ? 'pointer' : 'default' }}>
        {busy ? 'Lähetetään…' : plan ? 'Lähetä uusi versio' : 'Lähetä vuosisuunnitelma'}
      </button>
      {!selectedFile && <div style={{ fontSize: 12, color: '#8a857a', marginTop: 7 }}>Valitse ensin tiedosto. Mitään ei lähetetä ennen kuin painat lähetysnappia.</div>}
    </div>
  );

  if (!plan) {
    return (
      <div>
        {betaNote}
        {uploadForm}
      </div>
    );
  }
  return (
    <div>
      {betaNote}
      <div className="k-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px' }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(14,59,44,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 1.5h7l3 3v10a1 1 0 01-1 1H3a1 1 0 01-1-1v-12a1 1 0 011-1z" stroke="var(--green-deep)" strokeWidth="1.4" /><path d="M5 8.5h6M5 11h6" stroke="var(--green-deep)" strokeWidth="1.4" strokeLinecap="round" /></svg>
        </span>
        <button onClick={open} disabled={busy} style={{ minWidth: 0, flex: 1, background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{plan.filename}</div>
          <div style={{ fontSize: 12, color: '#8a857a', marginTop: 2 }}>
            {inReview ? 'Lähetetty ylläpidolle' : 'Päivitetty ryhmälle'} {window.koutsiFmtShortDate(plan.date)}{plan.sizeBytes ? ` · ${Math.max(1, Math.round(plan.sizeBytes / 1024))} kt` : ''}
          </div>
        </button>
        <span style={{
          fontSize: 11, fontWeight: 800, letterSpacing: 0.3, borderRadius: 999, padding: '5px 10px', flexShrink: 0,
          background: inReview ? 'rgba(214,140,44,0.16)' : 'rgba(14,59,44,0.10)',
          color: inReview ? '#8a5a12' : 'var(--green-deep)',
        }}>{inReview ? 'Odottaa ylläpitoa' : 'Käytössä'}</span>
        <window.KoutsiRowActions onDelete={remove} deleteLabel="Poista vuosisuunnitelma" />
      </div>
      <div style={{ marginTop: 12 }}>{uploadForm}</div>
    </div>
  );
}

function GroupDetail({ group, members, trainings, upcoming, onClose, onOpenStudent, onOpenAttendance, onEditTheme, onAddMembers, onUploadPlan, onRemovePlan, onEditGroup, onDeleteGroup, onRemoveMember, onAddSlot, onDeleteSlot }) {
  const nowWeek = window.koutsiCurrentIsoWeek();
  const sortedTrainings = (trainings || []).slice().sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  const thisWeekTrainings = sortedTrainings.filter((t) => {
    const w = window.koutsiIsoWeekOfDateStr(t.date);
    return w.year === nowWeek.year && w.week === nowWeek.week;
  });
  const attendanceTrainings = [...thisWeekTrainings, ...sortedTrainings.filter((t) => t.date >= window.koutsiTodayStr()).slice(0, 3)]
    .filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i)
    .slice(0, 4);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(10,15,10,0.35)', animation: 'kFadeIn .2s ease' }} />
      <div style={{ position: 'relative', width: 'min(480px, 100%)', height: '100%', background: '#fff', boxShadow: '-16px 0 40px -20px rgba(0,0,0,0.35)', overflowY: 'auto', animation: 'kSlideIn .25s ease' }}>
        <div style={{ padding: '26px 28px 0', display: 'flex', justifyContent: 'flex-end' }}>
          <CloseButton onClick={onClose} />
        </div>
        <div style={{ padding: '10px 28px 60px' }}>
          <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: '#111', fontWeight: 800, fontSize: 22 }}>{group.name}</div>
              <div style={{ marginTop: 8 }}><LevelChip level={group.level} /></div>
              <div style={{ fontSize: 14, color: '#514c42', marginTop: 12 }}>Viikoittain: {group.day} klo {window.koutsiTimeRangeLabel(group.time, group.durationMinutes)}</div>
              {(group.slots || []).map((slot) => (
                <div key={slot.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                  <span style={{ fontSize: 14, color: '#514c42' }}>Lisäksi: {slot.day} klo {window.koutsiTimeRangeLabel(slot.time, slot.durationMinutes)}</span>
                  <window.KoutsiRowActions onDelete={() => onDeleteSlot(slot)} deleteLabel="Poista harjoitusaika" />
                </div>
              ))}
              <button onClick={onAddSlot} className="btn-outline btn-sm" style={{ marginTop: 10 }}>+ Toinen harjoitusaika</button>
            </div>
            <window.KoutsiRowActions onEdit={onEditGroup} editLabel="Muokkaa ryhmää" />
          </div>
          <div style={{ marginBottom: 22 }}>
            {group.theme
              ? <GroupThemeBanner theme={group.theme} label="Tämän viikon teema" />
              : (group.upcomingThemes || []).length > 0
                ? <GroupThemeBanner theme={group.upcomingThemes[0]} label="Seuraava suunniteltu teema" />
                : <div style={{ fontSize: 14, color: '#8a857a' }}>Ei vielä viikkoteemoja. Voit suunnitella useamman viikon kerralla.</div>}
            <button onClick={onEditTheme} className="btn-outline btn-sm" style={{ marginTop: 10 }}>
              {(group.themes || []).length > 0 ? `Muokkaa viikkoteemoja (${group.themes.length})` : '+ Suunnittele viikkoteemat'}
            </button>
            {(group.upcomingThemes || []).length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5 }}>Tulevat viikot</div>
                {group.upcomingThemes.slice(0, 5).map((t) => (
                  <div key={t.id} style={{ fontSize: 13.5, color: '#3c382f' }}>
                    <b style={{ color: 'var(--green-deep)' }}>vko {t.week}</b> · {window.koutsiIsoWeekRangeLabel(t.year, t.week)} — {t.title}
                  </div>
                ))}
                {group.upcomingThemes.length > 5 && <div style={{ fontSize: 12.5, color: '#a8a297' }}>+{group.upcomingThemes.length - 5} viikkoa lisää</div>}
              </div>
            )}
          </div>
          <Field label="Vuosisuunnitelma">
            <AnnualPlanCard group={group} onUploadPlan={onUploadPlan} onRemovePlan={onRemovePlan} />
          </Field>
          <Field label="Läsnäolot">
            <div style={{ fontSize: 12.5, color: '#8a857a', lineHeight: 1.45, marginBottom: 9 }}>Avaa treeni ja valitse jokaiselle paikalla tai poissa.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {attendanceTrainings.map((t) => {
                const missing = (t.absences || []).filter((a) => members.some((m) => m.id === a.studentId)).length;
                return (
                  <button key={t.id} onClick={() => onOpenAttendance(t.id)} className="k-card" style={{ width: '100%', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textAlign: 'left' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, color: '#111', fontWeight: 750 }}>{window.koutsiFmtShortDate(t.date)} · {t.time}</div>
                      <div style={{ fontSize: 12, color: missing ? '#8a5a12' : '#2f7d54', marginTop: 3 }}>{missing ? `${missing} poissa` : 'Kaikki merkitty paikalle'}</div>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 750, color: 'var(--green-deep)' }}>Kirjaa →</span>
                  </button>
                );
              })}
              {attendanceTrainings.length === 0 && <div style={{ color: '#8a857a', fontSize: 14 }}>Ei vielä treenejä, joihin läsnäolon voisi kirjata.</div>}
            </div>
          </Field>
          <Field label={`Jäsenet (${members.length})`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {members.map((m) => (
                <div key={m.id} className="k-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px' }}>
                  <button onClick={() => onOpenStudent(m.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, textAlign: 'left', cursor: 'pointer', background: 'none', border: 'none', padding: 0, fontFamily: 'inherit' }}>
                    <Avatar src={m.avatarUrl} initial={m.initial} hue={m.hue} size={40} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14.5, color: '#111' }}>{m.name}</div>
                      <div style={{ marginTop: 4 }}><PlayerAppStatus isPlaceholder={m.isPlaceholder} compact /></div>
                    </div>
                  </button>
                  <window.KoutsiRowActions onDelete={() => onRemoveMember(m)} deleteLabel="Poista ryhmästä" />
                </div>
              ))}
              {members.length === 0 && <div style={{ color: '#8a857a', fontSize: 14 }}>Ei vielä jäseniä.</div>}
            </div>
            <button onClick={onAddMembers} className="btn-outline btn-sm" style={{ marginTop: 12 }}>+ Lisää pelaajia</button>
          </Field>
          <Field label="Tulevat treenit">
            {upcoming.length === 0 && <div style={{ color: '#8a857a', fontSize: 14 }}>Ei tulevia treenejä.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {upcoming.map((t) => (
                <div key={t.id} style={{ fontSize: 14.5, color: '#3c382f', padding: '4px 0' }}>{window.koutsiFmtShortDate(t.date)} · {t.time}</div>
              ))}
            </div>
          </Field>

          <div style={{ marginTop: 34, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Ryhmän poistaminen</div>
            <p style={{ fontSize: 13, color: '#8a857a', lineHeight: 1.5, marginBottom: 12 }}>
              Ryhmä ja sen tulevat treenit poistetaan. Pelaajat säilyvät oppilainasi.
            </p>
            <button onClick={onDeleteGroup} style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              border: '1px solid rgba(143,47,36,0.35)', background: '#fff', color: '#8f2f24',
              borderRadius: 999, padding: '11px 20px', fontSize: 14, fontWeight: 700,
              fontFamily: 'inherit', cursor: 'pointer',
            }}>
              <window.KoutsiTrashIcon /> Poista ryhmä
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Treenit / kalenteri ──────────────────────────────────
function CalendarGrid({ state, viewYear, viewMonth, selectedDate, todayStr, onSelect, onPrev, onNext }) {
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startWeekday = (firstOfMonth.getDay() + 6) % 7; // Mon=0..Sun=6
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const dateStrFor = (d) => `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  return (
    <div className="k-card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <button onClick={onPrev} aria-label="Edellinen kuukausi" style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--line)', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="7" height="12" viewBox="0 0 8 14"><path d="M7 1L1 7l6 6" stroke="#111" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div style={{ fontWeight: 800, fontSize: 15, color: '#111', textTransform: 'capitalize' }}>{window.KOUTSI_MONTHS[viewMonth]} {viewYear}</div>
        <button onClick={onNext} aria-label="Seuraava kuukausi" style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--line)', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="7" height="12" viewBox="0 0 8 14"><path d="M1 1l6 6-6 6" stroke="#111" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 6 }}>
        {CAL_WEEKDAY_LABELS.map((d) => <div key={d} style={{ fontSize: 10.5, fontWeight: 700, color: '#a8a297', textAlign: 'center' }}>{d}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {cells.map((d, i) => {
          if (d == null) return <div key={i} />;
          const ds = dateStrFor(d);
          // Player-logged practice is the player's own calendar, not a session the coach
          // is running — it stays off the coach's schedule grid (see StudentDetail's
          // Omatoimisuus card for where the coach does see it).
          const dayTrainings = window.koutsiTrainingsOnDate(state, ds).filter((t) => t.loggedBy !== 'player');
          const dayClubEvents = window.koutsiClubEventsOnDate(state, ds);
          const isToday = ds === todayStr;
          const isSelected = ds === selectedDate;
          return (
            <button key={i} onClick={() => onSelect(ds)} style={{
              aspectRatio: '1', borderRadius: 10, border: isSelected ? '2px solid var(--green-deep)' : '2px solid transparent',
              background: isSelected ? 'rgba(14,59,44,0.06)' : isToday ? 'rgba(207,228,20,0.2)' : 'transparent',
              cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, fontFamily: 'inherit',
            }}>
              <span style={{ fontSize: 13, fontWeight: isToday ? 800 : 600, color: '#111' }}>{d}</span>
              {(dayTrainings.length > 0 || dayClubEvents.length > 0) && (
                <span style={{ display: 'flex', gap: 2 }}>
                  {dayTrainings.slice(0, 3).map((t, ti) => <span key={ti} style={{ width: 5, height: 5, borderRadius: '50%', background: t.groupId != null ? 'var(--green-deep)' : 'var(--lime)' }} />)}
                  {dayClubEvents.length > 0 && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#c77b2e' }} />}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8a857a' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--lime)' }} />Yksilö</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8a857a' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green-deep)' }} />Ryhmä</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8a857a' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#c77b2e' }} />Seuran tapahtuma</span>
      </div>
    </div>
  );
}

function CalendarView({ state, onAdd, onPreSession, onEditTraining, onDeleteTraining, onAddEvent, onEditEvent, onDeleteEvent }) {
  const todayStr = window.koutsiTodayStr();
  const todayDate = window.koutsiDateFromStr(todayStr);
  const [viewYear, setViewYear] = React.useState(todayDate.getFullYear());
  const [viewMonth, setViewMonth] = React.useState(todayDate.getMonth());
  const [selectedDate, setSelectedDate] = React.useState(() => {
    const upcoming = state.trainings.filter((t) => t.loggedBy !== 'player' && t.date >= todayStr).slice().sort((a, b) => a.date.localeCompare(b.date));
    return upcoming[0] ? upcoming[0].date : todayStr;
  });

  const prevMonth = () => { if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); } else setViewMonth((m) => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); } else setViewMonth((m) => m + 1); };

  const trainingsOnSelected = window.koutsiTrainingsOnDate(state, selectedDate).filter((t) => t.loggedBy !== 'player');
  const clubEventsOnSelected = window.koutsiClubEventsOnDate(state, selectedDate);

  return (
    <div>
      <PageHeader title="Treenit" sub="Kalenteri ja tulevat valmennukset" action={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => onAddEvent(selectedDate)} className="btn-outline btn-sm">+ Tapahtuma</button>
          <button onClick={() => onAdd(selectedDate)} className="btn-dark btn-sm">+ Lisää valmennus</button>
        </div>
      } />
      <div className="kv-calendar-layout">
        <CalendarGrid state={state} viewYear={viewYear} viewMonth={viewMonth} selectedDate={selectedDate} todayStr={todayStr}
          onSelect={setSelectedDate} onPrev={prevMonth} onNext={nextMonth} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 14 }}>{window.koutsiFmtLongDate(selectedDate)}</div>
          {clubEventsOnSelected.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {clubEventsOnSelected.map((e) => {
                const kindLabel = (window.KOUTSI_EVENT_KINDS.find((k) => k.value === e.kind) || {}).label;
                return (
                  <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 15px', borderRadius: 14, background: 'rgba(199,123,46,0.1)', border: '1px solid rgba(199,123,46,0.3)' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#c77b2e', flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13.5, color: '#7a4c1e', fontWeight: 700 }}>{e.title}</span>
                      {e.endDate && e.endDate !== e.date && (
                        <span style={{ display: 'block', fontSize: 11.5, color: '#9a6a30', marginTop: 2 }}>{window.koutsiFmtShortDate(e.date)}–{window.koutsiFmtShortDate(e.endDate)}</span>
                      )}
                    </span>
                    {kindLabel && <span style={{ fontSize: 11.5, color: '#9a6a30', fontWeight: 600 }}>{kindLabel}</span>}
                    <window.KoutsiRowActions onEdit={() => onEditEvent(e)} onDelete={() => onDeleteEvent(e)} editLabel="Muokkaa tapahtumaa" deleteLabel="Poista tapahtuma" />
                  </div>
                );
              })}
            </div>
          )}
          {trainingsOnSelected.length === 0 && clubEventsOnSelected.length === 0 && <div className="k-card" style={{ padding: 22, color: '#8a857a', fontSize: 14.5 }}>Ei valmennuksia tänä päivänä.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {trainingsOnSelected.map((t) => {
              const party = window.koutsiTrainingParty(state, t);
              const trainingCoach = window.koutsiCoachById(state, t.coachId);
              return (
                <div key={t.id} className="k-card k-clickable-card" role="button" tabIndex={0}
                  aria-label={`Avaa treeni ${party.kind === 'group' && party.group ? party.group.name : party.student?.name || ''} ${window.koutsiFmtShortDate(t.date)} kello ${t.time}`}
                  onClick={() => onPreSession(t.id)}
                  onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPreSession(t.id); } }}
                  style={{ padding: '16px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                    <div style={{ width: 90, fontSize: 14.5, fontWeight: 800, color: 'var(--green-deep)', flexShrink: 0 }}>{window.koutsiTimeRangeLabel(t.time, t.durationMinutes)}</div>
                    {party.kind === 'student' && party.student && <Avatar src={party.student.avatarUrl} initial={party.student.initial} hue={party.student.hue} size={38} />}
                    {party.kind === 'group' && <AvatarStack members={party.members} size={38} />}
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div style={{ color: '#111', fontWeight: 700, fontSize: 15 }}>{party.kind === 'group' ? (party.group ? party.group.name : 'Ryhmä') : (party.student ? party.student.name : '—')}</div>
                      <div style={{ color: '#8a857a', fontSize: 12.5 }}>{t.type}{party.kind === 'group' ? ` · ${party.members.length} pelaajaa` : ''}{trainingCoach ? ` · ${trainingCoach.name}` : ''}</div>
                    </div>
                    <span style={{ color: 'var(--green-deep)', fontSize: 12.5, fontWeight: 750, whiteSpace: 'nowrap' }}>Avaa →</span>
                    <window.KoutsiRowActions onEdit={() => onEditTraining(t)} onDelete={() => onDeleteTraining(t)} editLabel="Muokkaa treeniä" deleteLabel="Poista treeni" />
                  </div>
                  {t.seriesId && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 11.5, color: '#8a857a', fontWeight: 600 }}>
                      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M2 7a5 5 0 018.5-3.5M12 7a5 5 0 01-8.5 3.5" stroke="#8a857a" strokeWidth="1.5" strokeLinecap="round" /><path d="M10.5 1v2.7H7.8M3.5 13v-2.7h2.7" stroke="#8a857a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      Osa viikoittaista sarjaa
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function PreSessionPanel({ training, state, onClose, onEditAttendance }) {
  const party = window.koutsiTrainingParty(state, training);
  const members = party.kind === 'group' ? party.members : (party.student ? [party.student] : []);
  const suggestions = state.exercises.slice(0, 3);
  const trainingCoach = window.koutsiCoachById(state, training.coachId);
  const absences = training.absences || [];
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(560px, 100%)', maxHeight: '86vh', overflowY: 'auto', padding: '28px 28px 26px', animation: 'kFadeIn .2s ease' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Treenin tiedot ja läsnäolot</div>
        <h3 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>{window.koutsiFmtShortDate(training.date)} · {window.koutsiTimeRangeLabel(training.time, training.durationMinutes)}</h3>
        <div style={{ fontSize: 14, color: '#8a857a', fontWeight: 600, marginBottom: 20 }}>
          {party.kind === 'group' && party.group ? party.group.name : ''}{party.kind === 'group' && party.group && trainingCoach ? ' · ' : ''}{trainingCoach ? trainingCoach.name : ''}
        </div>
        <Field label="Pelaajat">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {members.map((m) => {
              const entry = absences.find((a) => a.studentId === m.id);
              return (
                <div key={m.id} className="k-card" style={{ display: 'flex', gap: 13, alignItems: 'flex-start', flexWrap: 'wrap', padding: '13px 15px' }}>
                  <Avatar src={m.avatarUrl} initial={m.initial} hue={m.hue} size={40} />
                  <div style={{ minWidth: 150, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#111' }}>{m.name}</div>
                    <div style={{ fontSize: 13, color: '#514c42', marginTop: 3, lineHeight: 1.4 }}>Jatka: {m.focus}</div>
                    <div style={{ fontSize: 12.5, color: '#8a857a', marginTop: 1, lineHeight: 1.4 }}>Huomioi: {m.lastSession}</div>
                    {m.playerWish && <div style={{ fontSize: 12.5, color: '#5c6b06', marginTop: 1, lineHeight: 1.4, fontWeight: 600 }}>Toivoo: {m.playerWish}</div>}
                    {entry?.reportedBy && <div style={{ fontSize: 11.5, color: '#a8a297', marginTop: 3 }}>{entry.reportedBy === m.id ? 'Pelaajan ilmoittama' : 'Valmentajan kirjaama'}</div>}
                  </div>
                  <window.KoutsiAttendanceBadge entry={entry} onClick={() => onEditAttendance(m.id)} />
                </div>
              );
            })}
          </div>
        </Field>
        {party.kind === 'group' && party.group && window.koutsiThemeForDate(party.group, training.date) && (
          <Field label="Tämän treenin viikkoteema">
            <GroupThemeBanner theme={window.koutsiThemeForDate(party.group, training.date)} label="Viikon teema" />
          </Field>
        )}
        <Field label="Ehdotetut harjoitteet">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {suggestions.map((ex) => <div key={ex.id} style={{ fontSize: 14, color: '#3c382f' }}>• {ex.name} — {ex.duration}</div>)}
          </div>
        </Field>
        <button onClick={onClose} className="btn-outline" style={{ width: '100%', padding: '13px 0', marginTop: 4 }}>Sulje</button>
      </div>
    </div>
  );
}

// Doubles as "new" and "edit". The repeat option is the reason a coach can now plan a
// year in one sitting instead of adding ~50 rows by hand; when editing an occurrence
// that belongs to a series, the save button asks which of the two they meant.
function TrainingModal({ students, groups, defaultDate, editing, onClose, onSave, onSaveSeries, onCreateGroup }) {
  const isEdit = Boolean(editing);
  const [targetType, setTargetType] = React.useState(() => (editing && editing.groupId != null ? 'group' : 'student'));
  const [studentId, setStudentId] = React.useState(() => (editing ? editing.studentId : (students[0] ? students[0].id : null)));
  const [groupId, setGroupId] = React.useState(() => (editing ? editing.groupId : (groups[0] ? groups[0].id : null)));
  const [date, setDate] = React.useState(() => (editing ? editing.date : (defaultDate || window.koutsiTodayStr())));
  const [time, setTime] = React.useState(() => (editing ? editing.time : ''));
  const [type, setType] = React.useState(() => (editing ? editing.type : 'Yksityistunti'));
  const [repeat, setRepeat] = React.useState(false);
  const [studentQuery, setStudentQuery] = React.useState('');
  const [groupFormOpen, setGroupFormOpen] = React.useState(false);

  // only track the target for a brand-new session; changing it while editing would move
  // the session to a different player, which is what delete + re-add is for
  React.useEffect(() => { if (!isEdit) setType(targetType === 'group' ? 'Ryhmätreeni' : 'Yksityistunti'); }, [targetType, isEdit]);

  const trainingTypes = targetType === 'group' ? ['Ryhmätreeni', 'Ottelu'] : ['Yksityistunti', 'Ottelu'];
  const normalizedStudentQuery = studentQuery.trim().toLocaleLowerCase('fi-FI');
  const filteredStudents = normalizedStudentQuery
    ? students.filter((student) => student.name.toLocaleLowerCase('fi-FI').includes(normalizedStudentQuery))
    : students;
  // The database stores recurring sessions as individual rows. Materializing one year
  // keeps the series useful for the foreseeable future while staying below its safety cap.
  const repeatUntil = repeat && date ? window.koutsiAddDays(date, 365) : null;
  const occurrences = repeatUntil ? window.koutsiWeeklyDates(date, repeatUntil).length : 1;
  const ready = (targetType === 'student' ? studentId != null : groupId != null) && date && time.trim()
    && trainingTypes.includes(type);
  const inputStyle = { flex: 1, boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };
  const Pill = ({ on, children, onClick }) => (
    <button onClick={onClick} style={{ padding: '9px 15px', borderRadius: 999, border: on ? 'none' : '1px solid #d8d4ca', background: on ? 'var(--lime)' : '#fff', color: on ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>{children}</button>
  );

  // A coach booking their first ryhmatreeni has no group to pick yet. Sending them to the
  // Ryhmat tab would throw away the half-filled form, so the group is created right here
  // and selected the moment it exists.
  const createGroup = async (fields) => {
    const newId = await onCreateGroup(fields);
    if (newId == null) return; // creation failed; the toast already said so
    setGroupFormOpen(false);
    setGroupId(newId);
  };

  const save = () => {
    if (!ready) return;
    onSave({
      studentId: targetType === 'student' ? studentId : null,
      groupId: targetType === 'group' ? groupId : null,
      date, time: time.trim(), type,
      repeatUntil,
    });
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(480px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 16 }}>{isEdit ? 'Muokkaa valmennusta' : 'Uusi valmennus'}</h3>

        {!isEdit && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
            <Pill on={targetType === 'student'} onClick={() => setTargetType('student')}>Yksittäinen pelaaja</Pill>
            <Pill on={targetType === 'group'} onClick={() => setTargetType('group')}>Ryhmä</Pill>
          </div>
        )}

        {!isEdit && (targetType === 'student' ? (
          <React.Fragment>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Oppilas</div>
            {students.length > 5 && (
              <input
                type="search"
                value={studentQuery}
                onChange={(e) => setStudentQuery(e.target.value)}
                placeholder="Hae oppilasta nimellä"
                aria-label="Hae oppilasta nimellä"
                style={{ ...inputStyle, width: '100%', marginBottom: 12 }}
              />
            )}
            <div style={{ display: 'flex', gap: 12, overflowX: 'auto', marginBottom: 18, paddingBottom: 2 }}>
              {filteredStudents.map((s) => (
                <button key={s.id} onClick={() => setStudentId(s.id)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                  <span style={{ borderRadius: '50%', padding: 2, border: studentId === s.id ? '2px solid var(--lime)' : '2px solid transparent' }}>
                    <Avatar src={s.avatarUrl} initial={s.initial} hue={s.hue} size={46} />
                  </span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: studentId === s.id ? '#111' : '#8a857a' }}>{s.name.split(' ')[0]}</span>
                </button>
              ))}
              {students.length === 0 && <div style={{ color: '#8a857a', fontSize: 14 }}>Ei vielä oppilaita — kutsu ensin pelaaja.</div>}
              {students.length > 0 && filteredStudents.length === 0 && <div style={{ color: '#8a857a', fontSize: 14 }}>Oppilaita ei löytynyt.</div>}
            </div>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Ryhmä</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              {groups.map((g) => (
                <button key={g.id} onClick={() => setGroupId(g.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px', borderRadius: 14, border: groupId === g.id ? '2px solid var(--lime)' : '1px solid #d8d4ca', background: groupId === g.id ? 'rgba(207,228,20,0.1)' : '#fff', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: '#111', flex: 1 }}>{g.name}</span>
                  <span style={{ fontSize: 12, color: '#8a857a' }}>{g.memberIds.length} pelaajaa</span>
                </button>
              ))}
              {groups.length === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 11 }}>
                  <div style={{ color: '#8a857a', fontSize: 14 }}>Ei vielä ryhmiä.</div>
                  <button onClick={() => setGroupFormOpen(true)} className="btn-dark btn-sm">+ Luo ryhmä</button>
                </div>
              )}
            </div>
          </React.Fragment>
        ))}

        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Ajankohta</div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
          <input type="time" step={900} value={time} onChange={(e) => setTime(window.koutsiRoundTimeToQuarterHour(e.target.value))} onClick={(e) => e.currentTarget.showPicker?.()} style={{ ...inputStyle, flex: 0.7 }} />
        </div>

        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Tyyppi</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {trainingTypes.map((t) => <Pill key={t} on={type === t} onClick={() => setType(t)}>{t}</Pill>)}
        </div>

        {!isEdit && (
          <div style={{ marginBottom: 20 }}>
            <button onClick={() => setRepeat((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', textAlign: 'left' }}>
              <span style={{ width: 19, height: 19, borderRadius: 6, border: '1.5px solid ' + (repeat ? 'var(--green-deep)' : '#c5c0b5'), background: repeat ? 'var(--green-deep)' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {repeat && <svg width="11" height="9" viewBox="0 0 10 8"><path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </span>
              <span style={{ fontSize: 14.5, fontWeight: 600, color: '#111' }}>Toistuu viikoittain, kunnes lopetat</span>
            </button>
            {repeat && (
              <div style={{ marginTop: 9, paddingLeft: 30, fontSize: 12.5, color: '#8a857a', lineHeight: 1.45 }}>
                Valmennukset luodaan vuodeksi eteenpäin. Voit lopettaa sarjan milloin tahansa.
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={save} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: ready ? 1 : 0.45, cursor: ready ? 'pointer' : 'default' }}>
            {isEdit ? 'Tallenna' : (occurrences > 1 ? 'Lisää viikoittainen' : 'Lisää')}
          </button>
        </div>
        {isEdit && editing.seriesId && (
          <button onClick={() => onSaveSeries({ time: time.trim(), type })} className="btn-outline btn-sm" style={{ width: '100%', marginTop: 10 }}>
            Tallenna kellonaika ja tyyppi koko sarjaan
          </button>
        )}
        {groupFormOpen && (
          <GroupFormModal
            students={students} editing={null} zIndex={90}
            onClose={() => setGroupFormOpen(false)} onSave={createGroup} />
        )}
      </div>
    </div>
  );
}


// ── Harjoitteet ──────────────────────────────────────────
function ExercisesView({ exercises, onOpen, onAdd, onRestoreStarters }) {
  const [activeTag, setActiveTag] = React.useState('kaikki');
  const [activeCount, setActiveCount] = React.useState('kaikki');
  const filtered = exercises
    .filter((e) => activeTag === 'kaikki' || e.tags.includes(activeTag))
    .filter((e) => activeCount === 'kaikki' || (activeCount === 4 ? e.playerCount >= 4 : e.playerCount === activeCount));
  return (
    <div>
      <PageHeader title="Harjoitteet" sub="Oma harjoitepankki" action={<button onClick={onAdd} className="btn-dark btn-sm">+ Lisää harjoite</button>} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {PLAYER_COUNT_FILTERS.map((f) => (
          <button key={f.key} onClick={() => setActiveCount(f.key)} style={{ padding: '9px 16px', borderRadius: 999, border: activeCount === f.key ? 'none' : '1px solid var(--line)', background: activeCount === f.key ? 'var(--green-deep)' : '#fff', color: activeCount === f.key ? '#fff' : '#3c382f', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{f.label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {EXERCISE_TAGS.map((t) => (
          <button key={t} onClick={() => setActiveTag(t)} style={{ padding: '9px 16px', borderRadius: 999, border: activeTag === t ? 'none' : '1px solid var(--line)', background: activeTag === t ? 'var(--lime)' : '#fff', color: activeTag === t ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{TAG_LABELS[t]}</button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {filtered.map((ex) => (
          <button key={ex.id} onClick={() => onOpen(ex.id)} className="k-card" style={{ textAlign: 'left', cursor: 'pointer', padding: '18px 19px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%' }}>
              <div style={{ color: '#111', fontWeight: 700, fontSize: 16, flex: 1, minWidth: 0 }}>{ex.name}</div>
              {ex.video && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 999, background: 'rgba(14,59,44,0.09)', color: 'var(--green-deep)', fontSize: 10.5, fontWeight: 800, flexShrink: 0 }}>
                  <span aria-hidden="true">▶</span> Video
                </span>
              )}
            </div>
            <div style={{ color: '#8a857a', fontSize: 13 }}>{ex.players} pelaajaa · {ex.duration} · {ex.level}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {ex.tags.map((t) => <span key={t} className="k-chip">{TAG_LABELS[t]}</span>)}
            </div>
          </button>
        ))}
        {filtered.length === 0 && <div style={{ color: '#8a857a', fontSize: 14.5 }}>Ei harjoitteita tällä suodattimella.</div>}
      </div>
      <div style={{ marginTop: 26, paddingTop: 18, borderTop: '1px solid var(--line)' }}>
        <button onClick={onRestoreStarters} className="btn-outline btn-sm">Palauta Krossin esimerkkiharjoitteet</button>
        <div style={{ fontSize: 12.5, color: '#8a857a', marginTop: 8, lineHeight: 1.5 }}>
          Lisää takaisin ne valmiit harjoitteet, jotka olet poistanut. Omia harjoitteitasi tämä ei koske.
        </div>
      </div>
    </div>
  );
}

function ExerciseDetail({ exercise, onClose, onEdit, onDelete, onAddVideo, onRemoveVideo }) {
  const [playing, setPlaying] = React.useState(false);
  return (
    <div onClick={playing ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      {playing && exercise.video && <VideoPlayerModal video={exercise.video} onClose={() => setPlaying(false)} />}
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(480px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: '28px 28px 26px', animation: 'kFadeIn .2s ease' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
          <h3 style={{ fontSize: 22, fontWeight: 800, flex: 1, minWidth: 0 }}>{exercise.name}</h3>
          {(onEdit || onDelete) && <window.KoutsiRowActions onEdit={onEdit} onDelete={onDelete} editLabel="Muokkaa harjoitetta" deleteLabel="Poista harjoite" />}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 18 }}>
          <span className="k-chip">{exercise.players} pelaajaa</span>
          <span className="k-chip">{exercise.duration}</span>
          <LevelChip level={exercise.level} />
        </div>
        <Field label="Tavoite">
          <p style={{ fontSize: 14.5, lineHeight: 1.6, color: '#3c382f' }}>{exercise.goal}</p>
        </Field>
        <Field label="Teemat">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {exercise.tags.map((t) => <span key={t} className="k-chip">{TAG_LABELS[t]}</span>)}
          </div>
        </Field>
        <Field label="Video">
          {exercise.video ? (
            <React.Fragment>
              <div className="k-card" style={{ padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <button onClick={() => setPlaying(true)} aria-label={`Katso video ${exercise.video.title}`} style={{ width: 38, height: 38, borderRadius: '50%', border: 'none', background: 'var(--lime)', color: '#101a08', cursor: 'pointer', flexShrink: 0, fontSize: 14, paddingLeft: 8 }}>▶</button>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: '#111', fontSize: 14, fontWeight: 700, lineHeight: 1.35 }}>{exercise.video.title}</div>
                  <div style={{ color: '#8a857a', fontSize: 11.5, marginTop: 3 }}>{exercise.video.externalUrl ? 'Videolinkki' : 'Videotiedosto'}</div>
                </div>
                <button onClick={() => setPlaying(true)} className="btn-outline btn-sm">Katso</button>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={onAddVideo} className="btn-outline btn-sm">Vaihda video</button>
                <button onClick={onRemoveVideo} className="btn-outline btn-sm" style={{ color: '#8f2f24', borderColor: '#e3c9c4' }}>Poista video</button>
              </div>
            </React.Fragment>
          ) : (
            <button onClick={onAddVideo} className="btn-outline btn-sm">+ Lisää video harjoitteeseen</button>
          )}
        </Field>
        <button onClick={onClose} className="btn-outline" style={{ width: '100%', padding: '13px 0' }}>Sulje</button>
      </div>
    </div>
  );
}

function ExerciseVideoModal({ exercise, onClose, onSave }) {
  const existing = exercise.video || null;
  const [title, setTitle] = React.useState(() => existing?.title || exercise.name);
  const [file, setFile] = React.useState(null);
  const [externalUrl, setExternalUrl] = React.useState(() => existing?.externalUrl || '');
  const [source, setSource] = React.useState(() => existing?.storagePath ? 'file' : 'link');
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [error, setError] = React.useState('');
  const fileRef = React.useRef(null);
  const pickFile = (event) => {
    const picked = event.target.files?.[0];
    setError('');
    if (!picked) return;
    if (picked.size > 50 * 1024 * 1024) {
      setFile(null);
      setSource('link');
      setError(`${Math.round(picked.size / 1048576)} Mt video on liian suuri. Jaa se YouTube- tai Drive-linkkinä.`);
      return;
    }
    setFile(picked);
    if (!title.trim()) setTitle(picked.name.replace(/\.[^.]+$/, ''));
  };
  const hasSource = source === 'file' ? Boolean(file) : /^https?:\/\//i.test(externalUrl.trim());
  const ready = title.trim() && hasSource && !busy;
  const submit = async () => {
    if (!ready) return;
    setBusy(true); setProgress(0); setError('');
    try {
      const ok = await onSave({
        title: title.trim(),
        file: source === 'file' ? file : null,
        externalUrl: source === 'link' ? externalUrl.trim() : null,
        onProgress: setProgress,
      });
      if (ok === false) setBusy(false);
    } catch (err) {
      setError(window.koutsiErrorText(err, 'Harjoitevideon tallennus epäonnistui'));
      setBusy(false);
    }
  };
  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };
  const fieldLabel = { fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 };
  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(460px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 6 }}>{existing ? 'Vaihda harjoitevideo' : 'Lisää harjoitevideo'}</h3>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 16, lineHeight: 1.5 }}>Liitä hyvä opetusvideo linkkinä tai lataa lyhyt klippi suoraan harjoitteeseen.</p>
        {error && <div style={{ background: 'rgba(161,59,47,0.08)', border: '1px solid rgba(161,59,47,0.25)', color: '#a13b2f', padding: '10px 14px', borderRadius: 12, fontSize: 13, marginBottom: 14 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {[['link', 'Video linkkinä'], ['file', 'Klippi tiedostona']].map(([key, label]) => (
            <button key={key} onClick={() => { setSource(key); setError(''); }} disabled={busy} style={{ padding: '9px 15px', borderRadius: 999, border: source === key ? 'none' : '1px solid #d8d4ca', background: source === key ? 'var(--lime)' : '#fff', color: source === key ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 13, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}>{label}</button>
          ))}
        </div>
        {source === 'file' ? (
          <React.Fragment>
            <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/webm,video/x-m4v,video/mpeg" onChange={pickFile} style={{ display: 'none' }} />
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="btn-outline" style={{ width: '100%', padding: '13px 0', marginBottom: 16 }}>
              {file ? `${file.name} (${Math.max(1, Math.round(file.size / 1048576))} Mt)` : 'Valitse enintään 50 Mt video…'}
            </button>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <input value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://youtube.com/... tai https://drive.google.com/..." style={{ ...inputStyle, marginBottom: 9 }} />
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16, fontSize: 12.5 }}>
              <a href="https://studio.youtube.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green-deep)', fontWeight: 700 }}>Avaa YouTube Studio ↗</a>
              <a href="https://drive.google.com/drive/my-drive" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green-deep)', fontWeight: 700 }}>Avaa Drive ↗</a>
            </div>
          </React.Fragment>
        )}
        {busy && source === 'file' && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b665c', marginBottom: 6 }}><span>Ladataan videota</span><b>{progress}%</b></div>
            <div style={{ height: 7, borderRadius: 999, overflow: 'hidden', background: '#ebe8df' }}><div style={{ height: '100%', width: `${progress}%`, background: 'var(--lime)', transition: 'width .2s ease' }} /></div>
          </div>
        )}
        <div style={fieldLabel}>Videon nimi</div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={exercise.name} style={{ ...inputStyle, marginBottom: 20 }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={busy} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={submit} disabled={!ready} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: ready ? 1 : 0.45, cursor: ready ? 'pointer' : 'default' }}>{busy ? (source === 'file' ? `Ladataan ${progress}%` : 'Tallennetaan…') : 'Tallenna video'}</button>
        </div>
      </div>
    </div>
  );
}

function ExerciseFormModal({ editing, onClose, onSave }) {
  const isEdit = Boolean(editing);
  const [name, setName] = React.useState(() => (editing ? editing.name : ''));
  const [goal, setGoal] = React.useState(() => (editing ? editing.goal || '' : ''));
  const [players, setPlayers] = React.useState(() => (editing ? editing.players || '' : ''));
  const [playerCount, setPlayerCount] = React.useState(() => (editing ? editing.playerCount || 1 : 1));
  const [duration, setDuration] = React.useState(() => (editing ? editing.duration || '' : ''));
  const [level, setLevel] = React.useState(() => (editing ? editing.level || '' : ''));
  const [tags, setTags] = React.useState(() => (editing ? editing.tags || [] : []));
  const toggleTag = (t) => setTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
  const ready = name.trim() && goal.trim() && players.trim() && duration.trim() && level.trim();
  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };
  const label = { fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(480px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 16 }}>{isEdit ? 'Muokkaa harjoitetta' : 'Uusi harjoite'}</h3>
        <div style={label}>Nimi</div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Esim. Kakkossyöttö + suunta" style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={label}>Tavoite</div>
        <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={3} placeholder="Mitä tällä harjoitteella treenataan?" style={{ ...inputStyle, resize: 'none', marginBottom: 16 }} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={label}>Pelaajia</div>
            <input value={players} onChange={(e) => setPlayers(e.target.value)} placeholder="2" style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={label}>Kesto</div>
            <input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="15 min" style={inputStyle} />
          </div>
        </div>
        <div style={label}>Pelaajamäärä (suodatinta varten)</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {PLAYER_COUNT_FILTERS.filter((f) => f.key !== 'kaikki').map((f) => (
            <button key={f.key} onClick={() => setPlayerCount(f.key)} style={{ padding: '8px 14px', borderRadius: 999, border: playerCount === f.key ? 'none' : '1px solid #d8d4ca', background: playerCount === f.key ? 'var(--lime)' : '#fff', color: playerCount === f.key ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>{f.label}</button>
          ))}
        </div>
        <div style={label}>Taso</div>
        <input value={level} onChange={(e) => setLevel(e.target.value)} placeholder="Esim. Kaikki tasot" style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={label}>Aihe</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {window.KOUTSI_TAGS.map((t) => (
            <button key={t} onClick={() => toggleTag(t)} style={{ padding: '8px 14px', borderRadius: 999, border: tags.includes(t) ? 'none' : '1px solid #d8d4ca', background: tags.includes(t) ? 'var(--lime)' : '#fff', color: tags.includes(t) ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>{window.KOUTSI_TAG_LABELS[t]}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={() => ready && onSave({ name: name.trim(), goal: goal.trim(), players: players.trim(), playerCount, duration: duration.trim(), level: level.trim(), tags })} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: ready ? 1 : 0.45, cursor: ready ? 'pointer' : 'default' }}>{isEdit ? 'Tallenna' : 'Lisää'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Profiili ─────────────────────────────────────────────
// The coaching blurb used to render but had no editor anywhere, so a new coach's profile
// tab was permanently blank. Name and avatar live on the shared Krossi profile, the rest
// on koutsi_coaches; both save from here.
function ProfileEditModal({ coach, onClose, onSaved }) {
  const toast = window.useKoutsiToast();
  const [name, setName] = React.useState(coach.name || '');
  const [tagline, setTagline] = React.useState(coach.tagline || '');
  const [bio, setBio] = React.useState(coach.bio || '');
  const [experience, setExperience] = React.useState(coach.experience || '');
  const [specialtyText, setSpecialtyText] = React.useState((coach.specialties || []).join(', '));
  const [avatarFile, setAvatarFile] = React.useState(null);
  const [avatarPreview, setAvatarPreview] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const avatarInputRef = React.useRef(null);

  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };
  const label = { fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 };

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const ok = await toast.run(async () => {
      if (avatarFile) await window.koutsiUploadAvatar(coach.id, avatarFile);
      if (name.trim() !== coach.name) await window.koutsiSaveDisplayName(coach.id, name.trim());
      await window.koutsiSaveCoachProfile(coach.id, {
        tagline: tagline.trim() || null,
        bio: bio.trim() || null,
        experience: experience.trim() || null,
        specialties: specialtyText.split(',').map((t) => t.trim()).filter(Boolean),
      });
    }, 'Profiili tallennettu.');
    setBusy(false);
    if (ok) { await onSaved(); onClose(); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(480px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 18 }}>Muokkaa profiilia</h3>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <button onClick={() => avatarInputRef.current?.click()} style={{ position: 'relative', width: 84, height: 84, padding: 0, border: 'none', background: 'none', cursor: 'pointer', borderRadius: '50%' }}>
            {avatarPreview
              ? <img src={avatarPreview} alt="" style={{ width: 84, height: 84, borderRadius: '50%', objectFit: 'cover' }} />
              : <Avatar src={coach.avatarUrl} initial={coach.initial} hue={coach.hue} size={84} />}
            <span style={{ position: 'absolute', bottom: 0, right: 0, width: 26, height: 26, borderRadius: '50%', background: 'var(--green-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M3 7h3l2-3h8l2 3h3v13H3z" /><circle cx="12" cy="13" r="4" /></svg>
            </span>
          </button>
          <input ref={avatarInputRef} type="file" accept="image/*" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) { setAvatarFile(f); setAvatarPreview(URL.createObjectURL(f)); }
          }} />
        </div>

        <div style={label}>Nimi</div>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={label}>Lyhyt esittely</div>
        <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Esim. Aikuisvalmentaja, Lahti" style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={label}>Kuvaus</div>
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} placeholder="Millainen valmentaja olet?" style={{ ...inputStyle, resize: 'none', marginBottom: 16 }} />
        <div style={label}>Kokemus</div>
        <textarea value={experience} onChange={(e) => setExperience(e.target.value)} rows={2} placeholder="Esim. 8 vuotta aikuisvalmennusta, tason 2 valmentajakoulutus" style={{ ...inputStyle, resize: 'none', marginBottom: 16 }} />
        <div style={label}>Erikoisalat</div>
        <input value={specialtyText} onChange={(e) => setSpecialtyText(e.target.value)} placeholder="Syöttö, verkkopeli, aikuiset" style={{ ...inputStyle, marginBottom: 6 }} />
        <div style={{ fontSize: 12, color: '#a8a297', marginBottom: 20 }}>Erota pilkulla.</div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={save} disabled={busy || !name.trim()} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: (busy || !name.trim()) ? 0.45 : 1 }}>{busy ? 'Tallennetaan…' : 'Tallenna'}</button>
        </div>
      </div>
    </div>
  );
}

// Only rendered for people in koutsi_admins. Replaces the hand-written UPDATE that
// publishing a reviewed annual plan used to require.
function AnnualPlanReviewPanel() {
  const toast = window.useKoutsiToast();
  const confirm = window.useKoutsiConfirm();
  const [plans, setPlans] = React.useState(null);
  const [busyId, setBusyId] = React.useState(null);

  const load = React.useCallback(async () => {
    try { setPlans(await window.koutsiPendingAnnualPlans()); } catch { setPlans([]); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const open = async (plan) => {
    setBusyId(plan.groupId);
    try {
      const url = await window.koutsiAnnualPlanUrl(plan.storagePath);
      window.open(url, '_blank', 'noopener');
    } catch (err) { toast.error(window.koutsiErrorText(err)); } finally { setBusyId(null); }
  };
  const publish = async (plan) => {
    const ok = await confirm({
      title: 'Merkitse lisätyksi?',
      body: `${plan.groupName} · ${plan.filename}. Valmentaja ${plan.coachName} saa ilmoituksen, ja suunnitelma näkyy sovelluksessa käytössä olevana.`,
      confirmLabel: 'Merkitse lisätyksi',
    });
    if (!ok) return;
    setBusyId(plan.groupId);
    await toast.run(async () => { await window.koutsiPublishAnnualPlan(plan.groupId); await load(); }, 'Merkitty lisätyksi.');
    setBusyId(null);
  };

  if (plans === null || plans.length === 0) return null;
  return (
    <Field label={`Odottavat vuosisuunnitelmat (${plans.length})`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {plans.map((plan) => (
          <div key={plan.groupId} className="k-card" style={{ padding: '13px 15px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 140, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{plan.groupName}</div>
              <div style={{ fontSize: 12.5, color: '#8a857a', marginTop: 2 }}>
                {plan.coachName} · {plan.filename}
                {plan.uploadedAt ? ` · ${window.koutsiFmtShortDate(String(plan.uploadedAt).slice(0, 10))}` : ''}
              </div>
            </div>
            <button onClick={() => open(plan)} disabled={busyId === plan.groupId} className="btn-outline btn-sm">Avaa</button>
            <button onClick={() => publish(plan)} disabled={busyId === plan.groupId} className="btn-dark btn-sm">Merkitse lisätyksi</button>
          </div>
        ))}
      </div>
    </Field>
  );
}

// Turns an access/portability request from an evening of manual queries into a button.
// The export contains only rows the caller can already read — RLS decides, not the client.
function DataExportButton({ userId, role, name }) {
  const toast = window.useKoutsiToast();
  const [busy, setBusy] = React.useState(false);
  const run = async () => {
    setBusy(true);
    await toast.run(async () => {
      const payload = await window.koutsiExportMyData(userId, role);
      const stamp = window.koutsiTodayStr();
      const safe = (name || 'koutsi').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      window.koutsiDownloadJson(payload, `koutsi-tiedot-${safe}-${stamp}.json`);
    }, 'Tiedot ladattu.');
    setBusy(false);
  };
  return (
    <button onClick={run} disabled={busy} className="btn-outline btn-sm" style={{ opacity: busy ? 0.6 : 1 }}>
      {busy ? 'Kootaan…' : 'Lataa omat tietoni (JSON)'}
    </button>
  );
}

// `acting` = ylläpitäjä katsoo toisen valmentajan näkymää. Silloin profiili on pelkkä
// kortti: nimi, kuva, ilmoitusasetukset ja tili ovat valmentajan omia, ei ylläpidettäviä.
function ProfileView({ coach, studentCount, groupCount, onSignOut, onReload, acting }) {
  const [editOpen, setEditOpen] = React.useState(false);
  const specialties = coach.specialties || [];
  return (
    <div>
      <PageHeader title="Profiili" action={acting ? null : <button onClick={() => setEditOpen(true)} className="btn-dark btn-sm">Muokkaa profiilia</button>} />
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
        <div className="k-card" style={{ padding: 26, flex: '0 0 260px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
          <Avatar src={coach.avatarUrl} initial={coach.initial} hue={coach.hue} size={84} ring />
          <div style={{ color: '#111', fontWeight: 800, fontSize: 20 }}>{coach.name}</div>
          <div style={{ color: '#8a857a', fontSize: 13.5 }}>{coach.tagline || 'Lisää lyhyt esittely'}</div>
          <div style={{ display: 'flex', gap: 10, width: '100%', marginTop: 6 }}>
            {[['Oppilaita', studentCount], ['Ryhmiä', groupCount]].map(([k, v]) => (
              <div key={k} style={{ flex: 1, background: '#f7f5ef', borderRadius: 14, padding: '12px 10px' }}>
                <div style={{ color: '#8a857a', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 }}>{k}</div>
                <div style={{ color: '#111', fontWeight: 800, fontSize: 18 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ flex: '1 1 320px' }}>
          <Field label="Kuvaus">
            <p style={{ fontSize: 14.5, lineHeight: 1.6, color: coach.bio ? '#3c382f' : '#8a857a' }}>{coach.bio || 'Ei vielä kuvausta.'}</p>
          </Field>
          <Field label="Kokemus">
            <p style={{ fontSize: 14.5, lineHeight: 1.6, color: coach.experience ? '#3c382f' : '#8a857a' }}>{coach.experience || 'Ei vielä lisätty.'}</p>
          </Field>
          <Field label="Erikoisalat">
            {specialties.length > 0
              ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{specialties.map((s) => <span key={s} className="k-chip">{s}</span>)}</div>
              : <div style={{ fontSize: 14.5, color: '#8a857a' }}>Ei vielä lisätty.</div>}
          </Field>
          {acting ? (
            <Field label="Ylläpitotila">
              <p style={{ fontSize: 13.5, color: '#8a857a', lineHeight: 1.55 }}>
                Valmentajan omat profiilitiedot, ilmoitusasetukset ja tili näkyvät tässä vain luettavina.
                Niitä muokkaa hän itse — sinä voit lisätä ja muokata pelaajia, ryhmiä, treenejä ja harjoitteita.
              </p>
            </Field>
          ) : (
          <React.Fragment>
          <Field label="Ilmoitukset">
            <window.KoutsiEmailPrefToggle userId={coach.id} />
          </Field>
          <Field label="Toiminnot">
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <a href="https://koutsi.krossi.app" className="btn-outline btn-sm">← Etusivulle</a>
              <button onClick={onSignOut} className="btn-outline btn-sm">Kirjaudu ulos</button>
            </div>
          </Field>
          <AnnualPlanReviewPanel />
          <Field label="Tili ja tiedot">
            <p style={{ fontSize: 13, color: '#8a857a', lineHeight: 1.55, marginBottom: 10 }}>
              Voit ladata kaikki sinulle näkyvät tiedot yhtenä tiedostona. Tilin poisto tyhjentää pysyvästi
              kaikki oppilastietosi, ryhmäsi, treenisi ja harjoitteesi — oppilaiden omat tilit säilyvät.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <DataExportButton userId={coach.id} role="coach" name={coach.name} />
              <window.KoutsiDeleteAccountButton profileName={coach.name} />
            </div>
            <window.KoutsiLegalLinks style={{ marginTop: 16 }} />
          </Field>
          </React.Fragment>
          )}
        </div>
      </div>
      {editOpen && !acting && <ProfileEditModal coach={coach} onClose={() => setEditOpen(false)} onSaved={onReload} />}
    </div>
  );
}

// ── Käyttöönotto ─────────────────────────────────────────
// Shown until the coach has done the three things that make the app useful. Replaces the
// old "Ei vielä oppilaita" dead end, which gave a brand-new coach nothing to act on.
function GettingStarted({ studentCount, trainingCount, onBulkSetup, onAddTraining }) {
  const steps = [
    { done: studentCount > 0, title: 'Lisää pelaajat ja ryhmät kerralla', body: 'Kirjoita koko pelaajalista, jaa pelaajat ryhmiin ja lisää viikkoteemat yhdessä näkymässä.', action: 'Aloita nopea käyttöönotto', onClick: onBulkSetup },
    { done: trainingCount > 0, title: 'Lisää ensimmäinen treeni', body: 'Merkitse toistuvaksi, niin koko kausi syntyy kerralla.', action: 'Lisää treeni', onClick: onAddTraining },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  return (
    <div className="k-card" style={{ padding: '22px 24px', marginBottom: 24, background: 'linear-gradient(135deg, rgba(207,228,20,0.14), rgba(14,59,44,0.04))', borderColor: 'rgba(14,59,44,0.14)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 4, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--green-deep)' }}>Näin pääset alkuun</h2>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#8a857a' }}>{doneCount}/{steps.length} valmiina</span>
      </div>
      <div style={{ height: 5, borderRadius: 999, background: 'rgba(14,59,44,0.1)', overflow: 'hidden', margin: '10px 0 18px' }}>
        <div style={{ width: `${(doneCount / steps.length) * 100}%`, height: '100%', background: 'var(--green-deep)', transition: 'width .3s ease' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {steps.map((s, i) => (
          <div key={s.title} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', borderRadius: 14, background: s.done ? 'rgba(255,255,255,0.5)' : '#fff', border: '1px solid ' + (s.done ? 'transparent' : 'var(--line)'), opacity: s.done ? 0.65 : 1 }}>
            <span style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: s.done ? 'var(--green-deep)' : 'rgba(14,59,44,0.08)', color: s.done ? '#fff' : 'var(--green-deep)', fontSize: 11.5, fontWeight: 800 }}>
              {s.done ? <svg width="11" height="9" viewBox="0 0 10 8"><path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg> : i + 1}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: '#111', textDecoration: s.done ? 'line-through' : 'none' }}>{s.title}</div>
              {!s.done && <div style={{ fontSize: 13, color: '#514c42', marginTop: 3, lineHeight: 1.45 }}>{s.body}</div>}
            </div>
            {!s.done && <button onClick={s.onClick} className="btn-dark btn-sm" style={{ flexShrink: 0, padding: '8px 14px', fontSize: 12.5 }}>{s.action}</button>}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 13, fontSize: 12.5, color: '#6f6a60', lineHeight: 1.5 }}>
        Pelaajat voi tallentaa ensin ilman käyttäjätilejä. Liittymiskutsut lähetät myöhemmin pelaajan omalta kortilta.
      </div>
    </div>
  );
}


// ── Ylläpito ─────────────────────────────────────────────
// Only mounted for people in koutsi_admins. Exists so running the pilot means opening a
// tab, not the SQL editor: who the coaches are, what their invite codes are, adding an
// annual plan on their behalf, and turning a pasted player list into ready-to-send links.
function adminFormatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} t`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} kt`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} Mt`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} Gt`;
}

function adminFormatAccountDate(value) {
  if (!value) return 'Ei tiedossa';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Ei tiedossa';
  return date.toLocaleDateString('fi-FI', { day: 'numeric', month: 'numeric', year: 'numeric' });
}

function AdminUserCard({ user, onOpenPlans, onOpenImport, onActAs, onDelete }) {
  const toast = window.useKoutsiToast();
  const confirm = window.useKoutsiConfirm();
  const [showCodes, setShowCodes] = React.useState(false);
  const [opening, setOpening] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const openView = async () => {
    setOpening(true);
    try { await onActAs(user.id); }
    catch (err) { toast.error(window.koutsiErrorText(err, 'Näkymää ei saatu auki.')); setOpening(false); }
  };
  const remove = async () => {
    const ok = await confirm({
      title: `Poista käyttäjä ${user.name}?`,
      body: `Tämä poistaa pysyvästi koko käyttäjätilin (${user.email || 'ei sähköpostia'}), profiilin, Koutsi-tiedot ja ${adminFormatBytes(user.storageBytes)} tallennettuja tiedostoja. Toimintoa ei voi perua.`,
      confirmLabel: 'Poista lopullisesti',
      cancelLabel: 'Peruuta',
      danger: true,
      typeToConfirm: user.email || user.name,
    });
    if (!ok) return;
    setDeleting(true);
    const deleted = await toast.run(() => onDelete(user), `${user.name} ja käyttäjän tiedot poistettiin.`);
    if (!deleted) setDeleting(false);
  };
  const roles = [
    user.isAdmin && { label: 'Ylläpitäjä', fg: '#7a4c1e', bg: 'rgba(199,123,46,0.12)', border: 'rgba(199,123,46,0.3)' },
    user.isCoach && { label: 'Valmentaja', fg: '#0e5b42', bg: 'rgba(94,189,139,0.12)', border: 'rgba(47,125,84,0.28)' },
    user.isPlayer && { label: 'Pelaaja', fg: '#315f8a', bg: 'rgba(75,137,189,0.11)', border: 'rgba(75,137,189,0.28)' },
  ].filter(Boolean);
  if (!roles.length) roles.push({ label: 'Ei Koutsi-roolia', fg: '#6f695f', bg: '#f4f2ec', border: '#ded9cf' });
  return (
    <div className="k-card" style={{ padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: '#111' }}>{user.name}</div>
          <div style={{ fontSize: 12.5, color: '#8a857a', marginTop: 2, wordBreak: 'break-all' }}>{user.email || 'Ei sähköpostia'}</div>
          <div style={{ fontSize: 11.5, color: '#8a857a', marginTop: 4 }}>Tili luotu {adminFormatAccountDate(user.joinedAt)}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 9 }}>
            {roles.map((role) => (
              <span key={role.label} style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '4px 9px', fontSize: 10.5, fontWeight: 800, color: role.fg, background: role.bg, border: `1px solid ${role.border}` }}>{role.label}</span>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ background: '#f7f5ef', borderRadius: 11, padding: '7px 11px', textAlign: 'center', minWidth: 76 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.4 }}>Tallennustila</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#111' }}>{adminFormatBytes(user.storageBytes)}</div>
          </div>
          {user.isCoach && [['Oppilaita', user.studentCount], ['Ryhmiä', user.groupCount], ['Treenejä', user.trainingCount]].map(([k, v]) => (
            <div key={k} style={{ background: '#f7f5ef', borderRadius: 11, padding: '7px 11px', textAlign: 'center', minWidth: 62 }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.4 }}>{k}</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#111' }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {user.pendingPlans > 0 && (
        <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 10, background: 'rgba(199,123,46,0.12)', border: '1px solid rgba(199,123,46,0.35)', fontSize: 12.5, color: '#7a4c1e', fontWeight: 700 }}>
          {user.pendingPlans} vuosisuunnitelmaa odottaa käsittelyä
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {user.isCoach && <button onClick={openView} disabled={opening || deleting} className="btn-dark btn-sm" style={{ opacity: opening || deleting ? 0.5 : 1 }}>
          {opening ? 'Avataan…' : 'Avaa näkymä'}
        </button>}
        {user.isCoach && <button onClick={() => onOpenImport(user)} disabled={deleting} className="btn-outline btn-sm">Tuo pelaajalista</button>}
        {user.isCoach && <button onClick={() => onOpenPlans(user)} disabled={deleting} className="btn-outline btn-sm">Vuosisuunnitelmat</button>}
        {user.isCoach && user.codes.length > 0 && (
          <button onClick={() => setShowCodes((v) => !v)} className="btn-outline btn-sm">
            {showCodes ? 'Piilota koodit' : `Kutsukoodit (${user.codes.length})`}
          </button>
        )}
        {!user.isAdmin && <button onClick={remove} disabled={deleting} className="btn-outline btn-sm" style={{ marginLeft: 'auto', color: '#8f2f24', borderColor: '#e3c9c4', opacity: deleting ? 0.55 : 1 }}>
          {deleting ? 'Poistetaan…' : 'Poista tili'}
        </button>}
      </div>

      {showCodes && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
          {user.codes.map((c) => (
            <div key={c.code} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px', borderRadius: 10, background: '#f7f5ef', border: '1px solid var(--line)', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 800, letterSpacing: 1.5, fontSize: 13.5, color: '#111' }}>{c.code}</span>
              <span style={{ fontSize: 12, color: '#514c42', flex: 1, minWidth: 90 }}>
                {c.label || c.group_name || 'Ei ryhmää'} · {c.used}/{c.max_uses ?? '∞'}
              </span>
              <window.KoutsiCopyButton text={window.koutsiInviteLink(c.code)} label="Kopioi linkki" style={{ padding: '5px 10px', fontSize: 11.5 }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// A player is an auth user who signs up themselves — that is also where they accept the
// terms — so no spreadsheet can create accounts. What this does instead is turn the list
// into one labelled code and link per name, ready to paste back to the coach.
function AdminImportModal({ coach, onClose }) {
  const toast = window.useKoutsiToast();
  const [groups, setGroups] = React.useState([]);
  const [groupId, setGroupId] = React.useState(null);
  const [text, setText] = React.useState('');
  const [result, setResult] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    window.koutsiAdminGroups(coach.id).then(setGroups).catch(() => setGroups([]));
  }, [coach.id]);

  const names = window.koutsiParseNameList(text);
  const run = async () => {
    if (!names.length) return;
    setBusy(true);
    await toast.run(async () => {
      setResult(await window.koutsiAdminBulkInviteCodes(coach.id, names, groupId));
    }, `${names.length} kutsulinkkiä luotu.`);
    setBusy(false);
  };

  const asText = result
    ? result.map((r) => `${r.label}\t${r.link}`).join('\n')
    : '';
  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '12px 14px', fontSize: 14, fontFamily: 'inherit', color: '#111', background: '#fff' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 6 }}>Tuo pelaajalista — {coach.name}</h3>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 18, lineHeight: 1.5 }}>
          Liitä nimet Excelistä, yksi per rivi. Jokaiselle syntyy oma nimetty kutsulinkki, jonka
          valmentaja lähettää pelaajalle. Tilin luo pelaaja itse — sitä ei voi tehdä hänen puolestaan,
          koska siinä hyväksytään myös käyttöehdot.
        </p>

        {result ? (
          <React.Fragment>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>{result.length} linkkiä valmiina</div>
            <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 12, marginBottom: 14 }}>
              {result.map((r) => (
                <div key={r.code} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: '#111', minWidth: 110 }}>{r.label}</span>
                  <span style={{ fontSize: 12, color: '#514c42', flex: 1, wordBreak: 'break-all' }}>{r.link}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <window.KoutsiCopyButton text={asText} label="Kopioi kaikki (nimi + linkki)" copiedLabel="Kopioitu!" className="btn-dark btn-sm" />
              <button onClick={() => { setResult(null); setText(''); }} className="btn-outline btn-sm">Tee uusi lista</button>
              <button onClick={onClose} className="btn-outline btn-sm">Sulje</button>
            </div>
          </React.Fragment>
        ) : (
          <React.Fragment>
            {groups.length > 0 && (
              <React.Fragment>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Liitä ryhmään (valinnainen)</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                  <button onClick={() => setGroupId(null)} style={{ padding: '8px 14px', borderRadius: 999, border: groupId === null ? 'none' : '1px solid #d8d4ca', background: groupId === null ? 'var(--lime)' : '#fff', color: '#3c382f', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>Ei ryhmää</button>
                  {groups.map((g) => (
                    <button key={g.id} onClick={() => setGroupId(g.id)} style={{ padding: '8px 14px', borderRadius: 999, border: groupId === g.id ? 'none' : '1px solid #d8d4ca', background: groupId === g.id ? 'var(--lime)' : '#fff', color: '#3c382f', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>{g.name}</button>
                  ))}
                </div>
              </React.Fragment>
            )}
            <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Nimet</div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={9}
              placeholder={'Maria Korhonen\nAleksi Rantanen\nEmma Laine'}
              style={{ ...inputStyle, resize: 'vertical', marginBottom: 8, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }} />
            <div style={{ fontSize: 12.5, color: '#8a857a', marginBottom: 18 }}>
              {names.length > 0 ? `${names.length} nimeä tunnistettu.` : 'Yksi nimi per rivi. CSV käy myös — ensimmäinen sarake luetaan.'}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={onClose} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
              <button onClick={run} disabled={!names.length || busy} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: (!names.length || busy) ? 0.45 : 1 }}>
                {busy ? 'Luodaan…' : `Luo ${names.length || ''} linkkiä`}
              </button>
            </div>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

function AdminPlansModal({ coach, onClose, onChanged, onActAs }) {
  const toast = window.useKoutsiToast();
  const confirm = window.useKoutsiConfirm();
  const [groups, setGroups] = React.useState(null);
  const [submissions, setSubmissions] = React.useState(null);
  const [busyId, setBusyId] = React.useState(null);

  const load = React.useCallback(() => {
    Promise.all([
      window.koutsiAdminGroups(coach.id),
      window.koutsiAnnualPlanSubmissions(coach.id),
    ]).then(([nextGroups, nextSubmissions]) => {
      setGroups(nextGroups);
      setSubmissions(nextSubmissions);
    }).catch(() => {
      setGroups([]);
      setSubmissions([]);
    });
  }, [coach.id]);
  React.useEffect(() => { load(); }, [load]);

  const openSubmission = async (submission) => {
    setBusyId(submission.id);
    try {
      const url = await window.koutsiAnnualPlanUrl(submission.storagePath);
      if (!url) throw new Error('Tiedostoa ei löytynyt.');
      window.open(url, '_blank', 'noopener');
    } catch (err) { toast.error(window.koutsiErrorText(err, 'Tiedostoa ei saatu auki.')); }
    finally { setBusyId(null); }
  };
  const markHandled = async (submission) => {
    const ok = await confirm({
      title: 'Merkitse vuosisuunnitelma käsitellyksi?',
      body: `${submission.filename}. Tee tämä vasta, kun olet tarkistanut Excelin ja päivittänyt viikkoteemat valmentajan näkymässä.`,
      confirmLabel: 'Merkitse käsitellyksi',
    });
    if (!ok) return;
    setBusyId(submission.id);
    const handled = await toast.run(
      () => window.koutsiAdminHandleAnnualPlanSubmission(submission.id),
      'Vuosisuunnitelma merkitty käsitellyksi.',
    );
    if (handled) { await load(); onChanged(); }
    setBusyId(null);
  };
  const openCoachView = async () => {
    setBusyId('coach-view');
    try { await onActAs(coach.id); }
    catch (err) { toast.error(window.koutsiErrorText(err, 'Valmentajan näkymää ei saatu auki.')); setBusyId(null); }
  };

  const upload = async (group, file) => {
    if (!file) return;
    setBusyId(group.id);
    await toast.run(async () => {
      await window.koutsiAdminUploadAnnualPlan(group.id, file);
      load();
      onChanged();
    }, 'Vuosisuunnitelma lisätty ja merkitty käytössä olevaksi.');
    setBusyId(null);
  };
  const open = async (group) => {
    setBusyId(group.id);
    try {
      const { data } = await window.koutsiSupabase.from('koutsi_groups').select('annual_plan_storage_path').eq('id', group.id).maybeSingle();
      if (!data?.annual_plan_storage_path) { toast.info('Ei tallennettua tiedostoa.'); return; }
      window.open(await window.koutsiAnnualPlanUrl(data.annual_plan_storage_path), '_blank', 'noopener');
    } catch (err) { toast.error(window.koutsiErrorText(err)); } finally { setBusyId(null); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" role="dialog" aria-modal="true" aria-label={`Vuosisuunnitelmat — ${coach.name}`} style={{ width: 'min(700px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 6 }}>Vuosisuunnitelmat — {coach.name}</h3>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 18, lineHeight: 1.5 }}>
          Avaa koutsin lähettämä Excel, siirry hänen valmentajanäkymäänsä ja päivitä viikkoteemat oikeisiin ryhmiin. Merkitse tiedosto käsitellyksi vasta lopuksi.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <button type="button" onClick={openCoachView} disabled={busyId === 'coach-view'} className="btn-dark btn-sm" style={{ opacity: busyId === 'coach-view' ? 0.55 : 1 }}>
            {busyId === 'coach-view' ? 'Avataan…' : 'Avaa valmentajan näkymä'}
          </button>
        </div>

        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Koutsin lähettämät Excelit</div>
        {submissions === null && <div style={{ color: '#8a857a', fontSize: 14, marginBottom: 18 }}>Ladataan lähetyksiä…</div>}
        {submissions && submissions.length === 0 && <div style={{ color: '#8a857a', fontSize: 14, marginBottom: 18 }}>Koutsi ei ole vielä lähettänyt yhteistä Excel-vuosisuunnitelmaa.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          {[...(submissions || [])].sort((a, b) => (a.status === b.status ? 0 : a.status === 'pending' ? -1 : 1)).map((submission) => {
            const pending = submission.status === 'pending';
            return (
              <div key={submission.id} className="k-card" style={{ padding: '13px 15px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: pending ? 'rgba(199,123,46,0.055)' : '#fff' }}>
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 750, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{submission.filename}</div>
                  <div style={{ fontSize: 12, color: '#8a857a', marginTop: 2 }}>{new Date(submission.uploadedAt).toLocaleDateString('fi-FI')} · {adminFormatBytes(submission.sizeBytes)}</div>
                </div>
                <span style={{ borderRadius: 999, padding: '5px 9px', fontSize: 10.5, fontWeight: 800, color: pending ? '#7a4c1e' : '#0e5b42', background: pending ? 'rgba(199,123,46,0.12)' : 'rgba(47,125,84,0.11)', border: `1px solid ${pending ? 'rgba(199,123,46,0.3)' : 'rgba(47,125,84,0.25)'}` }}>
                  {pending ? 'Odottaa käsittelyä' : 'Käsitelty'}
                </span>
                <button type="button" onClick={() => openSubmission(submission)} disabled={busyId === submission.id} className="btn-outline btn-sm">Avaa Excel</button>
                {pending && <button type="button" onClick={() => markHandled(submission)} disabled={busyId === submission.id} className="btn-dark btn-sm" style={{ opacity: busyId === submission.id ? 0.55 : 1 }}>Merkitse käsitellyksi</button>}
              </div>
            );
          })}
        </div>

        {groups === null && <div style={{ color: '#8a857a', fontSize: 14 }}>Ladataan ryhmiä…</div>}
        {groups && groups.length === 0 && <div style={{ color: '#8a857a', fontSize: 14 }}>Tällä valmentajalla ei ole vielä ryhmiä.</div>}
        {groups && groups.length > 0 && <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Ryhmään liitetyt tiedostot</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(groups || []).map((g) => (
            <div key={g.id} className="k-card" style={{ padding: '13px 15px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 150px', minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{g.name}</div>
                <div style={{ fontSize: 12.5, color: '#8a857a', marginTop: 2 }}>
                  {g.memberCount} pelaajaa · {g.planFilename ? `${g.planFilename} (${g.planStatus === 'review' ? 'odottaa' : 'käytössä'})` : 'ei suunnitelmaa'}
                </div>
              </div>
              {g.planFilename && <button onClick={() => open(g)} disabled={busyId === g.id} className="btn-outline btn-sm">Avaa</button>}
              <label className="btn-dark btn-sm" style={{ cursor: busyId === g.id ? 'default' : 'pointer', opacity: busyId === g.id ? 0.6 : 1 }}>
                {busyId === g.id ? 'Ladataan…' : (g.planFilename ? 'Korvaa' : 'Lataa')}
                <input type="file" accept=".pdf,.csv,.xls,.xlsx" style={{ display: 'none' }} disabled={busyId === g.id}
                  onChange={(e) => { upload(g, e.target.files[0]); e.target.value = ''; }} />
              </label>
            </div>
          ))}
        </div>
        <button onClick={onClose} className="btn-outline" style={{ width: '100%', padding: '13px 0', marginTop: 18 }}>Sulje</button>
      </div>
    </div>
  );
}

function AdminView({ onActAs }) {
  const [users, setUsers] = React.useState(null);
  const [loadError, setLoadError] = React.useState(false);
  const [importCoach, setImportCoach] = React.useState(null);
  const [plansCoach, setPlansCoach] = React.useState(null);
  const [search, setSearch] = React.useState('');
  const [roleFilter, setRoleFilter] = React.useState('all');

  const load = React.useCallback(async () => {
    try {
      setUsers(await window.koutsiAdminUsers());
      setLoadError(false);
    } catch {
      setUsers([]);
      setLoadError(true);
    }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const q = search.trim().toLowerCase();
  const matchesRole = (user) => roleFilter === 'all'
    || (roleFilter === 'coach' && user.isCoach)
    || (roleFilter === 'player' && user.isPlayer)
    || (roleFilter === 'admin' && user.isAdmin)
    || (roleFilter === 'other' && !user.isCoach && !user.isPlayer);
  const shown = (users || []).filter((user) => matchesRole(user) && (!q || `${user.name} ${user.email}`.toLowerCase().includes(q)));
  const totals = (users || []).reduce((acc, user) => ({
    coaches: acc.coaches + (user.isCoach ? 1 : 0),
    players: acc.players + (user.isPlayer ? 1 : 0),
    admins: acc.admins + (user.isAdmin ? 1 : 0),
    others: acc.others + (!user.isCoach && !user.isPlayer ? 1 : 0),
    groups: acc.groups + user.groupCount,
    pending: acc.pending + user.pendingPlans,
    storage: acc.storage + user.storageBytes,
  }), { coaches: 0, players: 0, admins: 0, others: 0, groups: 0, pending: 0, storage: 0 });
  const filters = [
    { id: 'all', label: 'Kaikki', count: (users || []).length },
    { id: 'coach', label: 'Valmentajat', count: totals.coaches },
    { id: 'player', label: 'Pelaajat', count: totals.players },
    { id: 'admin', label: 'Ylläpitäjät', count: totals.admins },
    { id: 'other', label: 'Muut', count: totals.others },
  ];
  const removeUser = async (user) => {
    await window.koutsiAdminDeleteUser(user.id);
    if (importCoach?.id === user.id) setImportCoach(null);
    if (plansCoach?.id === user.id) setPlansCoach(null);
    await load();
  };

  return (
    <div>
      <PageHeader title="Ylläpito" sub={users ? `${users.length} käyttäjää · ${totals.coaches} valmentajaa · ${totals.players} pelaajaa · ${adminFormatBytes(totals.storage)}` : 'Ladataan…'} />
      {totals.pending > 0 && (
        <div className="k-card" style={{ padding: '14px 17px', marginBottom: 18, background: 'rgba(199,123,46,0.1)', borderColor: 'rgba(199,123,46,0.35)', fontSize: 14, color: '#7a4c1e', fontWeight: 700 }}>
          {totals.pending} vuosisuunnitelmaa odottaa käsittelyä.
        </div>
      )}

      <div className="k-card" style={{ padding: 14, marginBottom: 18 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Hae nimellä tai sähköpostilla…" aria-label="Hae käyttäjiä"
          style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 12, padding: '11px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff', marginBottom: 11 }} />
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }} aria-label="Suodata roolin mukaan">
          {filters.map((filter) => {
            const active = roleFilter === filter.id;
            return <button key={filter.id} type="button" onClick={() => setRoleFilter(filter.id)} aria-pressed={active}
              style={{ border: active ? '1px solid var(--green-deep)' : '1px solid #d8d4ca', background: active ? 'var(--green-deep)' : '#fff', color: active ? '#fff' : '#514c42', borderRadius: 999, padding: '7px 11px', fontSize: 12, lineHeight: 1, fontWeight: 750, cursor: 'pointer', fontFamily: 'inherit' }}>
              {filter.label} <span style={{ opacity: active ? 0.78 : 0.6 }}>{filter.count}</span>
            </button>;
          })}
        </div>
      </div>

      {loadError && (
        <div className="k-card" style={{ padding: '16px 17px', marginBottom: 18, color: '#8f2f24', fontSize: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ flex: 1 }}>Käyttäjiä ei saatu ladattua.</span>
          <button type="button" onClick={load} className="btn-outline btn-sm">Yritä uudelleen</button>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {shown.map((user) => (
          <AdminUserCard key={user.id} user={user} onOpenImport={setImportCoach} onOpenPlans={setPlansCoach} onActAs={onActAs} onDelete={removeUser} />
        ))}
        {users && !loadError && shown.length === 0 && <div style={{ color: '#8a857a', fontSize: 14.5 }}>Suodattimilla ei löytynyt käyttäjiä.</div>}
      </div>
      {importCoach && <AdminImportModal coach={importCoach} onClose={() => setImportCoach(null)} />}
      {plansCoach && <AdminPlansModal coach={plansCoach} onClose={() => setPlansCoach(null)} onChanged={load} onActAs={onActAs} />}
    </div>
  );
}

// ── Sidebar ──────────────────────────────────────────────
const NAV_BASE = [
  { id: 'students', label: 'Oppilaat' },
  { id: 'groups', label: 'Ryhmät' },
  { id: 'trainings', label: 'Treenit' },
  { id: 'exercises', label: 'Harjoitteet' },
  { id: 'profile', label: 'Profiili' },
];
const NAV_ADMIN = { id: 'admin', label: 'Ylläpito' };
// The tab is absent for a normal coach, and every RPC behind it re-checks koutsi_is_admin()
// server-side — hiding it is convenience, not the access control.
function koutsiNav(isAdmin) { return isAdmin ? [...NAV_BASE, NAV_ADMIN] : NAV_BASE; }
// Each view's own address: /valmentaja/oppilaat and so on. Finnish segments to match the
// labels the coach actually sees. Module level on purpose — useKoutsiTabRoute needs this
// object to keep its identity between renders.
const COACH_TAB_SLUGS = {
  students: 'oppilaat',
  groups: 'ryhmat',
  trainings: 'treenit',
  exercises: 'harjoitteet',
  profile: 'profiili',
  admin: 'yllapito',
};
// Switch the address before remounting CoachApp. The tab hook then reads the intended
// destination on its first render instead of inheriting /yllapito or /profiili.
function replaceCoachTabRoute(tab) {
  const path = window.location.pathname;
  if (path !== '/valmentaja' && !path.startsWith('/valmentaja/')) return;
  const slug = COACH_TAB_SLUGS[tab] || COACH_TAB_SLUGS.students;
  const url = `/valmentaja/${encodeURIComponent(slug)}${window.location.search}${window.location.hash}`;
  window.history.replaceState({ koutsiTab: tab }, '', url);
}
function NavIcon({ id, on, offColor = 'rgba(255,255,255,0.72)' }) {
  const c = on ? '#101a08' : offColor;
  if (id === 'admin') return <svg width="19" height="19" viewBox="0 0 22 22" fill="none"><path d="M11 2l7 3v5.5c0 4.2-2.9 7.9-7 9-4.1-1.1-7-4.8-7-9V5l7-3z" stroke={c} strokeWidth="1.7" strokeLinejoin="round" /><path d="M8 11l2.2 2.2L14.5 9" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (id === 'students') return <svg width="19" height="19" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="7.5" r="4" stroke={c} strokeWidth="1.7" /><path d="M3 20c0-4.4 3.6-7 8-7s8 2.6 8 7" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>;
  if (id === 'groups') return <svg width="19" height="19" viewBox="0 0 22 22" fill="none"><circle cx="7" cy="7.5" r="3" stroke={c} strokeWidth="1.7" /><circle cx="15" cy="7.5" r="3" stroke={c} strokeWidth="1.7" /><path d="M1.5 19c0-3.1 2.5-5 5.5-5s5.5 1.9 5.5 5M9.5 19c0-3.1 2.5-5 5.5-5s5.5 1.9 5.5 5" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>;
  if (id === 'trainings') return <svg width="19" height="19" viewBox="0 0 22 22" fill="none"><rect x="2.5" y="4.5" width="17" height="15" rx="3" stroke={c} strokeWidth="1.7" /><path d="M2.5 9h17M7 2.5v4M15 2.5v4" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>;
  if (id === 'exercises') return <svg width="19" height="19" viewBox="0 0 22 22" fill="none"><rect x="4" y="3" width="14" height="17" rx="2.5" stroke={c} strokeWidth="1.7" /><path d="M8 1.5h6a1 1 0 011 1V4H7V2.5a1 1 0 011-1z" stroke={c} strokeWidth="1.7" /><path d="M7.5 9.5h7M7.5 13h7M7.5 16.5h4" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>;
  return <svg width="19" height="19" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="7.5" r="4" stroke={c} strokeWidth="1.7" /><path d="M3 20c0-4.4 3.6-7 8-7s8 2.6 8 7" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>;
}

function Sidebar({ tab, setTab, coach, onSignOut, nav, acting }) {
  const isDemo = Boolean(window.KOUTSI_DEMO_ROLE);
  const homeHref = isDemo ? 'https://demo.koutsi.krossi.app' : 'https://koutsi.krossi.app';
  return (
    <div style={{ width: 248, flexShrink: 0, background: 'var(--green-deep)', color: '#fff', display: 'flex', flexDirection: 'column', padding: '26px 18px', position: 'fixed', top: 0, left: 0, bottom: 0, overflowY: 'auto' }}>
      <a href={homeHref} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7, textDecoration: 'none', paddingLeft: 6 }}>
        <span style={{ fontWeight: 800, fontSize: 20, color: 'var(--lime)', letterSpacing: -0.5 }}>Krossi</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>Koutsi</span>
      </a>
      <span style={{ display: 'inline-flex', alignSelf: 'flex-start', marginLeft: 6, marginTop: 8, marginBottom: 22, padding: '4px 11px', borderRadius: 999, background: 'rgba(207,228,20,0.16)', border: '1px solid rgba(207,228,20,0.4)', color: 'var(--lime)', fontSize: 11, fontWeight: 800, letterSpacing: 0.5 }}>VALMENTAJA</span>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 'auto' }}>
        {nav.map((n) => {
          const on = tab === n.id;
          return (
            <button key={n.id} onClick={() => setTab(n.id)} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: on ? 'var(--lime)' : 'transparent', color: on ? '#101a08' : 'rgba(255,255,255,0.85)',
              fontWeight: on ? 700 : 600, fontSize: 14.5, fontFamily: 'inherit', textAlign: 'left', transition: 'background .15s',
            }}>
              <NavIcon id={n.id} on={on} />{n.label}
            </button>
          );
        })}
      </nav>
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.14)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 6px 8px' }}>
          <Avatar src={coach.avatarUrl} initial={coach.initial} hue={coach.hue} size={34} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{coach.name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Valmentaja</div>
          </div>
          {!acting && <window.KoutsiNotificationBell userId={coach.id} dark />}
        </div>
        {!acting && (
          <button
            onClick={onSignOut}
            className={isDemo ? 'btn-lime' : undefined}
            style={isDemo
              ? { width: '100%', padding: '12px 18px', fontSize: 14 }
              : { background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)', fontSize: 12, cursor: 'pointer', textAlign: 'left', padding: '4px 6px', fontFamily: 'inherit' }}>
            {isDemo ? 'Luo tili' : 'Kirjaudu ulos'}
          </button>
        )}
      </div>
    </div>
  );
}

function MobileTopBar({ coach, acting, onProfile, onSignOut }) {
  const isDemo = Boolean(window.KOUTSI_DEMO_ROLE);
  const homeHref = isDemo ? 'https://demo.koutsi.krossi.app' : 'https://koutsi.krossi.app';
  return (
    <div className="kv-mobile-topbar" style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 96, zIndex: 45, alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px 10px', background: 'var(--green-deep)', borderBottom: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 10px 28px -22px rgba(0,0,0,0.65)', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 7, minWidth: 0 }}>
        <a href={homeHref} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, textDecoration: 'none' }}>
          <span style={{ fontWeight: 800, fontSize: 21, color: 'var(--lime)', letterSpacing: -0.5 }}>Krossi</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>Koutsi</span>
        </a>
        <span style={{ padding: '4px 11px', borderRadius: 999, background: 'rgba(207,228,20,0.12)', border: '1px solid rgba(207,228,20,0.5)', color: 'var(--lime)', fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6 }}>VALMENTAJA</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
        {isDemo && !acting && (
          <button onClick={onSignOut} className="btn-lime" style={{ minHeight: 38, padding: '9px 12px', fontSize: 12.5, whiteSpace: 'nowrap' }}>
            Luo tili
          </button>
        )}
        {!acting && <window.KoutsiNotificationBell userId={coach.id} dark />}
        <button onClick={acting ? undefined : onProfile} disabled={acting} aria-label={acting ? 'Valmentajan profiili' : 'Avaa profiili'} title={acting ? undefined : 'Profiili'} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, padding: 2, borderRadius: '50%', border: '2px solid var(--lime)', background: 'transparent', cursor: acting ? 'default' : 'pointer', opacity: acting ? 0.72 : 1 }}>
          <Avatar src={coach.avatarUrl} initial={coach.initial} hue={coach.hue} size={32} />
        </button>
      </div>
    </div>
  );
}

function MobileBottomNav({ tab, setTab, nav }) {
  const mobileNav = nav.filter((item) => item.id !== 'profile');
  return (
    <div className="kv-mobile-bottomnav" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, minHeight: 72, zIndex: 45, padding: '6px 5px max(6px, env(safe-area-inset-bottom))', background: 'var(--green-deep)', borderTop: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 -12px 28px -20px rgba(0,0,0,0.65)' }}>
      {mobileNav.map((n) => {
        const on = tab === n.id;
        const fs = n.label.length > 8 ? 9.5 : 10.5;
        return (
          <button key={n.id} onClick={() => setTab(n.id)} aria-current={on ? 'page' : undefined} style={{ flex: 1, minWidth: 0, margin: '0 2px', border: 'none', borderRadius: 14, background: on ? 'var(--lime)' : 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, fontFamily: 'inherit' }}>
            <NavIcon id={n.id} on={on} offColor="rgba(255,255,255,0.72)" />
            <span style={{ fontSize: fs, fontWeight: on ? 800 : 600, color: on ? 'var(--green-deep)' : 'rgba(255,255,255,0.78)' }}>{n.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Ylläpitäjä toisen valmentajan näkymässä. Palkki on tarkoituksella rumahko ja tarttuu
// yläreunaan: se on ainoa asia, joka erottaa "kirjoitan omaan Koutsiini" tilanteesta
// "kirjoitan jonkun toisen oppilaille".
function ActingBanner({ coachName, onExit }) {
  return (
    <div className="kv-acting-banner" style={{ background: '#7a4c1e', color: '#fff', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', boxShadow: '0 6px 18px -12px rgba(20,15,5,0.6)' }}>
      <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', background: 'rgba(255,255,255,0.18)', padding: '4px 9px', borderRadius: 999 }}>Ylläpitotila</span>
      <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1, minWidth: 180 }}>
        Toimit valmentajan <strong>{coachName}</strong> näkymässä. Kaikki mitä lisäät tallentuu hänen nimissään.
      </span>
      <button onClick={onExit} style={{ background: '#fff', color: '#7a4c1e', border: 'none', borderRadius: 999, padding: '7px 15px', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
        Palaa omaan näkymään
      </button>
    </div>
  );
}

function CoachApp({ coachId, onSignOut, actingCoach, onExitActing, onActAs }) {
  const toast = window.useKoutsiToast();
  const confirm = window.useKoutsiConfirm();
  const [state, setState] = React.useState(null);
  const [tab, setTab] = window.useKoutsiTabRoute(COACH_TAB_SLUGS, 'students');
  const [detailId, setDetailId] = React.useState(null);
  const [groupDetailId, setGroupDetailId] = React.useState(null);
  const [entryOpen, setEntryOpen] = React.useState(false);
  const [editingEntry, setEditingEntry] = React.useState(null);
  const [homeworkOpen, setHomeworkOpen] = React.useState(false);
  const [trainingOpen, setTrainingOpen] = React.useState(false);
  const [trainingDefaultDate, setTrainingDefaultDate] = React.useState(null);
  const [editingTraining, setEditingTraining] = React.useState(null);
  const [exerciseId, setExerciseId] = React.useState(null);
  const [exerciseFormOpen, setExerciseFormOpen] = React.useState(false);
  const [editingExercise, setEditingExercise] = React.useState(null);
  const [exerciseVideoOpen, setExerciseVideoOpen] = React.useState(false);
  const [videoOpen, setVideoOpen] = React.useState(false);
  const [audienceVideo, setAudienceVideo] = React.useState(null);
  const [presessionTrainingId, setPresessionTrainingId] = React.useState(null);
  const [attendanceEdit, setAttendanceEdit] = React.useState(null);
  const [themeModalGroupId, setThemeModalGroupId] = React.useState(null);
  const [groupFormOpen, setGroupFormOpen] = React.useState(false);
  const [editingGroup, setEditingGroup] = React.useState(null);
  const [slotFormOpen, setSlotFormOpen] = React.useState(false);
  const [addMembersGroupId, setAddMembersGroupId] = React.useState(null);
  const [eventOpen, setEventOpen] = React.useState(false);
  const [editingEvent, setEditingEvent] = React.useState(null);
  const [eventDefaultDate, setEventDefaultDate] = React.useState(null);

  const [loadError, setLoadError] = React.useState(false);
  const [isAdmin, setIsAdmin] = React.useState(null); // null = the check is still out
  const reload = React.useCallback(async () => {
    const next = await window.koutsiLoadCoachState(coachId);
    setState(next);
  }, [coachId]);
  // Vain ensilataus voi jäädä tyhjän ruudun taakse; myöhemmät virheet raportoi toast.
  const initialLoad = React.useCallback(async () => {
    setLoadError(false);
    try { await reload(); } catch { setLoadError(true); }
  }, [reload]);

  React.useEffect(() => { initialLoad(); }, [initialLoad]);
  // Decides whether the Ylläpito tab is offered; the RPCs behind it check again server-side.
  React.useEffect(() => { window.koutsiIsAdmin().then((v) => setIsAdmin(Boolean(v))); }, []);
  // /valmentaja/yllapito is now a real address anyone can type. Waiting for the answer
  // before redirecting keeps a genuine admin's deep link intact; once it comes back false,
  // send them to Oppilaat instead of an empty page — as a correction, not a back stop.
  React.useEffect(() => {
    if (isAdmin === false && tab === 'admin') setTab('students', { replace: true });
  }, [isAdmin, tab, setTab]);
  // Profile, notifications and account actions belong to the signed-in administrator,
  // never to the target coach. A typed/restored acting URL is corrected immediately.
  React.useEffect(() => {
    if (actingCoach && (tab === 'admin' || tab === 'profile')) setTab('students', { replace: true });
  }, [actingCoach, tab, setTab]);

  // Live sync: any change to the tables this coach can see (their own students,
  // groups, trainings, etc.) — made from this device or the player's — refreshes state.
  React.useEffect(() => {
    const tables = ['koutsi_coaches', 'koutsi_students', 'koutsi_coach_students', 'koutsi_groups', 'koutsi_group_members', 'koutsi_trainings', 'koutsi_training_absences', 'koutsi_exercises', 'koutsi_coach_events', 'koutsi_videos', 'koutsi_diary_entries', 'koutsi_homework', 'koutsi_moods', 'koutsi_match_notes', 'koutsi_player_history'];
    const channel = tables.reduce((ch, table) => ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => reload()), window.koutsiSupabase.channel(`koutsi-coach-${coachId}`)).subscribe();
    return () => window.koutsiSupabase.removeChannel(channel);
  }, [coachId, reload]);

  if (loadError && !state) return <window.KoutsiErrorScreen message="Valmennustietojasi ei saatu ladattua. Tarkista verkkoyhteys ja yritä uudelleen." onRetry={initialLoad} onSignOut={onSignOut} />;
  if (!state) return <window.KoutsiAuthLoadingScreen />;

  const detail = detailId != null ? state.students.find((s) => s.id === detailId) : null;
  const detailGroup = detail ? window.koutsiGroupForStudent(state, detail.id) : null;
  const detailGroupCoach = detailGroup ? window.koutsiCoachById(state, detailGroup.coachId) : null;
  const detailTrainings = detail ? window.koutsiTrainingsForStudent(state, detail.id) : [];
  const detailUpcoming = detail ? window.koutsiUpcomingTrainingsForStudent(state, detail.id) : [];
  const detailAttendance = detail ? window.koutsiAttendanceSummary(state, detail.id) : null;

  const groupDetail = groupDetailId != null ? state.groups.find((g) => g.id === groupDetailId) : null;
  const groupMembers = groupDetail ? groupDetail.memberIds.map((id) => state.students.find((s) => s.id === id)).filter(Boolean) : [];
  const groupTrainings = groupDetail ? window.koutsiTrainingsForGroup(state, groupDetail.id) : [];
  const groupUpcoming = groupDetail ? window.koutsiTrainingsForGroup(state, groupDetail.id).filter((t) => t.date >= window.koutsiTodayStr()) : [];

  const exercise = exerciseId != null ? state.exercises.find((e) => e.id === exerciseId) : null;
  const presessionTraining = presessionTrainingId != null ? state.trainings.find((t) => t.id === presessionTrainingId) : null;
  const attendanceTraining = attendanceEdit ? state.trainings.find((t) => t.id === attendanceEdit.trainingId) : null;
  const attendanceStudent = attendanceEdit ? state.students.find((s) => s.id === attendanceEdit.studentId) : null;
  const attendanceEntry = attendanceTraining && attendanceEdit
    ? (attendanceTraining.absences || []).find((a) => a.studentId === attendanceEdit.studentId)
    : null;
  const attendanceEligibleTrainings = attendanceStudent ? window.koutsiTrainingsForStudent(state, attendanceStudent.id) : [];

  // Every write goes through the toast layer: failures surface in Finnish instead of a
  // raw Postgres message in an alert(), and successes are acknowledged.
  const act = (fn, successMessage) => async (...args) => {
    await toast.run(async () => { await fn(...args); await reload(); }, successMessage);
  };

  const saveEntry = async (text) => {
    const ok = await toast.run(async () => {
      if (editingEntry) await window.koutsiUpdateDiaryEntry(editingEntry.id, text);
      else await window.koutsiAddDiaryEntry(coachId, detailId, text);
      await reload();
    }, editingEntry ? 'Merkintä päivitetty.' : 'Merkintä tallennettu.');
    if (ok) { setEntryOpen(false); setEditingEntry(null); }
  };
  const deleteEntry = async (entry) => {
    const ok = await confirm({ title: 'Poista päiväkirjamerkintä?', body: entry.text, confirmLabel: 'Poista', danger: true });
    if (ok) await act(() => window.koutsiDeleteDiaryEntry(entry.id), 'Merkintä poistettu.')();
  };

  const toggleHomework = act(async (i) => {
    const item = detail.homework[i];
    await window.koutsiToggleHomeworkDone(item.id, !item.done);
  });
  const saveHomework = async (text) => {
    const ok = await toast.run(async () => {
      await window.koutsiAddHomework(detailId, text);
      await reload();
    }, 'Kotiläksy lisätty.');
    if (ok) setHomeworkOpen(false);
  };
  const editHomework = act((h, text) => window.koutsiUpdateHomework(h.id, text), 'Kotiläksy päivitetty.');
  const deleteHomework = async (h) => {
    const ok = await confirm({ title: 'Poista kotiläksy?', body: h.text, confirmLabel: 'Poista', danger: true });
    if (ok) await act(() => window.koutsiDeleteHomework(h.id), 'Kotiläksy poistettu.')();
  };

  const saveTraining = async ({ studentId, groupId, date, time, type, repeatUntil }) => {
    const ok = await toast.run(async () => {
      if (editingTraining) await window.koutsiUpdateTraining(editingTraining.id, { date, time, type });
      else await window.koutsiAddTraining({ coachId, studentId, groupId, date, time, type, repeatUntil });
      await reload();
    }, editingTraining ? 'Treeni päivitetty.' : (repeatUntil ? 'Viikoittainen valmennus lisätty.' : 'Treeni lisätty.'));
    if (ok) { setTrainingOpen(false); setEditingTraining(null); }
  };
  const saveTrainingSeries = async ({ time, type }) => {
    if (!editingTraining?.seriesId) return;
    const ok = await toast.run(async () => {
      await window.koutsiUpdateTrainingSeries(editingTraining.seriesId, { time, type });
      await reload();
    }, 'Koko sarja päivitetty.');
    if (ok) { setTrainingOpen(false); setEditingTraining(null); }
  };
  // A session that belongs to a series asks which one the coach meant; a one-off does not.
  const deleteTraining = async (t) => {
    const label = `${window.koutsiFmtShortDate(t.date)} klo ${t.time} — ${t.type}`;
    if (!t.seriesId) {
      const ok = await confirm({ title: 'Poista treeni?', body: `${label}. Pelaajat saavat ilmoituksen peruutuksesta.`, confirmLabel: 'Poista', danger: true });
      if (ok) await act(() => window.koutsiDeleteTraining(t.id), 'Treeni poistettu.')();
      return;
    }
    let remaining = 0;
    try { remaining = await window.koutsiCountSeriesRemaining(t.seriesId, t.date); } catch { /* fall back to the single-session wording */ }
    const whole = await confirm({
      title: 'Poista koko sarja?',
      body: `${label} kuuluu viikoittaiseen sarjaan${remaining ? ` (${remaining} tulevaa kertaa)` : ''}. Poistetaanko kaikki tulevat kerrat vai vain tämä?`,
      confirmLabel: remaining ? `Poista kaikki ${remaining}` : 'Poista kaikki tulevat',
      cancelLabel: 'Vain tämä kerta',
      danger: true,
    });
    if (whole) await act(() => window.koutsiDeleteTrainingSeries(t.seriesId, t.date), 'Sarja poistettu.')();
    else await act(() => window.koutsiDeleteTraining(t.id), 'Treeni poistettu.')();
  };

  // Not wrapped in `act`: VideoModal shows its own error and resets its button, otherwise
  // a failed upload would leave the dialog stuck on "Ladataan…".
  const addVideo = async ({ shareId, title, date, tags, studentIds, file, externalUrl, onProgress }) => {
    await window.koutsiShareVideo({ shareId, title, date, tags, studentIds, addedById: coachId, file, externalUrl, onProgress });
    await reload();
    setVideoOpen(false);
    toast.success('Video jaettu.');
  };
  const saveVideoAudience = async (video, studentIds) => {
    await window.koutsiSetVideoRecipients(video.shareId, studentIds);
    await reload();
    setAudienceVideo(null);
    toast.success('Videon näkyvyys päivitetty.');
  };
  const deleteVideo = async (v) => {
    const ok = await confirm({ title: 'Poista video?', body: `${v.title} poistetaan pelaajan näkymästä.`, confirmLabel: 'Poista', danger: true });
    if (ok) await act(() => window.koutsiDeleteVideo(v.id, v.storagePath), 'Video poistettu.')();
  };

  const saveAttendance = async ({ trainingIds, status, note }) => toast.run(async () => {
    await window.koutsiSetAttendance(trainingIds, attendanceEdit.studentId, status, note);
    await reload();
  }, status === 'paikalla' ? 'Läsnäolo merkitty.' : `${window.KOUTSI_ATTENDANCE_STATUS_LABELS[status]} tallennettu.`);

  const setLevel = act((level) => window.koutsiSetStudentLevel(detailId, level));
  // Ei act(): AddPlayerModal näyttää virheen itse ja palauttaa nappinsa tilan.
  const addPlayer = async ({ name, age, level }) => {
    await window.koutsiCreatePlayer(name, age, level, coachId);
    await reload();
    toast.success(`${name} lisätty. Anna hänelle liittymiskoodisi, jos haluat että hän näkee tiedot itse.`);
  };
  // BulkSetupModal owns its validation and error state. On success it keeps the dialog
  // open for a useful summary while the underlying roster refreshes immediately.
  const bulkSetup = async ({ groups, players, themes, extraSlots }) => {
    const result = await window.koutsiBulkSetup({ coachId, groups, players, themes });
    // Extra weekly times a group got in the wizard: attached now that the group has a
    // real id (result.group_ids maps the wizard's temporary client_id to it).
    if (extraSlots?.length && result?.group_ids) {
      for (const { clientId, slots } of extraSlots) {
        const groupId = result.group_ids[clientId];
        if (!groupId) continue;
        for (const slot of slots) {
          await window.koutsiAddGroupSlot({ groupId, coachId, day: slot.day, time: slot.time, durationMinutes: slot.duration });
        }
      }
    }
    await reload();
    toast.success(`${result?.players_created || players.length} pelaajaa lisätty.`);
    return result;
  };
  const endCoaching = async () => {
    const ok = await confirm({
      title: `Päätä ${detail.name} valmennussuhde?`,
      body: 'Pelaaja poistuu oppilaslistaltasi ja ryhmistäsi. Hänen omat tietonsa ja aiemmat merkinnät säilyvät hänen näkymässään.',
      confirmLabel: 'Päätä valmennussuhde', danger: true,
    });
    if (!ok) return;
    const done = await toast.run(async () => { await window.koutsiEndCoaching(coachId, detailId); await reload(); }, 'Valmennussuhde päättyi.');
    if (done) setDetailId(null);
  };

  const saveExercise = async (data) => {
    const ok = await toast.run(async () => {
      if (editingExercise) await window.koutsiUpdateExercise(editingExercise.id, data);
      else await window.koutsiAddExercise({ coachId, ...data });
      await reload();
    }, editingExercise ? 'Harjoite päivitetty.' : 'Harjoite lisätty.');
    if (ok) { setExerciseFormOpen(false); setEditingExercise(null); }
  };
  const saveExerciseVideo = async (video) => {
    const ok = await toast.run(async () => {
      await window.koutsiSetExerciseVideo({ exerciseId, coachId, ...video });
      await reload();
    }, exercise?.video ? 'Harjoitevideo vaihdettu.' : 'Video lisätty harjoitteeseen.');
    if (ok) setExerciseVideoOpen(false);
    return Boolean(ok);
  };
  const removeExerciseVideo = async (ex) => {
    const ok = await confirm({ title: 'Poista harjoitevideo?', body: ex.video?.title || ex.name, confirmLabel: 'Poista', danger: true });
    if (!ok) return;
    await toast.run(async () => {
      await window.koutsiRemoveExerciseVideo(ex.id);
      await reload();
    }, 'Harjoitevideo poistettu.');
  };
  const deleteExercise = async (ex) => {
    const ok = await confirm({ title: 'Poista harjoite?', body: ex.name, confirmLabel: 'Poista', danger: true });
    if (!ok) return;
    const done = await toast.run(async () => { await window.koutsiDeleteExercise(ex.id); await reload(); }, 'Harjoite poistettu.');
    if (done) setExerciseId(null);
  };
  const restoreStarters = async () => {
    await toast.run(async () => {
      const added = await window.koutsiSeedExercises(coachId);
      await reload();
      toast.info(added > 0 ? `${added} esimerkkiharjoitetta palautettu.` : 'Kaikki esimerkkiharjoitteet ovat jo pankissasi.');
    });
  };

  const saveThemes = async ({ rows, removedIds }) => {
    const ok = await toast.run(async () => {
      await window.koutsiDeleteThemes(removedIds);
      await window.koutsiSaveThemes(themeModalGroupId, rows);
      await reload();
    }, rows.length === 1 ? 'Viikon teema tallennettu.' : `${rows.length} viikkoteemaa tallennettu.`);
    if (ok) setThemeModalGroupId(null);
  };
  const saveGroup = async ({ name, level, day, time, durationMinutes, memberIds }) => {
    const ok = await toast.run(async () => {
      if (editingGroup) await window.koutsiUpdateGroup(editingGroup.id, { name, level, day, time, durationMinutes });
      else await window.koutsiCreateGroup({ coachId, name, level, day, time, durationMinutes, memberIds });
      await reload();
    }, editingGroup ? 'Ryhmä päivitetty.' : 'Ryhmä luotu.');
    if (ok) { setGroupFormOpen(false); setEditingGroup(null); }
  };
  // Used by the training modal's empty group list. Unlike saveGroup this keeps the modal
  // open and returns the new id, so the coach lands back on a form that has the group picked.
  const createGroupForTraining = async (fields) => {
    let newId = null;
    const ok = await toast.run(async () => {
      newId = await window.koutsiCreateGroup(Object.assign({ coachId }, fields));
      await reload();
    }, 'Ryhmä luotu.');
    return ok ? newId : null;
  };
  const deleteGroup = async () => {
    const upcomingCount = groupUpcoming.length;
    const ok = await confirm({
      title: `Poista ryhmä ${groupDetail.name}?`,
      body: `Ryhmä ja sen ${upcomingCount} tulevaa treeniä poistetaan. Pelaajat säilyvät oppilainasi ja saavat ilmoituksen peruuntuneista treeneistä.`,
      confirmLabel: 'Poista ryhmä', danger: true,
    });
    if (!ok) return;
    const done = await toast.run(async () => { await window.koutsiDeleteGroup(groupDetail.id); await reload(); }, 'Ryhmä poistettu.');
    if (done) setGroupDetailId(null);
  };
  const removeMember = async (m) => {
    const ok = await confirm({
      title: `Poista ${m.name} ryhmästä?`,
      body: 'Pelaaja pysyy oppilaanasi, mutta ei enää näe tämän ryhmän treenejä.',
      confirmLabel: 'Poista ryhmästä', danger: true,
    });
    if (ok) await act(() => window.koutsiRemoveGroupMember(groupDetail.id, m.id), 'Pelaaja poistettu ryhmästä.')();
  };
  const addMembers = async (ids) => {
    const ok = await toast.run(async () => { await window.koutsiAddGroupMembers(addMembersGroupId, ids); await reload(); }, 'Pelaajat lisätty ryhmään.');
    if (ok) setAddMembersGroupId(null);
  };
  // Reuse the atomic bulk RPC for the one-player shortcut: the placeholder player and
  // membership are either both saved or neither is. Keeping the dialog open makes it
  // quick to type several names from a paper roster in succession.
  const createPlayerInGroup = async ({ name, age, level }) => {
    if (addMembersGroupId == null) throw new Error('Ryhmää ei löytynyt.');
    const groupRef = 'selected-existing-group';
    await window.koutsiBulkSetup({
      coachId,
      groups: [{ client_id: groupRef, existing_id: addMembersGroupId }],
      players: [{ name, age, level, group_refs: [groupRef] }],
      themes: [],
    });
    await reload();
    toast.success(`${name} luotu ja lisätty ryhmään.`);
  };

  const addGroupSlot = async ({ day, time, durationMinutes }) => {
    const ok = await toast.run(async () => {
      await window.koutsiAddGroupSlot({ groupId: groupDetail.id, coachId, day, time, durationMinutes });
      await reload();
    }, 'Harjoitusaika lisätty.');
    if (ok) setSlotFormOpen(false);
  };
  const deleteGroupSlot = async (slot) => {
    const ok = await confirm({
      title: 'Poista harjoitusaika?',
      body: `${slot.day} klo ${window.koutsiTimeRangeLabel(slot.time, slot.durationMinutes)} ja sen tulevat treenit poistetaan.`,
      confirmLabel: 'Poista', danger: true,
    });
    if (ok) await act(() => window.koutsiDeleteGroupSlot(slot.id), 'Harjoitusaika poistettu.')();
  };

  const uploadAnnualPlan = async (groupId, file) => { await window.koutsiUploadAnnualPlan(groupId, file); await reload(); };
  const removeAnnualPlan = async (groupId, storagePath) => { await window.koutsiRemoveAnnualPlan(groupId, storagePath); await reload(); };

  const openStudentFromGroup = (id) => { setGroupDetailId(null); setDetailId(id); };
  const openGroupFromStudent = () => { if (detailGroup) { setDetailId(null); setGroupDetailId(detailGroup.id); } };
  const saveClubEvent = async ({ title, date, endDate, kind }) => {
    const ok = await toast.run(async () => {
      if (editingEvent) await window.koutsiUpdateClubEvent(editingEvent.id, { title, date, endDate, kind });
      else await window.koutsiAddClubEvent({ coachId, title, date, endDate, kind });
      await reload();
    }, editingEvent ? 'Tapahtuma päivitetty.' : 'Tapahtuma lisätty.');
    if (ok) { setEventOpen(false); setEditingEvent(null); }
  };
  const deleteClubEvent = async (e) => {
    const dates = e.endDate && e.endDate !== e.date
      ? `${window.koutsiFmtShortDate(e.date)}–${window.koutsiFmtShortDate(e.endDate)}`
      : window.koutsiFmtShortDate(e.date);
    const ok = await confirm({ title: 'Poista tapahtuma?', body: `${e.title} — ${dates}`, confirmLabel: 'Poista', danger: true });
    if (ok) await act(() => window.koutsiDeleteClubEvent(e.id), 'Tapahtuma poistettu.')();
  };

  // Acting mode has neither Ylläpito nor Profiili. The sticky banner is the only exit,
  // which also works when the mobile bottom navigation has no room for an extra action.
  const nav = koutsiNav(isAdmin && !actingCoach).filter((item) => !actingCoach || item.id !== 'profile');

  const openNewTraining = (d) => { setEditingTraining(null); setTrainingDefaultDate(d || window.koutsiTodayStr()); setTrainingOpen(true); };
  const openEditTraining = (t) => { setEditingTraining(t); setTrainingOpen(true); };

  return (
    <div style={{ minHeight: '100vh' }}>
      <div className="kv-sidebar-wrap">
        <Sidebar tab={tab} setTab={setTab} coach={state.coach} onSignOut={onSignOut} nav={nav} acting={Boolean(actingCoach)} />
      </div>
      <MobileTopBar coach={state.coach} acting={Boolean(actingCoach)} onProfile={() => setTab('profile')} onSignOut={onSignOut} />
      <div className="kv-main">
        {actingCoach && <ActingBanner coachName={state.coach.name} onExit={onExitActing} />}
        <div key={tab} className="k-rise-in">
          {tab === 'students' && (
            <StudentsView
              students={state.students} groups={state.groups} state={state} coachId={coachId} coachName={state.coach.name} onOpen={setDetailId}
              trainingCount={state.trainings.filter((t) => t.loggedBy !== 'player').length}
              onAddTraining={() => { setTab('trainings'); openNewTraining(null); }}
              onAddPlayer={addPlayer} onBulkSetup={bulkSetup} />
          )}
          {tab === 'groups' && <GroupsView groups={state.groups} students={state.students} coachId={coachId} acting={Boolean(actingCoach)} onOpen={setGroupDetailId} onCreate={() => { setEditingGroup(null); setGroupFormOpen(true); }} />}
          {tab === 'trainings' && (
            <CalendarView
              state={state} onAdd={openNewTraining} onPreSession={setPresessionTrainingId}
              onEditTraining={openEditTraining} onDeleteTraining={deleteTraining}
              onAddEvent={(d) => { setEditingEvent(null); setEventDefaultDate(d); setEventOpen(true); }}
              onEditEvent={(e) => { setEditingEvent(e); setEventOpen(true); }}
              onDeleteEvent={deleteClubEvent} />
          )}
          {tab === 'exercises' && <ExercisesView exercises={state.exercises} onOpen={setExerciseId} onAdd={() => { setEditingExercise(null); setExerciseFormOpen(true); }} onRestoreStarters={restoreStarters} />}
          {tab === 'admin' && isAdmin && !actingCoach && <AdminView onActAs={onActAs} />}
          {tab === 'profile' && !actingCoach && <ProfileView coach={state.coach} studentCount={state.students.length} groupCount={state.groups.length} onSignOut={onSignOut} onReload={reload} acting={false} />}
        </div>
      </div>
      <MobileBottomNav tab={tab} setTab={setTab} nav={nav} />

      {detail && (
        <StudentDetail
          student={detail} coach={state.coach} state={state} trainings={detailTrainings} group={detailGroup} groupCoach={detailGroupCoach} upcoming={detailUpcoming} attendance={detailAttendance}
          onClose={() => { setDetailId(null); setHomeworkOpen(false); }} onAddEntry={() => { setEditingEntry(null); setEntryOpen(true); }}
          onToggleHomework={toggleHomework} onOpenGroup={openGroupFromStudent} onAddHomework={() => setHomeworkOpen(true)}
          onAddVideo={() => setVideoOpen(true)}
          onEditAttendance={(training, studentId) => setAttendanceEdit({ trainingId: training.id, studentId })} onSetLevel={setLevel}
          onEditEntry={(d) => { setEditingEntry(d); setEntryOpen(true); }} onDeleteEntry={deleteEntry}
          onEditHomework={editHomework} onDeleteHomework={deleteHomework}
          onDeleteVideo={deleteVideo} onEditVideoAudience={setAudienceVideo} onEndCoaching={endCoaching} />
      )}
      {detail && entryOpen && <EntryModal student={detail} entry={editingEntry} onClose={() => { setEntryOpen(false); setEditingEntry(null); }} onSend={saveEntry} />}
      {detail && homeworkOpen && <HomeworkModal student={detail} onClose={() => setHomeworkOpen(false)} onSend={saveHomework} />}
      {detail && videoOpen && <VideoModal students={state.students} groups={state.groups} initialStudentId={detailId} onClose={() => setVideoOpen(false)} onSave={addVideo} />}
      {audienceVideo && <VideoAudienceModal video={audienceVideo} students={state.students} onClose={() => setAudienceVideo(null)} onSave={saveVideoAudience} />}
      {groupDetail && (
        <GroupDetail
          group={groupDetail} members={groupMembers} trainings={groupTrainings} upcoming={groupUpcoming}
          onClose={() => setGroupDetailId(null)} onOpenStudent={openStudentFromGroup} onOpenAttendance={setPresessionTrainingId}
          onEditTheme={() => setThemeModalGroupId(groupDetail.id)} onAddMembers={() => setAddMembersGroupId(groupDetail.id)}
          onUploadPlan={uploadAnnualPlan} onRemovePlan={removeAnnualPlan}
          onEditGroup={() => { setEditingGroup(groupDetail); setGroupFormOpen(true); }}
          onDeleteGroup={deleteGroup} onRemoveMember={removeMember}
          onAddSlot={() => setSlotFormOpen(true)} onDeleteSlot={deleteGroupSlot} />
      )}
      {slotFormOpen && <GroupSlotModal onClose={() => setSlotFormOpen(false)} onSave={addGroupSlot} />}
      {trainingOpen && (
        <TrainingModal
          students={state.students} groups={state.groups} defaultDate={trainingDefaultDate} editing={editingTraining}
          onClose={() => { setTrainingOpen(false); setEditingTraining(null); }}
          onSave={saveTraining} onSaveSeries={saveTrainingSeries} onCreateGroup={createGroupForTraining} />
      )}
      {exercise && (
        <ExerciseDetail
          exercise={exercise} onClose={() => { setExerciseId(null); setExerciseVideoOpen(false); }}
          onEdit={() => { setEditingExercise(exercise); setExerciseFormOpen(true); setExerciseId(null); setExerciseVideoOpen(false); }}
          onDelete={() => deleteExercise(exercise)}
          onAddVideo={() => setExerciseVideoOpen(true)}
          onRemoveVideo={() => removeExerciseVideo(exercise)} />
      )}
      {exercise && exerciseVideoOpen && <ExerciseVideoModal exercise={exercise} onClose={() => setExerciseVideoOpen(false)} onSave={saveExerciseVideo} />}
      {exerciseFormOpen && <ExerciseFormModal editing={editingExercise} onClose={() => { setExerciseFormOpen(false); setEditingExercise(null); }} onSave={saveExercise} />}
      {presessionTraining && <PreSessionPanel training={presessionTraining} state={state} onClose={() => setPresessionTrainingId(null)} onEditAttendance={(studentId) => setAttendanceEdit({ trainingId: presessionTraining.id, studentId })} />}
      {attendanceTraining && attendanceStudent && (
        <window.KoutsiAttendanceModal
          studentName={attendanceStudent.name} training={attendanceTraining} eligibleTrainings={attendanceEligibleTrainings}
          entry={attendanceEntry} viewerRole="coach" onClose={() => setAttendanceEdit(null)} onSave={saveAttendance} />
      )}
      {themeModalGroupId != null && (() => {
        const themeGroup = state.groups.find((g) => g.id === themeModalGroupId);
        return themeGroup ? <WeeklyThemesModal group={themeGroup} onClose={() => setThemeModalGroupId(null)} onSave={saveThemes} /> : null;
      })()}
      {groupFormOpen && <GroupFormModal students={state.students} editing={editingGroup} onClose={() => { setGroupFormOpen(false); setEditingGroup(null); }} onSave={saveGroup} />}
      {eventOpen && <ClubEventModal editing={editingEvent} defaultDate={eventDefaultDate} onClose={() => { setEventOpen(false); setEditingEvent(null); }} onSave={saveClubEvent} />}
      {addMembersGroupId != null && <AddMembersModal coachId={coachId} coachName={state.coach.name} group={state.groups.find((g) => g.id === addMembersGroupId)} allStudents={state.students} onClose={() => setAddMembersGroupId(null)} onSave={addMembers} onCreatePlayer={createPlayerInGroup} />}
    </div>
  );
}


// ── root gate: auth -> Krossi onboarding -> coach check -> app ─────────
// Self-serve coach provisioning, gated by a shared key checked server-side
// (redeem_koutsi_coach_key) — the real value never ships to the browser.
function CoachKeyGate({ onSignOut, onRedeemed }) {
  const [key, setKey] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!key.trim()) return;
    setError(''); setBusy(true);
    try {
      await window.koutsiRedeemCoachKey(key.trim());
      await onRedeemed();
    } catch (err) {
      setError(window.koutsiErrorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--sand)', textAlign: 'center' }}>
      <div className="k-card" style={{ width: 'min(420px, 100%)', padding: '30px 28px' }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 10, color: '#111' }}>Tiliäsi ei ole vielä liitetty valmentajaksi</h2>
        <p style={{ fontSize: 14, color: '#8a857a', lineHeight: 1.55, marginBottom: 20 }}>
          Jos olet valmentaja, syötä Krossilta saamasi valmentaja-avain. Jos et ole vielä saanut avainta,{' '}
          <a href="mailto:eelispuro@gmail.com?subject=Valmentaja-avain%20Koutsiin" style={{ color: 'var(--green-deep)', fontWeight: 700 }}>pyydä se sähköpostilla</a>.
        </p>
        {error && <div style={{ background: 'rgba(161,59,47,0.08)', border: '1px solid rgba(161,59,47,0.25)', color: '#a13b2f', padding: '10px 14px', borderRadius: 12, fontSize: 13, marginBottom: 14, textAlign: 'left' }}>{error}</div>}
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Valmentaja-avain" type="password" autoFocus
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' }} />
          <button className="btn-dark" type="submit" disabled={busy || !key.trim()} style={{ padding: '13px 0', border: 'none', opacity: (busy || !key.trim()) ? 0.45 : 1 }}>
            {busy ? 'Tarkistetaan...' : 'Vahvista'}
          </button>
        </form>
        <button onClick={onSignOut} className="btn-outline" style={{ width: '100%', padding: '13px 0' }}>Kirjaudu ulos</button>
      </div>
    </div>
  );
}
function KoutsiValmentajaRoot() {
  const auth = window.useKoutsiAuth();
  const [coachRow, setCoachRow] = React.useState(undefined); // undefined = checking, null = not a coach

  const [checkFailed, setCheckFailed] = React.useState(false);

  // Keyed on the user id rather than the session object: Supabase hands out a new session
  // object on every token refresh and every return to the tab, so depending on the object
  // itself re-queried the coach row each time for a person who had not changed.
  const uid = auth.session?.user?.id || null;

  // sessionStorage is only a hint. Its target is never rendered until the current JWT has
  // called koutsi_admin_act_as again and the server has confirmed koutsi_admins membership.
  const [actingCoach, setActingCoach] = React.useState(undefined); // undefined = validating
  const [actingValidatedUid, setActingValidatedUid] = React.useState(null);
  React.useEffect(() => {
    if (!uid) { setActingCoach(undefined); setActingValidatedUid(null); return undefined; }
    let cancelled = false;
    let cached = null;
    try { cached = JSON.parse(sessionStorage.getItem('koutsiActingCoach') || 'null'); } catch { cached = null; }
    if (!cached?.id) {
      setActingCoach(null);
      setActingValidatedUid(uid);
      return undefined;
    }

    setActingCoach(undefined);
    setActingValidatedUid(null);
    window.koutsiAdminActAs(cached.id)
      .then((verified) => {
        if (!cancelled) { setActingCoach(verified); setActingValidatedUid(uid); }
      })
      .catch(() => {
        try { sessionStorage.removeItem('koutsiActingCoach'); } catch { /* private mode */ }
        if (!cancelled) { setActingCoach(null); setActingValidatedUid(uid); }
      });
    return () => { cancelled = true; };
  }, [uid]);

  React.useEffect(() => {
    if (!uid || actingValidatedUid !== uid || actingCoach === undefined) return;
    try {
      if (actingCoach) sessionStorage.setItem('koutsiActingCoach', JSON.stringify(actingCoach));
      else sessionStorage.removeItem('koutsiActingCoach');
    } catch { /* yksityinen selaustila: tila elää silti muistissa */ }
  }, [uid, actingCoach, actingValidatedUid]);

  const actAs = React.useCallback(async (coachId) => {
    const verified = await window.koutsiAdminActAs(coachId);
    replaceCoachTabRoute('students');
    setActingCoach(verified);
    setActingValidatedUid(uid);
  }, [uid]);
  const exitActing = React.useCallback(() => {
    replaceCoachTabRoute('admin');
    setActingCoach(null);
    setActingValidatedUid(uid);
  }, [uid]);

  const checkCoachRow = React.useCallback(() => {
    if (!uid) return Promise.resolve();
    setCheckFailed(false);
    return window.koutsiFetchCoachRow(uid)
      .then((row) => setCoachRow(row))
      .catch(() => setCheckFailed(true)); // katkennut yhteys ei saa jättää rautalankaan pyörimään
  }, [uid]);

  React.useEffect(() => {
    if (!uid || !auth.pilotAccepted || auth.needsOnboarding) { setCoachRow(undefined); return; }
    let cancelled = false;
    setCheckFailed(false);
    window.koutsiFetchCoachRow(uid)
      .then((row) => { if (!cancelled) setCoachRow(row); })
      .catch(() => { if (!cancelled) setCheckFailed(true); });
    return () => { cancelled = true; };
  }, [uid, auth.pilotAccepted, auth.needsOnboarding]);

  if (auth.loading) return <window.KoutsiAuthLoadingScreen />;
  // a recovery link must lead to a new password, not straight into the app
  if (auth.recoveryMode && auth.session) return <window.KoutsiPasswordResetScreen />;
  if (!auth.session) return <window.KoutsiAuthScreen />;
  if (auth.pilotError) return <window.KoutsiErrorScreen message="Pilotin käyttörajausta ei saatu tarkistettua. Tarkista verkkoyhteys ja yritä uudelleen." onRetry={auth.retryPilot} onSignOut={auth.signOut} />;
  if (!auth.pilotAccepted) return <window.KoutsiPilotGate />;
  if (auth.profileError) return <window.KoutsiErrorScreen message="Profiilitietojasi ei saatu haettua. Tarkista verkkoyhteys ja yritä uudelleen." onRetry={auth.retryProfile} onSignOut={auth.signOut} />;
  if (auth.needsOnboarding) return <window.KoutsiProfileOnboarding />;
  if (checkFailed) return <window.KoutsiErrorScreen onRetry={checkCoachRow} onSignOut={auth.signOut} />;
  if (coachRow === undefined) return <window.KoutsiAuthLoadingScreen />;
  if (!coachRow) return <CoachKeyGate onSignOut={auth.signOut} onRedeemed={checkCoachRow} />;
  if (actingValidatedUid !== uid || actingCoach === undefined) return <window.KoutsiAuthLoadingScreen />;
  return (
    <CoachApp
      key={actingCoach ? actingCoach.id : auth.session.user.id}
      coachId={actingCoach ? actingCoach.id : auth.session.user.id}
      actingCoach={actingCoach} onExitActing={exitActing} onActAs={actAs}
      onSignOut={auth.signOut} />
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <window.KoutsiUIProvider>
    <window.KoutsiAuthProvider><KoutsiValmentajaRoot /></window.KoutsiAuthProvider>
  </window.KoutsiUIProvider>
);
