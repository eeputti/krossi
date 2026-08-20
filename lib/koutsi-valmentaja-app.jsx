// koutsi-valmentaja-app.jsx — full-page coach web app for koutsi.krossi.app/valmentaja.
// Reads/writes the real Supabase-backed store from koutsi-data.js (see koutsi-auth.jsx
// for the login/onboarding gate this file is mounted behind), so changes made here show
// up on the player's device too, live. The localStorage-only sales demo is
// lib/koutsi-demo-valmentaja-app.jsx.

const TAG_LABELS = { kaikki: 'Kaikki', syotto: 'Syöttö', liikkuminen: 'Liikkuminen', pistepeli: 'Pistepeli', verkkopeli: 'Verkkopeli', tekniikka: 'Tekniikka', lammittely: 'Lämmittely' };
const EXERCISE_TAGS = ['kaikki', 'syotto', 'liikkuminen', 'pistepeli', 'verkkopeli', 'tekniikka', 'lammittely'];
const CAL_WEEKDAY_LABELS = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];
const PLAYER_COUNT_FILTERS = [
  { key: 'kaikki', label: 'Kaikki' },
  { key: 1, label: '1 pelaaja' },
  { key: 2, label: '2 pelaajaa' },
  { key: 3, label: '3 pelaajaa' },
  { key: 4, label: '4+ pelaajaa' },
];

function Avatar({ initial, hue = 150, size = 44, ring = false }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: `radial-gradient(120% 120% at 30% 20%, hsl(${hue} 55% 62%), hsl(${hue + 24} 60% 38%))`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 700, fontSize: size * 0.38,
      boxShadow: ring ? '0 0 0 3px var(--lime)' : 'none', letterSpacing: 0.3,
    }}>{initial}</div>
  );
}
function AvatarStack({ members, size = 34, max = 4 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {members.slice(0, max).map((m, i) => (
        <div key={m.id} style={{ marginLeft: i > 0 ? -Math.round(size * 0.28) : 0, position: 'relative', zIndex: max - i }}>
          <Avatar initial={m.initial} hue={m.hue} size={size} ring />
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
function VideoTile({ video, onDelete }) {
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
        {onDelete && <window.KoutsiRowActions onDelete={() => onDelete(video)} deleteLabel="Poista video" />}
      </div>
      {video.tags && video.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          {video.tags.map((t) => <span key={t} className="k-chip" style={{ padding: '2px 8px', fontSize: 10.5 }}>{window.KOUTSI_TAG_LABELS[t] || t}</span>)}
        </div>
      )}
    </div>
  );
}

function VideoRow({ videos, onDelete }) {
  if (!videos.length) return <div style={{ color: '#8a857a', fontSize: 14 }}>Ei vielä jaettuja videoita.</div>;
  return (
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 2 }}>
      {videos.map((v) => <VideoTile key={v.id} video={v} onDelete={onDelete} />)}
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
// `label` distinguishes the theme running this week from one planned for a later week.
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
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 16, lineHeight: 1.5 }}>Tämä koodi liittää pelaajan sinun valmennettavaksesi ilman ryhmää — sopii esim. yksityistunneille. Voit lisätä pelaajan johonkin ryhmään myöhemmin erikseen.</p>
        <InviteCodeBox coachId={coachId} coachName={coachName} groupId={null} groupName={null} />
        <button onClick={onClose} className="btn-outline" style={{ width: '100%', padding: '13px 0', marginTop: 16 }}>Sulje</button>
      </div>
    </div>
  );
}

function StudentsView({ students, coachId, coachName, onOpen, groupCount, trainingCount, onCreateGroup, onAddTraining }) {
  const [inviteOpen, setInviteOpen] = React.useState(false);
  // A search box only earns its space once the list stops fitting on one screen.
  const [search, setSearch] = React.useState('');
  const q = search.trim().toLowerCase();
  const shown = q
    ? students.filter((s) => `${s.name} ${s.goal || ''} ${s.focus || ''} ${s.level || ''}`.toLowerCase().includes(q))
    : students;
  return (
    <div>
      <PageHeader title="Oppilaani" sub={`${students.length} valmennettavaa`} action={<button onClick={() => setInviteOpen(true)} className="btn-dark btn-sm">+ Kutsu oppilas</button>} />
      <GettingStarted
        studentCount={students.length} groupCount={groupCount} trainingCount={trainingCount}
        onInvite={() => setInviteOpen(true)} onCreateGroup={onCreateGroup} onAddTraining={onAddTraining} />
      {students.length > 6 && (
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Hae oppilaan nimellä tai tavoitteella…"
          style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '12px 15px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff', marginBottom: 18 }} />
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 18 }}>
        {shown.map((s) => (
          <button key={s.id} onClick={() => onOpen(s.id)} className="k-card" style={{ textAlign: 'left', cursor: 'pointer', padding: '20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar initial={s.initial} hue={s.hue} size={48} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ color: '#111', fontWeight: 700, fontSize: 16.5 }}>{s.name}{s.age ? `, ${s.age}` : ''}</span>
                  {s.diary.length > 0 && <span title="Uusi merkintä" style={{ width: 7, height: 7, borderRadius: '50%', background: '#46a66d', flexShrink: 0 }} />}
                </div>
                <div style={{ marginTop: 6 }}><LevelChip level={s.level || 'Ei asetettu'} /></div>
              </div>
            </div>
            <div style={{ fontSize: 13.5, color: '#3c382f', lineHeight: 1.5 }}><b style={{ color: 'var(--green-deep)' }}>Tavoite:</b> {s.goal || 'Ei vielä tavoitetta'}</div>
            <div style={{ fontSize: 12.5, color: '#8a857a', lineHeight: 1.5 }}>Seuraavaksi: {s.focus || '—'}</div>
          </button>
        ))}
        {students.length === 0 && <div style={{ color: '#8a857a', fontSize: 14.5 }}>Ei vielä oppilaita — kutsu ensimmäinen yllä olevasta linkistä.</div>}
        {students.length > 0 && shown.length === 0 && <div style={{ color: '#8a857a', fontSize: 14.5 }}>Ei osumia haulla ”{search.trim()}”.</div>}
      </div>
      {inviteOpen && <InviteStudentModal coachId={coachId} coachName={coachName} onClose={() => setInviteOpen(false)} />}
    </div>
  );
}

// Absences were listed one by one with no total, which is the number a coach is actually
// asked for at the end of a season. Only past sessions count — a season planned ahead
// would otherwise read as one long absence.
function AttendanceCard({ attendance }) {
  const [open, setOpen] = React.useState(false);
  const { total, present, absent, injured, rate, events } = attendance;
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
          <span style={{ width: `${total ? (injured / total) * 100 : 0}%`, background: '#c23b28' }} />
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12.5, color: '#514c42' }}>
          <span><b style={{ color: '#2f7d54' }}>{present}</b> paikalla</span>
          <span><b style={{ color: '#6b665c' }}>{absent}</b> poissa</span>
          <span><b style={{ color: '#c23b28' }}>{injured}</b> loukkaantuneena</span>
        </div>
        {events.length > 0 && (
          <React.Fragment>
            <button onClick={() => setOpen((v) => !v)} style={{ background: 'none', border: 'none', padding: '10px 0 0', color: 'var(--green-deep)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              {open ? 'Piilota erittely' : `Näytä ${events.length} poissaoloa`}
            </button>
            {open && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                {events.map(({ training, reason }) => (
                  <div key={training.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: reason === 'vamma' ? 'rgba(214,60,44,0.08)' : 'rgba(138,133,122,0.1)' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: reason === 'vamma' ? '#c23b28' : '#8a857a', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: '#3c382f', flex: 1 }}>{window.koutsiFmtShortDate(training.date)} — {training.type}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: reason === 'vamma' ? '#c23b28' : '#6b665c' }}>{window.KOUTSI_ABSENCE_REASON_LABELS[reason]}</span>
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

function ClubEventModal({ editing, defaultDate, onClose, onSave }) {
  const isEdit = Boolean(editing);
  const [title, setTitle] = React.useState(() => (editing ? editing.title : ''));
  const [date, setDate] = React.useState(() => (editing ? editing.date : (defaultDate || window.koutsiTodayStr())));
  const [kind, setKind] = React.useState(() => (editing ? editing.kind || 'seura' : 'seura'));
  const ready = title.trim() && date;
  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };
  const label = { fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(440px, 100%)', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 6 }}>{isEdit ? 'Muokkaa tapahtumaa' : 'Uusi tapahtuma'}</h3>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 18, lineHeight: 1.5 }}>Kilpailut, leirit ja muut merkinnät näkyvät kalenterissa sinulle ja oppilaillesi.</p>
        <div style={label}>Otsikko</div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Esim. Seuran kevätkisat" autoFocus style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={label}>Päivämäärä</div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={label}>Tyyppi</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {window.KOUTSI_EVENT_KINDS.map((k) => (
            <button key={k.value} onClick={() => setKind(k.value)} style={{ padding: '8px 14px', borderRadius: 999, border: kind === k.value ? 'none' : '1px solid #d8d4ca', background: kind === k.value ? 'var(--lime)' : '#fff', color: kind === k.value ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>{k.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={() => ready && onSave({ title: title.trim(), date, kind })} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: ready ? 1 : 0.45, cursor: ready ? 'pointer' : 'default' }}>{isEdit ? 'Tallenna' : 'Lisää'}</button>
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

function StudentDetail({ student, group, groupCoach, upcoming, attendance, onClose, onAddEntry, onToggleHomework, onOpenGroup, onAddHomework, onAddVideo, onEditBackground, onSetLevel, onEditEntry, onDeleteEntry, onEditHomework, onDeleteHomework, onDeleteVideo, onEndCoaching }) {
  const [homeworkText, setHomeworkText] = React.useState('');
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
            <Avatar initial={student.initial} hue={student.hue} size={84} ring />
            <div style={{ color: '#111', fontWeight: 800, fontSize: 22 }}>{student.name}{student.age ? `, ${student.age}` : ''}</div>
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

          <Field label="Tavoite ja seuraava askel">
            <div className="k-card" style={{ padding: '15px 17px', display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ fontSize: 14, lineHeight: 1.5 }}><b style={{ color: 'var(--green-deep)' }}>Tavoite:</b> {student.goal} <span style={{ color: '#8a857a', fontSize: 12 }}>(pelaajan asettama)</span></div>
              <div style={{ fontSize: 14, lineHeight: 1.5 }}><b style={{ color: 'var(--green-deep)' }}>Viime treenissä:</b> {student.lastSession}</div>
              <div style={{ fontSize: 14, lineHeight: 1.5 }}><b style={{ color: 'var(--green-deep)' }}>Seuraavaksi:</b> {student.focus}</div>
              <GoalHistory history={student.goalHistory} />
            </div>
          </Field>

          <Field label="Taustatiedot">
            <div className="k-card" style={{ padding: '13px 15px' }}>
              {student.background ? (
                <div style={{ fontSize: 14, color: '#3c382f', lineHeight: 1.5 }}>{student.background}</div>
              ) : (
                <div style={{ fontSize: 14, color: '#8a857a' }}>Ei taustatietoja — esim. loukkaantumishistoria, tavoitteet tai muuta huomioitavaa.</div>
              )}
            </div>
            <button onClick={onEditBackground} className="btn-outline btn-sm" style={{ marginTop: 10 }}>Muokkaa taustatietoja</button>
          </Field>

          {attendance && attendance.total > 0 && <AttendanceCard attendance={attendance} />}

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
            <VideoRow videos={student.videos} onDelete={onDeleteVideo} />
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
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input value={homeworkText} onChange={(e) => setHomeworkText(e.target.value)} placeholder="Uusi kotiläksy…"
                style={{ flex: 1, boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 12, padding: '9px 12px', fontSize: 13.5, fontFamily: 'inherit', color: '#111', background: '#fff' }} />
              <button onClick={() => { if (homeworkText.trim()) { onAddHomework(homeworkText.trim()); setHomeworkText(''); } }} className="btn-outline btn-sm">+ Lisää</button>
            </div>
          </Field>

          <Field label="Valmennussuhde">
            <p style={{ fontSize: 13, color: '#8a857a', lineHeight: 1.5, marginBottom: 10 }}>
              Päättäminen poistaa pelaajan oppilaslistaltasi ja ryhmistäsi. Aiemmat merkinnät säilyvät pelaajan omassa näkymässä.
            </p>
            <button onClick={onEndCoaching} className="btn-outline btn-sm" style={{ color: '#8f2f24', borderColor: '#e3c9c4' }}>Päätä valmennussuhde</button>
          </Field>
        </div>
        <div style={{ position: 'sticky', bottom: 0, left: 0, right: 0, padding: '18px 28px', background: 'linear-gradient(to top, #fff 60%, transparent)' }}>
          <button onClick={onAddEntry} className="btn-lime btn-lg" style={{ width: '100%' }}>+ Uusi päiväkirjamerkintä</button>
        </div>
      </div>
    </div>
  );
}

function BackgroundModal({ student, onClose, onSave }) {
  const [val, setVal] = React.useState(student.background || '');
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(460px, 100%)', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 6 }}>Taustatiedot — {student.name}</h3>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 16, lineHeight: 1.5 }}>Esim. loukkaantumishistoria, terveystiedot, tavoitteet tai muuta huomioitavaa pelaajasta.</p>
        <textarea autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder="Esim. Vanha nilkkavamma — vältä äkkinäisiä suunnanmuutoksia…" rows={5}
          style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', resize: 'none', marginBottom: 16, background: '#fff' }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={() => onSave(val.trim())} className="btn-dark" style={{ flex: 1, padding: '13px 0' }}>Tallenna</button>
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
          style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', resize: 'none', marginBottom: 16, background: '#fff' }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={() => val.trim() && onSend(val.trim())} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: val.trim() ? 1 : 0.45, cursor: val.trim() ? 'pointer' : 'default' }}>Tallenna</button>
        </div>
      </div>
    </div>
  );
}

function VideoModal({ students, initialStudentId, onClose, onSave }) {
  const [title, setTitle] = React.useState('');
  const [date, setDate] = React.useState(window.koutsiTodayStr());
  const [tags, setTags] = React.useState([]);
  const [studentIds, setStudentIds] = React.useState(initialStudentId != null ? [initialStudentId] : []);
  const [file, setFile] = React.useState(null);
  const [externalUrl, setExternalUrl] = React.useState('');
  const [source, setSource] = React.useState('file'); // 'file' | 'link'
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const fileRef = React.useRef(null);
  const toggleTag = (t) => setTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
  const toggleStudent = (id) => setStudentIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const pickFile = (e) => {
    const f = e.target.files?.[0];
    setError('');
    if (!f) return;
    setFile(f);
    if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };
  const hasSource = source === 'file' ? Boolean(file) : /^https?:\/\//i.test(externalUrl.trim());
  const ready = title.trim() && date && studentIds.length > 0 && hasSource && !busy;
  const submit = async () => {
    if (!ready) return;
    setBusy(true); setError('');
    try {
      await onSave({
        title: title.trim(), date, tags, studentIds,
        file: source === 'file' ? file : null,
        externalUrl: source === 'link' ? externalUrl.trim() : null,
      });
    } catch (err) { setError(window.koutsiErrorText(err, 'Videon tallennus epäonnistui')); setBusy(false); }
  };
  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(460px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 6 }}>Lisää video</h3>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 16, lineHeight: 1.5 }}>Video näkyy valituille pelaajille. Lataa tiedosto (MP4, MOV tai WebM, enintään 200 Mt) tai jaa linkki, jos video on jo YouTubessa tai Drivessa.</p>
        {error && <div style={{ background: 'rgba(161,59,47,0.08)', border: '1px solid rgba(161,59,47,0.25)', color: '#a13b2f', padding: '10px 14px', borderRadius: 12, fontSize: 13, marginBottom: 14 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {[['file', 'Lataa tiedosto'], ['link', 'Jaa linkki']].map(([key, label]) => (
            <button key={key} onClick={() => { setSource(key); setError(''); }} style={{ padding: '9px 15px', borderRadius: 999, border: source === key ? 'none' : '1px solid #d8d4ca', background: source === key ? 'var(--lime)' : '#fff', color: source === key ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{label}</button>
          ))}
        </div>
        {source === 'file' ? (
          <React.Fragment>
            <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/webm,video/x-m4v" onChange={pickFile} style={{ display: 'none' }} />
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="btn-outline" style={{ width: '100%', padding: '13px 0', marginBottom: 16 }}>
              {file ? `${file.name} (${Math.max(1, Math.round(file.size / 1048576))} Mt)` : 'Valitse video…'}
            </button>
          </React.Fragment>
        ) : (
          <input value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://youtube.com/..." style={{ ...inputStyle, marginBottom: 16 }} />
        )}
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Otsikko</div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Esim. Syöttöanalyysi" style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Päivämäärä</div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Aihe</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {window.KOUTSI_TAGS.map((t) => (
            <button key={t} onClick={() => toggleTag(t)} style={{ padding: '8px 14px', borderRadius: 999, border: tags.includes(t) ? 'none' : '1px solid #d8d4ca', background: tags.includes(t) ? 'var(--lime)' : '#fff', color: tags.includes(t) ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>{window.KOUTSI_TAG_LABELS[t]}</button>
          ))}
        </div>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Jaa pelaajille ({studentIds.length} valittu)</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20, maxHeight: 220, overflowY: 'auto' }}>
          {students.map((s) => (
            <button key={s.id} onClick={() => toggleStudent(s.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 12, border: studentIds.includes(s.id) ? '2px solid var(--lime)' : '1px solid #d8d4ca', background: studentIds.includes(s.id) ? 'rgba(207,228,20,0.1)' : '#fff', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%' }}>
              <Avatar initial={s.initial} hue={s.hue} size={30} />
              <span style={{ fontWeight: 600, fontSize: 13.5, color: '#111', flex: 1 }}>{s.name}</span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={busy} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={submit} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: ready ? 1 : 0.45, cursor: ready ? 'pointer' : 'default' }}>{busy ? 'Ladataan…' : `Jaa (${studentIds.length})`}</button>
        </div>
      </div>
    </div>
  );
}

// ── Ryhmät ───────────────────────────────────────────────
function GroupsView({ groups, students, onOpen, onCreate }) {
  return (
    <div>
      <PageHeader title="Ryhmät" sub={`${groups.length} valmennusryhmää`} action={<button onClick={onCreate} className="btn-dark btn-sm">+ Uusi ryhmä</button>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 18 }}>
        {groups.map((g) => {
          const members = g.memberIds.map((id) => students.find((s) => s.id === id)).filter(Boolean);
          return (
            <button key={g.id} onClick={() => onOpen(g.id)} className="k-card" style={{ textAlign: 'left', cursor: 'pointer', padding: '20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ color: '#111', fontWeight: 700, fontSize: 17 }}>{g.name}</div>
                <div style={{ marginTop: 6 }}><LevelChip level={g.level} /></div>
              </div>
              <div style={{ fontSize: 13, color: '#8a857a' }}>{g.day} klo {g.time} viikoittain</div>
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
      const result = await window.koutsiCreateInviteCode(groupId, { expiresDays: 14, maxUses });
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
          ? 'Tämä on pysyvä koodisi. Se ei vanhene eikä kulu, joten voit jakaa saman koodin kaikille pelaajillesi. Pelaaja avaa linkin, kirjautuu tai luo Krossi-tilin ja liittyy valmennettavaksesi.'
          : `Pelaaja avaa linkin, kirjautuu tai luo Krossi-tilin ja liittyy${groupName ? ' suoraan tähän ryhmään' : ' valmennettavaksesi'} — koodia ei tarvitse näpytellä.${issued && issued.expires_at ? ` Linkki on voimassa ${window.koutsiFmtShortDate(String(issued.expires_at).slice(0, 10))} asti.` : ''}`}
      </p>
      {!isPermanent && <button onClick={() => setIssued(null)} className="btn-outline btn-sm" style={{ marginTop: 10 }}>Valmis</button>}
    </div>
  );
}

function GroupFormModal({ students, editing, onClose, onSave }) {
  const isEdit = Boolean(editing);
  const [name, setName] = React.useState(() => (editing ? editing.name : ''));
  const [level, setLevel] = React.useState(() => (editing ? editing.level || '' : ''));
  const [day, setDay] = React.useState(() => (editing ? editing.day || 'Ma' : 'Ma'));
  const [time, setTime] = React.useState(() => (editing ? editing.time || '' : ''));
  const [memberIds, setMemberIds] = React.useState([]);
  const toggleMember = (id) => setMemberIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const ready = name.trim() && time.trim();
  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };
  const label = { fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 };
  const days = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
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
        <div style={label}>Kellonaika</div>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ ...inputStyle, marginBottom: 20 }} />
        {!isEdit && <div style={label}>Pelaajat ({memberIds.length} valittu)</div>}
        <div style={{ display: isEdit ? 'none' : 'flex', flexDirection: 'column', gap: 8, marginBottom: 10, maxHeight: 220, overflowY: 'auto' }}>
          {students.map((s) => (
            <button key={s.id} onClick={() => toggleMember(s.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 12, border: memberIds.includes(s.id) ? '2px solid var(--lime)' : '1px solid #d8d4ca', background: memberIds.includes(s.id) ? 'rgba(207,228,20,0.1)' : '#fff', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%' }}>
              <Avatar initial={s.initial} hue={s.hue} size={30} />
              <span style={{ fontWeight: 600, fontSize: 13.5, color: '#111', flex: 1 }}>{s.name}</span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={() => ready && onSave({ name: name.trim(), level: level.trim() || 'Kaikki tasot', day, time: time.trim(), memberIds })} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: ready ? 1 : 0.45, cursor: ready ? 'pointer' : 'default' }}>{isEdit ? 'Tallenna' : 'Luo ryhmä'}</button>
        </div>
        {!isEdit && <p style={{ fontSize: 12, color: '#8a857a', marginTop: 12, lineHeight: 1.5 }}>Voit kutsua uusia pelaajia liittymislinkillä ryhmän luomisen jälkeen.</p>}
      </div>
    </div>
  );
}

function AddMembersModal({ coachId, coachName, group, allStudents, onClose, onSave }) {
  const available = allStudents.filter((s) => !group.memberIds.includes(s.id));
  const [selected, setSelected] = React.useState([]);
  const toggle = (id) => setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(460px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 4 }}>Lisää pelaajia</h3>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 16 }}>{group.name}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10, maxHeight: 260, overflowY: 'auto' }}>
          {available.map((s) => (
            <button key={s.id} onClick={() => toggle(s.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 12, border: selected.includes(s.id) ? '2px solid var(--lime)' : '1px solid #d8d4ca', background: selected.includes(s.id) ? 'rgba(207,228,20,0.1)' : '#fff', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%' }}>
              <Avatar initial={s.initial} hue={s.hue} size={30} />
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
  const plan = group.annualPlan;
  const inReview = plan && plan.status !== 'published';

  const pick = async (file) => {
    if (!file) return;
    setBusy(true);
    await toast.run(() => onUploadPlan(group.id, file), 'Vuosisuunnitelma lähetetty. Lisäämme sen järjestelmään ja ilmoitamme, kun se on valmis.');
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
    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 13, background: 'rgba(214,140,44,0.10)', border: '1px solid rgba(214,140,44,0.28)', marginBottom: 12 }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, color: '#8a5a12', background: 'rgba(214,140,44,0.22)', borderRadius: 999, padding: '3px 8px', flexShrink: 0, marginTop: 1 }}>BETA</span>
      <div style={{ fontSize: 12.5, color: '#6b4a12', lineHeight: 1.5 }}>
        Vuosisuunnitelman lataus on vielä beta-vaiheessa. Voit lähettää suunnitelman tästä, mutta se ei mene suoraan käyttöön: tiedosto tulee meille, ja me lisäämme sen järjestelmään sinun ryhmällesi. Saat ilmoituksen, kun se on valmis.
      </div>
    </div>
  );

  if (!plan) {
    return (
      <div>
        {betaNote}
        <label className="btn-outline btn-sm" style={{ cursor: busy ? 'default' : 'pointer', display: 'inline-block', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Lähetetään…' : '+ Lähetä vuosisuunnitelma'}
          <input type="file" accept=".pdf,.csv,.xls,.xlsx" style={{ display: 'none' }} disabled={busy}
            onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }} />
        </label>
        <div style={{ fontSize: 12, color: '#a8a297', marginTop: 8 }}>PDF, CSV tai Excel, enintään 20 Mt.</div>
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
            {inReview ? 'Lähetetty' : 'Lisätty järjestelmään'} {window.koutsiFmtShortDate(plan.date)}{plan.sizeBytes ? ` · ${Math.max(1, Math.round(plan.sizeBytes / 1024))} kt` : ''}
          </div>
        </button>
        <span style={{
          fontSize: 11, fontWeight: 800, letterSpacing: 0.3, borderRadius: 999, padding: '5px 10px', flexShrink: 0,
          background: inReview ? 'rgba(214,140,44,0.16)' : 'rgba(14,59,44,0.10)',
          color: inReview ? '#8a5a12' : 'var(--green-deep)',
        }}>{inReview ? 'Käsittelyssä' : 'Käytössä'}</span>
        <window.KoutsiRowActions onDelete={remove} deleteLabel="Poista vuosisuunnitelma" />
      </div>
      <label className="btn-outline btn-sm" style={{ cursor: busy ? 'default' : 'pointer', display: 'inline-block', marginTop: 10, opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Lähetetään…' : 'Lähetä uusi versio'}
        <input type="file" accept=".pdf,.csv,.xls,.xlsx" style={{ display: 'none' }} disabled={busy}
          onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }} />
      </label>
    </div>
  );
}

function GroupDetail({ group, members, upcoming, onClose, onOpenStudent, onEditTheme, onAddMembers, onUploadPlan, onRemovePlan, onEditGroup, onDeleteGroup, onRemoveMember }) {
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
              <div style={{ fontSize: 14, color: '#514c42', marginTop: 12 }}>Viikoittain: {group.day} klo {group.time}</div>
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
          <Field label={`Jäsenet (${members.length})`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {members.map((m) => (
                <div key={m.id} className="k-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px' }}>
                  <button onClick={() => onOpenStudent(m.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, textAlign: 'left', cursor: 'pointer', background: 'none', border: 'none', padding: 0, fontFamily: 'inherit' }}>
                    <Avatar initial={m.initial} hue={m.hue} size={40} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14.5, color: '#111' }}>{m.name}</div>
                      <div style={{ fontSize: 12.5, color: '#8a857a', marginTop: 2 }}>{m.focus}</div>
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
          const dayTrainings = window.koutsiTrainingsOnDate(state, ds);
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
    const upcoming = state.trainings.filter((t) => t.date >= todayStr).slice().sort((a, b) => a.date.localeCompare(b.date));
    return upcoming[0] ? upcoming[0].date : todayStr;
  });

  const prevMonth = () => { if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); } else setViewMonth((m) => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); } else setViewMonth((m) => m + 1); };

  const trainingsOnSelected = window.koutsiTrainingsOnDate(state, selectedDate);
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
                    <span style={{ fontSize: 13.5, color: '#7a4c1e', fontWeight: 700, flex: 1, minWidth: 0 }}>{e.title}</span>
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
                <div key={t.id} className="k-card" style={{ padding: '16px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                    <div style={{ width: 50, fontSize: 14.5, fontWeight: 800, color: 'var(--green-deep)', flexShrink: 0 }}>{t.time}</div>
                    {party.kind === 'student' && party.student && <Avatar initial={party.student.initial} hue={party.student.hue} size={38} />}
                    {party.kind === 'group' && <AvatarStack members={party.members} size={38} />}
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div style={{ color: '#111', fontWeight: 700, fontSize: 15 }}>{party.kind === 'group' ? (party.group ? party.group.name : 'Ryhmä') : (party.student ? party.student.name : '—')}</div>
                      <div style={{ color: '#8a857a', fontSize: 12.5 }}>{t.type}{party.kind === 'group' ? ` · ${party.members.length} pelaajaa` : ''}{trainingCoach ? ` · ${trainingCoach.name}` : ''}</div>
                    </div>
                    <button onClick={() => onPreSession(t.id)} className="btn-outline btn-sm" style={{ padding: '7px 14px', fontSize: 12.5 }}>Ennen treeniä →</button>
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

function PreSessionPanel({ training, state, onClose, onToggleAbsence }) {
  const party = window.koutsiTrainingParty(state, training);
  const members = party.kind === 'group' ? party.members : (party.student ? [party.student] : []);
  const suggestions = state.exercises.slice(0, 3);
  const trainingCoach = window.koutsiCoachById(state, training.coachId);
  const absences = training.absences || [];
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(560px, 100%)', maxHeight: '86vh', overflowY: 'auto', padding: '28px 28px 26px', animation: 'kFadeIn .2s ease' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Seuraavaksi</div>
        <h3 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>{window.koutsiFmtShortDate(training.date)} · {training.time}</h3>
        <div style={{ fontSize: 14, color: '#8a857a', fontWeight: 600, marginBottom: 20 }}>
          {party.kind === 'group' && party.group ? party.group.name : ''}{party.kind === 'group' && party.group && trainingCoach ? ' · ' : ''}{trainingCoach ? trainingCoach.name : ''}
        </div>
        <Field label="Pelaajat">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {members.map((m) => {
              const entry = absences.find((a) => a.studentId === m.id);
              const statusLabel = entry ? window.KOUTSI_ABSENCE_REASON_LABELS[entry.reason] : 'Paikalla';
              const statusColor = entry ? (entry.reason === 'vamma' ? '#c23b28' : '#8a857a') : 'var(--green-deep)';
              return (
                <div key={m.id} className="k-card" style={{ display: 'flex', gap: 13, alignItems: 'flex-start', padding: '13px 15px', opacity: entry ? 0.7 : 1 }}>
                  <Avatar initial={m.initial} hue={m.hue} size={40} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#111' }}>{m.name}</div>
                    <div style={{ fontSize: 13, color: '#514c42', marginTop: 3, lineHeight: 1.4 }}>Jatka: {m.focus}</div>
                    <div style={{ fontSize: 12.5, color: '#8a857a', marginTop: 1, lineHeight: 1.4 }}>Huomioi: {m.lastSession}</div>
                    {m.playerWish && <div style={{ fontSize: 12.5, color: '#5c6b06', marginTop: 1, lineHeight: 1.4, fontWeight: 600 }}>Toivoo: {m.playerWish}</div>}
                  </div>
                  <button onClick={() => onToggleAbsence(m.id)} style={{ flexShrink: 0, padding: '6px 12px', borderRadius: 999, border: `1px solid ${entry ? statusColor : 'var(--line)'}`, background: entry ? `${statusColor}18` : '#fff', color: statusColor, fontWeight: 700, fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>{statusLabel}</button>
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
// season in one sitting instead of adding ~40 rows by hand; when editing an occurrence
// that belongs to a series, the save button asks which of the two they meant.
function TrainingModal({ students, groups, defaultDate, editing, onClose, onSave, onSaveSeries }) {
  const isEdit = Boolean(editing);
  const [targetType, setTargetType] = React.useState(() => (editing && editing.groupId != null ? 'group' : 'student'));
  const [studentId, setStudentId] = React.useState(() => (editing ? editing.studentId : (students[0] ? students[0].id : null)));
  const [groupId, setGroupId] = React.useState(() => (editing ? editing.groupId : (groups[0] ? groups[0].id : null)));
  const [date, setDate] = React.useState(() => (editing ? editing.date : (defaultDate || window.koutsiTodayStr())));
  const [time, setTime] = React.useState(() => (editing ? editing.time : ''));
  const [type, setType] = React.useState(() => (editing ? editing.type : 'Yksityistunti'));
  const [repeat, setRepeat] = React.useState(false);
  const [repeatUntil, setRepeatUntil] = React.useState('');

  // only track the target for a brand-new session; changing it while editing would move
  // the session to a different player, which is what delete + re-add is for
  React.useEffect(() => { if (!isEdit) setType(targetType === 'group' ? 'Ryhmätreeni' : 'Yksityistunti'); }, [targetType, isEdit]);

  // a sensible default end: the end of the current season, roughly 12 weeks out
  React.useEffect(() => {
    if (repeat && !repeatUntil) setRepeatUntil(window.koutsiAddDays(date, 7 * 11));
  }, [repeat, repeatUntil, date]);

  const occurrences = (repeat && repeatUntil > date) ? window.koutsiWeeklyDates(date, repeatUntil).length : 1;
  const ready = (targetType === 'student' ? studentId != null : groupId != null) && date && time.trim()
    && (!repeat || (repeatUntil > date));
  const inputStyle = { flex: 1, boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };
  const Pill = ({ on, children, onClick }) => (
    <button onClick={onClick} style={{ padding: '9px 15px', borderRadius: 999, border: on ? 'none' : '1px solid #d8d4ca', background: on ? 'var(--lime)' : '#fff', color: on ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>{children}</button>
  );

  const save = () => {
    if (!ready) return;
    onSave({
      studentId: targetType === 'student' ? studentId : null,
      groupId: targetType === 'group' ? groupId : null,
      date, time: time.trim(), type,
      repeatUntil: repeat && repeatUntil > date ? repeatUntil : null,
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
            <div style={{ display: 'flex', gap: 12, overflowX: 'auto', marginBottom: 18, paddingBottom: 2 }}>
              {students.map((s) => (
                <button key={s.id} onClick={() => setStudentId(s.id)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                  <span style={{ borderRadius: '50%', padding: 2, border: studentId === s.id ? '2px solid var(--lime)' : '2px solid transparent' }}>
                    <Avatar initial={s.initial} hue={s.hue} size={46} />
                  </span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: studentId === s.id ? '#111' : '#8a857a' }}>{s.name.split(' ')[0]}</span>
                </button>
              ))}
              {students.length === 0 && <div style={{ color: '#8a857a', fontSize: 14 }}>Ei vielä oppilaita — kutsu ensin pelaaja.</div>}
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
              {groups.length === 0 && <div style={{ color: '#8a857a', fontSize: 14 }}>Ei vielä ryhmiä.</div>}
            </div>
          </React.Fragment>
        ))}

        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Ajankohta</div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ ...inputStyle, flex: 0.7 }} />
        </div>

        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Tyyppi</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {['Yksityistunti', 'Ryhmätreeni', 'Ottelu'].map((t) => <Pill key={t} on={type === t} onClick={() => setType(t)}>{t}</Pill>)}
        </div>

        {!isEdit && (
          <div style={{ marginBottom: 20 }}>
            <button onClick={() => setRepeat((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', textAlign: 'left' }}>
              <span style={{ width: 19, height: 19, borderRadius: 6, border: '1.5px solid ' + (repeat ? 'var(--green-deep)' : '#c5c0b5'), background: repeat ? 'var(--green-deep)' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {repeat && <svg width="11" height="9" viewBox="0 0 10 8"><path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </span>
              <span style={{ fontSize: 14.5, fontWeight: 600, color: '#111' }}>Toistuu viikoittain</span>
            </button>
            {repeat && (
              <div style={{ marginTop: 12, paddingLeft: 30 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Viimeinen kerta</div>
                <input type="date" value={repeatUntil} min={date} onChange={(e) => setRepeatUntil(e.target.value)} style={{ ...inputStyle, width: '100%', flex: 'none' }} />
                <div style={{ fontSize: 12.5, color: repeatUntil && repeatUntil <= date ? '#a13b2f' : '#8a857a', marginTop: 8 }}>
                  {repeatUntil && repeatUntil <= date
                    ? 'Viimeisen kerran pitää olla ensimmäisen jälkeen.'
                    : `Luodaan ${occurrences} treeniä, sama viikonpäivä ja kello.`}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={save} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: ready ? 1 : 0.45, cursor: ready ? 'pointer' : 'default' }}>
            {isEdit ? 'Tallenna' : (occurrences > 1 ? `Lisää ${occurrences} treeniä` : 'Lisää')}
          </button>
        </div>
        {isEdit && editing.seriesId && (
          <button onClick={() => onSaveSeries({ time: time.trim(), type })} className="btn-outline btn-sm" style={{ width: '100%', marginTop: 10 }}>
            Tallenna kellonaika ja tyyppi koko sarjaan
          </button>
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
            <div style={{ color: '#111', fontWeight: 700, fontSize: 16 }}>{ex.name}</div>
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

function ExerciseDetail({ exercise, onClose, onEdit, onDelete }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(480px, 100%)', padding: '28px 28px 26px', animation: 'kFadeIn .2s ease' }}>
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
        <button onClick={onClose} className="btn-outline" style={{ width: '100%', padding: '13px 0' }}>Sulje</button>
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
              : <Avatar initial={coach.initial} hue={coach.hue} size={84} />}
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
        <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Esim. Juniorivalmentaja, Lahti" style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={label}>Kuvaus</div>
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} placeholder="Millainen valmentaja olet?" style={{ ...inputStyle, resize: 'none', marginBottom: 16 }} />
        <div style={label}>Kokemus</div>
        <textarea value={experience} onChange={(e) => setExperience(e.target.value)} rows={2} placeholder="Esim. 8 vuotta juniorivalmennusta, tason 2 valmentajakoulutus" style={{ ...inputStyle, resize: 'none', marginBottom: 16 }} />
        <div style={label}>Erikoisalat</div>
        <input value={specialtyText} onChange={(e) => setSpecialtyText(e.target.value)} placeholder="Syöttö, verkkopeli, juniorit" style={{ ...inputStyle, marginBottom: 6 }} />
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

function ProfileView({ coach, studentCount, groupCount, onSignOut, onReload }) {
  const [editOpen, setEditOpen] = React.useState(false);
  const specialties = coach.specialties || [];
  return (
    <div>
      <PageHeader title="Profiili" action={<button onClick={() => setEditOpen(true)} className="btn-dark btn-sm">Muokkaa profiilia</button>} />
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
        <div className="k-card" style={{ padding: 26, flex: '0 0 260px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
          <Avatar initial={coach.initial} hue={coach.hue} size={84} ring />
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
        </div>
      </div>
      {editOpen && <ProfileEditModal coach={coach} onClose={() => setEditOpen(false)} onSaved={onReload} />}
    </div>
  );
}

// ── Käyttöönotto ─────────────────────────────────────────
// Shown until the coach has done the three things that make the app useful. Replaces the
// old "Ei vielä oppilaita" dead end, which gave a brand-new coach nothing to act on.
function GettingStarted({ studentCount, groupCount, trainingCount, onInvite, onCreateGroup, onAddTraining }) {
  const steps = [
    { done: groupCount > 0, title: 'Luo ensimmäinen ryhmä', body: 'Esim. "Tiistain iltaryhmä". Yksityisoppilaille ryhmää ei tarvita.', action: 'Luo ryhmä', onClick: onCreateGroup },
    { done: studentCount > 0, title: 'Kutsu oppilaat mukaan', body: 'Saat linkin ja QR-koodin — lähetä se WhatsAppissa tai näytä kentällä.', action: 'Kutsu oppilas', onClick: onInvite },
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
    </div>
  );
}


// ── Sidebar ──────────────────────────────────────────────
const NAV = [
  { id: 'students', label: 'Oppilaat' },
  { id: 'groups', label: 'Ryhmät' },
  { id: 'trainings', label: 'Treenit' },
  { id: 'exercises', label: 'Harjoitteet' },
  { id: 'profile', label: 'Profiili' },
];
function NavIcon({ id, on, offColor = 'rgba(255,255,255,0.72)' }) {
  const c = on ? '#101a08' : offColor;
  if (id === 'students') return <svg width="19" height="19" viewBox="0 0 22 22" fill="none"><circle cx="8" cy="6.5" r="3" stroke={c} strokeWidth="1.7" /><path d="M2 19c0-3.2 2.7-5.3 6-5.3s6 2.1 6 5.3" stroke={c} strokeWidth="1.7" strokeLinecap="round" /><circle cx="16" cy="7.5" r="2.4" stroke={c} strokeWidth="1.7" /><path d="M13.8 19c.3-2.6 2.1-4.3 4.2-4.3S21.7 16.4 22 19" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>;
  if (id === 'groups') return <svg width="19" height="19" viewBox="0 0 22 22" fill="none"><circle cx="7" cy="7.5" r="3" stroke={c} strokeWidth="1.7" /><circle cx="15" cy="7.5" r="3" stroke={c} strokeWidth="1.7" /><path d="M1.5 19c0-3.1 2.5-5 5.5-5s5.5 1.9 5.5 5M9.5 19c0-3.1 2.5-5 5.5-5s5.5 1.9 5.5 5" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>;
  if (id === 'trainings') return <svg width="19" height="19" viewBox="0 0 22 22" fill="none"><rect x="2.5" y="4.5" width="17" height="15" rx="3" stroke={c} strokeWidth="1.7" /><path d="M2.5 9h17M7 2.5v4M15 2.5v4" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>;
  if (id === 'exercises') return <svg width="19" height="19" viewBox="0 0 22 22" fill="none"><rect x="4" y="3" width="14" height="17" rx="2.5" stroke={c} strokeWidth="1.7" /><path d="M8 1.5h6a1 1 0 011 1V4H7V2.5a1 1 0 011-1z" stroke={c} strokeWidth="1.7" /><path d="M7.5 9.5h7M7.5 13h7M7.5 16.5h4" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>;
  return <svg width="19" height="19" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="7.5" r="4" stroke={c} strokeWidth="1.7" /><path d="M3 20c0-4.4 3.6-7 8-7s8 2.6 8 7" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>;
}

function Sidebar({ tab, setTab, coach, onSignOut }) {
  return (
    <div style={{ width: 248, flexShrink: 0, background: 'var(--green-deep)', color: '#fff', display: 'flex', flexDirection: 'column', padding: '26px 18px', position: 'fixed', top: 0, left: 0, bottom: 0, overflowY: 'auto' }}>
      <a href="/" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7, textDecoration: 'none', paddingLeft: 6 }}>
        <span style={{ fontWeight: 800, fontSize: 20, color: 'var(--lime)', letterSpacing: -0.5 }}>Krossi</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>Koutsi</span>
      </a>
      <span style={{ display: 'inline-flex', alignSelf: 'flex-start', marginLeft: 6, marginTop: 8, marginBottom: 22, padding: '4px 11px', borderRadius: 999, background: 'rgba(207,228,20,0.16)', border: '1px solid rgba(207,228,20,0.4)', color: 'var(--lime)', fontSize: 11, fontWeight: 800, letterSpacing: 0.5 }}>VALMENTAJA</span>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 'auto' }}>
        {NAV.map((n) => {
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
          <Avatar initial={coach.initial} hue={coach.hue} size={34} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{coach.name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Valmentaja</div>
          </div>
          <window.KoutsiNotificationBell userId={coach.id} dark />
        </div>
        <button onClick={onSignOut} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)', fontSize: 12, cursor: 'pointer', textAlign: 'left', padding: '4px 6px', fontFamily: 'inherit' }}>Kirjaudu ulos</button>
      </div>
    </div>
  );
}

function MobileTopBar({ coach }) {
  return (
    <div className="kv-mobile-topbar" style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 60, zIndex: 45, alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: 'rgba(247,245,239,0.9)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <a href="/" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, textDecoration: 'none' }}>
          <span style={{ fontWeight: 800, fontSize: 18, color: 'var(--green-deep)', letterSpacing: -0.4 }}>Krossi</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#8a857a' }}>Koutsi</span>
        </a>
        <span style={{ padding: '3px 9px', borderRadius: 999, background: 'rgba(14,59,44,0.1)', border: '1px solid rgba(14,59,44,0.22)', color: 'var(--green-deep)', fontSize: 10, fontWeight: 800, letterSpacing: 0.4 }}>VALMENTAJA</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <window.KoutsiNotificationBell userId={coach.id} />
        <Avatar initial={coach.initial} hue={coach.hue} size={30} />
      </div>
    </div>
  );
}

function MobileBottomNav({ tab, setTab }) {
  return (
    <div className="kv-mobile-bottomnav" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: 68, zIndex: 45, background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderTop: '1px solid var(--line)', boxShadow: '0 -8px 24px -18px rgba(0,0,0,0.2)' }}>
      {NAV.map((n) => {
        const on = tab === n.id;
        const fs = n.label.length > 8 ? 9.5 : 10.5;
        return (
          <button key={n.id} onClick={() => setTab(n.id)} style={{ flex: 1, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, fontFamily: 'inherit' }}>
            <NavIcon id={n.id} on={on} offColor="#9a958a" />
            <span style={{ fontSize: fs, fontWeight: on ? 700 : 500, color: on ? 'var(--green-deep)' : '#9a958a' }}>{n.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function CoachApp({ coachId, onSignOut }) {
  const toast = window.useKoutsiToast();
  const confirm = window.useKoutsiConfirm();
  const [state, setState] = React.useState(null);
  const [tab, setTab] = React.useState('students');
  const [detailId, setDetailId] = React.useState(null);
  const [groupDetailId, setGroupDetailId] = React.useState(null);
  const [entryOpen, setEntryOpen] = React.useState(false);
  const [editingEntry, setEditingEntry] = React.useState(null);
  const [trainingOpen, setTrainingOpen] = React.useState(false);
  const [trainingDefaultDate, setTrainingDefaultDate] = React.useState(null);
  const [editingTraining, setEditingTraining] = React.useState(null);
  const [exerciseId, setExerciseId] = React.useState(null);
  const [exerciseFormOpen, setExerciseFormOpen] = React.useState(false);
  const [editingExercise, setEditingExercise] = React.useState(null);
  const [videoOpen, setVideoOpen] = React.useState(false);
  const [presessionTrainingId, setPresessionTrainingId] = React.useState(null);
  const [themeModalGroupId, setThemeModalGroupId] = React.useState(null);
  const [groupFormOpen, setGroupFormOpen] = React.useState(false);
  const [editingGroup, setEditingGroup] = React.useState(null);
  const [addMembersGroupId, setAddMembersGroupId] = React.useState(null);
  const [backgroundOpen, setBackgroundOpen] = React.useState(false);
  const [eventOpen, setEventOpen] = React.useState(false);
  const [editingEvent, setEditingEvent] = React.useState(null);
  const [eventDefaultDate, setEventDefaultDate] = React.useState(null);

  const [loadError, setLoadError] = React.useState(false);
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
  const detailUpcoming = detail ? window.koutsiUpcomingTrainingsForStudent(state, detail.id) : [];
  const detailAttendance = detail ? window.koutsiAttendanceSummary(state, detail.id) : null;

  const groupDetail = groupDetailId != null ? state.groups.find((g) => g.id === groupDetailId) : null;
  const groupMembers = groupDetail ? groupDetail.memberIds.map((id) => state.students.find((s) => s.id === id)).filter(Boolean) : [];
  const groupUpcoming = groupDetail ? window.koutsiTrainingsForGroup(state, groupDetail.id).filter((t) => t.date >= window.koutsiTodayStr()) : [];

  const exercise = exerciseId != null ? state.exercises.find((e) => e.id === exerciseId) : null;
  const presessionTraining = presessionTrainingId != null ? state.trainings.find((t) => t.id === presessionTrainingId) : null;

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
  const addHomework = act((text) => window.koutsiAddHomework(detailId, text), 'Kotiläksy lisätty.');
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
    }, editingTraining ? 'Treeni päivitetty.' : (repeatUntil ? 'Treenisarja luotu.' : 'Treeni lisätty.'));
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
  const addVideo = async ({ title, date, tags, studentIds, file, externalUrl }) => {
    await window.koutsiShareVideo({ title, date, tags, studentIds, addedById: coachId, file, externalUrl });
    await reload();
    setVideoOpen(false);
    toast.success('Video jaettu.');
  };
  const deleteVideo = async (v) => {
    const ok = await confirm({ title: 'Poista video?', body: `${v.title} poistetaan pelaajan näkymästä.`, confirmLabel: 'Poista', danger: true });
    if (ok) await act(() => window.koutsiDeleteVideo(v.id, v.storagePath), 'Video poistettu.')();
  };

  const cycleAbsence = act(async (trainingId, studentId) => {
    const training = state.trainings.find((t) => t.id === trainingId);
    const currentReason = (training?.absences || []).find((a) => a.studentId === studentId)?.reason;
    await window.koutsiCycleAbsence(trainingId, studentId, currentReason);
  });

  const saveBackground = async (text) => {
    const ok = await act(() => window.koutsiSaveBackground(detailId, text), 'Taustatiedot tallennettu.')();
    setBackgroundOpen(false);
    return ok;
  };
  const setLevel = act((level) => window.koutsiSetStudentLevel(detailId, level));
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
  const deleteExercise = async (ex) => {
    const ok = await confirm({ title: 'Poista harjoite?', body: ex.name, confirmLabel: 'Poista', danger: true });
    if (!ok) return;
    const done = await toast.run(async () => { await window.koutsiDeleteExercise(ex.id); await reload(); }, 'Harjoite poistettu.');
    if (done) setExerciseId(null);
  };
  const restoreStarters = async () => {
    await toast.run(async () => {
      const added = await window.koutsiSeedExercises();
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
  const saveGroup = async ({ name, level, day, time, memberIds }) => {
    const ok = await toast.run(async () => {
      if (editingGroup) await window.koutsiUpdateGroup(editingGroup.id, { name, level, day, time });
      else await window.koutsiCreateGroup({ coachId, name, level, day, time, memberIds });
      await reload();
    }, editingGroup ? 'Ryhmä päivitetty.' : 'Ryhmä luotu.');
    if (ok) { setGroupFormOpen(false); setEditingGroup(null); }
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

  const uploadAnnualPlan = async (groupId, file) => { await window.koutsiUploadAnnualPlan(groupId, file); await reload(); };
  const removeAnnualPlan = async (groupId, storagePath) => { await window.koutsiRemoveAnnualPlan(groupId, storagePath); await reload(); };

  const openStudentFromGroup = (id) => { setGroupDetailId(null); setDetailId(id); };
  const openGroupFromStudent = () => { if (detailGroup) { setDetailId(null); setGroupDetailId(detailGroup.id); } };
  const saveClubEvent = async ({ title, date, kind }) => {
    const ok = await toast.run(async () => {
      if (editingEvent) await window.koutsiUpdateClubEvent(editingEvent.id, { title, date, kind });
      else await window.koutsiAddClubEvent({ coachId, title, date, kind });
      await reload();
    }, editingEvent ? 'Tapahtuma päivitetty.' : 'Tapahtuma lisätty.');
    if (ok) { setEventOpen(false); setEditingEvent(null); }
  };
  const deleteClubEvent = async (e) => {
    const ok = await confirm({ title: 'Poista tapahtuma?', body: `${e.title} — ${window.koutsiFmtShortDate(e.date)}`, confirmLabel: 'Poista', danger: true });
    if (ok) await act(() => window.koutsiDeleteClubEvent(e.id), 'Tapahtuma poistettu.')();
  };

  const openNewTraining = (d) => { setEditingTraining(null); setTrainingDefaultDate(d || window.koutsiTodayStr()); setTrainingOpen(true); };
  const openEditTraining = (t) => { setEditingTraining(t); setTrainingOpen(true); };

  return (
    <div style={{ minHeight: '100vh' }}>
      <div className="kv-sidebar-wrap">
        <Sidebar tab={tab} setTab={setTab} coach={state.coach} onSignOut={onSignOut} />
      </div>
      <MobileTopBar coach={state.coach} />
      <div className="kv-main">
        <div key={tab} className="k-rise-in">
          {tab === 'students' && (
            <StudentsView
              students={state.students} coachId={coachId} coachName={state.coach.name} onOpen={setDetailId}
              groupCount={state.groups.length} trainingCount={state.trainings.length}
              onCreateGroup={() => { setEditingGroup(null); setTab('groups'); setGroupFormOpen(true); }}
              onAddTraining={() => { setTab('trainings'); openNewTraining(null); }} />
          )}
          {tab === 'groups' && <GroupsView groups={state.groups} students={state.students} onOpen={setGroupDetailId} onCreate={() => { setEditingGroup(null); setGroupFormOpen(true); }} />}
          {tab === 'trainings' && (
            <CalendarView
              state={state} onAdd={openNewTraining} onPreSession={setPresessionTrainingId}
              onEditTraining={openEditTraining} onDeleteTraining={deleteTraining}
              onAddEvent={(d) => { setEditingEvent(null); setEventDefaultDate(d); setEventOpen(true); }}
              onEditEvent={(e) => { setEditingEvent(e); setEventOpen(true); }}
              onDeleteEvent={deleteClubEvent} />
          )}
          {tab === 'exercises' && <ExercisesView exercises={state.exercises} onOpen={setExerciseId} onAdd={() => { setEditingExercise(null); setExerciseFormOpen(true); }} onRestoreStarters={restoreStarters} />}
          {tab === 'profile' && <ProfileView coach={state.coach} studentCount={state.students.length} groupCount={state.groups.length} onSignOut={onSignOut} onReload={reload} />}
        </div>
      </div>
      <MobileBottomNav tab={tab} setTab={setTab} />

      {detail && (
        <StudentDetail
          student={detail} group={detailGroup} groupCoach={detailGroupCoach} upcoming={detailUpcoming} attendance={detailAttendance}
          onClose={() => setDetailId(null)} onAddEntry={() => { setEditingEntry(null); setEntryOpen(true); }}
          onToggleHomework={toggleHomework} onOpenGroup={openGroupFromStudent} onAddHomework={addHomework}
          onAddVideo={() => setVideoOpen(true)} onEditBackground={() => setBackgroundOpen(true)} onSetLevel={setLevel}
          onEditEntry={(d) => { setEditingEntry(d); setEntryOpen(true); }} onDeleteEntry={deleteEntry}
          onEditHomework={editHomework} onDeleteHomework={deleteHomework}
          onDeleteVideo={deleteVideo} onEndCoaching={endCoaching} />
      )}
      {detail && entryOpen && <EntryModal student={detail} entry={editingEntry} onClose={() => { setEntryOpen(false); setEditingEntry(null); }} onSend={saveEntry} />}
      {detail && videoOpen && <VideoModal students={state.students} initialStudentId={detailId} onClose={() => setVideoOpen(false)} onSave={addVideo} />}
      {detail && backgroundOpen && <BackgroundModal student={detail} onClose={() => setBackgroundOpen(false)} onSave={saveBackground} />}
      {groupDetail && (
        <GroupDetail
          group={groupDetail} members={groupMembers} upcoming={groupUpcoming}
          onClose={() => setGroupDetailId(null)} onOpenStudent={openStudentFromGroup}
          onEditTheme={() => setThemeModalGroupId(groupDetail.id)} onAddMembers={() => setAddMembersGroupId(groupDetail.id)}
          onUploadPlan={uploadAnnualPlan} onRemovePlan={removeAnnualPlan}
          onEditGroup={() => { setEditingGroup(groupDetail); setGroupFormOpen(true); }}
          onDeleteGroup={deleteGroup} onRemoveMember={removeMember} />
      )}
      {trainingOpen && (
        <TrainingModal
          students={state.students} groups={state.groups} defaultDate={trainingDefaultDate} editing={editingTraining}
          onClose={() => { setTrainingOpen(false); setEditingTraining(null); }}
          onSave={saveTraining} onSaveSeries={saveTrainingSeries} />
      )}
      {exercise && (
        <ExerciseDetail
          exercise={exercise} onClose={() => setExerciseId(null)}
          onEdit={() => { setEditingExercise(exercise); setExerciseFormOpen(true); setExerciseId(null); }}
          onDelete={() => deleteExercise(exercise)} />
      )}
      {exerciseFormOpen && <ExerciseFormModal editing={editingExercise} onClose={() => { setExerciseFormOpen(false); setEditingExercise(null); }} onSave={saveExercise} />}
      {presessionTraining && <PreSessionPanel training={presessionTraining} state={state} onClose={() => setPresessionTrainingId(null)} onToggleAbsence={(studentId) => cycleAbsence(presessionTraining.id, studentId)} />}
      {themeModalGroupId != null && (() => {
        const themeGroup = state.groups.find((g) => g.id === themeModalGroupId);
        return themeGroup ? <WeeklyThemesModal group={themeGroup} onClose={() => setThemeModalGroupId(null)} onSave={saveThemes} /> : null;
      })()}
      {groupFormOpen && <GroupFormModal students={state.students} editing={editingGroup} onClose={() => { setGroupFormOpen(false); setEditingGroup(null); }} onSave={saveGroup} />}
      {eventOpen && <ClubEventModal editing={editingEvent} defaultDate={eventDefaultDate} onClose={() => { setEventOpen(false); setEditingEvent(null); }} onSave={saveClubEvent} />}
      {addMembersGroupId != null && <AddMembersModal coachId={coachId} coachName={state.coach.name} group={state.groups.find((g) => g.id === addMembersGroupId)} allStudents={state.students} onClose={() => setAddMembersGroupId(null)} onSave={addMembers} />}
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
        <div style={{ marginTop: 16, fontSize: 13, color: '#8a857a', lineHeight: 1.5 }}>
          Oletko sittenkin pelaaja?{' '}
          <a href="https://koutsi.krossi.app/pelaaja" style={{ color: 'var(--green-deep)', fontWeight: 700 }}>Siirry pelaajan puolelle</a> — sinne pääsee valmentajan liittymiskoodilla tai ilman.
        </div>
      </div>
    </div>
  );
}
function KoutsiValmentajaRoot() {
  const auth = window.useKoutsiAuth();
  const [coachRow, setCoachRow] = React.useState(undefined); // undefined = checking, null = not a coach

  const [checkFailed, setCheckFailed] = React.useState(false);

  const checkCoachRow = React.useCallback(() => {
    if (!auth.session) return Promise.resolve();
    setCheckFailed(false);
    return window.koutsiFetchCoachRow(auth.session.user.id)
      .then((row) => setCoachRow(row))
      .catch(() => setCheckFailed(true)); // katkennut yhteys ei saa jättää rautalankaan pyörimään
  }, [auth.session]);

  React.useEffect(() => {
    if (!auth.session || auth.needsOnboarding) { setCoachRow(undefined); return; }
    let cancelled = false;
    setCheckFailed(false);
    window.koutsiFetchCoachRow(auth.session.user.id)
      .then((row) => { if (!cancelled) setCoachRow(row); })
      .catch(() => { if (!cancelled) setCheckFailed(true); });
    return () => { cancelled = true; };
  }, [auth.session, auth.needsOnboarding]);

  if (auth.loading) return <window.KoutsiAuthLoadingScreen />;
  // a recovery link must lead to a new password, not straight into the app
  if (auth.recoveryMode && auth.session) return <window.KoutsiPasswordResetScreen />;
  if (!auth.session) return <window.KoutsiAuthScreen />;
  if (auth.profileError) return <window.KoutsiErrorScreen message="Profiilitietojasi ei saatu haettua. Tarkista verkkoyhteys ja yritä uudelleen." onRetry={auth.retryProfile} onSignOut={auth.signOut} />;
  if (auth.needsOnboarding) return <window.KoutsiProfileOnboarding />;
  if (checkFailed) return <window.KoutsiErrorScreen onRetry={checkCoachRow} onSignOut={auth.signOut} />;
  if (coachRow === undefined) return <window.KoutsiAuthLoadingScreen />;
  if (!coachRow) return <CoachKeyGate onSignOut={auth.signOut} onRedeemed={checkCoachRow} />;
  return <CoachApp coachId={auth.session.user.id} onSignOut={auth.signOut} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <window.KoutsiUIProvider>
    <window.KoutsiAuthProvider><KoutsiValmentajaRoot /></window.KoutsiAuthProvider>
  </window.KoutsiUIProvider>
);
