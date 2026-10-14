// BookingParts.jsx — small pieces of the court-booking screens: the day strip, the start-time
// tiles, my booking cards, the hold countdown and the calendar file for a booking.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MONTHS, WEEKDAYS_SHORT, dayLabel, formatGameTime, formatTime } from '../../lib/format.js';
import { SPORTS, centsLabel, durationLabel, localDate, partOfDay } from '../../features/booking.js';
import { Icon } from '../../ui/index.js';

const cx = (...c) => c.filter(Boolean).join(' ');

export const sportLabel = (sport) => SPORTS.find((s) => s.value === sport)?.label || 'Tennis';

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
    const left = el.offsetLeft - box.clientWidth / 2 + el.offsetWidth / 2;
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

// ── Start-time tiles ─────────────────────────────────────────────────────────

const PARTS = { Aamu: 'Aamu', Päivä: 'Päivä', Ilta: 'Ilta' };

/**
 * A day's start times grouped into Aamu / Päivä / Ilta. A free tile shows the time, the cheapest
 * free court's price ("alk." when courts differ, struck-through full price on a last-minute deal)
 * and how many courts are free; `fits(startsAt)` marks the player's usual play times. A full time
 * (options: []) is a dimmed tile with a bell: "Ilmoita kun vapautuu" — `watched(startsAt)` says
 * whether the bell is already on.
 */
export function TimeTiles({ slots, onPick, onWatch, watched = () => false, fits = () => false }) {
  const groups = [];
  for (const slot of slots) {
    const label = PARTS[partOfDay(slot.startsAt)];
    let group = groups[groups.length - 1];
    if (!group || group.label !== label) {
      group = { label, slots: [] };
      groups.push(group);
    }
    group.slots.push(slot);
  }
  return (
    <div className="bk-times-wrap">
      {groups.map((group) => (
        <section key={group.label} className="bk-times-group" aria-label={group.label}>
          <h3 className="eyebrow bk-times-label">{group.label}</h3>
          <div className="bk-times stagger">
            {group.slots.map((slot, i) => {
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
                    <span className="bk-time-price">Täynnä</span>
                    <span className="bk-time-free"><Icon name="bell" size={12} strokeWidth={2.4} />{on ? 'Ilmoitetaan' : 'Ilmoita'}</span>
                  </button>
                );
              }
              const prices = slot.options.map((o) => o.cents);
              const min = Math.min(...prices);
              const full = Math.min(...slot.options.map((o) => o.fullCents ?? o.cents));
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
                  <span className="bk-time-price">
                    {varies && <small>alk. </small>}{centsLabel(min)}
                    {slot.deal > 0 && full > min && <s className="bk-time-was">{centsLabel(full)}</s>}
                  </span>
                  <span className="bk-time-free">{free}</span>
                  {slot.deal > 0 && <span className="bk-time-tag">−{slot.deal} %</span>}
                  {mine && !slot.deal && <span className="bk-time-yours" aria-hidden="true" title="Sopii peliaikoihisi" />}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// ── My bookings ──────────────────────────────────────────────────────────────

/** 'Maksettu' | 'Maksamatta' | … for a Booking. */
export function bookingStateText(booking) {
  if (booking.status === 'cancelled') return booking.paymentStatus === 'refunded' ? 'Peruttu · hyvitetty' : 'Peruttu';
  if (booking.status === 'expired') return 'Vanhentunut';
  if (booking.status === 'held') return 'Maksamatta';
  if (booking.paymentStatus === 'paid') return 'Maksettu';
  if (booking.paymentStatus === 'free') return 'Vahvistettu';
  return 'Vahvistettu';
}

export function MyBookingCard({ booking, now, onOpen }) {
  const held = booking.status === 'held';
  return (
    <button type="button" className={cx('bk-mine', held && 'is-held')} onClick={() => onOpen(booking)}>
      <span className="bk-mine-day">{dayLabel(booking.startsAt, new Date(now))}</span>
      <span className="bk-mine-clock t-num">{formatTime(booking.startsAt)}–{formatTime(booking.endsAt)}</span>
      <span className="bk-mine-court">{booking.courtName}</span>
      <span className="bk-mine-place truncate">{booking.locationName}</span>
      <span className={cx('bk-mine-state', held ? 'is-held' : 'is-ok')}>
        <Icon name={held ? 'clock' : 'check'} size={13} strokeWidth={2.6} />
        {bookingStateText(booking)}
      </span>
    </button>
  );
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
    cancellableUntil && `Maksuton peruutus ${formatGameTime(cancellableUntil)} asti.`,
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
