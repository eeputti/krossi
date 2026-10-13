// Marks a profile as paid once Stripe confirms the one-time checkout succeeded.
// Signature verification (not a Supabase JWT) is the auth here, since Stripe calls
// this endpoint directly — the function must be deployed with verify_jwt disabled.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17.7.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const signature = req.headers.get('Stripe-Signature');
  const body = await req.text();
  if (!signature) return new Response('missing signature', { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!,
      undefined,
      cryptoProvider,
    );
  } catch (err) {
    return new Response(`signature verification failed: ${(err as Error).message}`, { status: 400 });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // Idempotenssi: sama Stripe-tapahtuma ei saa merkitä maksua kahdesti (Stripe voi lähettää sen uudelleen).
  const { error: seenError } = await admin.from('stripe_events').insert({ id: event.id });
  if (seenError) return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });

  // Who paid: hosted Checkout (stripe-checkout) or the in-app checkout (krossi-payment).
  let paid: { userId: string; customerId: string | null; intent?: Stripe.PaymentIntent } | null = null;
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.client_reference_id || session.metadata?.supabase_user_id;
    if (userId && session.payment_status === 'paid') {
      paid = { userId, customerId: (typeof session.customer === 'string' ? session.customer : session.customer?.id) ?? null };
    }
  } else if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object as Stripe.PaymentIntent;
    const userId = intent.metadata?.supabase_user_id;
    if (userId && intent.metadata?.product === 'krossi_unlock') {
      paid = { userId, customerId: (typeof intent.customer === 'string' ? intent.customer : intent.customer?.id) ?? null, intent };
    }
  }

  if (paid) {
    // First payment wins: a late or repeated event never moves paid_at.
    const { error } = await admin.from('profiles').update({
      paid_at: new Date().toISOString(),
      ...(paid.customerId ? { stripe_customer_id: paid.customerId } : {}),
    }).eq('id', paid.userId).is('paid_at', null);
    if (error) {
      console.error('paid_at update failed', error.message);
      // Forget the event so Stripe's retry gets another go instead of being skipped as a duplicate.
      await admin.from('stripe_events').delete().eq('id', event.id);
      return new Response('paid_at update failed', { status: 500 });
    }
    // Same stamp as krossi-payment's applyPayment: this payment has now unlocked the profile once.
    if (paid.intent && !paid.intent.metadata?.applied_at) {
      try {
        await stripe.paymentIntents.update(paid.intent.id, { metadata: { applied_at: new Date().toISOString() } });
      } catch (err) {
        console.error('applied_at stamp failed', (err as Error).message);
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
