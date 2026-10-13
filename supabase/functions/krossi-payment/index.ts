// Krossi's own in-app checkout: the 8,99 € unlock paid inside krossi.app with Stripe's Payment
// Element + Express Checkout Element (Apple Pay, Google Pay, MobilePay, cards…) instead of a
// redirect to Stripe's hosted Checkout page (stripe-checkout, kept as the fallback).
//
//   { action: 'config' }                  -> { paid: true } | { hosted: true } | { publishableKey, amount, currency, email }
//   { action: 'intent' }                  -> { paid: true } | { clientSecret, paymentIntentId }
//   { action: 'verify', paymentIntentId } -> { paid: boolean, status }
//
// `verify` asks Stripe directly, so a payment unlocks Krossi immediately instead of waiting for
// the webhook (which also marks it paid via payment_intent.succeeded). `config` and `intent` also
// pick up a payment that succeeded while the player was away (e.g. closed the tab in MobilePay).
//
// Test vs live is decided by the secrets alone: STRIPE_SECRET_KEY + STRIPE_PUBLISHABLE_KEY +
// STRIPE_PRICE_ID (+ STRIPE_WEBHOOK_SECRET for stripe-webhook). Without STRIPE_PUBLISHABLE_KEY
// the app keeps using the hosted Checkout page.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17.7.0';

const PRODUCT = 'krossi_unlock';
// Apple Pay / Google Pay only show on domains registered with Stripe (per mode: test and live).
const PAYMENT_DOMAINS = ['krossi.app', 'www.krossi.app'];

const ALLOWED_ORIGINS = ['https://krossi.app', 'https://www.krossi.app'];
function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'access-control-allow-origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'Origin',
  };
}
const json = (req: Request, body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders(req), 'content-type': 'application/json' } },
);

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

/**
 * STRIPE_PUBLISHABLE_KEY if it looks real and is from the same mode as the secret key, else null
 * (-> hosted Checkout). A placeholder or a test key next to a live secret would otherwise leave
 * players with a checkout that can't load or can't confirm.
 */
function usablePublishableKey() {
  const publishable = (Deno.env.get('STRIPE_PUBLISHABLE_KEY') || '').trim();
  const mode = /^pk_(test|live)_[A-Za-z0-9]{20,}$/.exec(publishable)?.[1];
  const secretMode = /^[sr]k_(test|live)_/.exec(Deno.env.get('STRIPE_SECRET_KEY') || '')?.[1];
  if (!mode || mode !== secretMode) {
    if (publishable) console.error(`STRIPE_PUBLISHABLE_KEY ignored: ${mode ? `${mode} key next to a ${secretMode} secret key` : 'not a pk_test_/pk_live_ key'}`);
    return null;
  }
  return publishable;
}

// The price lives in Stripe (STRIPE_PRICE_ID) so the amount is never trusted from the client.
let pricePromise: Promise<{ amount: number; currency: string }> | null = null;
function getPrice() {
  pricePromise ??= stripe.prices.retrieve(Deno.env.get('STRIPE_PRICE_ID')!).then((price) => {
    if (!price.unit_amount) throw new Error('STRIPE_PRICE_ID has no unit_amount');
    return { amount: price.unit_amount, currency: price.currency };
  }).catch((err) => { pricePromise = null; throw err; });
  return pricePromise;
}

// Registers krossi.app for wallets once per worker. Doing it here (not by hand in the Dashboard)
// means switching the secrets to live keys registers the live domains on its own.
let domainsChecked = false;
async function ensurePaymentDomains() {
  if (domainsChecked) return;
  domainsChecked = true;
  try {
    const { data } = await stripe.paymentMethodDomains.list({ limit: 100 });
    const known = new Set(data.map((d) => d.domain_name));
    for (const domain of PAYMENT_DOMAINS) {
      if (!known.has(domain)) await stripe.paymentMethodDomains.create({ domain_name: domain });
    }
  } catch (err) {
    domainsChecked = false;
    console.error('payment method domain registration failed', (err as Error).message);
  }
}

async function markPaid(admin: SupabaseClient, userId: string, customerId: string | null) {
  const { error } = await admin.from('profiles')
    .update({ paid_at: new Date().toISOString(), ...(customerId ? { stripe_customer_id: customerId } : {}) })
    .eq('id', userId)
    .is('paid_at', null);
  if (error) throw new Error(`paid_at update failed: ${error.message}`);
}

const customerOf = (intent: Stripe.PaymentIntent) =>
  (typeof intent.customer === 'string' ? intent.customer : intent.customer?.id) ?? null;

/**
 * Unlocks the profile for a succeeded intent and stamps the intent (metadata.applied_at) so it
 * is picked up only once: an admin who flips their own account back to unpaid to test the
 * paywall again isn't silently re-unlocked by an old test payment. stripe-webhook stamps too.
 */
async function applyPayment(admin: SupabaseClient, userId: string, intent: Stripe.PaymentIntent) {
  await markPaid(admin, userId, customerOf(intent));
  if (!intent.metadata?.applied_at) {
    await stripe.paymentIntents.update(intent.id, { metadata: { applied_at: new Date().toISOString() } });
  }
}

/** A payment that went through but never reached the profile (tab closed in MobilePay, missed webhook). */
const unapplied = (intents: Stripe.PaymentIntent[]) =>
  intents.find((pi) => pi.status === 'succeeded' && !pi.metadata?.applied_at);

const isMissing = (err: unknown) => (err as { code?: string })?.code === 'resource_missing';

/** This player's Krossi payment intents, newest first ([] if the customer is unknown in this mode). */
async function ownIntents(customerId: string, userId: string) {
  try {
    const { data } = await stripe.paymentIntents.list({ customer: customerId, limit: 20 });
    return data.filter((pi) => pi.metadata?.product === PRODUCT && pi.metadata?.supabase_user_id === userId);
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

/**
 * The player's Stripe customer in the current mode. A stored id from the other mode (sandbox
 * customers after switching to live keys) or a deleted customer is replaced with a new one.
 */
async function ensureCustomer(admin: SupabaseClient, userId: string, email: string | undefined, stored: string | null) {
  if (stored) {
    try {
      const existing = await stripe.customers.retrieve(stored);
      if (!existing.deleted) return stored;
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
  }
  const customer = await stripe.customers.create({ email: email || undefined, metadata: { supabase_user_id: userId } });
  await admin.from('profiles').update({ stripe_customer_id: customer.id }).eq('id', userId);
  return customer.id;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const { data: callerData, error: callerError } = await asUser.auth.getUser();
  if (callerError || !callerData?.user) return json(req, { error: 'Kirjaudu uudelleen sisään.' }, 401);
  const user = callerData.user;

  let body: { action?: string; paymentIntentId?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body -> unknown action below */ }

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: profile, error: profileError } = await admin.from('profiles')
    .select('paid_at, stripe_customer_id').eq('id', user.id).maybeSingle();
  if (profileError) return json(req, { error: 'Profiilin lataus epäonnistui.' }, 500);
  if (!profile) return json(req, { error: 'Tee ensin pelaajaprofiili.' }, 400);

  try {
    if (body.action === 'config') {
      if (profile.paid_at) return json(req, { paid: true });
      const publishableKey = usablePublishableKey();
      if (!publishableKey) return json(req, { hosted: true });
      // @ts-ignore EdgeRuntime is the Supabase runtime global
      EdgeRuntime.waitUntil(ensurePaymentDomains());
      if (profile.stripe_customer_id) {
        const done = unapplied(await ownIntents(profile.stripe_customer_id, user.id));
        if (done) { await applyPayment(admin, user.id, done); return json(req, { paid: true }); }
      }
      const price = await getPrice();
      return json(req, { publishableKey, amount: price.amount, currency: price.currency, email: user.email ?? null });
    }

    if (body.action === 'intent') {
      if (profile.paid_at) return json(req, { paid: true });
      const price = await getPrice();

      const customerId = await ensureCustomer(admin, user.id, user.email, profile.stripe_customer_id);
      const intents = await ownIntents(customerId, user.id);
      const done = unapplied(intents);
      if (done) { await applyPayment(admin, user.id, done); return json(req, { paid: true }); }

      // Reuse an unfinished attempt (closed sheet, declined card) instead of piling up new ones.
      const open = intents.find((pi) => ['requires_payment_method', 'requires_confirmation'].includes(pi.status)
        && pi.amount === price.amount && pi.currency === price.currency);
      const intent = open ?? await stripe.paymentIntents.create({
        amount: price.amount,
        currency: price.currency,
        customer: customerId,
        automatic_payment_methods: { enabled: true },
        description: 'Krossi — kertamaksu',
        receipt_email: user.email || undefined,
        metadata: { product: PRODUCT, supabase_user_id: user.id },
      });
      return json(req, { clientSecret: intent.client_secret, paymentIntentId: intent.id });
    }

    if (body.action === 'verify') {
      const id = typeof body.paymentIntentId === 'string' ? body.paymentIntentId : '';
      if (!/^pi_[A-Za-z0-9]+$/.test(id)) return json(req, { error: 'Tuntematon maksu.' }, 400);
      if (profile.paid_at) return json(req, { paid: true, status: 'succeeded' });
      const intent = await stripe.paymentIntents.retrieve(id);
      if (intent.metadata?.supabase_user_id !== user.id || intent.metadata?.product !== PRODUCT) {
        return json(req, { error: 'Tuntematon maksu.' }, 403);
      }
      if (intent.status !== 'succeeded') return json(req, { paid: false, status: intent.status });
      await applyPayment(admin, user.id, intent);
      return json(req, { paid: true, status: intent.status });
    }

    // Admin-only setup check: which Stripe mode each secret is from and whether Stripe has what
    // the checkout needs. Never returns key values.
    if (body.action === 'status') {
      const { data: isAdmin } = await asUser.rpc('krossi_is_admin');
      if (!isAdmin) return json(req, { error: 'not allowed' }, 403);
      const modeOf = (value: string | undefined, re: RegExp) => re.exec(value || '')?.[1] ?? (value ? 'invalid' : 'missing');
      const settle = async <T,>(fn: () => Promise<T>) => {
        try { return await fn(); } catch (err) { return { error: (err as Error).message }; }
      };
      const hookUrl = `${url}/functions/v1/stripe-webhook`;
      return json(req, {
        secretKey: modeOf(Deno.env.get('STRIPE_SECRET_KEY'), /^[sr]k_(test|live)_/),
        publishableKey: modeOf(Deno.env.get('STRIPE_PUBLISHABLE_KEY'), /^pk_(test|live)_[A-Za-z0-9]{20,}$/),
        publishableKeyUsed: Boolean(usablePublishableKey()),
        webhookSecret: Deno.env.get('STRIPE_WEBHOOK_SECRET') ? 'set' : 'missing',
        account: await settle(async () => {
          const a = await stripe.accounts.retrieve();
          return { charges_enabled: a.charges_enabled, payouts_enabled: a.payouts_enabled, details_submitted: a.details_submitted, country: a.country };
        }),
        price: await settle(async () => {
          const p = await stripe.prices.retrieve(Deno.env.get('STRIPE_PRICE_ID')!);
          return { livemode: p.livemode, active: p.active, amount: p.unit_amount, currency: p.currency };
        }),
        webhookEndpoints: await settle(async () => {
          const { data } = await stripe.webhookEndpoints.list({ limit: 100 });
          return data.filter((w) => w.url === hookUrl).map((w) => ({ status: w.status, events: w.enabled_events }));
        }),
        paymentMethods: await settle(async () => {
          const { data } = await stripe.paymentMethodConfigurations.list({ limit: 20 });
          const config = data.find((c) => c.is_default) ?? data[0];
          const pick = (k: string) => {
            const m = (config as unknown as Record<string, { available?: boolean; display_preference?: { value?: string } }>)?.[k];
            return m ? { available: m.available, on: m.display_preference?.value } : 'unknown';
          };
          return { card: pick('card'), apple_pay: pick('apple_pay'), google_pay: pick('google_pay'), mobilepay: pick('mobilepay') };
        }),
        domains: await settle(async () => {
          const { data } = await stripe.paymentMethodDomains.list({ limit: 100 });
          return data.filter((d) => PAYMENT_DOMAINS.includes(d.domain_name)).map((d) => ({
            domain: d.domain_name, enabled: d.enabled, apple_pay: d.apple_pay?.status, google_pay: d.google_pay?.status,
          }));
        }),
      });
    }

    // Admin-only: finds or creates the 8,99 € one-time price in the current Stripe mode, found
    // again by its lookup key so running it twice never makes a second product. Its id goes into
    // the STRIPE_PRICE_ID secret.
    if (body.action === 'setup-price') {
      const { data: isAdmin } = await asUser.rpc('krossi_is_admin');
      if (!isAdmin) return json(req, { error: 'not allowed' }, 403);
      const lookupKey = 'krossi_unlock_899';
      const { data: existing } = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
      const price = existing[0] ?? await stripe.prices.create({
        currency: 'eur',
        unit_amount: 899,
        lookup_key: lookupKey,
        product_data: { name: 'Krossi — kertamaksu' },
      });
      return json(req, { priceId: price.id, created: !existing[0], livemode: price.livemode, amount: price.unit_amount, currency: price.currency });
    }

    return json(req, { error: 'unknown action' }, 400);
  } catch (err) {
    console.error(`krossi-payment ${body.action} failed`, (err as Error).message);
    return json(req, { error: 'Maksupalvelu ei nyt vastaa. Yritä hetken päästä uudelleen.' }, 502);
  }
});
