// games.js — games ("haasteet" / "tapahtumat", table `challenges`): browse, create, join,
// leave, waitlist, invites and outcomes.
//
// RLS in short: every signed-in user sees open/filled games and their participant rows;
// creators and participants also see their own games in any status. Creator and participant
// *profiles* are only readable once the current user has paid, so people are often mapped
// from an id alone (name 'Pelaaja'). Joining goes through the join_challenge RPC (raises
// 'Payment required' / 'Challenge is full'), leaving through leave_challenge, and the only
// UPDATE the client may do on a game is the creator setting status = 'cancelled'.

import { db, requireUid, selectIn, isUuid, isDuplicate, isRlsViolation, isMissingFunction } from './client.js';
import { GAME_COLUMNS, PERSON_COLUMNS, gameIsPast, mapGame, mapPublicPreview } from './map.js';
import { emit } from './notifications.js';
import { ApiError, toApiError, unwrap } from '../errors.js';
import { GAME_DURATION_HOURS, OPEN_GAME_TTL_HOURS } from '../../lib/constants.js';

const HOUR_MS = 60 * 60 * 1000;
const LOAD_FAIL = 'Pelejä ei voitu ladata.';
const PARTICIPANT_COLUMNS = `challenge_id, user_id, created_at, profile:profiles!challenge_participants_user_id_fkey(${PERSON_COLUMNS})`;

// ── Loading ──────────────────────────────────────────────────────────────────

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row[key]) || [];
    list.push(row);
    map.set(row[key], list);
  }
  return map;
}

const byCreatedAt = (a, b) => String(a.created_at).localeCompare(String(b.created_at));

/** challenges rows -> Game[] (same order), with people, waitlist and chat looked up in bulk. */
async function hydrate(rows, uid) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [participants, creators, waitlist, conversations] = await Promise.all([
    selectIn(ids, (chunk) => db().from('challenge_participants').select(PARTICIPANT_COLUMNS).in('challenge_id', chunk), LOAD_FAIL),
    selectIn(rows.map((r) => r.creator_id), (chunk) => db().from('profiles').select(PERSON_COLUMNS).in('id', chunk), LOAD_FAIL),
    selectIn(ids, (chunk) => db().from('challenge_waitlist').select('challenge_id, user_id, created_at').in('challenge_id', chunk), LOAD_FAIL),
    // Only conversations I take part in are visible, which is exactly the contract.
    selectIn(ids, (chunk) => db().from('conversations').select('id, challenge_id').in('challenge_id', chunk), LOAD_FAIL),
  ]);

  const participantsByGame = groupBy(participants.sort(byCreatedAt), 'challenge_id');
  const waitlistByGame = groupBy(waitlist.sort(byCreatedAt), 'challenge_id');
  const creatorById = new Map(creators.map((c) => [c.id, c]));
  const conversationByGame = new Map(conversations.map((c) => [c.challenge_id, c.id]));

  return rows.map((row) =>
    mapGame(row, {
      uid,
      creator: creatorById.get(row.creator_id) || null,
      participants: (participantsByGame.get(row.id) || []).map((p) => ({ userId: p.user_id, row: p.profile })),
      waitlistUserIds: (waitlistByGame.get(row.id) || []).map((w) => w.user_id),
      conversationId: conversationByGame.get(row.id) || null,
    }),
  );
}

// Nulls ("aika avoin") sort after every scheduled game.
function byScheduledAsc(a, b) {
  if (!a.scheduledAt && !b.scheduledAt) return String(a.createdAt).localeCompare(String(b.createdAt));
  if (!a.scheduledAt) return 1;
  if (!b.scheduledAt) return -1;
  return a.scheduledAt.localeCompare(b.scheduledAt);
}

const playedTime = (g) => g.scheduledAt || g.expiresAt || g.createdAt || '';
const byPlayedDesc = (a, b) => playedTime(b).localeCompare(playedTime(a));

/** Every game I created or joined, any status (raw rows, deduplicated). */
async function loadMyGameRows(uid) {
  const [created, joined] = await Promise.all([
    db().from('challenges').select(GAME_COLUMNS).eq('creator_id', uid).order('created_at', { ascending: false }).limit(300),
    db()
      .from('challenge_participants')
      .select(`challenge:challenges!challenge_participants_challenge_id_fkey(${GAME_COLUMNS})`)
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(300),
  ]);
  const rows = new Map();
  for (const row of unwrap(created, LOAD_FAIL) || []) rows.set(row.id, row);
  for (const { challenge } of unwrap(joined, LOAD_FAIL) || []) if (challenge) rows.set(challenge.id, challenge);
  return [...rows.values()];
}

export async function listOpen() {
  const uid = await requireUid();
  const nowIso = new Date().toISOString();
  const rows = unwrap(
    await db()
      .from('challenges')
      .select(GAME_COLUMNS)
      .in('status', ['open', 'filled'])
      .in('challenge_type', ['open', 'event'])
      .or(`expires_at.is.null,expires_at.gt."${nowIso}"`)
      .order('scheduled_at', { ascending: true, nullsFirst: false })
      .limit(300),
    LOAD_FAIL,
  );
  // Old rows without expires_at are filtered on their scheduled time instead.
  const games = await hydrate((rows || []).filter((r) => !gameIsPast(r, nowIso)), uid);
  return games.sort(byScheduledAsc);
}

export async function listMine() {
  const uid = await requireUid();
  const nowIso = new Date().toISOString();
  const rows = await loadMyGameRows(uid);
  const games = await hydrate(rows, uid);
  const isPast = (game, row) => game.status === 'cancelled' || game.outcome != null || gameIsPast(row, nowIso);
  const upcoming = [];
  const past = [];
  games.forEach((game, i) => (isPast(game, rows[i]) ? past : upcoming).push(game));
  return { upcoming: upcoming.sort(byScheduledAsc), past: past.sort(byPlayedDesc) };
}

export async function get(id) {
  if (!isUuid(id)) return null;
  const uid = await requireUid();
  const row = unwrap(await db().from('challenges').select(GAME_COLUMNS).eq('id', id).maybeSingle(), 'Peliä ei voitu ladata.');
  if (!row) return null;
  const [game] = await hydrate([row], uid);
  return game;
}

export async function pendingOutcomes() {
  const uid = await requireUid();
  const nowIso = new Date().toISOString();
  const rows = (await loadMyGameRows(uid)).filter(
    (r) => ['open', 'filled'].includes(r.status) && r.outcome == null && gameIsPast(r, nowIso),
  );
  return (await hydrate(rows, uid)).sort(byPlayedDesc);
}

/** What a logged-out visitor of a shared link sees. Works without a session. */
export async function publicPreview(id) {
  if (!isUuid(id)) return null;
  const { data, error } = await db().rpc('krossi_public_challenge_preview', { challenge_id_input: id });
  if (error && isMissingFunction(error)) {
    console.warn('krossi_public_challenge_preview puuttuu vielä tietokannasta', error);
    return null;
  }
  if (error) throw toApiError(error, 'Peliä ei voitu ladata.');
  return mapPublicPreview(data);
}

// ── Creating ─────────────────────────────────────────────────────────────────

function createError(error, isEvent) {
  const message = String(error?.message || '');
  if (isRlsViolation(error)) {
    return isEvent
      ? new ApiError('Sinulla ei ole oikeutta luoda tapahtumia tähän kaupunkiin.', { cause: error, code: 'forbidden' })
      : new ApiError('Pelin luominen vaatii Krossin avaamisen.', { cause: error, code: 'payment_required' });
  }
  if (message.includes('challenges_city_check')) {
    return new ApiError('Tähän kaupunkiin ei voi vielä luoda pelejä.', { cause: error, code: 'invalid' });
  }
  if (message.includes('challenges_challenge_type_check')) {
    return new ApiError('Tapahtumien luonti ei ole vielä käytössä.', { cause: error, code: 'invalid' });
  }
  return toApiError(error, isEvent ? 'Tapahtuman luonti epäonnistui. Yritä hetken päästä uudelleen.' : 'Pelin luonti epäonnistui. Yritä hetken päästä uudelleen.');
}

/** GameInput -> challenges row, field by field as the legacy CreateChallengeScreen did. */
function toInsertRow(input, uid) {
  const isEvent = input.kind === 'event';
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  const expiresAt = scheduledAt
    ? new Date(scheduledAt.getTime() + GAME_DURATION_HOURS * HOUR_MS)
    : new Date(Date.now() + OPEN_GAME_TTL_HOURS * HOUR_MS);

  const row = {
    creator_id: uid,
    challenge_type: isEvent ? 'event' : 'open',
    match_type: input.matchType,
    location: input.locationName?.trim() || 'Avoin',
    location_type: input.locationType,
    city: input.city || null,
    scheduled_at: scheduledAt ? scheduledAt.toISOString() : null,
    expires_at: expiresAt.toISOString(),
    title: input.title?.trim() || null,
    description: input.description?.trim() || null,
  };
  if (input.lat != null && input.lng != null) {
    row.latitude = input.lat;
    row.longitude = input.lng;
  }
  if (input.courtSurface) row.court_surface = input.courtSurface;
  if (input.courtPrice) row.court_price = Number(input.courtPrice);
  if (isEvent) {
    row.max_players = Number(input.maxPlayers);
  } else {
    if (input.minSkillLevel) row.min_skill_level = input.minSkillLevel;
    if (input.creatorCoversFull) row.creator_covers_full = true;
  }
  return row;
}

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
  validateInput(input);
  const uid = await requireUid();
  const isEvent = input.kind === 'event';
  const { data, error } = await db().from('challenges').insert(toInsertRow(input, uid)).select('id').single();
  if (error) throw createError(error, isEvent);

  emit({
    type: isEvent ? 'new_area_event' : 'new_area_challenge',
    challengeId: data.id,
    creatorId: uid,
    area: input.city,
  });
  return data.id;
}

// ── Joining and leaving ──────────────────────────────────────────────────────

export async function join(id) {
  const uid = await requireUid();
  // join_challenge is idempotent for existing participants; check first so a double tap or
  // a stale invite doesn't notify the creator twice.
  const [alreadyResult, creatorResult] = await Promise.all([
    db().from('challenge_participants').select('user_id').eq('challenge_id', id).eq('user_id', uid).maybeSingle(),
    db().from('challenges').select('creator_id').eq('id', id).maybeSingle(),
  ]);
  const wasParticipant = Boolean(alreadyResult.data);
  const conversationId = unwrap(
    await db().rpc('join_challenge', { challenge_id_input: id }),
    'Peliin liittyminen epäonnistui. Yritä hetken päästä uudelleen.',
  );

  // Someone who got the spot from the waitlist is no longer waiting, and an invite to a
  // game you joined some other way is answered.
  const [{ error: waitlistError }, { error: inviteError }] = await Promise.all([
    db().from('challenge_waitlist').delete().eq('challenge_id', id).eq('user_id', uid),
    db().from('challenge_invites').update({ status: 'accepted' }).eq('challenge_id', id).eq('invited_user_id', uid).eq('status', 'pending'),
  ]);
  if (waitlistError) console.warn('Jonopaikan poisto liittymisen jälkeen epäonnistui', waitlistError);
  if (inviteError) console.warn('Kutsun kuittaus liittymisen jälkeen epäonnistui', inviteError);

  const creatorId = creatorResult.data?.creator_id;
  if (!wasParticipant && creatorId && creatorId !== uid) {
    emit({ type: 'challenge_join', challengeId: id, challengeCreatorId: creatorId, joinerId: uid });
  }
  return conversationId;
}

export async function leave(id) {
  const uid = await requireUid();
  unwrap(await db().rpc('leave_challenge', { challenge_id_input: id }), 'Pelistä poistuminen epäonnistui.');
  emit({ type: 'challenge_spot_available', challengeId: id, leaverId: uid });
}

export async function cancel(id) {
  const uid = await requireUid();
  const rows = unwrap(
    await db().from('challenges').update({ status: 'cancelled' }).eq('id', id).eq('creator_id', uid).select('id'),
    'Pelin peruminen epäonnistui.',
  );
  // RLS filters instead of erroring: zero rows means this wasn't my game.
  if (!rows?.length) throw new ApiError('Vain pelin luoja voi perua pelin.', { code: 'forbidden' });
  emit({ type: 'challenge_cancelled', challengeId: id, creatorId: uid });
}

export async function joinWaitlist(id) {
  const uid = await requireUid();
  const { error } = await db().from('challenge_waitlist').insert({ challenge_id: id, user_id: uid });
  if (error && !isDuplicate(error)) throw toApiError(error, 'Jonoon liittyminen epäonnistui.');
}

export async function leaveWaitlist(id) {
  const uid = await requireUid();
  unwrap(
    await db().from('challenge_waitlist').delete().eq('challenge_id', id).eq('user_id', uid),
    'Jonosta poistuminen epäonnistui.',
  );
}

export async function recordOutcome(id, outcome) {
  await requireUid();
  // A direct UPDATE is blocked by RLS; the SECURITY DEFINER RPC lets creator and participants answer.
  unwrap(
    await db().rpc('record_challenge_outcome', { challenge_id_input: id, outcome_input: outcome }),
    'Vastauksen tallennus epäonnistui.',
  );
}

// ── Invites ──────────────────────────────────────────────────────────────────

export async function invite(gameId, userIds) {
  const uid = await requireUid();
  const invitees = [...new Set(userIds || [])].filter((id) => id && id !== uid);
  if (invitees.length === 0) return { invited: [], alreadyInvited: [] };
  const { data, error } = await db()
    .from('challenge_invites')
    .upsert(
      invitees.map((invitedUserId) => ({ challenge_id: gameId, invited_user_id: invitedUserId })),
      { onConflict: 'challenge_id,invited_user_id', ignoreDuplicates: true },
    )
    .select('invited_user_id');
  if (error && isRlsViolation(error)) throw new ApiError('Vain pelin luoja voi kutsua pelaajia.', { cause: error, code: 'forbidden' });
  if (error) throw toApiError(error, 'Kutsujen lähetys epäonnistui.');

  // Only newly created invites notify. An existing row (pending, accepted or declined) can't be
  // re-opened by the creator under RLS, so report those back instead of a false success.
  const invited = (data || []).map((row) => row.invited_user_id);
  for (const invitedUserId of invited) {
    emit({ type: 'challenge_invite', challengeId: gameId, inviterId: uid, invitedUserId });
  }
  return { invited, alreadyInvited: invitees.filter((id) => !invited.includes(id)) };
}

export async function listInvites() {
  const uid = await requireUid();
  const invites = unwrap(
    await db()
      .from('challenge_invites')
      .select('id, challenge_id, created_at')
      .eq('invited_user_id', uid)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    'Pelikutsuja ei voitu ladata.',
  ) || [];
  if (invites.length === 0) return [];

  const nowIso = new Date().toISOString();
  const rows = (
    await selectIn(invites.map((i) => i.challenge_id), (chunk) => db().from('challenges').select(GAME_COLUMNS).in('id', chunk), 'Pelikutsuja ei voitu ladata.')
  ).filter((r) => ['open', 'filled'].includes(r.status) && !gameIsPast(r, nowIso));
  const gameById = new Map((await hydrate(rows, uid)).map((g) => [g.id, g]));

  // Hide invites to games I already joined some other way (shared link, game page).
  return invites
    .filter((i) => gameById.has(i.challenge_id) && !gameById.get(i.challenge_id).iJoined && !gameById.get(i.challenge_id).isMine)
    .map((i) => ({ id: i.id, game: gameById.get(i.challenge_id) }));
}

async function setInviteStatus(inviteId, status) {
  unwrap(await db().from('challenge_invites').update({ status }).eq('id', inviteId), 'Kutsuun vastaaminen epäonnistui.');
}

export async function respondInvite(inviteId, accept) {
  await requireUid();
  const invite = unwrap(
    await db().from('challenge_invites').select('id, challenge_id').eq('id', inviteId).maybeSingle(),
    'Kutsuun vastaaminen epäonnistui.',
  );
  if (!invite) throw new ApiError('Kutsua ei löytynyt — se on ehkä jo vanhentunut.', { code: 'not_found' });
  if (!accept) {
    await setInviteStatus(inviteId, 'declined');
    return null;
  }
  const conversationId = await join(invite.challenge_id);
  await setInviteStatus(inviteId, 'accepted');
  return conversationId;
}
