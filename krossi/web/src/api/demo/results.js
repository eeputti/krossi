// results.js (demo) — Alex's own match result log, mirroring api/supabase/results.js.

import { ApiError } from '../errors.js';
import { run, newId } from './runtime.js';
import { db, nowIso } from './store.js';
import { matchResults } from './history.js';

const setsWon = (sets) => sets.filter((s) => s.my > s.opp).length > sets.filter((s) => s.opp > s.my).length;

export async function listMine() {
  return run(() => matchResults().slice(0, 100));
}

/** Same normalisation and validation as the Supabase toRow(). */
function toRow(result) {
  const sets = (result?.sets || [])
    .map((s) => ({ my: Number(s.my) || 0, opp: Number(s.opp) || 0 }))
    .filter((s) => s.my > 0 || s.opp > 0);
  if (sets.length === 0) throw new ApiError('Lisää vähintään yhden erän tulos.', { code: 'invalid' });
  return {
    gameType: result.gameType,
    format: result.format,
    partnerName: result.partnerName?.trim() || null,
    opponentName: result.opponentName?.trim() || null,
    oppPartnerName: result.oppPartnerName?.trim() || null,
    sets,
    won: typeof result.won === 'boolean' ? result.won : setsWon(sets),
  };
}

export async function save(id, result) {
  return run(() => {
    const row = toRow(result);
    if (id) {
      // An update that matches no row of mine changes nothing, like `.eq('created_by', uid)`.
      const existing = db.results.get(id);
      if (existing) Object.assign(existing, row);
      return;
    }
    const created = { id: newId('r'), createdAt: nowIso(), ...row };
    db.results.set(created.id, created);
  });
}

export async function remove(id) {
  return run(() => {
    db.results.delete(id);
  });
}
