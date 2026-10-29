// _shared/koutsiPay.ts — the pure parts of koutsi-pay (Laskutus): where the payer comes back to, what
// the Stripe Checkout page says, what the coach's payment costs, and when a Checkout session counts as
// paid. No Deno or npm imports (fees.ts imports only a type), so koutsi/web/test/koutsiPay.test.mjs runs
// it in Node as it is.
import { STRIPE_COST } from './fees.ts';

export const KOUTSI_APP = 'https://koutsi.krossi.app';
export const KOUTSI_ORIGINS = ['https://koutsi.krossi.app', 'https://demo.koutsi.krossi.app'];
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SESSION_RE = /^cs_[A-Za-z0-9_]{8,250}$/;

export const isLocalOrigin = (origin: string) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
export const isAllowedOrigin = (origin: string) => KOUTSI_ORIGINS.includes(origin) || isLocalOrigin(origin);

/** Where Stripe sends the payer and the coach back: the calling app's origin when it is ours. */
export function appBase(origin: string | null | undefined): string {
  const o = String(origin || '');
  return isAllowedOrigin(o) ? o : KOUTSI_APP;
}

const fi = (date: string | null | undefined) => (/^\d{4}-\d{2}-\d{2}/.test(String(date || ''))
  ? `${Number(String(date).slice(8, 10))}.${Number(String(date).slice(5, 7))}.${String(date).slice(0, 4)}`
  : '');

/** "1.11.2026–30.11.2026", or '' without a period. */
export function periodLabel(start: string | null | undefined, end: string | null | undefined): string {
  return start && end ? `${fi(start)}–${fi(end)}` : '';
}

/**
 * The two ways to pay an invoice, each on its own Checkout page so the coach pays the fee of the way
 * the player chose: 'card' = MobilePay, Apple Pay, Google Pay and cards (one price class), 'klarna' =
 * Klarna (pay now, in 30 days or in parts; its fee is about twice a card's).
 */
export type PayMethod = 'card' | 'klarna';
export const payMethodOf = (value: unknown): PayMethod => (value === 'klarna' ? 'klarna' : 'card');

/**
 * Klarna's estimated cost: 2,99 % + 0,40 € in Finland (stripe.com/en-fi/pricing/local-payment-methods)
 * and Connect's 0,25 % of the payout. Cards and MobilePay use STRIPE_COST (fees.ts: 1,5 % + 0,36 €,
 * MobilePay's price, and the same 0,25 %). Kept equal to PAY_COSTS in koutsi/web/src/domain/billing.js,
 * which shows them to the coach (test/koutsiPay.test.mjs compares them).
 */
export const KLARNA_COST = { bps: 324, fixedCents: 40 } as const;

/**
 * What Stripe keeps of a coach's online payment: its estimated cost for the way the player pays.
 * Krossi adds no margin; the player pays exactly the invoice.
 */
export function paymentCost(totalCents: number, method: PayMethod = 'card'): number {
  const cost = method === 'klarna' ? KLARNA_COST : STRIPE_COST;
  const fee = Math.ceil((totalCents * cost.bps) / 10_000) + cost.fixedCents;
  return Math.max(0, Math.min(totalCents, fee));
}

/** The ways an account can take, from its capabilities: ['card', 'mobilepay'?, 'klarna'?] once cards work. */
export function accountMethods(capabilities: Record<string, string | undefined> | null | undefined): string[] {
  const caps = capabilities || {};
  if (caps.card_payments !== 'active') return [];
  return ['card', ...(caps.mobilepay_payments === 'active' ? ['mobilepay'] : []), ...(caps.klarna_payments === 'active' ? ['klarna'] : [])];
}

export interface CheckoutInput {
  invoiceId: string;
  number: number;
  totalCents: number;
  sellerName: string;
  period: string;
  payerEmail: string | null;
  token: string;
  base: string;
  /** the coach's connected Express account */
  destination: string;
  /** 'card' (MobilePay, Apple Pay, Google Pay, cards) or 'klarna' */
  method?: PayMethod;
  /** the account takes MobilePay (accountMethods) */
  mobilepay?: boolean;
}

/**
 * The Checkout session for one invoice, on Krossi's account as a destination charge: the coach is
 * the seller on the payer's statement (on_behalf_of) and gets the money (transfer_data) less Stripe's
 * estimated cost (application_fee_amount). One line, the invoice's total in euros, back to the
 * invoice's own page; {CHECKOUT_SESSION_ID} is filled in by Stripe.
 */
export function checkoutParams(input: CheckoutInput) {
  const page = `${input.base}/lasku/${input.token}`;
  const description = [input.sellerName, input.period].filter(Boolean).join(', ');
  const method = input.method === 'klarna' ? 'klarna' : 'card';
  const metadata = { koutsi_invoice_id: input.invoiceId, koutsi_invoice_number: String(input.number), koutsi_method: method };
  return {
    mode: 'payment' as const,
    // Apple Pay and Google Pay come with 'card' on Stripe's page
    payment_method_types: method === 'klarna' ? ['klarna'] : ['card', ...(input.mobilepay ? ['mobilepay'] : [])],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: input.totalCents,
        product_data: { name: `Lasku ${input.number}`, ...(description ? { description } : {}) },
      },
    }],
    success_url: `${page}?maksu={CHECKOUT_SESSION_ID}`,
    cancel_url: page,
    locale: 'fi' as const,
    client_reference_id: input.invoiceId,
    ...(input.payerEmail ? { customer_email: input.payerEmail } : {}),
    metadata,
    payment_intent_data: {
      description: `Lasku ${input.number}, ${input.sellerName}`,
      on_behalf_of: input.destination,
      transfer_data: { destination: input.destination },
      application_fee_amount: paymentCost(input.totalCents, method),
      metadata,
    },
  };
}

export interface SessionLike {
  id?: string;
  payment_status?: string | null;
  status?: string | null;
  metadata?: Record<string, string> | null;
  payment_intent?: string | { id: string } | null;
  amount_total?: number | null;
}

/** Is this Checkout session the invoice's, and paid in full? */
export function paidFromSession(session: SessionLike, invoiceId: string, totalCents: number) {
  const matches = session?.metadata?.koutsi_invoice_id === invoiceId;
  const intent = session?.payment_intent;
  return {
    matches,
    paid: matches && session.payment_status === 'paid' && (session.amount_total == null || session.amount_total === totalCents),
    paymentIntent: typeof intent === 'string' ? intent : intent?.id ?? null,
  };
}

/** The coach's online payments as the app shows them. */
export function payStatus(stored: { stripe_account_id: string | null; stripe_charges_enabled: boolean; stripe_details_submitted: boolean; pay_online: boolean }, dueCount = 0) {
  return {
    state: !stored.stripe_account_id ? 'none' : stored.stripe_charges_enabled ? 'ready' : 'pending',
    chargesEnabled: Boolean(stored.stripe_charges_enabled),
    detailsSubmitted: Boolean(stored.stripe_details_submitted),
    payOnline: Boolean(stored.pay_online),
    dueCount,
  };
}
