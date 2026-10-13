// stripe.js — loads Stripe.js on demand. It must come from js.stripe.com (never bundled), and only
// the paywall needs it, so nobody else pays for the download.
//
//   const stripe = await loadStripe(publishableKey);

const STRIPE_JS = 'https://js.stripe.com/v3/';

let script = null;
const instances = new Map();

function loadScript() {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  script ??= new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = STRIPE_JS;
    el.async = true;
    el.onload = () => (window.Stripe ? resolve(window.Stripe) : reject(new Error('Stripe.js loaded without window.Stripe')));
    el.onerror = () => { script = null; el.remove(); reject(new Error('Stripe.js failed to load')); };
    document.head.appendChild(el);
  });
  return script;
}

/** Opens the connection to Stripe ahead of time without loading Stripe.js (no cookies yet). */
let preconnected = false;
export function preconnectStripe() {
  if (preconnected || typeof document === 'undefined') return;
  preconnected = true;
  for (const href of ['https://js.stripe.com', 'https://api.stripe.com']) {
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = href;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  }
}

/** Warms the connection while the player is still reading the paywall. */
export function preloadStripe() {
  loadScript().catch(() => { /* loadStripe() reports it when it matters */ });
}

export async function loadStripe(publishableKey) {
  const Stripe = await loadScript();
  if (!instances.has(publishableKey)) instances.set(publishableKey, Stripe(publishableKey, { locale: 'fi' }));
  return instances.get(publishableKey);
}

export const isTestKey = (publishableKey) => String(publishableKey || '').startsWith('pk_test_');
