// leagueUtils.js — pure helpers for the league screens: labels, season suggestions,
// standings, fixture ordering/perspective, and the hallisarja's rounds (phases, dates and the
// promotion/relegation proposal for the next round). Sets are `{a, b}` where `a` = player A's
// games; a timed match (tunnin aikapeli) is one `{a, b}` row of games and may end in a draw
// (`winnerId` null).
//
// Two formats:
//   'ladder'     Krossi-liiga: groups drawn once, best of sets, wins → set diff → game diff.
//   'hallisarja' rounds with organiser-made groups (A = top), 2/1/0 points, tiebreaks as in
//                the Lahti indoor series rules: points → game diff → head-to-head → games won.

import { SKILL_LEVELS, SKILL_ORDER, labelOf } from '../../lib/constants.js';

export const MIN_MEMBERS_TO_START = 4;
export const MIN_ROUND_PLAYERS = 2;
export const POINTS_PER_WIN = 2;
export const POINTS_PER_DRAW = 1;
export const MAX_SETS = 5;
export const ROUND_WEEKS = 8;
export const ROUND_BREAK_WEEKS = 2;

export const STATUS = {
  signup: { label: 'Ilmoittautuminen', tone: 'lime', icon: null, dot: 'live' },
  active: { label: 'Käynnissä', tone: 'green', icon: 'play', dot: null },
  finished: { label: 'Päättynyt', tone: 'neutral', icon: 'flag', dot: null },
};

export const FORMATS = [
  { value: 'ladder', label: 'Krossi-liiga', icon: 'trophy' },
  { value: 'hallisarja', label: 'Hallisarja', icon: 'grid' },
];

export const MATCH_FORMATS = [
  { value: 'timed', label: 'Tunnin aikapeli', hint: 'Eniten geimejä tunnissa voittaa, tasapeli mahdollinen' },
  { value: 'sets', label: 'Erät', hint: 'Paras kolmesta erästä' },
];

/** Level options for a league; a hallisarja may be open to every level. */
export const ALL_LEVELS = 'kaikki';
export const LEAGUE_LEVELS = [...SKILL_LEVELS, { value: ALL_LEVELS, label: 'Kaikki tasot', short: 'Kaikki', desc: 'Kaikki tasot samaan sarjaan — lohkot jaetaan tason mukaan.' }];

const CITY_IN = {
  Lahti: 'Lahdessa', Turku: 'Turussa', Helsinki: 'Helsingissä', Tampere: 'Tampereella', Oulu: 'Oulussa',
  Jyväskylä: 'Jyväskylässä', Pori: 'Porissa', Kuopio: 'Kuopiossa', Rovaniemi: 'Rovaniemellä', Mikkeli: 'Mikkelissä',
};
/** Finnish locative: 'Lahti' -> 'Lahdessa' (falls back to "Kaupungissa X"). */
export const cityIn = (city) => CITY_IN[city] || `Kaupungissa ${city}`;

export const statusOf = (status) => STATUS[status] || STATUS.signup;
export const levelLabel = (level) => labelOf(LEAGUE_LEVELS, level) || 'Kaikki tasot';
export const isHallisarja = (league) => league?.format === 'hallisarja';
export const isTimed = (league) => league?.matchFormat === 'timed';
export const formatLabel = (league) => (isHallisarja(league) ? 'Hallisarja' : 'Krossi-liiga');

/** 'Mikko Virtanen' -> 'Mikko V.' (a series has many first names in common). */
export function shortName(name) {
  const [first, last] = String(name || '').trim().split(/\s+/);
  if (!first) return 'Pelaaja';
  return last && !/\.$/.test(first) ? `${first} ${last[0]}.` : first;
}

/** 1 -> 'A' (hallisarja lohkot are letters, top group first). */
export const groupLetter = (n) => (n >= 1 && n <= 26 ? String.fromCharCode(64 + n) : String(n));
export const groupName = (league, n) => `Lohko ${isHallisarja(league) ? groupLetter(n) : n}`;

/** Season name suggestions for "Luo liiga", based on today's date. */
export function seasonSuggestions(now = new Date(), format = 'ladder') {
  const y = now.getFullYear();
  const m = now.getMonth();
  if (format === 'hallisarja') {
    const from = m >= 6 ? y : y - 1;
    const season = `${from}–${String(from + 1).slice(2)}`;
    return [`Hallisarja ${season}`, `Hallisarja ${season} · Yleinen`, `Hallisarja ${season} · Naiset`];
  }
  const winter = (from) => `Talviliiga ${from}–${String(from + 1).slice(2)}`;
  if (m <= 3) return [`Kevätkausi ${y}`, `Kesäliiga ${y}`, `Kevät ${y}`];
  if (m <= 6) return [`Kesäliiga ${y}`, `Syyskausi ${y}`, `Kesä ${y}`];
  if (m <= 10) return [`Syyskausi ${y}`, winter(y), `Syksy ${y}`];
  return [winter(y), `Kevätkausi ${y + 1}`, `Talvi ${y}–${String(y + 1).slice(2)}`];
}

// ── Dates ────────────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0');
/** Local date -> 'YYYY-MM-DD'. */
export const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** 'YYYY-MM-DD' -> local Date at midnight. */
export const parseDay = (s) => {
  const [y, m, d] = String(s || '').split('-').map(Number);
  return y ? new Date(y, (m || 1) - 1, d || 1) : null;
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** The coming Monday (today if it is Monday). */
export function nextMonday(now = new Date()) {
  const day = (now.getDay() + 6) % 7; // 0 = Monday
  return addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), day === 0 ? 0 : 7 - day);
}

/** A round lasting `weeks` weeks from `start` (Monday → Sunday). */
export function roundFrom(start, weeks = ROUND_WEEKS) {
  return { startsOn: isoDay(start), endsOn: isoDay(addDays(start, weeks * 7 - 1)) };
}

/** `count` rounds of ROUND_WEEKS weeks with ROUND_BREAK_WEEKS between them, starting next Monday. */
export function suggestRounds(now = new Date(), count = 3) {
  const rounds = [];
  let start = nextMonday(now);
  for (let i = 0; i < count; i += 1) {
    rounds.push(roundFrom(start));
    start = addDays(start, (ROUND_WEEKS + ROUND_BREAK_WEEKS) * 7);
  }
  return rounds;
}

/** The round after `prev` (same length, two-week break), or one from next Monday. */
export function roundAfter(prev, now = new Date()) {
  const end = parseDay(prev?.endsOn);
  if (!end) return roundFrom(nextMonday(now));
  const start = addDays(end, ROUND_BREAK_WEEKS * 7 + 1); // Sunday + two weeks off → a Monday
  return roundFrom(start < nextMonday(now) ? nextMonday(now) : start);
}

/** Whole days from today until `day` (0 = today, negative = past). */
export function daysUntil(day, now = new Date()) {
  const target = parseDay(day);
  if (!target) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}

/** '14.9.–8.11.2026' */
export function roundRange(round) {
  const a = parseDay(round?.startsOn);
  const b = parseDay(round?.endsOn);
  if (!a || !b) return '';
  const left = a.getFullYear() === b.getFullYear() ? `${a.getDate()}.${a.getMonth() + 1}.` : `${a.getDate()}.${a.getMonth() + 1}.${a.getFullYear()}`;
  return `${left}–${b.getDate()}.${b.getMonth() + 1}.${b.getFullYear()}`;
}

// ── Rounds and phases ────────────────────────────────────────────────────────

export const roundOf = (league, n) => (league?.rounds || []).find((r) => r.roundNumber === n) || null;

/**
 * Where a league is:
 *   'signup'   sign-up, no groups yet
 *   'round'    a round (or the ladder season) is being played
 *   'between'  hallisarja: the current round is over, the next one not started yet
 *   'finished' season over
 */
export function leaguePhase(league) {
  if (!league) return 'signup';
  if (league.status === 'finished') return 'finished';
  if (league.status === 'signup') return 'signup';
  if (!isHallisarja(league)) return 'round';
  return roundOf(league, league.currentRound)?.status === 'active' ? 'round' : 'between';
}

/** Round numbers that have fixtures (newest first). */
export function playedRounds(league) {
  const set = new Set((league?.fixtures || []).map((f) => f.roundNumber || 1));
  return [...set].sort((a, b) => b - a);
}

export const fixturesOfRound = (league, round) => (league?.fixtures || []).filter((f) => (f.roundNumber || 1) === round);

/** Group numbers present in a round (all rounds for a ladder league), my group first. */
export function groupOrder(league, meId, round = null) {
  const set = new Set();
  const fixtures = round == null ? league.fixtures : fixturesOfRound(league, round);
  fixtures.forEach((f) => { if (f.groupNumber != null) set.add(f.groupNumber); });
  if (round == null || round === league.currentRound) {
    league.members.forEach((m) => { if (m.groupNumber != null) set.add(m.groupNumber); });
  }
  const groups = [...set].sort((a, b) => a - b);
  const mine = myGroupOf(league, meId, round);
  return mine != null && groups.includes(mine) ? [mine, ...groups.filter((g) => g !== mine)] : groups;
}

/** My group in `round` (default: the current one). */
export function myGroupOf(league, meId, round = null) {
  if (round != null && round !== league.currentRound) {
    const f = fixturesOfRound(league, round).find((x) => isMyFixture(x, meId));
    return f ? f.groupNumber : null;
  }
  return league.members.find((m) => m.id === meId)?.groupNumber ?? null;
}

/** Players of one group in one round: from its fixtures (+ current members of that group). */
export function groupPlayers(league, round, group) {
  const byId = new Map();
  const fixtures = (round == null ? league.fixtures : fixturesOfRound(league, round)).filter((f) => f.groupNumber === group);
  fixtures.forEach((f) => { byId.set(f.playerA.id, f.playerA); byId.set(f.playerB.id, f.playerB); });
  if (round == null || round === league.currentRound) {
    league.members.filter((m) => m.groupNumber === group).forEach((m) => { if (!byId.has(m.id)) byId.set(m.id, m); });
  }
  return { players: [...byId.values()], fixtures };
}

// ── Results and standings ────────────────────────────────────────────────────

export const isConfirmed = (fixture) => Boolean(fixture.result?.confirmedBy);
export const isMyFixture = (fixture, meId) => fixture.playerA.id === meId || fixture.playerB.id === meId;
export const isDraw = (fixture) => Boolean(fixture.result) && !fixture.result.winnerId;

/** Standings rows for one group, computed from confirmed fixtures only. */
export function computeStandings(members, fixtures, { scoring = 'ladder' } = {}) {
  const hall = scoring === 'hallisarja';
  const rows = new Map();
  members.forEach((m) => rows.set(m.id, {
    player: m, played: 0, wins: 0, draws: 0, losses: 0, setsWon: 0, setsLost: 0, gamesWon: 0, gamesLost: 0, points: 0,
  }));
  const confirmed = fixtures.filter((f) => isConfirmed(f) && rows.has(f.playerA.id) && rows.has(f.playerB.id));
  confirmed.forEach((f) => {
    const a = rows.get(f.playerA.id);
    const b = rows.get(f.playerB.id);
    let aSets = 0; let bSets = 0; let aGames = 0; let bGames = 0;
    (f.result.sets || []).forEach((s) => {
      aGames += s.a; bGames += s.b;
      if (s.a > s.b) aSets += 1; else if (s.b > s.a) bSets += 1;
    });
    a.played += 1; b.played += 1;
    a.setsWon += aSets; a.setsLost += bSets; b.setsWon += bSets; b.setsLost += aSets;
    a.gamesWon += aGames; a.gamesLost += bGames; b.gamesWon += bGames; b.gamesLost += aGames;
    if (!f.result.winnerId) { a.draws += 1; b.draws += 1; } else if (f.result.winnerId === f.playerA.id) { a.wins += 1; b.losses += 1; } else { b.wins += 1; a.losses += 1; }
  });
  const list = [...rows.values()];
  list.forEach((r) => { r.points = r.wins * POINTS_PER_WIN + (hall ? r.draws * POINTS_PER_DRAW : 0); });
  const byName = (l, r) => String(l.player.name).localeCompare(String(r.player.name), 'fi');
  const gameDiff = (r) => r.gamesWon - r.gamesLost;

  if (!hall) {
    return list.sort((l, r) => (
      r.wins - l.wins
      || (r.setsWon - r.setsLost) - (l.setsWon - l.setsLost)
      || gameDiff(r) - gameDiff(l)
      || r.played - l.played
      || byName(l, r)
    ));
  }

  // Hallisarja: points → game diff → head-to-head (between exactly two tied players) → games won.
  list.sort((l, r) => r.points - l.points || gameDiff(r) - gameDiff(l) || r.gamesWon - l.gamesWon || byName(l, r));
  for (let i = 0; i < list.length - 1; i += 1) {
    const l = list[i];
    const r = list[i + 1];
    const tied = (x) => x.points === l.points && gameDiff(x) === gameDiff(l);
    if (!tied(r) || (list[i + 2] && tied(list[i + 2])) || (list[i - 1] && tied(list[i - 1]))) continue;
    const mutual = confirmed.find((f) => (
      (f.playerA.id === l.player.id && f.playerB.id === r.player.id) || (f.playerA.id === r.player.id && f.playerB.id === l.player.id)
    ));
    if (mutual?.result.winnerId === r.player.id) { list[i] = r; list[i + 1] = l; }
  }
  return list;
}

/** Standings of one group in one round (scoring follows the league's format). */
export function groupStandings(league, round, group) {
  const { players, fixtures } = groupPlayers(league, round, group);
  return computeStandings(players, fixtures, { scoring: league.format });
}

/**
 * Where a fixture stands from my point of view:
 *   'confirm' (opponent reported, I confirm) | 'open' (not played) | 'waiting' (I reported) |
 *   'pending' (someone else's, reported but unconfirmed) | 'done' (confirmed)
 */
export function fixtureState(fixture, meId) {
  const r = fixture.result;
  if (!r) return 'open';
  if (r.confirmedBy) return 'done';
  if (!isMyFixture(fixture, meId)) return 'pending';
  return r.reportedBy === meId ? 'waiting' : 'confirm';
}

const MY_ORDER = { confirm: 0, open: 1, waiting: 2, done: 3 };
const OTHER_ORDER = { done: 0, pending: 1, open: 2 };

/** My fixtures first (needs-action on top), then the rest of the group (played first). */
export function sortFixtures(fixtures, meId) {
  const mine = [];
  const others = [];
  fixtures.forEach((f) => (isMyFixture(f, meId) ? mine : others).push(f));
  const time = (f) => String(f.result?.confirmedAt || '');
  mine.sort((a, b) => MY_ORDER[fixtureState(a, meId)] - MY_ORDER[fixtureState(b, meId)] || time(b).localeCompare(time(a)));
  others.sort((a, b) => OTHER_ORDER[fixtureState(a, meId)] - OTHER_ORDER[fixtureState(b, meId)] || time(b).localeCompare(time(a)));
  return { mine, others };
}

/** Board rows for a fixture: me first in my own fixtures, otherwise A then B. */
export function boardSides(fixture, meId) {
  const sets = fixture.result?.sets || [];
  const winner = fixture.result?.winnerId || null;
  const a = { player: fixture.playerA, games: sets.map((s) => s.a), won: winner === fixture.playerA.id };
  const b = { player: fixture.playerB, games: sets.map((s) => s.b), won: winner === fixture.playerB.id };
  return fixture.playerB.id === meId ? [b, a] : [a, b];
}

/** "6–4, 6–3" from my perspective (or player A's). */
export function scoreText(fixture, meId) {
  const flip = fixture.playerB.id === meId;
  return (fixture.result?.sets || []).map((s) => (flip ? `${s.b}–${s.a}` : `${s.a}–${s.b}`)).join(', ');
}

/** Tally of { my, opp } sets: won/lost counts. */
export function tallySets(sets) {
  let won = 0; let lost = 0;
  sets.forEach((s) => { if (s.my > s.opp) won += 1; else if (s.opp > s.my) lost += 1; });
  return { won, lost };
}

// ── Next round proposal (hallisarja) ─────────────────────────────────────────

const skillRank = (p) => {
  const i = SKILL_ORDER.indexOf(p?.skillLevel);
  return i < 0 ? 1 : i; // unknown ≈ keskitaso
};
const strongestFirst = (a, b) => skillRank(b) - skillRank(a) || String(a.name).localeCompare(String(b.name), 'fi');

/** Split an ordered list into ceil(n / size) groups whose sizes differ by at most one (bigger groups on top). */
export function chunkBalanced(items, size) {
  const n = items.length;
  if (n === 0) return [];
  const k = Math.max(1, Math.ceil(n / Math.max(2, size)));
  const base = Math.floor(n / k);
  const extra = n % k;
  const groups = [];
  let next = 0;
  for (let g = 0; g < k; g += 1) {
    const len = base + (g < extra ? 1 : 0);
    groups.push(items.slice(next, next + len));
    next += len;
  }
  return groups;
}

/** How many move up / down from a group of `size`: the winner (and the runner-up in groups of 6+). */
export const movesFor = (size) => (size >= 6 ? 2 : 1);

/** userId -> group index (0 = top) in the league's current round. */
export function currentGroupIndex(league) {
  const map = new Map();
  const groups = [...new Set(fixturesOfRound(league, league.currentRound).map((f) => f.groupNumber))].sort((a, b) => a - b);
  groups.forEach((g, i) => groupPlayers(league, league.currentRound, g).players.forEach((p) => map.set(p.id, i)));
  return map;
}

/** 'up' | 'down' | 'same' | 'new' for a player now placed in group index `to`. */
export function moveOf(previousIndex, id, to) {
  if (!previousIndex.has(id)) return 'new';
  const from = previousIndex.get(id);
  return to < from ? 'up' : to > from ? 'down' : 'same';
}

/**
 * Groups for the next hallisarja round, top group first: string[][] of user ids.
 * First round: everyone by level. Later: the current round's standings with the winner (and
 * runner-up in groups of 6+) moving up and the last (and second-to-last) moving down; players
 * who said they won't continue are left out, newcomers start from the bottom by level.
 */
export function proposeGroups(league, { size = league.groupSize || 5 } = {}) {
  const continuing = league.members.filter((m) => m.continues !== false);
  const round = league.currentRound || 0;
  const roundGroups = round > 0
    ? [...new Set(fixturesOfRound(league, round).map((f) => f.groupNumber))].sort((a, b) => a - b)
    : [];
  if (roundGroups.length === 0) return chunkBalanced([...continuing].sort(strongestFirst).map((m) => m.id), size);

  const keep = new Set(continuing.map((m) => m.id));
  const last = roundGroups.length - 1;
  const placed = [];
  const seen = new Set();
  roundGroups.forEach((g, gi) => {
    const ranked = groupStandings(league, round, g).map((r) => r.player.id);
    const moves = movesFor(ranked.length);
    ranked.forEach((id, rank) => {
      seen.add(id);
      let target = gi;
      let order = 1; // stayers in the middle
      if (gi > 0 && rank < moves) { target = gi - 1; order = 2; } // promoted: bottom of the group above
      else if (gi < last && rank >= ranked.length - moves) { target = gi + 1; order = 0; } // relegated: top of the group below
      if (keep.has(id)) placed.push({ id, target, order, rank });
    });
  });
  placed.sort((a, b) => a.target - b.target || a.order - b.order || a.rank - b.rank);
  const newcomers = continuing.filter((m) => !seen.has(m.id)).sort(strongestFirst);
  return chunkBalanced([...placed.map((p) => p.id), ...newcomers.map((m) => m.id)], size);
}
