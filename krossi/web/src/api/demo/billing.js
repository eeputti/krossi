// billing.js (demo) — laskutus for kausivuorot: the hall's invoices (mark paid, "send"), the card
// kept on file, the month-by-month card charges and the hall's invoicing details (Hallin
// asetukset). No money moves: the demo card 'demo-0341' fails every charge on purpose, so the
// failure path (a failed month, "Maksa nyt") can be tried.

import { ME } from './rows.js';
import { run } from './runtime.js';
import { db, nowIso } from './store.js';
import { dateKey } from '../../features/booking.js';
import { chargeIsDue, checkBillingSettings } from '../../features/seasons.js';
import { billingRow, fail, requireStaff, venueRow } from './bookingCore.js';
import { slotRow, toCharge, toInvoice } from './seasonCore.js';

const MAX_ATTEMPTS = 4;
const DECLINED = 'Pankki hylkäsi veloituksen. Kortti pitää päivittää tai kuukausi maksaa sovelluksessa.';
const NO_CARD = 'Pelaajalla ei ole tallennettua korttia.';
const today = () => dateKey(new Date());

const DEMO_CARDS = {
  'demo-4242': { brand: 'visa', last4: '4242', fails: false },
  'demo-0341': { brand: 'visa', last4: '0341', fails: true },
};

const toCard = (card) => (card ? { brand: card.brand, last4: card.last4, expMonth: card.expMonth, expYear: card.expYear } : null);

function invoiceRow(id) {
  return db.booking.invoices.find((i) => i.id === id) || null;
}

function staffInvoice(id) {
  const invoice = invoiceRow(id);
  if (!invoice) throw fail('Laskua ei löytynyt.', 'not_found');
  requireStaff(venueRow(invoice.venueId));
  return invoice;
}

// ── Invoices ─────────────────────────────────────────────────────────────────

export async function listInvoices(venueId) {
  return run(() => {
    const venue = venueRow(venueId);
    requireStaff(venue);
    return db.booking.invoices
      .filter((i) => i.venueId === venue.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.number.localeCompare(a.number))
      .map(toInvoice);
  });
}

export async function getInvoice(invoiceId) {
  return run(() => {
    const invoice = invoiceRow(invoiceId);
    if (!invoice) return null;
    const venue = venueRow(invoice.venueId);
    const slot = slotRow(invoice.seasonSlotId);
    if (!venue.staffIds.includes(ME) && slot?.holderId !== ME) return null;
    return toInvoice(invoice);
  });
}

export async function markInvoicePaid(invoiceId, paidOn = null) {
  return run(() => {
    const invoice = staffInvoice(invoiceId);
    if (invoice.status === 'void') throw fail('Mitätöityä laskua ei voi merkitä maksetuksi.');
    const day = paidOn || today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today()) throw fail('Tarkista maksupäivä.');
    if (invoice.status === 'open') {
      invoice.status = 'paid';
      invoice.paidOn = day;
    }
    return toInvoice(invoice);
  });
}

export async function sendInvoice(invoiceId) {
  return run(() => {
    const invoice = staffInvoice(invoiceId);
    if (invoice.status === 'void') throw fail('Mitätöityä laskua ei lähetetä.');
    if (!invoice.recipient.email) throw fail('Laskulla ei ole sähköpostiosoitetta. Tulosta lasku tai lisää osoite.');
    invoice.sentAt = nowIso();
    return { sentTo: invoice.recipient.email };
  });
}

// ── The card on file ─────────────────────────────────────────────────────────

export async function cardStatus() {
  return run(() => toCard(db.booking.cards.get(ME)));
}

export async function cardSetup() {
  return run(() => ({ demo: true }));
}

export async function cardSaved(setupIntentId = 'demo-4242') {
  return run(() => {
    const demo = DEMO_CARDS[setupIntentId] || DEMO_CARDS['demo-4242'];
    const card = { brand: demo.brand, last4: demo.last4, expMonth: 12, expYear: new Date().getFullYear() + 3, fails: demo.fails };
    db.booking.cards.set(ME, card);
    return toCard(card);
  });
}

export async function removeCard() {
  return run(() => {
    const active = db.booking.seasonSlots.some((s) => s.holderId === ME && s.billing === 'card' && s.status === 'active');
    if (active) {
      throw fail('Kausivuorosi kuukausimaksut veloitetaan tältä kortilta. Tallenna uusi kortti tilalle tai pyydä hallilta laskua.');
    }
    db.booking.cards.delete(ME);
  });
}

// ── Monthly card charges ─────────────────────────────────────────────────────

export async function listCharges(venueId) {
  return run(() => {
    const venue = venueRow(venueId);
    requireStaff(venue);
    const rank = (c) => (c.status === 'failed' ? 0 : chargeIsDue(c) ? 1 : 2);
    return db.booking.charges
      .filter((c) => c.venueId === venue.id)
      .sort((a, b) => rank(a) - rank(b) || a.dueOn.localeCompare(b.dueOn) || a.id.localeCompare(b.id))
      .map(toCharge);
  });
}

/** Charges every due month of the venue's active card-billed slots (what the daily cron does). */
export async function runCharges(venueId) {
  return run(() => {
    const venue = venueRow(venueId);
    requireStaff(venue);
    let paid = 0;
    let failed = 0;
    for (const charge of db.booking.charges) {
      if (charge.venueId !== venue.id || !chargeIsDue(charge, today())) continue;
      if (charge.status === 'failed' && charge.attempts >= MAX_ATTEMPTS) continue;
      const slot = slotRow(charge.seasonSlotId);
      if (!slot || slot.status !== 'active' || slot.billing !== 'card') continue;
      const card = slot.holderId ? db.booking.cards.get(slot.holderId) : null;
      charge.attempts += 1;
      if (!card || card.fails) {
        charge.status = 'failed';
        charge.failureMessage = card ? DECLINED : NO_CARD;
        failed += 1;
      } else {
        charge.status = 'paid';
        charge.paidAt = nowIso();
        charge.failureMessage = null;
        paid += 1;
      }
    }
    return { paid, failed };
  });
}

function myCharge(chargeId) {
  const charge = db.booking.charges.find((c) => c.id === chargeId);
  const slot = charge ? slotRow(charge.seasonSlotId) : null;
  if (!charge || slot?.holderId !== ME) throw fail('Veloitusta ei löytynyt.', 'not_found');
  return charge;
}

export async function payCharge(chargeId) {
  return run(() => {
    const charge = myCharge(chargeId);
    if (charge.status === 'paid') return { paid: true };
    if (charge.status === 'void') throw fail('Tätä kuukautta ei enää veloiteta.');
    if (!chargeIsDue(charge, today())) throw fail('Tämä kuukausi veloitetaan vasta eräpäivänä.');
    return { demo: true, amount: charge.amountCents, currency: 'eur' };
  });
}

/** The demo has no card form: verifying (with no payment intent) pays the month. */
export async function verifyCharge(chargeId) {
  return run(() => {
    const charge = myCharge(chargeId);
    if (charge.status === 'scheduled' || charge.status === 'failed') {
      charge.status = 'paid';
      charge.paidAt = nowIso();
      charge.failureMessage = null;
    }
    return { paid: charge.status === 'paid', status: charge.status === 'paid' ? 'succeeded' : 'canceled' };
  });
}

// ── Hallin asetukset: laskutustiedot ─────────────────────────────────────────

/** The biggest invoice number the venue has used (0 = none yet). */
function lastInvoiceNumber(venueId) {
  return db.booking.invoices
    .filter((i) => i.venueId === venueId && /^\d{1,9}$/.test(i.number))
    .reduce((max, i) => Math.max(max, Number(i.number)), 0);
}

function toSettings(venue) {
  const row = db.booking.billing[venue.id] || null;
  const seller = row?.seller || {};
  return {
    venueId: venue.id,
    sellerName: seller.name || '',
    businessId: seller.businessId || null,
    address: seller.address || null,
    iban: seller.iban || null,
    bic: seller.bic || null,
    email: seller.email || null,
    phone: seller.phone || null,
    vatPercent: row?.vatPercent ?? 14,
    paymentTermsDays: row?.paymentTermsDays ?? 14,
    nextInvoiceNumber: row?.nextInvoiceNumber ?? 1001,
    lastInvoiceNumber: lastInvoiceNumber(venue.id),
    ready: Boolean(seller.name && seller.iban),
    updatedAt: row?.updatedAt || null,
  };
}

export async function getSettings(venueId) {
  return run(() => {
    const venue = venueRow(venueId);
    requireStaff(venue);
    return toSettings(venue);
  });
}

export async function saveSettings(venueId, input = {}) {
  return run(() => {
    const venue = venueRow(venueId);
    requireStaff(venue);
    const row = billingRow(venue.id);
    const { value, error } = checkBillingSettings(
      { ...input, nextInvoiceNumber: input.nextInvoiceNumber ?? null },
      { lastInvoiceNumber: lastInvoiceNumber(venue.id) },
    );
    if (error) throw fail(error);
    row.seller = {
      name: value.sellerName, businessId: value.businessId, address: value.address, iban: value.iban, bic: value.bic,
      email: value.email, phone: value.phone,
    };
    Object.assign(row, { vatPercent: value.vatPercent, paymentTermsDays: value.paymentTermsDays, updatedAt: nowIso() });
    if (value.nextInvoiceNumber != null) row.nextInvoiceNumber = value.nextInvoiceNumber;
    return toSettings(venue);
  });
}
