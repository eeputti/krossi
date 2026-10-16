// _shared/booking.ts — the court-booking money moves krossi-booking, krossi-booking-cron and
// stripe-webhook share, so each one does them the same way:
//
//   settleBookingPayment   a booker's payment succeeded: krossi_booking_mark_paid (with the amount
//                          paid — the rest of the price comes from the gift balance on the hold — and
//                          a split booking's card); a lost or duplicate payment is refunded at once
//   settleSharePayment     a friend's share (or a booker's rest share) was paid:
//                          krossi_booking_share_mark_paid; a payment the share no longer needs
//                          (covered by the rest, or the booking was cancelled) is refunded
//   refundParts            every paid part of a cancelled or sold booking back to where it came
//                          from, recorded with krossi_booking_parts_refunded
//   afterBookingPaid       a confirmed booking: the on-sale bookings it took over are refunded and
//                          their sellers told; a split booking's friends get their email
//
// Refunds use the idempotency key `krossi-booking-refund-<payment intent>` and the same metadata
// in every function, so a payment is refunded once even when the webhook and the app race.
// Emails go through krossi-notify with the service-role key (internal events only it accepts).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type Stripe from 'npm:stripe@17.7.0';

type Admin = SupabaseClient;

export const BOOKING_PRODUCT = 'krossi_booking';
export const SHARE_PRODUCT = 'krossi_booking_share';
export const LOST = 'Aika ehti mennä toiselle — maksu palautettiin.';

const NOTIFY_WINDOW_MINUTES = 10;

/** A Stripe expandable field (string id or object) as its id. */
export const idOf = (value: unknown): string | null =>
  typeof value === 'string' ? value : ((value as { id?: string } | null)?.id ?? null);

// ── Database rows ────────────────────────────────────────────────────────────

export interface BookingRow {
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
  split_parts: number | null;
  own_cents: number | null;
  gift_cents: number;
  pass_minutes: number;
}

export interface VenueRow {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  cancel_limit_hours: number;
  stripe_account_id: string | null;
  platform_fee_bps: number;
}

export const BOOKING_COLUMNS = 'id, venue_id, court_id, starts_at, ends_at, kind, status, booked_by, price_cents, ' +
  'payment_status, hold_expires_at, stripe_payment_intent_id, cancelled_by, split_parts, own_cents, gift_cents, pass_minutes';

export async function loadBooking(admin: Admin, id: string): Promise<BookingRow | null> {
  const { data, error } = await admin.from('booking_reservations').select(BOOKING_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`booking lookup failed: ${error.message}`);
  return (data as BookingRow | null) ?? null;
}

export async function loadVenue(admin: Admin, id: string): Promise<VenueRow> {
  const { data, error } = await admin.from('booking_venues')
    .select('id, slug, name, timezone, cancel_limit_hours, stripe_account_id, platform_fee_bps').eq('id', id).single();
  if (error) throw new Error(`venue lookup failed: ${error.message}`);
  return data as VenueRow;
}

export async function loadPlace(admin: Admin, courtId: string): Promise<{ courtName: string; locationName: string }> {
  const { data: court, error } = await admin.from('booking_courts').select('name, location_id').eq('id', courtId).single();
  if (error) throw new Error(`court lookup failed: ${error.message}`);
  const { data: location, error: locationError } = await admin.from('booking_locations')
    .select('name').eq('id', court.location_id).single();
  if (locationError) throw new Error(`location lookup failed: ${locationError.message}`);
  return { courtName: court.name as string, locationName: location.name as string };
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

export function describeBooking(
  booking: Pick<BookingRow, 'starts_at' | 'ends_at'>,
  venue: Pick<VenueRow, 'timezone'>,
  place: { courtName: string; locationName: string },
) {
  const timeZone = venue.timezone || 'Europe/Helsinki';
  const start = localParts(booking.starts_at, timeZone);
  const end = localParts(booking.ends_at, timeZone);
  return `Kenttävaraus: ${place.courtName}, ${place.locationName}, ${start.weekday} ${start.day}.${start.month}. klo ${start.time}–${end.time}`;
}

/** Destination charge for a hall with a Stripe Connect account (Krossi's fee from platform_fee_bps). */
export function connectParams(venue: VenueRow, amount: number): Partial<Stripe.PaymentIntentCreateParams> {
  if (!venue.stripe_account_id) return {};
  const fee = Math.floor((amount * (venue.platform_fee_bps || 0)) / 10_000);
  return { transfer_data: { destination: venue.stripe_account_id }, ...(fee > 0 ? { application_fee_amount: fee } : {}) };
}

// ── Refunds ──────────────────────────────────────────────────────────────────

const bookingRefundMetadata = (bookingId: string) => ({ product: BOOKING_PRODUCT, booking_id: bookingId });
const shareRefundMetadata = (bookingId: string, shareId: string) => ({ product: SHARE_PRODUCT, booking_id: bookingId, share_id: shareId });

/**
 * Refunds a whole payment. The idempotency key is the same in every function, so two of them
 * racing refund it once. A destination charge (Connect) takes the money back from the hall and
 * returns Krossi's fee too. Refunded already (e.g. by hand in the Dashboard): that refund is used.
 */
export async function refundIntent(stripe: Stripe, intent: Stripe.PaymentIntent, metadata: Record<string, string>): Promise<Stripe.Refund> {
  const params: Stripe.RefundCreateParams = { payment_intent: intent.id, metadata };
  if (intent.transfer_data?.destination) params.reverse_transfer = true;
  if (intent.application_fee_amount) params.refund_application_fee = true;
  try {
    return await stripe.refunds.create(params, { idempotencyKey: `krossi-booking-refund-${intent.id}` });
  } catch (err) {
    if ((err as { code?: string }).code === 'charge_already_refunded') {
      const { data } = await stripe.refunds.list({ payment_intent: intent.id, limit: 1 });
      if (data[0]) return data[0];
    }
    throw err;
  }
}

interface PaidPart {
  shareId: string | null;
  kind: 'own' | 'friend' | 'rest';
  paymentIntentId: string;
  cents: number;
}

/**
 * Refunds every paid part of a cancelled or sold booking (`parts`, or krossi_booking_paid_parts)
 * and records what went back. Throws when a refund failed — what is left stays due
 * (refund_due_at) and krossi-booking-cron finishes it. → { total, own } refunded cents, own = the
 * booker's (their part and a rest share).
 */
export async function refundParts(stripe: Stripe, admin: Admin, bookingId: string, parts?: PaidPart[]) {
  let due = parts;
  if (!due) {
    const { data, error } = await admin.rpc('krossi_booking_paid_parts', { booking_id_input: bookingId });
    if (error) throw new Error(`krossi_booking_paid_parts failed: ${error.message}`);
    due = (Array.isArray(data) ? data : []) as PaidPart[];
  }
  const refunds: { shareId: string | null; refundId: string }[] = [];
  let total = 0;
  let own = 0;
  let failure: unknown = null;
  for (const part of due) {
    try {
      const intent = await stripe.paymentIntents.retrieve(part.paymentIntentId);
      const refund = await refundIntent(stripe, intent,
        part.shareId ? shareRefundMetadata(bookingId, part.shareId) : bookingRefundMetadata(bookingId));
      refunds.push({ shareId: part.shareId, refundId: refund.id });
      total += refund.amount;
      if (part.kind !== 'friend') own += refund.amount;
    } catch (err) {
      console.error('booking refund failed', bookingId, part.paymentIntentId, (err as Error).message);
      failure = failure ?? err;
    }
  }
  if (refunds.length || !due.length) {
    const { error } = await admin.rpc('krossi_booking_parts_refunded', { booking_id_input: bookingId, refunds_input: refunds });
    if (error) throw new Error(`krossi_booking_parts_refunded failed: ${error.message}`);
  }
  if (failure) throw failure;
  return { total, own };
}

// ── Recording payments ───────────────────────────────────────────────────────

export type Outcome = 'confirmed' | 'lost' | 'duplicate' | 'cancelled';

/**
 * Records a succeeded payment of the booker (krossi_booking_mark_paid: the amount paid, so a gift
 * share on the hold leaves the balance; a split booking keeps the card for the rest). 'lost' (the court went to somebody else) and 'duplicate' (the booking was
 * paid by another payment) refund this payment; a lost booking is then marked cancelled + refunded.
 * Throws with the database's message (stripe-webhook recognises 'Varausta ei löytynyt').
 */
export async function settleBookingPayment(stripe: Stripe, admin: Admin, intent: Stripe.PaymentIntent): Promise<Outcome> {
  const bookingId = intent.metadata?.booking_id ?? '';
  const { data, error } = await admin.rpc('krossi_booking_mark_paid', {
    booking_id_input: bookingId,
    payment_intent_id_input: intent.id,
    amount_input: intent.amount,
    payment_method_input: idOf(intent.payment_method),
  });
  if (error) throw new Error(`krossi_booking_mark_paid failed: ${error.message}`);
  const outcome = data as Outcome;
  if (outcome === 'lost' || outcome === 'duplicate') {
    const refund = await refundIntent(stripe, intent, bookingRefundMetadata(bookingId));
    if (outcome === 'lost') {
      const { error: cancelError } = await admin.rpc('krossi_booking_mark_cancelled', {
        booking_id_input: bookingId,
        refunded_input: true,
        refund_id_input: refund.id,
        by_input: null,
      });
      if (cancelError) throw new Error(`krossi_booking_mark_cancelled failed: ${cancelError.message}`);
    }
  }
  return outcome;
}

export type ShareOutcome = 'paid' | 'duplicate' | 'cancelled';

/** Records a succeeded share payment; one the share no longer needs is refunded. */
export async function settleSharePayment(stripe: Stripe, admin: Admin, intent: Stripe.PaymentIntent): Promise<ShareOutcome> {
  const shareId = intent.metadata?.share_id ?? '';
  const { data, error } = await admin.rpc('krossi_booking_share_mark_paid', {
    share_id_input: shareId,
    payment_intent_id_input: intent.id,
  });
  if (error) throw new Error(`krossi_booking_share_mark_paid failed: ${error.message}`);
  const outcome = data as ShareOutcome;
  if (outcome !== 'paid') await refundIntent(stripe, intent, shareRefundMetadata(intent.metadata?.booking_id ?? '', shareId));
  return outcome;
}

// ── After a confirmation ─────────────────────────────────────────────────────

/** An internal event for krossi-notify (it only takes these from the service role). Never throws. */
export async function notifyInternal(admin: Admin, event: Record<string, string>) {
  try {
    const { error } = await admin.functions.invoke('krossi-notify', { body: event });
    if (error) console.error('krossi-notify failed', event.type, (error as Error).message);
  } catch (err) {
    console.error('krossi-notify failed', event.type, (err as Error).message);
  }
}

/**
 * A booking was confirmed: the on-sale bookings it took over get their money back and their
 * sellers an email; a split booking's friends, asked in the chat just now, get their email.
 * Never throws — the booking itself is confirmed; an unfinished refund stays due for the cron.
 */
export async function afterBookingPaid(stripe: Stripe, admin: Admin, bookingId: string) {
  try {
    const { data, error } = await admin.rpc('krossi_booking_resold_by', { booking_id_input: bookingId });
    if (error) throw new Error(error.message);
    for (const sold of (Array.isArray(data) ? data : []) as { bookingId: string; refundDue: boolean }[]) {
      try {
        if (sold.refundDue) await refundParts(stripe, admin, sold.bookingId);
      } catch (err) {
        console.error('refunding a sold booking failed', sold.bookingId, (err as Error).message);
      }
      await notifyInternal(admin, { type: 'booking_resold', bookingId: sold.bookingId });
    }
  } catch (err) {
    console.error('resale lookup failed', bookingId, (err as Error).message);
  }
  try {
    const since = new Date(Date.now() - NOTIFY_WINDOW_MINUTES * 60_000).toISOString();
    const { data, error } = await admin.from('booking_shares')
      .select('id')
      .eq('reservation_id', bookingId)
      .eq('kind', 'friend')
      .eq('status', 'pending')
      .gte('invited_at', since);
    if (error) throw new Error(error.message);
    for (const share of (data ?? []) as { id: string }[]) {
      await notifyInternal(admin, { type: 'booking_share_request', shareId: share.id });
    }
  } catch (err) {
    console.error('share invite lookup failed', bookingId, (err as Error).message);
  }
}
