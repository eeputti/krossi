// games.js (demo) — browse, create, join, leave, waitlist, invites and outcomes, with the
// same rules and error messages as api/supabase/games.js and the SQL behind it
// (join_challenge, leave_challenge, record_challenge_outcome, RLS on challenges/invites).

import { CITIES } from '../../lib/constants.js';
import { ApiError } from '../errors.js';
import { GAME_DURATION_HOURS, OPEN_GAME_TTL_HOURS } from '../../lib/constants.js';
import { ME, isExpired } from './rows.js';
import { run, newId } from './runtime.js';
import { db, nowIso, gameRow, isMember, profileOf } from './store.js';
import { toGame, toPublicPreview, byScheduledAsc, byPlayedDesc } from './views.js';
import {
  dbError, notify, joinGameAs, scheduleWelcome, scheduleSomeoneJoins, scheduleInviteAnswer,
  scheduleWaitlistTakesSpot,
} from './actions.js';

const HOUR_MS = 60 * 60 * 1000;
const JOIN_FAIL = 'Peliin liittyminen epäonnistui. Yritä hetken päästä uudelleen.';

// challenges_city_check in production (widened to every app city in 20261002110000)
const GAME_CITIES = CITIES;

/** RLS on challenges: open/filled games for everyone, my own games in any status. */
function visible(game) {
  return Boolean(game) && (['open', 'filled'].includes(game.status) || isMember(game));
}

/** Past = cancelled, answered, or over (listMine's rule). */
function isPast(game) {
  return game.status === 'cancelled' || game.outcome != null || isExpired(game);
}

// ── Reading ──────────────────────────────────────────────────────────────────

export async function listOpen() {
  return run(() => [...db.games.values()]
    .filter((g) => ['open', 'filled'].includes(g.status) && ['open', 'event'].includes(g.kind) && !isExpired(g))
    .map(toGame)
    .sort(byScheduledAsc));
}

export async function listMine() {
  return run(() => {
    const upcoming = [];
    const past = [];
    for (const game of db.games.values()) {
      if (!isMember(game)) continue;
      (isPast(game) ? past : upcoming).push(toGame(game));
    }
    return { upcoming: upcoming.sort(byScheduledAsc), past: past.sort(byPlayedDesc) };
  });
}

export async function get(id) {
  return run(() => {
    const game = gameRow(id);
    return visible(game) ? toGame(game) : null;
  });
}

export async function pendingOutcomes() {
  return run(() => [...db.games.values()]
    .filter((g) => isMember(g) && ['open', 'filled'].includes(g.status) && g.outcome == null && isExpired(g))
    .map(toGame)
    .sort(byPlayedDesc));
}

/** Works without a session in production; the demo always has one anyway. */
export async function publicPreview(id) {
  return run(() => toPublicPreview(gameRow(id)));
}

// ── Creating ─────────────────────────────────────────────────────────────────

function validateInput(input) {
  if (input.kind === 'event') {
    if (!input.title?.trim()) throw new ApiError('Anna tapahtumalle nimi.', { code: 'invalid' });
    if (!input.city) throw new ApiError('Valitse tapahtuman kaupunki.', { code: 'invalid' });
    if (!(Number(input.maxPlayers) >= 2)) throw new ApiError('Pelaajakaton pitää olla vähintään 2.', { code: 'invalid' });
  }
  if (input.scheduledAt && Number.isNaN(new Date(input.scheduledAt).getTime())) {
    throw new ApiError('Tarkista pelin ajankohta.', { code: 'invalid' });
  }
}

export async function create(input) {
  return run(() => {
    validateInput(input);
    const isEvent = input.kind === 'event';
    // Insert policy: events need city-admin rights, which Alex doesn't have.
    if (isEvent) throw new ApiError('Sinulla ei ole oikeutta luoda tapahtumia tähän kaupunkiin.', { code: 'forbidden' });
    if (input.city && !GAME_CITIES.includes(input.city)) {
      throw new ApiError('Tähän kaupunkiin ei voi vielä luoda pelejä.', { code: 'invalid' });
    }

    const createdAt = nowIso();
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt).toISOString() : null;
    const expiresAt = scheduledAt
      ? new Date(Date.parse(scheduledAt) + GAME_DURATION_HOURS * HOUR_MS).toISOString()
      : new Date(Date.parse(createdAt) + OPEN_GAME_TTL_HOURS * HOUR_MS).toISOString();
    const hasPin = input.lat != null && input.lng != null;
    const game = {
      id: newId('g'),
      kind: 'open',
      status: 'open',
      outcome: null,
      creatorId: ME,
      participantIds: [],
      waitlistIds: [],
      matchType: input.matchType,
      locationName: input.locationName?.trim() || 'Avoin',
      locationType: input.locationType,
      courtSurface: input.courtSurface || null,
      city: input.city || null,
      lat: hasPin ? Number(input.lat) : null,
      lng: hasPin ? Number(input.lng) : null,
      scheduledAt,
      expiresAt,
      title: input.title?.trim() || null,
      description: input.description?.trim() || null,
      minSkillLevel: input.minSkillLevel || null,
      courtPrice: input.courtPrice ? Number(input.courtPrice) : null,
      creatorCoversFull: Boolean(input.creatorCoversFull),
      maxPlayers: null,
      createdAt,
    };
    db.games.set(game.id, game);
    notify({ type: 'new_area_challenge', challengeId: game.id, creatorId: ME, area: input.city });
    scheduleSomeoneJoins(game.id);
    return game.id;
  });
}

// ── Joining and leaving ──────────────────────────────────────────────────────

/** join_challenge for Alex; returns the game chat's id. */
function joinAsMe(id) {
  const game = gameRow(id);
  if (!game) throw dbError('Challenge not found', JOIN_FAIL);
  const already = game.participantIds.includes(ME);
  const conversationId = joinGameAs(game, ME);
  if (!already) {
    notify({ type: 'challenge_join', challengeId: id, challengeCreatorId: game.creatorId, joinerId: ME });
    scheduleWelcome(game, conversationId);
  }
  return conversationId;
}

export async function join(id) {
  return run(() => joinAsMe(id));
}

export async function leave(id) {
  return run(() => {
    const game = gameRow(id);
    if (game) {
      const wasIn = game.participantIds.includes(ME);
      game.participantIds = game.participantIds.filter((uid) => uid !== ME);
      // leave_challenge reopens a filled game; the leaver keeps the group chat.
      if (game.status === 'filled') game.status = 'open';
      if (wasIn) scheduleWaitlistTakesSpot(id);
    }
    notify({ type: 'challenge_spot_available', challengeId: id, leaverId: ME });
  });
}

export async function cancel(id) {
  return run(() => {
    const game = gameRow(id);
    if (!game || game.creatorId !== ME) throw new ApiError('Vain pelin luoja voi perua pelin.', { code: 'forbidden' });
    game.status = 'cancelled';
    notify({ type: 'challenge_cancelled', challengeId: id, creatorId: ME });
  });
}

export async function joinWaitlist(id) {
  return run(() => {
    const game = gameRow(id);
    if (!game) throw new ApiError('Jonoon liittyminen epäonnistui.');
    if (!game.waitlistIds.includes(ME)) game.waitlistIds.push(ME);
  });
}

export async function leaveWaitlist(id) {
  return run(() => {
    const game = gameRow(id);
    if (game) game.waitlistIds = game.waitlistIds.filter((uid) => uid !== ME);
  });
}

export async function recordOutcome(id, outcome) {
  return run(() => {
    const fail = 'Vastauksen tallennus epäonnistui.';
    if (!['played', 'not_played'].includes(outcome)) throw dbError(`Invalid outcome: ${outcome}`, fail);
    const game = gameRow(id);
    if (!game || !isMember(game)) throw dbError('Not allowed to record outcome for this challenge', fail);
    if (game.outcome == null) {
      game.outcome = outcome;
      game.outcomeRecordedAt = nowIso();
    }
  });
}

// ── Invites ──────────────────────────────────────────────────────────────────

export async function invite(gameId, userIds) {
  return run(() => {
    const invitees = [...new Set(userIds || [])].filter((uid) => uid && uid !== ME);
    if (invitees.length === 0) return { invited: [], alreadyInvited: [] };
    const game = gameRow(gameId);
    if (!game || game.creatorId !== ME) throw new ApiError('Vain pelin luoja voi kutsua pelaajia.', { code: 'forbidden' });
    if (invitees.some((uid) => !profileOf(uid))) throw new ApiError('Kutsujen lähetys epäonnistui.');

    const created = [];
    for (const invitedId of invitees) {
      const exists = [...db.gameInvites.values()].some((i) => i.gameId === gameId && i.invitedId === invitedId);
      if (exists) continue; // ignoreDuplicates: inviting twice stays quiet
      const row = { id: newId('inv'), gameId, inviterId: ME, invitedId, status: 'pending', createdAt: nowIso() };
      db.gameInvites.set(row.id, row);
      created.push(row);
      notify({ type: 'challenge_invite', challengeId: gameId, inviterId: ME, invitedUserId: invitedId });
    }
    if (created.length > 0) scheduleInviteAnswer(created[0].id);
    const invited = created.map((row) => row.invitedId);
    return { invited, alreadyInvited: invitees.filter((id) => !invited.includes(id)) };
  });
}

export async function listInvites() {
  return run(() => [...db.gameInvites.values()]
    .filter((i) => i.invitedId === ME && i.status === 'pending')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((i) => ({ invite: i, game: gameRow(i.gameId) }))
    .filter(({ game }) => game && ['open', 'filled'].includes(game.status) && !isExpired(game))
    .map(({ invite, game }) => ({ id: invite.id, game: toGame(game) }))
    // Same as production: invites to games already joined some other way are hidden.
    .filter(({ game }) => !game.iJoined && !game.isMine));
}

export async function respondInvite(inviteId, accept) {
  return run(() => {
    const row = db.gameInvites.get(inviteId);
    // RLS: an invite is visible to the invited player and to the game's creator.
    const mine = row && (row.invitedId === ME || gameRow(row.gameId)?.creatorId === ME);
    if (!mine) throw new ApiError('Kutsua ei löytynyt — se on ehkä jo vanhentunut.', { code: 'not_found' });
    if (!accept) {
      if (row.invitedId === ME) row.status = 'declined';
      return null;
    }
    const conversationId = joinAsMe(row.gameId);
    if (row.invitedId === ME) row.status = 'accepted';
    return conversationId;
  });
}
