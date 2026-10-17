// _shared/booking.ts — the court-booking money moves krossi-booking, krossi-booking-cron and
// stripe-webhook share, so each one does them the same way:
//
//   settleBookingPayment   a booker's payment succeeded: krossi_booking_mark_paid (with the amount
//                          paid — the rest of the price comes from the gift balance on the hold); a
//                          lost or duplicate payment is refunded at once
//   settleSplitPayment     a friend paid their share of a split booking: krossi_split_mark_paid; a
//                          payment the split can't take (the booking was cancelled or sold, the split
//                          changed, every share was paid already) is refunded to the friend at once
//   refundBooker           a paid share's amount back to the booker from their own payment (a
//                          partial refund), recorded with krossi_split_booker_refunded, and the
//                          booker told (krossi-notify booking_split_paid)
//   refundParts            every paid part of a cancelled or sold booking back to where it came
//                          from — what is left of the booker's payment and each friend's whole
//                          payment — recorded with krossi_booking_parts_refunded
//   cancelPendingShares    payments friends started on a cancelled or sold booking are cancelled
//   afterBookingPaid       a confirmed booking: the on-sale bookings it took over are refunded and
//                          their sellers told
//
// Refunds use idempotency keys that are the same in every function (`krossi-booking-refund-<payment
// intent>` for a whole payment or what is left of it, `krossi-split-booker-refund-<share>` for a
// share's amount back to the booker), so a refund happens once even when the webhook and the app
// race. Stripe never refunds more than a payment has left, so a cancellation racing a share's
// refund to the booker can't refund too much: whichever lands second gets what remains, or nothing.
// Emails go through krossi-notify with the service-role key (internal events only it accepts).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type Stripe from 'npm:stripe@17.7.0';

type Admin = SupabaseClient;

export const BOOKING_PRODUCT = 'krossi_booking';
export const SPLIT_PRODUCT = 'krossi_split_share';
export const LOST = 'Aika ehti mennä toiselle — maksu palautettiin.';

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
  'payment_status, hold_expires_at, stripe_payment_intent_id, cancelled_by, gift_cents, pass_minutes';

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
  label = 'Kenttävaraus',
) {
  const timeZone = venue.timezone || 'Europe/Helsinki';
  const start = localParts(booking.starts_at, timeZone);
  const end = localParts(booking.ends_at, timeZone);
  return `${label}: ${place.courtName}, ${place.locationName}, ${start.weekday} ${start.day}.${start.month}. klo ${start.time}–${end.time}`;
}

/** Destination charge for a hall with a Stripe Connect account (Krossi's fee from platform_fee_bps). */
export function connectParams(venue: VenueRow, amount: number): Partial<Stripe.PaymentIntentCreateParams> {
  if (!venue.stripe_account_id) return {};
  const fee = Math.floor((amount * (venue.platform_fee_bps || 0)) / 10_000);
  return { transfer_data: { destination: venue.stripe_account_id }, ...(fee > 0 ? { application_fee_amount: fee } : {}) };
}

// ── Refunds ──────────────────────────────────────────────────────────────────

const bookingRefundMetadata = (bookingId: string) => ({ product: BOOKING_PRODUCT, booking_id: bookingId });
const shareRefundMetadata = (bookingId: string, shareId: string) => ({ product: SPLIT_PRODUCT, booking_id: bookingId, split_share_id: shareId });

/** A destination charge (Connect) takes the money back from the hall and returns Krossi's fee too. */
function refundParams(intent: Stripe.PaymentIntent, metadata: Record<string, string>, amount?: number): Stripe.RefundCreateParams {
  const params: Stripe.RefundCreateParams = { payment_intent: intent.id, metadata };
  if (amount) params.amount = amount;
  if (intent.transfer_data?.destination) params.reverse_transfer = true;
  if (intent.application_fee_amount) params.refund_application_fee = true;
  return params;
}

/**
 * Refunds what is left of a payment (all of it, or what earlier partial refunds left). The
 * idempotency key is the same in every function, so two of them racing refund it once. Refunded
 * already (e.g. by hand in the Dashboard): that refund is used.
 */
export async function refundIntent(stripe: Stripe, intent: Stripe.PaymentIntent, metadata: Record<string, string>): Promise<Stripe.Refund> {
  try {
    return await stripe.refunds.create(refundParams(intent, metadata), { idempotencyKey: `krossi-booking-refund-${intent.id}` });
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
  kind: 'own' | 'friend';
  paymentIntentId: string;
  cents: number;
}

/**
 * Refunds every paid part of a cancelled or sold booking (`parts`, or krossi_booking_paid_parts)
 * and records what went back. Throws when a refund failed — what is left stays due
 * (refund_due_at) and krossi-booking-cron finishes it. → { total, own } refunded cents, own = the
 * booker's.
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
      if (part.kind === 'own') own += refund.amount;
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

/**
 * The payments friends started on a booking that is now cancelled or sold can't be finished any
 * more (one that went through anyway is refunded when it is recorded). Never throws.
 */
export async function cancelPendingShares(stripe: Stripe, admin: Admin, bookingId: string) {
  try {
    const { data, error } = await admin.from('booking_shares')
      .select('stripe_payment_intent_id')
      .eq('reservation_id', bookingId)
      .eq('status', 'pending');
    if (error) throw new Error(error.message);
    for (const share of (data ?? []) as { stripe_payment_intent_id: string | null }[]) {
      if (!share.stripe_payment_intent_id) continue;
      await stripe.paymentIntents.cancel(share.stripe_payment_intent_id, { cancellation_reason: 'abandoned' }).catch((err) =>
        console.error('cancelling a share payment failed', share.stripe_payment_intent_id, (err as Error).message));
    }
  } catch (err) {
    console.error('pending share lookup failed', bookingId, (err as Error).message);
  }
}

// ── Recording payments ───────────────────────────────────────────────────────

export type Outcome = 'confirmed' | 'lost' | 'duplicate' | 'cancelled';

/**
 * Records a succeeded payment of the booker (krossi_booking_mark_paid: the amount paid, so a gift
 * share on the hold leaves the balance). 'lost' (the court went to somebody else) and 'duplicate'
 * (the booking was paid by another payment) refund this payment; a lost booking is then marked
 * cancelled + refunded. Throws with the database's message (stripe-webhook recognises 'Varausta
 * ei löytynyt').
 */
export async function settleBookingPayment(stripe: Stripe, admin: Admin, intent: Stripe.PaymentIntent): Promise<Outcome> {
  const bookingId = intent.metadata?.booking_id ?? '';
  const { data, error } = await admin.rpc('krossi_booking_mark_paid', {
    booking_id_input: bookingId,
    payment_intent_id_input: intent.id,
    amount_input: intent.amount,
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

/** A paid share whose amount goes back to the booker. */
export interface BookerRefund {
  shareId: string;
  bookingId: string;
  bookerIntentId: string;
  cents: number;
}

export type SplitRefundReason = 'cancelled' | 'changed' | 'full';

export type SplitOutcome =
  | { outcome: 'paid'; shareId: string; bookerRefund: BookerRefund | null }
  | { outcome: 'refunded'; reason: SplitRefundReason };

interface SplitMarkPaid {
  result: 'paid' | 'refund';
  reason?: SplitRefundReason;
  bookingId: string;
  shareId?: string;
  cents?: number;
  bookerIntentId?: string | null;
  bookerRefundDue?: boolean;
}

/**
 * Records a friend's succeeded share payment (krossi_split_mark_paid). A payment the split can't
 * take is refunded to the friend now (and a share it was on recorded as refunded). A paid share's
 * refund to the booker is left to the caller (refundBooker): the webhook waits for it, the app
 * doesn't. Throws with the database's message ('Varausta ei löytynyt' = another environment).
 */
export async function settleSplitPayment(stripe: Stripe, admin: Admin, intent: Stripe.PaymentIntent): Promise<SplitOutcome> {
  const metadata = intent.metadata ?? {};
  const { data, error } = await admin.rpc('krossi_split_mark_paid', {
    booking_id_input: metadata.booking_id ?? '',
    share_id_input: metadata.split_share_id ?? '',
    payment_intent_id_input: intent.id,
    amount_input: intent.amount,
    name_input: metadata.payer_name || null,
    user_id_input: metadata.payer_user_id || null,
  });
  if (error) throw new Error(`krossi_split_mark_paid failed: ${error.message}`);
  const marked = data as SplitMarkPaid;
  if (marked.result === 'refund') {
    const refund = await refundIntent(stripe, intent, shareRefundMetadata(marked.bookingId, marked.shareId ?? metadata.split_share_id ?? ''));
    if (marked.shareId) {
      const { error: recordError } = await admin.rpc('krossi_booking_parts_refunded', {
        booking_id_input: marked.bookingId, refunds_input: [{ shareId: marked.shareId, refundId: refund.id }],
      });
      if (recordError) throw new Error(`krossi_booking_parts_refunded failed: ${recordError.message}`);
    }
    return { outcome: 'refunded', reason: marked.reason ?? 'cancelled' };
  }
  const bookerRefund = marked.bookerRefundDue && marked.bookerIntentId && marked.shareId
    ? { shareId: marked.shareId, bookingId: marked.bookingId, bookerIntentId: marked.bookerIntentId, cents: marked.cents ?? 0 }
    : null;
  return { outcome: 'paid', shareId: marked.shareId ?? '', bookerRefund };
}

/**
 * A paid share's amount back to the booker: a partial refund of their own payment, recorded and
 * mailed to them. A booking cancelled or sold meanwhile was refunded whole — then there is nothing
 * left to do (→ false). Throws when Stripe didn't take it: the webhook's retry or
 * krossi-booking-cron tries again with the same idempotency key.
 */
export async function refundBooker(stripe: Stripe, admin: Admin, due: BookerRefund): Promise<boolean> {
  let refund: Stripe.Refund;
  try {
    const intent = await stripe.paymentIntents.retrieve(due.bookerIntentId);
    refund = await stripe.refunds.create(
      refundParams(intent, { product: BOOKING_PRODUCT, booking_id: due.bookingId, split_share_id: due.shareId }, due.cents),
      { idempotencyKey: `krossi-split-booker-refund-${due.shareId}` },
    );
  } catch (err) {
    const booking = await loadBooking(admin, due.bookingId);
    if (booking && (booking.status !== 'confirmed' || booking.payment_status !== 'paid')) {
      console.error('booker refund not needed: the booking was refunded whole', due.shareId, (err as Error).message);
      return false;
    }
    throw err;
  }
  const { error } = await admin.rpc('krossi_split_booker_refunded', { share_id_input: due.shareId, refund_id_input: refund.id });
  if (error) throw new Error(`krossi_split_booker_refunded failed: ${error.message}`);
  await notifyInternal(admin, { type: 'booking_split_paid', shareId: due.shareId });
  return true;
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
 * A booking was confirmed: the on-sale bookings it took over get their money back (the seller's
 * and every friend's who paid a share) and their sellers an email. Never throws — the booking
 * itself is confirmed; an unfinished refund stays due for the cron.
 */
export async function afterBookingPaid(stripe: Stripe, admin: Admin, bookingId: string) {
  try {
    const { data, error } = await admin.rpc('krossi_booking_resold_by', { booking_id_input: bookingId });
    if (error) throw new Error(error.message);
    for (const sold of (Array.isArray(data) ? data : []) as { bookingId: string; refundDue: boolean }[]) {
      await cancelPendingShares(stripe, admin, sold.bookingId);
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
}
