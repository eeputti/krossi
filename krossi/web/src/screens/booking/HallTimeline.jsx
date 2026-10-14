// HallTimeline — the hall view's day grid (HallScreen): one row per court of a location, half-hour
// columns from the venue's opening to its closing time, the day's bookings and blocks laid on top.
// Phones scroll it sideways with the court column pinned; the hour axis stays pinned under the top
// bar and follows the sideways scroll. Opens scrolled to "now" (other days: 16.00).
//
//   <HallTimeline venue location dayKey items loading nowMin onFree={(court, minute) => …} onItem={(item) => …} />
//     items    StaffItem[] of the day (rows of other locations are ignored)
//     loading  skeleton bars instead of items; free half hours aren't tappable meanwhile
//     nowMin   nowMinuteOn(dayKey): draws the "now" line and greys out what is already over
//
// Free half hours are mouse/touch targets only (tabIndex -1, ~400 of them): keyboard users block
// time with the screen's "Estä aika" button. Items are real tab stops with full aria-labels.

import { memo, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { centsLabel } from '../../features/booking.js';
import { firstName, formatTime } from '../../lib/format.js';
import { Icon } from '../../ui/index.js';
import { SLOT, cellStates, dayWindow, hhmm, itemVariant, minuteIn, paymentInfo, spanOf } from './hallData.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const EVENING = 16 * 60;

export function HallTimeline({ venue, location, dayKey, items, loading, nowMin, onFree, onItem }) {
  const win = useMemo(() => dayWindow(venue), [venue]);
  const courts = location?.courts || [];
  // One sport only (the tennis pilot): no colour dots, a narrower court column.
  const mixed = new Set(courts.map((c) => c.sport)).size > 1;
  const axisRef = useRef(null);
  const bodyRef = useRef(null);
  const nowRef = useRef(nowMin);
  nowRef.current = nowMin;

  const hours = useMemo(() => {
    const out = [];
    for (let m = Math.ceil(win.from / 60) * 60; m < win.until; m += 60) out.push(m);
    return out;
  }, [win]);

  // Cells only change when a whole half hour passes, not on every "now" tick.
  const pastUntil = Number.isFinite(nowMin) ? Math.floor(nowMin / SLOT) * SLOT : nowMin;
  const rows = useMemo(() => courts.map((court, i) => ({
    court,
    groupStart: i > 0 && courts[i - 1].sport !== court.sport,
    states: cellStates(venue, court, dayKey, items, pastUntil, win),
    items: (items || []).filter((it) => it.courtId === court.id),
  })), [venue, courts, dayKey, items, pastUntil, win]);

  const syncAxis = useCallback(() => {
    if (axisRef.current && bodyRef.current) axisRef.current.scrollLeft = bodyRef.current.scrollLeft;
  }, []);

  // Open at "now" (today) or 16.00, an hour of context on the left — only when it scrolls at all.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const overflow = body.scrollWidth - body.clientWidth;
    if (overflow < 4) {
      body.scrollLeft = 0;
    } else {
      const col = body.querySelector('.bhall-court')?.offsetWidth || 0;
      const slotPx = (body.scrollWidth - col) / win.slots;
      const now = nowRef.current;
      const target = Number.isFinite(now) ? Math.min(Math.max(now, win.from), win.until) : Math.min(Math.max(EVENING, win.from), win.until);
      body.scrollLeft = Math.max(0, ((target - win.from) / SLOT - 2) * slotPx);
    }
    syncAxis();
  }, [dayKey, location?.id, win, syncAxis]);

  const showNow = Number.isFinite(nowMin) && nowMin >= win.from && nowMin <= win.until;
  const nowAt = showNow ? (nowMin - win.from) / SLOT : 0;
  // The "now" tag takes the place of the hour label it would cover, and stays inside the axis.
  const covered = (m) => showNow && m > nowMin - 60 && m < nowMin + 20;
  const tagEdge = showNow && nowMin > win.until - 25 ? 'is-end' : showNow && nowMin < win.from + 25 ? 'is-start' : null;

  return (
    <div className={cx('bhall-timeline', !mixed && 'is-one-sport')} style={{ '--slots': win.slots }}>
      <div ref={axisRef} className="bhall-axis" aria-hidden="true">
        <div className="bhall-sizer bhall-axis-row">
          <div className="bhall-corner">Kenttä</div>
          <div className="bhall-axis-track">
            {hours.map((m) => (
              <span key={m} className={cx('bhall-hour t-num', covered(m) && 'is-covered')} style={{ '--at': (m - win.from) / SLOT }}>{hhmm(m)}</span>
            ))}
            {showNow && <span className={cx('bhall-now-tag t-num', tagEdge)} style={{ '--at': nowAt }}>{hhmm(Math.floor(nowMin))}</span>}
          </div>
        </div>
      </div>

      <div ref={bodyRef} className="bhall-body" onScroll={syncAxis}>
        <div className="bhall-sizer bhall-rows">
          {rows.map((row, i) => (
            <CourtRow
              key={row.court.id}
              row={row}
              index={i}
              dayKey={dayKey}
              win={win}
              mixed={mixed}
              loading={loading}
              nowSlot={pastUntil}
              onFree={onFree}
              onItem={onItem}
            />
          ))}
          {showNow && <span className="bhall-now" style={{ '--at': nowAt }} aria-hidden="true" />}
        </div>
      </div>
    </div>
  );
}

const CourtRow = memo(function CourtRow({ row, index, dayKey, win, mixed, loading, nowSlot, onFree, onItem }) {
  const { court, states, items, groupStart } = row;
  return (
    <div className={cx('bhall-row', groupStart && 'is-group-start')} role="group" aria-label={court.name}>
      <div className="bhall-court" title={court.surface ? `${court.name} · ${court.surface}` : court.name}>
        {mixed && <span className={cx('bhall-dot', `bhall-dot-${court.sport}`)} aria-hidden="true" />}
        <span className="bhall-court-name">{court.shortName}</span>
      </div>
      <div className="bhall-track">
        <div className="bhall-cells">
          {states.map((state, i) => {
            const minute = win.from + i * SLOT;
            const className = cx('bhall-cell', `is-${state}`, minute % 60 === 0 && 'is-hour');
            if (state === 'free' && !loading) {
              return (
                <button
                  key={minute}
                  type="button"
                  tabIndex={-1}
                  className={className}
                  aria-label={`Estä ${court.shortName} klo ${hhmm(minute)}`}
                  onClick={() => onFree(court, minute)}
                />
              );
            }
            return <span key={minute} className={className} />;
          })}
        </div>
        {loading
          ? <RowSkeleton index={index} slots={win.slots} />
          : items.map((item) => (
            <TimelineItem key={item.id} item={item} court={court} dayKey={dayKey} win={win} nowSlot={nowSlot} onItem={onItem} />
          ))}
      </div>
    </div>
  );
});

function TimelineItem({ item, court, dayKey, win, nowSlot, onItem }) {
  const span = spanOf(item, dayKey, win);
  if (!span) return null;
  const variant = itemVariant(item);
  const start = minuteIn(item.startsAt, dayKey);
  const end = minuteIn(item.endsAt, dayKey);
  const range = `${formatTime(item.startsAt)}–${formatTime(item.endsAt)}`;
  const over = end <= nowSlot;
  const live = Number.isFinite(nowSlot) && start <= nowSlot && end > nowSlot;
  const name = firstName(item.bookedBy?.name);
  const own = variant === 'league' || variant === 'block';
  const title = own ? (item.title || (variant === 'league' ? 'Hallisarja' : 'Este')) : name;

  let label;
  if (own) label = `${title}, ${court.shortName} klo ${range}`;
  else if (variant === 'held') label = `Pidossa, maksu kesken: ${name}, ${court.shortName} klo ${range}`;
  else label = `${name}, ${court.shortName} klo ${range}, ${paymentInfo(item).label.toLowerCase()}`;

  return (
    <button
      type="button"
      className={cx('bhall-item', `is-${variant}`, over && 'is-over', live && 'is-live', span.len < 2 && 'is-tiny')}
      style={{ '--start': span.start, '--len': span.len }}
      aria-label={label}
      title={label}
      onClick={() => onItem(item)}
    >
      <span className="bhall-item-title"><span className="truncate">{title}</span></span>
      <span className="bhall-item-meta t-num">
        {own ? range : variant === 'held' ? 'Pidossa' : <ItemPrice item={item} variant={variant} />}
      </span>
    </button>
  );
}

function ItemPrice({ item, variant }) {
  if (item.paymentStatus === 'free') return 'Maksuton';
  // '21,50 €' -> '21,50' + ' €': a narrow item drops the unit (container query) instead of clipping.
  const [amount, unit] = centsLabel(item.priceCents).split(/(?=\s€$)/);
  return (
    <>
      {variant === 'unpaid'
        ? <Icon name="alert" size={11} strokeWidth={2.6} />
        : item.paymentStatus === 'paid' ? <Icon name="check" size={11} strokeWidth={3.2} /> : null}
      <span className="truncate">{amount}{unit && <span className={cx('bhall-item-unit', amount.includes(',') && 'is-after-cents')}>{unit}</span>}</span>
    </>
  );
}

/** Two shimmering bars per row, spread so the grid reads as "a day is coming" while it loads. */
function RowSkeleton({ index, slots }) {
  const bars = [
    [(3 + index * 5) % Math.max(1, slots - 6), 2 + (index % 3)],
    [(17 + index * 7) % Math.max(1, slots - 4), 2 + ((index + 1) % 2)],
  ];
  return bars.map(([start, len], i) => (
    // eslint-disable-next-line react/no-array-index-key
    <span key={i} className="skeleton bhall-item-skeleton" style={{ '--start': start, '--len': len }} aria-hidden="true" />
  ));
}
