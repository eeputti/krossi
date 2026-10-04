// gamification.js — tilastot, putket ja merkit pelaajan Activity-datasta (ks. api/contract.js).
//
// Pure functions only: no I/O and no clock. Everything that depends on "today" takes `now`
// explicitly, so tests and recaps of past periods are deterministic. Functions that take `now`
// ignore anything dated after it. Dates are bucketed by the local calendar (players are in
// Europe/Helsinki) and weeks are ISO weeks starting on Monday.
//
// Vocabulary
// - occasion  one time on court. Entries from different sources on the same calendar day are
//             assumed to describe the same play (you play a game, then log its result), so a day
//             yields max(games, results, league matches) occasions. Two games on one day still
//             count as two.
// - match     a logged result or a confirmed league match; drives wins, sets and win streaks.

const DAY_MS = 86_400_000;

// ── Badges ───────────────────────────────────────────────────────────────────
//
// `metric` names the measurement in measure() below; `target` is the value that earns the badge.
// Badges sharing a metric form a ladder (5 → 10 → 25 peliä). Array order is the suggested order
// for a brand-new player and breaks ties in nextGoals(); within a group it is ascending.

/**
 * @typedef {'ball'|'racket'|'trophy'|'flame'|'star'|'sparkles'|'bolt'|'users'|'calendar'|'pin'|'crown'|'medal'|'sunrise'|'moon'|'target'|'heart'|'gift'|'flag'|'repeat'|'compass'|'shield'|'award'} BadgeIcon
 * @typedef {Object} Badge
 * @property {string} id
 * @property {string} name
 * @property {string} desc                  how to earn it
 * @property {BadgeIcon} icon
 * @property {'bronze'|'silver'|'gold'|'special'} tier
 * @property {'pelit'|'voitot'|'putket'|'yhteisö'|'erikoiset'} group
 * @property {string} metric
 * @property {number} target
 */

/** @type {readonly Badge[]} */
export const BADGES = Object.freeze([
  { id: 'first-game', name: 'Ensimmäinen syöttö', desc: 'Pelaa ensimmäinen pelisi.', icon: 'ball', tier: 'bronze', group: 'pelit', metric: 'gamesPlayed', target: 1 },
  { id: 'organizer-1', name: 'Järjestäjä', desc: 'Järjestä ensimmäinen pelisi.', icon: 'flag', tier: 'bronze', group: 'yhteisö', metric: 'organized', target: 1 },
  { id: 'invite-1', name: 'Kutsuja', desc: 'Kutsu kaveri Krossiin omalla kutsulinkilläsi.', icon: 'gift', tier: 'bronze', group: 'yhteisö', metric: 'invitesJoined', target: 1 },
  { id: 'first-win', name: 'Eka voitto', desc: 'Voita ottelu ja kirjaa tulos.', icon: 'trophy', tier: 'bronze', group: 'voitot', metric: 'wins', target: 1 },
  { id: 'games-5', name: 'Lämpö päällä', desc: 'Pelaa 5 peliä.', icon: 'racket', tier: 'bronze', group: 'pelit', metric: 'gamesPlayed', target: 5 },
  { id: 'week-streak-3', name: 'Rytmissä', desc: 'Pelaa 3 viikkoa putkeen.', icon: 'calendar', tier: 'bronze', group: 'putket', metric: 'weekStreak', target: 3 },
  { id: 'partners-5', name: 'Seurallinen', desc: 'Pelaa 5 eri pelaajan kanssa.', icon: 'heart', tier: 'bronze', group: 'yhteisö', metric: 'partners', target: 5 },
  { id: 'venues-3', name: 'Kiertolainen', desc: 'Pelaa kolmella eri kentällä.', icon: 'compass', tier: 'bronze', group: 'erikoiset', metric: 'venues', target: 3 },
  { id: 'early-bird', name: 'Aamuvirkku', desc: 'Pelaa peli, joka alkaa ennen klo 9.', icon: 'sunrise', tier: 'special', group: 'erikoiset', metric: 'earlyGames', target: 1 },
  { id: 'night-owl', name: 'Iltavirkku', desc: 'Pelaa peli, joka alkaa klo 20 tai myöhemmin.', icon: 'moon', tier: 'special', group: 'erikoiset', metric: 'lateGames', target: 1 },
  { id: 'league-1', name: 'Liigapelaaja', desc: 'Pelaa ensimmäinen liigaottelusi.', icon: 'shield', tier: 'special', group: 'pelit', metric: 'leagueMatches', target: 1 },
  { id: 'doubles-5', name: 'Nelinpelikonkari', desc: 'Pelaa 5 nelinpeliä.', icon: 'users', tier: 'silver', group: 'pelit', metric: 'doubles', target: 5 },
  { id: 'games-10', name: 'Kymppi täynnä', desc: 'Pelaa 10 peliä.', icon: 'star', tier: 'silver', group: 'pelit', metric: 'gamesPlayed', target: 10 },
  { id: 'win-streak-3', name: 'Hattutemppu', desc: 'Voita 3 ottelua putkeen.', icon: 'flame', tier: 'silver', group: 'putket', metric: 'winStreak', target: 3 },
  { id: 'organizer-5', name: 'Kenttäkapteeni', desc: 'Järjestä 5 peliä.', icon: 'target', tier: 'silver', group: 'yhteisö', metric: 'organized', target: 5 },
  { id: 'week-streak-5', name: 'Tapa päällä', desc: 'Pelaa 5 viikkoa putkeen.', icon: 'repeat', tier: 'silver', group: 'putket', metric: 'weekStreak', target: 5 },
  { id: 'partners-10', name: 'Verkostoituja', desc: 'Pelaa 10 eri pelaajan kanssa.', icon: 'users', tier: 'silver', group: 'yhteisö', metric: 'partners', target: 10 },
  { id: 'wins-10', name: 'Voittokone', desc: 'Voita 10 ottelua.', icon: 'award', tier: 'silver', group: 'voitot', metric: 'wins', target: 10 },
  { id: 'invite-5', name: 'Lähettiläs', desc: 'Kutsu 5 kaveria Krossiin.', icon: 'sparkles', tier: 'gold', group: 'yhteisö', metric: 'invitesJoined', target: 5 },
  { id: 'games-25', name: 'Kenttäkonkari', desc: 'Pelaa 25 peliä.', icon: 'medal', tier: 'silver', group: 'pelit', metric: 'gamesPlayed', target: 25 },
  { id: 'win-streak-5', name: 'Pysäyttämätön', desc: 'Voita 5 ottelua putkeen.', icon: 'bolt', tier: 'gold', group: 'putket', metric: 'winStreak', target: 5 },
  { id: 'week-streak-10', name: 'Rautainen putki', desc: 'Pelaa 10 viikkoa putkeen.', icon: 'flame', tier: 'gold', group: 'putket', metric: 'weekStreak', target: 10 },
  { id: 'organizer-15', name: 'Pelipomo', desc: 'Järjestä 15 peliä.', icon: 'crown', tier: 'gold', group: 'yhteisö', metric: 'organized', target: 15 },
  { id: 'games-50', name: 'Puolen sadan kerho', desc: 'Pelaa 50 peliä.', icon: 'trophy', tier: 'gold', group: 'pelit', metric: 'gamesPlayed', target: 50 },
  { id: 'veteran-1y', name: 'Vuoden veteraani', desc: 'Ole ollut Krossissa vuoden.', icon: 'medal', tier: 'special', group: 'erikoiset', metric: 'membership', target: 12 },
  { id: 'games-100', name: 'Satasen legenda', desc: 'Pelaa 100 peliä.', icon: 'crown', tier: 'gold', group: 'pelit', metric: 'gamesPlayed', target: 100 },
].map((badge) => Object.freeze(badge)));

const BADGE_ORDER = new Map(BADGES.map((badge, index) => [badge.id, index]));

// Metrics that grow by themselves; not something to suggest as a goal.
const PASSIVE_METRICS = new Set(['membership']);

// Start-hour windows [from, until) for Aamuvirkku and Iltavirkku. Night hours are left out of
// the morning so that a midnight timestamp (a date without a real start time) is not "early".
const EARLY_GAME_HOURS = [5, 9];
const LATE_GAME_HOURS = [20, 24];

// Membership is measured in whole months; ten years is far beyond any badge.
const MAX_MEMBERSHIP_MONTHS = 120;

// ── Date helpers ─────────────────────────────────────────────────────────────

/** ISO string / Date / timestamp -> valid Date, or null. */
export function toDate(value) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Guards the explicit-clock rule: a missing or invalid `now` is a bug, not "no data". */
export function requireNow(now) {
  const date = now instanceof Date ? toDate(now) : null;
  if (!date) throw new TypeError('`now` must be a valid Date');
  return date;
}

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// Local calendar day as an integer (days since 1970-01-01). Built from the local Y/M/D, so a
// 23 h or 25 h DST day never makes two dates look further apart than they are.
const dayNumber = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;

/**
 * ISO week (Monday start) as a running integer: adjacent weeks differ by exactly 1, also across
 * year boundaries. 1970-01-01 was a Thursday, hence the +3.
 */
export function weekIndex(date) {
  return Math.floor((dayNumber(date) + 3) / 7);
}

// Same day of month `months` later, clamped to the month's last day (31.1. + 1 kk = 28.2.).
function addMonths(date, months) {
  const result = new Date(date.getTime());
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(date.getDate(), lastDay));
  return result;
}

const byDate = (x, y) => x.date - y.date;
const countWhere = (list, predicate) => list.reduce((n, item) => (predicate(item) ? n + 1 : n), 0);
const sum = (list) => list.reduce((total, n) => total + n, 0);

// ── Activity normalisation ───────────────────────────────────────────────────

const ENTRY_DATE = {
  games: (game) => game.playedAt,
  results: (result) => result.createdAt,
  leagueMatches: (match) => match.playedAt,
};

// Tolerates a partial or missing Activity (e.g. while loading): missing lists become empty,
// duplicate ids and entries without a valid date are dropped.
function normalizeActivity(activity) {
  const source = activity ?? {};
  const list = (key) => {
    if (!Array.isArray(source[key])) return [];
    const seen = new Set();
    return source[key].filter((item) => {
      if (!item || !toDate(ENTRY_DATE[key](item))) return false;
      if (item.id == null) return true;
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  };
  const count = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
  return {
    games: list('games'),
    results: list('results'),
    leagueMatches: list('leagueMatches'),
    organizedCount: count(source.organizedCount),
    invitesJoined: count(source.invitesJoined),
    memberSince: source.memberSince ?? null,
  };
}

/**
 * The activity with only the dated entries for which `keep(date)` is true. Undated counters
 * (organizedCount, invitesJoined, memberSince) are kept as they are.
 */
export function filterActivityByDate(activity, keep) {
  const a = normalizeActivity(activity);
  const pick = (key) => a[key].filter((item) => keep(toDate(ENTRY_DATE[key](item))));
  return { ...a, games: pick('games'), results: pick('results'), leagueMatches: pick('leagueMatches') };
}

const asOf = (activity, now) => filterActivityByDate(activity, (date) => date <= now);

// ── Occasions ────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Occasion
 * @property {string} day                 'YYYY-MM-DD', local
 * @property {string} at                  ISO; the game's start time when the occasion has a game
 * @property {Object|null} game           Activity.games entry
 * @property {Object|null} result         Activity.results entry (MatchResult)
 * @property {Object|null} leagueMatch    Activity.leagueMatches entry
 */

function occasionsOf(a) {
  const days = new Map();
  const add = (kind, item, value) => {
    const date = toDate(value);
    const key = dayKey(date);
    if (!days.has(key)) days.set(key, { games: [], results: [], leagueMatches: [] });
    days.get(key)[kind].push({ item, date });
  };
  for (const game of a.games) add('games', game, game.playedAt);
  for (const result of a.results) add('results', result, result.createdAt);
  for (const match of a.leagueMatches) add('leagueMatches', match, match.playedAt);

  const occasions = [];
  for (const [day, { games, results, leagueMatches }] of days) {
    games.sort(byDate);
    results.sort(byDate);
    leagueMatches.sort(byDate);
    const count = Math.max(games.length, results.length, leagueMatches.length);
    for (let i = 0; i < count; i += 1) {
      const [game, result, leagueMatch] = [games[i], results[i], leagueMatches[i]];
      // A game carries the real start time; a result's createdAt is only when it was logged.
      const anchor = game ?? leagueMatch ?? result;
      occasions.push({
        day,
        at: anchor.date.toISOString(),
        game: game?.item ?? null,
        result: result?.item ?? null,
        leagueMatch: leagueMatch?.item ?? null,
      });
    }
  }
  return occasions.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
}

/** Play occasions, oldest first. See the vocabulary note at the top of the file. */
export function playDates(activity) {
  return occasionsOf(normalizeActivity(activity));
}

/** People you were on court with during an occasion (game participants, league opponent). */
export function occasionPeople(occasion) {
  const people = new Map();
  for (const person of [...(occasion.game?.people ?? []), occasion.leagueMatch?.opponent]) {
    if (person?.id && !people.has(person.id)) people.set(person.id, person);
  }
  return [...people.values()];
}

// 'Avoin' is what the database stores for a game created without a place.
const UNNAMED_VENUES = new Set(['', 'avoin']);

/** The named venue of an occasion as { key, name }, or null. Keys ignore case and spacing. */
export function occasionVenue(occasion) {
  const name = String(occasion.game?.locationName ?? '').trim().replace(/\s+/g, ' ');
  const key = name.toLocaleLowerCase('fi');
  return UNNAMED_VENUES.has(key) ? null : { key, name };
}

const isDoubles = (o) => o.game?.matchType === 'nelinpeli' || o.result?.format === 'doubles';
const isSingles = (o) => !isDoubles(o)
  && (o.game?.matchType === 'kaksinpeli' || o.result?.format === 'singles' || Boolean(o.leagueMatch));

// Only games have a real start time (a result's timestamp is when it was logged).
const gameStartsWithin = ([from, until]) => (occasion) => {
  if (!occasion.game) return false;
  const hour = new Date(occasion.at).getHours();
  return hour >= from && hour < until;
};

// ── Matches ──────────────────────────────────────────────────────────────────

const setScores = (sets, mine, theirs) => (Array.isArray(sets) ? sets : [])
  .map((set) => [Number(set?.[mine]) || 0, Number(set?.[theirs]) || 0]);

// Decided by sets, like tennis: 6–4 3–6 7–6 is a win even with equal game totals; level sets
// (an unfinished 1–1) read as a draw. Same rule as the history card
// (screens/profile/matchResult.js), so a badge never celebrates a match shown as a draw.
function resultOutcome(result) {
  const scores = setScores(result.sets, 'my', 'opp');
  const won = countWhere(scores, ([my, opp]) => my > opp);
  const lost = countWhere(scores, ([my, opp]) => opp > my);
  if (won > lost) return 'win';
  if (lost > won) return 'loss';
  return 'draw';
}

function resultSets(result) {
  // A lone tie-break is not a set.
  if (result.gameType === 'tiebreak') return { setsWon: 0, setsLost: 0 };
  const scores = setScores(result.sets, 'my', 'opp');
  return { setsWon: countWhere(scores, ([my, opp]) => my > opp), setsLost: countWhere(scores, ([my, opp]) => opp > my) };
}

// League sets are stored per fixture side (a/b), not per viewer. The winner always took more
// sets, so `won` tells which side was mine without relying on the mapper's orientation.
function leagueSets(match) {
  const scores = setScores(match.sets, 'a', 'b');
  const aSets = countWhere(scores, ([a, b]) => a > b);
  const bSets = countWhere(scores, ([a, b]) => b > a);
  const [more, fewer] = [Math.max(aSets, bSets), Math.min(aSets, bSets)];
  return match.won ? { setsWon: more, setsLost: fewer } : { setsWon: fewer, setsLost: more };
}

function matchesInOrder(a) {
  const matches = [
    ...a.results.map((result) => ({ date: toDate(result.createdAt), outcome: resultOutcome(result), ...resultSets(result) })),
    ...a.leagueMatches.map((match) => ({ date: toDate(match.playedAt), outcome: match.won ? 'win' : 'loss', ...leagueSets(match) })),
  ];
  return matches.sort(byDate);
}

// ── Streaks ──────────────────────────────────────────────────────────────────
//
// `reachedAt[k - 1]` is when a run of length k was reached for the first time, so its length
// is the best run and it doubles as the earn date of streak badges.

function weekRuns(occasions, now) {
  const firstAtByWeek = new Map();
  for (const occasion of occasions) {
    const week = weekIndex(new Date(occasion.at));
    if (!firstAtByWeek.has(week)) firstAtByWeek.set(week, occasion.at);
  }
  const reachedAt = [];
  let run = 0;
  let previous = null;
  for (const week of [...firstAtByWeek.keys()].sort((x, y) => x - y)) {
    run = previous !== null && week === previous + 1 ? run + 1 : 1;
    previous = week;
    if (run > reachedAt.length) reachedAt.push(firstAtByWeek.get(week));
  }

  // The streak survives a week without play until that week is over: it may end at this week
  // or, if this week has no play yet, at last week.
  const thisWeek = weekIndex(now);
  const activeThisWeek = firstAtByWeek.has(thisWeek);
  const lastPlayedWeek = activeThisWeek ? thisWeek : thisWeek - 1;
  let current = 0;
  while (firstAtByWeek.has(lastPlayedWeek - current)) current += 1;

  return { current, best: reachedAt.length, activeThisWeek, reachedAt };
}

// Draws neither extend nor break a win streak.
function winRuns(matches) {
  const reachedAt = [];
  let run = 0;
  for (const match of matches) {
    if (match.outcome === 'draw') continue;
    if (match.outcome === 'loss') { run = 0; continue; }
    run += 1;
    if (run > reachedAt.length) reachedAt.push(match.date.toISOString());
  }
  return { current: run, best: reachedAt.length, reachedAt };
}

/**
 * Consecutive ISO weeks with at least one occasion.
 * @returns {{ current:number, best:number, activeThisWeek:boolean, weeksAtRisk:boolean }}
 *   weeksAtRisk: there is a streak but no play this week yet — play before Sunday ends to keep it.
 */
export function weekStreak(activity, now) {
  const at = requireNow(now);
  const { current, best, activeThisWeek } = weekRuns(occasionsOf(asOf(activity, at)), at);
  return { current, best, activeThisWeek, weeksAtRisk: current > 0 && !activeThisWeek };
}

/** Consecutive won matches (results and league matches in date order). */
export function winStreak(activity) {
  const { current, best } = winRuns(matchesInOrder(normalizeActivity(activity)));
  return { current, best };
}

// ── Totals ───────────────────────────────────────────────────────────────────

/**
 * @returns {{ gamesPlayed:number, gamesOrganized:number, wins:number, losses:number,
 *   winRate:number|null, setsWon:number, setsLost:number, doubles:number, singles:number,
 *   venues:number, partners:number, leagueMatches:number }}
 */
export function computeTotals(activity) {
  const a = normalizeActivity(activity);
  const occasions = occasionsOf(a);
  const matches = matchesInOrder(a);
  const wins = countWhere(matches, (m) => m.outcome === 'win');
  const losses = countWhere(matches, (m) => m.outcome === 'loss');
  return {
    gamesPlayed: occasions.length,
    // organizedCount includes games that have not been played yet; a played game you organized
    // is always among them, so the larger number is the right one.
    gamesOrganized: Math.max(a.organizedCount, countWhere(a.games, (g) => g.isOrganizer)),
    wins,
    losses,
    winRate: wins + losses > 0 ? wins / (wins + losses) : null,
    setsWon: sum(matches.map((m) => m.setsWon)),
    setsLost: sum(matches.map((m) => m.setsLost)),
    doubles: countWhere(occasions, isDoubles),
    singles: countWhere(occasions, isSingles),
    venues: new Set(occasions.map((o) => occasionVenue(o)?.key).filter(Boolean)).size,
    partners: new Set(occasions.flatMap((o) => occasionPeople(o).map((p) => p.id))).size,
    leagueMatches: a.leagueMatches.length,
  };
}

// ── Badge evaluation ─────────────────────────────────────────────────────────
//
// Every metric is measured as { value, best?, dates }: `value` is the current number,
// `best` the best ever (streaks only) and `dates[k - 1]` when the metric first reached k
// (empty when the source has no dates, e.g. invites).

const counter = (dates) => ({ value: dates.length, dates });

function firstSeenDates(occasions, keysOf) {
  const seen = new Set();
  const dates = [];
  for (const occasion of occasions) {
    for (const key of keysOf(occasion)) {
      if (key == null || seen.has(key)) continue;
      seen.add(key);
      dates.push(occasion.at);
    }
  }
  return dates;
}

function membershipMonths(memberSince, now) {
  const start = toDate(memberSince);
  const dates = [];
  for (let months = 1; start && months <= MAX_MEMBERSHIP_MONTHS; months += 1) {
    const anniversary = addMonths(start, months);
    if (anniversary > now) break;
    dates.push(anniversary.toISOString());
  }
  return counter(dates);
}

function measure(activity, now) {
  const a = asOf(activity, now);
  const occasions = occasionsOf(a);
  const matches = matchesInOrder(a);
  const atOf = (list) => list.map((o) => o.at);
  const weeks = weekRuns(occasions, now);
  const wins = winRuns(matches);
  const organizerDates = atOf(occasions.filter((o) => o.game?.isOrganizer));
  return {
    gamesPlayed: counter(atOf(occasions)),
    organized: { value: Math.max(a.organizedCount, organizerDates.length), dates: organizerDates },
    wins: counter(matches.filter((m) => m.outcome === 'win').map((m) => m.date.toISOString())),
    winStreak: { value: wins.current, best: wins.best, dates: wins.reachedAt },
    weekStreak: { value: weeks.current, best: weeks.best, dates: weeks.reachedAt },
    doubles: counter(atOf(occasions.filter(isDoubles))),
    leagueMatches: counter(atOf(occasions.filter((o) => o.leagueMatch))),
    venues: counter(firstSeenDates(occasions, (o) => [occasionVenue(o)?.key])),
    partners: counter(firstSeenDates(occasions, (o) => occasionPeople(o).map((p) => p.id))),
    earlyGames: counter(atOf(occasions.filter(gameStartsWithin(EARLY_GAME_HOURS)))),
    lateGames: counter(atOf(occasions.filter(gameStartsWithin(LATE_GAME_HOURS)))),
    invitesJoined: { value: a.invitesJoined, dates: [] },
    membership: membershipMonths(a.memberSince, now),
  };
}

function evaluateBadge(badge, measured) {
  const reached = measured.best ?? measured.value;
  const earned = reached >= badge.target;
  // An earned streak badge shows the best run; an unearned one the run you are building now.
  const current = earned ? reached : measured.value;
  return {
    ...badge,
    earned,
    earnedAt: earned ? (measured.dates[badge.target - 1] ?? null) : null,
    progress: earned ? 1 : Math.min(1, current / badge.target),
    current,
    target: badge.target,
  };
}

// Earned first, newest first (undated earned badges after dated ones); then unearned by
// progress, fewest steps left, and finally BADGES order.
function compareEvaluated(x, y) {
  if (x.earned !== y.earned) return x.earned ? -1 : 1;
  if (x.earned && x.earnedAt !== y.earnedAt) {
    if (!x.earnedAt) return 1;
    if (!y.earnedAt) return -1;
    return x.earnedAt < y.earnedAt ? 1 : -1;
  }
  if (!x.earned) {
    if (x.progress !== y.progress) return y.progress - x.progress;
    const stepsLeft = (x.target - x.current) - (y.target - y.current);
    if (stepsLeft !== 0) return stepsLeft;
  }
  return BADGE_ORDER.get(x.id) - BADGE_ORDER.get(y.id);
}

/**
 * Every badge with its state as of `now`.
 * @returns {(Badge & { earned:boolean, earnedAt:string|null, progress:number, current:number, target:number })[]}
 *   earnedAt is when the earning occasion happened, or null when the data has no date for it
 *   (invites; organizer badges reached through games that have not been played yet).
 */
export function evaluateBadges(activity, now) {
  const measured = measure(activity, requireNow(now));
  return BADGES.map((badge) => evaluateBadge(badge, measured[badge.metric])).sort(compareEvaluated);
}

/**
 * The `n` unearned badges closest to completion. Only the next step of each ladder is offered
 * ("5 peliä", not also "10 peliä"), and passive badges (membership) are left out.
 */
export function nextGoals(activity, now, n = 3) {
  const nextStep = new Map();
  for (const badge of evaluateBadges(activity, now)) {
    if (badge.earned || PASSIVE_METRICS.has(badge.metric)) continue;
    const known = nextStep.get(badge.metric);
    if (!known || badge.target < known.target) nextStep.set(badge.metric, badge);
  }
  return [...nextStep.values()].sort(compareEvaluated).slice(0, Math.max(0, n));
}

// ── Profile completeness ─────────────────────────────────────────────────────

const filled = (value) => (Array.isArray(value) ? value.length > 0 : Boolean(String(value ?? '').trim()));

const PROFILE_ITEMS = [
  { key: 'photo', label: 'Profiilikuva', done: (p) => filled(p.avatarUrl) },
  { key: 'bio', label: 'Esittely', done: (p) => filled(p.bio) },
  { key: 'availability', label: 'Peliajat', done: (p) => filled(p.availability) },
  { key: 'playStyles', label: 'Pelimuodot', done: (p) => filled(p.playStyles) },
  { key: 'competitionClasses', label: 'Kilpailuluokka', done: (p) => filled(p.competitionClasses), appliesTo: (p) => p.skillLevel === 'kilpapelaaja' },
  { key: 'handedness', label: 'Pelikäsi', done: (p) => filled(p.handedness) },
  { key: 'backhand', label: 'Rysty', done: (p) => filled(p.backhand) },
];

/**
 * How much of the optional profile is filled in (onboarding covers the required fields).
 * @returns {{ score:number, missing:{ key:string, label:string }[] }}   score 0..1
 */
export function profileCompleteness(profile) {
  const p = profile ?? {};
  const items = PROFILE_ITEMS.filter((item) => !item.appliesTo || item.appliesTo(p));
  const missing = items.filter((item) => !item.done(p)).map(({ key, label }) => ({ key, label }));
  return { score: (items.length - missing.length) / items.length, missing };
}
