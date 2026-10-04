// views.js — turns internal rows into exactly the shapes documented in api/contract.js,
// the same ones the Supabase backend returns (api/supabase/map.js). runtime.run()
// deep-copies whatever these build, so screens never hold references into the tables.

import { ME, capacityOf, isExpired, previewText } from './rows.js';
import {
  db, gameRow, personLite, profileOf, messagesOf, gameConversation, isMember, leagueMembers, leagueFixtures,
} from './store.js';

// ── People ───────────────────────────────────────────────────────────────────

/** @returns {import('../contract.js').Profile} — keys in the same order as mapProfile(). */
export function toProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    ageRange: row.ageRange ?? null,
    gender: row.gender ?? null,
    city: row.areas[0] || '',
    areas: [...row.areas],
    bio: row.bio ?? null,
    avatarUrl: row.avatarUrl ?? null,
    avatarColor: row.avatarColor,
    skillLevel: row.skillLevel,
    competitionClasses: [...row.competitionClasses],
    playStyles: [...row.playStyles],
    availability: [...row.availability],
    handedness: row.handedness ?? null,
    backhand: row.backhand ?? null,
    playingThisWeek: Boolean(row.playingThisWeek),
    playingNowUntil: row.playingNowUntil ?? null,
    playingNowNote: row.playingNowNote ?? null,
    hiddenFromFeed: Boolean(row.hiddenFromFeed),
    paidAt: row.paidAt ?? null,
    createdAt: row.createdAt ?? null,
  };
}

export function isPlayingNow(row, now = Date.now()) {
  return Boolean(row?.playingNowUntil && Date.parse(row.playingNowUntil) > now);
}

// ── Games ────────────────────────────────────────────────────────────────────

/** @returns {import('../contract.js').Game} */
export function toGame(game) {
  const capacity = capacityOf(game);
  const conversation = gameConversation(game.id);
  const onWaitlist = game.waitlistIds.includes(ME);
  return {
    id: game.id,
    kind: game.kind,
    status: game.status,
    outcome: game.outcome ?? null,
    creator: personLite(game.creatorId),
    participants: game.participantIds.map(personLite),
    capacity,
    spotsLeft: Math.max(0, capacity - game.participantIds.length),
    matchType: game.matchType,
    locationName: game.locationName || 'Avoin',
    locationType: game.locationType,
    courtSurface: game.courtSurface ?? null,
    city: game.city ?? null,
    lat: game.lat ?? null,
    lng: game.lng ?? null,
    scheduledAt: game.scheduledAt ?? null,
    expiresAt: game.expiresAt ?? null,
    title: game.title ?? null,
    description: game.description ?? null,
    minSkillLevel: game.minSkillLevel ?? null,
    courtPrice: game.courtPrice ?? null,
    creatorCoversFull: Boolean(game.creatorCoversFull),
    maxPlayers: game.maxPlayers ?? null,
    createdAt: game.createdAt,
    isMine: game.creatorId === ME,
    iJoined: game.participantIds.includes(ME),
    onWaitlist,
    // RLS on challenge_waitlist: members see the whole queue, everyone else only their own row.
    waitlistCount: isMember(game) ? game.waitlistIds.length : onWaitlist ? 1 : 0,
    // Only conversations I take part in are visible.
    conversationId: conversation && conversation.participantIds.includes(ME) ? conversation.id : null,
  };
}

/**
 * krossi_public_challenge_preview: only open/filled, unexpired open games and events;
 * the creator's first name and colour, no people, prices or coordinates.
 */
export function toPublicPreview(game) {
  if (!game || !['open', 'event'].includes(game.kind) || !['open', 'filled'].includes(game.status) || isExpired(game)) return null;
  const creator = profileOf(game.creatorId);
  return {
    id: game.id,
    kind: game.kind === 'event' ? 'event' : 'open',
    status: game.status,
    creatorName: (creator?.name || '').trim().split(' ')[0] || 'Pelaaja',
    creatorAvatarColor: creator?.avatarColor || 'blue',
    matchType: game.matchType,
    locationName: game.locationName || 'Avoin',
    locationType: game.locationType,
    city: game.city ?? null,
    scheduledAt: game.scheduledAt ?? null,
    title: game.title ?? null,
    spotsLeft: Math.max(0, capacityOf(game) - game.participantIds.length),
    participantCount: game.participantIds.length,
  };
}

/** Sort for game lists: soonest first, "aika avoin" games last (oldest first among them). */
export function byScheduledAsc(a, b) {
  if (!a.scheduledAt && !b.scheduledAt) return String(a.createdAt).localeCompare(String(b.createdAt));
  if (!a.scheduledAt) return 1;
  if (!b.scheduledAt) return -1;
  return a.scheduledAt.localeCompare(b.scheduledAt);
}

const playedTime = (g) => g.scheduledAt || g.expiresAt || g.createdAt || '';

/** Sort for past games: most recent first. */
export function byPlayedDesc(a, b) {
  return playedTime(b).localeCompare(playedTime(a));
}

// ── Messages ─────────────────────────────────────────────────────────────────

/** @returns {import('../contract.js').Message} */
export function toMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    sender: personLite(row.senderId),
    kind: row.kind,
    text: row.kind === 'thumbs' ? '👍' : row.text ?? (row.kind === 'text' ? '' : null),
    imageUrl: row.imageUrl ?? null,
    createdAt: row.createdAt,
    meta: row.meta ?? null,
  };
}

function otherParticipants(conversation) {
  return conversation.participantIds.filter((id) => id !== ME).map(personLite);
}

function isUnread(conversation) {
  const list = db.messages.get(conversation.id) || [];
  const last = list[list.length - 1];
  if (!last || last.senderId === ME) return false;
  const readAt = conversation.lastReadAt[ME];
  return !readAt || Date.parse(last.createdAt) > Date.parse(readAt);
}

/**
 * @returns {import('../contract.js').Conversation|null} — null when everyone else has left,
 * like the production list (there is nothing to show).
 */
export function toConversation(conversation) {
  const others = otherParticipants(conversation);
  if (others.length === 0) return null;
  const list = messagesOf(conversation.id);
  const last = list[list.length - 1] || null;
  const isGroup = Boolean(conversation.gameId) || others.length > 1;
  const gameTitle = conversation.gameId ? gameRow(conversation.gameId)?.title?.trim() || null : null;
  const title = isGroup ? gameTitle || (others.length === 1 ? others[0].name : 'Ryhmäkeskustelu') : others[0].name;
  return {
    id: conversation.id,
    isGroup,
    title,
    participants: others,
    lastMessage: last ? { text: previewText(last), senderId: last.senderId, createdAt: last.createdAt, kind: last.kind } : null,
    updatedAt: conversation.updatedAt,
    unread: isUnread(conversation),
    gameId: conversation.gameId ?? null,
  };
}

export function toPlayRequest(request) {
  return { id: request.id, from: personLite(request.fromId), message: request.message || '', createdAt: request.createdAt };
}

// ── Results ──────────────────────────────────────────────────────────────────

/** @returns {import('../contract.js').MatchResult} */
export function toMatchResult(row) {
  return {
    id: row.id,
    createdAt: row.createdAt,
    gameType: row.gameType,
    format: row.format,
    partnerName: row.partnerName ?? null,
    opponentName: row.opponentName ?? null,
    oppPartnerName: row.oppPartnerName ?? null,
    sets: row.sets.map((s) => ({ my: Number(s.my) || 0, opp: Number(s.opp) || 0 })),
    won: Boolean(row.won),
  };
}

// ── Leagues ──────────────────────────────────────────────────────────────────

const byJoinedAt = (a, b) => String(a.joinedAt).localeCompare(String(b.joinedAt));

export function toLeagueSummary(league) {
  const members = leagueMembers(league.id);
  return {
    id: league.id,
    city: league.city,
    skillLevel: league.skillLevel,
    seasonLabel: league.seasonLabel,
    groupSize: league.groupSize,
    status: league.status,
    memberCount: members.length,
    createdBy: league.createdBy,
    iAmMember: members.some((m) => m.userId === ME),
  };
}

export function toLeagueDetail(league) {
  const fixtures = leagueFixtures(league.id).sort((a, b) => a.groupNumber - b.groupNumber);
  return {
    ...toLeagueSummary(league),
    members: [...leagueMembers(league.id)].sort(byJoinedAt).map((m) => ({ ...personLite(m.userId), groupNumber: m.groupNumber ?? null })),
    fixtures: fixtures.map((f) => ({
      id: f.id,
      groupNumber: f.groupNumber,
      playerA: personLite(f.playerAId),
      playerB: personLite(f.playerBId),
      result: f.result
        ? {
          sets: f.result.sets.map((s) => ({ a: s.a, b: s.b })),
          winnerId: f.result.winnerId,
          reportedBy: f.result.reportedBy,
          confirmedBy: f.result.confirmedBy ?? null,
          confirmedAt: f.result.confirmedAt ?? null,
        }
        : null,
    })),
  };
}

// ── Misc ─────────────────────────────────────────────────────────────────────

export function blockedRows() {
  return [...db.blocks.values()]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((row) => ({ rowId: row.rowId, user: personLite(row.userId) }));
}
