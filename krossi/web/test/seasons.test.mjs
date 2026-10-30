// Phase 2 of court booking: the rules in features/seasons.js (season weeks and price, Finnish
// reference numbers and the bank barcode, gift shares and codes) and the demo backend's seasons,
// billing and wallet domains, which follow the krossi_season_* / krossi_wallet_* RPCs.
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { configureTiming } from '../src/api/demo/runtime.js';
import { db, resetStore } from '../src/api/demo/store.js';
import { backend as api } from '../src/api/demo/index.js';
import { addDays, dateKey, freeSlots, isoWeekday, localDate } from '../src/features/booking.js';
import {
  chargeSchedule, formatReference, giftShare, invoiceLines, isValidReference, normalizeGiftCode, newGiftCode,
  passState, referenceNumber, seasonDates, seasonPrice, slotWhen, vatOf, virtualBarcode, MIN_CARD_CENTS,
} from '../src/features/seasons.js';

configureTiming({ latencyMin: 0, latencyMax: 0, autoScale: 0.001 });
beforeEach(() => resetStore());

const SLOT_KEYS = [
  'id', 'venueId', 'seasonId', 'seasonName', 'sport', 'courtId', 'courtName', 'locationId', 'locationName', 'weekday',
  'startTime', 'minutes', 'startsOn', 'endsOn', 'skipDates', 'status', 'billing', 'priceCents', 'weeks', 'holderName',
  'holder', 'billingEmail', 'billingAddress', 'note', 'declineReason', 'nextAt', 'invoice', 'charges', 'createdAt', 'decidedAt',
  'notifiedAt',
];
const INVOICE_KEYS = [
  'id', 'venueId', 'seasonSlotId', 'number', 'reference', 'issuedOn', 'dueOn', 'amountCents', 'vatPercent', 'vatCents',
  'lines', 'recipient', 'seller', 'status', 'paidOn', 'sentAt', 'createdAt',
];
const keys = (o) => Object.keys(o).sort();
const today = () => dateKey(new Date());

async function venue() {
  return (await api.booking.listVenues())[0];
}
const winter = async (v) => (await api.seasons.list(v.id))[0];
const janus = (v) => v.locations[0];
const court = (v, loc, mapId) => v.locations[loc].courts.find((c) => c.mapId === mapId);

// ── Rules ─────────────────────────────────────────────────────────────────────

test('season weeks skip the holidays and start from the given day', () => {
  const season = { startsOn: '2026-08-31', endsOn: '2027-05-02', skipDates: ['2026-12-24', '2026-12-31', '2027-01-06'] };
  const thursdays = seasonDates(season, 4);
  assert.equal(thursdays.dates[0], '2026-09-03');
  assert.equal(thursdays.dates.at(-1), '2027-04-29');
  assert.deepEqual(thursdays.skipped, ['2026-12-24', '2026-12-31']);
  assert.ok(thursdays.dates.every((d) => isoWeekday(localDate(d)) === 4));
  assert.equal(thursdays.dates.length + thursdays.skipped.length, 35);
  const fromNovember = seasonDates(season, 3, '2026-11-01');
  assert.equal(fromNovember.dates[0], '2026-11-04');
  assert.deepEqual(fromNovember.skipped, ['2027-01-06']);
});

test('season price: each month discounted and rounded, the season is the sum of the months', () => {
  const weeks = [
    { date: '2026-11-04', cents: 3000 }, { date: '2026-11-11', cents: 3000 }, { date: '2026-11-18', cents: 3000 },
    { date: '2026-12-02', cents: 2333 }, { date: '2026-12-09', cents: 2333 },
  ];
  const price = seasonPrice(weeks, 15);
  assert.equal(price.fullCents, 13666);
  assert.deepEqual(price.months, [{ month: '2026-11', count: 3, cents: 7650 }, { month: '2026-12', count: 2, cents: 3966 }]);
  assert.equal(price.cents, 7650 + 3966);
  assert.deepEqual(chargeSchedule(price.months, '2026-11-14'), [
    { month: '2026-11', weeks: 3, amountCents: 7650, dueOn: '2026-11-14' },
    { month: '2026-12', weeks: 2, amountCents: 3966, dueOn: '2026-12-01' },
  ]);
});

test('invoice lines: weeks at the normal price and the season discount as a minus line', () => {
  const slot = { weekday: 3, startTime: '19:00', minutes: 60 };
  const weeks = [{ date: '2026-11-04' }, { date: '2026-11-11' }];
  const lines = invoiceLines(slot, { weeks, fullCents: 6000, priceCents: 5100, discountPercent: 15, courtName: 'Tennis 1', locationName: 'Janus-Areena' });
  assert.equal(lines[0].text, 'Kausivuoro ke 19.00–20.00, Tennis 1, Janus-Areena, 4.11.2026–11.11.2026');
  assert.deepEqual(lines.map((l) => [l.quantity, l.unit, l.unitCents, l.totalCents]), [[2, 'krt', 3000, 6000], [1, '', null, -900]]);
  assert.equal(lines[1].text, 'Kausialennus 15 %');
  assert.equal(lines.reduce((s, l) => s + l.totalCents, 0), 5100);
  assert.equal(invoiceLines(slot, { weeks, fullCents: 6000, priceCents: 4000, discountPercent: 15, agreed: true })[1].text, 'Sovittu kausihinta');
  assert.equal(slotWhen({ weekday: 7, startTime: '09:30', minutes: 90 }), 'su 9.30–11.00');
});

test('Finnish reference numbers, VAT and the virtual barcode', () => {
  assert.equal(referenceNumber('1001'), '10016');
  assert.equal(referenceNumber('123456'), '1234561');
  assert.ok(isValidReference('10016'));
  assert.ok(isValidReference('12 34561'));
  assert.ok(!isValidReference('10017'));
  assert.equal(formatReference('1234561'), '12 34561');
  assert.equal(formatReference('868516259619897'), '86851 62596 19897');
  assert.equal(vatOf(11400, 14), 1400);
  // The Finance Finland specification's example (version 4).
  assert.equal(
    virtualBarcode({ iban: 'FI79 4405 2020 0360 82', cents: 488315, reference: '86851 62596 19897', dueOn: '2010-06-12' }),
    '479440520200360820048831500000000868516259619897100612',
  );
  assert.equal(virtualBarcode({ iban: 'SE4550000000058398257466', cents: 100, reference: '10016', dueOn: '2026-11-01' }), null);
  assert.equal(virtualBarcode({ iban: 'FI2112345600000785', cents: 100, reference: '10016', dueOn: null }).slice(-6), '000000');
});

test('gift shares leave the card at least 50 cents and codes survive retyping', () => {
  assert.equal(giftShare(3000, 0), 0);
  assert.equal(giftShare(3000, 5000), 3000);
  assert.equal(giftShare(3000, 3000), 3000);
  assert.equal(giftShare(3000, 2000), 2000);
  assert.equal(giftShare(3000, 2990), 3000 - MIN_CARD_CENTS);
  const code = newGiftCode(() => 0.5);
  assert.match(code, /^KRSI-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(normalizeGiftCode(code.toLowerCase().replace(/-/g, ' ')), code);
  assert.equal(normalizeGiftCode(code.slice(5)), code);
  assert.equal(normalizeGiftCode('KRSI-ABC'), null);
  assert.equal(passState({ status: 'active', minutesLeft: 60, validUntil: '2026-01-01' }, '2026-01-02'), 'expired');
  assert.equal(passState({ status: 'active', minutesLeft: 0, validUntil: '2027-01-01' }, '2026-01-02'), 'used');
});

// ── Demo: seasons ─────────────────────────────────────────────────────────────

test('seasons: the demo hall runs a winter and a summer season, Alex holds a card-billed slot', async () => {
  const v = await venue();
  const list = await api.seasons.list(v.id);
  assert.equal(list.length, 2);
  assert.ok(list[0].startsOn <= today() && list[0].endsOn >= today());
  assert.equal(list[0].discountPercent, 15);
  const mine = await api.seasons.listMine();
  assert.equal(mine.length, 1);
  const [slot] = mine;
  assert.deepEqual(keys(slot), [...SLOT_KEYS].sort());
  assert.equal(slot.status, 'active');
  assert.equal(slot.billing, 'card');
  assert.equal(slot.courtName, 'Tennis 1');
  assert.ok(slot.nextAt > new Date().toISOString());
  assert.equal(slot.charges.reduce((s, c) => s + c.amountCents, 0), slot.priceCents);
  assert.equal(slot.charges.reduce((s, c) => s + c.weeks, 0), slot.weeks);
  // Its weeks are busy for everybody and mine for Alex.
  const week = slot.nextAt.slice(0, 10);
  const { busy } = await api.booking.day(v.id, dateKey(new Date(slot.nextAt)));
  const row = busy.find((b) => b.kind === 'season' && b.courtId === slot.courtId && b.startsAt === slot.nextAt);
  assert.ok(row, `season week on ${week}`);
  assert.equal(row.title, 'Kausivuoro');
  assert.equal(row.mine, true);
  await assert.rejects(api.booking.hold({ courtId: slot.courtId, startsAt: slot.nextAt, minutes: 60 }), (err) => err.code === 'taken');
});

test('seasons: quote counts conflicts per court and prices the free weeks', async () => {
  const v = await venue();
  const season = await winter(v);
  const te3 = court(v, 0, 'te3'); // the juniors' coaching block, weekdays 16–18 (seeded two weeks ahead)
  const q = await api.seasons.quote({ seasonId: season.id, courtId: te3.id, weekday: 2, startTime: '16:00', minutes: 60 });
  assert.equal(q.courtId, te3.id);
  const blocked = q.weeks.filter((w) => w.conflict);
  assert.ok(blocked.length >= 2);
  assert.ok(blocked.every((w) => w.conflict.kind === 'block' && w.conflict.title === 'Junioreiden valmennus'));
  assert.equal(q.count, q.weeks.length - blocked.length);
  const any = await api.seasons.quote({ seasonId: season.id, locationId: janus(v).id, weekday: 2, startTime: '16:00', minutes: 60 });
  assert.notEqual(any.courtId, te3.id);
  assert.equal(any.courts.length, 4);
  assert.equal(any.courts.find((c) => c.courtId === te3.id).conflicts, blocked.length);
  assert.ok(any.courts.find((c) => c.courtId === any.courtId).conflicts < blocked.length);
  assert.equal(any.cents, any.months.reduce((s, m) => s + m.cents, 0));
  assert.equal(any.count, any.weeks.filter((w) => !w.conflict).length);
  await assert.rejects(api.seasons.quote({ seasonId: season.id, weekday: 8, startTime: '16:00', minutes: 60 }), /viikonpäivä/);
  await assert.rejects(api.seasons.quote({ seasonId: season.id, weekday: 2, startTime: '16:15', minutes: 60 }), /aloitusaika/);
  await assert.rejects(api.seasons.quote({ seasonId: season.id, weekday: 2, startTime: '22:30', minutes: 60 }), /suljettu/);
});

test('seasons: request -> hall approves around a taken week -> weeks in the calendar, months on the card', async () => {
  const v = await venue();
  const season = await winter(v);
  const te2 = court(v, 0, 'te2');
  const quote = await api.seasons.quote({ seasonId: season.id, courtId: te2.id, weekday: 6, startTime: '08:00', minutes: 60 });
  assert.ok(quote.count > 5);
  // Somebody books one of the coming Saturdays 8.00 before the hall answers.
  const taken = quote.weeks.find((w) => !w.conflict && dateKey(new Date(w.startsAt)) <= addDays(today(), v.daysAhead));
  db.booking.rows.push({
    id: 'bk-other', venueId: v.id, courtId: te2.id, startsAt: taken.startsAt, endsAt: taken.endsAt, kind: 'booking',
    status: 'confirmed', bookedBy: 'p-ville', title: null, priceCents: 3000, paymentStatus: 'paid', holdExpiresAt: null,
    createdAt: new Date().toISOString(), cancelledAt: null,
  });
  const requested = await api.seasons.request({
    seasonId: season.id, courtId: te2.id, locationId: null, weekday: 6, startTime: '08:00', minutes: 60, billing: 'card', note: ' Lauantaiaamut ',
  });
  assert.equal(requested.status, 'requested');
  assert.equal(requested.note, 'Lauantaiaamut');
  assert.equal(requested.charges.length, 0);
  await assert.rejects(api.seasons.request({
    seasonId: season.id, courtId: te2.id, weekday: 6, startTime: '08:00', minutes: 60, billing: 'card',
  }), /jo hakemus/);

  const conflictsBefore = quote.weeks.filter((w) => w.conflict).length;
  await assert.rejects(api.seasons.approve(requested.id, {}), (err) => err.code === 'conflict'
    && err.userMessage.startsWith(`Kenttä on varattu ${conflictsBefore + 1 === 1 ? 'yhtenä viikkona' : `${conflictsBefore + 1} viikkona`}`));
  const approved = await api.seasons.approve(requested.id, { skipConflicts: true });
  assert.equal(approved.status, 'active');
  assert.ok(approved.skipDates.includes(taken.date));
  assert.equal(approved.weeks, quote.count - 1);
  assert.equal(approved.charges.length, approved.charges.filter((c) => c.status === 'scheduled').length);
  assert.equal(approved.charges[0].dueOn, today());
  assert.equal(approved.charges.reduce((s, c) => s + c.amountCents, 0), approved.priceCents);
  await assert.rejects(api.seasons.approve(requested.id, {}), /jo käsitelty/);

  // The hall view shows the weeks with the holder's name.
  const next = approved.nextAt;
  const items = await api.booking.staffDay(v.id, dateKey(new Date(next)));
  const item = items.find((it) => it.kind === 'season' && it.seasonSlotId === approved.id);
  assert.equal(item.title, 'Alex');
  assert.equal(item.paymentStatus, 'none');
  assert.equal(item.bookedBy.id, 'demo-user');

  // The first month is charged by the hall's run; a removed week frees the court.
  const run = await api.billing.runCharges(v.id);
  assert.ok(run.paid >= 1);
  const charged = (await api.seasons.listMine()).find((s) => s.id === approved.id);
  assert.equal(charged.charges[0].status, 'paid');
  await api.seasons.releaseOccurrence(item.id);
  const after = await api.booking.staffDay(v.id, dateKey(new Date(next)));
  assert.ok(!after.some((it) => it.id === item.id));

  // Ending the slot frees every coming week and voids the months not due yet.
  const { released } = await api.seasons.end(approved.id);
  assert.equal(released, approved.weeks - 1);
  const ended = (await api.seasons.listMine()).find((s) => s.id === approved.id);
  assert.equal(ended.status, 'ended');
  assert.equal(ended.nextAt, null);
  assert.ok(ended.charges.slice(1).every((c) => c.status === 'void' || c.dueOn <= today()));
});

test('seasons: card billing needs a saved card; withdraw and decline', async () => {
  const v = await venue();
  const season = await winter(v);
  await assert.rejects(api.billing.removeCard(), /kortilta/);
  db.booking.cards.delete('demo-user');
  await assert.rejects(api.seasons.request({
    seasonId: season.id, locationId: janus(v).id, weekday: 1, startTime: '06:00', minutes: 60, billing: 'card',
  }), (err) => err.code === 'card_required');
  const r = await api.seasons.request({
    seasonId: season.id, locationId: janus(v).id, weekday: 1, startTime: '06:00', minutes: 60, billing: 'invoice', note: '',
  });
  assert.equal(r.courtId, null);
  assert.equal(r.locationName, 'Janus-Areena');
  await api.seasons.withdraw(r.id);
  assert.ok(!(await api.seasons.listMine()).some((s) => s.id === r.id));
  const laura = (await api.seasons.staffList(v.id)).find((s) => s.holderName === 'Laura');
  await api.seasons.decline(laura.id, 'Torstai-illat ovat täynnä.');
  const declined = (await api.seasons.staffList(v.id)).find((s) => s.id === laura.id);
  assert.equal(declined.status, 'declined');
  assert.equal(declined.declineReason, 'Torstai-illat ovat täynnä.');
});

test('seasons: the hall adds a team slot, invoiced with a valid reference', async () => {
  const v = await venue();
  const season = await winter(v);
  const te4 = court(v, 1, 'te4');
  const slot = await api.seasons.create({
    venueId: v.id, seasonId: season.id, courtId: te4.id, weekday: 3, startTime: '06:30', minutes: 90,
    holderName: 'Aamupalloilijat ry', billingEmail: 'pj@aamupallo.example', billingAddress: 'PL 1, 15100 Lahti', priceCents: null,
    skipConflicts: true,
  });
  assert.equal(slot.status, 'active');
  assert.equal(slot.holder, null);
  assert.equal(slot.invoice.status, 'open');
  const invoice = await api.billing.getInvoice(slot.invoice.id);
  assert.deepEqual(keys(invoice), [...INVOICE_KEYS].sort());
  assert.equal(invoice.number, '1004');
  assert.ok(isValidReference(invoice.reference));
  assert.equal(invoice.amountCents, slot.priceCents);
  assert.equal(invoice.lines.reduce((s, l) => s + l.totalCents, 0), invoice.amountCents);
  assert.equal(invoice.vatCents, vatOf(invoice.amountCents, 14));
  assert.equal(invoice.recipient.name, 'Aamupalloilijat ry');
  assert.equal(invoice.seller.iban, 'FI2112345600000785');
  const sent = await api.billing.sendInvoice(invoice.id);
  assert.equal(sent.sentTo, 'pj@aamupallo.example');
  const paid = await api.billing.markInvoicePaid(invoice.id, today());
  assert.equal(paid.status, 'paid');
  assert.equal(paid.paidOn, today());
  await assert.rejects(api.seasons.create({
    venueId: v.id, seasonId: season.id, courtId: te4.id, weekday: 3, startTime: '06:30', minutes: 90, holderName: ' ',
  }), /haltija/);
  const agreed = await api.seasons.create({
    venueId: v.id, seasonId: season.id, courtId: court(v, 1, 'te3').id, weekday: 3, startTime: '06:30', minutes: 60,
    holderName: 'Seura', billingEmail: null, priceCents: 50000, skipConflicts: true,
  });
  assert.equal(agreed.priceCents, 50000);
  const agreedInvoice = await api.billing.getInvoice(agreed.invoice.id);
  assert.equal(agreedInvoice.lines[1].text, 'Sovittu kausihinta');
  await assert.rejects(api.billing.sendInvoice(agreedInvoice.id), /sähköpostiosoitetta/);
});

test('billing: a failing card fails the month, the holder pays it in the app', async () => {
  const v = await venue();
  const season = await winter(v);
  await api.billing.cardSaved('demo-0341');
  assert.deepEqual(await api.billing.cardStatus(), { brand: 'visa', last4: '0341', expMonth: 12, expYear: new Date().getFullYear() + 3 });
  const req = await api.seasons.request({
    seasonId: season.id, courtId: court(v, 2, 'ulko1').id, weekday: isoWeekday(localDate(addDays(today(), 2))),
    startTime: '08:00', minutes: 60, billing: 'card',
  });
  const slot = await api.seasons.approve(req.id, { skipConflicts: true });
  const first = slot.charges[0];
  const result = await api.billing.runCharges(v.id);
  assert.ok(result.failed >= 1);
  const failed = (await api.billing.listCharges(v.id)).find((c) => c.id === first.id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.failureMessage, /hylkäsi/);
  assert.equal(failed.holderName, 'Alex');
  // Mikko's month failed in the seed: it stays on top of the hall's list.
  assert.equal((await api.billing.listCharges(v.id))[0].status, 'failed');
  const pay = await api.billing.payCharge(first.id);
  assert.deepEqual(pay, { demo: true, amount: first.amountCents, currency: 'eur' });
  assert.deepEqual(await api.billing.verifyCharge(first.id, null), { paid: true, status: 'succeeded' });
  assert.deepEqual(await api.billing.payCharge(first.id), { paid: true });
  await assert.rejects(api.billing.payCharge(slot.charges.at(-1).id), /eräpäivänä/);
});

// ── Demo: wallet ──────────────────────────────────────────────────────────────

/** A held booking of Alex's on a free tennis court a few days ahead, costing at least `minCents`. */
async function heldBooking(v, minutes = 60, offset = 3, minCents = 0) {
  const key = addDays(today(), offset);
  const { busy } = await api.booking.day(v.id, key);
  const slots = freeSlots(v, key, busy, { sport: 'tennis', minutes });
  const slot = slots.find((s) => s.options.some((o) => o.cents >= minCents));
  assert.ok(slot, `no free ${minutes} min tennis of ${minCents} cents on ${key}`);
  const option = slot.options.find((o) => o.cents >= minCents);
  return api.booking.hold({ courtId: option.court.id, startsAt: slot.startsAt, minutes });
}

test('wallet: Alex has a series card with history and a gift balance', async () => {
  const v = await venue();
  const w = await api.wallet.get(v.id);
  assert.equal(w.passes.length, 1);
  const [pass] = w.passes;
  assert.equal(pass.status, 'active');
  assert.equal(pass.minutesLeft, 480);
  assert.equal(pass.history.length, 3);
  assert.equal(pass.history.reduce((s, e) => s + e.minutes, 0), 480);
  assert.equal(w.giftCents, 2000);
  assert.equal(w.giftHistory.reduce((s, e) => s + e.cents, 0), 2000);
  assert.equal(w.giftCards.length, 1);
  assert.match(w.giftCards[0].code, /^KRSI-/);
  const past = (await api.booking.listMine()).past.find((b) => b.credit);
  assert.deepEqual(past.credit, { kind: 'pass', cents: past.priceCents, minutes: 60, name: 'Tennis 10 × 1 h' });
  assert.equal(past.paymentStatus, 'credit');
});

test('wallet: buy a series card, pay a booking with it, cancel gives the hour back', async () => {
  const v = await venue();
  const { passes: products } = await api.wallet.products(v.id);
  const product = products.find((p) => p.uses === 20);
  const pending = await api.wallet.buyPass(product.id);
  assert.equal(pending.status, 'pending');
  assert.equal((await api.wallet.buyPass(product.id)).id, pending.id);
  assert.deepEqual(await api.wallet.checkoutConfig({ kind: 'pass', id: pending.id }), { demo: true, amount: 48000, currency: 'eur' });
  assert.deepEqual(await api.wallet.createPaymentIntent({ kind: 'pass', id: pending.id }), { paid: true });
  assert.deepEqual(await api.wallet.verifyPayment({ kind: 'pass', id: pending.id }, null), { paid: true, status: 'succeeded' });
  const bought = (await api.wallet.get(v.id)).passes.find((p) => p.id === pending.id);
  assert.equal(bought.minutesLeft, 1200);
  assert.equal(bought.validUntil, addDays(today(), 365));

  const held = await heldBooking(v, 90);
  const paid = await api.wallet.payBooking(held.id, bought.id);
  assert.equal(paid.status, 'confirmed');
  assert.equal(paid.paymentStatus, 'credit');
  assert.deepEqual(paid.credit, { kind: 'pass', cents: paid.priceCents, minutes: 90, name: 'Tennis 20 × 1 h' });
  assert.equal((await api.wallet.get(v.id)).passes.find((p) => p.id === bought.id).minutesLeft, 1110);
  await assert.rejects(api.wallet.payBooking(held.id, bought.id), /jo maksettu/);

  const result = await api.booking.cancel(held.id);
  assert.deepEqual(result, { refundedCents: 0, feeCents: 0, creditCents: 0, creditMinutes: 90 }, 'no card money, no peruutuskulu');
  const back = (await api.wallet.get(v.id)).passes.find((p) => p.id === bought.id);
  assert.equal(back.minutesLeft, 1200);
  assert.equal(back.history[0].kind, 'refund');

  // Not enough left: an 8-hour card can't pay a 2-hour booking once 7 hours are gone.
  const alexPass = (await api.wallet.get(v.id)).passes.find((p) => p.minutesTotal === 600);
  db.booking.passes.find((p) => p.id === alexPass.id).minutesLeft = 60;
  const long = await heldBooking(v, 120, 4);
  await assert.rejects(api.wallet.payBooking(long.id, alexPass.id), (err) => err.code === 'insufficient');
});

test('wallet: a gift card is bought, redeemed once, and pays part of a booking', async () => {
  const v = await venue();
  await assert.rejects(api.wallet.buyGiftCard({ venueId: v.id, amountCents: 500 }), /täysinä euroina/);
  const card = await api.wallet.buyGiftCard({ venueId: v.id, amountCents: 2500, recipientName: ' Aino ', message: 'Pelaillaan!' });
  assert.equal(card.code, null);
  await api.wallet.createPaymentIntent({ kind: 'gift', id: card.id });
  const issued = (await api.wallet.get(v.id)).giftCards.find((g) => g.id === card.id);
  assert.match(issued.code, /^KRSI-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(issued.recipientName, 'Aino');

  const redeemed = await api.wallet.redeem(issued.code.toLowerCase().replace(/-/g, ' '));
  assert.deepEqual(redeemed, { venueId: v.id, cents: 2500, giftCents: 4500 });
  await assert.rejects(api.wallet.redeem(issued.code), (err) => err.code === 'used');
  await assert.rejects(api.wallet.redeem('KRSI-AAAA-AAAA'), (err) => err.code === 'not_found');

  // 45 € balance on a two-hour evening booking: part of it, the card pays the rest.
  const held = await heldBooking(v, 120, 3, 5000);
  assert.ok(held.priceCents > 4500);
  const withGift = await api.wallet.useGift(held.id, true);
  assert.equal(withGift.status, 'held');
  assert.deepEqual(withGift.credit, { kind: 'gift', cents: 4500, minutes: 0, name: null });
  // A second hold can't spend the same balance.
  const other = await heldBooking(v, 60, 5);
  await assert.rejects(api.wallet.useGift(other.id, true), (err) => err.code === 'insufficient');
  await api.booking.release(other.id);
  const config = await api.booking.checkoutConfig(held.id);
  assert.equal(config.amount, held.priceCents - 4500);
  await api.booking.createPaymentIntent(held.id);
  assert.equal((await api.wallet.get(v.id)).giftCents, 0);
  const cancelled = await api.booking.cancel(held.id);
  assert.deepEqual(cancelled, { refundedCents: held.priceCents - 4500 - 100, feeCents: 100, creditCents: 4500, creditMinutes: 0 }, 'the gift balance back whole, 1 € of the card money stays');
  assert.equal((await api.wallet.get(v.id)).giftCents, 4500);

  // Enough balance confirms a booking on the spot.
  const small = await heldBooking(v, 60, 6);
  db.booking.creditEvents.push({ id: 'ce-x', venueId: v.id, userId: 'demo-user', kind: 'adjust', passId: null, giftCardId: null, bookingId: null, minutes: 0, cents: 10000, label: 'Hyvitys', createdAt: new Date().toISOString() });
  const covered = await api.wallet.useGift(small.id, true);
  assert.equal(covered.status, 'confirmed');
  assert.equal(covered.paymentStatus, 'credit');
  assert.deepEqual(await api.booking.checkoutConfig(small.id), { paid: true });
});

test('wallet: staff see the cards sold', async () => {
  const v = await venue();
  const sold = await api.wallet.staffList(v.id);
  assert.equal(sold.passes.length, 4);
  assert.ok(sold.passes.every((p) => p.owner && p.history.length === 0));
  assert.deepEqual(sold.passes.map((p) => p.status).sort(), ['active', 'active', 'active', 'used']);
  assert.equal(sold.giftCards.length, 3);
  assert.equal(sold.giftCards.find((g) => g.status === 'redeemed').redeemedBy.id, 'demo-user');
});
