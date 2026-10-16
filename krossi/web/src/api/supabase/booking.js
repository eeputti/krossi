// booking.js — kenttävaraus (court booking): the hall calendar, holds, paying for a booking,
// cancelling it, jaettu maksu (friends pay their shares), "Laita myyntiin" (a late-cancelled
// booking sold on), "ilmoita kun vapautuu" watches and the hall staff view.
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
  DATE_RE, announceFreed, call, edgeCall, fail, iso, linePerson, list, listOrNull, mapBooker, mapBooking, mapCredit,
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
const SHARE_FAIL = 'Osuuden tietoja ei voitu ladata.';

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
    // Only the phase 4 server (20261016130000_krossi_booking_split_and_resale) sends it: without
    // it there are no split payments or resale to offer.
    shareDeadlineHours: raw.shareDeadlineHours == null ? null : number(raw.shareDeadlineHours, 2),
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

function mapShare(raw) {
  return {
    id: raw.id,
    kind: raw.kind,
    cents: number(raw.cents),
    status: raw.status,
    paidAt: iso(raw.paidAt),
    deadline: iso(raw.deadline),
    payable: raw.payable === true,
    chargeError: text(raw.chargeError),
    booker: linePerson(raw.booker),
    booking: mapBooking(raw.booking || {}),
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
    unpaidCents: number(raw.unpaidCents),
    parts: numberOrNull(raw.parts),
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

/** friendIds (jaettu maksu): 1 for kaksinpeli, 3 for nelinpeli; the server checks who counts as a pelikaveri. */
export async function hold({ courtId, startsAt, minutes, friendIds = [] } = {}) {
  await requireUid();
  if (!isUuid(courtId)) throw fail('Kenttää ei löytynyt.');
  const start = iso(startsAt);
  if (!start) throw fail('Valitse aika kalenterista.', 'invalid');
  const friends = list(friendIds);
  if (friends.some((id) => !isUuid(id))) throw fail('Voit jakaa maksun vain pelikavereidesi kanssa.', 'invalid');
  const args = {
    court_id_input: courtId,
    starts_at_input: start,
    minutes_input: minutesOrNull(minutes),
  };
  if (friends.length) args.friend_ids_input = friends;
  return mapBooking(await call('krossi_hold_booking', args, HOLD_FAIL));
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
    // 'off_session': a split booking saves the card for the rest (the Elements must say the same)
    setupFutureUsage: data.setupFutureUsage === 'off_session' ? 'off_session' : null,
  };
}

/** { paid: true } when nothing is left to pay, else what the Payment Element needs (split: my part). */
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

/** Pelikaverit and chat contacts to split with; [] while the migration isn't deployed. */
export async function shareFriends() {
  await requireUid();
  const { data, error } = await db().rpc('krossi_booking_share_friends', {});
  if (error) {
    if (isMissingFunction(error)) return [];
    throw rpcError(error, 'Pelikavereita ei voitu ladata.');
  }
  return list(data).map(mapBooker).filter(Boolean);
}

/** Shares I owe or owed; [] while the migration isn't deployed (the bell asks for these too). */
export async function listShares() {
  await requireUid();
  const { data, error } = await db().rpc('krossi_booking_my_shares', {});
  if (error) {
    if (isMissingFunction(error)) return [];
    throw rpcError(error, SHARE_FAIL);
  }
  return list(data).map(mapShare);
}

/** My share or one of my own booking's; null when there is none (or the phase 4 migration isn't deployed). */
export async function getShare(shareId) {
  await requireUid();
  if (!isUuid(shareId)) return null;
  const { data, error } = await db().rpc('krossi_booking_share', { share_id_input: shareId });
  if (error) {
    if (isMissingFunction(error)) return null;
    throw rpcError(error, SHARE_FAIL);
  }
  return data ? mapShare(data) : null;
}

export async function shareCheckoutConfig(shareId) {
  await requireUid();
  if (!isUuid(shareId)) throw fail('Osuutta ei löytynyt.');
  return mapCheckout(await edge('shareConfig', { shareId }, CHECKOUT_FAIL));
}

export async function createSharePaymentIntent(shareId) {
  await requireUid();
  if (!isUuid(shareId)) throw fail('Osuutta ei löytynyt.');
  const data = await edge('shareIntent', { shareId }, CHECKOUT_FAIL);
  if (data?.paid) return { paid: true };
  if (!data?.clientSecret) throw fail(CHECKOUT_FAIL);
  return { clientSecret: data.clientSecret, paymentIntentId: data.paymentIntentId };
}

/**
 * Asks Stripe (server-side) whether my share's payment went through. status 'refunded' means the
 * share was settled meanwhile (the booker's card covered it, or the booking was cancelled) and
 * this payment went back — `message` says which.
 */
export async function verifySharePayment(shareId, paymentIntentId) {
  await requireUid();
  if (!isUuid(shareId)) throw fail('Osuutta ei löytynyt.');
  const data = await edge('shareVerify', { shareId, paymentIntentId }, VERIFY_FAIL);
  const result = { paid: data?.paid === true, status: text(data?.status) };
  if (typeof data?.error === 'string' && data.error) result.message = data.error;
  return result;
}

export async function declineShare(shareId) {
  await requireUid();
  if (!isUuid(shareId)) throw fail('Osuutta ei löytynyt.');
  await call('krossi_booking_decline_share', { share_id_input: shareId }, 'Viestin lähetys epäonnistui. Yritä hetken päästä uudelleen.');
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
