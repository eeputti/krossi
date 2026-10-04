// invites.js — personal invite links (krossi.app/pelaa/kutsu/<code>).
//
// The RPCs come from a new migration. resolve and claim run on public / onboarding paths,
// so a not-yet-deployed RPC must never break them: they degrade to "no invite".

import { db, requireUid, isMissingFunction } from './client.js';
import { ApiError, toApiError } from '../errors.js';

export async function myCode() {
  await requireUid();
  const { data, error } = await db().rpc('krossi_my_invite_code');
  if (error && isMissingFunction(error)) {
    throw new ApiError('Kutsulinkit eivät ole vielä käytössä. Kokeile myöhemmin uudelleen.', { cause: error, code: 'unavailable' });
  }
  if (error) throw toApiError(error, 'Kutsulinkkiä ei voitu luoda.');
  return String(data);
}

/** Works without a session (the invite page is public). */
export async function resolve(code) {
  const trimmed = String(code || '').trim();
  if (!trimmed) return null;
  const { data, error } = await db().rpc('krossi_resolve_invite', { code_input: trimmed });
  if (error && isMissingFunction(error)) {
    console.warn('krossi_resolve_invite puuttuu vielä tietokannasta', error);
    return null;
  }
  if (error) throw toApiError(error, 'Kutsua ei voitu tarkistaa.');
  return data ? { inviterName: data.inviter_name || 'Pelaaja' } : null;
}

/** The RPC itself silently ignores invalid, own and already-claimed codes. */
export async function claim(code) {
  const trimmed = String(code || '').trim();
  if (!trimmed) return;
  await requireUid();
  const { error } = await db().rpc('krossi_claim_invite', { code_input: trimmed });
  if (error && isMissingFunction(error)) {
    console.warn('krossi_claim_invite puuttuu vielä tietokannasta', error);
    return;
  }
  if (error) throw toApiError(error, 'Kutsun kirjaus epäonnistui.');
}
