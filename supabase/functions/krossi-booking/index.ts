// krossi-booking — kenttävarauksen maksu ja peruutus (krossi.app/pelaa/varaa) ja jaetun vuoron
// kaverin osuus (krossi.app/pelaa/maksa/<token>).
//
// The booking itself is made by the krossi_hold_booking RPC (a 'held' row that keeps the court
// for venue.hold_minutes); this function moves the money. Amounts always come from the database,
// never from the client: price_cents minus the gift balance the player put on the hold
// (gift_cents, krossi_wallet_use_gift — that share leaves the balance when the payment is
// recorded: krossi_booking_mark_paid gets the amount actually paid), and a split's share
// (booking_reservations.split_cents). A booking paid in full with a series card or gift balance
// (payment_status 'credit') has nothing to pay here.
//
//   { action: 'payConfig' }                            -> { publishableKey, currency, email }   the checkout before a hold
//   { action: 'config', bookingId }                    -> { paid: true } | { publishableKey, amount, currency, email }
//   { action: 'intent', bookingId }                    -> { paid: true } | { clientSecret, paymentIntentId }
//   { action: 'verify', bookingId, paymentIntentId }   -> { confirmed, status } (+ error when the court was lost)
//   { action: 'confirmed', bookingId }                 -> { ok }   after a series card / gift balance confirmed my booking
//                                                         (krossi_wallet_pay_booking / _use_gift): refunds what it took over
//   { action: 'cancel', bookingId, toSaldo? }          -> { refundedCents, feeCents, creditCents, creditMinutes }   the player, before the
//                                                         cancellation limit; feeCents = the peruutuskulu kept of the card money.
//                                                         toSaldo: the card part goes to my saldo at the hall whole instead
//                                                         (no peruutuskulu, no Stripe refund; creditCents)
//   { action: 'staffCancel', bookingId, refund }       -> { refundedCents, feeCents, creditCents, creditMinutes }   hall staff; refund defaults
//                                                         to true; everything goes back (feeCents 0)
//   { action: 'freed', bookingId }                     -> { notified }        after krossi_release_booking / _unblock / _put_on_sale
//
// Jaettu maksu — no sign-in needed, the split's secret token is the key:
//   { action: 'splitConfig', token }                   -> { full: true } | { over: true } | { publishableKey, amount, currency }
//   { action: 'splitIntent', token, name, paymentIntentId? }
//                                                      -> { clientSecret, paymentIntentId } | { full: true } | { paid: true }
//   { action: 'splitVerify', token, paymentIntentId }  -> { paid, status, message? }
//   { action: 'splitSaldo', token }                    -> { paid: true } | { full: true }   signed in: my share paid from my
//                                                         saldo at the same hall (no Stripe payment); 409 when it doesn't reach
// splitIntent claims one open share for 15 minutes (krossi_split_claim), so two friends paying at
// once can't both take the last one; `name` (optional, ≤ 40 characters) is shown to the booker, and
// a signed-in friend's profile name wins. Passing the paymentIntentId of one's own earlier,
// unfinished share payment resumes it ({ paid: true } when it already went through). A cancelled
// or sold booking answers 409 'Vuoro on peruttu…', a started one 409 'Vuoro on jo alkanut.' (or
// splitConfig's { over: true }), the booker's own splitIntent 409, an unknown token 404.
//
// Vieras — a court booked without an account (migration 20261021083557_krossi_booking_guest): name
// and email, then the same hold + payment as a player's. The booking's own secret link token is the
// key; nothing here needs a session:
//   { action: 'payConfig' }  without signing in too   -> { publishableKey, currency, email: null, guests: true }
//   { action: 'guestHold', courtId, startsAt, minutes, name, email }
//                                                      -> { booking, token }   (krossi_guest_hold_booking; two unpaid
//                                                         holds per address — a hash of the caller's IP — and 20 per hall)
//   { action: 'guestIntent', token }                   -> { paid: true } | { clientSecret, paymentIntentId }
//   { action: 'guestVerify', token, paymentIntentId }  -> { confirmed, status } (+ error when the court was lost)
//   { action: 'guestRelease', token }                  -> { ok }   the guest closed the payment: the hold ends now
//   { action: 'guestBooking', token }                  -> { booking, guest: { name, email }, venue, cancelledByGuest }
//                                                         the guest's page (krossi.app/pelaa/varaus/<token>); a payment
//                                                         that went through while they were away is recorded first
//   { action: 'guestCancel', token }                   -> { refundedCents, feeCents }   before the cancellation limit;
//                                                         the peruutuskulu stays as in a player's own cancellation
// A guest pays with a card / wallet / MobilePay only (no saldo, series cards, split or resale) and
// gets the confirmation with the link by email (../_shared/guestMail.ts, sent once when the payment
// is recorded — here, in stripe-webhook or by krossi-booking-cron). Hall staff see the guest's name
// and email (krossi_booking_staff_day); a guest booking the hall cancels mails the guest.
//
// The booker always pays the whole booking with any method (a plain PaymentIntent, so MobilePay
// works too). When a friend's share payment succeeds (splitVerify here, payment_intent.succeeded in
// stripe-webhook — whichever comes first), the share is recorded and the same amount is refunded
// from the booker's payment; the booker gets an email. A payment the split can't take any more is
// refunded to the friend at once and splitVerify says why (status 'refunded' + message).
//
// Saldo (migration 20261021071731_krossi_booking_saldo): a booking paid with the saldo can be split
// too, and a share goes back where the booker paid from — the saldo part into their saldo at once
// (krossi_split_mark_paid; no refund), the rest from their card payment as above. A signed-in friend
// with saldo at the same hall pays from it (splitSaldo → krossi_split_pay_saldo): their own card
// payment of the share started before is recorded if it went through, else cancelled first. The
// player's own cancellation can put the card part into the saldo whole (toSaldo: no peruutuskulu,
// nothing through Stripe; friends still get their payments back).
//
// A succeeded payment is recorded here (verify, splitVerify, and config / intent / cancel when a
// payment went through while the player was away) and in stripe-webhook, through the shared
// functions in ../_shared/booking.ts. Cancelling refunds what is left of the booker's payment and
// every friend's paid share; krossi_booking_cancel gives credit back (a series card's minutes, the
// gift share to the balance). The player's own cancellation keeps the peruutuskulu (1 €, fees.ts)
// of their card money; the hall's gives everything back.
//
// Stripe Connect (../_shared/fees.ts): every payment is a destination charge to the hall's account
// with the hall as the seller (on_behalf_of) and Krossi's fee = Stripe's estimated cost + the
// hall's margin; a refund takes the money back from the hall and Krossi keeps its fee. A public
// hall whose account isn't connected and ready takes no payments: config, intent, splitConfig and
// splitIntent answer 503 'Hallin verkkomaksu ei ole vielä käytössä.' (a hidden hall without an
// account still charges on Krossi's own account, for testing).
//
// When a court frees up (cancel, staffCancel, freed), krossi_booking_watchers_to_notify picks the
// "ilmoita kun vapautuu" watches it satisfies and krossi-notify emails each watcher
// (event booking_slot_free), sent with the caller's own JWT like the app's other notifications.
//
// Deploy with verify_jwt = false (`--no-verify-jwt`): friends pay their share and guests book without
// signing in, and the app's publishable key is not a JWT. Every other action checks the caller's JWT
// here (auth.getUser) and answers 401 without a signed-in player.
//
// Secrets: STRIPE_SECRET_KEY + STRIPE_PUBLISHABLE_KEY (same as krossi-payment). There is no
// hosted Checkout fallback for bookings: without a usable publishable key the configs answer 503.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17.7.0';
import {
  BOOKING_PRODUCT, SPLIT_PRODUCT, LOST, type BookingRow, type SplitRefundReason, HALL_NOT_CONNECTED, HallNotConnected,
  afterBookingPaid, cancelFeeOf, cancelPendingShares, connectParams, describeBooking, loadBooking, loadPlace, loadVenue,
  notifyInternal, paysCancelFee, refundBooker, refundParts, settleBookingPayment, settleSplitPayment, takesPayments, type Outcome,
} from '../_shared/booking.ts';
import { mailGuestHallCancelled } from '../_shared/guestMail.ts';

// Apple Pay / Google Pay only show on domains registered with Stripe (per mode: test and live).
const PAYMENT_DOMAINS = ['krossi.app', 'www.krossi.app'];
// Stripe's smallest euro charge.
const MIN_CHARGE_CENTS = 50;

const NOT_FOUND = 'Varausta ei löytynyt.';
const EXPIRED = 'Varauksen pitoaika ehti umpeutua. Valitse aika uudelleen.';
const TOO_LATE = 'Peruutusaika on mennyt. Ota yhteyttä halliin.';
const NOT_CANCELLABLE = 'Tätä varausta ei voi enää perua.';
const STAFF_ONLY = 'Vain hallin henkilökunta voi tehdä tämän.';
const UNKNOWN_PAYMENT = 'Maksua ei löytynyt.';
const PENDING = 'Maksu on vielä kesken. Odota hetki ja päivitä sivu.';
const NOT_IN_USE = 'Kenttävarausten verkkomaksu ei ole vielä käytössä.';
const SPLIT_NOT_FOUND = 'Maksulinkkiä ei löytynyt.';
const SPLIT_CANCELLED = 'Vuoro on peruttu — osuutta ei tarvitse maksaa.';
const SPLIT_OVER = 'Vuoro on jo alkanut.';
const SPLIT_OWN = 'Tämä on oma vuorosi — lähetä linkki kavereillesi.';
const CLAIM_LOST = 'Osuuden maksu ehti vanhentua. Yritä uudelleen.';
const SALDO_SHORT = 'Saldosi tässä hallissa ei riitä osuuteen.';
const SPLIT_REFUNDED: Record<SplitRefundReason, string> = {
  cancelled: 'Vuoro peruttiin — maksusi palautettiin.',
  changed: 'Vuoron maksun jako muuttui — maksusi palautettiin.',
  full: 'Kaikki osuudet ehdittiin jo maksaa — maksusi palautettiin.',
};
const STRIPE_DOWN = 'Maksupalvelu ei nyt vastaa. Yritä hetken päästä uudelleen.';
const DB_FAILED = 'Varauksen käsittely epäonnistui. Yritä hetken päästä uudelleen.';

// These work without signing in: the split's token (or the guest booking's) is the key.
const SPLIT_ACTIONS = new Set(['splitConfig', 'splitIntent', 'splitVerify']);
const GUEST_ACTIONS = new Set(['payConfig', 'guestHold', 'guestIntent', 'guestVerify', 'guestRelease', 'guestBooking', 'guestCancel']);

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
const INTENT_RE = /^pi_[A-Za-z0-9]+$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;
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

/** The publishable key for a checkout, else 503; registers krossi.app for wallets in the background. */
function checkoutKey() {
  const publishableKey = usablePublishableKey();
  if (!publishableKey) throw new Reply(503, NOT_IN_USE);
  inBackground(ensurePaymentDomains());
  return publishableKey;
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

/** The caller's own booking (kind 'booking'), else 404 — someone else's booking looks the same as none. */
async function myBooking(admin: SupabaseClient, id: unknown, userId: string): Promise<BookingRow> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new Reply(404, NOT_FOUND);
  const booking = await loadBooking(admin, id);
  if (!booking || booking.kind !== 'booking' || booking.booked_by !== userId) throw new Reply(404, NOT_FOUND);
  return booking;
}

const holdIsLive = (b: BookingRow) =>
  b.status === 'held' && Boolean(b.hold_expires_at) && Date.parse(b.hold_expires_at as string) > Date.now();
/** Paid (by card, credit, or free) and still on: nothing left to pay. */
const isSettled = (b: BookingRow) => b.status === 'confirmed' && ['paid', 'free', 'credit'].includes(b.payment_status);
/** What the booker pays online: the price minus the gift balance on the hold. */
const amountOf = (b: BookingRow) => b.price_cents - (b.gift_cents || 0);

/**
 * The credit a cancelled booking gave back (krossi_booking_cancel did it in the database): a series
 * card's minutes, or what friends' shares hadn't already put back of its saldo part, plus the card
 * part the booker put on the saldo (toSaldo).
 */
async function creditBack(admin: SupabaseClient, booking: BookingRow, giveBack: boolean, toSaldo = false) {
  const settled = booking.payment_status === 'paid' || booking.payment_status === 'credit';
  if (!giveBack || !settled) return { creditCents: 0, creditMinutes: 0 };
  if (booking.pass_minutes > 0) return { creditCents: 0, creditMinutes: booking.pass_minutes };
  let creditCents = booking.gift_cents || 0;
  if (creditCents > 0) {
    const { data, error } = await admin.from('booking_shares').select('cents, booker_saldo').eq('reservation_id', booking.id);
    if (error) throw new Error(`share lookup failed: ${error.message}`);
    creditCents -= ((data ?? []) as { cents: number; booker_saldo: boolean }[])
      .filter((s) => s.booker_saldo).reduce((n, s) => n + s.cents, 0);
  }
  if (toSaldo) {
    const { data, error } = await admin.from('booking_reservations').select('saldo_refund_cents').eq('id', booking.id).maybeSingle();
    if (error) throw new Error(`booking lookup failed: ${error.message}`);
    creditCents += Number(data?.saldo_refund_cents) || 0;
  }
  return { creditCents: Math.max(0, creditCents), creditMinutes: 0 };
}

const splitTokenOf = (value: unknown) => {
  if (typeof value !== 'string' || !TOKEN_RE.test(value)) throw new Reply(404, SPLIT_NOT_FOUND);
  return value;
};

/** The public split (krossi_split_public), else 404. */
async function splitOf(admin: SupabaseClient, token: string) {
  const { data, error } = await admin.rpc('krossi_split_public', { p_token: token });
  if (error) throw new Error(`krossi_split_public failed: ${error.message}`);
  if (!data) throw new Reply(404, SPLIT_NOT_FOUND);
  return data as { state: 'open' | 'full' | 'over' | 'cancelled'; perCents: number };
}

/** A split's hall must take online payments before a friend's share is claimed or paid. */
async function requireSplitPayable(admin: SupabaseClient, token: string) {
  const { data, error } = await admin.from('booking_reservations').select('venue_id').eq('split_token', token).maybeSingle();
  if (error) throw new Error(`split lookup failed: ${error.message}`);
  if (data && !takesPayments(await loadVenue(admin, data.venue_id as string))) throw new HallNotConnected();
}

interface Claim {
  state: 'claimed' | 'resumed' | 'full' | 'over' | 'cancelled' | 'unknown' | 'own';
  bookingId: string;
  venueId: string;
  shareId: string;
  claimId: string;
  cents: number;
  payerName: string | null;
  payerUserId: string | null;
  intentId?: string | null;
  previousIntentId?: string | null;
}

async function claimShare(admin: SupabaseClient, token: string, name: string | null, userId: string | null, resume: string | null) {
  const { data, error } = await admin.rpc('krossi_split_claim', {
    token_input: token, name_input: name, user_id_input: userId, resume_intent_input: resume,
  });
  if (error) throw new Error(`krossi_split_claim failed: ${error.message}`);
  return data as Claim;
}

// ── Guests ───────────────────────────────────────────────────────────────────

/** A guest booking by its link token (kind 'booking'), with the guest's email, else 404. */
async function guestBookingOf(admin: SupabaseClient, token: unknown): Promise<{ booking: BookingRow; email: string; token: string }> {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw new Reply(404, NOT_FOUND);
  const { data, error } = await admin.from('booking_reservations').select('id, guest_email').eq('guest_token', token).maybeSingle();
  if (error) throw new Error(`guest booking lookup failed: ${error.message}`);
  const booking = data ? await loadBooking(admin, data.id as string) : null;
  if (!booking || booking.kind !== 'booking') throw new Reply(404, NOT_FOUND);
  return { booking, email: String(data?.guest_email ?? ''), token };
}

/**
 * What limits a guest's unpaid holds: a hash of the caller's address (never stored as such). The
 * edge runtime puts the client first in x-forwarded-for.
 */
async function guestKey(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
    || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`krossi-guest:${ip}`));
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A booking RPC's own Finnish message (raise exception → P0001) is the answer; anything else a 5xx. */
function rpcFailed(name: string, error: { message?: string; code?: string }): Error {
  const message = String(error.message ?? '').trim();
  if (error.code === 'P0001' && message && message.length <= 200) return new Reply(409, message);
  return new Error(`${name} failed: ${message}`);
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

/** Records a succeeded booking payment; a confirmation then refunds the on-sale bookings it bought. */
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

interface Payer {
  email: string | null;
  /** The player's Stripe customer; a guest has none. */
  customer: () => Promise<string | undefined>;
  /** Who pays, in the payment's metadata: supabase_user_id, or guest 'true'. */
  metadata: Record<string, string>;
}

/**
 * The booking's payment: { paid: true } when nothing is left to pay, else the PaymentIntent for the
 * Payment Element. An unfinished payment of the same amount is reused, one that went through is
 * recorded, and an expired hold can't be paid any more (409).
 */
async function bookingPayment(admin: SupabaseClient, booking: BookingRow, payer: Payer): Promise<Record<string, unknown>> {
  if (isSettled(booking)) return { paid: true };

  // An unfinished payment of this booking is reused; one that went through is recorded.
  const previous = booking.stripe_payment_intent_id ? await retrieveIntent(booking.stripe_payment_intent_id) : null;
  if (previous?.status === 'succeeded' && previous.metadata?.booking_id === booking.id) {
    const outcome = await settle(admin, previous);
    if (outcome === 'lost') throw new Reply(409, LOST);
    booking = (await loadBooking(admin, booking.id)) ?? booking;
    if (isSettled(booking)) return { paid: true };
  }
  if (previous?.status === 'processing') throw new Reply(409, PENDING);
  const amount = amountOf(booking);
  // The gift balance on the hold changed (or not) since that payment was started: only the same amount is reused.
  const reusable = previous && REUSABLE.includes(previous.status) && previous.amount === amount
    && previous.metadata?.booking_id === booking.id ? previous : null;

  if (!holdIsLive(booking)) {
    // Too late to pay: make sure the old payment can't be finished either.
    if (reusable) {
      await stripe.paymentIntents.cancel(reusable.id, { cancellation_reason: 'abandoned' }).catch((err) =>
        console.error('cancelling an expired booking payment failed', (err as Error).message));
    }
    throw new Reply(409, EXPIRED);
  }
  if (reusable) return { clientSecret: reusable.client_secret, paymentIntentId: reusable.id };
  if (previous && REUSABLE.includes(previous.status)) {
    await stripe.paymentIntents.cancel(previous.id, { cancellation_reason: 'abandoned' }).catch((err) =>
      console.error('cancelling an outdated booking payment failed', (err as Error).message));
  }
  if (amount < MIN_CHARGE_CENTS) throw new Reply(409, 'Varauksen hinta on liian pieni verkkomaksuun.');

  const [venue, place, customerId] = await Promise.all([
    loadVenue(admin, booking.venue_id), loadPlace(admin, booking.court_id), payer.customer(),
  ]);
  // A plain payment (nothing saved for later), so every method the account has works — MobilePay too.
  const intent = await stripe.paymentIntents.create({
    amount,
    currency: 'eur',
    ...(customerId ? { customer: customerId } : {}),
    automatic_payment_methods: { enabled: true },
    description: describeBooking(booking, venue, place) + (booking.gift_cents > 0 ? ' (osa saldolla)' : ''),
    receipt_email: payer.email || undefined,
    metadata: { product: BOOKING_PRODUCT, booking_id: booking.id, venue_id: booking.venue_id, ...payer.metadata },
    ...connectParams(venue, amount),
  }, {
    // Two taps at once get the same intent: the key names the booking, the intent it replaces
    // and the amount (a gift balance put on or taken off changes it).
    idempotencyKey: `krossi-booking-intent-${booking.id}-${booking.stripe_payment_intent_id ?? 'first'}`
      + (booking.gift_cents > 0 ? `-${amount}` : ''),
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
      if (latest && isSettled(latest)) return { paid: true };
      const theirs = latest?.stripe_payment_intent_id ? await retrieveIntent(latest.stripe_payment_intent_id) : null;
      if (!theirs || !REUSABLE.includes(theirs.status)) throw new Reply(409, 'Maksun aloitus on jo käynnissä. Yritä hetken päästä uudelleen.');
      return { clientSecret: theirs.client_secret, paymentIntentId: theirs.id };
    }
  }
  return { clientSecret: intent.client_secret, paymentIntentId: intent.id };
}

/**
 * Asks Stripe whether the booking's payment went through and records it: { confirmed, status }
 * (+ error when the court went to somebody else and the payment was refunded). `owns` tells whether
 * the payment is the caller's (a player's user id, a guest's flag).
 */
async function verifyBookingPayment(
  admin: SupabaseClient, booking: BookingRow, paymentIntentId: unknown, owns: (intent: Stripe.PaymentIntent) => boolean,
): Promise<Record<string, unknown>> {
  const id = typeof paymentIntentId === 'string' ? paymentIntentId : '';
  if (!INTENT_RE.test(id)) throw new Reply(400, UNKNOWN_PAYMENT);
  const intent = await retrieveIntent(id);
  if (!intent || intent.metadata?.product !== BOOKING_PRODUCT || intent.metadata?.booking_id !== booking.id || !owns(intent)) {
    throw new Reply(403, UNKNOWN_PAYMENT);
  }
  if (intent.status !== 'succeeded') return { confirmed: false, status: intent.status };
  const outcome = await settle(admin, intent);
  if (outcome === 'confirmed') return { confirmed: true, status: 'succeeded' };
  if (outcome === 'lost') return { confirmed: false, status: 'lost', error: LOST };
  // 'duplicate' (this payment was refunded, another one paid the booking) / 'cancelled'
  const latest = await loadBooking(admin, booking.id);
  const confirmed = latest?.status === 'confirmed';
  // The webhook got here first and refunded a lost court: same answer as above.
  if (!confirmed && latest?.payment_status === 'refunded' && latest.cancelled_by === null && !latest.guest_cancelled
    && latest.stripe_payment_intent_id === intent.id) {
    return { confirmed: false, status: 'lost', error: LOST };
  }
  return { confirmed, status: confirmed ? 'succeeded' : 'cancelled' };
}

/**
 * Records a friend's succeeded share payment. The share's amount goes back to the booker in the
 * background (the webhook and krossi-booking-cron retry it if Stripe doesn't take it now).
 */
async function settleSplit(admin: SupabaseClient, intent: Stripe.PaymentIntent) {
  const settled = await settleSplitPayment(stripe, admin, intent);
  if (settled.outcome === 'paid' && settled.bookerRefund) {
    inBackground(refundBooker(stripe, admin, settled.bookerRefund).catch((err) =>
      console.error('refunding a share to the booker failed', settled.shareId, (err as Error).message)));
  }
  return settled;
}

/**
 * Cancels the booking (krossi_booking_cancel) and refunds every paid part (the booker's own
 * cancellation keeps the peruutuskulu; toSaldo puts their card part on the saldo instead, so only
 * friends' payments are left to refund). A refund Stripe doesn't take now stays due and
 * krossi-booking-cron finishes it: the answer still tells what goes back to the booker. Payments
 * friends started can't be finished any more. → { total, own, fee } cents.
 */
async function cancelAndRefund(admin: SupabaseClient, booking: BookingRow, by: string, refund: boolean, toSaldo = false) {
  const bookingId = booking.id;
  const { data, error } = await admin.rpc('krossi_booking_cancel', {
    booking_id_input: bookingId, by_input: by, refund_input: refund, ...(toSaldo ? { to_saldo_input: true } : {}),
  });
  if (error) {
    if (/Kaverin maksu on juuri käsittelyssä/.test(error.message)) throw new Reply(409, 'Kaverin maksu on juuri käsittelyssä. Yritä hetken päästä uudelleen.');
    throw new Error(`krossi_booking_cancel failed: ${error.message}`);
  }
  inBackground(cancelPendingShares(stripe, admin, bookingId));
  return refundCancelled(admin, bookingId, data, paysCancelFee({ cancelled_by: by, booked_by: booking.booked_by, resold_by: null }));
}

/**
 * Refunds the paid parts a cancellation returned (krossi_booking_cancel / krossi_guest_cancel). A
 * refund Stripe doesn't take now stays due for krossi-booking-cron; the answer still tells what goes
 * back. keepsFee: the booker gave it up themselves (the peruutuskulu stays). → { total, own, fee }.
 */
async function refundCancelled(admin: SupabaseClient, bookingId: string, data: unknown, keepsFee: boolean) {
  const parts = (Array.isArray(data) ? data : []) as { shareId: string | null; kind: 'own' | 'friend'; paymentIntentId: string; cents: number }[];
  try {
    return await refundParts(stripe, admin, bookingId, parts);
  } catch (err) {
    console.error('refunds left for the cron', bookingId, (err as Error).message);
    const sum = (list: typeof parts) => list.reduce((n, p) => n + p.cents, 0);
    const own = sum(parts.filter((p) => p.kind === 'own'));
    const fee = keepsFee ? cancelFeeOf(own) : 0;
    return { total: sum(parts) - fee, own: own - fee, fee };
  }
}

// ── Watches ──────────────────────────────────────────────────────────────────

/**
 * A court freed up: the watches it satisfies are stamped in the database (once per freed row)
 * and krossi-notify emails each watcher — called with the player's own JWT (asUser), or for a
 * guest with the service role (admin; freedById is then the booking's id). Never throws: the
 * cancellation itself already happened.
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

interface Body {
  action?: string;
  bookingId?: unknown;
  courtId?: unknown;
  startsAt?: unknown;
  minutes?: unknown;
  email?: unknown;
  paymentIntentId?: unknown;
  refund?: unknown;
  token?: unknown;
  name?: unknown;
  toSaldo?: unknown;
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
  const signedIn = callerError ? null : callerData?.user ?? null;
  if (!signedIn && !SPLIT_ACTIONS.has(body.action ?? '') && !GUEST_ACTIONS.has(body.action ?? '')) {
    return json(req, { error: 'Kirjaudu uudelleen sisään.' }, 401);
  }
  // Every action but payConfig and the split and guest ones has a signed-in player.
  const user = signedIn as NonNullable<typeof signedIn>;

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  try {
    if (body.action === 'payConfig') {
      // guests: this server takes bookings without an account (the app shows its name + email form).
      return json(req, { publishableKey: checkoutKey(), currency: 'eur', email: signedIn?.email ?? null, guests: true });
    }

    if (body.action === 'config') {
      let booking = await myBooking(admin, body.bookingId, user.id);
      if (isSettled(booking)) return json(req, { paid: true });
      const stored = await settleStored(admin, booking);
      booking = stored.booking;
      if (stored.outcome === 'lost') throw new Reply(409, LOST);
      if (isSettled(booking)) return json(req, { paid: true });
      if (!holdIsLive(booking)) throw new Reply(409, EXPIRED);
      if (amountOf(booking) < MIN_CHARGE_CENTS) throw new Reply(409, 'Varauksen hinta on liian pieni verkkomaksuun.');
      if (!takesPayments(await loadVenue(admin, booking.venue_id))) throw new HallNotConnected();
      return json(req, { publishableKey: checkoutKey(), amount: amountOf(booking), currency: 'eur', email: user.email ?? null });
    }

    if (body.action === 'intent') {
      const booking = await myBooking(admin, body.bookingId, user.id);
      return json(req, await bookingPayment(admin, booking, {
        email: user.email ?? null,
        customer: () => customerOf(admin, user),
        metadata: { supabase_user_id: user.id },
      }));
    }

    if (body.action === 'verify') {
      if (typeof body.paymentIntentId !== 'string' || !INTENT_RE.test(body.paymentIntentId)) throw new Reply(400, UNKNOWN_PAYMENT);
      const booking = await myBooking(admin, body.bookingId, user.id);
      return json(req, await verifyBookingPayment(admin, booking, body.paymentIntentId,
        (intent) => intent.metadata?.supabase_user_id === user.id));
    }

    if (body.action === 'confirmed') {
      const booking = await myBooking(admin, body.bookingId, user.id);
      // Only a booking that is on: the on-sale bookings it took over get their money back now (the
      // cron would in a few minutes), and their sellers an email (once — krossi-notify throttles).
      if (booking.status === 'confirmed') inBackground(afterBookingPaid(stripe, admin, booking.id));
      return json(req, { ok: booking.status === 'confirmed' });
    }

    if (body.action === 'cancel') {
      let booking = await myBooking(admin, body.bookingId, user.id);
      ({ booking } = await settleStored(admin, booking));
      if (booking.status !== 'confirmed') throw new Reply(409, NOT_CANCELLABLE);
      const venue = await loadVenue(admin, booking.venue_id);
      if (Date.now() >= Date.parse(booking.starts_at) - venue.cancel_limit_hours * 3_600_000) throw new Reply(409, TOO_LATE);
      const toSaldo = body.toSaldo === true;
      const { own, fee } = await cancelAndRefund(admin, booking, user.id, true, toSaldo);
      inBackground(notifyWatchers(admin, asUser, booking.id, user.id));
      return json(req, { refundedCents: own, feeCents: fee, ...(await creditBack(admin, booking, true, toSaldo)) });
    }

    if (body.action === 'staffCancel') {
      if (typeof body.bookingId !== 'string' || !UUID_RE.test(body.bookingId)) throw new Reply(404, NOT_FOUND);
      let booking = await loadBooking(admin, body.bookingId);
      if (!booking || booking.kind !== 'booking') throw new Reply(404, NOT_FOUND);
      const { data: isStaff, error: staffError } = await asUser.rpc('krossi_booking_is_staff', { venue_id: booking.venue_id });
      if (staffError) throw new Error(`staff check failed: ${staffError.message}`);
      if (isStaff !== true) throw new Reply(403, STAFF_ONLY);

      ({ booking } = await settleStored(admin, booking));
      if (booking.status !== 'confirmed' && !holdIsLive(booking)) return json(req, { refundedCents: 0, feeCents: 0, creditCents: 0, creditMinutes: 0 });
      if (booking.payment_status === 'unpaid' && booking.stripe_payment_intent_id) {
        // A hold the hall cancels must not be payable any more (a late payment would be refunded anyway).
        await stripe.paymentIntents.cancel(booking.stripe_payment_intent_id, { cancellation_reason: 'abandoned' }).catch((err) =>
          console.error('cancelling the payment of a cancelled hold failed', (err as Error).message));
      }
      const { total, fee } = await cancelAndRefund(admin, booking, user.id, body.refund !== false);
      inBackground(notifyWatchers(admin, asUser, booking.id, user.id));
      // A guest has no app to see it in: they get an email.
      if (booking.guest_token) inBackground(mailGuestHallCancelled(admin, booking.id, total));
      return json(req, { refundedCents: total, feeCents: fee, ...(await creditBack(admin, booking, body.refund !== false)) });
    }

    if (body.action === 'freed') {
      if (typeof body.bookingId !== 'string' || !UUID_RE.test(body.bookingId)) throw new Reply(404, NOT_FOUND);
      // The database checks that the row really is freed (or on sale) and handles it only once.
      return json(req, { notified: await notifyWatchers(admin, asUser, body.bookingId, user.id) });
    }

    // ── Vieras: a booking without an account ──

    if (body.action === 'guestHold') {
      const courtId = typeof body.courtId === 'string' && UUID_RE.test(body.courtId) ? body.courtId : null;
      if (!courtId) throw new Reply(404, 'Kenttää ei löytynyt.');
      const startsAt = typeof body.startsAt === 'string' && !Number.isNaN(Date.parse(body.startsAt))
        ? new Date(body.startsAt).toISOString() : null;
      if (!startsAt) throw new Reply(400, 'Valitse aika kalenterista.');
      // Before holding: without a checkout the court must not sit held for nothing.
      checkoutKey();
      const { data: court, error: courtError } = await admin.from('booking_courts').select('venue_id').eq('id', courtId).maybeSingle();
      if (courtError) throw new Error(`court lookup failed: ${courtError.message}`);
      if (court && !takesPayments(await loadVenue(admin, court.venue_id as string))) throw new HallNotConnected();
      const { data, error } = await admin.rpc('krossi_guest_hold_booking', {
        court_id_input: courtId,
        starts_at_input: startsAt,
        minutes_input: Number.isInteger(body.minutes) ? body.minutes : null,
        name_input: typeof body.name === 'string' ? body.name.slice(0, 200) : '',
        email_input: typeof body.email === 'string' ? body.email.slice(0, 300) : '',
        key_input: await guestKey(req),
      });
      if (error) throw rpcFailed('krossi_guest_hold_booking', error);
      const held = data as { booking: Record<string, unknown>; token: string };
      return json(req, { booking: held.booking, token: held.token });
    }

    if (body.action === 'guestIntent') {
      const { booking, email } = await guestBookingOf(admin, body.token);
      return json(req, await bookingPayment(admin, booking, {
        email,
        customer: async () => undefined,
        metadata: { guest: 'true' },
      }));
    }

    if (body.action === 'guestVerify') {
      const { booking } = await guestBookingOf(admin, body.token);
      return json(req, await verifyBookingPayment(admin, booking, body.paymentIntentId, (intent) => intent.metadata?.guest === 'true'));
    }

    if (body.action === 'guestRelease') {
      const { token } = await guestBookingOf(admin, body.token);
      const { data: freed, error } = await admin.rpc('krossi_guest_release', { token_input: token });
      if (error) throw new Error(`krossi_guest_release failed: ${error.message}`);
      if (typeof freed === 'string') inBackground(notifyWatchers(admin, admin, freed, freed));
      return json(req, { ok: true });
    }

    if (body.action === 'guestBooking') {
      const { booking, token } = await guestBookingOf(admin, body.token);
      // A payment that went through while the guest was away (a redirect, a closed tab) is recorded first.
      const stored = await settleStored(admin, booking);
      const { data, error } = await admin.rpc('krossi_guest_booking', { token_input: token });
      if (error) throw new Error(`krossi_guest_booking failed: ${error.message}`);
      if (!data) throw new Reply(404, NOT_FOUND);
      return json(req, { ...(data as Record<string, unknown>), ...(stored.outcome === 'lost' ? { lost: LOST } : {}) });
    }

    if (body.action === 'guestCancel') {
      const found = await guestBookingOf(admin, body.token);
      const { booking } = await settleStored(admin, found.booking);
      if (booking.status === 'confirmed') {
        const venue = await loadVenue(admin, booking.venue_id);
        if (Date.now() >= Date.parse(booking.starts_at) - venue.cancel_limit_hours * 3_600_000) throw new Reply(409, TOO_LATE);
      } else if (!(booking.status === 'cancelled' && booking.guest_cancelled)) {
        throw new Reply(409, NOT_CANCELLABLE);
      }
      const { data, error } = await admin.rpc('krossi_guest_cancel', { token_input: found.token });
      if (error) throw rpcFailed('krossi_guest_cancel', error);
      const { own, fee } = await refundCancelled(admin, booking.id, data, true);
      if (booking.status === 'confirmed') inBackground(notifyWatchers(admin, admin, booking.id, booking.id));
      return json(req, { refundedCents: own, feeCents: fee });
    }

    // ── Jaettu maksu: a friend's share, signed in or not ──

    if (body.action === 'splitConfig') {
      const token = splitTokenOf(body.token);
      const split = await splitOf(admin, token);
      if (split.state === 'cancelled') throw new Reply(409, SPLIT_CANCELLED);
      if (split.state === 'over') return json(req, { over: true });
      if (split.state === 'full') return json(req, { full: true });
      await requireSplitPayable(admin, token);
      return json(req, { publishableKey: checkoutKey(), amount: split.perCents, currency: 'eur' });
    }

    if (body.action === 'splitIntent') {
      const token = splitTokenOf(body.token);
      const name = typeof body.name === 'string' ? body.name.slice(0, 200) : null;
      const resume = typeof body.paymentIntentId === 'string' && INTENT_RE.test(body.paymentIntentId) ? body.paymentIntentId : null;
      // Before claiming: without a checkout the share must not sit claimed for nothing.
      if (!usablePublishableKey()) throw new Reply(503, NOT_IN_USE);
      await requireSplitPayable(admin, token);
      const claim = await claimShare(admin, token, name, signedIn?.id ?? null, resume);
      if (claim.state === 'unknown') throw new Reply(404, SPLIT_NOT_FOUND);
      if (claim.state === 'cancelled') throw new Reply(409, SPLIT_CANCELLED);
      if (claim.state === 'over') throw new Reply(409, SPLIT_OVER);
      if (claim.state === 'own') throw new Reply(409, SPLIT_OWN);
      if (claim.state === 'full') return json(req, { full: true });

      if (claim.state === 'resumed') {
        // My own unfinished payment of this share: the same one again, unless it went through or is gone.
        const previous = claim.intentId ? await retrieveIntent(claim.intentId) : null;
        if (previous && REUSABLE.includes(previous.status)) {
          return json(req, { clientSecret: previous.client_secret, paymentIntentId: previous.id });
        }
        if (previous?.status === 'processing') throw new Reply(409, PENDING);
        if (previous?.status === 'succeeded') {
          const settled = await settleSplit(admin, previous);
          if (settled.outcome === 'paid') return json(req, { paid: true });
          throw new Reply(409, SPLIT_REFUNDED[settled.reason]);
        }
      } else if (claim.previousIntentId) {
        // The share's earlier claim ran out: its payment can't be finished any more (one that went
        // through meanwhile takes another open share when it is recorded, or is refunded).
        const stale = claim.previousIntentId;
        inBackground(stripe.paymentIntents.cancel(stale, { cancellation_reason: 'abandoned' }).catch((err) =>
          console.error('cancelling an expired share payment failed', stale, (err as Error).message)));
      }

      const booking = await loadBooking(admin, claim.bookingId);
      if (!booking) throw new Reply(404, SPLIT_NOT_FOUND);
      const [venue, place] = await Promise.all([loadVenue(admin, booking.venue_id), loadPlace(admin, booking.court_id)]);
      const metadata: Record<string, string> = {
        product: SPLIT_PRODUCT, booking_id: booking.id, split_share_id: claim.shareId, venue_id: booking.venue_id,
      };
      if (claim.payerName) metadata.payer_name = claim.payerName;
      if (claim.payerUserId) metadata.payer_user_id = claim.payerUserId;
      const intent = await stripe.paymentIntents.create({
        amount: claim.cents,
        currency: 'eur',
        automatic_payment_methods: { enabled: true },
        description: describeBooking(booking, venue, place, 'Osuus kenttävuorosta'),
        receipt_email: signedIn?.email || undefined,
        metadata,
        ...connectParams(venue, claim.cents),
      }, { idempotencyKey: `krossi-split-intent-${claim.claimId}-${claim.intentId ?? 'first'}` });
      const { data: attached, error: attachError } = await admin.rpc('krossi_split_attach', {
        share_id_input: claim.shareId, claim_id_input: claim.claimId, payment_intent_id_input: intent.id,
      });
      if (attachError) throw new Error(`krossi_split_attach failed: ${attachError.message}`);
      if (attached !== true) {
        await stripe.paymentIntents.cancel(intent.id, { cancellation_reason: 'abandoned' }).catch((err) =>
          console.error('cancelling a share payment that lost its claim failed', (err as Error).message));
        throw new Reply(409, CLAIM_LOST);
      }
      inBackground(ensurePaymentDomains());
      return json(req, { clientSecret: intent.client_secret, paymentIntentId: intent.id });
    }

    if (body.action === 'splitVerify') {
      const token = splitTokenOf(body.token);
      const id = typeof body.paymentIntentId === 'string' ? body.paymentIntentId : '';
      if (!INTENT_RE.test(id)) throw new Reply(400, UNKNOWN_PAYMENT);
      const intent = await retrieveIntent(id);
      if (!intent || intent.metadata?.product !== SPLIT_PRODUCT) throw new Reply(403, UNKNOWN_PAYMENT);
      // The payment belongs to this link's booking. (A split removed since has no link any more;
      // its payment is still recorded — and refunded.)
      const { data: owner, error: ownerError } = await admin.from('booking_reservations')
        .select('id').eq('split_token', token).maybeSingle();
      if (ownerError) throw new Error(`split lookup failed: ${ownerError.message}`);
      if (owner && owner.id !== intent.metadata?.booking_id) throw new Reply(403, UNKNOWN_PAYMENT);
      if (intent.status !== 'succeeded') return json(req, { paid: false, status: intent.status });
      const settled = await settleSplit(admin, intent);
      if (settled.outcome === 'paid') return json(req, { paid: true, status: 'succeeded' });
      return json(req, { paid: false, status: 'refunded', message: SPLIT_REFUNDED[settled.reason] });
    }

    if (body.action === 'splitSaldo') {
      const token = splitTokenOf(body.token);
      // My own card payment of a share, started here before: recorded if it went through, else
      // cancelled first so it can't go through after the saldo paid the share.
      const { data: owner, error: ownerError } = await admin.from('booking_reservations')
        .select('id').eq('split_token', token).maybeSingle();
      if (ownerError) throw new Error(`split lookup failed: ${ownerError.message}`);
      const cancelled = new Set<string>();
      if (owner) {
        const { data: started, error: startedError } = await admin.from('booking_shares')
          .select('stripe_payment_intent_id').eq('reservation_id', owner.id).eq('status', 'pending').eq('payer_user_id', user.id);
        if (startedError) throw new Error(`share lookup failed: ${startedError.message}`);
        for (const share of (started ?? []) as { stripe_payment_intent_id: string | null }[]) {
          const intent = share.stripe_payment_intent_id ? await retrieveIntent(share.stripe_payment_intent_id) : null;
          if (intent?.status === 'succeeded') {
            const settled = await settleSplit(admin, intent);
            if (settled.outcome === 'paid') return json(req, { paid: true });
          } else if (intent?.status === 'processing') {
            throw new Reply(409, PENDING);
          } else if (intent && REUSABLE.includes(intent.status)) {
            await stripe.paymentIntents.cancel(intent.id, { cancellation_reason: 'abandoned' });
            cancelled.add(intent.id);
          }
        }
      }
      const { data, error } = await admin.rpc('krossi_split_pay_saldo', { token_input: token, user_id_input: user.id });
      if (error) throw new Error(`krossi_split_pay_saldo failed: ${error.message}`);
      const paid = data as {
        state: 'paid' | 'short' | 'full' | 'over' | 'cancelled' | 'unknown' | 'own';
        bookingId?: string; shareId?: string; cents?: number; bookerIntentId?: string | null;
        bookerRefundDue?: boolean; bookerSaldo?: boolean; cancelIntentId?: string | null;
      };
      if (paid.state === 'unknown') throw new Reply(404, SPLIT_NOT_FOUND);
      if (paid.state === 'cancelled') throw new Reply(409, SPLIT_CANCELLED);
      if (paid.state === 'over') throw new Reply(409, SPLIT_OVER);
      if (paid.state === 'own') throw new Reply(409, SPLIT_OWN);
      if (paid.state === 'short') throw new Reply(409, SALDO_SHORT);
      if (paid.state === 'full') return json(req, { full: true });
      const stale = paid.cancelIntentId;
      if (stale && !cancelled.has(stale)) {
        // An expired claim's payment: it can't take this share any more (one that went through is refunded).
        inBackground(stripe.paymentIntents.cancel(stale, { cancellation_reason: 'abandoned' }).catch((err) =>
          console.error('cancelling an expired share payment failed', stale, (err as Error).message)));
      }
      const shareId = paid.shareId ?? '';
      if (paid.bookerRefundDue && paid.bookerIntentId) {
        const due = { shareId, bookingId: paid.bookingId ?? '', bookerIntentId: paid.bookerIntentId, cents: paid.cents ?? 0 };
        inBackground(refundBooker(stripe, admin, due).catch((err) =>
          console.error('refunding a share to the booker failed', shareId, (err as Error).message)));
      } else if (paid.bookerSaldo) {
        inBackground(notifyInternal(admin, { type: 'booking_split_paid', shareId }));
      }
      return json(req, { paid: true });
    }

    throw new Reply(400, 'Tuntematon toiminto.');
  } catch (err) {
    if (err instanceof Reply) return json(req, { error: err.message }, err.status);
    if (err instanceof HallNotConnected) return json(req, { error: HALL_NOT_CONNECTED }, 503);
    const stripeFailed = isStripeError(err);
    console.error(`krossi-booking ${body.action} failed`, (err as Error).message);
    return json(req, { error: stripeFailed ? STRIPE_DOWN : DB_FAILED }, stripeFailed ? 502 : 500);
  }
});
