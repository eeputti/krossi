// koutsiPay.test.mjs — the pure parts of the koutsi-pay edge function (supabase/functions/_shared/koutsiPay.ts),
// run in Node as they are (type stripping): where the payer comes back to, what Stripe Checkout gets,
// and when a Checkout session counts as paid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appBase, checkoutParams, isAllowedOrigin, paidFromSession, payStatus, periodLabel, SESSION_RE, UUID_RE,
} from '../../../supabase/functions/_shared/koutsiPay.ts';

const TOKEN = '00000000-0000-4000-8000-000000000003';
const INVOICE = '11111111-1111-4111-8111-111111111111';

test('appBase: our own origins, else the real app', () => {
  assert.equal(appBase('https://koutsi.krossi.app'), 'https://koutsi.krossi.app');
  assert.equal(appBase('https://demo.koutsi.krossi.app'), 'https://demo.koutsi.krossi.app');
  assert.equal(appBase('http://localhost:4500'), 'http://localhost:4500');
  assert.equal(appBase('https://evil.example'), 'https://koutsi.krossi.app');
  assert.equal(appBase(null), 'https://koutsi.krossi.app');
  assert.ok(!isAllowedOrigin('https://krossi.app.evil.example'));
  assert.ok(UUID_RE.test(TOKEN) && !UUID_RE.test('abc'));
  assert.ok(SESSION_RE.test('cs_live_a1B2c3D4e5F6g7H8i9J0') && !SESSION_RE.test('cs_') && !SESSION_RE.test('pi_123456789'));
});

test('checkoutParams: one line for the invoice total, back to the invoice page', () => {
  const p = checkoutParams({
    invoiceId: INVOICE, number: 7, totalCents: 25200, sellerName: 'Anna Virtanen Tennis', period: periodLabel('2026-11-01', '2026-11-30'),
    payerEmail: 'sari@example.test', token: TOKEN, base: 'https://koutsi.krossi.app',
  });
  assert.equal(p.mode, 'payment');
  assert.deepEqual(p.line_items, [{ quantity: 1, price_data: { currency: 'eur', unit_amount: 25200, product_data: { name: 'Lasku 7', description: 'Anna Virtanen Tennis · 1.11.2026–30.11.2026' } } }]);
  assert.equal(p.success_url, `https://koutsi.krossi.app/lasku/${TOKEN}?maksu={CHECKOUT_SESSION_ID}`);
  assert.equal(p.cancel_url, `https://koutsi.krossi.app/lasku/${TOKEN}`);
  assert.equal(p.customer_email, 'sari@example.test');
  assert.equal(p.locale, 'fi');
  assert.deepEqual(p.metadata, { koutsi_invoice_id: INVOICE, koutsi_invoice_number: '7' });
  assert.equal(p.payment_intent_data.metadata.koutsi_invoice_id, INVOICE);
  assert.equal(p.payment_method_types, undefined, 'the coach chooses the payment methods in Stripe');
  const bare = checkoutParams({ invoiceId: INVOICE, number: 8, totalCents: 1000, sellerName: 'A', period: '', payerEmail: null, token: TOKEN, base: 'http://localhost:4500' });
  assert.equal('customer_email' in bare, false);
  assert.deepEqual(bare.line_items[0].price_data.product_data, { name: 'Lasku 8', description: 'A' });
});

test('paidFromSession: this invoice, paid, the full amount', () => {
  const session = { id: 'cs_1', payment_status: 'paid', metadata: { koutsi_invoice_id: INVOICE }, payment_intent: 'pi_1', amount_total: 25200 };
  assert.deepEqual(paidFromSession(session, INVOICE, 25200), { matches: true, paid: true, paymentIntent: 'pi_1' });
  assert.equal(paidFromSession({ ...session, payment_status: 'unpaid' }, INVOICE, 25200).paid, false);
  assert.equal(paidFromSession({ ...session, metadata: { koutsi_invoice_id: 'other' } }, INVOICE, 25200).paid, false, 'another invoice\'s session');
  assert.equal(paidFromSession({ ...session, amount_total: 100 }, INVOICE, 25200).paid, false, 'not the full amount');
  assert.equal(paidFromSession({ ...session, payment_intent: { id: 'pi_2' } }, INVOICE, 25200).paymentIntent, 'pi_2');
  assert.equal(paidFromSession({}, INVOICE, 25200).paid, false);
});

test('payStatus and periodLabel', () => {
  assert.deepEqual(payStatus({ stripe_account_id: null, stripe_charges_enabled: false, stripe_details_submitted: false, pay_online: true }),
    { state: 'none', chargesEnabled: false, detailsSubmitted: false, payOnline: true, dueCount: 0 });
  assert.equal(payStatus({ stripe_account_id: 'acct_1', stripe_charges_enabled: false, stripe_details_submitted: true, pay_online: true }, 2).state, 'pending');
  assert.equal(payStatus({ stripe_account_id: 'acct_1', stripe_charges_enabled: true, stripe_details_submitted: true, pay_online: false }).state, 'ready');
  assert.equal(periodLabel('2026-09-14', '2026-10-14'), '14.9.2026–14.10.2026');
  assert.equal(periodLabel(null, '2026-10-14'), '');
});
