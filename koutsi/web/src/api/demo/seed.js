// seed.js — the demo world, laid out around today so it always looks like "this week".
//
// A coach (Anna) with six groups that look like a real club's week — adults and juniors,
// several groups with the same kind of name — some players who have joined and some who
// haven't, weekly themes for the past weeks with this week half planned, attendance, and a
// bit of player activity so the coach's Koti and the player's Kehitys have a story to tell.
// Nothing is stored: every page load starts from this seed.

import {
  koutsiCurrentIsoWeek, koutsiAddIsoWeeks, koutsiTodayStr, koutsiAddDays, koutsiNextWeekday, koutsiWeeklyDates,
  koutsiHueFromId, koutsiInitialOf, koutsiSplitThemes, koutsiFmtShortDate,
} from '../../domain/core.js';

export const COACH = 'demo-coach';
export const COACH2 = 'demo-coach-2';
export const PLAYER = 'demo-s-maria';

export const STARTER_EXERCISES = [
  { name: 'Minitennis ristiin', goal: 'Pehmeä aloitus: pelataan syöttöruutujen sisällä ristiin. Katse palloon, lyhyet liikkeet, korkea osumapiste.', players: '2', playerCount: 2, duration: '10 min', level: 'Kaikki tasot', tags: ['lammittely', 'tekniikka'] },
  { name: 'Split step -ajoitus', goal: 'Valmentaja syöttää, pelaaja tekee splitin juuri ennen vastustajan osumaa. Ajoitus ennen nopeutta.', players: '1', playerCount: 1, duration: '10 min', level: 'Kaikki tasot', tags: ['liikkuminen', 'tekniikka'] },
  { name: 'Kämmen ristiin 10 palloa', goal: 'Kymmenen peräkkäistä kämmentä ristiin verkon yli. Tavoite on rytmi ja varmuus, ei vauhti.', players: '2', playerCount: 2, duration: '12 min', level: 'Aloittelija', tags: ['tekniikka'] },
  { name: 'Ensimmäinen syöttö — 20 palloa', goal: 'Kaksikymmentä ykkössyöttöä, tavoitteena vähintään 12 sisään. Kirjataan prosentti joka kerta.', players: '1', playerCount: 1, duration: '12 min', level: 'Kaikki tasot', tags: ['syotto'] },
  { name: 'Kakkossyöttö + suunta', goal: 'Kymmenen kakkossyöttöä ulos, kymmenen keskelle. Kierre ja korkeus verkon yli tärkeämpi kuin vauhti.', players: '1', playerCount: 1, duration: '12 min', level: 'Keskitaso', tags: ['syotto', 'tekniikka'] },
  { name: 'Lähestymislyönti ja verkkoon', goal: 'Lyhyt pallo, hyökkäävä lähestymislyönti suoraan, sitten lentolyönti pisteeseen.', players: '2', playerCount: 2, duration: '15 min', level: 'Keskitaso', tags: ['verkkopeli', 'pistepeli'] },
  { name: 'Verkkorefleksit', goal: 'Molemmat pelaajat syöttöviivalla, nopeita lyhyitä lentolyöntejä. Kehittää reaktion ja mailan otteen.', players: '2', playerCount: 2, duration: '8 min', level: 'Edistynyt', tags: ['verkkopeli', 'liikkuminen'] },
  { name: 'Pistepeli 7 pisteeseen', goal: 'Lyhyt kilpailu, jokainen piste aloitetaan syötöstä. Voittaja jää, häviäjä vaihtaa.', players: '2+', playerCount: 2, duration: '15 min', level: 'Kaikki tasot', tags: ['pistepeli'] },
  { name: 'Kuningaskenttä', goal: 'Ryhmä kiertää kentän puolilla, voittaja siirtyy ylöspäin. Pitää tempon ja motivaation korkealla.', players: '4+', playerCount: 4, duration: '20 min', level: 'Kaikki tasot', tags: ['pistepeli', 'liikkuminen'] },
  { name: 'Jäähdyttely ja venyttely', goal: 'Kevyt hölkkä ja päälihasryhmien venytykset. Sulkee treenin ja tukee palautumista.', players: '1', playerCount: 1, duration: '8 min', level: 'Kaikki tasot', tags: ['lammittely'] },
];

function isoAt(offsetDays, hour = 12) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}
const day = (offset) => koutsiAddDays(koutsiTodayStr(), offset);

function person(id, name, extra) {
  return { id, name, initial: koutsiInitialOf(name), hue: koutsiHueFromId(id), avatarUrl: '', ...extra };
}

function student(id, name, { age = null, level = 'Keskitaso', placeholder = false, joinedDaysAgo = 60, ...rest } = {}) {
  return person(id, name, {
    isPlaceholder: placeholder, age, ageRange: null, ageValue: age == null ? '' : String(age), ageLabel: age == null ? '' : `${age} v`,
    level, goal: '', lastSession: '', focus: '', playerNote: '', playerWish: '',
    joinedAt: placeholder ? null : isoAt(-joinedDaysAgo), welcomeSeenAt: isoAt(-joinedDaysAgo),
    diary: [], homework: [], videos: [], moods: [], matchNotes: [], goalHistory: [], wishHistory: [], noteHistory: [],
    ...rest,
  });
}

let seq = 0;
export const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(seq += 1)}`;

/** Weekly sessions for a group from `fromDate` for `weeks` weeks. */
export function weeklySessions(group, fromDate, weeks, coachId = COACH) {
  const first = koutsiNextWeekday(fromDate, group.day);
  if (!first) return [];
  const seriesId = newId('ser');
  return koutsiWeeklyDates(first, koutsiAddDays(first, (weeks - 1) * 7)).map((date) => ({
    id: newId('tr'), date, time: group.time, type: 'Ryhmätreeni', durationMinutes: group.durationMinutes,
    loggedBy: 'coach', notes: '', endDate: null, studentId: null, groupId: group.id, coachId, seriesId, absences: [],
  }));
}

export function refreshThemes(group) {
  Object.assign(group, koutsiSplitThemes(group.themes || []));
}

export function seed() {
  const now = koutsiCurrentIsoWeek();
  const wk = (n) => koutsiAddIsoWeeks(now, n);
  const theme = (n, title, lead = '') => ({ id: newId('t'), ...wk(n), title, lead });

  const students = [
    student(PLAYER, 'Maria K.', {
      age: 26, level: 'Kilpapelaaja', joinedDaysAgo: 75,
      goal: 'Varmempi kakkossyöttö ja rohkeampi verkkopeli',
      playerWish: 'Haluaisin harjoitella enemmän verkkopeliä ensi kerralla.',
      diary: [
        { id: 'd1', at: isoAt(-2, 19), text: 'Hyvä nousu syötössä tällä viikolla — heitto pysyy jo samassa kohdassa. Jatka samaan malliin.' },
        { id: 'd2', at: isoAt(-16, 19), text: 'Aloitettiin uusi lähestymislyönti. Muista split step ennen volleytä.' },
      ],
      homework: [{ id: 'h1', at: isoAt(-6), text: '10 min syöttöharjoittelua päivässä — 20 kakkossyöttöä keskelle', done: false, doneAt: null }],
      moods: [
        { id: 'm1', at: isoAt(-5, 20), score: 4, note: 'Hyvä fiilis, syöttö kulki', hiddenFromCoach: false },
        { id: 'm2', at: isoAt(-12, 20), score: 3, note: '', hiddenFromCoach: false },
        { id: 'm3', at: isoAt(-19, 20), score: 5, note: 'Paras treeni pitkään aikaan!', hiddenFromCoach: false },
      ],
      matchNotes: [
        { id: 'n1', at: isoAt(-4), opponentName: 'Sofia L.', date: day(-4), note: 'Vahva kämmen, rystyllä epävarma paineessa. Pelaa toiselle puolelle.', durationMinutes: 95, result: 'voitto', format: 'kaksinpeli', score: '6-4 6-3', partnerName: '', opponent2Name: '', tournamentId: null },
        { id: 'n2', at: isoAt(-25), opponentName: 'Emma V.', date: day(-25), note: 'Liikaa virheitä kakkossyötöllä.', durationMinutes: 80, result: 'tappio', format: 'kaksinpeli', score: '4-6 5-7', partnerName: '', opponent2Name: '', tournamentId: null },
      ],
      goalHistory: [
        { id: 'gh1', at: isoAt(-40), field: 'goal', value: 'Varmempi kakkossyöttö ja rohkeampi verkkopeli', previousValue: 'Varmempi kakkossyöttö', byPlayer: true },
      ],
    }),
    student('demo-s-aleksi', 'Aleksi R.', {
      age: 24, level: 'Keskitaso', goal: 'Backhandin tasapaino pitkissä vaihdoissa',
      diary: [{ id: 'd3', at: isoAt(-1, 20), text: 'Backhand parani huomattavasti — hyvä liikkeen aloitus.' }],
      homework: [{ id: 'h2', at: isoAt(-13), text: 'Katso videoanalyysi backhandista', done: true, doneAt: isoAt(-11) }],
      moods: [{ id: 'm4', at: isoAt(-1, 21), score: 4, note: 'Jalat liikkui hyvin', hiddenFromCoach: false }],
    }),
    student('demo-s-venla', 'Venla H.', { age: 22, level: 'Aloittelija', goal: 'Pallon rytmi ja peliin pääsy' }),
    student('demo-s-jussi', 'Jussi T.', { age: 41, level: 'Keskitaso', playerWish: 'Enemmän pistepelejä loppuun?' }),
    student('demo-s-sanna', 'Sanna P.', { age: 35, level: 'Edistynyt' }),
    student('demo-s-mikko', 'Mikko L.', { level: 'Keskitaso', placeholder: true }),
    student('demo-s-tiina', 'Tiina R.', { level: 'Aloittelija', placeholder: true }),
    student('demo-s-eetu', 'Eetu J.', { age: 13, level: 'Aloittelija', placeholder: true }),
    student('demo-s-ilona', 'Ilona P.', { age: 15, level: 'Keskitaso' }),
    student('demo-s-oskari', 'Oskari M.', { age: 14, level: 'Keskitaso', placeholder: true }),
    student('demo-s-aino', 'Aino S.', { age: 12, level: 'Aloittelija', placeholder: true }),
    student('demo-s-leo', 'Leo K.', { age: 16, level: 'Edistynyt' }),
  ];

  const g = (id, name, day, time, durationMinutes, level, memberIds, themes) => ({
    id, coachId: COACH, name, level, day, time, durationMinutes, memberIds, slots: [], themes, annualPlan: null,
  });
  const groups = [
    g('demo-g-ma-jun', 'maanantai juniorit', 'Ma', '16:00', 60, 'Aloittelija', ['demo-s-eetu', 'demo-s-aino'], [
      theme(-3, 'Kämmenen pelitila', 'Korkea pallo takakenttään ja aikaa palata keskelle.'),
      theme(-2, 'Syötön heitto', 'Heitto samaan kohtaan joka kerta, maila valmiiksi selän takana.'),
      theme(-1, 'Syötön heitto', 'Heitto samaan kohtaan joka kerta, maila valmiiksi selän takana.'),
    ]),
    g('demo-g-ti-aik1', 'tiistai aikuiset', 'Ti', '17:00', 90, 'Keskitaso', [PLAYER, 'demo-s-aleksi', 'demo-s-venla', 'demo-s-mikko'], [
      theme(-3, 'Kämmenen pelitila', 'Korkea pallo takakenttään ja aikaa palata keskelle.'),
      theme(-2, 'Verkolle tulo', 'Lähestymislyönti linjaan ja split step ennen volleytä.'),
      theme(-1, 'Syötön rytmi', 'Tasainen heitto ja sama rytmi joka syötössä.'),
      theme(0, 'Kakkossyöttö', 'Kierre ja korkeus verkon yli — varmuus ennen vauhtia.'),
    ]),
    g('demo-g-ti-aik2', 'tiistai aikuiset', 'Ti', '18:30', 90, 'Edistynyt', ['demo-s-jussi', 'demo-s-sanna', 'demo-s-tiina'], [
      theme(-2, 'Verkolle tulo', 'Lähestymislyönti linjaan ja split step ennen volleytä.'),
      theme(-1, 'Syötön rytmi', 'Tasainen heitto ja sama rytmi joka syötössä.'),
      theme(0, 'Kakkossyöttö', 'Kierre ja korkeus verkon yli — varmuus ennen vauhtia.'),
    ]),
    g('demo-g-ke-jun', 'keskiviikko juniorit', 'Ke', '16:30', 60, 'Keskitaso', ['demo-s-ilona', 'demo-s-oskari', 'demo-s-leo'], [
      theme(-2, 'Syötön heitto', 'Heitto samaan kohtaan joka kerta, maila valmiiksi selän takana.'),
      theme(-1, 'Rysty ristiin', 'Vartalon kierto mukaan, lyönti loppuu korkealle.'),
    ]),
    g('demo-g-to-aik', 'torstai aikuiset', 'To', '18:00', 60, 'Keskitaso', [PLAYER, 'demo-s-jussi', 'demo-s-venla'], [
      theme(-2, 'Verkolle tulo', 'Lähestymislyönti linjaan ja split step ennen volleytä.'),
      theme(-1, 'Syötön rytmi', 'Tasainen heitto ja sama rytmi joka syötössä.'),
    ]),
    g('demo-g-pe-kilpa', 'perjantai kilpa', 'Pe', '17:00', 90, 'Kilpapelaaja', ['demo-s-sanna', 'demo-s-leo'], [
      theme(-1, 'Pisteen rakentaminen', 'Kolme palloa ristiin ennen suoraa.'),
    ]),
  ];
  groups.forEach(refreshThemes);

  // Six weeks of history and eight weeks ahead for every group (the last group runs out
  // sooner, so the "kalenteri loppuu" card has something to show).
  const start = koutsiAddDays(koutsiTodayStr(), -42);
  const trainings = groups.flatMap((group) => weeklySessions(group, start, group.id === 'demo-g-pe-kilpa' ? 8 : 14));
  const absent = (groupId, offsetWeeks, studentId) => {
    const target = koutsiAddDays(koutsiTodayStr(), -7 * offsetWeeks);
    const t = trainings.filter((x) => x.groupId === groupId && x.date <= target).pop();
    if (t) t.absences.push({ studentId, reason: 'poissa', note: '', reportedBy: studentId, updatedAt: isoAt(-7 * offsetWeeks - 1) });
  };
  absent('demo-g-ti-aik1', 1, 'demo-s-venla');
  absent('demo-g-ti-aik1', 3, PLAYER);
  absent('demo-g-ke-jun', 2, 'demo-s-leo');
  absent('demo-g-to-aik', 1, 'demo-s-jussi');

  trainings.push(
    { id: 'tr-private-1', date: day(2), time: '15:30', type: 'Yksityistunti', durationMinutes: 60, loggedBy: 'coach', notes: '', endDate: null, studentId: PLAYER, groupId: null, coachId: COACH, seriesId: null, absences: [] },
    { id: 'tr-self-1', date: day(-1), time: '09:00', type: 'Fysiikka', durationMinutes: 45, loggedBy: 'player', notes: 'Kuntosali — jalat ja keskivartalo.', endDate: null, studentId: PLAYER, groupId: null, coachId: COACH, seriesId: null, absences: [] },
    { id: 'tr-self-2', date: day(-3), time: '12:00', type: 'Omatoiminen harjoitus', durationMinutes: 40, loggedBy: 'player', notes: 'Syöttöjä yksin seinää vasten.', endDate: null, studentId: PLAYER, groupId: null, coachId: COACH, seriesId: null, absences: [] },
    { id: 'tr-self-3', date: day(-9), time: '18:00', type: 'Muu liikunta', durationMinutes: 60, loggedBy: 'player', notes: 'Sulkapalloa kaverin kanssa.', endDate: null, studentId: PLAYER, groupId: null, coachId: COACH, seriesId: null, absences: [] },
    { id: 'tr-self-4', date: day(-2), time: '17:30', type: 'Omatoiminen harjoitus', durationMinutes: 30, loggedBy: 'player', notes: 'Rystyn varjolyöntejä.', endDate: null, studentId: 'demo-s-aleksi', groupId: null, coachId: COACH, seriesId: null, absences: [] },
  );

  const coach = person(COACH, 'Anna Koskinen', {
    tagline: 'Tennisvalmentaja · Lahti',
    bio: 'Valmennan aikuisia ja junioreita. Erikoisalana lyöntitekniikka ja pelikäsitys.',
    experience: '12 vuotta valmennuskokemusta · Tennisliiton tason 2 koulutus',
    specialties: ['Ryhmätreenit', 'Juniorit', 'Aikuispelaajat', 'Kilpavalmennus'],
    welcomeSeenAt: isoAt(-80),
  });

  return {
    coach,
    coaches: [coach, person(COACH2, 'Juho Aalto', { tagline: 'Fysiikkavalmentaja', bio: '', experience: '', specialties: [], welcomeSeenAt: null })],
    students,
    groups,
    trainings,
    exercises: STARTER_EXERCISES.map((e, i) => ({ id: `demo-e-${i}`, coachId: COACH, ...e, video: null })),
    clubEvents: [
      { id: 'demo-ce-1', date: day(11), endDate: day(12), title: 'Seuran syyskisat', kind: 'kilpailu' },
      { id: 'demo-ce-2', date: day(24), endDate: null, title: 'Vanhempainilta', kind: 'seura' },
    ],
    notifications: [
      { id: 'demo-nt-1', kind: 'homework_done', title: 'Aleksi R. merkitsi kotiläksyn tehdyksi', body: 'Katso videoanalyysi backhandista', linkPath: '/valmentaja', createdAt: isoAt(-11), read: true },
      { id: 'demo-nt-2', kind: 'player_feedback', title: 'Jussi T. lähetti toiveen', body: 'Enemmän pistepelejä loppuun?', linkPath: '/valmentaja', createdAt: isoAt(-1), read: false },
    ],
    playerNotifications: [
      { id: 'demo-pn-1', kind: 'diary_added', title: 'Uusi huomio valmentajalta', body: 'Hyvä nousu syötössä tällä viikolla…', linkPath: '/pelaaja', createdAt: isoAt(-2, 19), read: false },
    ],
    // the coach's own diary: how the last two weeks went
    weekNotes: [
      { id: 'demo-wn-1', ...koutsiAddIsoWeeks(koutsiCurrentIsoWeek(), -2), score: 4, note: 'Juniorit innostuivat pistepeleistä. Lisää niitä loppuun.', updatedAt: isoAt(-10, 20) },
      { id: 'demo-wn-2', ...koutsiAddIsoWeeks(koutsiCurrentIsoWeek(), -1), score: 3, note: 'Sateinen viikko, kaksi siirtoa sisähalliin. Syötön heitto vaatii vielä toistoja.', updatedAt: isoAt(-3, 20) },
    ],
    inviteCodes: [],
    joinCode: 'ANNA24',
    emailPref: true,
    annualPlanSubmissions: [],
    profileName: { [COACH]: 'Anna Koskinen', [PLAYER]: 'Maria K.' },
    shortDate: koutsiFmtShortDate(koutsiTodayStr()),
  };
}
