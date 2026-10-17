// PayoutSheet — Hallin asetukset → Verkkomaksut: the hall's own Stripe account and what one payment
// costs the hall. Krossi's admins connect the account here (Stripe's own onboarding page, through
// krossi-connect); hall staff open their Stripe dashboard for the payouts. A money screen, so plain:
// the state, one or two buttons, the cost table at the hall's own prices, and the rule in a line.
import { api, isDemo } from '../../api/index.js';
import { useBusy } from '../../app/hooks.js';
import { centsLabel } from '../../features/booking.js';
import { feeExamples, payoutStateLabel, rateLabel } from '../../features/payouts.js';
import { Button, Sheet, useToast } from '../../ui/index.js';
import { InfoLine } from './SeasonParts.jsx';

const STATE_ICON = { ready: 'check', pending: 'clock', none: 'info' };

export function PayoutSheet({ open, onClose, venue, status }) {
  const toast = useToast();
  const [busy, run] = useBusy();
  if (!venue || !status) return <Sheet open={false} onClose={onClose} />;

  const label = payoutStateLabel(status);
  const { fee } = status;
  const rows = feeExamples(venue, fee);
  const margin = fee.marginBps > 0 || fee.marginFixedCents > 0;

  // Stripe's onboarding replaces the app (it comes back to Hallin asetukset); the dashboard opens
  // beside it. The tab is opened at the tap, before the link is fetched, so no popup blocker stops it.
  const connect = () => run(async () => {
    try {
      const result = await api.billing.connectStripe(venue.id);
      if (result.demo) toast('Demossa Stripe-tiliä ei yhdistetä.');
      else window.location.assign(result.url);
    } catch (err) {
      toast(err);
    }
  });
  const dashboard = () => {
    if (isDemo) {
      toast('Demossa Stripeä ei avata.');
      return;
    }
    const tab = window.open('about:blank', '_blank');
    run(async () => {
      try {
        const { url } = await api.billing.stripeDashboard(venue.id);
        if (tab) tab.location.href = url;
        else window.location.assign(url);
      } catch (err) {
        tab?.close();
        toast(err);
      }
    });
  };

  const canContinue = status.canConnect && status.state !== 'ready';
  const footer = (canContinue || status.detailsSubmitted) ? (
    <div className="hset-pay-actions">
      {canContinue && (
        <Button variant="lime" size="lg" block icon="external" loading={busy} onClick={connect}>
          {status.state === 'none' ? 'Yhdistä Stripe-tili' : 'Jatka Stripessä'}
        </Button>
      )}
      {status.detailsSubmitted && (
        <Button variant={canContinue ? 'soft' : 'dark'} size="lg" block icon="external" loading={busy && !canContinue} onClick={dashboard}>
          Avaa Stripe
        </Button>
      )}
    </div>
  ) : null;

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} title="Verkkomaksut" subtitle={venue.name} footer={footer} size="md" className="bk-sheet">
      <div className="stack-4">
        <InfoLine icon={STATE_ICON[status.state] || 'info'}>{label.text}</InfoLine>
        <table className="hset-fees">
          <caption className="sr-only">Mitä yksi maksu maksaa hallille</caption>
          <thead>
            <tr><th scope="col">Maksu</th><th scope="col">Kulut</th><th scope="col">Hallille</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td className="t-num">{centsLabel(r.feeCents)}</td>
                <td className="t-num">{centsLabel(r.hallCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="bk-fine">
          Kulut maksua kohden: Stripe {rateLabel(fee.stripeBps, fee.stripeFixedCents)}
          {margin ? ` ja Krossi ${rateLabel(fee.marginBps, fee.marginFixedCents)}` : ''}. Jaetussa maksussa jokainen osuus on oma maksunsa.
          Peruttu tai palautettu maksu palautuu pelaajalle kokonaan; sen kulut eivät palaudu.
          {status.state === 'ready' ? ' Stripe maksaa rahat hallin pankkitilille maanantaisin.' : ''}
        </p>
      </div>
    </Sheet>
  );
}
