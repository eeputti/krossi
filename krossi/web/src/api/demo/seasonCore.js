// seasonCore.js (demo) — the SeasonSlot / CardCharge / Invoice shapes of the demo's kausivuorot,
// shared by seasons.js and billing.js (not a contract module).

import { db, personLite } from './store.js';
import { findCourt } from '../../features/booking.js';
import { isLive, venueRow } from './bookingCore.js';

export function seasonRow(id) {
  return db.booking.seasons.find((s) => s.id === id) || null;
}

export const toSeason = (s) => ({
  id: s.id, venueId: s.venueId, name: s.name, startsOn: s.startsOn, endsOn: s.endsOn, skipDates: [...s.skipDates],
  discountPercent: s.discountPercent, requestsOpen: s.requestsOpen,
});

export function slotRow(id) {
  return db.booking.seasonSlots.find((s) => s.id === id) || null;
}

/** Weeks of a slot in the calendar (live rows). */
export const slotRows = (slot) => db.booking.rows.filter((r) => r.kind === 'season' && r.seasonSlotId === slot.id && isLive(r));

export function toCharge(c) {
  const slot = slotRow(c.seasonSlotId);
  return {
    id: c.id, seasonSlotId: c.seasonSlotId, month: c.month, weeks: c.weeks, amountCents: c.amountCents, dueOn: c.dueOn,
    status: c.status, attempts: c.attempts, failureMessage: c.failureMessage, paidAt: c.paidAt, holderName: slot?.holderName || '',
  };
}

export function toSlot(slot) {
  const venue = venueRow(slot.venueId);
  const season = seasonRow(slot.seasonId);
  const found = slot.courtId ? findCourt(venue, slot.courtId) : null;
  const location = found?.location || venue.locations.find((l) => l.id === slot.locationId) || null;
  const now = Date.now();
  const next = slot.status === 'active'
    ? slotRows(slot).filter((r) => Date.parse(r.startsAt) > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]
    : null;
  const invoice = slot.billing === 'invoice'
    ? db.booking.invoices.filter((i) => i.seasonSlotId === slot.id && i.status !== 'void').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    : null;
  return {
    id: slot.id,
    venueId: slot.venueId,
    seasonId: slot.seasonId,
    seasonName: season?.name || '',
    sport: slot.sport,
    courtId: slot.courtId,
    courtName: found?.court.name || null,
    locationId: location?.id || null,
    locationName: location?.name || '',
    weekday: slot.weekday,
    startTime: slot.startTime,
    minutes: slot.minutes,
    startsOn: slot.startsOn,
    endsOn: slot.endsOn,
    skipDates: [...slot.skipDates],
    status: slot.status,
    billing: slot.billing,
    priceCents: slot.priceCents,
    weeks: slot.weeks,
    holderName: slot.holderName,
    holder: slot.holderId ? personLite(slot.holderId) : null,
    billingEmail: slot.billingEmail,
    billingAddress: slot.billingAddress,
    note: slot.note,
    declineReason: slot.declineReason,
    nextAt: next?.startsAt || null,
    invoice: invoice ? { id: invoice.id, number: invoice.number, dueOn: invoice.dueOn, amountCents: invoice.amountCents, status: invoice.status } : null,
    charges: slot.billing === 'card'
      ? db.booking.charges.filter((c) => c.seasonSlotId === slot.id).sort((a, b) => a.month.localeCompare(b.month)).map(toCharge)
      : [],
    createdAt: slot.createdAt,
    decidedAt: slot.decidedAt,
  };
}

/** Invoice (contract shape) of a stored invoice. */
export function toInvoice(i) {
  return {
    id: i.id, venueId: i.venueId, seasonSlotId: i.seasonSlotId, number: i.number, reference: i.reference,
    issuedOn: i.issuedOn, dueOn: i.dueOn, amountCents: i.amountCents, vatPercent: i.vatPercent, vatCents: i.vatCents,
    lines: i.lines.map((l) => ({ ...l })), recipient: { ...i.recipient }, seller: { ...i.seller }, status: i.status,
    paidOn: i.paidOn, sentAt: i.sentAt, createdAt: i.createdAt,
  };
}
