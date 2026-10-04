// Gamification engine: occasions, totals, streaks, badges, goals and profile completeness.
// All dates are built in local time, like the engine buckets them, so the suite passes in
// any time zone.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  BADGES, computeTotals, evaluateBadges, nextGoals, playDates, profileCompleteness, weekIndex,
  weekStreak, winStreak,
} from '../src/features/gamification.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const local = (y, mo, d, h = 18, mi = 0) => new Date(y, mo - 1, d, h, mi);
const iso = (...args) => local(...args).toISOString();
const NOW = local(2026, 10, 2, 12); // Friday; this ISO week is Mon 28.9. – Sun 4.10.

let seq = 0;
const nextId = (prefix) => `${prefix}${(seq += 1)}`;
const person = (id) => ({ id, name: `Pelaaja ${id}`, avatarUrl: null, avatarColor: 'blue' });

const game = (when, extra = {}) => ({
  id: nextId('g'), playedAt: when, matchType: 'kaksinpeli', kind: 'open', locationName: 'Janus Areena',
  locationType: 'sisätennis', city: 'Lahti', isOrganizer: false, people: [], ...extra,
});

// `won` is derived the way both apps save it: more sets won than lost.
const result = (when, sets, extra = {}) => {
  const scores = sets.map(([my, opp]) => ({ my, opp }));
  const won = scores.filter((s) => s.my > s.opp).length > scores.filter((s) => s.opp > s.my).length;
  return {
    id: nextId('r'), createdAt: when, gameType: 'sets', format: 'singles', partnerName: null,
    opponentName: 'Vastustaja', oppPartnerName: null, sets: scores, won, ...extra,
  };
};
const win = (when, extra) => result(when, [[6, 3], [6, 4]], extra);
const loss = (when, extra) => result(when, [[3, 6], [4, 6]], extra);

// Sets are stored per fixture side; the viewer is side a when winning and side b when losing here.
const league = (when, won, extra = {}) => ({
  id: nextId('l'), playedAt: when, won, opponent: person('liigavastus'),
  sets: [{ a: 6, b: 2 }, { a: 6, b: 3 }], leagueId: 'liiga-1', ...extra,
});

const activity = (parts = {}) => ({
  games: [], results: [], leagueMatches: [], organizedCount: 0, invitesJoined: 0, memberSince: null, ...parts,
});

const byId = (badges, id) => badges.find((b) => b.id === id);

// ── playDates ────────────────────────────────────────────────────────────────

describe('playDates', () => {
  test('missing or empty activity has no occasions', () => {
    assert.deepEqual(playDates(null), []);
    assert.deepEqual(playDates(undefined), []);
    assert.deepEqual(playDates({}), []);
    assert.deepEqual(playDates(activity()), []);
  });

  test('a game and its result on the same day are one occasion, timed by the game', () => {
    const g = game(iso(2026, 9, 14, 18));
    const r = win(iso(2026, 9, 14, 21));
    const occasions = playDates(activity({ games: [g], results: [r] }));
    assert.equal(occasions.length, 1);
    assert.equal(occasions[0].day, '2026-09-14');
    assert.equal(occasions[0].at, iso(2026, 9, 14, 18));
    assert.equal(occasions[0].game, g);
    assert.equal(occasions[0].result, r);
    assert.equal(occasions[0].leagueMatch, null);
  });

  test('a result logged the next day is its own occasion', () => {
    const occasions = playDates(activity({ games: [game(iso(2026, 9, 14, 23, 59))], results: [win(iso(2026, 9, 15, 0, 1))] }));
    assert.deepEqual(occasions.map((o) => o.day), ['2026-09-14', '2026-09-15']);
  });

  test('two games on the same day are two occasions', () => {
    const occasions = playDates(activity({ games: [game(iso(2026, 9, 14, 9)), game(iso(2026, 9, 14, 19))] }));
    assert.equal(occasions.length, 2);
  });

  test('two results and one game on a day pair up into two occasions', () => {
    const occasions = playDates(activity({
      games: [game(iso(2026, 9, 14, 10))],
      results: [win(iso(2026, 9, 14, 12)), loss(iso(2026, 9, 14, 16))],
    }));
    assert.equal(occasions.length, 2);
    assert.ok(occasions[0].game && occasions[0].result);
    assert.ok(!occasions[1].game && occasions[1].result);
  });

  test('a league match also logged as a result is one occasion; so is game + result + league', () => {
    assert.equal(playDates(activity({ results: [win(iso(2026, 9, 3, 20))], leagueMatches: [league(iso(2026, 9, 3, 19), true)] })).length, 1);
    const all = playDates(activity({
      games: [game(iso(2026, 9, 3, 17))], results: [win(iso(2026, 9, 3, 20))], leagueMatches: [league(iso(2026, 9, 3, 19), true)],
    }));
    assert.equal(all.length, 1);
    assert.equal(all[0].at, iso(2026, 9, 3, 17));
  });

  test('a league match without a game is timed by the league match, not the logged result', () => {
    const [occasion] = playDates(activity({ results: [win(iso(2026, 9, 3, 22))], leagueMatches: [league(iso(2026, 9, 3, 19), true)] }));
    assert.equal(occasion.at, iso(2026, 9, 3, 19));
  });

  test('sorted oldest first whatever the input order', () => {
    const occasions = playDates(activity({
      results: [win(iso(2026, 9, 20)), win(iso(2026, 9, 1))],
      games: [game(iso(2026, 9, 10))],
      leagueMatches: [league(iso(2026, 8, 30), false)],
    }));
    assert.deepEqual(occasions.map((o) => o.day), ['2026-08-30', '2026-09-01', '2026-09-10', '2026-09-20']);
  });

  test('skips entries without a valid date and duplicate ids', () => {
    const g = game(iso(2026, 9, 1));
    const occasions = playDates(activity({
      games: [g, { ...g }, game('ei päivämäärä'), game(null), null],
      results: [win(undefined)],
    }));
    assert.equal(occasions.length, 1);
  });
});

// ── computeTotals ────────────────────────────────────────────────────────────

describe('computeTotals', () => {
  test('empty activity', () => {
    assert.deepEqual(computeTotals(activity()), {
      gamesPlayed: 0, gamesOrganized: 0, wins: 0, losses: 0, winRate: null, setsWon: 0, setsLost: 0,
      doubles: 0, singles: 0, venues: 0, partners: 0, leagueMatches: 0,
    });
    assert.equal(computeTotals(null).gamesPlayed, 0);
  });

  test('wins, losses and sets come from results and league matches', () => {
    const totals = computeTotals(activity({
      results: [win(iso(2026, 9, 1)), loss(iso(2026, 9, 2))],
      leagueMatches: [league(iso(2026, 9, 3), true), league(iso(2026, 9, 4), false)],
    }));
    assert.equal(totals.wins, 2);
    assert.equal(totals.losses, 2);
    assert.equal(totals.winRate, 0.5);
    // League sets are oriented by `won`: the 6–2 6–3 loss means 0 sets won, 2 lost.
    assert.equal(totals.setsWon, 4);
    assert.equal(totals.setsLost, 4);
    assert.equal(totals.leagueMatches, 2);
    assert.equal(totals.gamesPlayed, 4);
  });

  test('sets decide the result; only level sets are a draw', () => {
    const totals = computeTotals(activity({
      results: [
        result(iso(2026, 9, 1), [[7, 6], [7, 6], [0, 2]]), // won 2–1 on sets despite 14–14 on games
        result(iso(2026, 9, 2), [[6, 4], [4, 6]]), // 1–1, unfinished: a draw
        result(iso(2026, 9, 3), []),
      ],
    }));
    assert.equal(totals.wins, 1);
    assert.equal(totals.losses, 0);
    assert.equal(totals.winRate, 1);
    assert.equal(totals.setsWon, 3);
    assert.equal(totals.setsLost, 2);
  });

  test('a stored loss stays a loss even when more games were won', () => {
    const totals = computeTotals(activity({ results: [result(iso(2026, 9, 1), [[6, 0], [4, 6], [4, 6]])] }));
    assert.equal(totals.losses, 1);
    assert.equal(totals.winRate, 0);
  });

  test('a lone tie-break counts as a win but not as a set', () => {
    const totals = computeTotals(activity({ results: [result(iso(2026, 9, 1), [[10, 8]], { gameType: 'tiebreak' })] }));
    assert.equal(totals.wins, 1);
    assert.equal(totals.setsWon, 0);
  });

  test('singles and doubles are counted per occasion', () => {
    const totals = computeTotals(activity({
      games: [
        game(iso(2026, 9, 1), { matchType: 'nelinpeli' }),
        game(iso(2026, 9, 2)),
        game(iso(2026, 9, 3), { matchType: 'pallottelu' }),
      ],
      results: [
        win(iso(2026, 9, 1, 21), { format: 'doubles' }), // same occasion as the doubles game
        win(iso(2026, 9, 5), { format: 'doubles' }),
      ],
      leagueMatches: [league(iso(2026, 9, 6), true)],
    }));
    assert.equal(totals.gamesPlayed, 5);
    assert.equal(totals.doubles, 2);
    assert.equal(totals.singles, 2);
  });

  test('venues are distinct by name ignoring case and spacing; unnamed places do not count', () => {
    const totals = computeTotals(activity({
      games: ['Janus Areena', 'janus  areena ', 'Kispi Areena', 'Avoin', ''].map((name, i) => game(iso(2026, 9, i + 1), { locationName: name })),
    }));
    assert.equal(totals.venues, 2);
  });

  test('partners are distinct people from games and league opponents', () => {
    const totals = computeTotals(activity({
      games: [
        game(iso(2026, 9, 1), { people: [person('a'), person('b')] }),
        game(iso(2026, 9, 2), { people: [person('b'), person('c')] }),
      ],
      leagueMatches: [league(iso(2026, 9, 3), true, { opponent: person('c') }), league(iso(2026, 9, 4), true, { opponent: person('d') })],
    }));
    assert.equal(totals.partners, 4);
  });

  test('gamesOrganized is the larger of organizedCount and organized played games', () => {
    const organized = [game(iso(2026, 9, 1), { isOrganizer: true }), game(iso(2026, 9, 2), { isOrganizer: true })];
    assert.equal(computeTotals(activity({ games: organized, organizedCount: 5 })).gamesOrganized, 5);
    assert.equal(computeTotals(activity({ games: organized, organizedCount: 0 })).gamesOrganized, 2);
  });
});

// ── weekIndex / weekStreak ───────────────────────────────────────────────────

describe('weekIndex', () => {
  test('weeks start on Monday and run on across years', () => {
    assert.equal(weekIndex(local(2026, 9, 13, 23, 59)) + 1, weekIndex(local(2026, 9, 14, 0, 0)));
    assert.equal(weekIndex(local(2026, 9, 14, 0, 0)), weekIndex(local(2026, 9, 20, 23, 59)));
    // ISO week 53 of 2026 is Mon 28.12.2026 – Sun 3.1.2027.
    assert.equal(weekIndex(local(2026, 12, 28)), weekIndex(local(2027, 1, 3)));
    assert.equal(weekIndex(local(2026, 12, 27)) + 1, weekIndex(local(2026, 12, 28)));
  });
});

describe('weekStreak', () => {
  const games = (...dates) => activity({ games: dates.map((d) => game(d)) });

  test('no activity', () => {
    assert.deepEqual(weekStreak(activity(), NOW), { current: 0, best: 0, activeThisWeek: false, weeksAtRisk: false });
  });

  test('consecutive weeks ending this week', () => {
    const streak = weekStreak(games(iso(2026, 9, 16), iso(2026, 9, 23), iso(2026, 9, 30)), NOW);
    assert.deepEqual(streak, { current: 3, best: 3, activeThisWeek: true, weeksAtRisk: false });
  });

  test('a streak survives until a full week passes without play', () => {
    const played = games(iso(2026, 9, 16), iso(2026, 9, 23));
    // Monday right after: last week counts, this week is still open.
    assert.deepEqual(weekStreak(played, local(2026, 9, 28, 0, 30)), { current: 2, best: 2, activeThisWeek: false, weeksAtRisk: true });
    // Last minute of Sunday: still alive.
    assert.equal(weekStreak(played, local(2026, 10, 4, 23, 59)).current, 2);
    // Next Monday: a full week without play has passed.
    assert.deepEqual(weekStreak(played, local(2026, 10, 5, 0, 1)), { current: 0, best: 2, activeThisWeek: false, weeksAtRisk: false });
  });

  test('Sunday night and Monday morning are two different weeks', () => {
    const streak = weekStreak(games(iso(2026, 9, 13, 23, 30), iso(2026, 9, 14, 0, 15)), local(2026, 9, 14, 12));
    assert.equal(streak.current, 2);
  });

  test('Monday of one week and Sunday of the next are consecutive', () => {
    assert.equal(weekStreak(games(iso(2026, 9, 7, 7), iso(2026, 9, 20, 21)), local(2026, 9, 21, 12)).current, 2);
  });

  test('several games in one week count once', () => {
    const streak = weekStreak(games(iso(2026, 9, 28), iso(2026, 9, 29), iso(2026, 10, 1)), NOW);
    assert.equal(streak.current, 1);
    assert.equal(streak.best, 1);
  });

  test('a gap resets the current streak but best remembers', () => {
    // Four weeks in a row (10.8. – 6.9.), nothing 7.–13.9., then 16.9.
    const streak = weekStreak(games(iso(2026, 8, 10), iso(2026, 8, 17), iso(2026, 8, 24), iso(2026, 8, 31), iso(2026, 9, 16)), local(2026, 9, 17));
    assert.deepEqual(streak, { current: 1, best: 4, activeThisWeek: true, weeksAtRisk: false });
  });

  test('two weeks without play at all means no current streak', () => {
    const streak = weekStreak(games(iso(2026, 9, 16)), NOW);
    assert.equal(streak.current, 0);
    assert.equal(streak.best, 1);
    assert.equal(streak.weeksAtRisk, false);
  });

  test('carries over the turn of the year (ISO week 53)', () => {
    const streak = weekStreak(games(iso(2026, 12, 22), iso(2027, 1, 2), iso(2027, 1, 4)), local(2027, 1, 5));
    assert.equal(streak.current, 3);
  });

  test('a daylight saving change does not break the chain', () => {
    // EU clocks go back on Sunday 25.10.2026.
    const streak = weekStreak(games(iso(2026, 10, 19, 9), iso(2026, 10, 26, 9), iso(2026, 11, 2, 9)), local(2026, 11, 3));
    assert.equal(streak.current, 3);
  });

  test('ignores play dated after now', () => {
    assert.deepEqual(weekStreak(games(iso(2026, 10, 9)), NOW), { current: 0, best: 0, activeThisWeek: false, weeksAtRisk: false });
  });

  test('results and league matches keep the streak too', () => {
    const streak = weekStreak(activity({ results: [win(iso(2026, 9, 22))], leagueMatches: [league(iso(2026, 9, 29), true)] }), NOW);
    assert.equal(streak.current, 2);
  });

  test('requires an explicit now', () => {
    assert.throws(() => weekStreak(activity(), undefined), TypeError);
    assert.throws(() => weekStreak(activity(), new Date('nope')), TypeError);
  });
});

// ── winStreak ────────────────────────────────────────────────────────────────

describe('winStreak', () => {
  const sequence = (...outcomes) => activity({
    results: outcomes.map((o, i) => (o === 'W' ? win : o === 'L' ? loss : (d) => result(d, [[6, 4], [4, 6]]))(iso(2026, 9, i + 1))),
  });

  test('no matches', () => {
    assert.deepEqual(winStreak(activity()), { current: 0, best: 0 });
  });

  test('current is the run at the end, best the longest ever', () => {
    assert.deepEqual(winStreak(sequence('W', 'W', 'L', 'W', 'W', 'W')), { current: 3, best: 3 });
    assert.deepEqual(winStreak(sequence('W', 'W', 'W', 'W', 'L')), { current: 0, best: 4 });
    assert.deepEqual(winStreak(sequence('L', 'L')), { current: 0, best: 0 });
  });

  test('draws neither extend nor break a streak', () => {
    assert.deepEqual(winStreak(sequence('W', 'D', 'W')), { current: 2, best: 2 });
  });

  test('results and league matches merge in date order whatever the input order', () => {
    const streak = winStreak(activity({
      results: [win(iso(2026, 9, 20)), loss(iso(2026, 9, 10))], // newest first, like results.listMine
      leagueMatches: [league(iso(2026, 9, 15), true)],
    }));
    assert.deepEqual(streak, { current: 2, best: 2 });
  });
});

// ── BADGES ───────────────────────────────────────────────────────────────────

describe('BADGES', () => {
  const ICONS = ['ball', 'racket', 'trophy', 'flame', 'star', 'sparkles', 'bolt', 'users', 'calendar', 'pin', 'crown',
    'medal', 'sunrise', 'moon', 'target', 'heart', 'gift', 'flag', 'repeat', 'compass', 'shield', 'award'];

  test('are well formed', () => {
    assert.ok(BADGES.length >= 22, `only ${BADGES.length} badges`);
    assert.equal(new Set(BADGES.map((b) => b.id)).size, BADGES.length, 'duplicate badge id');
    for (const b of BADGES) {
      assert.ok(b.name && b.desc, `${b.id}: name and desc`);
      assert.ok(ICONS.includes(b.icon), `${b.id}: unknown icon ${b.icon}`);
      assert.ok(['bronze', 'silver', 'gold', 'special'].includes(b.tier), `${b.id}: tier`);
      assert.ok(['pelit', 'voitot', 'putket', 'yhteisö', 'erikoiset'].includes(b.group), `${b.id}: group`);
      assert.ok(Number.isInteger(b.target) && b.target > 0, `${b.id}: target`);
    }
  });

  test('include the agreed badges and ladders', () => {
    const names = BADGES.map((b) => b.name);
    for (const name of ['Ensimmäinen syöttö', 'Järjestäjä', 'Eka voitto', 'Nelinpelikonkari', 'Kiertolainen', 'Aamuvirkku',
      'Iltavirkku', 'Seurallinen', 'Verkostoituja', 'Liigapelaaja', 'Kutsuja', 'Lähettiläs', 'Vuoden veteraani']) {
      assert.ok(names.includes(name), `missing ${name}`);
    }
    const ladder = (metric) => BADGES.filter((b) => b.metric === metric).map((b) => b.target).sort((x, y) => x - y);
    assert.deepEqual(ladder('gamesPlayed'), [1, 5, 10, 25, 50, 100]);
    assert.deepEqual(ladder('organized'), [1, 5, 15]);
    assert.deepEqual(ladder('winStreak'), [3, 5]);
    assert.deepEqual(ladder('weekStreak'), [3, 5, 10]);
    assert.deepEqual(ladder('partners'), [5, 10]);
    assert.deepEqual(ladder('invitesJoined'), [1, 5]);
  });

  test('cannot be mutated by a screen', () => {
    assert.throws(() => { BADGES[0].name = 'Muutettu'; }, TypeError);
    assert.throws(() => { BADGES.push({}); }, TypeError);
  });
});

// ── evaluateBadges ───────────────────────────────────────────────────────────

describe('evaluateBadges', () => {
  const nGames = (n, extra = () => ({})) => Array.from({ length: n }, (_, i) => game(iso(2026, 9, i + 1), extra(i)));

  test('nothing is earned for an empty activity', () => {
    const badges = evaluateBadges(activity(), NOW);
    assert.equal(badges.length, BADGES.length);
    for (const b of badges) {
      assert.equal(b.earned, false, b.id);
      assert.equal(b.earnedAt, null, b.id);
      assert.equal(b.progress, 0, b.id);
      assert.equal(b.current, 0, b.id);
    }
  });

  test('game count ladder: progress below the threshold, earn date of the occasion that reached it', () => {
    const four = nGames(4);
    let badges = evaluateBadges(activity({ games: four }), NOW);
    assert.equal(byId(badges, 'first-game').earnedAt, iso(2026, 9, 1));
    assert.deepEqual(
      (({ earned, current, target, progress }) => ({ earned, current, target, progress }))(byId(badges, 'games-5')),
      { earned: false, current: 4, target: 5, progress: 0.8 },
    );
    badges = evaluateBadges(activity({ games: [...four, game(iso(2026, 9, 20))] }), NOW);
    assert.equal(byId(badges, 'games-5').earned, true);
    assert.equal(byId(badges, 'games-5').earnedAt, iso(2026, 9, 20));
    assert.equal(byId(badges, 'games-5').progress, 1);
    assert.equal(byId(badges, 'games-10').progress, 0.5);
  });

  test('organizer badges count unplayed games but only date played ones', () => {
    const badges = evaluateBadges(activity({ games: [game(iso(2026, 9, 3), { isOrganizer: true })], organizedCount: 5 }), NOW);
    assert.equal(byId(badges, 'organizer-1').earnedAt, iso(2026, 9, 3));
    assert.equal(byId(badges, 'organizer-5').earned, true);
    assert.equal(byId(badges, 'organizer-5').earnedAt, null);
    assert.equal(byId(badges, 'organizer-15').progress, 5 / 15);
  });

  test('win streak badge is dated by the win that completed the run', () => {
    const dates = [1, 2, 3, 4, 5, 6].map((d) => iso(2026, 9, d));
    const badges = evaluateBadges(activity({
      results: [win(dates[0]), win(dates[1]), loss(dates[2]), win(dates[3]), win(dates[4]), win(dates[5])],
    }), NOW);
    assert.equal(byId(badges, 'first-win').earnedAt, dates[0]);
    assert.equal(byId(badges, 'win-streak-3').earnedAt, dates[5]);
    assert.equal(byId(badges, 'win-streak-5').current, 3);
    assert.equal(byId(badges, 'win-streak-5').progress, 0.6);
  });

  test('an unearned streak badge shows the run being built now; an earned one keeps the best', () => {
    const badges = evaluateBadges(activity({
      results: [win(iso(2026, 9, 1)), win(iso(2026, 9, 2)), win(iso(2026, 9, 3)), loss(iso(2026, 9, 4)), win(iso(2026, 9, 5))],
    }), NOW);
    assert.equal(byId(badges, 'win-streak-3').earned, true);
    assert.equal(byId(badges, 'win-streak-3').current, 3);
    assert.equal(byId(badges, 'win-streak-5').current, 1);
    assert.equal(byId(badges, 'win-streak-5').progress, 0.2);
  });

  test('week streak badge is dated by the first occasion of the week that completed it', () => {
    const badges = evaluateBadges(activity({
      games: [game(iso(2026, 9, 2)), game(iso(2026, 9, 9)), game(iso(2026, 9, 18)), game(iso(2026, 9, 16))],
    }), NOW);
    assert.equal(byId(badges, 'week-streak-3').earnedAt, iso(2026, 9, 16));
    // The streak ended last week (14.–20.9. was the last week played; 21.–27.9. had nothing).
    assert.equal(byId(badges, 'week-streak-5').current, 0);
  });

  test('doubles, partners, venues and league thresholds', () => {
    const venues = ['Janus Areena', 'Kispi Areena', 'Janus Areena', 'Smash Center', 'Janus Areena'];
    const doubles = nGames(5, (i) => ({ matchType: 'nelinpeli', locationName: venues[i], people: [person(`p${i}`)] }));
    let badges = evaluateBadges(activity({ games: doubles }), NOW);
    assert.equal(byId(badges, 'doubles-5').earned, true);
    assert.equal(byId(badges, 'partners-5').earned, true);
    assert.equal(byId(badges, 'partners-10').progress, 0.5);
    assert.equal(byId(badges, 'venues-3').earned, true);
    assert.equal(byId(badges, 'venues-3').earnedAt, iso(2026, 9, 4));
    assert.equal(byId(badges, 'league-1').earned, false);

    badges = evaluateBadges(activity({ games: doubles, leagueMatches: [league(iso(2026, 9, 25), false)] }), NOW);
    assert.equal(byId(badges, 'league-1').earnedAt, iso(2026, 9, 25));
  });

  test('four doubles are not enough for Nelinpelikonkari', () => {
    const badges = evaluateBadges(activity({ games: nGames(4, () => ({ matchType: 'nelinpeli' })) }), NOW);
    assert.equal(byId(badges, 'doubles-5').earned, false);
    assert.equal(byId(badges, 'doubles-5').current, 4);
  });

  test('Aamuvirkku and Iltavirkku go by the game start hour', () => {
    const earned = (when, extra) => {
      const badges = evaluateBadges(activity(extra ?? { games: [game(when)] }), NOW);
      return { early: byId(badges, 'early-bird').earned, late: byId(badges, 'night-owl').earned };
    };
    assert.deepEqual(earned(iso(2026, 9, 1, 8, 59)), { early: true, late: false });
    assert.deepEqual(earned(iso(2026, 9, 1, 9, 0)), { early: false, late: false });
    assert.deepEqual(earned(iso(2026, 9, 1, 19, 59)), { early: false, late: false });
    assert.deepEqual(earned(iso(2026, 9, 1, 20, 0)), { early: false, late: true });
    assert.deepEqual(earned(iso(2026, 9, 1, 0, 30)), { early: false, late: false });
    // A result's timestamp is when it was logged, not when the match started.
    assert.deepEqual(earned(null, { results: [win(iso(2026, 9, 1, 7))] }), { early: false, late: false });
  });

  test('invite badges have no date', () => {
    let badges = evaluateBadges(activity({ invitesJoined: 1 }), NOW);
    assert.equal(byId(badges, 'invite-1').earned, true);
    assert.equal(byId(badges, 'invite-1').earnedAt, null);
    assert.equal(byId(badges, 'invite-5').progress, 0.2);
    badges = evaluateBadges(activity({ invitesJoined: 5 }), NOW);
    assert.equal(byId(badges, 'invite-5').earned, true);
  });

  test('Vuoden veteraani is earned on the first anniversary', () => {
    let veteran = byId(evaluateBadges(activity({ memberSince: iso(2025, 10, 2, 12, 1) }), NOW), 'veteran-1y');
    assert.equal(veteran.earned, false);
    assert.equal(veteran.current, 11);
    assert.equal(veteran.progress, 11 / 12);

    veteran = byId(evaluateBadges(activity({ memberSince: iso(2025, 10, 2, 10) }), NOW), 'veteran-1y');
    assert.equal(veteran.earned, true);
    assert.equal(veteran.earnedAt, iso(2026, 10, 2, 10));

    veteran = byId(evaluateBadges(activity({ memberSince: null }), NOW), 'veteran-1y');
    assert.equal(veteran.current, 0);
  });

  test('a leap day member celebrates on the last day of February', () => {
    const veteran = byId(evaluateBadges(activity({ memberSince: iso(2028, 2, 29, 10) }), local(2029, 3, 1)), 'veteran-1y');
    assert.equal(veteran.earnedAt, iso(2029, 2, 28, 10));
  });

  test('ignores activity dated after now', () => {
    const badges = evaluateBadges(activity({ games: [game(iso(2026, 10, 5))], results: [win(iso(2026, 10, 5))] }), NOW);
    assert.equal(byId(badges, 'first-game').earned, false);
    assert.equal(byId(badges, 'first-win').earned, false);
  });

  test('sorted earned first (newest first, undated last), then by progress', () => {
    const badges = evaluateBadges(activity({
      games: [game(iso(2026, 9, 1)), game(iso(2026, 9, 2)), game(iso(2026, 9, 3))],
      results: [win(iso(2026, 9, 10))],
      invitesJoined: 1,
    }), NOW);
    const earned = badges.filter((b) => b.earned);
    assert.deepEqual(earned.map((b) => b.id), ['first-win', 'first-game', 'invite-1']);
    assert.ok(badges.slice(0, earned.length).every((b) => b.earned), 'earned badges come first');
    const progress = badges.filter((b) => !b.earned).map((b) => b.progress);
    assert.deepEqual(progress, [...progress].sort((x, y) => y - x));
    assert.equal(badges.find((b) => !b.earned).id, 'games-5'); // 4 occasions of 5
  });

  test('requires an explicit now', () => {
    assert.throws(() => evaluateBadges(activity()), TypeError);
  });
});

// ── nextGoals ────────────────────────────────────────────────────────────────

describe('nextGoals', () => {
  test('a new player gets the first steps', () => {
    assert.deepEqual(nextGoals(activity(), NOW).map((b) => b.id), ['first-game', 'organizer-1', 'invite-1']);
  });

  test('n controls how many', () => {
    assert.equal(nextGoals(activity(), NOW, 5).length, 5);
    assert.equal(nextGoals(activity(), NOW, 0).length, 0);
  });

  test('closest to completion first, and only the next step of each ladder', () => {
    const goals = nextGoals(activity({ games: [1, 2, 3, 4].map((d) => game(iso(2026, 9, d), { isOrganizer: true })) }), NOW, 10);
    const ids = goals.map((b) => b.id);
    assert.equal(ids[0], 'games-5');
    assert.ok(ids.includes('organizer-5'));
    assert.ok(!ids.includes('games-10'), 'only the next game-count step');
    assert.ok(!ids.includes('first-game') && !ids.includes('organizer-1'), 'earned badges are not goals');
    const progress = goals.map((b) => b.progress);
    assert.deepEqual(progress, [...progress].sort((x, y) => y - x));
  });

  test('never suggests the passive membership badge', () => {
    const goals = nextGoals(activity({ memberSince: iso(2025, 10, 3) }), NOW, BADGES.length);
    assert.ok(!goals.some((b) => b.id === 'veteran-1y'));
  });
});

// ── profileCompleteness ──────────────────────────────────────────────────────

describe('profileCompleteness', () => {
  const complete = {
    avatarUrl: 'https://example.com/a.jpg', bio: 'Pelaan mielelläni iltaisin.', availability: ['arki-illat'],
    playStyles: ['matsit'], skillLevel: 'keskitaso', competitionClasses: [], handedness: 'oikeakätinen', backhand: 'kahden käden',
  };

  test('a missing profile has everything to fill in', () => {
    const { score, missing } = profileCompleteness(null);
    assert.equal(score, 0);
    assert.deepEqual(missing.map((m) => m.key), ['photo', 'bio', 'availability', 'playStyles', 'handedness', 'backhand']);
    assert.ok(missing.every((m) => typeof m.label === 'string' && m.label));
  });

  test('a complete profile scores 1', () => {
    assert.deepEqual(profileCompleteness(complete), { score: 1, missing: [] });
  });

  test('a kilpapelaaja also needs a competition class', () => {
    const competitive = { ...complete, skillLevel: 'kilpapelaaja' };
    assert.deepEqual(profileCompleteness(competitive).missing, [{ key: 'competitionClasses', label: 'Kilpailuluokka' }]);
    assert.equal(profileCompleteness(competitive).score, 6 / 7);
    assert.equal(profileCompleteness({ ...competitive, competitionClasses: ['B2'] }).score, 1);
  });

  test('blank values count as missing', () => {
    const { score, missing } = profileCompleteness({ ...complete, bio: '   ', availability: [], avatarUrl: null });
    assert.deepEqual(missing.map((m) => m.key), ['photo', 'bio', 'availability']);
    assert.equal(score, 0.5);
  });
});
