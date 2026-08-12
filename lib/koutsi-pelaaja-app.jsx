// koutsi-pelaaja-app.jsx — full-page player web app for koutsi.krossi.app/pelaaja.
// Reads/writes the same shared demo store as the coach view (koutsi-data.js), so
// whatever the coach adds — a diary entry, a new training — shows up here.

const TAG_LABELS = { kaikki: 'Kaikki', syotto: 'Syöttö', liikkuminen: 'Liikkuminen', pistepeli: 'Pistepeli', verkkopeli: 'Verkkopeli', tekniikka: 'Tekniikka' };
const EXERCISE_TAGS = ['kaikki', 'syotto', 'liikkuminen', 'pistepeli', 'verkkopeli', 'tekniikka'];

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

function Bar({ label, value }) {
  return (
    <div style={{ marginBottom: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: '#111' }}>{label}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#8a857a' }}>{value}%</span>
      </div>
      <div style={{ height: 8, borderRadius: 99, background: '#efece4', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${value}%`, borderRadius: 99, background: 'var(--lime)' }} />
      </div>
    </div>
  );
}

function VideoRow({ videos }) {
  if (!videos.length) return <div style={{ color: '#8a857a', fontSize: 14.5 }}>Ei vielä videoita.</div>;
  return (
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 2 }}>
      {videos.map((v, i) => (
        <div key={i} style={{ width: 160, flexShrink: 0 }}>
          <div style={{ width: '100%', aspectRatio: '4/3', borderRadius: 16, position: 'relative', overflow: 'hidden', background: `radial-gradient(120% 120% at 30% 20%, hsl(${v.hue} 55% 45%), hsl(${v.hue + 24} 60% 22%))` }}>
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="16" viewBox="0 0 12 14"><path d="M1 1v12l10-6L1 1z" fill="#101a08" /></svg>
              </span>
            </span>
            <span style={{ position: 'absolute', right: 7, bottom: 7, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 6 }}>{v.dur}</span>
          </div>
          <div style={{ color: '#111', fontSize: 13, fontWeight: 600, marginTop: 7, lineHeight: 1.35 }}>{v.title}</div>
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ children }) {
  return <div style={{ fontWeight: 800, fontSize: 12.5, color: 'var(--green-deep)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 }}>{children}</div>;
}
function PageHeader({ title, sub }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.5, color: 'var(--green-deep)' }}>{title}</h1>
      {sub && <p style={{ fontSize: 14.5, color: '#8a857a', marginTop: 4 }}>{sub}</p>}
    </div>
  );
}
function LevelChip({ level }) {
  const c = window.koutsiLevelColor(level);
  return <span style={{ display: 'inline-flex', alignItems: 'center', padding: '5px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, lineHeight: 1, background: c.bg, color: c.fg, border: `1px solid ${c.border}` }}>{level}</span>;
}
function IdentityBlock({ student, group }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 26, textAlign: 'center' }}>
      <Avatar initial={student.initial} hue={student.hue} size={76} ring />
      <div style={{ fontSize: 24, fontWeight: 800, color: '#111' }}>{student.name}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <LevelChip level={student.level} />
        {group && <span className="k-chip">Ryhmä: {group.name} · {group.day} {group.time}</span>}
      </div>
      <p style={{ fontSize: 15, color: '#514c42', lineHeight: 1.55, maxWidth: 480, marginTop: 4 }}>
        <b style={{ color: 'var(--green-deep)' }}>Tavoitteeni:</b> {student.goal}
      </p>
    </div>
  );
}

function TopBar({ students, activeId, onSwitch }) {
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(247,245,239,0.88)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderBottom: '1px solid var(--line)' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <a href="/" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7, textDecoration: 'none', marginRight: 'auto' }}>
          <span style={{ fontWeight: 800, fontSize: 19, color: 'var(--green-deep)', letterSpacing: -0.5 }}>Krossi</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#8a857a' }}>Koutsi</span>
        </a>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#514c42' }}>
          Pelaajana:
          <select value={activeId} onChange={(e) => onSwitch(Number(e.target.value))} style={{ border: '1px solid var(--line)', borderRadius: 999, padding: '7px 12px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: '#111', background: '#fff' }}>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}

// ── Koti ─────────────────────────────────────────────────
function HomeView({ student, group, wish, setWish, wishSaved, onSaveWish }) {
  const latestEntry = student.diary[0];
  return (
    <div>
      <IdentityBlock student={student} group={group} />

      {group && group.theme && (
        <div className="k-card" style={{ padding: '20px 24px', background: 'linear-gradient(135deg, rgba(207,228,20,0.16), rgba(14,59,44,0.05))', borderColor: 'rgba(14,59,44,0.14)', marginBottom: 22 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--green-deep)', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 6 }}>Viikon teema — {group.name}</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#111', marginBottom: 5 }}>{group.theme.title}</div>
          <div style={{ fontSize: 14, color: '#514c42', lineHeight: 1.55 }}>{group.theme.lead}</div>
        </div>
      )}

      {latestEntry && (
        <div style={{ marginBottom: 26 }}>
          <SectionTitle>Viimeisin palaute valmentajalta</SectionTitle>
          <div className="k-card" style={{ padding: '18px 20px', borderColor: 'var(--green-deep)', borderWidth: 1.5 }}>
            <p style={{ fontSize: 15.5, color: '#111', lineHeight: 1.6 }}>{latestEntry.text}</p>
            <div style={{ marginTop: 8, fontSize: 12.5, color: '#8a857a', fontWeight: 600 }}>{latestEntry.date}</div>
          </div>
        </div>
      )}

      <div>
        <SectionTitle>Toiveeni seuraavalle kerralle</SectionTitle>
        <textarea value={wish} onChange={(e) => setWish(e.target.value)} placeholder="Mitä haluaisit harjoitella seuraavassa treenissä?" rows={2}
          style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 14, padding: '13px 14px', fontSize: 14, fontFamily: 'inherit', color: '#111', resize: 'none', background: '#fff', marginBottom: 10 }} />
        <button onClick={onSaveWish} className="btn-dark btn-sm">{wishSaved ? 'Tallennettu ✓' : 'Lähetä toive valmentajalle'}</button>
      </div>
    </div>
  );
}

// ── Treenit ──────────────────────────────────────────────
function TrainingsView({ student, group, upcoming, note, setNote, noteSaved, onSaveNote, onToggleHomework }) {
  return (
    <div>
      <PageHeader title="Treenit" sub="Tulevat valmennukset ja omatoimiset tehtävät" />

      {upcoming.length > 0 ? (
        <div style={{ marginBottom: 26 }}>
          <SectionTitle>Tulevat valmennukset</SectionTitle>
          <div className="k-card" style={{ padding: 0, overflow: 'hidden' }}>
            {upcoming.map((t, i) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderBottom: i === upcoming.length - 1 ? 'none' : '1px solid var(--line)' }}>
                <div style={{ width: 90, fontSize: 13.5, fontWeight: 800, color: 'var(--green-deep)' }}>{window.koutsiFmtShortDate(t.date)}</div>
                <div style={{ flex: 1, fontSize: 14.5, color: '#111' }}>{t.type}{t.groupId != null && group ? ` — ${group.name}` : ''}</div>
                <div style={{ fontSize: 13.5, color: '#8a857a', fontWeight: 600 }}>{t.time}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="k-card" style={{ padding: 22, color: '#8a857a', fontSize: 14.5, marginBottom: 26 }}>Ei tulevia valmennuksia.</div>
      )}

      {student.homework.length > 0 && (
        <div>
          <SectionTitle>Omatoimiset tehtävät</SectionTitle>
          <div className="k-card" style={{ padding: '8px 18px' }}>
            {student.homework.map((h, i) => (
              <button key={i} onClick={() => onToggleHomework(i)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '12px 0', borderBottom: i === student.homework.length - 1 ? 'none' : '1px solid var(--line)', fontFamily: 'inherit' }}>
                <span style={{ width: 21, height: 21, borderRadius: 7, border: '1.5px solid ' + (h.done ? 'var(--green-deep)' : '#c5c0b5'), background: h.done ? 'var(--green-deep)' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {h.done && <svg width="12" height="10" viewBox="0 0 10 8"><path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </span>
                <span style={{ fontSize: 15, color: '#111', textDecoration: h.done ? 'line-through' : 'none', opacity: h.done ? 0.55 : 1 }}>{h.text}</span>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Miten treenit sujuivat tällä viikolla? Kirjoita oma kommenttisi valmentajalle…" rows={3}
              style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 14, padding: '13px 14px', fontSize: 14, fontFamily: 'inherit', color: '#111', resize: 'none', background: '#fff', marginBottom: 10 }} />
            <button onClick={onSaveNote} className="btn-dark btn-sm">{noteSaved ? 'Tallennettu ✓' : 'Lähetä kommentti valmentajalle'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Harjoitteet ──────────────────────────────────────────
function ExercisesView({ exercises, onOpen }) {
  const [activeTag, setActiveTag] = React.useState('kaikki');
  const filtered = activeTag === 'kaikki' ? exercises : exercises.filter((e) => e.tags.includes(activeTag));
  return (
    <div>
      <PageHeader title="Harjoitteet" sub="Valmentajan harjoitepankki" />
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {EXERCISE_TAGS.map((t) => (
          <button key={t} onClick={() => setActiveTag(t)} style={{ padding: '9px 16px', borderRadius: 999, border: activeTag === t ? 'none' : '1px solid var(--line)', background: activeTag === t ? 'var(--lime)' : '#fff', color: activeTag === t ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{TAG_LABELS[t]}</button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {filtered.map((ex) => (
          <button key={ex.id} onClick={() => onOpen(ex.id)} className="k-card" style={{ textAlign: 'left', cursor: 'pointer', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ color: '#111', fontWeight: 700, fontSize: 15.5 }}>{ex.name}</div>
            <div style={{ color: '#8a857a', fontSize: 13 }}>{ex.players} pelaajaa · {ex.duration} · {ex.level}</div>
          </button>
        ))}
        {filtered.length === 0 && <div style={{ color: '#8a857a', fontSize: 14.5 }}>Ei harjoitteita tällä suodattimella.</div>}
      </div>
    </div>
  );
}
function ExerciseDetail({ exercise, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(480px, 100%)', padding: '28px 28px 26px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 22, fontWeight: 800, marginBottom: 10 }}>{exercise.name}</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 18 }}>
          <span className="k-chip">{exercise.players} pelaajaa</span>
          <span className="k-chip">{exercise.duration}</span>
          <LevelChip level={exercise.level} />
        </div>
        <SectionTitle>Tavoite</SectionTitle>
        <p style={{ fontSize: 14.5, lineHeight: 1.6, color: '#3c382f', marginBottom: 20 }}>{exercise.goal}</p>
        <button onClick={onClose} className="btn-outline" style={{ width: '100%', padding: '13px 0' }}>Sulje</button>
      </div>
    </div>
  );
}

// ── Profiili ─────────────────────────────────────────────
function ProfileView({ student, group }) {
  return (
    <div>
      <PageHeader title="Profiili" />
      <IdentityBlock student={student} group={group} />

      <div style={{ marginBottom: 26 }}>
        <SectionTitle>Kehitykseni</SectionTitle>
        <div className="k-card" style={{ padding: '20px 22px' }}>
          {Object.entries(student.progress).map(([k, v]) => <Bar key={k} label={k} value={v} />)}
        </div>
      </div>

      {student.diary.length > 0 && (
        <div style={{ marginBottom: 26 }}>
          <SectionTitle>Kehityshistoria</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {student.diary.map((d, i) => (
              <div key={i} style={{ display: 'flex', gap: 12 }}>
                <div style={{ width: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, paddingTop: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: i === 0 ? 'var(--lime)' : '#d8d4ca' }} />
                  {i < student.diary.length - 1 && <span style={{ width: 1.5, flex: 1, background: '#e3dfd4', marginTop: 4 }} />}
                </div>
                <div style={{ paddingBottom: 14 }}>
                  <div style={{ fontSize: 14, color: '#3c382f', lineHeight: 1.55 }}>{d.text}</div>
                  <div style={{ fontSize: 12, color: '#8a857a', fontWeight: 600, marginTop: 3 }}>{d.date}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 26 }}>
        <SectionTitle>Omat videot</SectionTitle>
        <VideoRow videos={student.videos} />
      </div>

      <SectionTitle>Toiminnot</SectionTitle>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <a href="/valmentaja" className="btn-outline btn-sm">Valmentajan näkymä →</a>
        <a href="/" className="btn-outline btn-sm">← Etusivulle</a>
      </div>
    </div>
  );
}

// ── bottom nav ───────────────────────────────────────────
const NAV = [
  { id: 'home', label: 'Koti' },
  { id: 'trainings', label: 'Treenit' },
  { id: 'exercises', label: 'Harjoitteet' },
  { id: 'profile', label: 'Profiili' },
];
function NavIcon({ id, on }) {
  const c = on ? 'var(--green-deep)' : '#9a958a';
  if (id === 'home') return <svg width="20" height="20" viewBox="0 0 22 22" fill="none"><path d="M3 10.5L11 3l8 7.5" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 9v9.5a1 1 0 001 1h10a1 1 0 001-1V9" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (id === 'trainings') return <svg width="20" height="20" viewBox="0 0 22 22" fill="none"><rect x="2.5" y="4.5" width="17" height="15" rx="3" stroke={c} strokeWidth="1.7" /><path d="M2.5 9h17M7 2.5v4M15 2.5v4" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>;
  if (id === 'exercises') return <svg width="20" height="20" viewBox="0 0 22 22" fill="none"><rect x="4" y="3" width="14" height="17" rx="2.5" stroke={c} strokeWidth="1.7" /><path d="M8 1.5h6a1 1 0 011 1V4H7V2.5a1 1 0 011-1z" stroke={c} strokeWidth="1.7" /><path d="M7.5 9.5h7M7.5 13h7M7.5 16.5h4" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>;
  return <svg width="20" height="20" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="7.5" r="4" stroke={c} strokeWidth="1.7" /><path d="M3 20c0-4.4 3.6-7 8-7s8 2.6 8 7" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>;
}
function BottomNav({ tab, setTab }) {
  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: 68, zIndex: 45, background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderTop: '1px solid var(--line)', boxShadow: '0 -8px 24px -18px rgba(0,0,0,0.2)', display: 'flex' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', width: '100%', display: 'flex' }}>
        {NAV.map((n) => {
          const on = tab === n.id;
          const fs = n.label.length > 8 ? 9.5 : 10.5;
          return (
            <button key={n.id} onClick={() => setTab(n.id)} style={{ flex: 1, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, fontFamily: 'inherit' }}>
              <NavIcon id={n.id} on={on} />
              <span style={{ fontSize: fs, fontWeight: on ? 700 : 500, color: on ? 'var(--green-deep)' : '#9a958a' }}>{n.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function App() {
  const [state, setState] = React.useState(() => window.koutsiLoadState());
  const [activeId, setActiveId] = React.useState(0);
  const [tab, setTab] = React.useState('home');
  const [exerciseId, setExerciseId] = React.useState(null);
  const [note, setNote] = React.useState('');
  const [noteSaved, setNoteSaved] = React.useState(false);
  const [wish, setWish] = React.useState('');
  const [wishSaved, setWishSaved] = React.useState(false);

  React.useEffect(() => {
    const onStorage = (e) => { if (e.key === window.KOUTSI_STORE_KEY) setState(window.koutsiLoadState()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const student = state.students.find((s) => s.id === activeId) || state.students[0];
  React.useEffect(() => {
    setNote(student ? student.playerNote || '' : '');
    setWish(student ? student.playerWish || '' : '');
    setNoteSaved(false);
    setWishSaved(false);
  }, [activeId]);

  const group = student ? window.koutsiGroupForStudent(state, student.id) : null;
  const upcoming = student ? window.koutsiUpcomingTrainingsForStudent(state, student.id) : [];
  const exercise = exerciseId != null ? state.exercises.find((e) => e.id === exerciseId) : null;

  const update = (fn) => setState((prev) => { const next = fn(prev); window.koutsiSaveState(next); return next; });

  const toggleHomework = (i) => {
    update((prev) => ({ ...prev, students: prev.students.map((s) => s.id === activeId ? { ...s, homework: s.homework.map((h, k) => k === i ? { ...h, done: !h.done } : h) } : s) }));
  };
  const saveNote = () => {
    update((prev) => ({ ...prev, students: prev.students.map((s) => s.id === activeId ? { ...s, playerNote: note.trim() } : s) }));
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 1800);
  };
  const saveWish = () => {
    update((prev) => ({ ...prev, students: prev.students.map((s) => s.id === activeId ? { ...s, playerWish: wish.trim() } : s) }));
    setWishSaved(true);
    setTimeout(() => setWishSaved(false), 1800);
  };
  const switchPlayer = (id) => { setActiveId(id); setTab('home'); };

  if (!student) return null;

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopBar students={state.students} activeId={activeId} onSwitch={switchPlayer} />
      <div key={tab + activeId} className="k-rise-in" style={{ maxWidth: 760, margin: '0 auto', padding: '34px 22px 100px' }}>
        {tab === 'home' && <HomeView student={student} group={group} wish={wish} setWish={setWish} wishSaved={wishSaved} onSaveWish={saveWish} />}
        {tab === 'trainings' && <TrainingsView student={student} group={group} upcoming={upcoming} note={note} setNote={setNote} noteSaved={noteSaved} onSaveNote={saveNote} onToggleHomework={toggleHomework} />}
        {tab === 'exercises' && <ExercisesView exercises={state.exercises} onOpen={setExerciseId} />}
        {tab === 'profile' && <ProfileView student={student} group={group} />}
      </div>
      <BottomNav tab={tab} setTab={setTab} />
      {exercise && <ExerciseDetail exercise={exercise} onClose={() => setExerciseId(null)} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
