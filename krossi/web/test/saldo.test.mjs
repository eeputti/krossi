// Hallikohtainen saldo: the shared rules in features/booking.js (saldoRefundPlan, cancelChoices,
// giveBackOf with friends' parts back in the saldo) and the demo backend that follows the server
// (migration 20261017190000_krossi_booking_saldo, krossi-billing saldoRefund, krossi-booking
// cancel toSaldo / splitSaldo).
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { configureTiming } from '../src/api/demo/runtime.js';
import { resetStore } from '../src/api/demo/store.js';
import { backend as api } from '../src/api/demo/index.js';
import {
  SALDO_RULES, addDays, cancelChoices, dateKey, freeSlots, giveBackOf, saldoRefundPlan,
} from '../src/features/booking.js';

configureTiming({ latencyMin: 0, latencyMax: 0, autoScale: 0.001 });
beforeEach(() => resetStore());

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-17T12:00:00Z');
const ago = (days) => new Date(NOW - days * DAY).toISOString();

// ── Rules ─────────────────────────────────────────────────────────────────────

test('saldo rules: 25 / 50 / 100 €, back to the card free for 14 days, then 1 €, until 180 days', () => {
  assert.deepEqual({ ...SALDO_RULES, amounts: [...SALDO_RULES.amounts] },
    { amounts: [2500, 5000, 10000], refundFreeDays: 14, refundDays: 180, refundFeeCents: 100 });
});

test('refund plan: only top-ups, newest first, at most the saldo; free while every top-up in it is fresh', () => {
  const fresh = { id: 'new', amountCents: 5000, refundedCents: 0, paidAt: ago(2) };
  const old = { id: 'old', amountCents: 2500, refundedCents: 0, paidAt: ago(30) };
  assert.deepEqual(saldoRefundPlan(3000, [old, fresh], NOW), {
    totalCents: 3000, feeCents: 0, cents: 3000, freeUntil: new Date(Date.parse(fresh.paidAt) + 14 * DAY).toISOString(),
    rows: [{ topupId: 'new', cents: 3000, feeCents: 0 }],
  });
  // Reaching the old top-up: 1 € off, from the oldest row.
  assert.deepEqual(saldoRefundPlan(7500, [old, fresh], NOW), {
    totalCents: 7500, feeCents: 100, cents: 7400, freeUntil: null,
    rows: [{ topupId: 'new', cents: 5000, feeCents: 0 }, { topupId: 'old', cents: 2400, feeCents: 100 }],
  });
  // More saldo than top-ups (a gift card, a cancellation): only the top-ups go back.
  assert.equal(saldoRefundPlan(20000, [fresh], NOW).cents, 5000);
  assert.equal(saldoRefundPlan(20000, [], NOW).cents, 0, 'a gift card balance never goes to a card');
  // What went back already, and top-ups past 180 days, are out.
  assert.equal(saldoRefundPlan(5000, [{ ...fresh, refundedCents: 4000 }], NOW).cents, 1000);
  assert.equal(saldoRefundPlan(5000, [{ ...old, paidAt: ago(181) }], NOW).cents, 0);
  assert.equal(saldoRefundPlan(0, [fresh], NOW).cents, 0);
});

test('cancelling: card minus 1 € or the whole card part into the saldo; the saldo part comes back either way', () => {
  const card = { priceCents: 3000, paymentStatus: 'paid', credit: null, split: null };
  assert.deepEqual(cancelChoices(card), { cardCents: 2900, feeCents: 100, saldoCents: 3000, giftCents: 0 });
  const mixed = { ...card, credit: { kind: 'gift', cents: 500, minutes: 0, name: null } };
  assert.deepEqual(cancelChoices(mixed), { cardCents: 2400, feeCents: 100, saldoCents: 3000, giftCents: 500 });
  assert.equal(cancelChoices({ ...card, paymentStatus: 'credit', credit: { kind: 'gift', cents: 3000, minutes: 0, name: null } }), null,
    'all saldo: nothing to choose');
  assert.equal(cancelChoices({ ...card, paymentStatus: 'credit', credit: { kind: 'pass', cents: 3000, minutes: 60, name: 'x' } }), null);
  assert.equal(cancelChoices({ ...card, paymentStatus: 'unpaid' }), null);
});

test('what comes back of a split booking: friends\' parts that went to the saldo come off the saldo part', () => {
  const line = (status, backTo) => ({ id: 's', kind: 'friend', person: null, name: null, cents: 1000, status, paidAt: null, backTo });
  const own = { id: null, kind: 'own', person: null, name: null, cents: 1000, status: 'paid', paidAt: null, backTo: null };
  const saldoPaid = { priceCents: 3000, paymentStatus: 'credit', credit: { kind: 'gift', cents: 3000, minutes: 0, name: null },
    split: { parts: 3, perCents: 1000, ownCents: 1000, token: null, lines: [own, line('paid', 'saldo'), line('open', null)] } };
  assert.deepEqual(giveBackOf(saldoPaid), { cardCents: 0, giftCents: 2000, minutes: 0, feeCents: 0 });
  // 15 € saldo + 25 € card, 4 players: one part back in the saldo, one on the card.
  const mixed = { priceCents: 4000, paymentStatus: 'paid', credit: { kind: 'gift', cents: 1500, minutes: 0, name: null },
    split: { parts: 4, perCents: 1000, ownCents: 1000, token: null, lines: [own, line('paid', 'saldo'), line('paid', 'card'), line('open', null)] } };
  assert.deepEqual(giveBackOf(mixed), { cardCents: 1400, giftCents: 500, minutes: 0, feeCents: 100 });
  assert.deepEqual(cancelChoices(mixed), { cardCents: 1400, feeCents: 100, saldoCents: 2000, giftCents: 500 });
});

// ── Demo ──────────────────────────────────────────────────────────────────────

async function venue() {
  return (await api.booking.listVenues())[0];
}
async function freeTennis(v, key) {
  const { busy } = await api.booking.day(v.id, key);
  const slots = freeSlots(v, key, busy, { sport: 'tennis', minutes: 60 });
  assert.ok(slots.length, `no free tennis on ${key}`);
  const slot = slots[slots.length - 1];
  return { startsAt: slot.startsAt, court: slot.options[0].court };
}
async function hold(v, daysAhead) {
  const slot = await freeTennis(v, addDays(dateKey(new Date()), daysAhead));
  return api.booking.hold({ courtId: slot.court.id, startsAt: slot.startsAt, minutes: 60 });
}
async function topUp(v, cents) {
  const order = await api.wallet.topUp({ venueId: v.id, amountCents: cents });
  const ref = { kind: 'topup', id: order.id };
  assert.deepEqual(await api.wallet.checkoutConfig(ref), { demo: true, amount: cents, currency: 'eur' });
  assert.deepEqual(await api.wallet.createPaymentIntent(ref), { paid: true });
  return order;
}

test('demo: the hall has the saldo; a top-up is paid like a card and lands on the saldo', async () => {
  const v = await venue();
  assert.equal(v.saldo, true);
  assert.deepEqual((await api.wallet.products(v.id)).topup, { amounts: [2500, 5000, 10000], refundFreeDays: 14, refundDays: 180, refundFeeCents: 100 });
  await assert.rejects(api.wallet.topUp({ venueId: v.id, amountCents: 3000 }), /25, 50 tai 100 €/);
  const before = (await api.wallet.get(v.id)).giftCents;
  const order = await topUp(v, 5000);
  assert.deepEqual([order.amountCents, order.status], [5000, 'pending']);
  const w = await api.wallet.get(v.id);
  assert.equal(w.giftCents, before + 5000);
  assert.equal(w.giftHistory[0].kind, 'topup');
  assert.deepEqual([w.refundableCents, w.refundFeeCents], [5000, 0]);
  assert.ok(w.refundFreeUntil);
  assert.deepEqual(await api.wallet.verifyPayment({ kind: 'topup', id: order.id }), { paid: true, status: 'succeeded' });
});

test('demo: unused top-ups back to the card; the rest of the saldo stays', async () => {
  const v = await venue();
  const before = (await api.wallet.get(v.id)).giftCents;
  await assert.rejects(api.wallet.refundToCard(v.id), /Kortille palautettavaa saldoa ei ole/);
  await topUp(v, 2500);
  assert.deepEqual(await api.wallet.refundToCard(v.id), { refundedCents: 2500, feeCents: 0 });
  const w = await api.wallet.get(v.id);
  assert.equal(w.giftCents, before);
  assert.equal(w.giftHistory[0].kind, 'card_refund');
  assert.equal(w.refundableCents, 0);
});

test('demo: cancel into the saldo — the whole card part, no peruutuskulu', async () => {
  const v = await venue();
  const held = await hold(v, 5);
  await api.booking.createPaymentIntent(held.id);
  const before = (await api.wallet.get(v.id)).giftCents;
  assert.deepEqual(await api.booking.cancel(held.id, { toSaldo: true }),
    { refundedCents: 0, feeCents: 0, creditCents: held.priceCents, creditMinutes: 0 });
  assert.equal((await api.wallet.get(v.id)).giftCents, before + held.priceCents);
  const other = await hold(v, 6);
  await api.booking.createPaymentIntent(other.id);
  assert.deepEqual(await api.booking.cancel(other.id),
    { refundedCents: other.priceCents - 100, feeCents: 100, creditCents: 0, creditMinutes: 0 }, 'by card as before');
});

test('demo: a saldo-paid booking split; a friend\'s part goes back to my saldo, and cancelling gives the rest back', async () => {
  const v = await venue();
  await topUp(v, 10000);
  const held = await hold(v, 7);
  const paid = await api.wallet.useGift(held.id, true);
  assert.equal(paid.paymentStatus, 'credit');
  const token = (await api.booking.split(held.id, 2)).split.token;
  const before = (await api.wallet.get(v.id)).giftCents;
  // Shown to a friend in the demo: they pay without an account.
  assert.deepEqual(await api.booking.createSplitPaymentIntent(token, { name: 'Kaisa' }), { paid: true });
  const mine = (await api.booking.listMine()).upcoming.find((b) => b.id === held.id);
  assert.equal(mine.split.lines[1].backTo, 'saldo');
  const per = mine.split.perCents;
  assert.equal((await api.wallet.get(v.id)).giftCents, before + per);
  assert.deepEqual(await api.booking.cancel(held.id), { refundedCents: 0, feeCents: 0, creditCents: held.priceCents - per, creditMinutes: 0 });
  assert.equal((await api.wallet.get(v.id)).giftCents, before + held.priceCents);
});

test('demo: Mikko\'s link — Alex pays his part from the saldo; not enough saldo says so', async () => {
  const v = await venue();
  const token = 'revanssiMikkoT4Hd6Lx2Bn';
  const link = await api.booking.splitPublic(token);
  assert.equal(link.venueId, v.id);
  const saldo = (await api.wallet.get(v.id)).giftCents;
  if (saldo >= link.perCents) {
    // Spend it down first, so "not enough" can be seen.
    const held = await hold(v, 8);
    await api.wallet.useGift(held.id, true);
  }
  if ((await api.wallet.get(v.id)).giftCents < link.perCents) {
    await assert.rejects(api.booking.paySplitWithSaldo(token), /Saldosi tässä hallissa ei riitä osuuteen/);
  }
  await topUp(v, 2500);
  const before = (await api.wallet.get(v.id)).giftCents;
  assert.deepEqual(await api.booking.paySplitWithSaldo(token), { paid: true });
  assert.equal((await api.wallet.get(v.id)).giftCents, before - link.perCents);
  assert.equal((await api.booking.splitPublic(token)).state, 'full');
  assert.deepEqual(await api.booking.paySplitWithSaldo(token), { full: true });
});
