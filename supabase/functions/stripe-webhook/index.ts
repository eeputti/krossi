// Marks a profile as paid once Stripe confirms the one-time checkout succeeded.
// Signature verification (not a Supabase JWT) is the auth here, since Stripe calls
// this endpoint directly — the function must be deployed with verify_jwt disabled.
//
// Also confirms court bookings (payment_intent.succeeded with metadata.product 'krossi_booking',
// paid in krossi-booking) and records a friend's share of a split booking (metadata.product
// 'krossi_split_share', metadata.split_share_id). The shared functions in ../_shared/booking.ts do
// what krossi-booking does: a payment whose court went to somebody else meanwhile ('lost') or that
// paid an already paid booking is refunded, and so is a share payment the split can't take any
// more — with the same idempotency keys as krossi-booking, so a payment is never refunded twice. A
// confirmed booking refunds the on-sale bookings it took over; a paid share's amount goes back to
// the booker before this answers 200, so Stripe retries the event when that refund fails.
//
// Phase 2 (krossi-billing): series cards, gift cards and saldo top-ups (metadata.product
// 'krossi_pass' / 'krossi_gift' / 'krossi_topup') are recorded with krossi_wallet_order_paid
// (activates the pass, issues the gift card's code, puts the top-up on the saldo) — an order already paid by another
// payment is refunded (key `krossi-order-refund-<intent>`, same as krossi-billing) — and a monthly
// kausivuoro charge ('krossi_season') is recorded with krossi_billing_charge_result, also when it
// fails (payment_intent.payment_failed).
//
// Stripe Connect: account.updated of a hall's connected account (sent to a Connect endpoint, signed
// with STRIPE_CONNECT_WEBHOOK_SECRET) refreshes the hall's stripe_charges_enabled /
// _payouts_enabled / _details_submitted, so a hall Stripe restricts stops taking payments at once.
// krossi-connect's status action refreshes the same columns whenever the hall's settings are opened,
// so the Connect endpoint is optional. Refunds keep Krossi's fee (../_shared/fees.ts).
//
// Saldo (../_shared/saldo.ts): a refund of a top-up back to its card that fails after Stripe took
// it (charge.refund.updated / refund.updated with status 'failed', metadata.saldo_refund_id) puts
// the sum back on the player's saldo (krossi_saldo_refund_failed, once). Needs those events on
// Krossi's endpoint.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17.7.0';
import { BOOKING_PRODUCT, SPLIT_PRODUCT, afterBookingPaid, refundBooker, settleBookingPayment, settleSplitPayment } from '../_shared/booking.ts';
import { accountState } from '../_shared/connect.ts';
import { refundConnect } from '../_shared/fees.ts';
import { TOPUP_PRODUCT } from '../_shared/saldo.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

const ORDER_PRODUCTS: Record<string, 'pass' | 'gift' | 'topup'> = { krossi_pass: 'pass', krossi_gift: 'gift', [TOPUP_PRODUCT]: 'topup' };
const SEASON_PRODUCT = 'krossi_season';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Confirms the booking a succeeded payment belongs to; throws when it should be retried. */
async function settleBooking(admin: SupabaseClient, intent: Stripe.PaymentIntent) {
  const bookingId = intent.metadata?.booking_id ?? '';
  if (!UUID_RE.test(bookingId)) {
    console.error('booking payment without a booking id', intent.id);
    return;
  }
  let outcome;
  try {
    outcome = await settleBookingPayment(stripe, admin, intent);
  } catch (err) {
    // A booking this database doesn't have (e.g. a test-mode event of another environment):
    // nothing to confirm, and retrying won't change that. The money is not touched.
    if (/Varausta ei löytynyt/.test((err as Error).message)) {
      console.error('booking payment for an unknown booking', intent.id, bookingId);
      return;
    }
    throw err;
  }
  // The booking is confirmed either way; refunds it owes are retried by krossi-booking-cron.
  if (outcome === 'confirmed') await afterBookingPaid(stripe, admin, bookingId);
}

/**
 * Records a friend's share payment and gives its amount back to the booker; throws when it should
 * be retried (the share stays recorded, so a retry only finishes the refund).
 */
async function settleSplit(admin: SupabaseClient, intent: Stripe.PaymentIntent) {
  const bookingId = intent.metadata?.booking_id ?? '';
  const shareId = intent.metadata?.split_share_id ?? '';
  if (!UUID_RE.test(bookingId) || !UUID_RE.test(shareId)) {
    console.error('share payment without a booking or share id', intent.id);
    return;
  }
  let settled;
  try {
    settled = await settleSplitPayment(stripe, admin, intent);
  } catch (err) {
    // A booking this database doesn't have (another environment): the money is not touched.
    if (/Varausta ei löytynyt/.test((err as Error).message)) {
      console.error('share payment for an unknown booking', intent.id, bookingId);
      return;
    }
    throw err;
  }
  if (settled.outcome === 'paid' && settled.bookerRefund) await refundBooker(stripe, admin, settled.bookerRefund);
}

/** A paid series card / gift card order (same as krossi-billing's settleOrder). Throws to be retried. */
async function settleOrder(admin: SupabaseClient, intent: Stripe.PaymentIntent, kind: 'pass' | 'gift' | 'topup') {
  const orderId = intent.metadata?.order_id ?? '';
  if (!UUID_RE.test(orderId)) {
    console.error('order payment without an order id', intent.id);
    return;
  }
  const { data: outcome, error } = await admin.rpc('krossi_wallet_order_paid', {
    kind_input: kind, order_id_input: orderId, payment_intent_id_input: intent.id, amount_input: intent.amount,
  });
  if (error) {
    if (/Tilausta ei löytynyt/.test(error.message)) {
      console.error('order payment for an unknown order', intent.id, orderId);
      return;
    }
    throw new Error(`krossi_wallet_order_paid failed: ${error.message}`);
  }
  if (outcome === 'duplicate') {
    const params: Stripe.RefundCreateParams = {
      payment_intent: intent.id, metadata: { product: intent.metadata?.product ?? '', order_id: orderId }, ...refundConnect(intent),
    };
    try {
      await stripe.refunds.create(params, { idempotencyKey: `krossi-order-refund-${intent.id}` });
    } catch (err) {
      if ((err as { code?: string }).code !== 'charge_already_refunded') throw err;
    }
  }
}

/** A monthly kausivuoro charge succeeded or failed (krossi-billing records it too; this is the backup). */
async function settleSeasonCharge(admin: SupabaseClient, intent: Stripe.PaymentIntent, succeeded: boolean) {
  const chargeId = intent.metadata?.charge_id ?? '';
  if (!UUID_RE.test(chargeId)) return;
  const message = succeeded ? null : (intent.last_payment_error?.message ? 'Veloitus epäonnistui: ' + intent.last_payment_error.message : 'Veloitus epäonnistui.');
  const { error } = await admin.rpc('krossi_billing_charge_result', {
    charge_id_input: chargeId, payment_intent_id_input: intent.id, succeeded_input: succeeded, failure_message_input: message,
  });
  if (error && !/Veloitusta ei löytynyt/.test(error.message)) throw new Error(`krossi_billing_charge_result failed: ${error.message}`);
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const signature = req.headers.get('Stripe-Signature');
  const body = await req.text();
  if (!signature) return new Response('missing signature', { status: 400 });

  // Krossi's own endpoint, or the Connect endpoint for the halls' accounts (its own secret).
  let event: Stripe.Event | null = null;
  let failure = '';
  for (const secret of [Deno.env.get('STRIPE_WEBHOOK_SECRET'), Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET')]) {
    if (!secret || event) continue;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, secret, undefined, cryptoProvider);
    } catch (err) {
      failure = failure || (err as Error).message;
    }
  }
  if (!event) return new Response(`signature verification failed: ${failure}`, { status: 400 });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // Idempotenssi: sama Stripe-tapahtuma ei saa merkitä maksua kahdesti (Stripe voi lähettää sen uudelleen).
  const { error: seenError } = await admin.from('stripe_events').insert({ id: event.id });
  if (seenError) return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });

  // Hallin Stripe-tili muuttui (Connect): maksut päälle / pois sen mukaan, mitä Stripe sallii.
  if (event.type === 'account.updated') {
    const account = event.data.object as Stripe.Account;
    const { error } = await admin.from('booking_venues').update(accountState(account)).eq('stripe_account_id', account.id);
    if (error) {
      console.error('hall account update failed', account.id, error.message);
      await admin.from('stripe_events').delete().eq('id', event.id);
      return new Response('hall account update failed', { status: 500 });
    }
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  // Saldon palautus kortille epäonnistui jälkikäteen: summa takaisin saldoon.
  if (event.type === 'charge.refund.updated' || (event.type as string) === 'refund.updated') {
    const refund = event.data.object as Stripe.Refund;
    const rowId = refund.metadata?.saldo_refund_id ?? '';
    if (refund.status === 'failed' && refund.metadata?.product === TOPUP_PRODUCT && UUID_RE.test(rowId)) {
      const { error } = await admin.rpc('krossi_saldo_refund_failed', { refund_id_input: rowId, stripe_refund_id_input: refund.id });
      if (error) {
        console.error('saldo refund failure update failed', rowId, error.message);
        await admin.from('stripe_events').delete().eq('id', event.id);
        return new Response('saldo refund update failed', { status: 500 });
      }
    }
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  // Sarja- ja lahjakortit, saldon lataukset, kausivuorojen kuukausiveloitukset (krossi-billing).
  if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object as Stripe.PaymentIntent;
    const product = intent.metadata?.product ?? '';
    const orderKind = ORDER_PRODUCTS[product];
    if (orderKind || product === SEASON_PRODUCT) {
      try {
        if (product === SEASON_PRODUCT) await settleSeasonCharge(admin, intent, event.type === 'payment_intent.succeeded');
        else if (event.type === 'payment_intent.succeeded') await settleOrder(admin, intent, orderKind);
      } catch (err) {
        console.error('billing update failed', (err as Error).message);
        await admin.from('stripe_events').delete().eq('id', event.id);
        return new Response('billing update failed', { status: 500 });
      }
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }
  }

  // Kenttävaraus ja jaetun vuoron osuudet (krossi-booking) — erillään avausmaksusta alla.
  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object as Stripe.PaymentIntent;
    const product = intent.metadata?.product;
    if (product === BOOKING_PRODUCT || product === SPLIT_PRODUCT) {
      try {
        if (product === BOOKING_PRODUCT) await settleBooking(admin, intent);
        else await settleSplit(admin, intent);
      } catch (err) {
        console.error('booking update failed', (err as Error).message);
        // Forget the event so Stripe's retry gets another go instead of being skipped as a duplicate.
        await admin.from('stripe_events').delete().eq('id', event.id);
        return new Response('booking update failed', { status: 500 });
      }
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }
  }

  // Who paid: hosted Checkout (stripe-checkout) or the in-app checkout (krossi-payment).
  let paid: { userId: string; customerId: string | null; intent?: Stripe.PaymentIntent } | null = null;
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.client_reference_id || session.metadata?.supabase_user_id;
    if (userId && session.payment_status === 'paid') {
      paid = { userId, customerId: (typeof session.customer === 'string' ? session.customer : session.customer?.id) ?? null };
    }
  } else if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object as Stripe.PaymentIntent;
    const userId = intent.metadata?.supabase_user_id;
    if (userId && intent.metadata?.product === 'krossi_unlock') {
      paid = { userId, customerId: (typeof intent.customer === 'string' ? intent.customer : intent.customer?.id) ?? null, intent };
    }
  }

  if (paid) {
    // First payment wins: a late or repeated event never moves paid_at.
    const { error } = await admin.from('profiles').update({
      paid_at: new Date().toISOString(),
      ...(paid.customerId ? { stripe_customer_id: paid.customerId } : {}),
    }).eq('id', paid.userId).is('paid_at', null);
    if (error) {
      console.error('paid_at update failed', error.message);
      // Forget the event so Stripe's retry gets another go instead of being skipped as a duplicate.
      await admin.from('stripe_events').delete().eq('id', event.id);
      return new Response('paid_at update failed', { status: 500 });
    }
    // Same stamp as krossi-payment's applyPayment: this payment has now unlocked the profile once.
    if (paid.intent && !paid.intent.metadata?.applied_at) {
      try {
        await stripe.paymentIntents.update(paid.intent.id, { metadata: { applied_at: new Date().toISOString() } });
      } catch (err) {
        console.error('applied_at stamp failed', (err as Error).message);
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
