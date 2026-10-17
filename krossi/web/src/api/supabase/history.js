// history.js — what I have actually played: games marked 'played', confirmed league matches
// and logged match results. Internal module shared by stats.myActivity, players.listPartners
// and results.

import { db, isMissingFunction, selectIn } from './client.js';
import { PERSON_COLUMNS, mapPerson, mapStoredResult, leagueSetsFor } from './map.js';
import { toApiError, unwrap } from '../errors.js';
import { viewResult } from '../../features/resultLinks.js';

const FAIL = 'Pelihistoriaa ei voitu ladata.';
const PLAYED_GAME_COLUMNS = 'id, creator_id, challenge_type, match_type, location, location_type, city, scheduled_at, outcome_recorded_at, created_at';

/**
 * Challenges with outcome 'played' that I created or joined, with everyone else in them.
 * @returns {Promise<{id, playedAt, matchType, kind, locationName, locationType, city, isOrganizer, people}[]>}
 */
export async function loadPlayedGames(uid) {
  const [created, joined] = await Promise.all([
    db().from('challenges').select(PLAYED_GAME_COLUMNS).eq('creator_id', uid).eq('outcome', 'played'),
    db()
      .from('challenge_participants')
      .select(`challenge:challenges!challenge_participants_challenge_id_fkey(${PLAYED_GAME_COLUMNS}, outcome)`)
      .eq('user_id', uid),
  ]);
  const rows = new Map();
  for (const row of unwrap(created, FAIL) || []) rows.set(row.id, row);
  for (const { challenge } of unwrap(joined, FAIL) || []) {
    if (challenge?.outcome === 'played') rows.set(challenge.id, challenge);
  }
  if (rows.size === 0) return [];

  const games = [...rows.values()];
  const [participants, creators] = await Promise.all([
    selectIn(games.map((g) => g.id), (chunk) =>
      db().from('challenge_participants')
        .select(`challenge_id, user_id, profile:profiles!challenge_participants_user_id_fkey(${PERSON_COLUMNS})`)
        .in('challenge_id', chunk), FAIL),
    selectIn(games.map((g) => g.creator_id), (chunk) => db().from('profiles').select(PERSON_COLUMNS).in('id', chunk), FAIL),
  ]);
  const creatorById = new Map(creators.map((c) => [c.id, c]));
  const othersByGame = new Map();
  for (const p of participants) {
    if (p.user_id === uid) continue;
    const list = othersByGame.get(p.challenge_id) || [];
    list.push(mapPerson(p.profile, p.user_id));
    othersByGame.set(p.challenge_id, list);
  }

  return games.map((g) => {
    const people = othersByGame.get(g.id) || [];
    if (g.creator_id !== uid) people.unshift(mapPerson(creatorById.get(g.creator_id), g.creator_id));
    return {
      id: g.id,
      playedAt: g.scheduled_at || g.outcome_recorded_at || g.created_at,
      matchType: g.match_type,
      kind: g.challenge_type === 'event' ? 'event' : 'open',
      locationName: g.location || 'Avoin',
      locationType: g.location_type,
      city: g.city ?? null,
      isOrganizer: g.creator_id === uid,
      people,
    };
  }).sort((a, b) => String(b.playedAt).localeCompare(String(a.playedAt)));
}

/**
 * League fixtures I played whose result the opponent has confirmed.
 * `sets` are oriented so that `a` = my games, `b` = the opponent's.
 */
export async function loadConfirmedLeagueMatches(uid) {
  const fixtures = unwrap(
    await db()
      .from('league_fixtures')
      .select(
        'id, league_id, player_a_id, player_b_id, ' +
        `player_a:profiles!league_fixtures_player_a_id_fkey(${PERSON_COLUMNS}), ` +
        `player_b:profiles!league_fixtures_player_b_id_fkey(${PERSON_COLUMNS})`,
      )
      .or(`player_a_id.eq.${uid},player_b_id.eq.${uid}`),
    FAIL,
  ) || [];
  if (fixtures.length === 0) return [];

  const results = await selectIn(fixtures.map((f) => f.id), (chunk) =>
    db().from('league_fixture_results').select('*')
      .in('fixture_id', chunk).not('confirmed_by', 'is', null), FAIL);
  // A walkover (luovutus) was never played: it counts in the standings, not in my tennis history.
  const resultByFixture = new Map(results.filter((r) => !r.walkover).map((r) => [r.fixture_id, r]));

  return fixtures
    .filter((f) => resultByFixture.has(f.id))
    .map((f) => {
      const result = resultByFixture.get(f.id);
      const iAmA = f.player_a_id === uid;
      return {
        id: f.id,
        playedAt: result.confirmed_at || result.created_at,
        won: result.winner_id === uid,
        opponent: iAmA ? mapPerson(f.player_b, f.player_b_id) : mapPerson(f.player_a, f.player_a_id),
        sets: leagueSetsFor(result, uid),
        leagueId: f.league_id,
      };
    })
    .sort((a, b) => String(b.playedAt).localeCompare(String(a.playedAt)));
}

// ── Logged match results ─────────────────────────────────────────────────────

const RESULTS_FAIL = 'Tuloksia ei voitu ladata.';
const ID_FIELDS = ['partnerId', 'opponentId', 'oppPartnerId', 'confirmedBy', 'disputedBy'];

/** Results other players logged with me in them, each with its creator (RPC; [] before the migration). */
export async function loadLinkedResults() {
  const { data, error } = await db().rpc('krossi_linked_match_results');
  if (error) {
    if (isMissingFunction(error)) return [];
    throw toApiError(error, RESULTS_FAIL);
  }
  return (Array.isArray(data) ? data : []).map((row) => ({ stored: mapStoredResult(row), creator: row.creator || null }));
}

/** PersonLite for every linked id of the results (profiles are readable once paid; else 'Pelaaja'). */
export async function peopleOfResults(stored, creators = []) {
  const people = new Map();
  for (const c of creators) if (c?.id) people.set(c.id, mapPerson(c));
  const ids = stored.flatMap((r) => ID_FIELDS.map((f) => r[f])).filter((id) => id && !people.has(id));
  const rows = await selectIn(ids, (chunk) => db().from('profiles').select(PERSON_COLUMNS).in('id', chunk), RESULTS_FAIL);
  for (const row of rows) people.set(row.id, mapPerson(row));
  return people;
}

const newestFirst = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));

/**
 * My results as MatchResult[], newest first: the ones I logged and the ones others logged with
 * me that have been confirmed. Shared by results.listMine and stats.myActivity.
 */
export async function loadMyResults(uid, limit = 100) {
  const [own, linked] = await Promise.all([
    db().from('match_results').select('*').eq('created_by', uid).order('created_at', { ascending: false }).limit(limit),
    loadLinkedResults(),
  ]);
  const mine = (unwrap(own, RESULTS_FAIL) || []).map(mapStoredResult);
  const confirmed = linked.filter((l) => l.stored.confirmation === 'confirmed');
  const people = await peopleOfResults([...mine, ...confirmed.map((l) => l.stored)], confirmed.map((l) => l.creator));
  return [...mine, ...confirmed.map((l) => l.stored)]
    .map((row) => viewResult(row, uid, people))
    .sort(newestFirst)
    .slice(0, limit);
}
