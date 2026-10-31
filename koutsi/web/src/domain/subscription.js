// subscription.js — the coach's Koutsi subscription in words: a 3-month free trial without a card,
// then a monthly subscription through Stripe (supabase/migrations/20261029193756_koutsi_coach_plans.sql).
//
// Status (api.subscription.status()):
//   { ready, selfServe, plan: 'free' | 'trial' | 'active' | 'past_due' | 'ended' | null, trialEndsAt,
//     stripeStatus, periodEnd, cancelAtPeriodEnd, hasCustomer }
//   ready = the database has it; selfServe = a new coach may start without a key; plan null = not a coach.
//   'free' (today's coaches, coach keys) never shows anything.
// Price (api.subscription.price()), from Stripe; null while it is not set up:
//   { cents, interval: 'month', offer: { cents, months } | null, vat: number | null, year: { cents } | null }
//   vat = VAT added on top (once Roisku Media is VAT-liable); null = the price is the whole sum.
//   year = the yearly price (cheaper than 12 months), when one is set up; the founding offer is monthly only.
// Valmentaja-avaimet (api.subscription.useCode, supabase/migrations/20261030080055_koutsi_trial_codes.sql): the
// default trial is 3 months; a key from the owner gives N free months from the day of use (a surprise,
// keyWelcome), or free use. The same input takes an old coach key.

// The subscription terms a new coach accepts (koutsi-tilausehdot.html): change together with the
// terms' "Voimassa" date. Not the pilot acknowledgement (PILOT_TERMS_VERSION stays as it is).
export const SUBSCRIPTION_TERMS_VERSION = '2026-10-30';
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

/** The founding offer, when the price has one that is cheaper than the price itself. */
const offerOf = (price) => {
  const offer = price?.offer;
  return offer && Number.isFinite(offer.cents) && offer.cents < price.cents && offer.months > 0 ? offer : null;
};

/** "29 €/kk", "19 €/kk 12 kk, sitten 29 €/kk", with VAT "… + alv"; '' without a price. */
export function priceLine(price) {
  if (!price || !Number.isFinite(price.cents)) return '';
  const base = `${fmtEuros(price.cents)}/kk`;
  const vat = price.vat ? ' + alv' : '';
  const offer = offerOf(price);
  if (offer) return `${fmtEuros(offer.cents)}/kk ${offer.months} kk, sitten ${base}${vat}`;
  return `${base}${vat}`;
}

/** "290 €/v" (with VAT "290 €/v + alv"); '' without a yearly price. */
export function yearLine(price) {
  if (!price?.year || !Number.isFinite(price.year.cents)) return '';
  return `${fmtEuros(price.year.cents)}/v${price.vat ? ' + alv' : ''}`;
}

/** The first year on the monthly price, in cents: the founding offer's months at the offer price. */
function firstYearMonthly(price) {
  const offer = offerOf(price);
  const m = offer ? Math.min(12, offer.months) : 0;
  return (offer ? offer.cents * m : 0) + price.cents * (12 - m);
}

/** What a year costs less than the first twelve months monthly (the founding offer counted), in cents. */
export function yearSaving(price) {
  if (!price?.year || !Number.isFinite(price.cents) || !Number.isFinite(price.year.cents)) return 0;
  return Math.max(0, firstYearMonthly(price) - price.year.cents);
}

/**
 * "Ota tilaus": monthly, and yearly when there is a yearly price. → [{ interval, title, sub }]
 * The founding offer is monthly only: while it is on, a year is not "säästät" but "ilman aloitustarjousta".
 */
export function checkoutChoices(price) {
  const month = { interval: 'month', title: 'Kuukausi', sub: priceLine(price) || 'Kuukausittain' };
  if (!yearLine(price)) return [month];
  const save = yearSaving(price);
  const note = save ? `, säästät ${fmtEuros(save)}` : offerOf(price) ? ', ilman aloitustarjousta' : '';
  return [month, { interval: 'year', title: 'Vuosi', sub: `${yearLine(price)}${note}` }];
}

/**
 * The surprise after a valmentaja-avain (useCode → { kind, months, plan, trialEndsAt }): null for an
 * old key that just makes a free coach, else { title, text }.
 */
export function keyWelcome(result) {
  if (!result || result.kind === 'key') return null;
  if (result.plan === 'free') return { title: 'Koutsi on sinulle maksuton!', text: '' };
  const until = result.trialEndsAt ? `Kokeilu jatkuu ${fmtDay(result.trialEndsAt)} asti.` : '';
  if (result.months) return { title: `Sait ${result.months} kk ilmaisen kokeilun!`, text: until };
  return { title: 'Kokeilu jatkuu!', text: until };
}

/**
 * What Profiili → Tilaus shows, or null when nothing (no database yet, not a coach, a free coach).
 * → { tone: 'lime' | 'warn', icon, title, text, action: 'checkout' | 'portal', label, code }
 *   code = "Onko sinulla valmentaja-avain?" belongs on the card (an ended trial or subscription; a running
 *   trial already has its key).
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
      // the key is already used (a trial starts with one): no "Onko sinulla valmentaja-avain?" here
      text: `Kokeilu päättyy ${fmtDay(status.trialEndsAt)}.`,
      action: 'checkout', label: 'Ota tilaus', code: false,
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
      action: 'checkout', label: 'Ota tilaus', code: true,
    };
  }
  return null;
}
