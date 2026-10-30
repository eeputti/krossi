// subscription.js — the coach's Koutsi subscription (domain/subscription.js). The state is one RPC
// (koutsi_plan_status, also before signing in); Stripe is behind the edge function
// koutsi-subscription. Without the migration 20261029193756_koutsi_coach_plans status() answers
// { ready: false } and everything about it stays hidden; the coach key works as before.
import { ApiError } from '../errors.js';
import { db, isMissingFunction, isMissingTable, requireSession, SUPABASE_ANON_KEY, SUPABASE_URL } from './client.js';
import { mapStatus, NO_SUBSCRIPTION, SUBSCRIPTION_TERMS_VERSION } from '../../domain/subscription.js';

const notYet = () => new ApiError('Tilaus otetaan käyttöön pian.', { code: 'not_deployed' });
let priceOnce = null;

// The edge function: our answers carry { error: "<suomeksi>" }; a function that isn't deployed yet
// answers 404 without one.
async function call(action, extra = {}) {
  const session = await requireSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/koutsi-subscription`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...extra }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 404 && !payload.error) throw notYet();
    throw new ApiError(payload.error || 'Toiminto epäonnistui. Yritä hetken päästä uudelleen.');
  }
  return payload;
}

export const subscription = {
  async status() {
    const { data, error } = await db().rpc('koutsi_plan_status');
    if (error) {
      if (isMissingFunction(error) || isMissingTable(error)) return { ...NO_SUBSCRIPTION };
      throw error;
    }
    return mapStatus(data);
  },
  async startTrial() {
    const { data, error } = await db().rpc('koutsi_start_trial', { p_terms_version: SUBSCRIPTION_TERMS_VERSION });
    if (error && (isMissingFunction(error) || isMissingTable(error))) throw notYet();
    if (error) throw error;
    return mapStatus(data);
  },
  // Never throws: without a price the screens just leave it out. The same for every coach, so it is
  // read once per page load (a failed read is tried again next time).
  price() {
    if (!priceOnce) {
      priceOnce = call('price')
        .then(({ price }) => (price && Number.isFinite(price.cents) ? price : null))
        .catch(() => null);
      priceOnce.then((p) => { if (!p) priceOnce = null; });
    }
    return priceOnce;
  },
  async checkout(interval = 'month') {
    const { url } = await call('checkout', { interval: interval === 'year' ? 'year' : 'month' });
    if (!url) throw notYet();
    return { url };
  },
  async portal() {
    const { url } = await call('portal');
    if (!url) throw notYet();
    return { url };
  },
  // Right after Stripe: read the subscription from Stripe (not waiting for the webhook), then the state.
  async sync() {
    await call('sync');
    return subscription.status();
  },
  // A valmentaja-avain: one that gives more months (or free use), or an old coach key (koutsi_use_code).
  // Before that migration, the coach key alone.
  async useCode(code) {
    const { data, error } = await db().rpc('koutsi_use_code', { p_code: code, p_terms_version: SUBSCRIPTION_TERMS_VERSION });
    if (error && isMissingFunction(error)) {
      const key = await db().rpc('redeem_koutsi_coach_key', { key_input: String(code || '').trim() });
      if (key.error) throw key.error;
      return { ...(await subscription.status()), kind: 'key' };
    }
    if (error) throw error;
    return { ...mapStatus(data), kind: data?.kind || 'code', months: data?.months ?? null };
  },
};
