// krossi-booking — kenttävarauksen maksu ja peruutus (krossi.app/pelaa/varaa).
//
// The booking itself is made by the krossi_hold_booking RPC (a 'held' row that keeps the court
// for venue.hold_minutes); this function moves the money. Amounts always come from the database
// (booking_reservations.price_cents / own_cents, booking_shares.cents), never from the client.
//
//   { action: 'config', bookingId }                    -> { paid: true } | { publishableKey, amount, currency, email, setupFutureUsage }
//   { action: 'intent', bookingId }                    -> { paid: true } | { clientSecret, paymentIntentId }
//   { action: 'verify', bookingId, paymentIntentId }   -> { confirmed, status } (+ error when the court was lost)
//   { action: 'cancel', bookingId }                    -> { refundedCents }   the player, before the cancellation limit
//   { action: 'staffCancel', bookingId, refund }       -> { refundedCents }   hall staff; refund defaults to true
//   { action: 'freed', bookingId }                     -> { notified }        after krossi_release_booking / _unblock / _put_on_sale
//   { action: 'shareConfig', shareId }                 -> like config, for my share (a friend's, or my rest share)
//   { action: 'shareIntent', shareId }                 -> like intent
//   { action: 'shareVerify', shareId, paymentIntentId } -> { paid, status } (+ error when the payment went back)
//
// Jaettu maksu: a split booking's booker pays own_cents with setup_future_usage 'off_session', so
// the card is saved for the rest (krossi-booking-cron charges it after the deadline). Confirming
// the booking asks the friends in their chat (krossi_booking_mark_paid) and here by email. A
// friend pays their share in the same Payment Element (metadata.product 'krossi_booking_share').
//
// A succeeded payment is recorded here (verify, and config / intent / cancel when a payment went
// through while the player was away) and in stripe-webhook (payment_intent.succeeded), through
// the shared functions in ../_shared/booking.ts. A payment the booking or share no longer needs
// (the court went to somebody else, it was paid already, it was cancelled) is refunded at once.
// Cancelling refunds every paid part: the booker's own, the friends' shares and a rest share.
//
// Stripe Connect: a venue with stripe_account_id gets a destination charge (transfer_data +
// application_fee_amount from platform_fee_bps); its refunds reverse the transfer and the fee.
//
// When a court frees up (cancel, staffCancel, freed), krossi_booking_watchers_to_notify picks the
// "ilmoita kun vapautuu" watches it satisfies and krossi-notify emails each watcher
// (event booking_slot_free), sent with the caller's own JWT like the app's other notifications.
//
// Secrets: STRIPE_SECRET_KEY + STRIPE_PUBLISHABLE_KEY (same as krossi-payment). There is no
// hosted Checkout fallback for bookings: without a usable publishable key `config` answers 503.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17.7.0';
import {
  BOOKING_PRODUCT, SHARE_PRODUCT, LOST, type BookingRow, afterBookingPaid, connectParams, describeBooking, loadBooking,
  loadPlace, loadVenue, refundParts, settleBookingPayment, settleSharePayment, type Outcome,
} from '../_shared/booking.ts';

// Apple Pay / Google Pay only show on domains registered with Stripe (per mode: test and live).
const PAYMENT_DOMAINS = ['krossi.app', 'www.krossi.app'];
// Stripe's smallest euro charge.
const MIN_CHARGE_CENTS = 50;

const NOT_FOUND = 'Varausta ei löytynyt.';
const SHARE_NOT_FOUND = 'Osuutta ei löytynyt.';
const EXPIRED = 'Varauksen pitoaika ehti umpeutua. Valitse aika uudelleen.';
const TOO_LATE = 'Peruutusaika on mennyt. Ota yhteyttä halliin.';
const NOT_CANCELLABLE = 'Tätä varausta ei voi enää perua.';
const STAFF_ONLY = 'Vain hallin henkilökunta voi tehdä tämän.';
const UNKNOWN_PAYMENT = 'Maksua ei löytynyt.';
const PENDING = 'Maksu on vielä kesken. Odota hetki ja päivitä sivu.';
const SHARE_DUPLICATE = 'Osuutesi oli jo hoidettu — tämä maksu palautettiin.';
const SHARE_CANCELLED = 'Vuoro on peruttu — maksusi palautettiin.';
const STRIPE_DOWN = 'Maksupalvelu ei nyt vastaa. Yritä hetken päästä uudelleen.';
const DB_FAILED = 'Varauksen käsittely epäonnistui. Yritä hetken päästä uudelleen.';

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
const isStripeError = (err: unknown) => /^Stripe/.test(String((err as { type?: unknown })?.type ?? ''));
const isMissing = (err: unknown) => (err as { code?: string })?.code === 'resource_missing';

/**
 * STRIPE_PUBLISHABLE_KEY if it looks real and is from the same mode as the secret key, else null.
 * (Same check as krossi-payment.)
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

// Registers krossi.app for wallets once per worker (krossi-payment does the same).
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

/**
 * The player's Stripe customer in the current mode (same as krossi-payment). A stored id from
 * the other mode or a deleted customer is replaced with a new one.
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

async function customerOf(admin: SupabaseClient, user: { id: string; email?: string }) {
  const { data: profile, error } = await admin.from('profiles').select('stripe_customer_id').eq('id', user.id).maybeSingle();
  if (error) throw new Error(`profile lookup failed: ${error.message}`);
  if (!profile) throw new Reply(400, 'Täytä ensin pelaajaprofiilisi.');
  return ensureCustomer(admin, user.id, user.email, profile.stripe_customer_id);
}

// ── Database ─────────────────────────────────────────────────────────────────

interface ShareRow {
  id: string;
  reservation_id: string;
  user_id: string | null;
  kind: string;
  cents: number;
  status: string;
  stripe_payment_intent_id: string | null;
  invited_at: string | null;
}

const SHARE_COLUMNS = 'id, reservation_id, user_id, kind, cents, status, stripe_payment_intent_id, invited_at';

async function loadShare(admin: SupabaseClient, id: string): Promise<ShareRow | null> {
  const { data, error } = await admin.from('booking_shares').select(SHARE_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`share lookup failed: ${error.message}`);
  return (data as ShareRow | null) ?? null;
}

/** The caller's own booking (kind 'booking'), else 404 — someone else's booking looks the same as none. */
async function myBooking(admin: SupabaseClient, id: unknown, userId: string): Promise<BookingRow> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new Reply(404, NOT_FOUND);
  const booking = await loadBooking(admin, id);
  if (!booking || booking.kind !== 'booking' || booking.booked_by !== userId) throw new Reply(404, NOT_FOUND);
  return booking;
}

/** The caller's share — a friend's once they were asked, a rest share always — else 404. */
async function myShare(admin: SupabaseClient, id: unknown, userId: string): Promise<ShareRow> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new Reply(404, SHARE_NOT_FOUND);
  const share = await loadShare(admin, id);
  if (!share || share.user_id !== userId || (share.kind === 'friend' && !share.invited_at)) throw new Reply(404, SHARE_NOT_FOUND);
  return share;
}

/** Why the share can't be paid now (Finnish, shown as-is), or null (krossi_booking_share_problem). */
async function shareProblem(admin: SupabaseClient, shareId: string): Promise<string | null> {
  const { data, error } = await admin.rpc('krossi_booking_share_problem', { share_id_input: shareId });
  if (error) throw new Error(`krossi_booking_share_problem failed: ${error.message}`);
  return typeof data === 'string' && data ? data : null;
}

const holdIsLive = (b: BookingRow) =>
  b.status === 'held' && Boolean(b.hold_expires_at) && Date.parse(b.hold_expires_at as string) > Date.now();
/** Paid (or free) and still on: nothing left to pay. */
const isSettled = (b: BookingRow) => b.status === 'confirmed' && (b.payment_status === 'paid' || b.payment_status === 'free');
/** What the booker pays now: their own part of a split booking, else the whole price. */
const amountOf = (b: BookingRow) => (b.split_parts ? (b.own_cents ?? b.price_cents) : b.price_cents);
const futureUsageOf = (b: BookingRow) => (b.split_parts ? 'off_session' : null);

// ── Payments ─────────────────────────────────────────────────────────────────

const REUSABLE = ['requires_payment_method', 'requires_confirmation', 'requires_action'];

async function retrieveIntent(id: string): Promise<Stripe.PaymentIntent | null> {
  try {
    return await stripe.paymentIntents.retrieve(id);
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

/** Records a succeeded booking payment; a confirmation then refunds what it bought and emails the friends. */
async function settle(admin: SupabaseClient, intent: Stripe.PaymentIntent): Promise<Outcome> {
  const outcome = await settleBookingPayment(stripe, admin, intent);
  if (outcome === 'confirmed') inBackground(afterBookingPaid(stripe, admin, intent.metadata?.booking_id ?? ''));
  return outcome;
}

/** A stored payment that succeeded while the player was away (closed tab, missed webhook) is recorded now. */
async function settleStored(admin: SupabaseClient, booking: BookingRow): Promise<{ outcome: Outcome | null; booking: BookingRow }> {
  if (booking.payment_status !== 'unpaid' || !booking.stripe_payment_intent_id) return { outcome: null, booking };
  const intent = await retrieveIntent(booking.stripe_payment_intent_id);
  if (intent?.status !== 'succeeded' || intent.metadata?.booking_id !== booking.id) return { outcome: null, booking };
  const outcome = await settle(admin, intent);
  return { outcome, booking: (await loadBooking(admin, booking.id)) ?? booking };
}

/** The same for a share. */
async function settleStoredShare(admin: SupabaseClient, share: ShareRow): Promise<ShareRow> {
  if (share.status === 'paid' || !share.stripe_payment_intent_id) return share;
  const intent = await retrieveIntent(share.stripe_payment_intent_id);
  if (intent?.status !== 'succeeded' || intent.metadata?.share_id !== share.id) return share;
  await settleSharePayment(stripe, admin, intent);
  return (await loadShare(admin, share.id)) ?? share;
}

/**
 * Cancels the booking (krossi_booking_cancel) and refunds every paid part. A refund Stripe
 * doesn't take now stays due and krossi-booking-cron finishes it: the answer still tells what
 * goes back to the booker. → { total, own } cents.
 */
async function cancelAndRefund(admin: SupabaseClient, bookingId: string, by: string, refund: boolean) {
  const { data, error } = await admin.rpc('krossi_booking_cancel', { booking_id_input: bookingId, by_input: by, refund_input: refund });
  if (error) throw new Error(`krossi_booking_cancel failed: ${error.message}`);
  const parts = (Array.isArray(data) ? data : []) as { shareId: string | null; kind: 'own' | 'friend' | 'rest'; paymentIntentId: string; cents: number }[];
  try {
    return await refundParts(stripe, admin, bookingId, parts);
  } catch (err) {
    console.error('refunds left for the cron', bookingId, (err as Error).message);
    const sum = (list: typeof parts) => list.reduce((n, p) => n + p.cents, 0);
    return { total: sum(parts), own: sum(parts.filter((p) => p.kind !== 'friend')) };
  }
}

// ── Watches ──────────────────────────────────────────────────────────────────

/**
 * A court freed up: the watches it satisfies are stamped in the database (once per freed row)
 * and krossi-notify emails each watcher. Never throws: the cancellation itself already happened.
 */
async function notifyWatchers(admin: SupabaseClient, asUser: SupabaseClient, reservationId: string, actorId: string) {
  try {
    const { data, error } = await admin.rpc('krossi_booking_watchers_to_notify', { reservation_id_input: reservationId });
    if (error) throw new Error(error.message);
    const watches = (Array.isArray(data) ? data : []) as { id: string }[];
    const results = await Promise.allSettled(watches.map((watch) =>
      asUser.functions.invoke('krossi-notify', { body: { type: 'booking_slot_free', watchId: watch.id, freedById: actorId } })));
    results.forEach((result, i) => {
      const failure = result.status === 'rejected' ? result.reason : result.value.error;
      if (failure) console.error('krossi-booking: slot email failed', watches[i].id, (failure as Error)?.message ?? failure);
    });
    return watches.length;
  } catch (err) {
    console.error('krossi-booking: watcher lookup failed', reservationId, (err as Error).message);
    return 0;
  }
}

function inBackground(promise: Promise<unknown>) {
  // @ts-ignore EdgeRuntime is the Supabase runtime global
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(promise);
}

// ── Handler ──────────────────────────────────────────────────────────────────

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

  let body: { action?: string; bookingId?: unknown; shareId?: unknown; paymentIntentId?: unknown; refund?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body -> unknown action below */ }

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  try {
    if (body.action === 'config') {
      let booking = await myBooking(admin, body.bookingId, user.id);
      if (isSettled(booking)) return json(req, { paid: true });
      const stored = await settleStored(admin, booking);
      booking = stored.booking;
      if (stored.outcome === 'lost') throw new Reply(409, LOST);
      if (isSettled(booking)) return json(req, { paid: true });
      if (!holdIsLive(booking)) throw new Reply(409, EXPIRED);
      if (amountOf(booking) < MIN_CHARGE_CENTS) throw new Reply(409, 'Varauksen hinta on liian pieni verkkomaksuun.');
      const publishableKey = usablePublishableKey();
      if (!publishableKey) throw new Reply(503, 'Kenttävarausten verkkomaksu ei ole vielä käytössä.');
      inBackground(ensurePaymentDomains());
      return json(req, {
        publishableKey, amount: amountOf(booking), currency: 'eur', email: user.email ?? null, setupFutureUsage: futureUsageOf(booking),
      });
    }

    if (body.action === 'intent') {
      let booking = await myBooking(admin, body.bookingId, user.id);
      if (isSettled(booking)) return json(req, { paid: true });

      // An unfinished payment of this booking is reused; one that went through is recorded.
      const previous = booking.stripe_payment_intent_id ? await retrieveIntent(booking.stripe_payment_intent_id) : null;
      if (previous?.status === 'succeeded' && previous.metadata?.booking_id === booking.id) {
        const outcome = await settle(admin, previous);
        if (outcome === 'lost') throw new Reply(409, LOST);
        booking = (await loadBooking(admin, booking.id)) ?? booking;
        if (isSettled(booking)) return json(req, { paid: true });
      }
      if (previous?.status === 'processing') throw new Reply(409, PENDING);
      const amount = amountOf(booking);
      const futureUsage = futureUsageOf(booking);
      // The split changed (or not) since that payment was started: only the same one is reused.
      const reusable = previous && REUSABLE.includes(previous.status) && previous.amount === amount
        && (previous.setup_future_usage ?? null) === futureUsage && previous.metadata?.booking_id === booking.id ? previous : null;

      if (!holdIsLive(booking)) {
        // Too late to pay: make sure the old payment can't be finished either.
        if (reusable) {
          await stripe.paymentIntents.cancel(reusable.id, { cancellation_reason: 'abandoned' }).catch((err) =>
            console.error('cancelling an expired booking payment failed', (err as Error).message));
        }
        throw new Reply(409, EXPIRED);
      }
      if (reusable) return json(req, { clientSecret: reusable.client_secret, paymentIntentId: reusable.id });
      if (previous && REUSABLE.includes(previous.status)) {
        await stripe.paymentIntents.cancel(previous.id, { cancellation_reason: 'abandoned' }).catch((err) =>
          console.error('cancelling an outdated booking payment failed', (err as Error).message));
      }
      if (amount < MIN_CHARGE_CENTS) throw new Reply(409, 'Varauksen hinta on liian pieni verkkomaksuun.');

      const [venue, place, customerId] = await Promise.all([
        loadVenue(admin, booking.venue_id), loadPlace(admin, booking.court_id), customerOf(admin, user),
      ]);
      const params: Stripe.PaymentIntentCreateParams = {
        amount,
        currency: 'eur',
        customer: customerId,
        automatic_payment_methods: { enabled: true },
        description: describeBooking(booking, venue, place),
        receipt_email: user.email || undefined,
        metadata: { product: BOOKING_PRODUCT, booking_id: booking.id, venue_id: booking.venue_id, supabase_user_id: user.id },
        ...connectParams(venue, amount),
      };
      // Jaettu maksu: the card stays on the customer for the rest of the friends' shares.
      if (futureUsage) params.setup_future_usage = futureUsage;
      // Two taps at once get the same intent: the key names the booking and the intent it replaces.
      const intent = await stripe.paymentIntents.create(params, {
        idempotencyKey: `krossi-booking-intent-${booking.id}-${booking.stripe_payment_intent_id ?? 'first'}`,
      });

      // Store it unless the booking changed meanwhile (paid, or another intent stored first).
      let store = admin.from('booking_reservations')
        .update({ stripe_payment_intent_id: intent.id })
        .eq('id', booking.id)
        .eq('payment_status', 'unpaid');
      store = booking.stripe_payment_intent_id
        ? store.eq('stripe_payment_intent_id', booking.stripe_payment_intent_id)
        : store.is('stripe_payment_intent_id', null);
      const { data: stored, error: storeError } = await store.select('id');
      if (storeError) throw new Error(`storing the payment intent failed: ${storeError.message}`);
      if (!stored?.length) {
        const latest = await loadBooking(admin, booking.id);
        if (latest?.stripe_payment_intent_id !== intent.id) {
          await stripe.paymentIntents.cancel(intent.id, { cancellation_reason: 'duplicate' }).catch((err) =>
            console.error('cancelling a duplicate booking payment failed', (err as Error).message));
          if (latest && isSettled(latest)) return json(req, { paid: true });
          const theirs = latest?.stripe_payment_intent_id ? await retrieveIntent(latest.stripe_payment_intent_id) : null;
          if (!theirs || !REUSABLE.includes(theirs.status)) throw new Reply(409, 'Maksun aloitus on jo käynnissä. Yritä hetken päästä uudelleen.');
          return json(req, { clientSecret: theirs.client_secret, paymentIntentId: theirs.id });
        }
      }
      return json(req, { clientSecret: intent.client_secret, paymentIntentId: intent.id });
    }

    if (body.action === 'verify') {
      const id = typeof body.paymentIntentId === 'string' ? body.paymentIntentId : '';
      if (!/^pi_[A-Za-z0-9]+$/.test(id)) throw new Reply(400, UNKNOWN_PAYMENT);
      const booking = await myBooking(admin, body.bookingId, user.id);
      const intent = await retrieveIntent(id);
      if (!intent || intent.metadata?.product !== BOOKING_PRODUCT || intent.metadata?.booking_id !== booking.id
        || intent.metadata?.supabase_user_id !== user.id) {
        throw new Reply(403, UNKNOWN_PAYMENT);
      }
      if (intent.status !== 'succeeded') return json(req, { confirmed: false, status: intent.status });
      const outcome = await settle(admin, intent);
      if (outcome === 'confirmed') return json(req, { confirmed: true, status: 'succeeded' });
      if (outcome === 'lost') return json(req, { confirmed: false, status: 'lost', error: LOST });
      // 'duplicate' (this payment was refunded, another one paid the booking) / 'cancelled'
      const latest = await loadBooking(admin, booking.id);
      const confirmed = latest?.status === 'confirmed';
      // The webhook got here first and refunded a lost court: same answer as above.
      if (!confirmed && latest?.payment_status === 'refunded' && latest.cancelled_by === null
        && latest.stripe_payment_intent_id === intent.id) {
        return json(req, { confirmed: false, status: 'lost', error: LOST });
      }
      return json(req, { confirmed, status: confirmed ? 'succeeded' : 'cancelled' });
    }

    if (body.action === 'cancel') {
      let booking = await myBooking(admin, body.bookingId, user.id);
      ({ booking } = await settleStored(admin, booking));
      if (booking.status !== 'confirmed') throw new Reply(409, NOT_CANCELLABLE);
      const venue = await loadVenue(admin, booking.venue_id);
      if (Date.now() >= Date.parse(booking.starts_at) - venue.cancel_limit_hours * 3_600_000) throw new Reply(409, TOO_LATE);
      const { own } = await cancelAndRefund(admin, booking.id, user.id, true);
      inBackground(notifyWatchers(admin, asUser, booking.id, user.id));
      return json(req, { refundedCents: own });
    }

    if (body.action === 'staffCancel') {
      if (typeof body.bookingId !== 'string' || !UUID_RE.test(body.bookingId)) throw new Reply(404, NOT_FOUND);
      let booking = await loadBooking(admin, body.bookingId);
      if (!booking || booking.kind !== 'booking') throw new Reply(404, NOT_FOUND);
      const { data: isStaff, error: staffError } = await asUser.rpc('krossi_booking_is_staff', { venue_id: booking.venue_id });
      if (staffError) throw new Error(`staff check failed: ${staffError.message}`);
      if (isStaff !== true) throw new Reply(403, STAFF_ONLY);

      ({ booking } = await settleStored(admin, booking));
      if (booking.status !== 'confirmed' && !holdIsLive(booking)) return json(req, { refundedCents: 0 });
      if (booking.payment_status === 'unpaid' && booking.stripe_payment_intent_id) {
        // A hold the hall cancels must not be payable any more (a late payment would be refunded anyway).
        await stripe.paymentIntents.cancel(booking.stripe_payment_intent_id, { cancellation_reason: 'abandoned' }).catch((err) =>
          console.error('cancelling the payment of a cancelled hold failed', (err as Error).message));
      }
      const { total } = await cancelAndRefund(admin, booking.id, user.id, body.refund !== false);
      inBackground(notifyWatchers(admin, asUser, booking.id, user.id));
      return json(req, { refundedCents: total });
    }

    if (body.action === 'freed') {
      if (typeof body.bookingId !== 'string' || !UUID_RE.test(body.bookingId)) throw new Reply(404, NOT_FOUND);
      // The database checks that the row really is freed (or on sale) and handles it only once.
      return json(req, { notified: await notifyWatchers(admin, asUser, body.bookingId, user.id) });
    }

    if (body.action === 'shareConfig') {
      const share = await settleStoredShare(admin, await myShare(admin, body.shareId, user.id));
      if (share.status === 'paid') return json(req, { paid: true });
      const problem = await shareProblem(admin, share.id);
      if (problem) throw new Reply(409, problem);
      const publishableKey = usablePublishableKey();
      if (!publishableKey) throw new Reply(503, 'Kenttävarausten verkkomaksu ei ole vielä käytössä.');
      inBackground(ensurePaymentDomains());
      return json(req, { publishableKey, amount: share.cents, currency: 'eur', email: user.email ?? null, setupFutureUsage: null });
    }

    if (body.action === 'shareIntent') {
      let share = await myShare(admin, body.shareId, user.id);
      if (share.status === 'paid') return json(req, { paid: true });
      const previous = share.stripe_payment_intent_id ? await retrieveIntent(share.stripe_payment_intent_id) : null;
      if (previous?.status === 'succeeded' && previous.metadata?.share_id === share.id) {
        const outcome = await settleSharePayment(stripe, admin, previous);
        if (outcome === 'paid') return json(req, { paid: true });
        share = (await loadShare(admin, share.id)) ?? share;
      }
      if (previous?.status === 'processing') throw new Reply(409, PENDING);
      const reusable = previous && REUSABLE.includes(previous.status) && previous.amount === share.cents
        && previous.metadata?.share_id === share.id && previous.metadata?.charge !== 'off_session' ? previous : null;
      const problem = await shareProblem(admin, share.id);
      if (problem) {
        if (reusable) {
          await stripe.paymentIntents.cancel(reusable.id, { cancellation_reason: 'abandoned' }).catch((err) =>
            console.error('cancelling a share payment that is no longer needed failed', (err as Error).message));
        }
        throw new Reply(409, problem);
      }
      if (reusable) return json(req, { clientSecret: reusable.client_secret, paymentIntentId: reusable.id });
      if (previous && REUSABLE.includes(previous.status)) {
        await stripe.paymentIntents.cancel(previous.id, { cancellation_reason: 'abandoned' }).catch((err) =>
          console.error('cancelling an outdated share payment failed', (err as Error).message));
      }
      const booking = await loadBooking(admin, share.reservation_id);
      if (!booking) throw new Reply(404, SHARE_NOT_FOUND);
      const [venue, place, customerId] = await Promise.all([
        loadVenue(admin, booking.venue_id), loadPlace(admin, booking.court_id), customerOf(admin, user),
      ]);
      const params: Stripe.PaymentIntentCreateParams = {
        amount: share.cents,
        currency: 'eur',
        customer: customerId,
        automatic_payment_methods: { enabled: true },
        description: `${share.kind === 'rest' ? 'Loppuosuus' : 'Osuus'}: ${describeBooking(booking, venue, place)}`,
        receipt_email: user.email || undefined,
        metadata: {
          product: SHARE_PRODUCT, share_id: share.id, booking_id: booking.id, venue_id: booking.venue_id, supabase_user_id: user.id,
        },
        ...connectParams(venue, share.cents),
      };
      const intent = await stripe.paymentIntents.create(params, {
        idempotencyKey: `krossi-share-intent-${share.id}-${share.stripe_payment_intent_id ?? 'first'}`,
      });
      let store = admin.from('booking_shares')
        .update({ stripe_payment_intent_id: intent.id })
        .eq('id', share.id)
        .in('status', ['pending', 'declined']);
      store = share.stripe_payment_intent_id
        ? store.eq('stripe_payment_intent_id', share.stripe_payment_intent_id)
        : store.is('stripe_payment_intent_id', null);
      const { data: stored, error: storeError } = await store.select('id');
      if (storeError) throw new Error(`storing the share payment failed: ${storeError.message}`);
      if (!stored?.length) {
        await stripe.paymentIntents.cancel(intent.id, { cancellation_reason: 'duplicate' }).catch((err) =>
          console.error('cancelling a duplicate share payment failed', (err as Error).message));
        const latest = await loadShare(admin, share.id);
        if (latest?.status === 'paid') return json(req, { paid: true });
        throw new Reply(409, 'Maksun aloitus on jo käynnissä. Yritä hetken päästä uudelleen.');
      }
      return json(req, { clientSecret: intent.client_secret, paymentIntentId: intent.id });
    }

    if (body.action === 'shareVerify') {
      const id = typeof body.paymentIntentId === 'string' ? body.paymentIntentId : '';
      if (!/^pi_[A-Za-z0-9]+$/.test(id)) throw new Reply(400, UNKNOWN_PAYMENT);
      const share = await myShare(admin, body.shareId, user.id);
      const intent = await retrieveIntent(id);
      if (!intent || intent.metadata?.product !== SHARE_PRODUCT || intent.metadata?.share_id !== share.id
        || intent.metadata?.supabase_user_id !== user.id) {
        throw new Reply(403, UNKNOWN_PAYMENT);
      }
      if (intent.status !== 'succeeded') return json(req, { paid: false, status: intent.status });
      const outcome = await settleSharePayment(stripe, admin, intent);
      if (outcome === 'paid') return json(req, { paid: true, status: 'succeeded' });
      return json(req, { paid: false, status: 'refunded', error: outcome === 'duplicate' ? SHARE_DUPLICATE : SHARE_CANCELLED });
    }

    throw new Reply(400, 'Tuntematon toiminto.');
  } catch (err) {
    if (err instanceof Reply) return json(req, { error: err.message }, err.status);
    const stripeFailed = isStripeError(err);
    console.error(`krossi-booking ${body.action} failed`, (err as Error).message);
    return json(req, { error: stripeFailed ? STRIPE_DOWN : DB_FAILED }, stripeFailed ? 502 : 500);
  }
});
