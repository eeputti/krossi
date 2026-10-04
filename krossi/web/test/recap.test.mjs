// Monthly and season recaps. Dates are built in local time, like the engine buckets them.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { availableRecaps, buildRecap, monthKey, parsePeriod, seasonKey } from '../src/features/recap.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const local = (y, mo, d, h = 18, mi = 0) => new Date(y, mo - 1, d, h, mi);
const iso = (...args) => local(...args).toISOString();
const NOW = local(2026, 10, 2, 12); // Friday 2.10.2026

let seq = 0;
const nextId = (prefix) => `${prefix}${(seq += 1)}`;
const person = (id) => ({ id, name: `Pelaaja ${id}`, avatarUrl: null, avatarColor: 'blue' });
const A = person('a');
const B = person('b');
const C = person('c');
const D = person('d');

const game = (when, extra = {}) => ({
  id: nextId('g'), playedAt: when, matchType: 'kaksinpeli', kind: 'open', locationName: 'Janus Areena',
  locationType: 'sisätennis', city: 'Lahti', isOrganizer: false, people: [], ...extra,
});
const result = (when, sets, won) => ({
  id: nextId('r'), createdAt: when, gameType: 'sets', format: 'singles', partnerName: null, opponentName: 'Vastustaja',
  oppPartnerName: null, sets: sets.map(([my, opp]) => ({ my, opp })), won,
});
const win = (when) => result(when, [[6, 3], [6, 4]], true);
const loss = (when) => result(when, [[3, 6], [4, 6]], false);
const league = (when, won, opponent) => ({
  id: nextId('l'), playedAt: when, won, opponent, sets: [{ a: 6, b: 2 }, { a: 6, b: 3 }], leagueId: 'liiga-1',
});
const activity = (parts = {}) => ({
  games: [], results: [], leagueMatches: [], organizedCount: 0, invitesJoined: 0, memberSince: null, ...parts,
});
const gamesOn = (...dates) => activity({ games: dates.map((d) => game(d)) });

// August: three games with A. September (the month under test): five occasions, four ISO
// weeks in a row, three wins and one loss. Plus one game on each side of September's edges.
function seasonActivity() {
  return activity({
    games: [
      game(iso(2026, 8, 10), { people: [A] }),
      game(iso(2026, 8, 20), { people: [A] }),
      game(iso(2026, 8, 31, 23, 59), { people: [A] }), // last minute of August
      game(iso(2026, 9, 2, 18), { people: [A], isOrganizer: true }),
      game(iso(2026, 9, 9, 19), { people: [B] }),
      game(iso(2026, 9, 16, 18, 30), { people: [A, B], locationName: 'Kispi Areena' }),
      game(iso(2026, 9, 22, 8), { people: [B, C] }),
      game(iso(2026, 10, 1, 0, 0), { people: [C] }), // first minute of October
    ],
    results: [win(iso(2026, 9, 2, 20)), win(iso(2026, 9, 9, 21)), loss(iso(2026, 9, 16, 21))],
    leagueMatches: [league(iso(2026, 9, 27, 15), true, D)],
    organizedCount: 4,
    invitesJoined: 2,
  });
}

// ── Keys and periods ─────────────────────────────────────────────────────────

describe('monthKey / seasonKey', () => {
  test('month of a local date', () => {
    assert.equal(monthKey(local(2026, 9, 30, 23, 59)), '2026-09');
    assert.equal(monthKey(local(2026, 10, 1, 0, 0)), '2026-10');
    assert.equal(monthKey(iso(2026, 1, 5)), '2026-01');
    assert.equal(monthKey('ei päivä'), null);
    assert.equal(monthKey(null), null);
  });

  test('season key', () => {
    assert.equal(seasonKey(2026), 'kausi-2026');
  });
});

describe('parsePeriod', () => {
  test('a month', () => {
    assert.deepEqual(parsePeriod('2026-09'), {
      type: 'month', key: '2026-09', year: 2026, month: 9, label: 'syyskuu 2026',
      start: local(2026, 9, 1, 0), end: local(2026, 10, 1, 0),
    });
  });

  test('December ends at the start of the next year', () => {
    const period = parsePeriod('2026-12');
    assert.equal(period.label, 'joulukuu 2026');
    assert.deepEqual(period.end, local(2027, 1, 1, 0));
  });

  test('a season is the calendar year', () => {
    assert.deepEqual(parsePeriod('kausi-2026'), {
      type: 'season', key: 'kausi-2026', year: 2026, label: 'Kausi 2026',
      start: local(2026, 1, 1, 0), end: local(2027, 1, 1, 0),
    });
    assert.equal(parsePeriod(' KAUSI-2026 ').key, 'kausi-2026');
  });

  test('invalid periods', () => {
    for (const bad of ['2026-13', '2026-00', '2026-9', '26-09', 'kausi-26', 'kausi-', 'syyskuu-2026', '1999-01', '', null, undefined, 202609]) {
      assert.equal(parsePeriod(bad), null, String(bad));
    }
  });
});

// ── buildRecap ───────────────────────────────────────────────────────────────

describe('buildRecap', () => {
  test('a full month', () => {
    const recap = buildRecap(seasonActivity(), '2026-09', NOW);
    assert.equal(recap.key, '2026-09');
    assert.equal(recap.label, 'syyskuu 2026');
    assert.equal(recap.inProgress, false);
    assert.equal(recap.isEmpty, false);
    assert.equal(recap.gamesPlayed, 5);
    assert.equal(recap.wins, 3);
    assert.equal(recap.losses, 1);
    assert.equal(recap.winRate, 0.75);
    assert.equal(recap.setsWon, 6);
    assert.equal(recap.setsLost, 2);
    assert.equal(recap.organized, 1, 'organized games played in the month, not the undated organizedCount');
    assert.deepEqual(recap.topPartner, { person: B, count: 3 });
    assert.deepEqual(recap.topVenue, { name: 'Janus Areena', count: 3 });
    assert.equal(recap.busiestWeekday, 'keskiviikko');
    assert.equal(recap.favoriteTime, 'ilta');
    assert.equal(recap.longestWeekStreakInPeriod, 4);
    assert.deepEqual(recap.newPartners, [B, C, D]);
    assert.deepEqual(recap.comparedToPrevious, { gamesDelta: 2, previousGamesPlayed: 3, previousLabel: 'elokuu 2026' });
    assert.equal(recap.headline, 'Syyskuun voittokone');
  });

  test('new badges are those earned during the month, in the order they were earned', () => {
    const recap = buildRecap(seasonActivity(), '2026-09', NOW);
    assert.deepEqual(recap.newBadges.map((b) => b.id), ['organizer-1', 'first-win', 'games-5', 'week-streak-3', 'early-bird', 'league-1']);
    assert.equal(recap.newBadges[2].earnedAt, iso(2026, 9, 9, 19));
    // Earned in August or October, or never dated: not part of September.
    for (const id of ['first-game', 'week-streak-5', 'invite-1', 'organizer-5']) {
      assert.ok(!recap.newBadges.some((b) => b.id === id), id);
    }
  });

  test('the edges of the month are exact', () => {
    const activityAtEdges = gamesOn(iso(2026, 8, 31, 23, 59), iso(2026, 9, 1, 0, 0), iso(2026, 9, 30, 23, 59), iso(2026, 10, 1, 0, 0));
    assert.equal(buildRecap(activityAtEdges, '2026-09', NOW).gamesPlayed, 2);
  });

  test('an empty past month', () => {
    const recap = buildRecap(seasonActivity(), '2026-07', NOW);
    assert.equal(recap.isEmpty, true);
    assert.equal(recap.gamesPlayed, 0);
    assert.equal(recap.wins, 0);
    assert.equal(recap.winRate, null);
    assert.equal(recap.topPartner, null);
    assert.equal(recap.topVenue, null);
    assert.equal(recap.busiestWeekday, null);
    assert.equal(recap.favoriteTime, null);
    assert.equal(recap.longestWeekStreakInPeriod, 0);
    assert.deepEqual(recap.newBadges, []);
    assert.deepEqual(recap.newPartners, []);
    assert.equal(recap.comparedToPrevious, null, 'nothing to compare before the first game');
    assert.equal(recap.headline, 'Rauhallinen kuukausi — elokuussa uusi yritys!');
  });

  test('a quiet month after active ones compares to the previous month', () => {
    const recap = buildRecap(gamesOn(iso(2026, 7, 1), iso(2026, 8, 3), iso(2026, 8, 12)), '2026-09', NOW);
    assert.deepEqual(recap.comparedToPrevious, { gamesDelta: -2, previousGamesPlayed: 2, previousLabel: 'elokuu 2026' });
    assert.equal(recap.headline, 'Rauhallinen kuukausi — lokakuussa uusi yritys!');
  });

  test('an empty December points to January', () => {
    assert.equal(buildRecap(gamesOn(iso(2026, 11, 3)), '2026-12', local(2027, 1, 15)).headline, 'Rauhallinen kuukausi — tammikuussa uusi yritys!');
  });

  test('the current month counts only what has happened so far', () => {
    const data = seasonActivity();
    data.games.push(game(iso(2026, 10, 10, 18), { people: [D] }));
    const recap = buildRecap(data, '2026-10', NOW);
    assert.equal(recap.inProgress, true);
    assert.equal(recap.gamesPlayed, 1);
    assert.deepEqual(recap.comparedToPrevious, { gamesDelta: -4, previousGamesPlayed: 5, previousLabel: 'syyskuu 2026' });
    assert.equal(recap.headline, 'Yksi peli takana — siitä se lähtee!');
  });

  test('an empty current month invites to play', () => {
    const recap = buildRecap(gamesOn(iso(2026, 9, 10)), '2026-10', NOW);
    assert.equal(recap.isEmpty, true);
    assert.equal(recap.headline, 'Lokakuun eka peli odottaa vielä — pelataanko?');
  });

  test('a season', () => {
    const data = seasonActivity();
    let recap = buildRecap(data, 'kausi-2026', NOW);
    assert.equal(recap.label, 'Kausi 2026');
    assert.equal(recap.gamesPlayed, 9);
    assert.equal(recap.inProgress, true);
    assert.equal(recap.comparedToPrevious, null);
    assert.deepEqual(recap.topPartner, { person: A, count: 5 });
    assert.equal(recap.newPartners.length, 4);

    data.games.push(game(iso(2025, 6, 1)));
    recap = buildRecap(data, 'kausi-2026', NOW);
    assert.deepEqual(recap.comparedToPrevious, { gamesDelta: 8, previousGamesPlayed: 1, previousLabel: 'Kausi 2025' });
  });

  test('accepts a Period object as well as a key; null for an invalid period', () => {
    const data = seasonActivity();
    assert.deepEqual(buildRecap(data, parsePeriod('2026-09'), NOW), buildRecap(data, '2026-09', NOW));
    assert.equal(buildRecap(data, '2026-13', NOW), null);
    assert.equal(buildRecap(data, null, NOW), null);
  });

  test('works for a missing activity', () => {
    const recap = buildRecap(null, '2026-09', NOW);
    assert.equal(recap.isEmpty, true);
    assert.equal(recap.gamesPlayed, 0);
  });

  test('requires an explicit now', () => {
    assert.throws(() => buildRecap(activity(), '2026-09'), TypeError);
  });

  test('a single tie in partners goes to the most recent one', () => {
    const recap = buildRecap(activity({ games: [game(iso(2026, 9, 1), { people: [A] }), game(iso(2026, 9, 8), { people: [B] })] }), '2026-09', NOW);
    assert.deepEqual(recap.topPartner, { person: B, count: 1 });
  });

  test('favourite time ignores results, whose time is only when they were logged', () => {
    const recap = buildRecap(activity({
      games: [game(iso(2026, 9, 1, 7))],
      results: [win(iso(2026, 9, 5, 21)), win(iso(2026, 9, 6, 22))],
    }), '2026-09', NOW);
    assert.equal(recap.favoriteTime, 'aamu');
  });
});

describe('recap headlines', () => {
  const headline = (data, period = '2026-09', now = NOW) => buildRecap(data, period, now).headline;
  // Games on Tuesdays two weeks apart: no streaks, no badges ladders to speak of.
  const spaced = (n, month = 9) => Array.from({ length: n }, (_, i) => iso(2026, month, 1 + 14 * (i % 2), 10 + Math.floor(i / 2)));

  test('lots of games', () => {
    const eight = Array.from({ length: 8 }, (_, i) => iso(2026, 9, 1 + (i % 2) * 14, 8 + i));
    assert.equal(headline(gamesOn(...eight)), 'Syyskuun kenttäkuningas');
  });

  test('every week on court', () => {
    assert.equal(headline(gamesOn(iso(2026, 9, 1), iso(2026, 9, 8), iso(2026, 9, 15), iso(2026, 9, 22))), '4 viikkoa putkeen — rautaa!');
  });

  test('more than last month', () => {
    assert.equal(headline(gamesOn(iso(2026, 8, 4), ...spaced(4))), 'Nousukiidossa — 3 peliä enemmän kuin elokuussa');
  });

  test('new people', () => {
    const data = activity({ games: [game(iso(2026, 9, 1), { people: [A, B] }), game(iso(2026, 9, 15), { people: [C] })] });
    assert.equal(headline(data), '3 uutta pelikaveria syyskuussa!');
  });

  test('winning record', () => {
    const data = activity({ games: [game(iso(2026, 8, 3)), game(iso(2026, 9, 1)), game(iso(2026, 9, 15))], results: [win(iso(2026, 9, 1, 21))] });
    assert.equal(headline(data), 'Syyskuussa plussalla: 1–0');
  });

  test('a couple of games', () => {
    assert.equal(headline(gamesOn(iso(2026, 8, 4), iso(2026, 8, 5), ...spaced(2))), '2 peliä syyskuussa — hyvä meno!');
  });

  test('season wording', () => {
    assert.equal(headline(gamesOn(iso(2025, 5, 1)), 'kausi-2025', local(2026, 3, 1)), 'Yksi peli takana — siitä se lähtee!');
    assert.equal(headline(gamesOn(iso(2024, 5, 1)), 'kausi-2025', local(2026, 3, 1)), 'Rauhallinen kausi — ensi kaudella uusi yritys!');
    assert.equal(headline(gamesOn(iso(2025, 5, 1), iso(2025, 5, 20)), 'kausi-2025', local(2026, 3, 1)), '2 peliä kaudella 2025 — hyvä meno!');
  });
});

// ── availableRecaps ──────────────────────────────────────────────────────────

describe('availableRecaps', () => {
  test('no activity, no recaps', () => {
    assert.deepEqual(availableRecaps(activity(), NOW), []);
    assert.deepEqual(availableRecaps(null, NOW), []);
  });

  test('months newest first, then seasons', () => {
    assert.deepEqual(availableRecaps(seasonActivity(), NOW), [
      { key: '2026-10', label: 'lokakuu 2026', type: 'month', gamesPlayed: 1 },
      { key: '2026-09', label: 'syyskuu 2026', type: 'month', gamesPlayed: 5 },
      { key: '2026-08', label: 'elokuu 2026', type: 'month', gamesPlayed: 3 },
      { key: 'kausi-2026', label: 'Kausi 2026', type: 'season', gamesPlayed: 9 },
    ]);
  });

  test('counts agree with the recaps themselves', () => {
    const data = seasonActivity();
    for (const item of availableRecaps(data, NOW)) {
      assert.equal(buildRecap(data, item.key, NOW).gamesPlayed, item.gamesPlayed, item.key);
    }
  });

  test('the current month appears only once it has a game; future games never count', () => {
    const data = gamesOn(iso(2026, 9, 20), iso(2026, 10, 9));
    assert.deepEqual(availableRecaps(data, NOW).map((r) => r.key), ['2026-09', 'kausi-2026']);
  });

  test('several seasons', () => {
    const keys = availableRecaps(gamesOn(iso(2025, 12, 30), iso(2026, 1, 2)), NOW).map((r) => r.key);
    assert.deepEqual(keys, ['2026-01', '2025-12', 'kausi-2026', 'kausi-2025']);
  });

  test('requires an explicit now', () => {
    assert.throws(() => availableRecaps(activity()), TypeError);
  });
});
