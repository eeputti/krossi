// stats.js — the raw Activity data that gamification (streaks, badges) and recaps are
// computed from in features/. No scoring logic lives here.

import { db, requireUid } from './client.js';
import { mapMatchResult } from './map.js';
import { loadPlayedGames, loadConfirmedLeagueMatches } from './history.js';
import { toApiError, unwrap } from '../errors.js';

const FAIL = 'Tilastoja ei voitu ladata.';

async function invitesJoined() {
  // New RPC (invite links); until it is deployed — or on any hiccup — badges just see 0.
  const { data, error } = await db().rpc('krossi_my_invites_joined');
  if (error) return 0;
  return Number(data) || 0;
}

export async function myActivity() {
  const uid = await requireUid();
  const [games, results, leagueMatches, organized, joinedCount, me] = await Promise.all([
    loadPlayedGames(uid),
    db().from('match_results').select('*').eq('created_by', uid).order('created_at', { ascending: false }).limit(1000),
    loadConfirmedLeagueMatches(uid),
    db().from('challenges').select('id', { count: 'exact', head: true }).eq('creator_id', uid).neq('status', 'cancelled'),
    invitesJoined(),
    db().from('profiles').select('created_at').eq('id', uid).maybeSingle(),
  ]);
  if (organized.error) throw toApiError(organized.error, FAIL);

  return {
    games,
    results: (unwrap(results, FAIL) || []).map(mapMatchResult),
    leagueMatches,
    organizedCount: organized.count || 0,
    invitesJoined: joinedCount,
    memberSince: unwrap(me, FAIL)?.created_at ?? null,
  };
}
