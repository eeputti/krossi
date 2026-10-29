// subscription.js — the coach's Koutsi subscription in words: a 3-month free trial without a card,
// then a monthly subscription through Stripe (koutsi/web/sql/20261029190000_koutsi_coach_plans.sql).
//
// Status (api.subscription.status()):
//   { ready, selfServe, plan: 'free' | 'trial' | 'active' | 'past_due' | 'ended' | null, trialEndsAt,
//     stripeStatus, periodEnd, cancelAtPeriodEnd, hasCustomer }
//   ready = the database has it; selfServe = a new coach may start without a key; plan null = not a coach.
//   'free' (today's coaches, coach keys) never shows anything.
// Price (api.subscription.price()), from Stripe; null while it is not set up:
//   { cents, interval: 'month', offer: { cents, months } | null }

// The subscription terms a new coach accepts (koutsi-tilausehdot.html): change together with the
// terms' "Voimassa" date. Not the pilot acknowledgement (PILOT_TERMS_VERSION stays as it is).
export const SUBSCRIPTION_TERMS_VERSION = '2026-10-29';
export const TRIAL_MONTHS = 3;

export const NO_SUBSCRIPTION = Object.freeze({
  ready: false, selfServe: false, plan: null, trialEndsAt: null, stripeStatus: null, periodEnd: null,
  cancelAtPeriodEnd: false, hasCustomer: false,
});

/** The database row (koutsi_plan_status) → the status above. */
export function mapStatus(row) {
  if (!row || typeof row !== 'object') return { ...NO_SUBSCRIPTION, ready: true };
  return {
    ready: true,
    selfServe: row.self_serve === true,
    plan: row.plan || null,
    trialEndsAt: row.trial_ends_at || null,
    stripeStatus: row.stripe_status || null,
    periodEnd: row.period_end || null,
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    hasCustomer: row.has_customer === true,
  };
}

/** Whole days until `iso` (a started day counts), never below 0. */
export function daysLeft(iso, now = new Date()) {
  const end = Date.parse(iso);
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.ceil((end - now.getTime()) / 86400000));
}

/** 27.1.2027 */
export function fmtDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

/** 2900 → "29 €", 1990 → "19,90 €" */
export function fmtEuros(cents) {
  const n = Math.round(Number(cents) || 0);
  const whole = Math.floor(n / 100);
  const rest = n % 100;
  return rest ? `${whole},${String(rest).padStart(2, '0')} €` : `${whole} €`;
}

/** "29 €/kk" or "19 €/kk 12 kk, sitten 29 €/kk"; '' without a price. */
export function priceLine(price) {
  if (!price || !Number.isFinite(price.cents)) return '';
  const base = `${fmtEuros(price.cents)}/kk`;
  const offer = price.offer;
  if (offer && Number.isFinite(offer.cents) && offer.cents < price.cents && offer.months > 0) {
    return `${fmtEuros(offer.cents)}/kk ${offer.months} kk, sitten ${base}`;
  }
  return base;
}

/**
 * What Profiili → Tilaus shows, or null when nothing (no database yet, not a coach, a free coach).
 * → { tone: 'lime' | 'warn', icon, title, text, action: 'checkout' | 'portal', label }
 */
export function planCard(status, price = null, now = new Date()) {
  if (!status?.ready) return null;
  const { plan } = status;
  const cost = priceLine(price);
  if (plan === 'trial') {
    const left = daysLeft(status.trialEndsAt, now);
    return {
      tone: 'lime', icon: 'clock',
      title: left === 1 ? 'Kokeilua jäljellä 1 päivä' : `Kokeilua jäljellä ${left} pv`,
      text: `Ilmainen ${fmtDay(status.trialEndsAt)} asti${cost ? `, sitten ${cost}` : ''}. Tilauksen veloitus alkaa vasta kokeilun jälkeen.`,
      action: 'checkout', label: 'Ota tilaus',
    };
  }
  if (plan === 'active') {
    const day = fmtDay(status.periodEnd);
    let text = day ? `Seuraava veloitus ${day}.` : '';
    if (status.cancelAtPeriodEnd) text = day ? `Päättyy ${day}. Voit jatkaa tilausta ennen sitä.` : 'Päättyy kauden lopussa.';
    else if (status.stripeStatus === 'trialing') text = day ? `Ensimmäinen veloitus ${day}, kun kokeilu päättyy.` : '';
    return { tone: 'lime', icon: 'check', title: 'Tilaus voimassa', text, action: 'portal', label: 'Hallitse tilausta' };
  }
  if (plan === 'past_due') {
    return {
      tone: 'warn', icon: 'alert', title: 'Maksu ei mennyt läpi',
      text: 'Päivitä maksutapa, niin tilaus jatkuu.', action: 'portal', label: 'Päivitä maksutapa',
    };
  }
  if (plan === 'ended') {
    const subscribed = Boolean(status.stripeStatus);
    const day = fmtDay(subscribed ? status.periodEnd : status.trialEndsAt);
    return {
      tone: 'warn', icon: 'clock', title: subscribed ? 'Tilaus päättyi' : 'Kokeilu päättyi',
      text: [day ? `Päättyi ${day}.` : '', `Pelaajille lähettäminen vaatii tilauksen${cost ? ` (${cost})` : ''}.`].filter(Boolean).join(' '),
      action: 'checkout', label: 'Ota tilaus',
    };
  }
  return null;
}
