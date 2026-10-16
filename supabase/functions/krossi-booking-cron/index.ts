// krossi-booking-cron — kenttävarauksen ajastetut tehtävät (krossi.app/pelaa/varaa).
//
// Called every five minutes by the pg_cron job 'krossi-booking-tasks', which runs
// public.krossi_dispatch_booking_tasks() (migration 20261016130100_krossi_booking_tasks_cron).
// Never called by a browser: deploy with verify_jwt = false. The only way in is the
// x-krossi-cron-key header, checked against the Vault secret 'krossi_cron_key' (shared with
// krossi-reminders) through public.krossi_cron_key_valid().
//
// What it does:
//   1. Jaettu maksu: krossi_booking_due_rests() turns the friend shares still unpaid at a split
//      booking's deadline into the booker's rest share; each one is charged here off-session to
//      the card the booker saved when booking. The idempotency key
//      `krossi-booking-rest-<share>` makes a repeated attempt (a run that died half-way is handed
//      out again after 15 minutes) return the same charge instead of a second one.
//        succeeded   recorded at once (krossi_booking_share_mark_paid, same as stripe-webhook)
//        processing  the payment is stored on the share; stripe-webhook records it when it lands
//        declined    krossi_booking_rest_failed keeps Stripe's reason, and krossi-notify emails the
//                    booker (booking_rest_failed): they pay the rest in the app, and the hall's
//                    day view shows it as unpaid until then
//      A Stripe outage leaves the share claimed but unanswered, so it comes back in 15 minutes.
//   2. Refunds a cancellation or a sale left unfinished (krossi_booking_refunds_due) are done.
//
// Body: { "type": "booking_tasks" }. Response: { charged, pending, failed, refunded, errors }.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17.7.0';
import {
  SHARE_PRODUCT, connectParams, describeBooking, loadBooking, loadPlace, loadVenue, notifyInternal, refundParts,
  settleSharePayment,
} from '../_shared/booking.ts';

const MAX_CRON_KEY_LENGTH = 256;
const BATCH = 50;

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface DueRest {
  shareId: string;
  bookingId: string;
  userId: string | null;
  cents: number;
  paymentMethodId: string | null;
}

async function failRest(admin: SupabaseClient, rest: DueRest, code: string) {
  const { error } = await admin.rpc('krossi_booking_rest_failed', { share_id_input: rest.shareId, error_input: code });
  if (error) throw new Error(`krossi_booking_rest_failed failed: ${error.message}`);
  await notifyInternal(admin, { type: 'booking_rest_failed', shareId: rest.shareId });
}

/** Charges one rest share to the booker's saved card. → 'charged' | 'pending' | 'failed' */
async function chargeRest(admin: SupabaseClient, rest: DueRest): Promise<'charged' | 'pending' | 'failed'> {
  const booking = await loadBooking(admin, rest.bookingId);
  if (!booking || !rest.userId) throw new Error(`rest ${rest.shareId} has no booking or booker`);
  const { data: profile, error } = await admin.from('profiles').select('stripe_customer_id').eq('id', rest.userId).maybeSingle();
  if (error) throw new Error(`profile lookup failed: ${error.message}`);
  if (!rest.paymentMethodId || !profile?.stripe_customer_id) {
    await failRest(admin, rest, 'no_card');
    return 'failed';
  }
  const [venue, place, booker] = await Promise.all([
    loadVenue(admin, booking.venue_id), loadPlace(admin, booking.court_id), admin.auth.admin.getUserById(rest.userId),
  ]);
  const params: Stripe.PaymentIntentCreateParams = {
    amount: rest.cents,
    currency: 'eur',
    customer: profile.stripe_customer_id,
    payment_method: rest.paymentMethodId,
    off_session: true,
    confirm: true,
    description: `Loppuosuus: ${describeBooking(booking, venue, place)}`,
    receipt_email: booker.data?.user?.email || undefined,
    metadata: {
      product: SHARE_PRODUCT, share_id: rest.shareId, booking_id: booking.id, venue_id: booking.venue_id,
      supabase_user_id: rest.userId, charge: 'off_session',
    },
    ...connectParams(venue, rest.cents),
  };
  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.create(params, { idempotencyKey: `krossi-booking-rest-${rest.shareId}` });
  } catch (err) {
    const stripeError = err as { type?: string; code?: string; decline_code?: string };
    // The card (or the saved payment method) said no: tell the booker. Anything else — Stripe
    // down, rate limits — is tried again in 15 minutes with the same idempotency key.
    if (stripeError.type === 'StripeCardError' || stripeError.type === 'StripeInvalidRequestError') {
      await failRest(admin, rest, stripeError.decline_code || stripeError.code || 'failed');
      return 'failed';
    }
    throw err;
  }
  if (intent.status === 'succeeded') {
    await settleSharePayment(stripe, admin, intent);
    return 'charged';
  }
  const { error: storeError } = await admin.from('booking_shares')
    .update({ stripe_payment_intent_id: intent.id }).eq('id', rest.shareId).is('stripe_payment_intent_id', null);
  if (storeError) throw new Error(`storing the rest payment failed: ${storeError.message}`);
  return 'pending';
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const key = req.headers.get('x-krossi-cron-key') ?? '';
  if (!key || key.length > MAX_CRON_KEY_LENGTH) return json({ error: 'Unauthorized.' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { data: valid, error: keyError } = await admin.rpc('krossi_cron_key_valid', { key_input: key });
  if (keyError) {
    console.error('krossi-booking-cron: key check failed', keyError.message);
    return json({ error: 'Key check failed.' }, 500);
  }
  if (valid !== true) return json({ error: 'Unauthorized.' }, 401);

  const counts = { charged: 0, pending: 0, failed: 0, refunded: 0, errors: 0 };

  const { data: due, error: dueError } = await admin.rpc('krossi_booking_due_rests', { limit_input: BATCH });
  if (dueError) {
    console.error('krossi-booking-cron: due rests failed', dueError.message);
    counts.errors += 1;
  }
  for (const rest of (Array.isArray(due) ? due : []) as DueRest[]) {
    try {
      counts[await chargeRest(admin, rest)] += 1;
    } catch (err) {
      counts.errors += 1;
      console.error('krossi-booking-cron: rest charge failed', rest.shareId, (err as Error).message);
    }
  }

  const { data: refunds, error: refundsError } = await admin.rpc('krossi_booking_refunds_due', { limit_input: BATCH });
  if (refundsError) {
    console.error('krossi-booking-cron: refunds due failed', refundsError.message);
    counts.errors += 1;
  }
  for (const item of (Array.isArray(refunds) ? refunds : []) as { bookingId: string; resold: boolean }[]) {
    try {
      await refundParts(stripe, admin, item.bookingId);
      counts.refunded += 1;
      // A sale's seller hears about it once (krossi-notify throttles a repeat).
      if (item.resold) await notifyInternal(admin, { type: 'booking_resold', bookingId: item.bookingId });
    } catch (err) {
      counts.errors += 1;
      console.error('krossi-booking-cron: refunds failed', item.bookingId, (err as Error).message);
    }
  }

  return json(counts);
});
