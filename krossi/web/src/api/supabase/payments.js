// payments.js — the one-off 8,99 € unlock. Paid in-app (krossi-payment: Stripe Payment Element +
// Apple Pay / Google Pay / MobilePay), or on Stripe's hosted Checkout page (stripe-checkout) when
// the in-app checkout isn't configured.

import { requireUid, invokeFunction, rpc } from './client.js';
import { ApiError } from '../errors.js';

const CHECKOUT_FAIL = 'Maksun aloitus epäonnistui. Yritä hetken päästä uudelleen.';

/** Redirects to Stripe's hosted Checkout page. */
export async function startCheckout() {
  await requireUid();
  const data = await invokeFunction('stripe-checkout', { method: 'POST' }, CHECKOUT_FAIL);
  if (!data?.url) throw new ApiError(typeof data?.error === 'string' ? data.error : CHECKOUT_FAIL);
  window.location.assign(data.url);
}

/** What the in-app checkout needs: { paid } | { hosted } | { publishableKey, amount, currency, email }. */
export async function checkoutConfig() {
  await requireUid();
  const data = await invokeFunction('krossi-payment', { body: { action: 'config' } }, CHECKOUT_FAIL);
  if (data?.paid) return { paid: true };
  if (data?.hosted) return { hosted: true };
  if (!data?.publishableKey) throw new ApiError(CHECKOUT_FAIL);
  return { publishableKey: data.publishableKey, amount: data.amount, currency: data.currency, email: data.email || null };
}

/** { paid: true } if already paid, else the PaymentIntent to confirm with Stripe.js. */
export async function createPaymentIntent() {
  await requireUid();
  const data = await invokeFunction('krossi-payment', { body: { action: 'intent' } }, CHECKOUT_FAIL);
  if (data?.paid) return { paid: true };
  if (!data?.clientSecret) throw new ApiError(CHECKOUT_FAIL);
  return { clientSecret: data.clientSecret, paymentIntentId: data.paymentIntentId };
}

/** Asks Stripe (server-side) whether the payment went through and unlocks the profile if so. */
export async function verifyPayment(paymentIntentId) {
  await requireUid();
  const data = await invokeFunction('krossi-payment', { body: { action: 'verify', paymentIntentId } },
    'Maksun tarkistus epäonnistui. Päivitä sivu hetken päästä.');
  return { paid: Boolean(data?.paid), status: data?.status || null };
}

/** Admins can flip their own account between paid and unpaid to test both experiences. */
export async function adminSetOwnPaid(paid) {
  await requireUid();
  await rpc('krossi_set_own_paid_status', { p_paid: Boolean(paid) }, 'Maksutilan vaihto epäonnistui.');
}
