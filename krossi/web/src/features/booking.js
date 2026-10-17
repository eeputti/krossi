// booking.js — the court-booking rules the screens and the demo backend share: which start
// times a day has, what a booking costs, which courts are free. The Supabase side applies the
// same rules on the server (krossi_booking_price / krossi_hold_booking); this copy only drives
// what the calendar shows, the server decides.
//
// Times are the venue's local time. The browser's local time stands in for it (players are in
// Finland), so every Date here is built with the local-time constructors.

import { formatEuro } from '../lib/format.js';

export const SPORTS = [
  { value: 'tennis', label: 'Tennis' },
  { value: 'padel', label: 'Padel' },
  { value: 'sulkapallo', label: 'Sulkapallo' },
  { value: 'squash', label: 'Squash' },
];

/**
 * Sports players can book in the app right now. The Lahti pilot starts with tennis only; the
 * data model (and the hall's other courts on the floor maps) stays, the UI just doesn't offer them.
 */
export const LIVE_SPORTS = ['tennis'];

/** Prices are per half hour: a 90-minute booking can straddle a day and an evening price. */
export const PIECE_MINUTES = 30;
const MINUTE = 60_000;

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' of a Date in local time. */
export function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local Date for 'YYYY-MM-DD' + minutes after midnight (DST-safe: the constructor normalises). */
export function localDate(key, minutes = 0) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, m - 1, d, 0, minutes, 0, 0);
}

export function addDays(key, days) {
  const [y, m, d] = String(key).split('-').map(Number);
  return dateKey(new Date(y, m - 1, d + days));
}

/** '06:30' -> 390, '24:00' -> 1440 */
export function minutesOf(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** ISO weekday: 1 = ma … 7 = su */
export function isoWeekday(date) {
  return ((date.getDay() + 6) % 7) + 1;
}

const minuteOfDay = (date) => date.getHours() * 60 + date.getMinutes();

/** The price rule for the half hour starting at `when`, or null when nothing covers it (closed). */
export function ruleAt(prices, court, when) {
  const weekday = isoWeekday(when);
  const minute = minuteOfDay(when);
  return (prices || []).find((r) => (!r.sports || r.sports.includes(court.sport))
    && (!r.courtIds || r.courtIds.includes(court.id))
    && r.weekdays.includes(weekday)
    && minute >= minutesOf(r.from) && minute < minutesOf(r.until)) || null;
}

/** Cents for `court` from `startsAt` for `minutes`, or null when any half hour is closed. */
export function priceOf(venue, court, startsAt, minutes) {
  const start = new Date(startsAt).getTime();
  let total = 0;
  for (let m = 0; m < minutes; m += PIECE_MINUTES) {
    const rule = ruleAt(venue.prices, court, new Date(start + m * MINUTE));
    if (!rule) return null;
    total += (rule.centsPerHour * PIECE_MINUTES) / 60;
  }
  return Math.round(total);
}

/** "Viime hetken ale" percent for a booking made at `now` (0 when the venue has none or it's too early). */
export function lastMinutePercent(venue, startsAt, now = Date.now()) {
  const deal = venue?.lastMinute;
  if (!deal || !deal.percent || !deal.hours) return 0;
  const lead = Date.parse(startsAt) - now;
  return lead > 0 && lead < deal.hours * 3_600_000 ? deal.percent : 0;
}

/** The price after a percent discount, rounded to whole cents like the server does. */
export function discounted(cents, percent) {
  return percent ? Math.round((cents * (100 - percent)) / 100) : cents;
}

/** [{ court, location }] of the venue, optionally only one sport / one location. */
export function courtsOf(venue, { sport = null, locationId = null } = {}) {
  const out = [];
  for (const location of venue?.locations || []) {
    if (locationId && location.id !== locationId) continue;
    for (const court of location.courts || []) {
      if (sport && court.sport !== sport) continue;
      out.push({ court, location });
    }
  }
  return out;
}

export function findCourt(venue, courtId) {
  return courtsOf(venue).find((x) => x.court.id === courtId) || null;
}

/** Sports this venue has courts for, in SPORTS order (only LIVE_SPORTS unless `all`). */
export function sportsOf(venue, { all = false } = {}) {
  const have = new Set(courtsOf(venue).map((x) => x.court.sport));
  return SPORTS.filter((s) => have.has(s.value) && (all || LIVE_SPORTS.includes(s.value)));
}

/** Locations that have courts for `sport`. */
export function locationsFor(venue, sport) {
  return (venue?.locations || []).filter((l) => (l.courts || []).some((c) => c.sport === sport));
}

/** The bookable days: today … today + daysAhead, as 'YYYY-MM-DD'. */
export function bookingDays(venue, now = new Date()) {
  const today = dateKey(now);
  return Array.from({ length: (venue?.daysAhead ?? 14) + 1 }, (_, i) => addDays(today, i));
}

/** Start times (Date) on the venue's grid for `key` that leave room for `minutes` and are not past. */
export function startTimes(venue, key, minutes, now = Date.now()) {
  const from = minutesOf(venue.openFrom);
  const until = minutesOf(venue.openUntil);
  const step = venue.slotMinutes || 30;
  const out = [];
  for (let m = from; m + minutes <= until; m += step) {
    const start = localDate(key, m);
    if (start.getTime() > now) out.push(start);
  }
  return out;
}

const overlaps = (b, courtId, startMs, endMs) => b.courtId === courtId
  && Date.parse(b.startsAt) < endMs && Date.parse(b.endsAt) > startMs;

/**
 * An on-sale booking ("Laita myyntiin") doesn't block a booking that covers it completely: that
 * booking takes it over and its seller gets their money back. A partial overlap would leave a
 * piece of it unsold, so that still counts as taken — the same rule krossi_hold_booking applies.
 * My own on-sale booking is never mine to buy.
 */
export function takesOver(b, startMs, endMs) {
  return Boolean(b.forSale) && !b.mine && Date.parse(b.startsAt) >= startMs && Date.parse(b.endsAt) <= endMs;
}

/** The busy entry that keeps `courtId` taken for [startMs, endMs), if any. */
export function blockingAt(busy, courtId, startMs, endMs) {
  return (busy || []).find((b) => overlaps(b, courtId, startMs, endMs) && !takesOver(b, startMs, endMs)) || null;
}

/** True when `busy` has something on `courtId` that [startMs, endMs) can't be booked over. */
export function isTaken(busy, courtId, startMs, endMs) {
  return Boolean(blockingAt(busy, courtId, startMs, endMs));
}

/** The busy entry covering `courtId` at [startMs, endMs), if any (an on-sale one it would take over doesn't count). */
export function busyAt(busy, courtId, startMs, endMs) {
  return blockingAt(busy, courtId, startMs, endMs);
}

/** True when booking [startMs, endMs) on `courtId` would take over somebody's on-sale booking (no last-minute deal then). */
export function coversSale(busy, courtId, startMs, endMs) {
  return (busy || []).some((b) => overlaps(b, courtId, startMs, endMs) && takesOver(b, startMs, endMs));
}

/**
 * Free times of a day: [{ startsAt, endsAt, options: [{ court, location, cents, fullCents, resale }], deal }],
 * only start times where at least one court is free and open. Options keep the venue's court
 * order; `cents` includes a last-minute discount (`deal` = its percent, 0 without one). A court
 * that is free because its booking is on sale (`resale`) costs the full price: the seller gets
 * back what they paid. With `includeFull`, start times where every open court is taken come back
 * too, with `options: []` — the screen offers "Ilmoita kun vapautuu" for those.
 */
export function freeSlots(venue, key, busy, { sport, locationId = null, minutes, now = Date.now(), includeFull = false }) {
  const courts = courtsOf(venue, { sport, locationId });
  const out = [];
  for (const start of startTimes(venue, key, minutes, now)) {
    const startMs = start.getTime();
    const endMs = startMs + minutes * MINUTE;
    const startsAt = start.toISOString();
    const deal = lastMinutePercent(venue, startsAt, now);
    const options = [];
    let open = 0;
    for (const { court, location } of courts) {
      const fullCents = priceOf(venue, court, startsAt, minutes);
      if (fullCents == null) continue;
      open += 1;
      if (isTaken(busy, court.id, startMs, endMs)) continue;
      const resale = coversSale(busy, court.id, startMs, endMs);
      options.push({ court, location, cents: resale ? fullCents : discounted(fullCents, deal), fullCents, resale });
    }
    if (options.length || (includeFull && open)) {
      out.push({ startsAt, endsAt: new Date(endMs).toISOString(), options, deal: options.length ? deal : 0 });
    }
  }
  return out;
}

/**
 * State of every court of `sport` for one time window — what the floor map paints:
 * { [courtId]: 'free' | 'busy' | 'mine' | 'closed' }.
 */
export function courtStatesAt(venue, busy, { sport, startsAt, minutes }) {
  const startMs = Date.parse(startsAt);
  const endMs = startMs + minutes * MINUTE;
  const states = {};
  for (const { court } of courtsOf(venue, { sport })) {
    const taken = busyAt(busy, court.id, startMs, endMs);
    if (taken) states[court.id] = taken.mine ? 'mine' : 'busy';
    else states[court.id] = priceOf(venue, court, startsAt, minutes) == null ? 'closed' : 'free';
  }
  return states;
}

/** startsAt − cancelLimitHours, as ISO. */
export function cancelDeadline(startsAt, venue) {
  return new Date(Date.parse(startsAt) - (venue?.cancelLimitHours ?? 24) * 3_600_000).toISOString();
}

// ── Jaettu maksu ─────────────────────────────────────────────────────────────
// The booker pays the whole court. "Jaa maksu" then makes a link: anyone with it pays one friend
// part (no account needed), and the same sum goes back to the booker's payment method.

/** Payers per match type, the booker included: friend parts = parts − 1. */
export const SPLIT_PARTS = { kaksinpeli: 2, nelinpeli: 4 };
/** Stripe's smallest euro charge: every part has to be at least this. */
export const MIN_SHARE_CENTS = 50;

/**
 * Even parts in whole cents, like krossi_split_booking: every friend pays floor(total / parts),
 * the booker the rest (so an odd cent is theirs). → { ownCents, friendCents }
 */
export function splitCents(totalCents, parts) {
  const friendCents = Math.floor(totalCents / parts);
  return { ownCents: totalCents - friendCents * (parts - 1), friendCents };
}

/** A friend part somebody has paid (or paid and got back when the booking was cancelled). */
const settledPart = (line) => line.kind === 'friend' && (line.status === 'paid' || line.status === 'refunded');

/**
 * Whether my booking can be split in `parts` (2 or 4) now, or the split changed: paid with money
 * or the saldo (not a series card), not on sale, not started, and while no friend part is paid or
 * being paid. `saldo` false = a server before the saldo, where only card-paid bookings split.
 * → null when it can, else the reason in Finnish (the server says the same).
 */
export function splitBlocker(booking, parts, now = Date.now(), { saldo = true } = {}) {
  if (booking?.credit?.kind === 'pass') return 'Sarjakortilla maksettua vuoroa ei voi jakaa.';
  const paid = booking?.paymentStatus === 'paid' || (saldo && booking?.paymentStatus === 'credit' && booking.credit?.kind === 'gift');
  if (!booking || booking.status !== 'confirmed' || !paid) return 'Vain maksetun vuoron voi jakaa.';
  if (!saldo && booking.credit) return 'Voit jakaa vain vuoron, jonka maksoit kokonaan kortilla tai muulla verkkomaksulla.';
  if (booking.forSale) return 'Myynnissä olevaa vuoroa ei voi jakaa.';
  if (Date.parse(booking.startsAt) <= now) return 'Vuoro on jo alkanut.';
  if (booking.split?.lines.some((l) => l.kind === 'friend' && l.status !== 'open')) return 'Joku on jo maksanut osuutensa — jakoa ei voi enää muuttaa.';
  if (parts > 1 && splitCents(booking.priceCents, parts).friendCents < MIN_SHARE_CENTS) return 'Vuoro on liian edullinen jaettavaksi.';
  return null;
}

/** Friend parts of a split: { paid, open, total } (a part somebody is paying counts as neither). */
export function splitCounts(split) {
  const friends = (split?.lines || []).filter((l) => l.kind === 'friend');
  return {
    paid: friends.filter(settledPart).length,
    open: friends.filter((l) => l.status === 'open').length,
    total: friends.length,
  };
}

/** What has gone back to the booker from friends' parts so far. */
export function backToBooker(split) {
  return (split?.lines || []).filter(settledPart).reduce((n, l) => n + l.cents, 0);
}

// ── Laita myyntiin ───────────────────────────────────────────────────────────

/** A booking of mine that can go on sale now: confirmed, past its free cancellation, not started. */
export function canPutOnSale(booking, now = Date.now()) {
  return booking?.status === 'confirmed' && !booking.forSale
    && Date.parse(booking.cancellableUntil) <= now && Date.parse(booking.startsAt) > now;
}

/**
 * Peruutuskulu: when the player gives up their own booking (cancels it, or it is sold on after they
 * put it on sale), 1 € of their card / MobilePay money stays — about what the payment cost, a round
 * sum in the booking terms (supabase/functions/_shared/fees.ts CANCEL_FEE_CENTS). Series card hours
 * and saldo come back whole, friends get all of their shares, and a booking the hall cancels gives
 * everything back. Cancelling into the saldo (cancel toSaldo) keeps no fee: the card money stays
 * with the hall as saldo. Nothing is ever added on top of a price.
 */
export const CANCEL_FEE_CENTS = 100;

/**
 * What the booker gets back when they cancel their booking or it is sold: { cardCents, giftCents,
 * minutes, feeCents } — card money minus the peruutuskulu (feeCents), the saldo (giftCents) and
 * series card minutes it was paid with (BookingCredit). A split booking: the friends' paid parts
 * already went back to the booker as they were paid — into the saldo for the part paid from it
 * (line.backTo 'saldo'), else from the card payment — and the friends get theirs. Reads the same
 * before and after the money went back.
 */
export function giveBackOf(booking) {
  const none = { cardCents: 0, giftCents: 0, minutes: 0, feeCents: 0 };
  if (!booking || !['paid', 'credit', 'refunded'].includes(booking.paymentStatus)) return none;
  if (booking.credit?.kind === 'pass') return { ...none, minutes: booking.credit.minutes };
  const saldoPaid = booking.credit?.kind === 'gift' ? booking.credit.cents : 0;
  const friends = (booking.split?.lines || []).filter(settledPart);
  const toSaldo = friends.filter((l) => l.backTo === 'saldo').reduce((n, l) => n + l.cents, 0);
  const toCard = friends.filter((l) => l.backTo !== 'saldo').reduce((n, l) => n + l.cents, 0);
  const card = booking.paymentStatus === 'credit' ? 0 : Math.max(0, booking.priceCents - saldoPaid - toCard);
  const feeCents = Math.min(CANCEL_FEE_CENTS, card);
  return { ...none, cardCents: card - feeCents, feeCents, giftCents: Math.max(0, saldoPaid - toSaldo) };
}

/**
 * The two ways my own cancellation can give the card part back (venue.saldo): { cardCents, feeCents }
 * to the card minus the peruutuskulu, or saldoCents whole into my saldo at the hall. giftCents (the
 * saldo it was paid with) goes back to the saldo either way. null = there is no card part to choose for.
 */
export function cancelChoices(booking) {
  const back = giveBackOf(booking);
  if (back.cardCents + back.feeCents <= 0 || booking?.paymentStatus !== 'paid') return null;
  return { cardCents: back.cardCents, feeCents: back.feeCents, saldoCents: back.cardCents + back.feeCents + back.giftCents, giftCents: back.giftCents };
}

/** Friends paid their parts of a split booking (they get them back themselves). */
export const friendsPaid = (booking) => Boolean(booking?.split?.lines.some(settledPart));

const backParts = ({ cardCents = 0, giftCents = 0, minutes = 0 }) => ({
  card: cardCents > 0 ? centsLabel(cardCents) : null,
  gift: giftCents > 0 ? centsLabel(giftCents) : null,
  hours: minutes > 0 ? durationLabel(minutes) : null,
});

/**
 * 'Saat takaisin 14 € maksutavallesi (peruutuskulu 1 €) ja 5 € lahjakorttisaldoosi' (giveBackOf, or
 * a cancel's answer); null = nothing.
 */
export function giveBackText(back) {
  const { card, gift, hours } = backParts(back || {});
  const fee = back?.feeCents > 0 && card ? ` (peruutuskulu ${centsLabel(back.feeCents)})` : '';
  const parts = [card && `${card} maksutavallesi${fee}`, gift && `${gift} saldoosi`, hours && `${hours} sarjakortillesi`].filter(Boolean);
  if (!parts.length) return null;
  return `Saat takaisin ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} ja ${parts.at(-1)}` : parts[0]}`;
}

/** The bell's short form: '30 € palautetaan' | '1 h sarjakortille' | '5 € saldoon'; '' = nothing. */
export function giveBackShort(back) {
  const { card, gift, hours } = backParts(back || {});
  return [card && `${card} palautetaan`, gift && `${gift} saldoon`, hours && `${hours} sarjakortille`].filter(Boolean).join(', ');
}

// ── Saldo ────────────────────────────────────────────────────────────────────
// Hallikohtainen saldo: money a player keeps at one hall (top-ups, redeemed gift cards, refunds)
// and pays bookings and friends' shares with — no card payment each time. Only usable at that
// hall, never moved to another player, never paid out except unused top-ups back to their card.

/** The saldo's rules, as the server's krossi_saldo_rules (wallet.products' topup). */
export const SALDO_RULES = Object.freeze({ amounts: Object.freeze([2500, 5000, 10000]), refundFreeDays: 14, refundDays: 180, refundFeeCents: 100 });

/**
 * What goes back to the card now (krossi_saldo_refund_plan): the unused part of my paid top-ups of
 * the last refundDays, newest first, at most `saldoCents`; the round fee once a top-up in it is
 * older than refundFreeDays (taken from the oldest). topups: [{ id, amountCents, refundedCents,
 * paidAt }]. → { totalCents (off the saldo), feeCents, cents (to the card), freeUntil (ISO|null),
 * rows: [{ topupId, cents, feeCents }] }
 */
export function saldoRefundPlan(saldoCents, topups, now = Date.now(), rules = SALDO_RULES) {
  const DAY_MS = 86_400_000;
  let left = Math.max(0, saldoCents);
  const rows = [];
  let old = false;
  let freeUntil = null;
  const usable = (topups || [])
    .filter((t) => t.paidAt && t.amountCents > (t.refundedCents || 0) && Date.parse(t.paidAt) > now - rules.refundDays * DAY_MS)
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  for (const t of usable) {
    if (left <= 0) break;
    const take = Math.min(left, t.amountCents - (t.refundedCents || 0));
    rows.push({ topupId: t.id, cents: take, feeCents: 0 });
    left -= take;
    const free = Date.parse(t.paidAt) + rules.refundFreeDays * DAY_MS;
    if (free <= now) old = true;
    else freeUntil = Math.min(freeUntil ?? Infinity, free);
  }
  const totalCents = rows.reduce((n, r) => n + r.cents, 0);
  const feeCents = old ? Math.min(rules.refundFeeCents, totalCents) : 0;
  let fee = feeCents;
  for (let i = rows.length - 1; i >= 0 && fee > 0; i -= 1) {
    const take = Math.min(fee, rows[i].cents);
    rows[i] = { ...rows[i], cents: rows[i].cents - take, feeCents: take };
    fee -= take;
  }
  return {
    totalCents, feeCents, cents: totalCents - feeCents,
    freeUntil: old || freeUntil == null ? null : new Date(freeUntil).toISOString(),
    rows,
  };
}

/** '1 h' | '1,5 h' | '2 h' | '45 min' */
export function durationLabel(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : String(hours).replace('.', ',')} h`;
}

/** '23 €' | '22,50 €' */
export function centsLabel(cents) {
  return formatEuro((cents || 0) / 100);
}

/** 'Aamu' | 'Päivä' | 'Ilta' for grouping a day's start times. */
export function partOfDay(iso) {
  const h = new Date(iso).getHours();
  if (h < 12) return 'Aamu';
  if (h < 17) return 'Päivä';
  return 'Ilta';
}

// The profile's play times (AVAILABILITY_SLOTS) as weekday/weekend hour ranges. Evenings start at
// 18 here so the usual 18.00 slot counts as an evening.
const AVAILABILITY_HOURS = {
  aamuvirkku: { days: 'all', from: 6, until: 9 },
  arkiaamut: { days: 'week', from: 9, until: 12 },
  'arkipäivät': { days: 'week', from: 12, until: 15 },
  'arki-iltapäivät': { days: 'week', from: 15, until: 18 },
  'arki-illat': { days: 'week', from: 18, until: 22 },
  viikonloppuaamut: { days: 'weekend', from: 9, until: 12 },
  'viikonloppupäivät': { days: 'weekend', from: 12, until: 15 },
  'viikonloppuiltapäivät': { days: 'weekend', from: 15, until: 18 },
  viikonloppuillat: { days: 'weekend', from: 18, until: 22 },
};

/** True when `startsAt` falls in one of the player's usual play times ('joustavasti' alone = no hint). */
export function fitsAvailability(availability, startsAt) {
  if (!availability?.length) return false;
  const d = new Date(startsAt);
  const weekend = isoWeekday(d) >= 6;
  const hour = d.getHours() + d.getMinutes() / 60;
  return availability.some((slot) => {
    const range = AVAILABILITY_HOURS[slot];
    if (!range) return false;
    if (range.days === 'week' && weekend) return false;
    if (range.days === 'weekend' && !weekend) return false;
    return hour >= range.from && hour < range.until;
  });
}

// ── Games and courts ─────────────────────────────────────────────────────────
// A game (challenges row) and a court booking aren't linked in the data: a booking of mine
// "is" a game's court when the game starts inside it (or up to half an hour before it starts:
// a 18.00 booking for a game posted as 17.45). Pelataanko? and the game page use this to say
// "Kenttä varattu" or offer "Varaa kenttä tälle pelille".

const LIVE_BOOKING = new Set(['held', 'confirmed']);

/** True when `game` (with a time) is played on `booking`. */
export function bookingFitsGame(booking, game) {
  if (!booking || !game?.scheduledAt || !LIVE_BOOKING.has(booking.status)) return false;
  const t = Date.parse(game.scheduledAt);
  return Date.parse(booking.startsAt) - 30 * MINUTE <= t && t < Date.parse(booking.endsAt);
}

/** My booking that is the court of `game`, or null. */
export function bookingForGame(bookings, game) {
  return (bookings || []).find((b) => bookingFitsGame(b, game)) || null;
}

/** My game that is played on `booking`, or null. */
export function gameForBooking(games, booking) {
  return (games || []).find((g) => g.status !== 'cancelled' && bookingFitsGame(booking, g)) || null;
}

/** "Kenttä varattu" / "Puuttuu pelikaveri": a booking with nobody to play with is one with no game and no split. */
export function needsPartner(booking, games) {
  return !booking.split && !gameForBooking(games, booking);
}

const NO_TIME = Number.MAX_SAFE_INTEGER; // "aika sovitaan" games sort last

/**
 * My coming games and courts in time order — Koti's "Seuraava pelisi", Pelit → Omat pelit and
 * Pelataanko?'s "Tulossa": [{ kind: 'game', id, at, game } | { kind: 'court', id, at, booking, empty }].
 * A confirmed booking that is one of my games' court shows as that game; the others are courts of
 * their own, `empty` when nobody plays on them yet (needsPartner). Held bookings (still being paid)
 * stay out.
 */
export function gamesAndCourts(games, bookings) {
  const list = games || [];
  const courts = (bookings || []).filter((b) => b.status === 'confirmed' && !gameForBooking(list, b));
  return [
    ...list.map((g) => ({ kind: 'game', id: g.id, at: g.scheduledAt ? Date.parse(g.scheduledAt) : NO_TIME, game: g })),
    ...courts.map((b) => ({ kind: 'court', id: b.id, at: Date.parse(b.startsAt), booking: b, empty: !b.split })),
  ].sort((a, b) => a.at - b.at);
}

// ── Chat ─────────────────────────────────────────────────────────────────────

// A payment link at the end of a chat message (the demo's shareMessage, or pasted by the booker).
const SPLIT_LINK_RE = /:?\s*https:\/\/krossi\.app\/(?:pelaa|demo)\/maksa\/([A-Za-z0-9_-]+)\s*$/;

/**
 * "Varasin meille kentän … Osuutesi on 15 € — maksa se tästä: <link>" → { text: the message
 * without the link, token }, else null. The chat shows the link as a "Maksa osuutesi" button
 * (other apps just see the link).
 */
export function shareRequestOf(text) {
  const s = String(text || '');
  const m = SPLIT_LINK_RE.exec(s);
  if (!m) return null;
  return { text: s.slice(0, m.index).trim(), token: m[1] };
}
