// The coach's subscription in words (domain/subscription.js) and the demo's trial.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkoutChoices, keyWelcome, daysLeft, fmtDay, fmtEuros, mapStatus, NO_SUBSCRIPTION, planCard, priceLine, yearLine, yearSaving } from '../src/domain/subscription.js';
import { backend as demo, configureDemo } from '../src/api/demo/index.js';

const NOW = new Date('2026-10-29T12:00:00Z');
const base = { ...NO_SUBSCRIPTION, ready: true, selfServe: true };

test('the database row becomes the status; a missing row is "ready, nothing"', () => {
  assert.deepEqual(mapStatus({
    self_serve: true, plan: 'trial', trial_ends_at: '2027-01-29T12:00:00Z', stripe_status: null, period_end: null,
    cancel_at_period_end: false, has_customer: false,
  }), {
    ready: true, selfServe: true, plan: 'trial', trialEndsAt: '2027-01-29T12:00:00Z', stripeStatus: null, periodEnd: null,
    cancelAtPeriodEnd: false, hasCustomer: false,
  });
  assert.equal(mapStatus(null).ready, true);
  assert.equal(mapStatus(null).plan, null);
  assert.equal(NO_SUBSCRIPTION.ready, false);
});

test('days, dates and euros', () => {
  assert.equal(daysLeft('2026-11-08T12:00:00Z', NOW), 10);
  assert.equal(daysLeft('2026-10-29T13:00:00Z', NOW), 1, 'a started day counts');
  assert.equal(daysLeft('2026-10-28T12:00:00Z', NOW), 0);
  assert.equal(daysLeft(null, NOW), 0);
  assert.equal(fmtDay('2027-01-29T12:00:00Z'), '29.1.2027');
  assert.equal(fmtDay(null), '');
  assert.equal(fmtEuros(2900), '29 €');
  assert.equal(fmtEuros(1990), '19,90 €');
  assert.equal(fmtEuros(905), '9,05 €');
  assert.equal(priceLine(null), '');
  assert.equal(priceLine({ cents: 2900, interval: 'month', offer: null }), '29 €/kk');
  assert.equal(priceLine({ cents: 2900, interval: 'month', offer: { cents: 1900, months: 12 } }), '19 €/kk 12 kk, sitten 29 €/kk');
  // once Roisku Media is VAT-liable (tilausehdot §3): VAT on top
  assert.equal(priceLine({ cents: 2900, interval: 'month', offer: null, vat: 25.5 }), '29 €/kk + alv');
  assert.equal(priceLine({ cents: 2900, interval: 'month', offer: { cents: 1900, months: 12 }, vat: 25.5 }), '19 €/kk 12 kk, sitten 29 €/kk + alv');
});

test('nothing shows before the database has it, for a free coach or for someone who is not a coach', () => {
  assert.equal(planCard(NO_SUBSCRIPTION, null, NOW), null);
  assert.equal(planCard({ ...base, plan: 'free' }, { cents: 2900 }, NOW), null);
  assert.equal(planCard({ ...base, plan: null }, null, NOW), null);
  assert.equal(planCard(null, null, NOW), null);
});

test('the trial: days left, the end date, Ota tilaus, no key question (the key is used)', () => {
  const trial = { ...base, plan: 'trial', trialEndsAt: '2027-01-13T12:00:00Z' };
  const card = planCard(trial, null, NOW);
  assert.equal(card.title, 'Kokeilua jäljellä 76 pv');
  assert.equal(card.text, 'Kokeilu päättyy 13.1.2027.');
  assert.equal(card.action, 'checkout');
  assert.equal(card.label, 'Ota tilaus');
  assert.equal(card.code, false);
  assert.equal(planCard(trial, { cents: 2900, offer: null }, NOW).text, 'Kokeilu päättyy 13.1.2027.');
  assert.equal(planCard({ ...trial, trialEndsAt: '2026-10-30T08:00:00Z' }, null, NOW).title, 'Kokeilua jäljellä 1 päivä');
});

test('a subscription: next charge, first charge after the trial, ending, Hallitse tilausta', () => {
  const active = { ...base, plan: 'active', stripeStatus: 'active', periodEnd: '2026-11-29T12:00:00Z', hasCustomer: true };
  let card = planCard(active, null, NOW);
  assert.equal(card.title, 'Tilaus voimassa');
  assert.equal(card.text, 'Seuraava veloitus 29.11.2026.');
  assert.equal(card.action, 'portal');
  assert.equal(card.label, 'Hallitse tilausta');
  card = planCard({ ...active, stripeStatus: 'trialing', periodEnd: '2027-01-13T12:00:00Z' }, null, NOW);
  assert.equal(card.text, 'Ensimmäinen veloitus 13.1.2027, kun kokeilu päättyy.');
  card = planCard({ ...active, cancelAtPeriodEnd: true }, null, NOW);
  assert.equal(card.text, 'Päättyy 29.11.2026. Voit jatkaa tilausta ennen sitä.');
});

test('a failed payment asks for a new card; an ended trial or subscription offers the subscription', () => {
  const late = planCard({ ...base, plan: 'past_due', stripeStatus: 'past_due', hasCustomer: true }, null, NOW);
  assert.deepEqual([late.tone, late.title, late.action, late.label], ['warn', 'Maksu ei mennyt läpi', 'portal', 'Päivitä maksutapa']);
  const trialOver = planCard({ ...base, plan: 'ended', trialEndsAt: '2026-10-20T12:00:00Z' }, { cents: 2900 }, NOW);
  assert.deepEqual([trialOver.title, trialOver.text, trialOver.action], ['Kokeilu päättyi', 'Päättyi 20.10.2026. Pelaajille lähettäminen vaatii tilauksen (29 €/kk).', 'checkout']);
  const subOver = planCard({ ...base, plan: 'ended', stripeStatus: 'canceled', periodEnd: '2026-10-25T12:00:00Z', trialEndsAt: '2026-08-01T12:00:00Z' }, null, NOW);
  assert.deepEqual([subOver.title, subOver.text], ['Tilaus päättyi', 'Päättyi 25.10.2026. Pelaajille lähettäminen vaatii tilauksen.']);
});

test('demo: Anna is on the free trial; paying is for the real app', async () => {
  configureDemo({ role: 'coach', latency: 0 });
  const s = await demo.subscription.status();
  assert.equal(s.ready, true);
  assert.equal(s.plan, 'trial');
  assert.equal(daysLeft(s.trialEndsAt), 76);
  assert.deepEqual(await demo.subscription.price(), { cents: 2900, interval: 'month', offer: null, vat: null, year: { cents: 29000 } });
  const used = await demo.subscription.useCode('Avain12');
  assert.equal(used.kind, 'code');
  assert.equal(used.months, 12);
  assert.ok(daysLeft(used.trialEndsAt) >= 364);
  await assert.rejects(async () => demo.subscription.checkout(), /demossa/);
  await assert.rejects(async () => demo.subscription.portal(), /demossa/);
  assert.deepEqual(await demo.coach.fetchRow('demo-coach'), { id: 'demo-coach' }, 'the trial gate is a dev-only preview');
});

test('month or year: the yearly price, what it saves, only when there is one', () => {
  const month = { cents: 2900, interval: 'month', offer: null, vat: null, year: null };
  assert.deepEqual(checkoutChoices(month), [{ interval: 'month', title: 'Kuukausi', sub: '29 €/kk' }]);
  const both = { ...month, year: { cents: 29000 } };
  assert.equal(yearLine(both), '290 €/v');
  assert.equal(yearSaving(both), 5800);
  assert.deepEqual(checkoutChoices(both), [
    { interval: 'month', title: 'Kuukausi', sub: '29 €/kk' },
    { interval: 'year', title: 'Vuosi', sub: '290 €/v, säästät 58 €' },
  ]);
  assert.equal(yearLine({ ...both, vat: 25.5 }), '290 €/v + alv');
  assert.deepEqual(checkoutChoices({ ...both, offer: { cents: 1900, months: 12 } })[0].sub, '19 €/kk 12 kk, sitten 29 €/kk');
  assert.deepEqual(checkoutChoices(null), [{ interval: 'month', title: 'Kuukausi', sub: 'Kuukausittain' }]);
  for (const c of checkoutChoices({ ...both, vat: 25.5 })) assert.doesNotMatch(c.sub, /·/);
});

test('a valmentaja-avain: the card offers it after the trial (not during it: that key is used), and the surprise says what it gave', () => {
  const trial = { ...base, plan: 'trial', trialEndsAt: '2027-01-13T12:00:00Z' };
  assert.equal(planCard(trial, null, NOW).code, false);
  assert.equal(planCard({ ...base, plan: 'ended', trialEndsAt: '2026-10-20T12:00:00Z' }, null, NOW).code, true);
  assert.equal(planCard({ ...base, plan: 'active', periodEnd: '2026-11-29T12:00:00Z' }, null, NOW).code, undefined);
  // the surprise: a key that gives more months, or free use; an old key just lets the coach in
  assert.deepEqual(keyWelcome({ kind: 'code', months: 12, plan: 'trial', trialEndsAt: '2027-10-30T12:00:00Z' }),
    { title: 'Sait 12 kk ilmaisen kokeilun!', text: 'Kokeilu jatkuu 30.10.2027 asti.' });
  assert.deepEqual(keyWelcome({ kind: 'code', months: null, plan: 'free' }), { title: 'Koutsi on sinulle maksuton!', text: '' });
  assert.equal(keyWelcome({ kind: 'key', plan: 'free' }), null);
  assert.equal(keyWelcome(null), null);
});
