// seasons.js — the rules of kausivuorot (season slots), their billing and the hall's credit
// products, shared by the screens, the demo backend and the tests. The server applies the same
// rules (supabase/migrations/20261016100000_krossi_booking_seasons_billing_wallet.sql); this copy
// drives what the screens show and what the demo does.
//
//   Season weeks   every date of the season on the slot's weekday, minus the season's holidays
//   Season price   per calendar month: round(Σ normal prices of the month's weeks × (100 − %) / 100);
//                  the season = Σ months, so the invoice and the monthly card charges add up
//   Invoices       Finnish reference number (7-3-1 check digit) and the bank's virtual barcode (v4)
//   Credits        series cards hold minutes, gift balance holds cents; gift balance may pay part
//                  of a booking, but the card then still pays at least MIN_CARD_CENTS
//
// Dates are 'YYYY-MM-DD' in the venue's local time (the browser's, as in booking.js).

import { MONTHS } from '../lib/format.js';
import {
  addDays, busyAt, courtsOf, dateKey, durationLabel, findCourt, isoWeekday, localDate, minutesOf, priceOf,
} from './booking.js';

/** Stripe's smallest euro charge: a gift balance never leaves less than this for the card. */
export const MIN_CARD_CENTS = 50;

export const WEEKDAY_SHORT = ['ma', 'ti', 'ke', 'to', 'pe', 'la', 'su'];
export const WEEKDAY_NAMES = ['maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'lauantai', 'sunnuntai'];
/** 'maanantaisin' … for "ke 19.00" style sentences: "keskiviikkoisin klo 19.00". */
export const WEEKDAY_ADVERBS = ['maanantaisin', 'tiistaisin', 'keskiviikkoisin', 'torstaisin', 'perjantaisin', 'lauantaisin', 'sunnuntaisin'];

const pad = (n) => String(n).padStart(2, '0');

/** '19:00' -> '19.00' */
export function clockLabel(hhmm) {
  const m = minutesOf(hhmm);
  return `${Math.floor(m / 60)}.${pad(m % 60)}`;
}

/** '19:00' + 60 -> '20:00' */
export function addClock(hhmm, minutes) {
  const m = minutesOf(hhmm) + minutes;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** 'ke 19.00–20.00' */
export function slotWhen(slot) {
  return `${WEEKDAY_SHORT[slot.weekday - 1]} ${clockLabel(slot.startTime)}–${clockLabel(addClock(slot.startTime, slot.minutes))}`;
}

/** '1.11.' / '1.11.2026' from 'YYYY-MM-DD' */
export function dayMonth(key, withYear = false) {
  const [y, m, d] = String(key).split('-').map(Number);
  return withYear ? `${d}.${m}.${y}` : `${d}.${m}.`;
}

/** '2026-11' -> 'marraskuu 2026'; short -> 'marras' */
export function monthLabel(month, short = false) {
  const [y, m] = String(month).split('-').map(Number);
  const name = MONTHS[m - 1] || '';
  return short ? name.replace(/kuu$/, '') : `${name} ${y}`;
}

// ── Season weeks and price ───────────────────────────────────────────────────

/**
 * The season's dates on ISO `weekday` from `from` on (the season's start at the earliest):
 * { dates, skipped } — skipped = the season's holidays on that weekday.
 */
export function seasonDates(season, weekday, from = null) {
  const start = from && from > season.startsOn ? from : season.startsOn;
  let key = addDays(start, (weekday - isoWeekday(localDate(start)) + 7) % 7);
  const skip = new Set(season.skipDates || []);
  const dates = [];
  const skipped = [];
  for (; key <= season.endsOn; key = addDays(key, 7)) (skip.has(key) ? skipped : dates).push(key);
  return { dates, skipped };
}

/** One week's instants: { startsAt, endsAt } (DST-safe: built from the local clock). */
export function weekTimes(date, startTime, minutes) {
  const start = localDate(date, minutesOf(startTime));
  return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + minutes * 60_000).toISOString() };
}

/** Rounds like the server: whole cents, half away from zero. */
const discountedCents = (cents, percent) => Math.round((cents * (100 - percent)) / 100);

/**
 * Season price of the bookable weeks ([{ date, cents }]): per month the normal prices minus the
 * discount, rounded; the season is the sum of the months. { fullCents, cents, months }.
 */
export function seasonPrice(weeks, discountPercent = 0) {
  const byMonth = new Map();
  for (const w of weeks) {
    const month = w.date.slice(0, 7);
    const entry = byMonth.get(month) || { month, count: 0, full: 0 };
    entry.count += 1;
    entry.full += w.cents || 0;
    byMonth.set(month, entry);
  }
  const months = [...byMonth.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((e) => ({ month: e.month, count: e.count, cents: discountedCents(e.full, discountPercent) }));
  return {
    fullCents: weeks.reduce((sum, w) => sum + (w.cents || 0), 0),
    cents: months.reduce((sum, m) => sum + m.cents, 0),
    months,
  };
}

/**
 * SeasonQuote (api/contract.js) for one court, or for the court with the fewest conflicts.
 *   rows   live reservations of the venue over the season ({ courtId, startsAt, endsAt, kind, title })
 *   now    weeks that have started are left out
 */
export function quoteSeason(venue, season, rows, {
  courtId = null, locationId = null, sport = 'tennis', weekday, startTime, minutes, fromDate = null, now = Date.now(),
} = {}) {
  const asked = courtId ? findCourt(venue, courtId) : null;
  const theSport = asked?.court.sport || sport;
  const { dates, skipped } = seasonDates(season, weekday, fromDate);
  const times = dates.map((date) => ({ date, ...weekTimes(date, startTime, minutes) }))
    .filter((t) => Date.parse(t.startsAt) > now);

  const weeksFor = (court) => times.map((t) => {
    const cents = priceOf(venue, court, t.startsAt, minutes);
    const taken = busyAt(rows, court.id, Date.parse(t.startsAt), Date.parse(t.endsAt));
    let conflict = null;
    if (taken) conflict = { kind: taken.kind, title: taken.kind === 'booking' ? null : taken.title || null };
    else if (cents == null) conflict = { kind: 'closed', title: null };
    return { date: t.date, startsAt: t.startsAt, endsAt: t.endsAt, cents, conflict };
  });

  const candidates = courtsOf(venue, { sport: theSport, locationId: asked ? asked.location.id : locationId }).map((x) => x.court);
  const courts = candidates.map((court) => ({ courtId: court.id, conflicts: weeksFor(court).filter((w) => w.conflict).length }));
  let court = asked?.court || null;
  if (!court && candidates.length) {
    const best = courts.reduce((a, b) => (b.conflicts < a.conflicts ? b : a));
    court = candidates.find((c) => c.id === best.courtId);
  }

  const weeks = court ? weeksFor(court) : [];
  const bookable = weeks.filter((w) => !w.conflict);
  const price = seasonPrice(bookable, season.discountPercent);
  return {
    seasonId: season.id,
    courtId: court?.id || null,
    weekday,
    startTime,
    minutes,
    weeks,
    skipped: skipped.filter((date) => Date.parse(weekTimes(date, startTime, minutes).startsAt) > now),
    count: bookable.length,
    fullCents: price.fullCents,
    discountPercent: season.discountPercent,
    cents: price.cents,
    months: price.months,
    courts,
  };
}

/** 'Kausivuoro ke 19.00–20.00 · Tennis 1, Janus-Areena · 21.10.2026–28.4.2027' */
export function seasonLineText(slot, { courtName, locationName, firstDate, lastDate }) {
  const place = [courtName, locationName].filter(Boolean).join(', ');
  return `Kausivuoro ${slotWhen(slot)} · ${place} · ${dayMonth(firstDate, true)}–${dayMonth(lastDate, true)}`;
}

/**
 * An invoice's lines for a season slot: the weeks at their normal price, then the season
 * discount (or the price the hall agreed on) as a negative line. `weeks` = the booked weeks.
 */
export function invoiceLines(slot, { weeks, fullCents, priceCents, discountPercent, agreed = false, courtName, locationName }) {
  const count = weeks.length;
  const lines = [{
    text: seasonLineText(slot, { courtName, locationName, firstDate: weeks[0]?.date, lastDate: weeks[count - 1]?.date }),
    quantity: count,
    unit: 'krt',
    unitCents: count ? Math.round(fullCents / count) : 0,
    totalCents: fullCents,
  }];
  if (priceCents !== fullCents) {
    lines.push({
      text: agreed ? 'Sovittu kausihinta' : `Kausialennus ${discountPercent} %`,
      quantity: 1,
      unit: '',
      unitCents: null,
      totalCents: priceCents - fullCents,
    });
  }
  return lines;
}

/** Month-by-month card charges: each month on its 1st, the first one on `firstDueOn` (approval day). */
export function chargeSchedule(months, firstDueOn) {
  return months.map((m) => ({
    month: m.month,
    weeks: m.count,
    amountCents: m.cents,
    dueOn: `${m.month}-01` < firstDueOn ? firstDueOn : `${m.month}-01`,
  }));
}

// ── Invoices ─────────────────────────────────────────────────────────────────

/** Finnish reference number check digit: weights 7, 3, 1 from the right. */
export function referenceCheckDigit(base) {
  const weights = [7, 3, 1];
  const digits = String(base).replace(/\D/g, '').split('').reverse();
  const sum = digits.reduce((total, d, i) => total + Number(d) * weights[i % 3], 0);
  return (10 - (sum % 10)) % 10;
}

/** '1001' -> '10016' (viitenumero). */
export function referenceNumber(base) {
  const digits = String(base).replace(/\D/g, '');
  return `${digits}${referenceCheckDigit(digits)}`;
}

export function isValidReference(reference) {
  const digits = String(reference || '').replace(/\s/g, '');
  if (!/^\d{4,20}$/.test(digits)) return false;
  return referenceCheckDigit(digits.slice(0, -1)) === Number(digits.slice(-1));
}

/** '1234561' -> '12 34561' (groups of five from the right, like the banks print it). */
export function formatReference(reference) {
  const digits = String(reference || '').replace(/\s/g, '');
  const groups = [];
  for (let end = digits.length; end > 0; end -= 5) groups.unshift(digits.slice(Math.max(0, end - 5), end));
  return groups.join(' ');
}

/** 'FI2112345600000785' -> 'FI21 1234 5600 0007 85' */
export function formatIban(iban) {
  return String(iban || '').replace(/\s/g, '').replace(/(.{4})(?=.)/g, '$1 ');
}

/** The VAT inside a VAT-inclusive total (rounded to cents). */
export function vatOf(totalCents, vatPercent) {
  return Math.round((totalCents * vatPercent) / (100 + vatPercent));
}

/**
 * The bank's virtual barcode (pankkiviivakoodi, version 4) for a Finnish IBAN and a Finnish
 * reference number: 54 digits to paste into the online bank. null when it can't be built
 * (non-Finnish IBAN, 1 000 000 € or more, an RF reference).
 */
export function virtualBarcode({ iban, cents, reference, dueOn }) {
  const account = String(iban || '').replace(/\s/g, '').toUpperCase();
  const ref = String(reference || '').replace(/\s/g, '');
  if (!/^FI\d{16}$/.test(account) || !/^\d{1,20}$/.test(ref) || !Number.isInteger(cents) || cents < 0 || cents >= 100_000_000) return null;
  const euros = String(Math.floor(cents / 100)).padStart(6, '0');
  const due = /^\d{4}-\d{2}-\d{2}$/.test(String(dueOn || '')) ? `${dueOn.slice(2, 4)}${dueOn.slice(5, 7)}${dueOn.slice(8, 10)}` : '000000';
  return `4${account.slice(2)}${euros}${pad(cents % 100)}000${ref.padStart(20, '0')}${due}`;
}

/** 'paid' | 'void' | 'overdue' | 'open' */
export function invoiceState(invoice, today = dateKey(new Date())) {
  if (invoice.status !== 'open') return invoice.status;
  return invoice.dueOn < today ? 'overdue' : 'open';
}

export const INVOICE_STATE_LABELS = { open: 'Avoin', overdue: 'Erääntynyt', paid: 'Maksettu', void: 'Mitätöity' };

// ── Card charges ─────────────────────────────────────────────────────────────

export const CHARGE_STATE_LABELS = {
  scheduled: 'Tulossa', processing: 'Käsittelyssä', paid: 'Veloitettu', failed: 'Epäonnistui', void: 'Peruttu',
};

/** A month waiting for money: due by `today` and not paid (scheduled, or failed and retried). */
export function chargeIsDue(charge, today = dateKey(new Date())) {
  return (charge.status === 'scheduled' || charge.status === 'failed') && charge.dueOn <= today;
}

// ── Credits ──────────────────────────────────────────────────────────────────

/**
 * How much of `priceCents` a gift balance of `availableCents` covers: all of it when it can,
 * else as much as leaves MIN_CARD_CENTS for the card (0 when the balance is empty).
 */
export function giftShare(priceCents, availableCents) {
  if (!(availableCents > 0) || !(priceCents > 0)) return 0;
  if (availableCents >= priceCents) return priceCents;
  return Math.max(0, Math.min(availableCents, priceCents - MIN_CARD_CENTS));
}

/** 'pending' | 'active' | 'used' | 'expired' for a stored pass ({ status, minutesLeft, validUntil }). */
export function passState(pass, today = dateKey(new Date())) {
  if (pass.status === 'pending') return 'pending';
  if (pass.validUntil && pass.validUntil < today) return 'expired';
  return pass.minutesLeft > 0 ? 'active' : 'used';
}

/** Whether `pass` can pay a booking of `minutes` minutes of `sport` starting `startsAt`. */
export function passFits(pass, { sport, minutes, startsAt }) {
  return pass.status === 'active' && pass.sport === sport && pass.minutesLeft >= minutes
    && Boolean(pass.validUntil) && dateKey(new Date(startsAt)) <= pass.validUntil;
}

/** '8 h' / '8,5 h' / '30 min' / '0 h' */
export function hoursLeftLabel(minutes) {
  return minutes > 0 ? durationLabel(minutes) : '0 h';
}

/** 'Tennis 10 × 1 h' style name for a product. */
export function passProductName({ sport, uses, minutesPerUse }) {
  const sportName = { tennis: 'Tennis', padel: 'Padel', sulkapallo: 'Sulkapallo', squash: 'Squash' }[sport] || 'Tennis';
  return `${sportName} ${uses} × ${durationLabel(minutesPerUse)}`;
}

/** The label a credit event keeps of its booking: 'Tennis 2 · Janus-Areena · ti 6.10. klo 19.00'. */
export function creditEventLabel({ courtName, locationName, startsAt }) {
  const d = new Date(startsAt);
  const day = `${WEEKDAY_SHORT[isoWeekday(d) - 1]} ${d.getDate()}.${d.getMonth() + 1}.`;
  return `${[courtName, locationName].filter(Boolean).join(' · ')} · ${day} klo ${d.getHours()}.${pad(d.getMinutes())}`;
}

// ── Gift card codes ──────────────────────────────────────────────────────────

/** No 0/O, 1/I: a code read aloud over the counter can't be mistyped into another one. */
export const GIFT_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GIFT_PREFIX = 'KRSI';

/** 'KRSI-7F3K-9QPA' from eight random characters of GIFT_ALPHABET (`random` = Math.random-like). */
export function newGiftCode(random = Math.random) {
  let body = '';
  for (let i = 0; i < 8; i += 1) body += GIFT_ALPHABET[Math.floor(random() * GIFT_ALPHABET.length)];
  return `${GIFT_PREFIX}-${body.slice(0, 4)}-${body.slice(4)}`;
}

/** What the player typed, as the stored code ('krsi 7f3k 9qpa' -> 'KRSI-7F3K-9QPA'), or null. */
export function normalizeGiftCode(input) {
  let raw = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length === GIFT_PREFIX.length + 8 && raw.startsWith(GIFT_PREFIX)) raw = raw.slice(GIFT_PREFIX.length);
  if (raw.length !== 8) return null;
  return `${GIFT_PREFIX}-${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** Date `days` after `key` (gift / pass validity). */
export const validUntilFrom = (key, days) => addDays(key, days);
