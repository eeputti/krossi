// _shared/saldo.ts — hallikohtainen saldo's card refunds, shared by krossi-billing (the player asks
// for the unused top-ups back), krossi-booking-cron (retries) and stripe-webhook (a refund that
// failed afterwards).
//
// The saldo itself lives in the database (booking_credit_events, migration
// 20261017190000_krossi_booking_saldo): a top-up (metadata.product 'krossi_topup') is an order
// paid like a gift card (krossi-billing orderIntent: a destination charge to the hall, Krossi's fee
// from fees.ts), and bookings and friends' shares paid from the saldo move no money through Stripe.
//
// Only top-ups go back to a card, each to the payment that topped it up, newest first, within
// 180 days; free for 14 days, then a round 1 € that stays with the hall (krossi_saldo_refund_plan
// works it out, krossi_saldo_refund_claim takes it off the saldo at once). Here each claimed row is
// refunded from its top-up's payment: reverse_transfer takes the money back from the hall, and
// Krossi keeps its fee as on every refund (fees.ts). The idempotency key is the row
// (`krossi-saldo-refund-<row>`), so the app, the cron and a retry refund it once. A refund Stripe
// refuses for good puts the row's sum back on the saldo (krossi_saldo_refund_failed); a passing
// Stripe hiccup leaves it due for krossi-booking-cron.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type Stripe from 'npm:stripe@17.7.0';
import { refundConnect } from './fees.ts';

export const TOPUP_PRODUCT = 'krossi_topup';

/** A claimed refund row (krossi_saldo_refund_claim / krossi_saldo_refunds_due). */
export interface SaldoRefund {
  id: string;
  paymentIntentId: string;
  cents: number;
  /** the palautuskulu kept on this row (claims only; 0 from the cron's list) */
  feeCents?: number;
  topupId: string;
}

/** Stripe said no for good (not an outage): the refund will never go through as asked. */
const refusedForGood = (err: unknown) => (err as { type?: string })?.type === 'StripeInvalidRequestError';

/**
 * Refunds claimed rows to their top-ups' cards and records each one. Never throws: a row Stripe
 * refuses for good goes back on the saldo, one it didn't take now stays due for the cron.
 * → { refunded, left } row counts and the rows that `failed` (their sums are back on the saldo).
 */
export async function refundSaldo(stripe: Stripe, admin: SupabaseClient, rows: SaldoRefund[]) {
  const counts = { refunded: 0, left: 0, failed: [] as SaldoRefund[] };
  for (const row of rows) {
    if (!(row.cents > 0)) continue;
    let refund: Stripe.Refund;
    try {
      const intent = await stripe.paymentIntents.retrieve(row.paymentIntentId);
      refund = await stripe.refunds.create({
        payment_intent: intent.id,
        amount: row.cents,
        metadata: { product: TOPUP_PRODUCT, topup_id: row.topupId, saldo_refund_id: row.id },
        ...refundConnect(intent),
      }, { idempotencyKey: `krossi-saldo-refund-${row.id}` });
    } catch (err) {
      if ((err as { code?: string }).code === 'charge_already_refunded') {
        // Refunded by hand in the Dashboard already: the money is on the card, the saldo is off.
        console.error('saldo refund: the payment was refunded already', row.id);
        const { error } = await admin.rpc('krossi_saldo_refund_done', { refund_id_input: row.id, stripe_refund_id_input: null });
        if (error) console.error('krossi_saldo_refund_done failed', row.id, error.message);
        counts.refunded += 1;
      } else if (refusedForGood(err)) {
        console.error('saldo refund refused', row.id, (err as Error).message);
        const { error } = await admin.rpc('krossi_saldo_refund_failed', { refund_id_input: row.id, stripe_refund_id_input: null });
        if (error) {
          console.error('krossi_saldo_refund_failed failed', row.id, error.message);
          counts.left += 1;
        } else {
          counts.failed.push(row);
        }
      } else {
        console.error('saldo refund left due', row.id, (err as Error).message);
        counts.left += 1;
      }
      continue;
    }
    const { error } = await admin.rpc('krossi_saldo_refund_done', { refund_id_input: row.id, stripe_refund_id_input: refund.id });
    if (error) {
      console.error('krossi_saldo_refund_done failed', row.id, error.message);
      counts.left += 1;
    } else {
      counts.refunded += 1;
    }
  }
  return counts;
}
