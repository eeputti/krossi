// Marks a profile as paid once Stripe confirms the one-time checkout succeeded.
// Signature verification (not a Supabase JWT) is the auth here, since Stripe calls
// this endpoint directly — the function must be deployed with verify_jwt disabled.
//
// Also confirms court bookings (payment_intent.succeeded with metadata.product
// 'krossi_booking', paid in krossi-booking): krossi_booking_mark_paid confirms the booking, and
// a payment whose court went to somebody else meanwhile ('lost') or that paid an already paid
// booking ('duplicate') is refunded — with the same idempotency key as krossi-booking, so a
// payment is never refunded twice.
//
// Phase 2 (krossi-billing): series cards and gift cards (metadata.product 'krossi_pass' /
// 'krossi_gift') are activated with krossi_wallet_order_paid — an order already paid by another
// payment is refunded (key `krossi-order-refund-<intent>`, same as krossi-billing) — and a monthly
// kausivuoro charge ('krossi_season') is recorded with krossi_billing_charge_result, also when it
// fails (payment_intent.payment_failed).
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17.7.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

const BOOKING_PRODUCT = 'krossi_booking';
const ORDER_PRODUCTS: Record<string, 'pass' | 'gift'> = { krossi_pass: 'pass', krossi_gift: 'gift' };
const SEASON_PRODUCT = 'krossi_season';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same refund as krossi-booking's refundIntent (same params and idempotency key). */
async function refundBookingIntent(intent: Stripe.PaymentIntent, bookingId: string): Promise<Stripe.Refund> {
  const params: Stripe.RefundCreateParams = {
    payment_intent: intent.id,
    metadata: { product: BOOKING_PRODUCT, booking_id: bookingId },
  };
  if (intent.transfer_data?.destination) params.reverse_transfer = true;
  if (intent.application_fee_amount) params.refund_application_fee = true;
  try {
    return await stripe.refunds.create(params, { idempotencyKey: `krossi-booking-refund-${intent.id}` });
  } catch (err) {
    if ((err as { code?: string }).code === 'charge_already_refunded') {
      const { data } = await stripe.refunds.list({ payment_intent: intent.id, limit: 1 });
      if (data[0]) return data[0];
    }
    throw err;
  }
}

/** Confirms the booking a succeeded payment belongs to; throws when it should be retried. */
async function settleBooking(admin: SupabaseClient, intent: Stripe.PaymentIntent) {
  const bookingId = intent.metadata?.booking_id ?? '';
  if (!UUID_RE.test(bookingId)) {
    console.error('booking payment without a booking id', intent.id);
    return;
  }
  const { data: outcome, error } = await admin.rpc('krossi_booking_mark_paid', {
    booking_id_input: bookingId,
    payment_intent_id_input: intent.id,
    amount_input: intent.amount,
  });
  if (error) {
    // A booking this database doesn't have (e.g. a test-mode event of another environment):
    // nothing to confirm, and retrying won't change that. The money is not touched.
    if (/Varausta ei löytynyt/.test(error.message)) {
      console.error('booking payment for an unknown booking', intent.id, bookingId);
      return;
    }
    throw new Error(`krossi_booking_mark_paid failed: ${error.message}`);
  }
  if (outcome !== 'lost' && outcome !== 'duplicate') return;
  const refund = await refundBookingIntent(intent, bookingId);
  if (outcome === 'lost') {
    const { error: cancelError } = await admin.rpc('krossi_booking_mark_cancelled', {
      booking_id_input: bookingId,
      refunded_input: true,
      refund_id_input: refund.id,
      by_input: null,
    });
    if (cancelError) throw new Error(`krossi_booking_mark_cancelled failed: ${cancelError.message}`);
  }
}

/** A paid series card / gift card order (same as krossi-billing's settleOrder). Throws to be retried. */
async function settleOrder(admin: SupabaseClient, intent: Stripe.PaymentIntent, kind: 'pass' | 'gift') {
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
    const params: Stripe.RefundCreateParams = { payment_intent: intent.id, metadata: { product: intent.metadata?.product ?? '', order_id: orderId } };
    if (intent.transfer_data?.destination) params.reverse_transfer = true;
    if (intent.application_fee_amount) params.refund_application_fee = true;
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

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!,
      undefined,
      cryptoProvider,
    );
  } catch (err) {
    return new Response(`signature verification failed: ${(err as Error).message}`, { status: 400 });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // Idempotenssi: sama Stripe-tapahtuma ei saa merkitä maksua kahdesti (Stripe voi lähettää sen uudelleen).
  const { error: seenError } = await admin.from('stripe_events').insert({ id: event.id });
  if (seenError) return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });

  // Sarja- ja lahjakortit, kausivuorojen kuukausiveloitukset (krossi-billing).
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

  // Kenttävaraus (krossi-booking) — erillään avausmaksusta alla.
  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object as Stripe.PaymentIntent;
    if (intent.metadata?.product === BOOKING_PRODUCT) {
      try {
        await settleBooking(admin, intent);
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
