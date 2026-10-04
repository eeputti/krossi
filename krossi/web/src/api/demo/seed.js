// seed.js — the demo world: Alex from Lahti, ~18 other players, open games for the coming
// days, nine months of tennis history, chats, a league and pending requests.
//
// Everything comes from a fixed-seed PRNG and is laid out relative to `now`, so the demo looks
// the same on every visit while dates always read "this week", "yesterday", "in 3 days".
// The history is hand-shaped so the gamification has something to show: a live streak of
// 4+ weeks (confirmed league matches add to it), an earlier 7-week streak, a 3-win run,
// ~10 games Alex organised, five venues and a dozen partners.

import { INDOOR_VENUES } from '../../lib/constants.js';
import { ME, capacityOf, expiresAtFor, joinMeta, wonSets } from './rows.js';

const SEED = 20260924;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ── Deterministic randomness ─────────────────────────────────────────────────

/** mulberry32 — tiny, fast and good enough for seed data. */
function createRng(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    /** pairs: [[value, weight], …] */
    weighted(pairs) {
      const total = pairs.reduce((sum, [, w]) => sum + w, 0);
      let roll = next() * total;
      for (const [value, weight] of pairs) {
        roll -= weight;
        if (roll < 0) return value;
      }
      return pairs[pairs.length - 1][0];
    },
  };
}

// ── Local-time helpers (DST-safe: calendar days, not 24 h steps) ─────────────

const iso = (ms) => new Date(ms).toISOString();

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function addDays(ms, days) {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

function atTime(dayMs, time) {
  const [hours, minutes] = time.split(':').map(Number);
  const d = new Date(dayMs);
  d.setHours(hours, minutes, 0, 0);
  return d.getTime();
}

/** Monday 00:00 of the ISO week containing `ms`. */
function isoWeekStart(ms) {
  const day = startOfDay(ms);
  const weekday = (new Date(day).getDay() + 6) % 7; // Mon = 0
  return addDays(day, -weekday);
}

// ── Places ───────────────────────────────────────────────────────────────────

function indoor(name) {
  const v = INDOOR_VENUES.find((x) => x.name === name);
  return { name: v.name, city: v.city, lat: v.lat, lng: v.lng, locationType: 'sisätennis', courtSurface: 'kova' };
}

const PLACES = {
  janus: indoor('Janus Areena'),
  kispi: indoor('Kispi Areena'),
  smash: indoor('Smash Center'),
  tampere: indoor('Tampereen Tenniskeskus'),
  kisapuisto: {
    name: 'Kisapuiston tenniskentät', city: 'Lahti', lat: 60.98795, lng: 25.6562,
    locationType: 'ulkotennis', courtSurface: 'massa',
  },
  open: { name: 'Avoin', city: 'Lahti', lat: null, lng: null, locationType: 'missä vain', courtSurface: null },
};

// ── People ───────────────────────────────────────────────────────────────────

const ALEX = {
  key: 'me', name: 'Alex', ageRange: '30-40', gender: null, areas: ['Lahti'], color: 'green',
  level: 'keskitaso', styles: ['matsit', 'kaksinpeli'], slots: ['arki-illat', 'viikonloppuaamut'],
  hand: 'oikeakätinen', backhand: 'kahden käden', thisWeek: true, joinedDaysAgo: 275,
  bio: 'Pelaan pari kertaa viikossa, mieluiten iltaisin. Kunnon matsit on parhaita, mutta pallottelukin käy. Etsin vakiopelikavereita Lahdesta!',
};

const PEOPLE = [
  { key: 'mikko', name: 'Mikko', ageRange: '30-40', gender: 'mies', areas: ['Lahti'], color: 'blue', level: 'keskitaso',
    styles: ['matsit', 'kaksinpeli', 'nelinpeli'], slots: ['arki-illat', 'viikonloppupäivät'], hand: 'oikeakätinen', backhand: 'kahden käden',
    thisWeek: true, joinedDaysAgo: 320, bio: 'Pelannut parikymppisestä asti ja nyt taas innostunut. Hyvä matsi ja sauna perään 🎾' },
  { key: 'laura', name: 'Laura', ageRange: '30-40', gender: 'nainen', areas: ['Lahti'], color: 'red', level: 'keskitaso',
    styles: ['matsit', 'nelinpeli', 'pallottelu'], slots: ['arki-illat', 'viikonloppuaamut'], hand: 'oikeakätinen', backhand: 'kahden käden',
    thisWeek: true, joinedDaysAgo: 290, bio: 'Nelinpeli on parasta! Etsin rentoa mutta tavoitteellista porukkaa.' },
  { key: 'joonas', name: 'Joonas', ageRange: '20-30', gender: 'mies', areas: ['Lahti'], color: 'yellow', level: 'edistynyt',
    styles: ['matsit', 'kaksinpeli', 'treenit'], slots: ['aamuvirkku', 'arki-illat'], hand: 'vasenkätinen', backhand: 'yhden käden',
    joinedDaysAgo: 240, bio: 'Juniorina pelasin kilpaa, nyt harrastan. Aamupelit ennen töitä kiinnostaa.' },
  { key: 'aino', name: 'Aino', ageRange: '20-30', gender: 'nainen', areas: ['Lahti'], color: 'green', level: 'aloittelija',
    styles: ['pallottelu', 'treenit'], slots: ['arki-iltapäivät', 'viikonloppupäivät'], hand: 'oikeakätinen', backhand: 'kahden käden',
    joinedDaysAgo: 75, bio: 'Aloitin tenniksen viime kesänä. Etsin rentoa pallotteluseuraa!' },
  { key: 'ville', name: 'Ville', ageRange: '40-50', gender: 'mies', areas: ['Lahti'], color: 'blue', level: 'keskitaso',
    styles: ['nelinpeli', 'matsit'], slots: ['arki-illat', 'viikonloppuaamut'], hand: 'oikeakätinen', backhand: 'yhden käden',
    joinedDaysAgo: 300, bio: 'Kahden lapsen isä ja tennishullu. Nelinpeli ja hyvä tunnelma ennen kaikkea.' },
  { key: 'sanna', name: 'Sanna', ageRange: '40-50', gender: 'nainen', areas: ['Lahti'], color: 'yellow', level: 'edistynyt',
    styles: ['nelinpeli', 'matsit'], slots: ['arkiaamut', 'viikonloppuaamut'], hand: 'oikeakätinen', backhand: 'kahden käden',
    thisWeek: true, joinedDaysAgo: 210, bio: 'Pelaan vuorotyön lomassa aamuisin. Hyvät nelinpelit kiinnostaa aina.' },
  { key: 'teemu', name: 'Teemu', ageRange: '30-40', gender: 'mies', areas: ['Lahti'], color: 'red', level: 'kilpapelaaja', classes: ['C1', 'C2'],
    styles: ['matsit', 'kaksinpeli'], slots: ['arki-illat'], hand: 'oikeakätinen', backhand: 'kahden käden', playingNow: 'Kispissä vapaa kenttä, tule pelaamaan!',
    joinedDaysAgo: 180, bio: 'Kilpailen C-luokassa. Haen kovia harjoitusmatseja — pitkät rallit tervetulleita.' },
  { key: 'emilia', name: 'Emilia', ageRange: '20-30', gender: 'nainen', areas: ['Lahti'], color: 'green', level: 'keskitaso',
    styles: ['kaksinpeli', 'pallottelu'], slots: ['arki-iltapäivät', 'arki-illat'], hand: 'oikeakätinen', backhand: 'kahden käden',
    joinedDaysAgo: 160, bio: 'Opiskelen Lahdessa ja pelaan mielelläni iltaisin. Matsit ja pallottelu käy molemmat.' },
  { key: 'antti', name: 'Antti', ageRange: '60+', gender: 'mies', areas: ['Lahti'], color: 'yellow', level: 'keskitaso',
    styles: ['matsit', 'nelinpeli'], slots: ['arkipäivät', 'viikonloppuaamut'], hand: 'oikeakätinen', backhand: 'yhden käden',
    joinedDaysAgo: 230, bio: 'Eläkkeellä ja aikaa on! Päiväpelit sopivat parhaiten.' },
  { key: 'henna', name: 'Henna', ageRange: '30-40', gender: 'nainen', areas: ['Lahti'], color: 'red', level: 'keskitaso',
    styles: ['pallottelu', 'nelinpeli', 'kaikki käy'], slots: ['viikonloppupäivät', 'joustavasti'], hand: 'oikeakätinen', backhand: 'kahden käden',
    joinedDaysAgo: 120, bio: 'Kaikki käy, kunhan pallo lentää 😄' },
  { key: 'juho', name: 'Juho', ageRange: 'alle20', gender: 'mies', areas: ['Lahti'], color: 'blue', level: 'aloittelija',
    styles: ['treenit', 'kaksinpeli'], slots: ['arki-iltapäivät'], hand: 'oikeakätinen', backhand: 'kahden käden',
    thisWeek: true, joinedDaysAgo: 40, bio: 'Lukiolainen, haluan kehittyä nopeasti. Syötöt vielä hakusessa!' },
  { key: 'riikka', name: 'Riikka', ageRange: '20-30', gender: 'nainen', areas: ['Lahti'], color: 'green', level: 'kilpapelaaja', classes: ['B2'],
    styles: ['matsit', 'kaksinpeli', 'treenit'], slots: ['aamuvirkku', 'viikonloppuaamut'], hand: 'oikeakätinen', backhand: 'kahden käden',
    joinedDaysAgo: 140, bio: 'B2-luokan pelaaja. Treenaan kisoihin ja etsin tasaisia sparrauksia.' },
  { key: 'olli', name: 'Olli', ageRange: '50-60', gender: 'mies', areas: ['Lahti'], color: 'yellow', level: 'keskitaso',
    styles: ['pallottelu', 'nelinpeli'], slots: ['aamuvirkku', 'arkiaamut'], hand: 'oikeakätinen', backhand: 'yhden käden',
    joinedDaysAgo: 260, bio: 'Aamukahvi ja pallottelu — parempaa aamua ei ole.' },
  { key: 'petra', name: 'Petra', ageRange: '40-50', gender: 'nainen', areas: ['Lahti'], color: 'red', level: 'edistynyt',
    styles: ['treenit', 'nelinpeli', 'kaikki käy'], slots: ['joustavasti'], hand: 'oikeakätinen', backhand: 'kahden käden',
    joinedDaysAgo: 330, bio: 'Valmennan junioreita ja järjestän Krossi-iltoja Lahdessa. Tervetuloa mukaan!' },
  { key: 'kaisa', name: 'Kaisa', ageRange: '40-50', gender: 'nainen', areas: ['Tampere', 'Lahti'], color: 'blue', level: 'keskitaso',
    styles: ['matsit', 'nelinpeli'], slots: ['arki-iltapäivät', 'viikonloppupäivät'], hand: 'oikeakätinen', backhand: 'kahden käden',
    joinedDaysAgo: 100, bio: 'Asun Tampereella ja käyn Lahdessa töissä. Pelaan molemmissa!' },
  { key: 'elina', name: 'Elina', ageRange: '30-40', gender: 'nainen', areas: ['Helsinki'], color: 'yellow', level: 'edistynyt',
    styles: ['matsit', 'kaksinpeli'], slots: ['arki-illat', 'viikonloppuaamut'], hand: 'oikeakätinen', backhand: 'kahden käden',
    joinedDaysAgo: 200, bio: 'Helsingissä asuva tennisintoilija. Kova halli ja kova matsi.' },
  { key: 'tuomas', name: 'Tuomas', ageRange: '20-30', gender: 'mies', areas: ['Helsinki'], color: 'green', level: 'kilpapelaaja', classes: ['B1'],
    styles: ['matsit', 'treenit'], slots: ['aamuvirkku', 'arki-illat'], hand: 'vasenkätinen', backhand: 'kahden käden',
    thisWeek: true, joinedDaysAgo: 150, bio: 'B1-pelaaja, haen sparrauskavereita kisakauteen.' },
  { key: 'niko', name: 'Niko', ageRange: '30-40', gender: 'mies', areas: ['Tampere'], color: 'red', level: 'keskitaso',
    styles: ['matsit', 'kaksinpeli', 'nelinpeli'], slots: ['arki-illat', 'viikonloppupäivät'], hand: 'oikeakätinen', backhand: 'kahden käden',
    joinedDaysAgo: 250, bio: 'Tamperelainen viikonloppusoturi. Tule käymään Tenniskeskuksessa!' },
];

const pid = (key) => (key === 'me' ? ME : `p-${key}`);

function buildProfile(def, now) {
  const createdAt = now - def.joinedDaysAgo * DAY;
  return {
    id: pid(def.key),
    name: def.name,
    ageRange: def.ageRange,
    gender: def.gender,
    city: def.areas[0] || '',
    areas: [...def.areas],
    bio: def.bio,
    avatarUrl: null,
    avatarColor: def.color,
    skillLevel: def.level,
    competitionClasses: def.classes ? [...def.classes] : [],
    playStyles: [...def.styles],
    availability: [...def.slots],
    handedness: def.hand,
    backhand: def.backhand,
    playingThisWeek: Boolean(def.thisWeek),
    playingNowUntil: def.playingNow ? iso(now + 90 * MIN) : null,
    playingNowNote: def.playingNow || null,
    hiddenFromFeed: false,
    paidAt: iso(createdAt + 2 * HOUR),
    createdAt: iso(createdAt),
  };
}

// ── Games ────────────────────────────────────────────────────────────────────

function makeGame(spec) {
  const place = PLACES[spec.place];
  const createdAt = iso(spec.createdAt);
  const scheduledAt = spec.at == null ? null : iso(spec.at);
  const game = {
    id: spec.id,
    kind: spec.kind || 'open',
    status: 'open',
    outcome: spec.outcome ?? null,
    creatorId: pid(spec.creator),
    participantIds: (spec.joiners || []).map(pid),
    waitlistIds: (spec.waitlist || []).map(pid),
    matchType: spec.type,
    locationName: place.name,
    locationType: place.locationType,
    courtSurface: place.courtSurface,
    city: place.city,
    lat: place.lat,
    lng: place.lng,
    scheduledAt,
    expiresAt: expiresAtFor(scheduledAt, createdAt),
    title: spec.title || null,
    description: spec.description || null,
    minSkillLevel: spec.minSkill || null,
    courtPrice: spec.courtPrice ?? null,
    creatorCoversFull: Boolean(spec.covers),
    maxPlayers: spec.maxPlayers ?? null,
    createdAt,
  };
  game.status = spec.status || (game.participantIds.length >= capacityOf(game) ? 'filled' : 'open');
  return game;
}

/** A start time `dayOffset` days from today, pushed a day later if it would be within 90 min. */
function upcomingAt(now, dayOffset, time) {
  const today = startOfDay(now);
  const t = atTime(addDays(today, dayOffset), time);
  return t >= now + 90 * MIN ? t : atTime(addDays(today, dayOffset + 1), time);
}

function buildUpcomingGames(now) {
  const up = (dayOffset, time) => upcomingAt(now, dayOffset, time);
  const ago = (hours) => now - hours * HOUR;
  return [
    // Alex's own games
    { id: 'g-alex-nelinpeli', creator: 'me', joiners: ['mikko', 'laura', 'ville'], type: 'nelinpeli', place: 'janus',
      at: up(2, '18:30'), createdAt: ago(72), title: 'Iltanelinpeli Januksessa', courtPrice: 36,
      description: 'Pelataan pari tuntia, kenttä on varattu. Tuon uudet pallot!' },
    { id: 'g-joonas-aamu', creator: 'joonas', joiners: ['me'], type: 'kaksinpeli', place: 'kispi',
      at: up(5, '07:30'), createdAt: ago(48), description: 'Aamumatsi ennen töitä, tunnin vuoro.', courtPrice: 24 },
    // Open games around Lahti
    { id: 'g-teemu-ilta', creator: 'teemu', type: 'kaksinpeli', place: 'kispi', at: up(0, '19:00'), createdAt: ago(5),
      minSkill: 'keskitaso', courtPrice: 28, description: 'Haen kunnon harjoitusmatsia, 1,5 tunnin vuoro.' },
    { id: 'g-olli-aamu', creator: 'olli', type: 'pallottelu', place: 'kispi', at: up(1, '07:00'), createdAt: ago(26),
      title: 'Aamupallottelut', description: 'Rentoa lyöntiharjoittelua ennen töitä ☕' },
    { id: 'g-sanna-nelinpeli', creator: 'sanna', joiners: ['olli'], type: 'nelinpeli', place: 'janus', at: up(2, '10:00'),
      createdAt: ago(30), title: 'Rento nelinpeli', courtPrice: 32, description: 'Kaksi paikkaa vapaana, kaikki tasot keskitasosta ylöspäin.' },
    { id: 'g-riikka-matsi', creator: 'riikka', type: 'kaksinpeli', place: 'janus', at: up(3, '20:00'), createdAt: ago(44),
      minSkill: 'edistynyt', title: 'Kovatasoinen matsi', description: 'Treenaan kisoihin ja etsin tasaista vastusta. B- ja C-luokan pelaajat tervetuloa!' },
    { id: 'g-antti-paiva', creator: 'antti', joiners: ['emilia'], waitlist: ['juho'], type: 'kaksinpeli', place: 'janus',
      at: up(4, '11:00'), createdAt: ago(50), courtPrice: 26, covers: true, description: 'Päivämatsi, minä maksan kentän.' },
    { id: 'g-juho-treeni', creator: 'juho', type: 'kaksinpeli', place: 'kispi', at: up(5, '16:30'), createdAt: ago(9),
      description: 'Olen aloittelija ja haluaisin harjoitella syöttöjä ja pitkiä palloralleja.' },
    { id: 'g-petra-ilta', kind: 'event', creator: 'petra', joiners: ['laura', 'henna', 'aino', 'olli'], type: 'nelinpeli', place: 'janus',
      at: up(6, '18:00'), createdAt: ago(75), maxPlayers: 8, courtPrice: 15, title: 'Krossi-ilta: vaihtuvat parit',
      description: 'Pelataan lyhyitä nelinpelejä vaihtuvilla pareilla. Kaikki tasot tervetulleita! Kenttämaksu 15 € / pelaaja, pallot ja vesi tarjolla.' },
    { id: 'g-henna-porukka', creator: 'henna', type: 'nelinpeli', place: 'open', at: null, createdAt: ago(6),
      title: 'Nelinpeliporukka kasaan', description: 'Aika ja paikka sovitaan porukalla — kuka lähtee?' },
    { id: 'g-ville-kutsu', creator: 'ville', type: 'kaksinpeli', place: 'kispi', at: up(7, '18:00'), createdAt: ago(4),
      description: 'Matsi tai pallottelua, fiiliksen mukaan.' },
    { id: 'g-mikko-nelinpeli', creator: 'mikko', joiners: ['antti', 'ville'], type: 'nelinpeli', place: 'janus', at: up(8, '10:00'),
      createdAt: ago(12), title: 'Viikonlopun nelinpeli', courtPrice: 36, description: 'Yksi paikka vapaana — tule neljänneksi!' },
    { id: 'g-emilia-pallottelu', creator: 'emilia', type: 'pallottelu', place: 'kispi', at: up(9, '17:00'), createdAt: ago(3),
      description: 'Rentoa pallottelua luentojen jälkeen, kaikki tasot tervetulleita!' },
    // Other cities
    { id: 'g-elina-smash', creator: 'elina', type: 'kaksinpeli', place: 'smash', at: up(2, '19:00'), createdAt: ago(20), courtPrice: 30 },
    { id: 'g-niko-tampere', creator: 'niko', joiners: ['kaisa'], type: 'nelinpeli', place: 'tampere', at: up(3, '18:00'),
      createdAt: ago(28), title: 'Torstain nelinpeli', courtPrice: 34 },
  ].map(makeGame);
}

// Alex's played history. `w` = ISO weeks back from this week, `day` 1 = Mon … 7 = Sun.
// 'local' places resolve by season: outdoor courts in May–September, otherwise a hall.
// `result` = [gameType, won] when Alex also logged a score for it.
const HISTORY = [
  { w: 0, day: 0, time: '', type: 'kaksinpeli', with: ['mikko'], org: 'me', result: ['full_match', true] }, // day/time chosen at build time
  { w: 1, day: 2, time: '18:30', type: 'nelinpeli', with: ['mikko', 'laura', 'ville'], org: 'ville', result: ['sets', true] },
  { w: 1, day: 4, time: '19:00', type: 'kaksinpeli', with: ['joonas'], org: 'joonas', result: ['full_match', true] },
  { w: 2, day: 7, time: '11:00', type: 'pallottelu', with: ['henna'], org: 'henna' },
  { w: 3, day: 3, time: '18:30', type: 'kaksinpeli', with: ['laura'], org: 'me', result: ['sets', false] },
  // weeks 4–5 empty: the current streak is exactly 4 weeks
  { w: 6, day: 2, time: '07:30', type: 'kaksinpeli', with: ['joonas'], org: 'me', result: ['full_match', true] },
  { w: 8, day: 4, time: '18:00', type: 'nelinpeli', with: ['mikko', 'sanna', 'olli'], org: 'sanna' },
  { w: 9, day: 1, time: '19:00', type: 'kaksinpeli', with: ['teemu'], org: 'teemu', result: ['full_match', false] },
  { w: 9, day: 6, time: '10:30', type: 'pallottelu', with: ['aino'], org: 'me' },
  { w: 11, day: 3, time: '18:30', type: 'kaksinpeli', with: ['mikko'], org: 'mikko', result: ['tiebreak', true] },
  { w: 13, day: 7, time: '12:00', type: 'nelinpeli', with: ['laura', 'henna', 'ville'], org: 'laura' },
  // weeks 14–15 empty; weeks 16–22 are the earlier 7-week streak
  { w: 16, day: 2, time: '18:00', type: 'kaksinpeli', with: ['mikko'], org: 'me', result: ['sets', true] },
  { w: 17, day: 6, time: '12:00', type: 'kaksinpeli', with: ['niko'], org: 'niko', place: 'tampere', result: ['full_match', false] },
  { w: 18, day: 4, time: '19:00', type: 'nelinpeli', with: ['mikko', 'laura', 'antti'], org: 'antti', result: ['sets', true] },
  { w: 18, day: 7, time: '10:00', type: 'pallottelu', with: ['juho'], org: 'me' },
  { w: 19, day: 3, time: '18:30', type: 'kaksinpeli', with: ['joonas'], org: 'joonas', result: ['full_match', false] },
  { w: 20, day: 1, time: '18:00', type: 'kaksinpeli', with: ['emilia'], org: 'emilia' },
  { w: 21, day: 5, time: '17:30', type: 'nelinpeli', with: ['ville', 'mikko', 'olli'], org: 'mikko', result: ['sets', true] },
  { w: 21, day: 7, time: '11:00', type: 'kaksinpeli', with: ['laura'], org: 'me', result: ['sets', true] },
  { w: 22, day: 2, time: '19:00', type: 'kaksinpeli', with: ['mikko'], org: 'mikko' },
  // weeks 23–24 empty
  { w: 25, day: 4, time: '18:30', type: 'kaksinpeli', with: ['elina'], org: 'elina', place: 'smash', result: ['full_match', false] },
  { w: 26, day: 3, time: '19:00', type: 'kaksinpeli', with: ['mikko'], org: 'me', result: ['full_match', true] },
  { w: 26, day: 6, time: '11:00', type: 'nelinpeli', with: ['laura', 'sanna', 'henna'], org: 'sanna', result: ['sets', false] },
  { w: 28, day: 2, time: '18:00', type: 'pallottelu', with: ['olli'], org: 'olli' },
  { w: 30, day: 1, time: '19:30', type: 'kaksinpeli', with: ['joonas'], org: 'me', result: ['sets', true] },
  { w: 31, day: 4, time: '18:00', type: 'kaksinpeli', with: ['mikko'], org: 'mikko' },
  { w: 33, day: 7, time: '12:00', type: 'nelinpeli', with: ['ville', 'antti', 'mikko'], org: 'ville' },
  { w: 35, day: 3, time: '19:00', type: 'kaksinpeli', with: ['emilia'], org: 'me', result: ['full_match', true] },
  { w: 36, day: 6, time: '10:00', type: 'pallottelu', with: ['laura'], org: 'laura' },
  { w: 38, day: 2, time: '18:30', type: 'kaksinpeli', with: ['mikko'], org: 'mikko' },
];

/**
 * Picks the slot for this week's game: the latest weekday slot that's already over (preferably
 * before yesterday, which holds the "Pelasitteko?" game). Returns null early on Monday, when
 * nothing this week can be in the past yet — the whole history then shifts back a week.
 */
function thisWeeksSlot(now) {
  const week = isoWeekStart(now);
  const candidates = [[3, '18:30'], [2, '07:30'], [1, '18:30']].map(([day, time]) => ({ day, time, at: atTime(addDays(week, day - 1), time) }));
  const yesterday = addDays(startOfDay(now), -1);
  return candidates.find((c) => c.at < yesterday) || candidates.find((c) => c.at + 3 * HOUR < now) || null;
}

function resolvePlace(rng, entry, at) {
  // Always draw both numbers so the random sequence doesn't depend on the season.
  const outdoorRoll = rng.next();
  const hallRoll = rng.next();
  if (entry.place) return entry.place;
  const month = new Date(at).getMonth() + 1;
  if (month >= 5 && month <= 9 && outdoorRoll < 0.65) return 'kisapuisto';
  return hallRoll < 0.5 ? 'janus' : 'kispi';
}

function buildHistory(now, rng) {
  const week = isoWeekStart(now);
  const slot = thisWeeksSlot(now);
  const shift = slot ? 0 : 1;
  const games = [];
  const results = [];

  HISTORY.forEach((entry, index) => {
    const weeksBack = entry.w + shift;
    const day = entry.w === 0 ? (slot ? slot.day : 3) : entry.day;
    const time = entry.w === 0 ? (slot ? slot.time : '18:30') : entry.time;
    const at = atTime(addDays(week, -7 * weeksBack + day - 1), time);
    const place = resolvePlace(rng, entry, at);
    const creator = entry.org;
    const joiners = ['me', ...entry.with].filter((k) => k !== creator);
    const hallPrice = PLACES[place].locationType === 'sisätennis' ? rng.pick([24, 28, 32, 36]) : null;
    games.push(makeGame({
      id: `g-hist-${String(index + 1).padStart(2, '0')}`,
      creator, joiners, type: entry.type, place, at,
      createdAt: at - rng.int(20, 120) * HOUR,
      outcome: 'played',
      courtPrice: hallPrice,
    }));
    if (entry.result) results.push(buildResult(rng, entry, at, results.length + 1));
  });

  return { games, results, firstGameAt: games[0].scheduledAt };
}

// ── Match results ────────────────────────────────────────────────────────────

function setScore(rng, iWin) {
  const loserGames = rng.weighted([[0, 1], [1, 2], [2, 4], [3, 5], [4, 5], [5, 3], [6, 3]]);
  const winnerGames = loserGames >= 5 ? 7 : 6;
  return iWin ? { my: winnerGames, opp: loserGames } : { my: loserGames, opp: winnerGames };
}

function matchSets(rng, gameType, won) {
  if (gameType === 'tiebreak') {
    const loser = rng.int(4, 8);
    return [won ? { my: 10, opp: loser } : { my: loser, opp: 10 }];
  }
  const threeSets = rng.chance(gameType === 'full_match' ? 0.45 : 0.3);
  const order = !threeSets ? [won, won] : rng.chance(0.5) ? [won, !won, won] : [!won, won, won];
  const sets = order.map((iWin) => setScore(rng, iWin));
  return wonSets(sets, 'my', 'opp') === won ? sets : sets.map((s) => ({ my: s.opp, opp: s.my }));
}

function buildResult(rng, entry, playedAt, n) {
  const [gameType, won] = entry.result;
  const doubles = entry.type === 'nelinpeli';
  const name = (key) => PEOPLE.find((p) => p.key === key).name;
  return {
    id: `r-${String(n).padStart(2, '0')}`,
    createdAt: iso(playedAt + 2 * HOUR + rng.int(0, 40) * MIN),
    gameType,
    format: doubles ? 'doubles' : 'singles',
    partnerName: doubles ? name(entry.with[0]) : null,
    opponentName: name(doubles ? entry.with[1] : entry.with[0]),
    oppPartnerName: doubles ? name(entry.with[2]) : null,
    sets: matchSets(rng, gameType, won),
    won,
  };
}

// ── Past games that aren't part of the played history ────────────────────────

function buildOtherPastGames(now) {
  const week = isoWeekStart(now);
  const weekAt = (weeksBack, day, time) => atTime(addDays(week, -7 * weeksBack + day - 1), time);
  const yesterday = atTime(addDays(startOfDay(now), -1), '18:00');
  return [
    // The one game whose outcome Alex hasn't answered yet ("Pelasitteko?")
    makeGame({ id: 'g-eilen', creator: 'me', joiners: ['emilia'], type: 'kaksinpeli', place: 'kispi',
      at: yesterday, createdAt: yesterday - 50 * HOUR, courtPrice: 28 }),
    makeGame({ id: 'g-peruttu', creator: 'laura', joiners: ['me'], type: 'kaksinpeli', place: 'janus', status: 'cancelled',
      at: weekAt(7, 4, '19:00'), createdAt: weekAt(7, 1, '12:00'), description: 'Sori, flunssa iski — siirretään!' }),
    makeGame({ id: 'g-ei-pelattu', creator: 'me', joiners: ['olli'], type: 'kaksinpeli', place: 'kispi', outcome: 'not_played',
      at: weekAt(12, 2, '18:00'), createdAt: weekAt(12, 1, '09:00') }),
  ];
}

// ── Conversations ────────────────────────────────────────────────────────────

function buildConversations(now, games) {
  const conversations = [];
  const messages = new Map();
  let messageNo = 0;
  const playedAt = (id) => Date.parse(games.find((g) => g.id === id).scheduledAt);

  /** Adds a conversation; `lines` are [timeMs, senderKey, text | {join: gameId}]. */
  function thread({ id, members, gameId = null, lines, readUpTo = Infinity }) {
    const list = [];
    let previous = 0;
    for (const [rawAt, senderKey, content] of lines) {
      // Clamp into the past and keep the order strict even if relative times collide.
      const at = Math.max(Math.min(rawAt, now - 2 * MIN), previous + 1000);
      previous = at;
      messageNo += 1;
      const base = { id: `m-${messageNo}`, conversationId: id, senderId: pid(senderKey), imageUrl: null, createdAt: iso(at), meta: null };
      if (typeof content === 'object' && content.join) {
        const game = games.find((g) => g.id === content.join);
        const joiner = [ALEX, ...PEOPLE].find((p) => p.key === senderKey);
        const meta = joinMeta(game, { id: pid(senderKey), name: joiner.name, avatarUrl: null, avatarColor: joiner.color });
        list.push({ ...base, kind: 'join', text: `${joiner.name} liittyi peliin!`, meta });
      } else {
        list.push({ ...base, kind: 'text', text: content });
      }
    }
    const last = list[list.length - 1];
    const readAt = Math.min(readUpTo, Date.parse(last.createdAt));
    conversations.push({
      id, gameId, participantIds: members.map(pid), updatedAt: last.createdAt,
      lastReadAt: { [ME]: iso(readAt) },
    });
    messages.set(id, list);
  }

  const h = (hoursAgo) => now - hoursAgo * HOUR;
  const thisWeek = playedAt('g-hist-01');
  const withLaura = playedAt('g-hist-05');
  const withHenna = playedAt('g-hist-04');
  const inTampere = playedAt('g-hist-13');

  thread({ id: 'c-nelinpeli', gameId: 'g-alex-nelinpeli', members: ['me', 'mikko', 'laura', 'ville'], lines: [
    [h(70), 'mikko', { join: 'g-alex-nelinpeli' }],
    [h(69.9), 'mikko', 'Jes, mukana! 💪'],
    [h(50), 'laura', { join: 'g-alex-nelinpeli' }],
    [h(49.8), 'laura', 'Kiva! Kuka on parini? 😄'],
    [h(49), 'me', 'Arvotaan paikan päällä — tai Laura ja Ville vastaan minä ja Mikko?'],
    [h(27), 'ville', { join: 'g-alex-nelinpeli' }],
    [h(26.9), 'ville', 'Sopii mulle. Tuon pallot, jos tarvii.'],
    [h(20), 'mikko', 'Nähdään hallilla! Lähdetäänkö saunaan perään?'],
    [h(19.5), 'laura', 'Ehdottomasti 🧖'],
  ] });

  thread({ id: 'c-joonas-peli', gameId: 'g-joonas-aamu', members: ['me', 'joonas'], lines: [
    [h(40), 'me', { join: 'g-joonas-aamu' }],
    [h(39), 'joonas', 'Moi Alex! Hyvä, nähdään Kispissä. Varasin kentän 3.'],
    [h(38.5), 'me', 'Mahtavaa, nähdään! 🎾'],
  ] });

  thread({ id: 'c-mikko', members: ['me', 'mikko'], lines: [
    [thisWeek + 2.5 * HOUR, 'mikko', 'Hyvä matsi! Revanssi ensi viikolla 😄'],
    [thisWeek + 2.7 * HOUR, 'me', 'Kiitos! Tiukka oli, ilman muuta revanssi.'],
    [h(26), 'mikko', 'Mietin uutta mailaa, onko sulla suosituksia?'],
    [h(25), 'me', 'Kokeile Januksen testimailoja, siellä on hyvä valikoima. Kevyempi kehys teki mun kyynärpäälle hyvää.'],
    [h(24.5), 'mikko', 'Hyvä vinkki, kokeilen! 👍'],
  ] });

  // The one unread conversation
  thread({ id: 'c-laura', members: ['me', 'laura'], readUpTo: withLaura + 4 * HOUR, lines: [
    [withLaura + 3 * HOUR, 'me', 'Kiitos pelistä! Ensi kerralla nelinpeli?'],
    [withLaura + 3.5 * HOUR, 'laura', 'Ehdottomasti! Kerään porukkaa 🙌'],
    [now - 35 * MIN, 'laura', 'Moi! Lähtisitkö viikonloppuna aamupäivällä pelaamaan Janukseen? Saan kentän klo 10 🎾'],
  ] });

  thread({ id: 'c-henna', members: ['me', 'henna'], lines: [
    [withHenna - 6 * DAY, 'henna', 'Moi! Haluaisitko pallotella joskus viikonloppuna? 🙂'],
    [withHenna - 6 * DAY + HOUR, 'me', 'Moi Henna! Mielellään, sunnuntai sopisi hyvin.'],
    [withHenna - 5 * DAY, 'henna', 'Super! Laitan pelin Krossiin, niin voit liittyä.'],
    [withHenna + 3 * HOUR, 'henna', 'Kiitos pelistä, oli tosi kiva! 😊'],
    [withHenna + 3.5 * HOUR, 'me', 'Kiitos itsellesi! Uusiksi pian.'],
  ] });

  // Archived: an away game in Tampere a few months back
  thread({ id: 'c-niko', members: ['me', 'niko'], lines: [
    [inTampere - 4 * DAY, 'niko', 'Moi! Huomasin, että olet tulossa Tampereelle. Lähdetkö matsiin Tenniskeskukseen?'],
    [inTampere - 4 * DAY + 2 * HOUR, 'me', 'Joo! Lauantaina klo 12 sopisi.'],
    [inTampere - 3 * DAY, 'niko', 'Sovittu, laitan pelin Krossiin 👍'],
    [inTampere + 3 * HOUR, 'me', 'Kiitos matsista! Hieno halli teillä.'],
    [inTampere + 4 * HOUR, 'niko', 'Kiitti itelle! Tervetuloa uudestaan 🎾'],
  ] });

  return { conversations, messages, archivedIds: ['c-niko'] };
}

// ── Leagues ──────────────────────────────────────────────────────────────────

function seasonLabels(now) {
  const d = new Date(now);
  const year = d.getFullYear();
  if (d.getMonth() >= 6) {
    return { current: `Syyskausi ${year}`, next: `Talviliiga ${year}–${String(year + 1).slice(2)}` };
  }
  return { current: `Kevätkausi ${year}`, next: `Kesäliiga ${year}` };
}

/** Same grouping + round robin as the start_league SQL (input order instead of random()). */
export function roundRobin(memberIds) {
  const pairs = [];
  for (let i = 0; i < memberIds.length; i += 1) {
    for (let j = i + 1; j < memberIds.length; j += 1) pairs.push([memberIds[i], memberIds[j]]);
  }
  return pairs;
}

function buildLeagues(now, rng) {
  const labels = seasonLabels(now);
  const leagues = [
    { id: 'l-kausi', city: 'Lahti', skillLevel: 'keskitaso', seasonLabel: labels.current, groupSize: 6,
      status: 'active', createdBy: pid('ville'), createdAt: iso(now - 56 * DAY) },
    { id: 'l-seuraava', city: 'Lahti', skillLevel: 'edistynyt', seasonLabel: labels.next, groupSize: 6,
      status: 'signup', createdBy: pid('petra'), createdAt: iso(now - 6 * DAY) },
  ];

  const groups = [
    ['mikko', 'me', 'laura', 'ville', 'emilia', 'henna'].map(pid),
    ['antti', 'olli', 'kaisa', 'juho', 'aino'].map(pid),
  ];
  const members = [];
  groups.forEach((ids, g) => ids.forEach((userId, i) => {
    members.push({ leagueId: 'l-kausi', userId, groupNumber: g + 1, joinedAt: iso(now - (56 - i * 2 - g) * DAY) });
  }));
  ['petra', 'joonas', 'sanna', 'riikka', 'teemu'].forEach((key, i) => {
    members.push({ leagueId: 'l-seuraava', userId: pid(key), groupNumber: null, joinedAt: iso(now - (6 - i) * DAY) });
  });

  // Alex's own fixtures, from Alex's point of view (my/opp games per set).
  const alexFixtures = {
    [pid('mikko')]: { won: true, sets: [[6, 4], [6, 3]], reportedBy: ME, confirmed: true, daysAgo: 30 },
    [pid('laura')]: { won: false, sets: [[4, 6], [6, 7]], reportedBy: pid('laura'), confirmed: true, daysAgo: 23 },
    [pid('ville')]: { won: true, sets: [[6, 2], [3, 6], [6, 4]], reportedBy: ME, confirmed: true, daysAgo: 12 },
    [pid('emilia')]: { won: true, sets: [[6, 3], [6, 4]], reportedBy: pid('emilia'), confirmed: false, daysAgo: 1 },  // waits for Alex
    [pid('henna')]: { won: false, sets: [[4, 6], [6, 3], [8, 10]], reportedBy: ME, confirmed: false, daysAgo: 2 },     // waits for Henna
  };

  const fixtures = [];
  groups.forEach((ids, g) => {
    roundRobin(ids).forEach(([a, b], i) => {
      const fixture = { id: `f-${g + 1}-${String(i + 1).padStart(2, '0')}`, leagueId: 'l-kausi', groupNumber: g + 1, playerAId: a, playerBId: b, result: null };
      const opponent = a === ME ? b : b === ME ? a : null;
      if (opponent) {
        fixture.result = alexResult(alexFixtures[opponent], a === ME, opponent, now);
      } else if (rng.chance(g === 0 ? 0.55 : 0.45)) {
        fixture.result = randomResult(rng, a, b, now);
      }
      fixtures.push(fixture);
    });
  });

  return { leagues, members, fixtures };
}

function alexResult(spec, alexIsA, opponentId, now) {
  const at = iso(now - spec.daysAgo * DAY);
  return {
    sets: spec.sets.map(([my, opp]) => (alexIsA ? { a: my, b: opp } : { a: opp, b: my })),
    winnerId: spec.won ? ME : opponentId,
    reportedBy: spec.reportedBy,
    confirmedBy: spec.confirmed ? (spec.reportedBy === ME ? opponentId : ME) : null,
    confirmedAt: spec.confirmed ? at : null,
    createdAt: at,
  };
}

function randomResult(rng, a, b, now) {
  const aWins = rng.chance(0.5);
  const sets = matchSets(rng, 'sets', aWins).map((s) => ({ a: s.my, b: s.opp }));
  const at = iso(now - rng.int(3, 40) * DAY);
  return { sets, winnerId: aWins ? a : b, reportedBy: a, confirmedBy: b, confirmedAt: at, createdAt: at };
}

// ── The whole world ──────────────────────────────────────────────────────────

export function createSeed(now) {
  const rng = createRng(SEED);
  const profiles = new Map([ALEX, ...PEOPLE].map((def) => {
    const profile = buildProfile(def, now);
    return [profile.id, profile];
  }));

  const history = buildHistory(now, rng);
  const allGames = [...buildUpcomingGames(now), ...history.games, ...buildOtherPastGames(now)];
  const chat = buildConversations(now, allGames);
  const league = buildLeagues(now, rng);
  const at = (hoursAgo) => iso(now - hoursAgo * HOUR);

  return {
    profiles,
    games: new Map(allGames.map((g) => [g.id, g])),
    gameInvites: new Map([
      ['inv-ville', { id: 'inv-ville', gameId: 'g-ville-kutsu', inviterId: pid('ville'), invitedId: ME, status: 'pending', createdAt: at(4) }],
    ]),
    conversations: new Map(chat.conversations.map((c) => [c.id, c])),
    messages: chat.messages,
    archivedIds: chat.archivedIds,
    playRequests: new Map([
      ['pr-antti', { id: 'pr-antti', fromId: pid('antti'), toId: ME, status: 'pending', createdAt: at(3),
        message: 'Moi Alex! Näin, että pelaat arki-iltaisin. Lähtisitkö kaksinpeliin Kispiin ensi viikolla?' }],
      ['pr-kaisa', { id: 'pr-kaisa', fromId: pid('kaisa'), toId: ME, status: 'pending', createdAt: at(28),
        message: 'Hei! Olen Lahdessa töissä tiistaisin — olisiko sinulla aikaa pelata iltapäivällä?' }],
    ]),
    results: new Map(history.results.map((r) => [r.id, r])),
    leagues: new Map(league.leagues.map((l) => [l.id, l])),
    leagueMembers: league.members,
    fixtures: new Map(league.fixtures.map((f) => [f.id, f])),
    blocks: new Map(),
    reports: [],
    notificationPrefs: {
      emailEnabled: true, playRequests: true, messages: true, areaGames: true,
      gameJoins: true, gameInvites: true, playingNow: false,
    },
    inviteCode: 'DEMO24',
    invitesJoined: 2,
    cityAdmins: new Map([[pid('petra'), ['Lahti']]]),
    deletedUserIds: new Set(),
  };
}
