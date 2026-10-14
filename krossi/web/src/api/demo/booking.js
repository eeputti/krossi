// booking.js (demo) — court booking against the in-memory hall in bookingSeed.js, with the
// rules of the booking RPCs (krossi_hold_booking & co.) and the krossi-booking edge function.
// Payments don't go anywhere: checkoutConfig answers { demo: true } and the "payment" confirms
// the booking at once.

import { ApiError } from '../errors.js';
import { ME } from './rows.js';
import { later, run, newId } from './runtime.js';
import { db, nowIso, personLite } from './store.js';
import {
  addDays, cancelDeadline, courtsOf, dateKey, discounted, findCourt, isTaken, lastMinutePercent, localDate, minutesOf,
  priceOf,
} from '../../features/booking.js';

const MIN = 60_000;
const MAX_HOLDS = 2;
const MAX_WATCHES = 5;
const STAFF_ONLY = 'Vain hallin henkilökunta voi tehdä tämän.';
const TAKEN = 'Joku ehti varata tämän ajan juuri ennen sinua. Valitse toinen aika.';

const fail = (message, code) => new ApiError(message, code ? { code } : undefined);

function venueRow(idOrSlug) {
  return db.booking.venues.find((v) => v.id === idOrSlug || v.slug === idOrSlug) || null;
}

function toVenue(v) {
  const { staffIds, ...rest } = v;
  return { ...rest, isStaff: staffIds.includes(ME) };
}

function requireStaff(venue) {
  if (!venue || !venue.staffIds.includes(ME)) throw fail(STAFF_ONLY, 'forbidden');
}

/** A hold whose time ran out counts as free everywhere, like the SQL does. */
function isLive(row, now = Date.now()) {
  if (row.status === 'confirmed') return true;
  return row.status === 'held' && Date.parse(row.holdExpiresAt) > now;
}

function expireStaleHolds(now = Date.now()) {
  for (const row of db.booking.rows) {
    if (row.status === 'held' && Date.parse(row.holdExpiresAt) <= now) row.status = 'expired';
  }
}

const liveRows = () => db.booking.rows.filter((r) => isLive(r));

function dayRange(key) {
  return [localDate(key).getTime(), localDate(addDays(key, 1)).getTime()];
}

function inRange(row, [from, to]) {
  return Date.parse(row.startsAt) < to && Date.parse(row.endsAt) > from;
}

function toBooking(row) {
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
  };
}

function myRow(bookingId) {
  const row = db.booking.rows.find((r) => r.id === bookingId && r.kind === 'booking');
  if (!row || row.bookedBy !== ME) throw fail('Varausta ei löytynyt.', 'not_found');
  return row;
}

// ── Public calendar ──────────────────────────────────────────────────────────

export async function listVenues() {
  return run(() => db.booking.venues.map(toVenue));
}

export async function getVenue(idOrSlug) {
  return run(() => {
    const v = venueRow(idOrSlug);
    return v ? toVenue(v) : null;
  });
}

export async function day(venueId, key) {
  return run(() => {
    const venue = venueRow(venueId);
    if (!venue) throw fail('Hallia ei löytynyt.', 'not_found');
    const range = dayRange(key);
    const busy = liveRows()
      .filter((r) => r.venueId === venue.id && inRange(r, range))
      .map((r) => ({
        id: r.id, courtId: r.courtId, startsAt: r.startsAt, endsAt: r.endsAt, kind: r.kind,
        mine: r.kind === 'booking' && r.bookedBy === ME, title: r.kind === 'booking' ? null : r.title,
      }));
    return { date: key, busy };
  });
}

// ── Booking and paying ───────────────────────────────────────────────────────

export async function hold({ courtId, startsAt, minutes } = {}) {
  return run(() => {
    const venue = db.booking.venues.find((v) => findCourt(v, courtId));
    if (!venue) throw fail('Kenttää ei löytynyt.', 'not_found');
    const { court } = findCourt(venue, courtId);
    if (!venue.durations.includes(minutes)) throw fail('Valitse varauksen kesto.');
    const start = new Date(startsAt);
    if (Number.isNaN(start.getTime())) throw fail('Valitse aika kalenterista.');
    const startMinute = start.getHours() * 60 + start.getMinutes();
    if (start.getSeconds() || startMinute % venue.slotMinutes) throw fail('Valitse aika kalenterista.');
    const now = Date.now();
    if (start.getTime() <= now) throw fail('Tämä aika on jo mennyt.');
    if (dateKey(start) > addDays(dateKey(new Date(now)), venue.daysAhead)) {
      throw fail(`Vuoroja voi varata ${venue.daysAhead} päivän päähän.`);
    }
    if (startMinute < minutesOf(venue.openFrom) || startMinute + minutes > minutesOf(venue.openUntil)) {
      throw fail('Kenttä on suljettu tähän aikaan.');
    }
    const fullCents = priceOf(venue, court, start.toISOString(), minutes);
    if (fullCents == null) throw fail('Kenttä on suljettu tähän aikaan.');
    const cents = discounted(fullCents, lastMinutePercent(venue, start.toISOString(), now));
    expireStaleHolds(now);
    const myHolds = db.booking.rows.filter((r) => r.bookedBy === ME && r.status === 'held');
    if (myHolds.length >= MAX_HOLDS) throw fail('Sinulla on jo kaksi maksamatonta varausta. Maksa tai peru ne ensin.');
    const endMs = start.getTime() + minutes * MIN;
    if (isTaken(liveRows(), courtId, start.getTime(), endMs)) throw fail(TAKEN, 'taken');
    const free = cents === 0;
    const row = {
      id: newId('bk'), venueId: venue.id, courtId, startsAt: start.toISOString(), endsAt: new Date(endMs).toISOString(),
      kind: 'booking', status: free ? 'confirmed' : 'held', bookedBy: ME, title: null, priceCents: cents,
      paymentStatus: free ? 'free' : 'unpaid', holdExpiresAt: free ? null : new Date(now + venue.holdMinutes * MIN).toISOString(),
      createdAt: nowIso(), cancelledAt: null,
    };
    db.booking.rows.push(row);
    return toBooking(row);
  });
}

export async function release(bookingId) {
  return run(() => {
    const row = myRow(bookingId);
    if (row.status !== 'held') return;
    row.status = 'cancelled';
    row.cancelledAt = nowIso();
  });
}

function payable(row) {
  if (row.paymentStatus === 'paid' || row.paymentStatus === 'free') return { paid: true };
  if (!isLive(row) || row.status !== 'held') throw fail('Varauksen pitoaika ehti umpeutua. Valitse aika uudelleen.', 'expired');
  return null;
}

export async function checkoutConfig(bookingId) {
  return run(() => {
    const row = myRow(bookingId);
    return payable(row) || { demo: true, amount: row.priceCents, currency: 'eur' };
  });
}

/** The demo has no card form: "paying" confirms the booking on the spot. */
export async function createPaymentIntent(bookingId) {
  return run(() => {
    const row = myRow(bookingId);
    const done = payable(row);
    if (done) return done;
    row.status = 'confirmed';
    row.paymentStatus = 'paid';
    row.holdExpiresAt = null;
    return { paid: true };
  });
}

export async function verifyPayment(bookingId) {
  return run(() => {
    const row = myRow(bookingId);
    return { confirmed: row.status === 'confirmed', status: row.status === 'confirmed' ? 'succeeded' : 'requires_payment_method' };
  });
}

export async function listMine() {
  return run(() => {
    const now = Date.now();
    const mine = db.booking.rows.filter((r) => r.kind === 'booking' && r.bookedBy === ME);
    const upcoming = mine.filter((r) => isLive(r, now) && Date.parse(r.endsAt) > now)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const upcomingIds = new Set(upcoming.map((r) => r.id));
    const past = mine.filter((r) => !upcomingIds.has(r.id))
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
      .slice(0, 30);
    return { upcoming: upcoming.map(toBooking), past: past.map(toBooking) };
  });
}

export async function cancel(bookingId) {
  return run(() => {
    const row = myRow(bookingId);
    if (row.status !== 'confirmed') throw fail('Tätä varausta ei voi enää perua.');
    const venue = venueRow(row.venueId);
    if (Date.now() >= Date.parse(cancelDeadline(row.startsAt, venue))) throw fail('Peruutusaika on mennyt. Ota yhteyttä halliin.', 'too_late');
    const refundedCents = row.paymentStatus === 'paid' ? row.priceCents : 0;
    row.status = 'cancelled';
    row.cancelledAt = nowIso();
    if (refundedCents) row.paymentStatus = 'refunded';
    return { refundedCents };
  });
}

// ── "Ilmoita kun vapautuu" ───────────────────────────────────────────────────

/** Courts a watch covers: the venue's courts of its sport, in its place when it has one. */
function watchCourts(watch) {
  const venue = venueRow(watch.venueId);
  return courtsOf(venue, { sport: watch.sport, locationId: watch.locationId || null }).map((x) => x.court);
}

function freeForWatch(watch) {
  const startMs = Date.parse(watch.startsAt);
  const endMs = startMs + watch.minutes * MIN;
  const venue = venueRow(watch.venueId);
  return watchCourts(watch).some((court) => priceOf(venue, court, watch.startsAt, watch.minutes) != null
    && !isTaken(liveRows(), court.id, startMs, endMs));
}

const toWatch = ({ userId, ...watch }) => watch;

/**
 * In the demo somebody cancels a little later, so the watch fires: a booking (not a block, not
 * Alex's own) on a watched court is cancelled and the watch is stamped as notified.
 */
function scheduleFreeing(watchId) {
  later(14_000, 26_000, () => {
    const watch = db.booking.watches.find((w) => w.id === watchId);
    if (!watch || watch.notifiedAt) return;
    const startMs = Date.parse(watch.startsAt);
    const endMs = startMs + watch.minutes * MIN;
    const ids = new Set(watchCourts(watch).map((c) => c.id));
    for (const courtId of ids) {
      const blocking = liveRows().filter((r) => r.courtId === courtId && Date.parse(r.startsAt) < endMs && Date.parse(r.endsAt) > startMs);
      if (blocking.length && blocking.every((r) => r.kind === 'booking' && r.bookedBy !== ME)) {
        for (const r of blocking) { r.status = 'cancelled'; r.cancelledAt = nowIso(); r.paymentStatus = 'refunded'; }
        watch.notifiedAt = nowIso();
        return;
      }
    }
  });
}

export async function watch({ venueId, sport, locationId = null, startsAt, minutes } = {}) {
  return run(() => {
    const venue = venueRow(venueId);
    if (!venue) throw fail('Hallia ei löytynyt.', 'not_found');
    if (!venue.durations.includes(minutes)) throw fail('Valitse varauksen kesto.');
    if (!(Date.parse(startsAt) > Date.now())) throw fail('Tämä aika on jo mennyt.');
    const now = Date.now();
    const mine = db.booking.watches.filter((w) => w.userId === ME && Date.parse(w.startsAt) > now);
    const same = mine.find((w) => w.venueId === venue.id && w.sport === sport && (w.locationId || null) === (locationId || null)
      && w.startsAt === new Date(startsAt).toISOString() && w.minutes === minutes);
    if (same) return toWatch(same);
    const row = {
      id: newId('w'), userId: ME, venueId: venue.id, sport, locationId: locationId || null,
      startsAt: new Date(startsAt).toISOString(), minutes, notifiedAt: null, createdAt: nowIso(),
    };
    if (freeForWatch(row)) throw fail('Aika on vapaana — varaa se heti.', 'free');
    if (mine.length >= MAX_WATCHES) throw fail('Sinulla on jo 5 hälytystä. Poista jokin ensin.');
    db.booking.watches.push(row);
    scheduleFreeing(row.id);
    return toWatch(row);
  });
}

export async function unwatch(watchId) {
  return run(() => {
    const i = db.booking.watches.findIndex((w) => w.id === watchId && w.userId === ME);
    if (i >= 0) db.booking.watches.splice(i, 1);
  });
}

export async function listWatches() {
  return run(() => {
    const now = Date.now();
    return db.booking.watches
      .filter((w) => w.userId === ME && Date.parse(w.startsAt) > now)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map(toWatch);
  });
}

// ── Hall staff ───────────────────────────────────────────────────────────────

export async function staffDay(venueId, key) {
  return run(() => {
    const venue = venueRow(venueId);
    requireStaff(venue);
    const range = dayRange(key);
    return liveRows()
      .filter((r) => r.venueId === venue.id && inRange(r, range))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map((r) => ({
        id: r.id, courtId: r.courtId, startsAt: r.startsAt, endsAt: r.endsAt, kind: r.kind, status: r.status,
        title: r.kind === 'booking' ? null : r.title,
        bookedBy: r.kind === 'booking' && r.bookedBy ? personLite(r.bookedBy) : null,
        priceCents: r.priceCents, paymentStatus: r.paymentStatus,
      }));
  });
}

export async function block({ courtIds, startsAt, endsAt, title, kind = 'block' } = {}) {
  return run(() => {
    const ids = [...new Set(courtIds || [])];
    if (!ids.length) throw fail('Valitse ainakin yksi kenttä.');
    const venue = db.booking.venues.find((v) => findCourt(v, ids[0]));
    requireStaff(venue);
    if (!['block', 'league'].includes(kind)) throw fail('Tuntematon varauksen tyyppi.');
    const startMs = Date.parse(startsAt);
    const endMs = Date.parse(endsAt);
    if (!(endMs > startMs)) throw fail('Loppuajan pitää olla alun jälkeen.');
    const name = String(title || '').trim();
    if (!name) throw fail('Anna esteelle nimi, esim. "Hallisarja".');
    if (ids.some((id) => !courtsOf(venue).some((x) => x.court.id === id))) throw fail('Kenttää ei löytynyt.');
    expireStaleHolds();
    if (ids.some((id) => isTaken(liveRows(), id, startMs, endMs))) throw fail('Aika ei ole vapaa kaikilla valituilla kentillä.', 'taken');
    return ids.map((courtId) => {
      const row = {
        id: newId('bk'), venueId: venue.id, courtId, startsAt: new Date(startMs).toISOString(), endsAt: new Date(endMs).toISOString(),
        kind, status: 'confirmed', bookedBy: null, title: name.slice(0, 80), priceCents: 0, paymentStatus: 'none',
        holdExpiresAt: null, createdAt: nowIso(), cancelledAt: null,
      };
      db.booking.rows.push(row);
      return row.id;
    });
  });
}

export async function unblock(blockId) {
  return run(() => {
    const row = db.booking.rows.find((r) => r.id === blockId && r.kind !== 'booking');
    if (!row) throw fail('Estoa ei löytynyt.', 'not_found');
    requireStaff(venueRow(row.venueId));
    row.status = 'cancelled';
    row.cancelledAt = nowIso();
  });
}

export async function staffCancel(bookingId, { refund = true } = {}) {
  return run(() => {
    const row = db.booking.rows.find((r) => r.id === bookingId && r.kind === 'booking');
    if (!row) throw fail('Varausta ei löytynyt.', 'not_found');
    requireStaff(venueRow(row.venueId));
    if (row.status === 'cancelled' || row.status === 'expired') return;
    row.status = 'cancelled';
    row.cancelledAt = nowIso();
    if (refund && row.paymentStatus === 'paid') row.paymentStatus = 'refunded';
  });
}
