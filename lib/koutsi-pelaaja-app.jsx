// koutsi-pelaaja-app.jsx — full-page player web app for koutsi.krossi.app/pelaaja.
// Reads/writes the same shared demo store as the coach view (koutsi-data.js), so
// whatever the coach adds — a diary entry, a new training, a weekly theme — shows up here.

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
        <a href="/valmentaja" className="btn-outline btn-sm">Valmentajan näkymä →</a>
      </div>
    </div>
  );
}

function App() {
  const [state, setState] = React.useState(() => window.koutsiLoadState());
  const [activeId, setActiveId] = React.useState(0);
  const [note, setNote] = React.useState('');
  const [noteSaved, setNoteSaved] = React.useState(false);

  React.useEffect(() => {
    const onStorage = (e) => { if (e.key === window.KOUTSI_STORE_KEY) setState(window.koutsiLoadState()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const student = state.students.find((s) => s.id === activeId) || state.students[0];
  React.useEffect(() => { setNote(student ? student.playerNote || '' : ''); setNoteSaved(false); }, [activeId]);

  const group = student ? window.koutsiGroupForStudent(state, student.id) : null;
  const upcoming = student ? window.koutsiUpcomingTrainingsForStudent(state, student.id) : [];

  const update = (fn) => setState((prev) => { const next = fn(prev); window.koutsiSaveState(next); return next; });

  const toggleHomework = (i) => {
    update((prev) => ({ ...prev, students: prev.students.map((s) => s.id === activeId ? { ...s, homework: s.homework.map((h, k) => k === i ? { ...h, done: !h.done } : h) } : s) }));
  };
  const saveNote = () => {
    update((prev) => ({ ...prev, students: prev.students.map((s) => s.id === activeId ? { ...s, playerNote: note.trim() } : s) }));
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 1800);
  };

  if (!student) return null;
  const latestEntry = student.diary[0];

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopBar students={state.students} activeId={activeId} onSwitch={setActiveId} />
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '34px 22px 100px' }}>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 30, textAlign: 'center' }}>
          <Avatar initial={student.initial} hue={student.hue} size={76} ring />
          <div style={{ fontSize: 24, fontWeight: 800, color: '#111' }}>{student.name}</div>
          <span className="k-chip">{student.level}</span>
          {group && <span className="k-chip">Ryhmä: {group.name} · {group.day} {group.time}</span>}
          <p style={{ fontSize: 15, color: '#514c42', lineHeight: 1.55, maxWidth: 480, marginTop: 4 }}>
            <b style={{ color: 'var(--green-deep)' }}>Tavoitteeni:</b> {student.goal}
          </p>
        </div>

        <div className="k-card" style={{ padding: '20px 24px', background: 'linear-gradient(135deg, rgba(207,228,20,0.16), rgba(14,59,44,0.05))', borderColor: 'rgba(14,59,44,0.14)', marginBottom: 22 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--green-deep)', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 6 }}>Viikon teema</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#111', marginBottom: 5 }}>{state.weeklyTheme.title}</div>
          <div style={{ fontSize: 14, color: '#514c42', lineHeight: 1.55 }}>{state.weeklyTheme.lead}</div>
        </div>

        {latestEntry && (
          <div style={{ marginBottom: 26 }}>
            <SectionTitle>Viimeisin palaute valmentajalta</SectionTitle>
            <div className="k-card" style={{ padding: '18px 20px', borderColor: 'var(--green-deep)', borderWidth: 1.5 }}>
              <p style={{ fontSize: 15.5, color: '#111', lineHeight: 1.6 }}>{latestEntry.text}</p>
              <div style={{ marginTop: 8, fontSize: 12.5, color: '#8a857a', fontWeight: 600 }}>{latestEntry.date}</div>
            </div>
          </div>
        )}

        {upcoming.length > 0 && (
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
        )}

        {student.homework.length > 0 && (
          <div style={{ marginBottom: 26 }}>
            <SectionTitle>Omatoimiset tehtävät</SectionTitle>
            <div className="k-card" style={{ padding: '8px 18px' }}>
              {student.homework.map((h, i) => (
                <button key={i} onClick={() => toggleHomework(i)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '12px 0', borderBottom: i === student.homework.length - 1 ? 'none' : '1px solid var(--line)', fontFamily: 'inherit' }}>
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
              <button onClick={saveNote} className="btn-dark btn-sm">{noteSaved ? 'Tallennettu ✓' : 'Lähetä kommentti valmentajalle'}</button>
            </div>
          </div>
        )}

        <div style={{ marginBottom: 26 }}>
          <SectionTitle>Kehitykseni</SectionTitle>
          <div className="k-card" style={{ padding: '20px 22px', marginBottom: 14 }}>
            {Object.entries(student.progress).map(([k, v]) => <Bar key={k} label={k} value={v} />)}
          </div>
          {student.diary.length > 0 && (
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
          )}
        </div>

        <div>
          <SectionTitle>Omat videot</SectionTitle>
          <VideoRow videos={student.videos} />
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
