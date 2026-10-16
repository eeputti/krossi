// seasons.js (demo) — kausivuorot against the hall in bookingSeed.js / hallSeed.js, with the rules
// of the krossi_season_* RPCs: quotes over the whole season, requests, the hall's approval (the
// weeks become reservation rows, the invoice or the monthly card schedule is made), ending a
// slot and freeing one week. Same Finnish messages and error codes as the SQL.

import { ME, ME_EMAIL } from './rows.js';
import { newId, run } from './runtime.js';
import { db, nowIso, personLite } from './store.js';
import { dateKey, findCourt, minutesOf } from '../../features/booking.js';
import {
  chargeSchedule, dayMonth, invoiceLines, quoteSeason, referenceNumber, vatOf,
} from '../../features/seasons.js';
import { expireStaleHolds, fail, isLive, liveRows, requireStaff, venueRow } from './bookingCore.js';
import { seasonRow, slotRow, slotRows, toSeason, toSlot } from './seasonCore.js';

const MAX_OPEN_REQUESTS = 3;
const today = () => dateKey(new Date());

/** The season of a visible venue, else 'Kautta ei löytynyt.' */
function seasonAndVenue(seasonId) {
  const season = seasonRow(seasonId);
  const venue = season ? venueRow(season.venueId) : null;
  if (!season || !venue) throw fail('Kautta ei löytynyt.', 'not_found');
  return { season, venue };
}

/** Weekday, start and length the way krossi_season_check_time checks them. */
function checkTime(venue, { weekday, startTime, minutes }) {
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw fail('Valitse viikonpäivä.');
  if (!/^\d{2}:\d{2}$/.test(String(startTime || ''))) throw fail('Valitse aloitusaika.');
  if (!venue.durations.includes(minutes)) throw fail('Valitse vuoron kesto.');
  const start = minutesOf(startTime);
  if (start % venue.slotMinutes) throw fail('Valitse aloitusaika.');
  if (start < minutesOf(venue.openFrom) || start + minutes > minutesOf(venue.openUntil)) throw fail('Halli on suljettu tähän aikaan.');
}

/** A court of the venue (and of `sport` when given), else 'Kenttää ei löytynyt.' */
function courtOf(venue, courtId, sport = null) {
  const found = courtId ? findCourt(venue, courtId) : null;
  if (!found || (sport && found.court.sport !== sport)) throw fail('Kenttää ei löytynyt.', 'not_found');
  return found;
}

function quoteFor(venue, season, input) {
  const { courtId = null, locationId = null, weekday, startTime, minutes, fromDate = null } = input;
  checkTime(venue, { weekday, startTime, minutes });
  if (courtId) courtOf(venue, courtId);
  if (locationId && !venue.locations.some((l) => l.id === locationId)) throw fail('Kenttää ei löytynyt.', 'not_found');
  const from = fromDate && fromDate > today() ? fromDate : today();
  return quoteSeason(venue, season, liveRows().filter((r) => r.venueId === venue.id), {
    courtId, locationId, sport: 'tennis', weekday, startTime, minutes, fromDate: from,
  });
}

// ── Players ──────────────────────────────────────────────────────────────────

export async function list(venueId) {
  return run(() => {
    const venue = venueRow(venueId);
    if (!venue) throw fail('Hallia ei löytynyt.', 'not_found');
    return db.booking.seasons
      .filter((s) => s.venueId === venue.id && s.endsOn >= today())
      .sort((a, b) => a.startsOn.localeCompare(b.startsOn))
      .map(toSeason);
  });
}

export async function quote(input = {}) {
  return run(() => {
    const { season, venue } = seasonAndVenue(input.seasonId);
    return quoteFor(venue, season, input);
  });
}

export async function request(input = {}) {
  return run(() => {
    const { season, venue } = seasonAndVenue(input.seasonId);
    if (!season.requestsOpen || season.endsOn < today()) throw fail('Tämän kauden vakiovuorohaku on suljettu.');
    if (!['invoice', 'card'].includes(input.billing)) throw fail('Valitse, miten kausivuoro maksetaan.');
    if (input.billing === 'card' && !db.booking.cards.get(ME)) {
      throw fail('Tallenna ensin kortti, jolta kuukausimaksut veloitetaan.', 'card_required');
    }
    const q = quoteFor(venue, season, input);
    if (q.count === 0) throw fail('Tälle ajalle ei ole kaudella yhtään vapaata viikkoa. Kokeile toista aikaa tai kenttää.', 'conflict');
    const mine = db.booking.seasonSlots.filter((s) => s.holderId === ME && s.status === 'requested');
    if (mine.some((s) => s.seasonId === season.id && s.weekday === input.weekday && s.startTime === input.startTime)) {
      throw fail('Sinulla on jo hakemus tälle ajalle.');
    }
    if (mine.length >= MAX_OPEN_REQUESTS) throw fail('Sinulla on jo kolme avointa hakemusta. Odota hallin vastausta.');
    const court = input.courtId ? findCourt(venue, input.courtId) : null;
    const note = String(input.note || '').trim().slice(0, 500) || null;
    const slot = {
      id: newId('ss'), venueId: venue.id, seasonId: season.id, sport: court?.court.sport || 'tennis',
      courtId: court?.court.id || null, locationId: court?.location.id || input.locationId || null,
      weekday: input.weekday, startTime: input.startTime, minutes: input.minutes,
      startsOn: q.weeks[0]?.date || today(), endsOn: season.endsOn, skipDates: q.skipped,
      status: 'requested', billing: input.billing, priceCents: q.cents, weeks: q.count,
      holderId: ME, holderName: personLite(ME).name, billingEmail: ME_EMAIL, billingAddress: null, note,
      declineReason: null, createdAt: nowIso(), decidedAt: null,
    };
    db.booking.seasonSlots.push(slot);
    return toSlot(slot);
  });
}

export async function listMine() {
  return run(() => {
    const rank = { requested: 0, active: 1 };
    return db.booking.seasonSlots
      .filter((s) => s.holderId === ME && s.status !== 'withdrawn')
      .map(toSlot)
      .sort((a, b) => (rank[a.status] ?? 2) - (rank[b.status] ?? 2)
        || (a.status === 'active' ? String(a.nextAt || '9').localeCompare(String(b.nextAt || '9')) : b.createdAt.localeCompare(a.createdAt)));
  });
}

export async function withdraw(slotId) {
  return run(() => {
    const slot = slotRow(slotId);
    if (!slot || slot.holderId !== ME) throw fail('Hakemusta ei löytynyt.', 'not_found');
    if (slot.status !== 'requested') throw fail('Hakemus on jo käsitelty.');
    slot.status = 'withdrawn';
    slot.decidedAt = nowIso();
  });
}

// ── Hall staff ───────────────────────────────────────────────────────────────

export async function staffList(venueId) {
  return run(() => {
    const venue = venueRow(venueId);
    requireStaff(venue);
    const rank = { requested: 0, active: 1 };
    return db.booking.seasonSlots
      .filter((s) => s.venueId === venue.id && s.status !== 'withdrawn')
      .sort((a, b) => (rank[a.status] ?? 2) - (rank[b.status] ?? 2)
        || (a.status === 'requested' ? a.createdAt.localeCompare(b.createdAt)
          : a.status === 'active' ? a.weekday - b.weekday || a.startTime.localeCompare(b.startTime)
            : String(b.decidedAt).localeCompare(String(a.decidedAt))))
      .map(toSlot);
  });
}

function makeInvoice(venue, slot, q, agreed) {
  const settings = db.booking.billing[venue.id];
  if (!settings?.seller?.iban || !settings.seller.name) {
    throw fail('Hallin laskutustiedot puuttuvat (nimi ja tilinumero). Lisää ne ennen laskutusta.', 'billing_settings');
  }
  const number = String(settings.nextInvoiceNumber);
  settings.nextInvoiceNumber += 1;
  const issuedOn = today();
  const found = findCourt(venue, slot.courtId);
  const invoice = {
    id: newId('inv'), venueId: venue.id, seasonSlotId: slot.id, number, reference: referenceNumber(number),
    issuedOn, dueOn: dateKey(new Date(Date.parse(`${issuedOn}T12:00:00`) + settings.paymentTermsDays * 86_400_000)),
    amountCents: slot.priceCents, vatPercent: settings.vatPercent, vatCents: vatOf(slot.priceCents, settings.vatPercent),
    lines: invoiceLines(slot, {
      weeks: q.weeks.filter((w) => !w.conflict), fullCents: q.fullCents, priceCents: slot.priceCents,
      discountPercent: q.discountPercent, agreed, courtName: found?.court.name, locationName: found?.location.name,
    }),
    recipient: { name: slot.holderName, email: slot.billingEmail, address: slot.billingAddress },
    seller: { ...settings.seller }, status: 'open', paidOn: null, sentAt: null, createdAt: nowIso(),
  };
  db.booking.invoices.push(invoice);
}

function makeCharges(venue, slot, q) {
  for (const c of chargeSchedule(q.months, today())) {
    db.booking.charges.push({
      id: newId('ch'), venueId: venue.id, seasonSlotId: slot.id, ...c, status: 'scheduled', attempts: 0,
      failureMessage: null, paidAt: null, paymentIntentId: null,
    });
  }
}

/**
 * Puts a slot's weeks into the calendar and bills it — what approve and create share. All or
 * nothing: every check runs before anything changes.
 */
function activate(venue, slot, { courtId, priceCents = null, skipConflicts = false }) {
  const season = seasonRow(slot.seasonId);
  const court = courtOf(venue, courtId || slot.courtId, slot.sport);
  if (slot.billing === 'card') {
    if (priceCents != null) throw fail('Kortilta veloitettavan kausivuoron hinta tulee kauden hinnoista.');
    if (!slot.holderId || !db.booking.cards.get(slot.holderId)) throw fail('Pelaajalla ei ole tallennettua korttia kuukausiveloituksiin.', 'card_required');
  }
  if (priceCents != null && !(Number.isInteger(priceCents) && priceCents >= 0)) throw fail('Tarkista hinta.');
  expireStaleHolds();
  const from = slot.startsOn > today() ? slot.startsOn : today();
  const q = quoteSeason(venue, season, liveRows().filter((r) => r.venueId === venue.id), {
    courtId: court.court.id, weekday: slot.weekday, startTime: slot.startTime, minutes: slot.minutes, fromDate: from,
  });
  const conflicts = q.weeks.filter((w) => w.conflict);
  if (conflicts.length && !skipConflicts) {
    const dates = conflicts.slice(0, 6).map((w) => dayMonth(w.date)).join(', ') + (conflicts.length > 6 ? '…' : '');
    throw fail(`Kenttä on varattu ${conflicts.length === 1 ? 'yhtenä viikkona' : `${conflicts.length} viikkona`} (${dates}). Ohita ne viikot tai valitse toinen kenttä.`, 'conflict');
  }
  const weeks = q.weeks.filter((w) => !w.conflict);
  if (!weeks.length) throw fail('Kenttä ei ole vapaana yhtenäkään kauden viikkona.', 'conflict');
  if (slot.billing === 'invoice') {
    const settings = db.booking.billing[venue.id];
    if (!settings?.seller?.iban || !settings.seller.name) {
      throw fail('Hallin laskutustiedot puuttuvat (nimi ja tilinumero). Lisää ne ennen laskutusta.', 'billing_settings');
    }
  }

  Object.assign(slot, {
    courtId: court.court.id, locationId: court.location.id, startsOn: weeks[0].date,
    skipDates: [...new Set([...slot.skipDates.filter((d) => d < from), ...q.skipped, ...conflicts.map((w) => w.date)])].sort(),
    priceCents: priceCents ?? q.cents, weeks: weeks.length, status: 'active', decidedAt: nowIso(),
  });
  for (const w of weeks) {
    db.booking.rows.push({
      id: newId('bk'), venueId: venue.id, courtId: court.court.id, startsAt: w.startsAt, endsAt: w.endsAt, kind: 'season',
      status: 'confirmed', bookedBy: slot.holderId, title: 'Kausivuoro',
      priceCents: Math.round((w.cents * (100 - q.discountPercent)) / 100), paymentStatus: 'none', holdExpiresAt: null,
      createdAt: nowIso(), cancelledAt: null, seasonSlotId: slot.id,
    });
  }
  if (slot.billing === 'invoice') makeInvoice(venue, slot, q, priceCents != null && priceCents !== q.cents);
  else makeCharges(venue, slot, q);
}

export async function create(input = {}) {
  return run(() => {
    const venue = venueRow(input.venueId);
    requireStaff(venue);
    const season = seasonRow(input.seasonId);
    if (!season || season.venueId !== venue.id) throw fail('Kautta ei löytynyt.', 'not_found');
    if (season.endsOn < today()) throw fail('Kausi on jo päättynyt.');
    checkTime(venue, input);
    const holderName = String(input.holderName || '').trim().slice(0, 80);
    if (!holderName) throw fail('Kirjoita vuoron haltija, esim. seuran tai pelaajan nimi.');
    const email = String(input.billingEmail || '').trim() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail('Tarkista laskutuksen sähköpostiosoite.');
    const { court, location } = courtOf(venue, input.courtId);
    const from = input.fromDate && input.fromDate > today() ? input.fromDate : today();
    const slot = {
      id: newId('ss'), venueId: venue.id, seasonId: season.id, sport: court.sport, courtId: court.id, locationId: location.id,
      weekday: input.weekday, startTime: input.startTime, minutes: input.minutes, startsOn: from, endsOn: season.endsOn,
      skipDates: [], status: 'requested', billing: 'invoice', priceCents: 0, weeks: 0, holderId: null, holderName,
      billingEmail: email, billingAddress: String(input.billingAddress || '').trim().slice(0, 300) || null, note: null,
      declineReason: null, createdAt: nowIso(), decidedAt: null,
    };
    activate(venue, slot, { courtId: court.id, priceCents: input.priceCents ?? null, skipConflicts: Boolean(input.skipConflicts) });
    db.booking.seasonSlots.push(slot);
    return toSlot(slot);
  });
}

export async function approve(slotId, { courtId = null, priceCents = null, skipConflicts = false } = {}) {
  return run(() => {
    const slot = slotRow(slotId);
    if (!slot) throw fail('Hakemusta ei löytynyt.', 'not_found');
    const venue = venueRow(slot.venueId);
    requireStaff(venue);
    if (slot.status !== 'requested') throw fail('Hakemus on jo käsitelty.');
    activate(venue, slot, { courtId, priceCents, skipConflicts });
    return toSlot(slot);
  });
}

export async function decline(slotId, reason = '') {
  return run(() => {
    const slot = slotRow(slotId);
    if (!slot) throw fail('Hakemusta ei löytynyt.', 'not_found');
    requireStaff(venueRow(slot.venueId));
    if (slot.status !== 'requested') throw fail('Hakemus on jo käsitelty.');
    slot.status = 'declined';
    slot.declineReason = String(reason || '').trim().slice(0, 300) || null;
    slot.decidedAt = nowIso();
  });
}

export async function end(slotId) {
  return run(() => {
    const slot = slotRow(slotId);
    if (!slot) throw fail('Kausivuoroa ei löytynyt.', 'not_found');
    requireStaff(venueRow(slot.venueId));
    if (slot.status !== 'active') throw fail('Kausivuoro ei ole voimassa.');
    const now = Date.now();
    let released = 0;
    for (const row of slotRows(slot)) {
      if (Date.parse(row.startsAt) <= now) continue;
      row.status = 'cancelled';
      row.cancelledAt = nowIso();
      released += 1;
    }
    for (const c of db.booking.charges) {
      if (c.seasonSlotId === slot.id && (c.status === 'scheduled' || c.status === 'failed') && c.dueOn > today()) c.status = 'void';
    }
    slot.status = 'ended';
    slot.decidedAt = nowIso();
    return { released };
  });
}

export async function releaseOccurrence(reservationId) {
  return run(() => {
    const row = db.booking.rows.find((r) => r.id === reservationId && r.kind === 'season');
    if (!row) throw fail('Kausivuoron viikkoa ei löytynyt.', 'not_found');
    requireStaff(venueRow(row.venueId));
    if (!isLive(row)) return;
    if (Date.parse(row.startsAt) <= Date.now()) throw fail('Alkanutta vuoroa ei voi enää vapauttaa.');
    row.status = 'cancelled';
    row.cancelledAt = nowIso();
  });
}
