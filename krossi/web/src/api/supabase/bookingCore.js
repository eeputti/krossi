// bookingCore.js — what the real backend's booking domains share (booking.js, seasons.js,
// billing.js, wallet.js): error codes for the RPCs' Finnish messages, the RPC and edge-function
// callers, and the mappers that pin the RPCs' contract-shaped JSON down (a Booking with its
// credit, its jaettu maksu lines and its "Laita myyntiin" state). Not a contract module.
//
// The booking RPCs and edge functions raise Finnish messages written for players
// ('Valitse varauksen kesto.', 'Varauksen pitoaika ehti umpeutua…'). toApiError() only trusts
// raw messages that contain ä/ö/å, so those are passed through here as-is, with the same error
// codes the demo backend uses.

import { db, invokeFunction, isMissingFunction } from './client.js';
import { mapPerson } from './map.js';
import { ApiError, toApiError } from '../errors.js';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Errors ───────────────────────────────────────────────────────────────────

const CODES = [
  [/^Joku ehti varata/, 'taken'],
  [/^Aika ei ole vapaa/, 'taken'],
  [/^Varauksen pitoaika ehti umpeutua/, 'expired'],
  [/^Aika ehti mennä toiselle/, 'lost'],
  [/^Peruutusaika on mennyt/, 'too_late'],
  [/^Vain hallin henkilökunta/, 'forbidden'],
  [/^Aika on vapaana/, 'free'],
  [/^Voit vielä perua vuoron maksutta/, 'cancellable'],
  [/^Joku on juuri varaamassa vuoroa/, 'buyer_paying'],
  [/^Maksuaika päättyi/, 'closed'],
  [/^Vuoro on peruttu/, 'cancelled'],
  [/^Kirjaudu /, 'auth_required'],
  [/^Kenttä on varattu .*viikkona/, 'conflict'],
  [/^Tälle ajalle ei ole kaudella/, 'conflict'],
  [/^Kenttä ei ole vapaana yhtenäkään/, 'conflict'],
  [/^Kenttä ehti varautua/, 'conflict'],
  [/^Tallenna ensin kortti/, 'card_required'],
  [/^Pelaajalla ei ole tallennettua korttia/, 'card_required'],
  [/^Hallin laskutustiedot puuttuvat/, 'billing_settings'],
  [/^Sarjakortin saldo ei riitä/, 'insufficient'],
  [/^Lahjakorttisaldoa ei ole/, 'insufficient'],
  [/^Tämä lahjakortti on jo käytetty/, 'used'],
  [/^Lahjakortti on vanhentunut/, 'expired'],
  [/^Koodia ei löytynyt/, 'not_found'],
  [/ei löytynyt\.$/, 'not_found'],
];

export function codeFor(message) {
  return CODES.find(([re]) => re.test(message))?.[1] ?? null;
}

export const fail = (message, code = codeFor(message)) => new ApiError(message, code ? { code } : undefined);

/** `raise exception '<suomeksi>'` in our booking RPCs arrives as SQLSTATE P0001. */
export function rpcError(error, fallback) {
  const message = typeof error?.message === 'string' ? error.message.trim() : '';
  if (error?.code === 'P0001' && message && message.length <= 200) {
    return new ApiError(message, { cause: error, code: codeFor(message) });
  }
  return toApiError(error, fallback);
}

export async function call(name, args, fallback) {
  const { data, error } = await db().rpc(name, args);
  if (error) throw rpcError(error, fallback);
  return data;
}

/**
 * Like call(), but `empty` when the function isn't deployed yet (a migration not applied): lists
 * then look empty instead of failing.
 */
export async function callOrEmpty(name, args, fallback, empty) {
  const { data, error } = await db().rpc(name, args);
  if (error) {
    if (isMissingFunction(error)) return empty;
    throw rpcError(error, fallback);
  }
  return data;
}

/**
 * Calls one of the booking edge functions. invokeFunction keeps the function's own `{ error }`
 * text as the cause of the ApiError it throws (an Error whose own cause is the HTTP error); every
 * such error is written for players, so it is shown as-is.
 */
export async function edgeCall(fn, action, payload, fallback) {
  try {
    return await invokeFunction(fn, { body: { action, ...payload } }, fallback);
  } catch (err) {
    const detail = err?.cause instanceof Error && err.cause.cause ? err.cause.message : '';
    if (detail) throw new ApiError(detail, { cause: err.cause, code: codeFor(detail) });
    throw err;
  }
}

/**
 * A court freed up (hold released, block removed, a season week released): krossi-booking emails
 * the people waiting for it. Fire and forget — the release itself already succeeded, so this
 * never throws.
 */
export function announceFreed(reservationId) {
  invokeFunction('krossi-booking', { body: { action: 'freed', bookingId: reservationId } })
    .catch((err) => console.warn('Vapautuneen vuoron ilmoitus epäonnistui', err));
}

/**
 * My booking was confirmed without krossi-booking (a series card or gift balance paid it all):
 * krossi-booking refunds the on-sale bookings it took over and tells their sellers now — the cron
 * would, a few minutes later. Fire and forget, never throws.
 */
export function announceConfirmed(bookingId) {
  invokeFunction('krossi-booking', { body: { action: 'confirmed', bookingId } })
    .catch((err) => console.warn('Vahvistuneen varauksen jatkotoimet epäonnistuivat', err));
}

// ── Mapping ──────────────────────────────────────────────────────────────────

export const text = (value, fallback = null) => (typeof value === 'string' && value !== '' ? value : fallback);
export const number = (value, fallback = 0) => {
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
};
export const numberOrNull = (value) => (value === null || value === undefined || value === '' ? null : number(value, null));

export function iso(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export const list = (value) => (Array.isArray(value) ? value : []);
export const listOrNull = (value) => (Array.isArray(value) ? [...value] : null);
/** 'YYYY-MM-DD' or null. */
export const day = (value) => (typeof value === 'string' && DATE_RE.test(value) ? value : null);

export function mapCredit(raw) {
  if (!raw || (raw.kind !== 'pass' && raw.kind !== 'gift')) return null;
  return { kind: raw.kind, cents: number(raw.cents), minutes: number(raw.minutes), name: text(raw.name) };
}

/** The RPCs build PersonLite like krossi_booking_staff_day; a deleted account is just 'Pelaaja'. */
const NOBODY = { id: '', name: 'Pelaaja', avatarUrl: null, avatarColor: 'blue', ageRange: null, skillLevel: null };
export const linePerson = (raw) => mapBooker(raw) || { ...NOBODY };

const LINE_STATUSES = ['open', 'pending', 'paid', 'refunded'];

/** One payer of a split booking: the booker ('own'), or a friend part (a payer without an account has a name only). */
function mapLine(raw) {
  const own = raw.kind === 'own';
  return {
    id: text(raw.id),
    kind: own ? 'own' : 'friend',
    person: own ? linePerson(raw.person) : mapBooker(raw.person),
    name: text(raw.name),
    cents: number(raw.cents),
    status: LINE_STATUSES.includes(raw.status) ? raw.status : 'open',
    paidAt: iso(raw.paidAt),
    backTo: !own && (raw.backTo === 'saldo' || raw.backTo === 'card') ? raw.backTo : null,
  };
}

/** BookingSplit (jaettu maksu by link) or null; ownCents follows from the price if the server leaves it out. */
function mapSplit(raw, priceCents) {
  if (!raw || typeof raw !== 'object') return null;
  const parts = number(raw.parts, 2);
  const perCents = number(raw.perCents);
  return {
    parts,
    perCents,
    ownCents: raw.ownCents != null ? number(raw.ownCents) : Math.max(0, priceCents - perCents * (parts - 1)),
    token: text(raw.token),
    lines: list(raw.lines).map(mapLine),
  };
}

export function mapBooking(raw) {
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
    credit: mapCredit(raw.credit),
    forSale: raw.forSale === true,
    soldAt: iso(raw.soldAt),
    split: mapSplit(raw.split, number(raw.priceCents)),
  };
}

/** The RPCs give a person's profile fields (krossi_booking_person_json); map.js turns them into a PersonLite. */
export function mapBooker(raw) {
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
