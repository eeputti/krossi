// wallet.js — sarjakortit and lahjakortit: the hall's series cards for sale, ordering them and gift
// cards, paying for an order with the same Stripe checkout as bookings (krossi-billing edge
// function: orderConfig / orderIntent / orderVerify), redeeming a gift card's code, and paying a
// held booking with a series card or the gift balance (RPCs; the database keeps the ledger).

import { db, isMissingFunction, isUuid, requireUid } from './client.js';
import { call, edgeCall, fail, list, mapBooking, mapBooker, number, rpcError, text } from './bookingCore.js';
import { mapGiftCard, mapPass, mapProduct, mapWallet } from './hallMaps.js';

const FUNCTION = 'krossi-billing';
const LOAD_FAIL = 'Kortteja ei voitu ladata.';
const ORDER_FAIL = 'Tilaus epäonnistui. Yritä hetken päästä uudelleen.';
const CHECKOUT_FAIL = 'Maksun aloitus epäonnistui. Yritä hetken päästä uudelleen.';
const PAY_FAIL = 'Maksu epäonnistui. Yritä hetken päästä uudelleen.';

const edge = (action, payload, fallback) => edgeCall(FUNCTION, action, payload, fallback);

function orderArgs(order) {
  const kind = order?.kind;
  if ((kind !== 'pass' && kind !== 'gift') || !isUuid(order?.id)) throw fail('Tilausta ei löytynyt.');
  return { kind, id: order.id };
}

// ── Shop ─────────────────────────────────────────────────────────────────────

/**
 * Series cards for sale and the gift card amounts. Works without a session; empty (gift null)
 * while the phase-2 migration is not deployed.
 */
export async function products(venueId) {
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  const { data, error } = await db().rpc('krossi_wallet_products', { venue_id_input: venueId });
  if (error) {
    if (isMissingFunction(error)) return { passes: [], gift: null };
    throw rpcError(error, LOAD_FAIL);
  }
  const gift = data?.gift;
  return {
    passes: list(data?.passes).map(mapProduct),
    gift: gift ? {
      amounts: list(gift.amounts).map((n) => number(n)).filter((n) => n > 0),
      minCents: number(gift.minCents, 1000),
      maxCents: number(gift.maxCents, 30000),
      validDays: number(gift.validDays, 365),
    } : null,
  };
}

export async function get(venueId) {
  await requireUid();
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  const { data, error } = await db().rpc('krossi_wallet', { venue_id_input: venueId });
  if (error) {
    if (isMissingFunction(error)) return mapWallet(null, venueId);
    throw rpcError(error, LOAD_FAIL);
  }
  return mapWallet(data, venueId);
}

export async function buyPass(productId) {
  await requireUid();
  if (!isUuid(productId)) throw fail('Sarjakorttia ei löytynyt.');
  return mapPass(await call('krossi_wallet_buy_pass', { product_id_input: productId }, ORDER_FAIL));
}

export async function buyGiftCard({ venueId, amountCents, recipientName = null, message = null } = {}) {
  await requireUid();
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  const data = await call('krossi_wallet_buy_gift', {
    venue_id_input: venueId,
    amount_cents_input: Number.isInteger(amountCents) ? amountCents : null,
    recipient_name_input: typeof recipientName === 'string' ? recipientName : null,
    message_input: typeof message === 'string' ? message : null,
  }, ORDER_FAIL);
  return mapGiftCard(data);
}

export async function checkoutConfig(order) {
  await requireUid();
  const data = await edge('orderConfig', orderArgs(order), CHECKOUT_FAIL);
  if (data?.paid) return { paid: true };
  if (!data?.publishableKey) throw fail(CHECKOUT_FAIL);
  return { publishableKey: data.publishableKey, amount: number(data.amount), currency: text(data.currency, 'eur'), email: text(data.email) };
}

export async function createPaymentIntent(order) {
  await requireUid();
  const data = await edge('orderIntent', orderArgs(order), CHECKOUT_FAIL);
  if (data?.paid) return { paid: true };
  if (!data?.clientSecret) throw fail(CHECKOUT_FAIL);
  return { clientSecret: data.clientSecret, paymentIntentId: data.paymentIntentId };
}

/** Asks Stripe (server-side) whether the order was paid; activates the pass / issues the code. */
export async function verifyPayment(order, paymentIntentId) {
  await requireUid();
  const data = await edge('orderVerify', { ...orderArgs(order), paymentIntentId }, 'Maksun tarkistus epäonnistui. Päivitä sivu hetken päästä.');
  return { paid: data?.paid === true, status: text(data?.status) };
}

export async function redeem(code) {
  await requireUid();
  const data = await call('krossi_wallet_redeem', { code_input: typeof code === 'string' ? code : '' }, 'Lunastus epäonnistui. Yritä hetken päästä uudelleen.');
  if (!data?.ok) throw fail(text(data?.error, 'Koodia ei löytynyt. Tarkista kirjoitusasu.'), text(data?.code) || undefined);
  return { venueId: data.venueId, cents: number(data.cents), giftCents: number(data.giftCents) };
}

// ── Paying a booking with credit ─────────────────────────────────────────────

export async function payBooking(bookingId, passId) {
  await requireUid();
  if (!isUuid(bookingId)) throw fail('Varausta ei löytynyt.');
  if (!isUuid(passId)) throw fail('Sarjakorttia ei löytynyt.');
  return mapBooking(await call('krossi_wallet_pay_booking', { booking_id_input: bookingId, pass_id_input: passId }, PAY_FAIL));
}

export async function useGift(bookingId, use = true) {
  await requireUid();
  if (!isUuid(bookingId)) throw fail('Varausta ei löytynyt.');
  return mapBooking(await call('krossi_wallet_use_gift', { booking_id_input: bookingId, use_input: use !== false }, PAY_FAIL));
}

// ── Hall staff ───────────────────────────────────────────────────────────────

export async function staffList(venueId) {
  await requireUid();
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  const data = await call('krossi_wallet_staff_list', { venue_id_input: venueId }, LOAD_FAIL);
  return {
    passes: list(data?.passes).map((p) => ({ ...mapPass(p), owner: mapBooker(p.owner) })),
    giftCards: list(data?.giftCards).map((g) => ({
      ...mapGiftCard(g), buyer: mapBooker(g.buyer), redeemedBy: mapBooker(g.redeemedBy),
    })),
  };
}
