// booking.js — kenttävaraus (court booking): the hall calendar, holds, paying for a booking,
// cancelling it, jaettu maksu (the booker pays it all, friends pay their parts by link and the
// booker gets them back), "Laita myyntiin" (a late-cancelled booking sold on), "ilmoita kun
// vapautuu" watches and the hall staff view.
//
// The booking tables have no client access: every read and write is a SECURITY DEFINER RPC
// (supabase/migrations/20261016074110_krossi_court_booking.sql and
// 20261016130000_krossi_booking_split_and_resale.sql), and money only moves in the
// krossi-booking edge function (Stripe Payment Element, refunds). The RPCs already answer in the
// contract's shapes (camelCase, ISO strings); the mappers below pin the types down so a missing
// field never reaches a screen as undefined, and turn a booker's avatar path into a URL.
//
// The booking RPCs and the edge function raise Finnish messages written for players; bookingCore.js
// passes them through as-is with the same error codes the demo backend uses ('taken', 'expired',
// 'too_late', 'forbidden', 'not_found', 'free', 'cancellable', 'buyer_paying', 'closed',
// 'cancelled', …) and holds the mappers seasons.js, billing.js and wallet.js share with this file
// (Booking with its series card / gift credit and its split).

import { db, requireUid, isMissingFunction, isUuid } from './client.js';
import {
  DATE_RE, announceFreed, call, edgeCall, fail, iso, list, listOrNull, mapBooker, mapBooking, mapCredit,
  number, numberOrNull, rpcError, text,
} from './bookingCore.js';

const FUNCTION = 'krossi-booking';
const LOAD_FAIL = 'Varauksia ei voitu ladata.';
const HOLD_FAIL = 'Varaus epäonnistui. Yritä hetken päästä uudelleen.';
const CHECKOUT_FAIL = 'Maksun aloitus epäonnistui. Yritä hetken päästä uudelleen.';
const VERIFY_FAIL = 'Maksun tarkistus epäonnistui. Päivitä sivu hetken päästä.';
const CANCEL_FAIL = 'Peruutus epäonnistui. Yritä hetken päästä uudelleen.';
const WATCH_FAIL = 'Hälytyksen tallennus epäonnistui.';
const STAFF_FAIL = 'Hallin tietoja ei voitu ladata.';
const SALE_FAIL = 'Myyntiin laitto epäonnistui. Yritä hetken päästä uudelleen.';
const SPLIT_FAIL = 'Maksun jako epäonnistui. Yritä hetken päästä uudelleen.';
const LINK_FAIL = 'Maksulinkkiä ei voitu avata. Yritä hetken päästä uudelleen.';
const LINK_NOT_FOUND = 'Maksulinkkiä ei löytynyt. Pyydä varaajalta uusi linkki.';

const edge = (action, payload, fallback) => edgeCall(FUNCTION, action, payload, fallback);

// ── Mapping ──────────────────────────────────────────────────────────────────

function mapCourt(raw) {
  return {
    id: raw.id,
    locationId: raw.locationId,
    name: text(raw.name, ''),
    shortName: text(raw.shortName, text(raw.name, '')),
    sport: raw.sport,
    surface: text(raw.surface),
    mapId: text(raw.mapId),
  };
}

function mapLocation(raw) {
  return {
    id: raw.id,
    name: text(raw.name, ''),
    address: text(raw.address),
    indoor: raw.indoor !== false,
    mapKey: text(raw.mapKey),
    lat: numberOrNull(raw.lat),
    lng: numberOrNull(raw.lng),
    courts: list(raw.courts).map(mapCourt),
  };
}

function mapPrice(raw) {
  return {
    sports: listOrNull(raw.sports),
    courtIds: listOrNull(raw.courtIds),
    weekdays: list(raw.weekdays).map(Number),
    from: text(raw.from, '00:00'),
    until: text(raw.until, '24:00'),
    centsPerHour: number(raw.centsPerHour),
  };
}

function mapVenue(raw) {
  const deal = raw.lastMinute;
  return {
    id: raw.id,
    slug: text(raw.slug, ''),
    name: text(raw.name, ''),
    city: text(raw.city, ''),
    openFrom: text(raw.openFrom, '06:00'),
    openUntil: text(raw.openUntil, '23:00'),
    slotMinutes: number(raw.slotMinutes, 30),
    durations: list(raw.durations).map(Number),
    daysAhead: number(raw.daysAhead, 14),
    cancelLimitHours: number(raw.cancelLimitHours, 24),
    // Only the phase 4 server (20261016130000_krossi_booking_split_and_resale) says true: before
    // it there are no split payments or resale to offer.
    splitPay: raw.splitPay === true,
    resale: raw.resale === true,
    holdMinutes: number(raw.holdMinutes, 10),
    payOnline: raw.payOnline !== false,
    lastMinute: deal && number(deal.hours) > 0 && number(deal.percent) > 0
      ? { hours: number(deal.hours), percent: number(deal.percent) }
      : null,
    isStaff: raw.isStaff === true,
    locations: list(raw.locations).map(mapLocation),
    prices: list(raw.prices).map(mapPrice),
  };
}

function mapBusy(raw) {
  return {
    id: raw.id,
    courtId: raw.courtId,
    startsAt: iso(raw.startsAt),
    endsAt: iso(raw.endsAt),
    kind: raw.kind,
    mine: raw.mine === true,
    title: text(raw.title),
    forSale: raw.forSale === true,
  };
}

function mapPublicSplit(raw) {
  const state = ['open', 'full', 'over', 'cancelled'].includes(raw.state) ? raw.state : 'open';
  return {
    token: text(raw.token, ''),
    venueName: text(raw.venueName, ''),
    locationName: text(raw.locationName, ''),
    courtName: text(raw.courtName, 'Kenttä'),
    sport: text(raw.sport, 'tennis'),
    startsAt: iso(raw.startsAt),
    endsAt: iso(raw.endsAt),
    bookerFirstName: text(raw.bookerFirstName, 'Kaverisi'),
    bookerAvatarUrl: text(raw.bookerAvatarUrl),
    parts: number(raw.parts, 2),
    perCents: number(raw.perCents),
    paidCount: number(raw.paidCount),
    openCount: number(raw.openCount),
    state,
  };
}

function mapStaffItem(raw) {
  return {
    id: raw.id,
    courtId: raw.courtId,
    startsAt: iso(raw.startsAt),
    endsAt: iso(raw.endsAt),
    kind: raw.kind,
    status: raw.status,
    title: text(raw.title),
    bookedBy: mapBooker(raw.bookedBy),
    priceCents: number(raw.priceCents),
    paymentStatus: raw.paymentStatus,
    seasonSlotId: text(raw.seasonSlotId),
    credit: mapCredit(raw.credit),
    forSale: raw.forSale === true,
  };
}

function mapWatch(raw) {
  return {
    id: raw.id,
    venueId: raw.venueId,
    sport: raw.sport,
    locationId: text(raw.locationId),
    startsAt: iso(raw.startsAt),
    minutes: number(raw.minutes),
    notifiedAt: iso(raw.notifiedAt),
    createdAt: iso(raw.createdAt),
  };
}

const minutesOrNull = (value) => {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
};

// ── Public calendar (works without a session) ────────────────────────────────

export async function listVenues() {
  const { data, error } = await db().rpc('krossi_booking_venues', {});
  if (error) {
    // Booking isn't deployed yet (migration not applied): no venues, the app hides the feature.
    if (isMissingFunction(error)) return [];
    throw rpcError(error, LOAD_FAIL);
  }
  return list(data).map(mapVenue);
}

/** By id or by slug (/pelaa/varaa/<slug>); null when there is no such venue or it is hidden. */
export async function getVenue(idOrSlug) {
  const key = typeof idOrSlug === 'string' ? idOrSlug.trim() : '';
  if (!key) return null;
  const venues = await listVenues();
  if (isUuid(key)) return venues.find((v) => v.id.toLowerCase() === key.toLowerCase()) || null;
  return venues.find((v) => v.slug === key.toLowerCase()) || null;
}

export async function day(venueId, date) {
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  if (!DATE_RE.test(String(date))) throw fail('Valitse päivä kalenterista.', 'invalid');
  const data = await call('krossi_booking_day', { venue_id_input: venueId, day_input: date }, LOAD_FAIL);
  return { date: text(data?.date, date), busy: list(data?.busy).map(mapBusy) };
}

// ── Booking and paying ───────────────────────────────────────────────────────

export async function hold({ courtId, startsAt, minutes } = {}) {
  await requireUid();
  if (!isUuid(courtId)) throw fail('Kenttää ei löytynyt.');
  const start = iso(startsAt);
  if (!start) throw fail('Valitse aika kalenterista.', 'invalid');
  return mapBooking(await call('krossi_hold_booking', {
    court_id_input: courtId,
    starts_at_input: start,
    minutes_input: minutesOrNull(minutes),
  }, HOLD_FAIL));
}

export async function release(bookingId) {
  await requireUid();
  if (!isUuid(bookingId)) throw fail('Varausta ei löytynyt.');
  await call('krossi_release_booking', { booking_id_input: bookingId }, 'Varauksen vapautus epäonnistui.');
  announceFreed(bookingId);
}

/** What the Payment Element needs, from a krossi-booking config answer. */
function mapCheckout(data) {
  if (data?.paid) return { paid: true };
  if (!data?.publishableKey) throw fail(CHECKOUT_FAIL);
  return {
    publishableKey: data.publishableKey,
    amount: number(data.amount),
    currency: text(data.currency, 'eur'),
    email: text(data.email),
  };
}

/**
 * What the booking sheet needs to show the payment methods before anything is held. A server
 * without the action (krossi-booking before phase 4) answers { legacy: true }: hold first, then
 * checkoutConfig(bookingId), like before.
 */
export async function payConfig() {
  await requireUid();
  try {
    const data = await edge('payConfig', {}, CHECKOUT_FAIL);
    if (!data?.publishableKey) return { legacy: true };
    return { publishableKey: data.publishableKey, currency: text(data.currency, 'eur'), email: text(data.email) };
  } catch (err) {
    if (/tuntematon toiminto/i.test(err?.userMessage || err?.message || '')) return { legacy: true };
    throw err;
  }
}

/** { paid: true } when nothing is left to pay, else what the Payment Element needs. */
export async function checkoutConfig(bookingId) {
  await requireUid();
  if (!isUuid(bookingId)) throw fail('Varausta ei löytynyt.');
  return mapCheckout(await edge('config', { bookingId }, CHECKOUT_FAIL));
}

/** { paid: true } if already paid, else the PaymentIntent (an unfinished one is reused). */
export async function createPaymentIntent(bookingId) {
  await requireUid();
  if (!isUuid(bookingId)) throw fail('Varausta ei löytynyt.');
  const data = await edge('intent', { bookingId }, CHECKOUT_FAIL);
  if (data?.paid) return { paid: true };
  if (!data?.clientSecret) throw fail(CHECKOUT_FAIL);
  return { clientSecret: data.clientSecret, paymentIntentId: data.paymentIntentId };
}

/**
 * Asks Stripe (server-side) whether the payment went through and confirms the booking if so.
 * status is Stripe's ('succeeded', 'processing', 'requires_payment_method', …), or 'lost' when
 * the hold ran out and somebody else took the court meanwhile — the payment was refunded then,
 * and `message` says so.
 */
export async function verifyPayment(bookingId, paymentIntentId) {
  await requireUid();
  if (!isUuid(bookingId)) throw fail('Varausta ei löytynyt.');
  const data = await edge('verify', { bookingId, paymentIntentId }, VERIFY_FAIL);
  const result = { confirmed: data?.confirmed === true, status: text(data?.status) };
  if (typeof data?.error === 'string' && data.error) result.message = data.error;
  return result;
}

export async function listMine() {
  await requireUid();
  const data = await call('krossi_my_bookings', {}, LOAD_FAIL);
  return { upcoming: list(data?.upcoming).map(mapBooking), past: list(data?.past).map(mapBooking) };
}

/**
 * Cancels my confirmed booking before cancellableUntil. Everything paid goes back to where it came
 * from (friends' shares to the friends, credit to the series card / gift balance); refundedCents is
 * the money that comes back to me, creditCents / creditMinutes the credit.
 */
export async function cancel(bookingId) {
  await requireUid();
  if (!isUuid(bookingId)) throw fail('Varausta ei löytynyt.');
  const data = await edge('cancel', { bookingId }, CANCEL_FAIL);
  return {
    refundedCents: number(data?.refundedCents),
    creditCents: number(data?.creditCents),
    creditMinutes: number(data?.creditMinutes),
  };
}

// ── Laita myyntiin ───────────────────────────────────────────────────────────

/** Puts my booking on sale (after the free cancellation); the people waiting for that time are told. */
export async function putOnSale(bookingId) {
  await requireUid();
  if (!isUuid(bookingId)) throw fail('Varausta ei löytynyt.');
  const data = await call('krossi_booking_put_on_sale', { booking_id_input: bookingId }, SALE_FAIL);
  announceFreed(bookingId);
  return mapBooking(data);
}

export async function takeOffSale(bookingId) {
  await requireUid();
  if (!isUuid(bookingId)) throw fail('Varausta ei löytynyt.');
  return mapBooking(await call('krossi_booking_take_off_sale', { booking_id_input: bookingId }, 'Myynnin peruminen epäonnistui.'));
}

// ── Jaettu maksu ─────────────────────────────────────────────────────────────

// ── Jaettu maksu: the link ───────────────────────────────────────────────────

/** Splits my paid booking in 2 or 4 parts (1 = no split); the answer carries the link's token. */
export async function split(bookingId, parts) {
  await requireUid();
  if (!isUuid(bookingId)) throw fail('Varausta ei löytynyt.');
  const n = Number(parts);
  if (![1, 2, 4].includes(n)) throw fail('Valitse kaksin- tai nelinpeli.', 'invalid');
  return mapBooking(await call('krossi_split_booking', { p_booking_id: bookingId, p_parts: n }, SPLIT_FAIL));
}

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** What a payment link shows; works without a session. null = no such link (or no phase 4 yet). */
export async function splitPublic(token) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const { data, error } = await db().rpc('krossi_split_public', { p_token: token });
  if (error) {
    if (isMissingFunction(error)) return null;
    throw rpcError(error, LINK_FAIL);
  }
  return data ? mapPublicSplit(data) : null;
}

export async function splitCheckoutConfig(token) {
  if (!TOKEN_RE.test(String(token || ''))) throw fail(LINK_NOT_FOUND, 'not_found');
  const data = await edge('splitConfig', { token }, CHECKOUT_FAIL);
  if (data?.full) return { full: true };
  if (data?.over) return { over: true };
  if (!data?.publishableKey) throw fail(CHECKOUT_FAIL);
  return { publishableKey: data.publishableKey, amount: number(data.amount), currency: text(data.currency, 'eur') };
}

/** Claims one open part for 15 minutes and returns its PaymentIntent; `name` shows to the booker. */
export async function createSplitPaymentIntent(token, { name = '' } = {}) {
  if (!TOKEN_RE.test(String(token || ''))) throw fail(LINK_NOT_FOUND, 'not_found');
  const data = await edge('splitIntent', { token, name: String(name || '').trim().slice(0, 40) }, CHECKOUT_FAIL);
  if (data?.paid) return { paid: true };
  if (data?.full) return { full: true };
  if (!data?.clientSecret) throw fail(CHECKOUT_FAIL);
  return { clientSecret: data.clientSecret, paymentIntentId: data.paymentIntentId };
}

/**
 * Asks Stripe (server-side) whether the part went through; then its sum goes back to the booker.
 * status 'refunded' + message: the booking was cancelled or sold meanwhile and this payment went back.
 */
export async function verifySplitPayment(token, paymentIntentId) {
  if (!TOKEN_RE.test(String(token || ''))) throw fail(LINK_NOT_FOUND, 'not_found');
  const data = await edge('splitVerify', { token, paymentIntentId }, VERIFY_FAIL);
  return { paid: data?.paid === true, status: text(data?.status, 'unknown'), message: text(data?.message) };
}

// ── Ilmoita kun vapautuu ─────────────────────────────────────────────────────

export async function watch({ venueId, sport, locationId = null, startsAt, minutes } = {}) {
  await requireUid();
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  if (locationId !== null && locationId !== undefined && !isUuid(locationId)) throw fail('Kenttää ei löytynyt.');
  const start = iso(startsAt);
  if (!start) throw fail('Valitse aika kalenterista.', 'invalid');
  const data = await call('krossi_booking_watch', {
    venue_id_input: venueId,
    sport_input: typeof sport === 'string' ? sport : null,
    location_id_input: locationId || null,
    starts_at_input: start,
    minutes_input: minutesOrNull(minutes),
  }, WATCH_FAIL);
  return mapWatch(data);
}

export async function unwatch(watchId) {
  await requireUid();
  if (!isUuid(watchId)) return; // nothing to remove, like an unknown id
  await call('krossi_booking_unwatch', { watch_id_input: watchId }, 'Hälytyksen poisto epäonnistui.');
}

export async function listWatches() {
  await requireUid();
  return list(await call('krossi_booking_my_watches', {}, LOAD_FAIL)).map(mapWatch);
}

// ── Hall staff ───────────────────────────────────────────────────────────────

export async function staffDay(venueId, date) {
  await requireUid();
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  if (!DATE_RE.test(String(date))) throw fail('Valitse päivä kalenterista.', 'invalid');
  const data = await call('krossi_booking_staff_day', { venue_id_input: venueId, day_input: date }, STAFF_FAIL);
  return list(data).map(mapStaffItem);
}

/** Blocks the courts for [startsAt, endsAt) — all or nothing. Returns the new ids in court order. */
export async function block({ courtIds, startsAt, endsAt, title, kind = 'block' } = {}) {
  await requireUid();
  const ids = [...new Set(list(courtIds).filter(isUuid))];
  if (ids.length === 0) throw fail('Valitse ainakin yksi kenttä.', 'invalid');
  const from = iso(startsAt);
  const to = iso(endsAt);
  if (!from || !to) throw fail('Valitse aika kalenterista.', 'invalid');
  const data = await call('krossi_booking_block', {
    court_ids_input: ids,
    starts_at_input: from,
    ends_at_input: to,
    title_input: typeof title === 'string' ? title : '',
    kind_input: kind,
  }, 'Eston tallennus epäonnistui.');
  return list(data).map(String);
}

export async function unblock(blockId) {
  await requireUid();
  if (!isUuid(blockId)) throw fail('Estoa ei löytynyt.');
  await call('krossi_booking_unblock', { block_id_input: blockId }, 'Eston poisto epäonnistui.');
  announceFreed(blockId);
}

/** Hall staff cancels a player's booking; refund (default) returns the money to the player. */
export async function staffCancel(bookingId, { refund = true } = {}) {
  await requireUid();
  if (!isUuid(bookingId)) throw fail('Varausta ei löytynyt.');
  await edge('staffCancel', { bookingId, refund: refund !== false }, CANCEL_FAIL);
}
