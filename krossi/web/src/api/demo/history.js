// history.js — what Alex has actually played: games marked 'played' and confirmed league
// matches. Internal module shared by stats.myActivity and players.listPartners, mirroring
// api/supabase/history.js.

import { ME } from './rows.js';
import { db, personLite, isMember, isBlocked } from './store.js';
import { roleOf } from '../../features/resultLinks.js';
import { toMatchResult } from './views.js';

/** Results with me in a linked slot that someone else logged. */
export function linkedResults() {
  return [...db.results.values()].filter((r) => r.createdBy !== ME && roleOf(r, ME) && !isBlocked(r.createdBy));
}

/** My results, newest first: the ones I logged and others' with me in them once confirmed. */
export function matchResults() {
  const confirmed = new Set(linkedResults().filter((r) => r.confirmation === 'confirmed'));
  return [...db.results.values()]
    .filter((r) => r.createdBy === ME || confirmed.has(r))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((r) => toMatchResult(r));
}

/** Games with outcome 'played' that I created or joined, newest first. */
export function playedGames() {
  return [...db.games.values()]
    .filter((g) => g.outcome === 'played' && isMember(g))
    .map((g) => {
      const people = g.participantIds.filter((id) => id !== ME).map(personLite);
      if (g.creatorId !== ME) people.unshift(personLite(g.creatorId));
      return {
        id: g.id,
        playedAt: g.scheduledAt || g.outcomeRecordedAt || g.createdAt,
        matchType: g.matchType,
        kind: g.kind === 'event' ? 'event' : 'open',
        locationName: g.locationName || 'Avoin',
        locationType: g.locationType,
        city: g.city ?? null,
        isOrganizer: g.creatorId === ME,
        people,
      };
    })
    .sort((a, b) => String(b.playedAt).localeCompare(String(a.playedAt)));
}

/** League fixtures I played whose result the opponent has confirmed; `a` = my games. */
export function confirmedLeagueMatches() {
  return [...db.fixtures.values()]
    .filter((f) => (f.playerAId === ME || f.playerBId === ME) && f.result?.confirmedBy && !f.result.walkover)
    .map((f) => {
      const iAmA = f.playerAId === ME;
      return {
        id: f.id,
        playedAt: f.result.confirmedAt || f.result.createdAt,
        won: f.result.winnerId === ME,
        opponent: personLite(iAmA ? f.playerBId : f.playerAId),
        sets: f.result.sets.map((s) => (iAmA ? { a: s.a, b: s.b } : { a: s.b, b: s.a })),
        leagueId: f.leagueId,
      };
    })
    .sort((a, b) => String(b.playedAt).localeCompare(String(a.playedAt)));
}
