// players.js — other players: the city feed, single profiles, play requests and
// "pelikaverit" (people I have actually played with).
//
// Other people's profiles are only readable once the current user has paid (RLS on
// profiles: current_user_has_paid()), so for an unpaid user the feed is simply empty.

import { db, requireUid, isUuid } from './client.js';
import { PROFILE_COLUMNS, mapProfile, isPlayingNow } from './map.js';
import { loadPlayedGames, loadConfirmedLeagueMatches } from './history.js';
import { emit } from './notifications.js';
import { unwrap } from '../errors.js';

async function blockedIds(uid) {
  const rows = unwrap(
    await db().from('blocked_profiles').select('blocked_id').eq('blocker_id', uid),
    'Pelaajia ei voitu ladata.',
  );
  return new Set((rows || []).map((r) => r.blocked_id));
}

export async function list({ city } = {}) {
  const uid = await requireUid();
  let query = db().from('profiles').select(PROFILE_COLUMNS).eq('hidden_from_feed', false).neq('id', uid);
  // Coarse filter in the database; the exact city match happens below on the parsed list.
  if (city) query = query.ilike('area', `%${city}%`);
  const [rows, blocked] = await Promise.all([
    query.order('playing_this_week', { ascending: false }).order('updated_at', { ascending: false }).limit(500),
    blockedIds(uid),
  ]);

  const now = Date.now();
  const entries = (unwrap(rows, 'Pelaajia ei voitu ladata.') || [])
    .map((row) => ({ profile: mapProfile(row), updatedAt: row.updated_at || '' }))
    .filter(({ profile }) => !blocked.has(profile.id) && (!city || profile.areas.includes(city)));

  const rank = (p) => (isPlayingNow(p, now) ? 2 : p.playingThisWeek ? 1 : 0);
  entries.sort((a, b) => rank(b.profile) - rank(a.profile) || b.updatedAt.localeCompare(a.updatedAt));
  return entries.map((e) => e.profile);
}

export async function get(id) {
  if (!isUuid(id)) return null;
  await requireUid();
  const row = unwrap(
    await db().from('profiles').select(PROFILE_COLUMNS).eq('id', id).maybeSingle(),
    'Profiilia ei voitu ladata.',
  );
  return mapProfile(row);
}

export async function sendPlayRequest(toId, message) {
  const uid = await requireUid();
  unwrap(
    await db().from('connection_requests').insert({
      sender_id: uid,
      receiver_id: toId,
      message: message?.trim() || 'Moi! Pelataanko?',
    }),
    'Pelipyynnön lähetys epäonnistui.',
  );
  emit({ type: 'play_request', senderId: uid, receiverId: toId });
}

export async function listPartners() {
  const uid = await requireUid();
  const [games, leagueMatches] = await Promise.all([loadPlayedGames(uid), loadConfirmedLeagueMatches(uid)]);

  const partners = new Map();
  const count = (person, playedAt) => {
    if (!person?.id || person.id === uid) return;
    const entry = partners.get(person.id) || { player: person, gamesTogether: 0, lastPlayedAt: null };
    entry.gamesTogether += 1;
    if (playedAt && (!entry.lastPlayedAt || playedAt > entry.lastPlayedAt)) entry.lastPlayedAt = playedAt;
    // Prefer a version of the person we can actually show (paid users see names).
    if (entry.player.name === 'Pelaaja' && person.name !== 'Pelaaja') entry.player = person;
    partners.set(person.id, entry);
  };
  for (const game of games) for (const person of game.people) count(person, game.playedAt);
  for (const match of leagueMatches) count(match.opponent, match.playedAt);

  return [...partners.values()].sort(
    (a, b) => b.gamesTogether - a.gamesTogether || String(b.lastPlayedAt || '').localeCompare(String(a.lastPlayedAt || '')),
  );
}
