// seasons.js — kausivuorot: the venue's seasons, quotes over a whole season, a player's requests
// and the hall staff's approvals. Every read and write is a SECURITY DEFINER RPC
// (supabase/migrations/20261016100000_krossi_booking_seasons_billing_wallet.sql); approving puts the
// slot's weeks into the calendar as reservation rows and makes its invoice or monthly card charges
// in the same transaction. The RPCs answer in the contract's shapes; the mappers pin types down.

import { db, isMissingFunction, isUuid, requireUid } from './client.js';
import { announceFreed, call, day, fail, list as asList, number, rpcError } from './bookingCore.js';
import { mapQuote, mapSeason, mapSlot } from './hallMaps.js';

const LOAD_FAIL = 'Kausivuoroja ei voitu ladata.';
const SAVE_FAIL = 'Kausivuoron tallennus epäonnistui. Yritä hetken päästä uudelleen.';
const TIME_RE = /^\d{2}:\d{2}$/;

// ── Input checks (the RPCs check again) ──────────────────────────────────────

const uuidOrNull = (value, message) => {
  if (value === null || value === undefined || value === '') return null;
  if (!isUuid(value)) throw fail(message);
  return value;
};

function timeArgs({ weekday, startTime, minutes }) {
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw fail('Valitse viikonpäivä.', 'invalid');
  if (!TIME_RE.test(String(startTime || ''))) throw fail('Valitse aloitusaika.', 'invalid');
  if (!Number.isInteger(minutes)) throw fail('Valitse vuoron kesto.', 'invalid');
  return { weekday_input: weekday, start_time_input: startTime, minutes_input: minutes };
}

const dateOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (!day(value)) throw fail('Tarkista päivämäärä.', 'invalid');
  return value;
};

// ── Players ──────────────────────────────────────────────────────────────────

/** The venue's seasons not over yet; [] while the phase-2 migration is not deployed. Works without a session. */
export async function list(venueId) {
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  const { data, error } = await db().rpc('krossi_seasons', { venue_id_input: venueId });
  if (error) {
    if (isMissingFunction(error)) return [];
    throw rpcError(error, LOAD_FAIL);
  }
  return asList(data).map(mapSeason);
}

export async function quote({ seasonId, courtId = null, locationId = null, weekday, startTime, minutes, fromDate = null } = {}) {
  await requireUid();
  if (!isUuid(seasonId)) throw fail('Kautta ei löytynyt.');
  const data = await call('krossi_season_quote', {
    season_id_input: seasonId,
    court_id_input: uuidOrNull(courtId, 'Kenttää ei löytynyt.'),
    location_id_input: uuidOrNull(locationId, 'Kenttää ei löytynyt.'),
    ...timeArgs({ weekday, startTime, minutes }),
    from_date_input: dateOrNull(fromDate),
  }, 'Hintaa ei voitu laskea. Yritä hetken päästä uudelleen.');
  return mapQuote(data);
}

export async function request({ seasonId, courtId = null, locationId = null, weekday, startTime, minutes, billing, note = null } = {}) {
  await requireUid();
  if (!isUuid(seasonId)) throw fail('Kautta ei löytynyt.');
  const data = await call('krossi_season_request', {
    season_id_input: seasonId,
    court_id_input: uuidOrNull(courtId, 'Kenttää ei löytynyt.'),
    location_id_input: uuidOrNull(locationId, 'Kenttää ei löytynyt.'),
    ...timeArgs({ weekday, startTime, minutes }),
    billing_input: billing === 'card' || billing === 'invoice' ? billing : null,
    note_input: typeof note === 'string' ? note : null,
  }, 'Hakemuksen lähetys epäonnistui. Yritä hetken päästä uudelleen.');
  return mapSlot(data);
}

/** [] while the phase-2 migration is not deployed. */
export async function listMine() {
  await requireUid();
  const { data, error } = await db().rpc('krossi_my_season_slots', {});
  if (error) {
    if (isMissingFunction(error)) return [];
    throw rpcError(error, LOAD_FAIL);
  }
  return asList(data).map(mapSlot);
}

export async function withdraw(slotId) {
  await requireUid();
  if (!isUuid(slotId)) throw fail('Hakemusta ei löytynyt.');
  await call('krossi_season_withdraw', { slot_id_input: slotId }, 'Hakemuksen peruminen epäonnistui.');
}

// ── Hall staff ───────────────────────────────────────────────────────────────

export async function staffList(venueId) {
  await requireUid();
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  return asList(await call('krossi_season_staff_list', { venue_id_input: venueId }, LOAD_FAIL)).map(mapSlot);
}

export async function create({
  venueId, seasonId, courtId, weekday, startTime, minutes, holderName, billingEmail = null, billingAddress = null,
  priceCents = null, skipConflicts = false, fromDate = null,
} = {}) {
  await requireUid();
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  if (!isUuid(seasonId)) throw fail('Kautta ei löytynyt.');
  if (!isUuid(courtId)) throw fail('Valitse kenttä.', 'invalid');
  const data = await call('krossi_season_create', {
    venue_id_input: venueId,
    season_id_input: seasonId,
    court_id_input: courtId,
    ...timeArgs({ weekday, startTime, minutes }),
    holder_name_input: typeof holderName === 'string' ? holderName : '',
    billing_email_input: typeof billingEmail === 'string' ? billingEmail : null,
    billing_address_input: typeof billingAddress === 'string' ? billingAddress : null,
    price_cents_input: Number.isInteger(priceCents) ? priceCents : null,
    skip_conflicts_input: skipConflicts === true,
    from_date_input: dateOrNull(fromDate),
  }, SAVE_FAIL);
  return mapSlot(data);
}

export async function approve(slotId, { courtId = null, priceCents = null, skipConflicts = false } = {}) {
  await requireUid();
  if (!isUuid(slotId)) throw fail('Hakemusta ei löytynyt.');
  const data = await call('krossi_season_approve', {
    slot_id_input: slotId,
    court_id_input: uuidOrNull(courtId, 'Kenttää ei löytynyt.'),
    price_cents_input: Number.isInteger(priceCents) ? priceCents : null,
    skip_conflicts_input: skipConflicts === true,
  }, SAVE_FAIL);
  return mapSlot(data);
}

export async function decline(slotId, reason = '') {
  await requireUid();
  if (!isUuid(slotId)) throw fail('Hakemusta ei löytynyt.');
  await call('krossi_season_decline', { slot_id_input: slotId, reason_input: typeof reason === 'string' ? reason : '' }, SAVE_FAIL);
}

export async function end(slotId) {
  await requireUid();
  if (!isUuid(slotId)) throw fail('Kausivuoroa ei löytynyt.');
  const data = await call('krossi_season_end', { slot_id_input: slotId }, SAVE_FAIL);
  return { released: number(data?.released) };
}

/** Frees one week; the people waiting for that time hear about it (krossi-booking 'freed'). */
export async function releaseOccurrence(reservationId) {
  await requireUid();
  if (!isUuid(reservationId)) throw fail('Kausivuoron viikkoa ei löytynyt.');
  await call('krossi_season_release_week', { reservation_id_input: reservationId }, SAVE_FAIL);
  announceFreed(reservationId);
}
