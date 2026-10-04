// leagues.js — city ladder leagues, ported from the mobile app (src/services/leagues.ts).
// Tables are read directly (readable by every signed-in user); every write is an RPC.
//
// Set scores in this API are `{a, b}` with `a` = player A's games. The database keeps the
// mobile app's format, `{my, opp}` from the reporter's point of view; map.js converts.

import { db, requireUid, selectIn, isUuid } from './client.js';
import { PERSON_COLUMNS, mapPerson, mapLeagueSummary, leagueSetsFor, leagueSetsToStored } from './map.js';
import { ApiError, unwrap } from '../errors.js';

const LOAD_FAIL = 'Liigoja ei voitu ladata.';

export async function listByCity(city) {
  const uid = await requireUid();
  const leagues = unwrap(
    await db().from('leagues').select('*').eq('city', city).order('created_at', { ascending: false }),
    LOAD_FAIL,
  ) || [];
  const members = await selectIn(leagues.map((l) => l.id), (chunk) =>
    db().from('league_members').select('league_id, user_id').in('league_id', chunk), LOAD_FAIL);

  const memberIds = new Map();
  for (const m of members) memberIds.set(m.league_id, [...(memberIds.get(m.league_id) || []), m.user_id]);
  return leagues.map((row) => mapLeagueSummary(row, { memberIds: memberIds.get(row.id) || [], uid }));
}

export async function get(id) {
  if (!isUuid(id)) return null;
  const uid = await requireUid();
  const league = unwrap(await db().from('leagues').select('*').eq('id', id).maybeSingle(), LOAD_FAIL);
  if (!league) return null;

  const [members, fixtures] = await Promise.all([
    db()
      .from('league_members')
      .select(`user_id, group_number, joined_at, profile:profiles!league_members_user_id_fkey(${PERSON_COLUMNS})`)
      .eq('league_id', id)
      .order('joined_at', { ascending: true }),
    db()
      .from('league_fixtures')
      .select(
        'id, group_number, player_a_id, player_b_id, created_at, ' +
        `player_a:profiles!league_fixtures_player_a_id_fkey(${PERSON_COLUMNS}), ` +
        `player_b:profiles!league_fixtures_player_b_id_fkey(${PERSON_COLUMNS})`,
      )
      .eq('league_id', id)
      .order('group_number', { ascending: true })
      .order('created_at', { ascending: true }),
  ]);
  const memberRows = unwrap(members, LOAD_FAIL) || [];
  const fixtureRows = unwrap(fixtures, LOAD_FAIL) || [];
  const results = await selectIn(fixtureRows.map((f) => f.id), (chunk) =>
    db().from('league_fixture_results').select('*').in('fixture_id', chunk), LOAD_FAIL);
  const resultByFixture = new Map(results.map((r) => [r.fixture_id, r]));

  return {
    ...mapLeagueSummary(league, { memberIds: memberRows.map((m) => m.user_id), uid }),
    members: memberRows.map((m) => ({ ...mapPerson(m.profile, m.user_id), groupNumber: m.group_number ?? null })),
    fixtures: fixtureRows.map((f) => {
      const result = resultByFixture.get(f.id);
      return {
        id: f.id,
        groupNumber: f.group_number,
        playerA: mapPerson(f.player_a, f.player_a_id),
        playerB: mapPerson(f.player_b, f.player_b_id),
        result: result
          ? {
            sets: leagueSetsFor(result, f.player_a_id),
            winnerId: result.winner_id,
            reportedBy: result.reported_by,
            confirmedBy: result.confirmed_by ?? null,
            confirmedAt: result.confirmed_at ?? null,
          }
          : null,
      };
    }),
  };
}

export async function create({ city, skillLevel, seasonLabel }) {
  await requireUid();
  if (!seasonLabel?.trim()) throw new ApiError('Anna kaudelle nimi, esim. "Syksy 2026".', { code: 'invalid' });
  return unwrap(
    await db().rpc('create_league', { city_input: city, skill_level_input: skillLevel, season_label_input: seasonLabel.trim() }),
    'Liigan luonti epäonnistui.',
  );
}

export async function join(id) {
  await requireUid();
  unwrap(await db().rpc('join_league', { league_id_input: id }), 'Liigaan liittyminen epäonnistui.');
}

export async function start(id) {
  await requireUid();
  unwrap(await db().rpc('start_league', { league_id_input: id }), 'Kauden aloitus epäonnistui.');
}

/** @param sets {a, b}[] with a = player A's games */
export async function reportResult(fixtureId, sets, winnerId) {
  const uid = await requireUid();
  const fixture = unwrap(
    await db().from('league_fixtures').select('id, player_a_id, player_b_id').eq('id', fixtureId).maybeSingle(),
    'Tuloksen tallennus epäonnistui.',
  );
  if (!fixture) throw new ApiError('Ottelua ei löytynyt.', { code: 'not_found' });
  unwrap(
    await db().rpc('report_league_fixture_result', {
      fixture_id_input: fixtureId,
      sets_input: leagueSetsToStored(sets || [], fixture, uid),
      winner_id_input: winnerId,
    }),
    'Tuloksen tallennus epäonnistui.',
  );
}

export async function confirmResult(fixtureId) {
  await requireUid();
  unwrap(await db().rpc('confirm_league_fixture_result', { fixture_id_input: fixtureId }), 'Tuloksen vahvistus epäonnistui.');
}

export async function openFixtureChat(fixtureId) {
  await requireUid();
  return unwrap(
    await db().rpc('start_league_fixture_conversation', { fixture_id_input: fixtureId }),
    'Keskustelua ei voitu avata.',
  );
}
