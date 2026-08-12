// koutsi-phone.jsx — interactive coach-app mockup for the koutsi.krossi.app hero demo.
// Same device chrome as the main Krossi phone demo (lib/krossi-phone.jsx), light/white skin,
// re-themed for the coach flows: students, trainings, diary entries, shared videos, exercise bank, own profile.

const KC = {
  Avatar({ initial, hue = 150, size = 44, ring = false }) {
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: `radial-gradient(120% 120% at 30% 20%, hsl(${hue} 55% 62%), hsl(${hue + 24} 60% 38%))`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontWeight: 700, fontSize: size * 0.4,
        boxShadow: ring ? '0 0 0 2px var(--lime)' : 'none', letterSpacing: 0.3,
      }}>{initial}</div>
    );
  },
  Chip({ children, variant = 'outline' }) {
    const base = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', lineHeight: 1 };
    if (variant === 'lime') return <span style={{ ...base, background: 'var(--lime)', color: '#101a08' }}>{children}</span>;
    if (variant === 'active') return (
      <span style={{ ...base, background: 'rgba(70,166,109,0.1)', color: '#2d7a4d', border: '1px solid rgba(70,166,109,0.3)' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#46a66d' }} />{children}
      </span>
    );
    return <span style={{ ...base, background: '#f4f2ec', color: '#6b665c', border: '1px solid var(--line)' }}>{children}</span>;
  },
};

const KC_LEVEL_COLORS = {
  aloitt: { bg: 'rgba(214,140,44,0.14)', fg: '#8a5a12', border: 'rgba(214,140,44,0.35)' },
  keski: { bg: 'rgba(58,130,212,0.12)', fg: '#2a5d94', border: 'rgba(58,130,212,0.32)' },
  edist: { bg: 'rgba(148,88,214,0.12)', fg: '#6a389c', border: 'rgba(148,88,214,0.32)' },
  kilpa: { bg: 'rgba(180,205,20,0.22)', fg: '#5c6b06', border: 'rgba(180,205,20,0.55)' },
};
function KCLevelChip({ level }) {
  const l = (level || '').toLowerCase();
  const key = Object.keys(KC_LEVEL_COLORS).find((k) => l.includes(k));
  const c = key ? KC_LEVEL_COLORS[key] : { bg: '#f4f2ec', fg: '#6b665c', border: '#d8d4ca' };
  return <span style={{ display: 'inline-flex', alignItems: 'center', padding: '5px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, lineHeight: 1, background: c.bg, color: c.fg, border: `1px solid ${c.border}` }}>{level}</span>;
}

const KC_STUDENTS = [
  {
    id: 0, initial: 'M', hue: 205, name: 'Maria K.', age: 16, level: 'Kilpapelaaja',
    goal: 'Varmempi kakkossyöttö ja rohkeampi verkkopeli',
    lastSession: 'Kämmenen valmistautuminen myöhässä',
    focus: 'Split step + ensimmäinen askel',
    progress: { Tekniikka: 78, Kunto: 65, Taktiikka: 70 },
    diary: [
      { date: '2 pv sitten', text: 'Hyvä nousu syötössä tällä viikolla — jatka samaan malliin.' },
      { date: '1 vko sitten', text: 'Aloitettiin uusi lyöntitekniikka forehandiin.' },
    ],
    videos: [{ title: 'Syöttöanalyysi', dur: '0:42', hue: 205 }, { title: 'Forehand vertailu', dur: '1:10', hue: 150 }],
    upcoming: [{ day: 'Ke 4.6.', time: '17:00', type: 'Yksityistunti' }],
    homework: [{ text: '10 min syöttöharjoittelua päivässä', done: false }],
  },
  {
    id: 1, initial: 'A', hue: 150, name: 'Aleksi R.', age: 14, level: 'Keskitaso',
    goal: 'Backhandin tasapaino pitkissä vaihdoissa',
    lastSession: 'Liikkeen aloitus parani huomattavasti',
    focus: 'Askelkuvio ennen lyöntiä',
    progress: { Tekniikka: 60, Kunto: 72, Taktiikka: 55 },
    diary: [{ date: 'Eilen', text: 'Backhand parani huomattavasti — hyvä liikkeen aloitus.' }],
    videos: [{ title: 'Backhand-analyysi', dur: '0:35', hue: 20 }],
    upcoming: [{ day: 'To 5.6.', time: '16:00', type: 'Ryhmätreeni' }],
    homework: [{ text: 'Katso videoanalyysi backhandista', done: true }],
  },
  {
    id: 2, initial: 'E', hue: 40, name: 'Emma L.', age: 12, level: 'Aloittelija',
    goal: 'Luonteva ote ja perusasento',
    lastSession: 'Ensimmäinen kerta, tutustuttiin mailaan',
    focus: 'Mailan ote peilin edessä',
    progress: { Tekniikka: 35, Kunto: 40, Taktiikka: 25 },
    diary: [],
    videos: [],
    upcoming: [{ day: 'La 7.6.', time: '10:00', type: 'Yksityistunti' }],
    homework: [{ text: 'Harjoittele otetta peilin edessä', done: false }],
  },
  {
    id: 3, initial: 'J', hue: 0, name: 'Joonas P.', age: 17, level: 'Edistynyt',
    goal: 'Nelinpelitaktiikan syventäminen',
    lastSession: 'Nelinpelitaktiikka istui hyvin',
    focus: 'Verkkopelin sijoittuminen',
    progress: { Tekniikka: 82, Kunto: 80, Taktiikka: 74 },
    diary: [
      { date: '4 pv sitten', text: 'Nelinpelitaktiikka istui hyvin — jatketaan verkkopeliä ensi kerralla.' },
      { date: '2 vko sitten', text: 'Kuntotestit tehty, hyvä lähtötaso koko kaudelle.' },
    ],
    videos: [{ title: 'Verkkopelin sijoittuminen', dur: '0:58', hue: 280 }],
    upcoming: [],
    homework: [],
  },
];

const KC_COACH = {
  initial: 'A', hue: 150, name: 'Anna Koskinen', tagline: 'Tennisvalmentaja · Lahti',
  bio: 'Valmennan juniori- ja aikuispelaajia. Erikoisalana lyöntitekniikka ja kilpapelaajien fysiikka.',
  specialties: ['Yksityistunnit', 'Ryhmätreenit', 'Junioripelaajat', 'Kilpavalmennus'],
  videos: [{ title: 'Esittelyvideo', dur: '1:24', hue: 150 }, { title: 'Harjoitteluohjelma', dur: '2:05', hue: 40 }],
};

const TAG_LABELS = { kaikki: 'Kaikki', syotto: 'Syöttö', liikkuminen: 'Liikkuminen', pistepeli: 'Pistepeli', verkkopeli: 'Verkkopeli', tekniikka: 'Tekniikka' };
const EXERCISE_TAGS = ['kaikki', 'syotto', 'liikkuminen', 'pistepeli', 'verkkopeli', 'tekniikka'];

const KC_EXERCISES = [
  { id: 0, name: 'Kakkossyöttö + suunta', goal: 'Syötön suunnan vaihtelu paineen alla — jokainen syöttö osoitetaan ennalta valittuun ruutuun.', players: '1–2', duration: '15 min', level: 'Kilpapelaajat', tags: ['syotto'] },
  { id: 1, name: 'Ristikkäispeli', goal: 'Liikkuminen ja suunnanmuutos — pallo pelataan aina vastakkaiseen kenttäpuoliskoon.', players: '4', duration: '20 min', level: 'Kaikki tasot', tags: ['liikkuminen'] },
  { id: 2, name: 'Syöttö + 1', goal: 'Syötön jälkeinen ensimmäinen lyönti — aloita piste syötöllä ja päätä se kolmen lyönnin sisällä.', players: '2', duration: '15 min', level: 'Keskitaso+', tags: ['syotto', 'pistepeli'] },
  { id: 3, name: 'Split step + verkolle nousu', goal: 'Ajoitus ja ensimmäinen askel — split step vastustajan osumahetkellä ja nousu verkolle.', players: '2', duration: '10 min', level: 'Kaikki tasot', tags: ['verkkopeli'] },
  { id: 4, name: 'Ote peilin edessä', goal: 'Perusote ja lyöntiasento ilman palloa, peilin edessä toistaen.', players: '1', duration: '10 min', level: 'Aloittelijat', tags: ['tekniikka'] },
];

// ── small shared bits ────────────────────────────────────
const backBtnStyle = { display: 'inline-flex', alignItems: 'center', gap: 5, background: '#f0ede6', border: '1px solid var(--line)', color: '#111', fontSize: 14, fontWeight: 600, padding: '8px 14px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit' };

function KCHeader({ title, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 18px 14px' }}>
      <h3 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: 'var(--green-deep)', letterSpacing: -0.5 }}>{title}</h3>
      {action}
    </div>
  );
}
function KCBar({ label, value }) {
  return (
    <div style={{ marginBottom: 11 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#8a857a' }}>{value}%</span>
      </div>
      <div style={{ height: 7, borderRadius: 99, background: '#efece4', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${value}%`, borderRadius: 99, background: 'var(--lime)' }} />
      </div>
    </div>
  );
}
function KCField({ label, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontWeight: 800, fontSize: 12.5, color: 'var(--green-deep)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>{label}</div>
      {children}
    </div>
  );
}
function KCVideoRow({ videos }) {
  if (!videos.length) return <div style={{ color: '#8a857a', fontSize: 13.5 }}>Ei vielä jaettuja videoita.</div>;
  return (
    <div className="kp-scroll-x" style={{ display: 'flex', gap: 10, overflowX: 'auto' }}>
      {videos.map((v, i) => (
        <div key={i} style={{ width: 132, flexShrink: 0 }}>
          <div style={{
            width: '100%', aspectRatio: '4/3', borderRadius: 14, position: 'relative', overflow: 'hidden',
            background: `radial-gradient(120% 120% at 30% 20%, hsl(${v.hue} 55% 45%), hsl(${v.hue + 24} 60% 22%))`,
          }}>
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="12" height="14" viewBox="0 0 12 14"><path d="M1 1v12l10-6L1 1z" fill="#101a08" /></svg>
              </span>
            </span>
            <span style={{ position: 'absolute', right: 6, bottom: 6, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10.5, fontWeight: 700, padding: '2px 6px', borderRadius: 6 }}>{v.dur}</span>
          </div>
          <div style={{ color: '#111', fontSize: 12, fontWeight: 600, marginTop: 6, lineHeight: 1.3 }}>{v.title}</div>
        </div>
      ))}
    </div>
  );
}
// ── screens ───────────────────────────────────────────────
function KCStudentsTab({ students, onOpen }) {
  return (
    <div>
      <KCHeader title="Oppilaani" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 18px' }}>
        {students.map((s) => (
          <button key={s.id} onClick={() => onOpen(s.id)} className="kp-card kp-press" style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <KC.Avatar initial={s.initial} hue={s.hue} size={44} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#111', fontWeight: 700, fontSize: 16 }}>{s.name}, {s.age}</span>
                  {s.diary.length > 0 && <span title="Uusi merkintä" style={{ width: 7, height: 7, borderRadius: '50%', background: '#46a66d', flexShrink: 0 }} />}
                </div>
                <div style={{ color: '#6b665c', fontSize: 12.5, fontWeight: 600, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Tavoite: {s.goal}</div>
              </div>
              <svg width="8" height="14" viewBox="0 0 8 14"><path d="M1 1l6 6-6 6" stroke="#c5c0b5" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function KCAddButton({ onClick, label }) {
  return (
    <button onClick={onClick} aria-label={label} style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid var(--line)', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
      <svg width="15" height="15" viewBox="0 0 15 15"><path d="M7.5 1v13M1 7.5h13" stroke="var(--green-deep)" strokeWidth="2" strokeLinecap="round" /></svg>
    </button>
  );
}

function KCTrainingsTab({ students, onAdd, onPreSession }) {
  const rows = students.flatMap((s) => s.upcoming.map((u) => ({ ...u, student: s })));
  const days = [];
  rows.forEach((r) => { if (!days.some((d) => d.day === r.day)) days.push({ day: r.day, sessions: rows.filter((x) => x.day === r.day) }); });
  return (
    <div>
      <KCHeader title="Treenit" action={<KCAddButton onClick={onAdd} label="Lisää valmennus" />} />
      <div style={{ padding: '0 18px' }}>
        {days.length === 0 && <div style={{ color: '#8a857a', fontSize: 14, padding: '4px 2px' }}>Ei tulevia valmennuksia.</div>}
        {days.map((d) => (
          <div key={d.day} style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5 }}>{d.day}</div>
              <button onClick={() => onPreSession(d)} style={{ background: 'none', border: 'none', color: 'var(--green-deep)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Ennen treeniä →</button>
            </div>
            <div className="kp-card" style={{ padding: 0, overflow: 'hidden' }}>
              {d.sessions.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: i === d.sessions.length - 1 ? 'none' : '1px solid var(--line)' }}>
                  <div style={{ width: 44, fontSize: 13.5, fontWeight: 800, color: 'var(--green-deep)', flexShrink: 0 }}>{r.time}</div>
                  <KC.Avatar initial={r.student.initial} hue={r.student.hue} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#111', fontWeight: 700, fontSize: 14.5 }}>{r.student.name}</div>
                    <div style={{ color: '#8a857a', fontSize: 12 }}>{r.type}</div>
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

function KCExercisesTab({ exercises, onOpen }) {
  const [activeTag, setActiveTag] = React.useState('kaikki');
  const filtered = activeTag === 'kaikki' ? exercises : exercises.filter((e) => e.tags.includes(activeTag));
  return (
    <div>
      <KCHeader title="Harjoitteet" />
      <div className="kp-scroll-x" style={{ display: 'flex', gap: 8, padding: '0 18px 14px', overflowX: 'auto' }}>
        {EXERCISE_TAGS.map((t) => (
          <button key={t} onClick={() => setActiveTag(t)} style={{ padding: '8px 14px', borderRadius: 999, border: activeTag === t ? 'none' : '1px solid var(--line)', background: activeTag === t ? 'var(--lime)' : '#fff', color: activeTag === t ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}>{TAG_LABELS[t]}</button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 18px' }}>
        {filtered.map((ex) => (
          <button key={ex.id} onClick={() => onOpen(ex.id)} className="kp-card kp-press" style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: '#111', fontWeight: 700, fontSize: 15 }}>{ex.name}</div>
                <div style={{ color: '#8a857a', fontSize: 12.5, marginTop: 3 }}>{ex.players} pelaajaa · {ex.duration} · {ex.level}</div>
              </div>
              <svg width="8" height="14" viewBox="0 0 8 14" style={{ flexShrink: 0 }}><path d="M1 1l6 6-6 6" stroke="#c5c0b5" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
          </button>
        ))}
        {filtered.length === 0 && <div style={{ color: '#8a857a', fontSize: 14, padding: '8px 2px' }}>Ei harjoitteita tällä suodattimella.</div>}
      </div>
    </div>
  );
}

function KCProfileTab({ coach, studentCount }) {
  return (
    <div>
      <KCHeader title="Profiili" />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '0 18px 16px' }}>
        <KC.Avatar initial={coach.initial} hue={coach.hue} size={80} ring />
        <div style={{ color: '#111', fontWeight: 800, fontSize: 21 }}>{coach.name}</div>
        <div style={{ color: '#8a857a', fontSize: 13.5 }}>{coach.tagline}</div>
      </div>
      <div style={{ padding: '0 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          {[['Oppilaita', studentCount], ['Treenejä tällä vk', 4]].map(([k, v]) => (
            <div key={k} className="kp-card" style={{ flex: 1, padding: '14px 15px' }}>
              <div style={{ color: '#8a857a', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 5 }}>{k}</div>
              <div style={{ color: '#111', fontWeight: 700, fontSize: 20 }}>{v}</div>
            </div>
          ))}
        </div>
        <p style={{ color: '#514c42', fontSize: 13.5, lineHeight: 1.5, margin: '2px 0' }}>{coach.bio}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {coach.specialties.map((s) => <KC.Chip key={s}>{s}</KC.Chip>)}
        </div>
        <div>
          <div style={{ color: 'var(--green-deep)', fontSize: 13, fontWeight: 800, letterSpacing: 0.3, margin: '4px 0 10px' }}>OMA VIDEOKIRJASTO</div>
          <KCVideoRow videos={coach.videos} />
        </div>
      </div>
    </div>
  );
}

// ── overlays ──────────────────────────────────────────────
function KCDetail({ student, onBack, onAddEntry }) {
  const [homework, setHomework] = React.useState(student.homework);
  const toggle = (i) => setHomework((h) => h.map((x, k) => k === i ? { ...x, done: !x.done } : x));
  return (
    <div className="kp-light kp-overlay" style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', borderRadius: 'inherit', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '46px 16px 6px', flexShrink: 0 }}>
        <button onClick={onBack} style={backBtnStyle}>← Takaisin</button>
      </div>
      <div className="kp-screen" style={{ flex: 1, overflowY: 'auto', padding: '6px 20px 96px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <KC.Avatar initial={student.initial} hue={student.hue} size={80} ring />
          <div style={{ color: '#111', fontWeight: 800, fontSize: 21 }}>{student.name}, {student.age}</div>
          <KCLevelChip level={student.level} />
        </div>
        <KCField label="Tavoite ja seuraava askel">
          <div className="kp-card" style={{ padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 13.5, lineHeight: 1.45 }}><b style={{ color: 'var(--green-deep)' }}>Tavoite:</b> <span style={{ color: '#111' }}>{student.goal}</span></div>
            <div style={{ fontSize: 13.5, lineHeight: 1.45 }}><b style={{ color: 'var(--green-deep)' }}>Viime treenissä:</b> <span style={{ color: '#111' }}>{student.lastSession}</span></div>
            <div style={{ fontSize: 13.5, lineHeight: 1.45 }}><b style={{ color: 'var(--green-deep)' }}>Seuraavaksi:</b> <span style={{ color: '#111' }}>{student.focus}</span></div>
          </div>
        </KCField>
        <KCField label="Kehitys">
          {Object.entries(student.progress).map(([k, v]) => <KCBar key={k} label={k} value={v} />)}
        </KCField>
        <KCField label="Videot">
          <KCVideoRow videos={student.videos} />
        </KCField>
        <KCField label="Päiväkirja">
          {student.diary.length === 0 && <div style={{ color: '#8a857a', fontSize: 13.5 }}>Ei vielä merkintöjä.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {student.diary.map((d, i) => (
              <div key={i} className="kp-card" style={{ padding: '11px 14px' }}>
                <div style={{ color: '#111', fontSize: 13.5, lineHeight: 1.45 }}>{d.text}</div>
                <div style={{ marginTop: 5, fontSize: 11.5, color: '#8a857a', fontWeight: 600 }}>{d.date}</div>
              </div>
            ))}
          </div>
        </KCField>
        {student.upcoming.length > 0 && (
          <KCField label="Tulevat treenit">
            {student.upcoming.map((u, i) => (
              <div key={i} style={{ fontSize: 14, color: '#3c382f', padding: '3px 0' }}>{u.day} · {u.time} — {u.type}</div>
            ))}
          </KCField>
        )}
        {homework.length > 0 && (
          <KCField label="Kotiläksyt">
            {homework.map((h, i) => (
              <button key={i} onClick={() => toggle(i)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0', fontFamily: 'inherit' }}>
                <span style={{ width: 18, height: 18, borderRadius: 6, border: '1.5px solid ' + (h.done ? 'var(--green-deep)' : '#c5c0b5'), background: h.done ? 'var(--green-deep)' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {h.done && <svg width="10" height="8" viewBox="0 0 10 8"><path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </span>
                <span style={{ fontSize: 14, color: '#111', textDecoration: h.done ? 'line-through' : 'none', opacity: h.done ? 0.55 : 1 }}>{h.text}</span>
              </button>
            ))}
          </KCField>
        )}
      </div>
      <div style={{ position: 'absolute', left: 18, right: 18, bottom: 18 }}>
        <button onClick={onAddEntry} style={{ width: '100%', background: 'var(--lime)', color: '#101a08', border: 'none', borderRadius: 999, padding: '16px 0', fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 8px 24px -8px rgba(20,20,10,0.25)' }}>+ Uusi päiväkirjamerkintä</button>
      </div>
    </div>
  );
}

const DICTATION_SAMPLE = 'Harjoittelimme kakkossyöttöä ja ensimmäistä lyöntiä syötön jälkeen. Heiton suunta parani, mutta vauhti hidastuu paineessa. Ensi kerralla jatketaan samoista lähtöasennoista ja lisätään pisteen aloituksia.';

function KCMicButton({ recState, onClick }) {
  const label = recState === 'idle' ? 'Sanele muistiinpano' : recState === 'recording' ? 'Sanellaan…' : 'Tekoäly kirjoittaa yhteenvedon…';
  const dotColor = recState === 'recording' ? '#e5484d' : recState === 'thinking' ? 'var(--lime)' : 'var(--green-deep)';
  return (
    <button onClick={onClick} disabled={recState !== 'idle'} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: recState === 'idle' ? '#fff' : 'rgba(207,228,20,0.14)', border: '1px solid ' + (recState === 'idle' ? '#d8d4ca' : 'var(--lime)'), borderRadius: 999, padding: '10px 16px', cursor: recState === 'idle' ? 'pointer' : 'default', fontFamily: 'inherit', fontWeight: 700, fontSize: 13, color: '#111', marginBottom: 12 }}>
      <span className={recState !== 'idle' ? 'kc-pulse' : ''} style={{ width: 9, height: 9, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
      {label}
    </button>
  );
}

function KCEntryModal({ student, onClose, onSend }) {
  const [val, setVal] = React.useState('');
  const [recState, setRecState] = React.useState('idle');
  const startDictation = () => {
    setRecState('recording');
    setTimeout(() => {
      setRecState('thinking');
      setTimeout(() => {
        setVal(DICTATION_SAMPLE);
        setRecState('idle');
      }, 900);
    }, 1300);
  };
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', borderRadius: 'inherit', overflow: 'hidden' }}>
      <div onClick={(e) => e.stopPropagation()} className="kp-sheet" style={{ width: '100%', background: '#F7F5EF', borderRadius: '24px 24px 0 0', padding: '22px 18px calc(18px + env(safe-area-inset-bottom))' }}>
        <h4 style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 800, color: '#111' }}>Päiväkirja — {student.name}</h4>
        <KCMicButton recState={recState} onClick={startDictation} />
        <textarea autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder="Esim. Hyvä nousu syötössä tällä viikolla… tai sanele yllä olevasta napista." rows={3}
          style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', resize: 'none', marginBottom: 12, background: '#fff' }} />
        <button onClick={onClose} style={{ width: '100%', background: '#e9e6df', color: '#111', border: 'none', borderRadius: 14, padding: '14px 0', fontWeight: 700, fontSize: 15, cursor: 'pointer', marginBottom: 10, fontFamily: 'inherit' }}>Peruuta</button>
        <button onClick={() => val.trim() && onSend(val.trim())} style={{ width: '100%', background: val.trim() ? 'var(--green-deep)' : '#c7c2b6', color: '#fff', border: 'none', borderRadius: 14, padding: '14px 0', fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit' }}>Tallenna merkintä</button>
      </div>
    </div>
  );
}

function KCTrainingModal({ students, onClose, onSave }) {
  const [studentId, setStudentId] = React.useState(students[0]?.id ?? null);
  const [day, setDay] = React.useState('');
  const [time, setTime] = React.useState('');
  const [type, setType] = React.useState('Yksityistunti');
  const ready = studentId != null && day.trim() && time.trim();
  const inputStyle = { flex: 1, boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };
  const Pill = ({ on, children, onClick }) => (
    <button onClick={onClick} style={{ padding: '9px 14px', borderRadius: 999, border: on ? 'none' : '1px solid #d8d4ca', background: on ? 'var(--lime)' : '#fff', color: on ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>{children}</button>
  );
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', borderRadius: 'inherit', overflow: 'hidden' }}>
      <div onClick={(e) => e.stopPropagation()} className="kp-sheet" style={{ width: '100%', background: '#F7F5EF', borderRadius: '24px 24px 0 0', padding: '22px 18px calc(18px + env(safe-area-inset-bottom))' }}>
        <h4 style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 800, color: '#111' }}>Uusi valmennus</h4>

        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Oppilas</div>
        <div className="kp-scroll-x" style={{ display: 'flex', gap: 12, overflowX: 'auto', marginBottom: 16, paddingBottom: 2 }}>
          {students.map((s) => (
            <button key={s.id} onClick={() => setStudentId(s.id)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
              <span style={{ borderRadius: '50%', padding: 2, border: studentId === s.id ? '2px solid var(--lime)' : '2px solid transparent' }}>
                <KC.Avatar initial={s.initial} hue={s.hue} size={44} />
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: studentId === s.id ? '#111' : '#8a857a' }}>{s.name.split(' ')[0]}</span>
            </button>
          ))}
        </div>

        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Ajankohta</div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <input value={day} onChange={(e) => setDay(e.target.value)} placeholder="Esim. Ma 9.6." style={inputStyle} />
          <input value={time} onChange={(e) => setTime(e.target.value)} placeholder="Klo 17:00" style={{ ...inputStyle, flex: 0.7 }} />
        </div>

        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Tyyppi</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
          {['Yksityistunti', 'Ryhmätreeni', 'Ottelu'].map((t) => <Pill key={t} on={type === t} onClick={() => setType(t)}>{t}</Pill>)}
        </div>

        <button onClick={onClose} style={{ width: '100%', background: '#e9e6df', color: '#111', border: 'none', borderRadius: 14, padding: '14px 0', fontWeight: 700, fontSize: 15, cursor: 'pointer', marginBottom: 10, fontFamily: 'inherit' }}>Peruuta</button>
        <button onClick={() => ready && onSave({ studentId, day: day.trim(), time: time.trim(), type })} style={{ width: '100%', background: ready ? 'var(--green-deep)' : '#c7c2b6', color: '#fff', border: 'none', borderRadius: 14, padding: '14px 0', fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit' }}>Lisää valmennus</button>
      </div>
    </div>
  );
}

function KCPreSessionSummary({ day, exercises, onBack }) {
  const suggestions = exercises.slice(0, 3);
  return (
    <div className="kp-light kp-overlay" style={{ position: 'absolute', inset: 0, zIndex: 55, display: 'flex', flexDirection: 'column', borderRadius: 'inherit', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '46px 16px 6px', flexShrink: 0 }}>
        <button onClick={onBack} style={backBtnStyle}>← Takaisin</button>
      </div>
      <div className="kp-screen" style={{ flex: 1, overflowY: 'auto', padding: '6px 20px 40px' }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Seuraavaksi</div>
          <div style={{ fontSize: 21, fontWeight: 800, color: '#111' }}>{day.day}</div>
        </div>
        <KCField label="Pelaajat">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {day.sessions.map((r, i) => (
              <div key={i} className="kp-card" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px' }}>
                <KC.Avatar initial={r.student.initial} hue={r.student.hue} size={38} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#111' }}>{r.student.name}</div>
                  <div style={{ fontSize: 12.5, color: '#514c42', marginTop: 2, lineHeight: 1.4 }}>Jatka: {r.student.focus}</div>
                  <div style={{ fontSize: 12, color: '#8a857a', marginTop: 1, lineHeight: 1.4 }}>Huomioi: {r.student.lastSession}</div>
                </div>
              </div>
            ))}
          </div>
        </KCField>
        <KCField label="Ehdotetut harjoitteet">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {suggestions.map((ex) => (
              <div key={ex.id} style={{ fontSize: 13.5, color: '#3c382f' }}>• {ex.name} — {ex.duration}</div>
            ))}
          </div>
        </KCField>
      </div>
    </div>
  );
}

function KCExerciseDetail({ exercise, onBack }) {
  return (
    <div className="kp-light kp-overlay" style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', borderRadius: 'inherit', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '46px 16px 6px', flexShrink: 0 }}>
        <button onClick={onBack} style={backBtnStyle}>← Takaisin</button>
      </div>
      <div className="kp-screen" style={{ flex: 1, overflowY: 'auto', padding: '10px 20px 40px' }}>
        <div style={{ fontSize: 21, fontWeight: 800, color: '#111', marginBottom: 6 }}>{exercise.name}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 16 }}>
          <KC.Chip>{exercise.players} pelaajaa</KC.Chip>
          <KC.Chip>{exercise.duration}</KC.Chip>
          <KCLevelChip level={exercise.level} />
        </div>
        <KCField label="Tavoite">
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: '#3c382f' }}>{exercise.goal}</p>
        </KCField>
        <KCField label="Teemat">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {exercise.tags.map((t) => <KC.Chip key={t}>{TAG_LABELS[t]}</KC.Chip>)}
          </div>
        </KCField>
      </div>
    </div>
  );
}

function KCToast({ show, text }) {
  return (
    <div style={{ position: 'absolute', top: 52, left: '50%', transform: `translateX(-50%) translateY(${show ? 0 : -20}px)`, opacity: show ? 1 : 0, transition: 'all .3s', zIndex: 90, background: 'var(--green-deep)', color: '#fff', padding: '10px 18px', borderRadius: 999, fontWeight: 700, fontSize: 13.5, boxShadow: '0 8px 24px -8px rgba(0,0,0,0.35)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>{text}</div>
  );
}

// ── tab bar ───────────────────────────────────────────────
const KC_TABS = [{ id: 'students', label: 'Oppilaat' }, { id: 'trainings', label: 'Treenit' }, { id: 'exercises', label: 'Harjoitteet' }, { id: 'profile', label: 'Profiili' }];
function KCTabIcon({ id, on }) {
  const c = on ? 'var(--green-deep)' : '#9a958a';
  if (id === 'profile') {
    return <div style={{ width: 22, height: 22, borderRadius: '50%', background: `radial-gradient(120% 120% at 30% 20%, hsl(${KC_COACH.hue} 55% 62%), hsl(${KC_COACH.hue + 24} 60% 38%))`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 10.5, boxShadow: on ? '0 0 0 2px var(--lime)' : 'none', opacity: on ? 1 : 0.6 }}>{KC_COACH.initial}</div>;
  }
  if (id === 'students') {
    return <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><circle cx="8" cy="6.5" r="3" stroke={c} strokeWidth="1.6" /><path d="M2 19c0-3.2 2.7-5.3 6-5.3s6 2.1 6 5.3" stroke={c} strokeWidth="1.6" strokeLinecap="round" /><circle cx="16" cy="7.5" r="2.4" stroke={c} strokeWidth="1.6" /><path d="M13.8 19c.3-2.6 2.1-4.3 4.2-4.3S21.7 16.4 22 19" stroke={c} strokeWidth="1.6" strokeLinecap="round" /></svg>;
  }
  if (id === 'exercises') {
    return <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="4" y="3" width="14" height="17" rx="2.5" stroke={c} strokeWidth="1.6" /><path d="M8 1.5h6a1 1 0 011 1V4H7V2.5a1 1 0 011-1z" stroke={c} strokeWidth="1.6" /><path d="M7.5 9.5h7M7.5 13h7M7.5 16.5h4" stroke={c} strokeWidth="1.6" strokeLinecap="round" /></svg>;
  }
  return <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2.5" y="4.5" width="17" height="15" rx="3" stroke={c} strokeWidth="1.6" /><path d="M2.5 9h17M7 2.5v4M15 2.5v4" stroke={c} strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

function KoutsiPhone({ width = 300, onScrollEl }) {
  const [tab, setTab] = React.useState('students');
  const [students, setStudents] = React.useState(KC_STUDENTS);
  const [detailId, setDetailId] = React.useState(null);
  const [entryOpen, setEntryOpen] = React.useState(false);
  const [trainingOpen, setTrainingOpen] = React.useState(false);
  const [exerciseId, setExerciseId] = React.useState(null);
  const [presessionDay, setPresessionDay] = React.useState(null);
  const [toast, setToast] = React.useState(false);
  const [toastText, setToastText] = React.useState('');
  const scrollRef = React.useRef(null);
  React.useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [tab]);
  React.useEffect(() => { if (onScrollEl && scrollRef.current) onScrollEl(scrollRef.current); }, []);

  const goTab = (id) => { setDetailId(null); setEntryOpen(false); setTrainingOpen(false); setExerciseId(null); setPresessionDay(null); setTab(id); };
  const detail = detailId != null ? students.find((s) => s.id === detailId) : null;
  const exercise = exerciseId != null ? KC_EXERCISES.find((e) => e.id === exerciseId) : null;

  const flashToast = (text) => { setToastText(text); setToast(true); setTimeout(() => setToast(false), 1900); };

  const saveEntry = (text) => {
    setStudents((list) => list.map((s) => s.id === detailId ? { ...s, diary: [{ date: 'Juuri nyt', text }, ...s.diary] } : s));
    setEntryOpen(false);
    flashToast('Merkintä lisätty ✓');
  };

  const addTraining = ({ studentId, day, time, type }) => {
    setStudents((list) => list.map((s) => s.id === studentId ? { ...s, upcoming: [...s.upcoming, { day, time, type }] } : s));
    setTrainingOpen(false);
    flashToast('Valmennus lisätty ✓');
  };

  const h = Math.round(width * 2.06);

  return (
    <div style={{ width, height: h, position: 'relative', borderRadius: width * 0.16, background: '#0a0a0a', padding: width * 0.028, boxShadow: '0 0 0 1.5px rgba(0,0,0,0.4)' }}>
      <div className="kp-light" style={{ width: '100%', height: '100%', borderRadius: width * 0.135, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'absolute', top: 9, left: '50%', transform: 'translateX(-50%)', width: width * 0.3, height: width * 0.085, borderRadius: 99, background: '#000', zIndex: 90 }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 22px 6px', color: '#111', flexShrink: 0, zIndex: 85, position: 'relative' }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>12.44</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="16" height="11" viewBox="0 0 16 11"><path d="M8 2.6c2 0 3.8.8 5.1 2.1l1-1C12.5 2 10.4 1 8 1S3.5 2 1.9 3.7l1 1C4.2 3.4 6 2.6 8 2.6z" fill="#111" /><path d="M8 5.6c1.2 0 2.3.5 3.1 1.3l1-1C11 4.8 9.6 4.2 8 4.2s-3 .6-4.1 1.7l1 1C5.7 6.1 6.8 5.6 8 5.6z" fill="#111" /><circle cx="8" cy="9" r="1.4" fill="#111" /></svg>
            <svg width="24" height="11" viewBox="0 0 24 11"><rect x="0.5" y="0.5" width="20" height="10" rx="3" stroke="#111" strokeOpacity="0.6" fill="none" /><rect x="2" y="2" width="16" height="7" rx="1.5" fill="#111" /><path d="M22 3.5v4c.7-.3 1.2-1 1.2-2s-.5-1.7-1.2-2z" fill="#111" fillOpacity="0.6" /></svg>
          </div>
        </div>
        <div ref={scrollRef} className="kp-screen" style={{ flex: 1, overflowY: 'auto', paddingTop: 6, paddingBottom: 86 }}>
          {tab === 'students' && <KCStudentsTab students={students} onOpen={setDetailId} />}
          {tab === 'trainings' && <KCTrainingsTab students={students} onAdd={() => setTrainingOpen(true)} onPreSession={setPresessionDay} />}
          {tab === 'exercises' && <KCExercisesTab exercises={KC_EXERCISES} onOpen={setExerciseId} />}
          {tab === 'profile' && <KCProfileTab coach={KC_COACH} studentCount={students.length} />}
        </div>

        <div style={{ position: 'absolute', left: 10, right: 10, bottom: 10, height: 62, borderRadius: 22, background: 'rgba(255,255,255,0.82)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid var(--line)', display: 'flex', zIndex: 30, boxShadow: '0 8px 24px -12px rgba(0,0,0,0.18)' }}>
          {KC_TABS.map((t) => {
            const on = tab === t.id;
            const fs = t.label.length > 9 ? 9.5 : 10.5;
            return (
              <button key={t.id} onClick={() => goTab(t.id)} style={{ flex: 1, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, padding: 0, fontFamily: 'inherit' }}>
                <KCTabIcon id={t.id} on={on} />
                <span style={{ fontSize: fs, fontWeight: on ? 700 : 500, color: on ? 'var(--green-deep)' : '#9a958a' }}>{t.label}</span>
              </button>
            );
          })}
        </div>

        {detail && <KCDetail student={detail} onBack={() => setDetailId(null)} onAddEntry={() => setEntryOpen(true)} />}
        {detail && entryOpen && <KCEntryModal student={detail} onClose={() => setEntryOpen(false)} onSend={saveEntry} />}
        {trainingOpen && <KCTrainingModal students={students} onClose={() => setTrainingOpen(false)} onSave={addTraining} />}
        {exercise && <KCExerciseDetail exercise={exercise} onBack={() => setExerciseId(null)} />}
        {presessionDay && <KCPreSessionSummary day={presessionDay} exercises={KC_EXERCISES} onBack={() => setPresessionDay(null)} />}
        <KCToast show={toast} text={toastText} />

        <div style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', width: width * 0.3, height: 4, borderRadius: 99, background: 'rgba(0,0,0,0.25)', zIndex: 95 }} />
      </div>
    </div>
  );
}

Object.assign(window, { KoutsiPhone });
