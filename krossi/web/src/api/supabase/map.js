// map.js — database rows -> contract shapes (see api/contract.js). The only place that knows
// column names, legacy encodings and storage URL rules; screens only ever see the output.

import { SUPABASE_URL, SKILL_ORDER, COMPETITION_CLASSES, PLAY_STYLES } from '../../lib/constants.js';

const AVATAR_COLORS = ['blue', 'yellow', 'red', 'green'];
const PLAIN_SKILLS = new Set(SKILL_ORDER);
const PLAY_STYLE_VALUES = new Set(PLAY_STYLES.map((s) => s.value));
const COMPETITION_CLASS_RE = /^[A-E][1-3]$/;
const UNKNOWN_NAME = 'Pelaaja';

// ── Storage ──────────────────────────────────────────────────────────────────

function publicStorageUrl(bucket, path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path; // the mobile app stores full URLs
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

export const avatarUrl = (path) => publicStorageUrl('profile-avatars', path);
export const chatImageUrl = (path) => publicStorageUrl('chat-images', path);

// ── Small parsers ────────────────────────────────────────────────────────────

export function avatarColor(value) {
  return AVATAR_COLORS.includes(value) ? value : 'blue';
}

/** ", "-joined city list -> string[] (order kept, first = home city). */
export function parseAreas(raw) {
  if (!raw) return [];
  const seen = new Set();
  for (const part of String(raw).split(',')) {
    const city = part.trim();
    if (city) seen.add(city);
  }
  return [...seen];
}

/**
 * tennis_preferences.skill_level is a comma list. Seen in production:
 *   'keskitaso'            plain level
 *   'kilpapelaaja,B1,B2'   competitive level + classes
 *   'B2'                   classes only (older mobile builds) => kilpapelaaja
 *   'rento'                retired value => keskitaso
 */
export function parseSkill(raw) {
  const parts = String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
  const classes = parts
    .filter((p) => COMPETITION_CLASS_RE.test(p))
    .sort((a, b) => COMPETITION_CLASSES.indexOf(a) - COMPETITION_CLASSES.indexOf(b));
  const plain = parts.find((p) => PLAIN_SKILLS.has(p));
  const skillLevel = plain || (classes.length > 0 ? 'kilpapelaaja' : 'keskitaso');
  return { skillLevel, competitionClasses: skillLevel === 'kilpapelaaja' ? classes : [] };
}

/** Inverse of parseSkill, for writing tennis_preferences.skill_level. */
export function serializeSkill(skillLevel, competitionClasses = []) {
  const level = PLAIN_SKILLS.has(skillLevel) ? skillLevel : 'keskitaso';
  const classes = level === 'kilpapelaaja' ? competitionClasses.filter((c) => COMPETITION_CLASS_RE.test(c)) : [];
  return [level, ...classes].join(',');
}

/** ", "-joined play styles; unknown legacy values are dropped, empty means "kaikki käy". */
export function parsePlayStyles(raw) {
  const styles = String(raw || '').split(',').map((s) => s.trim()).filter((s) => PLAY_STYLE_VALUES.has(s));
  return styles.length > 0 ? [...new Set(styles)] : ['kaikki käy'];
}

// PostgREST embeds one-to-one relations as an object, but older code paths saw arrays.
function one(embedded) {
  return Array.isArray(embedded) ? embedded[0] ?? null : embedded ?? null;
}

function trimmedOrNull(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

// ── People ───────────────────────────────────────────────────────────────────

export const PERSON_COLUMNS = 'id, name, avatar_url, avatar_color, age, tennis_preferences(skill_level)';

/**
 * Row from `profiles` (PERSON_COLUMNS or more) -> PersonLite. Other people's profiles are
 * only readable once the current user has paid, so `row` is often null: the person still
 * exists (we know their id), we just can't show who they are.
 */
export function mapPerson(row, id = row?.id) {
  const prefs = one(row?.tennis_preferences);
  return {
    id: id ?? null,
    name: trimmedOrNull(row?.name) || UNKNOWN_NAME,
    avatarUrl: avatarUrl(row?.avatar_url),
    avatarColor: avatarColor(row?.avatar_color),
    ageRange: row?.age ?? null,
    skillLevel: prefs ? parseSkill(prefs.skill_level).skillLevel : null,
  };
}

export const PROFILE_COLUMNS =
  'id, name, age, gender, area, bio, avatar_url, avatar_color, playing_this_week, playing_now_until, ' +
  'playing_now_note, hidden_from_feed, paid_at, created_at, updated_at, ' +
  'tennis_preferences(skill_level, play_style, handedness, backhand_type), availability(slot)';

export function mapProfile(row) {
  if (!row) return null;
  const prefs = one(row.tennis_preferences) || {};
  const areas = parseAreas(row.area);
  const { skillLevel, competitionClasses } = parseSkill(prefs.skill_level);
  return {
    id: row.id,
    name: trimmedOrNull(row.name) || UNKNOWN_NAME,
    ageRange: row.age ?? null,
    gender: row.gender === 'mies' || row.gender === 'nainen' ? row.gender : null,
    city: areas[0] || '',
    areas,
    bio: trimmedOrNull(row.bio),
    avatarUrl: avatarUrl(row.avatar_url),
    avatarColor: avatarColor(row.avatar_color),
    skillLevel,
    competitionClasses,
    playStyles: parsePlayStyles(prefs.play_style),
    availability: (row.availability || []).map((a) => a.slot).filter(Boolean),
    handedness: prefs.handedness || null,
    backhand: prefs.backhand_type || null,
    playingThisWeek: Boolean(row.playing_this_week),
    playingNowUntil: row.playing_now_until || null,
    playingNowNote: row.playing_now_note || null,
    hiddenFromFeed: Boolean(row.hidden_from_feed),
    paidAt: row.paid_at || null,
    createdAt: row.created_at || null,
  };
}

export function isPlayingNow(profile, now = Date.now()) {
  return Boolean(profile?.playingNowUntil && new Date(profile.playingNowUntil).getTime() > now);
}

// ── Games (challenges) ───────────────────────────────────────────────────────

export const GAME_COLUMNS =
  'id, creator_id, location, location_type, court_surface, city, latitude, longitude, scheduled_at, ' +
  'expires_at, match_type, status, challenge_type, title, description, min_skill_level, court_price, ' +
  'creator_covers_full, max_players, created_at, outcome, outcome_recorded_at';

/** Joiners that fit — the exact formula of the join_challenge RPC. */
export function gameCapacity(matchType, maxPlayers) {
  const base = matchType === 'nelinpeli' ? 3 : 1;
  return maxPlayers != null && maxPlayers > 1 ? Math.max(base, maxPlayers - 1) : base;
}

/**
 * A game is over once its end time has passed. Old rows may lack expires_at, in which case
 * the scheduled time decides; a row with neither never expires by itself.
 */
export function gameIsPast(row, nowIso = new Date().toISOString()) {
  if (row.expires_at) return row.expires_at < nowIso;
  if (row.scheduled_at) return row.scheduled_at < nowIso;
  return false;
}

/**
 * challenges row + looked-up related data -> Game.
 * @param {object} ctx { uid, creator: profiles row|null, participants: {userId, row}[],
 *                       waitlistUserIds: string[], conversationId: string|null }
 */
export function mapGame(row, ctx) {
  const { uid, creator = null, participants = [], waitlistUserIds = [], conversationId = null } = ctx;
  const capacity = gameCapacity(row.match_type, row.max_players);
  const people = participants.map((p) => mapPerson(p.row, p.userId));
  return {
    id: row.id,
    kind: row.challenge_type === 'event' ? 'event' : 'open',
    status: row.status,
    outcome: row.outcome ?? null,
    creator: mapPerson(creator, row.creator_id),
    participants: people,
    capacity,
    spotsLeft: Math.max(0, capacity - people.length),
    matchType: row.match_type,
    locationName: row.location || 'Avoin',
    locationType: row.location_type,
    courtSurface: row.court_surface || null,
    city: row.city ?? null,
    lat: row.latitude ?? null,
    lng: row.longitude ?? null,
    scheduledAt: row.scheduled_at ?? null,
    expiresAt: row.expires_at ?? null,
    title: trimmedOrNull(row.title),
    description: trimmedOrNull(row.description),
    // The mobile app may store a competition class (A1–E3) instead of a plain level.
    minSkillLevel: PLAIN_SKILLS.has(row.min_skill_level) || COMPETITION_CLASS_RE.test(row.min_skill_level || '') ? row.min_skill_level : null,
    courtPrice: row.court_price != null ? Number(row.court_price) : null,
    creatorCoversFull: Boolean(row.creator_covers_full),
    maxPlayers: row.max_players ?? null,
    createdAt: row.created_at,
    isMine: Boolean(uid) && row.creator_id === uid,
    iJoined: Boolean(uid) && participants.some((p) => p.userId === uid),
    onWaitlist: Boolean(uid) && waitlistUserIds.includes(uid),
    waitlistCount: waitlistUserIds.length,
    conversationId,
  };
}

export function mapPublicPreview(data) {
  if (!data || typeof data !== 'object') return null;
  return {
    id: data.id,
    kind: data.kind === 'event' ? 'event' : 'open',
    status: data.status,
    creatorName: data.creator_name || UNKNOWN_NAME,
    creatorAvatarColor: avatarColor(data.creator_avatar_color),
    matchType: data.match_type,
    locationName: data.location || 'Avoin',
    locationType: data.location_type,
    city: data.city ?? null,
    scheduledAt: data.scheduled_at ?? null,
    title: trimmedOrNull(data.title),
    spotsLeft: Number(data.spots_left) || 0,
    participantCount: Number(data.participant_count) || 0,
  };
}

// ── Messages ─────────────────────────────────────────────────────────────────

export const THUMBS_UP_CONTENT = JSON.stringify({ __type: 'thumbs_up' });

function parseJsonContent(content) {
  if (typeof content !== 'string' || !content.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && typeof parsed.__type === 'string' ? parsed : null;
  } catch {
    return null; // a normal text message that happens to start with "{"
  }
}

/**
 * messages.content conventions shared with the mobile app:
 *   image_url set                          -> photo (content is null)
 *   {"__type":"thumbs_up"}                 -> 👍
 *   {"__type":"challenge_join", ...}       -> system line written by join_challenge
 *   anything else                          -> plain text
 */
export function parseMessageContent(content, imagePath) {
  if (imagePath) return { kind: 'image', text: trimmedOrNull(content), imageUrl: chatImageUrl(imagePath), meta: null };
  const payload = parseJsonContent(content);
  if (payload?.__type === 'thumbs_up') return { kind: 'thumbs', text: '👍', imageUrl: null, meta: null };
  if (payload?.__type === 'challenge_join') {
    const meta = { ...payload, joinerAvatarUrl: avatarUrl(payload.joinerAvatarUrl) };
    return { kind: 'join', text: `${payload.joinerName || UNKNOWN_NAME} liittyi peliin!`, imageUrl: null, meta };
  }
  return { kind: 'text', text: content ?? '', imageUrl: null, meta: null };
}

export const MESSAGE_COLUMNS =
  'id, conversation_id, sender_id, content, image_url, created_at, ' +
  'profile:profiles!messages_sender_id_fkey(id, name, avatar_url, avatar_color, age)';

export function mapMessage(row, sender = mapPerson(row.profile, row.sender_id)) {
  const parsed = parseMessageContent(row.content, row.image_url);
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    sender,
    kind: parsed.kind,
    text: parsed.text,
    imageUrl: parsed.imageUrl,
    createdAt: row.created_at,
    meta: parsed.meta,
  };
}

/** Conversation list preview line. `hasImage` comes from the newest message row. */
export function lastMessagePreview(content, { senderId = null, createdAt = null, hasImage = false } = {}) {
  if (!content && !hasImage) return null;
  const parsed = parseMessageContent(content, hasImage ? 'x' : null);
  const text = parsed.kind === 'image' ? '📷 Kuva' : parsed.text;
  return { text: text || '', senderId, createdAt, kind: parsed.kind };
}

// ── Results ──────────────────────────────────────────────────────────────────

export function mapMatchResult(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    gameType: row.game_type,
    format: row.format,
    partnerName: row.partner_name ?? null,
    opponentName: row.opponent_name ?? null,
    oppPartnerName: row.opp_partner_name ?? null,
    sets: Array.isArray(row.sets) ? row.sets.map((s) => ({ my: Number(s.my) || 0, opp: Number(s.opp) || 0 })) : [],
    won: Boolean(row.won),
  };
}

export function setsWon(sets) {
  const won = sets.filter((s) => s.my > s.opp).length;
  const lost = sets.filter((s) => s.opp > s.my).length;
  return won > lost;
}

// ── Leagues ──────────────────────────────────────────────────────────────────

// League results are stored the way the mobile app reports them: `{my, opp}` from the
// reporter's point of view. These convert to/from a fixed orientation.

/** Stored sets -> `{a, b}[]` where `a` is `playerId`'s games. */
export function leagueSetsFor(result, playerId) {
  const reporterIsPlayer = result.reported_by === playerId;
  return (Array.isArray(result.sets) ? result.sets : []).map((s) => {
    const my = Number(s.my) || 0;
    const opp = Number(s.opp) || 0;
    return reporterIsPlayer ? { a: my, b: opp } : { a: opp, b: my };
  });
}

/** `{a, b}[]` (a = player A) -> stored `{my, opp}[]` for a report made by `reporterId`. */
export function leagueSetsToStored(sets, fixture, reporterId) {
  const reporterIsA = fixture.player_a_id === reporterId;
  return sets.map(({ a, b }) => (reporterIsA ? { my: Number(a) || 0, opp: Number(b) || 0 } : { my: Number(b) || 0, opp: Number(a) || 0 }));
}

const LEAGUE_STATUS = { signup: 'signup', active: 'active', completed: 'finished' };

export function mapLeagueSummary(row, { memberIds = [], uid = null } = {}) {
  return {
    id: row.id,
    city: row.city,
    skillLevel: PLAIN_SKILLS.has(row.skill_level) || COMPETITION_CLASS_RE.test(row.skill_level || '') ? row.skill_level : 'keskitaso',
    seasonLabel: row.season_label,
    groupSize: row.group_size,
    status: LEAGUE_STATUS[row.status] || 'signup',
    memberCount: memberIds.length,
    createdBy: row.created_by,
    iAmMember: Boolean(uid) && memberIds.includes(uid),
  };
}
