// api/supabase/results.js against a fake supabase-js client: what reaches the database, the
// match_result_logged notification, and the behaviour before migration 20261017140000.
import assert from 'node:assert/strict';
import test from 'node:test';
import { setClientForTests } from '../src/api/supabase/client.js';
import { backend } from '../src/api/supabase/index.js';
import { ApiError } from '../src/api/errors.js';

const UID = '11111111-1111-4111-8111-111111111111';
const OPP = '33333333-3333-4333-8333-333333333333';
const RID = '44444444-4444-4444-8444-444444444444';

/** Chainable stand-in for supabase-js; every query resolves to `respond({ target, ops })`. */
function fakeClient(respond) {
  const log = { queries: [], invoked: [] };
  const query = (target, initialOps = []) => {
    const entry = { target, ops: [...initialOps] };
    log.queries.push(entry);
    const proxy = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (resolve, reject) => Promise.resolve(respond(entry) ?? { data: null, error: null }).then(resolve, reject);
        return (...args) => { entry.ops.push([prop, ...args]); return proxy; };
      },
    });
    return proxy;
  };
  return {
    log,
    from: (table) => query(table),
    rpc: (name, args) => query(`rpc:${name}`, [['args', args]]),
    functions: { invoke: async (name, options) => { log.invoked.push({ name, body: options?.body }); return { data: null, error: null }; } },
    auth: { getSession: async () => ({ data: { session: { user: { id: UID, email: 'me@example.com' } } }, error: null }) },
  };
}

const op = (entry, name) => entry.ops.find(([n]) => n === name);
const row = (over = {}) => ({
  id: RID, created_at: '2026-10-17T10:00:00.000Z', created_by: UID, game_type: 'sets', format: 'singles',
  partner_name: null, opponent_name: 'Bea', opp_partner_name: null, partner_id: null, opponent_id: OPP, opp_partner_id: null,
  sets: [{ my: 6, opp: 3 }], won: true, confirmation: 'pending', confirmed_by: null, confirmed_at: null, disputed_by: null, disputed_at: null,
  ...over,
});
const input = (over = {}) => ({
  gameType: 'sets', format: 'singles', partnerName: null, opponentName: 'Bea', oppPartnerName: null,
  opponentId: OPP, sets: [{ my: 6, opp: 3 }], won: true, ...over,
});

test('save: a linked opponent goes to the database and is asked once', async () => {
  const fake = fakeClient(({ target, ops }) => (target === 'match_results' && op({ ops }, 'insert') ? { data: [row()], error: null } : undefined));
  setClientForTests(fake);
  const saved = await backend.results.save(null, input());
  assert.deepEqual(saved, { id: RID, confirmation: 'pending' });
  const insert = op(fake.log.queries.find((q) => op(q, 'insert')), 'insert')[1];
  assert.equal(insert.opponent_id, OPP);
  assert.equal(insert.partner_id, null);
  assert.equal(insert.created_by, UID);
  assert.ok(!('confirmation' in insert), 'the database decides the state');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(fake.log.invoked.map((i) => i.name).sort(), ['krossi-notify', 'send-push-notification']);
  assert.deepEqual(fake.log.invoked[0].body, { type: 'match_result_logged', resultId: RID, creatorId: UID });
});

test('save: an edit that leaves the same question pending asks nobody again', async () => {
  const fake = fakeClient(({ target, ops }) => {
    if (target !== 'match_results') return undefined;
    if (op({ ops }, 'maybeSingle')) return { data: row(), error: null };
    if (op({ ops }, 'update')) return { data: [row({ opponent_name: 'Bea B.' })], error: null };
    return undefined;
  });
  setClientForTests(fake);
  await backend.results.save(RID, input({ opponentName: 'Bea B.' }));
  assert.equal(fake.log.invoked.length, 0);
  const update = fake.log.queries.find((q) => op(q, 'update'));
  assert.deepEqual(update.ops.filter(([n]) => n === 'eq').map(([, c, v]) => [c, v]), [['id', RID], ['created_by', UID]]);
});

test('save: before the migration it keeps saving typed names, and asks nobody', async () => {
  let attempt = 0;
  const fake = fakeClient(({ target, ops }) => {
    if (target !== 'match_results' || !op({ ops }, 'insert')) return undefined;
    attempt += 1;
    return attempt === 1
      ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'opp_partner_id' column of 'match_results' in the schema cache" } }
      : { data: [{ id: RID, created_by: UID, sets: [{ my: 6, opp: 3 }], won: true }], error: null };
  });
  setClientForTests(fake);
  const saved = await backend.results.save(null, input());
  assert.deepEqual(saved, { id: RID, confirmation: null });
  const second = op(fake.log.queries.filter((q) => op(q, 'insert'))[1], 'insert')[1];
  assert.ok(!('opponent_id' in second) && !('partner_id' in second) && !('opp_partner_id' in second));
  assert.equal(second.opponent_name, 'Bea');
  assert.equal(fake.log.invoked.length, 0);
});

test('save: refuses myself and malformed ids before touching the network', async () => {
  const fake = fakeClient(() => undefined);
  setClientForTests(fake);
  await assert.rejects(backend.results.save(null, input({ opponentId: UID })), (e) => e instanceof ApiError && e.code === 'invalid');
  await assert.rejects(backend.results.save(null, input({ opponentId: 'p-mikko' })), (e) => e instanceof ApiError && e.code === 'invalid');
  assert.equal(fake.log.queries.length, 0);
});

test('listToConfirm: pending rows where I am on the other side, from my side, with the logger', async () => {
  const fake = fakeClient(({ target }) => {
    if (target === 'rpc:krossi_linked_match_results') {
      const creator = { id: OPP, name: 'Bea Bee', avatar_url: null, avatar_color: 'red' };
      return {
        data: [
          { ...row({ created_by: OPP, opponent_id: UID, opponent_name: 'Minä' }), creator },
          { ...row({ id: '55555555-5555-4555-8555-555555555555', created_by: OPP, opponent_id: UID, confirmation: 'confirmed' }), creator },
          { ...row({ id: '66666666-6666-4666-8666-666666666666', created_by: OPP, format: 'doubles', partner_id: UID, opponent_id: null }), creator },
        ],
        error: null,
      };
    }
    if (target === 'profiles') return { data: [], error: null };
    return undefined;
  });
  setClientForTests(fake);
  const list = await backend.results.listToConfirm();
  assert.equal(list.length, 1, 'confirmed rows and my own side (partner) are not questions to me');
  assert.equal(list[0].loggedBy.name, 'Bea Bee');
  assert.equal(list[0].isMine, false);
  assert.deepEqual(list[0].sets, [{ my: 3, opp: 6 }]);
  assert.equal(list[0].won, false);
});

test('listMine: my rows plus confirmed ones others logged with me; nothing breaks before the migration', async () => {
  const fake = fakeClient(({ target }) => {
    if (target === 'match_results') return { data: [row({ created_at: '2026-10-10T10:00:00.000Z', opponent_id: null, confirmation: null })], error: null };
    if (target === 'rpc:krossi_linked_match_results') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    return undefined;
  });
  setClientForTests(fake);
  const mine = await backend.results.listMine();
  assert.equal(mine.length, 1);
  assert.equal(mine[0].isMine, true);
  assert.equal(mine[0].confirmation, null);
  assert.deepEqual(await backend.results.listToConfirm(), []);
  const own = fake.log.queries.find((q) => q.target === 'match_results');
  assert.deepEqual(op(own, 'eq'), ['eq', 'created_by', UID], 'match_results is readable by everyone: always filter by me');
});

test('confirm / dispute call the answer RPC; a bad id never reaches it', async () => {
  const fake = fakeClient(() => ({ data: 'confirmed', error: null }));
  setClientForTests(fake);
  await backend.results.confirm(RID);
  await backend.results.dispute(RID);
  assert.deepEqual(fake.log.queries.map((q) => [q.target, op(q, 'args')[1]]), [
    ['rpc:krossi_answer_match_result', { result_id_input: RID, confirm_input: true }],
    ['rpc:krossi_answer_match_result', { result_id_input: RID, confirm_input: false }],
  ]);
  await assert.rejects(backend.results.confirm('x'), (e) => e instanceof ApiError && e.code === 'not_found');
  assert.equal(fake.log.queries.length, 2);
});

test('confirm: the database\'s own Finnish refusal reaches the player', async () => {
  setClientForTests(fakeClient(() => ({ data: null, error: { code: '42501', message: 'Vain tuloksen vastustaja voi vastata tähän tulokseen' } })));
  await assert.rejects(backend.results.confirm(RID), (e) => e instanceof ApiError && e.userMessage === 'Vain tuloksen vastustaja voi vastata tähän tulokseen');
});
