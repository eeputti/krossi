// billing.js — laskutus for kausivuorot: the hall's invoices (RPCs), the card kept on file for
// monthly season charges, the charges themselves and the hall's invoicing details (Hallin
// asetukset). Reading and marking invoices and the details go through SECURITY DEFINER RPCs;
// everything that touches Stripe or sends mail goes through the krossi-billing edge function
// (SetupIntent, off-session PaymentIntents, invoice e-mail). The hall's own Stripe account (Stripe
// Connect, Hallin asetukset → Verkkomaksut) goes through krossi-connect.

import { db, isMissingFunction, isUuid, requireUid } from './client.js';
import { DATE_RE, call, callOrEmpty, edgeCall, fail, list, number, rpcError, text } from './bookingCore.js';
import { mapBillingSettings, mapCard, mapCharge, mapInvoice } from './hallMaps.js';

const FUNCTION = 'krossi-billing';
const LOAD_FAIL = 'Laskutustietoja ei voitu ladata.';
const CARD_FAIL = 'Kortin tallennus epäonnistui. Yritä hetken päästä uudelleen.';
const PAY_FAIL = 'Maksun aloitus epäonnistui. Yritä hetken päästä uudelleen.';

const edge = (action, payload, fallback) => edgeCall(FUNCTION, action, payload, fallback);

// ── Invoices ─────────────────────────────────────────────────────────────────

export async function listInvoices(venueId) {
  await requireUid();
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  return list(await callOrEmpty('krossi_billing_invoices', { venue_id_input: venueId }, LOAD_FAIL, [])).map(mapInvoice);
}

/** null when there is no such invoice or it isn't the caller's (holder or hall staff). */
export async function getInvoice(invoiceId) {
  await requireUid();
  if (!isUuid(invoiceId)) return null;
  const data = await call('krossi_billing_invoice', { invoice_id_input: invoiceId }, 'Laskua ei voitu ladata.');
  return data ? mapInvoice(data) : null;
}

export async function markInvoicePaid(invoiceId, paidOn = null) {
  await requireUid();
  if (!isUuid(invoiceId)) throw fail('Laskua ei löytynyt.');
  if (paidOn !== null && !DATE_RE.test(String(paidOn))) throw fail('Tarkista maksupäivä.', 'invalid');
  const data = await call('krossi_billing_mark_invoice_paid', { invoice_id_input: invoiceId, paid_on_input: paidOn }, 'Merkintä epäonnistui.');
  return mapInvoice(data);
}

/** Emails the invoice to its billing address (krossi-billing sends it with the hall's details). */
export async function sendInvoice(invoiceId) {
  await requireUid();
  if (!isUuid(invoiceId)) throw fail('Laskua ei löytynyt.');
  const data = await edge('sendInvoice', { invoiceId }, 'Laskun lähetys epäonnistui. Yritä hetken päästä uudelleen.');
  return { sentTo: text(data?.sentTo, '') };
}

// ── The card on file ─────────────────────────────────────────────────────────

/** null when there is no card (or the phase-2 migration is not deployed yet). */
export async function cardStatus() {
  await requireUid();
  const { data, error } = await db().rpc('krossi_billing_card', {});
  if (error) {
    if (isMissingFunction(error)) return null;
    throw rpcError(error, LOAD_FAIL);
  }
  return mapCard(data);
}

/** A Stripe SetupIntent for saving a card for off-session monthly charges. */
export async function cardSetup() {
  await requireUid();
  const data = await edge('cardSetup', {}, CARD_FAIL);
  if (!data?.publishableKey || !data?.clientSecret) throw fail(CARD_FAIL);
  return { publishableKey: data.publishableKey, clientSecret: data.clientSecret, email: text(data.email) };
}

/** After Stripe confirmed the SetupIntent: krossi-billing checks it and stores the card. */
export async function cardSaved(setupIntentId) {
  await requireUid();
  if (!/^seti_[A-Za-z0-9]+$/.test(String(setupIntentId || ''))) throw fail('Korttia ei löytynyt.');
  const card = mapCard(await edge('cardSaved', { setupIntentId }, CARD_FAIL));
  if (!card) throw fail(CARD_FAIL);
  return card;
}

export async function removeCard() {
  await requireUid();
  await edge('removeCard', {}, 'Kortin poisto epäonnistui. Yritä hetken päästä uudelleen.');
}

// ── Monthly card charges ─────────────────────────────────────────────────────

export async function listCharges(venueId) {
  await requireUid();
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  return list(await callOrEmpty('krossi_billing_charges', { venue_id_input: venueId }, LOAD_FAIL, [])).map(mapCharge);
}

/** Charges every due month of the venue now (krossi-billing; a daily cron does the same). */
export async function runCharges(venueId) {
  await requireUid();
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  const data = await edge('runCharges', { venueId }, 'Veloitusajo epäonnistui. Yritä hetken päästä uudelleen.');
  return { paid: number(data?.paid), failed: number(data?.failed) };
}

/** My unpaid (failed or due) month, paid now in the app: what the Payment Element needs. */
export async function payCharge(chargeId) {
  await requireUid();
  if (!isUuid(chargeId)) throw fail('Veloitusta ei löytynyt.');
  const data = await edge('payCharge', { chargeId }, PAY_FAIL);
  if (data?.paid) return { paid: true };
  if (!data?.publishableKey || !data?.clientSecret) throw fail(PAY_FAIL);
  return {
    publishableKey: data.publishableKey,
    clientSecret: data.clientSecret,
    paymentIntentId: data.paymentIntentId,
    amount: number(data.amount),
    currency: text(data.currency, 'eur'),
    email: text(data.email),
  };
}

export async function verifyCharge(chargeId, paymentIntentId) {
  await requireUid();
  if (!isUuid(chargeId)) throw fail('Veloitusta ei löytynyt.');
  const data = await edge('verifyCharge', { chargeId, paymentIntentId }, 'Maksun tarkistus epäonnistui. Päivitä sivu hetken päästä.');
  return { paid: data?.paid === true, status: text(data?.status) };
}

// ── Hallin asetukset: laskutustiedot ─────────────────────────────────────────

/** The venue's invoicing details; the defaults (not ready) while the settings migration is not deployed. */
export async function getSettings(venueId) {
  await requireUid();
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  return mapBillingSettings(await callOrEmpty('krossi_billing_settings', { venue_id_input: venueId }, LOAD_FAIL, null), venueId);
}

/** Saves them; the RPC checks and normalizes like features/seasons.js checkBillingSettings. */
export async function saveSettings(venueId, {
  sellerName = '', businessId = null, address = null, iban = null, bic = null, email = null, phone = null,
  vatPercent, paymentTermsDays, nextInvoiceNumber = null,
} = {}) {
  await requireUid();
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  if (nextInvoiceNumber !== null && nextInvoiceNumber !== undefined && !Number.isInteger(nextInvoiceNumber)) {
    throw fail('Tarkista seuraavan laskun numero.', 'invalid');
  }
  const textOrNull = (value) => (typeof value === 'string' ? value : null);
  const data = await call('krossi_billing_save_settings', {
    venue_id_input: venueId,
    seller_name_input: typeof sellerName === 'string' ? sellerName : '',
    business_id_input: textOrNull(businessId),
    address_input: textOrNull(address),
    iban_input: textOrNull(iban),
    bic_input: textOrNull(bic),
    email_input: textOrNull(email),
    phone_input: textOrNull(phone),
    vat_percent_input: typeof vatPercent === 'number' && Number.isFinite(vatPercent) ? vatPercent : null,
    payment_terms_days_input: Number.isInteger(paymentTermsDays) ? paymentTermsDays : null,
    next_invoice_number_input: nextInvoiceNumber ?? null,
  }, 'Laskutustietojen tallennus epäonnistui. Yritä hetken päästä uudelleen.');
  return mapBillingSettings(data, venueId);
}

// ── The hall's own Stripe account (krossi-connect) ───────────────────────────

const PAYOUT_FAIL = 'Verkkomaksujen tietoja ei voitu ladata.';
const STATES = ['none', 'pending', 'ready'];

/** PayoutStatus: krossi-connect reads the account from Stripe and stores what it says. */
export async function payoutStatus(venueId) {
  await requireUid();
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  const data = await edgeCall('krossi-connect', 'status', { venueId }, PAYOUT_FAIL);
  const fee = data?.fee || {};
  return {
    state: STATES.includes(data?.state) ? data.state : 'none',
    chargesEnabled: Boolean(data?.chargesEnabled),
    payoutsEnabled: Boolean(data?.payoutsEnabled),
    detailsSubmitted: Boolean(data?.detailsSubmitted),
    dueCount: number(data?.dueCount),
    canConnect: Boolean(data?.canConnect),
    fee: {
      stripeBps: number(fee.stripeBps), stripeFixedCents: number(fee.stripeFixedCents),
      marginBps: number(fee.marginBps), marginFixedCents: number(fee.marginFixedCents),
    },
  };
}

const stripeUrl = (data, fallback) => {
  const url = text(data?.url);
  if (!url || !/^https:\/\/([a-z0-9-]+\.)*stripe\.com\//.test(url)) throw fail(fallback);
  return { url };
};

/** Krossi's admins: Stripe's onboarding page for the hall (the account is made on first use). */
export async function connectStripe(venueId) {
  await requireUid();
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  const failed = 'Stripe-tilin yhdistäminen ei nyt onnistu. Yritä hetken päästä uudelleen.';
  return stripeUrl(await edgeCall('krossi-connect', 'onboard', { venueId }, failed), failed);
}

/** Hall staff: a one-time login to the hall's Stripe Express dashboard. */
export async function stripeDashboard(venueId) {
  await requireUid();
  if (!isUuid(venueId)) throw fail('Hallia ei löytynyt.');
  const failed = 'Stripen avaaminen ei nyt onnistu. Yritä hetken päästä uudelleen.';
  return stripeUrl(await edgeCall('krossi-connect', 'dashboard', { venueId }, failed), failed);
}
