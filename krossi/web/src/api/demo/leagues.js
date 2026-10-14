// leagues.js (demo) — city leagues with the rules and messages of the league RPCs
// (create_league / krossi_create_league, join_league, start_league, krossi_start_league_round,
// krossi_close_league_round, report/confirm results, the krossi_admin_* result tools, delete,
// finish, leave). Sets are `{a, b}` with `a` = player A's games. Alex manages the leagues Alex
// created (demo Alex is no Krossi moderator).

import { ApiError } from '../errors.js';
import { SKILL_ORDER } from '../../lib/constants.js';
import { ME } from './rows.js';
import { run, newId } from './runtime.js';
import { db, nowIso, leagueMembers, leagueFixtures, leagueRounds } from './store.js';
import { toLeagueSummary, toLeagueDetail } from './views.js';
import { roundRobin } from './seed.js';
import {
  dbError, findOrCreateDirect, scheduleLeagueSignups, scheduleFixtureConfirmation,
} from './actions.js';

const DEFAULT_GROUP_SIZE = 6; // leagues.group_size default
const HALL_GROUP_SIZE = 5;

const leagueOf = (id, fail) => {
  const league = db.leagues.get(id);
  if (!league) throw dbError('Liigaa ei löytynyt', fail);
  return league;
};
const canManage = (league) => league.createdBy === ME;
const requireManager = (league, raw, fail) => { if (!canManage(league)) throw dbError(raw, fail); };
const activeRound = (league) => leagueRounds(league.id).find((r) => r.status === 'active') || null;
const memberRow = (leagueId, userId) => db.leagueMembers.find((m) => m.leagueId === leagueId && m.userId === userId) || null;
const dropMember = (row) => { db.leagueMembers = db.leagueMembers.filter((m) => m !== row); };

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

/** Same as the public RPC: only public leagues, "Etunimi S.", no photos, confirmed results only. */
export async function publicGet(id) {
  return run(() => {
    const league = db.leagues.get(id);
    if (!league?.isPublic) return null;
    const detail = toLeagueDetail(league);
    const shorten = (p) => {
      const [first, last] = String(p.name || 'Pelaaja').trim().split(/\s+/);
      return { ...p, name: last ? `${first} ${last[0]}.` : first, avatarUrl: null, skillLevel: null, ageRange: null };
    };
    return {
      ...detail,
      canManage: false,
      iAmMember: false,
      organizer: shorten(detail.organizer),
      members: detail.members.map(shorten),
      fixtures: detail.fixtures.map((f) => ({
        ...f, playerA: shorten(f.playerA), playerB: shorten(f.playerB), result: f.result?.confirmedBy ? f.result : null,
      })),
    };
  });
}

export async function create(input = {}) {
  return run(() => {
    const { city, skillLevel, seasonLabel } = input;
    if (!seasonLabel?.trim()) throw new ApiError('Anna kaudelle nimi, esim. "Syksy 2026".', { code: 'invalid' });
    const hall = input.format === 'hallisarja';
    const fail = hall ? 'Sarjan luonti epäonnistui.' : 'Liigan luonti epäonnistui.';
    if (!city || !(SKILL_ORDER.includes(skillLevel) || (hall && skillLevel === 'kaikki'))) throw new ApiError(fail);
    const groupSize = hall ? (input.groupSize ?? HALL_GROUP_SIZE) : DEFAULT_GROUP_SIZE;
    if (groupSize < 3 || groupSize > 10) throw new ApiError(fail);
    const league = {
      id: newId('l'), city, skillLevel, seasonLabel: seasonLabel.trim(), groupSize,
      status: 'signup', createdBy: ME, createdAt: nowIso(),
      format: hall ? 'hallisarja' : 'ladder',
      matchFormat: hall && input.matchFormat !== 'sets' ? 'timed' : 'sets',
      currentRound: 0,
      isPublic: hall && Boolean(input.isPublic),
      venue: hall ? input.venue?.trim() || null : null,
      description: hall ? input.description?.trim() || null : null,
    };
    db.leagues.set(league.id, league);
    if (hall) {
      (input.rounds || []).forEach((r, i) => {
        db.leagueRounds.push({ leagueId: league.id, roundNumber: i + 1, startsOn: r.startsOn, endsOn: r.endsOn, status: 'planned' });
      });
    }
    if (!hall || input.organizerPlays) {
      db.leagueMembers.push({ leagueId: league.id, userId: ME, groupNumber: null, joinedAt: league.createdAt, continues: true });
    }
    scheduleLeagueSignups(league.id);
    return league.id;
  });
}

export async function update(id, { seasonLabel, description, venue, isPublic } = {}) {
  return run(() => {
    const fail = 'Tietojen tallennus epäonnistui.';
    const league = leagueOf(id, fail);
    requireManager(league, 'Vain liigan ylläpitäjä voi muokata liigaa', fail);
    if (!seasonLabel?.trim()) throw new ApiError('Anna kaudelle nimi.', { code: 'invalid' });
    Object.assign(league, {
      seasonLabel: seasonLabel.trim(), description: description?.trim() || null, venue: venue?.trim() || null, isPublic: Boolean(isPublic),
    });
  });
}

export async function remove(id) {
  return run(() => {
    const fail = 'Liigan poisto epäonnistui.';
    const league = leagueOf(id, fail);
    requireManager(league, 'Vain liigan ylläpitäjä tai Krossin moderaattori voi poistaa liigan', fail);
    for (const f of leagueFixtures(id)) db.fixtures.delete(f.id);
    db.leagueMembers = db.leagueMembers.filter((m) => m.leagueId !== id);
    db.leagueRounds = db.leagueRounds.filter((r) => r.leagueId !== id);
    db.leagues.delete(id);
  });
}

export async function finish(id) {
  return run(() => {
    const fail = 'Kauden päättäminen epäonnistui.';
    const league = leagueOf(id, fail);
    requireManager(league, 'Vain liigan ylläpitäjä voi päättää kauden', fail);
    if (league.status === 'finished') return;
    if (league.status === 'signup') throw dbError('Kausi ei ole vielä alkanut', fail);
    leagueRounds(id).forEach((r) => { if (r.status === 'active') r.status = 'completed'; });
    league.status = 'finished';
  });
}

export async function join(id) {
  return run(() => {
    const fail = 'Liigaan liittyminen epäonnistui.';
    const league = leagueOf(id, fail);
    if (league.status === 'finished' || (league.status === 'active' && league.format !== 'hallisarja')) {
      throw dbError('Liigan ilmoittautuminen on päättynyt', fail);
    }
    if (leagueMembers(id).some((m) => m.userId === ME)) return;
    db.leagueMembers.push({ leagueId: id, userId: ME, groupNumber: null, joinedAt: nowIso(), continues: true });
  });
}

export async function leave(id) {
  return run(() => {
    const fail = 'Ilmoittautumisen peruminen epäonnistui.';
    const league = leagueOf(id, fail);
    const row = memberRow(id, ME);
    if (!row) return;
    if (league.status !== 'signup' && row.groupNumber != null) {
      if (league.format !== 'hallisarja') throw dbError('Kausi on jo käynnissä, joten et voi enää poistua liigasta', fail);
      if (activeRound(league)) throw dbError('Kierros on vielä käynnissä. Merkitse, ettet jatka seuraavalla kierroksella', fail);
    }
    dropMember(row);
  });
}

export async function setContinues(id, continues) {
  return run(() => {
    const row = memberRow(id, ME);
    if (!row) throw dbError('Et ole tämän sarjan pelaaja', 'Tallennus epäonnistui.');
    row.continues = Boolean(continues);
  });
}

export async function removeMember(id, userId) {
  return run(() => {
    const fail = 'Pelaajan poisto epäonnistui.';
    const league = leagueOf(id, fail);
    requireManager(league, 'Vain liigan ylläpitäjä voi poistaa pelaajia', fail);
    const row = memberRow(id, userId);
    if (!row) return;
    if (league.status === 'active' && row.groupNumber != null && (league.format !== 'hallisarja' || activeRound(league))) {
      throw dbError('Pelaaja on mukana kesken olevassa lohkossa. Kirjaa hänen jäljellä olevat ottelunsa luovutuksiksi ja poista hänet kierroksen jälkeen', fail);
    }
    dropMember(row);
  });
}

function addRoundRobin(league, round, group, ids) {
  roundRobin(ids).forEach(([a, b]) => {
    const fixture = { id: newId('f'), leagueId: league.id, roundNumber: round, groupNumber: group, playerAId: a, playerBId: b, result: null };
    db.fixtures.set(fixture.id, fixture);
  });
}

/** Even groups of at most groupSize, a round robin in each (sign-up order instead of random()). */
export async function start(id) {
  return run(() => {
    const fail = 'Kauden aloitus epäonnistui.';
    const league = leagueOf(id, fail);
    if (league.createdBy !== ME) throw dbError('Vain liigan perustaja voi aloittaa kauden', fail);
    if (league.format === 'hallisarja') throw dbError('Hallisarjan lohkot jaetaan Krossin selainversiossa (krossi.app/pelaa)', fail);
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
      addRoundRobin(league, 1, g, group.map((m) => m.userId));
    }
    league.status = 'active';
    league.currentRound = 1;
  });
}

export async function startRound(id, groups, { startsOn, endsOn } = {}) {
  return run(() => {
    const fail = 'Kierroksen aloitus epäonnistui.';
    const league = leagueOf(id, fail);
    requireManager(league, 'Vain sarjan ylläpitäjä voi aloittaa kierroksen', fail);
    if (league.format !== 'hallisarja') throw dbError('Kierrokset ovat käytössä vain hallisarjoissa', fail);
    if (league.status === 'finished') throw dbError('Kausi on jo päättynyt', fail);
    if (activeRound(league)) throw dbError('Edellinen kierros on vielä kesken — päätä se ensin', fail);
    if (!startsOn || !endsOn || endsOn < startsOn) throw new ApiError('Tarkista kierroksen päivämäärät.', { code: 'invalid' });
    const clean = (groups || []).map((g) => (g || []).filter(Boolean)).filter((g) => g.length > 0);
    if (clean.length === 0) throw new ApiError('Jaa pelaajat vähintään yhteen lohkoon.', { code: 'invalid' });
    if (clean.some((g) => g.length < 2)) throw new ApiError('Jokaisessa lohkossa pitää olla vähintään 2 pelaajaa.', { code: 'invalid' });
    if (clean.some((g) => g.length > 10)) throw dbError('Lohkossa voi olla enintään 10 pelaajaa', fail);
    const all = clean.flat();
    if (new Set(all).size !== all.length) throw new ApiError('Sama pelaaja on kahdessa lohkossa.', { code: 'invalid' });
    if (all.some((uid) => !memberRow(id, uid))) throw dbError('Lohkoissa on pelaaja, joka ei ole enää sarjassa — päivitä näkymä', fail);

    const n = (league.currentRound || 0) + 1;
    leagueMembers(id).forEach((m) => { m.groupNumber = null; });
    clean.forEach((ids, i) => {
      ids.forEach((uid) => { const m = memberRow(id, uid); m.groupNumber = i + 1; m.continues = true; });
      addRoundRobin(league, n, i + 1, ids);
    });
    const planned = leagueRounds(id).find((r) => r.roundNumber === n);
    if (planned) Object.assign(planned, { startsOn, endsOn, status: 'active' });
    else db.leagueRounds.push({ leagueId: id, roundNumber: n, startsOn, endsOn, status: 'active' });
    league.status = 'active';
    league.currentRound = n;
    return n;
  });
}

export async function closeRound(id) {
  return run(() => {
    const fail = 'Kierroksen päättäminen epäonnistui.';
    const league = leagueOf(id, fail);
    requireManager(league, 'Vain sarjan ylläpitäjä voi päättää kierroksen', fail);
    const round = leagueRounds(id).find((r) => r.roundNumber === league.currentRound && r.status === 'active');
    if (!round) throw dbError('Kierros ei ole käynnissä', fail);
    round.status = 'completed';
    leagueFixtures(id).filter((f) => f.roundNumber === round.roundNumber && f.result && !f.result.confirmedBy).forEach((f) => {
      f.result.confirmedBy = f.result.reportedBy === f.playerAId ? f.playerBId : f.playerAId;
      f.result.confirmedAt = nowIso();
      f.result.setByAdmin = true;
    });
  });
}

function myFixture(fixtureId, fail) {
  const fixture = db.fixtures.get(fixtureId);
  if (!fixture) throw dbError('Ottelua ei löytynyt', fail);
  if (fixture.playerAId !== ME && fixture.playerBId !== ME) throw dbError('Et ole tämän ottelun pelaaja', fail);
  return fixture;
}

const roundIsOpen = (league, fixture) => leagueRounds(league.id)
  .some((r) => r.roundNumber === (fixture.roundNumber || 1) && r.status === 'active');

export async function reportResult(fixtureId, sets, winnerId) {
  return run(() => {
    const fail = 'Tuloksen tallennus epäonnistui.';
    // The Supabase version looks the fixture up itself before calling the RPC.
    if (!db.fixtures.get(fixtureId)) throw new ApiError('Ottelua ei löytynyt.', { code: 'not_found' });
    const fixture = myFixture(fixtureId, fail);
    const league = db.leagues.get(fixture.leagueId);
    if (league.status !== 'active') throw dbError('Kausi ei ole käynnissä', fail);
    if (league.format === 'hallisarja' && !roundIsOpen(league, fixture)) throw dbError('Kierros on päättynyt — pyydä ylläpitäjää kirjaamaan tulos', fail);
    if (fixture.result?.confirmedBy) throw dbError('Tulos on jo vahvistettu', fail);
    const clean = (sets || []).map(({ a, b }) => ({ a: Number(a) || 0, b: Number(b) || 0 }));
    let winner = winnerId;
    if (league.matchFormat === 'timed') {
      if (clean.length !== 1) throw dbError('Aikapelissä kirjataan vain tunnin aikana pelatut geimit', fail);
      const [{ a, b }] = clean;
      winner = a > b ? fixture.playerAId : b > a ? fixture.playerBId : null;
    } else if (winner !== fixture.playerAId && winner !== fixture.playerBId) {
      throw dbError('Virheellinen voittaja', fail);
    }
    const at = nowIso();
    fixture.result = {
      sets: clean, winnerId: winner, reportedBy: ME, confirmedBy: null, confirmedAt: null, createdAt: at, walkover: false, setByAdmin: false,
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

function managedFixture(fixtureId, raw, fail) {
  const fixture = db.fixtures.get(fixtureId);
  if (!fixture) throw dbError('Ottelua ei löytynyt', fail);
  const league = db.leagues.get(fixture.leagueId);
  requireManager(league, raw, fail);
  return { fixture, league };
}

export async function adminSetResult(fixtureId, { sets = null, winnerId = null, walkover = false } = {}) {
  return run(() => {
    const fail = 'Tuloksen tallennus epäonnistui.';
    const { fixture, league } = managedFixture(fixtureId, 'Vain liigan ylläpitäjä voi kirjata tuloksia', fail);
    if (league.status === 'signup') throw dbError('Kausi ei ole vielä alkanut', fail);
    if (winnerId && winnerId !== fixture.playerAId && winnerId !== fixture.playerBId) throw dbError('Virheellinen voittaja', fail);
    let clean;
    let winner = winnerId || null;
    if (walkover) {
      if (!winner) throw new ApiError('Valitse, kumpi voitti luovutuksella.', { code: 'invalid' });
      clean = [winner === fixture.playerAId ? { a: 6, b: 0 } : { a: 0, b: 6 }];
    } else {
      clean = (sets || []).map(({ a, b }) => ({ a: Number(a) || 0, b: Number(b) || 0 }));
      if (clean.length < 1 || clean.length > 5) throw new ApiError(fail);
      if (league.matchFormat === 'timed') {
        if (clean.length !== 1) throw dbError('Aikapelissä kirjataan vain pelatut geimit', fail);
        const [{ a, b }] = clean;
        winner = a > b ? fixture.playerAId : b > a ? fixture.playerBId : null;
      } else if (!winner) {
        throw dbError('Tasapeli on mahdollinen vain aikapelissä', fail);
      }
    }
    const at = nowIso();
    fixture.result = {
      sets: clean, winnerId: winner, reportedBy: fixture.playerAId, confirmedBy: fixture.playerBId,
      confirmedAt: at, createdAt: at, walkover: Boolean(walkover), setByAdmin: true,
    };
  });
}

export async function adminConfirmResult(fixtureId) {
  return run(() => {
    const fail = 'Tuloksen vahvistus epäonnistui.';
    const { fixture } = managedFixture(fixtureId, 'Vain liigan ylläpitäjä voi vahvistaa tuloksia', fail);
    if (!fixture.result) throw dbError('Ei vahvistettavaa tulosta', fail);
    if (fixture.result.confirmedBy) return;
    fixture.result.confirmedBy = fixture.result.reportedBy === fixture.playerAId ? fixture.playerBId : fixture.playerAId;
    fixture.result.confirmedAt = nowIso();
    fixture.result.setByAdmin = true;
  });
}

export async function adminClearResult(fixtureId) {
  return run(() => {
    const { fixture } = managedFixture(fixtureId, 'Vain liigan ylläpitäjä voi poistaa tuloksia', 'Tuloksen poisto epäonnistui.');
    fixture.result = null;
  });
}

export async function openFixtureChat(fixtureId) {
  return run(() => {
    const fixture = myFixture(fixtureId, 'Keskustelua ei voitu avata.');
    const other = fixture.playerAId === ME ? fixture.playerBId : fixture.playerAId;
    return findOrCreateDirect(other).id;
  });
}
