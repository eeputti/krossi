// MyBookingSheet — one of my bookings: where and when (with the court on the floor map), what it
// cost, add to calendar, find a partner for it, and cancel while cancelling is still free.
import { useState } from 'react';
import { api } from '../../api/index.js';
import { navigate } from '../../app/router.js';
import { formatGameTime } from '../../lib/format.js';
import { centsLabel } from '../../features/booking.js';
import { Button, Chip, Icon, Sheet, useConfirm, useToast } from '../../ui/index.js';
import { VenueMap, hasVenueMap } from './VenueMap.jsx';
import { bookingStateText, downloadBookingIcs, sportLabel, whenLabel } from './BookingParts.jsx';
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
  const paid = booking.paymentStatus === 'paid';

  const cancel = async () => {
    const ok = await confirm({
      title: 'Perutaanko vuoro?',
      message: paid
        ? `${booking.courtName}, ${whenLabel(booking.startsAt, booking.endsAt)}. Saat ${centsLabel(booking.priceCents)} takaisin maksutavallesi.`
        : `${booking.courtName}, ${whenLabel(booking.startsAt, booking.endsAt)}. Vuoro vapautuu muille.`,
      confirmLabel: 'Peru vuoro',
      cancelLabel: 'Pidä vuoro',
      danger: true,
    });
    if (!ok) return;
    setWorking(true);
    try {
      const { refundedCents } = await api.booking.cancel(booking.id);
      toast(refundedCents ? `Vuoro peruttu — ${centsLabel(refundedCents)} palautetaan maksutavallesi.` : 'Vuoro peruttu.', { icon: 'check' });
      onChanged?.();
      onClose();
    } catch (err) {
      toast(err);
    } finally {
      setWorking(false);
    }
  };

  const release = async () => {
    setWorking(true);
    try {
      await api.booking.release(booking.id);
      toast('Varaus peruttu — mitään ei veloitettu.');
      onChanged?.();
      onClose();
    } catch (err) {
      toast(err);
    } finally {
      setWorking(false);
    }
  };

  const findPartner = () => {
    onClose();
    navigate(`/pelaa/uusi-peli?varaus=${encodeURIComponent(booking.id)}`, { overlay: true });
  };

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
              <Button variant="outline" icon="users" block onClick={findPartner}>Etsi pelikaveri tähän vuoroon</Button>
            </>
          )}
        </div>
      ) : undefined}
    >
      <div className="stack-4">
        <div className="bk-mine-head">
          <span className="bk-mine-head-when">{whenLabel(booking.startsAt, booking.endsAt)}</span>
          <Chip tone={booking.status === 'confirmed' ? 'success' : booking.status === 'held' ? 'warn' : 'neutral'} size="sm">
            {bookingStateText(booking)}
          </Chip>
        </div>

        {location && hasVenueMap(location.mapKey) && (
          <VenueMap compact mapKey={location.mapKey} courts={location.courts} states={{ [booking.courtId]: 'mine' }} className="bk-sheet-map" />
        )}

        <dl className="bk-facts">
          <div><dt>Paikka</dt><dd>{booking.locationName}{location?.address ? <small>{location.address}</small> : null}</dd></div>
          <div><dt>Hinta</dt><dd>{centsLabel(booking.priceCents)}<small>{bookingStateText(booking)}</small></dd></div>
          {weather && !ended && <div><dt>Sää</dt><dd className={weather.wet ? 'bk-weather is-wet' : 'bk-weather'}>{weather.symbol} {weather.text}</dd></div>}
          {booking.status === 'confirmed' && !ended && (
            <div>
              <dt>Peruutus</dt>
              <dd>{canCancel ? `Maksuton ${formatGameTime(booking.cancellableUntil)} asti` : 'Peruutusaika on mennyt — ota yhteyttä halliin.'}</dd>
            </div>
          )}
        </dl>

        {onRebook && booking.status === 'confirmed' && (
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
            <Icon name="close" size={16} />Peru vuoro{paid ? ` ja palauta ${centsLabel(booking.priceCents)}` : ''}
          </button>
        )}
      </div>
    </Sheet>
  );
}
