// subscriptionMail.test.mjs — the coach's e-mails about the Koutsi subscription
// (supabase/functions/_shared/subscriptionMail.ts, sent by koutsi-stripe-webhook): which Stripe event
// mails what, and what the mail says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDay, fmtEuros, renderSubscriptionEmail, subscriptionFacts, subscriptionMailKind } from '../../../supabase/functions/_shared/subscriptionMail.ts';

const t = (iso) => Date.parse(iso) / 1000;
// A coach with a 6 kk key who subscribed on 30.10.2026: trialing until 30.4.2027 (23.59 in Finland),
// the founding coupon lasts 6 + 12 months (Stripe API 2024-06-20 shape)
const trialing = {
  id: 'sub_1', status: 'trialing', trial_end: t('2027-04-30T20:59:14Z'), current_period_end: t('2027-04-30T20:59:14Z'),
  cancel_at_period_end: false, cancel_at: null, default_tax_rates: [],
  items: { data: [{ price: { unit_amount: 2900, recurring: { interval: 'month' } } }] },
  discount: { coupon: { amount_off: 1000, duration: 'repeating', duration_in_months: 18, metadata: { koutsi_kk: '12' } }, end: t('2028-04-30T20:59:14Z') },
  metadata: { product: 'koutsi_subscription', koutsi_coach_id: 'c1' },
};
const cancelled = { ...trialing, cancel_at_period_end: true };
const active = { ...trialing, status: 'active', trial_end: null, current_period_end: t('2026-11-30T10:00:00Z') };
const event = (type, object, previous_attributes) => ({ id: 'evt_1', type, livemode: true, data: { object, ...(previous_attributes ? { previous_attributes } : {}) } });

test('which event mails what', () => {
  const session = { mode: 'subscription', status: 'complete', subscription: 'sub_1' };
  assert.equal(subscriptionMailKind(event('checkout.session.completed', session), trialing), 'started');
  assert.equal(subscriptionMailKind(event('checkout.session.completed', session), { ...trialing, status: 'incomplete' }), null, 'not paid yet');
  assert.equal(subscriptionMailKind(event('checkout.session.completed', { ...session, mode: 'payment' }), trialing), null);
  assert.equal(subscriptionMailKind(event('customer.subscription.created', trialing), trialing), null, 'the checkout mails the start');

  // Hallitse tilausta → Peru (the portal cancels at the period's end), and back
  assert.equal(subscriptionMailKind(event('customer.subscription.updated', cancelled, { cancel_at_period_end: false }), cancelled), 'cancelled');
  assert.equal(subscriptionMailKind(event('customer.subscription.updated', trialing, { cancel_at_period_end: true }), trialing), 'resumed');
  // newer API versions say it with cancel_at
  const at = { ...trialing, cancel_at: t('2027-04-30T20:59:14Z') };
  assert.equal(subscriptionMailKind(event('customer.subscription.updated', at, { cancel_at: null }), at), 'cancelled');
  // a late event that no longer holds: no mail
  assert.equal(subscriptionMailKind(event('customer.subscription.updated', cancelled, { cancel_at_period_end: false }), trialing), null, 'already resumed');
  assert.equal(subscriptionMailKind(event('customer.subscription.updated', trialing, { cancel_at_period_end: true }), cancelled), null, 'cancelled again');

  const pastDue = { ...active, status: 'past_due' };
  assert.equal(subscriptionMailKind(event('customer.subscription.updated', pastDue, { status: 'active' }), pastDue), 'payment_failed');
  assert.equal(subscriptionMailKind(event('customer.subscription.updated', active, { status: 'trialing' }), active), null, 'the trial ended and the charge went through');
  assert.equal(subscriptionMailKind(event('customer.subscription.updated', active, { items: {} }), active), null, 'a plan switch');

  const ended = (reason) => ({ ...active, status: 'canceled', cancellation_details: { reason } });
  assert.equal(subscriptionMailKind(event('customer.subscription.deleted', ended('payment_failed')), ended('payment_failed')), 'ended_unpaid');
  assert.equal(subscriptionMailKind(event('customer.subscription.deleted', ended('cancellation_requested')), ended('cancellation_requested')), null, 'cancelled earlier or account deleted');
});

test('the start inside a trial: free until the trial ends, then 19 € for 12 months, then 29 €', () => {
  const f = subscriptionFacts(trialing);
  assert.deepEqual({ next: fmtDay(f.nextAt), cents: f.nextCents, months: f.offer.months }, { next: '30.4.2027', cents: 1900, months: 12 });
  const { subject, text, html } = renderSubscriptionEmail('started', trialing, { name: 'Eelis' });
  assert.equal(subject, 'Koutsi-tilauksesi on voimassa');
  assert.match(text, /^Hei Eelis,/);
  assert.match(text, /Ilmainen kokeilusi jatkuu 30\.4\.2027 asti\. Sinulta ei veloiteta mitään ennen sitä\./);
  assert.match(text, /Hinta: 19 €\/kk 12 kuukautta, sitten 29 €\/kk/);
  assert.match(text, /Ensimmäinen veloitus: 30\.4\.2027, 19 €/);
  assert.match(text, /Myyjä: Roisku Media \(Y-tunnus 3413406-6\)/);
  assert.match(text, /Profiili → Tilaus → Hallitse tilausta/);
  assert.match(text, /https:\/\/koutsi\.krossi\.app\/tilausehdot/);
  assert.match(html, /href="https:\/\/koutsi\.krossi\.app\/valmentaja\/profiili"/);
});

test('the start without a trial, a year, VAT on top', () => {
  const now = renderSubscriptionEmail('started', active).text;
  assert.match(now, /^Hei!/);
  assert.match(now, /Maksu on vastaanotettu/);
  assert.match(now, /Seuraava veloitus: 30\.11\.2026, 19 €/);
  const year = { ...active, discount: null, items: { data: [{ price: { unit_amount: 29000, recurring: { interval: 'year' } } }] } };
  assert.match(renderSubscriptionEmail('started', year).text, /Hinta: 290 €\/v\n/);
  assert.match(renderSubscriptionEmail('started', year).text, /vuositilaus/);
  const vat = { ...active, default_tax_rates: [{ percentage: 25.5, inclusive: false }] };
  assert.match(renderSubscriptionEmail('started', vat).text, /sitten 29 €\/kk \+ alv 25,5 %/);
  assert.match(renderSubscriptionEmail('started', vat).text, /30\.11\.2026, 23,85 €/);
  // the offer over: the full price
  const over = { ...active, current_period_end: t('2028-05-30T10:00:00Z') };
  assert.match(renderSubscriptionEmail('started', over).text, /30\.5\.2028, 29 €/);
});

test('cancelled, resumed, failed, ended: what each says', () => {
  const c = renderSubscriptionEmail('cancelled', cancelled).text;
  assert.match(c, /Sinulta ei veloiteta mitään\. Kokeilusi jatkuu 30\.4\.2027 asti\./);
  assert.match(c, /pelaajasi pitävät kaiken/);
  assert.match(renderSubscriptionEmail('cancelled', { ...active, cancel_at_period_end: true }).text, /Sinulta ei veloiteta enää\. Tilauksesi on voimassa 30\.11\.2026 asti\./);
  assert.match(renderSubscriptionEmail('resumed', trialing).text, /Kokeilusi jatkuu 30\.4\.2027 asti, ja ensimmäinen veloitus on silloin: 19 €\./);
  assert.match(renderSubscriptionEmail('resumed', active).text, /Seuraava veloitus on 30\.11\.2026: 19 €\./);
  const failed = renderSubscriptionEmail('payment_failed', { ...active, status: 'past_due' });
  assert.equal(failed.subject, 'Koutsin veloitus ei onnistunut');
  assert.match(failed.text, /Päivitä maksutapa: https:\/\/koutsi\.krossi\.app\/valmentaja\/profiili/);
  assert.match(renderSubscriptionEmail('ended_unpaid', active).text, /päättyi, koska veloitus ei onnistunut/);
});

test('a test-mode event says TESTI; names are escaped; no middle dots', () => {
  assert.equal(renderSubscriptionEmail('started', trialing, { test: true }).subject, 'TESTI: Koutsi-tilauksesi on voimassa');
  assert.match(renderSubscriptionEmail('started', trialing, { name: '<b>' }).html, /Hei &lt;b&gt;,/);
  for (const kind of ['started', 'cancelled', 'resumed', 'payment_failed', 'ended_unpaid']) {
    const { subject, text, html } = renderSubscriptionEmail(kind, trialing, { name: 'Eelis' });
    for (const s of [subject, text, html]) assert.doesNotMatch(s, /·/, kind);
  }
  assert.equal(fmtEuros(1990), '19,90 €');
  assert.equal(fmtDay(null), '');
});
