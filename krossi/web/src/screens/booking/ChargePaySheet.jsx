// ChargePaySheet — pays one month of a card-billed kausivuoro in the app: a month whose automatic
// charge failed (declined card, the bank asked for authentication) or that is due. Same Stripe
// checkout as bookings, with the payment the server made for that month (api.billing.payCharge);
// the demo pays at once.
import { useEffect, useState } from 'react';
import { api } from '../../api/index.js';
import { Checkout } from '../../app/checkout.jsx';
import { centsLabel } from '../../features/booking.js';
import { monthLabel } from '../../features/seasons.js';
import { Button, Icon, Sheet, Skeleton, useToast } from '../../ui/index.js';
import { InfoLine } from './SeasonParts.jsx';

export function ChargePaySheet({ open, onClose, charge, slotLabel, onPaid }) {
  const toast = useToast();
  const [pay, setPay] = useState(null);
  const [error, setError] = useState(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!open || !charge) return undefined;
    let cancelled = false;
    setPay(null);
    setError(null);
    api.billing.payCharge(charge.id)
      .then((result) => { if (cancelled) return; if (result.paid) onPaid?.(); else setPay(result); })
      .catch((err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, charge?.id]);

  if (!charge) return <Sheet open={false} onClose={onClose} />;

  const payDemo = async () => {
    setWorking(true);
    try {
      const result = await api.billing.verifyCharge(charge.id, null);
      if (result.paid) onPaid?.();
    } catch (err) {
      toast(err);
    } finally {
      setWorking(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={`Kausivuoro: ${monthLabel(charge.month)}`} subtitle={slotLabel} size="md" className="bk-sheet">
      <div className="stack-4">
        <div className="bk-paybar">
          <span className="bk-paybar-label">{charge.weeks} kertaa</span>
          <span className="bk-paybar-price t-num">{centsLabel(charge.amountCents)}</span>
        </div>
        {charge.status === 'failed' && charge.failureMessage && <InfoLine icon="alert" tone="danger">{charge.failureMessage}</InfoLine>}
        <div className="bk-paybox">
          <span className="eyebrow bk-paybox-title">Maksu</span>
          {error ? (
            <p className="checkout-error" role="alert"><Icon name="alert" size={16} />{error.userMessage || 'Maksua ei saatu auki.'}</p>
          ) : !pay ? (
            <div className="stack-3" aria-label="Ladataan maksua"><Skeleton h={50} r={14} /><Skeleton h={54} r={14} /></div>
          ) : pay.demo ? (
            <div className="stack-3">
              <p className="bk-paybox-demo"><Icon name="info" size={15} /><span><b>Demotila</b> — maksu hyväksytään heti.</span></p>
              <Button variant="lime" size="lg" block icon="lock" loading={working} onClick={payDemo}>Maksa {centsLabel(pay.amount)}</Button>
            </div>
          ) : (
            <Checkout
              config={{ publishableKey: pay.publishableKey, amount: pay.amount, currency: pay.currency, email: pay.email }}
              createIntent={async () => ({ clientSecret: pay.clientSecret, paymentIntentId: pay.paymentIntentId })}
              verify={(paymentIntentId) => api.billing.verifyCharge(charge.id, paymentIntentId)}
              returnPath={`/pelaa/omat-varaukset?kuukausi=${encodeURIComponent(charge.id)}`}
              pendingText="Maksu on vielä kesken. Kuukausi näkyy maksettuna heti, kun pankki vahvistaa sen."
              onPaid={() => onPaid?.()}
            />
          )}
        </div>
        <p className="bk-fine">Seuraavat kuukaudet veloitetaan edelleen tallennetulta kortilta. Jos kortti ei enää toimi, tallenna uusi kortti Omissa varauksissa.</p>
      </div>
    </Sheet>
  );
}
