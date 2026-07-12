// koutsi-data.js — shared seed data + localStorage-backed store for the Koutsi demo.
// koutsi-valmentaja.html (coach) and koutsi-pelaaja.html (player) both read/write the
// same store key, so an action taken in one view (a new diary entry, a checked-off
// homework item, a new training) is visible in the other — no backend needed for the demo.

const KOUTSI_STORE_KEY = 'krossiKoutsiDemoV1';

const KOUTSI_SEED = {
  weeklyTheme: {
    title: 'Kämmenen pelitila',
    lead: 'Tällä viikolla keskitymme siihen, että valmistautuminen alkaa heti vastustajan osumasta.',
    tip: 'Omatoimisissa peleissä tarkkailkaa erityisesti ensimmäistä askelta ja lyönnin jälkeistä palautumista.',
  },
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
      upcoming: [{ day: 'Ke 4.6.', time: '17:00', type: 'Yksityistunti' }],
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
      upcoming: [{ day: 'To 5.6.', time: '16:00', type: 'Ryhmätreeni' }],
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
      upcoming: [{ day: 'La 7.6.', time: '10:00', type: 'Yksityistunti' }],
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
      upcoming: [],
      homework: [],
      playerNote: '',
    },
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

Object.assign(window, { KOUTSI_SEED, KOUTSI_STORE_KEY, koutsiLoadState, koutsiSaveState, koutsiResetState });
