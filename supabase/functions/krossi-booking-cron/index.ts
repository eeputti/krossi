// krossi-booking-cron — kenttävarauksen keskeneräiset palautukset (krossi.app/pelaa/varaa).
//
// Called every five minutes by the pg_cron job 'krossi-booking-tasks', which runs
// public.krossi_dispatch_booking_tasks() (migration 20261017124658_krossi_booking_tasks_cron).
// Never called by a browser: deploy with verify_jwt = false. The only way in is the
// x-krossi-cron-key header, checked against the Vault secret 'krossi_cron_key' (shared with
// krossi-reminders) through public.krossi_cron_key_valid().
//
// It finishes refunds that Stripe didn't take when they were first tried — the app and
// stripe-webhook do them at once, this only catches what is left (a Stripe hiccup, a series card
// or gift balance purchase that sold an on-sale booking without a webhook behind it):
//   1. A friend's paid share whose amount hasn't gone back to the booker yet
//      (krossi_split_refunds_due → refundBooker, key `krossi-split-booker-refund-<share>`).
//   2. A cancellation or a sale whose refunds stalled (krossi_booking_refunds_due → refundParts):
//      what is left of the booker's payment and every friend's paid share. A sale's seller is told
//      once (krossi-notify throttles a repeat).
//   3. A saldo refund to a card that Stripe didn't take when the player asked (krossi_saldo_refunds_due
//      → refundSaldo, key `krossi-saldo-refund-<row>`; one refused for good goes back on the saldo).
//   4. A guest's confirmation mail (a court booked without an account) that wasn't sent when the
//      payment was recorded (krossi_guest_mails_due → mailGuestConfirmed, once per booking).
// The idempotency keys are the ones krossi-booking, krossi-billing and stripe-webhook use, so nothing is refunded twice.
//
// Body: { "type": "booking_tasks" }. Response: { bookerRefunded, refunded, saldoRefunded, guestMailed, errors }.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17.7.0';
import { type BookerRefund, notifyInternal, refundBooker, refundParts } from '../_shared/booking.ts';
import { type SaldoRefund, refundSaldo } from '../_shared/saldo.ts';
import { mailGuestConfirmed } from '../_shared/guestMail.ts';

const MAX_CRON_KEY_LENGTH = 256;
const BATCH = 50;

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

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

  const counts = { bookerRefunded: 0, refunded: 0, saldoRefunded: 0, guestMailed: 0, errors: 0 };

  const { data: shares, error: sharesError } = await admin.rpc('krossi_split_refunds_due', { limit_input: BATCH });
  if (sharesError) {
    console.error('krossi-booking-cron: share refunds due failed', sharesError.message);
    counts.errors += 1;
  }
  for (const due of (Array.isArray(shares) ? shares : []) as BookerRefund[]) {
    try {
      if (await refundBooker(stripe, admin, due)) counts.bookerRefunded += 1;
    } catch (err) {
      counts.errors += 1;
      console.error('krossi-booking-cron: refunding a share to the booker failed', due.shareId, (err as Error).message);
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
      if (item.resold) await notifyInternal(admin, { type: 'booking_resold', bookingId: item.bookingId });
    } catch (err) {
      counts.errors += 1;
      console.error('krossi-booking-cron: refunds failed', item.bookingId, (err as Error).message);
    }
  }

  const { data: saldo, error: saldoError } = await admin.rpc('krossi_saldo_refunds_due', { limit_input: BATCH });
  if (saldoError) {
    console.error('krossi-booking-cron: saldo refunds due failed', saldoError.message);
    counts.errors += 1;
  } else {
    const done = await refundSaldo(stripe, admin, (Array.isArray(saldo) ? saldo : []) as SaldoRefund[]);
    counts.saldoRefunded += done.refunded;
    counts.errors += done.left;
  }

  const { data: mails, error: mailsError } = await admin.rpc('krossi_guest_mails_due', { limit_input: BATCH });
  if (mailsError) {
    console.error('krossi-booking-cron: guest mails due failed', mailsError.message);
    counts.errors += 1;
  }
  for (const bookingId of (Array.isArray(mails) ? mails : []) as string[]) {
    if (await mailGuestConfirmed(admin, bookingId)) counts.guestMailed += 1;
    else counts.errors += 1;
  }

  return json(counts);
});
