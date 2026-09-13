// Marks a profile as paid once Stripe confirms the one-time checkout succeeded.
// Signature verification (not a Supabase JWT) is the auth here, since Stripe calls
// this endpoint directly — the function must be deployed with verify_jwt disabled.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17.7.0?target=deno';

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

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.client_reference_id || session.metadata?.supabase_user_id;
    if (userId && session.payment_status === 'paid') {
      const { error } = await admin.from('profiles').update({
        paid_at: new Date().toISOString(),
        stripe_customer_id: typeof session.customer === 'string' ? session.customer : session.customer?.id,
      }).eq('id', userId);
      if (error) console.error('paid_at update failed', error.message);
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
