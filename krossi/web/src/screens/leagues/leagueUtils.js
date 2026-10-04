// leagueUtils.js — pure helpers for the league screens: labels, season suggestions,
// standings (same ordering as the mobile app: wins → set difference → game difference)
// and fixture ordering/perspective. Sets are `{a, b}` where `a` = player A's games.

import { SKILL_LEVELS, labelOf } from '../../lib/constants.js';

export const MIN_MEMBERS_TO_START = 4;
export const POINTS_PER_WIN = 2;
export const MAX_SETS = 5;

export const STATUS = {
  signup: { label: 'Ilmoittautuminen', tone: 'lime', icon: null, dot: 'live' },
  active: { label: 'Käynnissä', tone: 'green', icon: 'play', dot: null },
  finished: { label: 'Päättynyt', tone: 'neutral', icon: 'flag', dot: null },
};

const CITY_IN = {
  Lahti: 'Lahdessa', Turku: 'Turussa', Helsinki: 'Helsingissä', Tampere: 'Tampereella', Oulu: 'Oulussa',
  Jyväskylä: 'Jyväskylässä', Pori: 'Porissa', Kuopio: 'Kuopiossa', Rovaniemi: 'Rovaniemellä', Mikkeli: 'Mikkelissä',
};
/** Finnish locative: 'Lahti' -> 'Lahdessa' (falls back to "Kaupungissa X"). */
export const cityIn = (city) => CITY_IN[city] || `Kaupungissa ${city}`;

export const statusOf = (status) => STATUS[status] || STATUS.signup;
export const levelLabel = (level) => labelOf(SKILL_LEVELS, level) || 'Kaikki tasot';

/** Season name suggestions for "Luo liiga", based on today's date. */
export function seasonSuggestions(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const winter = (from) => `Talviliiga ${from}–${String(from + 1).slice(2)}`;
  if (m <= 3) return [`Kevätkausi ${y}`, `Kesäliiga ${y}`, `Kevät ${y}`];
  if (m <= 6) return [`Kesäliiga ${y}`, `Syyskausi ${y}`, `Kesä ${y}`];
  if (m <= 10) return [`Syyskausi ${y}`, winter(y), `Syksy ${y}`];
  return [winter(y), `Kevätkausi ${y + 1}`, `Talvi ${y}–${String(y + 1).slice(2)}`];
}

/** Group numbers present in the league, my group first. */
export function groupOrder(league, meId) {
  const set = new Set();
  league.members.forEach((m) => { if (m.groupNumber != null) set.add(m.groupNumber); });
  league.fixtures.forEach((f) => { if (f.groupNumber != null) set.add(f.groupNumber); });
  const groups = [...set].sort((a, b) => a - b);
  const mine = myGroupOf(league, meId);
  return mine != null && groups.includes(mine) ? [mine, ...groups.filter((g) => g !== mine)] : groups;
}

export function myGroupOf(league, meId) {
  return league.members.find((m) => m.id === meId)?.groupNumber ?? null;
}

export const isConfirmed = (fixture) => Boolean(fixture.result?.confirmedBy);
export const isMyFixture = (fixture, meId) => fixture.playerA.id === meId || fixture.playerB.id === meId;

/** Standings rows for one group, computed from confirmed fixtures only. */
export function computeStandings(members, fixtures) {
  const rows = new Map();
  members.forEach((m) => rows.set(m.id, {
    player: m, played: 0, wins: 0, losses: 0, setsWon: 0, setsLost: 0, gamesWon: 0, gamesLost: 0, points: 0,
  }));
  fixtures.forEach((f) => {
    if (!isConfirmed(f)) return;
    const a = rows.get(f.playerA.id);
    const b = rows.get(f.playerB.id);
    if (!a || !b) return;
    let aSets = 0; let bSets = 0; let aGames = 0; let bGames = 0;
    (f.result.sets || []).forEach((s) => {
      aGames += s.a; bGames += s.b;
      if (s.a > s.b) aSets += 1; else if (s.b > s.a) bSets += 1;
    });
    a.played += 1; b.played += 1;
    a.setsWon += aSets; a.setsLost += bSets; b.setsWon += bSets; b.setsLost += aSets;
    a.gamesWon += aGames; a.gamesLost += bGames; b.gamesWon += bGames; b.gamesLost += aGames;
    if (f.result.winnerId === f.playerA.id) { a.wins += 1; b.losses += 1; } else { b.wins += 1; a.losses += 1; }
  });
  const list = [...rows.values()];
  list.forEach((r) => { r.points = r.wins * POINTS_PER_WIN; });
  return list.sort((l, r) => (
    r.wins - l.wins
    || (r.setsWon - r.setsLost) - (l.setsWon - l.setsLost)
    || (r.gamesWon - r.gamesLost) - (l.gamesWon - l.gamesLost)
    || r.played - l.played
    || String(l.player.name).localeCompare(String(r.player.name), 'fi')
  ));
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
  const a = { player: fixture.playerA, games: sets.map((s) => s.a), won: fixture.result?.winnerId === fixture.playerA.id };
  const b = { player: fixture.playerB, games: sets.map((s) => s.b), won: fixture.result?.winnerId === fixture.playerB.id };
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
