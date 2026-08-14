// koutsi-data.js — shared seed data + localStorage-backed store for the Koutsi demo.
// koutsi-valmentaja.html (coach) and koutsi-pelaaja.html (player) both read/write the
// same store key, so an action taken in one view (a new diary entry, a checked-off
// homework item, a new training) is visible in the other — no backend needed for the demo.

const KOUTSI_STORE_KEY = 'krossiKoutsiDemoV7';

const KOUTSI_SEED = {
  // The full profile shown in the coach app's own Profiili tab — "you", logged in as Anna.
  coach: {
    id: 0, initial: 'A', hue: 150, name: 'Anna Koskinen', tagline: 'Tennisvalmentaja · Lahti',
    bio: 'Valmennan juniori- ja aikuispelaajia. Erikoisalana lyöntitekniikka ja kilpapelaajien fysiikka.',
    specialties: ['Yksityistunnit', 'Ryhmätreenit', 'Junioripelaajat', 'Kilpavalmennus'],
  },
  // All coaches at the club — used to show players which coach runs which group/session.
  coaches: [
    { id: 0, initial: 'A', hue: 150, name: 'Anna Koskinen' },
    { id: 1, initial: 'J', hue: 25, name: 'Juho Aalto' },
  ],
  students: [
    {
      id: 0, initial: 'M', hue: 205, name: 'Maria K.', age: 16, level: 'Kilpapelaaja',
      goal: 'Varmempi kakkossyöttö ja rohkeampi verkkopeli',
      lastSession: 'Kämmenen valmistautuminen myöhässä',
      focus: 'Split step + ensimmäinen askel',
      diary: [
        { date: '2 pv sitten', text: 'Hyvä nousu syötössä tällä viikolla — jatka samaan malliin.' },
        { date: '1 vko sitten', text: 'Aloitettiin uusi lyöntitekniikka forehandiin.' },
      ],
      videos: [
        { id: 0, title: 'Syöttöanalyysi', hue: 205, date: '2026-07-05', tags: ['syotto'], addedBy: 'coach' },
        { id: 1, title: 'Forehand vertailu', hue: 150, date: '2026-06-28', tags: ['tekniikka'], addedBy: 'coach' },
      ],
      homework: [{ text: '10 min syöttöharjoittelua päivässä', done: false }],
      playerNote: '',
      playerWish: 'Haluaisin harjoitella enemmän verkkopeliä ensi kerralla.',
    },
    {
      id: 1, initial: 'A', hue: 150, name: 'Aleksi R.', age: 14, level: 'Keskitaso',
      goal: 'Backhandin tasapaino pitkissä vaihdoissa',
      lastSession: 'Liikkeen aloitus parani huomattavasti',
      focus: 'Askelkuvio ennen lyöntiä',
      diary: [{ date: 'Eilen', text: 'Backhand parani huomattavasti — hyvä liikkeen aloitus.' }],
      videos: [
        { id: 0, title: 'Backhand-analyysi', hue: 20, date: '2026-07-08', tags: ['tekniikka'], addedBy: 'coach' },
      ],
      homework: [{ text: 'Katso videoanalyysi backhandista', done: true }],
      playerNote: '',
      playerWish: '',
    },
    {
      id: 2, initial: 'E', hue: 40, name: 'Emma L.', age: 12, level: 'Aloittelija',
      goal: 'Luonteva ote ja perusasento',
      lastSession: 'Ensimmäinen kerta, tutustuttiin mailaan',
      focus: 'Mailan ote peilin edessä',
      diary: [],
      videos: [],
      homework: [{ text: 'Harjoittele otetta peilin edessä', done: false }],
      playerNote: '',
      playerWish: '',
    },
    {
      id: 3, initial: 'J', hue: 0, name: 'Joonas P.', age: 17, level: 'Edistynyt',
      goal: 'Nelinpelitaktiikan syventäminen',
      lastSession: 'Nelinpelitaktiikka istui hyvin',
      focus: 'Verkkopelin sijoittuminen',
      diary: [
        { date: '4 pv sitten', text: 'Nelinpelitaktiikka istui hyvin — jatketaan verkkopeliä ensi kerralla.' },
        { date: '2 vko sitten', text: 'Kuntotestit tehty, hyvä lähtötaso koko kaudelle.' },
      ],
      videos: [
        { id: 0, title: 'Verkkopelin sijoittuminen', hue: 280, date: '2026-07-01', tags: ['verkkopeli'], addedBy: 'coach' },
      ],
      homework: [],
      playerNote: '',
      playerWish: 'Nelinpeliä lisää — se on kivointa juuri nyt.',
    },
    {
      id: 4, initial: 'P', hue: 90, name: 'Petri Virtanen', age: 34, level: 'Keskitaso',
      goal: 'Rystyslyönnin varmuus ja kestävyys pitkissä peleissä',
      lastSession: 'Kunto nousi hyvin, lyönnit tarkentuivat loppua kohden',
      focus: 'Jalkatyö sivuttaisliikkeessä',
      diary: [
        { date: '3 pv sitten', text: 'Hyvä treeni — rystyslyönti pysyi tasaisena koko session ajan.' },
      ],
      videos: [
        { id: 0, title: 'Rystyslyönti hidastettuna', hue: 90, date: '2026-07-03', tags: ['tekniikka'], addedBy: 'coach' },
      ],
      homework: [{ text: '15 min jalkatyöharjoittelua 2x viikossa', done: false }],
      playerNote: '',
      playerWish: '',
    },
    {
      id: 5, initial: 'L', hue: 320, name: 'Liisa Mäkinen', age: 41, level: 'Kilpapelaaja',
      goal: 'Syötön jälkeisen pisteen hallinta kilpailuissa',
      lastSession: 'Pelasi harjoitusottelun, syöttöpeli toimi hyvin',
      focus: 'Palautuslyönnin syvyys',
      diary: [
        { date: '5 pv sitten', text: 'Harjoitusottelu meni hyvin — syöttöprosentti pysyi korkealla paineen alla.' },
        { date: '2 vko sitten', text: 'Aloitettiin uusi lämmittelyrutiini ennen otteluita.' },
      ],
      videos: [],
      homework: [{ text: 'Katso oma ottelutallenne ja merkitse 3 kehityskohdetta', done: false }],
      playerNote: 'Otin ottelusta paljon oppia, kiitos avusta!',
      playerWish: 'Haluaisin harjoitella lisää palautuslyöntejä kovaan syöttöön.',
    },
  ],
  groups: [
    {
      id: 0, name: 'Kilpajuniorit', level: 'Kilpapelaajat', day: 'Ke', time: '17:00', memberIds: [0, 3], coachId: 0,
      theme: { title: 'Kämmenen pelitila', lead: 'Valmistautuminen alkaa heti vastustajan osumasta — treenataan ensimmäistä askelta ja lyönnin jälkeistä palautumista.' },
    },
    {
      id: 1, name: 'Keskitason ryhmä', level: 'Keskitaso', day: 'To', time: '16:00', memberIds: [1], coachId: 0,
      theme: { title: 'Askelkuvio ennen lyöntiä', lead: 'Keskitytään siihen, että jalat ehtivät oikeaan asentoon ennen jokaista lyöntiä — ei hätäisiä käsivarsilyöntejä.' },
    },
    {
      id: 2, name: 'Alkeisryhmä', level: 'Aloittelijat', day: 'La', time: '10:00', memberIds: [2], coachId: 1,
      theme: { title: 'Ote ja perusasento', lead: 'Harjoitellaan luontevaa mailanotetta ja valmiusasentoa — perusta kaikelle muulle.' },
    },
    {
      id: 3, name: 'Kesäleiri', level: 'Kaikki tasot', day: 'Su', time: '12:00', memberIds: [0, 1, 2, 3], coachId: 0,
      theme: { title: 'Ottelupelit ja taktiikka', lead: 'Kausi huipentuu yhteisiin ottelupeleihin — pelataan täysillä ja katsotaan missä kukin menee.' },
    },
  ],
  // `trainings` is filled in at load time (see koutsiBuildSeedTrainings) so the demo
  // always shows upcoming sessions relative to today, instead of dates baked in once and
  // silently drifting into the past the longer this file sits deployed.
  trainings: [],
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
  const seed = koutsiClone(KOUTSI_SEED);
  seed.trainings = koutsiBuildSeedTrainings();
  return seed;
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
function koutsiOffsetDateStr(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${koutsiPad(d.getMonth() + 1)}-${koutsiPad(d.getDate())}`;
}
// Days until the next occurrence of a weekday (0=Sun..6=Sat), never today itself.
function koutsiNextWeekdayOffset(targetDow) {
  const diff = (targetDow - new Date().getDay() + 7) % 7;
  return diff === 0 ? 7 : diff;
}
// Builds fresh demo training instances relative to "today", so the calendar and
// upcoming lists always look alive no matter when the demo is opened. Kilpajuniorit
// meets Wednesdays, Keskitason ryhmä Thursdays, Alkeisryhmä Saturdays — sessions land
// on the matching real weekday, two weeks out for each group.
function koutsiBuildSeedTrainings() {
  const kilpa = koutsiNextWeekdayOffset(3);
  const keski = koutsiNextWeekdayOffset(4);
  const alkeis = koutsiNextWeekdayOffset(6);
  const kesaleiri = koutsiNextWeekdayOffset(0);
  return [
    { id: 0, date: koutsiOffsetDateStr(2), time: '17:00', type: 'Yksityistunti', studentId: 0, groupId: null, coachId: 0 },
    { id: 1, date: koutsiOffsetDateStr(kilpa), time: '17:00', type: 'Ryhmätreeni', studentId: null, groupId: 0, coachId: 0 },
    { id: 2, date: koutsiOffsetDateStr(keski), time: '16:00', type: 'Ryhmätreeni', studentId: null, groupId: 1, coachId: 0 },
    { id: 3, date: koutsiOffsetDateStr(alkeis), time: '10:00', type: 'Ryhmätreeni', studentId: null, groupId: 2, coachId: 1 },
    { id: 4, date: koutsiOffsetDateStr(kilpa + 7), time: '17:00', type: 'Ryhmätreeni', studentId: null, groupId: 0, coachId: 0 },
    { id: 5, date: koutsiOffsetDateStr(keski + 7), time: '16:00', type: 'Ryhmätreeni', studentId: null, groupId: 1, coachId: 0 },
    { id: 6, date: koutsiOffsetDateStr(alkeis + 7), time: '10:00', type: 'Ryhmätreeni', studentId: null, groupId: 2, coachId: 1 },
    { id: 7, date: koutsiOffsetDateStr(21), time: '11:00', type: 'Ottelu', studentId: 3, groupId: null, coachId: 0 },
    { id: 8, date: koutsiOffsetDateStr(kesaleiri), time: '12:00', type: 'Ryhmätreeni', studentId: null, groupId: 3, coachId: 0 },
    { id: 9, date: koutsiOffsetDateStr(4), time: '18:00', type: 'Yksityistunti', studentId: 4, groupId: null, coachId: 0 },
    { id: 10, date: koutsiOffsetDateStr(9), time: '19:00', type: 'Ottelu', studentId: 5, groupId: null, coachId: 1 },
  ];
}

function koutsiStudentById(state, id) { return state.students.find((s) => s.id === id) || null; }
function koutsiGroupById(state, id) { return state.groups.find((g) => g.id === id) || null; }
function koutsiGroupForStudent(state, studentId) { return state.groups.find((g) => g.memberIds.includes(studentId)) || null; }
function koutsiGroupsForStudent(state, studentId) { return state.groups.filter((g) => g.memberIds.includes(studentId)); }
function koutsiCoachById(state, id) { return state.coaches.find((c) => c.id === id) || null; }

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
  const groups = koutsiGroupsForStudent(state, studentId);
  const groupIds = groups.map((g) => g.id);
  return state.trainings
    .filter((t) => t.studentId === studentId || (t.groupId != null && groupIds.includes(t.groupId)))
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
function koutsiNextExerciseId(state) {
  return state.exercises.reduce((max, e) => Math.max(max, e.id), -1) + 1;
}
function koutsiNextVideoId(student) {
  return student.videos.reduce((max, v) => Math.max(max, v.id), -1) + 1;
}

// Consistent level → color mapping used across the landing demo, coach app, and player app.
const KOUTSI_LEVEL_COLORS = {
  aloitt: { bg: 'rgba(214,140,44,0.14)', fg: '#8a5a12', border: 'rgba(214,140,44,0.35)' },
  keski: { bg: 'rgba(58,130,212,0.12)', fg: '#2a5d94', border: 'rgba(58,130,212,0.32)' },
  edist: { bg: 'rgba(148,88,214,0.12)', fg: '#6a389c', border: 'rgba(148,88,214,0.32)' },
  kilpa: { bg: 'rgba(180,205,20,0.22)', fg: '#5c6b06', border: 'rgba(180,205,20,0.55)' },
};
function koutsiLevelColor(level) {
  const l = (level || '').toLowerCase();
  const key = Object.keys(KOUTSI_LEVEL_COLORS).find((k) => l.includes(k));
  return key ? KOUTSI_LEVEL_COLORS[key] : { bg: '#f4f2ec', fg: '#6b665c', border: '#d8d4ca' };
}

const KOUTSI_TAG_LABELS = { syotto: 'Syöttö', liikkuminen: 'Liikkuminen', pistepeli: 'Pistepeli', verkkopeli: 'Verkkopeli', tekniikka: 'Tekniikka' };
const KOUTSI_TAGS = ['syotto', 'liikkuminen', 'pistepeli', 'verkkopeli', 'tekniikka'];

Object.assign(window, {
  KOUTSI_SEED, KOUTSI_STORE_KEY, koutsiLoadState, koutsiSaveState, koutsiResetState,
  koutsiTodayStr, koutsiFmtShortDate, koutsiFmtLongDate, koutsiDateFromStr,
  koutsiStudentById, koutsiGroupById, koutsiGroupForStudent, koutsiGroupsForStudent, koutsiCoachById, koutsiTrainingParty,
  koutsiTrainingsForStudent, koutsiUpcomingTrainingsForStudent, koutsiTrainingsForGroup,
  koutsiTrainingsOnDate, koutsiNextTrainingId, koutsiNextExerciseId, koutsiNextVideoId, koutsiLevelColor,
  KOUTSI_WEEKDAYS, KOUTSI_WEEKDAYS_LONG, KOUTSI_MONTHS, KOUTSI_TAG_LABELS, KOUTSI_TAGS,
});
