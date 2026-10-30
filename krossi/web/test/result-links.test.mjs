// Logged results whose players are Krossi users (features/resultLinks.js), the confirmation
// lines on result cards and the bell items about them.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  asksOpponent, canAnswer, linksOfInput, opponentIdsOf, rankCandidates, ratedMatches, roleOf, setsWonBy, viewResult,
} from '../src/features/resultLinks.js';
import { buildNotifications } from '../src/features/notifications.js';
import { confirmationLine } from '../src/screens/profile/matchResult.js';

const person = (id, name) => ({ id, name, avatarUrl: null, avatarColor: 'blue', ageRange: null, skillLevel: null });
const PEOPLE = new Map([
  ['a', person('a', 'Aapo Ankka')],
  ['p', person('p', 'Pirjo')],
  ['b', person('b', 'Bea')],
  ['d', person('d', 'Daniel')],
]);

const stored = (over = {}) => ({
  id: 'r1', createdAt: '2026-10-10T17:00:00.000Z', createdBy: 'a', gameType: 'sets', format: 'singles',
  partnerName: null, opponentName: null, oppPartnerName: null, partnerId: null, opponentId: 'b', oppPartnerId: null,
  sets: [{ my: 6, opp: 4 }, { my: 3, opp: 6 }, { my: 6, opp: 2 }], won: true,
  confirmation: 'pending', confirmedBy: null, confirmedAt: null, disputedBy: null, disputedAt: null,
  ...over,
});

test('roleOf / canAnswer: only the other side answers', () => {
  const row = stored({ format: 'doubles', partnerId: 'p', oppPartnerId: 'd' });
  assert.equal(roleOf(row, 'a'), 'creator');
  assert.equal(roleOf(row, 'p'), 'partner');
  assert.equal(roleOf(row, 'b'), 'opponent');
  assert.equal(roleOf(row, 'd'), 'oppPartner');
  assert.equal(roleOf(row, 'x'), null);
  assert.deepEqual(['a', 'p', 'b', 'd', 'x'].map((u) => canAnswer(row, u)), [false, false, true, true, false]);
});

test('viewResult: the logger sees it as stored, with the linked opponent', () => {
  const r = viewResult(stored(), 'a', PEOPLE);
  assert.equal(r.isMine, true);
  assert.equal(r.loggedBy, null);
  assert.equal(r.opponentName, 'Bea', 'a linked player fills an empty name');
  assert.equal(r.opponent.id, 'b');
  assert.equal(r.partner, null);
  assert.deepEqual(r.sets, [{ my: 6, opp: 4 }, { my: 3, opp: 6 }, { my: 6, opp: 2 }]);
  assert.equal(r.won, true);
  assert.equal(r.confirmation, 'pending');
  assert.equal(r.answeredBy, null);
});

test('viewResult: the opponent sees their own side as "my", the logger as opponent', () => {
  const r = viewResult(stored({ opponentName: 'Bea B.' }), 'b', PEOPLE);
  assert.equal(r.isMine, false);
  assert.equal(r.loggedBy.name, 'Aapo Ankka');
  assert.equal(r.opponent.id, 'a');
  assert.equal(r.opponentName, 'Aapo Ankka');
  assert.deepEqual(r.sets, [{ my: 4, opp: 6 }, { my: 6, opp: 3 }, { my: 2, opp: 6 }]);
  assert.equal(r.won, false);
});

test('viewResult: doubles from all four seats', () => {
  const row = stored({
    format: 'doubles', partnerId: 'p', partnerName: 'Pirjo', oppPartnerId: 'd', oppPartnerName: 'Daniel', opponentName: 'Bea',
    confirmation: 'confirmed', confirmedBy: 'd', confirmedAt: '2026-10-11T08:00:00.000Z',
  });
  const partner = viewResult(row, 'p', PEOPLE);
  assert.equal(partner.partnerName, 'Aapo Ankka');
  assert.equal(partner.opponentName, 'Bea');
  assert.equal(partner.won, true);
  const opp = viewResult(row, 'b', PEOPLE);
  assert.equal(opp.partnerName, 'Daniel');
  assert.equal(opp.opponentName, 'Aapo Ankka');
  assert.equal(opp.oppPartnerName, 'Pirjo');
  assert.equal(opp.won, false);
  const oppPartner = viewResult(row, 'd', PEOPLE);
  assert.equal(oppPartner.partner.id, 'b');
  assert.equal(oppPartner.answeredBy.id, 'd');
  assert.equal(oppPartner.answeredAt, '2026-10-11T08:00:00.000Z');
});

test('viewResult: typed names win, unknown people stay "Pelaaja" without hiding the typed name', () => {
  const r = viewResult(stored({ opponentId: 'zz', opponentName: 'Kaveri' }), 'a', PEOPLE);
  assert.equal(r.opponentName, 'Kaveri');
  assert.equal(r.opponent.name, 'Pelaaja');
  const unlinked = viewResult(stored({ opponentId: null, opponentName: 'Joku', confirmation: null }), 'a', PEOPLE);
  assert.equal(unlinked.opponent, null);
  assert.equal(unlinked.confirmation, null);
  // Singles never show partner names, whatever the row says.
  assert.equal(viewResult(stored({ partnerName: 'X' }), 'a', PEOPLE).partnerName, null);
});

test('setsWonBy: more sets won than lost; level is not a win', () => {
  assert.equal(setsWonBy([{ my: 6, opp: 4 }]), true);
  assert.equal(setsWonBy([{ my: 6, opp: 4 }, { my: 4, opp: 6 }]), false);
  assert.equal(setsWonBy([]), false);
});

test('linksOfInput: singles drop partners, me and duplicates are refused', () => {
  assert.deepEqual(linksOfInput({ format: 'singles', opponentId: 'b', partnerId: 'p', oppPartnerId: 'd' }, 'a'),
    { ids: { partnerId: null, opponentId: 'b', oppPartnerId: null }, error: null });
  assert.deepEqual(linksOfInput({ format: 'doubles', opponentId: ' ', partnerId: 'p' }, 'a').ids, { partnerId: 'p', opponentId: null, oppPartnerId: null });
  assert.match(linksOfInput({ format: 'singles', opponentId: 'a' }, 'a').error, /itseäsi/);
  assert.match(linksOfInput({ format: 'doubles', opponentId: 'b', oppPartnerId: 'b' }, 'a').error, /kahdesti/);
});

test('asksOpponent: new questions only', () => {
  const pending = { confirmation: 'pending', opponentId: 'b', oppPartnerId: null };
  assert.equal(asksOpponent(null, pending), true, 'a new linked result');
  assert.equal(asksOpponent({ ...pending, confirmation: 'disputed' }, pending), true, 'corrected after a dispute');
  assert.equal(asksOpponent(pending, pending), false, 'still the same question');
  assert.equal(asksOpponent(pending, { ...pending, opponentId: 'c' }), true, 'someone else now');
  assert.equal(asksOpponent(null, { confirmation: null }), false, 'typed names only');
});

test('rankCandidates: pelikaverit first, unknown and excluded out, word-start search', () => {
  const partners = [
    { player: person('m', 'Mikko Virtanen'), gamesTogether: 5 },
    { player: person('u', 'Pelaaja'), gamesTogether: 3 },
    { player: person('e', 'Emilia'), gamesTogether: 1 },
  ];
  const players = [person('e', 'Emilia'), person('t', 'Tuomas'), person('j', 'Juho Mikkola')];
  assert.deepEqual(rankCandidates({ partners, players }).map((c) => [c.person.id, c.gamesTogether]), [['m', 5], ['e', 1], ['t', 0], ['j', 0]]);
  assert.deepEqual(rankCandidates({ partners, players, query: 'mik' }).map((c) => c.person.id), ['m', 'j']);
  assert.deepEqual(rankCandidates({ partners, players, query: 'om' }).map((c) => c.person.id), [], 'not the middle of a word');
  assert.deepEqual(rankCandidates({ partners, players, excludeIds: ['m'], limit: 2 }).map((c) => c.person.id), ['e', 't']);
  assert.deepEqual(Object.keys(rankCandidates({ partners, players })[0].person).sort(), ['ageRange', 'avatarColor', 'avatarUrl', 'id', 'name', 'skillLevel']);
});

test('ratedMatches: confirmed linked results and league matches, a same-day duplicate once', () => {
  const view = (over) => viewResult(stored(over), 'a', PEOPLE);
  const results = [
    view({ id: 'c1', confirmation: 'confirmed', createdAt: '2026-10-12T18:00:00.000Z', sets: [{ my: 6, opp: 3 }, { my: 6, opp: 4 }] }),
    view({ id: 'p1', confirmation: 'pending' }),
    view({ id: 'd1', confirmation: 'disputed' }),
    view({ id: 't1', confirmation: 'confirmed', opponentId: null, opponentName: 'Kaveri' }),
    // The same league match also logged as a result: counted once (as the league match).
    view({ id: 'dup', confirmation: 'confirmed', createdAt: '2026-10-05T19:30:00.000Z', sets: [{ my: 2, opp: 6 }, { my: 3, opp: 6 }] }),
  ];
  const leagueMatches = [
    { id: 'L1', playedAt: '2026-10-05T17:00:00.000Z', won: false, opponent: person('b', 'Bea'), sets: [{ a: 2, b: 6 }, { a: 3, b: 6 }], leagueId: 'x' },
    { id: 'L2', playedAt: '2026-09-28T17:00:00.000Z', won: false, opponent: person('d', 'Daniel'), sets: [{ a: 4, b: 4 }], leagueId: 'x' },
  ];
  const rated = ratedMatches({ results, leagueMatches });
  assert.deepEqual(rated.map((m) => m.id), ['c1', 'L1', 'L2']);
  assert.deepEqual(rated[0], {
    id: 'c1', source: 'result', playedAt: '2026-10-12T18:00:00.000Z', format: 'singles', partnerId: null,
    opponentIds: ['b'], sets: [{ a: 6, b: 3 }, { a: 6, b: 4 }], winner: 'a',
  });
  assert.equal(rated[1].winner, 'b');
  assert.equal(rated[2].winner, null, 'a timed draw is nobody\'s win');
  assert.deepEqual(opponentIdsOf(results[0]), ['b']);
});

test('confirmationLine: what the card says under the score', () => {
  const mine = (over) => viewResult(stored(over), 'a', PEOPLE);
  assert.equal(confirmationLine(mine({ confirmation: null, opponentId: null })), null);
  assert.equal(confirmationLine(mine({})).text, 'Odottaa, että Bea vahvistaa');
  assert.equal(confirmationLine(mine({ confirmation: 'confirmed', confirmedBy: 'b', confirmedAt: 'x' })).text, 'Bea vahvisti tuloksen');
  const disputed = confirmationLine(mine({ confirmation: 'disputed', disputedBy: 'b', disputedAt: 'x' }));
  assert.equal(disputed.tone, 'danger');
  assert.match(disputed.text, /^Bea: ei pidä paikkaansa/);
  const theirs = viewResult(stored({ confirmation: 'confirmed', confirmedBy: 'b', confirmedAt: 'x' }), 'b', PEOPLE);
  assert.equal(confirmationLine(theirs).text, 'Kirjasi Aapo, vahvistettu');
});

test('bell: results waiting for my answer, and answers to mine from the last week', () => {
  const now = Date.parse('2026-10-17T12:00:00.000Z');
  const toConfirm = [viewResult(stored({ createdAt: '2026-10-16T18:00:00.000Z' }), 'b', PEOPLE)];
  const results = [
    viewResult(stored({ id: 'ok', confirmation: 'confirmed', confirmedBy: 'b', confirmedAt: '2026-10-17T10:00:00.000Z' }), 'a', PEOPLE),
    viewResult(stored({ id: 'no', confirmation: 'disputed', disputedBy: 'b', disputedAt: '2026-10-16T10:00:00.000Z' }), 'a', PEOPLE),
    viewResult(stored({ id: 'old', confirmation: 'confirmed', confirmedBy: 'b', confirmedAt: '2026-10-01T10:00:00.000Z' }), 'a', PEOPLE),
    viewResult(stored({ id: 'theirs', createdBy: 'b', opponentId: 'a', confirmation: 'confirmed', confirmedBy: 'a', confirmedAt: '2026-10-17T09:00:00.000Z' }), 'a', PEOPLE),
  ];
  const items = buildNotifications({ toConfirm, results, now });
  assert.deepEqual(items.map((i) => i.kind), ['resultAnswered', 'resultConfirm', 'resultAnswered']);
  assert.equal(items[0].title, 'Bea vahvisti tuloksen');
  assert.equal(items[0].to, '/pelaa/profiili');
  assert.equal(items[1].title, 'Aapo kirjasi tuloksen kanssasi');
  assert.equal(items[1].result.id, 'r1');
  assert.match(items[1].body, /^4–6 6–3 2–6/);
  assert.equal(items[2].title, 'Bea: tulos ei pidä paikkaansa');
});
