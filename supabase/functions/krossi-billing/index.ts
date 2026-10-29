// krossi-billing — kenttävarauksen vaihe 2: kausivuorojen laskutus ja kortit, sarja- ja lahjakorttien
// osto (krossi.app/pelaa/varaa, /pelaa/halli/:venue).
//
//   { action: 'cardSetup' }                          -> { publishableKey, clientSecret, email }   SetupIntent for a card on file
//   { action: 'cardSaved', setupIntentId }           -> SavedCard   checks the SetupIntent, stores the card
//   { action: 'removeCard' }                         -> {}          refused while a card-billed season slot is active
//   { action: 'runCharges', venueId }                -> { paid, failed }   hall staff: charges every due month off-session
//   { action: 'payCharge', chargeId }                -> { paid: true } | { publishableKey, clientSecret, paymentIntentId, amount, currency, email }
//   { action: 'verifyCharge', chargeId, paymentIntentId } -> { paid, status }
//   { action: 'orderConfig', kind, id }              -> { paid: true } | { publishableKey, amount, currency, email }   kind 'pass' | 'gift' | 'topup'
//   { action: 'orderIntent', kind, id }              -> { paid: true } | { clientSecret, paymentIntentId }
//   { action: 'orderVerify', kind, id, paymentIntentId } -> { paid, status }
//   { action: 'saldoRefund', venueId }               -> { refundedCents, feeCents }   the unused top-ups of my saldo at the hall
//                                                     back to their cards (refundedCents goes to the cards, feeCents stays)
//   { action: 'sendInvoice', invoiceId }             -> { sentTo }   hall staff: e-mails the invoice with the payment details
//   { action: 'seasonDecided', slotId }              -> { sent }     hall staff, right after approving / declining a
//                                                                     kausivuoro request: e-mails the player the decision
//
// Monthly charges: krossi_billing_due_charges lists the due months of active card-billed season
// slots; each one is claimed with krossi_billing_charge_attempt (so two runs never charge the same
// month), charged off-session from the holder's saved card (idempotency key per attempt) and
// recorded with krossi_billing_charge_result. A declined card or a bank asking for authentication
// leaves the month 'failed' with a Finnish reason: the holder gets an e-mail and pays it in the app
// (payCharge, a normal on-session payment), the hall sees it first in its billing view, and the
// daily run retries it (at most 4 attempts, 20 h apart).
//
// A daily cron can run the charges for every hall: POST { action: 'runCharges' } with the header
// x-cron-secret: <KROSSI_CRON_SECRET> (and the service role key as the bearer token).
//
// Orders (series cards, gift cards, saldo top-ups) are paid like bookings: the amount comes from the
// database (booking_passes.price_cents / booking_gift_cards.amount_cents / booking_topups.amount_cents),
// metadata.product 'krossi_pass' / 'krossi_gift' / 'krossi_topup', and krossi_wallet_order_paid
// activates the pass, issues the gift card's code or puts the top-up on the saldo (here and in
// stripe-webhook). An order paid twice is refunded (key `krossi-order-refund-<pi>`).
//
// Saldo back to the card (saldoRefund, ../_shared/saldo.ts): krossi_saldo_refund_claim takes the
// refundable part off the saldo at once (only top-ups, newest first, within 180 days; free for 14
// days, then 1 €), and each top-up's payment is refunded by that much. A refund Stripe doesn't
// take now is finished by krossi-booking-cron; one it refuses for good goes back on the saldo.
//
// Decision e-mails: the app calls 'seasonDecided' after krossi_season_approve / _decline. The mail
// goes once per decision: krossi_season_decision_claim stamps the slot's notified_at (only a
// player's own request, decided in the last 24 h, not mailed yet) and krossi_season_decision_release
// lifts the stamp when the mail didn't go, so a later call may try again. It is a transactional
// message about the player's own request (like the failed-charge mail): no notification
// preferences; reply-to is the hall's invoicing e-mail.
//
// Stripe Connect (../_shared/fees.ts), like krossi-booking: destination charges to the hall's
// account with Krossi's fee = Stripe's estimated cost + the hall's margin; refunds keep Krossi's fee.
// On-session payments name the hall as the seller (on_behalf_of); the off-session kausivuoro months
// don't, because the card was saved on Krossi's account. A public hall whose account isn't ready
// takes no payments (503 'Hallin verkkomaksu ei ole vielä käytössä.'), and runCharges leaves its
// due months for a later run.
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY (as krossi-payment / krossi-booking),
// RESEND_API_KEY + KROSSI_MAIL_FROM(_NAME) (as krossi-notify), KROSSI_CRON_SECRET (optional).
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17.7.0';
import {
  HALL_NOT_CONNECTED, HallNotConnected, PAYEE_COLUMNS, type PayeeVenue, connectParams, refundConnect, takesPayments,
} from '../_shared/fees.ts';
import { type SaldoRefund, TOPUP_PRODUCT, refundSaldo } from '../_shared/saldo.ts';

const APP = 'https://krossi.app';
const MIN_CHARGE_CENTS = 50;
const PRODUCTS = { pass: 'krossi_pass', gift: 'krossi_gift', topup: TOPUP_PRODUCT } as const;
type OrderKind = keyof typeof PRODUCTS;
const ORDER_TABLES: Record<OrderKind, string> = { pass: 'booking_passes', gift: 'booking_gift_cards', topup: 'booking_topups' };
const SEASON_PRODUCT = 'krossi_season';
const REUSABLE = ['requires_payment_method', 'requires_confirmation', 'requires_action'];

const NOT_FOUND_ORDER = 'Tilausta ei löytynyt.';
const NOT_FOUND_CHARGE = 'Veloitusta ei löytynyt.';
const STAFF_ONLY = 'Vain hallin henkilökunta voi tehdä tämän.';
const UNKNOWN_PAYMENT = 'Maksua ei löytynyt.';
const NO_ONLINE = 'Verkkomaksu ei ole vielä käytössä.';
const STRIPE_DOWN = 'Maksupalvelu ei nyt vastaa. Yritä hetken päästä uudelleen.';
const DB_FAILED = 'Käsittely epäonnistui. Yritä hetken päästä uudelleen.';
const NO_CARD = 'Pelaajalla ei ole tallennettua korttia.';

const ALLOWED_ORIGINS = ['https://krossi.app', 'https://www.krossi.app'];
function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'access-control-allow-origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'Origin',
  };
}
const json = (req: Request, body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders(req), 'content-type': 'application/json' } },
);

/** An answer for the player: { error } with this status. Anything else thrown is a 5xx. */
class Reply extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
const isStripeError = (err: unknown) => /^Stripe/.test(String((err as { type?: unknown })?.type ?? ''));
const isMissing = (err: unknown) => (err as { code?: string })?.code === 'resource_missing';

/** STRIPE_PUBLISHABLE_KEY if it looks real and is from the same mode as the secret key, else null. */
function usablePublishableKey() {
  const publishable = (Deno.env.get('STRIPE_PUBLISHABLE_KEY') || '').trim();
  const mode = /^pk_(test|live)_[A-Za-z0-9]{20,}$/.exec(publishable)?.[1];
  const secretMode = /^[sr]k_(test|live)_/.exec(Deno.env.get('STRIPE_SECRET_KEY') || '')?.[1];
  return mode && mode === secretMode ? publishable : null;
}

/** The player's Stripe customer in the current mode (same as krossi-payment / krossi-booking). */
async function ensureCustomer(admin: SupabaseClient, userId: string, email: string | undefined) {
  const { data: profile, error } = await admin.from('profiles').select('stripe_customer_id').eq('id', userId).maybeSingle();
  if (error) throw new Error(`profile lookup failed: ${error.message}`);
  if (!profile) throw new Reply(400, 'Täytä ensin pelaajaprofiilisi.');
  const stored = profile.stripe_customer_id as string | null;
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

async function retrieveIntent(id: string | null | undefined): Promise<Stripe.PaymentIntent | null> {
  if (!id) return null;
  try {
    return await stripe.paymentIntents.retrieve(id);
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

async function cancelIntent(id: string, reason: Stripe.PaymentIntentCancelParams.CancellationReason) {
  await stripe.paymentIntents.cancel(id, { cancellation_reason: reason }).catch((err) =>
    console.error('cancelling an outdated payment failed', id, (err as Error).message));
}

interface Venue extends PayeeVenue { id: string; name: string }

async function loadVenue(admin: SupabaseClient, id: string): Promise<Venue> {
  const { data, error } = await admin.from('booking_venues').select(`id, name, ${PAYEE_COLUMNS}`).eq('id', id).single();
  if (error) throw new Error(`venue lookup failed: ${error.message}`);
  return data as Venue;
}

async function isStaff(asUser: SupabaseClient, venueId: string) {
  const { data, error } = await asUser.rpc('krossi_booking_is_staff', { venue_id: venueId });
  if (error) throw new Error(`staff check failed: ${error.message}`);
  return data === true;
}

// ── Mail (Resend, like krossi-notify) ────────────────────────────────────────

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const euros = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;
const fiDate = (key: string | null) => (key ? `${Number(key.slice(8, 10))}.${Number(key.slice(5, 7))}.${key.slice(0, 4)}` : '');

/** Sends one e-mail; false when mail isn't configured or Resend refused it. */
async function sendMail(to: string, subject: string, lines: string[], { replyTo, cta }: { replyTo?: string | null; cta?: { label: string; url: string } } = {}) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) return false;
  const mailFrom = Deno.env.get('KROSSI_MAIL_FROM') ?? Deno.env.get('KOUTSI_MAIL_FROM') ?? 'messages@krossi.app';
  const fromName = Deno.env.get('KROSSI_MAIL_FROM_NAME') ?? 'Krossi';
  const html = `<!doctype html><html lang="fi"><head><meta charset="utf-8"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:#F7F5EF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#121212">
<div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:18px;padding:28px">
${lines.map((line) => (line === '' ? '<div style="height:10px"></div>' : `<div style="font-size:15px;line-height:1.55;color:#3A372F">${escapeHtml(line)}</div>`)).join('\n')}
${cta ? `<p style="margin:20px 0 0"><a href="${escapeHtml(cta.url)}" style="display:inline-block;background:#CFE414;color:#121212;text-decoration:none;font-weight:800;font-size:15px;padding:12px 24px;border-radius:999px">${escapeHtml(cta.label)}</a></p>` : ''}
</div></body></html>`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: `${fromName} <${mailFrom}>`, to: [to], subject, html,
      text: [...lines, ...(cta ? ['', `${cta.label}: ${cta.url}`] : [])].join('\n'),
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!response.ok) console.error('krossi-billing: mail rejected', response.status, await response.text().catch(() => ''));
  return response.ok;
}

/** Pankkiviivakoodi v4 (same rule as the app's features/seasons.js virtualBarcode). */
function virtualBarcode(iban: string | null, cents: number, reference: string, dueOn: string) {
  const account = String(iban || '').replace(/\s/g, '').toUpperCase();
  const ref = String(reference || '').replace(/\s/g, '');
  if (!/^FI\d{16}$/.test(account) || !/^\d{1,20}$/.test(ref) || cents < 0 || cents >= 100_000_000) return null;
  const due = /^\d{4}-\d{2}-\d{2}$/.test(dueOn) ? `${dueOn.slice(2, 4)}${dueOn.slice(5, 7)}${dueOn.slice(8, 10)}` : '000000';
  return `4${account.slice(2)}${String(Math.floor(cents / 100)).padStart(6, '0')}${String(cents % 100).padStart(2, '0')}000${ref.padStart(20, '0')}${due}`;
}

// ── Card on file ─────────────────────────────────────────────────────────────

async function cardSetup(admin: SupabaseClient, user: { id: string; email?: string }) {
  const publishableKey = usablePublishableKey();
  if (!publishableKey) throw new Reply(503, NO_ONLINE);
  const customer = await ensureCustomer(admin, user.id, user.email);
  const intent = await stripe.setupIntents.create({
    customer,
    usage: 'off_session',
    payment_method_types: ['card'],
    metadata: { product: 'krossi_card', supabase_user_id: user.id },
  });
  return { publishableKey, clientSecret: intent.client_secret, email: user.email ?? null };
}

async function cardSaved(admin: SupabaseClient, user: { id: string }, setupIntentId: unknown) {
  if (typeof setupIntentId !== 'string' || !/^seti_[A-Za-z0-9]+$/.test(setupIntentId)) throw new Reply(400, 'Korttia ei löytynyt.');
  let intent: Stripe.SetupIntent;
  try {
    intent = await stripe.setupIntents.retrieve(setupIntentId, { expand: ['payment_method'] });
  } catch (err) {
    if (isMissing(err)) throw new Reply(404, 'Korttia ei löytynyt.');
    throw err;
  }
  if (intent.metadata?.supabase_user_id !== user.id || intent.metadata?.product !== 'krossi_card') throw new Reply(403, 'Korttia ei löytynyt.');
  if (intent.status !== 'succeeded') throw new Reply(409, 'Kortin vahvistus on kesken. Yritä uudelleen.');
  const method = intent.payment_method as Stripe.PaymentMethod | null;
  if (!method?.id || !method.card) throw new Reply(409, 'Tallennettava maksutapa ei ole kortti.');
  const customer = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id;
  if (!customer) throw new Error(`setup intent ${intent.id} without a customer`);

  // The card that was on file before (if any) is detached once the new one is stored.
  const { data: previous } = await admin.from('booking_saved_cards').select('stripe_payment_method_id').eq('user_id', user.id).maybeSingle();
  const { data, error } = await admin.rpc('krossi_billing_save_card', {
    user_id_input: user.id,
    customer_input: customer,
    payment_method_input: method.id,
    brand_input: method.card.brand,
    last4_input: method.card.last4,
    exp_month_input: method.card.exp_month,
    exp_year_input: method.card.exp_year,
  });
  if (error) throw new Error(`krossi_billing_save_card failed: ${error.message}`);
  const old = previous?.stripe_payment_method_id as string | undefined;
  if (old && old !== method.id) {
    await stripe.paymentMethods.detach(old).catch((err) => console.error('detaching the old card failed', (err as Error).message));
  }
  return data as Record<string, unknown>;
}

async function removeCard(asUser: SupabaseClient) {
  const { data, error } = await asUser.rpc('krossi_billing_remove_card');
  if (error) {
    if (error.code === 'P0001') throw new Reply(409, error.message);
    throw new Error(`krossi_billing_remove_card failed: ${error.message}`);
  }
  if (typeof data === 'string' && data) {
    await stripe.paymentMethods.detach(data).catch((err) => console.error('detaching a removed card failed', (err as Error).message));
  }
  return {};
}

// ── Monthly season charges ───────────────────────────────────────────────────

interface DueCharge {
  chargeId: string;
  venueId: string;
  seasonSlotId: string;
  userId: string | null;
  month: string;
  amountCents: number;
  status: string;
  attempts: number;
  paymentIntentId: string | null;
  customerId: string | null;
  paymentMethodId: string | null;
  description: string;
}

/** Finnish reason for a failed off-session card charge. */
function failureMessage(err: { code?: string; decline_code?: string } | null, status?: string) {
  const code = err?.decline_code || err?.code || '';
  if (status === 'requires_action' || code === 'authentication_required') return 'Pankki pyysi vahvistusta. Maksa kuukausi sovelluksessa.';
  if (code === 'insufficient_funds') return 'Kortilla ei ollut katetta. Maksa kuukausi sovelluksessa tai vaihda kortti.';
  if (code === 'expired_card') return 'Kortti on vanhentunut. Tallenna uusi kortti ja maksa kuukausi sovelluksessa.';
  return 'Pankki hylkäsi veloituksen. Kortti pitää päivittää tai kuukausi maksaa sovelluksessa.';
}

async function chargeResult(admin: SupabaseClient, chargeId: string, intentId: string | null, succeeded: boolean, message: string | null) {
  const { data, error } = await admin.rpc('krossi_billing_charge_result', {
    charge_id_input: chargeId, payment_intent_id_input: intentId, succeeded_input: succeeded, failure_message_input: message,
  });
  if (error) throw new Error(`krossi_billing_charge_result failed: ${error.message}`);
  return data as string;
}

/** Tells the holder that a month couldn't be charged. Never throws. */
async function mailFailure(admin: SupabaseClient, charge: DueCharge, message: string) {
  try {
    if (!charge.userId) return;
    const { data } = await admin.auth.admin.getUserById(charge.userId);
    const email = data?.user?.email;
    if (!email) return;
    await sendMail(email, 'Kausivuoron kuukausimaksu ei mennyt läpi', [
      `Kausivuorosi maksua (${charge.month}, ${euros(charge.amountCents)}) ei saatu veloitettua kortiltasi.`,
      message,
      '',
      'Vuorosi pysyy voimassa. Maksa kuukausi Krossissa tai tallenna uusi kortti, niin seuraavat veloitukset onnistuvat.',
    ], { cta: { label: 'Maksa kuukausi', url: `${APP}/pelaa/omat-varaukset` } });
  } catch (err) {
    console.error('krossi-billing: failure mail failed', (err as Error).message);
  }
}

/**
 * Charges one due month off-session: 'paid' | 'failed' | 'skipped' (taken by another run, Stripe
 * down, or the hall takes no payments now — the month stays due).
 */
async function chargeOne(admin: SupabaseClient, charge: DueCharge, venue: Venue): Promise<'paid' | 'failed' | 'skipped'> {
  // A run that died after charging: the payment it made decides.
  if (charge.status === 'processing' && charge.paymentIntentId) {
    const previous = await retrieveIntent(charge.paymentIntentId);
    if (previous?.status === 'succeeded') return (await chargeResult(admin, charge.chargeId, previous.id, true, null)) === 'paid' ? 'paid' : 'skipped';
    if (previous?.status === 'processing') return 'skipped';
  }
  if (!takesPayments(venue)) return 'skipped';
  const { data: attempt, error } = await admin.rpc('krossi_billing_charge_attempt', { charge_id_input: charge.chargeId });
  if (error) throw new Error(`krossi_billing_charge_attempt failed: ${error.message}`);
  if (attempt === null || attempt === undefined) return 'skipped';
  if (!charge.customerId || !charge.paymentMethodId) {
    await chargeResult(admin, charge.chargeId, null, false, NO_CARD);
    await mailFailure(admin, charge, 'Tallennettua korttia ei löytynyt.');
    return 'failed';
  }
  const params: Stripe.PaymentIntentCreateParams = {
    amount: charge.amountCents,
    currency: 'eur',
    customer: charge.customerId,
    payment_method: charge.paymentMethodId,
    off_session: true,
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    description: charge.description,
    metadata: {
      product: SEASON_PRODUCT, mode: 'off_session', charge_id: charge.chargeId, season_slot_id: charge.seasonSlotId,
      venue_id: charge.venueId, supabase_user_id: charge.userId ?? '',
    },
    ...connectParams(venue, charge.amountCents, { onBehalfOf: false }),
  };
  try {
    const intent = await stripe.paymentIntents.create(params, { idempotencyKey: `krossi-season-${charge.chargeId}-${attempt}` });
    if (intent.status === 'succeeded') {
      await chargeResult(admin, charge.chargeId, intent.id, true, null);
      return 'paid';
    }
    if (intent.status === 'processing') {
      await admin.from('booking_season_charges').update({ stripe_payment_intent_id: intent.id }).eq('id', charge.chargeId);
      return 'skipped'; // the webhook records it
    }
    const message = failureMessage(intent.last_payment_error ?? null, intent.status);
    await chargeResult(admin, charge.chargeId, intent.id, false, message);
    await mailFailure(admin, charge, message);
    return 'failed';
  } catch (err) {
    const e = err as { type?: string; code?: string; decline_code?: string; raw?: { payment_intent?: { id?: string } }; payment_intent?: { id?: string } };
    if (e.type === 'StripeCardError') {
      const message = failureMessage(e);
      await chargeResult(admin, charge.chargeId, e.payment_intent?.id ?? e.raw?.payment_intent?.id ?? null, false, message);
      await mailFailure(admin, charge, message);
      return 'failed';
    }
    // Stripe or the network failed: the month stays 'processing' and is retried in an hour.
    console.error('krossi-billing: charge failed', charge.chargeId, (err as Error).message);
    return 'skipped';
  }
}

async function runCharges(admin: SupabaseClient, venueId: string | null) {
  const { data, error } = await admin.rpc('krossi_billing_due_charges', { venue_id_input: venueId });
  if (error) throw new Error(`krossi_billing_due_charges failed: ${error.message}`);
  let paid = 0;
  let failed = 0;
  const venues = new Map<string, Venue>();
  for (const charge of (Array.isArray(data) ? data : []) as DueCharge[]) {
    if (!venues.has(charge.venueId)) venues.set(charge.venueId, await loadVenue(admin, charge.venueId));
    const outcome = await chargeOne(admin, charge, venues.get(charge.venueId) as Venue);
    if (outcome === 'paid') paid += 1;
    if (outcome === 'failed') failed += 1;
  }
  return { paid, failed };
}

interface ChargeRow {
  id: string;
  venue_id: string;
  season_slot_id: string;
  month: string;
  amount_cents: number;
  due_on: string;
  status: string;
  attempts: number;
  stripe_payment_intent_id: string | null;
}

/** The caller's own charge (holder of its season slot), else 404. */
async function myCharge(admin: SupabaseClient, chargeId: unknown, userId: string) {
  if (!isUuid(chargeId)) throw new Reply(404, NOT_FOUND_CHARGE);
  const { data: charge, error } = await admin.from('booking_season_charges')
    .select('id, venue_id, season_slot_id, month, amount_cents, due_on, status, attempts, stripe_payment_intent_id')
    .eq('id', chargeId).maybeSingle();
  if (error) throw new Error(`charge lookup failed: ${error.message}`);
  if (!charge) throw new Reply(404, NOT_FOUND_CHARGE);
  const { data: slot, error: slotError } = await admin.from('booking_season_slots')
    .select('holder_id, holder_name').eq('id', charge.season_slot_id).single();
  if (slotError) throw new Error(`slot lookup failed: ${slotError.message}`);
  if (slot.holder_id !== userId) throw new Reply(404, NOT_FOUND_CHARGE);
  return { charge: charge as ChargeRow, holderName: slot.holder_name as string };
}

async function payCharge(admin: SupabaseClient, user: { id: string; email?: string }, chargeId: unknown) {
  const { charge, holderName } = await myCharge(admin, chargeId, user.id);
  if (charge.status === 'paid') return { paid: true };
  if (charge.status === 'void') throw new Reply(409, 'Tätä kuukautta ei enää veloiteta.');
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Helsinki' });
  if (String(charge.due_on).slice(0, 10) > today) throw new Reply(409, 'Tämä kuukausi veloitetaan vasta eräpäivänä.');
  const publishableKey = usablePublishableKey();
  if (!publishableKey) throw new Reply(503, NO_ONLINE);
  if (charge.amount_cents < MIN_CHARGE_CENTS) throw new Reply(409, 'Summa on liian pieni verkkomaksuun.');
  const venue = await loadVenue(admin, charge.venue_id);
  if (!takesPayments(venue)) throw new HallNotConnected();

  const previous = await retrieveIntent(charge.stripe_payment_intent_id);
  if (previous?.status === 'succeeded') {
    await chargeResult(admin, charge.id, previous.id, true, null);
    return { paid: true };
  }
  if (previous?.status === 'processing') throw new Reply(409, 'Maksu on vielä kesken. Odota hetki ja päivitä sivu.');
  const answer = (intent: Stripe.PaymentIntent) => ({
    publishableKey, clientSecret: intent.client_secret, paymentIntentId: intent.id, amount: intent.amount, currency: 'eur', email: user.email ?? null,
  });
  // An unfinished payment made in the app is reused; a failed off-session one is replaced.
  if (previous && REUSABLE.includes(previous.status) && previous.metadata?.mode === 'on_session' && previous.amount === charge.amount_cents) {
    return answer(previous);
  }
  if (previous && REUSABLE.includes(previous.status)) await cancelIntent(previous.id, 'abandoned');

  const customer = await ensureCustomer(admin, user.id, user.email);
  const params: Stripe.PaymentIntentCreateParams = {
    amount: charge.amount_cents,
    currency: 'eur',
    customer,
    automatic_payment_methods: { enabled: true },
    description: `Kausivuoro ${holderName}, ${charge.month}, ${venue.name}`,
    receipt_email: user.email || undefined,
    metadata: {
      product: SEASON_PRODUCT, mode: 'on_session', charge_id: charge.id, season_slot_id: charge.season_slot_id,
      venue_id: charge.venue_id, supabase_user_id: user.id,
    },
    ...connectParams(venue, charge.amount_cents),
  };
  const intent = await stripe.paymentIntents.create(params, {
    idempotencyKey: `krossi-season-pay-${charge.id}-${charge.stripe_payment_intent_id ?? 'first'}`,
  });
  const { error } = await admin.from('booking_season_charges').update({ stripe_payment_intent_id: intent.id }).eq('id', charge.id)
    .in('status', ['scheduled', 'failed', 'processing']);
  if (error) throw new Error(`storing the charge payment failed: ${error.message}`);
  return answer(intent);
}

async function verifyCharge(admin: SupabaseClient, user: { id: string }, chargeId: unknown, paymentIntentId: unknown) {
  const id = typeof paymentIntentId === 'string' ? paymentIntentId : '';
  if (!/^pi_[A-Za-z0-9]+$/.test(id)) throw new Reply(400, UNKNOWN_PAYMENT);
  const { charge } = await myCharge(admin, chargeId, user.id);
  const intent = await retrieveIntent(id);
  if (!intent || intent.metadata?.product !== SEASON_PRODUCT || intent.metadata?.charge_id !== charge.id) throw new Reply(403, UNKNOWN_PAYMENT);
  if (intent.status !== 'succeeded') return { paid: charge.status === 'paid', status: intent.status };
  const status = await chargeResult(admin, charge.id, intent.id, true, null);
  return { paid: status === 'paid', status: 'succeeded' };
}

// ── Orders: series cards, gift cards and saldo top-ups ───────────────────────

interface Order {
  kind: OrderKind;
  id: string;
  venueId: string;
  ownerId: string | null;
  pending: boolean;
  amount: number;
  intentId: string | null;
  label: string;
}

async function loadOrder(admin: SupabaseClient, kind: unknown, id: unknown): Promise<Order | null> {
  if ((kind !== 'pass' && kind !== 'gift' && kind !== 'topup') || !isUuid(id)) return null;
  if (kind === 'topup') {
    const { data, error } = await admin.from('booking_topups')
      .select('id, venue_id, user_id, status, amount_cents, stripe_payment_intent_id').eq('id', id).maybeSingle();
    if (error) throw new Error(`top-up lookup failed: ${error.message}`);
    return data ? {
      kind, id: data.id, venueId: data.venue_id, ownerId: data.user_id, pending: data.status === 'pending', amount: data.amount_cents,
      intentId: data.stripe_payment_intent_id, label: `Saldon lataus ${euros(data.amount_cents)}`,
    } : null;
  }
  if (kind === 'pass') {
    const { data, error } = await admin.from('booking_passes')
      .select('id, venue_id, user_id, status, price_cents, stripe_payment_intent_id, name').eq('id', id).maybeSingle();
    if (error) throw new Error(`pass lookup failed: ${error.message}`);
    return data ? {
      kind, id: data.id, venueId: data.venue_id, ownerId: data.user_id, pending: data.status === 'pending', amount: data.price_cents,
      intentId: data.stripe_payment_intent_id, label: `Sarjakortti ${data.name}`,
    } : null;
  }
  const { data, error } = await admin.from('booking_gift_cards')
    .select('id, venue_id, buyer_id, status, amount_cents, stripe_payment_intent_id').eq('id', id).maybeSingle();
  if (error) throw new Error(`gift card lookup failed: ${error.message}`);
  return data ? {
    kind, id: data.id, venueId: data.venue_id, ownerId: data.buyer_id, pending: data.status === 'pending', amount: data.amount_cents,
    intentId: data.stripe_payment_intent_id, label: `Lahjakortti ${euros(data.amount_cents)}`,
  } : null;
}

async function myOrder(admin: SupabaseClient, body: { kind?: unknown; id?: unknown }, userId: string) {
  const order = await loadOrder(admin, body.kind, body.id);
  if (!order || order.ownerId !== userId) throw new Reply(404, NOT_FOUND_ORDER);
  return order;
}

/** Records a succeeded order payment; an order paid by another payment gets this one back. */
async function settleOrder(admin: SupabaseClient, intent: Stripe.PaymentIntent, kind: OrderKind) {
  const { data, error } = await admin.rpc('krossi_wallet_order_paid', {
    kind_input: kind, order_id_input: intent.metadata?.order_id, payment_intent_id_input: intent.id, amount_input: intent.amount,
  });
  if (error) throw new Error(`krossi_wallet_order_paid failed: ${error.message}`);
  if (data === 'duplicate') {
    const params: Stripe.RefundCreateParams = {
      payment_intent: intent.id, metadata: { product: PRODUCTS[kind], order_id: intent.metadata?.order_id ?? '' }, ...refundConnect(intent),
    };
    try {
      await stripe.refunds.create(params, { idempotencyKey: `krossi-order-refund-${intent.id}` });
    } catch (err) {
      if ((err as { code?: string }).code !== 'charge_already_refunded') throw err;
    }
  }
  return data as string;
}

async function orderIntent(admin: SupabaseClient, user: { id: string; email?: string }, order: Order) {
  const previous = await retrieveIntent(order.intentId);
  if (previous?.status === 'succeeded' && previous.metadata?.order_id === order.id) {
    if ((await settleOrder(admin, previous, order.kind)) === 'paid') return { paid: true };
  }
  if (previous?.status === 'processing') throw new Reply(409, 'Maksu on vielä kesken. Odota hetki ja päivitä sivu.');
  if (previous && REUSABLE.includes(previous.status) && previous.amount === order.amount && previous.metadata?.order_id === order.id) {
    return { clientSecret: previous.client_secret, paymentIntentId: previous.id };
  }
  if (previous && REUSABLE.includes(previous.status)) await cancelIntent(previous.id, 'abandoned');

  const venue = await loadVenue(admin, order.venueId);
  const customer = await ensureCustomer(admin, user.id, user.email);
  const params: Stripe.PaymentIntentCreateParams = {
    amount: order.amount,
    currency: 'eur',
    customer,
    automatic_payment_methods: { enabled: true },
    description: `${order.label}, ${venue.name}`,
    receipt_email: user.email || undefined,
    metadata: { product: PRODUCTS[order.kind], order_id: order.id, venue_id: order.venueId, supabase_user_id: user.id },
    ...connectParams(venue, order.amount),
  };
  const intent = await stripe.paymentIntents.create(params, {
    idempotencyKey: `krossi-order-intent-${order.id}-${order.intentId ?? 'first'}`,
  });
  let store = admin.from(ORDER_TABLES[order.kind]).update({ stripe_payment_intent_id: intent.id }).eq('id', order.id).eq('status', 'pending');
  store = order.intentId ? store.eq('stripe_payment_intent_id', order.intentId) : store.is('stripe_payment_intent_id', null);
  const { data: stored, error } = await store.select('id');
  if (error) throw new Error(`storing the order payment failed: ${error.message}`);
  if (!stored?.length) {
    await cancelIntent(intent.id, 'duplicate');
    throw new Reply(409, 'Maksun aloitus on jo käynnissä. Yritä hetken päästä uudelleen.');
  }
  return { clientSecret: intent.client_secret, paymentIntentId: intent.id };
}

/**
 * The unused top-ups of my saldo at the hall back to their cards (../_shared/saldo.ts). The saldo
 * is off at once; what Stripe doesn't take now the cron finishes, what it refuses comes back.
 */
async function saldoRefund(admin: SupabaseClient, userId: string, venueId: unknown) {
  if (!isUuid(venueId)) throw new Reply(404, 'Hallia ei löytynyt.');
  const { data, error } = await admin.rpc('krossi_saldo_refund_claim', { user_id_input: userId, venue_id_input: venueId });
  if (error) {
    if (/Kortille palautettavaa saldoa ei ole/.test(error.message)) throw new Reply(409, 'Kortille palautettavaa saldoa ei ole.');
    throw new Error(`krossi_saldo_refund_claim failed: ${error.message}`);
  }
  const claim = data as { cents: number; feeCents: number; refunds: SaldoRefund[] };
  const { failed } = await refundSaldo(stripe, admin, claim.refunds ?? []);
  // What Stripe refused for good is back on the saldo (with its share of the fee).
  const refundedCents = claim.cents - failed.reduce((n, r) => n + r.cents, 0);
  const feeCents = claim.feeCents - failed.reduce((n, r) => n + (r.feeCents ?? 0), 0);
  if (refundedCents <= 0) throw new Reply(502, 'Palautus kortille ei onnistunut. Saldo on ennallaan.');
  return { refundedCents, feeCents };
}

// ── Invoices ─────────────────────────────────────────────────────────────────

interface InvoiceJson {
  id: string;
  venueId: string;
  number: string;
  reference: string;
  issuedOn: string;
  dueOn: string;
  amountCents: number;
  vatPercent: number;
  vatCents: number;
  lines: { text: string; quantity: number; unit: string; totalCents: number }[];
  recipient: { name: string; email: string | null; address: string | null };
  seller: { name: string; businessId: string | null; address: string | null; iban: string | null; bic: string | null; email: string | null; phone: string | null };
  status: string;
}

async function sendInvoice(admin: SupabaseClient, asUser: SupabaseClient, invoiceId: unknown) {
  if (!isUuid(invoiceId)) throw new Reply(404, 'Laskua ei löytynyt.');
  const { data, error } = await asUser.rpc('krossi_billing_invoice', { invoice_id_input: invoiceId });
  if (error) throw new Error(`invoice lookup failed: ${error.message}`);
  const invoice = data as InvoiceJson | null;
  if (!invoice) throw new Reply(404, 'Laskua ei löytynyt.');
  if (!(await isStaff(asUser, invoice.venueId))) throw new Reply(403, STAFF_ONLY);
  if (invoice.status === 'void') throw new Reply(409, 'Mitätöityä laskua ei lähetetä.');
  const to = invoice.recipient?.email;
  if (!to) throw new Reply(409, 'Laskulla ei ole sähköpostiosoitetta. Tulosta lasku tai lisää osoite.');

  const s = invoice.seller;
  const barcode = virtualBarcode(s.iban, invoice.amountCents, invoice.reference, invoice.dueOn);
  const lines = [
    `Lasku ${invoice.number}, ${s.name}`,
    `Päiväys ${fiDate(invoice.issuedOn)}, eräpäivä ${fiDate(invoice.dueOn)}`,
    '',
    `Vastaanottaja: ${invoice.recipient.name}`,
    ...(invoice.recipient.address ? [invoice.recipient.address] : []),
    '',
    ...invoice.lines.map((l) => `${l.text}${l.unit ? ` — ${l.quantity} ${l.unit}` : ''}: ${euros(l.totalCents)}`),
    `Yhteensä ${euros(invoice.amountCents)} (sis. ALV ${String(invoice.vatPercent).replace('.', ',')} % ${euros(invoice.vatCents)})`,
    '',
    `Saaja: ${s.name}${s.businessId ? ` (Y-tunnus ${s.businessId})` : ''}`,
    `Tilinumero: ${String(s.iban || '').replace(/(.{4})(?=.)/g, '$1 ')}${s.bic ? `, BIC ${s.bic}` : ''}`,
    `Viitenumero: ${invoice.reference}`,
    `Summa: ${euros(invoice.amountCents)}`,
    `Eräpäivä: ${fiDate(invoice.dueOn)}`,
    ...(barcode ? [`Virtuaaliviivakoodi: ${barcode}`] : []),
    '',
    [s.address, s.email, s.phone].filter(Boolean).join(', '),
  ];
  const sent = await sendMail(to, `Lasku ${invoice.number} — ${s.name}`, lines, { replyTo: s.email });
  if (!sent) throw new Reply(502, 'Laskun lähetys epäonnistui. Yritä hetken päästä uudelleen.');
  const { error: markError } = await admin.rpc('krossi_billing_mark_invoice_sent', { invoice_id_input: invoice.id });
  if (markError) console.error('krossi-billing: marking the invoice sent failed', markError.message);
  return { sentTo: to };
}

// ── The hall's decision on a kausivuoro request ──────────────────────────────

const WEEKDAY_SHORT = ['ma', 'ti', 'ke', 'to', 'pe', 'la', 'su'];
const WEEKDAY_ADVERBS = ['Maanantaisin', 'Tiistaisin', 'Keskiviikkoisin', 'Torstaisin', 'Perjantaisin', 'Lauantaisin', 'Sunnuntaisin'];
const MONTHS = ['tammikuu', 'helmikuu', 'maaliskuu', 'huhtikuu', 'toukokuu', 'kesäkuu', 'heinäkuu', 'elokuu', 'syyskuu', 'lokakuu', 'marraskuu', 'joulukuu'];

/** '19:00' + 60 -> '19.00–20.00' */
function clockRange(startTime: string, minutes: number) {
  const start = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5));
  const label = (m: number) => `${Math.floor(m / 60)}.${String(m % 60).padStart(2, '0')}`;
  return `${label(start)}–${label(start + minutes)}`;
}
const dayMonth = (key: string) => `${Number(key.slice(8, 10))}.${Number(key.slice(5, 7))}.`;

interface DecidedSlot {
  id: string;
  status: 'active' | 'declined';
  holderId: string;
  holderName: string;
  venueName: string;
  venueSlug: string;
  replyTo: string | null;
  seasonName: string;
  weekday: number;
  startTime: string;
  minutes: number;
  courtName: string | null;
  locationName: string;
  startsOn: string;
  endsOn: string;
  skipDates: string[];
  weeks: number;
  priceCents: number;
  billing: 'invoice' | 'card';
  declineReason: string | null;
  invoice: { number: string; dueOn: string; amountCents: number } | null;
  charges: { month: string; amountCents: number; dueOn: string; status: string }[];
}

/** Subject, lines and button of the decision e-mail (Finnish, plain like the invoice mail). */
function decisionMail(d: DecidedSlot) {
  const time = `${WEEKDAY_ADVERBS[d.weekday - 1]} klo ${clockRange(d.startTime, d.minutes)}`;
  const place = [d.courtName, d.locationName].filter(Boolean).join(', ');
  if (d.status === 'declined') {
    return {
      subject: `Kausivuorohakemuksesi: ${d.venueName}`,
      lines: [
        `${d.venueName} ei valitettavasti voinut myöntää hakemaasi kausivuoroa.`,
        '',
        `${time}${place ? `, ${place}` : ''}`,
        d.seasonName,
        ...(d.declineReason ? ['', `Hallin viesti: ”${d.declineReason}”`] : []),
        '',
        'Voit hakea toista aikaa tai varata yksittäisiä vuoroja Krossissa.',
      ],
      cta: { label: 'Katso vapaat ajat', url: `${APP}/pelaa/varaa/${encodeURIComponent(d.venueSlug)}` },
    };
  }
  const skipped = (d.skipDates || []).filter((x) => x >= d.startsOn && x <= d.endsOn);
  const first = d.charges.find((c) => c.status !== 'void');
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Helsinki' });
  const payment = d.billing === 'invoice'
    ? (d.invoice
      ? `Maksu laskulla: lasku ${d.invoice.number}, ${euros(d.invoice.amountCents)}, eräpäivä ${fiDate(d.invoice.dueOn)}. Lasku näkyy Krossissa kohdassa Omat varaukset.`
      : 'Maksu laskulla: halli lähettää laskun erikseen.')
    : first
      ? `Maksu kortilta kuukausittain: ${MONTHS[Number(first.month.slice(5, 7)) - 1]}n erä ${euros(first.amountCents)} veloitetaan ${first.dueOn <= today ? 'tänään' : fiDate(first.dueOn)}, seuraavat kunkin kuun 1. päivä.`
      : 'Maksu kortilta kuukausittain.';
  return {
    subject: `Kausivuorosi on vahvistettu: ${d.venueName}`,
    lines: [
      `${d.venueName} hyväksyi kausivuorohakemuksesi. Vuoro on nyt sinun koko kauden.`,
      '',
      `${time}, ${place}`,
      `${d.seasonName}: ${d.weeks} kertaa, ensimmäinen ${WEEKDAY_SHORT[d.weekday - 1]} ${fiDate(d.startsOn)}`,
      ...(skipped.length ? [`Ei vuoroa: ${skipped.slice(0, 10).map(dayMonth).join(', ')}${skipped.length > 10 ? ' …' : ''}`] : []),
      `Kausihinta ${euros(d.priceCents)}`,
      '',
      payment,
    ],
    cta: { label: 'Avaa omat varaukset', url: `${APP}/pelaa/omat-varaukset` },
  };
}

async function seasonDecided(admin: SupabaseClient, asUser: SupabaseClient, slotId: unknown) {
  if (!isUuid(slotId)) throw new Reply(404, 'Kausivuoroa ei löytynyt.');
  const { data: slot, error } = await admin.from('booking_season_slots').select('id, venue_id').eq('id', slotId).maybeSingle();
  if (error) throw new Error(`slot lookup failed: ${error.message}`);
  if (!slot) throw new Reply(404, 'Kausivuoroa ei löytynyt.');
  if (!(await isStaff(asUser, slot.venue_id as string))) throw new Reply(403, STAFF_ONLY);
  const { data: claimed, error: claimError } = await admin.rpc('krossi_season_decision_claim', { slot_id_input: slotId });
  if (claimError) throw new Error(`krossi_season_decision_claim failed: ${claimError.message}`);
  if (!claimed) return { sent: false };
  const decided = claimed as DecidedSlot;
  let sent = false;
  try {
    const { data } = await admin.auth.admin.getUserById(decided.holderId);
    const to = data?.user?.email;
    if (to) {
      const mail = decisionMail(decided);
      sent = await sendMail(to, mail.subject, mail.lines, { replyTo: decided.replyTo, cta: mail.cta });
    }
  } finally {
    if (!sent) {
      const { error: releaseError } = await admin.rpc('krossi_season_decision_release', { slot_id_input: slotId });
      if (releaseError) console.error('krossi-billing: releasing the decision mail failed', releaseError.message);
    }
  }
  return { sent };
}

// ── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'method not allowed' }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body -> unknown action below */ }

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // The daily cron: every hall's due months, no user.
  const cronSecret = Deno.env.get('KROSSI_CRON_SECRET');
  if (body.action === 'runCharges' && cronSecret && req.headers.get('x-cron-secret') === cronSecret) {
    try {
      return json(req, await runCharges(admin, isUuid(body.venueId) ? body.venueId : null));
    } catch (err) {
      console.error('krossi-billing cron failed', (err as Error).message);
      return json(req, { error: DB_FAILED }, 500);
    }
  }

  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const { data: callerData, error: callerError } = await asUser.auth.getUser();
  if (callerError || !callerData?.user) return json(req, { error: 'Kirjaudu uudelleen sisään.' }, 401);
  const user = callerData.user;

  try {
    switch (body.action) {
      case 'cardSetup':
        return json(req, await cardSetup(admin, user));
      case 'cardSaved':
        return json(req, await cardSaved(admin, user, body.setupIntentId));
      case 'removeCard':
        return json(req, await removeCard(asUser));
      case 'runCharges': {
        if (!isUuid(body.venueId)) throw new Reply(404, 'Hallia ei löytynyt.');
        if (!(await isStaff(asUser, body.venueId))) throw new Reply(403, STAFF_ONLY);
        return json(req, await runCharges(admin, body.venueId));
      }
      case 'payCharge':
        return json(req, await payCharge(admin, user, body.chargeId));
      case 'verifyCharge':
        return json(req, await verifyCharge(admin, user, body.chargeId, body.paymentIntentId));
      case 'orderConfig': {
        const order = await myOrder(admin, body, user.id);
        if (!order.pending) return json(req, { paid: true });
        const publishableKey = usablePublishableKey();
        if (!publishableKey) throw new Reply(503, NO_ONLINE);
        if (!takesPayments(await loadVenue(admin, order.venueId))) throw new HallNotConnected();
        return json(req, { publishableKey, amount: order.amount, currency: 'eur', email: user.email ?? null });
      }
      case 'orderIntent': {
        const order = await myOrder(admin, body, user.id);
        if (!order.pending) return json(req, { paid: true });
        return json(req, await orderIntent(admin, user, order));
      }
      case 'orderVerify': {
        const id = typeof body.paymentIntentId === 'string' ? body.paymentIntentId : '';
        if (!/^pi_[A-Za-z0-9]+$/.test(id)) throw new Reply(400, UNKNOWN_PAYMENT);
        const order = await myOrder(admin, body, user.id);
        const intent = await retrieveIntent(id);
        if (!intent || intent.metadata?.order_id !== order.id || intent.metadata?.product !== PRODUCTS[order.kind]
          || intent.metadata?.supabase_user_id !== user.id) {
          throw new Reply(403, UNKNOWN_PAYMENT);
        }
        if (intent.status !== 'succeeded') return json(req, { paid: !order.pending, status: intent.status });
        const outcome = await settleOrder(admin, intent, order.kind);
        return json(req, { paid: outcome === 'paid', status: outcome === 'paid' ? 'succeeded' : 'duplicate' });
      }
      case 'saldoRefund':
        return json(req, await saldoRefund(admin, user.id, body.venueId));
      case 'sendInvoice':
        return json(req, await sendInvoice(admin, asUser, body.invoiceId));
      case 'seasonDecided':
        return json(req, await seasonDecided(admin, asUser, body.slotId));
      default:
        throw new Reply(400, 'Tuntematon toiminto.');
    }
  } catch (err) {
    if (err instanceof Reply) return json(req, { error: err.message }, err.status);
    if (err instanceof HallNotConnected) return json(req, { error: HALL_NOT_CONNECTED }, 503);
    const stripeFailed = isStripeError(err);
    console.error(`krossi-billing ${String(body.action)} failed`, (err as Error).message);
    return json(req, { error: stripeFailed ? STRIPE_DOWN : DB_FAILED }, stripeFailed ? 502 : 500);
  }
});
