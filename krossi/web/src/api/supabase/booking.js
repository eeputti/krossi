// booking.js — kenttävaraus (court booking): the hall calendar, holds, paying for a booking,
// cancelling it, "ilmoita kun vapautuu" watches and the hall staff view.
//
// The booking tables have no client access: every read and write is a SECURITY DEFINER RPC
// (supabase/migrations/20261014200000_krossi_court_booking.sql), and money only moves in the
// krossi-booking edge function (Stripe Payment Element, refunds). The RPCs already answer in the
// contract's shapes (camelCase, ISO strings); the mappers below pin the types down so a missing
// field never reaches a screen as undefined, and turn a booker's avatar path into a URL.
//
// The booking RPCs and the edge function raise Finnish messages written for players
// ('Valitse varauksen kesto.', 'Varauksen pitoaika ehti umpeutua…'). toApiError() only trusts
// raw messages that contain ä/ö/å, so those are passed through here as-is, with the same error
// codes the demo backend uses ('taken', 'expired', 'too_late', 'forbidden', 'not_found', 'free').

import { db, requireUid, invokeFunction, isMissingFunction, isUuid } from './client.js';
import { mapPerson } from './map.js';
import { ApiError, toApiError } from '../errors.js';

const FUNCTION = 'krossi-booking';
const LOAD_FAIL = 'Varauksia ei voitu ladata.';
const HOLD_FAIL = 'Varaus epäonnistui. Yritä hetken päästä uudelleen.';
const CHECKOUT_FAIL = 'Maksun aloitus epäonnistui. Yritä hetken päästä uudelleen.';
const VERIFY_FAIL = 'Maksun tarkistus epäonnistui. Päivitä sivu hetken päästä.';
const CANCEL_FAIL = 'Peruutus epäonnistui. Yritä hetken päästä uudelleen.';
const WATCH_FAIL = 'Hälytyksen tallennus epäonnistui.';
const STAFF_FAIL = 'Hallin tietoja ei voitu ladata.';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Errors ───────────────────────────────────────────────────────────────────

const CODES = [
  [/^Joku ehti varata/, 'taken'],
  [/^Aika ei ole vapaa/, 'taken'],
  [/^Varauksen pitoaika ehti umpeutua/, 'expired'],
  [/^Aika ehti mennä toiselle/, 'lost'],
  [/^Peruutusaika on mennyt/, 'too_late'],
  [/^Vain hallin henkilökunta/, 'forbidden'],
  [/^Aika on vapaana/, 'free'],
  [/^Kirjaudu /, 'auth_required'],
  [/ei löytynyt\.$/, 'not_found'],
];

function codeFor(message) {
  return CODES.find(([re]) => re.test(message))?.[1] ?? null;
}

const fail = (message, code = codeFor(message)) => new ApiError(message, code ? { code } : undefined);

/** `raise exception '<suomeksi>'` in our booking RPCs arrives as SQLSTATE P0001. */
function rpcError(error, fallback) {
  const message = typeof error?.message === 'string' ? error.message.trim() : '';
  if (error?.code === 'P0001' && message && message.length <= 200) {
    return new ApiError(message, { cause: error, code: codeFor(message) });
  }
  return toApiError(error, fallback);
}

async function call(name, args, fallback) {
  const { data, error } = await db().rpc(name, args);
  if (error) throw rpcError(error, fallback);
  return data;
}

/**
 * Calls krossi-booking. invokeFunction keeps the function's own `{ error }` text as the cause of
 * the ApiError it throws (an Error whose own cause is the HTTP error); every krossi-booking error
 * is written for players, so it is shown as-is.
 */
async function edge(action, payload, fallback) {
  try {
    return await invokeFunction(FUNCTION, { body: { action, ...payload } }, fallback);
  } catch (err) {
    const detail = err?.cause instanceof Error && err.cause.cause ? err.cause.message : '';
    if (detail) throw new ApiError(detail, { cause: err.cause, code: codeFor(detail) });
    throw err;
  }
}

/**
 * A court freed up (hold released, block removed): krossi-booking emails the people waiting
 * for it. Fire and forget — the release itself already succeeded, so this never throws.
 */
function announceFreed(reservationId) {
  invokeFunction(FUNCTION, { body: { action: 'freed', bookingId: reservationId } })
    .catch((err) => console.warn('Vapautuneen vuoron ilmoitus epäonnistui', err));
}

// ── Mapping ──────────────────────────────────────────────────────────────────

const text = (value, fallback = null) => (typeof value === 'string' && value !== '' ? value : fallback);
const number = (value, fallback = 0) => {
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
};
const numberOrNull = (value) => (value === null || value === undefined || value === '' ? null : number(value, null));

function iso(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

const list = (value) => (Array.isArray(value) ? value : []);
const listOrNull = (value) => (Array.isArray(value) ? [...value] : null);

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
  };
}

function mapBooking(raw) {
  return {
    id: raw.id,
    venueId: raw.venueId,
    venueName: text(raw.venueName, ''),
    locationName: text(raw.locationName, ''),
    mapKey: text(raw.mapKey),
    courtId: raw.courtId,
    courtName: text(raw.courtName, 'Kenttä'),
    courtMapId: text(raw.courtMapId),
    sport: raw.sport,
    startsAt: iso(raw.startsAt),
    endsAt: iso(raw.endsAt),
    status: raw.status,
    priceCents: number(raw.priceCents),
    paymentStatus: raw.paymentStatus,
    holdExpiresAt: iso(raw.holdExpiresAt),
    cancellableUntil: iso(raw.cancellableUntil),
    cancelledAt: iso(raw.cancelledAt),
    createdAt: iso(raw.createdAt),
  };
}

/** The RPC gives the booker's profile fields; map.js turns them into a PersonLite. */
function mapBooker(raw) {
  if (!raw?.id) return null;
  return mapPerson({
    id: raw.id,
    name: raw.name,
    avatar_url: raw.avatarUrl,
    avatar_color: raw.avatarColor,
    age: raw.ageRange ?? null,
    // null = no tennis_preferences row (no level); '' = a row without a level
    tennis_preferences: raw.skillLevel === null || raw.skillLevel === undefined ? null : { skill_level: raw.skillLevel },
  });
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
  const data = await call('krossi_hold_booking', {
    court_id_input: courtId,
    starts_at_input: start,
    minutes_input: minutesOrNull(minutes),
  }, HOLD_FAIL);
  return mapBooking(data);
}

export async function release(bookingId) {
  await requireUid();
  if (!isUuid(bookingId)) throw fail('Varausta ei löytynyt.');
  await call('krossi_release_booking', { booking_id_input: bookingId }, 'Varauksen vapautus epäonnistui.');
  announceFreed(bookingId);
}

/** { paid: true } when nothing is left to pay, else what the Payment Element needs. */
export async function checkoutConfig(bookingId) {
  await requireUid();
  if (!isUuid(bookingId)) throw fail('Varausta ei löytynyt.');
  const data = await edge('config', { bookingId }, CHECKOUT_FAIL);
  if (data?.paid) return { paid: true };
  if (!data?.publishableKey) throw fail(CHECKOUT_FAIL);
  return {
    publishableKey: data.publishableKey,
    amount: number(data.amount),
    currency: text(data.currency, 'eur'),
    email: text(data.email),
  };
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

/** Cancels my confirmed booking before cancellableUntil; a paid one is refunded in full. */
export async function cancel(bookingId) {
  await requireUid();
  if (!isUuid(bookingId)) throw fail('Varausta ei löytynyt.');
  const data = await edge('cancel', { bookingId }, CANCEL_FAIL);
  return { refundedCents: number(data?.refundedCents) };
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
