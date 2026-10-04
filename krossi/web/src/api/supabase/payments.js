// payments.js — the one-off 8,99 € unlock (Stripe Checkout via the stripe-checkout function).

import { requireUid, invokeFunction, rpc } from './client.js';
import { ApiError } from '../errors.js';

const CHECKOUT_FAIL = 'Maksun aloitus epäonnistui. Yritä hetken päästä uudelleen.';

export async function startCheckout() {
  await requireUid();
  const data = await invokeFunction('stripe-checkout', { method: 'POST' }, CHECKOUT_FAIL);
  if (!data?.url) throw new ApiError(typeof data?.error === 'string' ? data.error : CHECKOUT_FAIL);
  window.location.assign(data.url);
}

/** Admins can flip their own account between paid and unpaid to test both experiences. */
export async function adminSetOwnPaid(paid) {
  await requireUid();
  await rpc('krossi_set_own_paid_status', { p_paid: Boolean(paid) }, 'Maksutilan vaihto epäonnistui.');
}
