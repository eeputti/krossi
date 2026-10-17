// payouts.js — what an online payment costs the hall (Hallin asetukset → Verkkomaksut). Pure, so
// test/payouts.test.mjs checks it against the server's rule.
//
// Every payment goes to the hall's own Stripe account and Krossi takes its share on the way
// (supabase/functions/_shared/fees.ts): Stripe's estimated cost + the hall's margin,
//   fee = ceil(amount × (stripeBps + marginBps) / 10 000) + stripeFixedCents + marginFixedCents,
// never more than the payment. `fee` is PayoutStatus.fee from billing.payoutStatus.

import { LIVE_SPORTS, centsLabel } from './booking.js';

/** Krossi's share of a payment of `cents` (Stripe's cost included). */
export function paymentFee(cents, fee) {
  const bps = (fee?.stripeBps || 0) + (fee?.marginBps || 0);
  const fixed = (fee?.stripeFixedCents || 0) + (fee?.marginFixedCents || 0);
  return Math.min(cents, Math.ceil((cents * bps) / 10_000) + fixed);
}

/** '1,75 %' from basis points. */
export function percentLabel(bps) {
  return `${(bps / 100).toLocaleString('fi-FI', { maximumFractionDigits: 2 })} %`;
}

/** '1,75 % + 0,36 €' | '2 %' | '0,10 €' | '0 €' */
export function rateLabel(bps, fixedCents) {
  const parts = [bps ? percentLabel(bps) : null, fixedCents ? centsLabel(fixedCents) : null].filter(Boolean);
  return parts.join(' + ') || '0 €';
}

/** The hall's 1-hour prices for the courts players book, lowest first (at most `max`). */
export function hourPrices(venue, max = 3) {
  const prices = new Set();
  for (const rule of venue?.prices || []) {
    if (rule.sports && !rule.sports.some((s) => LIVE_SPORTS.includes(s))) continue;
    if (rule.centsPerHour > 0) prices.add(rule.centsPerHour);
  }
  const sorted = [...prices].sort((a, b) => a - b);
  if (sorted.length <= max) return sorted;
  // The cheapest, the dearest and one in between.
  return [sorted[0], sorted[Math.floor((sorted.length - 1) / 2)], sorted[sorted.length - 1]].slice(0, max);
}

/**
 * Rows for the cost table: a 1-hour booking at each of the hall's prices, and the dearest one
 * split four ways (jaettu maksu: the booker pays it all, three friends pay a quarter each and get
 * it back to the booker — four payments, each with its own fee). → [{ label, cents, feeCents, hallCents }]
 */
export function feeExamples(venue, fee) {
  const prices = hourPrices(venue);
  const list = prices.length ? prices : [2000, 3000];
  const rows = list.map((cents) => {
    const feeCents = paymentFee(cents, fee);
    return { label: `1 h · ${centsLabel(cents)}`, cents, feeCents, hallCents: cents - feeCents };
  });
  const top = list[list.length - 1];
  const share = Math.floor(top / 4);
  const splitFee = paymentFee(top, fee) + 3 * paymentFee(share, fee);
  rows.push({ label: `1 h · ${centsLabel(top)}, jaettu 4 osaan`, cents: top, feeCents: splitFee, hallCents: top - splitFee });
  return rows;
}

/** The account's state for the row and the sheet: { tone, chip, text }. */
export function payoutStateLabel(status) {
  if (status?.state === 'ready') {
    return { tone: 'success', chip: 'Valmis', text: 'Pelaajien maksut menevät hallin Stripe-tilille.' };
  }
  if (status?.state === 'pending') {
    const due = status.dueCount
      ? `Stripe tarvitsee hallilta vielä ${status.dueCount === 1 ? 'yhden tiedon' : `${status.dueCount} tietoa`}.`
      : 'Stripe tarkistaa hallin tietoja.';
    return { tone: 'warn', chip: 'Kesken', text: `${due} Verkkomaksut eivät ole vielä käytössä.` };
  }
  return { tone: 'neutral', chip: 'Ei yhdistetty', text: 'Hallilla ei ole Stripe-tiliä. Pelaajat eivät voi vielä maksaa verkossa.' };
}
