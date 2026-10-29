// koutsiPlan.js — Koutsi's coach subscription on Stripe, the parts without I/O: what a Checkout
// session looks like, which Stripe objects are Koutsi's, and what a subscription writes into
// koutsi_coach_plans (koutsi_plan_apply_stripe). Plain JavaScript so Deno (koutsi-subscription,
// koutsi-stripe-webhook) and Node (koutsi/web/test/subscriptionStripe.test.mjs) run the same code.
//
// Kept apart from Krossi on purpose: Krossi's stripe-webhook unlocks a Krossi profile from any
// completed Checkout that carries client_reference_id or metadata.supabase_user_id (and from
// payment intents with metadata.product 'krossi_unlock'). A Koutsi session never carries those —
// the coach rides on metadata.koutsi_coach_id — so paying for Koutsi never touches Krossi, and
// Koutsi's events go to their own endpoint with their own secret.

export const KOUTSI_PRODUCT = 'koutsi_subscription';

// Stripe takes a trial_end in Checkout only at least 48 hours ahead; an hour of slack on top.
const MIN_TRIAL_MS = 49 * 3600 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE = new Set(['active', 'trialing', 'past_due', 'unpaid']);

// Where a coach comes back after Stripe: the app's own origin, else the production one.
export const KOUTSI_ORIGINS = ['https://koutsi.krossi.app'];
export function returnBase(origin) {
  if (KOUTSI_ORIGINS.includes(origin)) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '')) return origin;
  return KOUTSI_ORIGINS[0];
}

/** The coach id a Koutsi Stripe object belongs to, or null when it is not Koutsi's. */
export function koutsiCoachOf(obj) {
  const meta = obj?.metadata || {};
  return meta.product === KOUTSI_PRODUCT && UUID_RE.test(meta.koutsi_coach_id || '') ? meta.koutsi_coach_id : null;
}

/**
 * The Checkout session for "Ota tilaus". Inside the free trial (more than ~2 days left) the
 * subscription starts with a Stripe trial up to the same day, so the first charge comes when the
 * trial would have ended. `coupon` = the founding-customer discount, when there is one. `taxRate` =
 * the VAT rate once Roisku Media is VAT-liable (KOUTSI_TAX_RATE): added on top of the price.
 * @param {{ customer: string, coachId: string, priceId: string, trialEndsAt?: string | null, coupon?: string | null, taxRate?: string | null, base: string, now?: number }} opts
 */
export function checkoutParams({ customer, coachId, priceId, trialEndsAt = null, coupon = null, taxRate = null, base, now = Date.now() }) {
  const meta = { product: KOUTSI_PRODUCT, koutsi_coach_id: coachId };
  const trialEnd = trialEndsAt ? Date.parse(trialEndsAt) : NaN;
  const subscriptionData = { metadata: meta };
  if (Number.isFinite(trialEnd) && trialEnd - now > MIN_TRIAL_MS) subscriptionData.trial_end = Math.floor(trialEnd / 1000);
  if (taxRate) subscriptionData.default_tax_rates = [taxRate];
  return {
    mode: 'subscription',
    customer,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: meta,
    subscription_data: subscriptionData,
    ...(coupon ? { discounts: [{ coupon }] } : {}),
    locale: 'fi',
    success_url: `${base}/valmentaja/profiili?tilaus=valmis`,
    cancel_url: `${base}/valmentaja/profiili`,
  };
}

/** Of a customer's subscriptions, the one that tells the coach's state: the newest live one, else the newest. */
export function pickSubscription(list) {
  const mine = (list || []).filter((s) => koutsiCoachOf(s));
  const newest = (a, b) => (b.created || 0) - (a.created || 0);
  return mine.filter((s) => LIVE.has(s.status)).sort(newest)[0] || mine.sort(newest)[0] || null;
}

const unixToIso = (t) => (Number.isFinite(t) && t > 0 ? new Date(t * 1000).toISOString() : null);
const idOf = (v) => (typeof v === 'string' ? v : v?.id || null);

/** koutsi_plan_apply_stripe's arguments for a subscription, or null when it is not Koutsi's. */
export function applyArgs(sub) {
  const coach = koutsiCoachOf(sub);
  if (!coach || !sub?.id) return null;
  // API 2024-06-20 keeps the period on the subscription; newer versions moved it to the items.
  const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? sub.trial_end ?? null;
  return {
    p_coach: coach,
    p_customer: idOf(sub.customer),
    p_subscription: sub.id,
    p_status: sub.status || null,
    p_period_end: unixToIso(periodEnd),
    p_cancel_at_period_end: Boolean(sub.cancel_at_period_end || sub.cancel_at),
  };
}

/** The webhook's question: which subscription does this event concern? null = not Koutsi's. */
export function subscriptionIdOf(event) {
  const obj = event?.data?.object;
  if (!obj) return null;
  if (event.type === 'checkout.session.completed') {
    return obj.mode === 'subscription' && koutsiCoachOf(obj) ? idOf(obj.subscription) : null;
  }
  if (/^customer\.subscription\./.test(event.type || '')) return koutsiCoachOf(obj) ? obj.id : null;
  return null;
}

/**
 * The price a coach sees before subscribing: { cents, interval, offer: { cents, months } | null, vat }.
 * vat = the VAT percentage added on top (null while Roisku Media is not VAT-liable).
 * @param {any} price  a Stripe price
 * @param {any} [coupon]  a Stripe coupon (the founding offer), if any
 * @param {any} [taxRate]  a Stripe tax rate (KOUTSI_TAX_RATE), if any
 */
export function priceInfo(price, coupon = null, taxRate = null) {
  if (!price || !Number.isFinite(price.unit_amount)) return null;
  const cents = price.unit_amount;
  let offer = null;
  const left = coupon?.max_redemptions == null ? Infinity : coupon.max_redemptions - (coupon.times_redeemed || 0);
  if (coupon?.valid && left > 0 && coupon.duration === 'repeating' && coupon.duration_in_months > 0) {
    const off = Number.isFinite(coupon.amount_off) ? coupon.amount_off
      : Number.isFinite(coupon.percent_off) ? Math.round(cents * coupon.percent_off / 100) : 0;
    // koutsi_kk = the paid months promised (scripts/koutsi-stripe-setup.mjs adds the trial's months
    // to the coupon itself, since Stripe counts them from the day the subscription is made)
    const months = Number(coupon.metadata?.koutsi_kk) || coupon.duration_in_months;
    if (off > 0 && off < cents) offer = { cents: cents - off, months };
  }
  const vat = taxRate?.active && !taxRate.inclusive && Number(taxRate.percentage) > 0 ? Number(taxRate.percentage) : null;
  return { cents, interval: price.recurring?.interval || 'month', offer, vat };
}
