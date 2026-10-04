// Behaviour of the real backend against a fake supabase-js client: notifications fan-out,
// graceful handling of not-yet-deployed schema, and the RLS edge cases screens rely on.
import assert from 'node:assert/strict';
import test from 'node:test';
import { setClientForTests } from '../src/api/supabase/client.js';
import { backend } from '../src/api/supabase/index.js';
import { ApiError } from '../src/api/errors.js';

const UID = '11111111-1111-4111-8111-111111111111';
const GAME = '22222222-2222-4222-8222-222222222222';

/**
 * Chainable stand-in for supabase-js. Every query records its operations and resolves to
 * whatever `respond({ target, ops })` returns ({ data, error, count }).
 */
function fakeClient(respond, { failingFunctions = [] } = {}) {
  const log = { queries: [], invoked: [] };
  const query = (target, initialOps = []) => {
    const ops = [...initialOps];
    const entry = { target, ops };
    log.queries.push(entry);
    const proxy = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') {
          return (resolve, reject) => Promise.resolve(respond(entry) ?? { data: null, error: null }).then(resolve, reject);
        }
        return (...args) => {
          ops.push([prop, ...args]);
          return proxy;
        };
      },
    });
    return proxy;
  };
  return {
    log,
    from: (table) => query(table),
    rpc: (name, args) => query(`rpc:${name}`, [['args', args]]),
    functions: {
      invoke: async (name, options) => {
        log.invoked.push({ name, body: options?.body });
        return { data: null, error: failingFunctions.includes(name) ? new Error('not deployed') : null };
      },
    },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: UID, email: 'me@example.com' } } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    channel: () => {
      const channel = { on: () => channel, subscribe: () => channel };
      return channel;
    },
    removeChannel: () => {},
  };
}

const op = (entry, name) => entry.ops.find(([n]) => n === name);
const quietly = async (fn) => {
  const warn = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = warn; }
};

test('notifications.emit calls push and email with the same body and never throws', async () => {
  const fake = fakeClient(() => ({ data: null, error: null }), { failingFunctions: ['krossi-notify'] });
  setClientForTests(fake);
  const event = { type: 'play_request', senderId: UID, receiverId: 'x' };
  await quietly(() => backend.notifications.emit(event));
  assert.deepEqual(fake.log.invoked.map((i) => i.name).sort(), ['krossi-notify', 'send-push-notification']);
  assert.ok(fake.log.invoked.every((i) => i.body === event));
});

test('games.cancel refuses when RLS updated nothing, and emits only on success', async () => {
  const fake = fakeClient(({ target }) => (target === 'challenges' ? { data: [], error: null } : undefined));
  setClientForTests(fake);
  await assert.rejects(backend.games.cancel(GAME), (err) => err instanceof ApiError && err.code === 'forbidden');
  assert.equal(fake.log.invoked.length, 0);
});

test('games.create builds the legacy payload and announces the game', async () => {
  const fake = fakeClient(({ target }) => (target === 'challenges' ? { data: { id: GAME }, error: null } : undefined));
  setClientForTests(fake);
  const id = await quietly(() => backend.games.create({
    kind: 'open', matchType: 'kaksinpeli', locationType: 'sisätennis', locationName: '', city: 'Lahti',
    lat: 61, lng: null, scheduledAt: '2026-10-03T16:00:00.000Z', title: ' ', description: null,
    courtSurface: null, minSkillLevel: 'keskitaso', courtPrice: null, creatorCoversFull: false, maxPlayers: 8,
  }));
  assert.equal(id, GAME);
  const [, row] = op(fake.log.queries.find((q) => q.target === 'challenges'), 'insert');
  assert.equal(row.location, 'Avoin');
  assert.equal(row.expires_at, '2026-10-03T19:00:00.000Z');
  assert.equal(row.title, null);
  assert.equal(row.min_skill_level, 'keskitaso');
  assert.ok(!('latitude' in row), 'coordinates only when both are set');
  assert.ok(!('max_players' in row), 'max_players only for events');
  assert.deepEqual(fake.log.invoked[0].body, { type: 'new_area_challenge', challengeId: GAME, creatorId: UID, area: 'Lahti' });
});

test('games.create maps an RLS refusal to the paywall', async () => {
  const fake = fakeClient(({ target }) => target === 'challenges'
    ? { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "challenges"' } }
    : undefined);
  setClientForTests(fake);
  await assert.rejects(
    backend.games.create({ kind: 'open', matchType: 'kaksinpeli', locationType: 'sisätennis', locationName: 'X', city: 'Lahti' }),
    (err) => err.code === 'payment_required',
  );
});

test('notifications.getPrefs works before email_enabled exists', async () => {
  const fake = fakeClient(({ target, ops }) => {
    if (target !== 'notification_preferences') return undefined;
    const [, columns] = op({ ops }, 'select');
    if (columns.includes('email_enabled')) return { data: null, error: { code: '42703', message: 'column notification_preferences.email_enabled does not exist' } };
    return { data: { messages_enabled: false }, error: null };
  });
  setClientForTests(fake);
  const prefs = await backend.notifications.getPrefs();
  assert.equal(prefs.emailEnabled, true);
  assert.equal(prefs.messages, false);
  assert.equal(prefs.playRequests, true);
});

test('notifications.savePrefs never writes push_enabled', async () => {
  const fake = fakeClient(() => ({ data: null, error: null }));
  setClientForTests(fake);
  await backend.notifications.savePrefs({ emailEnabled: false, playRequests: true, messages: true, areaGames: false, gameJoins: true, gameInvites: true, playingNow: true });
  const [, row] = op(fake.log.queries.find((q) => q.target === 'notification_preferences'), 'upsert');
  assert.equal(row.email_enabled, false);
  assert.equal(row.area_challenges_enabled, false);
  assert.ok(!('push_enabled' in row));
});

test('invite RPCs that are not deployed yet degrade instead of throwing', async () => {
  const missing = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.krossi_resolve_invite(code_input) in the schema cache' } };
  setClientForTests(fakeClient(({ target }) => (target.startsWith('rpc:') ? missing : undefined)));
  await quietly(async () => {
    assert.equal(await backend.invites.resolve('ABC234'), null);
    await backend.invites.claim('ABC234');
    assert.equal(await backend.games.publicPreview(GAME), null);
    assert.equal((await backend.stats.myActivity()).invitesJoined, 0);
  });
});

test('players.list keeps people hidden by RLS out and puts "pelaan nyt" first', async () => {
  const future = new Date(Date.now() + 3600e3).toISOString();
  const rows = [
    { id: 'a', name: 'A', area: 'Lahti', playing_this_week: true, updated_at: '2026-10-02' },
    { id: 'b', name: 'B', area: 'Lahti, Turku', playing_now_until: future, updated_at: '2026-09-01' },
    { id: 'c', name: 'C', area: 'Lahtinen', updated_at: '2026-10-01' },
    { id: 'blocked', name: 'D', area: 'Lahti', updated_at: '2026-10-01' },
  ];
  setClientForTests(fakeClient(({ target }) => {
    if (target === 'profiles') return { data: rows, error: null };
    if (target === 'blocked_profiles') return { data: [{ blocked_id: 'blocked' }], error: null };
    return undefined;
  }));
  const players = await backend.players.list({ city: 'Lahti' });
  assert.deepEqual(players.map((p) => p.id), ['b', 'a']);
});

test('messages.subscribe returns an unsubscribe function synchronously', () => {
  setClientForTests(fakeClient(() => undefined));
  const unsubscribe = backend.messages.subscribe(GAME, () => {});
  assert.equal(typeof unsubscribe, 'function');
  unsubscribe();
  const unsubscribeInbox = backend.messages.subscribeInbox(() => {});
  assert.equal(typeof unsubscribeInbox, 'function');
  unsubscribeInbox();
});

test('messages.send rejects empty text before touching the network', async () => {
  const fake = fakeClient(() => undefined);
  setClientForTests(fake);
  await assert.rejects(backend.messages.send(GAME, '   '), (err) => err.code === 'invalid');
  assert.equal(fake.log.queries.length, 0);
});
