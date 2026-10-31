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
// After the plan is written the coach gets an e-mail when the subscription starts, is cancelled or
// resumed, a charge fails, or it ends after failed charges (../_shared/subscriptionMail.ts). Stripe
// sends nothing of its own for these. Resend's Idempotency-Key (the event id; the subscription id for
// the start) keeps Stripe's retries from mailing twice. A failed mail is logged and never fails the
// event. Secrets: RESEND_API_KEY + KOUTSI_MAIL_FROM (optional KOUTSI_MAIL_FROM_NAME, KOUTSI_MAIL_REPLY_TO,
// KOUTSI_APP_ORIGIN), the same as koutsi-notify.
//
// Signature verification is the auth: deploy with verify_jwt disabled (--no-verify-jwt).
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17.7.0';
import { applyArgs, bestSubscription, koutsiCoachOf, subscriptionIdOf } from '../_shared/koutsiPlan.js';
import { renderSubscriptionEmail, subscriptionMailKind } from '../_shared/subscriptionMail.ts';

const stripe = new Stripe(Deno.env.get('KOUTSI_STRIPE_SECRET_KEY') || Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const ok = (body: Record<string, unknown> = {}) => new Response(JSON.stringify({ received: true, ...body }), { status: 200 });

/** The coach's mail about this event, if it asks for one. Never throws: the plan is already written. */
async function mailCoach(admin: SupabaseClient, event: Stripe.Event, sub: Stripe.Subscription) {
  try {
    const kind = subscriptionMailKind(event, sub);
    const coach = koutsiCoachOf(sub);
    if (!kind || !coach) return null;
    const resendKey = Deno.env.get('RESEND_API_KEY');
    const mailFrom = Deno.env.get('KOUTSI_MAIL_FROM');
    if (!resendKey || !mailFrom) { console.error('koutsi subscription mail: mailer not configured'); return null; }
    const { data: who } = await admin.auth.admin.getUserById(coach);
    const to = who?.user?.email;
    if (!to) return null; // a deleted account
    const { data: profile } = await admin.from('profiles').select('name').eq('id', coach).maybeSingle();
    const name = String(profile?.name || '').trim().split(/\s+/)[0] || '';
    const { subject, html, text } = renderSubscriptionEmail(kind, sub, {
      name, appOrigin: Deno.env.get('KOUTSI_APP_ORIGIN') ?? 'https://koutsi.krossi.app', test: !event.livemode,
    });
    const replyTo = Deno.env.get('KOUTSI_MAIL_REPLY_TO');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'content-type': 'application/json',
        'Idempotency-Key': kind === 'started' ? `koutsi-sub-started-${sub.id}` : `koutsi-sub-${kind}-${event.id}`,
      },
      body: JSON.stringify({
        from: `${Deno.env.get('KOUTSI_MAIL_FROM_NAME') ?? 'Krossi Koutsi'} <${mailFrom}>`,
        to: [to],
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
        tags: [{ name: 'app', value: 'koutsi' }, { name: 'kind', value: `subscription_${kind}` }],
      }),
    });
    if (!res.ok) { console.error('koutsi subscription mail failed', event.id, res.status, (await res.text()).slice(0, 200)); return null; }
    return kind;
  } catch (err) {
    console.error('koutsi subscription mail failed', event.id, (err as Error).message);
    return null;
  }
}

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
    // the mail tells about the event's own subscription, as Stripe has it now
    const mailed = await mailCoach(admin, event, sub);
    console.log('koutsi event', event.type, event.livemode ? 'live' : 'test', plan, mailed || '');
    return ok({ plan, mailed });
  } catch (err) {
    // A subscription this Stripe account doesn't have (another mode's event): nothing to record.
    if ((err as { code?: string }).code === 'resource_missing') return ok({ ignored: true });
    // Stripe retries a 500 for up to three days.
    console.error('koutsi plan update failed', event.id, (err as Error).message);
    return new Response('koutsi plan update failed', { status: 500 });
  }
});
