// bookingCore.js (demo) — what the demo's booking domains share: the venue and reservation rows
// of bookingSeed.js / hallSeed.js, the Booking shape, staff checks, and the credit ledger
// (series card minutes and gift balance) behind sarjakortit and lahjakortit. Not a contract
// module: booking.js, seasons.js, billing.js and wallet.js export the API functions.

import { ApiError } from '../errors.js';
import { ME } from './rows.js';
import { newId } from './runtime.js';
import { db, nowIso } from './store.js';
import { addDays, cancelDeadline, findCourt, localDate } from '../../features/booking.js';
import { creditEventLabel } from '../../features/seasons.js';

export const MIN = 60_000;
export const STAFF_ONLY = 'Vain hallin henkilökunta voi tehdä tämän.';

export const fail = (message, code) => new ApiError(message, code ? { code } : undefined);

export function venueRow(idOrSlug) {
  return db.booking.venues.find((v) => v.id === idOrSlug || v.slug === idOrSlug) || null;
}

export function requireStaff(venue) {
  if (!venue || !venue.staffIds.includes(ME)) throw fail(STAFF_ONLY, 'forbidden');
}

/** A hold whose time ran out counts as free everywhere, like the SQL does. */
export function isLive(row, now = Date.now()) {
  if (row.status === 'confirmed') return true;
  return row.status === 'held' && Date.parse(row.holdExpiresAt) > now;
}

export function expireStaleHolds(now = Date.now()) {
  for (const row of db.booking.rows) {
    if (row.status === 'held' && Date.parse(row.holdExpiresAt) <= now) row.status = 'expired';
  }
}

export const liveRows = () => db.booking.rows.filter((r) => isLive(r));

export function dayRange(key) {
  return [localDate(key).getTime(), localDate(addDays(key, 1)).getTime()];
}

export function inRange(row, [from, to]) {
  return Date.parse(row.startsAt) < to && Date.parse(row.endsAt) > from;
}

/** BookingCredit of a row, or null. */
export function creditOf(row) {
  if (row.passId) {
    const pass = db.booking.passes.find((p) => p.id === row.passId);
    return { kind: 'pass', cents: row.priceCents, minutes: row.passMinutes || 0, name: pass?.name || 'Sarjakortti' };
  }
  if (row.giftCents > 0) return { kind: 'gift', cents: row.giftCents, minutes: 0, name: null };
  return null;
}

export function toBooking(row) {
  const venue = venueRow(row.venueId);
  const found = findCourt(venue, row.courtId);
  return {
    id: row.id,
    venueId: venue.id,
    venueName: venue.name,
    locationName: found?.location.name || '',
    mapKey: found?.location.mapKey || null,
    courtId: row.courtId,
    courtName: found?.court.name || 'Kenttä',
    courtMapId: found?.court.mapId || null,
    sport: found?.court.sport || 'tennis',
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: row.status === 'held' && !isLive(row) ? 'expired' : row.status,
    priceCents: row.priceCents,
    paymentStatus: row.paymentStatus,
    holdExpiresAt: row.status === 'held' ? row.holdExpiresAt : null,
    cancellableUntil: cancelDeadline(row.startsAt, venue),
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    credit: creditOf(row),
  };
}

export function myRow(bookingId) {
  const row = db.booking.rows.find((r) => r.id === bookingId && r.kind === 'booking');
  if (!row || row.bookedBy !== ME) throw fail('Varausta ei löytynyt.', 'not_found');
  return row;
}

/** 'Tennis 2 · Janus-Areena · ti 6.10. klo 19.00' for a reservation row. */
export function rowLabel(row) {
  const found = findCourt(venueRow(row.venueId), row.courtId);
  return creditEventLabel({ courtName: found?.court.name, locationName: found?.location.name, startsAt: row.startsAt });
}

// ── Credit ledger ────────────────────────────────────────────────────────────
// Series card minutes live on the pass (minutesLeft) with every change in creditEvents; the gift
// balance is the sum of the user's gift events at a venue (events without a passId).

export function addCreditEvent(event) {
  const row = {
    id: newId('ce'), venueId: event.venueId, userId: event.userId || ME, kind: event.kind,
    passId: event.passId || null, giftCardId: event.giftCardId || null, bookingId: event.bookingId || null,
    minutes: event.minutes || 0, cents: event.cents || 0, label: event.label, createdAt: event.createdAt || nowIso(),
  };
  db.booking.creditEvents.push(row);
  return row;
}

export function giftBalance(userId, venueId) {
  return db.booking.creditEvents
    .filter((e) => e.userId === userId && e.venueId === venueId && !e.passId)
    .reduce((sum, e) => sum + e.cents, 0);
}

/** Gift balance the user can spend now: minus what their other live holds have put aside. */
export function giftAvailable(userId, venueId, exceptBookingId = null) {
  const reserved = db.booking.rows
    .filter((r) => r.kind === 'booking' && r.bookedBy === userId && r.venueId === venueId && r.id !== exceptBookingId
      && r.status === 'held' && isLive(r) && r.paymentStatus === 'unpaid' && r.giftCents > 0)
    .reduce((sum, r) => sum + r.giftCents, 0);
  return giftBalance(userId, venueId) - reserved;
}

/** A paid booking's gift share leaves the balance (at the moment the booking is confirmed). */
export function spendGift(row) {
  if (!(row.giftCents > 0)) return;
  addCreditEvent({
    venueId: row.venueId, userId: row.bookedBy, kind: 'use', cents: -row.giftCents, bookingId: row.id, label: rowLabel(row),
  });
}

/**
 * A cancelled paid booking gives its credit back: series card minutes to the pass, the gift share
 * to the balance. Returns { creditCents, creditMinutes }.
 */
export function returnCredit(row) {
  let creditCents = 0;
  let creditMinutes = 0;
  if (row.passId && row.passMinutes > 0) {
    const pass = db.booking.passes.find((p) => p.id === row.passId);
    if (pass) pass.minutesLeft += row.passMinutes;
    addCreditEvent({
      venueId: row.venueId, userId: row.bookedBy, kind: 'refund', passId: row.passId, minutes: row.passMinutes,
      bookingId: row.id, label: `Peruttu: ${rowLabel(row)}`,
    });
    creditMinutes = row.passMinutes;
  } else if (row.giftCents > 0) {
    addCreditEvent({
      venueId: row.venueId, userId: row.bookedBy, kind: 'refund', cents: row.giftCents, bookingId: row.id,
      label: `Peruttu: ${rowLabel(row)}`,
    });
    creditCents = row.giftCents;
  }
  return { creditCents, creditMinutes };
}
