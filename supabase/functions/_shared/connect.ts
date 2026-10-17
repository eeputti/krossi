// _shared/connect.ts — a hall's connected Stripe account as booking_venues stores it, the same in
// krossi-connect (status, after onboarding) and stripe-webhook (account.updated).
import type Stripe from 'npm:stripe@17.7.0';

/**
 * The booking_venues columns for a connected account. stripe_charges_enabled = the hall takes
 * payments: Stripe lets the account charge (card_payments, needed for on_behalf_of) and receive
 * transfers.
 */
export function accountState(account: Pick<Stripe.Account, 'charges_enabled' | 'payouts_enabled' | 'details_submitted' | 'capabilities'>) {
  return {
    stripe_charges_enabled: Boolean(account.charges_enabled) && account.capabilities?.transfers === 'active',
    stripe_payouts_enabled: Boolean(account.payouts_enabled),
    stripe_details_submitted: Boolean(account.details_submitted),
    stripe_checked_at: new Date().toISOString(),
  };
}
