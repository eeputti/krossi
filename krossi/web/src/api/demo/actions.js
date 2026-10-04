// actions.js — mutations shared by several domains (posting a message, joining a game,
// opening a 1:1 chat) and the background activity that makes the demo feel inhabited:
// people answer chats, accept invites and play requests, join Alex's new games.

import { SKILL_ORDER } from '../../lib/constants.js';
import { toApiError } from '../errors.js';
import { ME, capacityOf, isExpired, joinMeta } from './rows.js';
import { broadcastInboxChange, broadcastMessage, later, logNotifyEvent, newId } from './runtime.js';
import {
  db, nowIso, me, profileOf, personLite, isBlocked, isMember, visiblePlayers, gameRow,
  conversationRow, messagesOf, gameConversation, directConversation, leagueMembers,
} from './store.js';
import { toMessage } from './views.js';

// ── Errors: same messages and codes the Supabase backend produces ────────────

/**
 * Raw Postgres/RPC error text -> the ApiError toApiError() makes of it in production
 * (`fallback` is the message the Supabase domain function passes to unwrap()).
 */
export const dbError = (raw, fallback) => toApiError(new Error(raw), fallback);
export const forbidden = () => dbError('new row violates row-level security policy');
export const duplicate = () => dbError('duplicate key value violates unique constraint');

export const notify = (event) => logNotifyEvent(event);

// ── Messages & conversations ─────────────────────────────────────────────────

/** createdAt for a new message: now, but strictly after the conversation's last message. */
function nextTimestamp(conversationId) {
  const list = messagesOf(conversationId);
  const last = list[list.length - 1];
  const lastMs = last ? Date.parse(last.createdAt) : 0;
  return new Date(Math.max(Date.now(), lastMs + 1)).toISOString();
}

/** Inserts a message row, bumps the conversation and pushes it to realtime subscribers. */
export function postMessage(conversationId, senderId, { kind = 'text', text = null, imageUrl = null, meta = null }) {
  const conversation = conversationRow(conversationId);
  const row = { id: newId('m'), conversationId, senderId, kind, text, imageUrl, createdAt: nextTimestamp(conversationId), meta };
  messagesOf(conversationId).push(row);
  conversation.updatedAt = row.createdAt;
  if (senderId === ME) conversation.lastReadAt[ME] = row.createdAt;
  broadcastMessage(toMessage(row));
  return row;
}

function createConversation({ gameId = null, participantIds }) {
  const conversation = { id: newId('c'), gameId, participantIds: [...new Set(participantIds)], updatedAt: nowIso(), lastReadAt: {} };
  db.conversations.set(conversation.id, conversation);
  db.messages.set(conversation.id, []);
  broadcastInboxChange();
  return conversation;
}

/** Same hae-tai-luo rule as accept_connection_request / start_league_fixture_conversation. */
export function findOrCreateDirect(userId) {
  return directConversation(userId) || createConversation({ participantIds: [ME, userId] });
}

/** The game's group chat, created on first join; everyone in the game is a participant. */
function ensureGameConversation(game) {
  const ids = [game.creatorId, ...game.participantIds];
  const existing = gameConversation(game.id);
  if (!existing) return createConversation({ gameId: game.id, participantIds: ids });
  for (const id of ids) if (!existing.participantIds.includes(id)) existing.participantIds.push(id);
  return existing;
}

// ── Games ────────────────────────────────────────────────────────────────────

function hasFreeSpot(game) {
  return game.status !== 'cancelled' && !isExpired(game) && game.participantIds.length < capacityOf(game);
}

/**
 * join_challenge for any user: capacity check, 'filled' when the last spot goes, group chat
 * with a 'join' message. Returns the conversation id. Idempotent for someone already in.
 */
export function joinGameAs(game, userId) {
  if (game.status === 'cancelled') throw dbError('Challenge is cancelled');
  if (game.creatorId === userId) throw dbError('Creator cannot join own challenge');
  const already = game.participantIds.includes(userId);
  if (!already && game.participantIds.length >= capacityOf(game)) throw dbError('Challenge is full');

  if (!already) game.participantIds.push(userId);
  game.waitlistIds = game.waitlistIds.filter((id) => id !== userId);
  if (game.status === 'open' && game.participantIds.length >= capacityOf(game)) game.status = 'filled';
  for (const invite of db.gameInvites.values()) {
    if (invite.gameId === game.id && invite.invitedId === userId && invite.status === 'pending') invite.status = 'accepted';
  }

  const conversation = ensureGameConversation(game);
  if (!already) {
    const joiner = personLite(userId);
    postMessage(conversation.id, userId, { kind: 'join', text: `${joiner.name} liittyi peliin!`, meta: joinMeta(game, joiner) });
  }
  return conversation.id;
}

// ── Canned replies ───────────────────────────────────────────────────────────

const REPLIES = {
  question: ['Joo, sopii hyvin! 👍', 'Kuulostaa hyvältä, olen mukana!', 'Tarkistan vielä kalenterin, mutta todennäköisesti joo!'],
  thanks: ['Kiitos itsellesi! Uusiksi pian 🎾', 'Kiitti! Oli tosi kiva pelata.'],
  thumbs: ['💪', 'Jes! 🎾'],
  image: ['Haha, hyvä kuva! 😄', 'Näyttää hyvältä! 🙌'],
  other: ['Sovittu! Nähdään kentällä 🎾', 'Hyvä! Varaan kentän ja laitan vielä viestiä.', 'Jees, kiva! Tuon pallot.',
    'Mahtavaa, odotan jo innolla!', 'Kuulostaa hyvältä 👌'],
};

function nextFrom(pool) {
  db.rotation += 1;
  return pool[db.rotation % pool.length];
}

function cannedReply({ kind, text }) {
  if (kind === 'thumbs' || kind === 'image') return nextFrom(REPLIES[kind]);
  const t = (text || '').toLowerCase();
  if (/kiito|kiitti/.test(t)) return nextFrom(REPLIES.thanks);
  if (t.includes('?')) return nextFrom(REPLIES.question);
  return nextFrom(REPLIES.other);
}

/**
 * Someone in the chat answers 2–4 s later: the other person of a 1:1 chat, or one of the
 * players of a group chat. A burst of messages gets one answer. `text` overrides the
 * canned reply.
 */
export function scheduleReply(conversation, trigger, text = null) {
  const others = conversation.participantIds.filter((id) => id !== ME && !isBlocked(id) && profileOf(id));
  if (others.length === 0) return;
  const pending = db.pendingReplies;
  if (pending.has(conversation.id)) return;
  pending.add(conversation.id);
  const replier = others.length === 1 ? others[0] : nextFrom(others);
  later(2000, 4000, () => {
    pending.delete(conversation.id);
    const current = conversationRow(conversation.id);
    if (!current || !current.participantIds.includes(replier) || isBlocked(replier)) return;
    postMessage(conversation.id, replier, { text: text || cannedReply(trigger || {}) });
  });
}

// ── Other people doing things ────────────────────────────────────────────────

/** After Alex joins a game, its creator says hi in the game chat. */
export function scheduleWelcome(game, conversationId) {
  later(2000, 4000, () => {
    if (!conversationRow(conversationId) || game.status === 'cancelled' || !game.participantIds.includes(ME)) return;
    if (isBlocked(game.creatorId) || !profileOf(game.creatorId)) return;
    const name = me().name;
    postMessage(conversationId, game.creatorId, { text: nextFrom([`Tervetuloa mukaan, ${name}! 🎾`, 'Hienoa, nähdään kentällä!', `Jes ${name}, kiva kun lähdit mukaan!`]) });
  });
}

function joinCandidate(game) {
  const minRank = game.minSkillLevel ? SKILL_ORDER.indexOf(game.minSkillLevel) : 0;
  const invited = new Set([...db.gameInvites.values()].filter((i) => i.gameId === game.id).map((i) => i.invitedId));
  const candidates = visiblePlayers().filter((p) => p.areas.includes(game.city)
    && !isMember(game, p.id) && !game.waitlistIds.includes(p.id) && !invited.has(p.id)
    && SKILL_ORDER.indexOf(p.skillLevel) >= minRank);
  if (candidates.length === 0) return null;
  return nextFrom(candidates);
}

/** A few seconds after Alex publishes a game, a local player grabs a spot. */
export function scheduleSomeoneJoins(gameId) {
  later(6000, 9000, () => {
    const game = gameRow(gameId);
    if (!game || !hasFreeSpot(game)) return;
    const player = joinCandidate(game);
    if (!player) return;
    const conversationId = joinGameAs(game, player.id);
    postMessage(conversationId, player.id, { text: 'Moi! Tulen mielelläni mukaan 🎾' });
  });
}

/** The first person Alex invites says yes. */
export function scheduleInviteAnswer(inviteId) {
  later(4000, 6000, () => {
    const invite = db.gameInvites.get(inviteId);
    const game = invite && gameRow(invite.gameId);
    if (!invite || invite.status !== 'pending' || !game || !hasFreeSpot(game) || !profileOf(invite.invitedId)) return;
    const conversationId = joinGameAs(game, invite.invitedId);
    postMessage(conversationId, invite.invitedId, { text: 'Kiitos kutsusta, olen mukana! 🙌' });
  });
}

/** The player Alex asked accepts: a 1:1 chat opens with Alex's message and their answer. */
export function schedulePlayRequestAnswer(requestId) {
  later(3000, 5000, () => {
    const request = db.playRequests.get(requestId);
    if (!request || request.status !== 'pending' || !profileOf(request.toId)) return;
    request.status = 'accepted';
    const conversation = findOrCreateDirect(request.toId);
    postMessage(conversation.id, ME, { text: request.message });
    scheduleReply(conversation, null, `Moi ${me().name}! Kiitos pyynnöstä — lähden mielelläni. Milloin sinulle sopisi?`);
  });
}

/** Local players sign up to Alex's new league over ~20 s, so it can be started. */
export function scheduleLeagueSignups(leagueId) {
  const league = db.leagues.get(leagueId);
  const taken = new Set(leagueMembers(leagueId).map((m) => m.userId));
  const sameLevelFirst = (p) => (p.skillLevel === league.skillLevel ? 0 : 1);
  const pool = visiblePlayers()
    .filter((p) => p.areas.includes(league.city) && !taken.has(p.id))
    .sort((a, b) => sameLevelFirst(a) - sameLevelFirst(b))
    .slice(0, 4);
  pool.forEach((player, i) => {
    later(4000 + i * 5000, 6000 + i * 5000, () => {
      const current = db.leagues.get(leagueId);
      if (!current || current.status !== 'signup') return;
      if (leagueMembers(leagueId).some((m) => m.userId === player.id)) return;
      db.leagueMembers.push({ leagueId, userId: player.id, groupNumber: null, joinedAt: nowIso() });
    });
  });
}

/** The opponent confirms a result Alex reported. */
export function scheduleFixtureConfirmation(fixtureId) {
  later(5000, 8000, () => {
    const fixture = db.fixtures.get(fixtureId);
    const result = fixture?.result;
    if (!result || result.confirmedBy || result.reportedBy !== ME) return;
    result.confirmedBy = fixture.playerAId === ME ? fixture.playerBId : fixture.playerAId;
    result.confirmedAt = nowIso();
  });
}

/** After Alex accepts a play request, the sender follows up in the new chat. */
export function scheduleRequestFollowUp(conversationId, senderId) {
  later(3000, 5000, () => {
    if (!conversationRow(conversationId) || isBlocked(senderId) || !profileOf(senderId)) return;
    postMessage(conversationId, senderId, { text: nextFrom([
      `Kiva, ${me().name}! Mikä päivä sinulle sopisi? 🎾`,
      'Jes! Varaanko kentän, vai teetkö sinä pelin Krossiin?',
    ]) });
  });
}

/** When Alex leaves a game, the first player in its queue grabs the spot. */
export function scheduleWaitlistTakesSpot(gameId) {
  later(5000, 8000, () => {
    const game = gameRow(gameId);
    if (!game || !hasFreeSpot(game)) return;
    const next = game.waitlistIds.find((id) => id !== ME && profileOf(id) && !isBlocked(id));
    if (!next) return;
    joinGameAs(game, next);
  });
}

/** "Pelaan nyt": a local player who is free answers within a few seconds. */
export function schedulePlayingNowAnswer() {
  later(5000, 8000, () => {
    const city = me().areas[0];
    const candidates = visiblePlayers().filter((p) => p.areas.includes(city) && (p.playingThisWeek || p.playingNowUntil));
    if (candidates.length === 0) return;
    const player = nextFrom(candidates);
    const conversation = findOrCreateDirect(player.id);
    postMessage(conversation.id, player.id, { text: nextFrom([
      'Moi! Näin että pelaat nyt — ehdinkö mukaan? Pääsen hallille puolessa tunnissa 🎾',
      'Hei! Lähden mielelläni, kumpaan halliin mennään?',
    ]) });
  });
}

// ── Ambient life ─────────────────────────────────────────────────────────────

/**
 * Once per page load (browser only): a little later a friend messages Alex and someone
 * joins an open game nearby, so the demo is visibly alive even if the visitor only looks.
 */
export function startAmbientActivity() {
  if (db.ambientStarted) return;
  db.ambientStarted = true;

  later(25000, 35000, () => {
    const friend = profileOf('p-mikko');
    if (!friend || isBlocked(friend.id)) return;
    const conversation = findOrCreateDirect(friend.id);
    postMessage(conversation.id, friend.id, { text: 'Hei! Laitoin ensi viikolle nelinpelin Janukseen — lähdetkö mukaan? Yksi paikka vielä vapaana 🎾' });
  });

  later(50000, 70000, () => {
    const game = gameRow('g-sanna-nelinpeli');
    if (!game || !hasFreeSpot(game)) return;
    const player = joinCandidate(game);
    if (player) joinGameAs(game, player.id);
  });
}
