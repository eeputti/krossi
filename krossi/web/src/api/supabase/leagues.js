// leagues.js — city leagues: the Krossi-liiga ported from the mobile app (src/services/leagues.ts)
// and the hallisarja (rounds, organiser-made groups, timed matches). Tables are read directly
// (readable by every signed-in user); every write is an RPC. The creator is the league's admin;
// Krossi moderators (krossi_can_manage_city) have the same rights — the database decides.
//
// Set scores in this API are `{a, b}` with `a` = player A's games. The database keeps the
// mobile app's format, `{my, opp}` from the reporter's point of view; map.js converts.

import { db, requireUid, selectIn, isUuid, isMissingFunction } from './client.js';
import {
  PERSON_COLUMNS, mapPerson, mapLeagueSummary, mapLeagueRound, mapLeagueResult, leagueSetsToStored,
} from './map.js';
import { ApiError, toApiError, unwrap } from '../errors.js';

const LOAD_FAIL = 'Liigoja ei voitu ladata.';
const SAVE_FAIL = 'Tuloksen tallennus epäonnistui.';

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

async function canManage(id, league, uid) {
  if (league.created_by === uid) return true;
  const { data, error } = await db().rpc('krossi_can_manage_league', { league_id_input: id });
  if (error) {
    if (!isMissingFunction(error)) console.warn('Liigan ylläpito-oikeuden tarkistus epäonnistui', error);
    return false; // the database enforces the same rule, so "false" only hides admin buttons
  }
  return Boolean(data);
}

export async function get(id) {
  if (!isUuid(id)) return null;
  const uid = await requireUid();
  const league = unwrap(
    await db().from('leagues').select(`*, organizer:profiles!leagues_created_by_fkey(${PERSON_COLUMNS})`).eq('id', id).maybeSingle(),
    LOAD_FAIL,
  );
  if (!league) return null;

  const [members, fixtures, rounds, manage] = await Promise.all([
    db()
      .from('league_members')
      .select(`user_id, group_number, continues, joined_at, profile:profiles!league_members_user_id_fkey(${PERSON_COLUMNS})`)
      .eq('league_id', id)
      .order('joined_at', { ascending: true }),
    db()
      .from('league_fixtures')
      .select(
        'id, round_number, group_number, player_a_id, player_b_id, created_at, ' +
        `player_a:profiles!league_fixtures_player_a_id_fkey(${PERSON_COLUMNS}), ` +
        `player_b:profiles!league_fixtures_player_b_id_fkey(${PERSON_COLUMNS})`,
      )
      .eq('league_id', id)
      .order('round_number', { ascending: true })
      .order('group_number', { ascending: true })
      .order('created_at', { ascending: true }),
    db().from('league_rounds').select('round_number, starts_on, ends_on, status').eq('league_id', id).order('round_number', { ascending: true }),
    canManage(id, league, uid),
  ]);
  const memberRows = unwrap(members, LOAD_FAIL) || [];
  const fixtureRows = unwrap(fixtures, LOAD_FAIL) || [];
  const roundRows = unwrap(rounds, LOAD_FAIL) || [];
  const results = await selectIn(fixtureRows.map((f) => f.id), (chunk) =>
    db().from('league_fixture_results').select('*').in('fixture_id', chunk), LOAD_FAIL);
  const resultByFixture = new Map(results.map((r) => [r.fixture_id, r]));

  return {
    ...mapLeagueSummary(league, { memberIds: memberRows.map((m) => m.user_id), uid }),
    canManage: manage,
    organizer: mapPerson(league.organizer, league.created_by),
    rounds: roundRows.map(mapLeagueRound),
    members: memberRows.map((m) => ({
      ...mapPerson(m.profile, m.user_id), groupNumber: m.group_number ?? null, continues: m.continues !== false,
    })),
    fixtures: fixtureRows.map((f) => {
      const result = resultByFixture.get(f.id);
      return {
        id: f.id,
        roundNumber: Number(f.round_number) || 1,
        groupNumber: f.group_number,
        playerA: mapPerson(f.player_a, f.player_a_id),
        playerB: mapPerson(f.player_b, f.player_b_id),
        result: result ? mapLeagueResult(result, f.player_a_id) : null,
      };
    }),
  };
}

/** Public standings (no session needed). Same shape as get(), people as "Etunimi S." without photos. */
export async function publicGet(id) {
  if (!isUuid(id)) return null;
  const { data, error } = await db().rpc('krossi_public_league', { league_id_input: id });
  if (error && isMissingFunction(error)) return null;
  if (error) throw toApiError(error, LOAD_FAIL);
  if (!data) return null;
  const people = new Map((data.people || []).map((p) => [p.id, {
    id: p.id, name: p.name || 'Pelaaja', avatarUrl: null, avatarColor: p.avatar_color || 'blue', ageRange: null, skillLevel: null,
  }]));
  const personOf = (pid) => people.get(pid) || { id: pid, name: 'Pelaaja', avatarUrl: null, avatarColor: 'blue', ageRange: null, skillLevel: null };
  const memberIds = (data.members || []).map((m) => m.user_id);
  return {
    ...mapLeagueSummary({ ...data, is_public: true }, { memberIds, uid: null }),
    canManage: false,
    organizer: { id: null, name: data.organizer_name || 'Ylläpitäjä', avatarUrl: null, avatarColor: 'green', ageRange: null, skillLevel: null },
    rounds: (data.rounds || []).map(mapLeagueRound),
    members: (data.members || []).map((m) => ({ ...personOf(m.user_id), groupNumber: m.group_number ?? null, continues: true })),
    fixtures: (data.fixtures || []).map((f) => ({
      id: f.id,
      roundNumber: Number(f.round_number) || 1,
      groupNumber: f.group_number,
      playerA: personOf(f.player_a_id),
      playerB: personOf(f.player_b_id),
      result: f.result
        ? { ...mapLeagueResult(f.result, f.player_a_id), confirmedBy: f.result.reported_by === f.player_a_id ? f.player_b_id : f.player_a_id }
        : null,
    })),
  };
}

export async function create(input = {}) {
  await requireUid();
  const { city, skillLevel, seasonLabel } = input;
  if (!seasonLabel?.trim()) throw new ApiError('Anna kaudelle nimi, esim. "Syksy 2026".', { code: 'invalid' });
  const hallisarja = input.format === 'hallisarja';
  if (!hallisarja) {
    // The mobile app's RPC — same as before for a plain Krossi-liiga.
    return unwrap(
      await db().rpc('create_league', { city_input: city, skill_level_input: skillLevel, season_label_input: seasonLabel.trim() }),
      'Liigan luonti epäonnistui.',
    );
  }
  return unwrap(
    await db().rpc('krossi_create_league', {
      city_input: city,
      skill_level_input: skillLevel,
      season_label_input: seasonLabel.trim(),
      format_input: 'hallisarja',
      match_format_input: input.matchFormat === 'sets' ? 'sets' : 'timed',
      group_size_input: input.groupSize ?? null,
      description_input: input.description?.trim() || null,
      venue_input: input.venue?.trim() || null,
      rounds_input: (input.rounds || []).map((r) => ({ starts_on: r.startsOn, ends_on: r.endsOn })),
      organizer_plays: Boolean(input.organizerPlays),
      is_public_input: Boolean(input.isPublic),
    }),
    'Sarjan luonti epäonnistui.',
  );
}

export async function update(id, { seasonLabel, description, venue, isPublic } = {}) {
  await requireUid();
  if (!seasonLabel?.trim()) throw new ApiError('Anna kaudelle nimi.', { code: 'invalid' });
  unwrap(await db().rpc('krossi_update_league', {
    league_id_input: id,
    season_label_input: seasonLabel.trim(),
    description_input: description?.trim() || null,
    venue_input: venue?.trim() || null,
    is_public_input: Boolean(isPublic),
  }), 'Tietojen tallennus epäonnistui.');
}

export async function remove(id) {
  await requireUid();
  unwrap(await db().rpc('krossi_delete_league', { league_id_input: id }), 'Liigan poisto epäonnistui.');
}

export async function finish(id) {
  await requireUid();
  unwrap(await db().rpc('krossi_finish_league', { league_id_input: id }), 'Kauden päättäminen epäonnistui.');
}

export async function join(id) {
  await requireUid();
  unwrap(await db().rpc('join_league', { league_id_input: id }), 'Liigaan liittyminen epäonnistui.');
}

export async function leave(id) {
  await requireUid();
  unwrap(await db().rpc('krossi_leave_league', { league_id_input: id }), 'Ilmoittautumisen peruminen epäonnistui.');
}

export async function setContinues(id, continues) {
  await requireUid();
  unwrap(
    await db().rpc('krossi_set_league_continues', { league_id_input: id, continues_input: Boolean(continues) }),
    'Tallennus epäonnistui.',
  );
}

export async function removeMember(id, userId) {
  await requireUid();
  unwrap(
    await db().rpc('krossi_remove_league_member', { league_id_input: id, user_id_input: userId }),
    'Pelaajan poisto epäonnistui.',
  );
}

export async function start(id) {
  await requireUid();
  unwrap(await db().rpc('start_league', { league_id_input: id }), 'Kauden aloitus epäonnistui.');
}

export async function startRound(id, groups, { startsOn, endsOn } = {}) {
  await requireUid();
  const clean = (groups || []).map((g) => (g || []).filter(Boolean)).filter((g) => g.length > 0);
  if (clean.length === 0) throw new ApiError('Jaa pelaajat vähintään yhteen lohkoon.', { code: 'invalid' });
  if (clean.some((g) => g.length < 2)) throw new ApiError('Jokaisessa lohkossa pitää olla vähintään 2 pelaajaa.', { code: 'invalid' });
  if (!startsOn || !endsOn || endsOn < startsOn) throw new ApiError('Tarkista kierroksen päivämäärät.', { code: 'invalid' });
  return unwrap(
    await db().rpc('krossi_start_league_round', {
      league_id_input: id, groups_input: clean, starts_on_input: startsOn, ends_on_input: endsOn,
    }),
    'Kierroksen aloitus epäonnistui.',
  );
}

export async function closeRound(id) {
  await requireUid();
  unwrap(await db().rpc('krossi_close_league_round', { league_id_input: id }), 'Kierroksen päättäminen epäonnistui.');
}

/** @param sets {a, b}[] with a = player A's games; winnerId null = draw (timed matches only) */
export async function reportResult(fixtureId, sets, winnerId) {
  const uid = await requireUid();
  const fixture = unwrap(
    await db().from('league_fixtures').select('id, player_a_id, player_b_id').eq('id', fixtureId).maybeSingle(),
    SAVE_FAIL,
  );
  if (!fixture) throw new ApiError('Ottelua ei löytynyt.', { code: 'not_found' });
  unwrap(
    await db().rpc('report_league_fixture_result', {
      fixture_id_input: fixtureId,
      sets_input: leagueSetsToStored(sets || [], fixture, uid),
      winner_id_input: winnerId || null,
    }),
    SAVE_FAIL,
  );
}

export async function confirmResult(fixtureId) {
  await requireUid();
  unwrap(await db().rpc('confirm_league_fixture_result', { fixture_id_input: fixtureId }), 'Tuloksen vahvistus epäonnistui.');
}

export async function adminSetResult(fixtureId, { sets = null, winnerId = null, walkover = false } = {}) {
  await requireUid();
  if (walkover && !winnerId) throw new ApiError('Valitse, kumpi voitti luovutuksella.', { code: 'invalid' });
  unwrap(
    await db().rpc('krossi_admin_set_league_result', {
      fixture_id_input: fixtureId,
      sets_input: walkover ? null : (sets || []).map(({ a, b }) => ({ a: Number(a) || 0, b: Number(b) || 0 })),
      winner_id_input: winnerId || null,
      walkover_input: Boolean(walkover),
    }),
    SAVE_FAIL,
  );
}

export async function adminConfirmResult(fixtureId) {
  await requireUid();
  unwrap(await db().rpc('krossi_admin_confirm_league_result', { fixture_id_input: fixtureId }), 'Tuloksen vahvistus epäonnistui.');
}

export async function adminClearResult(fixtureId) {
  await requireUid();
  unwrap(await db().rpc('krossi_admin_clear_league_result', { fixture_id_input: fixtureId }), 'Tuloksen poisto epäonnistui.');
}

export async function openFixtureChat(fixtureId) {
  await requireUid();
  return unwrap(
    await db().rpc('start_league_fixture_conversation', { fixture_id_input: fixtureId }),
    'Keskustelua ei voitu avata.',
  );
}
