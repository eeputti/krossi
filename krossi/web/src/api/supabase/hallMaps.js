// hallMaps.js — mappers for the phase-2 booking RPCs (kausivuorot, laskutus, sarja- ja
// lahjakortit): the RPCs already answer in the contract's shapes (api/contract.js), these pin the
// types down so a missing field never reaches a screen as undefined. Not a contract module.

import { day, iso, list, mapBooker, number, text } from './bookingCore.js';

export function mapSeason(raw) {
  return {
    id: raw.id,
    venueId: raw.venueId,
    name: text(raw.name, ''),
    startsOn: day(raw.startsOn),
    endsOn: day(raw.endsOn),
    skipDates: list(raw.skipDates).map(day).filter(Boolean),
    discountPercent: number(raw.discountPercent),
    requestsOpen: raw.requestsOpen !== false,
  };
}

function mapConflict(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return { kind: raw.kind, title: text(raw.title) };
}

export function mapQuote(raw) {
  return {
    seasonId: raw.seasonId,
    courtId: text(raw.courtId),
    weekday: number(raw.weekday),
    startTime: text(raw.startTime, ''),
    minutes: number(raw.minutes),
    weeks: list(raw.weeks).map((w) => ({
      date: day(w.date),
      startsAt: iso(w.startsAt),
      endsAt: iso(w.endsAt),
      cents: w.cents === null || w.cents === undefined ? null : number(w.cents),
      conflict: mapConflict(w.conflict),
    })),
    skipped: list(raw.skipped).map(day).filter(Boolean),
    count: number(raw.count),
    fullCents: number(raw.fullCents),
    discountPercent: number(raw.discountPercent),
    cents: number(raw.cents),
    months: list(raw.months).map((m) => ({ month: text(m.month, ''), count: number(m.count), cents: number(m.cents) })),
    courts: list(raw.courts).map((c) => ({ courtId: c.courtId, conflicts: number(c.conflicts) })),
  };
}

export function mapCharge(raw) {
  return {
    id: raw.id,
    seasonSlotId: raw.seasonSlotId,
    month: text(raw.month, ''),
    weeks: number(raw.weeks),
    amountCents: number(raw.amountCents),
    dueOn: day(raw.dueOn),
    status: raw.status,
    attempts: number(raw.attempts),
    failureMessage: text(raw.failureMessage),
    paidAt: iso(raw.paidAt),
    holderName: text(raw.holderName, ''),
  };
}

export function mapSlot(raw) {
  const invoice = raw.invoice && typeof raw.invoice === 'object' ? raw.invoice : null;
  return {
    id: raw.id,
    venueId: raw.venueId,
    seasonId: raw.seasonId,
    seasonName: text(raw.seasonName, ''),
    sport: text(raw.sport, 'tennis'),
    courtId: text(raw.courtId),
    courtName: text(raw.courtName),
    locationId: text(raw.locationId),
    locationName: text(raw.locationName, ''),
    weekday: number(raw.weekday),
    startTime: text(raw.startTime, ''),
    minutes: number(raw.minutes),
    startsOn: day(raw.startsOn),
    endsOn: day(raw.endsOn),
    skipDates: list(raw.skipDates).map(day).filter(Boolean),
    status: raw.status,
    billing: raw.billing === 'card' ? 'card' : 'invoice',
    priceCents: number(raw.priceCents),
    weeks: number(raw.weeks),
    holderName: text(raw.holderName, 'Pelaaja'),
    holder: mapBooker(raw.holder),
    billingEmail: text(raw.billingEmail),
    billingAddress: text(raw.billingAddress),
    note: text(raw.note),
    declineReason: text(raw.declineReason),
    nextAt: iso(raw.nextAt),
    invoice: invoice ? {
      id: invoice.id,
      number: text(invoice.number, ''),
      dueOn: day(invoice.dueOn),
      amountCents: number(invoice.amountCents),
      status: invoice.status,
    } : null,
    charges: list(raw.charges).map(mapCharge),
    createdAt: iso(raw.createdAt),
    decidedAt: iso(raw.decidedAt),
    notifiedAt: iso(raw.notifiedAt),
  };
}

/** StaffSeason: Season + the settings view's counts. */
export function mapStaffSeason(raw) {
  return {
    ...mapSeason(raw),
    activeSlots: number(raw.activeSlots),
    requests: number(raw.requests),
    bookedFrom: day(raw.bookedFrom),
    bookedUntil: day(raw.bookedUntil),
    removable: raw.removable === true,
  };
}

export function mapInvoice(raw) {
  const recipient = raw.recipient || {};
  const seller = raw.seller || {};
  return {
    id: raw.id,
    venueId: raw.venueId,
    seasonSlotId: raw.seasonSlotId,
    number: text(raw.number, ''),
    reference: text(raw.reference, ''),
    issuedOn: day(raw.issuedOn),
    dueOn: day(raw.dueOn),
    amountCents: number(raw.amountCents),
    vatPercent: number(raw.vatPercent),
    vatCents: number(raw.vatCents),
    lines: list(raw.lines).map((l) => ({
      text: text(l.text, ''),
      quantity: number(l.quantity),
      unit: text(l.unit, ''),
      unitCents: l.unitCents === null || l.unitCents === undefined ? null : number(l.unitCents),
      totalCents: number(l.totalCents),
    })),
    recipient: { name: text(recipient.name, ''), email: text(recipient.email), address: text(recipient.address) },
    seller: {
      name: text(seller.name, ''),
      businessId: text(seller.businessId),
      address: text(seller.address),
      iban: text(seller.iban),
      bic: text(seller.bic),
      email: text(seller.email),
      phone: text(seller.phone),
    },
    status: raw.status,
    paidOn: day(raw.paidOn),
    sentAt: iso(raw.sentAt),
    createdAt: iso(raw.createdAt),
  };
}

export function mapCard(raw) {
  if (!raw || !raw.last4) return null;
  return {
    brand: text(raw.brand, 'card'),
    last4: String(raw.last4),
    expMonth: number(raw.expMonth),
    expYear: number(raw.expYear),
  };
}

export function mapProduct(raw) {
  return {
    id: raw.id,
    venueId: raw.venueId,
    name: text(raw.name, ''),
    sport: text(raw.sport, 'tennis'),
    uses: number(raw.uses),
    minutesPerUse: number(raw.minutesPerUse),
    validDays: number(raw.validDays),
    priceCents: number(raw.priceCents),
    description: text(raw.description),
  };
}

/** StaffPassProduct: PassProduct + for sale, sold, removable. */
export function mapStaffProduct(raw) {
  return { ...mapProduct(raw), active: raw.active !== false, sold: number(raw.sold), removable: raw.removable === true };
}

/** GiftSettings (null when the RPC gave none). */
export function mapGift(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    amounts: list(raw.amounts).map((n) => number(n)).filter((n) => n > 0),
    minCents: number(raw.minCents, 1000),
    maxCents: number(raw.maxCents, 30000),
    validDays: number(raw.validDays, 365),
  };
}

/** BillingSettings (laskutustiedot). */
export function mapBillingSettings(raw, venueId) {
  return {
    venueId: raw?.venueId || venueId,
    sellerName: text(raw?.sellerName, ''),
    businessId: text(raw?.businessId),
    address: text(raw?.address),
    iban: text(raw?.iban),
    bic: text(raw?.bic),
    email: text(raw?.email),
    phone: text(raw?.phone),
    vatPercent: number(raw?.vatPercent, 14),
    paymentTermsDays: number(raw?.paymentTermsDays, 14),
    nextInvoiceNumber: number(raw?.nextInvoiceNumber, 1001),
    lastInvoiceNumber: number(raw?.lastInvoiceNumber),
    ready: raw?.ready === true,
    updatedAt: iso(raw?.updatedAt),
  };
}

export function mapEvent(raw) {
  return {
    id: raw.id,
    kind: raw.kind,
    minutes: number(raw.minutes),
    cents: number(raw.cents),
    label: text(raw.label, ''),
    bookingId: text(raw.bookingId),
    createdAt: iso(raw.createdAt),
  };
}

export function mapPass(raw) {
  return {
    id: raw.id,
    venueId: raw.venueId,
    productId: raw.productId,
    name: text(raw.name, ''),
    sport: text(raw.sport, 'tennis'),
    minutesTotal: number(raw.minutesTotal),
    minutesLeft: number(raw.minutesLeft),
    validUntil: day(raw.validUntil),
    status: raw.status,
    priceCents: number(raw.priceCents),
    purchasedAt: iso(raw.purchasedAt),
    history: list(raw.history).map(mapEvent),
  };
}

export function mapGiftCard(raw) {
  return {
    id: raw.id,
    venueId: raw.venueId,
    code: text(raw.code),
    amountCents: number(raw.amountCents),
    recipientName: text(raw.recipientName),
    message: text(raw.message),
    status: raw.status,
    validUntil: day(raw.validUntil),
    redeemedAt: iso(raw.redeemedAt),
    createdAt: iso(raw.createdAt),
  };
}

export function mapWallet(raw, venueId) {
  return {
    venueId: raw?.venueId || venueId,
    passes: list(raw?.passes).map(mapPass),
    giftCents: number(raw?.giftCents),
    giftHistory: list(raw?.giftHistory).map(mapEvent),
    giftCards: list(raw?.giftCards).map(mapGiftCard),
    refundableCents: number(raw?.refundableCents),
    refundFeeCents: number(raw?.refundFeeCents),
    refundFreeUntil: iso(raw?.refundFreeUntil),
  };
}

/** TopUp (saldon lataus). */
export function mapTopUp(raw) {
  return {
    id: raw.id,
    venueId: raw.venueId,
    amountCents: number(raw.amountCents),
    status: raw.status === 'paid' ? 'paid' : 'pending',
    paidAt: iso(raw.paidAt),
    createdAt: iso(raw.createdAt),
  };
}

/** TopUpRules (null before the saldo migration). */
export function mapTopUpRules(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const amounts = list(raw.amounts).map((n) => number(n)).filter((n) => n > 0);
  if (!amounts.length) return null;
  return {
    amounts,
    refundFreeDays: number(raw.refundFreeDays, 14),
    refundDays: number(raw.refundDays, 180),
    refundFeeCents: number(raw.refundFeeCents, 100),
  };
}
