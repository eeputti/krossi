// BookingExtras — the booking page's row under the hero: Kausivuoro (apply for one, or your slot and
// its next week), Sarja- ja lahjakortit (your balance; buy, give or redeem) and Omat varaukset. A
// failed monthly charge of your kausivuoro shows here as a plain notice with "Maksa", so it can't
// be missed. Owns the request and wallet sheets, so BookingScreen only places it.
import { useEffect, useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync } from '../../app/hooks.js';
import { navigate } from '../../app/router.js';
import { centsLabel } from '../../features/booking.js';
import { hoursLeftLabel, slotWhen } from '../../features/seasons.js';
import { Button, Icon } from '../../ui/index.js';
import { SeasonRequestSheet } from './SeasonRequestSheet.jsx';
import { WalletSheet } from './WalletSheet.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

/** `showFailed` false: the page shows a failed month itself (BookingScreen's "Maksamattomat maksut"). */
export function BookingExtras({ venue, refreshKey, showFailed = true }) {
  const seasons = useAsync(() => api.seasons.list(venue.id), [venue.id]);
  const slots = useAsync(() => api.seasons.listMine(), [venue.id]);
  const wallet = useAsync(() => api.wallet.get(venue.id), [venue.id]);
  const card = useAsync(() => api.billing.cardStatus(), [venue.id]);
  const [requestOpen, setRequestOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);

  // A booking paid with a series card or gift balance changes the numbers here.
  useEffect(() => { wallet.reload({ silent: true }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [refreshKey]);

  const mine = (slots.data || []).filter((s) => s.venueId === venue.id);
  const active = mine.filter((s) => s.status === 'active');
  const pending = mine.filter((s) => s.status === 'requested');
  const failed = active.flatMap((s) => s.charges.filter((c) => c.status === 'failed'));
  const canApply = (seasons.data || []).some((s) => s.requestsOpen);
  const passMinutes = (wallet.data?.passes || []).filter((p) => p.status === 'active').reduce((n, p) => n + p.minutesLeft, 0);
  const gift = wallet.data?.giftCents || 0;

  let seasonTile = null;
  if (active.length) {
    const next = [...active].sort((a, b) => String(a.nextAt).localeCompare(String(b.nextAt)))[0];
    seasonTile = { title: active.length > 1 ? `${active.length} kausivuoroa` : 'Kausivuoro', sub: `${slotWhen(next)} · ${next.courtName}`, onClick: () => navigate('/pelaa/omat-varaukset') };
  } else if (pending.length) {
    seasonTile = { title: 'Kausivuoro', sub: 'Hakemus odottaa hallia', onClick: () => navigate('/pelaa/omat-varaukset') };
  } else if (canApply) {
    seasonTile = { title: 'Hae kausivuoroa', sub: 'Sama aika koko kauden', onClick: () => setRequestOpen(true) };
  }

  const walletSub = passMinutes || gift
    ? [passMinutes ? `${hoursLeftLabel(passMinutes)} sarjakortilla` : null, gift ? `${centsLabel(gift)} saldoa` : null].filter(Boolean).join(' · ')
    : 'Osta, anna lahjaksi tai lunasta';

  return (
    <>
      {showFailed && failed.length > 0 && (
        <div className="bk-note ss-failed-note" role="alert">
          <Icon name="alert" size={16} />
          <span>Kausivuoron kuukausimaksu ({centsLabel(failed[0].amountCents)}) ei mennyt läpi: {failed[0].failureMessage}</span>
          <Button variant="dark" size="sm" onClick={() => navigate('/pelaa/omat-varaukset')}>Maksa</Button>
        </div>
      )}
      <nav className="ss-tiles" aria-label="Kausivuorot, kortit ja omat varaukset">
        {seasonTile && (
          <button type="button" className="ss-tile" onClick={seasonTile.onClick}>
            <span className="ss-tile-icon" aria-hidden="true"><Icon name="repeat" size={18} /></span>
            <span className="ss-tile-title">{seasonTile.title}</span>
            <span className="ss-tile-sub">{seasonTile.sub}</span>
          </button>
        )}
        <button type="button" className="ss-tile" onClick={() => setWalletOpen(true)}>
          <span className="ss-tile-icon" aria-hidden="true"><Icon name="gift" size={18} /></span>
          <span className="ss-tile-title">Sarja- ja lahjakortit</span>
          <span className={cx('ss-tile-sub', (passMinutes || gift) && 'is-strong')}>{walletSub}</span>
        </button>
        <button type="button" className="ss-tile" onClick={() => navigate('/pelaa/omat-varaukset')}>
          <span className="ss-tile-icon" aria-hidden="true"><Icon name="list" size={18} /></span>
          <span className="ss-tile-title">Omat varaukset</span>
          <span className="ss-tile-sub">Vuorot, laskut, kortit</span>
        </button>
      </nav>

      <SeasonRequestSheet
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        venue={venue}
        seasons={seasons.data || []}
        card={card.data}
        onCardSaved={() => card.reload({ silent: true })}
        onRequested={() => slots.reload({ silent: true })}
      />
      <WalletSheet open={walletOpen} onClose={() => setWalletOpen(false)} venue={venue} onChanged={() => wallet.reload({ silent: true })} />
    </>
  );
}
