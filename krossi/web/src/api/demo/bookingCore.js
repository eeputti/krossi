// bookingCore.js (demo) — what the demo's booking domains share: the venue and reservation rows
// of bookingSeed.js / hallSeed.js, the Booking shape, staff checks, the credit ledger (series
// card minutes and gift balance) behind sarjakortit and lahjakortit, and the money of jaettu maksu
// and "Laita myyntiin" (friend parts, refunds, taking over an on-sale slot). Not a contract module:
// booking.js, seasons.js, billing.js and wallet.js export the API functions.

import { ApiError } from '../errors.js';
import { ME } from './rows.js';
import { newId } from './runtime.js';
import { db, nowIso, personLite } from './store.js';
import { CANCEL_FEE_CENTS, addDays, cancelDeadline, findCourt, localDate, splitCents } from '../../features/booking.js';
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

/** Gift cards of a venue that has never set its own (the SQL table's defaults). */
export const DEFAULT_GIFT = Object.freeze({ amounts: [2500, 5000, 10000], minCents: 1000, maxCents: 30000, validDays: 365 });

/**
 * The venue's laskutustiedot and gift card settings (booking_billing_settings): { seller: { name,
 * businessId, address, iban, bic, email, phone }, vatPercent, paymentTermsDays, nextInvoiceNumber,
 * gift, updatedAt }. Made with the table's defaults the first time the hall saves something.
 */
export function billingRow(venueId) {
  if (!db.booking.billing[venueId]) {
    db.booking.billing[venueId] = {
      seller: { name: '', businessId: null, address: null, iban: null, bic: null, email: null, phone: null },
      vatPercent: 14, paymentTermsDays: 14, nextInvoiceNumber: 1001,
      gift: { ...DEFAULT_GIFT, amounts: [...DEFAULT_GIFT.amounts] }, updatedAt: null,
    };
  }
  return db.booking.billing[venueId];
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
// row.split = { parts, perCents, token }; db.booking.shares holds its friend parts: { id, bookingId,
// kind: 'friend', cents, status: 'open'|'pending'|'paid'|'refunded'|'cancelled', userId (a payer who
// was signed in), name (one who wasn't), paidAt, claimUntil, createdAt }.

export const sharesOf = (bookingId) => db.booking.shares
  .filter((s) => s.bookingId === bookingId)
  .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

/** A part's status as the contract says it: a claim that ran out is open again; a cancelled one too. */
export function partStatus(share, now = Date.now()) {
  if (share.status === 'pending') return Date.parse(share.claimUntil) > now ? 'pending' : 'open';
  if (share.status === 'cancelled') return 'open';
  return share.status;
}

/** A link's secret: url-safe and long enough not to be guessed. */
export function newToken() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 22; i += 1) out += abc[Math.floor(Math.random() * abc.length)];
  return out;
}

function splitOf(row) {
  if (!row.split) return null;
  const { parts, perCents, token } = row.split;
  const { ownCents } = splitCents(row.priceCents, parts);
  return {
    parts,
    perCents,
    ownCents,
    token: row.bookedBy === ME ? token : null,
    lines: [
      {
        id: null, kind: 'own', person: personLite(row.bookedBy), name: null, cents: ownCents,
        status: row.paymentStatus === 'refunded' ? 'refunded' : 'paid', paidAt: row.paidAt ?? null,
      },
      ...sharesOf(row.id).map((s) => ({
        id: s.id, kind: 'friend', person: s.userId ? personLite(s.userId) : null, name: s.userId ? null : (s.name || null),
        cents: s.cents, status: partStatus(s), paidAt: s.paidAt ?? null,
      })),
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
 * Everything paid for `row` goes back: the booker's card payment (minus the friends' parts, which
 * already went back to the booker when they were paid) and series card / gift credit, and every
 * friend part to its payer; open parts are dropped. Returns what the booker gets back:
 * { refundedCents (card), creditCents, creditMinutes }.
 */
/**
 * A cancelled or sold booking gives its money and credit back (friends' paid shares go back to
 * them). `fee`: the booker gave it up themselves — the 1 € peruutuskulu stays of their card money
 * (CANCEL_FEE_CENTS), as on the server. → { refundedCents, feeCents, creditCents, creditMinutes }
 */
export function refundEverything(row, why = 'Peruttu', { fee = false } = {}) {
  let refundedCents = 0;
  let feeCents = 0;
  let credit = { creditCents: 0, creditMinutes: 0 };
  const parts = sharesOf(row.id);
  if (row.paymentStatus === 'paid' || row.paymentStatus === 'credit') {
    credit = returnCredit(row, why);
    if (row.paymentStatus === 'paid') {
      const back = parts.filter((s) => s.status === 'paid').reduce((n, s) => n + s.cents, 0);
      refundedCents = row.priceCents - (row.giftCents || 0) - back;
      if (fee) {
        feeCents = Math.min(CANCEL_FEE_CENTS, refundedCents);
        refundedCents -= feeCents;
      }
    }
    row.paymentStatus = 'refunded';
  }
  for (const s of parts) {
    if (s.status === 'paid') s.status = 'refunded';
    else if (s.status !== 'refunded') s.status = 'cancelled';
  }
  return { refundedCents, feeCents, ...credit };
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
    refundEverything(sold, 'Myyty', { fee: true });
  }
}
