// booking.js (demo) — court booking against the in-memory hall in bookingSeed.js, with the
// rules of the booking RPCs (krossi_hold_booking & co.) and the krossi-booking edge function.
// Payments don't go anywhere: payConfig / checkoutConfig answer { demo: true } and the "payment"
// confirms the booking at once. Series cards and gift balance (wallet.js) pay through the same rows;
// a cancelled booking gives its credit back (bookingCore.refundEverything).
//
// Jaettu maksu: the booker pays the whole court, then split() makes a link (/pelaa/maksa/<token>).
// Anyone with it pays one friend part without an account, and the same sum goes back to the
// booker. In the demo one friend of a nelinpeli pays by himself a little later, so the booker sees
// it happen; the other parts are there for whoever opens the link. Laita myyntiin: a booking past
// its free cancellation goes on sale, somebody books the slot a little later and everything that
// was paid goes back.
//
// Vieras (guest*): the booking site books without an account — name + email, then "pay". The demo
// visitor is the demo player all along, so a guest's booking is also theirs (bookedBy ME): after
// booking, "Etsi pelikaveri" carries on into the app with it. Its own token works like the real link.

import { ME } from './rows.js';
import { later, run, newId } from './runtime.js';
import { db, nowIso, personLite, profileOf } from './store.js';
import {
  addDays, cancelDeadline, courtsOf, dateKey, discounted, findCourt, lastMinutePercent, minutesOf,
  priceOf, splitBlocker, splitCents,
} from '../../features/booking.js';
import { firstName } from '../../lib/format.js';
import {
  MIN, blockers, creditOf, dayRange, expireStaleHolds, fail, inRange, isLive, liveRows, myRow, newToken, onSale, overlapping,
  addCreditEvent, giftAvailable, partStatus, refundEverything, requireStaff, rowLabel, salesCovered, shareToBooker, sharesOf, spendGift,
  takeOverSales, toBooking, venueRow,
} from './bookingCore.js';

const MAX_HOLDS = 2;
const MAX_WATCHES = 5;
const TAKEN = 'Joku ehti varata tämän ajan juuri ennen sinua. Valitse toinen aika.';
const LINK_NOT_FOUND = 'Maksulinkkiä ei löytynyt. Pyydä varaajalta uusi linkki.';
const LINK_CANCELLED = 'Vuoro on peruttu — osuutta ei tarvitse maksaa.';
const BUYER_PAYING = 'Joku on juuri varaamassa vuoroa. Jos maksu ei mene läpi, voit perua myynnin hetken päästä.';
// The other players' booking names in the demo, for the buyer of an on-sale slot.
const BUYERS = ['p-joonas', 'p-teemu', 'p-emilia', 'p-riikka', 'p-olli'];

function toVenue(v) {
  const { staffIds, ...rest } = v;
  return { ...rest, isStaff: staffIds.includes(ME) };
}

function confirmPaid(row) {
  row.status = 'confirmed';
  row.paymentStatus = 'paid';
  row.paidAt = nowIso();
  row.holdExpiresAt = null;
  spendGift(row);
  takeOverSales(row);
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
        mine: (r.kind === 'booking' || r.kind === 'season') && r.bookedBy === ME, title: r.kind === 'booking' ? null : r.title,
        forSale: onSale(r),
      }));
    return { date: key, busy };
  });
}

// ── Booking and paying ───────────────────────────────────────────────────────

export async function hold({ courtId, startsAt, minutes } = {}) {
  return run(() => toBooking(holdRow({ courtId, startsAt, minutes })));
}

/** krossi_hold_booking's checks; the new row (a guest's carries `guest` and its token). */
function holdRow({ courtId, startsAt, minutes, guest = null }) {
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
  expireStaleHolds(now);
  const endMs = start.getTime() + minutes * MIN;
  // Taking over an on-sale booking costs the full price: its seller gets back what they paid.
  const resale = salesCovered(courtId, start.getTime(), endMs).length > 0;
  const cents = resale ? fullCents : discounted(fullCents, lastMinutePercent(venue, start.toISOString(), now));
  const myHolds = db.booking.rows.filter((r) => r.bookedBy === ME && r.status === 'held');
  if (myHolds.length >= MAX_HOLDS) throw fail('Sinulla on jo kaksi maksamatonta varausta. Maksa tai peru ne ensin.');
  if (blockers(courtId, start.getTime(), endMs).length) throw fail(TAKEN, 'taken');
  const free = cents === 0;
  if (guest && free) throw fail('Tämän ajan voi varata vain kirjautuneena.');
  const row = {
    id: newId('bk'), venueId: venue.id, courtId, startsAt: start.toISOString(), endsAt: new Date(endMs).toISOString(),
    kind: 'booking', status: free ? 'confirmed' : 'held', bookedBy: ME, title: null, priceCents: cents,
    paymentStatus: free ? 'free' : 'unpaid', holdExpiresAt: free ? null : new Date(now + venue.holdMinutes * MIN).toISOString(),
    createdAt: nowIso(), cancelledAt: null, paidAt: free ? nowIso() : null, split: null, listedAt: null, resoldBy: null, resoldAt: null,
    ...(guest ? { guest, guestToken: newToken(), guestCancelled: false } : {}),
  };
  db.booking.rows.push(row);
  if (free) takeOverSales(row);
  return row;
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
  if (['paid', 'free', 'credit'].includes(row.paymentStatus)) return { paid: true };
  if (!isLive(row) || row.status !== 'held') throw fail('Varauksen pitoaika ehti umpeutua. Valitse aika uudelleen.', 'expired');
  return null;
}

/** The booking sheet shows the payment methods before anything is held: the demo has nothing to load. */
export async function payConfig() {
  return run(() => ({ demo: true }));
}

export async function checkoutConfig(bookingId) {
  return run(() => {
    const row = myRow(bookingId);
    // What a gift balance on the hold leaves for the card.
    return payable(row) || { demo: true, amount: row.priceCents - (row.giftCents || 0), currency: 'eur' };
  });
}

/** The demo has no card form: "paying" confirms the booking on the spot. */
export async function createPaymentIntent(bookingId) {
  return run(() => {
    const row = myRow(bookingId);
    const done = payable(row);
    if (done) return done;
    confirmPaid(row);
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

export async function cancel(bookingId, { toSaldo = false } = {}) {
  return run(() => {
    const row = myRow(bookingId);
    if (row.status !== 'confirmed') throw fail('Tätä varausta ei voi enää perua.');
    const venue = venueRow(row.venueId);
    if (Date.now() >= Date.parse(cancelDeadline(row.startsAt, venue))) throw fail('Peruutusaika on mennyt. Ota yhteyttä halliin.', 'too_late');
    row.status = 'cancelled';
    row.cancelledAt = nowIso();
    row.listedAt = null;
    return refundEverything(row, 'Peruttu', { fee: true, toSaldo: toSaldo === true && venue.saldo === true });
  });
}

// ── Laita myyntiin ───────────────────────────────────────────────────────────

/** In the demo somebody books an on-sale slot a little later; the seller gets their money back minus the peruutuskulu. */
function scheduleBuyer(bookingId) {
  later(12_000, 20_000, () => {
    const row = db.booking.rows.find((r) => r.id === bookingId);
    if (!row || !onSale(row) || Date.parse(row.startsAt) <= Date.now()) return;
    const startMs = Date.parse(row.startsAt);
    const endMs = Date.parse(row.endsAt);
    const buyerId = BUYERS[db.booking.rows.length % BUYERS.length];
    if (blockers(row.courtId, startMs, endMs, buyerId).length) return;
    const venue = venueRow(row.venueId);
    const { court } = findCourt(venue, row.courtId);
    const minutes = Math.round((endMs - startMs) / MIN);
    const buyer = {
      id: newId('bk'), venueId: row.venueId, courtId: row.courtId, startsAt: row.startsAt, endsAt: row.endsAt, kind: 'booking',
      status: 'confirmed', bookedBy: buyerId, title: null, priceCents: priceOf(venue, court, row.startsAt, minutes) || row.priceCents,
      paymentStatus: 'paid', holdExpiresAt: null, createdAt: nowIso(), cancelledAt: null, paidAt: nowIso(), split: null,
      listedAt: null, resoldBy: null, resoldAt: null,
    };
    db.booking.rows.push(buyer);
    takeOverSales(buyer);
  });
}

export async function putOnSale(bookingId) {
  return run(() => {
    const row = myRow(bookingId);
    if (row.status !== 'confirmed') throw fail('Tätä varausta ei voi laittaa myyntiin.');
    const now = Date.now();
    if (Date.parse(row.startsAt) <= now) throw fail('Vuoro on jo alkanut.');
    if (now < Date.parse(cancelDeadline(row.startsAt, venueRow(row.venueId)))) {
      throw fail('Voit vielä perua vuoron maksutta — rahat palautuvat heti.', 'cancellable');
    }
    if (!row.listedAt) {
      row.listedAt = nowIso();
      notifyWatchers(row);
      scheduleBuyer(row.id);
    }
    return toBooking(row);
  });
}

export async function takeOffSale(bookingId) {
  return run(() => {
    const row = myRow(bookingId);
    if (!onSale(row)) return toBooking(row);
    const startMs = Date.parse(row.startsAt);
    const endMs = Date.parse(row.endsAt);
    expireStaleHolds();
    if (liveRows().some((r) => r.id !== row.id && overlapping(r, row.courtId, startMs, endMs))) throw fail(BUYER_PAYING, 'buyer_paying');
    row.listedAt = null;
    return toBooking(row);
  });
}

// ── Jaettu maksu: the link ───────────────────────────────────────────────────

const FRIEND_PAYERS = ['p-mikko', 'p-laura', 'p-ville'];

/** In the demo one friend of a nelinpeli pays by himself a little later; the rest wait for the link. */
function scheduleFriendPaying(row) {
  if (row.split.parts < 4) return;
  later(10_000, 16_000, () => {
    const current = db.booking.rows.find((r) => r.id === row.id);
    if (!current?.split || current.status !== 'confirmed') return;
    const part = sharesOf(current.id).find((s) => partStatus(s) === 'open');
    const payer = FRIEND_PAYERS.find((id) => profileOf(id) && !sharesOf(current.id).some((s) => s.userId === id));
    if (!part || !payer) return;
    Object.assign(part, { status: 'paid', paidAt: nowIso(), userId: payer, name: null, claimUntil: null });
    shareToBooker(current, part);
  });
}

export async function split(bookingId, parts) {
  return run(() => {
    const row = myRow(bookingId);
    const n = Number(parts);
    if (![1, 2, 4].includes(n)) throw fail('Valitse kaksin- tai nelinpeli.');
    const blocked = splitBlocker(toBooking(row), n);
    if (blocked) throw fail(blocked, 'not_splittable');
    if ((row.split?.parts || 1) === n) return toBooking(row);
    db.booking.shares = db.booking.shares.filter((s) => s.bookingId !== row.id);
    if (n === 1) {
      row.split = null;
      return toBooking(row);
    }
    const { friendCents } = splitCents(row.priceCents, n);
    row.split = { parts: n, perCents: friendCents, token: row.split?.token || newToken() };
    for (let i = 1; i < n; i += 1) {
      db.booking.shares.push({
        id: newId('sh'), bookingId: row.id, kind: 'friend', cents: friendCents, status: 'open', userId: null, name: null,
        paidAt: null, claimUntil: null, createdAt: nowIso(),
      });
    }
    scheduleFriendPaying(row);
    return toBooking(row);
  });
}

function rowOfToken(token) {
  return db.booking.rows.find((r) => r.split && r.split.token === token) || null;
}

/** 'open' | 'full' | 'over' | 'cancelled' for a split booking's link. */
function linkState(row, now = Date.now()) {
  if (row.status !== 'confirmed') return 'cancelled';
  if (Date.parse(row.startsAt) <= now) return 'over';
  return sharesOf(row.id).some((s) => partStatus(s, now) === 'open') ? 'open' : 'full';
}

export async function splitPublic(token) {
  return run(() => {
    const row = rowOfToken(token);
    if (!row) return null;
    const venue = venueRow(row.venueId);
    const found = findCourt(venue, row.courtId);
    const booker = personLite(row.bookedBy);
    const parts = sharesOf(row.id).map((s) => partStatus(s));
    return {
      token, venueId: venue.id, venueName: venue.name, locationName: found?.location.name || '', courtName: found?.court.name || 'Kenttä',
      sport: found?.court.sport || 'tennis', startsAt: row.startsAt, endsAt: row.endsAt,
      bookerFirstName: firstName(booker.name), bookerAvatarUrl: booker.avatarUrl || null,
      parts: row.split.parts, perCents: row.split.perCents,
      paidCount: parts.filter((x) => x === 'paid').length, openCount: parts.filter((x) => x === 'open').length,
      state: linkState(row),
    };
  });
}

/** The row behind a link that can take a payment now, or the reason it can't. */
function payableLink(token) {
  const row = rowOfToken(token);
  if (!row) throw fail(LINK_NOT_FOUND, 'not_found');
  const state = linkState(row);
  if (state === 'cancelled') throw fail(LINK_CANCELLED, 'cancelled');
  return { row, state };
}

export async function splitCheckoutConfig(token) {
  return run(() => {
    const { row, state } = payableLink(token);
    if (state === 'over') return { over: true };
    if (state === 'full') return { full: true };
    return { demo: true, amount: row.split.perCents, currency: 'eur' };
  });
}

/** The demo has no card form: paying one part happens on the spot, and its sum goes back to the booker. */
export async function createSplitPaymentIntent(token, { name = '' } = {}) {
  return run(() => {
    const { row, state } = payableLink(token);
    if (state === 'over') throw fail('Vuoro on jo alkanut — osuutta ei voi enää maksaa linkistä.', 'over');
    const part = state === 'open' && sharesOf(row.id).find((s) => partStatus(s) === 'open');
    if (!part) return { full: true };
    // Signed in, the profile's name shows to the booker — unless it is the booker paying a part
    // themselves (showing the link to a friend in the demo), who counts as the name given.
    const asMe = row.bookedBy !== ME;
    Object.assign(part, {
      status: 'paid', paidAt: nowIso(), claimUntil: null,
      userId: asMe ? ME : null, name: asMe ? null : (String(name || '').trim().slice(0, 40) || null),
    });
    shareToBooker(row, part);
    return { paid: true };
  });
}

/** One part paid from my saldo at the booking's hall (as krossi_split_pay_saldo): no card payment. */
export async function paySplitWithSaldo(token) {
  return run(() => {
    const { row, state } = payableLink(token);
    if (state === 'over') throw fail('Vuoro on jo alkanut.', 'over');
    if (row.bookedBy === ME) throw fail('Tämä on oma vuorosi — lähetä linkki kavereillesi.', 'own');
    const part = state === 'open' && sharesOf(row.id).find((s) => partStatus(s) === 'open');
    if (!part) return { full: true };
    if (giftAvailable(ME, row.venueId) < part.cents) throw fail('Saldosi tässä hallissa ei riitä osuuteen.', 'short');
    addCreditEvent({ venueId: row.venueId, userId: ME, kind: 'use', cents: -part.cents, bookingId: row.id, label: `Osuus: ${rowLabel(row)}` });
    Object.assign(part, { status: 'paid', paidAt: nowIso(), claimUntil: null, userId: ME, name: null, withSaldo: true });
    shareToBooker(row, part);
    return { paid: true };
  });
}

export async function verifySplitPayment(token) {
  return run(() => {
    const row = rowOfToken(token);
    if (!row) throw fail(LINK_NOT_FOUND, 'not_found');
    if (row.status !== 'confirmed') return { paid: false, status: 'refunded', message: LINK_CANCELLED };
    return { paid: true, status: 'succeeded' };
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
    && !blockers(court.id, startMs, endMs, watch.userId).length);
}

/** A booking went on sale: the watches it satisfies (of other people) are told. */
function notifyWatchers(row) {
  for (const w of db.booking.watches) {
    if (w.userId === row.bookedBy || w.notifiedAt || w.venueId !== row.venueId || Date.parse(w.startsAt) <= Date.now()) continue;
    if (watchCourts(w).some((c) => c.id === row.courtId) && freeForWatch(w)) w.notifiedAt = nowIso();
  }
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
      const blocking = liveRows().filter((r) => overlapping(r, courtId, startMs, endMs));
      if (blocking.length && blocking.every((r) => r.kind === 'booking' && r.bookedBy !== ME && !r.split)) {
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
      .map((r) => {
        const slot = r.kind === 'season' ? db.booking.seasonSlots.find((s) => s.id === r.seasonSlotId) : null;
        return {
          id: r.id, courtId: r.courtId, startsAt: r.startsAt, endsAt: r.endsAt, kind: r.kind, status: r.status,
          title: r.kind === 'booking' ? null : slot ? slot.holderName : r.title,
          bookedBy: r.guest ? { id: '', name: r.guest.name, avatarUrl: null, avatarColor: 'blue', ageRange: null, skillLevel: null }
            : (r.kind === 'booking' || r.kind === 'season') && r.bookedBy ? personLite(r.bookedBy) : null,
          guest: r.guest ? { ...r.guest } : null,
          priceCents: r.priceCents, paymentStatus: r.paymentStatus,
          seasonSlotId: r.seasonSlotId || null, credit: creditOf(r),
          forSale: onSale(r),
        };
      });
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
    // An on-sale booking is still somebody's booking: a block never takes it over.
    if (ids.some((id) => liveRows().some((r) => overlapping(r, id, startMs, endMs)))) throw fail('Aika ei ole vapaa kaikilla valituilla kentillä.', 'taken');
    return ids.map((courtId) => {
      const row = {
        id: newId('bk'), venueId: venue.id, courtId, startsAt: new Date(startMs).toISOString(), endsAt: new Date(endMs).toISOString(),
        kind, status: 'confirmed', bookedBy: null, title: name.slice(0, 80), priceCents: 0, paymentStatus: 'none',
        holdExpiresAt: null, createdAt: nowIso(), cancelledAt: null, paidAt: null, split: null, listedAt: null, resoldBy: null, resoldAt: null,
      };
      db.booking.rows.push(row);
      return row.id;
    });
  });
}

export async function unblock(blockId) {
  return run(() => {
    const row = db.booking.rows.find((r) => r.id === blockId && (r.kind === 'block' || r.kind === 'league'));
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
    row.listedAt = null;
    if (refund) {
      refundEverything(row);
    } else {
      for (const s of sharesOf(row.id)) if (s.status !== 'paid') s.status = 'cancelled';
    }
  });
}

// ── Vieras: a booking without an account ─────────────────────────────────────

const GUEST_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function guestRow(token) {
  const row = token ? db.booking.rows.find((r) => r.kind === 'booking' && r.guestToken === token) : null;
  if (!row) throw fail('Varausta ei löytynyt.', 'not_found');
  return row;
}

export async function guestHold({ courtId, startsAt, minutes, name, email } = {}) {
  return run(() => {
    const cleanName = String(name || '').replace(/\s+/g, ' ').trim();
    if (cleanName.length < 2) throw fail('Kirjoita nimesi.');
    if (cleanName.length > 80) throw fail('Nimi on liian pitkä.');
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (cleanEmail.length > 254 || !GUEST_EMAIL_RE.test(cleanEmail)) throw fail('Tarkista sähköpostiosoite.');
    const row = holdRow({ courtId, startsAt, minutes, guest: { name: cleanName, email: cleanEmail } });
    return { booking: toBooking(row), token: row.guestToken };
  });
}

/** The demo has no card form: "paying" confirms the guest's booking on the spot. */
export async function guestPaymentIntent(token) {
  return run(() => {
    const row = guestRow(token);
    const done = payable(row);
    if (done) return done;
    confirmPaid(row);
    return { paid: true };
  });
}

export async function guestVerify(token) {
  return run(() => {
    const row = guestRow(token);
    return { confirmed: row.status === 'confirmed', status: row.status === 'confirmed' ? 'succeeded' : 'requires_payment_method' };
  });
}

export async function guestRelease(token) {
  return run(() => {
    const row = guestRow(token);
    if (row.status !== 'held') return;
    row.status = 'expired';
    row.holdExpiresAt = nowIso();
  });
}

export async function guestBooking(token) {
  return run(() => {
    const row = token ? db.booking.rows.find((r) => r.kind === 'booking' && r.guestToken === token) : null;
    if (!row) return null;
    const venue = venueRow(row.venueId);
    return {
      booking: toBooking(row),
      guest: { ...row.guest },
      venue: { slug: venue.slug, name: venue.name, cancelLimitHours: venue.cancelLimitHours, holdMinutes: venue.holdMinutes },
      cancelledByGuest: row.guestCancelled === true,
      claimed: row.guestClaimed === true,
      lostMessage: null,
    };
  });
}

/** The demo's guest booking is the demo player's already: claiming only marks it moved. */
export async function claimGuest(token) {
  return run(() => {
    const row = guestRow(token);
    if (row.status !== 'confirmed' || row.guestCancelled) throw fail('Vain voimassa olevan varauksen voi liittää tiliin.');
    row.guestClaimed = true;
    return toBooking(row);
  });
}

export async function guestCancel(token) {
  return run(() => {
    const row = guestRow(token);
    if (row.guestClaimed) throw fail('Varaus on Krossi-tililläsi. Peru se omista varauksistasi.');
    if (row.status === 'cancelled' && row.guestCancelled) return { refundedCents: 0, feeCents: 0 };
    if (row.status !== 'confirmed') throw fail('Tätä varausta ei voi enää perua.');
    const venue = venueRow(row.venueId);
    if (Date.now() >= Date.parse(cancelDeadline(row.startsAt, venue))) throw fail('Peruutusaika on mennyt. Ota yhteyttä halliin.', 'too_late');
    row.status = 'cancelled';
    row.cancelledAt = nowIso();
    row.listedAt = null;
    row.guestCancelled = true;
    const { refundedCents, feeCents } = refundEverything(row, 'Peruttu', { fee: true });
    return { refundedCents, feeCents };
  });
}
