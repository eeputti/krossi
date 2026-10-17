// MyBookingSheet — one of my bookings: where and when (with the court on the floor map), what it
// cost, add to calendar, find a partner for it, and cancel while cancelling is still free.
//
// Jaettu maksu: "Jaa maksu" makes the payment link here too, and once it exists the sheet shows who
// has paid (each paid part went back to me). Past the free cancellation the booking can go on sale
// ("Laita myyntiin", better than Cintoia's manual resale: it is bookable for others at once, the
// people waiting for that time are told, and when somebody books it everything paid comes back).
import { useState } from 'react';
import { api } from '../../api/index.js';
import { navigate } from '../../app/router.js';
import { canPutOnSale, centsLabel, durationLabel, friendsPaid, giveBackOf, giveBackText } from '../../features/booking.js';
import { Button, Chip, Icon, Sheet, useConfirm, useToast } from '../../ui/index.js';
import { VenueMap, hasVenueMap } from './VenueMap.jsx';
import { bookingStateText, downloadBookingIcs, sportLabel, timeInSentence, whenLabel } from './BookingParts.jsx';
import { SplitShare } from './SplitShare.jsx';
import { useForecast, weatherInfo } from './weather.js';

export function MyBookingSheet({ open, booking, venue, onClose, onChanged, onRebook }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [working, setWorking] = useState(false);
  const location = (booking && venue?.locations.find((l) => l.courts.some((c) => c.id === booking.courtId))) || null;
  const weather = weatherInfo(useForecast(location, booking?.startsAt));
  if (!booking) return null;

  const live = booking.status === 'confirmed' || booking.status === 'held';
  const ended = Date.parse(booking.endsAt) <= Date.now();
  const canCancel = booking.status === 'confirmed' && Date.parse(booking.cancellableUntil) > Date.now();
  // Resale needs the phase 4 server (venue.resale is false before it).
  const canSell = canPutOnSale(booking) && venue?.resale === true;
  const paid = booking.paymentStatus === 'paid' || booking.paymentStatus === 'credit';
  const split = booking.split;
  // What comes back: card money, series card hours, gift balance (and the friends get their own parts).
  const back = giveBackOf(booking);
  const backText = `${giveBackText(back) || 'Saat rahasi takaisin'}${friendsPaid(booking) ? ', kaverit omat osuutensa' : ''}`;
  const backLabel = [
    back.cardCents && centsLabel(back.cardCents),
    back.giftCents && `${centsLabel(back.giftCents)} saldoon`,
    back.minutes && `${durationLabel(back.minutes)} sarjakortille`,
  ].filter(Boolean).join(' + ');

  const soldBack = booking.soldAt ? giveBackText(back) : null;

  const run = async (fn) => {
    setWorking(true);
    try {
      await fn();
    } catch (err) {
      toast(err);
    } finally {
      setWorking(false);
    }
  };

  const cancel = async () => {
    const ok = await confirm({
      title: 'Perutaanko vuoro?',
      message: paid
        ? `${booking.courtName}, ${whenLabel(booking.startsAt, booking.endsAt)}. ${backText}.`
        : `${booking.courtName}, ${whenLabel(booking.startsAt, booking.endsAt)}. Vuoro vapautuu muille.`,
      confirmLabel: 'Peru vuoro',
      cancelLabel: 'Pidä vuoro',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      const { refundedCents, creditCents, creditMinutes } = await api.booking.cancel(booking.id);
      const backNow = giveBackText({ cardCents: refundedCents, giftCents: creditCents, minutes: creditMinutes });
      toast(backNow ? `Vuoro peruttu. ${backNow}.` : 'Vuoro peruttu.', { icon: 'check' });
      onChanged?.();
      onClose();
    });
  };

  const release = () => run(async () => {
    await api.booking.release(booking.id);
    toast('Varaus peruttu — mitään ei veloitettu.');
    onChanged?.();
    onClose();
  });

  const putOnSale = async () => {
    const ok = await confirm({
      title: 'Laitetaanko vuoro myyntiin?',
      message: `Vuoro näkyy muille vapaana. Kun joku varaa sen, ${backText.charAt(0).toLowerCase()}${backText.slice(1)}. Siihen asti vuoro on sinun.`,
      confirmLabel: 'Laita myyntiin',
      cancelLabel: 'Pidä vuoro',
    });
    if (!ok) return;
    await run(async () => {
      await api.booking.putOnSale(booking.id);
      toast('Vuoro on myynnissä. Kerromme, kun joku varaa sen.', { icon: 'check' });
      onChanged?.();
      onClose();
    });
  };

  const takeOffSale = () => run(async () => {
    await api.booking.takeOffSale(booking.id);
    toast('Myynti peruttu — vuoro on taas vain sinun.');
    onChanged?.();
    onClose();
  });

  const findPartner = () => {
    onClose();
    navigate(`/pelaa/uusi-peli?varaus=${encodeURIComponent(booking.id)}`, { overlay: true });
  };

  const stateTone = booking.soldAt ? 'neutral'
    : booking.status === 'confirmed' ? (booking.forSale ? 'neutral' : 'success')
    : booking.status === 'held' ? 'warn' : 'neutral';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={booking.courtName}
      subtitle={`${sportLabel(booking.sport)} · ${booking.locationName}`}
      size="md"
      className="bk-sheet"
      footer={live && !ended ? (
        <div className="stack-2">
          {booking.status === 'held' ? (
            <Button variant="outline" block loading={working} onClick={release}>Peru maksamaton varaus</Button>
          ) : (
            <>
              <Button variant="dark" icon="calendar" block onClick={() => downloadBookingIcs(booking, { cancellableUntil: booking.cancellableUntil })}>Lisää kalenteriin</Button>
              {!booking.forSale && <Button variant="outline" icon="users" block onClick={findPartner}>Etsi pelikaveri tähän vuoroon</Button>}
            </>
          )}
        </div>
      ) : undefined}
    >
      <div className="stack-4">
        <div className="bk-mine-head">
          <span className="bk-mine-head-when">{whenLabel(booking.startsAt, booking.endsAt)}</span>
          <Chip tone={stateTone} size="sm">{bookingStateText(booking)}</Chip>
        </div>

        {booking.soldAt && (
          <div className="bk-info">
            <Icon name="check-circle" size={18} />
            <span>
              Joku varasi vuoron {timeInSentence(booking.soldAt)}.{' '}
              {soldBack ? `${soldBack}.` : 'Mitään ei veloitettu.'}{friendsPaid(booking) ? ' Kaverit saavat osuutensa takaisin.' : ''}
            </span>
          </div>
        )}

        {booking.forSale && (
          <div className="bk-info">
            <Icon name="share" size={18} />
            <span><b>Myynnissä.</b> Vuoro näkyy muille vapaana. Kun joku varaa sen, {backText.charAt(0).toLowerCase()}{backText.slice(1)}. Siihen asti vuoro on sinun.</span>
          </div>
        )}

        {location && hasVenueMap(location.mapKey) && (
          <VenueMap compact mapKey={location.mapKey} courts={location.courts} states={{ [booking.courtId]: 'mine' }} className="bk-sheet-map" />
        )}

        {live && !ended && <SplitShare venue={venue} booking={booking} onChanged={() => onChanged?.()} />}

        <dl className="bk-facts">
          <div><dt>Paikka</dt><dd>{booking.locationName}{location?.address ? <small>{location.address}</small> : null}</dd></div>
          <div><dt>Hinta</dt><dd>{centsLabel(booking.priceCents)}<small>{split ? `Jaettu ${split.parts} pelaajalle · osuutesi ${centsLabel(split.ownCents)}` : bookingStateText(booking)}</small></dd></div>
          {weather && !ended && <div><dt>Sää</dt><dd className={weather.wet ? 'bk-weather is-wet' : 'bk-weather'}>{weather.symbol} {weather.text}</dd></div>}
          {booking.status === 'confirmed' && !ended && !booking.forSale && (
            <div>
              <dt>Peruutus</dt>
              <dd>{canCancel ? `Maksuton ${timeInSentence(booking.cancellableUntil)} asti` : canSell ? 'Maksuton peruutus on mennyt — voit laittaa vuoron myyntiin.' : 'Peruutusaika on mennyt — ota yhteyttä halliin.'}</dd>
            </div>
          )}
        </dl>

        {canSell && (
          <button type="button" className="bk-rebook bk-rebook-inline" onClick={putOnSale} disabled={working}>
            <span className="bk-rebook-icon" aria-hidden="true"><Icon name="share" size={18} strokeWidth={2.4} /></span>
            <span className="bk-rebook-text">
              <span className="bk-rebook-title">Et pääse? Laita vuoro myyntiin</span>
              <span className="bk-rebook-sub">Kun joku varaa sen, saat rahat takaisin</span>
            </span>
            <Icon name="chevron-right" size={18} />
          </button>
        )}

        {booking.forSale && (
          <Button variant="outline" block loading={working} onClick={takeOffSale}>Peru myynti, pidän vuoron</Button>
        )}

        {onRebook && booking.status === 'confirmed' && !booking.forSale && (
          <button type="button" className="bk-rebook bk-rebook-inline" onClick={() => onRebook(booking)}>
            <span className="bk-rebook-icon" aria-hidden="true"><Icon name="repeat" size={18} strokeWidth={2.4} /></span>
            <span className="bk-rebook-text">
              <span className="bk-rebook-title">Varaa sama vuoro viikon päähän</span>
              <span className="bk-rebook-sub">Sama kenttä ja aika, jos se on vapaana</span>
            </span>
            <Icon name="chevron-right" size={18} />
          </button>
        )}

        {canCancel && (
          <button type="button" className="bk-cancel" onClick={cancel} disabled={working}>
            <Icon name="close" size={16} />Peru vuoro{backLabel ? ` ja palauta ${backLabel}` : ''}
          </button>
        )}
      </div>
    </Sheet>
  );
}
