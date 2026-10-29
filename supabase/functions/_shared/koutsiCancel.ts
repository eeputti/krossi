// koutsiCancel.ts — a deleted account is never charged again: before a coach's account is deleted
// (koutsi-delete-account, koutsi-admin-delete-user), every live Koutsi subscription of the coach's
// Stripe customer is cancelled at once. Without the table (migration 20261029190000 not run) or
// without a customer this does nothing. Returns an error message, or null when it is safe to delete.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17.7.0';
import { koutsiCoachOf } from './koutsiPlan.js';

const LIVE = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']);

export async function cancelKoutsiSubscription(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await admin.from('koutsi_coach_plans')
    .select('stripe_customer_id').eq('coach_id', userId).maybeSingle();
  if (error) {
    const missing = ['PGRST205', '42P01'].includes((error as { code?: string }).code || '') || /does not exist|could not find the table/i.test(error.message);
    return missing ? null : error.message;
  }
  const customer = data?.stripe_customer_id;
  if (!customer) return null;
  const key = Deno.env.get('KOUTSI_STRIPE_SECRET_KEY') || Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return 'Stripe key missing';
  const stripe = new Stripe(key, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() });
  try {
    const list = await stripe.subscriptions.list({ customer, status: 'all', limit: 20 });
    for (const sub of list.data) {
      if (koutsiCoachOf(sub) && LIVE.has(sub.status)) await stripe.subscriptions.cancel(sub.id);
    }
    return null;
  } catch (err) {
    // A customer this Stripe account doesn't have (another mode): nothing to cancel.
    if ((err as { code?: string }).code === 'resource_missing') return null;
    return (err as Error).message;
  }
}
