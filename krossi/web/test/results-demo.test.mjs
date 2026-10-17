// The demo backend's match results with Krossi players in them: linking, the opponent's
// confirmation (the same rules as migration 20261017130234) and the seed the demo shows.
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { ApiError } from '../src/api/errors.js';
import { configureTiming } from '../src/api/demo/runtime.js';
import { db, resetStore } from '../src/api/demo/store.js';
import { backend as api } from '../src/api/demo/index.js';
import { ratedMatches } from '../src/features/resultLinks.js';

configureTiming({ latencyMin: 0, latencyMax: 0, autoScale: 0.001 });
beforeEach(() => resetStore());

const ME = 'demo-user';
const MIKKO = 'p-mikko';
const EMILIA = 'p-emilia';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const input = (over = {}) => ({
  gameType: 'sets', format: 'singles', partnerName: null, opponentName: 'Mikko', oppPartnerName: null,
  opponentId: MIKKO, sets: [{ my: 6, opp: 3 }, { my: 6, opp: 4 }], won: true, ...over,
});
const rejectsWith = (promise, re) => assert.rejects(promise, (e) => e instanceof ApiError && re.test(e.userMessage));

test('seed: Mikko waits for my answer; the history shows answered and others\' results', async () => {
  const waiting = await api.results.listToConfirm();
  assert.equal(waiting.length, 1);
  const [r] = waiting;
  assert.equal(r.id, 'r-mikko-vahvista');
  assert.equal(r.isMine, false);
  assert.equal(r.loggedBy.id, MIKKO);
  assert.equal(r.opponent.id, MIKKO, 'the logger is my opponent');
  assert.deepEqual(r.sets, [{ my: 4, opp: 6 }, { my: 6, opp: 3 }, { my: 3, opp: 6 }], 'my games first');
  assert.equal(r.won, false);

  const mine = await api.results.listMine();
  assert.ok(!mine.some((x) => x.id === 'r-mikko-vahvista'), 'pending results of others stay out of my history');
  const joonas = mine.find((x) => x.id === 'r-joonas');
  assert.equal(joonas.isMine, false);
  assert.equal(joonas.confirmation, 'confirmed');
  assert.equal(joonas.won, true);
  assert.deepEqual(mine.filter((x) => x.isMine && x.confirmation).map((x) => x.confirmation).sort(), ['confirmed', 'confirmed', 'disputed']);
  assert.ok(mine.filter((x) => x.isMine && x.confirmation).every((x) => x.opponent?.id && x.answeredBy?.id === x.opponent.id));
});

test('confirm: the result joins my history and my activity, and nothing waits anymore', async () => {
  await api.results.confirm('r-mikko-vahvista');
  assert.deepEqual(await api.results.listToConfirm(), []);
  const r = (await api.results.listMine()).find((x) => x.id === 'r-mikko-vahvista');
  assert.equal(r.confirmation, 'confirmed');
  assert.equal(r.answeredBy.id, ME);
  const activity = await api.stats.myActivity();
  assert.ok(activity.results.some((x) => x.id === 'r-mikko-vahvista' && !x.isMine));
  assert.ok(ratedMatches(activity).some((m) => m.id === 'r-mikko-vahvista' && m.winner === 'b'));
});

test('dispute: stays out of my history; I can change my mind', async () => {
  await api.results.dispute('r-mikko-vahvista');
  assert.deepEqual(await api.results.listToConfirm(), []);
  assert.ok(!(await api.results.listMine()).some((x) => x.id === 'r-mikko-vahvista'));
  assert.equal(db.results.get('r-mikko-vahvista').disputedBy, ME);
  await api.results.confirm('r-mikko-vahvista');
  const row = db.results.get('r-mikko-vahvista');
  assert.equal(row.confirmation, 'confirmed');
  assert.equal(row.disputedBy, null);
});

test('only the other side answers', async () => {
  const own = (await api.results.listMine()).find((x) => x.isMine);
  await rejectsWith(api.results.confirm(own.id), /Vain tuloksen vastustaja/);
  await rejectsWith(api.results.dispute('nope'), /Vain tuloksen vastustaja/);
});

test('save with a Krossi opponent: pending, the opponent is asked and confirms a moment later', async () => {
  const saved = await api.results.save(null, input());
  assert.equal(saved.confirmation, 'pending');
  let r = (await api.results.listMine()).find((x) => x.id === saved.id);
  assert.equal(r.isMine, true);
  assert.equal(r.opponent.id, MIKKO);
  assert.equal(r.confirmation, 'pending');
  await sleep(30); // the demo's 4–7 s answer, scaled down
  r = (await api.results.listMine()).find((x) => x.id === saved.id);
  assert.equal(r.confirmation, 'confirmed');
  assert.equal(r.answeredBy.id, MIKKO);
});

test('typed names only: nothing to confirm, as before', async () => {
  const saved = await api.results.save(null, input({ opponentId: null, opponentName: 'Naapurin Pekka' }));
  assert.equal(saved.confirmation, null);
  const r = (await api.results.listMine()).find((x) => x.id === saved.id);
  assert.equal(r.opponent, null);
  assert.equal(r.opponentName, 'Naapurin Pekka');
});

test('editing: a new score asks again, a new name does not', async () => {
  const { id } = await api.results.save(null, input());
  await sleep(30);
  assert.equal(db.results.get(id).confirmation, 'confirmed');
  await api.results.save(id, input({ opponentName: 'Mikko V.' }));
  assert.equal(db.results.get(id).confirmation, 'confirmed', 'a name is not the result');
  const after = await api.results.save(id, input({ sets: [{ my: 6, opp: 3 }, { my: 7, opp: 6 }] }));
  assert.equal(after.confirmation, 'pending');
  assert.equal(db.results.get(id).confirmedBy, null);
  // Unlinking leaves nothing to confirm.
  assert.equal((await api.results.save(id, input({ opponentId: null }))).confirmation, null);
});

test('validation: not myself, not twice, only real players', async () => {
  await rejectsWith(api.results.save(null, input({ opponentId: ME })), /itseäsi/);
  await rejectsWith(api.results.save(null, input({ format: 'doubles', opponentId: MIKKO, oppPartnerId: MIKKO })), /kahdesti/);
  await rejectsWith(api.results.save(null, input({ opponentId: 'p-nobody' })), /Pelaajaa ei löytynyt/);
  // Singles drop partner ids silently, like the database check would refuse them.
  const { id } = await api.results.save(null, input({ partnerId: EMILIA }));
  assert.equal(db.results.get(id).partnerId, null);
});

test('others\' results are read-only for me', async () => {
  await api.results.save('r-joonas', input());
  assert.equal(db.results.get('r-joonas').createdBy, 'p-joonas');
  assert.equal(db.results.get('r-joonas').gameType, 'tiebreak');
  await api.results.remove('r-joonas');
  assert.ok(db.results.has('r-joonas'));
});

test('candidates: pelikaverit and the players of my city', async () => {
  const { partners, players } = await api.results.candidates({ city: 'Lahti' });
  assert.ok(partners.length > 3 && partners.every((p) => p.player?.id && p.gamesTogether > 0));
  assert.ok(players.length > 3 && players.every((p) => p.id !== ME && p.areas.includes('Lahti')));
});
