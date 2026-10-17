// wallet.js — saldo, sarjakortit and lahjakortit: the hall's series cards for sale, ordering them,
// gift cards and saldo top-ups, paying for an order with the same Stripe checkout as bookings
// (krossi-billing edge function: orderConfig / orderIntent / orderVerify), the unused top-ups back
// to the card (saldoRefund), redeeming a gift card's code, paying a held booking with a series card
// or the saldo (RPCs; the database keeps the ledger), and the hall's own products and gift card
// limits (Hallin asetukset).

import { db, isMissingFunction, isUuid, requireUid } from './client.js';
import {
  announceConfirmed, call, callOrEmpty, edgeCall, fail, list, mapBooking, mapBooker, number, rpcError, text,
} from './bookingCore.js';
import { mapGift, mapGiftCard, mapPass, mapProduct, mapStaffProduct, mapTopUp, mapTopUpRules, mapWallet } from './hallMaps.js';

const FUNCTION = 'krossi-billing';
const LOAD_FAIL = 'Kortteja ei voitu ladata.';
const ORDER_FAIL = 'Tilaus epäonnistui. Yritä hetken päästä uudelleen.';
const SETTINGS_FAIL = 'Tallennus epäonnistui. Yritä hetken päästä uudelleen.';
const CHECKOUT_FAIL = 'Maksun aloitus epäonnistui. Yritä hetken päästä uudelleen.';
const PAY_FAIL = 'Maksu epäonnistui. Yritä hetken päästä uudelleen.';

const edge = (action, payload, fallback) => edgeCall(FUNCTION, action, payload, fallback);

function orderArgs(order) {
  const kind = order?.kind;
  if ((kind !== 'pass' && kind !== 'gift' && kind !== 'topup') || !isUuid(order?.id)) throw fail('Tilausta ei löytynyt.');
  return { kind, id: order.id };
}

// ── Shop ─────────────────────────────────────────────────────────────────────

/**
 * Series cards for sale, the gift card amounts and the saldo's top-ups. Works without a session;
 * empty (gift null) while the phase-2 migration is not deployed, topup null before the saldo one.
 */
export async function products(venueId) {
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  const { data, error } = await db().rpc('krossi_wallet_products', { venue_id_input: venueId });
  if (error) {
    if (isMissingFunction(error)) return { passes: [], gift: null, topup: null };
    throw rpcError(error, LOAD_FAIL);
  }
  return { passes: list(data?.passes).map(mapProduct), gift: mapGift(data?.gift), topup: mapTopUpRules(data?.topup) };
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

/** A saldo top-up of 25 / 50 / 100 € at the hall, 'pending' until paid like a card (kind 'topup'). */
export async function topUp({ venueId, amountCents } = {}) {
  await requireUid();
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  const data = await call('krossi_wallet_topup', {
    venue_id_input: venueId,
    amount_cents_input: Number.isInteger(amountCents) ? amountCents : null,
  }, ORDER_FAIL);
  return mapTopUp(data);
}

/** The unused top-ups of my saldo at the hall back to their cards (krossi-billing saldoRefund). */
export async function refundToCard(venueId) {
  await requireUid();
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  const data = await edge('saldoRefund', { venueId }, 'Palautus kortille epäonnistui. Yritä hetken päästä uudelleen.');
  return { refundedCents: number(data?.refundedCents), feeCents: number(data?.feeCents) };
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
  const booking = mapBooking(await call('krossi_wallet_pay_booking', { booking_id_input: bookingId, pass_id_input: passId }, PAY_FAIL));
  if (booking.status === 'confirmed') announceConfirmed(booking.id);
  return booking;
}

export async function useGift(bookingId, use = true) {
  await requireUid();
  if (!isUuid(bookingId)) throw fail('Varausta ei löytynyt.');
  const booking = mapBooking(await call('krossi_wallet_use_gift', { booking_id_input: bookingId, use_input: use !== false }, PAY_FAIL));
  if (booking.status === 'confirmed') announceConfirmed(booking.id);
  return booking;
}

// ── Hall staff ───────────────────────────────────────────────────────────────

export async function staffList(venueId) {
  await requireUid();
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  const data = await callOrEmpty('krossi_wallet_staff_list', { venue_id_input: venueId }, LOAD_FAIL, { passes: [], giftCards: [] });
  return {
    passes: list(data?.passes).map((p) => ({ ...mapPass(p), owner: mapBooker(p.owner) })),
    giftCards: list(data?.giftCards).map((g) => ({
      ...mapGiftCard(g), buyer: mapBooker(g.buyer), redeemedBy: mapBooker(g.redeemedBy),
    })),
  };
}

// ── Hallin asetukset: products and gift cards ────────────────────────────────

const intOrNull = (value) => (Number.isInteger(value) ? value : null);

/** Products for sale and hidden ones + the gift card settings; empty before the migration. */
export async function staffProducts(venueId) {
  await requireUid();
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  const data = await callOrEmpty('krossi_wallet_staff_products', { venue_id_input: venueId }, LOAD_FAIL, { passes: [], gift: null });
  return { passes: list(data?.passes).map(mapStaffProduct), gift: mapGift(data?.gift) };
}

/** A new product (id null) or changes; the RPC checks it like features/seasons.js checkPassProduct. */
export async function saveProduct({
  id = null, venueId, name, sport, uses, minutesPerUse, validDays, priceCents, description = null, active = true,
} = {}) {
  await requireUid();
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  if (id !== null && id !== undefined && !isUuid(id)) throw fail('Sarjakorttia ei löytynyt.');
  const data = await call('krossi_wallet_save_product', {
    product_id_input: id || null,
    venue_id_input: venueId,
    name_input: typeof name === 'string' ? name : '',
    sport_input: typeof sport === 'string' ? sport : null,
    uses_input: intOrNull(uses),
    minutes_per_use_input: intOrNull(minutesPerUse),
    valid_days_input: intOrNull(validDays),
    price_cents_input: intOrNull(priceCents),
    description_input: typeof description === 'string' ? description : null,
    active_input: active !== false,
  }, SETTINGS_FAIL);
  return mapStaffProduct(data);
}

export async function removeProduct(productId) {
  await requireUid();
  if (!isUuid(productId)) throw fail('Sarjakorttia ei löytynyt.');
  await call('krossi_wallet_remove_product', { product_id_input: productId }, 'Poisto epäonnistui. Yritä hetken päästä uudelleen.');
}

export async function saveGiftSettings(venueId, { amounts = [], minCents, maxCents, validDays } = {}) {
  await requireUid();
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  const data = await call('krossi_wallet_save_gift_settings', {
    venue_id_input: venueId,
    amounts_input: list(amounts).map(intOrNull),
    min_cents_input: intOrNull(minCents),
    max_cents_input: intOrNull(maxCents),
    valid_days_input: intOrNull(validDays),
  }, SETTINGS_FAIL);
  return mapGift(data);
}
