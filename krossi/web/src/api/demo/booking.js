// booking.js (demo) — court booking against the in-memory hall in bookingSeed.js, with the
// rules of the booking RPCs (krossi_hold_booking & co.) and the krossi-booking edge function.
// Payments don't go anywhere: checkoutConfig answers { demo: true } and the "payment" confirms
// the booking at once.
//
// Jaettu maksu: a booking held with friendIds is split. Once Alex has "paid" his part, every
// friend gets a chat message from him with a "Maksa osuutesi" link, and the friends answer a
// little later (one pays, then another; somebody always leaves it to the last minute). After the
// deadline (startsAt − shareDeadlineHours) the unpaid shares become the booker's rest share; in the
// demo the saved card always says yes. Laita myyntiin: a booking past its free cancellation goes
// on sale, somebody books the slot a little later and everything that was paid goes back.

import { ApiError } from '../errors.js';
import { ME } from './rows.js';
import { later, run, newId } from './runtime.js';
import { db, nowIso, personLite, profileOf, isBlocked, isMember, myConversations, conversationRow } from './store.js';
import { findOrCreateDirect, postMessage } from './actions.js';
import { shareMessage } from './bookingSeed.js';
import {
  addDays, cancelDeadline, courtsOf, dateKey, discounted, findCourt, lastMinutePercent, localDate, minutesOf,
  priceOf, shareDeadline, splitBlocker, splitCents,
} from '../../features/booking.js';
import { WEEKDAYS_SHORT, firstName, formatTime } from '../../lib/format.js';

const MIN = 60_000;
const MAX_HOLDS = 2;
const MAX_WATCHES = 5;
const STAFF_ONLY = 'Vain hallin henkilökunta voi tehdä tämän.';
const TAKEN = 'Joku ehti varata tämän ajan juuri ennen sinua. Valitse toinen aika.';
const SHARE_NOT_FOUND = 'Osuutta ei löytynyt.';
const FRIENDS_ONLY = 'Voit jakaa maksun vain pelikavereidesi kanssa.';
const BUYER_PAYING = 'Joku on juuri varaamassa vuoroa. Jos maksu ei mene läpi, voit perua myynnin hetken päästä.';
// The other players' booking names in the demo, for the buyer of an on-sale slot.
const BUYERS = ['p-joonas', 'p-teemu', 'p-emilia', 'p-riikka', 'p-olli'];

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
const overlapping = (r, courtId, startMs, endMs) => r.courtId === courtId
  && Date.parse(r.startsAt) < endMs && Date.parse(r.endsAt) > startMs;
const onSale = (r) => r.status === 'confirmed' && Boolean(r.listedAt);
/** An on-sale booking that [startMs, endMs) covers whole: `forUser` can take it over (never their own). */
const takenOver = (r, startMs, endMs, forUser) => onSale(r) && r.bookedBy !== forUser
  && Date.parse(r.startsAt) >= startMs && Date.parse(r.endsAt) <= endMs;

/** Live rows that keep `courtId` taken for [startMs, endMs) (what the exclusion constraint + the cover rule refuse). */
function blockers(courtId, startMs, endMs, forUser = ME) {
  return liveRows().filter((r) => overlapping(r, courtId, startMs, endMs) && !takenOver(r, startMs, endMs, forUser));
}

/** On-sale rows a booking of [startMs, endMs) on `courtId` would take over. */
function salesCovered(courtId, startMs, endMs, forUser = ME) {
  return liveRows().filter((r) => overlapping(r, courtId, startMs, endMs) && takenOver(r, startMs, endMs, forUser));
}

function dayRange(key) {
  return [localDate(key).getTime(), localDate(addDays(key, 1)).getTime()];
}

function inRange(row, [from, to]) {
  return Date.parse(row.startsAt) < to && Date.parse(row.endsAt) > from;
}

// ── Shapes ───────────────────────────────────────────────────────────────────

const sharesOf = (bookingId) => db.booking.shares
  .filter((s) => s.bookingId === bookingId)
  .sort((a, b) => (a.kind === 'rest') - (b.kind === 'rest') || a.createdAt.localeCompare(b.createdAt)); // stable: friends in the order picked

function ownStatus(row) {
  if (row.paymentStatus === 'paid' || row.paymentStatus === 'free') return 'paid';
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
    forSale: onSale(row),
    soldAt: row.resoldAt ?? null,
    split: splitOf(row),
  };
}

function shareRow(shareId) {
  return db.booking.shares.find((s) => s.id === shareId) || null;
}

function bookingOfShare(share) {
  return db.booking.rows.find((r) => r.id === share.bookingId) || null;
}

function isPayable(share, row, now = Date.now()) {
  if (!['pending', 'declined'].includes(share.status) || row?.status !== 'confirmed') return false;
  return share.kind === 'rest' || now < Date.parse(row.split.deadline);
}

function toShare(share) {
  const row = bookingOfShare(share);
  return {
    id: share.id,
    kind: share.kind,
    cents: share.cents,
    status: share.status,
    paidAt: share.paidAt,
    deadline: row.split.deadline,
    payable: isPayable(share, row),
    chargeError: share.kind === 'rest' ? share.chargeError : null,
    booker: personLite(row.bookedBy),
    booking: toBooking(row),
  };
}

function myRow(bookingId) {
  const row = db.booking.rows.find((r) => r.id === bookingId && r.kind === 'booking');
  if (!row || row.bookedBy !== ME) throw fail('Varausta ei löytynyt.', 'not_found');
  return row;
}

// ── The deadline and money moving (what krossi-booking-cron and the refunds do) ──────────

/**
 * Split bookings whose deadline has passed: the unpaid friend shares become the booker's rest
 * share, charged to the saved card — which in the demo always works. Runs lazily on every read.
 */
function settleDueShares(now = Date.now()) {
  for (const row of db.booking.rows) {
    if (!row.split || row.status !== 'confirmed' || row.paymentStatus !== 'paid' || Date.parse(row.split.deadline) > now) continue;
    const shares = sharesOf(row.id);
    if (shares.some((s) => s.kind === 'rest')) continue;
    const unpaid = shares.filter((s) => s.kind === 'friend' && ['pending', 'declined'].includes(s.status));
    if (!unpaid.length) continue;
    const rest = {
      id: newId('sh'), bookingId: row.id, userId: row.bookedBy, kind: 'rest', cents: unpaid.reduce((sum, s) => sum + s.cents, 0),
      status: 'paid', paidAt: nowIso(), invitedAt: null, declinedAt: null, chargeError: null, coveredBy: null, createdAt: nowIso(),
    };
    db.booking.shares.push(rest);
    for (const s of unpaid) { s.status = 'covered'; s.coveredBy = rest.id; }
  }
}

/** Everything paid for `row` goes back (own part, friends' shares, the rest); unpaid shares are dropped. */
function refundEverything(row) {
  let ownRefund = 0;
  if (row.paymentStatus === 'paid') {
    ownRefund = row.split ? row.split.ownCents : row.priceCents;
    row.paymentStatus = 'refunded';
  }
  for (const s of sharesOf(row.id)) {
    if (s.status === 'paid') {
      if (s.kind === 'rest') ownRefund += s.cents;
      s.status = 'refunded';
    } else if (['pending', 'declined'].includes(s.status)) {
      s.status = 'cancelled';
    }
  }
  return ownRefund;
}

/** A paid booking takes over the on-sale bookings it covers: they are sold, their payers refunded. */
function takeOverSales(row) {
  const startMs = Date.parse(row.startsAt);
  const endMs = Date.parse(row.endsAt);
  for (const sold of salesCovered(row.courtId, startMs, endMs, row.bookedBy)) {
    sold.status = 'cancelled';
    sold.cancelledAt = nowIso();
    sold.resoldBy = row.id;
    sold.resoldAt = nowIso();
    refundEverything(sold);
  }
}

/** 'to 17.10. klo 19.00' — chat messages are read later, so no "huomenna". */
const exactWhen = (iso) => `${WEEKDAYS_SHORT[new Date(iso).getDay()]} ${localDateLabel(iso)} klo ${formatTime(iso)}`;
function localDateLabel(iso) {
  const d = new Date(iso);
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

/** Friends are told in their own chat with the booker, then answer a little later. */
function inviteShares(row) {
  const venue = venueRow(row.venueId);
  const found = findCourt(venue, row.courtId);
  const friends = sharesOf(row.id).filter((s) => s.kind === 'friend' && !s.invitedAt);
  friends.forEach((s, i) => {
    s.invitedAt = nowIso();
    const conversation = findOrCreateDirect(s.userId);
    postMessage(conversation.id, row.bookedBy, {
      text: shareMessage({
        courtName: found?.court.name || 'Kenttä', locationName: found?.location.name || '', startsAt: row.startsAt, endsAt: row.endsAt,
        cents: s.cents, deadline: row.split.deadline, shareId: s.id,
      }),
    });
    // Everybody but the last of a nelinpeli pays within half a minute; the last one leaves it for later.
    if (friends.length > 1 && i === friends.length - 1) return;
    later(8000 + i * 9000, 12000 + i * 9000, () => {
      const current = shareRow(s.id);
      const booking = current && bookingOfShare(current);
      if (!current || current.status !== 'pending' || !isPayable(current, booking) || !profileOf(current.userId)) return;
      current.status = 'paid';
      current.paidAt = nowIso();
      const chat = conversationRow(conversation.id);
      if (chat) postMessage(chat.id, current.userId, { text: i === 0 ? 'Maksoin osuuteni, kiitos varauksesta! 🎾' : 'Maksettu 👍 Nähdään kentällä!' });
    });
  });
}

function confirmPaid(row) {
  row.status = 'confirmed';
  row.paymentStatus = 'paid';
  row.paidAt = nowIso();
  row.holdExpiresAt = null;
  takeOverSales(row);
  if (row.split) inviteShares(row);
}

// ── Friends to split with ────────────────────────────────────────────────────

/** Who counts as a pelikaveri for jaettu maksu: shares a chat or a game with Alex, or a league match. */
function friendTimes() {
  const seen = new Map();
  const note = (id, iso) => {
    if (!id || id === ME || !profileOf(id) || isBlocked(id)) return;
    const ms = Date.parse(iso) || 0;
    if (!seen.has(id) || seen.get(id) < ms) seen.set(id, ms);
  };
  for (const c of myConversations()) for (const id of c.participantIds) note(id, c.updatedAt);
  for (const g of db.games.values()) {
    if (g.status === 'cancelled' || !isMember(g)) continue;
    for (const id of [g.creatorId, ...g.participantIds]) note(id, g.scheduledAt || g.createdAt);
  }
  for (const f of db.fixtures.values()) {
    if (f.playerAId === ME) note(f.playerBId, f.result?.confirmedAt || f.createdAt);
    if (f.playerBId === ME) note(f.playerAId, f.result?.confirmedAt || f.createdAt);
  }
  return seen;
}

export async function shareFriends() {
  return run(() => [...friendTimes().entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => personLite(id)));
}

function checkFriends(friendIds, row, venue) {
  const ids = [...new Set((friendIds || []).filter(Boolean))];
  if (ids.length !== (friendIds || []).length || ![1, 3].includes(ids.length)) {
    throw fail('Valitse kaksinpeliin yksi ja nelinpeliin kolme pelikaveria.');
  }
  const friends = friendTimes();
  if (ids.some((id) => id === ME || !friends.has(id))) throw fail(FRIENDS_ONLY);
  const parts = ids.length + 1;
  const blocker = splitBlocker(venue, row.startsAt, row.priceCents, parts);
  if (blocker) throw fail(blocker);
  return { ids, parts };
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
        forSale: onSale(r),
      }));
    return { date: key, busy };
  });
}

// ── Booking and paying ───────────────────────────────────────────────────────

export async function hold({ courtId, startsAt, minutes, friendIds = [] } = {}) {
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
    expireStaleHolds(now);
    const endMs = start.getTime() + minutes * MIN;
    // Taking over an on-sale booking costs the full price: its seller gets back what they paid.
    const resale = salesCovered(courtId, start.getTime(), endMs).length > 0;
    const cents = resale ? fullCents : discounted(fullCents, lastMinutePercent(venue, start.toISOString(), now));
    const draft = { startsAt: start.toISOString(), priceCents: cents };
    const split = (friendIds || []).length ? checkFriends(friendIds, draft, venue) : null;
    const myHolds = db.booking.rows.filter((r) => r.bookedBy === ME && r.status === 'held');
    if (myHolds.length >= MAX_HOLDS) throw fail('Sinulla on jo kaksi maksamatonta varausta. Maksa tai peru ne ensin.');
    if (blockers(courtId, start.getTime(), endMs).length) throw fail(TAKEN, 'taken');
    const free = cents === 0;
    const row = {
      id: newId('bk'), venueId: venue.id, courtId, startsAt: start.toISOString(), endsAt: new Date(endMs).toISOString(),
      kind: 'booking', status: free ? 'confirmed' : 'held', bookedBy: ME, title: null, priceCents: cents,
      paymentStatus: free ? 'free' : 'unpaid', holdExpiresAt: free ? null : new Date(now + venue.holdMinutes * MIN).toISOString(),
      createdAt: nowIso(), cancelledAt: null, paidAt: free ? nowIso() : null, split: null, listedAt: null, resoldBy: null, resoldAt: null,
    };
    if (split) {
      const { ownCents, friendCents } = splitCents(cents, split.parts);
      row.split = { parts: split.parts, ownCents, deadline: shareDeadline(row.startsAt, venue) };
      for (const userId of split.ids) {
        db.booking.shares.push({
          id: newId('sh'), bookingId: row.id, userId, kind: 'friend', cents: friendCents, status: 'pending', paidAt: null,
          invitedAt: null, declinedAt: null, chargeError: null, coveredBy: null, createdAt: nowIso(),
        });
      }
    }
    db.booking.rows.push(row);
    if (free) takeOverSales(row);
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
    return payable(row) || { demo: true, amount: row.split ? row.split.ownCents : row.priceCents, currency: 'eur' };
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
    settleDueShares(now);
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
    row.status = 'cancelled';
    row.cancelledAt = nowIso();
    row.listedAt = null;
    return { refundedCents: refundEverything(row) };
  });
}

// ── Laita myyntiin ───────────────────────────────────────────────────────────

/** In the demo somebody books an on-sale slot a little later; the seller gets everything back. */
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

// ── Jaettu maksu: shares ─────────────────────────────────────────────────────

/** A friend sees their share once the booker has paid and asked (a rest share is the booker's own). */
const asked = (share) => share.kind === 'rest' || Boolean(share.invitedAt);

/** My share (to pay), or any share of my own booking (to look at). */
function visibleShare(shareId) {
  const share = shareRow(shareId);
  const row = share && bookingOfShare(share);
  if (!share || !row) return null;
  if (row.bookedBy === ME) return share;
  return share.userId === ME && asked(share) ? share : null;
}

function myShare(shareId) {
  settleDueShares();
  const share = shareRow(shareId);
  if (!share || share.userId !== ME || !asked(share)) throw fail(SHARE_NOT_FOUND, 'not_found');
  return share;
}

/** Why a share of mine can't be paid now, or null when it can. */
function shareBlocker(share) {
  const row = bookingOfShare(share);
  if (share.status === 'paid') return null;
  if (share.status === 'covered') return fail(`Maksuaika päättyi — ${firstName(personLite(row.bookedBy).name)} maksoi osuutesi.`, 'closed');
  if (share.status === 'cancelled' || share.status === 'refunded' || row.status !== 'confirmed') return fail('Vuoro on peruttu — osuutta ei tarvitse maksaa.', 'cancelled');
  if (!isPayable(share, row)) return fail('Maksuaika päättyi.', 'closed');
  return null;
}

export async function listShares() {
  return run(() => {
    const now = Date.now();
    settleDueShares(now);
    const recent = now - 30 * 86_400_000;
    const mine = db.booking.shares
      .filter((s) => s.userId === ME && asked(s))
      .filter((s) => {
        const row = bookingOfShare(s);
        return row && (isPayable(s, row, now) || Date.parse(row.endsAt) > recent);
      })
      .map(toShare);
    const payable = mine.filter((s) => s.payable).sort((a, b) => a.deadline.localeCompare(b.deadline));
    const rest = mine.filter((s) => !s.payable).sort((a, b) => b.booking.startsAt.localeCompare(a.booking.startsAt));
    return [...payable, ...rest];
  });
}

export async function getShare(shareId) {
  return run(() => {
    settleDueShares();
    const share = visibleShare(shareId);
    return share ? toShare(share) : null;
  });
}

export async function shareCheckoutConfig(shareId) {
  return run(() => {
    const share = myShare(shareId);
    const blocked = shareBlocker(share);
    if (blocked) throw blocked;
    if (share.status === 'paid') return { paid: true };
    return { demo: true, amount: share.cents, currency: 'eur' };
  });
}

export async function createSharePaymentIntent(shareId) {
  return run(() => {
    const share = myShare(shareId);
    const blocked = shareBlocker(share);
    if (blocked) throw blocked;
    if (share.status !== 'paid') {
      share.status = 'paid';
      share.paidAt = nowIso();
      share.chargeError = null;
    }
    return { paid: true };
  });
}

export async function verifySharePayment(shareId) {
  return run(() => {
    const share = myShare(shareId);
    return { paid: share.status === 'paid', status: share.status === 'paid' ? 'succeeded' : 'requires_payment_method' };
  });
}

export async function declineShare(shareId) {
  return run(() => {
    const share = myShare(shareId);
    if (share.kind !== 'friend') throw fail(SHARE_NOT_FOUND, 'not_found');
    if (share.status === 'paid') throw fail('Osuutesi on jo maksettu. Jos et pääse, kerro siitä viestillä.');
    const blocked = shareBlocker(share);
    if (blocked) throw blocked;
    if (share.status === 'declined') return;
    share.status = 'declined';
    share.declinedAt = nowIso();
    const row = bookingOfShare(share);
    const conversation = findOrCreateDirect(row.bookedBy);
    postMessage(conversation.id, ME, { text: `En pääse valitettavasti mukaan vuoroon ${exactWhen(row.startsAt)}.` });
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

/** Not paid yet: friend shares still open, and a rest share the card didn't cover. */
function unpaidCents(row) {
  if (!row.split) return 0;
  return sharesOf(row.id)
    .filter((s) => ['pending', 'declined'].includes(s.status))
    .reduce((sum, s) => sum + s.cents, 0);
}

export async function staffDay(venueId, key) {
  return run(() => {
    const venue = venueRow(venueId);
    requireStaff(venue);
    settleDueShares();
    const range = dayRange(key);
    return liveRows()
      .filter((r) => r.venueId === venue.id && inRange(r, range))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map((r) => ({
        id: r.id, courtId: r.courtId, startsAt: r.startsAt, endsAt: r.endsAt, kind: r.kind, status: r.status,
        title: r.kind === 'booking' ? null : r.title,
        bookedBy: r.kind === 'booking' && r.bookedBy ? personLite(r.bookedBy) : null,
        priceCents: r.priceCents, paymentStatus: r.paymentStatus,
        forSale: onSale(r), unpaidCents: unpaidCents(r), parts: r.split?.parts ?? null,
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
    row.listedAt = null;
    if (refund) {
      refundEverything(row);
    } else {
      for (const s of sharesOf(row.id)) if (['pending', 'declined'].includes(s.status)) s.status = 'cancelled';
    }
  });
}
