// BookingParts.jsx — small pieces of the court-booking screens: the place cards, the day strip,
// the length stepper, the start-time rows, unpaid kausivuoro months, a booking's state, the hold
// countdown and the calendar file for a booking.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MONTHS, WEEKDAYS_SHORT, dayLabel, formatGameTime, formatTime } from '../../lib/format.js';
import { SPORTS, centsLabel, durationLabel, localDate } from '../../features/booking.js';
import { Icon, TennisBall } from '../../ui/index.js';

const cx = (...c) => c.filter(Boolean).join(' ');

export const sportLabel = (sport) => SPORTS.find((s) => s.value === sport)?.label || 'Tennis';

/** formatGameTime inside a sentence: 'huomenna klo 17.00' (not 'Huomenna klo 17.00'). */
export function timeInSentence(iso, now = new Date()) {
  const text = formatGameTime(iso, now);
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** 'Huomenna klo 18.00–19.30' */
export function whenLabel(startsAt, endsAt, now = new Date()) {
  return `${dayLabel(startsAt, now)} klo ${formatTime(startsAt)}–${formatTime(endsAt)}`;
}

// ── Day strip ────────────────────────────────────────────────────────────────

/** The bookable days side by side; the chosen one stays in view. */
export function DateStrip({ days, value, onChange }) {
  const strip = useRef(null);
  useLayoutEffect(() => {
    const box = strip.current;
    const el = box?.querySelector('[aria-pressed="true"]');
    if (!box || !el) return;
    // Measured against the strip itself: offsetLeft counts from the nearest positioned ancestor,
    // which on a desktop includes the side nav and pushed "Tänään" out of view.
    const boxRect = box.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const left = box.scrollLeft + (elRect.left - boxRect.left) - box.clientWidth / 2 + elRect.width / 2;
    box.scrollTo?.({ left: Math.max(0, left), behavior: 'smooth' });
  }, [value]);
  return (
    <div ref={strip} className="bk-days" role="group" aria-label="Päivä">
      {days.map((key, i) => {
        const d = localDate(key);
        const top = i === 0 ? 'Tänään' : i === 1 ? 'Huom.' : WEEKDAYS_SHORT[d.getDay()];
        const on = key === value;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            aria-label={i < 2 ? `${top} ${d.getDate()}.${d.getMonth() + 1}.` : undefined}
            className={cx('bk-day', on && 'is-on', d.getDay() % 6 === 0 && 'is-weekend')}
            onClick={() => onChange(key)}
          >
            <span className="bk-day-top">{top}</span>
            <span className="bk-day-num t-num">{d.getDate()}</span>
            <span className="bk-day-month">{MONTHS[d.getMonth()].slice(0, 4)}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Duration stepper ─────────────────────────────────────────────────────────

/**
 * Kesto: [−] 1 h [+] in the venue's steps (30 min). Starts at 1 h; `options` are the venue's
 * durations, `note` an optional second line under the value (e.g. the price for that length).
 */
export function DurationStepper({ value, options, onChange, note, className }) {
  const sorted = [...options].sort((a, b) => a - b);
  const i = sorted.indexOf(value);
  const prev = i > 0 ? sorted[i - 1] : null;
  const next = i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : null;
  return (
    <div className={cx('bk-stepper', className)} role="group" aria-label="Kesto">
      <button type="button" className="bk-stepper-btn" disabled={prev == null} onClick={() => onChange(prev)} aria-label={prev ? `Lyhennä: ${durationLabel(prev)}` : 'Lyhin kesto'}>
        <span aria-hidden="true">−</span>
      </button>
      <span className="bk-stepper-value" aria-live="polite">
        <b className="t-num">{durationLabel(value)}</b>
        {note ? <small>{note}</small> : null}
      </span>
      <button type="button" className="bk-stepper-btn" disabled={next == null} onClick={() => onChange(next)} aria-label={next ? `Pidennä: ${durationLabel(next)}` : 'Pisin kesto'}>
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}

// ── Place ────────────────────────────────────────────────────────────────────

/**
 * Missä pelaat: the venue's places as cards — "Mikä tahansa" first (no choice needed: any free
 * court), then each hall (the icon tells indoor from outdoor) with how many start times are still
 * free on the chosen day (`freeTimes[placeId]`, `all` for any). While the day loads (`loading`) a
 * small ball spins where the number goes. `value` is a place id or null.
 */
export function PlacePicker({ places, value, onChange, freeTimes = {}, loading = false, shortName = (n) => n, all = 'kaikki' }) {
  const cards = [
    { id: null, name: 'Mikä tahansa', icon: 'grid', free: freeTimes[all] },
    ...places.map((l) => ({ id: l.id, name: shortName(l.name), icon: l.indoor ? 'court' : 'sun', free: freeTimes[l.id] })),
  ];
  return (
    <div className="bk-places" role="radiogroup" aria-label="Paikka">
      {cards.map((card) => {
        const on = (value || null) === card.id;
        return (
          <button
            key={card.id || 'all'}
            type="button"
            role="radio"
            aria-checked={on}
            className={cx('bk-place', on && 'is-on')}
            onClick={() => onChange(card.id)}
          >
            <span className="bk-place-name"><Icon name={card.icon} size={17} strokeWidth={2.3} />{card.name}</span>
            {loading ? (
              <span className="bk-place-free"><TennisBall size={14} motion="spin" /></span>
            ) : card.free != null && (
              <span className={cx('bk-place-free', card.free === 0 && 'is-none')}>
                {card.free === 0 ? 'Ei vapaita aikoja' : card.free === 1 ? '1 vapaa aika' : `${card.free} vapaata aikaa`}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Unpaid payments ──────────────────────────────────────────────────────────

/**
 * Maksamattomat maksut: kausivuoro months that failed (`months`: CardCharge & { slot }), one row
 * each with its amount on the pay button; `onOpenMonth(charge)` takes the player to the payment.
 */
export function UnpaidPayments({ months = [], onOpenMonth }) {
  return (
    <div className="bk-unpaid">
      {months.map((c) => {
        const [year, month] = c.month.split('-').map(Number);
        return (
          <button key={c.id} type="button" className="bk-owe" onClick={() => onOpenMonth(c)}>
            <span className="bk-owe-icon" aria-hidden="true"><Icon name="repeat" size={16} strokeWidth={2.4} /></span>
            <span className="bk-owe-text">
              <b>Kausivuoron kuukausimaksu</b>
              <span className="truncate">{MONTHS[month - 1]} {year} · {c.slot.courtName || 'Kausivuoro'}</span>
            </span>
            <span className="bk-owe-cta">Maksa <span className="t-num bk-nowrap">{centsLabel(c.amountCents)}</span></span>
          </button>
        );
      })}
    </div>
  );
}

// ── Start times ──────────────────────────────────────────────────────────────

/**
 * A day's start times as one list of rows, read left to right: the time, how many courts are free
 * (a lime dot: fits the player's usual play times, `fits(startsAt)`), a last-minute deal if the hall
 * has one, the price (the cheapest free court's, "alk." when courts differ). A full time
 * (options: []) is a dim row with a bell: "Ilmoita kun vapautuu" — `watched(startsAt)` says whether
 * it is on. `sales` are other players' bookings on sale at exactly their time: each is its own row,
 * booked as it is with `onPickSale(sale)`.
 */
export function TimeRows({ slots, sales = [], onPick, onPickSale, onWatch, watched = () => false, fits = () => false }) {
  const items = [
    ...slots.map((slot) => ({ at: slot.startsAt, slot })),
    ...sales.map((sale) => ({ at: sale.startsAt, sale })),
  ].sort((a, b) => a.at.localeCompare(b.at) || (a.sale ? 1 : 0) - (b.sale ? 1 : 0));
  return (
      <div className="bk-times stagger" aria-label="Vapaat ajat">
        {items.map(({ slot, sale }, i) => {
          if (sale) {
            const length = durationLabel(sale.minutes);
            return (
              <button
                key={sale.id}
                type="button"
                className="bk-time is-sale"
                style={{ '--i': Math.min(i, 10) }}
                onClick={() => onPickSale?.(sale)}
                aria-label={`klo ${formatTime(sale.startsAt)}–${formatTime(sale.endsAt)}, myynnissä: ${sale.court.name}, ${sale.location.name}, ${centsLabel(sale.cents)}`}
              >
                <span className="bk-time-clock t-num">{formatTime(sale.startsAt)}</span>
                <span className="bk-time-free truncate">{sale.court.name} · {length}</span>
                <span className="bk-time-tag is-sale">Myynnissä</span>
                <span className="bk-time-price">{centsLabel(sale.cents)}</span>
                <Icon name="chevron-right" size={18} className="bk-time-go" />
              </button>
            );
          }
          const clockText = formatTime(slot.startsAt);
          const mine = fits(slot.startsAt);
          if (!slot.options.length) {
            const on = watched(slot.startsAt);
            return (
              <button
                key={slot.startsAt}
                type="button"
                className={cx('bk-time', 'is-full', on && 'is-watched')}
                style={{ '--i': Math.min(i, 10) }}
                aria-pressed={on}
                onClick={() => onWatch?.(slot)}
                aria-label={`klo ${clockText}, täynnä. ${on ? 'Ilmoitus vapautumisesta on päällä — poista napauttamalla' : 'Ilmoita kun vapautuu'}`}
              >
                <span className="bk-time-clock t-num">{clockText}</span>
                <span className="bk-time-free">Täynnä</span>
                <span className="bk-time-bell"><Icon name="bell" size={14} strokeWidth={2.4} />{on ? 'Ilmoitetaan' : 'Ilmoita'}</span>
              </button>
            );
          }
          const prices = slot.options.map((o) => o.cents);
          const min = Math.min(...prices);
          const varies = prices.some((p) => p !== min);
          const n = slot.options.length;
          const free = n === 1 ? 'Viimeinen kenttä' : `${n} kenttää`;
          return (
            <button
              key={slot.startsAt}
              type="button"
              className={cx('bk-time', n === 1 && 'is-last', slot.deal && 'is-deal', mine && 'is-yours')}
              style={{ '--i': Math.min(i, 10) }}
              onClick={() => onPick(slot)}
              aria-label={`klo ${clockText}, ${free.toLowerCase()} vapaana, ${varies ? 'alkaen ' : ''}${centsLabel(min)}${slot.deal ? `, viime hetken ale −${slot.deal} %` : ''}${mine ? ', sopii peliaikoihisi' : ''}`}
            >
              <span className="bk-time-clock t-num">{clockText}</span>
              <span className="bk-time-free">
                {mine && <span className="bk-time-yours" aria-hidden="true" title="Sopii peliaikoihisi" />}
                {free}
              </span>
              {slot.deal > 0 && <span className="bk-time-tag">−{slot.deal} %</span>}
              <span className="bk-time-price">{varies && <small>alk. </small>}{centsLabel(min)}</span>
              <Icon name="chevron-right" size={18} className="bk-time-go" />
            </button>
          );
        })}
      </div>
  );
}

// ── My bookings ──────────────────────────────────────────────────────────────

/** 'Maksettu' | 'Maksamatta' | 'Myynnissä' | … for a Booking. */
export function bookingStateText(booking) {
  if (booking.soldAt) return booking.paymentStatus === 'refunded' ? 'Myyty · hyvitetty' : 'Myyty';
  if (booking.status === 'cancelled') return booking.paymentStatus === 'refunded' ? 'Peruttu · hyvitetty' : 'Peruttu';
  if (booking.status === 'expired') return 'Vanhentunut';
  if (booking.status === 'held') return 'Maksamatta';
  if (booking.forSale) return 'Myynnissä';
  if (booking.paymentStatus === 'paid') return 'Maksettu';
  return 'Vahvistettu';
}

// ── Hold countdown ───────────────────────────────────────────────────────────

/** Milliseconds left of a hold (ticks every second while there is one), or null without one. */
export function useHoldLeft(holdExpiresAt) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!holdExpiresAt) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [holdExpiresAt]);
  return holdExpiresAt ? Math.max(0, Date.parse(holdExpiresAt) - now) : null;
}

/** '9.05' (minutes.seconds, Finnish style) */
export function formatLeft(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}.${String(s % 60).padStart(2, '0')}`;
}

export function HoldCountdown({ left }) {
  const low = left < 120_000;
  return (
    <span className={cx('bk-hold', low && 'is-low')} role="timer" aria-live={low ? 'polite' : 'off'}>
      <Icon name="clock" size={15} strokeWidth={2.4} />
      Pidossa sinulle <b className="t-num">{formatLeft(left)}</b>
    </span>
  );
}

// ── Calendar file ────────────────────────────────────────────────────────────

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => `\\${m}`);

/** iCalendar text for a Booking (contract shape). */
export function bookingIcs(booking, { cancellableUntil, url } = {}) {
  const what = `${sportLabel(booking.sport)} – ${booking.courtName}`;
  const notes = [
    'Varattu Krossissa.',
    cancellableUntil && `Peruutus ${formatGameTime(cancellableUntil)} asti, peruutuskulu 1 €.`,
    url,
  ].filter(Boolean).join('\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Krossi//krossi.app//FI', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${booking.id}@krossi.app`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(new Date(booking.startsAt))}`,
    `DTEND:${stamp(new Date(booking.endsAt))}`,
    `SUMMARY:${esc(what)}`,
    `LOCATION:${esc([booking.locationName, booking.venueName].filter(Boolean).join(', '))}`,
    `DESCRIPTION:${esc(notes)}`,
    url ? `URL:${url}` : null,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Kenttävuoro kahden tunnin päästä', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

export function downloadBookingIcs(booking, options) {
  const blob = new Blob([bookingIcs(booking, options)], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'krossi-kenttavuoro.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
