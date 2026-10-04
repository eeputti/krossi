// rows.js — pure helpers on the demo's internal rows, shared by the seed and the store.
// The rules mirror the production SQL so the demo behaves like the real backend.

import { GAME_DURATION_HOURS, OPEN_GAME_TTL_HOURS } from '../../lib/constants.js';

export const ME = 'demo-user';
export const ME_EMAIL = 'demo@krossi.app';

const HOUR = 60 * 60 * 1000;

/** Joiners that fit, excluding the creator — same formula as the join_challenge RPC. */
export function capacityOf(game) {
  const base = game.matchType === 'nelinpeli' ? 3 : 1;
  return game.maxPlayers && game.maxPlayers > 1 ? Math.max(base, game.maxPlayers - 1) : base;
}

/** Feed expiry: game time + GAME_DURATION_HOURS, or OPEN_GAME_TTL_HOURS after creation when the time is open. */
export function expiresAtFor(scheduledAt, createdAt) {
  const start = scheduledAt ? Date.parse(scheduledAt) : null;
  const ms = start != null ? start + GAME_DURATION_HOURS * HOUR : Date.parse(createdAt) + OPEN_GAME_TTL_HOURS * HOUR;
  return new Date(ms).toISOString();
}

export function isExpired(game, now = Date.now()) {
  return Boolean(game.expiresAt) && Date.parse(game.expiresAt) < now;
}

/** The parsed payload join_challenge stores as a 'join' message. */
export function joinMeta(game, joiner) {
  return {
    __type: 'challenge_join',
    challengeId: game.id,
    creatorId: game.creatorId,
    joinerId: joiner.id,
    joinerName: joiner.name || 'Pelaaja',
    joinerAvatarUrl: joiner.avatarUrl ?? null,
    joinerAvatarColor: joiner.avatarColor || 'blue',
    location: game.locationName,
    locationType: game.locationType,
    courtSurface: game.courtSurface ?? null,
    matchType: game.matchType,
    scheduledAt: game.scheduledAt,
  };
}

/** One-line inbox preview for a message row. */
export function previewText(message) {
  switch (message.kind) {
    case 'thumbs': return '👍';
    case 'image': return '📷 Kuva';
    case 'join': return `${message.meta?.joinerName || 'Pelaaja'} liittyi peliin!`;
    default: return message.text || '';
  }
}

/** True when the set list is a win for the side whose games are in `mine`. */
export function wonSets(sets, mine, theirs) {
  const won = sets.filter((s) => s[mine] > s[theirs]).length;
  const lost = sets.filter((s) => s[theirs] > s[mine]).length;
  return won > lost;
}
