// koutsi-subscription — Koutsi's coach subscription (Profiili → Tilaus). One endpoint, four actions,
// for the signed-in coach only (the coach is the caller's own id, never something in the body):
//   price    → { cents, interval, offer } | null — what "Ota tilaus" costs (Stripe price + optional
//              founding-customer coupon)
//   checkout → { url } — Stripe Checkout for the monthly subscription (inside the free trial the first
//              charge comes when the trial ends)
//   portal   → { url } — Stripe's customer portal: card, receipts, cancelling
//   sync     → { plan } — reads the subscription from Stripe and writes it, right after the coach
//              returns from Checkout or the portal (the webhook does the same later on)
//
// Secrets (scripts/koutsi-stripe-setup.mjs sets them; nothing here is Krossi's):
//   KOUTSI_STRIPE_SECRET_KEY (falls back to STRIPE_SECRET_KEY), KOUTSI_PRICE_ID,
//   KOUTSI_FOUNDER_COUPON (optional), KOUTSI_PORTAL_CONFIG (optional),
//   KOUTSI_TAX_RATE (optional: VAT added on top, once Roisku Media is VAT-liable — `--alv 25.5`).
// Deploy with JWT verification on (the default). Needs the migration 20261029193756_koutsi_coach_plans (applied 29.10.2026).
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17.7.0';
import { applyArgs, checkoutParams, koutsiCoachOf, pickSubscription, priceInfo, returnBase, KOUTSI_ORIGINS } from '../_shared/koutsiPlan.js';

const stripe = new Stripe(Deno.env.get('KOUTSI_STRIPE_SECRET_KEY') || Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'access-control-allow-origin': returnBase(origin) === origin ? origin : KOUTSI_ORIGINS[0],
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'Origin',
  };
}
const json = (req: Request, body: unknown, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders(req), 'content-type': 'application/json' } },
);
const fail = (req: Request, error: string, status = 400) => json(req, { error }, status);

type PlanRow = { plan: string; trial_ends_at: string | null; stripe_customer_id: string | null };

// Stripe's price and coupon change rarely: one read per ten minutes per instance.
let priceCache: { at: number; value: unknown } | null = null;
async function currentPrice() {
  if (priceCache && Date.now() - priceCache.at < 600_000) return priceCache.value;
  const priceId = Deno.env.get('KOUTSI_PRICE_ID');
  if (!priceId) return null;
  const price = await stripe.prices.retrieve(priceId);
  const couponId = Deno.env.get('KOUTSI_FOUNDER_COUPON');
  let coupon = null;
  if (couponId) {
    try { coupon = await stripe.coupons.retrieve(couponId); } catch { coupon = null; }
  }
  const taxRateId = Deno.env.get('KOUTSI_TAX_RATE');
  let taxRate = null;
  if (taxRateId) {
    try { taxRate = await stripe.taxRates.retrieve(taxRateId); } catch { taxRate = null; }
  }
  const value = priceInfo(price, coupon, taxRate);
  priceCache = { at: Date.now(), value };
  return value;
}

/** The coach's customer, made on the first checkout; a stored one Stripe no longer has is replaced. */
async function customerFor(admin: SupabaseClient, coachId: string, email: string | undefined, row: PlanRow | null) {
  let id = row?.stripe_customer_id || null;
  if (id) {
    try {
      const existing = await stripe.customers.retrieve(id);
      if ((existing as Stripe.DeletedCustomer).deleted) id = null;
    } catch (err) {
      if ((err as { code?: string }).code !== 'resource_missing') throw err;
      id = null;
    }
  }
  if (!id) {
    const customer = await stripe.customers.create({
      email: email || undefined,
      metadata: { product: 'koutsi_subscription', koutsi_coach_id: coachId },
    });
    id = customer.id;
    const { error } = await admin.rpc('koutsi_plan_set_customer', { p_coach: coachId, p_customer: id });
    if (error) throw new Error(`koutsi_plan_set_customer: ${error.message}`);
  }
  return id;
}

/** Reads the customer's Koutsi subscription from Stripe and writes it. → the plan afterwards, or null. */
async function syncFromStripe(admin: SupabaseClient, customerId: string) {
  const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
  const sub = pickSubscription(list.data);
  const args = sub ? applyArgs(sub) : null;
  if (!args) return null;
  const { data, error } = await admin.rpc('koutsi_plan_apply_stripe', args);
  if (error) throw new Error(`koutsi_plan_apply_stripe: ${error.message}`);
  return { plan: data as string | null, live: ['active', 'trialing', 'past_due', 'unpaid'].includes(sub!.status) };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return fail(req, 'method not allowed', 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const { data: who, error: whoError } = await asUser.auth.getUser();
  if (whoError || !who?.user) return fail(req, 'Kirjaudu uudelleen sisään.', 401);
  const user = who.user;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  let action = '';
  try { action = String((await req.json())?.action || ''); } catch { action = ''; }

  try {
    if (action === 'price') return json(req, { price: await currentPrice() });

    const { data: plan, error: planError } = await admin.rpc('koutsi_coach_plan', { p_coach: user.id });
    if (planError) return fail(req, 'Tilaus otetaan käyttöön pian.', 503);
    if (!plan) return fail(req, 'Tiliäsi ei ole liitetty valmentajaksi.', 403);
    const { data: row } = await admin.from('koutsi_coach_plans')
      .select('plan, trial_ends_at, stripe_customer_id').eq('coach_id', user.id).maybeSingle();

    if (action === 'sync') {
      if (!row?.stripe_customer_id) return json(req, { plan });
      const synced = await syncFromStripe(admin, row.stripe_customer_id);
      return json(req, { plan: synced?.plan ?? plan });
    }

    if (action === 'portal') {
      if (!row?.stripe_customer_id) return fail(req, 'Sinulla ei ole vielä tilausta.');
      const config = Deno.env.get('KOUTSI_PORTAL_CONFIG');
      const session = await stripe.billingPortal.sessions.create({
        customer: row.stripe_customer_id,
        return_url: `${returnBase(req.headers.get('Origin') || '')}/valmentaja/profiili?tilaus=palasit`,
        locale: 'fi',
        ...(config ? { configuration: config } : {}),
      });
      return json(req, { url: session.url });
    }

    if (action === 'checkout') {
      if (plan === 'free') return fail(req, 'Koutsi on sinulle maksuton — tilausta ei tarvita.');
      if (plan === 'active' || plan === 'past_due') return fail(req, 'Sinulla on jo tilaus. Avaa Hallitse tilausta.');
      const priceId = Deno.env.get('KOUTSI_PRICE_ID');
      if (!priceId) return fail(req, 'Tilaus otetaan käyttöön pian.', 503);
      const customer = await customerFor(admin, user.id, user.email, row as PlanRow | null);
      // A subscription Stripe already has (a checkout finished, its webhook not here yet): no second one.
      const synced = await syncFromStripe(admin, customer);
      if (synced?.live) return fail(req, 'Sinulla on jo tilaus. Päivitä sivu.', 409);

      const base = returnBase(req.headers.get('Origin') || '');
      const coupon = (await currentPrice() as { offer?: unknown } | null)?.offer ? Deno.env.get('KOUTSI_FOUNDER_COUPON') || null : null;
      const taxRate = Deno.env.get('KOUTSI_TAX_RATE') || null;
      const params = checkoutParams({ customer, coachId: user.id, priceId, trialEndsAt: row?.trial_ends_at || null, coupon, taxRate, base });
      let session: Stripe.Checkout.Session;
      try {
        session = await stripe.checkout.sessions.create(params as Stripe.Checkout.SessionCreateParams);
      } catch (err) {
        // The founding offer ran out between the price read and now: the normal price.
        if (!coupon) throw err;
        priceCache = null;
        session = await stripe.checkout.sessions.create(checkoutParams({ customer, coachId: user.id, priceId, trialEndsAt: row?.trial_ends_at || null, taxRate, base }) as Stripe.Checkout.SessionCreateParams);
      }
      if (!koutsiCoachOf(session)) console.error('checkout session without the coach', session.id);
      return json(req, { url: session.url });
    }

    return fail(req, 'Tuntematon toiminto.');
  } catch (err) {
    console.error('koutsi-subscription', action, (err as Error).message);
    return fail(req, 'Stripe ei vastannut. Yritä hetken päästä uudelleen.', 502);
  }
});
