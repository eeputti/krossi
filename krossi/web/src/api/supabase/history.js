// history.js — what I have actually played: games marked 'played' and confirmed league
// matches. Internal module shared by stats.myActivity and players.listPartners.

import { db, selectIn } from './client.js';
import { PERSON_COLUMNS, mapPerson, leagueSetsFor } from './map.js';
import { unwrap } from '../errors.js';

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
    db().from('league_fixture_results').select('fixture_id, sets, winner_id, reported_by, confirmed_by, confirmed_at, created_at')
      .in('fixture_id', chunk).not('confirmed_by', 'is', null), FAIL);
  const resultByFixture = new Map(results.map((r) => [r.fixture_id, r]));

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
