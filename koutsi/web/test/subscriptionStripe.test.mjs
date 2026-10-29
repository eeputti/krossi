// Koutsi's Stripe pieces (supabase/functions/_shared/koutsiPlan.js, used by the edge functions
// koutsi-subscription and koutsi-stripe-webhook): the Checkout session, which events are Koutsi's,
// what a subscription writes — and that none of it can reach Krossi's stripe-webhook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyArgs, checkoutParams, koutsiCoachOf, KOUTSI_PRODUCT, pickSubscription, priceInfo, returnBase, subscriptionIdOf,
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
});

test('Checkout inside the free trial: the first charge comes when the trial ends', () => {
  const end = '2027-01-29T12:00:00Z';
  assert.equal(params({ trialEndsAt: end }).subscription_data.trial_end, Date.parse(end) / 1000);
  // Stripe wants at least 48 h: with less left, the charge is now
  assert.equal('trial_end' in params({ trialEndsAt: '2026-10-31T10:00:00Z' }).subscription_data, false);
  assert.equal('trial_end' in params({ trialEndsAt: '2026-10-20T12:00:00Z' }).subscription_data, false, 'trial already over');
  assert.equal('trial_end' in params({ trialEndsAt: null }).subscription_data, false);
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
  assert.deepEqual(priceInfo(price), { cents: 2900, interval: 'month', offer: null });
  const coupon = { valid: true, duration: 'repeating', duration_in_months: 12, amount_off: 1000, max_redemptions: 10, times_redeemed: 3 };
  assert.deepEqual(priceInfo(price, coupon), { cents: 2900, interval: 'month', offer: { cents: 1900, months: 12 } });
  assert.deepEqual(priceInfo(price, { ...coupon, amount_off: undefined, percent_off: 50 }).offer, { cents: 1450, months: 12 });
  assert.equal(priceInfo(price, { ...coupon, times_redeemed: 10 }).offer, null, 'all taken');
  assert.equal(priceInfo(price, { ...coupon, valid: false }).offer, null);
  assert.equal(priceInfo(price, { ...coupon, duration: 'forever' }).offer, null);
  assert.equal(priceInfo(null), null);
});
