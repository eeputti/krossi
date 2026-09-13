// Creates a Stripe Checkout session for the one-time Krossi profile payment.
// Only a signed-in caller can start a session, and we reuse their existing
// Stripe customer (stored on profiles) instead of creating a new one every time.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17.7.0?target=deno';

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

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: callerData, error: callerError } = await asUser.auth.getUser();
  if (callerError || !callerData?.user) return json(req, { error: 'Kirjaudu uudelleen sisään.' }, 401);
  const user = callerData.user;

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: profile } = await admin.from('profiles').select('paid_at, stripe_customer_id').eq('id', user.id).single();
  if (profile?.paid_at) return json(req, { error: 'Olet jo maksanut.' }, 400);

  let customerId = profile?.stripe_customer_id || null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email || undefined,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    await admin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id);
  }

  const origin = req.headers.get('Origin') || '';
  const returnBase = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    client_reference_id: user.id,
    metadata: { supabase_user_id: user.id },
    line_items: [{ price: Deno.env.get('STRIPE_PRICE_ID')!, quantity: 1 }],
    success_url: `${returnBase}/pelaa?stripe=success`,
    cancel_url: `${returnBase}/pelaa?stripe=cancel`,
  });

  return json(req, { url: session.url });
});
