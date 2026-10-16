// hallData.js — the hall view's pure helpers (screens/booking/Hall*.jsx): where each item sits on
// the day's timeline, which half hours are free / closed / over, the day's numbers per location
// and the block form's time choices. No React here, so test/hall.test.mjs runs it in Node.
//
// Times are the venue's local time (the browser's, like features/booking.js). Minutes after
// midnight are read from the local clock, never from "instant − midnight", so the DST night
// doesn't shift a day's grid by an hour.

import { LIVE_SPORTS, dateKey, localDate, minutesOf, priceOf } from '../../features/booking.js';
import { WEEKDAYS_SHORT, dayLabel } from '../../lib/format.js';

/** The timeline's resolution in minutes (= the price pieces of features/booking.js). */
export const SLOT = 30;
const DAY = 24 * 60;
const pad = (n) => String(n).padStart(2, '0');

/** '18.30' / '6.00' for minutes after midnight (Finnish style, like formatTime). */
export function hhmm(minutes) {
  const m = Math.round(minutes);
  return `${Math.floor(m / 60)}.${pad(m % 60)}`;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `value` when it is a real 'YYYY-MM-DD' calendar day (e.g. from ?pv=), else null. */
export function parseDayKey(value) {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return null;
  return dateKey(localDate(value)) === value ? value : null;
}

/** 'Tänään ke 14.10.' / 'pe 17.10.': the date, with the relative word when there is one. */
export function dayText(key, today = dateKey(new Date())) {
  const d = localDate(key);
  const short = `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`;
  const relative = dayLabel(d.toISOString(), localDate(today));
  return relative === short ? short : `${relative} ${short}`;
}

/** ISO week number of a day key (the hall plans its series by week). */
export function isoWeek(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); // the Thursday of its week
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
}

/**
 * The venue's locations with only the courts of sports that are live in the app (LIVE_SPORTS —
 * the Lahti pilot is tennis only); locations left without courts are dropped. The data model
 * keeps every court, the hall view just doesn't show the others.
 */
export function liveLocations(venue, sports = LIVE_SPORTS) {
  return (venue?.locations || [])
    .map((location) => ({ ...location, courts: (location.courts || []).filter((c) => sports.includes(c.sport)) }))
    .filter((location) => location.courts.length > 0);
}

/** The venue's day on the grid: { from, until, slots }, minutes after midnight snapped to SLOT. */
export function dayWindow(venue) {
  const from = Math.floor(minutesOf(venue?.openFrom || '06:00') / SLOT) * SLOT;
  const until = Math.max(from + SLOT, Math.ceil(minutesOf(venue?.openUntil || '23:00') / SLOT) * SLOT);
  return { from, until, slots: (until - from) / SLOT };
}

/** Minutes after `key`'s midnight for an ISO instant; earlier days clamp to 0, later ones to 1440. */
export function minuteIn(iso, key) {
  const d = new Date(iso);
  const k = dateKey(d);
  if (k < key) return 0;
  if (k > key) return DAY;
  return d.getHours() * 60 + d.getMinutes();
}

/** "Now" in minutes after midnight on `key`: a number today, Infinity for a past day, -Infinity ahead. */
export function nowMinuteOn(key, now = Date.now()) {
  const d = new Date(now);
  const today = dateKey(d);
  if (key === today) return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  return key < today ? Infinity : -Infinity;
}

/** Where an item sits on the grid: { start, len } in slots from the window start, null if outside. */
export function spanOf(item, key, win) {
  const start = Math.max(win.from, minuteIn(item.startsAt, key));
  const end = Math.min(win.until, minuteIn(item.endsAt, key));
  if (end <= start) return null;
  return { start: (start - win.from) / SLOT, len: (end - start) / SLOT };
}

const isOpen = (venue, court, key, minute) => priceOf(venue, court, localDate(key, minute).toISOString(), SLOT) != null;

/**
 * Every half hour of `court` on `key`, window start first: 'busy' (an item covers it), 'closed'
 * (no price rule = can't be booked), 'past' (already over) or 'free'.
 */
export function cellStates(venue, court, key, items, nowMin = -Infinity, win = dayWindow(venue)) {
  const spans = (items || []).filter((it) => it.courtId === court.id)
    .map((it) => [minuteIn(it.startsAt, key), minuteIn(it.endsAt, key)]);
  const out = [];
  for (let m = win.from; m < win.until; m += SLOT) {
    if (spans.some(([s, e]) => s < m + SLOT && e > m)) out.push('busy');
    else if (!isOpen(venue, court, key, m)) out.push('closed');
    else if (m + SLOT <= nowMin) out.push('past');
    else out.push('free');
  }
  return out;
}

/** A booking the player hasn't paid yet: still on hold, or confirmed without a payment. */
export const isUnpaid = (item) => item.kind === 'booking' && (item.status === 'held' || item.paymentStatus === 'unpaid');

/**
 * The day's numbers for one location:
 *   bookings     kind 'booking' (held ones too)
 *   season       kausivuoro weeks (kind 'season'), billed with the season
 *   own          the hall's own rows (blocks + league), one per court
 *   unpaid       held / unpaid bookings, unpaidCents their value
 *   salesCents   paid bookings
 *   utilization  occupied ÷ bookable minutes; bookable = half hours a price rule covers, and only
 *                those count as occupied, so a block over closed hours can't push it past 100 %.
 */
export function daySummary(venue, location, key, items, win = dayWindow(venue)) {
  const courts = location?.courts || [];
  const ids = new Set(courts.map((c) => c.id));
  const here = (items || []).filter((it) => ids.has(it.courtId));
  let bookableMin = 0;
  let usedMin = 0;
  for (const court of courts) {
    const spans = here.filter((it) => it.courtId === court.id)
      .map((it) => [minuteIn(it.startsAt, key), minuteIn(it.endsAt, key)]);
    for (let m = win.from; m < win.until; m += SLOT) {
      if (!isOpen(venue, court, key, m)) continue;
      bookableMin += SLOT;
      let covered = 0;
      for (const [s, e] of spans) covered += Math.max(0, Math.min(e, m + SLOT) - Math.max(s, m));
      usedMin += Math.min(SLOT, covered);
    }
  }
  const bookings = here.filter((it) => it.kind === 'booking');
  const season = here.filter((it) => it.kind === 'season');
  const unpaid = bookings.filter(isUnpaid);
  const sum = (list) => list.reduce((total, it) => total + (it.priceCents || 0), 0);
  return {
    bookings: bookings.length,
    season: season.length,
    own: here.length - bookings.length - season.length,
    unpaid: unpaid.length,
    unpaidCents: sum(unpaid),
    salesCents: sum(bookings.filter((it) => it.paymentStatus === 'paid')),
    bookableMin,
    usedMin,
    utilization: bookableMin ? usedMin / bookableMin : 0,
  };
}

/** '62 %' */
export function percentLabel(ratio) {
  return `${Math.round((ratio || 0) * 100)} %`;
}

/** Block form: start times whose half hour hasn't ended yet. */
export function startChoices(win, nowMin = -Infinity) {
  const out = [];
  for (let m = win.from; m < win.until; m += SLOT) if (m + SLOT > nowMin) out.push(m);
  return out;
}

/** Block form: end times after `startMin`, up to closing. */
export function endChoices(win, startMin) {
  const out = [];
  for (let m = startMin + SLOT; m <= win.until; m += SLOT) out.push(m);
  return out;
}

/** The first half hour that hasn't ended on `key` (today), else 16.00 — where a new block starts. */
export function defaultStart(win, nowMin) {
  const choices = startChoices(win, nowMin);
  if (Number.isFinite(nowMin)) return choices[0] ?? win.from;
  const evening = 16 * 60;
  return choices.includes(evening) ? evening : (choices[0] ?? win.from);
}

/** Items on `courtIds` overlapping [startMin, endMin) of `key` — what a block would collide with. */
export function conflictsFor(items, courtIds, key, startMin, endMin) {
  const set = new Set(courtIds);
  return (items || []).filter((it) => set.has(it.courtId)
    && minuteIn(it.startsAt, key) < endMin && minuteIn(it.endsAt, key) > startMin);
}

/** The rows one block() call made (one per court): same kind, title and times. A booking is alone. */
export function blockGroup(items, item) {
  if (!item || item.kind === 'booking') return item ? [item] : [];
  const group = (items || []).filter((it) => it.kind === item.kind && it.title === item.title
    && it.startsAt === item.startsAt && it.endsAt === item.endsAt);
  return group.some((it) => it.id === item.id) ? group : [item, ...group];
}

/** A league block: the hallisarja's evenings ("Hallisarja", "Hallisarja – 3. kierros"). */
export function kindForTitle(title) {
  return /^\s*hallisarja/i.test(String(title || '')) ? 'league' : 'block';
}

/** 'Te1, Te2, Te3' — or '7 kenttää' when the list gets long. Courts in display order. */
export function courtsLabel(courts) {
  if (!courts.length) return 'Ei kenttiä';
  if (courts.length <= 4) return courts.map((c) => c.shortName).join(', ');
  return `${courts.length} kenttää`;
}

/** Segmented label for a location: 'Janus-Areena' / 'Ulkokentät'; short: 'Janus' / 'Ulkokentät'. */
export function locationLabel(location, short = false) {
  const name = String(location?.name || '');
  if (location && !location.indoor && /ulkokent/i.test(name)) return 'Ulkokentät';
  return short ? name.split(/[-\s]/)[0] || name : name;
}

/** Payment of a booking for chips and labels: { label, tone } (Chip tones). */
export function paymentInfo(item) {
  if (item.kind === 'season') return { label: 'Kausivuoro', tone: 'neutral' };
  if (item.paymentStatus === 'credit') return { label: item.credit?.kind === 'gift' ? 'Lahjakortti' : 'Sarjakortti', tone: 'success' };
  if (item.paymentStatus === 'paid' && item.credit?.kind === 'gift') return { label: 'Maksettu + lahjakortti', tone: 'success' };
  if (item.paymentStatus === 'paid') return { label: 'Maksettu', tone: 'success' };
  if (item.paymentStatus === 'refunded') return { label: 'Hyvitetty', tone: 'neutral' };
  if (item.paymentStatus === 'free') return { label: 'Maksuton', tone: 'neutral' };
  return { label: 'Maksamatta', tone: 'warn' };
}

/** How the timeline paints an item: 'booking' | 'unpaid' | 'held' | 'league' | 'block' | 'season'. */
export function itemVariant(item) {
  if (item.kind === 'season') return 'season';
  if (item.kind === 'league') return 'league';
  if (item.kind === 'block') return 'block';
  if (item.status === 'held') return 'held';
  return item.paymentStatus === 'unpaid' ? 'unpaid' : 'booking';
}
