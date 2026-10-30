// koutsi-stripe-webhook — Stripe → koutsi_coach_plans for Koutsi's coach subscriptions. Krossi's
// stripe-webhook is not touched: this is its own endpoint with its own signing secret
// (KOUTSI_STRIPE_WEBHOOK_SECRET), and it acts only on objects marked metadata.product =
// 'koutsi_subscription' (../_shared/koutsiPlan.js) — everything else is answered 200 and left alone.
//
// Events (scripts/koutsi-stripe-setup.mjs subscribes them): checkout.session.completed,
// customer.subscription.created / .updated / .deleted. The subscription is read fresh from Stripe
// every time and written whole (koutsi_plan_apply_stripe), so a repeated or late event can't move
// anything backwards and no event log is needed (Krossi's stripe_events table is not used: the same
// event id reaches both endpoints). What is written is the best of the coach's subscriptions on that
// customer (bestSubscription: the newest live one), not just the event's: should a coach ever end up
// with two, an event of the one cancelled never ends the plan while the other is live.
//
// Signature verification is the auth: deploy with verify_jwt disabled (--no-verify-jwt).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17.7.0';
import { applyArgs, bestSubscription, subscriptionIdOf } from '../_shared/koutsiPlan.js';

const stripe = new Stripe(Deno.env.get('KOUTSI_STRIPE_SECRET_KEY') || Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const ok = (body: Record<string, unknown> = {}) => new Response(JSON.stringify({ received: true, ...body }), { status: 200 });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const signature = req.headers.get('Stripe-Signature');
  const secret = Deno.env.get('KOUTSI_STRIPE_WEBHOOK_SECRET');
  if (!signature || !secret) return new Response('missing signature', { status: 400 });
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, secret, undefined, cryptoProvider);
  } catch (err) {
    return new Response(`signature verification failed: ${(err as Error).message}`, { status: 400 });
  }

  const subscriptionId = subscriptionIdOf(event);
  if (!subscriptionId) return ok({ ignored: true });

  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    let chosen: Stripe.Subscription = sub;
    const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    if (customer) {
      const list = await stripe.subscriptions.list({ customer, status: 'all', limit: 20 });
      const best = bestSubscription(sub, list.data);
      if (best?.sub) chosen = best.sub;
      if (best && best.live > 1) console.error('koutsi: a coach has', best.live, 'live subscriptions on', customer);
    }
    const args = applyArgs(chosen);
    if (!args) return ok({ ignored: true });
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    });
    const { data: plan, error } = await admin.rpc('koutsi_plan_apply_stripe', args);
    if (error) throw new Error(error.message);
    return ok({ plan });
  } catch (err) {
    // A subscription this Stripe account doesn't have (another mode's event): nothing to record.
    if ((err as { code?: string }).code === 'resource_missing') return ok({ ignored: true });
    // Stripe retries a 500 for up to three days.
    console.error('koutsi plan update failed', event.id, (err as Error).message);
    return new Response('koutsi plan update failed', { status: 500 });
  }
});
