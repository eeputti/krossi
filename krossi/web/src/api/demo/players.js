// players.js (demo) — the city feed, single profiles, play requests and "pelikaverit",
// mirroring api/supabase/players.js.

import { ApiError } from '../errors.js';
import { ME } from './rows.js';
import { run, newId } from './runtime.js';
import { db, nowIso, profileOf, visiblePlayers } from './store.js';
import { toProfile, isPlayingNow } from './views.js';
import { playedGames, confirmedLeagueMatches } from './history.js';
import { duplicate, notify, schedulePlayRequestAnswer } from './actions.js';

export async function list({ city } = {}) {
  return run(() => {
    const now = Date.now();
    const rank = (p) => (isPlayingNow(p, now) ? 2 : p.playingThisWeek ? 1 : 0);
    // Stable sort: within a rank the seed order stands in for "recently updated first".
    const players = visiblePlayers().filter((p) => !city || p.areas.includes(city));
    players.sort((a, b) => rank(b) - rank(a));
    return players.map(toProfile);
  });
}

export async function get(id) {
  return run(() => toProfile(profileOf(id)));
}

export async function sendPlayRequest(toId, message) {
  return run(() => {
    const fail = 'Pelipyynnön lähetys epäonnistui.';
    if (!toId || toId === ME || !profileOf(toId)) throw new ApiError(fail);
    // connection_requests_one_pending_per_pair_idx: one pending request per pair, either direction.
    for (const r of db.playRequests.values()) {
      const samePair = (r.fromId === ME && r.toId === toId) || (r.fromId === toId && r.toId === ME);
      if (samePair && r.status === 'pending') throw duplicate();
    }
    const request = {
      id: newId('pr'), fromId: ME, toId, status: 'pending', createdAt: nowIso(),
      message: message?.trim() || 'Moi! Pelataanko?',
    };
    db.playRequests.set(request.id, request);
    notify({ type: 'play_request', senderId: ME, receiverId: toId });
    schedulePlayRequestAnswer(request.id);
  });
}

export async function listPartners() {
  return run(() => {
    const partners = new Map();
    const count = (person, playedAt) => {
      if (!person?.id || person.id === ME) return;
      const entry = partners.get(person.id) || { player: person, gamesTogether: 0, lastPlayedAt: null };
      entry.gamesTogether += 1;
      if (playedAt && (!entry.lastPlayedAt || playedAt > entry.lastPlayedAt)) entry.lastPlayedAt = playedAt;
      partners.set(person.id, entry);
    };
    for (const game of playedGames()) for (const person of game.people) count(person, game.playedAt);
    for (const match of confirmedLeagueMatches()) count(match.opponent, match.playedAt);
    return [...partners.values()].sort(
      (a, b) => b.gamesTogether - a.gamesTogether || String(b.lastPlayedAt || '').localeCompare(String(a.lastPlayedAt || '')),
    );
  });
}
