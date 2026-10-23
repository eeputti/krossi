// seed.js — the demo world, laid out around today so it always looks like "this week".
//
// Anna coaches a full indoor season in Lahti: eleven weekly groups (juniors by ball colour, a
// competition group twice a week, adults by level, a weekday morning group, a Friday match
// night) and 40 players, ten of whom haven't joined yet. Themes run in two-week blocks for
// the past six weeks, two groups still lack this week's theme and next week is partly planned.
// Feelings, coach notes, absences and matches sit on the days the sessions were held, so every
// screen tells the same story. Nothing is stored: every page load starts from this seed.

import {
  koutsiCurrentIsoWeek, koutsiAddIsoWeeks, koutsiTodayStr, koutsiAddDays, koutsiNextWeekday, koutsiWeeklyDates,
  koutsiHueFromId, koutsiInitialOf, koutsiSplitThemes, koutsiFmtShortDate, koutsiPad,
} from '../../domain/core.js';
import { writePlan } from '../../domain/plan.js';
import { seasonName } from '../../domain/season.js';

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

function isoAt(offsetDays, hour = 12, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}
/** A local date ('YYYY-MM-DD') and time ('HH:MM') as an ISO timestamp. */
function isoOn(date, time = '12:00') {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, min, 0, 0).toISOString();
}
const day = (offset) => koutsiAddDays(koutsiTodayStr(), offset);
function plusMinutes(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 45);
  return `${koutsiPad(Math.floor(total / 60))}:${koutsiPad(total % 60)}`;
}

function person(id, name, extra) {
  return { id, name, initial: koutsiInitialOf(name), hue: koutsiHueFromId(id), avatarUrl: '', ...extra };
}

function student(id, name, { age = null, level = 'Keskitaso', placeholder = false, joinedDaysAgo = 60, ...rest } = {}) {
  return person(id, name, {
    isPlaceholder: placeholder, age, ageRange: null, ageValue: age == null ? '' : String(age), ageLabel: age == null ? '' : `${age} v`,
    level, goal: '', lastSession: '', focus: '', playerNote: '', playerWish: '', ambition: '', longGoal: '',
    joinedAt: placeholder ? null : isoAt(-joinedDaysAgo), welcomeSeenAt: placeholder ? null : isoAt(-joinedDaysAgo),
    diary: [], homework: [], videos: [], moods: [], matchNotes: [], goalHistory: [], wishHistory: [], noteHistory: [], longGoalHistory: [], ambitionHistory: [], archive: [], entries: [],
    ...rest,
  });
}

/** A player's own words with the history row the real backend keeps for them. */
const said = (field, value, at) => ({ id: `${field}-${at}`, at, field, value, previousValue: '', byPlayer: true });

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

// ── groups ───────────────────────────────────────────────────────────────────
// Ids the tests lean on (Maria's Tuesday and Thursday groups) stay as they were.
const G = {
  oranssi: 'demo-g-ma-jun',
  kilpaMa: 'demo-g-ma-kilpa',
  aamu: 'demo-g-ti-aamu',
  edisTi: 'demo-g-ti-aik1',
  jatko: 'demo-g-ti-aik2',
  vihrea: 'demo-g-ke-jun',
  kilpaKe: 'demo-g-ke-kilpa',
  edisTo: 'demo-g-to-aik',
  alkeet: 'demo-g-to-alkeet',
  peli: 'demo-g-pe-kilpa',
  punainen: 'demo-g-la-punainen',
};

const T = (title, lead) => ({ title, lead });
// Themes per group, oldest first: [0] = six weeks ago … [6] = this week, [7] = next week.
// null = no theme that week. Most themes run for two weeks.
const THEMES = {
  punainen: [
    T('Mailan hallinta', 'Pallo pysyy mailalla kävellen ja juosten.'),
    T('Pallon pompotus', 'Pompotus ylös ja alas — montako peräkkäin?'),
    T('Heitto ja kiinniotto', 'Pari heittää yli verkon, kiinni yhden pompun jälkeen.'),
    T('Kämmen pudotuksesta', 'Pudota, anna pompata ja lyö parille.'),
    T('Kämmen pudotuksesta', 'Pudota, anna pompata ja lyö parille.'),
    T('Rysty pudotuksesta', 'Sama rystypuolelle — kaksi kättä mailassa.'),
    T('Ralli parin kanssa', 'Kaksi kosketusta yli verkon ja takaisin.'),
  ],
  oranssi: [
    T('Valmiusasento ja split', 'Jalat leveälle, maila edessä ja pieni hyppy, kun pari lyö.'),
    T('Kämmenen loppuasento', 'Lyönti loppuu olan yli, katse jää osumakohtaan.'),
    T('Kämmenen loppuasento', 'Lyönti loppuu olan yli, katse jää osumakohtaan.'),
    T('Rysty kahdella kädellä', 'Molemmat kädet mailassa, olkapää kääntyy ennen lyöntiä.'),
    T('Rysty kahdella kädellä', 'Molemmat kädet mailassa, olkapää kääntyy ennen lyöntiä.'),
    T('Rallit ristiin', 'Viisi palloa ristiin ennen kuin pisteet alkavat.'),
    T('Syötön heitto', 'Heitto samaan kohtaan joka kerta, maila valmiiksi selän takana.'),
  ],
  kilpa: [
    T('Syöttö + 1', 'Syötön jälkeen ensimmäinen lyönti avoimeen kenttään.'),
    T('Syöttö + 1', 'Syötön jälkeen ensimmäinen lyönti avoimeen kenttään.'),
    T('Palautus kakkossyöttöön', 'Askel sisään ja hyökkäävä palautus rystykulmaan.'),
    T('Palautus kakkossyöttöön', 'Askel sisään ja hyökkäävä palautus rystykulmaan.'),
    T('Puolustuksesta hyökkäykseen', 'Korkea pallo syvälle, kunnes saat lyhyen — sitten sisään.'),
    T('Pistepelit paineessa', 'Tie-breakit ja 30–40-tilanteet, sama rutiini pisteiden välissä.'),
    T('Pisteen rakentaminen', 'Kolme palloa ristiin ennen suoraa.'),
    T('Valmistautuminen syyskisoihin', 'Ottelulämmittely, syöttörutiini ja oma pelisuunnitelma.'),
  ],
  aamu: [
    T('Nelinpelin asemat', 'Toinen verkolla, toinen takana — liikutaan pallon mukana yhdessä.'),
    T('Lobi verkkopelaajan yli', 'Korkea ja syvä lobi rystykulmaan, sitten yhdessä eteen.'),
    T('Lentolyönti verkolla', 'Lyhyt liike, maila edessä ja osuma vartalon edessä.'),
    T('Lentolyönti verkolla', 'Lyhyt liike, maila edessä ja osuma vartalon edessä.'),
    T('Varma ensimmäinen syöttö', 'Vähemmän vauhtia, enemmän sisään — tavoite 70 % ykkösiä.'),
    T('Palautus ristiin', 'Matala palautus ristiin verkkopelaajan ohi.'),
    T('Syöttäjän pari verkolla', 'Verkkopelaaja liikkuu syöttäjän merkistä ja sulkee keskikaistan.'),
  ],
  edistyneet: [
    T('Kämmenen pelitila', 'Korkea pallo takakenttään ja aikaa palata keskelle.'),
    T('Kämmenen pelitila', 'Korkea pallo takakenttään ja aikaa palata keskelle.'),
    T('Verkolle tulo', 'Lähestymislyönti linjaan ja split step ennen volleytä.'),
    T('Verkolle tulo', 'Lähestymislyönti linjaan ja split step ennen volleytä.'),
    T('Syötön rytmi', 'Tasainen heitto ja sama rytmi joka syötössä.'),
    T('Syötön rytmi', 'Tasainen heitto ja sama rytmi joka syötössä.'),
    T('Kakkossyöttö', 'Kierre ja korkeus verkon yli — varmuus ennen vauhtia.'),
    T('Kakkossyöttö', 'Kierre ja korkeus verkon yli — varmuus ennen vauhtia.'),
  ],
  jatko: [
    T('Kämmen ristiin', 'Pitkä ristipallo ja paluu keskelle ennen seuraavaa lyöntiä.'),
    T('Kämmen ristiin', 'Pitkä ristipallo ja paluu keskelle ennen seuraavaa lyöntiä.'),
    T('Rysty ristiin', 'Vartalon kierto mukaan, lyönti loppuu korkealle.'),
    T('Rysty ristiin', 'Vartalon kierto mukaan, lyönti loppuu korkealle.'),
    T('Syötön heitto', 'Heitto samaan kohtaan joka kerta, maila valmiiksi selän takana.'),
    T('Syötön rytmi', 'Tasainen heitto ja sama rytmi joka syötössä.'),
    T('Palautus syvälle keskelle', 'Lyhyt taaksevienti ja palautus syvälle keskelle — ei riskiä kulmiin.'),
  ],
  vihrea: [
    T('Yläkierre kämmenelle', 'Alhaalta ylös, lyönti loppuu olan yli.'),
    T('Yläkierre rystylle', 'Sama liike rystylle: maila alas ennen osumaa.'),
    T('Syvyys ristiin', 'Pallo syöttöviivan taakse — korkeus verkon yli ratkaisee.'),
    T('Syvyys ristiin', 'Pallo syöttöviivan taakse — korkeus verkon yli ratkaisee.'),
    T('Syötön rytmi', 'Heitto ja mailan pudotus samaan tahtiin.'),
    T('Verkolle tulo', 'Lyhyt pallo, lähestyminen ja lentolyönti pisteeseen.'),
    T('Lyhyt pallo ja hyökkäys', 'Astu sisään lyhyeen palloon ja lyö avoimeen kenttään.'),
  ],
  alkeet: [
    T('Ote ja valmiusasento', 'Kämmenote, rystyote ja paino päkiöillä.'),
    T('Kämmen', 'Kylki verkkoon ja osuma vartalon edessä.'),
    T('Rysty', 'Kaksi kättä mailassa ja olkapää kääntyy.'),
    T('Ralli syöttöviivalta', 'Viisi palloa yli verkon rauhallisella vauhdilla.'),
    T('Syötön alkeet', 'Pokaaliasento ja heitto ennen vauhtia.'),
    T('Pistelasku ja peli', 'Pelataan pisteitä: 15–30–40 ja syöttövuoro.'),
    null,
  ],
  peli: [
    T('Syöttöpelien pitäminen', 'Ykkössyöttö sisään ja ensimmäinen lyönti avoimeen kenttään.'),
    T('Tie-break', 'Pisteiden välinen rutiini ja kaksi ensimmäistä pistettä.'),
    T('Palautuspelit', 'Palautus syvälle keskelle ja paine heti ensimmäisestä pallosta.'),
    T('Nelinpeli', 'Pari puhuu jokaisen pisteen välissä: syöttö mihin, kuka ottaa keskeltä.'),
    T('Supertiebreak', 'Kymmenen pisteen erä — ei hidasta alkua.'),
    T('Pisteen rakentaminen', 'Kolme palloa ristiin ennen suoraa.'),
    null,
  ],
};

export function seed() {
  const now = koutsiCurrentIsoWeek();
  const today = koutsiTodayStr();
  const monday = koutsiAddDays(today, -((new Date().getDay() + 6) % 7));

  // ── players ────────────────────────────────────────────────────────────────
  const students = [
    // Juniorit punainen (5–7 v): for the youngest a parent joins, if anyone
    student('demo-s-iida', 'Iida M.', { age: 7, level: 'Aloittelija', joinedDaysAgo: 40 }),
    student('demo-s-onni', 'Onni K.', { age: 6, level: 'Aloittelija', placeholder: true }),
    student('demo-s-hilla', 'Hilla V.', { age: 7, level: 'Aloittelija', placeholder: true }),
    student('demo-s-eino', 'Eino R.', { age: 6, level: 'Aloittelija', joinedDaysAgo: 30 }),
    student('demo-s-sohvi', 'Sohvi L.', { age: 7, level: 'Aloittelija', placeholder: true }),
    // Juniorit oranssi (8–10 v)
    student('demo-s-eetu', 'Eetu J.', { age: 9, level: 'Aloittelija', placeholder: true }),
    student('demo-s-aino', 'Aino S.', { age: 9, level: 'Aloittelija', joinedDaysAgo: 50,
      homework: [{ id: 'h-aino', at: isoAt(-12, 18), text: 'Pompottele palloa mailalla 50 kertaa putkeen — ensin ylös, sitten alas.', done: true, doneAt: isoAt(-10, 18, 20) }] }),
    student('demo-s-veeti', 'Veeti H.', { age: 10, level: 'Aloittelija', joinedDaysAgo: 48 }),
    student('demo-s-lumi', 'Lumi P.', { age: 8, level: 'Aloittelija', placeholder: true }),
    student('demo-s-niilo', 'Niilo A.', { age: 9, level: 'Aloittelija', joinedDaysAgo: 44 }),
    student('demo-s-kerttu', 'Kerttu T.', { age: 10, level: 'Aloittelija', joinedDaysAgo: 52 }),
    // Juniorit vihreä (10–12 v)
    student('demo-s-elias', 'Elias N.', { age: 11, level: 'Keskitaso', joinedDaysAgo: 70, goal: 'Yläkierre rystyyn' }),
    student('demo-s-siiri', 'Siiri K.', { age: 12, level: 'Keskitaso', joinedDaysAgo: 70, goal: 'Syvemmät pallot ristiin', ambition: 'kilpailu',
      longGoal: 'Päästä kilparyhmään ensi syksynä', longGoalHistory: [said('long_goal', 'Päästä kilparyhmään ensi syksynä', isoAt(-30, 19))] }),
    student('demo-s-aatu', 'Aatu L.', { age: 11, level: 'Keskitaso', joinedDaysAgo: 66 }),
    student('demo-s-pihla', 'Pihla R.', { age: 12, level: 'Keskitaso', joinedDaysAgo: 64 }),
    student('demo-s-oskari', 'Oskari M.', { age: 12, level: 'Keskitaso', placeholder: true }),
    student('demo-s-ella', 'Ella V.', { age: 11, level: 'Keskitaso', joinedDaysAgo: 58 }),
    // Juniorit kilpa (13–16 v), Ma + Ke; Leo and Ilona also play Friday's match night
    student('demo-s-leo', 'Leo K.', { age: 16, level: 'Kilpapelaaja', joinedDaysAgo: 90, goal: 'Rystyn suora ja kärsivällisyys pitkissä vaihdoissa', ambition: 'huippu',
      longGoal: '18-vuotiaiden SM-kisoihin', longGoalHistory: [said('long_goal', '18-vuotiaiden SM-kisoihin', isoAt(-60, 20))] }),
    student('demo-s-ilona', 'Ilona P.', { age: 15, level: 'Kilpapelaaja', joinedDaysAgo: 88, goal: 'Kakkossyöttöön lisää kierrettä', ambition: 'kilpailu',
      homework: [{ id: 'h-ilona', at: isoAt(-9, 19), text: 'Syöttörutiini 5 min ennen jokaista treeniä: 10 ykköstä, 10 kakkosta.', done: true, doneAt: isoAt(-3, 16, 40) }] }),
    student('demo-s-emil', 'Emil S.', { age: 14, level: 'Kilpapelaaja', joinedDaysAgo: 85, goal: 'Kovempi ja varmempi ykkössyöttö', ambition: 'kilpailu' }),
    student('demo-s-saga', 'Saga L.', { age: 14, level: 'Kilpapelaaja', joinedDaysAgo: 85, goal: 'Pysyä rallissa pidempään' }),
    student('demo-s-rasmus', 'Rasmus T.', { age: 15, level: 'Edistynyt', joinedDaysAgo: 80, goal: 'Kämmenen yläkierre syvälle' }),
    // Aikuiset aamupäivä (Ti 10)
    student('demo-s-raimo', 'Raimo K.', { age: 68, level: 'Keskitaso', placeholder: true }),
    student('demo-s-pirjo', 'Pirjo S.', { age: 63, level: 'Keskitaso', joinedDaysAgo: 60, goal: 'Nelinpeliin varmuutta verkolle', ambition: 'harrastus',
      playerWish: 'Voisiko loppuun pelata enemmän nelinpeliä?', wishHistory: [said('wish', 'Voisiko loppuun pelata enemmän nelinpeliä?', isoAt(-2, 13, 10))] }),
    student('demo-s-hannu', 'Hannu V.', { age: 71, level: 'Keskitaso', joinedDaysAgo: 58, goal: 'Lentolyönnit varmemmiksi', ambition: 'harrastus' }),
    student('demo-s-marjaliisa', 'Marja-Liisa T.', { age: 66, level: 'Keskitaso', placeholder: true }),
    // Aikuiset edistyneet (Ti 17 + To 18)
    student(PLAYER, 'Maria K.', {
      age: 26, level: 'Edistynyt', joinedDaysAgo: 75,
      goal: 'Varmempi kakkossyöttö ja rohkeampi verkkopeli',
      playerWish: 'Haluaisin harjoitella enemmän verkkopeliä ensi kerralla.',
      wishHistory: [said('wish', 'Haluaisin harjoitella enemmän verkkopeliä ensi kerralla.', isoAt(-16, 20, 30))],
      ambition: 'kilpailu',
      ambitionHistory: [{ ...said('ambition', 'kilpailu', isoAt(-40, 20, 5)), previousValue: 'kehitys' }],
      longGoal: 'Pelata seuran joukkueessa aluesarjaa ensi kesänä',
      longGoalHistory: [said('long_goal', 'Pelata seuran joukkueessa aluesarjaa ensi kesänä', isoAt(-40, 20))],
      homework: [
        { id: 'h1', at: isoAt(-6, 19, 40), text: '20 kakkossyöttöä keskelle ja 20 rystykulmaan — kirjaa, montako meni sisään.', done: false, doneAt: null },
        { id: 'h0', at: isoAt(-20, 19, 40), text: 'Varjosyötöt peilin edessä 3×10 — heitto samaan kohtaan joka kerta.', done: true, doneAt: isoAt(-17, 8, 15) },
      ],
      matchNotes: [
        { id: 'n1', at: isoAt(-4, 21), opponentName: 'Sofia L.', date: day(-4), note: 'Vahva kämmen, rystyllä epävarma paineessa. Pelasin toiselle puolelle ja tulin verkolle lyhyistä.', durationMinutes: 95, result: 'voitto', format: 'kaksinpeli', score: '6-4 6-3', partnerName: '', opponent2Name: '', tournamentId: null },
        { id: 'n2', at: isoAt(-11, 21), opponentName: 'Emma V.', date: day(-11), note: 'Hyvä ensimmäinen erä. Toisessa liikaa kaksoisvirheitä — kakkossyöttö jäi verkkoon.', durationMinutes: 100, result: 'tappio', format: 'nelinpeli', score: '6-7 4-6', partnerName: 'Sanna P.', opponent2Name: 'Kaisa R.', tournamentId: null },
        { id: 'n3', at: isoAt(-25, 21), opponentName: 'Emma V.', date: day(-25), note: 'Liikaa virheitä kakkossyötöllä.', durationMinutes: 80, result: 'tappio', format: 'kaksinpeli', score: '4-6 5-7', partnerName: '', opponent2Name: '', tournamentId: null },
      ],
      goalHistory: [
        { id: 'gh1', at: isoAt(-40, 20), field: 'goal', value: 'Varmempi kakkossyöttö ja rohkeampi verkkopeli', previousValue: 'Varmempi kakkossyöttö', byPlayer: true },
      ],
      entries: [
        { id: 'e1', at: isoAt(-2, 19), date: day(-2), text: 'Syötin 50 kakkossyöttöä kentän tyhjällä puolella ja pelasin kaverin kanssa tunnin.', how: 'Kick-syöttö alkoi nousta, 8/10 meni sisään.' },
        { id: 'e2', at: isoAt(-10, 20), date: day(-10), text: 'Seinää vasten 30 min: rystyn slice ja lentolyönnit.', how: 'Lentolyönnit alkoivat tuntua luontevilta.' },
      ],
    }),
    student('demo-s-aleksi', 'Aleksi R.', { age: 31, level: 'Edistynyt', joinedDaysAgo: 72, goal: 'Rystyn tasapaino pitkissä vaihdoissa', ambition: 'kehitys',
      homework: [{ id: 'h2', at: isoAt(-8, 19, 50), text: 'Rystyn varjolyönnit 3×15 askelkuvion kanssa', done: true, doneAt: isoAt(-2, 7, 45) }] }),
    student('demo-s-sanna', 'Sanna P.', { age: 35, level: 'Edistynyt', joinedDaysAgo: 74, goal: 'Ensimmäinen syöttö 65 % sisään', ambition: 'kilpailu',
      matchNotes: [{ id: 'n-sanna', at: isoAt(-11, 21, 10), opponentName: 'Emma V.', date: day(-11), note: 'Marian kanssa hyvä ensimmäinen erä. Pitää puhua enemmän pisteiden välissä.', durationMinutes: 100, result: 'tappio', format: 'nelinpeli', score: '6-7 4-6', partnerName: 'Maria K.', opponent2Name: 'Kaisa R.', tournamentId: null }] }),
    student('demo-s-petri', 'Petri L.', { age: 44, level: 'Edistynyt', joinedDaysAgo: 70, goal: 'Vähemmän virheitä kämmenellä pitkissä palloissa' }),
    student('demo-s-laura', 'Laura N.', { age: 29, level: 'Edistynyt', joinedDaysAgo: 68, goal: 'Kevään ensimmäinen kilpailu', ambition: 'kilpailu',
      playerNote: 'Olen marraskuussa kaksi viikkoa työmatkalla, merkitsen poissaolot sovellukseen.',
      noteHistory: [said('note', 'Olen marraskuussa kaksi viikkoa työmatkalla, merkitsen poissaolot sovellukseen.', isoAt(-6, 21, 15))] }),
    student('demo-s-tommi', 'Tommi H.', { age: 38, level: 'Edistynyt', joinedDaysAgo: 62 }),
    // Aikuiset jatko (Ti 18:30)
    student('demo-s-jussi', 'Jussi T.', { age: 41, level: 'Keskitaso', joinedDaysAgo: 66, goal: 'Pelata seuran sisäisessä sarjassa', ambition: 'kehitys',
      playerWish: 'Enemmän pistepelejä loppuun?', wishHistory: [said('wish', 'Enemmän pistepelejä loppuun?', isoAt(-1, 21, 5))] }),
    student('demo-s-venla', 'Venla H.', { age: 27, level: 'Keskitaso', joinedDaysAgo: 64, goal: 'Rysty varmaksi ristiin' }),
    student('demo-s-tiina', 'Tiina R.', { age: 45, level: 'Keskitaso', joinedDaysAgo: 60 }),
    student('demo-s-mikko', 'Mikko L.', { age: 52, level: 'Keskitaso', placeholder: true }),
    // Aikuiset alkeet (To 19:30), started in September
    student('demo-s-johanna', 'Johanna K.', { age: 39, level: 'Aloittelija', joinedDaysAgo: 45, goal: 'Pelata kaverin kanssa ensi kesänä', ambition: 'harrastus' }),
    student('demo-s-antti', 'Antti V.', { age: 47, level: 'Aloittelija', placeholder: true }),
    student('demo-s-noora', 'Noora S.', { age: 33, level: 'Aloittelija', joinedDaysAgo: 5 }),
    student('demo-s-kalle', 'Kalle M.', { age: 36, level: 'Aloittelija', joinedDaysAgo: 44, goal: 'Syöttö sisään yläkautta' }),
  ];
  const byId = Object.fromEntries(students.map((s) => [s.id, s]));

  const group = (id, name, weekday, time, durationMinutes, level, memberIds, themes) => ({
    id, coachId: COACH, name, level, day: weekday, time, durationMinutes, memberIds, slots: [], annualPlan: null,
    themes: themes.map((t, i) => (t ? { id: newId('t'), ...koutsiAddIsoWeeks(now, i - 6), ...t } : null)).filter(Boolean),
  });
  const kilpa = ['demo-s-leo', 'demo-s-ilona', 'demo-s-emil', 'demo-s-saga', 'demo-s-rasmus'];
  const groups = [
    group(G.oranssi, 'Juniorit oranssi', 'Ma', '16:00', 60, 'Aloittelija', ['demo-s-eetu', 'demo-s-aino', 'demo-s-veeti', 'demo-s-lumi', 'demo-s-niilo', 'demo-s-kerttu'], THEMES.oranssi),
    group(G.kilpaMa, 'Juniorit kilpa', 'Ma', '17:00', 90, 'Kilpapelaaja', kilpa, THEMES.kilpa),
    group(G.aamu, 'Aikuiset aamupäivä', 'Ti', '10:00', 90, 'Keskitaso', ['demo-s-raimo', 'demo-s-pirjo', 'demo-s-hannu', 'demo-s-marjaliisa'], THEMES.aamu),
    group(G.edisTi, 'Aikuiset edistyneet', 'Ti', '17:00', 90, 'Edistynyt', [PLAYER, 'demo-s-aleksi', 'demo-s-sanna', 'demo-s-petri'], THEMES.edistyneet),
    group(G.jatko, 'Aikuiset jatko', 'Ti', '18:30', 90, 'Keskitaso', ['demo-s-jussi', 'demo-s-venla', 'demo-s-tiina', 'demo-s-mikko'], THEMES.jatko),
    group(G.vihrea, 'Juniorit vihreä', 'Ke', '16:30', 60, 'Keskitaso', ['demo-s-elias', 'demo-s-siiri', 'demo-s-aatu', 'demo-s-pihla', 'demo-s-oskari', 'demo-s-ella'], THEMES.vihrea),
    group(G.kilpaKe, 'Juniorit kilpa', 'Ke', '17:30', 90, 'Kilpapelaaja', kilpa, THEMES.kilpa),
    group(G.edisTo, 'Aikuiset edistyneet', 'To', '18:00', 90, 'Edistynyt', [PLAYER, 'demo-s-sanna', 'demo-s-laura', 'demo-s-tommi'], THEMES.edistyneet),
    group(G.alkeet, 'Aikuiset alkeet', 'To', '19:30', 90, 'Aloittelija', ['demo-s-johanna', 'demo-s-antti', 'demo-s-noora', 'demo-s-kalle'], THEMES.alkeet),
    group(G.peli, 'Pelipäivä', 'Pe', '17:00', 90, 'Edistynyt', ['demo-s-sanna', 'demo-s-petri', 'demo-s-laura', 'demo-s-tommi', 'demo-s-leo', 'demo-s-ilona'], THEMES.peli),
    group(G.punainen, 'Juniorit punainen', 'La', '09:00', 45, 'Aloittelija', ['demo-s-iida', 'demo-s-onni', 'demo-s-hilla', 'demo-s-eino', 'demo-s-sohvi'], THEMES.punainen),
  ];

  // Six weeks of history and seven ahead for every group. Pelipäivä is a fall series that
  // ends next week, so the "kalenteri loppuu" card has something to show.
  const start = koutsiAddDays(monday, -42);
  const trainings = groups.flatMap((g) => weeklySessions(g, start, g.id === G.peli ? 8 : 14));

  // A group still waits for this week's theme only while its session is ahead; once it has
  // been held (late in the week) it ran on last week's theme, like a real coach would do.
  groups.forEach((g) => {
    const thisWeek = koutsiAddIsoWeeks(now, 0);
    if (g.themes.some((t) => t.year === thisWeek.year && t.week === thisWeek.week)) return;
    const held = trainings.some((t) => t.groupId === g.id && t.date >= monday && t.date < today);
    const last = g.themes[g.themes.length - 1];
    if (held && last) g.themes.push({ id: newId('t'), ...thisWeek, title: last.title, lead: last.lead });
  });
  groups.forEach(refreshThemes);

  // The season these groups run in: from the first session week to the Sunday of the calendar's
  // last week (Pelipäivä is a shorter series inside it). "Uusi kausi" copies it for the next one.
  const lastDate = trainings.filter((t) => t.groupId !== G.peli).map((t) => t.date).sort().pop();
  const season = { id: 'demo-season-1', coachId: COACH, name: seasonName(start), startsOn: start, endsOn: koutsiNextWeekday(lastDate, 'Su'), breaks: [] };
  groups.forEach((g) => { g.seasonId = season.id; });

  // ── helpers over the calendar ─────────────────────────────────────────────
  const sessionsOf = (groupId) => trainings.filter((t) => t.groupId === groupId);
  /** The group's session in week `w` (0 = this week, -1 = last week …). */
  const inWeek = (groupId, w) => {
    const from = koutsiAddDays(monday, 7 * w);
    const to = koutsiAddDays(from, 6);
    return sessionsOf(groupId).find((t) => t.date >= from && t.date <= to) || null;
  };
  /** The group's n:th latest session before today (0 = the latest). */
  const past = (groupId, n = 0) => sessionsOf(groupId).filter((t) => t.date < today).reverse()[n] || null;
  const nextOf = (groupId) => sessionsOf(groupId).find((t) => t.date >= today) || null;
  const after = (t, minutes) => isoOn(t.date, plusMinutes(t.time, (t.durationMinutes || 60) + minutes));

  const absent = (t, studentId, by = studentId) => {
    if (!t) return;
    const updatedAt = by === studentId ? isoOn(koutsiAddDays(t.date, -1), '20:40') : isoOn(t.date, plusMinutes(t.time, 5));
    t.absences.push({ studentId, reason: 'poissa', note: '', reportedBy: by, updatedAt });
  };
  const mood = (studentId, t, score, note = '') => {
    if (!t) return;
    byId[studentId].moods.push({ id: newId('m'), at: after(t, 50), score, note, hiddenFromCoach: false, trainingId: t.id });
  };
  const coachNote = (studentId, t, text) => {
    if (!t) return;
    byId[studentId].diary.push({ id: newId('d'), at: after(t, 25), text });
  };

  // ── attendance ────────────────────────────────────────────────────────────
  absent(inWeek(G.edisTi, -3), PLAYER);
  absent(past(G.jatko, 1), 'demo-s-venla');
  // last week five juniors were away on Monday and Wednesday (the coach's diary says so)
  absent(inWeek(G.oranssi, -1), 'demo-s-lumi', COACH);
  absent(inWeek(G.oranssi, -1), 'demo-s-niilo');
  absent(inWeek(G.vihrea, -1), 'demo-s-aatu');
  absent(inWeek(G.vihrea, -1), 'demo-s-ella', COACH);
  absent(inWeek(G.kilpaMa, -1), 'demo-s-saga');
  absent(inWeek(G.aamu, -2), 'demo-s-raimo', COACH);
  absent(inWeek(G.alkeet, -4), 'demo-s-kalle', COACH);
  absent(inWeek(G.peli, -2), 'demo-s-leo');
  absent(inWeek(G.peli, -1), 'demo-s-petri');
  // Tommi already said he can't make the next Thursday
  const tommiNext = nextOf(G.edisTo);
  if (tommiNext) tommiNext.absences.push({ studentId: 'demo-s-tommi', reason: 'poissa', note: '', reportedBy: 'demo-s-tommi', updatedAt: isoAt(-1, 21, 40) });

  // ── Maria's story ─────────────────────────────────────────────────────────
  // Her latest session gets no feeling, so the player demo opens with "Miten meni?".
  const mariaHeld = trainings
    .filter((t) => (t.groupId === G.edisTi || t.groupId === G.edisTo) && t.date < today && !t.absences.some((a) => a.studentId === PLAYER))
    .sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  [[4, 'Syöttö kulki, jalat vähän väsyneet.'], [5, 'Paras treeni pitkään aikaan!'], [3, ''], [4, 'Verkolla tuli onnistumisia.'], [4, '']]
    .forEach(([score, note], i) => mood(PLAYER, mariaHeld[i + 1], score, note));
  coachNote(PLAYER, mariaHeld[0], 'Hyvä nousu syötössä — heitto pysyy jo samassa kohdassa. Seuraavaksi kakkossyötön suunta rystykulmaan.');
  coachNote(PLAYER, inWeek(G.edisTo, -2), 'Syötön rytmi parani, kun laskit ääneen "heitto – lyönti". Pidä sama rytmi myös otteluissa.');
  coachNote(PLAYER, inWeek(G.edisTi, -4), 'Aloitettiin lähestymislyönti linjaan. Muista split step ennen volleytä — nyt jäit välillä seisomaan.');
  coachNote(PLAYER, inWeek(G.edisTo, -6), 'Kämmen ristiin toimii, kun annat pallolle korkeutta. Paluu keskelle on vielä hidas.');

  // ── the rest of the players ───────────────────────────────────────────────
  mood('demo-s-aleksi', past(G.edisTi), 4, 'Jalat liikkui hyvin.');
  mood('demo-s-petri', past(G.edisTi), 3, 'Kämmen karkasi pitkäksi.');
  mood('demo-s-sanna', past(G.edisTo), 5, 'Verkkopeli kulki.');
  mood('demo-s-laura', past(G.edisTo, 1), 4);
  mood('demo-s-jussi', past(G.jatko), 4);
  mood('demo-s-venla', past(G.jatko), 3, 'Väsynyt päivä, mutta rysty toimi.');
  mood('demo-s-leo', past(G.kilpaMa), 4);
  mood('demo-s-ilona', past(G.kilpaKe), 5, 'Tie-breakit meni hyvin!');
  mood('demo-s-emil', past(G.kilpaMa, 1), 4);
  mood('demo-s-hannu', past(G.aamu), 4, 'Lentolyönnit alkaa sujua.');
  mood('demo-s-pirjo', past(G.aamu), 5);
  mood('demo-s-johanna', past(G.alkeet), 5, 'Ensimmäiset pitkät rallit!');
  mood('demo-s-siiri', past(G.vihrea), 5, 'Kivaa!');
  mood('demo-s-kerttu', past(G.oranssi), 4);
  coachNote('demo-s-aleksi', past(G.edisTi, 1), 'Rysty parani — liike alkaa ajoissa. Pidä tasapaino lyönnin loppuun asti.');
  coachNote('demo-s-leo', past(G.kilpaMa), 'Hyvä viikonloppu turnauksessa. Supertiebreakissa kiirehdit — pidä rutiini pisteiden välissä.');
  coachNote('demo-s-siiri', past(G.vihrea, 1), 'Upea syvyys ristiin! Seuraavaksi sama rystylle.');
  coachNote('demo-s-johanna', past(G.alkeet, 1), 'Pokaaliasento löytyi. Heitä pallo vähän eteenpäin, niin syöttö lähtee ylös.');
  const leoHomeworkFrom = past(G.kilpaMa);
  if (leoHomeworkFrom) {
    byId['demo-s-leo'].homework.push({ id: 'h-leo', at: after(leoHomeworkFrom, 30), text: '3×10 syöttöä rystykulmaan ja pisteiden välinen rutiini ennen jokaista sarjaa.', done: false, doneAt: null });
  }

  // Leo's tournament last weekend, logged by Leo with both matches.
  const tourSat = koutsiNextWeekday(day(-7), 'La');
  const tourSun = koutsiAddDays(tourSat, 1);
  byId['demo-s-leo'].matchNotes.push(
    { id: 'n-leo-1', at: isoOn(tourSat, '13:20'), opponentName: 'Aaro V.', date: tourSat, note: 'Syöttö piti koko ottelun. Rystyn suora toimi tärkeissä pisteissä.', durationMinutes: 85, result: 'voitto', format: 'kaksinpeli', score: '6-3 7-5', partnerName: '', opponent2Name: '', tournamentId: 'tr-leo-tour' },
    { id: 'n-leo-2', at: isoOn(tourSun, '15:10'), opponentName: 'Joel M.', date: tourSun, note: 'Supertiebreakissa kiirehdin ja rutiini pisteiden välissä unohtui.', durationMinutes: 110, result: 'tappio', format: 'kaksinpeli', score: '4-6 6-4 8-10', partnerName: '', opponent2Name: '', tournamentId: 'tr-leo-tour' },
  );

  // ── session plans ─────────────────────────────────────────────────────────
  const own = (name) => `demo-e-${STARTER_EXERCISES.findIndex((e) => e.name === name)}`;
  const item = (part, lib, name, cat, minutes) => {
    const mine = STARTER_EXERCISES.some((e) => e.name === name);
    return { part, ref: mine ? own(name) : `k-${lib}`, lib, name, cat, minutes };
  };
  const plan = (t, items) => { if (t) t.notes = writePlan({ note: '', items }); };
  // Maria's next Tuesday (this week's theme: kakkossyöttö)
  plan(nextOf(G.edisTi), [
    item('lammittely', 'lam-11', 'Minitennis ristiin', 'lammittely', 10),
    item('harjoitteet', 'syo-08', 'Kakkossyöttö + suunta', 'syotto', 15),
    item('harjoitteet', 'syo-09', 'Syöttö + ensimmäinen lyönti', 'syotto', 15),
    item('harjoitteet', 'syo-15', 'Ristiinpeli: kaksoisvirhe maksaa kaksi', 'syotto', 20),
    item('peli', 'pis-03', 'Pistepeli 7 pisteeseen', 'pistepeli', 15),
    item('loppu', 'fys-03', 'Jäähdyttely ja venyttely', 'fysiikka', 8),
  ]);
  plan(nextOf(G.vihrea), [
    item('lammittely', 'lam-12', 'Minitennis jonossa', 'lammittely', 8),
    item('harjoitteet', 'poh-24', 'Lyhyt pallo: astu sisään ja ratkaise', 'pohjalyonnit', 15),
    item('harjoitteet', 'ver-08', 'Lähestymislyönti ja verkkoon', 'verkkopeli', 15),
    item('peli', 'pis-12', 'Lyhyt pallo on pakko hyökätä', 'pistepeli', 15),
    item('loppu', 'fys-03', 'Jäähdyttely ja venyttely', 'fysiikka', 7),
  ]);
  plan(nextOf(G.kilpaMa), [
    item('lammittely', 'lam-17', 'Ottelulämmittely 10 minuutissa', 'lammittely', 10),
    item('harjoitteet', 'poh-18', 'Kaksi ristiin, yksi suoraan', 'pohjalyonnit', 15),
    item('harjoitteet', 'poh-31', 'Ensimmäinen suora avaa kentän', 'pohjalyonnit', 20),
    item('peli', 'pis-34', 'Puolusta, rakenna, hyökkää', 'pistepeli', 15),
    item('peli', 'pis-21', 'Tie-break -harjoitus', 'pistepeli', 20),
    item('loppu', 'fys-03', 'Jäähdyttely ja venyttely', 'fysiikka', 10),
  ]);

  // ── private lessons and the players' own logs ─────────────────────────────
  const nextFri = koutsiNextWeekday(day(1), 'Pe');
  const lesson = (id, studentId, date, time) => ({ id, date, time, type: 'Yksityistunti', durationMinutes: 60, loggedBy: 'coach', notes: '', endDate: null, studentId, groupId: null, coachId: COACH, seriesId: null, absences: [] });
  const log = (id, studentId, date, time, type, durationMinutes, notes) => ({ id, date, time, type, durationMinutes, loggedBy: 'player', notes, endDate: null, studentId, groupId: null, coachId: COACH, seriesId: null, absences: [] });
  trainings.push(
    lesson('tr-private-1', PLAYER, nextFri, '15:30'),
    lesson('tr-private-0', PLAYER, koutsiAddDays(nextFri, -14), '15:30'),
    lesson('tr-private-leo', 'demo-s-leo', koutsiNextWeekday(day(1), 'To'), '16:00'),
    log('tr-self-1', PLAYER, day(-1), '09:00', 'Fysiikka', 45, 'Kuntosali — jalat ja keskivartalo'),
    log('tr-self-2', PLAYER, day(-3), '12:00', 'Omatoiminen harjoitus', 40, 'Syöttöjä yksin seinää vasten, 60 kakkossyöttöä.'),
    log('tr-self-3', PLAYER, day(-6), '07:30', 'Fysiikka', 35, 'Lenkki — 6 km rauhallisesti'),
    log('tr-self-4', PLAYER, day(-9), '18:00', 'Muu liikunta', 60, 'Sulkapalloa kaverin kanssa.'),
    log('tr-self-5', PLAYER, day(-13), '20:00', 'Fysiikka', 30, 'Liikkuvuus — rullaus ja lonkat'),
    log('tr-self-6', 'demo-s-aleksi', day(-2), '07:15', 'Omatoiminen harjoitus', 30, 'Kotiläksy — Rystyn varjolyönnit 3×15 askelkuvion kanssa'),
    log('tr-self-7', 'demo-s-sanna', day(-4), '06:45', 'Fysiikka', 50, 'Lenkki — 8 km'),
    log('tr-self-8', 'demo-s-leo', day(-2), '15:00', 'Fysiikka', 60, 'Kuntosali — Juhon ohjelma: jalat ja keskivartalo'),
    log('tr-self-9', 'demo-s-leo', day(-5), '19:45', 'Fysiikka', 30, 'Lenkki — 5 km palauttava'),
    log('tr-self-10', 'demo-s-tiina', day(-5), '07:00', 'Muu liikunta', 45, 'Uinti 1 km.'),
    log('tr-self-11', 'demo-s-johanna', day(-3), '17:00', 'Omatoiminen harjoitus', 60, 'Rallia kaverin kanssa ja syöttöjä yläkautta.'),
    { ...log('tr-leo-tour', 'demo-s-leo', tourSat, '09:00', 'Turnaus', null, 'Junioriturnaus, Hollola'), endDate: tourSun },
  );

  // ── newest first, like the real backend returns them ─────────────────────
  const desc = (key) => (a, b) => String(b[key]).localeCompare(String(a[key]));
  students.forEach((s) => {
    s.diary.sort(desc('at'));
    s.moods.sort(desc('at'));
    s.matchNotes.sort(desc('at'));
    s.homework.sort(desc('at'));
    s.entries.sort(desc('date'));
  });

  const coach = person(COACH, 'Anna Koskinen', {
    tagline: 'Tennisvalmentaja · Lahti',
    bio: 'Valmennan junioreita ja aikuisia Lahden sisähallissa. Jokaisella viikolla on yksi selkeä teema, ja pelaaja näkee sen jo ennen treeniä.',
    experience: '12 vuotta valmennuskokemusta · Tennisliiton tason 2 valmentajakoulutus',
    specialties: ['Juniorit', 'Aikuisryhmät', 'Kilpavalmennus', 'Syöttö ja palautus'],
    welcomeSeenAt: isoAt(-80),
  });

  const leoLoss = byId['demo-s-leo'].matchNotes.find((n) => n.id === 'n-leo-2');
  const mariaNote = byId[PLAYER].diary[0];
  const kisat = koutsiNextWeekday(day(7), 'La');
  const leiri = koutsiNextWeekday(day(33), 'Pe');
  return {
    coach,
    coaches: [coach, person(COACH2, 'Juho Aalto', { tagline: 'Fysiikkavalmentaja · kilparyhmät', bio: '', experience: '', specialties: [], welcomeSeenAt: null })],
    students,
    groups,
    trainings,
    seasons: [season],
    seasonDraft: null,
    exercises: STARTER_EXERCISES.map((e, i) => ({ id: `demo-e-${i}`, coachId: COACH, ...e, video: null })),
    clubEvents: [
      { id: 'demo-ce-1', date: kisat, endDate: koutsiAddDays(kisat, 1), title: 'Seuran syyskisat', kind: 'kilpailu' },
      { id: 'demo-ce-2', date: koutsiNextWeekday(day(14), 'Ke'), endDate: null, title: 'Junioreiden vanhempainilta', kind: 'seura' },
      { id: 'demo-ce-3', date: leiri, endDate: koutsiAddDays(leiri, 2), title: 'Kilparyhmän leiri', kind: 'leiri' },
    ],
    notifications: [
      { id: 'demo-nt-1', kind: 'match_note', title: 'Uusi ottelumuistiinpano', body: 'Leo K. — vastustaja Joel M.', linkPath: '/valmentaja/pelaaja/demo-s-leo', createdAt: leoLoss.at, read: false },
      { id: 'demo-nt-2', kind: 'player_feedback', title: 'Jussi T. lähetti toiveen', body: 'Enemmän pistepelejä loppuun?', linkPath: '/valmentaja/pelaaja/demo-s-jussi', createdAt: isoAt(-1, 21, 5), read: false },
      { id: 'demo-nt-3', kind: 'homework_done', title: 'Aleksi R. merkitsi kotiläksyn tehdyksi', body: 'Rystyn varjolyönnit 3×15 askelkuvion kanssa', linkPath: '/valmentaja/pelaaja/demo-s-aleksi', createdAt: isoAt(-2, 7, 45), read: false },
      { id: 'demo-nt-4', kind: 'player_feedback', title: 'Pirjo S. lähetti toiveen', body: 'Voisiko loppuun pelata enemmän nelinpeliä?', linkPath: '/valmentaja/pelaaja/demo-s-pirjo', createdAt: isoAt(-2, 13, 10), read: true },
      { id: 'demo-nt-5', kind: 'match_note', title: 'Uusi ottelumuistiinpano', body: 'Maria K. — vastustaja Sofia L.', linkPath: '/valmentaja/pelaaja/demo-s-maria', createdAt: isoAt(-4, 21), read: true },
    ].sort(desc('createdAt')),
    playerNotifications: [
      { id: 'demo-pn-1', kind: 'diary_added', title: 'Uusi merkintä valmentajaltasi', body: mariaNote ? mariaNote.text : '', linkPath: '/pelaaja', createdAt: mariaNote ? mariaNote.at : isoAt(-1, 19), read: false },
      { id: 'demo-pn-2', kind: 'homework_added', title: 'Sait uuden kotiläksyn', body: '20 kakkossyöttöä keskelle ja 20 rystykulmaan — kirjaa, montako meni sisään.', linkPath: '/pelaaja', createdAt: isoAt(-6, 19, 40), read: true },
      { id: 'demo-pn-3', kind: 'training_added', title: 'Uusi treeni kalenterissasi', body: `Yksityistunti ${koutsiFmtShortDate(nextFri)} klo 15:30`, linkPath: '/pelaaja', createdAt: isoAt(-7, 10, 30), read: true },
    ],
    // the coach's own diary: how the last three weeks went
    weekNotes: [
      { id: 'demo-wn-1', ...koutsiAddIsoWeeks(now, -3), score: 4, note: 'Kilparyhmän palautuspelit toimivat: kakkossyötön kimppuun meneminen alkaa näkyä. Alkeisryhmä sai ensimmäiset pitkät rallit syöttöviivalta.', updatedAt: isoAt(-17, 20) },
      { id: 'demo-wn-2', ...koutsiAddIsoWeeks(now, -2), score: 5, note: 'Paras viikko tähän asti. Maria löysi syöttöön saman heittokohdan, ja aamupäiväryhmä innostui syöttöharjoituksista.', updatedAt: isoAt(-10, 20) },
      { id: 'demo-wn-3', ...koutsiAddIsoWeeks(now, -1), score: 3, note: 'Junioreista viisi pois maanantaina ja keskiviikkona. Aikuisilla syötön rytmi vaatii vielä toistoja — jatketaan kakkossyötöllä kaksi viikkoa.', updatedAt: isoAt(-3, 20) },
    ],
    // Tiedotteet (ehdotus): a practical notice to Maria's groups, on their Koti until next Sunday.
    announcements: [
      { id: 'demo-an-1', coachId: COACH, text: 'Ensi viikolla treenit ovat kentällä 3, koska kentät 1–2 ovat turnauskäytössä. Kellonajat pysyvät samoina.', groupIds: [G.edisTi, G.edisTo], studentIds: [], until: koutsiAddDays(monday, 13), at: isoAt(0, 9, 15) },
    ],
    inviteCodes: [],
    joinCode: 'ANNA24',
    emailPref: true,
    annualPlanSubmissions: [],
    profileName: { [COACH]: 'Anna Koskinen', [PLAYER]: 'Maria K.' },
    shortDate: koutsiFmtShortDate(today),
  };
}
