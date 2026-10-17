// _shared/fees.ts — where the money of a court-booking payment goes (Stripe Connect), shared by
// krossi-booking, krossi-billing, stripe-webhook and krossi-connect so every payment and refund
// follows the same rules.
//
// The hall is the seller. A payment (a booking, a friend's share, a kausivuoro month, a series or
// gift card) is a destination charge on Krossi's Stripe account: on_behalf_of + transfer_data =
// the hall's connected Express account (krossi-connect onboards it), so the hall's name is on the
// player's statement and in MobilePay and the money goes to the hall. With destination charges
// Stripe takes its fee from KROSSI's balance, so Krossi's share (application_fee_amount) is
// Stripe's estimated cost of the payment plus Krossi's margin for the hall:
//
//   fee = ceil(amount × (STRIPE_COST.bps + platform_fee_bps) / 10 000)
//         + STRIPE_COST.fixedCents + platform_fee_fixed_cents            (never more than the amount)
//
// STRIPE_COST is a standard EEA card in Finland (1,5 % + 0,25 €, stripe.com/fi/pricing), MobilePay's
// own fee on top of it (≈ 0,11 €, billed daily) and Connect's 0,25 % of what is paid out to the hall.
// Premium EEA cards (2,8 %) and non-EEA cards (3,15 %) cost more: the margin has to cover that gap,
// and Connect's 2 € per active hall a month and 0,10 € per payout (the payouts are weekly). Keep the
// numbers in step with Stripe's price list; the hall sees them in Hallin asetukset → Verkkomaksut.
//
// Refunds (cancellations, a jaettu maksu share back to the booker, lost or duplicate payments):
// the money comes back from the hall (reverse_transfer) and the player gets all of it, but Krossi
// keeps its fee (no refund_application_fee): Stripe doesn't return its own fee on a refund, so
// returning Krossi's would make Krossi pay for the payment. A partial refund reverses the same
// share of the transfer.
//
// A hall without a ready account takes no online payments once it is public (HallNotConnected);
// a hidden hall without an account (only its staff and Krossi's admins see it) still charges on
// Krossi's own account, for testing before the hall is connected.
import type Stripe from 'npm:stripe@17.7.0';

/** Stripe's estimated cost of one payment (see above). */
export const STRIPE_COST = { bps: 175, fixedCents: 36 } as const;

export const HALL_NOT_CONNECTED = 'Hallin verkkomaksu ei ole vielä käytössä.';

/** The hall takes no online payments: it is public but its Stripe account isn't connected and ready. */
export class HallNotConnected extends Error {
  constructor() {
    super(HALL_NOT_CONNECTED);
  }
}

/** The booking_venues columns the money rules need. */
export interface PayeeVenue {
  is_public: boolean;
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
  platform_fee_bps: number;
  platform_fee_fixed_cents: number;
}

export const PAYEE_COLUMNS = 'is_public, stripe_account_id, stripe_charges_enabled, platform_fee_bps, platform_fee_fixed_cents';

/** Krossi's share of a payment of `amount` cents: Stripe's estimated cost + the hall's margin. */
export function platformFee(venue: Pick<PayeeVenue, 'platform_fee_bps' | 'platform_fee_fixed_cents'>, amount: number) {
  const bps = STRIPE_COST.bps + (venue.platform_fee_bps || 0);
  const fee = Math.ceil((amount * bps) / 10_000) + STRIPE_COST.fixedCents + (venue.platform_fee_fixed_cents || 0);
  return Math.min(amount, fee);
}

/** The hall's connected account can take payments. */
export const hallReady = (venue: PayeeVenue) => Boolean(venue.stripe_account_id && venue.stripe_charges_enabled);

/** Online payments are on: to the hall's ready account, or to Krossi's for a hidden hall not connected yet. */
export const takesPayments = (venue: PayeeVenue) => hallReady(venue) || (!venue.is_public && !venue.stripe_account_id);

/**
 * The Connect part of a PaymentIntent: the hall as the seller (on_behalf_of), its money
 * (transfer_data) and Krossi's fee. {} = Krossi's own account (a hidden hall not connected yet).
 * Throws HallNotConnected when the payment must not be made.
 *
 * `onBehalfOf: false` keeps Krossi as the merchant on the statement — for off-session charges of a
 * card saved on Krossi's account (kausivuoro months), so the card's issuer sees the same merchant
 * that set it up. The money still goes to the hall.
 */
export function connectParams(
  venue: PayeeVenue,
  amount: number,
  { onBehalfOf = true }: { onBehalfOf?: boolean } = {},
): Partial<Stripe.PaymentIntentCreateParams> {
  if (hallReady(venue)) {
    const account = venue.stripe_account_id as string;
    return {
      ...(onBehalfOf ? { on_behalf_of: account } : {}),
      transfer_data: { destination: account },
      application_fee_amount: platformFee(venue, amount),
    };
  }
  if (takesPayments(venue)) return {};
  throw new HallNotConnected();
}

/**
 * The Connect part of a refund of `intent`: the hall gives the money back (all of it, or the same
 * share of the transfer for a partial refund); Krossi's fee is kept (see above).
 */
export function refundConnect(intent: Pick<Stripe.PaymentIntent, 'transfer_data'>): Partial<Stripe.RefundCreateParams> {
  return intent.transfer_data?.destination ? { reverse_transfer: true } : {};
}
