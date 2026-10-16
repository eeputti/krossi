// SaveCard — keeps a card on file for a kausivuoro's monthly charges (Stripe SetupIntent, card only).
//
//   <SaveCard onSaved={(card) => …} />
//
// The card form (Stripe's Payment Element in setup mode) sits in the same dark box as the booking
// checkout. The SetupIntent is made only when the player presses "Tallenna kortti"
// (api.billing.cardSetup), confirmed in Stripe.js and then checked server-side
// (api.billing.cardSaved). The demo has no form: it offers a card that works and one whose
// charges fail, so the failure path can be tried.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { APPEARANCE } from '../../app/checkout.jsx';
import { isTestKey, loadStripe } from '../../lib/stripe.js';
import { Button, Icon, Skeleton } from '../../ui/index.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const FAIL = 'Kortin tallennus ei onnistunut. Tarkista tiedot tai kokeile toista korttia.';

export function SaveCard({ onSaved, label = 'Tallenna kortti' }) {
  const [setup, setSetup] = useState(null); // { publishableKey, … } | { demo: true }
  const [loadError, setLoadError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  // cardSetup creates a SetupIntent: ask for one only when the form is opened (the demo answers at once).
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    api.billing.cardSetup()
      .then((s) => { if (!cancelled) setSetup(s); })
      .catch((err) => { if (!cancelled) setLoadError(err); });
    return () => { cancelled = true; };
  }, [attempt]);

  if (loadError) {
    return (
      <div className="bk-paybox">
        <p className="checkout-error" role="alert"><Icon name="alert" size={16} />{loadError.userMessage || FAIL}</p>
        <Button variant="lime" icon="refresh" block onClick={() => setAttempt((n) => n + 1)}>Yritä uudelleen</Button>
      </div>
    );
  }
  if (!setup) return <div className="bk-paybox" aria-label="Ladataan korttilomaketta"><Skeleton h={54} r={14} /><Skeleton h={50} r={14} /></div>;
  if (setup.demo) return <DemoCards onSaved={onSaved} />;
  return <StripeCardForm setup={setup} onSaved={onSaved} label={label} />;
}

function DemoCards({ onSaved }) {
  const [busy, setBusy] = useState(null);
  const save = async (id) => {
    setBusy(id);
    try {
      onSaved?.(await api.billing.cardSaved(id));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="bk-paybox">
      <p className="bk-paybox-demo">
        <Icon name="info" size={15} />
        <span><b>Demotila</b> — valitse kortti. Oikeassa Krossissa kortti tallennetaan Stripeen, eikä Krossi näe kortin numeroa.</span>
      </p>
      <Button variant="lime" block loading={busy === 'demo-4242'} onClick={() => save('demo-4242')}>Visa •••• 4242 (veloitukset onnistuvat)</Button>
      <Button variant="on-dark" block loading={busy === 'demo-0341'} onClick={() => save('demo-0341')}>Visa •••• 0341 (veloitukset epäonnistuvat)</Button>
    </div>
  );
}

function StripeCardForm({ setup, onSaved, label }) {
  const box = useRef(null);
  const ctx = useRef(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let element = null;
    (async () => {
      try {
        const stripe = await loadStripe(setup.publishableKey);
        if (cancelled) return;
        const elements = stripe.elements({ mode: 'setup', currency: 'eur', paymentMethodTypes: ['card'], appearance: APPEARANCE, locale: 'fi' });
        element = elements.create('payment', {
          layout: { type: 'tabs' },
          defaultValues: { billingDetails: { email: setup.email || undefined } },
          business: { name: 'Krossi' },
        });
        element.on('ready', () => { if (!cancelled) setReady(true); });
        element.on('loaderror', () => { if (!cancelled) setError('Korttilomake ei latautunut. Yritä uudelleen.'); });
        element.mount(box.current);
        ctx.current = { stripe, elements };
      } catch (err) {
        console.error('Stripe.js failed to load', err);
        if (!cancelled) setError('Maksupalvelu ei latautunut. Tarkista yhteys tai sammuta mainosten esto tältä sivulta.');
      }
    })();
    return () => { cancelled = true; element?.destroy(); ctx.current = null; };
  }, [setup.publishableKey, setup.email]);

  const save = async () => {
    const c = ctx.current;
    if (!c || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: submitError } = await c.elements.submit();
      if (submitError) { setBusy(false); return; }
      const { setupIntent, error: confirmError } = await c.stripe.confirmSetup({
        elements: c.elements,
        clientSecret: setup.clientSecret,
        confirmParams: { return_url: `${window.location.origin}/pelaa/omat-varaukset` },
        redirect: 'if_required',
      });
      if (confirmError) { setError(confirmError.message || FAIL); setBusy(false); return; }
      onSaved?.(await api.billing.cardSaved(setupIntent.id));
    } catch (err) {
      setError(err?.userMessage || FAIL);
    }
    setBusy(false);
  };

  return (
    <div className="bk-paybox">
      {isTestKey(setup.publishableKey) && (
        <p className="checkout-test"><Icon name="info" size={15} /><span><b>Testitila</b> — testikortti 4242 4242 4242 4242.</span></p>
      )}
      {!ready && <Skeleton h={54} r={14} />}
      <div ref={box} className={cx('checkout-element', ready && 'is-ready')} />
      {error && <p className="checkout-error" role="alert"><Icon name="alert" size={16} />{error}</p>}
      <Button variant="lime" block icon={busy ? undefined : 'lock'} loading={busy} disabled={!ready} onClick={save}>{label}</Button>
      <p className="bk-paybox-demo"><Icon name="lock" size={14} /><span>Kortti tallentuu Stripeen. Halli veloittaa siltä vain kausivuorosi kuukausimaksut.</span></p>
    </div>
  );
}
