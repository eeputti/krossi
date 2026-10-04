// paywall.jsx — the one-time 8,99 € unlock.
//
//   const { paid, requirePaid, openPaywall } = usePaywall();
//   requirePaid(() => navigate(`/pelaa/peli/${id}`), 'Avaa peli')   runs fn when paid, else opens the sheet
//   <LockedPreview title text>{fake content}</LockedPreview>         blurred teaser with an unlock card
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { api, isDemo } from '../api/index.js';
import { PRICE_LABEL } from '../lib/constants.js';
import { Button, Icon, Illustration, Sheet, useToast } from '../ui/index.js';
import { useSession } from './session.jsx';

const PaywallContext = createContext(null);

const PERKS = [
  { icon: 'users', title: 'Näe kaikki pelaajat', text: 'Profiilit, tasot ja milloin he ehtivät pelata.' },
  { icon: 'calendar-plus', title: 'Luo ja liity peleihin', text: 'Pelit sovittu muutamalla napautuksella.' },
  { icon: 'chat', title: 'Viestit ja pelipyynnöt', text: 'Sovi yksityiskohdat suoraan pelikaverin kanssa.' },
  { icon: 'trophy', title: 'Liigat, putket ja merkit', text: 'Seuraa kehitystäsi ja haasta kaverit.' },
];

export function PaywallProvider({ children }) {
  const { paid } = useSession();
  const toast = useToast();
  const [reason, setReason] = useState(null);
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  const openPaywall = useCallback((why = null) => { setReason(why); setOpen(true); }, []);
  const requirePaid = useCallback((fn, why) => {
    if (paid) return fn?.();
    openPaywall(why);
    return undefined;
  }, [paid, openPaywall]);

  const pay = async () => {
    setStarting(true);
    try {
      // Checkout returns to /pelaa?stripe=…; remember this page so the Gate can bring them back.
      try { sessionStorage.setItem('krossi_after_payment', window.location.pathname + window.location.search); } catch { /* private mode */ }
      await api.payments.startCheckout();
      if (isDemo) { toast('Demossa kaikki on jo auki 😉', { icon: 'sparkles' }); setOpen(false); }
    } catch (err) {
      toast(err);
    } finally {
      setStarting(false);
    }
  };

  const value = useMemo(() => ({ paid, requirePaid, openPaywall }), [paid, requirePaid, openPaywall]);
  return (
    <PaywallContext.Provider value={value}>
      {children}
      <Sheet open={open} onClose={() => setOpen(false)} size="md" tone="dark" className="paywall-sheet">
        <div className="paywall court-lines">
          <Illustration name="lock" size={132} className="paywall-art" />
          <div className="eyebrow">Krossi · kertamaksu</div>
          <h2 className="paywall-title">{reason || 'Avaa koko Krossi'}</h2>
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
          <Button variant="lime" size="lg" block loading={starting} onClick={pay} icon="bolt">
            {starting ? 'Avataan maksua…' : `Avaa Krossi — ${PRICE_LABEL}`}
          </Button>
          <p className="paywall-fine">Turvallinen maksu Stripen kautta. Maksun jälkeen palaat suoraan tähän.</p>
        </div>
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
