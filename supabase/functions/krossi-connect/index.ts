// krossi-connect — hallin oma Stripe-tili (Stripe Connect Express): Hallin asetukset →
// Verkkomaksut (krossi.app/pelaa/halli/:venue?nakyma=asetukset).
//
//   { action: 'status', venueId }     -> PayoutStatus   hall staff (and Krossi's admins)
//   { action: 'onboard', venueId }    -> { url }        Krossi's admins: Stripe's onboarding page for the hall
//   { action: 'dashboard', venueId }  -> { url }        hall staff: a one-time login to the hall's Stripe Express dashboard
//
// PayoutStatus = { state, chargesEnabled, payoutsEnabled, detailsSubmitted, dueCount, canConnect, fee }
//   state 'none' (no account yet) | 'pending' (Stripe still needs details — dueCount of them — or is
//   checking them) | 'ready' (the hall takes payments); canConnect = the caller may onboard (admin);
//   fee = { stripeBps, stripeFixedCents, marginBps, marginFixedCents }: Krossi's share of a payment
//   is ceil(amount × (stripeBps + marginBps) / 10 000) + stripeFixedCents + marginFixedCents
//   (../_shared/fees.ts), so the app can show the hall what a payment costs.
// status reads the account from Stripe and stores what it says (stripe_charges_enabled …): the
// payment functions go by those columns (stripe-webhook's account.updated keeps them fresh too).
//
// onboard creates the hall's Express account the first time (Finland, euros; card and MobilePay
// payments and transfers; weekly payouts on Mondays, since every payout costs Krossi 0,10 €) and
// stores its id in booking_venues.stripe_account_id at once, so a second tap or a retry continues
// the same account. Then an Account Link — single use, valid for a few minutes — that returns to
// /pelaa/halli/<slug>?nakyma=asetukset&tili=valmis, or to …&tili=uusi when the link ran out
// (the app asks for a new one). Not ?stripe=: the app's paywall return already reads that. Stripe asks the hall for everything it will need (eventually_due),
// so the account isn't stopped later for missing details.
//
// Why Express: Stripe hosts the onboarding and identity checks, and the hall gets a light
// dashboard of its payouts; Krossi runs the payments (destination charges, ../_shared/fees.ts),
// pays Stripe's fees and answers disputes. Connect costs Krossi 2 € per active hall a month,
// 0,25 % of payouts and 0,10 € per payout.
//
// Deploy with verify_jwt on (signed-in staff only). Secrets: STRIPE_SECRET_KEY (as krossi-booking).
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17.7.0';
import { accountState } from '../_shared/connect.ts';
import { STRIPE_COST } from '../_shared/fees.ts';

const APP = 'https://krossi.app';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOT_FOUND = 'Hallia ei löytynyt.';
const STAFF_ONLY = 'Vain hallin henkilökunta voi tehdä tämän.';
const ADMIN_ONLY = 'Vain Krossin ylläpito voi yhdistää hallin Stripe-tilin.';
const NO_ACCOUNT = 'Hallilla ei ole vielä Stripe-tiliä.';
const NOT_SUBMITTED = 'Stripe-tilin käyttöönotto on kesken. Jatka sitä ensin.';
const MISSING = 'Hallin Stripe-tiliä ei löytynyt Stripestä. Tarkista, onko se luotu testitilassa.';
const STRIPE_DOWN = 'Maksupalvelu ei nyt vastaa. Yritä hetken päästä uudelleen.';
const DB_FAILED = 'Käsittely epäonnistui. Yritä hetken päästä uudelleen.';

const ALLOWED_ORIGINS = ['https://krossi.app', 'https://www.krossi.app'];
const isLocal = (origin: string) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) || isLocal(origin);
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

/** An answer for the caller: { error } with this status. Anything else thrown is a 5xx. */
class Reply extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

const isStripeError = (err: unknown) => /^Stripe/.test(String((err as { type?: unknown })?.type ?? ''));
const isMissing = (err: unknown) => (err as { code?: string })?.code === 'resource_missing';

interface Venue {
  id: string;
  slug: string;
  name: string;
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  stripe_details_submitted: boolean;
  platform_fee_bps: number;
  platform_fee_fixed_cents: number;
}

async function loadVenue(admin: SupabaseClient, id: string): Promise<Venue> {
  const { data, error } = await admin.from('booking_venues')
    .select('id, slug, name, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, platform_fee_bps, platform_fee_fixed_cents')
    .eq('id', id).maybeSingle();
  if (error) throw new Error(`venue lookup failed: ${error.message}`);
  if (!data) throw new Reply(404, NOT_FOUND);
  return data as Venue;
}

async function rpcTrue(asUser: SupabaseClient, fn: string, args: Record<string, unknown> = {}) {
  const { data, error } = await asUser.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data === true;
}


/** The account from Stripe, stored on the venue. */
async function refresh(admin: SupabaseClient, venue: Venue, accountId: string) {
  let account: Stripe.Account;
  try {
    account = await stripe.accounts.retrieve(accountId);
  } catch (err) {
    if (isMissing(err)) throw new Reply(409, MISSING);
    throw err;
  }
  const state = accountState(account);
  const { error } = await admin.from('booking_venues').update(state).eq('id', venue.id).eq('stripe_account_id', accountId);
  if (error) throw new Error(`storing the account state failed: ${error.message}`);
  return { account, state };
}

async function status(admin: SupabaseClient, venue: Venue, canConnect: boolean) {
  const fee = {
    stripeBps: STRIPE_COST.bps, stripeFixedCents: STRIPE_COST.fixedCents,
    marginBps: venue.platform_fee_bps || 0, marginFixedCents: venue.platform_fee_fixed_cents || 0,
  };
  const base = { canConnect, fee };
  if (!venue.stripe_account_id) {
    return { ...base, state: 'none', chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, dueCount: 0 };
  }
  let flags = {
    stripe_charges_enabled: venue.stripe_charges_enabled,
    stripe_payouts_enabled: venue.stripe_payouts_enabled,
    stripe_details_submitted: venue.stripe_details_submitted,
  };
  let dueCount = 0;
  try {
    const { account, state } = await refresh(admin, venue, venue.stripe_account_id);
    flags = state;
    const due = account.requirements;
    dueCount = new Set([...(due?.currently_due ?? []), ...(due?.past_due ?? [])]).size;
  } catch (err) {
    // Stripe didn't answer: what was stored last (the payments go by it anyway).
    if (err instanceof Reply || !isStripeError(err)) throw err;
    console.error('krossi-connect: account refresh failed', venue.id, (err as Error).message);
  }
  return {
    ...base,
    state: flags.stripe_charges_enabled ? 'ready' : 'pending',
    chargesEnabled: flags.stripe_charges_enabled,
    payoutsEnabled: flags.stripe_payouts_enabled,
    detailsSubmitted: flags.stripe_details_submitted,
    dueCount,
  };
}

/** The hall's account: the stored one, or a new Express account stored at once. */
async function ensureAccount(admin: SupabaseClient, venue: Venue) {
  if (venue.stripe_account_id) return venue.stripe_account_id;
  const account = await stripe.accounts.create({
    type: 'express',
    country: 'FI',
    default_currency: 'eur',
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
      mobilepay_payments: { requested: true },
    },
    business_profile: { name: venue.name, product_description: 'Kenttävuorojen myynti Krossi-sovelluksessa (krossi.app).' },
    settings: { payouts: { schedule: { interval: 'weekly', weekly_anchor: 'monday' } } },
    metadata: { krossi_venue_id: venue.id, krossi_venue_slug: venue.slug },
  }, { idempotencyKey: `krossi-connect-account-${venue.id}` });
  const { data, error } = await admin.from('booking_venues')
    .update({ stripe_account_id: account.id, ...accountState(account) })
    .eq('id', venue.id).is('stripe_account_id', null).select('stripe_account_id');
  if (error) throw new Error(`storing the account failed: ${error.message}`);
  if (data?.length) return account.id;
  // Somebody stored one first: continue theirs.
  const latest = await loadVenue(admin, venue.id);
  return latest.stripe_account_id as string;
}

function appBase(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return ALLOWED_ORIGINS.includes(origin) || isLocal(origin) ? origin : APP;
}

interface Body {
  action?: string;
  venueId?: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'method not allowed' }, 405);

  let body: Body = {};
  try { body = await req.json(); } catch { /* empty body -> unknown action below */ }

  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const { data: callerData, error: callerError } = await asUser.auth.getUser();
  if (callerError || !callerData?.user) return json(req, { error: 'Kirjaudu uudelleen sisään.' }, 401);
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  try {
    if (!['status', 'onboard', 'dashboard'].includes(body.action ?? '')) throw new Reply(400, 'Tuntematon toiminto.');
    const venueId = typeof body.venueId === 'string' && UUID_RE.test(body.venueId) ? body.venueId : null;
    if (!venueId) throw new Reply(404, NOT_FOUND);
    // Who may, before anything about the hall is read (Krossi's admins are staff of every hall).
    const isAdmin = await rpcTrue(asUser, 'krossi_is_admin');
    if (body.action === 'onboard' && !isAdmin) throw new Reply(403, ADMIN_ONLY);
    if (!isAdmin && !(await rpcTrue(asUser, 'krossi_booking_is_staff', { venue_id: venueId }))) throw new Reply(403, STAFF_ONLY);
    const venue = await loadVenue(admin, venueId);

    if (body.action === 'status') return json(req, await status(admin, venue, isAdmin));

    if (body.action === 'onboard') {
      const account = await ensureAccount(admin, venue);
      const back = `${appBase(req)}/pelaa/halli/${venue.slug}?nakyma=asetukset&tili=`;
      const link = await stripe.accountLinks.create({
        account,
        type: 'account_onboarding',
        refresh_url: `${back}uusi`,
        return_url: `${back}valmis`,
        collection_options: { fields: 'eventually_due' },
      });
      return json(req, { url: link.url });
    }

    if (body.action === 'dashboard') {
      if (!venue.stripe_account_id) throw new Reply(409, NO_ACCOUNT);
      const { state } = await refresh(admin, venue, venue.stripe_account_id);
      if (!state.stripe_details_submitted) throw new Reply(409, NOT_SUBMITTED);
      const link = await stripe.accounts.createLoginLink(venue.stripe_account_id);
      return json(req, { url: link.url });
    }
    throw new Reply(400, 'Tuntematon toiminto.');
  } catch (err) {
    if (err instanceof Reply) return json(req, { error: err.message }, err.status);
    const stripeFailed = isStripeError(err);
    console.error(`krossi-connect ${String(body.action)} failed`, (err as Error).message);
    return json(req, { error: stripeFailed ? STRIPE_DOWN : DB_FAILED }, stripeFailed ? 502 : 500);
  }
});
