// payments.js (demo) — Alex has already paid; checkout resolves without going anywhere.

import { run } from './runtime.js';
import { dbError } from './actions.js';

export async function startCheckout() {
  await run(() => undefined);
}

/** krossi_set_own_paid_status raises 'not allowed' for non-admins; Alex is not one. */
export async function adminSetOwnPaid() {
  return run(() => {
    throw dbError('not allowed', 'Maksutilan vaihto epäonnistui.');
  });
}
