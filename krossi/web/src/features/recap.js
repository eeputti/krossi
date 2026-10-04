// recap.js — kuukauden ja kauden koosteet Activity-datasta (ks. api/contract.js).
//
// A period is a calendar month ('2026-09') or a season = calendar year ('kausi-2026'), both
// in local time. Pure functions; `now` is always passed in and anything dated after it is
// ignored, so the recap of the current month is "so far".

import {
  computeTotals, evaluateBadges, filterActivityByDate, occasionPeople, occasionVenue, playDates,
  requireNow, toDate, weekStreak,
} from './gamification.js';

const MONTHS = ['tammikuu', 'helmikuu', 'maaliskuu', 'huhtikuu', 'toukokuu', 'kesäkuu',
  'heinäkuu', 'elokuu', 'syyskuu', 'lokakuu', 'marraskuu', 'joulukuu'];
const WEEKDAYS_FROM_MONDAY = ['maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'lauantai', 'sunnuntai'];
const TIMES_OF_DAY = ['aamu', 'päivä', 'ilta'];

// Thresholds for the headline rules; a season needs roughly a few months' worth.
const HEADLINE_LIMITS = {
  month: { wins: 3, games: 8, weekStreak: 4, gamesDelta: 3, newPartners: 3, organized: 3, newBadges: 2, venueVisits: 4 },
  season: { wins: 10, games: 40, weekStreak: 10, gamesDelta: 10, newPartners: 8, organized: 10, newBadges: 3, venueVisits: 15 },
};

const pad = (n) => String(n).padStart(2, '0');
const capitalize = (text) => text.charAt(0).toLocaleUpperCase('fi') + text.slice(1);

// ── Periods ──────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Period
 * @property {'month'|'season'} type
 * @property {string} key          '2026-09' | 'kausi-2026' (the URL segment)
 * @property {number} year
 * @property {number} [month]      1–12
 * @property {string} label        'syyskuu 2026' | 'Kausi 2026'
 * @property {Date} start          local midnight of the first day
 * @property {Date} end            exclusive: start of the next period
 */

/** 'YYYY-MM' of a Date / ISO string in local time, or null. */
export function monthKey(date) {
  const d = toDate(date);
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}` : null;
}

export function seasonKey(year) {
  return `kausi-${year}`;
}

const validYear = (year) => Number.isInteger(year) && year >= 2000 && year <= 2100;

function monthPeriod(year, month) {
  if (!validYear(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return {
    type: 'month', key: `${year}-${pad(month)}`, year, month,
    label: `${MONTHS[month - 1]} ${year}`,
    start: new Date(year, month - 1, 1),
    end: new Date(year, month, 1),
  };
}

function seasonPeriod(year) {
  if (!validYear(year)) return null;
  return {
    type: 'season', key: seasonKey(year), year,
    label: `Kausi ${year}`,
    start: new Date(year, 0, 1),
    end: new Date(year + 1, 0, 1),
  };
}

/** '2026-09' or 'kausi-2026' -> Period, or null when the string is not a valid period. */
export function parsePeriod(str) {
  if (typeof str !== 'string') return null;
  const text = str.trim().toLowerCase();
  const month = /^(\d{4})-(\d{2})$/.exec(text);
  if (month) return monthPeriod(Number(month[1]), Number(month[2]));
  const season = /^kausi-(\d{4})$/.exec(text);
  if (season) return seasonPeriod(Number(season[1]));
  return null;
}

function shiftPeriod(period, step) {
  if (period.type === 'season') return seasonPeriod(period.year + step);
  const index = period.year * 12 + (period.month - 1) + step;
  return monthPeriod(Math.floor(index / 12), (index % 12) + 1);
}

// Finnish case forms used in headlines: "syyskuun", "syyskuussa", "kaudella 2026".
function phrases(period) {
  if (period.type === 'month') {
    const name = MONTHS[period.month - 1];
    return { genitive: `${name}n`, inessive: `${name}ssa` };
  }
  return { genitive: `kauden ${period.year}`, inessive: `kaudella ${period.year}` };
}

// ── Recap ────────────────────────────────────────────────────────────────────

const within = (period, now) => (date) => date >= period.start && date < period.end && date <= now;

// The part of the activity inside the period. Undated counters cannot be placed in a period,
// so `organized` in a recap counts the played games you organized.
function periodActivity(activity, period, now) {
  return { ...filterActivityByDate(activity, within(period, now)), organizedCount: 0, invitesJoined: 0 };
}

// Highest count wins; a tie goes to the most recent one, which the player remembers best.
function mostFrequent(occasions, keysOf) {
  const tally = new Map();
  for (const occasion of occasions) {
    for (const { key, value } of keysOf(occasion)) {
      const entry = tally.get(key) ?? { value, count: 0, lastAt: '' };
      entry.count += 1;
      entry.value = value; // latest version (e.g. a changed avatar or spelling)
      entry.lastAt = occasion.at;
      tally.set(key, entry);
    }
  }
  let best = null;
  for (const entry of tally.values()) {
    if (!best || entry.count > best.count || (entry.count === best.count && entry.lastAt > best.lastAt)) best = entry;
  }
  return best;
}

function topPartner(occasions) {
  const top = mostFrequent(occasions, (o) => occasionPeople(o).map((person) => ({ key: person.id, value: person })));
  return top ? { person: top.value, count: top.count } : null;
}

function topVenue(occasions) {
  const top = mostFrequent(occasions, (o) => {
    const venue = occasionVenue(o);
    return venue ? [{ key: venue.key, value: venue.name }] : [];
  });
  return top ? { name: top.value, count: top.count } : null;
}

// Ties go to the earlier weekday.
function busiestWeekday(occasions) {
  if (occasions.length === 0) return null;
  const counts = Array(7).fill(0);
  for (const occasion of occasions) counts[(new Date(occasion.at).getDay() + 6) % 7] += 1;
  return WEEKDAYS_FROM_MONDAY[counts.indexOf(Math.max(...counts))];
}

// Night hours (before 5) belong to the evening that started them.
const timeOfDay = (hour) => (hour < 5 ? 'ilta' : hour < 12 ? 'aamu' : hour < 17 ? 'päivä' : 'ilta');

// Only games have a real start time; results are timestamped when they were logged.
function favoriteTime(occasions) {
  const counts = { aamu: 0, päivä: 0, ilta: 0 };
  const timed = occasions.filter((o) => o.game);
  if (timed.length === 0) return null;
  for (const occasion of timed) counts[timeOfDay(new Date(occasion.at).getHours())] += 1;
  return TIMES_OF_DAY.reduce((best, time) => (counts[time] > counts[best] ? time : best));
}

// People whose first occasion with you ever falls in the period, in the order you met them.
function peopleFirstMet(history, isInPeriod) {
  const seen = new Set();
  const people = [];
  for (const occasion of history) {
    for (const person of occasionPeople(occasion)) {
      if (seen.has(person.id)) continue;
      seen.add(person.id);
      if (isInPeriod(new Date(occasion.at))) people.push(person);
    }
  }
  return people;
}

function compareToPrevious(activity, period, now, history, gamesPlayed) {
  const previous = shiftPeriod(period, -1);
  // Before the player's first game there is nothing to compare against.
  if (!previous || !history.some((o) => new Date(o.at) < period.start)) return null;
  const previousGamesPlayed = computeTotals(periodActivity(activity, previous, now)).gamesPlayed;
  return { gamesDelta: gamesPlayed - previousGamesPlayed, previousGamesPlayed, previousLabel: previous.label };
}

function headlineFor(recap, now) {
  const { period } = recap;
  const { genitive, inessive } = phrases(period);
  const Genitive = capitalize(genitive);

  if (recap.isEmpty) {
    if (now < period.end) return `${Genitive} eka peli odottaa vielä — pelataanko?`;
    if (period.type === 'season') return 'Rauhallinen kausi — ensi kaudella uusi yritys!';
    return `Rauhallinen kuukausi — ${MONTHS[period.month % 12]}ssa uusi yritys!`;
  }

  const limit = HEADLINE_LIMITS[period.type];
  const delta = recap.comparedToPrevious?.gamesDelta ?? 0;
  const rules = [
    [recap.wins >= limit.wins && recap.winRate >= 0.75, () => `${Genitive} voittokone`],
    [recap.gamesPlayed >= limit.games, () => `${Genitive} kenttäkuningas`],
    [recap.longestWeekStreakInPeriod >= limit.weekStreak, () => `${recap.longestWeekStreakInPeriod} viikkoa putkeen — rautaa!`],
    [delta >= limit.gamesDelta, () => `Nousukiidossa — ${delta} peliä enemmän kuin ${phrases(shiftPeriod(period, -1)).inessive}`],
    [recap.newPartners.length >= limit.newPartners, () => `${recap.newPartners.length} uutta pelikaveria ${inessive}!`],
    [recap.organized >= limit.organized, () => `${Genitive} pelipomo`],
    [recap.newBadges.length >= limit.newBadges, () => `${recap.newBadges.length} uutta merkkiä ${inessive}!`],
    [(recap.topVenue?.count ?? 0) >= limit.venueVisits, () => `${recap.topVenue.name} on kakkoskotisi`],
    [recap.wins > recap.losses, () => `${capitalize(inessive)} plussalla: ${recap.wins}–${recap.losses}`],
    [recap.gamesPlayed === 1, () => 'Yksi peli takana — siitä se lähtee!'],
  ];
  const match = rules.find(([applies]) => applies);
  return match ? match[1]() : `${recap.gamesPlayed} peliä ${inessive} — hyvä meno!`;
}

/**
 * The recap of one period, as of `now`.
 * @param {Object} activity          Activity (api/contract.js)
 * @param {Period|string} period     a Period or its key ('2026-09', 'kausi-2026')
 * @param {Date} now
 * @returns {Object|null}            null when `period` is not a valid period
 */
export function buildRecap(activity, period, now) {
  const at = requireNow(now);
  const p = typeof period === 'string' ? parsePeriod(period) : period;
  if (!p) return null;

  const isInPeriod = within(p, at);
  const slice = periodActivity(activity, p, at);
  const totals = computeTotals(slice);
  const occasions = playDates(slice);
  const history = playDates(filterActivityByDate(activity, (date) => date <= at));
  const newBadges = evaluateBadges(activity, at)
    .filter((badge) => badge.earnedAt && isInPeriod(new Date(badge.earnedAt)))
    .sort((x, y) => (x.earnedAt < y.earnedAt ? -1 : x.earnedAt > y.earnedAt ? 1 : 0));

  const recap = {
    period: p,
    key: p.key,
    label: p.label,
    inProgress: p.start <= at && at < p.end,
    gamesPlayed: totals.gamesPlayed,
    wins: totals.wins,
    losses: totals.losses,
    winRate: totals.winRate,
    setsWon: totals.setsWon,
    setsLost: totals.setsLost,
    organized: totals.gamesOrganized,
    topPartner: topPartner(occasions),
    topVenue: topVenue(occasions),
    busiestWeekday: busiestWeekday(occasions),
    favoriteTime: favoriteTime(occasions),
    longestWeekStreakInPeriod: weekStreak(slice, at).best,
    newBadges,
    newPartners: peopleFirstMet(history, isInPeriod),
    comparedToPrevious: compareToPrevious(activity, p, at, history, totals.gamesPlayed),
    isEmpty: totals.gamesPlayed === 0,
  };
  recap.headline = headlineFor(recap, at);
  return recap;
}

/**
 * Recaps worth showing: months with at least one occasion (newest first; the current month
 * only once it has a game), then seasons with games (newest first).
 * @returns {{ key:string, label:string, type:'month'|'season', gamesPlayed:number }[]}
 */
export function availableRecaps(activity, now) {
  const at = requireNow(now);
  const months = new Map();
  const seasons = new Map();
  for (const occasion of playDates(filterActivityByDate(activity, (date) => date <= at))) {
    const date = new Date(occasion.at);
    const month = monthKey(date);
    const season = seasonKey(date.getFullYear());
    months.set(month, (months.get(month) ?? 0) + 1);
    seasons.set(season, (seasons.get(season) ?? 0) + 1);
  }
  // Both key formats sort chronologically as strings.
  const newestFirst = (counts) => [...counts]
    .sort(([x], [y]) => (x < y ? 1 : -1))
    .map(([key, gamesPlayed]) => ({ period: parsePeriod(key), gamesPlayed }))
    .filter(({ period }) => period)
    .map(({ period, gamesPlayed }) => ({ key: period.key, label: period.label, type: period.type, gamesPlayed }));
  return [...newestFirst(months), ...newestFirst(seasons)];
}
