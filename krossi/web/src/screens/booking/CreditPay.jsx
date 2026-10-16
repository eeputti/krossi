// CreditPay — the booking sheet's pay step offers the player's own credit before the card form:
// "Maksa sarjakortilla" pays the whole booking from a series card that fits (sport, enough minutes,
// valid on the day), and "Käytä lahjakorttisaldoa" puts the gift balance on the hold — all of it
// confirms the booking at once, part of it leaves the rest for the card (the checkout's amount
// changes). Shown only when the player has something to use.
//
//   <CreditPay venue booking onConfirmed={(booking) => …} onChanged={(booking) => …} />
import { useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync } from '../../app/hooks.js';
import { centsLabel } from '../../features/booking.js';
import { hoursLeftLabel, passFits } from '../../features/seasons.js';
import { Icon, Toggle, useToast } from '../../ui/index.js';

const cx = (...c) => c.filter(Boolean).join(' ');

/** What the card still pays for a booking (price minus a gift share on it). */
export function dueCents(booking) {
  return (booking?.priceCents || 0) - (booking?.credit?.kind === 'gift' ? booking.credit.cents : 0);
}

const bookingMinutes = (b) => Math.round((Date.parse(b.endsAt) - Date.parse(b.startsAt)) / 60_000);

export function CreditPay({ venue, booking, onConfirmed, onChanged }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const wallet = useAsync(() => api.wallet.get(venue.id), [venue.id, booking.id]);
  const w = wallet.data;
  if (!w) return null;

  const minutes = bookingMinutes(booking);
  const passes = w.passes.filter((p) => p.status === 'active' && p.sport === booking.sport);
  const giftOn = booking.credit?.kind === 'gift';
  const giftAvailable = w.giftCents;
  if (!passes.length && giftAvailable <= 0 && !giftOn) return null;

  const payWithPass = async (pass) => {
    setBusy(pass.id);
    try {
      onConfirmed(await api.wallet.payBooking(booking.id, pass.id));
    } catch (err) {
      toast(err);
      wallet.reload({ silent: true });
    } finally {
      setBusy(null);
    }
  };

  const toggleGift = async (on) => {
    setBusy('gift');
    try {
      const next = await api.wallet.useGift(booking.id, on);
      if (next.status === 'confirmed') onConfirmed(next);
      else onChanged(next);
      wallet.reload({ silent: true });
    } catch (err) {
      toast(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ss-credit">
      <span className="eyebrow ss-eyebrow">Omat kortit</span>
      {passes.map((p) => {
        const fits = passFits(p, { sport: booking.sport, minutes, startsAt: booking.startsAt });
        const after = p.minutesLeft - minutes;
        return (
          <button
            key={p.id}
            type="button"
            className={cx('ss-credit-option', !fits && 'is-off')}
            disabled={!fits || Boolean(busy)}
            onClick={() => payWithPass(p)}
          >
            <span className="ss-credit-icon" aria-hidden="true"><Icon name="repeat" size={18} /></span>
            <span className="ss-credit-text">
              <b>{busy === p.id ? 'Maksetaan…' : 'Maksa sarjakortilla'}</b>
              <small>
                {p.name} · {fits
                  ? `${hoursLeftLabel(p.minutesLeft)} → ${hoursLeftLabel(after)}`
                  : p.minutesLeft < minutes ? `saldo ei riitä (${hoursLeftLabel(p.minutesLeft)})` : 'ei voimassa vuoron päivänä'}
              </small>
            </span>
            {fits && <Icon name="chevron-right" size={18} />}
          </button>
        );
      })}
      {(giftAvailable > 0 || giftOn) && (
        <Toggle
          icon="gift"
          label="Käytä lahjakorttisaldoa"
          hint={giftOn
            ? `${centsLabel(booking.credit.cents)} saldosta · kortilla ${centsLabel(dueCents(booking))}`
            : `Saldoa ${centsLabel(giftAvailable)}${giftAvailable >= booking.priceCents ? ' — kattaa koko varauksen' : ''}`}
          checked={giftOn}
          disabled={Boolean(busy)}
          onChange={toggleGift}
        />
      )}
    </div>
  );
}
