// checkout.jsx — Krossi's own checkout inside the paywall sheet (Stripe Elements, deferred intent).
//
//   <Checkout config={{ publishableKey, amount, currency, email }} onPaid={() => …} onHosted={() => …} />
//
// The same checkout pays court bookings: pass `createIntent` / `verify` (both default to the 8,99 €
// unlock in api.payments), the `returnPath` redirect methods come back to, and `pendingText`.
// `verify` resolves to { paid, status }. Without `onHosted` there is no hosted-page fallback.
// `config.setupFutureUsage: 'off_session'` (a split court booking) saves the card for later: the
// Elements must say the same as the PaymentIntent, and only methods that can be saved are offered.
//
// Top: one-tap wallet buttons (Apple Pay / Google Pay, Express Checkout Element). Below: the
// Payment Element (MobilePay first, then card and whatever else is enabled in the Stripe
// Dashboard). The PaymentIntent is only created when the player actually pays, then the payment
// is verified server-side so Krossi unlocks without waiting for the webhook. Redirect methods
// (MobilePay on a phone) come back to /pelaa?maksu=1&payment_intent=… — see useStripeReturn().
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { isTestKey, loadStripe } from '../lib/stripe.js';
import { Button, Icon, Skeleton } from '../ui/index.js';

const cx = (...c) => c.filter(Boolean).join(' ');

export const AFTER_PAYMENT_KEY = 'krossi_after_payment';
const RETURN_PATH = '/pelaa?maksu=1';
const FAIL = 'Maksu ei mennyt läpi. Kokeile uudelleen tai valitse toinen maksutapa.';

/** "8,99 €" from Stripe's minor units. */
export function formatPrice(amount, currency) {
  return new Intl.NumberFormat('fi-FI', { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100);
}

// Stripe's iframes can't read our CSS tokens: these mirror tokens.css for the dark paywall sheet.
const APPEARANCE = {
  theme: 'night',
  variables: {
    colorPrimary: '#CFE414',          // --lime
    colorBackground: '#0A2C20',       // --green-900: fields sit a shade deeper than the sheet
    colorText: '#FFFFFF',
    colorTextSecondary: '#B9C9C1',
    colorTextPlaceholder: '#7E968B',
    colorIcon: '#B9C9C1',
    colorDanger: '#FF9F8F',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif',
    fontSizeBase: '15px',
    borderRadius: '14px',             // --r-md
    spacingUnit: '4px',
    focusBoxShadow: '0 0 0 2px rgba(207, 228, 20, 0.5)',
    focusOutline: 'none',
  },
  rules: {
    '.Input': { border: '1px solid #2B5A48', boxShadow: 'none' },
    '.Input:focus': { borderColor: '#CFE414' },
    '.AccordionItem': { border: '1px solid #2B5A48', boxShadow: 'none' },
    '.Label': { fontWeight: '600' },
  },
};

function rememberWhereWeWere() {
  const here = window.location.pathname + window.location.search;
  for (const storage of ['sessionStorage', 'localStorage']) {
    try { window[storage].setItem(AFTER_PAYMENT_KEY, here); } catch { /* private mode: lands on /pelaa */ }
  }
}

const UNLOCK_PENDING = 'Maksu on vielä kesken. Krossi aukeaa heti, kun pankki vahvistaa sen — voit sulkea tämän.';

export function Checkout({
  config, onPaid, onHosted, createIntent, verify, returnPath = RETURN_PATH, pendingText = UNLOCK_PENDING,
}) {
  const expressBox = useRef(null);
  const paymentBox = useRef(null);
  const stripeRef = useRef(null); // { stripe, elements } once mounted
  const busyRef = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState(null);
  const [ready, setReady] = useState(false);
  const [wallets, setWallets] = useState(null); // null = still checking, false = none on this device
  // Some browsers never answer the wallet check: stop holding the spot after a moment (a late
  // answer still shows the buttons).
  const [walletWait, setWalletWait] = useState(true);
  const [method, setMethod] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const price = formatPrice(config.amount, config.currency);
  const testMode = isTestKey(config.publishableKey);

  // Read through a ref: Stripe's event handlers are bound once per mount.
  const payRef = useRef(null);
  payRef.current = async (expressEvent) => {
    const ctx = stripeRef.current;
    if (!ctx || busyRef.current) { expressEvent?.paymentFailed({ reason: 'fail' }); return; }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const stop = (message) => { busyRef.current = false; setBusy(false); setError(message); };
    try {
      // Validates the form (the Payment Element marks the fields itself) and opens wallet sheets.
      const { error: submitError } = await ctx.elements.submit();
      if (submitError) { expressEvent?.paymentFailed({ reason: 'fail' }); stop(expressEvent ? submitError.message : null); return; }

      let intent;
      try {
        intent = await (createIntent ? createIntent() : api.payments.createPaymentIntent());
      } catch (err) {
        expressEvent?.paymentFailed({ reason: 'fail' });
        stop(err?.userMessage || FAIL);
        return;
      }
      if (intent.paid) { busyRef.current = false; setBusy(false); onPaid(); return; }

      if (!createIntent) rememberWhereWeWere(); // a custom returnPath already says where to land
      const { error: payError, paymentIntent } = await ctx.stripe.confirmPayment({
        elements: ctx.elements,
        clientSecret: intent.clientSecret,
        confirmParams: { return_url: window.location.origin + returnPath },
        redirect: 'if_required',
      });
      if (payError) { stop(payError.message || FAIL); return; }
      // Card, Apple Pay and Google Pay land here; redirect methods left the page above.
      await confirmUnlocked(paymentIntent.id);
    } catch (err) {
      stop(err?.userMessage || FAIL);
    }
  };

  async function confirmUnlocked(paymentIntentId) {
    for (let tries = 0; tries < 8; tries += 1) {
      const result = await (verify ? verify(paymentIntentId) : api.payments.verifyPayment(paymentIntentId));
      if (result.paid) { busyRef.current = false; setBusy(false); onPaid(); return; }
      if (result.status !== 'processing') break;
      setProcessing(true);
      await new Promise((r) => setTimeout(r, 1500));
    }
    busyRef.current = false;
    setBusy(false);
    setProcessing(false);
    setError(pendingText);
  }

  useEffect(() => {
    let cancelled = false;
    let express = null;
    let payment = null;
    setReady(false);
    setWallets(null);
    setWalletWait(true);
    setLoadError(null);
    const walletTimer = setTimeout(() => { if (!cancelled) setWalletWait(false); }, 3500);
    (async () => {
      try {
        const stripe = await loadStripe(config.publishableKey);
        if (cancelled) return;
        const elements = stripe.elements({
          mode: 'payment',
          amount: config.amount,
          currency: config.currency,
          ...(config.setupFutureUsage ? { setupFutureUsage: config.setupFutureUsage } : {}),
          appearance: APPEARANCE,
          locale: 'fi',
        });

        express = elements.create('expressCheckout', {
          buttonType: { applePay: 'plain', googlePay: 'plain' },
          buttonTheme: { applePay: 'white', googlePay: 'white' },
          buttonHeight: 50,
          layout: { maxColumns: 1, maxRows: 2, overflow: 'never' },
          // 'always': show the wallet button on a supporting device even before a card is saved
          // in it (the wallet then offers to add one) — otherwise many players never see it.
          paymentMethods: { applePay: 'always', googlePay: 'always', link: 'never', paypal: 'never', amazonPay: 'never', klarna: 'never' },
        });
        express.on('ready', ({ availablePaymentMethods }) => {
          if (!cancelled) setWallets(Boolean(availablePaymentMethods && Object.values(availablePaymentMethods).some(Boolean)));
        });
        express.on('confirm', (event) => payRef.current(event));
        // No wallet buttons is fine: the Payment Element below still takes every method.
        express.on('loaderror', () => { if (!cancelled) setWallets(false); });
        express.mount(expressBox.current);

        payment = elements.create('payment', {
          layout: { type: 'accordion', defaultCollapsed: false, radios: true, spacedAccordionItems: true },
          paymentMethodOrder: ['mobilepay', 'card'],
          wallets: { applePay: 'never', googlePay: 'never' }, // they're the big buttons above
          defaultValues: { billingDetails: { email: config.email || undefined } },
          business: { name: 'Krossi' },
        });
        payment.on('ready', () => { if (!cancelled) setReady(true); });
        payment.on('change', (event) => { if (!cancelled) setMethod(event.value?.type || null); });
        payment.on('loaderror', (event) => {
          console.error('Stripe Payment Element failed to load', event?.error);
          if (!cancelled) setLoadError({ userMessage: 'Maksulomake ei latautunut. Yritä uudelleen tai maksa Stripen sivulla.' });
        });
        payment.mount(paymentBox.current);
        stripeRef.current = { stripe, elements };
      } catch (err) {
        console.error('Stripe.js failed to load', err);
        if (!cancelled) setLoadError({ userMessage: 'Maksupalvelu ei latautunut. Tarkista yhteys tai sammuta mainosten esto tältä sivulta.' });
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(walletTimer);
      express?.destroy();
      payment?.destroy();
      stripeRef.current = null;
    };
  }, [config.publishableKey, config.amount, config.currency, config.email, config.setupFutureUsage, attempt]);

  if (loadError) {
    return (
      <div className="checkout checkout-failed">
        <p className="checkout-error" role="alert"><Icon name="alert" size={16} />{loadError.userMessage}</p>
        <Button variant="lime" size="lg" block icon="refresh" onClick={() => setAttempt((n) => n + 1)}>Yritä uudelleen</Button>
        {onHosted && <Button variant="on-dark" size="md" block icon="external" onClick={onHosted}>Maksa Stripen sivulla</Button>}
      </div>
    );
  }

  const label = processing ? 'Vahvistetaan maksua…'
    : method === 'mobilepay' ? `Jatka MobilePayhin · ${price}`
    : `Maksa ${price}`;

  return (
    <div className="checkout" aria-busy={!ready || undefined}>
      {testMode && (
        <p className="checkout-test">
          <Icon name="info" size={15} />
          <span><b>Testitila</b> — mitään ei veloiteta. Testikortti 4242 4242 4242 4242, mikä tahansa tuleva päivä ja CVC.</span>
        </p>
      )}

      {/* Wallets first: their spot is held while Stripe checks the device, so nothing jumps. */}
      {wallets === null && walletWait && <Skeleton h={50} r={14} className="checkout-express-skeleton" />}
      <div ref={expressBox} className={cx('checkout-express', wallets && 'is-ready', wallets === false && 'is-empty')} />
      {wallets && <div className="checkout-or" aria-hidden="true"><span>tai muulla tavalla</span></div>}

      {!ready && (
        <div className="checkout-skeleton" aria-label="Ladataan maksutapoja">
          <Skeleton h={54} r={14} />
          <Skeleton h={54} r={14} />
        </div>
      )}
      <div ref={paymentBox} className={cx('checkout-element', ready && 'is-ready')} />

      {error && <p className="checkout-error" role="alert"><Icon name="alert" size={16} />{error}</p>}

      <Button variant="lime" size="lg" block loading={busy} disabled={!ready} onClick={() => payRef.current(null)} icon={busy ? undefined : 'lock'}>
        {label}
      </Button>
    </div>
  );
}
