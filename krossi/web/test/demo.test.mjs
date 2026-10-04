// The in-memory demo backend (krossi.app/demo) must return exactly the contract shapes the
// Supabase backend returns, behave consistently when mutated, fail with the same error codes
// and feel alive (replies arrive through the realtime subscription).
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { ApiError } from '../src/api/errors.js';
import { INDOOR_VENUES } from '../src/lib/constants.js';
import { weekStreak } from '../src/features/gamification.js';
import { configureTiming } from '../src/api/demo/runtime.js';
import { resetStore } from '../src/api/demo/store.js';
import { backend as api } from '../src/api/demo/index.js';

// No fake latency; scheduled replies/joins run 1000x faster (a 2–4 s reply takes 2–4 ms).
configureTiming({ latencyMin: 0, latencyMax: 0, autoScale: 0.001 });

beforeEach(() => resetStore());

const ME = 'demo-user';

// ── Expected shapes (api/contract.js) ────────────────────────────────────────

const PERSON_KEYS = ['id', 'name', 'avatarUrl', 'avatarColor', 'ageRange', 'skillLevel'];
const GAME_KEYS = [
  'id', 'kind', 'status', 'outcome', 'creator', 'participants', 'capacity', 'spotsLeft', 'matchType',
  'locationName', 'locationType', 'courtSurface', 'city', 'lat', 'lng', 'scheduledAt', 'expiresAt', 'title',
  'description', 'minSkillLevel', 'courtPrice', 'creatorCoversFull', 'maxPlayers', 'createdAt', 'isMine',
  'iJoined', 'onWaitlist', 'waitlistCount', 'conversationId',
];
const CONVERSATION_KEYS = ['id', 'isGroup', 'title', 'participants', 'lastMessage', 'updatedAt', 'unread', 'gameId'];
const MESSAGE_KEYS = ['id', 'conversationId', 'senderId', 'sender', 'kind', 'text', 'imageUrl', 'createdAt', 'meta'];
const RESULT_KEYS = ['id', 'createdAt', 'gameType', 'format', 'partnerName', 'opponentName', 'oppPartnerName', 'sets', 'won'];
const ACTIVITY_GAME_KEYS = ['id', 'playedAt', 'matchType', 'kind', 'locationName', 'locationType', 'city', 'isOrganizer', 'people'];
const LEAGUE_MATCH_KEYS = ['id', 'playedAt', 'won', 'opponent', 'sets', 'leagueId'];
const LEAGUE_SUMMARY_KEYS = ['id', 'city', 'skillLevel', 'seasonLabel', 'groupSize', 'status', 'memberCount', 'createdBy', 'iAmMember'];
const PROFILE_KEYS = [
  'id', 'name', 'ageRange', 'gender', 'city', 'areas', 'bio', 'avatarUrl', 'avatarColor', 'skillLevel',
  'competitionClasses', 'playStyles', 'availability', 'handedness', 'backhand', 'playingThisWeek',
  'playingNowUntil', 'playingNowNote', 'hiddenFromFeed', 'paidAt', 'createdAt',
];

const sortedKeys = (obj) => Object.keys(obj).sort();
function assertKeys(obj, keys, what) {
  assert.ok(obj && typeof obj === 'object', `${what} is an object`);
  assert.deepEqual(sortedKeys(obj), [...keys].sort(), `${what} has exactly the contract keys`);
}
const isIso = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && value.includes('T');

function assertPerson(person, what) {
  assertKeys(person, PERSON_KEYS, what);
  assert.equal(typeof person.id, 'string');
  assert.ok(person.name.length > 0);
  assert.ok(['blue', 'yellow', 'red', 'green'].includes(person.avatarColor));
}

function assertGame(game, what = `game ${game?.id}`) {
  assertKeys(game, GAME_KEYS, what);
  assertPerson(game.creator, `${what}.creator`);
  game.participants.forEach((p, i) => assertPerson(p, `${what}.participants[${i}]`));
  assert.ok(['open', 'event'].includes(game.kind));
  assert.ok(['open', 'filled', 'cancelled'].includes(game.status));
  assert.ok([null, 'played', 'not_played'].includes(game.outcome));
  assert.equal(game.spotsLeft, Math.max(0, game.capacity - game.participants.length));
  assert.ok(game.scheduledAt === null || isIso(game.scheduledAt));
  assert.ok(isIso(game.createdAt));
  for (const flag of ['isMine', 'iJoined', 'onWaitlist', 'creatorCoversFull']) assert.equal(typeof game[flag], 'boolean');
  assert.equal(typeof game.waitlistCount, 'number');
  assert.ok(!game.participants.some((p) => p.id === game.creator.id), 'participants exclude the creator');
}

function assertMessage(message, what) {
  assertKeys(message, MESSAGE_KEYS, what);
  assertPerson(message.sender, `${what}.sender`);
  assert.equal(message.sender.id, message.senderId);
  assert.ok(['text', 'thumbs', 'image', 'join'].includes(message.kind));
  assert.ok(isIso(message.createdAt));
}

async function expectApiError(promise, code, what) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof ApiError, `${what}: ApiError, got ${err}`);
    assert.equal(typeof err.userMessage, 'string');
    assert.ok(err.userMessage.length > 0);
    if (code !== undefined) assert.equal(err.code, code, `${what}: code`);
    return true;
  });
}

/** Resolves with the first value `predicate` accepts, from a callback-style subscription. */
function waitFor(subscribe, predicate, ms = 2000) {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const guard = setTimeout(() => { unsubscribe(); reject(new Error('timed out waiting for the demo')); }, ms);
    unsubscribe = subscribe((value) => {
      if (!predicate(value)) return;
      clearTimeout(guard);
      unsubscribe();
      resolve(value);
    });
  });
}

/** Polls `check` (async, truthy = done) until it passes; scheduled demo activity is timer-based. */
async function eventually(check, what, ms = 2000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// ── Session ──────────────────────────────────────────────────────────────────

test('demo visitor is signed in as the paid, non-admin player Alex', async () => {
  assert.deepEqual(await api.auth.getSession(), { user: { id: ME, email: 'demo@krossi.app' } });
  const unsubscribe = api.auth.onChange(() => {});
  assert.equal(typeof unsubscribe, 'function', 'onChange returns the unsubscribe function directly');
  unsubscribe();

  const me = await api.profile.getMine(ME);
  assertKeys(me, PROFILE_KEYS, 'profile');
  assert.equal(me.name, 'Alex');
  assert.equal(me.city, 'Lahti');
  assert.equal(me.skillLevel, 'keskitaso');
  assert.ok(me.paidAt, 'paid');
  assert.equal(await api.profile.isAdmin(), false);
  assert.deepEqual(await api.profile.myEventCities(), []);
  assert.deepEqual(await api.auth.signUp('x@example.com', 'salasana123'), { needsConfirmation: false });
  assert.equal(await api.invites.myCode(), 'DEMO24');
  assert.deepEqual(await api.invites.resolve(' demo24 '), { inviterName: 'Alex' });
  assert.equal(await api.invites.resolve('NOPE00'), null);
});

// ── Shapes and the "alive" first load ────────────────────────────────────────

test('games.listOpen: contract shape, sorted, upcoming Lahti games at real indoor venues', async () => {
  const games = await api.games.listOpen();
  games.forEach((g) => assertGame(g));
  const now = Date.now();
  for (const g of games) {
    assert.ok(['open', 'filled'].includes(g.status));
    assert.ok(!g.expiresAt || Date.parse(g.expiresAt) > now, `${g.id} not expired`);
  }
  // Soonest first, "aika avoin" (no time) last.
  const scheduled = games.filter((g) => g.scheduledAt);
  assert.deepEqual(scheduled.map((g) => g.scheduledAt), [...scheduled.map((g) => g.scheduledAt)].sort());
  assert.ok(games.findIndex((g) => !g.scheduledAt) >= scheduled.length);

  const lahti = scheduled.filter((g) => g.city === 'Lahti');
  assert.ok(lahti.length >= 8, 'plenty of games in Lahti');
  assert.ok(lahti.every((g) => Date.parse(g.scheduledAt) < now + 11 * 86_400_000), 'within ~10 days');
  const venues = new Map(INDOOR_VENUES.map((v) => [v.name, v]));
  const indoor = games.filter((g) => g.locationType === 'sisätennis');
  assert.ok(indoor.length >= 6);
  for (const g of indoor) {
    const venue = venues.get(g.locationName);
    assert.ok(venue, `${g.locationName} is a real indoor venue`);
    assert.equal(g.lat, venue.lat);
    assert.equal(g.lng, venue.lng);
  }
  assert.equal(games.filter((g) => g.kind === 'event').length, 1, 'one event');
  assert.ok(games.some((g) => g.status === 'open' && g.spotsLeft > 0 && !g.isMine && !g.iJoined), 'something to join');
});

test('games.listMine / get / pendingOutcomes / listInvites', async () => {
  const mine = await api.games.listMine();
  assert.deepEqual(sortedKeys(mine), ['past', 'upcoming']);
  [...mine.upcoming, ...mine.past].forEach((g) => assertGame(g));
  assert.equal(mine.upcoming.length, 2, 'two upcoming games of Alex');
  assert.ok(mine.upcoming.every((g) => g.isMine || g.iJoined));
  assert.ok(mine.past.length >= 30, '~30 played games of history');
  assert.ok(mine.past.filter((g) => g.outcome === 'played').length >= 28);

  const first = mine.upcoming[0];
  const again = await api.games.get(first.id);
  assertGame(again);
  assert.deepEqual(again, first);
  assert.equal(await api.games.get('no-such-game'), null);

  // Results are deep copies: mutating one never touches the store.
  again.participants.length = 0;
  again.title = 'muutettu';
  assert.deepEqual(await api.games.get(first.id), first);

  const pending = await api.games.pendingOutcomes();
  assert.equal(pending.length, 1, 'one "Pelasitteko?" game');
  assert.equal(pending[0].outcome, null);
  assert.ok(Date.parse(pending[0].scheduledAt) < Date.now());

  const invites = await api.games.listInvites();
  assert.equal(invites.length, 1);
  assert.deepEqual(sortedKeys(invites[0]), ['game', 'id']);
  assertGame(invites[0].game);

  const preview = await api.games.publicPreview(first.id);
  assert.deepEqual(sortedKeys(preview), [
    'city', 'creatorAvatarColor', 'creatorName', 'id', 'kind', 'locationName', 'locationType', 'matchType',
    'participantCount', 'scheduledAt', 'spotsLeft', 'status', 'title',
  ]);
});

test('messages.listConversations / listMessages / requests: contract shapes', async () => {
  const conversations = await api.messages.listConversations();
  assert.ok(conversations.length >= 4 && conversations.length <= 6);
  for (const c of conversations) {
    assertKeys(c, CONVERSATION_KEYS, `conversation ${c.id}`);
    c.participants.forEach((p, i) => assertPerson(p, `${c.id}.participants[${i}]`));
    assert.ok(c.participants.every((p) => p.id !== ME), 'participants exclude me');
    assert.deepEqual(sortedKeys(c.lastMessage), ['createdAt', 'kind', 'senderId', 'text']);
  }
  const updated = conversations.map((c) => c.updatedAt);
  assert.deepEqual(updated, [...updated].sort().reverse(), 'newest first');
  assert.equal(conversations.filter((c) => c.unread).length, 1, 'one unread conversation');
  assert.ok(conversations.some((c) => c.isGroup && c.gameId && c.participants.length >= 2), 'a game group chat');

  const group = conversations.find((c) => c.isGroup && c.participants.length >= 2);
  const messages = await api.messages.listMessages(group.id);
  messages.forEach((m, i) => assertMessage(m, `message ${i}`));
  const times = messages.map((m) => m.createdAt);
  assert.deepEqual(times, [...times].sort(), 'oldest first');
  const join = messages.find((m) => m.kind === 'join');
  assert.equal(join.meta.__type, 'challenge_join');
  assert.equal(join.meta.challengeId, group.gameId);
  assert.deepEqual(await api.messages.listMessages('not-mine'), []);

  const requests = await api.messages.listRequests();
  assert.equal(requests.length, 2, 'two pending play requests');
  for (const r of requests) {
    assert.deepEqual(sortedKeys(r), ['createdAt', 'from', 'id', 'message']);
    assertPerson(r.from, 'request.from');
  }
  assert.equal(await api.messages.unreadCount(), 3, '1 unread conversation + 2 requests');
});

test('stats.myActivity: contract shape and a rich history', async () => {
  const activity = await api.stats.myActivity();
  assert.deepEqual(sortedKeys(activity), ['games', 'invitesJoined', 'leagueMatches', 'memberSince', 'organizedCount', 'results']);
  for (const g of activity.games) {
    assertKeys(g, ACTIVITY_GAME_KEYS, `activity game ${g.id}`);
    g.people.forEach((p) => assertPerson(p, 'activity person'));
    assert.ok(g.people.every((p) => p.id !== ME));
  }
  for (const r of activity.results) {
    assertKeys(r, RESULT_KEYS, `result ${r.id}`);
    r.sets.forEach((s) => assert.deepEqual(sortedKeys(s), ['my', 'opp']));
  }
  for (const m of activity.leagueMatches) {
    assertKeys(m, LEAGUE_MATCH_KEYS, `league match ${m.id}`);
    assertPerson(m.opponent, 'league opponent');
    m.sets.forEach((s) => assert.deepEqual(sortedKeys(s), ['a', 'b']));
  }

  assert.ok(activity.games.length >= 28, '~30 played games');
  assert.ok(activity.results.length >= 15, '~18 results');
  assert.ok(activity.results.some((r) => r.won) && activity.results.some((r) => !r.won));
  assert.ok(activity.leagueMatches.length >= 2);
  assert.ok(activity.organizedCount >= 5);
  assert.equal(activity.invitesJoined, 2);
  assert.ok(isIso(activity.memberSince));
  assert.ok(new Set(activity.games.map((g) => g.locationName)).size >= 3, 'several venues');
  assert.ok(new Set(activity.games.flatMap((g) => g.people.map((p) => p.id))).size >= 8, 'many partners');
  const spanDays = (Date.parse(activity.games[0].playedAt) - Date.parse(activity.games.at(-1).playedAt)) / 86_400_000;
  assert.ok(spanDays > 200, 'history spans ~9 months');
  assert.ok(weekStreak(activity, new Date()).current >= 3, 'a live weekly streak');

  const partners = await api.players.listPartners();
  assert.ok(partners.length >= 8);
  assert.deepEqual(sortedKeys(partners[0]), ['gamesTogether', 'lastPlayedAt', 'player']);
  assert.ok(partners[0].gamesTogether >= partners[1].gamesTogether);
});

test('leagues: an active league with Alex in group 1 and a signup league', async () => {
  const leagues = await api.leagues.listByCity('Lahti');
  leagues.forEach((l) => assertKeys(l, LEAGUE_SUMMARY_KEYS, `league ${l.id}`));
  assert.ok(leagues.some((l) => l.status === 'signup' && !l.iAmMember));
  const active = leagues.find((l) => l.status === 'active');
  assert.ok(active?.iAmMember);

  const detail = await api.leagues.get(active.id);
  assertKeys(detail, [...LEAGUE_SUMMARY_KEYS, 'members', 'fixtures'], 'league detail');
  for (const m of detail.members) {
    assertKeys(m, [...PERSON_KEYS, 'groupNumber'], 'league member');
  }
  assert.equal(detail.members.find((m) => m.id === ME).groupNumber, 1);
  for (const f of detail.fixtures) {
    assert.deepEqual(sortedKeys(f), ['groupNumber', 'id', 'playerA', 'playerB', 'result']);
    if (f.result) {
      assert.deepEqual(sortedKeys(f.result), ['confirmedAt', 'confirmedBy', 'reportedBy', 'sets', 'winnerId']);
      f.result.sets.forEach((s) => assert.deepEqual(sortedKeys(s), ['a', 'b']));
    }
  }
  const mine = detail.fixtures.filter((f) => f.playerA.id === ME || f.playerB.id === ME);
  const unconfirmed = mine.filter((f) => f.result && !f.result.confirmedBy);
  assert.ok(unconfirmed.some((f) => f.result.reportedBy !== ME), 'a result waits for Alex to confirm');
  assert.ok(unconfirmed.some((f) => f.result.reportedBy === ME), 'a result waits for the opponent');

  // Confirming the opponent's report makes it a league match in the activity.
  const toConfirm = unconfirmed.find((f) => f.result.reportedBy !== ME);
  const before = (await api.stats.myActivity()).leagueMatches.length;
  await api.leagues.confirmResult(toConfirm.id);
  assert.equal((await api.stats.myActivity()).leagueMatches.length, before + 1);
  assert.equal(await api.leagues.get('no-such-league'), null);
});

test('players: the Lahti feed shows who is playing now and this week first', async () => {
  const players = await api.players.list({ city: 'Lahti' });
  assert.ok(players.length >= 10);
  players.forEach((p) => assertKeys(p, PROFILE_KEYS, `player ${p.id}`));
  assert.ok(players.every((p) => p.id !== ME && p.areas.includes('Lahti')));
  assert.ok(players[0].playingNowUntil && Date.parse(players[0].playingNowUntil) > Date.now(), 'a "playing now" player first');
  assert.ok(players.filter((p) => p.playingThisWeek).length >= 2);
  assert.deepEqual(await api.players.get(players[0].id), players[0]);
});

// ── Mutations ────────────────────────────────────────────────────────────────

test('games.join marks iJoined, can fill a game and opens its group chat with a join message', async () => {
  const open = await api.games.listOpen();
  const single = open.find((g) => g.status === 'open' && g.capacity === 1 && g.spotsLeft === 1 && !g.isMine && !g.iJoined && !g.minSkillLevel);
  assert.ok(single, 'a joinable singles game');

  const conversationId = await api.games.join(single.id);
  assert.equal(typeof conversationId, 'string');
  const joined = await api.games.get(single.id);
  assert.equal(joined.iJoined, true);
  assert.equal(joined.status, 'filled', 'the last spot fills the game');
  assert.equal(joined.spotsLeft, 0);
  assert.equal(joined.conversationId, conversationId);
  assert.ok(joined.participants.some((p) => p.id === ME));

  const messages = await api.messages.listMessages(conversationId);
  const last = messages.at(-1);
  assert.equal(last.kind, 'join');
  assert.equal(last.meta.joinerId, ME);
  assert.equal(last.meta.joinerName, 'Alex');
  const conversation = await api.messages.getConversation(conversationId);
  assert.equal(conversation.isGroup, true);
  assert.equal(conversation.gameId, single.id);

  // Joining twice is idempotent and returns the same chat.
  assert.equal(await api.games.join(single.id), conversationId);
  assert.equal((await api.messages.listMessages(conversationId)).length, messages.length);

  // The creator welcomes Alex shortly after.
  await eventually(async () => (await api.messages.listMessages(conversationId))
    .some((m) => m.senderId === single.creator.id && m.kind === 'text'), 'creator says hi');

  // Leaving reopens it.
  await api.games.leave(single.id);
  const left = await api.games.get(single.id);
  assert.equal(left.iJoined, false);
  assert.equal(left.status, 'open');
});

test('waitlist, invites and outcomes stay consistent', async () => {
  const full = (await api.games.listOpen()).find((g) => g.status === 'filled' && !g.isMine && !g.iJoined);
  await api.games.joinWaitlist(full.id);
  let game = await api.games.get(full.id);
  assert.equal(game.onWaitlist, true);
  await api.games.leaveWaitlist(full.id);
  game = await api.games.get(full.id);
  assert.equal(game.onWaitlist, false);

  const [invite] = await api.games.listInvites();
  const conversationId = await api.games.respondInvite(invite.id, true);
  assert.equal(typeof conversationId, 'string');
  assert.equal((await api.games.get(invite.game.id)).iJoined, true);
  assert.deepEqual(await api.games.listInvites(), []);

  const [pending] = await api.games.pendingOutcomes();
  await api.games.recordOutcome(pending.id, 'played');
  assert.deepEqual(await api.games.pendingOutcomes(), []);
  assert.equal((await api.games.get(pending.id)).outcome, 'played');
});

test('games.create inserts a game owned by Alex and a local player joins it', async () => {
  const at = new Date(Date.now() + 2 * 86_400_000);
  at.setHours(18, 0, 0, 0);
  const venue = INDOOR_VENUES.find((v) => v.name === 'Kispi Areena');
  const id = await api.games.create({
    kind: 'open', matchType: 'kaksinpeli', locationType: 'sisätennis', locationName: venue.name, city: 'Lahti',
    lat: venue.lat, lng: venue.lng, scheduledAt: at.toISOString(), title: null, description: ' Matsi? ',
    courtSurface: 'kova', minSkillLevel: null, courtPrice: 28, creatorCoversFull: false, maxPlayers: null,
  });
  const game = await api.games.get(id);
  assertGame(game);
  assert.equal(game.isMine, true);
  assert.equal(game.creator.id, ME);
  assert.equal(game.description, 'Matsi?');
  assert.equal(game.status, 'open');
  assert.ok((await api.games.listMine()).upcoming.some((g) => g.id === id));
  assert.ok((await api.games.listOpen()).some((g) => g.id === id));

  // A local player grabs the spot (6–9 s in the browser, scaled down here).
  const filled = await eventually(async () => {
    const g = await api.games.get(id);
    return g.participants.length > 0 && g;
  }, 'someone joins the new game');
  assert.equal(filled.participants.length, 1);
  assert.equal(filled.status, 'filled');
  assert.ok(filled.conversationId, 'the game chat exists');

  await expectApiError(api.games.create({ kind: 'open', matchType: 'kaksinpeli', locationType: 'sisätennis', city: 'Tukholma', locationName: '' }), 'invalid', 'city outside the allowed list');
  await expectApiError(api.games.create({ kind: 'event', matchType: 'nelinpeli', locationType: 'sisätennis', city: 'Lahti', title: 'Ilta', maxPlayers: 8 }), 'forbidden', 'non-admin event');
});

test('a sent 1:1 message gets a friendly auto-reply through subscribe()', async () => {
  const conversation = (await api.messages.listConversations()).find((c) => !c.isGroup && c.participants.length === 1);
  const other = conversation.participants[0].id;

  const received = [];
  const reply = waitFor(
    (cb) => api.messages.subscribe(conversation.id, (m) => { received.push(m); cb(m); }),
    (m) => m.senderId === other,
  );
  const inboxPing = waitFor((cb) => api.messages.subscribeInbox(() => cb(true)), () => true);

  const sent = await api.messages.send(conversation.id, '  Pelataanko huomenna?  ');
  assertMessage(sent, 'sent message');
  assert.equal(sent.text, 'Pelataanko huomenna?');
  assert.equal(sent.senderId, ME);

  const answer = await reply;
  assertMessage(answer, 'auto-reply');
  assert.equal(answer.kind, 'text');
  assert.ok(answer.text.length > 0);
  assert.ok(received.some((m) => m.id === sent.id), 'own message is pushed too, like Supabase realtime');
  assert.equal(await inboxPing, true);

  const list = await api.messages.listMessages(conversation.id);
  assert.equal(list.at(-1).id, answer.id);
  assert.equal((await api.messages.getConversation(conversation.id)).unread, true);
  await api.messages.markRead(conversation.id);
  assert.equal((await api.messages.getConversation(conversation.id)).unread, false);

  const thumbs = await api.messages.sendThumbs(conversation.id);
  assert.equal(thumbs.kind, 'thumbs');
  const image = await api.messages.sendImage(conversation.id, new Blob(['jpeg'], { type: 'image/jpeg' }));
  assert.equal(image.kind, 'image');
  assert.ok(image.imageUrl, 'shown from an object URL (or a placeholder where there is none)');
  await expectApiError(api.messages.sendImage(conversation.id, new Blob(['%PDF'], { type: 'application/pdf' })), null, 'not an image');
});

test('play requests: accept opens a chat, sending one gets an answer', async () => {
  const [request] = await api.messages.listRequests();
  const conversationId = await api.messages.acceptRequest(request.id);
  const messages = await api.messages.listMessages(conversationId);
  assert.equal(messages.at(-1).text, request.message);
  assert.equal(messages.at(-1).senderId, request.from.id);
  assert.equal((await api.messages.listRequests()).length, 1);
  await expectApiError(api.messages.acceptRequest(request.id), null, 'accepting twice');

  const target = (await api.players.list({ city: 'Lahti' })).find((p) => p.name === 'Laura');
  await api.players.sendPlayRequest(target.id, 'Moi! Pelataanko?');
  // They accept: a 1:1 chat opens with Alex's request and their answer.
  const lines = await eventually(async () => {
    const chat = (await api.messages.listConversations()).find((c) => !c.isGroup && c.participants[0].id === target.id);
    const list = chat ? await api.messages.listMessages(chat.id) : [];
    const asked = list.findIndex((m) => m.senderId === ME && m.text === 'Moi! Pelataanko?');
    return asked >= 0 && list.slice(asked + 1).some((m) => m.senderId === target.id) && list;
  }, 'the play request is answered');
  assert.equal(lines.at(-1).senderId, target.id);
});

// ── Errors carry the same codes as production ────────────────────────────────

test('failures throw ApiError with the production codes and messages', async () => {
  const open = await api.games.listOpen();
  const full = open.find((g) => g.status === 'filled' && !g.isMine && !g.iJoined);
  await expectApiError(api.games.join(full.id), 'full', 'joining a full game');
  const err = await api.games.join(full.id).catch((e) => e);
  assert.match(err.userMessage, /täyttyä/);

  const own = open.find((g) => g.isMine);
  await expectApiError(api.games.join(own.id), 'own_game', 'joining own game');
  const cancelled = (await api.games.listMine()).past.find((g) => g.status === 'cancelled');
  await expectApiError(api.games.join(cancelled.id), 'cancelled', 'joining a cancelled game');
  const others = open.find((g) => !g.isMine);
  await expectApiError(api.games.cancel(others.id), 'forbidden', "cancelling someone else's game");
  await expectApiError(api.games.invite(others.id, ['p-mikko']), 'forbidden', "inviting to someone else's game");
  await expectApiError(api.games.respondInvite('no-such-invite', true), 'not_found', 'unknown invite');

  const [conversation] = await api.messages.listConversations();
  await expectApiError(api.messages.send(conversation.id, '   '), 'invalid', 'empty message');
  await expectApiError(api.messages.send(conversation.id, 'x'.repeat(1001)), 'invalid', 'too long message');
  await expectApiError(api.messages.send('not-mine', 'Moi'), 'forbidden', "someone else's chat");

  const [request] = await api.messages.listRequests();
  await expectApiError(api.players.sendPlayRequest(request.from.id, 'Moi'), 'duplicate', 'one pending request per pair');
  await expectApiError(api.results.save(null, { gameType: 'sets', format: 'singles', sets: [{ my: 0, opp: 0 }] }), 'invalid', 'result without sets');
  await expectApiError(api.social.report('p-mikko', '  '), 'invalid', 'report without reason');
  await expectApiError(api.profile.saveMine(ME, { name: ' ', areas: ['Lahti'] }), 'invalid', 'profile without name');

  const league = (await api.leagues.listByCity('Lahti')).find((l) => l.status === 'active');
  const detail = await api.leagues.get(league.id);
  const myReport = detail.fixtures.find((f) => f.result?.reportedBy === ME && !f.result.confirmedBy);
  await assert.rejects(api.leagues.confirmResult(myReport.id), (e) => e instanceof ApiError && e.userMessage === 'Tuloksen vahvistus epäonnistui.');
  await assert.rejects(api.leagues.join(league.id), (e) => e instanceof ApiError && e.userMessage === 'Liigan ilmoittautuminen on päättynyt');
  await expectApiError(api.admin.stats(), null, 'admin stats for a regular player');

  // notifications.emit never throws
  await api.notifications.emit({ type: 'new_message', conversationId: conversation.id, senderId: ME });
});
