// store.js — the demo's in-memory tables. Created from the seed when the module loads;
// a page reload starts over, nothing is persisted anywhere.
//
// Domain modules read and mutate `db` directly (it's the "database"); they hand screens
// only views built in views.js, deep-copied by runtime.run().

import { createSeed } from './seed.js';
import { cancelScheduled } from './runtime.js';
import { ME } from './rows.js';

export const db = {};

/** Rebuilds the whole world around `now` and cancels any scheduled background activity. */
export function resetStore(now = Date.now()) {
  cancelScheduled();
  for (const key of Object.keys(db)) delete db[key];
  Object.assign(db, createSeed(now), {
    pendingReplies: new Set(), // conversation ids with an auto-reply already on its way
    rotation: 0,               // rotates through canned replies / candidates so they don't repeat
    uploads: new Map(),        // avatar "storage path" -> object URL of the picked file
    ambientStarted: false,     // startAmbientActivity() runs once per page load
  });
}

resetStore();

export const nowIso = () => new Date().toISOString();

// ── People ───────────────────────────────────────────────────────────────────

export function profileOf(id) {
  if (db.deletedUserIds.has(id)) return null;
  return db.profiles.get(id) || null;
}

export function me() {
  return db.profiles.get(ME);
}

/** PersonLite for any user id; unknown or deleted users render as 'Pelaaja'. */
export function personLite(id) {
  const p = profileOf(id);
  if (!p) return { id, name: 'Pelaaja', avatarUrl: null, avatarColor: 'blue', ageRange: null, skillLevel: null };
  return { id: p.id, name: p.name, avatarUrl: p.avatarUrl, avatarColor: p.avatarColor, ageRange: p.ageRange, skillLevel: p.skillLevel };
}

export function isBlocked(userId) {
  for (const row of db.blocks.values()) if (row.userId === userId) return true;
  return false;
}

/** Other players visible in feeds: not me, not blocked, not deleted, not hidden. */
export function visiblePlayers() {
  return [...db.profiles.values()].filter((p) => p.id !== ME && !p.hiddenFromFeed && !isBlocked(p.id) && !db.deletedUserIds.has(p.id));
}

// ── Games ────────────────────────────────────────────────────────────────────

export function gameRow(id) {
  return db.games.get(id) || null;
}

export function isMember(game, userId = ME) {
  return game.creatorId === userId || game.participantIds.includes(userId);
}

// ── Conversations ────────────────────────────────────────────────────────────

export function conversationRow(id) {
  return db.conversations.get(id) || null;
}

export function messagesOf(conversationId) {
  if (!db.messages.has(conversationId)) db.messages.set(conversationId, []);
  return db.messages.get(conversationId);
}

export function myConversations() {
  return [...db.conversations.values()].filter((c) => c.participantIds.includes(ME));
}

export function gameConversation(gameId) {
  for (const c of db.conversations.values()) if (c.gameId === gameId) return c;
  return null;
}

/** The plain 1:1 conversation between me and `userId`, if there is one. */
export function directConversation(userId) {
  for (const c of db.conversations.values()) {
    if (c.gameId) continue;
    const ids = c.participantIds;
    if (ids.length === 2 && ids.includes(ME) && ids.includes(userId)) return c;
  }
  return null;
}

// ── Leagues ──────────────────────────────────────────────────────────────────

export function leagueMembers(leagueId) {
  return db.leagueMembers.filter((m) => m.leagueId === leagueId && !db.deletedUserIds.has(m.userId));
}

export function leagueFixtures(leagueId) {
  return [...db.fixtures.values()].filter((f) => f.leagueId === leagueId);
}
