// results.js — my own match result log (table match_results).
//
// match_results is readable by every signed-in user (results show on other people's
// profiles), so every query here must filter created_by = me explicitly.

import { db, requireUid } from './client.js';
import { mapMatchResult, setsWon } from './map.js';
import { ApiError, unwrap } from '../errors.js';

export async function listMine() {
  const uid = await requireUid();
  const rows = unwrap(
    await db().from('match_results').select('*').eq('created_by', uid).order('created_at', { ascending: false }).limit(100),
    'Tuloksia ei voitu ladata.',
  );
  return (rows || []).map(mapMatchResult);
}

function toRow(result) {
  const sets = (result.sets || [])
    .map((s) => ({ my: Number(s.my) || 0, opp: Number(s.opp) || 0 }))
    .filter((s) => s.my > 0 || s.opp > 0);
  if (sets.length === 0) throw new ApiError('Lisää vähintään yhden erän tulos.', { code: 'invalid' });
  return {
    game_type: result.gameType,
    format: result.format,
    partner_name: result.partnerName?.trim() || null,
    opponent_name: result.opponentName?.trim() || null,
    opp_partner_name: result.oppPartnerName?.trim() || null,
    sets,
    won: typeof result.won === 'boolean' ? result.won : setsWon(sets),
  };
}

export async function save(id, result) {
  const uid = await requireUid();
  const row = toRow(result);
  const fail = 'Tuloksen tallennus epäonnistui.';
  if (id) {
    unwrap(await db().from('match_results').update(row).eq('id', id).eq('created_by', uid), fail);
  } else {
    unwrap(await db().from('match_results').insert({ ...row, created_by: uid }), fail);
  }
}

export async function remove(id) {
  const uid = await requireUid();
  unwrap(await db().from('match_results').delete().eq('id', id).eq('created_by', uid), 'Tuloksen poisto epäonnistui.');
}
