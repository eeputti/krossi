// paywall.jsx — the one-time 8,99 € unlock, paid right inside the sheet (see checkout.jsx).
//
//   const { paid, requirePaid, openPaywall } = usePaywall();
//   requirePaid(() => navigate(`/pelaa/peli/${id}`), 'Avaa peli')   runs fn when paid, else opens the sheet
//                                                                    (and runs fn once the payment goes through)
//   <LockedPreview title text>{fake content}</LockedPreview>         blurred teaser with an unlock card
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, isDemo } from '../api/index.js';
import { PRICE_LABEL } from '../lib/constants.js';
import { isTestKey, preconnectStripe, preloadStripe } from '../lib/stripe.js';
import { Button, Icon, Illustration, Sheet, Skeleton, confetti, useToast } from '../ui/index.js';
import { AFTER_PAYMENT_KEY, Checkout } from './checkout.jsx';
import { useSession } from './session.jsx';

const PaywallContext = createContext(null);

const PERKS = [
  { icon: 'users', title: 'Näe kaikki pelaajat', text: 'Profiilit, tasot ja milloin he ehtivät pelata.' },
  { icon: 'calendar-plus', title: 'Luo ja liity peleihin', text: 'Pelit sovittu muutamalla napautuksella.' },
  { icon: 'chat', title: 'Viestit ja pelipyynnöt', text: 'Sovi yksityiskohdat suoraan pelikaverin kanssa.' },
  { icon: 'trophy', title: 'Liigat, putket ja merkit', text: 'Seuraa kehitystäsi ja haasta kaverit.' },
];

export function PaywallProvider({ children }) {
  const { user, paid, needsOnboarding, refreshProfile } = useSession();
  const toast = useToast();
  const [reason, setReason] = useState(null);
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  // In-app checkout setup: { status: 'idle' | 'loading' | 'ready' | 'hosted' | 'error', config?, error? }
  const [checkout, setCheckout] = useState({ status: 'idle' });
  const checkoutRef = useRef(checkout);
  checkoutRef.current = checkout;
  const [success, setSuccess] = useState(false);
  const afterPaid = useRef(null);

  const openPaywall = useCallback((why = null, then = null) => {
    afterPaid.current = typeof then === 'function' ? then : null;
    setReason(why);
    setSuccess(false);
    setOpen(true);
  }, []);
  const requirePaid = useCallback((fn, why) => {
    if (paid) return fn?.();
    openPaywall(why, fn);
    return undefined;
  }, [paid, openPaywall]);

  const onPaid = useCallback(async () => {
    setSuccess(true);
    confetti();
    try { await refreshProfile(); } catch { /* the Gate retries on the next load; paid_at is already set */ }
  }, [refreshProfile]);

  const loadCheckout = useCallback(async ({ background = false } = {}) => {
    setCheckout({ status: 'loading' });
    try {
      const config = await api.payments.checkoutConfig();
      if (config.paid) {
        // Paid meanwhile (another tab, or MobilePay finished after they left) — just unlock.
        setCheckout({ status: 'idle' });
        if (!background) { onPaid(); return; }
        await refreshProfile();
        toast('Maksusi on vastaanotettu — Krossi on auki! 🎾', { icon: 'sparkles', duration: 4200 });
        return;
      }
      setCheckout(config.hosted ? { status: 'hosted' } : { status: 'ready', config });
    } catch (err) {
      setCheckout({ status: 'error', error: err });
    }
  }, [onPaid, refreshProfile, toast]);

  // The config (default billing email) belongs to whoever is signed in.
  useEffect(() => { setCheckout({ status: 'idle' }); }, [user?.id]);

  // Unpaid players: fetch the checkout config once the app has settled, so the sheet opens
  // straight onto the payment buttons. Stripe.js itself still loads only when the sheet opens.
  useEffect(() => {
    if (!user || paid || needsOnboarding || isDemo) return undefined;
    const t = setTimeout(() => {
      preconnectStripe();
      if (checkoutRef.current.status === 'idle') loadCheckout({ background: true });
    }, 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, paid, needsOnboarding]);

  useEffect(() => {
    if (!open || paid || isDemo) return;
    preloadStripe();
    if (checkout.status === 'idle' || checkout.status === 'error') loadCheckout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, paid]);

  // Stripe's hosted page — the fallback while the in-app checkout isn't configured or won't load.
  const payHosted = async () => {
    setStarting(true);
    try {
      // Checkout returns to /pelaa?stripe=…; remember this page so the Gate can bring them back.
      try { sessionStorage.setItem(AFTER_PAYMENT_KEY, window.location.pathname + window.location.search); } catch { /* private mode */ }
      await api.payments.startCheckout();
      if (isDemo) { toast('Demossa kaikki on jo auki 😉', { icon: 'sparkles' }); setOpen(false); }
    } catch (err) {
      toast(err);
    } finally {
      setStarting(false);
    }
  };

  const close = () => {
    setOpen(false);
    if (success) {
      const next = afterPaid.current;
      afterPaid.current = null;
      next?.();
    }
  };

  const value = useMemo(() => ({ paid, requirePaid, openPaywall }), [paid, requirePaid, openPaywall]);
  const testMode = checkout.status === 'ready' && isTestKey(checkout.config.publishableKey);

  return (
    <PaywallContext.Provider value={value}>
      {children}
      <Sheet open={open} onClose={close} size="md" tone="dark" className="paywall-sheet" labelledBy="paywall-title">
        {success ? (
          <div className="paywall paywall-done court-lines" role="status">
            <span className="paywall-done-check"><Icon name="check" size={40} /></span>
            <h2 id="paywall-title" className="paywall-title">Krossi on auki!</h2>
            <p className="paywall-lead">
              Kiitos! Kaikki pelaajat, pelit ja viestit ovat nyt käytössäsi.
              {!testMode && ' Kuitti tulee sähköpostiisi.'}
            </p>
            <Button variant="lime" size="lg" block icon="ball" onClick={close}>
              {afterPaid.current ? 'Jatketaan' : 'Pelataan!'}
            </Button>
          </div>
        ) : (
          <div className="paywall court-lines">
            <Illustration name="lock" size={96} className="paywall-art" />
            <div className="eyebrow">Krossin kertamaksu</div>
            <h2 id="paywall-title" className="paywall-title">{reason || 'Avaa koko Krossi'}</h2>
            <p className="paywall-lead">Yksi maksu, ei tilausta eikä toistuvaa laskutusta. Sen jälkeen pelit voi alkaa.</p>
            <ul className="paywall-perks">
              {PERKS.map((p) => (
                <li key={p.title} className="paywall-perk">
                  <span className="paywall-perk-icon"><Icon name={p.icon} size={18} /></span>
                  <span>
                    <span className="paywall-perk-title">{p.title}</span>
                    <span className="paywall-perk-text">{p.text}</span>
                  </span>
                </li>
              ))}
            </ul>

            {checkout.status === 'ready' ? (
              <Checkout config={checkout.config} onPaid={onPaid} onHosted={payHosted} />
            ) : checkout.status === 'loading' ? (
              <div className="checkout-skeleton" aria-label="Avataan kassaa">
                <Skeleton h={50} r={14} />
                <Skeleton h={54} r={14} />
                <Skeleton h={56} r={999} />
              </div>
            ) : checkout.status === 'error' ? (
              <div className="checkout checkout-failed">
                <p className="checkout-error" role="alert"><Icon name="alert" size={16} />{checkout.error?.userMessage || 'Kassa ei auennut.'}</p>
                <Button variant="lime" size="lg" block icon="refresh" onClick={loadCheckout}>Yritä uudelleen</Button>
                <Button variant="on-dark" size="md" block loading={starting} icon="external" onClick={payHosted}>Maksa Stripen sivulla</Button>
              </div>
            ) : (
              <Button variant="lime" size="lg" block loading={starting} onClick={payHosted} icon="bolt">
                {starting ? 'Avataan maksua…' : `Avaa Krossi — ${PRICE_LABEL}`}
              </Button>
            )}

            <p className="paywall-fine">
              <Icon name="shield" size={13} />
              {checkout.status === 'hosted' || isDemo
                ? 'Turvallinen maksu Stripen kautta. Maksun jälkeen palaat suoraan tähän.'
                : 'Turvallinen maksu Stripen kautta — Krossi ei näe kortti- tai pankkitietojasi.'}
            </p>
          </div>
        )}
      </Sheet>
    </PaywallContext.Provider>
  );
}

export function usePaywall() {
  const ctx = useContext(PaywallContext);
  if (!ctx) throw new Error('usePaywall must be used inside <PaywallProvider>');
  return ctx;
}

/** Blurred teaser of real-looking content with an unlock card on top. */
export function LockedPreview({ title = 'Avaa nähdäksesi', text, cta = `Avaa Krossi — ${PRICE_LABEL}`, children }) {
  const { openPaywall } = usePaywall();
  return (
    <div className="locked">
      <div className="locked-content" aria-hidden="true">{children}</div>
      <div className="locked-overlay">
        <div className="locked-card rise">
          <span className="locked-icon"><Icon name="lock" size={20} /></span>
          <h3 className="locked-title">{title}</h3>
          {text && <p className="locked-text">{text}</p>}
          <Button variant="lime" size="md" block onClick={() => openPaywall()}>{cta}</Button>
        </div>
      </div>
    </div>
  );
}
