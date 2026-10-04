// social.js (demo) — blocking and reporting, mirroring api/supabase/social.js.

import { ApiError } from '../errors.js';
import { ME } from './rows.js';
import { run, newId } from './runtime.js';
import { db, nowIso, isBlocked, profileOf } from './store.js';
import { blockedRows } from './views.js';
import { notify } from './actions.js';

export async function listBlocked() {
  return run(blockedRows);
}

export async function block(userId) {
  return run(() => {
    if (!userId || userId === ME || !profileOf(userId)) throw new ApiError('Esto epäonnistui.');
    // Unique (blocker, blocked): blocking twice is not an error for the user.
    if (isBlocked(userId)) return;
    const row = { rowId: newId('b'), userId, createdAt: nowIso() };
    db.blocks.set(row.rowId, row);
  });
}

export async function unblock(rowId) {
  return run(() => {
    db.blocks.delete(rowId);
  });
}

export async function report(userId, reason) {
  return run(() => {
    const text = String(reason || '').trim();
    if (!text) throw new ApiError('Kerro lyhyesti, mikä on vialla.', { code: 'invalid' });
    // reports_check (reporter <> reported) and the profile foreign key
    if (!userId || userId === ME || !profileOf(userId)) throw new ApiError('Ilmoituksen lähetys epäonnistui.');
    const row = { id: newId('rep'), reporterId: ME, reportedId: userId, reason: text, createdAt: nowIso() };
    db.reports.push(row);
    notify({ type: 'account_report', reportId: row.id, reporterId: ME, reportedId: userId });
  });
}
