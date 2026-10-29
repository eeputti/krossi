// _shared/koutsiPay.ts — the pure parts of koutsi-pay (Laskutus, vaihe 2): where the payer comes
// back to, what the Stripe Checkout page says, and when a Checkout session counts as paid. No
// Deno or npm imports, so koutsi/web/test/koutsiPay.test.mjs runs it in Node as it is.

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

export interface CheckoutInput {
  invoiceId: string;
  number: number;
  totalCents: number;
  sellerName: string;
  period: string;
  payerEmail: string | null;
  token: string;
  base: string;
}

/**
 * The Checkout session for one invoice, on the coach's own account: one line, the invoice's total
 * in euros, the payment methods the coach has on in Stripe (card, Apple / Google Pay, MobilePay,
 * Klarna …), back to the invoice's own page. {CHECKOUT_SESSION_ID} is filled in by Stripe.
 */
export function checkoutParams(input: CheckoutInput) {
  const page = `${input.base}/lasku/${input.token}`;
  const description = [input.sellerName, input.period].filter(Boolean).join(' · ');
  return {
    mode: 'payment' as const,
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
    metadata: { koutsi_invoice_id: input.invoiceId, koutsi_invoice_number: String(input.number) },
    payment_intent_data: {
      description: `Lasku ${input.number} · ${input.sellerName}`,
      metadata: { koutsi_invoice_id: input.invoiceId, koutsi_invoice_number: String(input.number) },
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
