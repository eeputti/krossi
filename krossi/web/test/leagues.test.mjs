// League helpers: hallisarja standings (2/1/0, tiebreaks), phases, round dates and the
// promotion/relegation proposal for the next round.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  chunkBalanced, computeStandings, currentGroupIndex, groupOrder, leaguePhase, moveOf, proposeGroups,
  roundAfter, roundRange, suggestRounds,
} from '../src/screens/leagues/leagueUtils.js';

const person = (id, skillLevel = 'keskitaso') => ({ id, name: id.toUpperCase(), skillLevel });
let seq = 0;
const fx = (a, b, games, { round = 1, group = 1, confirmed = true, winner } = {}) => {
  seq += 1;
  const [ga, gb] = games || [];
  return {
    id: `f${seq}`, roundNumber: round, groupNumber: group, playerA: person(a), playerB: person(b),
    result: games ? {
      sets: [{ a: ga, b: gb }],
      winnerId: winner !== undefined ? winner : ga > gb ? a : gb > ga ? b : null,
      reportedBy: a, confirmedBy: confirmed ? b : null, confirmedAt: confirmed ? '2026-10-01T10:00:00Z' : null,
    } : null,
  };
};
const ids = (rows) => rows.map((r) => r.player.id);

describe('hallisarja standings', () => {
  test('win 2, draw 1, loss 0; unconfirmed and unplayed give nothing', () => {
    const players = ['a', 'b', 'c'].map((x) => person(x));
    const rows = computeStandings(players, [fx('a', 'b', [8, 8]), fx('a', 'c', [9, 5]), fx('b', 'c', [7, 6], { confirmed: false }), fx('b', 'c')], { scoring: 'hallisarja' });
    const byId = Object.fromEntries(rows.map((r) => [r.player.id, r]));
    assert.equal(byId.a.points, 3); assert.equal(byId.a.draws, 1); assert.equal(byId.a.wins, 1);
    assert.equal(byId.b.points, 1); assert.equal(byId.c.points, 0);
    assert.equal(byId.b.played, 1);
    assert.deepEqual(ids(rows), ['a', 'b', 'c']);
  });

  test('equal points: game difference decides', () => {
    const players = ['a', 'b', 'c', 'd'].map((x) => person(x));
    const rows = computeStandings(players, [fx('a', 'c', [10, 2]), fx('b', 'd', [7, 6])], { scoring: 'hallisarja' });
    assert.deepEqual(ids(rows).slice(0, 2), ['a', 'b']);
  });

  test('two players level on points and game difference: head-to-head beats games won', () => {
    const players = ['a', 'b', 'c', 'd'].map((x) => person(x));
    // d: 2 points, +1. a and b: 2 points, ±0 each; b beat a, a has more games won.
    const rows = computeStandings(players, [
      fx('a', 'b', [8, 9]), fx('a', 'c', [9, 8]), fx('b', 'd', [5, 6]),
    ], { scoring: 'hallisarja' });
    const a = rows.find((r) => r.player.id === 'a');
    const b = rows.find((r) => r.player.id === 'b');
    assert.equal(a.points, b.points);
    assert.equal(a.gamesWon - a.gamesLost, b.gamesWon - b.gamesLost);
    assert.ok(a.gamesWon > b.gamesWon);
    assert.deepEqual(ids(rows), ['d', 'b', 'a', 'c']);
  });

  test('ladder scoring keeps wins → set diff → game diff', () => {
    const players = ['a', 'b'].map((x) => person(x));
    const rows = computeStandings(players, [fx('a', 'b', [4, 6])]);
    assert.deepEqual(ids(rows), ['b', 'a']);
    assert.equal(rows[0].points, 2);
  });
});

describe('phases and rounds', () => {
  const base = { format: 'hallisarja', members: [], fixtures: [] };
  test('signup → round → between → finished', () => {
    assert.equal(leaguePhase({ ...base, status: 'signup', currentRound: 0, rounds: [] }), 'signup');
    const rounds = [{ roundNumber: 1, status: 'active' }];
    assert.equal(leaguePhase({ ...base, status: 'active', currentRound: 1, rounds }), 'round');
    assert.equal(leaguePhase({ ...base, status: 'active', currentRound: 1, rounds: [{ roundNumber: 1, status: 'completed' }] }), 'between');
    assert.equal(leaguePhase({ ...base, status: 'finished', currentRound: 1, rounds }), 'finished');
    assert.equal(leaguePhase({ format: 'ladder', status: 'active', currentRound: 1, rounds: [] }), 'round');
  });

  test('suggested rounds are 8 weeks Monday–Sunday with a two-week break (like the Lahti series)', () => {
    const rounds = suggestRounds(new Date(2026, 8, 10), 3); // Thu 10.9.2026
    assert.deepEqual(rounds[0], { startsOn: '2026-09-14', endsOn: '2026-11-08' });
    assert.deepEqual(rounds[1], { startsOn: '2026-11-23', endsOn: '2027-01-17' });
    assert.equal(roundRange(rounds[0]), '14.9.–8.11.2026');
    assert.equal(roundRange(rounds[1]), '23.11.2026–17.1.2027');
    assert.deepEqual(roundAfter(rounds[0], new Date(2026, 10, 1)), rounds[1]);
  });

  test('groups of a past round come from its fixtures', () => {
    const league = {
      format: 'hallisarja', currentRound: 2,
      members: [{ ...person('a'), groupNumber: 2 }, { ...person('b'), groupNumber: 1 }],
      fixtures: [fx('a', 'b', [1, 2], { round: 1, group: 1 }), fx('a', 'c', null, { round: 2, group: 2 })],
    };
    assert.deepEqual(groupOrder(league, 'a', 1), [1]);
    assert.deepEqual(groupOrder(league, 'a', 2), [2, 1]);
  });
});

describe('next round proposal', () => {
  test('chunks are balanced, bigger groups on top', () => {
    assert.deepEqual(chunkBalanced([1, 2, 3, 4, 5, 6, 7, 8, 9], 5).map((g) => g.length), [5, 4]);
    assert.deepEqual(chunkBalanced(Array.from({ length: 55 }, (_, i) => i), 6).map((g) => g.length), [6, 6, 6, 6, 6, 5, 5, 5, 5, 5]);
    assert.deepEqual(chunkBalanced([], 5), []);
  });

  test('first round: strongest first', () => {
    const league = {
      format: 'hallisarja', currentRound: 0, groupSize: 3, fixtures: [],
      members: [person('a', 'aloittelija'), person('b', 'kilpapelaaja'), person('c', 'edistynyt'), person('d', 'keskitaso'), person('e', 'aloittelija'), person('f', 'edistynyt')],
    };
    assert.deepEqual(proposeGroups(league), [['b', 'c', 'f'], ['d', 'a', 'e']]);
  });

  test('winner up, last down; leavers out; newcomers at the bottom', () => {
    // A: a1 > a2 > a3 > a4 · B: b1 > b2 > b3 > b4
    const A = ['a1', 'a2', 'a3', 'a4'];
    const B = ['b1', 'b2', 'b3', 'b4'];
    const games = (ranked, group) => {
      const out = [];
      for (let i = 0; i < ranked.length; i += 1) for (let j = i + 1; j < ranked.length; j += 1) out.push(fx(ranked[i], ranked[j], [9, 3], { group }));
      return out;
    };
    const league = {
      format: 'hallisarja', currentRound: 1, groupSize: 4,
      rounds: [{ roundNumber: 1, status: 'completed' }],
      members: [
        ...A.map((id) => ({ ...person(id), groupNumber: 1, continues: true })),
        ...B.map((id) => ({ ...person(id), groupNumber: 2, continues: id !== 'b3' })),
        { ...person('new', 'edistynyt'), groupNumber: null, continues: true },
      ],
      fixtures: [...games(A, 1), ...games(B, 2)],
    };
    const groups = proposeGroups(league);
    assert.deepEqual(groups, [['a1', 'a2', 'a3', 'b1'], ['a4', 'b2', 'b4', 'new']]);
    const prev = currentGroupIndex(league);
    assert.equal(moveOf(prev, 'b1', 0), 'up');
    assert.equal(moveOf(prev, 'a4', 1), 'down');
    assert.equal(moveOf(prev, 'a1', 0), 'same');
    assert.equal(moveOf(prev, 'new', 1), 'new');
  });

  test('groups of six move two up and two down', () => {
    const A = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
    const B = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'];
    const games = (ranked, group) => {
      const out = [];
      for (let i = 0; i < ranked.length; i += 1) for (let j = i + 1; j < ranked.length; j += 1) out.push(fx(ranked[i], ranked[j], [8, 4], { group }));
      return out;
    };
    const league = {
      format: 'hallisarja', currentRound: 1, groupSize: 6,
      members: [...A.map((id) => ({ ...person(id), groupNumber: 1 })), ...B.map((id) => ({ ...person(id), groupNumber: 2 }))],
      fixtures: [...games(A, 1), ...games(B, 2)],
    };
    assert.deepEqual(proposeGroups(league), [['a1', 'a2', 'a3', 'a4', 'b1', 'b2'], ['a5', 'a6', 'b3', 'b4', 'b5', 'b6']]);
  });
});
