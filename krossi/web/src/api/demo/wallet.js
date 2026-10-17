// wallet.js (demo) — sarjakortit and lahjakortit: the hall's series cards for sale, buying them and
// gift cards ("paid" at once, like the demo's bookings), redeeming a gift card's code onto the
// balance, paying a held booking with a series card or gift balance, and the hall's own products
// and gift card limits (Hallin asetukset). Same rules and messages as the krossi_wallet_* RPCs; the
// ledger helpers are in bookingCore.js.

import { ME } from './rows.js';
import { newId, run } from './runtime.js';
import { db, nowIso, personLite } from './store.js';
import { SALDO_RULES, addDays, dateKey, findCourt, saldoRefundPlan, sportsOf } from '../../features/booking.js';
import {
  checkGiftSettings, checkPassProduct, giftShare, newGiftCode, normalizeGiftCode, passState,
} from '../../features/seasons.js';
import {
  DEFAULT_GIFT, addCreditEvent, billingRow, fail, giftAvailable, isLive, myRow, requireStaff, rowLabel, takeOverSales, toBooking,
  venueRow,
} from './bookingCore.js';

const EXPIRED = 'Varauksen pitoaika ehti umpeutua. Valitse aika uudelleen.';
const today = () => dateKey(new Date());
const byNewest = (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

const toProduct = (p) => ({
  id: p.id, venueId: p.venueId, name: p.name, sport: p.sport, uses: p.uses, minutesPerUse: p.minutesPerUse,
  validDays: p.validDays, priceCents: p.priceCents, description: p.description,
});

/** StaffPassProduct: + for sale, paid cards sold, never ordered. */
function toStaffProduct(p) {
  const orders = db.booking.passes.filter((x) => x.productId === p.id);
  return { ...toProduct(p), active: p.active, sold: orders.filter((x) => x.status === 'active').length, removable: orders.length === 0 };
}

/** GiftSettings of a venue (the defaults until the hall saves its own). */
function giftOf(venueId) {
  const gift = db.booking.billing[venueId]?.gift || DEFAULT_GIFT;
  return { amounts: [...gift.amounts], minCents: gift.minCents, maxCents: gift.maxCents, validDays: gift.validDays };
}

const toEvent = (e) => ({
  id: e.id, kind: e.kind, minutes: e.minutes, cents: e.cents, label: e.label, bookingId: e.bookingId, createdAt: e.createdAt,
});

function toPass(p, { history = true } = {}) {
  return {
    id: p.id, venueId: p.venueId, productId: p.productId, name: p.name, sport: p.sport, minutesTotal: p.minutesTotal,
    minutesLeft: p.minutesLeft, validUntil: p.validUntil, status: passState(p, today()), priceCents: p.priceCents,
    purchasedAt: p.purchasedAt,
    history: history ? db.booking.creditEvents.filter((e) => e.passId === p.id).sort(byNewest).map(toEvent) : [],
  };
}

function toGiftCard(g) {
  let status = g.status;
  if (status === 'active' && g.validUntil < today()) status = 'expired';
  return {
    id: g.id, venueId: g.venueId, code: g.status === 'pending' ? null : g.code, amountCents: g.amountCents,
    recipientName: g.recipientName, message: g.message, status, validUntil: g.validUntil, redeemedAt: g.redeemedAt,
    createdAt: g.createdAt,
  };
}

/** My unpaid pass / gift card (an order), else 'Tilausta ei löytynyt.' */
const topupsOf = () => (db.booking.topups ||= []);
const toTopUp = (t) => ({ id: t.id, venueId: t.venueId, amountCents: t.amountCents, status: t.status, paidAt: t.paidAt, createdAt: t.createdAt });
const myTopups = (venueId) => topupsOf().filter((t) => t.userId === ME && t.venueId === venueId && t.status === 'paid');

function myOrder({ kind, id } = {}) {
  const list = kind === 'pass' ? db.booking.passes : kind === 'gift' ? db.booking.giftCards : kind === 'topup' ? topupsOf() : null;
  const order = list?.find((o) => o.id === id);
  const owner = kind === 'gift' ? order?.buyerId : order?.userId;
  if (!order || owner !== ME) throw fail('Tilausta ei löytynyt.', 'not_found');
  return order;
}

/** A paid order: the pass gets its minutes and validity, the gift card its code. */
function settle(kind, order) {
  if (order.status !== 'pending') return;
  if (kind === 'pass') {
    const product = db.booking.passProducts.find((p) => p.id === order.productId);
    Object.assign(order, {
      status: 'active', purchasedAt: nowIso(), minutesLeft: order.minutesTotal,
      validUntil: addDays(today(), product?.validDays ?? 365),
    });
    addCreditEvent({ venueId: order.venueId, kind: 'purchase', passId: order.id, minutes: order.minutesTotal, label: `Ostettu: ${order.name}` });
  } else if (kind === 'topup') {
    Object.assign(order, { status: 'paid', paidAt: nowIso() });
    addCreditEvent({ venueId: order.venueId, kind: 'topup', cents: order.amountCents, label: 'Saldon lataus' });
  } else {
    let code = newGiftCode();
    while (db.booking.giftCards.some((g) => g.code === code)) code = newGiftCode();
    Object.assign(order, { status: 'active', code, paidAt: nowIso(), validUntil: addDays(today(), giftOf(order.venueId).validDays) });
  }
}

const amountOf = (kind, order) => (kind === 'pass' ? order.priceCents : order.amountCents);

// ── Shop ─────────────────────────────────────────────────────────────────────

export async function products(venueId) {
  return run(() => {
    const venue = venueRow(venueId);
    if (!venue) throw fail('Hallia ei löytynyt.', 'not_found');
    return {
      passes: db.booking.passProducts.filter((p) => p.venueId === venue.id && p.active).map(toProduct),
      gift: giftOf(venue.id),
      topup: venue.saldo ? { ...SALDO_RULES, amounts: [...SALDO_RULES.amounts] } : null,
    };
  });
}

export async function get(venueId) {
  return run(() => {
    const venue = venueRow(venueId);
    if (!venue) throw fail('Hallia ei löytynyt.', 'not_found');
    const rank = (p) => (p.status === 'active' ? 0 : 1);
    const passes = db.booking.passes
      .filter((p) => p.userId === ME && p.venueId === venue.id && p.status !== 'pending')
      .map((p) => toPass(p))
      .sort((a, b) => rank(a) - rank(b)
        || (a.status === 'active' ? a.validUntil.localeCompare(b.validUntil) : String(b.purchasedAt).localeCompare(String(a.purchasedAt))));
    return {
      venueId: venue.id,
      passes,
      giftCents: giftAvailable(ME, venue.id),
      giftHistory: db.booking.creditEvents.filter((e) => e.userId === ME && e.venueId === venue.id && !e.passId).sort(byNewest).map(toEvent),
      giftCards: db.booking.giftCards.filter((g) => g.buyerId === ME && g.venueId === venue.id && g.status !== 'pending')
        .sort(byNewest).map(toGiftCard),
      ...refundOf(venue.id),
    };
  });
}

export async function buyPass(productId) {
  return run(() => {
    const product = db.booking.passProducts.find((p) => p.id === productId && p.active);
    if (!product) throw fail('Sarjakorttia ei löytynyt.', 'not_found');
    const open = db.booking.passes.find((p) => p.userId === ME && p.productId === product.id && p.status === 'pending');
    if (open) return toPass(open, { history: false });
    const pass = {
      id: newId('pass'), venueId: product.venueId, productId: product.id, userId: ME, name: product.name, sport: product.sport,
      minutesTotal: product.uses * product.minutesPerUse, minutesLeft: product.uses * product.minutesPerUse, validUntil: null,
      status: 'pending', priceCents: product.priceCents, purchasedAt: null, createdAt: nowIso(), paymentIntentId: null,
    };
    db.booking.passes.push(pass);
    return toPass(pass, { history: false });
  });
}

export async function buyGiftCard({ venueId, amountCents, recipientName = null, message = null } = {}) {
  return run(() => {
    const venue = venueRow(venueId);
    if (!venue) throw fail('Hallia ei löytynyt.', 'not_found');
    const gift = giftOf(venue.id);
    if (!Number.isInteger(amountCents) || amountCents % 100 || amountCents < gift.minCents || amountCents > gift.maxCents) {
      throw fail(`Valitse summa ${gift.minCents / 100}–${gift.maxCents / 100} € täysinä euroina.`);
    }
    const card = {
      id: newId('gc'), venueId: venue.id, code: null, amountCents, buyerId: ME,
      recipientName: String(recipientName || '').trim().slice(0, 60) || null, message: String(message || '').trim().slice(0, 300) || null,
      status: 'pending', validUntil: null, paidAt: null, redeemedBy: null, redeemedAt: null, createdAt: nowIso(), paymentIntentId: null,
    };
    db.booking.giftCards.push(card);
    return toGiftCard(card);
  });
}

/** Wallet's refundable* fields (saldoRefundPlan, as krossi_wallet). */
function refundOf(venueId) {
  const plan = saldoRefundPlan(giftAvailable(ME, venueId), myTopups(venueId));
  return { refundableCents: plan.cents > 0 ? plan.cents : 0, refundFeeCents: plan.cents > 0 ? plan.feeCents : 0, refundFreeUntil: plan.cents > 0 ? plan.freeUntil : null };
}

export async function topUp({ venueId, amountCents } = {}) {
  return run(() => {
    const venue = venueRow(venueId);
    if (!venue) throw fail('Hallia ei löytynyt.', 'not_found');
    if (!SALDO_RULES.amounts.includes(amountCents)) throw fail('Valitse ladattava summa: 25, 50 tai 100 €.');
    const open = topupsOf().find((t) => t.userId === ME && t.venueId === venue.id && t.amountCents === amountCents && t.status === 'pending');
    if (open) return toTopUp(open);
    const topup = { id: newId('top'), venueId: venue.id, userId: ME, amountCents, status: 'pending', paidAt: null, refundedCents: 0, createdAt: nowIso() };
    topupsOf().push(topup);
    return toTopUp(topup);
  });
}

export async function refundToCard(venueId) {
  return run(() => {
    const venue = venueRow(venueId);
    if (!venue) throw fail('Hallia ei löytynyt.', 'not_found');
    const plan = saldoRefundPlan(giftAvailable(ME, venue.id), myTopups(venue.id));
    if (plan.cents <= 0) throw fail('Kortille palautettavaa saldoa ei ole.');
    addCreditEvent({
      venueId: venue.id, kind: 'card_refund', cents: -plan.totalCents,
      label: `Palautus kortille${plan.feeCents ? ` (palautuskulu ${plan.feeCents / 100} €)` : ''}`,
    });
    for (const r of plan.rows) {
      const t = topupsOf().find((x) => x.id === r.topupId);
      if (t) t.refundedCents = (t.refundedCents || 0) + r.cents + r.feeCents;
    }
    return { refundedCents: plan.cents, feeCents: plan.feeCents };
  });
}

export async function checkoutConfig(order) {
  return run(() => {
    const row = myOrder(order);
    if (row.status !== 'pending') return { paid: true };
    return { demo: true, amount: amountOf(order.kind, row), currency: 'eur' };
  });
}

/** The demo has no card form: "paying" settles the order on the spot. */
export async function createPaymentIntent(order) {
  return run(() => {
    const row = myOrder(order);
    settle(order.kind, row);
    return { paid: true };
  });
}

export async function verifyPayment(order) {
  return run(() => {
    const row = myOrder(order);
    const paid = row.status !== 'pending';
    return { paid, status: paid ? 'succeeded' : 'requires_payment_method' };
  });
}

export async function redeem(code) {
  return run(() => {
    const normal = normalizeGiftCode(code);
    const card = normal ? db.booking.giftCards.find((g) => g.code === normal && g.status !== 'pending') : null;
    if (!card) throw fail('Koodia ei löytynyt. Tarkista kirjoitusasu.', 'not_found');
    if (card.status === 'redeemed') throw fail('Tämä lahjakortti on jo käytetty.', 'used');
    if (card.validUntil < today()) throw fail('Lahjakortti on vanhentunut.', 'expired');
    card.status = 'redeemed';
    card.redeemedBy = ME;
    card.redeemedAt = nowIso();
    addCreditEvent({ venueId: card.venueId, kind: 'redeem', giftCardId: card.id, cents: card.amountCents, label: `Lahjakortti ${card.code}` });
    return { venueId: card.venueId, cents: card.amountCents, giftCents: giftAvailable(ME, card.venueId) };
  });
}

// ── Paying a booking with credit ─────────────────────────────────────────────

/** My held, still-live, unpaid booking. */
function payableRow(bookingId) {
  const row = myRow(bookingId);
  if (['paid', 'free', 'credit'].includes(row.paymentStatus) && row.status === 'confirmed') throw fail('Varaus on jo maksettu.');
  if (row.status !== 'held' || !isLive(row)) throw fail(EXPIRED, 'expired');
  return row;
}

const minutesOfRow = (row) => Math.round((Date.parse(row.endsAt) - Date.parse(row.startsAt)) / 60_000);

export async function payBooking(bookingId, passId) {
  return run(() => {
    const row = payableRow(bookingId);
    const pass = db.booking.passes.find((p) => p.id === passId && p.userId === ME && p.status !== 'pending');
    if (!pass) throw fail('Sarjakorttia ei löytynyt.', 'not_found');
    const venue = venueRow(row.venueId);
    const sport = findCourt(venue, row.courtId)?.court.sport;
    const minutes = minutesOfRow(row);
    if (pass.venueId !== row.venueId || pass.sport !== sport) throw fail('Sarjakortti ei käy tähän vuoroon.');
    if (passState(pass, today()) === 'expired' || dateKey(new Date(row.startsAt)) > pass.validUntil) {
      throw fail('Sarjakortti ei ole voimassa vuoron päivänä.');
    }
    if (pass.minutesLeft < minutes) throw fail('Sarjakortin saldo ei riitä tähän vuoroon.', 'insufficient');
    pass.minutesLeft -= minutes;
    addCreditEvent({ venueId: row.venueId, kind: 'use', passId: pass.id, minutes: -minutes, bookingId: row.id, label: rowLabel(row) });
    Object.assign(row, {
      status: 'confirmed', paymentStatus: 'credit', holdExpiresAt: null, passId: pass.id, passMinutes: minutes, giftCents: 0,
    });
    takeOverSales(row);
    return toBooking(row);
  });
}

export async function useGift(bookingId, use = true) {
  return run(() => {
    const row = payableRow(bookingId);
    if (!use) {
      row.giftCents = 0;
      return toBooking(row);
    }
    const share = giftShare(row.priceCents, giftAvailable(ME, row.venueId, row.id));
    if (share <= 0) throw fail('Lahjakorttisaldoa ei ole käytettävissä.', 'insufficient');
    row.giftCents = share;
    if (share === row.priceCents) {
      addCreditEvent({ venueId: row.venueId, kind: 'use', cents: -share, bookingId: row.id, label: rowLabel(row) });
      Object.assign(row, { status: 'confirmed', paymentStatus: 'credit', holdExpiresAt: null });
      takeOverSales(row);
    }
    return toBooking(row);
  });
}

// ── Hall staff ───────────────────────────────────────────────────────────────

export async function staffList(venueId) {
  return run(() => {
    const venue = venueRow(venueId);
    requireStaff(venue);
    const rank = (p) => (p.status === 'active' ? 0 : 1);
    return {
      passes: db.booking.passes
        .filter((p) => p.venueId === venue.id && p.status !== 'pending')
        .map((p) => ({ ...toPass(p, { history: false }), owner: personLite(p.userId) }))
        .sort((a, b) => rank(a) - rank(b) || String(b.purchasedAt).localeCompare(String(a.purchasedAt))),
      giftCards: db.booking.giftCards
        .filter((g) => g.venueId === venue.id && g.status !== 'pending')
        .sort(byNewest)
        .map((g) => ({
          ...toGiftCard(g), buyer: g.buyerId ? personLite(g.buyerId) : null, redeemedBy: g.redeemedBy ? personLite(g.redeemedBy) : null,
        })),
    };
  });
}

// ── Hallin asetukset: products and gift cards ────────────────────────────────

export async function staffProducts(venueId) {
  return run(() => {
    const venue = venueRow(venueId);
    requireStaff(venue);
    return {
      passes: db.booking.passProducts.filter((p) => p.venueId === venue.id).map(toStaffProduct),
      gift: giftOf(venue.id),
    };
  });
}

export async function saveProduct(input = {}) {
  return run(() => {
    const venue = venueRow(input.venueId);
    requireStaff(venue);
    const existing = input.id ? db.booking.passProducts.find((p) => p.id === input.id) : null;
    if (input.id && existing?.venueId !== venue.id) throw fail('Sarjakorttia ei löytynyt.', 'not_found');
    const { value, error } = checkPassProduct(input, { sports: sportsOf(venue, { all: true }).map((s) => s.value) });
    if (error) throw fail(error);
    const product = existing || { id: newId('pp'), venueId: venue.id };
    Object.assign(product, value);
    if (!existing) {
      db.booking.passProducts.push(product);
    } else {
      // An unpaid order is paid with the new content and price (as the RPC does).
      const minutes = product.uses * product.minutesPerUse;
      for (const pass of db.booking.passes) {
        if (pass.productId !== product.id || pass.status !== 'pending') continue;
        Object.assign(pass, { name: product.name, sport: product.sport, minutesTotal: minutes, minutesLeft: minutes, priceCents: product.priceCents });
      }
    }
    return toStaffProduct(product);
  });
}

export async function removeProduct(productId) {
  return run(() => {
    const product = db.booking.passProducts.find((p) => p.id === productId);
    if (!product) throw fail('Sarjakorttia ei löytynyt.', 'not_found');
    requireStaff(venueRow(product.venueId));
    if (db.booking.passes.some((p) => p.productId === product.id)) {
      throw fail('Tätä sarjakorttia on jo tilattu, joten sitä ei voi poistaa. Piilota se myynnistä.');
    }
    db.booking.passProducts.splice(db.booking.passProducts.indexOf(product), 1);
  });
}

export async function saveGiftSettings(venueId, input = {}) {
  return run(() => {
    const venue = venueRow(venueId);
    requireStaff(venue);
    const { value, error } = checkGiftSettings(input);
    if (error) throw fail(error);
    const row = billingRow(venue.id);
    row.gift = value;
    row.updatedAt = nowIso();
    return giftOf(venue.id);
  });
}
