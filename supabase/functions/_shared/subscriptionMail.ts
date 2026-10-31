// _shared/subscriptionMail.ts — the coach's own e-mails about the Koutsi subscription, sent by
// koutsi-stripe-webhook: the subscription started, was cancelled, was resumed, a charge failed, or it
// ended after failed charges. Stripe mails nothing when a subscription starts inside a free trial or is
// cancelled, so without these the coach heard nothing. The Krossi look of koutsi-notify's mails. Pure,
// so koutsi/web/test/subscriptionMail.test.mjs runs it in Node.
import { offerMonths } from './koutsiPlan.js';

const C = { ink: '#121212', ink2: '#333333', muted: '#6A6A6A', line: '#E8E8E8', page: '#F7F7F7', lime: '#CFE414' };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif";
const SELLER = 'Roisku Media (Y-tunnus 3413406-6)';

export type SubscriptionMailKind = 'started' | 'cancelled' | 'resumed' | 'payment_failed' | 'ended_unpaid';

// deno-lint-ignore no-explicit-any
type Obj = any;

const escapeHtml = (s: string) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** 2900 → "29 €", 1990 → "19,90 €" (the app's way: koutsi/web/src/domain/subscription.js fmtEuros). */
export function fmtEuros(cents: number): string {
  const n = Math.round(Number(cents) || 0);
  const rest = n % 100;
  return rest ? `${Math.floor(n / 100)},${String(rest).padStart(2, '0')} €` : `${n / 100} €`;
}

/** Unix seconds → "30.4.2027" in Finnish time; '' without a time. */
export function fmtDay(unix: number | null | undefined): string {
  if (!Number.isFinite(unix) || !unix) return '';
  const parts = new Intl.DateTimeFormat('fi-FI', { timeZone: 'Europe/Helsinki', day: 'numeric', month: 'numeric', year: 'numeric' })
    .formatToParts(new Date(unix * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${get('day')}.${get('month')}.${get('year')}`;
}

const ending = (s: Obj) => Boolean(s?.cancel_at_period_end || s?.cancel_at);

/**
 * Which mail a Stripe event about a Koutsi subscription asks for, or null. `sub` = the subscription as
 * Stripe has it now (read fresh by the webhook): a mail that no longer holds (a cancellation already
 * taken back when its event comes late) is not sent.
 */
export function subscriptionMailKind(event: Obj, sub: Obj): SubscriptionMailKind | null {
  const obj = event?.data?.object;
  const prev = event?.data?.previous_attributes || {};
  if (!obj || !sub) return null;
  if (event.type === 'checkout.session.completed') {
    return obj.mode === 'subscription' && ['active', 'trialing'].includes(sub.status) ? 'started' : null;
  }
  if (event.type === 'customer.subscription.updated') {
    if ('cancel_at_period_end' in prev || 'cancel_at' in prev) {
      const before = {
        cancel_at_period_end: 'cancel_at_period_end' in prev ? prev.cancel_at_period_end : obj.cancel_at_period_end,
        cancel_at: 'cancel_at' in prev ? prev.cancel_at : obj.cancel_at,
      };
      const live = ['active', 'trialing', 'past_due'].includes(sub.status);
      if (ending(obj) && !ending(before)) return ending(sub) && live ? 'cancelled' : null;
      if (!ending(obj) && ending(before)) return !ending(sub) && live ? 'resumed' : null;
    }
    if ('status' in prev && obj.status === 'past_due' && prev.status !== 'past_due') {
      return sub.status === 'past_due' ? 'payment_failed' : null;
    }
    return null;
  }
  if (event.type === 'customer.subscription.deleted') {
    // ended at the period's end after a cancellation (the coach was told then) or with a deleted
    // account: no mail. Ended because the charges failed: the coach should know.
    return obj.cancellation_details?.reason === 'payment_failed' ? 'ended_unpaid' : null;
  }
  return null;
}

/** The price facts of a subscription (Stripe API 2024-06-20 shape: `discount`, `current_period_end`). */
export function subscriptionFacts(sub: Obj) {
  const item = sub?.items?.data?.[0];
  const price = item?.price || sub?.plan || {};
  const cents = Number(price.unit_amount ?? price.amount) || 0;
  const interval = (price.recurring?.interval || price.interval) === 'year' ? 'year' : 'month';
  const tax = (sub?.default_tax_rates || []).find((t: Obj) => t && !t.inclusive && Number(t.percentage) > 0);
  const vat = tax ? Number(tax.percentage) : null;
  const coupon = sub?.discount?.coupon || null;
  const discountEnd = Number(sub?.discount?.end) || null;
  let off = 0;
  if (coupon) {
    off = Number.isFinite(coupon.amount_off) && coupon.amount_off > 0 ? coupon.amount_off
      : Number.isFinite(coupon.percent_off) ? Math.round(cents * coupon.percent_off / 100) : 0;
    off = Math.min(off, cents);
  }
  const offer = off > 0 && interval === 'month' ? { cents: cents - off, months: offerMonths(coupon), end: discountEnd } : null;
  const trialEnd = sub?.status === 'trialing' ? Number(sub.trial_end) || null : null;
  const periodEnd = Number(sub?.current_period_end ?? item?.current_period_end) || null;
  // the next charge: when the trial ends, else at the period's end; the offer price while the discount lasts
  const nextAt = trialEnd || periodEnd;
  const discounted = offer && (!discountEnd || (nextAt && nextAt < discountEnd));
  const base = discounted ? offer.cents : cents;
  const nextCents = vat ? Math.round(base * (1 + vat / 100)) : base;
  return { cents, interval, vat, offer, trialEnd, periodEnd, nextAt, nextCents, endsAt: Number(sub?.cancel_at) || periodEnd };
}

/** "19 €/kk 12 kuukautta, sitten 29 €/kk" / "29 €/kk" / "290 €/v" (+ alv when VAT is added on top). */
export function priceText(f: ReturnType<typeof subscriptionFacts>): string {
  const per = f.interval === 'year' ? '/v' : '/kk';
  const vat = f.vat ? ` + alv ${String(f.vat).replace('.', ',')} %` : '';
  if (f.offer && f.offer.months > 0) return `${fmtEuros(f.offer.cents)}${per} ${f.offer.months} kuukautta, sitten ${fmtEuros(f.cents)}${per}${vat}`;
  return `${fmtEuros(f.cents)}${per}${vat}`;
}

const MANAGE = 'Profiili → Tilaus → Hallitse tilausta';
const LOCKED = 'Sen jälkeen näet ja suunnittelet kaiken kuten ennenkin, ja pelaajasi pitävät kaiken. Uusien huomioiden, kotiläksyjen, videoiden, tiedotteiden ja laskujen lähettäminen pelaajille vaatii silloin tilauksen.';

/**
 * subject, html and text of one subscription mail. `name` = the coach's name ('' → "Hei!"), `appOrigin`
 * = https://koutsi.krossi.app, `test` = a Stripe test-mode event (the subject says TESTI).
 */
export function renderSubscriptionEmail(kind: SubscriptionMailKind, sub: Obj, { name = '', appOrigin = 'https://koutsi.krossi.app', test = false } = {}) {
  const f = subscriptionFacts(sub);
  const link = `${appOrigin}/valmentaja/profiili`;
  let subject = '';
  let headline = '';
  let lead: string[] = [];
  let rows: [string, string][] = [];
  let label = 'Avaa Koutsi';
  if (kind === 'started') {
    subject = 'Koutsi-tilauksesi on voimassa';
    headline = 'Kiitos, tilauksesi on voimassa!';
    lead = [f.trialEnd
      ? `Ilmainen kokeilusi jatkuu ${fmtDay(f.trialEnd)} asti. Sinulta ei veloiteta mitään ennen sitä.`
      : 'Maksu on vastaanotettu, ja Koutsi on käytössäsi.'];
    rows = [
      ['Tilaus', f.interval === 'year' ? 'Koutsi, vuositilaus' : 'Koutsi, kuukausitilaus'],
      ['Hinta', priceText(f)],
      ...(f.nextAt ? [[f.trialEnd ? 'Ensimmäinen veloitus' : 'Seuraava veloitus', `${fmtDay(f.nextAt)}, ${fmtEuros(f.nextCents)}`] as [string, string]] : []),
      ['Myyjä', SELLER],
    ];
    lead.push(`Voit perua tilauksen milloin tahansa kohdasta ${MANAGE}. Peruttu tilaus on voimassa jakson loppuun. Kuitit löydät samasta paikasta.`);
  } else if (kind === 'cancelled') {
    subject = 'Koutsi-tilauksesi on peruttu';
    headline = 'Tilauksesi on peruttu';
    lead = [
      f.trialEnd
        ? `Sinulta ei veloiteta mitään. Kokeilusi jatkuu ${fmtDay(f.trialEnd)} asti.`
        : `Sinulta ei veloiteta enää. Tilauksesi on voimassa ${fmtDay(f.endsAt)} asti.`,
      LOCKED,
      `Muutitko mielesi? Voit jatkaa tilausta ennen sitä kohdasta ${MANAGE}.`,
    ];
  } else if (kind === 'resumed') {
    subject = 'Koutsi-tilauksesi jatkuu';
    headline = 'Tilauksesi jatkuu';
    lead = [f.trialEnd
      ? `Perumisesi on peruttu. Kokeilusi jatkuu ${fmtDay(f.trialEnd)} asti, ja ensimmäinen veloitus on silloin: ${fmtEuros(f.nextCents)}.`
      : `Perumisesi on peruttu. Seuraava veloitus on ${fmtDay(f.nextAt)}: ${fmtEuros(f.nextCents)}.`];
  } else if (kind === 'payment_failed') {
    subject = 'Koutsin veloitus ei onnistunut';
    headline = 'Veloitus ei onnistunut';
    lead = [
      'Emme saaneet veloitettua Koutsi-tilaustasi. Päivitä maksutapa kohdasta Profiili → Tilaus → Päivitä maksutapa, niin tilauksesi jatkuu.',
      'Pelaajasi eivät huomaa tästä mitään.',
    ];
    label = 'Päivitä maksutapa';
  } else {
    subject = 'Koutsi-tilauksesi päättyi';
    headline = 'Tilauksesi päättyi';
    lead = [
      'Tilauksesi päättyi, koska veloitus ei onnistunut.',
      'Näet ja suunnittelet kaiken kuten ennenkin, ja pelaajasi pitävät kaiken. Pelaajille lähettäminen vaatii tilauksen: voit ottaa sen uudelleen kohdasta Profiili → Tilaus.',
    ];
  }
  if (test) subject = `TESTI: ${subject}`;
  const hello = name ? `Hei ${name},` : 'Hei!';
  const table = rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;font-size:13px;color:${C.muted};white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td><td style="padding:4px 0;font-size:14px;font-weight:700;color:${C.ink}">${escapeHtml(v)}</td></tr>`).join('');
  const para = (t: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${C.ink2}">${escapeHtml(t)}</p>`;
  const html = `<!doctype html><html lang="fi"><body style="margin:0;background:${C.page};font-family:${FONT};color:${C.ink}">
  <div style="max-width:520px;margin:0 auto;padding:28px 16px">
    <div style="margin:0 0 18px;font-size:20px;font-weight:800;letter-spacing:-0.4px;color:${C.ink}">Krossi <span style="display:inline-block;vertical-align:2px;margin-left:2px;padding:3px 9px;border-radius:999px;background:${C.lime};color:${C.ink};font-size:12px;font-weight:800;letter-spacing:0">Koutsi</span></div>
    <div style="background:#ffffff;border:1px solid ${C.line};border-radius:12px;padding:24px 22px">
      <p style="margin:0 0 12px;font-size:15px;color:${C.muted}">${escapeHtml(hello)}</p>
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;font-weight:800;letter-spacing:-0.3px;color:${C.ink}">${escapeHtml(headline)}</h1>
      ${lead.slice(0, 1).map(para).join('')}
      ${table ? `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 14px">${table}</table>` : ''}
      ${lead.slice(1).map(para).join('')}
      <a href="${escapeHtml(link)}" style="display:inline-block;margin-top:4px;background:${C.lime};color:${C.ink};text-decoration:none;font-weight:800;font-size:15px;padding:13px 24px;border-radius:999px">${escapeHtml(label)}</a>
    </div>
    <p style="margin:16px 4px 0;font-size:12px;line-height:1.5;color:${C.muted}">Tilausehdot: <a href="${appOrigin}/tilausehdot" style="color:${C.ink};font-weight:700">${appOrigin.replace(/^https?:\/\//, '')}/tilausehdot</a>. Kysyttävää tilauksesta? Vastaa tähän viestiin.</p>
  </div>
</body></html>`;
  const text = [
    hello, '', headline, lead[0], '',
    ...(rows.length ? [...rows.map(([k, v]) => `${k}: ${v}`), ''] : []),
    ...lead.slice(1).flatMap((t) => [t, '']),
    `${label}: ${link}`, '',
    `Tilausehdot: ${appOrigin}/tilausehdot. Kysyttävää tilauksesta? Vastaa tähän viestiin.`,
  ].join('\n');
  return { subject, html, text };
}
