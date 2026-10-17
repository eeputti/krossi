// seasons.js — the rules of kausivuorot (season slots), their billing and the hall's credit
// products, shared by the screens, the demo backend and the tests. The server applies the same
// rules (supabase/migrations/20261017105241_krossi_booking_seasons_billing_wallet.sql); this copy
// drives what the screens show and what the demo does.
//
//   Season weeks   every date of the season on the slot's weekday, minus the season's holidays
//   Season price   per calendar month: round(Σ normal prices of the month's weeks × (100 − %) / 100);
//                  the season = Σ months, so the invoice and the monthly card charges add up
//   Invoices       Finnish reference number (7-3-1 check digit) and the bank's virtual barcode (v4)
//   Credits        series cards hold minutes, gift balance holds cents; gift balance may pay part
//                  of a booking, but the card then still pays at least MIN_CARD_CENTS
//   Settings       what the hall edits in Hallin asetukset: seasons and their holidays (Finnish
//                  holidays from Easter), series card products, gift card limits and the invoicing
//                  details (Y-tunnus and IBAN check digits) — the same checks and messages as the
//                  staff RPCs in 20261017105827_krossi_booking_hall_settings.sql
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

// ── Holidays ─────────────────────────────────────────────────────────────────

/** Easter Sunday of `year` (anonymous Gregorian algorithm), 'YYYY-MM-DD'. */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The first ISO `weekday` on or after `key`. */
const weekdayFrom = (key, weekday) => addDays(key, (weekday - isoWeekday(localDate(key)) + 7) % 7);

/**
 * Finnish public holidays and the eves halls close for (jouluaatto, juhannusaatto,
 * uudenvuodenaatto) from `fromKey` to `toKey`: [{ date, name }] by date. "Lisää Suomen pyhät" in
 * the season editor adds them all; the hall takes off the ones it plays on.
 */
export function finnishHolidays(fromKey, toKey) {
  const out = [];
  for (let y = Number(String(fromKey).slice(0, 4)); y <= Number(String(toKey).slice(0, 4)); y += 1) {
    const easter = easterSunday(y);
    out.push(
      { date: `${y}-01-01`, name: 'uudenvuodenpäivä' },
      { date: `${y}-01-06`, name: 'loppiainen' },
      { date: addDays(easter, -2), name: 'pitkäperjantai' },
      { date: easter, name: 'pääsiäispäivä' },
      { date: addDays(easter, 1), name: '2. pääsiäispäivä' },
      { date: `${y}-05-01`, name: 'vappu' },
      { date: addDays(easter, 39), name: 'helatorstai' },
      { date: addDays(easter, 49), name: 'helluntaipäivä' },
      { date: weekdayFrom(`${y}-06-19`, 5), name: 'juhannusaatto' },
      { date: weekdayFrom(`${y}-06-20`, 6), name: 'juhannuspäivä' },
      { date: weekdayFrom(`${y}-10-31`, 6), name: 'pyhäinpäivä' },
      { date: `${y}-12-06`, name: 'itsenäisyyspäivä' },
      { date: `${y}-12-24`, name: 'jouluaatto' },
      { date: `${y}-12-25`, name: 'joulupäivä' },
      { date: `${y}-12-26`, name: 'tapaninpäivä' },
      { date: `${y}-12-31`, name: 'uudenvuodenaatto' },
    );
  }
  return out.filter((x) => x.date >= fromKey && x.date <= toKey).sort((a, b) => a.date.localeCompare(b.date));
}

/** 'itsenäisyyspäivä' for '2026-12-06'; null for an ordinary day. */
export function holidayName(key) {
  return finnishHolidays(key, key)[0]?.name ?? null;
}

// ── Hallin asetukset ─────────────────────────────────────────────────────────
// What the hall's settings save. Each check returns { value, field, error }: the input as stored,
// or the first problem as a Finnish message (the same ones the RPCs raise, in the same order), so
// the demo backend refuses with it and the sheets show it under the field.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const trimmed = (value) => String(value ?? '').trim();
const isDay = (value) => DATE_RE.test(String(value || '')) && dateKey(localDate(value)) === value;
const wholeEuros = (cents) => Number.isInteger(cents) && cents % 100 === 0;
const utcDay = (key) => {
  const [y, m, d] = String(key).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Days from `a` to `b` ('YYYY-MM-DD'). */
export const daysBetween = (a, b) => Math.round((utcDay(b) - utcDay(a)) / 86_400_000);

/** A season's holidays as saved: real days inside startsOn…endsOn, each once, in order. */
export function seasonSkipDates(dates, startsOn, endsOn) {
  return [...new Set((dates || []).filter((d) => isDay(d) && d >= startsOn && d <= endsOn))].sort();
}

export const SEASON_LIMITS = { maxDays: 400, maxDiscount: 90, maxSkipDates: 100 };

/**
 * SeasonInput -> { value, field, error }. `booked` = { from, until } of the season's active
 * slots' weeks (the dates must still cover them); `isNew` refuses a season that is already over.
 */
export function checkSeason(input, { today = dateKey(new Date()), booked = null, isNew = false } = {}) {
  const name = trimmed(input?.name);
  const { startsOn, endsOn, discountPercent } = input || {};
  const fail = (field, error) => ({ value: null, field, error });
  if (!name) return fail('name', 'Anna kaudelle nimi.');
  if (name.length > 80) return fail('name', 'Kauden nimi saa olla enintään 80 merkkiä.');
  if (!isDay(startsOn) || !isDay(endsOn)) return fail('dates', 'Tarkista kauden päivät.');
  if (endsOn < startsOn) return fail('dates', 'Kauden pitää päättyä alkamisen jälkeen.');
  if (daysBetween(startsOn, endsOn) > SEASON_LIMITS.maxDays) return fail('dates', `Kausi voi olla enintään ${SEASON_LIMITS.maxDays} päivää.`);
  if (isNew && endsOn < today) return fail('dates', 'Kausi on jo päättynyt. Tarkista päivät.');
  if (booked?.from && (startsOn > booked.from || endsOn < booked.until)) {
    return fail('dates', `Kauden kausivuoroja pelataan ${dayMonth(booked.from, true)}–${dayMonth(booked.until, true)}, joten kausi ei voi alkaa myöhemmin eikä päättyä aiemmin.`);
  }
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > SEASON_LIMITS.maxDiscount) {
    return fail('discountPercent', `Kausialennus on 0–${SEASON_LIMITS.maxDiscount} %.`);
  }
  const skipDates = seasonSkipDates(input.skipDates, startsOn, endsOn);
  if (skipDates.length > SEASON_LIMITS.maxSkipDates) return fail('skipDates', `Pyhiä voi olla enintään ${SEASON_LIMITS.maxSkipDates}.`);
  return {
    value: { name, startsOn, endsOn, skipDates, discountPercent, requestsOpen: input.requestsOpen !== false },
    field: null,
    error: null,
  };
}

export const PRODUCT_LIMITS = { maxUses: 200, minMinutes: 30, maxMinutes: 480, maxValidDays: 1825, minCents: 50, maxCents: 1_000_000 };

/** PassProductInput -> { value, field, error }. `sports` = the sports the venue has courts for. */
export function checkPassProduct(input, { sports = null } = {}) {
  const name = trimmed(input?.name);
  const description = trimmed(input?.description);
  const { sport, uses, minutesPerUse, validDays, priceCents } = input || {};
  const L = PRODUCT_LIMITS;
  const fail = (field, error) => ({ value: null, field, error });
  if (!name) return fail('name', 'Anna sarjakortille nimi.');
  if (name.length > 80) return fail('name', 'Nimi saa olla enintään 80 merkkiä.');
  if (!['tennis', 'padel', 'sulkapallo', 'squash'].includes(sport)) return fail('sport', 'Valitse laji.');
  if (sports && !sports.includes(sport)) return fail('sport', 'Hallissa ei ole tämän lajin kenttiä.');
  if (!Number.isInteger(uses) || uses < 1 || uses > L.maxUses) return fail('uses', `Kertoja on 1–${L.maxUses}.`);
  if (!Number.isInteger(minutesPerUse) || minutesPerUse < L.minMinutes || minutesPerUse > L.maxMinutes || minutesPerUse % 30) {
    return fail('minutesPerUse', 'Kerran pituus on 30 min – 8 h puolen tunnin välein.');
  }
  if (!Number.isInteger(validDays) || validDays < 1 || validDays > L.maxValidDays) return fail('validDays', `Voimassaolo on 1–${L.maxValidDays} päivää.`);
  if (!Number.isInteger(priceCents) || priceCents < L.minCents || priceCents > L.maxCents) return fail('priceCents', 'Hinta on 0,50–10 000 €.');
  if (description.length > 300) return fail('description', 'Kuvaus saa olla enintään 300 merkkiä.');
  return {
    value: { name, sport, uses, minutesPerUse, validDays, priceCents, description: description || null, active: input.active !== false },
    field: null,
    error: null,
  };
}

export const GIFT_LIMITS = { minCents: 100, maxCents: 100_000, maxAmounts: 6, minValidDays: 30, maxValidDays: 1825 };

/** GiftSettings -> { value, field, error } (amounts sorted, each once). */
export function checkGiftSettings(input) {
  const { minCents, maxCents, validDays } = input || {};
  const L = GIFT_LIMITS;
  const fail = (field, error) => ({ value: null, field, error });
  const inRange = (c) => wholeEuros(c) && c >= L.minCents && c <= L.maxCents;
  if (!inRange(minCents)) return fail('minCents', 'Pienin summa on 1–1000 € täysinä euroina.');
  if (!inRange(maxCents)) return fail('maxCents', 'Suurin summa on 1–1000 € täysinä euroina.');
  if (minCents > maxCents) return fail('minCents', 'Pienin summa ei voi olla suurempi kuin suurin.');
  const amounts = [...new Set(Array.isArray(input.amounts) ? input.amounts : [])].sort((a, b) => a - b);
  if (amounts.length < 1 || amounts.length > L.maxAmounts) return fail('amounts', `Valitse 1–${L.maxAmounts} valmista summaa.`);
  if (!amounts.every((c) => wholeEuros(c) && c >= minCents && c <= maxCents)) {
    return fail('amounts', `Valmiiden summien pitää olla täysiä euroja välillä ${minCents / 100}–${maxCents / 100} €.`);
  }
  if (!Number.isInteger(validDays) || validDays < L.minValidDays || validDays > L.maxValidDays) {
    return fail('validDays', `Voimassaolo on ${L.minValidDays}–${L.maxValidDays} päivää.`);
  }
  return { value: { amounts, minCents, maxCents, validDays }, field: null, error: null };
}

/**
 * Y-tunnus as stored ('1234567-1') from what was typed — '1234567-1', '12345671', an old six-digit
 * '123456-7' (gets a leading zero) or the VAT number 'FI12345671' — or null when it isn't one. The
 * check digit: digits × 7, 9, 10, 5, 8, 4, 2, the sum mod 11 taken from 11 (0 stays 0; 1 is never valid).
 */
export function normalizeBusinessId(input) {
  let raw = String(input || '').toUpperCase().replace(/\s/g, '');
  if (/^FI\d{8}$/.test(raw)) raw = raw.slice(2);
  if (/^\d{8}$/.test(raw)) raw = `${raw.slice(0, 7)}-${raw.slice(7)}`;
  if (/^\d{6}-\d$/.test(raw)) raw = `0${raw}`;
  if (!/^\d{7}-\d$/.test(raw)) return null;
  const sum = [7, 9, 10, 5, 8, 4, 2].reduce((total, w, i) => total + w * Number(raw[i]), 0);
  const rest = sum % 11;
  if (rest === 1) return null;
  return (rest === 0 ? 0 : 11 - rest) === Number(raw[8]) ? raw : null;
}

/**
 * IBAN as stored ('FI2112345600000785': capitals, no spaces), or null: ISO 13616 — the first four
 * characters moved to the end, letters as 10–35, the number mod 97 = 1. A Finnish one is 18 long.
 */
export function normalizeIban(input) {
  const iban = String(input || '').toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return null;
  if (iban.startsWith('FI') && iban.length !== 18) return null;
  let rest = 0;
  for (const ch of iban.slice(4) + iban.slice(0, 4)) {
    const digits = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1 ? iban : null;
}

/** BIC as stored ('NDEAFIHH'), or null when it isn't 8 or 11 characters of the right kind. */
export function normalizeBic(input) {
  const bic = String(input || '').toUpperCase().replace(/\s/g, '');
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic) ? bic : null;
}

export const isEmail = (value) => EMAIL_RE.test(String(value || '')) && String(value).length <= 200;

/**
 * BillingSettingsInput -> { value, field, error }. Empty fields are saved empty (an invoice needs
 * only the seller's name and IBAN, `ready`); filled ones must be right. nextInvoiceNumber null
 * keeps the current one; a new one must be above `lastInvoiceNumber`, the biggest used so far.
 */
export function checkBillingSettings(input, { lastInvoiceNumber = 0 } = {}) {
  const fail = (field, error) => ({ value: null, field, error });
  const sellerName = trimmed(input?.sellerName);
  const address = trimmed(input?.address);
  const rawBusinessId = trimmed(input?.businessId);
  const rawIban = trimmed(input?.iban);
  const rawBic = trimmed(input?.bic);
  const email = trimmed(input?.email);
  const phone = trimmed(input?.phone);
  const { vatPercent, paymentTermsDays, nextInvoiceNumber } = input || {};
  if (sellerName.length > 120) return fail('sellerName', 'Nimi saa olla enintään 120 merkkiä.');
  const businessId = rawBusinessId ? normalizeBusinessId(rawBusinessId) : null;
  if (rawBusinessId && !businessId) return fail('businessId', 'Tarkista Y-tunnus (muoto 1234567-8).');
  if (address.length > 200) return fail('address', 'Osoite saa olla enintään 200 merkkiä.');
  const iban = rawIban ? normalizeIban(rawIban) : null;
  if (rawIban && !iban) return fail('iban', 'Tarkista tilinumero (IBAN).');
  const bic = rawBic ? normalizeBic(rawBic) : null;
  if (rawBic && !bic) return fail('bic', 'Tarkista BIC-koodi.');
  if (bic && iban?.startsWith('FI') && bic.slice(4, 6) !== 'FI') return fail('bic', 'Suomalaisen tilinumeron BIC-koodissa on FI (esim. NDEAFIHH).');
  if (email && !isEmail(email)) return fail('email', 'Tarkista sähköpostiosoite.');
  if (phone && !/^[0-9+()\- ]{5,40}$/.test(phone)) return fail('phone', 'Tarkista puhelinnumero.');
  if (typeof vatPercent !== 'number' || !Number.isFinite(vatPercent) || vatPercent < 0 || vatPercent > 50
    || Math.abs(Math.round(vatPercent * 10) - vatPercent * 10) > 1e-9) {
    return fail('vatPercent', 'ALV-prosentti on 0–50 (esim. 14 tai 25,5).');
  }
  if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 90) return fail('paymentTermsDays', 'Maksuaika on 0–90 päivää.');
  if (nextInvoiceNumber != null) {
    if (!Number.isInteger(nextInvoiceNumber) || nextInvoiceNumber < 1 || nextInvoiceNumber > 999_999_999) {
      return fail('nextInvoiceNumber', 'Tarkista seuraavan laskun numero.');
    }
    if (nextInvoiceNumber <= lastInvoiceNumber) {
      return fail('nextInvoiceNumber', `Seuraavan laskun numeron pitää olla suurempi kuin viimeisimmän laskun (${lastInvoiceNumber}).`);
    }
  }
  return {
    value: {
      sellerName, businessId, address: address || null, iban, bic, email: email || null, phone: phone || null,
      vatPercent, paymentTermsDays, nextInvoiceNumber: nextInvoiceNumber ?? null,
    },
    field: null,
    error: null,
  };
}
