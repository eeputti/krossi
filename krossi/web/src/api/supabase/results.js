// results.js — match results (table match_results): my own log, and results other players
// logged with me as a Krossi player (their opponent or partner), which I confirm or dispute.
//
// match_results is readable by every signed-in user (results show on other people's
// profiles in the mobile app), so every query here must filter by me explicitly. The player
// links (opponent_id …) and the confirmation come with migration 20261017130234; until it is
// applied results save with typed names only and nothing waits for an answer.

import { db, requireUid, isUuid, isMissingColumn, isMissingFunction } from './client.js';
import { mapStoredResult } from './map.js';
import { loadLinkedResults, loadMyResults, peopleOfResults } from './history.js';
import { list as listPlayers, listPartners } from './players.js';
import { emit } from './notifications.js';
import { ApiError, toApiError, unwrap } from '../errors.js';
import { asksOpponent, canAnswer, linksOfInput, setsWonBy, viewResult } from '../../features/resultLinks.js';

const LINK_COLUMNS = ['partner_id', 'opponent_id', 'opp_partner_id'];

export async function listMine() {
  return loadMyResults(await requireUid());
}

function toRow(result, uid) {
  const sets = (result.sets || [])
    .map((s) => ({ my: Number(s.my) || 0, opp: Number(s.opp) || 0 }))
    .filter((s) => s.my > 0 || s.opp > 0);
  if (sets.length === 0) throw new ApiError('Lisää vähintään yhden erän tulos.', { code: 'invalid' });
  const { ids, error } = linksOfInput(result, uid);
  if (error || Object.values(ids).some((id) => id && !isUuid(id))) {
    throw new ApiError(error || 'Pelaajaa ei löytynyt. Kirjoita nimi itse.', { code: 'invalid' });
  }
  return {
    game_type: result.gameType,
    format: result.format,
    partner_name: result.partnerName?.trim() || null,
    opponent_name: result.opponentName?.trim() || null,
    opp_partner_name: result.oppPartnerName?.trim() || null,
    partner_id: ids.partnerId,
    opponent_id: ids.opponentId,
    opp_partner_id: ids.oppPartnerId,
    sets,
    won: typeof result.won === 'boolean' ? result.won : setsWonBy(sets),
  };
}

const withoutLinks = (row) => Object.fromEntries(Object.entries(row).filter(([key]) => !LINK_COLUMNS.includes(key)));
const missingLinks = (error) => LINK_COLUMNS.some((col) => isMissingColumn(error, col));

/**
 * Saves (id null = new). A linked opponent makes the result 'pending' (the database decides) and
 * is asked to confirm it — again after I change the score or the players.
 * -> { id, confirmation }
 */
export async function save(id, result) {
  const uid = await requireUid();
  const row = toRow(result, uid);
  const fail = 'Tuloksen tallennus epäonnistui.';
  const table = () => db().from('match_results');

  let before = null;
  if (id) {
    const prev = unwrap(await table().select('*').eq('id', id).eq('created_by', uid).maybeSingle(), fail);
    before = prev ? mapStoredResult(prev) : null;
  }
  const write = (payload) => (id
    ? table().update(payload).eq('id', id).eq('created_by', uid).select('*')
    : table().insert({ ...payload, created_by: uid }).select('*'));

  let { data, error } = await write(row);
  // Migration 20261017130234 not applied yet: keep saving the typed names.
  if (error && missingLinks(error)) ({ data, error } = await write(withoutLinks(row)));
  if (error) throw toApiError(error, fail);

  const saved = Array.isArray(data) ? data[0] : data;
  const after = saved ? mapStoredResult(saved) : null;
  if (after && asksOpponent(before, after)) emit({ type: 'match_result_logged', resultId: after.id, creatorId: uid });
  return { id: after?.id ?? id ?? null, confirmation: after?.confirmation ?? null };
}

export async function remove(id) {
  const uid = await requireUid();
  unwrap(await db().from('match_results').delete().eq('id', id).eq('created_by', uid), 'Tuloksen poisto epäonnistui.');
}

/** Who I can name in a result: pelikaverit and the players of my city (both need the paid profile access). */
export async function candidates({ city } = {}) {
  const [partners, players] = await Promise.all([listPartners(), listPlayers({ city })]);
  return { partners, players };
}

/** Results others logged with me on the other side, waiting for my answer, newest first. */
export async function listToConfirm() {
  const uid = await requireUid();
  const waiting = (await loadLinkedResults()).filter((l) => l.stored.confirmation === 'pending' && canAnswer(l.stored, uid));
  const people = await peopleOfResults(waiting.map((l) => l.stored), waiting.map((l) => l.creator));
  return waiting.map((l) => viewResult(l.stored, uid, people)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function answer(id, confirm) {
  await requireUid();
  if (!isUuid(id)) throw new ApiError('Tulosta ei löytynyt.', { code: 'not_found' });
  const { error } = await db().rpc('krossi_answer_match_result', { result_id_input: id, confirm_input: confirm });
  if (error) {
    if (isMissingFunction(error)) throw new ApiError('Tulosten vahvistus ei ole vielä käytössä.', { cause: error, code: 'unavailable' });
    throw toApiError(error, 'Vastauksen tallennus epäonnistui.');
  }
}

export const confirm = (id) => answer(id, true);
export const dispute = (id) => answer(id, false);
