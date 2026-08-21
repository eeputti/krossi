// koutsi-demo-data.js — shared seed data + localStorage-backed store for the Koutsi sales demo
// (served at demo.koutsi.krossi.app). koutsi-valmentaja-demo.html (coach) and
// koutsi-pelaaja-demo.html (player) both read/write the same store key, so an action taken in
// one view (a new diary entry, a checked-off homework item, a new training) is visible in the
// other — no backend needed for the demo. This is separate from the real Supabase-backed app.

const KOUTSI_STORE_KEY = 'krossiKoutsiDemoV12';

const KOUTSI_SEED = {
  // The full profile shown in the coach app's own Profiili tab — "you", logged in as Anna.
  coach: {
    id: 0, initial: 'A', hue: 150, name: 'Anna Koskinen', tagline: 'Tennisvalmentaja · Lahti',
    bio: 'Valmennan juniori- ja aikuispelaajia. Erikoisalana lyöntitekniikka ja kilpapelaajien fysiikka.',
    experience: '12 vuotta valmennuskokemusta · Suomen Tennisliiton tason 2 valmentajakoulutus',
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
        { daysAgo: 2, text: 'Hyvä nousu syötössä tällä viikolla — jatka samaan malliin.' },
        { daysAgo: 7, text: 'Aloitettiin uusi lyöntitekniikka forehandiin.' },
      ],
      videos: [
        { id: 0, title: 'Syöttöanalyysi', hue: 205, daysAgo: 45, tags: ['syotto'], addedBy: 'coach' },
        { id: 1, title: 'Forehand vertailu', hue: 150, daysAgo: 52, tags: ['tekniikka'], addedBy: 'coach' },
      ],
      homework: [{ text: '10 min syöttöharjoittelua päivässä', done: false, daysAgo: 8 }],
      playerNote: '',
      playerWish: 'Haluaisin harjoitella enemmän verkkopeliä ensi kerralla.',
      background: 'Vanha nilkkavamma (2025) — vältä äkkinäisiä suunnanmuutoksia alkulämmittelyssä. Tavoitteena SM-kisat keväällä.',
      moods: [],
      matchNotes: [],
    },
    {
      id: 1, initial: 'A', hue: 150, name: 'Aleksi R.', age: 14, level: 'Keskitaso',
      goal: 'Backhandin tasapaino pitkissä vaihdoissa',
      lastSession: 'Liikkeen aloitus parani huomattavasti',
      focus: 'Askelkuvio ennen lyöntiä',
      diary: [{ daysAgo: 1, text: 'Backhand parani huomattavasti — hyvä liikkeen aloitus.' }],
      videos: [
        { id: 0, title: 'Backhand-analyysi', hue: 20, daysAgo: 42, tags: ['tekniikka'], addedBy: 'coach' },
      ],
      homework: [{ text: 'Katso videoanalyysi backhandista', done: true, daysAgo: 13 }],
      playerNote: '',
      playerWish: '',
      background: '',
      moods: [],
      matchNotes: [],
    },
    {
      id: 2, initial: 'E', hue: 40, name: 'Emma L.', age: 12, level: 'Aloittelija',
      goal: 'Luonteva ote ja perusasento',
      lastSession: 'Ensimmäinen kerta, tutustuttiin mailaan',
      focus: 'Mailan ote peilin edessä',
      diary: [],
      videos: [],
      homework: [{ text: 'Harjoittele otetta peilin edessä', done: false, daysAgo: 18 }],
      playerNote: '',
      playerWish: '',
      background: '',
      moods: [],
      matchNotes: [],
    },
    {
      id: 3, initial: 'J', hue: 0, name: 'Joonas P.', age: 17, level: 'Edistynyt',
      goal: 'Nelinpelitaktiikan syventäminen',
      lastSession: 'Nelinpelitaktiikka istui hyvin',
      focus: 'Verkkopelin sijoittuminen',
      diary: [
        { daysAgo: 4, text: 'Nelinpelitaktiikka istui hyvin — jatketaan verkkopeliä ensi kerralla.' },
        { daysAgo: 14, text: 'Kuntotestit tehty, hyvä lähtötaso koko kaudelle.' },
      ],
      videos: [
        { id: 0, title: 'Verkkopelin sijoittuminen', hue: 280, daysAgo: 49, tags: ['verkkopeli'], addedBy: 'coach' },
      ],
      homework: [],
      playerNote: '',
      playerWish: 'Nelinpeliä lisää — se on kivointa juuri nyt.',
      background: '',
      moods: [],
      matchNotes: [],
    },
    {
      id: 4, initial: 'P', hue: 90, name: 'Petri Virtanen', age: 34, level: 'Keskitaso',
      goal: 'Rystyslyönnin varmuus ja kestävyys pitkissä peleissä',
      lastSession: 'Kunto nousi hyvin, lyönnit tarkentuivat loppua kohden',
      focus: 'Jalkatyö sivuttaisliikkeessä',
      diary: [
        { daysAgo: 3, text: 'Hyvä treeni — rystyslyönti pysyi tasaisena koko session ajan.' },
      ],
      videos: [
        { id: 0, title: 'Rystyslyönti hidastettuna', hue: 90, daysAgo: 47, tags: ['tekniikka'], addedBy: 'coach' },
      ],
      homework: [{ text: '15 min jalkatyöharjoittelua 2x viikossa', done: false, daysAgo: 23 }],
      playerNote: '',
      playerWish: '',
      background: 'Aikuispelaaja, harrastaa kilpaa kunnon vuoksi. Polven kunto seurannassa — kevyempi kuormitus tarvittaessa.',
      moods: [],
      matchNotes: [],
    },
    {
      id: 5, initial: 'L', hue: 320, name: 'Liisa Mäkinen', age: 41, level: 'Kilpapelaaja',
      goal: 'Syötön jälkeisen pisteen hallinta kilpailuissa',
      lastSession: 'Pelasi harjoitusottelun, syöttöpeli toimi hyvin',
      focus: 'Palautuslyönnin syvyys',
      diary: [
        { daysAgo: 5, text: 'Harjoitusottelu meni hyvin — syöttöprosentti pysyi korkealla paineen alla.' },
        { daysAgo: 14, text: 'Aloitettiin uusi lämmittelyrutiini ennen otteluita.' },
      ],
      videos: [],
      homework: [{ text: 'Katso oma ottelutallenne ja merkitse 3 kehityskohdetta', done: false, daysAgo: 28 }],
      playerNote: 'Otin ottelusta paljon oppia, kiitos avusta!',
      playerWish: 'Haluaisin harjoitella lisää palautuslyöntejä kovaan syöttöön.',
      background: '',
      moods: [],
      matchNotes: [],
    },
    {
      id: 6, initial: 'E', hue: 260, name: 'Ella Nieminen', age: 15, level: 'Kilpapelaaja',
      goal: 'Nopeampi palautuminen pitkän pelin jälkeen',
      lastSession: 'Kuntotestit menivät hyvin, lyöntivarmuus parani',
      focus: 'Hengitys ja palautuminen pisteiden välissä',
      diary: [{ daysAgo: 6, text: 'Hyvä intensiteetti koko treenin ajan — jatketaan samalla linjalla.' }],
      videos: [],
      homework: [{ text: 'Palautumisharjoitus pisteiden välissä, 10 min', done: false, daysAgo: 7 }],
      playerNote: '',
      playerWish: '',
      background: '',
      moods: [],
      matchNotes: [],
    },
    {
      id: 7, initial: 'S', hue: 60, name: 'Sofia Laine', age: 13, level: 'Keskitaso',
      goal: 'Kaksinkäsinlyönnin tehon lisääminen',
      lastSession: 'Ensimmäinen kerta ryhmässä, sopeutui hyvin',
      focus: 'Vartalon kierto lyönnissä',
      diary: [],
      videos: [],
      homework: [],
      playerNote: '',
      playerWish: '',
      background: '',
      moods: [],
      matchNotes: [],
    },
    {
      id: 8, initial: 'O', hue: 190, name: 'Onni Hakala', age: 15, level: 'Keskitaso',
      goal: 'Syötön osumaprosentin nostaminen',
      lastSession: 'Syöttöharjoittelu tuotti tulosta, osumat paranivat',
      focus: 'Heiton korkeus ja ajoitus',
      diary: [{ daysAgo: 7, text: 'Syöttöprosentti nousi selvästi — jatka samalla rutiinilla.' }],
      videos: [{ id: 0, title: 'Syöttörutiini', hue: 190, daysAgo: 40, tags: ['syotto'], addedBy: 'coach' }],
      homework: [{ text: '20 syöttöä päivässä, tähtää kulmiin', done: true, daysAgo: 12 }],
      playerNote: '',
      playerWish: 'Haluaisin pelata enemmän pistepelejä syötöstä.',
      background: '',
      moods: [],
      matchNotes: [],
    },
    {
      id: 9, initial: 'E', hue: 10, name: 'Eetu Rantanen', age: 11, level: 'Aloittelija',
      goal: 'Pallon ja mailan yhteispeli',
      lastSession: 'Ensimmäiset kerrat kentällä, into kova',
      focus: 'Pomputus ja perusliike',
      diary: [],
      videos: [],
      homework: [{ text: 'Pomputa palloa mailalla 5 min päivässä', done: false, daysAgo: 17 }],
      playerNote: '',
      playerWish: '',
      background: 'Ensimmäinen kausi mailapelien parissa — huoltaja toivoo maltillista tahtia, ei liikaa kilpailupainetta vielä.',
      moods: [],
      matchNotes: [],
    },
    {
      id: 10, initial: 'N', hue: 340, name: 'Nea Salminen', age: 13, level: 'Aloittelija',
      goal: 'Rohkeus lyödä täysillä',
      lastSession: 'Otteessa parannusta, uskaltaa jo lyödä kovempaa',
      focus: 'Valmiusasento ja paino eteen',
      diary: [{ daysAgo: 4, text: 'Rohkeus lyödä kasvoi huomattavasti — hyvä edistys!' }],
      videos: [],
      homework: [],
      playerNote: '',
      playerWish: '',
      background: '',
      moods: [],
      matchNotes: [],
    },
  ],
  groups: [
    {
      id: 0, name: 'Kilpajuniorit', level: 'Kilpapelaajat', day: 'Ke', time: '17:00', memberIds: [0, 3, 6], coachId: 0,
      // Themes carry a weekOffset instead of a fixed week, for the same reason the
      // trainings carry day offsets: the demo has to look planned whenever it is opened.
      themes: [
        { id: 't0-0', weekOffset: 0, title: 'Kämmenen pelitila', lead: 'Valmistautuminen alkaa heti vastustajan osumasta — treenataan ensimmäistä askelta ja lyönnin jälkeistä palautumista.' },
        { id: 't0-1', weekOffset: 1, title: 'Kakkossyötön varmuus', lead: 'Kakkossyöttö ei ole pyyntö — haetaan kierre ja korkeus, joilla se uskaltaa mennä sisään paineessakin.' },
        { id: 't0-2', weekOffset: 2, title: 'Pisteen aloitus', lead: 'Kolme ensimmäistä lyöntiä ratkaisevat pisteen: syöttö, palautus ja se mitä niiden jälkeen tapahtuu.' },
      ],
      annualPlan: { filename: 'kilpajuniorit_vuosisuunnitelma_2026.xlsx', date: '2026-01-12', status: 'published' },
    },
    {
      id: 1, name: 'Keskitason ryhmä', level: 'Keskitaso', day: 'To', time: '16:00', memberIds: [1, 7, 8], coachId: 0,
      themes: [
        { id: 't1-0', weekOffset: 0, title: 'Askelkuvio ennen lyöntiä', lead: 'Keskitytään siihen, että jalat ehtivät oikeaan asentoon ennen jokaista lyöntiä — ei hätäisiä käsivarsilyöntejä.' },
        { id: 't1-1', weekOffset: 1, title: 'Korkea ja syvä pallo', lead: 'Turvallinen peruslyönti verkon yli reilulla marginaalilla — pituus ratkaisee enemmän kuin vauhti.' },
      ],
      annualPlan: null,
    },
    {
      id: 2, name: 'Alkeisryhmä', level: 'Aloittelijat', day: 'La', time: '10:00', memberIds: [2, 9, 10], coachId: 1,
      themes: [
        { id: 't2-0', weekOffset: 0, title: 'Ote ja perusasento', lead: 'Harjoitellaan luontevaa mailanotetta ja valmiusasentoa — perusta kaikelle muulle.' },
        { id: 't2-1', weekOffset: 1, title: 'Pallon kohtaaminen', lead: 'Osuma keskelle mailaa: paljon toistoja hitaalla pallolla, ei kiirettä.' },
        { id: 't2-2', weekOffset: 3, title: 'Ensimmäiset pistepelit', lead: 'Lasketaan pisteitä ensimmäistä kertaa — säännöt tutuiksi leikin kautta.' },
      ],
      annualPlan: null,
    },
    {
      id: 3, name: 'Kesäleiri', level: 'Kaikki tasot', day: 'Su', time: '12:00', memberIds: [0, 1, 2, 3], coachId: 0,
      themes: [
        { id: 't3-0', weekOffset: 0, title: 'Ottelupelit ja taktiikka', lead: 'Kausi huipentuu yhteisiin ottelupeleihin — pelataan täysillä ja katsotaan missä kukin menee.' },
      ],
      annualPlan: null,
    },
  ],
  // `trainings` is filled in at load time (see koutsiBuildSeedTrainings) so the demo
  // always shows upcoming sessions relative to today, instead of dates baked in once and
  // silently drifting into the past the longer this file sits deployed.
  trainings: [],
  exercises: [
    { id: 0, name: 'Kakkossyöttö + suunta', goal: 'Syötön suunnan vaihtelu paineen alla — jokainen syöttö osoitetaan ennalta valittuun ruutuun.', players: '1–2', playerCount: 1, duration: '15 min', level: 'Kilpapelaajat', tags: ['syotto'] },
    { id: 1, name: 'Ristikkäispeli', goal: 'Liikkuminen ja suunnanmuutos — pallo pelataan aina vastakkaiseen kenttäpuoliskoon.', players: '4', playerCount: 4, duration: '20 min', level: 'Kaikki tasot', tags: ['liikkuminen'] },
    { id: 2, name: 'Syöttö + 1', goal: 'Syötön jälkeinen ensimmäinen lyönti — aloita piste syötöllä ja päätä se kolmen lyönnin sisällä.', players: '2', playerCount: 2, duration: '15 min', level: 'Keskitaso+', tags: ['syotto', 'pistepeli'] },
    { id: 3, name: 'Split step + verkolle nousu', goal: 'Ajoitus ja ensimmäinen askel — split step vastustajan osumahetkellä ja nousu verkolle.', players: '2', playerCount: 2, duration: '10 min', level: 'Kaikki tasot', tags: ['verkkopeli'] },
    { id: 4, name: 'Ote peilin edessä', goal: 'Perusote ja lyöntiasento ilman palloa, peilin edessä toistaen.', players: '1', playerCount: 1, duration: '10 min', level: 'Aloittelijat', tags: ['tekniikka'] },
    { id: 5, name: 'Lonkan avaus', goal: 'Lonkkanivelen liikkuvuus ennen kenttäharjoittelua — isot kiertoliikkeet molempiin suuntiin.', players: '1', playerCount: 1, duration: '5 min', level: 'Kaikki tasot', tags: ['lammittely'] },
    { id: 6, name: 'Olkapään ja käsivarren pyörittely', goal: 'Lyöntikäden ja olkapään avaus ennen lyöntejä — pienistä kierroista isompiin.', players: '1', playerCount: 1, duration: '5 min', level: 'Kaikki tasot', tags: ['lammittely'] },
    { id: 7, name: 'Kevyt hölkkä + sivuaskellus', goal: 'Syke ylös ja jalat käyntiin — hölkkää reunasta reunaan, väliin sivuaskellusta ja risti-askellusta.', players: '1–4', playerCount: 1, duration: '5 min', level: 'Kaikki tasot', tags: ['lammittely', 'liikkuminen'] },
  ],
};

function koutsiClone(obj) { return JSON.parse(JSON.stringify(obj)); }

// Seed diary entries, videos and homework carry a `daysAgo` instead of a baked date, for
// the same reason the trainings do: the demo has to look alive whenever it is opened, and
// the Kehitys timeline sorts by real timestamps. Hydration turns those offsets into the
// `at` (ISO) + `date` (label) pair every view reads.
function koutsiHydrateStudents(seed) {
  const matchNotes = koutsiBuildSeedMatchNotes();
  const goalHistory = koutsiBuildSeedGoalHistory();
  const wishHistory = koutsiBuildSeedWishHistory();
  const noteHistory = koutsiBuildSeedNoteHistory();
  const moods = koutsiBuildSeedMoods();
  seed.students.forEach((s) => {
    s.joinedAt = koutsiOffsetIsoStr(-(190 + s.id * 11));
    s.diary = (s.diary || []).map((d, i) => ({ id: i, at: koutsiOffsetIsoStr(-d.daysAgo, 18), text: d.text }));
    // A finished homework item is dated when it was ticked off, not when it was handed out.
    s.homework = (s.homework || []).map((h, i) => ({
      id: i, at: koutsiOffsetIsoStr(-h.daysAgo, 18), text: h.text, done: h.done,
      doneAt: h.done ? koutsiOffsetIsoStr(-Math.max(1, Math.round(h.daysAgo / 2)), 20) : null,
    }));
    s.videos = (s.videos || []).map((v) => ({ ...v, date: koutsiOffsetDateStr(-v.daysAgo), at: koutsiOffsetIsoStr(-v.daysAgo, 12) }));
    s.matchNotes = matchNotes[s.id] || [];
    s.goalHistory = goalHistory[s.id] || [];
    s.wishHistory = wishHistory[s.id] || [];
    s.noteHistory = noteHistory[s.id] || [];
    s.moods = moods[s.id] || [];
  });
  return seed;
}

// Turns each group's `themes` list into the shape every screen reads: `theme` is the week
// running right now, `upcomingThemes` the ones planned after it. Seeded themes carry a
// weekOffset and are re-anchored to the current week on every load, so a demo left open in
// a bookmark for a month still shows a live plan; themes the demo visitor adds themselves
// carry a concrete week and are left exactly where they put them.
function koutsiDeriveGroupThemes(state) {
  const now = koutsiCurrentIsoWeek();
  (state.groups || []).forEach((g) => {
    const themes = (g.themes || []).map((t) => {
      const w = t.weekOffset == null ? { year: t.year, week: t.week } : koutsiAddIsoWeeks(now, t.weekOffset);
      return { ...t, year: w.year, week: w.week };
    }).sort(koutsiCompareIsoWeeks);
    g.themes = themes;
    g.theme = themes.find((t) => t.year === now.year && t.week === now.week) || null;
    g.upcomingThemes = themes.filter((t) => koutsiCompareIsoWeeks(t, now) > 0);
  });
  return state;
}
// The theme of the week a given training falls in — not today's.
function koutsiThemeForDate(group, dateStr) {
  if (!group) return null;
  const w = koutsiIsoWeekOf(koutsiDateFromStr(dateStr));
  return (group.themes || []).find((t) => t.year === w.year && t.week === w.week) || null;
}

function koutsiLoadState() {
  try {
    const raw = window.localStorage.getItem(KOUTSI_STORE_KEY);
    if (raw) return koutsiDeriveGroupThemes(JSON.parse(raw));
  } catch (e) { /* localStorage unavailable — fall through to seed */ }
  const seed = koutsiClone(KOUTSI_SEED);
  seed.trainings = koutsiBuildSeedTrainings();
  seed.clubEvents = koutsiBuildSeedClubEvents();
  return koutsiDeriveGroupThemes(koutsiHydrateStudents(seed));
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
// ── ISO weeks ────────────────────────────────────────────────
// Same helpers as the real data layer (lib/koutsi-data.js). Duplicated rather than shared
// because the demo bundle deliberately loads no Supabase code at all.
function koutsiIsoWeekOf(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { year: d.getUTCFullYear(), week: Math.ceil(((d - yearStart) / 86400000 + 1) / 7) };
}
function koutsiCurrentIsoWeek() { return koutsiIsoWeekOf(new Date()); }
function koutsiIsoWeekStart(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayNum = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dayNum + 1 + (week - 1) * 7);
  return new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate());
}
function koutsiAddIsoWeeks({ year, week }, n) {
  const monday = koutsiIsoWeekStart(year, week);
  monday.setDate(monday.getDate() + n * 7);
  return koutsiIsoWeekOf(monday);
}
function koutsiIsoWeekKey({ year, week }) { return `${year}-${koutsiPad(week)}`; }
function koutsiIsoWeekRangeLabel(year, week) {
  const start = koutsiIsoWeekStart(year, week);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${start.getDate()}.${start.getMonth() + 1}.–${end.getDate()}.${end.getMonth() + 1}.`;
}
function koutsiCompareIsoWeeks(a, b) { return a.year - b.year || a.week - b.week; }
function koutsiWeeksInIsoYear(year) { return koutsiIsoWeekOf(new Date(year, 11, 28)).week; }

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
// Same offset, but as a full timestamp — the Kehitys timeline orders several events
// within one day, so seed entries need an hour as well as a date.
function koutsiOffsetIsoStr(days, hour = 12) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
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
    { id: 0, date: koutsiOffsetDateStr(2), time: '17:00', type: 'Yksityistunti', studentId: 0, groupId: null, coachId: 0, absences: [] },
    { id: 1, date: koutsiOffsetDateStr(kilpa), time: '17:00', type: 'Ryhmätreeni', studentId: null, groupId: 0, coachId: 0, absences: [] },
    { id: 2, date: koutsiOffsetDateStr(keski), time: '16:00', type: 'Ryhmätreeni', studentId: null, groupId: 1, coachId: 0, absences: [] },
    { id: 3, date: koutsiOffsetDateStr(alkeis), time: '10:00', type: 'Ryhmätreeni', studentId: null, groupId: 2, coachId: 1, absences: [] },
    { id: 4, date: koutsiOffsetDateStr(kilpa + 7), time: '17:00', type: 'Ryhmätreeni', studentId: null, groupId: 0, coachId: 0, absences: [] },
    { id: 5, date: koutsiOffsetDateStr(keski + 7), time: '16:00', type: 'Ryhmätreeni', studentId: null, groupId: 1, coachId: 0, absences: [] },
    { id: 6, date: koutsiOffsetDateStr(alkeis + 7), time: '10:00', type: 'Ryhmätreeni', studentId: null, groupId: 2, coachId: 1, absences: [] },
    { id: 7, date: koutsiOffsetDateStr(21), time: '11:00', type: 'Ottelu', studentId: 3, groupId: null, coachId: 0, absences: [] },
    { id: 8, date: koutsiOffsetDateStr(kesaleiri), time: '12:00', type: 'Ryhmätreeni', studentId: null, groupId: 3, coachId: 0, absences: [] },
    { id: 9, date: koutsiOffsetDateStr(4), time: '18:00', type: 'Yksityistunti', studentId: 4, groupId: null, coachId: 0, absences: [] },
    { id: 10, date: koutsiOffsetDateStr(9), time: '19:00', type: 'Ottelu', studentId: 5, groupId: null, coachId: 1, absences: [] },
    // Sessions that have already happened. The calendar barely uses them, but the player's
    // Kehitys timeline is a history — without a past it reads as an empty season.
    { id: 11, date: koutsiOffsetDateStr(kilpa - 7), time: '17:00', type: 'Ryhmätreeni', studentId: null, groupId: 0, coachId: 0, absences: [] },
    { id: 12, date: koutsiOffsetDateStr(kilpa - 14), time: '17:00', type: 'Ryhmätreeni', studentId: null, groupId: 0, coachId: 0, absences: [{ studentId: 0, reason: 'vamma' }] },
    { id: 13, date: koutsiOffsetDateStr(kilpa - 21), time: '17:00', type: 'Ryhmätreeni', studentId: null, groupId: 0, coachId: 0, absences: [] },
    { id: 14, date: koutsiOffsetDateStr(kilpa - 28), time: '17:00', type: 'Ryhmätreeni', studentId: null, groupId: 0, coachId: 0, absences: [{ studentId: 3, reason: 'poissa' }] },
    { id: 15, date: koutsiOffsetDateStr(keski - 7), time: '16:00', type: 'Ryhmätreeni', studentId: null, groupId: 1, coachId: 0, absences: [] },
    { id: 16, date: koutsiOffsetDateStr(keski - 14), time: '16:00', type: 'Ryhmätreeni', studentId: null, groupId: 1, coachId: 0, absences: [] },
    { id: 17, date: koutsiOffsetDateStr(keski - 21), time: '16:00', type: 'Ryhmätreeni', studentId: null, groupId: 1, coachId: 0, absences: [{ studentId: 1, reason: 'poissa' }] },
    { id: 18, date: koutsiOffsetDateStr(alkeis - 7), time: '10:00', type: 'Ryhmätreeni', studentId: null, groupId: 2, coachId: 1, absences: [] },
    { id: 19, date: koutsiOffsetDateStr(alkeis - 14), time: '10:00', type: 'Ryhmätreeni', studentId: null, groupId: 2, coachId: 1, absences: [] },
    { id: 20, date: koutsiOffsetDateStr(-6), time: '17:00', type: 'Yksityistunti', studentId: 0, groupId: null, coachId: 0, absences: [] },
    { id: 21, date: koutsiOffsetDateStr(-20), time: '17:00', type: 'Yksityistunti', studentId: 0, groupId: null, coachId: 0, absences: [] },
    { id: 22, date: koutsiOffsetDateStr(-13), time: '11:00', type: 'Ottelu', studentId: 0, groupId: null, coachId: 0, absences: [] },
    { id: 23, date: koutsiOffsetDateStr(-11), time: '18:00', type: 'Yksityistunti', studentId: 3, groupId: null, coachId: 0, absences: [] },
  ];
}

// Pelaajien omat ottelumuistiinpanot. Rakennetaan latausaikaan suhteessa tähän
// päivään samasta syystä kuin treenit — muuten demon "viime viikon ottelu" olisi
// vuoden päästä vuoden takainen.
function koutsiBuildSeedMatchNotes() {
  return {
    0: [
      { id: 1, opponentName: 'Venla Aho (TVS)', date: koutsiOffsetDateStr(-5), note: 'Taktiikka: pitkät kämmenet ristiin ja verkolle heti lyhyestä pallosta. Piti hyvin. Kakkossyöttö on selvästi heikko — hyökkää sen päälle heti. Rystyllä ei uskalla lyödä suoraa.' },
      { id: 0, opponentName: 'Iiris Koski (HVS)', date: koutsiOffsetDateStr(-24), note: 'Todella nopea jaloistaan, ei kannata yrittää ohilyöntejä. Väsyi pitkissä vaihdoissa kolmannessa erässä. Ensi kerralla malttia — pallo peliin ja anna virheiden tulla.' },
    ],
    3: [
      { id: 0, opponentName: 'Venla Aho (TVS)', date: koutsiOffsetDateStr(-12), note: 'Sama vastustaja kuin Marialla. Syöttö tulee lähes aina rystylle — siirryin vastaanotossa askeleen vasemmalle ja se toimi.' },
    ],
  };
}

// Fiilikset the player has already marked. Built at load for the same reason as the rest:
// a demo timeline with no moods on it hides half of what the Kehitys tab does.
function koutsiBuildSeedMoods() {
  return {
    0: [
      { id: 3, at: koutsiOffsetIsoStr(-6, 19), score: 4, note: 'Syöttö tuntui vihdoin luontevalta.' },
      { id: 2, at: koutsiOffsetIsoStr(-13, 20), score: 5, note: 'Paras ottelu pitkään aikaan.' },
      { id: 1, at: koutsiOffsetIsoStr(-20, 19), score: 2, note: 'Nilkka jomotti, en uskaltanut liikkua täysillä.', hiddenFromCoach: true },
      { id: 0, at: koutsiOffsetIsoStr(-34, 19), score: 4, note: '' },
    ],
    1: [
      { id: 1, at: koutsiOffsetIsoStr(-9, 18), score: 3, note: 'Rystyt eivät kulkeneet, mutta jaksoin loppuun.' },
      { id: 0, at: koutsiOffsetIsoStr(-23, 18), score: 4, note: '' },
    ],
    3: [
      { id: 1, at: koutsiOffsetIsoStr(-11, 20), score: 5, note: 'Nelinpeli toimi, verkolla oli hyvä fiilis.' },
      { id: 0, at: koutsiOffsetIsoStr(-25, 20), score: 3, note: '' },
    ],
  };
}

// A player's goal is not a fixed thing — it moves as they improve. Every version is kept
// so the Kehitys timeline can show "Tavoite päivitetty" with the goal it replaced, which
// is the clearest single view of a season's progress the demo has.
function koutsiBuildSeedGoalHistory() {
  return {
    0: [
      { id: 2, at: koutsiOffsetIsoStr(-9, 20), value: 'Varmempi kakkossyöttö ja rohkeampi verkkopeli', previousValue: 'Kakkossyöttö sisään paineen alla', byPlayer: true },
      { id: 1, at: koutsiOffsetIsoStr(-74, 19), value: 'Kakkossyöttö sisään paineen alla', previousValue: 'Syötön perustekniikka kuntoon', byPlayer: true },
      { id: 0, at: koutsiOffsetIsoStr(-165, 18), value: 'Syötön perustekniikka kuntoon', previousValue: '', byPlayer: true },
    ],
    1: [
      { id: 1, at: koutsiOffsetIsoStr(-31, 17), value: 'Backhandin tasapaino pitkissä vaihdoissa', previousValue: 'Backhand kahdella kädellä haltuun', byPlayer: true },
      { id: 0, at: koutsiOffsetIsoStr(-140, 18), value: 'Backhand kahdella kädellä haltuun', previousValue: '', byPlayer: true },
    ],
    3: [
      { id: 1, at: koutsiOffsetIsoStr(-22, 21), value: 'Nelinpelitaktiikan syventäminen', previousValue: 'Verkkopeli rohkeammaksi nelinpelissä', byPlayer: true },
      { id: 0, at: koutsiOffsetIsoStr(-120, 18), value: 'Verkkopeli rohkeammaksi nelinpelissä', previousValue: '', byPlayer: true },
    ],
  };
}

// The wish and the player's own note overwrite themselves exactly like the goal, so the
// demo keeps their history too — otherwise "Toive päivitetty" never shows up on a timeline.
function koutsiBuildSeedWishHistory() {
  return {
    0: [
      { id: 1, at: koutsiOffsetIsoStr(-4, 20), value: 'Haluaisin harjoitella enemmän verkkopeliä ensi kerralla.', previousValue: 'Lisää pistepelejä, pelkkä lyöntitreeni alkaa puuduttaa.', byPlayer: true },
      { id: 0, at: koutsiOffsetIsoStr(-38, 19), value: 'Lisää pistepelejä, pelkkä lyöntitreeni alkaa puuduttaa.', previousValue: '', byPlayer: true },
    ],
    8: [
      { id: 0, at: koutsiOffsetIsoStr(-15, 18), value: 'Haluaisin pelata enemmän pistepelejä syötöstä.', previousValue: '', byPlayer: true },
    ],
  };
}
function koutsiBuildSeedNoteHistory() {
  return {
    0: [
      { id: 0, at: koutsiOffsetIsoStr(-17, 21), value: 'Muista: heitto vähän eteenpäin, ei suoraan ylös. Tämä toimi tänään.', previousValue: '', byPlayer: true },
    ],
  };
}

// Club-wide tennis-calendar events (tournaments, open days) — visible to every coach
// and player, unlike `trainings` which always belong to one student or group.
function koutsiBuildSeedClubEvents() {
  return [
    { id: 0, date: koutsiOffsetDateStr(10), title: 'Seuran kesäturnaus', kind: 'turnaus' },
    { id: 1, date: koutsiOffsetDateStr(17), title: 'Klubin pelipäivä — vapaa pelivuoro kaikille', kind: 'pelipaiva' },
    { id: 2, date: koutsiOffsetDateStr(30), title: 'Avoimet ovet -tenniskoulu', kind: 'tapahtuma' },
    // Past ones as well: the calendar only ever needed what is coming, but the Kehitys
    // timeline is a history and a played tournament belongs on it.
    { id: 3, date: koutsiOffsetDateStr(-16), title: 'Kevätkauden päätösturnaus', kind: 'turnaus' },
    { id: 4, date: koutsiOffsetDateStr(-44), title: 'Seuraottelu naapuriseuraa vastaan', kind: 'ottelu' },
  ];
}
function koutsiClubEventsOnDate(state, dateStr) {
  return (state.clubEvents || []).filter((e) => e.date === dateStr);
}
function koutsiUpcomingClubEvents(state) {
  const today = koutsiTodayStr();
  return (state.clubEvents || []).filter((e) => e.date >= today).slice().sort((a, b) => a.date.localeCompare(b.date));
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
function koutsiTrainingsOnDateForStudent(state, dateStr, studentId) {
  const groupIds = koutsiGroupsForStudent(state, studentId).map((g) => g.id);
  return koutsiTrainingsOnDate(state, dateStr).filter((t) => t.studentId === studentId || (t.groupId != null && groupIds.includes(t.groupId)));
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
function koutsiNextMatchNoteId(student) {
  return (student.matchNotes || []).reduce((max, n) => Math.max(max, n.id), -1) + 1;
}
function koutsiNextGroupId(state) {
  return state.groups.reduce((max, g) => Math.max(max, g.id), -1) + 1;
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

const KOUTSI_TAG_LABELS = { syotto: 'Syöttö', liikkuminen: 'Liikkuminen', pistepeli: 'Pistepeli', verkkopeli: 'Verkkopeli', tekniikka: 'Tekniikka', lammittely: 'Lämmittely' };
const KOUTSI_TAGS = ['syotto', 'liikkuminen', 'pistepeli', 'verkkopeli', 'tekniikka', 'lammittely'];
const KOUTSI_ABSENCE_REASON_LABELS = { poissa: 'Poissa', vamma: 'Loukkaantunut' };

Object.assign(window, {
  KOUTSI_SEED, KOUTSI_STORE_KEY, koutsiLoadState, koutsiSaveState, koutsiResetState,
  koutsiDeriveGroupThemes, koutsiThemeForDate,
  koutsiCurrentIsoWeek, koutsiIsoWeekOf, koutsiIsoWeekStart, koutsiAddIsoWeeks,
  koutsiIsoWeekKey, koutsiIsoWeekRangeLabel, koutsiCompareIsoWeeks, koutsiWeeksInIsoYear,
  koutsiTodayStr, koutsiFmtShortDate, koutsiFmtLongDate, koutsiDateFromStr, koutsiOffsetDateStr, koutsiOffsetIsoStr,
  koutsiStudentById, koutsiGroupById, koutsiGroupForStudent, koutsiGroupsForStudent, koutsiCoachById, koutsiTrainingParty,
  koutsiTrainingsForStudent, koutsiUpcomingTrainingsForStudent, koutsiTrainingsForGroup,
  koutsiTrainingsOnDate, koutsiTrainingsOnDateForStudent, koutsiNextTrainingId, koutsiNextExerciseId, koutsiNextVideoId, koutsiNextMatchNoteId, koutsiNextGroupId, koutsiLevelColor,
  koutsiClubEventsOnDate, koutsiUpcomingClubEvents,
  KOUTSI_WEEKDAYS, KOUTSI_WEEKDAYS_LONG, KOUTSI_MONTHS, KOUTSI_TAG_LABELS, KOUTSI_TAGS, KOUTSI_ABSENCE_REASON_LABELS,
});
