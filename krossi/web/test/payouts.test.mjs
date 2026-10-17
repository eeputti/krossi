// features/payouts.js — what a payment costs the hall (Hallin asetukset → Verkkomaksut) — against
// the server's rule in supabase/functions/_shared/fees.ts, which the edge tests check on its own.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { CANCEL_FEE_CENTS } from '../src/features/booking.js';
import { feeExamples, hourPrices, paymentFee, payoutStateLabel, percentLabel, rateLabel } from '../src/features/payouts.js';

const FEES_TS = new URL('../../../supabase/functions/_shared/fees.ts', import.meta.url);
const FEE = { stripeBps: 175, stripeFixedCents: 36, marginBps: 0, marginFixedCents: 0 };

test('the app and the server use the same Stripe estimate, and the demo shows it', async () => {
  const source = await readFile(FEES_TS, 'utf8');
  const m = /export const STRIPE_COST = \{ bps: (\d+), fixedCents: (\d+) \} as const;/.exec(source);
  assert.ok(m, 'STRIPE_COST in _shared/fees.ts');
  assert.deepEqual([Number(m[1]), Number(m[2])], [FEE.stripeBps, FEE.stripeFixedCents]);
  assert.match(source, /Math\.ceil\(\(amount \* bps\) \/ 10_000\) \+ STRIPE_COST\.fixedCents \+ \(venue\.platform_fee_fixed_cents \|\| 0\)/);
  assert.match(source, /return Math\.min\(amount, fee\);/);
  // The peruutuskulu: the same 1 € in the app (giveBackOf, terms) and in the refunds.
  assert.match(source, /export const CANCEL_FEE_CENTS = 100;/);
  assert.equal(CANCEL_FEE_CENTS, 100);
  const { backend } = await import('../src/api/demo/index.js');
  const demoVenue = (await backend.booking.listVenues())[0];
  // Krossi's margin is 1 % for every hall (migration 20261017134522): the demo shows the same.
  assert.deepEqual((await backend.billing.payoutStatus(demoVenue.id)).fee, { ...FEE, marginBps: 100 });
  const migration = await readFile(new URL('../../../supabase/migrations/20261017134522_krossi_booking_connect_fees.sql', import.meta.url), 'utf8');
  assert.match(migration, /alter column platform_fee_bps set default 100;/);
  assert.match(migration, /update public\.booking_venues set platform_fee_bps = 100 where platform_fee_bps = 0;/);
});

test('paymentFee: Stripe\'s estimate + the margin, the percentage rounded up, never more than the payment', () => {
  assert.equal(paymentFee(3000, FEE), 89);
  assert.equal(paymentFee(1800, FEE), 68);
  assert.equal(paymentFee(750, FEE), 50);
  assert.equal(paymentFee(3000, { ...FEE, marginBps: 200, marginFixedCents: 10 }), 159);
  // Krossi's 1 %: 18 € → 0,86 €, 23 € → 1,00 €, 30 € → 1,19 €
  assert.deepEqual([1800, 2300, 3000].map((c) => paymentFee(c, { ...FEE, marginBps: 100 })), [86, 100, 119]);
  assert.equal(paymentFee(30, FEE), 30);
  assert.equal(paymentFee(0, FEE), 0);
});

test('labels: percentages and the rule in Finnish', () => {
  assert.equal(percentLabel(175), '1,75 %');
  assert.equal(percentLabel(200), '2 %');
  assert.equal(rateLabel(175, 36), '1,75 % + 0,36 €');
  assert.equal(rateLabel(0, 10), '0,10 €');
  assert.equal(rateLabel(0, 0), '0 €');
});

test('hourPrices: the bookable sports\' prices, lowest first, at most three', () => {
  const venue = { prices: [
    { sports: ['tennis'], centsPerHour: 3000 }, { sports: ['tennis'], centsPerHour: 1800 }, { sports: null, centsPerHour: 2300 },
    { sports: ['squash'], centsPerHour: 1200 }, { sports: ['tennis'], centsPerHour: 2300 },
  ] };
  assert.deepEqual(hourPrices(venue), [1800, 2300, 3000]);
  const many = { prices: [1000, 1500, 2000, 2500, 3000].map((c) => ({ sports: ['tennis'], centsPerHour: c })) };
  assert.deepEqual(hourPrices(many), [1000, 2000, 3000]);
  assert.deepEqual(hourPrices({}), []);
});

test('feeExamples: each price and the dearest split four ways (four payments, four fees)', () => {
  const venue = { prices: [{ sports: ['tennis'], centsPerHour: 1800 }, { sports: ['tennis'], centsPerHour: 3000 }] };
  assert.deepEqual(feeExamples(venue, FEE), [
    { label: '1 h · 18 €', cents: 1800, feeCents: 68, hallCents: 1732 },
    { label: '1 h · 30 €', cents: 3000, feeCents: 89, hallCents: 2911 },
    // 89 for the booker's 30 € + 3 × 50 for the friends' 7,50 € shares
    { label: '1 h · 30 €, jaettu 4 osaan', cents: 3000, feeCents: 239, hallCents: 2761 },
  ]);
  assert.equal(feeExamples({}, FEE).length, 3, 'example prices when the hall has none');
});

test('payoutStateLabel: ready, pending with what Stripe still needs, none', () => {
  assert.equal(payoutStateLabel({ state: 'ready' }).chip, 'Valmis');
  assert.equal(payoutStateLabel({ state: 'pending', dueCount: 1 }).text,
    'Stripe tarvitsee hallilta vielä yhden tiedon. Verkkomaksut eivät ole vielä käytössä.');
  assert.match(payoutStateLabel({ state: 'pending', dueCount: 3 }).text, /^Stripe tarvitsee hallilta vielä 3 tietoa\./);
  assert.match(payoutStateLabel({ state: 'pending', dueCount: 0 }).text, /^Stripe tarkistaa hallin tietoja\./);
  assert.deepEqual([payoutStateLabel({ state: 'none' }).chip, payoutStateLabel(null).tone], ['Ei yhdistetty', 'neutral']);
});
