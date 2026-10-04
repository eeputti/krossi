// leagues.js (demo) — city ladder leagues with the rules and messages of the league RPCs
// (create_league, join_league, start_league, report/confirm_league_fixture_result,
// start_league_fixture_conversation). Sets are `{a, b}` with `a` = player A's games.

import { ApiError } from '../errors.js';
import { SKILL_ORDER } from '../../lib/constants.js';
import { ME } from './rows.js';
import { run, newId } from './runtime.js';
import { db, nowIso, leagueMembers } from './store.js';
import { toLeagueSummary, toLeagueDetail } from './views.js';
import { roundRobin } from './seed.js';
import {
  dbError, findOrCreateDirect, scheduleLeagueSignups, scheduleFixtureConfirmation,
} from './actions.js';

const DEFAULT_GROUP_SIZE = 6; // leagues.group_size default

export async function listByCity(city) {
  return run(() => [...db.leagues.values()]
    .filter((l) => l.city === city)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(toLeagueSummary));
}

export async function get(id) {
  return run(() => {
    const league = db.leagues.get(id);
    return league ? toLeagueDetail(league) : null;
  });
}

export async function create({ city, skillLevel, seasonLabel } = {}) {
  return run(() => {
    if (!seasonLabel?.trim()) throw new ApiError('Anna kaudelle nimi, esim. "Syksy 2026".', { code: 'invalid' });
    const fail = 'Liigan luonti epäonnistui.';
    if (!city || !SKILL_ORDER.includes(skillLevel)) throw new ApiError(fail);
    const league = {
      id: newId('l'), city, skillLevel, seasonLabel: seasonLabel.trim(), groupSize: DEFAULT_GROUP_SIZE,
      status: 'signup', createdBy: ME, createdAt: nowIso(),
    };
    db.leagues.set(league.id, league);
    db.leagueMembers.push({ leagueId: league.id, userId: ME, groupNumber: null, joinedAt: league.createdAt });
    scheduleLeagueSignups(league.id);
    return league.id;
  });
}

export async function join(id) {
  return run(() => {
    const fail = 'Liigaan liittyminen epäonnistui.';
    const league = db.leagues.get(id);
    if (!league) throw dbError('Liigaa ei löytynyt', fail);
    if (league.status !== 'signup') throw dbError('Liigan ilmoittautuminen on päättynyt', fail);
    if (leagueMembers(id).some((m) => m.userId === ME)) return;
    db.leagueMembers.push({ leagueId: id, userId: ME, groupNumber: null, joinedAt: nowIso() });
  });
}

/** Even groups of at most groupSize, a round robin in each (sign-up order instead of random()). */
export async function start(id) {
  return run(() => {
    const fail = 'Kauden aloitus epäonnistui.';
    const league = db.leagues.get(id);
    if (!league) throw dbError('Liigaa ei löytynyt', fail);
    if (league.createdBy !== ME) throw dbError('Vain liigan perustaja voi aloittaa kauden', fail);
    if (league.status !== 'signup') throw dbError('Kausi on jo käynnissä', fail);
    const members = [...leagueMembers(id)].sort((a, b) => String(a.joinedAt).localeCompare(String(b.joinedAt)));
    if (members.length < 4) throw dbError('Vähintään 4 pelaajaa tarvitaan kauden aloittamiseen', fail);

    const groups = Math.ceil(members.length / league.groupSize);
    const base = Math.floor(members.length / groups);
    const extra = members.length % groups;
    let next = 0;
    for (let g = 1; g <= groups; g += 1) {
      const group = members.slice(next, next + base + (g <= extra ? 1 : 0));
      next += group.length;
      for (const m of group) m.groupNumber = g;
      roundRobin(group.map((m) => m.userId)).forEach(([a, b]) => {
        const fixture = { id: newId('f'), leagueId: id, groupNumber: g, playerAId: a, playerBId: b, result: null };
        db.fixtures.set(fixture.id, fixture);
      });
    }
    league.status = 'active';
  });
}

function myFixture(fixtureId, fail) {
  const fixture = db.fixtures.get(fixtureId);
  if (!fixture) throw dbError('Ottelua ei löytynyt', fail);
  if (fixture.playerAId !== ME && fixture.playerBId !== ME) throw dbError('Et ole tämän ottelun pelaaja', fail);
  return fixture;
}

export async function reportResult(fixtureId, sets, winnerId) {
  return run(() => {
    const fail = 'Tuloksen tallennus epäonnistui.';
    // The Supabase version looks the fixture up itself before calling the RPC.
    if (!db.fixtures.get(fixtureId)) throw new ApiError('Ottelua ei löytynyt.', { code: 'not_found' });
    const fixture = myFixture(fixtureId, fail);
    if (winnerId !== fixture.playerAId && winnerId !== fixture.playerBId) throw dbError('Virheellinen voittaja', fail);
    if (fixture.result?.confirmedBy) throw dbError('Tulos on jo vahvistettu', fail);
    const at = nowIso();
    fixture.result = {
      sets: (sets || []).map(({ a, b }) => ({ a: Number(a) || 0, b: Number(b) || 0 })),
      winnerId,
      reportedBy: ME,
      confirmedBy: null,
      confirmedAt: null,
      createdAt: at,
    };
    scheduleFixtureConfirmation(fixtureId);
  });
}

export async function confirmResult(fixtureId) {
  return run(() => {
    const fail = 'Tuloksen vahvistus epäonnistui.';
    const fixture = myFixture(fixtureId, fail);
    if (!fixture.result) throw dbError('Ei vahvistettavaa tulosta', fail);
    if (fixture.result.reportedBy === ME) throw dbError('Et voi vahvistaa omaa ilmoitustasi', fail);
    if (fixture.result.confirmedBy) return;
    fixture.result.confirmedBy = ME;
    fixture.result.confirmedAt = nowIso();
  });
}

export async function openFixtureChat(fixtureId) {
  return run(() => {
    const fixture = myFixture(fixtureId, 'Keskustelua ei voitu avata.');
    const other = fixture.playerAId === ME ? fixture.playerBId : fixture.playerAId;
    return findOrCreateDirect(other).id;
  });
}
