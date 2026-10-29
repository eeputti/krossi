// koutsi-pay — Laskutus, vaihe 2: a Koutsi invoice paid online, straight to the coach's own Stripe account.
//
//   { action: 'connect', coachId? }        -> { url }      coach: Stripe's onboarding for the coach's own account
//   { action: 'status', coachId? }         -> PayStatus    coach: the account read from Stripe, stored on koutsi_billers
//   { action: 'sync', coachId? }           -> { updated }  coach: confirms the payments of the coach's open invoices
//   { action: 'checkout', token }          -> { url } | { paid: true }   anyone with the invoice's link: Stripe Checkout
//   { action: 'verify', token, session }   -> { paid }     anyone with the link, back from Checkout
//
// PayStatus = { state: 'none' | 'pending' | 'ready', chargesEnabled, detailsSubmitted, payOnline, dueCount }
// (../_shared/koutsiPay.ts). coachId defaults to the signed-in user (an admin acting as a coach passes it).
//
// The coach's account is a standard Stripe account: the coach is the seller, Stripe takes its fee from
// each payment on the coach's side, refunds and disputes are the coach's in their own Stripe dashboard,
// and Krossi takes nothing and pays no Connect fees. Payments are direct charges (Stripe-Account header),
// so their events stay on the coach's account: a payment is confirmed when the payer returns to the
// invoice page (verify) and whenever the coach opens Laskutus (sync); koutsi_invoice_paid_online marks
// it once and tells the coach. (A Connect webhook can be added later for the rare payer who closes the
// page before returning.)
//
// Deploy with verify_jwt off (checkout and verify have no signed-in user); the coach actions check the
// caller's JWT here. Secrets: STRIPE_SECRET_KEY (the platform's, as the krossi-* functions).
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17.7.0';
import { SESSION_RE, UUID_RE, appBase, checkoutParams, isAllowedOrigin, paidFromSession, payStatus, periodLabel, KOUTSI_APP } from '../_shared/koutsiPay.ts';

const NOT_FOUND = 'Laskua ei löytynyt.';
const NOT_COACH = 'Vain valmentaja voi tehdä tämän.';
const NO_BILLER = 'Täytä ensin laskuttajan tiedot.';
const NOT_ON = 'Laskutus ei ole käytössä.';
const ALREADY_PAID = 'Lasku on jo maksettu.';
const NOT_PAYABLE = 'Tätä laskua ei voi maksaa verkossa. Maksa tilisiirrolla laskun tiedoilla.';
const NO_CONNECT = 'Verkkomaksuja ei saatu käyttöön. Yritä hetken päästä uudelleen.';
const MISSING = 'Stripe-tiliä ei löytynyt Stripestä.';
const STRIPE_DOWN = 'Maksupalvelu ei nyt vastaa. Yritä hetken päästä uudelleen.';
const DB_FAILED = 'Käsittely epäonnistui. Yritä hetken päästä uudelleen.';

function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'access-control-allow-origin': isAllowedOrigin(origin) ? origin : KOUTSI_APP,
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

interface Biller {
  id: string;
  coach_id: string;
  name: string;
  email: string | null;
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
  stripe_details_submitted: boolean;
  pay_online: boolean;
}
const BILLER_COLUMNS = 'id, coach_id, name, email, stripe_account_id, stripe_charges_enabled, stripe_details_submitted, pay_online';

interface Invoice {
  id: string;
  biller_id: string;
  coach_id: string;
  status: string;
  number: number;
  total_cents: number;
  payer_email: string | null;
  period_start: string | null;
  period_end: string | null;
  public_token: string;
  checkout_session_id: string | null;
}
const INVOICE_COLUMNS = 'id, biller_id, coach_id, status, number, total_cents, payer_email, period_start, period_end, public_token, checkout_session_id';

async function billerOfCoach(admin: SupabaseClient, coachId: string): Promise<Biller | null> {
  const { data, error } = await admin.from('koutsi_billers').select(BILLER_COLUMNS).eq('coach_id', coachId).maybeSingle();
  if (error) throw new Error(`biller lookup failed: ${error.message}`);
  return data as Biller | null;
}

async function billerById(admin: SupabaseClient, id: string): Promise<Biller> {
  const { data, error } = await admin.from('koutsi_billers').select(BILLER_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`biller lookup failed: ${error.message}`);
  if (!data) throw new Reply(404, NOT_FOUND);
  return data as Biller;
}

async function invoiceByToken(admin: SupabaseClient, token: unknown): Promise<Invoice> {
  if (typeof token !== 'string' || !UUID_RE.test(token)) throw new Reply(404, NOT_FOUND);
  const { data, error } = await admin.from('koutsi_invoices').select(INVOICE_COLUMNS).eq('public_token', token).maybeSingle();
  if (error) throw new Error(`invoice lookup failed: ${error.message}`);
  if (!data || !['sent', 'paid'].includes((data as Invoice).status)) throw new Reply(404, NOT_FOUND);
  return data as Invoice;
}

/** Marks the invoice paid if this Checkout session paid it; true when it is paid now. */
async function settle(admin: SupabaseClient, inv: Invoice, session: Stripe.Checkout.Session) {
  const result = paidFromSession(session as unknown as Parameters<typeof paidFromSession>[0], inv.id, inv.total_cents);
  if (!result.paid) return false;
  const { error } = await admin.rpc('koutsi_invoice_paid_online', {
    p_invoice: inv.id, p_session: session.id, p_payment_intent: result.paymentIntent,
  });
  if (error) throw new Error(`marking paid failed: ${error.message}`);
  return true;
}

async function retrieveSession(id: string, account: string) {
  try {
    return await stripe.checkout.sessions.retrieve(id, {}, { stripeAccount: account });
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

/** The coach's account read from Stripe and stored; the status for the app. */
async function refresh(admin: SupabaseClient, biller: Biller) {
  if (!biller.stripe_account_id) return payStatus(biller);
  let account: Stripe.Account;
  try {
    account = await stripe.accounts.retrieve(biller.stripe_account_id);
  } catch (err) {
    if (isMissing(err)) throw new Reply(409, MISSING);
    throw err;
  }
  const stored = {
    stripe_charges_enabled: Boolean(account.charges_enabled),
    stripe_details_submitted: Boolean(account.details_submitted),
    stripe_checked_at: new Date().toISOString(),
  };
  const { error } = await admin.from('koutsi_billers').update(stored).eq('id', biller.id).eq('stripe_account_id', biller.stripe_account_id);
  if (error) throw new Error(`storing the account state failed: ${error.message}`);
  const due = account.requirements;
  const dueCount = new Set([...(due?.currently_due ?? []), ...(due?.past_due ?? [])]).size;
  return payStatus({ ...biller, ...stored }, dueCount);
}

/** The coach's account: the stored one, or a new standard account stored at once. */
async function ensureAccount(admin: SupabaseClient, biller: Biller, email: string | null) {
  if (biller.stripe_account_id) return biller.stripe_account_id;
  let account: Stripe.Account;
  try {
    account = await stripe.accounts.create({
      type: 'standard',
      country: 'FI',
      ...(biller.email || email ? { email: biller.email || email || undefined } : {}),
      business_profile: { name: biller.name, product_description: 'Tennisvalmennus. Laskut Krossi Koutsista (koutsi.krossi.app).' },
      metadata: { koutsi_coach_id: biller.coach_id, koutsi_biller_id: biller.id },
    }, { idempotencyKey: `koutsi-pay-account-${biller.id}` });
  } catch (err) {
    // e.g. Connect not yet on for the platform account
    console.error('koutsi-pay: account create failed', (err as Error).message);
    throw new Reply(502, NO_CONNECT);
  }
  const { data, error } = await admin.from('koutsi_billers')
    .update({ stripe_account_id: account.id, stripe_charges_enabled: Boolean(account.charges_enabled), stripe_details_submitted: Boolean(account.details_submitted) })
    .eq('id', biller.id).is('stripe_account_id', null).select('stripe_account_id');
  if (error) throw new Error(`storing the account failed: ${error.message}`);
  if (data?.length) return account.id;
  const latest = await billerOfCoach(admin, biller.coach_id);
  return latest?.stripe_account_id as string;
}

interface Body {
  action?: string;
  coachId?: unknown;
  token?: unknown;
  session?: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'method not allowed' }, 405);

  let body: Body = {};
  try { body = await req.json(); } catch { /* empty body -> unknown action below */ }

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const base = appBase(req.headers.get('Origin'));

  try {
    // ── the payer (no sign-in): the invoice's own page ──
    if (body.action === 'checkout') {
      const inv = await invoiceByToken(admin, body.token);
      if (inv.status === 'paid') return json(req, { paid: true });
      const biller = await billerById(admin, inv.biller_id);
      const account = biller.stripe_account_id;
      if (!account || !biller.stripe_charges_enabled || !biller.pay_online || !(inv.total_cents > 0)) throw new Reply(409, NOT_PAYABLE);
      // the page opened again: continue the same Checkout page while it is open (or notice it was paid)
      if (inv.checkout_session_id) {
        const open = await retrieveSession(inv.checkout_session_id, account);
        if (open && await settle(admin, inv, open)) return json(req, { paid: true });
        if (open?.status === 'open' && open.url && open.amount_total === inv.total_cents) return json(req, { url: open.url });
      }
      const session = await stripe.checkout.sessions.create(checkoutParams({
        invoiceId: inv.id, number: inv.number, totalCents: inv.total_cents, sellerName: biller.name,
        period: periodLabel(inv.period_start, inv.period_end), payerEmail: inv.payer_email, token: inv.public_token, base,
      }) as Stripe.Checkout.SessionCreateParams, { stripeAccount: account });
      const { error } = await admin.from('koutsi_invoices').update({ checkout_session_id: session.id }).eq('id', inv.id).eq('status', 'sent');
      if (error) throw new Error(`storing the session failed: ${error.message}`);
      return json(req, { url: session.url });
    }

    if (body.action === 'verify') {
      const inv = await invoiceByToken(admin, body.token);
      if (inv.status === 'paid') return json(req, { paid: true });
      if (typeof body.session !== 'string' || !SESSION_RE.test(body.session)) throw new Reply(400, NOT_FOUND);
      const biller = await billerById(admin, inv.biller_id);
      if (!biller.stripe_account_id) return json(req, { paid: false });
      const session = await retrieveSession(body.session, biller.stripe_account_id);
      return json(req, { paid: Boolean(session && await settle(admin, inv, session)) });
    }

    // ── the coach (signed in) ──
    if (!['connect', 'status', 'sync'].includes(body.action ?? '')) throw new Reply(400, 'Tuntematon toiminto.');
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false },
    });
    const { data: who, error: whoError } = await asUser.auth.getUser();
    if (whoError || !who?.user) return json(req, { error: 'Kirjaudu uudelleen sisään.' }, 401);
    const coachId = typeof body.coachId === 'string' && UUID_RE.test(body.coachId) ? body.coachId : who.user.id;
    const gate = body.action === 'connect' ? 'koutsi_billing_enabled' : 'koutsi_acts_as';
    const { data: allowed, error: gateError } = await asUser.rpc(gate, gate === 'koutsi_acts_as' ? { target: coachId } : { p_coach: coachId });
    if (gateError) throw new Error(`${gate} failed: ${gateError.message}`);
    if (allowed !== true) throw new Reply(403, body.action === 'connect' ? NOT_ON : NOT_COACH);
    const biller = await billerOfCoach(admin, coachId);
    if (!biller) throw new Reply(409, NO_BILLER);

    if (body.action === 'status') return json(req, await refresh(admin, biller));

    if (body.action === 'connect') {
      const account = await ensureAccount(admin, biller, who.user.email ?? null);
      const link = await stripe.accountLinks.create({
        account,
        type: 'account_onboarding',
        refresh_url: `${base}/valmentaja/laskutus?tili=uusi`,
        return_url: `${base}/valmentaja/laskutus?tili=valmis`,
      });
      return json(req, { url: link.url });
    }

    // sync: the coach's open invoices that have a Checkout page, newest first
    if (!biller.stripe_account_id) return json(req, { updated: 0 });
    const { data: open, error: openError } = await admin.from('koutsi_invoices').select(INVOICE_COLUMNS)
      .eq('coach_id', coachId).eq('status', 'sent').not('checkout_session_id', 'is', null)
      .order('sent_at', { ascending: false }).limit(25);
    if (openError) throw new Error(`open invoices failed: ${openError.message}`);
    let updated = 0;
    for (const inv of (open ?? []) as Invoice[]) {
      const session = await retrieveSession(inv.checkout_session_id as string, biller.stripe_account_id);
      if (session && await settle(admin, inv, session)) updated += 1;
    }
    return json(req, { updated });
  } catch (err) {
    if (err instanceof Reply) return json(req, { error: err.message }, err.status);
    const stripeFailed = isStripeError(err);
    console.error(`koutsi-pay ${String(body.action)} failed`, (err as Error).message);
    return json(req, { error: stripeFailed ? STRIPE_DOWN : DB_FAILED }, stripeFailed ? 502 : 500);
  }
});
