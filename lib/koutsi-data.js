// koutsi-data.js — shared seed data + localStorage-backed store for the Koutsi demo.
// koutsi-valmentaja.html (coach) and koutsi-pelaaja.html (player) both read/write the
// same store key, so an action taken in one view (a new diary entry, a checked-off
// homework item, a new training) is visible in the other — no backend needed for the demo.

const KOUTSI_STORE_KEY = 'krossiKoutsiDemoV3';

const KOUTSI_SEED = {
  coach: {
    initial: 'A', hue: 150, name: 'Anna Koskinen', tagline: 'Tennisvalmentaja · Lahti',
    bio: 'Valmennan juniori- ja aikuispelaajia. Erikoisalana lyöntitekniikka ja kilpapelaajien fysiikka.',
    specialties: ['Yksityistunnit', 'Ryhmätreenit', 'Junioripelaajat', 'Kilpavalmennus'],
    videos: [{ title: 'Esittelyvideo', dur: '1:24', hue: 150 }, { title: 'Harjoitteluohjelma', dur: '2:05', hue: 40 }],
  },
  students: [
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
      homework: [{ text: '10 min syöttöharjoittelua päivässä', done: false }],
      playerNote: '',
    },
    {
      id: 1, initial: 'A', hue: 150, name: 'Aleksi R.', age: 14, level: 'Keskitaso',
      goal: 'Backhandin tasapaino pitkissä vaihdoissa',
      lastSession: 'Liikkeen aloitus parani huomattavasti',
      focus: 'Askelkuvio ennen lyöntiä',
      progress: { Tekniikka: 60, Kunto: 72, Taktiikka: 55 },
      diary: [{ date: 'Eilen', text: 'Backhand parani huomattavasti — hyvä liikkeen aloitus.' }],
      videos: [{ title: 'Backhand-analyysi', dur: '0:35', hue: 20 }],
      homework: [{ text: 'Katso videoanalyysi backhandista', done: true }],
      playerNote: '',
    },
    {
      id: 2, initial: 'E', hue: 40, name: 'Emma L.', age: 12, level: 'Aloittelija',
      goal: 'Luonteva ote ja perusasento',
      lastSession: 'Ensimmäinen kerta, tutustuttiin mailaan',
      focus: 'Mailan ote peilin edessä',
      progress: { Tekniikka: 35, Kunto: 40, Taktiikka: 25 },
      diary: [],
      videos: [],
      homework: [{ text: 'Harjoittele otetta peilin edessä', done: false }],
      playerNote: '',
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
      homework: [],
      playerNote: '',
    },
  ],
  groups: [
    { id: 0, name: 'Kilpajuniorit', level: 'Kilpapelaajat', day: 'Ke', time: '17:00', memberIds: [0, 3] },
    { id: 1, name: 'Keskitason ryhmä', level: 'Keskitaso', day: 'To', time: '16:00', memberIds: [1] },
    { id: 2, name: 'Alkeisryhmä', level: 'Aloittelijat', day: 'La', time: '10:00', memberIds: [2] },
  ],
  // Trainings are dated instances, each tied to either one student (studentId) or a whole group (groupId).
  trainings: [
    { id: 0, date: '2026-07-14', time: '17:00', type: 'Yksityistunti', studentId: 0, groupId: null },
    { id: 1, date: '2026-07-15', time: '17:00', type: 'Ryhmätreeni', studentId: null, groupId: 0 },
    { id: 2, date: '2026-07-16', time: '16:00', type: 'Ryhmätreeni', studentId: null, groupId: 1 },
    { id: 3, date: '2026-07-18', time: '10:00', type: 'Ryhmätreeni', studentId: null, groupId: 2 },
    { id: 4, date: '2026-07-22', time: '17:00', type: 'Ryhmätreeni', studentId: null, groupId: 0 },
    { id: 5, date: '2026-07-23', time: '16:00', type: 'Ryhmätreeni', studentId: null, groupId: 1 },
    { id: 6, date: '2026-07-25', time: '10:00', type: 'Ryhmätreeni', studentId: null, groupId: 2 },
    { id: 7, date: '2026-08-01', time: '11:00', type: 'Ottelu', studentId: 3, groupId: null },
  ],
  exercises: [
    { id: 0, name: 'Kakkossyöttö + suunta', goal: 'Syötön suunnan vaihtelu paineen alla — jokainen syöttö osoitetaan ennalta valittuun ruutuun.', players: '1–2', duration: '15 min', level: 'Kilpapelaajat', tags: ['syotto'] },
    { id: 1, name: 'Ristikkäispeli', goal: 'Liikkuminen ja suunnanmuutos — pallo pelataan aina vastakkaiseen kenttäpuoliskoon.', players: '4', duration: '20 min', level: 'Kaikki tasot', tags: ['liikkuminen'] },
    { id: 2, name: 'Syöttö + 1', goal: 'Syötön jälkeinen ensimmäinen lyönti — aloita piste syötöllä ja päätä se kolmen lyönnin sisällä.', players: '2', duration: '15 min', level: 'Keskitaso+', tags: ['syotto', 'pistepeli'] },
    { id: 3, name: 'Split step + verkolle nousu', goal: 'Ajoitus ja ensimmäinen askel — split step vastustajan osumahetkellä ja nousu verkolle.', players: '2', duration: '10 min', level: 'Kaikki tasot', tags: ['verkkopeli'] },
    { id: 4, name: 'Ote peilin edessä', goal: 'Perusote ja lyöntiasento ilman palloa, peilin edessä toistaen.', players: '1', duration: '10 min', level: 'Aloittelijat', tags: ['tekniikka'] },
  ],
};

function koutsiClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function koutsiLoadState() {
  try {
    const raw = window.localStorage.getItem(KOUTSI_STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* localStorage unavailable — fall through to seed */ }
  return koutsiClone(KOUTSI_SEED);
}

function koutsiSaveState(state) {
  try { window.localStorage.setItem(KOUTSI_STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

function koutsiResetState() {
  try { window.localStorage.removeItem(KOUTSI_STORE_KEY); } catch (e) { /* ignore */ }
}

// ── date + lookup helpers, shared by the coach and player apps ──────────
function koutsiPad(n) { return String(n).padStart(2, '0'); }
function koutsiTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${koutsiPad(d.getMonth() + 1)}-${koutsiPad(d.getDate())}`;
}
const KOUTSI_WEEKDAYS = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
const KOUTSI_WEEKDAYS_LONG = ['sunnuntai', 'maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'lauantai'];
const KOUTSI_MONTHS = ['tammikuu', 'helmikuu', 'maaliskuu', 'huhtikuu', 'toukokuu', 'kesäkuu', 'heinäkuu', 'elokuu', 'syyskuu', 'lokakuu', 'marraskuu', 'joulukuu'];

function koutsiDateFromStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function koutsiFmtShortDate(dateStr) {
  const dt = koutsiDateFromStr(dateStr);
  return `${KOUTSI_WEEKDAYS[dt.getDay()]} ${dt.getDate()}.${dt.getMonth() + 1}.`;
}
function koutsiFmtLongDate(dateStr) {
  const dt = koutsiDateFromStr(dateStr);
  return `${KOUTSI_WEEKDAYS_LONG[dt.getDay()]} ${dt.getDate()}. ${KOUTSI_MONTHS[dt.getMonth()]}ta`;
}

function koutsiStudentById(state, id) { return state.students.find((s) => s.id === id) || null; }
function koutsiGroupById(state, id) { return state.groups.find((g) => g.id === id) || null; }
function koutsiGroupForStudent(state, studentId) { return state.groups.find((g) => g.memberIds.includes(studentId)) || null; }

// Resolves who a training is for — a lone student, or a group (with its member list).
function koutsiTrainingParty(state, training) {
  if (training.groupId != null) {
    const group = koutsiGroupById(state, training.groupId);
    const members = group ? group.memberIds.map((id) => koutsiStudentById(state, id)).filter(Boolean) : [];
    return { kind: 'group', group, members };
  }
  return { kind: 'student', student: koutsiStudentById(state, training.studentId) };
}

function koutsiTrainingsForStudent(state, studentId) {
  const group = koutsiGroupForStudent(state, studentId);
  return state.trainings
    .filter((t) => t.studentId === studentId || (group && t.groupId === group.id))
    .slice()
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
function koutsiUpcomingTrainingsForStudent(state, studentId) {
  const today = koutsiTodayStr();
  return koutsiTrainingsForStudent(state, studentId).filter((t) => t.date >= today);
}
function koutsiTrainingsForGroup(state, groupId) {
  return state.trainings.filter((t) => t.groupId === groupId).slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
function koutsiTrainingsOnDate(state, dateStr) {
  return state.trainings.filter((t) => t.date === dateStr).slice().sort((a, b) => a.time.localeCompare(b.time));
}
function koutsiNextTrainingId(state) {
  return state.trainings.reduce((max, t) => Math.max(max, t.id), -1) + 1;
}

Object.assign(window, {
  KOUTSI_SEED, KOUTSI_STORE_KEY, koutsiLoadState, koutsiSaveState, koutsiResetState,
  koutsiTodayStr, koutsiFmtShortDate, koutsiFmtLongDate, koutsiDateFromStr,
  koutsiStudentById, koutsiGroupById, koutsiGroupForStudent, koutsiTrainingParty,
  koutsiTrainingsForStudent, koutsiUpcomingTrainingsForStudent, koutsiTrainingsForGroup,
  koutsiTrainingsOnDate, koutsiNextTrainingId,
  KOUTSI_WEEKDAYS, KOUTSI_WEEKDAYS_LONG, KOUTSI_MONTHS,
});
