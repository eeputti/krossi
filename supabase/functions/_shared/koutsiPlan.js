// koutsiPlan.js — Koutsi's coach subscription on Stripe: what a Checkout session looks like, which
// Stripe objects are Koutsi's, and what a subscription writes into koutsi_coach_plans
// (koutsi_plan_apply_stripe). Plain JavaScript so Deno (koutsi-subscription, koutsi-stripe-webhook)
// and Node (koutsi/web/test/subscriptionStripe.test.mjs) run the same code. The few helpers that talk
// to Stripe (the founding coupon, open Checkout sessions) take the Stripe client as an argument, so the
// tests hand them a fake one.
//
// Kept apart from Krossi on purpose: Krossi's stripe-webhook unlocks a Krossi profile from any
// completed Checkout that carries client_reference_id or metadata.supabase_user_id (and from
// payment intents with metadata.product 'krossi_unlock'). A Koutsi session never carries those —
// the coach rides on metadata.koutsi_coach_id — so paying for Koutsi never touches Krossi, and
// Koutsi's events go to their own endpoint with their own secret.

export const KOUTSI_PRODUCT = 'koutsi_subscription';

// Stripe takes a trial_end in Checkout only at least 48 hours ahead; an hour of slack on top.
const MIN_TRIAL_MS = 49 * 3600 * 1000;
const DAY_MS = 86400 * 1000;
// Stripe's longest trial is 730 days; an hour of slack below it.
const MAX_TRIAL_MS = 730 * DAY_MS - 3600 * 1000;
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
 * The Stripe trial for a coach whose free trial ends at `trialEndsAt` (tilausehdot: a subscription taken
 * during the trial is charged first when the trial ends, never before):
 *   { trialEnd }  unix seconds, with more than ~2 days left (Checkout takes a trial_end only 48 h ahead)
 *   { trialDays } 1–3, with less left: the first charge comes at most a day after the trial ends
 *   {}            no trial left: charged at once
 *   { tooFar: true } further than Stripe's 730 days: Checkout would refuse it
 */
export function stripeTrial(trialEndsAt, now = Date.now()) {
  const end = trialEndsAt ? Date.parse(trialEndsAt) : NaN;
  if (!Number.isFinite(end) || end <= now) return {};
  const left = end - now;
  if (left > MAX_TRIAL_MS) return { tooFar: true };
  if (left > MIN_TRIAL_MS) return { trialEnd: Math.floor(end / 1000) };
  return { trialDays: Math.ceil(left / DAY_MS) };
}

/**
 * The Checkout session for "Ota tilaus". Inside the free trial the subscription starts with a Stripe
 * trial up to the same day (stripeTrial), so the first charge comes when the trial would have ended.
 * `coupon` = the founding-customer discount for this coach (foundingCouponFor), when there is one.
 * `taxRate` = the VAT rate once Roisku Media is VAT-liable (KOUTSI_TAX_RATE): added on top of the price.
 * Throws for a trial Stripe can't take (stripeTrial → tooFar); the caller says so to the coach first.
 * @param {{ customer: string, coachId: string, priceId: string, trialEndsAt?: string | null, coupon?: string | null, taxRate?: string | null, base: string, now?: number }} opts
 */
export function checkoutParams({ customer, coachId, priceId, trialEndsAt = null, coupon = null, taxRate = null, base, now = Date.now() }) {
  const meta = { product: KOUTSI_PRODUCT, koutsi_coach_id: coachId };
  const trial = stripeTrial(trialEndsAt, now);
  if (trial.tooFar) throw new Error('trial_end beyond Stripe\'s 730 days');
  const subscriptionData = { metadata: meta };
  if (trial.trialEnd) subscriptionData.trial_end = trial.trialEnd;
  if (trial.trialDays) subscriptionData.trial_period_days = trial.trialDays;
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

/**
 * The webhook's answer for an event about `sub`: the best of the same coach's subscriptions on its
 * customer (`list`), so an event of a cancelled duplicate never ends the coach's live subscription.
 * → { sub, live } (live = how many of them are live; more than one = the coach pays twice), or null.
 */
export function bestSubscription(sub, list) {
  const coach = koutsiCoachOf(sub);
  if (!coach) return null;
  const all = [sub, ...(list || []).filter((s) => s?.id !== sub.id && koutsiCoachOf(s) === coach)];
  return { sub: pickSubscription(all), live: all.filter((s) => LIVE.has(s.status)).length };
}

/**
 * Before a new Checkout: the customer's Koutsi Checkout sessions still open (another tab, a second
 * tap) are expired, so two of them can't both become subscriptions. → how many were expired.
 */
export async function expireOpenCheckouts(stripe, customer) {
  const list = await stripe.checkout.sessions.list({ customer, status: 'open', limit: 20 });
  let expired = 0;
  for (const session of list?.data || []) {
    if (session.mode !== 'subscription' || !koutsiCoachOf(session)) continue;
    try {
      await stripe.checkout.sessions.expire(session.id);
      expired += 1;
    } catch {
      // finished or expired a moment ago: the live-subscription check after this catches a finished one
    }
  }
  return expired;
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

// ── The founding offer ──────────────────────────────────────────────────────
// KOUTSI_FOUNDER_COUPON (scripts/koutsi-stripe-setup.mjs) = "the offer price for the first N paid months,
// for the first M coaches". Stripe counts a repeating coupon's months from the day the subscription is
// made, also inside its trial, so one coupon can't fit every coach: with a 6- or 12-month trial a coach
// would pay the offer price for fewer months than promised, and one who subscribes after the trial for
// more. So each checkout uses a coupon lasting the offer's months + the whole months left in the coach's
// trial: the configured coupon itself when that matches, else one made from it on demand (same discount,
// id `<configured id>_<months>KK`). The "first M coaches" limit counts the uses of all of them together.

/** The paid months the offer promises (metadata koutsi_kk, set by the setup script; else the coupon's length). */
export function offerMonths(coupon) {
  return Number(coupon?.metadata?.koutsi_kk) || Number(coupon?.duration_in_months) || 0;
}

/** Whole calendar months from `from` to `to` (ms; UTC; a month's last day clamps like Stripe's billing). */
export function wholeMonths(from, to) {
  const addMonths = (ms, n) => {
    const d = new Date(ms);
    const day = d.getUTCDate();
    const first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
    const t = new Date(first);
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    t.setUTCDate(Math.min(day, last));
    return t.getTime();
  };
  let months = 0;
  while (months < 60 && addMonths(from, months + 1) <= to) months += 1;
  return months;
}

/**
 * How long the founding coupon must last for this checkout: the offer's months + the whole months of the
 * Stripe trial (stripeTrial). Invoices come at the trial's end and monthly after it; the discount ends
 * that many months after today, so exactly `offer` of them are discounted.
 */
export function foundingMonths(offer, trial, now = Date.now()) {
  if (!(offer > 0)) return 0;
  const end = trial?.trialEnd ? trial.trialEnd * 1000 : trial?.trialDays ? now + trial.trialDays * DAY_MS : now;
  return offer + wholeMonths(now, end);
}

/** Is `id` the configured founding coupon `baseId` or one made from it? */
export function isFoundingCoupon(id, baseId) {
  if (!id || !baseId) return false;
  return id === baseId || (id.startsWith(`${baseId}_`) && /^\d+KK$/.test(id.slice(baseId.length + 1)));
}

/** Founding places left (Infinity without a limit); 0 when the offer is not on. */
export function foundingLeft(coupon) {
  if (!coupon?.valid || coupon.duration !== 'repeating' || !(coupon.duration_in_months > 0)) return 0;
  return coupon.max_redemptions == null ? Infinity : Math.max(0, coupon.max_redemptions - (coupon.times_redeemed || 0));
}

/**
 * The configured founding coupon as it stands, its times_redeemed counting the coupons made from it too
 * (the "first M coaches" limit). null when it is not set or Stripe doesn't have it.
 */
export async function foundingCoupon(stripe, baseId) {
  if (!baseId) return null;
  let base;
  try {
    base = await stripe.coupons.retrieve(baseId, { expand: ['applies_to'] });
  } catch (err) {
    if (err?.code === 'resource_missing') return null;
    throw err;
  }
  if (!base || base.deleted) return null;
  let redeemed = 0;
  let after = null;
  for (let page = 0; page < 10; page += 1) {
    const list = await stripe.coupons.list({ limit: 100, ...(after ? { starting_after: after } : {}) });
    const data = list?.data || [];
    for (const c of data) if (isFoundingCoupon(c.id, base.id)) redeemed += c.times_redeemed || 0;
    if (!list?.has_more || data.length === 0) break;
    after = data[data.length - 1].id;
  }
  return { ...base, times_redeemed: Math.max(redeemed, base.times_redeemed || 0) };
}

/**
 * The coupon id for a checkout whose discount must last `months` (foundingMonths): the configured one when
 * its length matches, else one made from it (retrieved, or created the first time). null when the offer
 * is not on or its places are taken. `base` = foundingCoupon(…).
 */
export async function foundingCouponFor(stripe, base, months) {
  if (!base || foundingLeft(base) <= 0 || !(months > 0)) return null;
  if (months === base.duration_in_months) return base.id;
  const id = `${base.id}_${months}KK`;
  try {
    const found = await stripe.coupons.retrieve(id);
    if (found && !found.deleted) return found.valid ? id : null;
  } catch (err) {
    if (err?.code !== 'resource_missing') throw err;
  }
  const off = Number.isFinite(base.amount_off) && base.amount_off > 0
    ? { amount_off: base.amount_off, currency: base.currency }
    : { percent_off: base.percent_off };
  const products = base.applies_to?.products || [];
  try {
    await stripe.coupons.create({
      id,
      ...(base.name ? { name: base.name } : {}),
      ...off,
      duration: 'repeating',
      duration_in_months: months,
      // the real limit is counted over all of them (foundingCoupon); this only caps one
      ...(base.max_redemptions ? { max_redemptions: base.max_redemptions } : {}),
      ...(base.redeem_by ? { redeem_by: base.redeem_by } : {}),
      ...(products.length ? { applies_to: { products } } : {}),
      metadata: { koutsi_kk: String(offerMonths(base)), koutsi_base: base.id },
    });
  } catch (err) {
    // made by another checkout a moment ago
    if (err?.code !== 'resource_already_exists') throw err;
  }
  return id;
}

/**
 * The price a coach sees before subscribing: { cents, interval, offer: { cents, months } | null, vat, year }.
 * vat = the VAT percentage added on top (null while Roisku Media is not VAT-liable); year = { cents } of
 * the yearly price (KOUTSI_PRICE_YEAR_ID) when there is one. The founding offer is for the monthly price.
 * @param {any} price  a Stripe price
 * @param {any} [coupon]  the founding coupon (foundingCoupon: its uses counted with the coupons made from it), if any
 * @param {any} [taxRate]  a Stripe tax rate (KOUTSI_TAX_RATE), if any
 * @param {any} [yearPrice]  the yearly Stripe price, if any
 */
export function priceInfo(price, coupon = null, taxRate = null, yearPrice = null) {
  if (!price || !Number.isFinite(price.unit_amount)) return null;
  const cents = price.unit_amount;
  let offer = null;
  if (foundingLeft(coupon) > 0) {
    const off = Number.isFinite(coupon.amount_off) ? coupon.amount_off
      : Number.isFinite(coupon.percent_off) ? Math.round(cents * coupon.percent_off / 100) : 0;
    // the paid months promised (koutsi_kk), whatever the coupon's own length
    const months = offerMonths(coupon);
    if (off > 0 && off < cents) offer = { cents: cents - off, months };
  }
  const vat = taxRate?.active && !taxRate.inclusive && Number(taxRate.percentage) > 0 ? Number(taxRate.percentage) : null;
  const year = yearPrice?.active !== false && Number.isFinite(yearPrice?.unit_amount) && yearPrice.recurring?.interval === 'year'
    ? { cents: yearPrice.unit_amount } : null;
  return { cents, interval: price.recurring?.interval || 'month', offer, vat, year };
}
