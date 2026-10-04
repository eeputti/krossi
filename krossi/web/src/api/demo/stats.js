// stats.js (demo) — the raw Activity data gamification and recaps are computed from,
// derived from the in-memory tables exactly like api/supabase/stats.js.

import { ME } from './rows.js';
import { run } from './runtime.js';
import { db, me } from './store.js';
import { playedGames, confirmedLeagueMatches, matchResults } from './history.js';

export async function myActivity() {
  return run(() => ({
    games: playedGames(),
    results: matchResults(),
    leagueMatches: confirmedLeagueMatches(),
    organizedCount: [...db.games.values()].filter((g) => g.creatorId === ME && g.status !== 'cancelled').length,
    invitesJoined: db.invitesJoined,
    memberSince: me()?.createdAt ?? null,
  }));
}
