// Koutsi's Stripe pieces (supabase/functions/_shared/koutsiPlan.js, used by the edge functions
// koutsi-subscription and koutsi-stripe-webhook): the Checkout session, which events are Koutsi's,
// what a subscription writes — and that none of it can reach Krossi's stripe-webhook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyArgs, bestSubscription, checkoutParams, expireOpenCheckouts, foundingCoupon, foundingCouponFor, foundingLeft, foundingMonths,
  isFoundingCoupon, koutsiCoachOf, KOUTSI_PRODUCT, offerMonths, pickSubscription, priceInfo, returnBase, stripeTrial, subscriptionIdOf,
  wholeMonths,
} from '../../../supabase/functions/_shared/koutsiPlan.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const COACH = '00000000-0000-4000-8000-0000000000c1';
const NOW = Date.parse('2026-10-29T12:00:00Z');
const meta = { product: KOUTSI_PRODUCT, koutsi_coach_id: COACH };
const params = (extra = {}) => checkoutParams({ customer: 'cus_1', coachId: COACH, priceId: 'price_1', base: 'https://koutsi.krossi.app', now: NOW, ...extra });

test('Checkout: a monthly subscription for this coach, back to Profiili', () => {
  const p = params();
  assert.equal(p.mode, 'subscription');
  assert.equal(p.customer, 'cus_1');
  assert.deepEqual(p.line_items, [{ price: 'price_1', quantity: 1 }]);
  assert.deepEqual(p.metadata, meta);
  assert.deepEqual(p.subscription_data, { metadata: meta });
  assert.equal(p.success_url, 'https://koutsi.krossi.app/valmentaja/profiili?tilaus=valmis');
  assert.equal(p.cancel_url, 'https://koutsi.krossi.app/valmentaja/profiili');
  assert.equal(p.locale, 'fi');
  assert.equal('discounts' in p, false);
  assert.deepEqual(params({ coupon: 'KOUTSI_ALKU' }).discounts, [{ coupon: 'KOUTSI_ALKU' }]);
  // VAT on top once Roisku Media is VAT-liable (KOUTSI_TAX_RATE), together with the free trial
  const taxed = params({ taxRate: 'txr_1', trialEndsAt: '2027-01-29T12:00:00Z' });
  assert.deepEqual(taxed.subscription_data.default_tax_rates, ['txr_1']);
  assert.equal(taxed.subscription_data.trial_end, Date.parse('2027-01-29T12:00:00Z') / 1000);
  assert.equal('default_tax_rates' in params().subscription_data, false);
});

test('Checkout inside the free trial: the first charge comes when the trial ends', () => {
  const end = '2027-01-29T12:00:00Z';
  assert.equal(params({ trialEndsAt: end }).subscription_data.trial_end, Date.parse(end) / 1000);
  // Stripe takes a trial_end only 48 h ahead: with less left, whole trial days instead, so the first
  // charge still never comes before the trial ends (tilausehdot)
  const short = params({ trialEndsAt: '2026-10-31T10:00:00Z' }).subscription_data; // 46 h left
  assert.equal('trial_end' in short, false);
  assert.equal(short.trial_period_days, 2);
  assert.equal(params({ trialEndsAt: '2026-10-29T13:00:00Z' }).subscription_data.trial_period_days, 1, 'an hour left');
  for (const over of ['2026-10-20T12:00:00Z', '2026-10-29T12:00:00Z', null]) {
    const data = params({ trialEndsAt: over }).subscription_data;
    assert.equal('trial_end' in data || 'trial_period_days' in data, false, `no trial left: ${over}`);
  }
  // Stripe's longest trial is 730 days: Checkout would fail, so the caller says so before
  assert.deepEqual(stripeTrial('2028-11-05T12:00:00Z', NOW), { tooFar: true }, '738 days');
  assert.throws(() => params({ trialEndsAt: '2028-11-05T12:00:00Z' }));
  assert.equal(stripeTrial('2028-10-23T12:00:00Z', NOW).trialEnd, Date.parse('2028-10-23T12:00:00Z') / 1000, '725 days is fine');
});

test("a Koutsi checkout can never unlock Krossi: none of the fields Krossi's stripe-webhook reads", async () => {
  const p = params({ trialEndsAt: '2027-01-29T12:00:00Z' });
  // Krossi's webhook: `session.client_reference_id || session.metadata?.supabase_user_id` + payment_status 'paid'
  // marks profiles.paid_at; payment intents with metadata.product 'krossi_unlock' do the same.
  assert.equal('client_reference_id' in p, false);
  assert.equal('supabase_user_id' in p.metadata, false);
  assert.equal('supabase_user_id' in p.subscription_data.metadata, false);
  assert.notEqual(p.metadata.product, 'krossi_unlock');
  // If Krossi's webhook starts reading something else, look at this again.
  const krossi = await readFile(join(root, 'supabase/functions/stripe-webhook/index.ts'), 'utf8');
  assert.match(krossi, /session\.client_reference_id \|\| session\.metadata\?\.supabase_user_id/);
  assert.match(krossi, /intent\.metadata\?\.product === 'krossi_unlock'/);
  assert.doesNotMatch(krossi, /koutsi/i, 'Krossi\'s webhook stays untouched');
});

test('back to the app it came from, else production', () => {
  assert.equal(returnBase('https://koutsi.krossi.app'), 'https://koutsi.krossi.app');
  assert.equal(returnBase('http://localhost:4500'), 'http://localhost:4500');
  assert.equal(returnBase('https://evil.example'), 'https://koutsi.krossi.app');
  assert.equal(returnBase(''), 'https://koutsi.krossi.app');
});

test('only objects marked as Koutsi with a coach id are Koutsi\'s', () => {
  assert.equal(koutsiCoachOf({ metadata: meta }), COACH);
  assert.equal(koutsiCoachOf({ metadata: { product: KOUTSI_PRODUCT, koutsi_coach_id: 'nope' } }), null);
  assert.equal(koutsiCoachOf({ metadata: { koutsi_coach_id: COACH } }), null);
  assert.equal(koutsiCoachOf({ metadata: { supabase_user_id: COACH } }), null);
  assert.equal(koutsiCoachOf(null), null);
});

test('the webhook acts on Koutsi subscriptions only', () => {
  const ev = (type, object) => ({ type, data: { object } });
  assert.equal(subscriptionIdOf(ev('checkout.session.completed', { mode: 'subscription', metadata: meta, subscription: 'sub_1' })), 'sub_1');
  assert.equal(subscriptionIdOf(ev('checkout.session.completed', { mode: 'subscription', metadata: meta, subscription: { id: 'sub_2' } })), 'sub_2');
  // Krossi's one-time payment, or any checkout without Koutsi's mark
  assert.equal(subscriptionIdOf(ev('checkout.session.completed', { mode: 'payment', client_reference_id: COACH, metadata: { supabase_user_id: COACH } })), null);
  assert.equal(subscriptionIdOf(ev('checkout.session.completed', { mode: 'subscription', metadata: {} , subscription: 'sub_x' })), null);
  for (const type of ['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']) {
    assert.equal(subscriptionIdOf(ev(type, { id: 'sub_3', metadata: meta })), 'sub_3', type);
    assert.equal(subscriptionIdOf(ev(type, { id: 'sub_4', metadata: {} })), null, type);
  }
  assert.equal(subscriptionIdOf(ev('payment_intent.succeeded', { id: 'pi_1', metadata: { product: 'krossi_booking' } })), null);
  assert.equal(subscriptionIdOf(ev('invoice.paid', { subscription: 'sub_3', metadata: meta })), null);
  assert.equal(subscriptionIdOf({}), null);
});

test('what a subscription writes into the coach\'s plan', () => {
  const sub = {
    id: 'sub_1', status: 'trialing', customer: 'cus_1', metadata: meta, cancel_at_period_end: false,
    current_period_end: Date.parse('2027-01-29T12:00:00Z') / 1000, created: 1,
  };
  assert.deepEqual(applyArgs(sub), {
    p_coach: COACH, p_customer: 'cus_1', p_subscription: 'sub_1', p_status: 'trialing',
    p_period_end: '2027-01-29T12:00:00.000Z', p_cancel_at_period_end: false,
  });
  // newer API versions keep the period on the item; an expanded customer; cancel_at
  const newer = { ...sub, current_period_end: undefined, customer: { id: 'cus_9' }, cancel_at: 1800000000, items: { data: [{ current_period_end: 1800000000 }] } };
  const args = applyArgs(newer);
  assert.equal(args.p_customer, 'cus_9');
  assert.equal(args.p_period_end, new Date(1800000000 * 1000).toISOString());
  assert.equal(args.p_cancel_at_period_end, true);
  assert.equal(applyArgs({ ...sub, metadata: {} }), null);
});

test("the customer's subscription that counts: the newest live one, else the newest", () => {
  const s = (id, status, created, m = meta) => ({ id, status, created, metadata: m });
  assert.equal(pickSubscription([s('a', 'canceled', 3), s('b', 'active', 2), s('c', 'past_due', 1)]).id, 'b');
  assert.equal(pickSubscription([s('a', 'canceled', 1), s('b', 'incomplete_expired', 2)]).id, 'b');
  assert.equal(pickSubscription([s('x', 'active', 9, {}), s('a', 'canceled', 1)]).id, 'a', 'not Koutsi\'s: ignored');
  assert.equal(pickSubscription([]), null);
  assert.equal(pickSubscription(undefined), null);
});

test('the price a coach sees, with a founding-customer offer while it lasts', () => {
  const price = { unit_amount: 2900, recurring: { interval: 'month' } };
  assert.deepEqual(priceInfo(price), { cents: 2900, interval: 'month', offer: null, vat: null, year: null });
  const coupon = { valid: true, duration: 'repeating', duration_in_months: 12, amount_off: 1000, max_redemptions: 10, times_redeemed: 3 };
  assert.deepEqual(priceInfo(price, coupon), { cents: 2900, interval: 'month', offer: { cents: 1900, months: 12 }, vat: null, year: null });
  // the yearly price, when one is set up (KOUTSI_PRICE_YEAR_ID)
  const year = { unit_amount: 29000, recurring: { interval: 'year' }, active: true };
  assert.deepEqual(priceInfo(price, null, null, year).year, { cents: 29000 });
  assert.equal(priceInfo(price, null, null, { ...year, active: false }).year, null);
  assert.equal(priceInfo(price, null, null, { ...year, recurring: { interval: 'month' } }).year, null);
  // VAT: only an active rate added on top
  const rate = { active: true, inclusive: false, percentage: 25.5 };
  assert.equal(priceInfo(price, null, rate).vat, 25.5);
  assert.equal(priceInfo(price, null, { ...rate, active: false }).vat, null);
  assert.equal(priceInfo(price, null, { ...rate, inclusive: true }).vat, null);
  assert.deepEqual(priceInfo(price, { ...coupon, amount_off: undefined, percent_off: 50 }).offer, { cents: 1450, months: 12 });
  assert.equal(priceInfo(price, { ...coupon, times_redeemed: 10 }).offer, null, 'all taken');
  assert.equal(priceInfo(price, { ...coupon, valid: false }).offer, null);
  assert.equal(priceInfo(price, { ...coupon, duration: 'forever' }).offer, null);
  // the setup script stretches the coupon over the free trial and keeps the promised paid months in metadata
  assert.deepEqual(priceInfo(price, { ...coupon, duration_in_months: 15, metadata: { koutsi_kk: '12' } }).offer, { cents: 1900, months: 12 });
  assert.equal(priceInfo(null), null);
});

// ── the founding offer ─────────────────────────────────────────────────────

const BASE = 'KOUTSI_ALKU_1000_12KK_10';
const baseCoupon = (extra = {}) => ({
  id: BASE, object: 'coupon', valid: true, name: 'Koutsi aloitustarjous', amount_off: 1000, currency: 'eur', percent_off: null,
  duration: 'repeating', duration_in_months: 15, max_redemptions: 10, times_redeemed: 0, redeem_by: null,
  applies_to: { products: ['krossi_koutsi_valmentaja'] }, metadata: { koutsi_kk: '12' }, ...extra,
});

/** Enough of Stripe for the founding coupon and open Checkout sessions. */
function fakeStripe({ coupons = [], sessions = [] } = {}) {
  const store = new Map(coupons.map((c) => [c.id, { ...c }]));
  const calls = [];
  const err = (code) => Object.assign(new Error(code), { code });
  return {
    calls, store,
    coupons: {
      async retrieve(id, opts) { calls.push(['retrieve', id, opts]); if (!store.has(id)) throw err('resource_missing'); return { ...store.get(id) }; },
      async list({ limit, starting_after: after }) {
        const all = [...store.values()];
        const from = after ? all.findIndex((c) => c.id === after) + 1 : 0;
        calls.push(['list', after || null]);
        return { data: all.slice(from, from + limit), has_more: from + limit < all.length };
      },
      async create(params) {
        calls.push(['create', params]);
        if (store.has(params.id)) throw err('resource_already_exists');
        const made = { object: 'coupon', valid: true, times_redeemed: 0, ...params };
        store.set(params.id, made);
        return made;
      },
    },
    checkout: {
      sessions: {
        async list(q) { calls.push(['sessions.list', q]); return { data: sessions.filter((x) => x.customer === q.customer && x.status === q.status) }; },
        async expire(id) {
          calls.push(['expire', id]);
          const x = sessions.find((y) => y.id === id);
          if (x.completeNow) throw err('checkout_session_completed');
          x.status = 'expired';
          return x;
        },
      },
    },
  };
}

/** Calendar months like Stripe's billing: the anchor's day, or the month's last day when it is shorter. */
function addMonths(ms, n) {
  const d = new Date(ms);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  t.setUTCDate(Math.min(d.getUTCDate(), new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()));
  return t.getTime();
}

test('whole calendar months between two moments', () => {
  const at = (iso) => Date.parse(iso);
  assert.equal(wholeMonths(at('2026-10-30T12:00:00Z'), at('2027-01-29T12:00:00Z')), 2);
  assert.equal(wholeMonths(at('2026-10-30T12:00:00Z'), at('2027-01-30T12:00:00Z')), 3);
  assert.equal(wholeMonths(at('2026-10-30T12:00:00Z'), at('2026-11-29T23:00:00Z')), 0);
  assert.equal(wholeMonths(at('2027-01-31T08:00:00Z'), at('2027-02-28T08:00:00Z')), 1, 'a short month clamps');
  assert.equal(wholeMonths(at('2026-10-30T12:00:00Z'), at('2026-10-29T12:00:00Z')), 0);
});

test('the founding coupon lasts so that exactly the promised paid months are discounted, whatever the trial', () => {
  // Stripe: invoices at the trial's end and monthly after it; a repeating coupon counts its months from the
  // day the subscription is made. Count the discounted invoices for many coaches.
  const offer = 12;
  const starts = ['2026-10-29T12:00:00Z', '2026-11-30T09:15:00Z', '2027-01-31T18:00:00Z', '2027-02-14T06:00:00Z'];
  for (const start of starts) {
    for (const trialMonths of [3, 6, 12]) {
      const trialEndsAt = new Date(addMonths(Date.parse(start), trialMonths)).toISOString();
      const end = Date.parse(trialEndsAt);
      const moments = [0, 1, 17, 45, 89, 120, 200, 400].map((day) => Date.parse(start) + day * 86400000 + 3600000)
        .concat([1, 30, 47, 50, 24 * 40].map((hoursLeft) => end - hoursLeft * 3600000)); // and just before its end
      for (const now of moments) {
        const dayOfTrial = Math.round((now - Date.parse(start)) / 86400000);
        const trial = stripeTrial(trialEndsAt, now);
        const months = foundingMonths(offer, trial, now);
        const firstCharge = trial.trialEnd ? trial.trialEnd * 1000 : trial.trialDays ? now + trial.trialDays * 86400000 : now;
        const discountEnds = addMonths(now, months);
        let discounted = 0;
        for (let k = 0; k < 40; k += 1) if (addMonths(firstCharge, k) < discountEnds) discounted += 1;
        assert.equal(discounted, offer, `trial ${trialMonths} kk from ${start}, day ${dayOfTrial}: ${months} months`);
      }
    }
  }
  // the default trial taken on its first day: the configured coupon's own 15 months
  const now = Date.parse('2026-10-29T12:00:00Z');
  assert.equal(foundingMonths(12, stripeTrial('2027-01-29T12:30:00Z', now), now), 15);
  assert.equal(foundingMonths(12, {}, now), 12, 'after the trial');
  assert.equal(foundingMonths(0, {}, now), 0);
});

test('founding places are counted over the configured coupon and the copies made from it', async () => {
  const others = Array.from({ length: 150 }, (_, i) => ({ id: `MUU_${i}`, times_redeemed: 50 }));
  const stripe = fakeStripe({ coupons: [
    ...others.slice(0, 70), baseCoupon({ times_redeemed: 3 }), ...others.slice(70),
    { id: `${BASE}_14KK`, times_redeemed: 4 }, { id: `${BASE}_9KK`, times_redeemed: 2 },
    { id: `${BASE}_X`, times_redeemed: 9 }, { id: 'KOUTSI_ALKU_1000_12KK_1', times_redeemed: 9 },
  ] });
  const base = await foundingCoupon(stripe, BASE);
  assert.equal(base.times_redeemed, 9, '3 + 4 + 2, over two pages');
  assert.equal(foundingLeft(base), 1);
  assert.deepEqual(stripe.calls[0], ['retrieve', BASE, { expand: ['applies_to'] }]);
  assert.equal(priceInfo({ unit_amount: 2900 }, base).offer.months, 12);
  // the last place taken through a copy: no offer shown, no coupon at checkout
  stripe.store.get(`${BASE}_9KK`).times_redeemed = 3;
  const full = await foundingCoupon(stripe, BASE);
  assert.equal(foundingLeft(full), 0);
  assert.equal(priceInfo({ unit_amount: 2900 }, full).offer, null);
  assert.equal(await foundingCouponFor(stripe, full, 14), null);
  // no coupon configured, or Stripe doesn't have it
  assert.equal(await foundingCoupon(stripe, ''), null);
  assert.equal(await foundingCoupon(stripe, 'EI_OLE'), null);
  assert.equal(isFoundingCoupon(`${BASE}_14KK`, BASE), true);
  assert.equal(isFoundingCoupon(`${BASE}0_14KK`, BASE), false);
  assert.equal(isFoundingCoupon('KOUTSI_ALKU_1000_12KK_1', BASE), false);
});

test('a checkout gets the configured coupon when its length fits, else a copy made once', async () => {
  const stripe = fakeStripe({ coupons: [baseCoupon()] });
  const base = await foundingCoupon(stripe, BASE);
  assert.equal(offerMonths(base), 12);
  assert.equal(await foundingCouponFor(stripe, base, 15), BASE);
  assert.equal(stripe.calls.some(([c]) => c === 'create'), false);
  assert.equal(await foundingCouponFor(stripe, base, 23), `${BASE}_23KK`);
  const created = stripe.calls.find(([c]) => c === 'create')[1];
  assert.deepEqual(created, {
    id: `${BASE}_23KK`, name: 'Koutsi aloitustarjous', amount_off: 1000, currency: 'eur', duration: 'repeating', duration_in_months: 23,
    max_redemptions: 10, applies_to: { products: ['krossi_koutsi_valmentaja'] }, metadata: { koutsi_kk: '12', koutsi_base: BASE },
  });
  // the next coach with the same trial left reuses it
  assert.equal(await foundingCouponFor(stripe, base, 23), `${BASE}_23KK`);
  assert.equal(stripe.calls.filter(([c]) => c === 'create').length, 1);
  // a percentage coupon copies the percentage, no currency
  const pct = fakeStripe({ coupons: [baseCoupon({ amount_off: null, currency: null, percent_off: 40, applies_to: null, name: null })] });
  const pctBase = await foundingCoupon(pct, BASE);
  assert.equal(await foundingCouponFor(pct, pctBase, 12), `${BASE}_12KK`);
  const made = pct.calls.find(([c]) => c === 'create')[1];
  assert.equal(made.percent_off, 40);
  assert.equal('currency' in made || 'amount_off' in made || 'applies_to' in made || 'name' in made, false);
  // two checkouts at once: the second create finds it made
  const race = fakeStripe({ coupons: [baseCoupon()] });
  const raceBase = await foundingCoupon(race, BASE);
  const realRetrieve = race.coupons.retrieve;
  race.coupons.retrieve = async (id, opts) => {
    if (id === `${BASE}_18KK`) { race.store.set(id, { id, valid: true }); throw Object.assign(new Error('missing'), { code: 'resource_missing' }); }
    return realRetrieve(id, opts);
  };
  assert.equal(await foundingCouponFor(race, raceBase, 18), `${BASE}_18KK`);
  // an offer that is not on gives nothing
  assert.equal(await foundingCouponFor(stripe, { ...base, valid: false }, 15), null);
  assert.equal(await foundingCouponFor(stripe, null, 15), null);
});

test('the webhook writes the best of the coach\'s subscriptions, not the cancelled duplicate', () => {
  const s = (id, status, created, m = meta) => ({ id, status, created, metadata: m, customer: 'cus_1' });
  const live = s('sub_live', 'active', 1);
  const dup = s('sub_dup', 'canceled', 2);
  assert.deepEqual(bestSubscription(dup, [live, dup]), { sub: live, live: 1 });
  assert.deepEqual(bestSubscription(live, [live, dup]), { sub: live, live: 1 });
  // two live ones: the newest, and the count tells the coach pays twice
  const second = s('sub_2', 'trialing', 3);
  assert.deepEqual(bestSubscription(live, [live, second]), { sub: second, live: 2 });
  // another coach's subscription on the same customer, or Krossi's, never counts
  const other = s('sub_x', 'active', 9, { product: KOUTSI_PRODUCT, koutsi_coach_id: '00000000-0000-4000-8000-0000000000c9' });
  assert.deepEqual(bestSubscription(dup, [dup, other, s('sub_k', 'active', 9, {})]), { sub: dup, live: 0 });
  assert.equal(bestSubscription(s('sub_k', 'active', 1, {}), []), null);
  assert.deepEqual(bestSubscription(dup, undefined), { sub: dup, live: 0 });
});

test('a new checkout expires the coach\'s Checkout sessions still open', async () => {
  const sessions = [
    { id: 'cs_1', customer: 'cus_1', status: 'open', mode: 'subscription', metadata: meta },
    { id: 'cs_2', customer: 'cus_1', status: 'open', mode: 'subscription', metadata: meta, completeNow: true },
    { id: 'cs_3', customer: 'cus_1', status: 'open', mode: 'payment', metadata: { product: 'krossi_unlock' } },
    { id: 'cs_4', customer: 'cus_2', status: 'open', mode: 'subscription', metadata: meta },
    { id: 'cs_5', customer: 'cus_1', status: 'complete', mode: 'subscription', metadata: meta },
  ];
  const stripe = fakeStripe({ sessions });
  assert.equal(await expireOpenCheckouts(stripe, 'cus_1'), 1);
  assert.deepEqual(stripe.calls.filter(([c]) => c === 'expire').map(([, id]) => id), ['cs_1', 'cs_2'], 'Koutsi\'s open ones only');
  assert.deepEqual(sessions.map((x) => x.status), ['expired', 'open', 'open', 'open', 'complete']);
});
