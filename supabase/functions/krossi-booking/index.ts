// krossi-booking — kenttävarauksen maksu ja peruutus (krossi.app/pelaa/varaa).
//
// The booking itself is made by the krossi_hold_booking RPC (a 'held' row that keeps the court
// for venue.hold_minutes); this function moves the money. The amount always comes from the
// database (booking_reservations.price_cents), never from the client.
//
//   { action: 'config', bookingId }                  -> { paid: true } | { publishableKey, amount, currency, email }
//   { action: 'intent', bookingId }                  -> { paid: true } | { clientSecret, paymentIntentId }
//   { action: 'verify', bookingId, paymentIntentId } -> { confirmed, status } (+ error when the court was lost)
//   { action: 'cancel', bookingId }                  -> { refundedCents }   the player, before the cancellation limit
//   { action: 'staffCancel', bookingId, refund }     -> { refundedCents }   hall staff; refund defaults to true
//   { action: 'freed', bookingId }                   -> { notified }        after krossi_release_booking / _unblock
//
// A succeeded payment is confirmed through krossi_booking_mark_paid, here (verify, and config /
// intent / cancel when a payment went through while the player was away) and in stripe-webhook
// (payment_intent.succeeded). If the hold ran out and somebody else took the court meanwhile,
// the payment is refunded at once ('lost'). Refunds use the idempotency key
// `krossi-booking-refund-<payment intent>` in both functions, so a payment is refunded once.
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

const PRODUCT = 'krossi_booking';
// Apple Pay / Google Pay only show on domains registered with Stripe (per mode: test and live).
const PAYMENT_DOMAINS = ['krossi.app', 'www.krossi.app'];
// Stripe's smallest euro charge.
const MIN_CHARGE_CENTS = 50;

const NOT_FOUND = 'Varausta ei löytynyt.';
const EXPIRED = 'Varauksen pitoaika ehti umpeutua. Valitse aika uudelleen.';
const LOST = 'Aika ehti mennä toiselle — maksu palautettiin.';
const TOO_LATE = 'Peruutusaika on mennyt. Ota yhteyttä halliin.';
const NOT_CANCELLABLE = 'Tätä varausta ei voi enää perua.';
const STAFF_ONLY = 'Vain hallin henkilökunta voi tehdä tämän.';
const UNKNOWN_PAYMENT = 'Maksua ei löytynyt.';
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

// ── Database ─────────────────────────────────────────────────────────────────

interface BookingRow {
  id: string;
  venue_id: string;
  court_id: string;
  starts_at: string;
  ends_at: string;
  kind: string;
  status: string;
  booked_by: string | null;
  price_cents: number;
  payment_status: string;
  hold_expires_at: string | null;
  stripe_payment_intent_id: string | null;
  cancelled_by: string | null;
}

interface VenueRow {
  id: string;
  name: string;
  timezone: string;
  cancel_limit_hours: number;
  stripe_account_id: string | null;
  platform_fee_bps: number;
}

const BOOKING_COLUMNS = 'id, venue_id, court_id, starts_at, ends_at, kind, status, booked_by, price_cents, ' +
  'payment_status, hold_expires_at, stripe_payment_intent_id, cancelled_by';

async function loadBooking(admin: SupabaseClient, id: string): Promise<BookingRow | null> {
  const { data, error } = await admin.from('booking_reservations').select(BOOKING_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`booking lookup failed: ${error.message}`);
  return (data as BookingRow | null) ?? null;
}

async function loadVenue(admin: SupabaseClient, id: string): Promise<VenueRow> {
  const { data, error } = await admin.from('booking_venues')
    .select('id, name, timezone, cancel_limit_hours, stripe_account_id, platform_fee_bps').eq('id', id).single();
  if (error) throw new Error(`venue lookup failed: ${error.message}`);
  return data as VenueRow;
}

async function loadPlace(admin: SupabaseClient, courtId: string): Promise<{ courtName: string; locationName: string }> {
  const { data: court, error } = await admin.from('booking_courts').select('name, location_id').eq('id', courtId).single();
  if (error) throw new Error(`court lookup failed: ${error.message}`);
  const { data: location, error: locationError } = await admin.from('booking_locations')
    .select('name').eq('id', court.location_id).single();
  if (locationError) throw new Error(`location lookup failed: ${locationError.message}`);
  return { courtName: court.name as string, locationName: location.name as string };
}

/** The caller's own booking (kind 'booking'), else 404 — someone else's booking looks the same as none. */
async function myBooking(admin: SupabaseClient, id: unknown, userId: string): Promise<BookingRow> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new Reply(404, NOT_FOUND);
  const booking = await loadBooking(admin, id);
  if (!booking || booking.kind !== 'booking' || booking.booked_by !== userId) throw new Reply(404, NOT_FOUND);
  return booking;
}

const holdIsLive = (b: BookingRow) =>
  b.status === 'held' && Boolean(b.hold_expires_at) && Date.parse(b.hold_expires_at as string) > Date.now();
/** Paid (or free) and still on: nothing left to pay. */
const isSettled = (b: BookingRow) => b.status === 'confirmed' && (b.payment_status === 'paid' || b.payment_status === 'free');

async function markCancelled(admin: SupabaseClient, bookingId: string, refunded: boolean, refundId: string | null, by: string | null) {
  const { error } = await admin.rpc('krossi_booking_mark_cancelled', {
    booking_id_input: bookingId,
    refunded_input: refunded,
    refund_id_input: refundId,
    by_input: by,
  });
  if (error) throw new Error(`krossi_booking_mark_cancelled failed: ${error.message}`);
}

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

/**
 * Refunds a whole booking payment. The idempotency key is shared with stripe-webhook, so verify
 * and the webhook racing over a lost court refund it once. A destination charge (Connect)
 * takes the money back from the hall and returns Krossi's fee too.
 */
async function refundIntent(intent: Stripe.PaymentIntent, bookingId: string): Promise<Stripe.Refund> {
  const params: Stripe.RefundCreateParams = {
    payment_intent: intent.id,
    metadata: { product: PRODUCT, booking_id: bookingId },
  };
  if (intent.transfer_data?.destination) params.reverse_transfer = true;
  if (intent.application_fee_amount) params.refund_application_fee = true;
  try {
    return await stripe.refunds.create(params, { idempotencyKey: `krossi-booking-refund-${intent.id}` });
  } catch (err) {
    // Refunded already (e.g. by hand in the Dashboard): use that refund.
    if ((err as { code?: string }).code === 'charge_already_refunded') {
      const { data } = await stripe.refunds.list({ payment_intent: intent.id, limit: 1 });
      if (data[0]) return data[0];
    }
    throw err;
  }
}

type Outcome = 'confirmed' | 'lost' | 'duplicate' | 'cancelled';

/**
 * Records a succeeded booking payment (krossi_booking_mark_paid). 'lost' (the court went to
 * somebody else) and 'duplicate' (the booking was already paid by another payment) refund this
 * payment; a lost booking is then marked cancelled + refunded.
 */
async function settle(admin: SupabaseClient, intent: Stripe.PaymentIntent): Promise<Outcome> {
  const bookingId = intent.metadata?.booking_id ?? '';
  const { data, error } = await admin.rpc('krossi_booking_mark_paid', {
    booking_id_input: bookingId,
    payment_intent_id_input: intent.id,
  });
  if (error) throw new Error(`krossi_booking_mark_paid failed: ${error.message}`);
  const outcome = data as Outcome;
  if (outcome === 'lost' || outcome === 'duplicate') {
    const refund = await refundIntent(intent, bookingId);
    if (outcome === 'lost') await markCancelled(admin, bookingId, true, refund.id, null);
  }
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

// 'Kenttävaraus: Tennis 3, Janus-Areena, to 16.10. klo 18.00–19.30' in the venue's time.
const WEEKDAYS: Record<string, string> = { Mon: 'ma', Tue: 'ti', Wed: 'ke', Thu: 'to', Fri: 'pe', Sat: 'la', Sun: 'su' };
function localParts(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    weekday: WEEKDAYS[part('weekday')] ?? '',
    day: String(Number(part('day'))),
    month: String(Number(part('month'))),
    time: `${Number(part('hour'))}.${part('minute').padStart(2, '0')}`,
  };
}
function describeBooking(booking: BookingRow, venue: VenueRow, place: { courtName: string; locationName: string }) {
  const timeZone = venue.timezone || 'Europe/Helsinki';
  const start = localParts(booking.starts_at, timeZone);
  const end = localParts(booking.ends_at, timeZone);
  return `Kenttävaraus: ${place.courtName}, ${place.locationName}, ${start.weekday} ${start.day}.${start.month}. klo ${start.time}–${end.time}`;
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

  let body: { action?: string; bookingId?: unknown; paymentIntentId?: unknown; refund?: unknown } = {};
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
      if (booking.price_cents < MIN_CHARGE_CENTS) throw new Reply(409, 'Varauksen hinta on liian pieni verkkomaksuun.');
      const publishableKey = usablePublishableKey();
      if (!publishableKey) throw new Reply(503, 'Kenttävarausten verkkomaksu ei ole vielä käytössä.');
      inBackground(ensurePaymentDomains());
      return json(req, { publishableKey, amount: booking.price_cents, currency: 'eur', email: user.email ?? null });
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
      if (previous?.status === 'processing') throw new Reply(409, 'Maksu on vielä kesken. Odota hetki ja päivitä sivu.');
      const reusable = previous && REUSABLE.includes(previous.status) && previous.amount === booking.price_cents
        && previous.metadata?.booking_id === booking.id ? previous : null;

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
      if (booking.price_cents < MIN_CHARGE_CENTS) throw new Reply(409, 'Varauksen hinta on liian pieni verkkomaksuun.');

      const { data: profile, error: profileError } = await admin.from('profiles')
        .select('stripe_customer_id').eq('id', user.id).maybeSingle();
      if (profileError) throw new Error(`profile lookup failed: ${profileError.message}`);
      if (!profile) throw new Reply(400, 'Täytä ensin pelaajaprofiilisi.');

      const [venue, place] = await Promise.all([loadVenue(admin, booking.venue_id), loadPlace(admin, booking.court_id)]);
      const customerId = await ensureCustomer(admin, user.id, user.email, profile.stripe_customer_id);
      const params: Stripe.PaymentIntentCreateParams = {
        amount: booking.price_cents,
        currency: 'eur',
        customer: customerId,
        automatic_payment_methods: { enabled: true },
        description: describeBooking(booking, venue, place),
        receipt_email: user.email || undefined,
        metadata: { product: PRODUCT, booking_id: booking.id, venue_id: booking.venue_id, supabase_user_id: user.id },
      };
      if (venue.stripe_account_id) {
        params.transfer_data = { destination: venue.stripe_account_id };
        const fee = Math.floor((booking.price_cents * (venue.platform_fee_bps || 0)) / 10_000);
        if (fee > 0) params.application_fee_amount = fee;
      }
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
      if (!intent || intent.metadata?.product !== PRODUCT || intent.metadata?.booking_id !== booking.id
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

      let refund: Stripe.Refund | null = null;
      if (booking.payment_status === 'paid') {
        if (!booking.stripe_payment_intent_id) throw new Error(`paid booking ${booking.id} has no payment intent`);
        refund = await refundIntent(await stripe.paymentIntents.retrieve(booking.stripe_payment_intent_id), booking.id);
      }
      await markCancelled(admin, booking.id, Boolean(refund), refund?.id ?? null, user.id);
      inBackground(notifyWatchers(admin, asUser, booking.id, user.id));
      return json(req, { refundedCents: refund?.amount ?? 0 });
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

      let refund: Stripe.Refund | null = null;
      if (body.refund !== false && booking.payment_status === 'paid' && booking.stripe_payment_intent_id) {
        refund = await refundIntent(await stripe.paymentIntents.retrieve(booking.stripe_payment_intent_id), booking.id);
      } else if (booking.payment_status === 'unpaid' && booking.stripe_payment_intent_id) {
        // A hold the hall cancels must not be payable any more (a late payment would be refunded anyway).
        await stripe.paymentIntents.cancel(booking.stripe_payment_intent_id, { cancellation_reason: 'abandoned' }).catch((err) =>
          console.error('cancelling the payment of a cancelled hold failed', (err as Error).message));
      }
      await markCancelled(admin, booking.id, Boolean(refund), refund?.id ?? null, user.id);
      inBackground(notifyWatchers(admin, asUser, booking.id, user.id));
      return json(req, { refundedCents: refund?.amount ?? 0 });
    }

    if (body.action === 'freed') {
      if (typeof body.bookingId !== 'string' || !UUID_RE.test(body.bookingId)) throw new Reply(404, NOT_FOUND);
      // The database checks that the row really is cancelled/expired and handles it only once.
      return json(req, { notified: await notifyWatchers(admin, asUser, body.bookingId, user.id) });
    }

    throw new Reply(400, 'Tuntematon toiminto.');
  } catch (err) {
    if (err instanceof Reply) return json(req, { error: err.message }, err.status);
    const stripeFailed = isStripeError(err);
    console.error(`krossi-booking ${body.action} failed`, (err as Error).message);
    return json(req, { error: stripeFailed ? STRIPE_DOWN : DB_FAILED }, stripeFailed ? 502 : 500);
  }
});
