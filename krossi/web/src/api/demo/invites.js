// invites.js (demo) — Alex's personal invite link. Codes are case-insensitive like
// krossi_resolve_invite; claiming is silently ignored (an own code, in production).

import { run } from './runtime.js';
import { db, me } from './store.js';

export async function myCode() {
  return run(() => db.inviteCode);
}

export async function resolve(code) {
  return run(() => {
    const normalized = String(code || '').trim().toUpperCase();
    if (!normalized || normalized !== db.inviteCode) return null;
    return { inviterName: (me()?.name || '').trim().split(' ')[0] || 'Pelaaja' };
  });
}

export async function claim() {
  await run(() => undefined);
}
