// bookingCore.js (demo) — what the demo's booking domains share: the venue and reservation rows
// of bookingSeed.js / hallSeed.js, the Booking shape, staff checks, the credit ledger (series
// card minutes and gift balance) behind sarjakortit and lahjakortit, and the money of jaettu maksu
// and "Laita myyntiin" (shares, refunds, taking over an on-sale slot). Not a contract module:
// booking.js, seasons.js, billing.js and wallet.js export the API functions.

import { ApiError } from '../errors.js';
import { ME } from './rows.js';
import { newId } from './runtime.js';
import { db, nowIso, personLite } from './store.js';
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

export const overlapping = (r, courtId, startMs, endMs) => r.courtId === courtId
  && Date.parse(r.startsAt) < endMs && Date.parse(r.endsAt) > startMs;
export const onSale = (r) => r.status === 'confirmed' && Boolean(r.listedAt);
/** An on-sale booking that [startMs, endMs) covers whole: `forUser` can take it over (never their own). */
const takenOver = (r, startMs, endMs, forUser) => onSale(r) && r.bookedBy !== forUser
  && Date.parse(r.startsAt) >= startMs && Date.parse(r.endsAt) <= endMs;

/** Live rows that keep `courtId` taken for [startMs, endMs) (what the exclusion constraint + the cover rule refuse). */
export function blockers(courtId, startMs, endMs, forUser = ME) {
  return liveRows().filter((r) => overlapping(r, courtId, startMs, endMs) && !takenOver(r, startMs, endMs, forUser));
}

/** On-sale rows a booking of [startMs, endMs) on `courtId` would take over. */
export function salesCovered(courtId, startMs, endMs, forUser = ME) {
  return liveRows().filter((r) => overlapping(r, courtId, startMs, endMs) && takenOver(r, startMs, endMs, forUser));
}

// ── Jaettu maksu: a split booking's lines ────────────────────────────────────

export const sharesOf = (bookingId) => db.booking.shares
  .filter((s) => s.bookingId === bookingId)
  .sort((a, b) => (a.kind === 'rest') - (b.kind === 'rest') || a.createdAt.localeCompare(b.createdAt)); // stable: friends in the order picked

function ownStatus(row) {
  if (['paid', 'free', 'credit'].includes(row.paymentStatus)) return 'paid';
  if (row.paymentStatus === 'refunded') return 'refunded';
  return row.status === 'held' && isLive(row) ? 'pending' : 'cancelled';
}

const toLine = (s) => ({ id: s.id, kind: s.kind, person: personLite(s.userId), cents: s.cents, status: s.status, paidAt: s.paidAt });

function splitOf(row) {
  if (!row.split) return null;
  return {
    parts: row.split.parts,
    ownCents: row.split.ownCents,
    deadline: row.split.deadline,
    lines: [
      { id: null, kind: 'own', person: personLite(row.bookedBy), cents: row.split.ownCents, status: ownStatus(row), paidAt: row.paidAt ?? null },
      ...sharesOf(row.id).map(toLine),
    ],
  };
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
    forSale: onSale(row),
    soldAt: row.resoldAt ?? null,
    split: splitOf(row),
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
 * to the balance. Returns { creditCents, creditMinutes }. `why` starts the history line
 * ('Peruttu', or 'Myyty' for a slot somebody took over).
 */
export function returnCredit(row, why = 'Peruttu') {
  let creditCents = 0;
  let creditMinutes = 0;
  if (row.passId && row.passMinutes > 0) {
    const pass = db.booking.passes.find((p) => p.id === row.passId);
    if (pass) pass.minutesLeft += row.passMinutes;
    addCreditEvent({
      venueId: row.venueId, userId: row.bookedBy, kind: 'refund', passId: row.passId, minutes: row.passMinutes,
      bookingId: row.id, label: `${why}: ${rowLabel(row)}`,
    });
    creditMinutes = row.passMinutes;
  } else if (row.giftCents > 0) {
    addCreditEvent({
      venueId: row.venueId, userId: row.bookedBy, kind: 'refund', cents: row.giftCents, bookingId: row.id,
      label: `${why}: ${rowLabel(row)}`,
    });
    creditCents = row.giftCents;
  }
  return { creditCents, creditMinutes };
}

// ── Refunds and "Laita myyntiin" ─────────────────────────────────────────────

/**
 * Everything paid for `row` goes back: the booker's card part and series card / gift credit, the
 * friends' shares and the rest; unpaid shares are dropped. Returns what the booker gets back:
 * { refundedCents (card: own part + rest), creditCents, creditMinutes }.
 */
export function refundEverything(row, why = 'Peruttu') {
  let refundedCents = 0;
  let credit = { creditCents: 0, creditMinutes: 0 };
  if (row.paymentStatus === 'paid' || row.paymentStatus === 'credit') {
    credit = returnCredit(row, why);
    if (row.paymentStatus === 'paid') refundedCents = row.split ? row.split.ownCents : row.priceCents - (row.giftCents || 0);
    row.paymentStatus = 'refunded';
  }
  for (const s of sharesOf(row.id)) {
    if (s.status === 'paid') {
      if (s.kind === 'rest') refundedCents += s.cents;
      s.status = 'refunded';
    } else if (['pending', 'declined'].includes(s.status)) {
      s.status = 'cancelled';
    }
  }
  return { refundedCents, ...credit };
}

/** A confirmed booking takes over the on-sale bookings it covers: they are sold, their payers refunded. */
export function takeOverSales(row) {
  const startMs = Date.parse(row.startsAt);
  const endMs = Date.parse(row.endsAt);
  for (const sold of salesCovered(row.courtId, startMs, endMs, row.bookedBy)) {
    sold.status = 'cancelled';
    sold.cancelledAt = nowIso();
    sold.resoldBy = row.id;
    sold.resoldAt = nowIso();
    refundEverything(sold, 'Myyty');
  }
}
