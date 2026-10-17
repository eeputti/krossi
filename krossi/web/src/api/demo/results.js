// results.js (demo) — Alex's match results, mirroring api/supabase/results.js and the
// confirmation rules of migration 20261017130234 (the trigger + krossi_answer_match_result).

import { ApiError } from '../errors.js';
import { ME } from './rows.js';
import { run, newId } from './runtime.js';
import { db, nowIso } from './store.js';
import { linkedResults, matchResults } from './history.js';
import { toMatchResult } from './views.js';
import { dbError, notify, scheduleResultAnswer } from './actions.js';
import { list, listPartners } from './players.js';
import { asksOpponent, canAnswer, linksOfInput, setsWonBy } from '../../features/resultLinks.js';

const ANSWER_FIELDS = { confirmation: null, confirmedBy: null, confirmedAt: null, disputedBy: null, disputedAt: null };
const FACT_FIELDS = ['sets', 'won', 'gameType', 'format', 'opponentId', 'partnerId', 'oppPartnerId'];

export async function listMine() {
  return run(() => matchResults().slice(0, 100));
}

/** Same normalisation and validation as the Supabase toRow(). */
function toRow(result) {
  const sets = (result?.sets || [])
    .map((s) => ({ my: Number(s.my) || 0, opp: Number(s.opp) || 0 }))
    .filter((s) => s.my > 0 || s.opp > 0);
  if (sets.length === 0) throw new ApiError('Lisää vähintään yhden erän tulos.', { code: 'invalid' });
  const { ids, error } = linksOfInput(result, ME);
  if (error || Object.values(ids).some((id) => id && !db.profiles.has(id))) {
    throw new ApiError(error || 'Pelaajaa ei löytynyt. Kirjoita nimi itse.', { code: 'invalid' });
  }
  return {
    gameType: result.gameType,
    format: result.format,
    partnerName: result.partnerName?.trim() || null,
    opponentName: result.opponentName?.trim() || null,
    oppPartnerName: result.oppPartnerName?.trim() || null,
    ...ids,
    sets,
    won: typeof result.won === 'boolean' ? result.won : setsWonBy(sets),
  };
}

/** The database trigger: a linked opponent means 'pending'; new facts clear the old answer. */
function pendingIfLinked(row) {
  return { ...ANSWER_FIELDS, confirmation: row.opponentId || row.oppPartnerId ? 'pending' : null };
}

export async function save(id, result) {
  return run(() => {
    const row = toRow(result);
    if (id) {
      // An update that matches no row of mine changes nothing, like `.eq('created_by', uid)`.
      const existing = db.results.get(id);
      if (!existing || existing.createdBy !== ME) return { id, confirmation: null };
      const before = { ...existing };
      const changed = FACT_FIELDS.some((f) => JSON.stringify(existing[f]) !== JSON.stringify(row[f]));
      Object.assign(existing, row, changed ? pendingIfLinked(row) : {});
      if (asksOpponent(before, existing)) askOpponent(existing);
      return { id, confirmation: existing.confirmation };
    }
    const created = { id: newId('r'), createdAt: nowIso(), createdBy: ME, ...row, ...pendingIfLinked(row) };
    db.results.set(created.id, created);
    if (asksOpponent(null, created)) askOpponent(created);
    return { id: created.id, confirmation: created.confirmation };
  });
}

function askOpponent(row) {
  notify({ type: 'match_result_logged', resultId: row.id, creatorId: ME });
  scheduleResultAnswer(row.id);
}

export async function remove(id) {
  return run(() => {
    if (db.results.get(id)?.createdBy === ME) db.results.delete(id);
  });
}

export async function candidates({ city } = {}) {
  const [partners, players] = await Promise.all([listPartners(), list({ city })]);
  return { partners, players };
}

export async function listToConfirm() {
  return run(() => linkedResults()
    .filter((r) => r.confirmation === 'pending' && canAnswer(r, ME))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((r) => toMatchResult(r)));
}

function answer(id, confirm) {
  return run(() => {
    const row = db.results.get(id);
    if (!row || !canAnswer(row, ME)) throw dbError('Vain tuloksen vastustaja voi vastata tähän tulokseen', 'Vastauksen tallennus epäonnistui.');
    const at = nowIso();
    Object.assign(row, confirm
      ? { ...ANSWER_FIELDS, confirmation: 'confirmed', confirmedBy: ME, confirmedAt: at }
      : { ...ANSWER_FIELDS, confirmation: 'disputed', disputedBy: ME, disputedAt: at });
  });
}

export const confirm = (id) => answer(id, true);
export const dispute = (id) => answer(id, false);
