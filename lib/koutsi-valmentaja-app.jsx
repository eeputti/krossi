// koutsi-valmentaja-app.jsx — full-page coach web app for koutsi.krossi.app/valmentaja.
// Reads/writes the shared demo store from koutsi-data.js, so changes made here
// (diary entries, homework, new trainings) show up in the player view too.

const DICTATION_SAMPLE = 'Harjoittelimme kakkossyöttöä ja ensimmäistä lyöntiä syötön jälkeen. Heiton suunta parani, mutta vauhti hidastuu paineessa. Ensi kerralla jatketaan samoista lähtöasennoista ja lisätään pisteen aloituksia.';
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
    <div style={{ marginBottom: 12 }}>
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

function ThemeBanner({ theme }) {
  return (
    <div className="k-card" style={{ padding: '20px 24px', background: 'linear-gradient(135deg, rgba(207,228,20,0.16), rgba(14,59,44,0.05))', borderColor: 'rgba(14,59,44,0.14)', marginBottom: 24 }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--green-deep)', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 6 }}>Viikon teema</div>
      <div style={{ fontSize: 19, fontWeight: 800, color: '#111', marginBottom: 5 }}>{theme.title}</div>
      <div style={{ fontSize: 14, color: '#514c42', lineHeight: 1.55, maxWidth: 640 }}>{theme.lead}</div>
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

// ── Oppilaat ─────────────────────────────────────────────
function StudentsView({ students, onOpen, theme }) {
  return (
    <div>
      <PageHeader title="Oppilaani" sub={`${students.length} valmennettavaa`} />
      <ThemeBanner theme={theme} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 18 }}>
        {students.map((s) => (
          <button key={s.id} onClick={() => onOpen(s.id)} className="k-card" style={{ textAlign: 'left', cursor: 'pointer', padding: '20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar initial={s.initial} hue={s.hue} size={48} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ color: '#111', fontWeight: 700, fontSize: 16.5 }}>{s.name}, {s.age}</span>
                  {s.diary.length > 0 && <span title="Uusi merkintä" style={{ width: 7, height: 7, borderRadius: '50%', background: '#46a66d', flexShrink: 0 }} />}
                </div>
                <span className="k-chip" style={{ marginTop: 6 }}>{s.level}</span>
              </div>
            </div>
            <div style={{ fontSize: 13.5, color: '#3c382f', lineHeight: 1.5 }}><b style={{ color: 'var(--green-deep)' }}>Tavoite:</b> {s.goal}</div>
            <div style={{ fontSize: 12.5, color: '#8a857a', lineHeight: 1.5 }}>Seuraavaksi: {s.focus}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {Object.entries(s.progress).map(([k, v]) => (
                <div key={k} style={{ flex: 1 }}>
                  <div style={{ height: 5, borderRadius: 99, background: '#efece4', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${v}%`, borderRadius: 99, background: 'var(--lime)' }} />
                  </div>
                  <div style={{ fontSize: 10, color: '#a8a297', marginTop: 3, fontWeight: 600 }}>{k}</div>
                </div>
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function StudentDetail({ student, onClose, onAddEntry, onToggleHomework }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(10,15,10,0.35)', animation: 'kFadeIn .2s ease' }} />
      <div style={{ position: 'relative', width: 'min(480px, 100%)', height: '100%', background: '#fff', boxShadow: '-16px 0 40px -20px rgba(0,0,0,0.35)', overflowY: 'auto', animation: 'kSlideIn .25s ease' }}>
        <div style={{ padding: '26px 28px 0', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} aria-label="Sulje" style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid var(--line)', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M1 1l12 12M13 1L1 13" stroke="#111" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div style={{ padding: '10px 28px 120px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, marginBottom: 24 }}>
            <Avatar initial={student.initial} hue={student.hue} size={84} ring />
            <div style={{ color: '#111', fontWeight: 800, fontSize: 22 }}>{student.name}, {student.age}</div>
            <span className="k-chip">{student.level}</span>
          </div>

          <Field label="Tavoite ja seuraava askel">
            <div className="k-card" style={{ padding: '15px 17px', display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ fontSize: 14, lineHeight: 1.5 }}><b style={{ color: 'var(--green-deep)' }}>Tavoite:</b> {student.goal}</div>
              <div style={{ fontSize: 14, lineHeight: 1.5 }}><b style={{ color: 'var(--green-deep)' }}>Viime treenissä:</b> {student.lastSession}</div>
              <div style={{ fontSize: 14, lineHeight: 1.5 }}><b style={{ color: 'var(--green-deep)' }}>Seuraavaksi:</b> {student.focus}</div>
            </div>
          </Field>

          <Field label="Kehitys">
            {Object.entries(student.progress).map(([k, v]) => <Bar key={k} label={k} value={v} />)}
          </Field>

          <Field label="Videot">
            <VideoRow videos={student.videos} />
          </Field>

          <Field label="Päiväkirja">
            {student.diary.length === 0 && <div style={{ color: '#8a857a', fontSize: 14 }}>Ei vielä merkintöjä.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {student.diary.map((d, i) => (
                <div key={i} className="k-card" style={{ padding: '12px 15px' }}>
                  <div style={{ color: '#111', fontSize: 14, lineHeight: 1.5 }}>{d.text}</div>
                  <div style={{ marginTop: 6, fontSize: 12, color: '#8a857a', fontWeight: 600 }}>{d.date}</div>
                </div>
              ))}
            </div>
          </Field>

          {student.playerNote && (
            <Field label="Pelaajan oma kommentti">
              <div className="k-card" style={{ padding: '12px 15px', background: 'rgba(207,228,20,0.08)', borderColor: 'rgba(207,228,20,0.4)' }}>
                <div style={{ color: '#111', fontSize: 14, lineHeight: 1.5, fontStyle: 'italic' }}>&ldquo;{student.playerNote}&rdquo;</div>
              </div>
            </Field>
          )}

          {student.upcoming.length > 0 && (
            <Field label="Tulevat treenit">
              {student.upcoming.map((u, i) => (
                <div key={i} style={{ fontSize: 14.5, color: '#3c382f', padding: '4px 0' }}>{u.day} · {u.time} — {u.type}</div>
              ))}
            </Field>
          )}

          {student.homework.length > 0 && (
            <Field label="Kotiläksyt">
              {student.homework.map((h, i) => (
                <button key={i} onClick={() => onToggleHomework(i)} style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '7px 0', fontFamily: 'inherit' }}>
                  <span style={{ width: 19, height: 19, borderRadius: 6, border: '1.5px solid ' + (h.done ? 'var(--green-deep)' : '#c5c0b5'), background: h.done ? 'var(--green-deep)' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {h.done && <svg width="11" height="9" viewBox="0 0 10 8"><path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </span>
                  <span style={{ fontSize: 14.5, color: '#111', textDecoration: h.done ? 'line-through' : 'none', opacity: h.done ? 0.55 : 1 }}>{h.text}</span>
                </button>
              ))}
            </Field>
          )}
        </div>
        <div style={{ position: 'sticky', bottom: 0, left: 0, right: 0, padding: '18px 28px', background: 'linear-gradient(to top, #fff 60%, transparent)' }}>
          <button onClick={onAddEntry} className="btn-lime btn-lg" style={{ width: '100%' }}>+ Uusi päiväkirjamerkintä</button>
        </div>
      </div>
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

function VideoRow({ videos }) {
  if (!videos.length) return <div style={{ color: '#8a857a', fontSize: 14 }}>Ei vielä jaettuja videoita.</div>;
  return (
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 2 }}>
      {videos.map((v, i) => (
        <div key={i} style={{ width: 150, flexShrink: 0 }}>
          <div style={{ width: '100%', aspectRatio: '4/3', borderRadius: 14, position: 'relative', overflow: 'hidden', background: `radial-gradient(120% 120% at 30% 20%, hsl(${v.hue} 55% 45%), hsl(${v.hue + 24} 60% 22%))` }}>
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="13" height="15" viewBox="0 0 12 14"><path d="M1 1v12l10-6L1 1z" fill="#101a08" /></svg>
              </span>
            </span>
            <span style={{ position: 'absolute', right: 7, bottom: 7, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 6 }}>{v.dur}</span>
          </div>
          <div style={{ color: '#111', fontSize: 12.5, fontWeight: 600, marginTop: 7, lineHeight: 1.35 }}>{v.title}</div>
        </div>
      ))}
    </div>
  );
}

function MicButton({ recState, onClick }) {
  const label = recState === 'idle' ? 'Sanele muistiinpano' : recState === 'recording' ? 'Sanellaan…' : 'Tekoäly kirjoittaa yhteenvedon…';
  const dotColor = recState === 'recording' ? '#e5484d' : recState === 'thinking' ? 'var(--lime)' : 'var(--green-deep)';
  return (
    <button onClick={onClick} disabled={recState !== 'idle'} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: recState === 'idle' ? '#fff' : 'rgba(207,228,20,0.14)', border: '1px solid ' + (recState === 'idle' ? '#d8d4ca' : 'var(--lime)'), borderRadius: 999, padding: '11px 18px', cursor: recState === 'idle' ? 'pointer' : 'default', fontFamily: 'inherit', fontWeight: 700, fontSize: 13.5, color: '#111', marginBottom: 14 }}>
      <span className={recState !== 'idle' ? 'kc-pulse' : ''} style={{ width: 9, height: 9, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
      {label}
    </button>
  );
}

function EntryModal({ student, onClose, onSend }) {
  const [val, setVal] = React.useState('');
  const [recState, setRecState] = React.useState('idle');
  const startDictation = () => {
    setRecState('recording');
    setTimeout(() => {
      setRecState('thinking');
      setTimeout(() => { setVal(DICTATION_SAMPLE); setRecState('idle'); }, 900);
    }, 1300);
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(460px, 100%)', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 16 }}>Päiväkirja — {student.name}</h3>
        <MicButton recState={recState} onClick={startDictation} />
        <textarea autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder="Esim. Hyvä nousu syötössä tällä viikolla… tai sanele yllä olevasta napista." rows={4}
          style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', resize: 'none', marginBottom: 16, background: '#fff' }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={() => val.trim() && onSend(val.trim())} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: val.trim() ? 1 : 0.45, cursor: val.trim() ? 'pointer' : 'default' }}>Tallenna</button>
        </div>
      </div>
    </div>
  );
}

function TrainingModal({ students, onClose, onSave }) {
  const [studentId, setStudentId] = React.useState(students[0]?.id ?? null);
  const [day, setDay] = React.useState('');
  const [time, setTime] = React.useState('');
  const [type, setType] = React.useState('Yksityistunti');
  const ready = studentId != null && day.trim() && time.trim();
  const inputStyle = { flex: 1, boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };
  const Pill = ({ on, children, onClick }) => (
    <button onClick={onClick} style={{ padding: '9px 15px', borderRadius: 999, border: on ? 'none' : '1px solid #d8d4ca', background: on ? 'var(--lime)' : '#fff', color: on ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>{children}</button>
  );
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(460px, 100%)', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 16 }}>Uusi valmennus</h3>
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
        </div>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Ajankohta</div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
          <input value={day} onChange={(e) => setDay(e.target.value)} placeholder="Esim. Ma 9.6." style={inputStyle} />
          <input value={time} onChange={(e) => setTime(e.target.value)} placeholder="Klo 17:00" style={{ ...inputStyle, flex: 0.7 }} />
        </div>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Tyyppi</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {['Yksityistunti', 'Ryhmätreeni', 'Ottelu'].map((t) => <Pill key={t} on={type === t} onClick={() => setType(t)}>{t}</Pill>)}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={() => ready && onSave({ studentId, day: day.trim(), time: time.trim(), type })} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: ready ? 1 : 0.45, cursor: ready ? 'pointer' : 'default' }}>Lisää</button>
        </div>
      </div>
    </div>
  );
}

// ── Treenit ──────────────────────────────────────────────
function TrainingsView({ students, theme, onAdd, onPreSession }) {
  const rows = students.flatMap((s) => s.upcoming.map((u) => ({ ...u, student: s })));
  const days = [];
  rows.forEach((r) => { if (!days.some((d) => d.day === r.day)) days.push({ day: r.day, sessions: rows.filter((x) => x.day === r.day) }); });
  return (
    <div>
      <PageHeader title="Treenit" sub="Tulevat valmennukset" action={<button onClick={onAdd} className="btn-dark btn-sm">+ Lisää valmennus</button>} />
      <ThemeBanner theme={theme} />
      {days.length === 0 && <div className="k-card" style={{ padding: 24, color: '#8a857a', fontSize: 14.5 }}>Ei tulevia valmennuksia.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {days.map((d) => (
          <div key={d.day}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.6 }}>{d.day}</div>
              <button onClick={() => onPreSession(d)} className="btn-outline btn-sm" style={{ padding: '7px 14px', fontSize: 12.5 }}>Ennen treeniä →</button>
            </div>
            <div className="k-card" style={{ padding: 0, overflow: 'hidden' }}>
              {d.sessions.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '15px 18px', borderBottom: i === d.sessions.length - 1 ? 'none' : '1px solid var(--line)' }}>
                  <div style={{ width: 52, fontSize: 14.5, fontWeight: 800, color: 'var(--green-deep)', flexShrink: 0 }}>{r.time}</div>
                  <Avatar initial={r.student.initial} hue={r.student.hue} size={38} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#111', fontWeight: 700, fontSize: 15 }}>{r.student.name}</div>
                    <div style={{ color: '#8a857a', fontSize: 12.5 }}>{r.type}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreSessionPanel({ day, exercises, theme, onClose }) {
  const suggestions = exercises.slice(0, 3);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(560px, 100%)', maxHeight: '86vh', overflowY: 'auto', padding: '28px 28px 26px', animation: 'kFadeIn .2s ease' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Seuraavaksi</div>
        <h3 style={{ fontSize: 24, fontWeight: 800, marginBottom: 20 }}>{day.day}</h3>
        <Field label="Pelaajat">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {day.sessions.map((r, i) => (
              <div key={i} className="k-card" style={{ display: 'flex', gap: 13, alignItems: 'flex-start', padding: '13px 15px' }}>
                <Avatar initial={r.student.initial} hue={r.student.hue} size={40} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#111' }}>{r.student.name}</div>
                  <div style={{ fontSize: 13, color: '#514c42', marginTop: 3, lineHeight: 1.4 }}>Jatka: {r.student.focus}</div>
                  <div style={{ fontSize: 12.5, color: '#8a857a', marginTop: 1, lineHeight: 1.4 }}>Huomioi: {r.student.lastSession}</div>
                </div>
              </div>
            ))}
          </div>
        </Field>
        <Field label="Ryhmän teema">
          <div className="k-card" style={{ padding: '13px 15px' }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#111', marginBottom: 5 }}>{theme.title}</div>
            <div style={{ fontSize: 13, color: '#514c42', lineHeight: 1.5 }}>{theme.lead}</div>
          </div>
        </Field>
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

// ── Harjoitteet ──────────────────────────────────────────
function ExercisesView({ exercises, onOpen }) {
  const [activeTag, setActiveTag] = React.useState('kaikki');
  const filtered = activeTag === 'kaikki' ? exercises : exercises.filter((e) => e.tags.includes(activeTag));
  return (
    <div>
      <PageHeader title="Harjoitteet" sub="Oma harjoitepankki" />
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
          <span className="k-chip">{exercise.level}</span>
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

// ── Profiili ─────────────────────────────────────────────
function ProfileView({ coach, studentCount }) {
  return (
    <div>
      <PageHeader title="Profiili" />
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
        <div className="k-card" style={{ padding: 26, flex: '0 0 260px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
          <Avatar initial={coach.initial} hue={coach.hue} size={84} ring />
          <div style={{ color: '#111', fontWeight: 800, fontSize: 20 }}>{coach.name}</div>
          <div style={{ color: '#8a857a', fontSize: 13.5 }}>{coach.tagline}</div>
          <div style={{ display: 'flex', gap: 10, width: '100%', marginTop: 6 }}>
            {[['Oppilaita', studentCount], ['Treenejä/vk', 4]].map(([k, v]) => (
              <div key={k} style={{ flex: 1, background: '#f7f5ef', borderRadius: 14, padding: '12px 10px' }}>
                <div style={{ color: '#8a857a', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 }}>{k}</div>
                <div style={{ color: '#111', fontWeight: 800, fontSize: 18 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ flex: '1 1 320px' }}>
          <Field label="Kuvaus">
            <p style={{ fontSize: 14.5, lineHeight: 1.6, color: '#3c382f' }}>{coach.bio}</p>
          </Field>
          <Field label="Erikoisalat">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {coach.specialties.map((s) => <span key={s} className="k-chip">{s}</span>)}
            </div>
          </Field>
          <Field label="Oma videokirjasto">
            <VideoRow videos={coach.videos} />
          </Field>
        </div>
      </div>
    </div>
  );
}

// ── Sidebar ──────────────────────────────────────────────
const NAV = [
  { id: 'students', label: 'Oppilaat' },
  { id: 'trainings', label: 'Treenit' },
  { id: 'exercises', label: 'Harjoitteet' },
  { id: 'profile', label: 'Profiili' },
];
function NavIcon({ id, on }) {
  const c = on ? '#101a08' : 'rgba(255,255,255,0.72)';
  if (id === 'students') return <svg width="19" height="19" viewBox="0 0 22 22" fill="none"><circle cx="8" cy="6.5" r="3" stroke={c} strokeWidth="1.7" /><path d="M2 19c0-3.2 2.7-5.3 6-5.3s6 2.1 6 5.3" stroke={c} strokeWidth="1.7" strokeLinecap="round" /><circle cx="16" cy="7.5" r="2.4" stroke={c} strokeWidth="1.7" /><path d="M13.8 19c.3-2.6 2.1-4.3 4.2-4.3S21.7 16.4 22 19" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>;
  if (id === 'trainings') return <svg width="19" height="19" viewBox="0 0 22 22" fill="none"><rect x="2.5" y="4.5" width="17" height="15" rx="3" stroke={c} strokeWidth="1.7" /><path d="M2.5 9h17M7 2.5v4M15 2.5v4" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>;
  if (id === 'exercises') return <svg width="19" height="19" viewBox="0 0 22 22" fill="none"><rect x="4" y="3" width="14" height="17" rx="2.5" stroke={c} strokeWidth="1.7" /><path d="M8 1.5h6a1 1 0 011 1V4H7V2.5a1 1 0 011-1z" stroke={c} strokeWidth="1.7" /><path d="M7.5 9.5h7M7.5 13h7M7.5 16.5h4" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>;
  return <svg width="19" height="19" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="7.5" r="4" stroke={c} strokeWidth="1.7" /><path d="M3 20c0-4.4 3.6-7 8-7s8 2.6 8 7" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>;
}

function Sidebar({ tab, setTab, coach, onReset }) {
  return (
    <div style={{ width: 248, flexShrink: 0, background: 'var(--green-deep)', color: '#fff', display: 'flex', flexDirection: 'column', padding: '26px 18px', position: 'fixed', top: 0, left: 0, bottom: 0, overflowY: 'auto' }}>
      <a href="/" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7, textDecoration: 'none', marginBottom: 30, paddingLeft: 6 }}>
        <span style={{ fontWeight: 800, fontSize: 20, color: 'var(--lime)', letterSpacing: -0.5 }}>Krossi</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>Koutsi</span>
      </a>
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
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{coach.name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Valmentaja (demo)</div>
          </div>
        </div>
        <a href="/pelaaja" className="btn-ghost btn-sm" style={{ justifyContent: 'flex-start', gap: 8 }}>Pelaajan näkymä →</a>
        <a href="/" className="btn-ghost btn-sm" style={{ justifyContent: 'flex-start', gap: 8 }}>← Etusivulle</a>
        <button onClick={onReset} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)', fontSize: 12, cursor: 'pointer', textAlign: 'left', padding: '4px 6px', fontFamily: 'inherit' }}>Nollaa demodata</button>
      </div>
    </div>
  );
}

function App() {
  const [state, setState] = React.useState(() => window.koutsiLoadState());
  const [tab, setTab] = React.useState('students');
  const [detailId, setDetailId] = React.useState(null);
  const [entryOpen, setEntryOpen] = React.useState(false);
  const [trainingOpen, setTrainingOpen] = React.useState(false);
  const [exerciseId, setExerciseId] = React.useState(null);
  const [presessionDay, setPresessionDay] = React.useState(null);

  React.useEffect(() => {
    const onStorage = (e) => { if (e.key === window.KOUTSI_STORE_KEY) setState(window.koutsiLoadState()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = (fn) => setState((prev) => { const next = fn(prev); window.koutsiSaveState(next); return next; });

  const detail = detailId != null ? state.students.find((s) => s.id === detailId) : null;
  const exercise = exerciseId != null ? state.exercises.find((e) => e.id === exerciseId) : null;

  const saveEntry = (text) => {
    update((prev) => ({ ...prev, students: prev.students.map((s) => s.id === detailId ? { ...s, diary: [{ date: 'Juuri nyt', text }, ...s.diary] } : s) }));
    setEntryOpen(false);
  };
  const toggleHomework = (i) => {
    update((prev) => ({ ...prev, students: prev.students.map((s) => s.id === detailId ? { ...s, homework: s.homework.map((h, k) => k === i ? { ...h, done: !h.done } : h) } : s) }));
  };
  const addTraining = ({ studentId, day, time, type }) => {
    update((prev) => ({ ...prev, students: prev.students.map((s) => s.id === studentId ? { ...s, upcoming: [...s.upcoming, { day, time, type }] } : s) }));
    setTrainingOpen(false);
  };
  const resetDemo = () => {
    window.koutsiResetState();
    setState(window.koutsiLoadState());
    setDetailId(null); setEntryOpen(false); setTrainingOpen(false); setExerciseId(null); setPresessionDay(null);
  };

  return (
    <div style={{ minHeight: '100vh' }}>
      <Sidebar tab={tab} setTab={setTab} coach={state.coach} onReset={resetDemo} />
      <div style={{ marginLeft: 248, padding: '36px 44px 80px', maxWidth: 1180 }}>
        {tab === 'students' && <StudentsView students={state.students} onOpen={setDetailId} theme={state.weeklyTheme} />}
        {tab === 'trainings' && <TrainingsView students={state.students} theme={state.weeklyTheme} onAdd={() => setTrainingOpen(true)} onPreSession={setPresessionDay} />}
        {tab === 'exercises' && <ExercisesView exercises={state.exercises} onOpen={setExerciseId} />}
        {tab === 'profile' && <ProfileView coach={state.coach} studentCount={state.students.length} />}
      </div>

      {detail && <StudentDetail student={detail} onClose={() => setDetailId(null)} onAddEntry={() => setEntryOpen(true)} onToggleHomework={toggleHomework} />}
      {detail && entryOpen && <EntryModal student={detail} onClose={() => setEntryOpen(false)} onSend={saveEntry} />}
      {trainingOpen && <TrainingModal students={state.students} onClose={() => setTrainingOpen(false)} onSave={addTraining} />}
      {exercise && <ExerciseDetail exercise={exercise} onClose={() => setExerciseId(null)} />}
      {presessionDay && <PreSessionPanel day={presessionDay} exercises={state.exercises} theme={state.weeklyTheme} onClose={() => setPresessionDay(null)} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
