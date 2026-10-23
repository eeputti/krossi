// MonthSheet — Kehitys → Kalenteri: a month at a glance, what was done on each day (the coach's
// sessions, own tennis, a run, the gym, matches, tournaments, own entries). Tap a day for its list.
// WeekCard is the small card on Kehitys that opens it: this week Monday–Sunday.
import { useMemo, useState } from 'react';
import { useData } from '../app/data.jsx';
import { Icon, IconButton, Sheet } from '../ui/index.js';
import { koutsiFmtShortDate } from '../domain/core.js';
import { monthCalendar, weekStrip, itemIcon } from '../domain/monthCal.js';
import { ActivityIcon } from './ActivityIcon.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const WEEKDAYS = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];

/** An item's icon: own activities draw their own (ActivityIcon), the rest use the Krossi set. */
function ItemIcon({ item, size = 16 }) {
  const name = itemIcon(item);
  if (item.kind === 'own' || item.kind === 'coach') return <ActivityIcon activity={item.activity} size={size} />;
  return <Icon name={name} size={size} />;
}

/** "11 h 30 min" / "45 min" */
function fmtMinutes(min) {
  if (!min) return '0 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}

export function WeekCard({ hidden, onOpen }) {
  const { state } = useData();
  const student = state.students[0];
  const days = weekStrip(state, student, { hidden });
  const done = days.filter((d) => d.items.length).length;
  return (
    <button type="button" className="mc-week" onClick={onOpen}>
      <span className="mc-week-head">
        <span className="mc-week-title">Tämä viikko</span>
        <span className="mc-week-sub">{done === 0 ? 'Ei vielä merkintöjä' : done === 1 ? '1 treenipäivä' : `${done} treenipäivää`}</span>
        <span className="mc-week-open">Kalenteri <Icon name="chevron-right" size={15} /></span>
      </span>
      <span className="mc-week-days">
        {days.map((d, i) => (
          <span key={d.date} className={cx('mc-week-day', d.items.length && 'is-done', d.isToday && 'is-today', d.isFuture && 'is-future')}>
            <span className="mc-week-dot">{d.items[0] ? <ItemIcon item={d.items[0]} size={15} /> : null}</span>
            <span className="mc-week-name">{WEEKDAYS[i]}</span>
          </span>
        ))}
      </span>
    </button>
  );
}

export function MonthSheet({ open, onClose, hidden }) {
  const { state } = useData();
  const student = state.students[0];
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [picked, setPicked] = useState(null);
  const cal = useMemo(() => monthCalendar(state, student, ym.year, ym.month, { hidden }), [state, student, ym, hidden]);
  const isCurrent = ym.year === now.getFullYear() && ym.month === now.getMonth();
  const shift = (n) => {
    setPicked(null);
    setYm(({ year, month }) => {
      const d = new Date(year, month + n, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };
  const days = cal.weeks.flat();
  const lastDone = [...days].reverse().find((d) => d.inMonth && d.items.length);
  const day = days.find((d) => d.date === picked) || days.find((d) => d.isToday && d.inMonth && d.items.length) || lastDone || null;
  return (
    <Sheet open={open} onClose={onClose} title="Kalenteri" size="md" className="mc-sheet">
      <div className="stack-4">
        <div className="mc-nav">
          <IconButton icon="chevron-left" label="Edellinen kuukausi" size="sm" onClick={() => shift(-1)} />
          <span className="mc-month">{cal.label}</span>
          <IconButton icon="chevron-right" label="Seuraava kuukausi" size="sm" disabled={isCurrent} onClick={() => shift(1)} />
        </div>
        <div className="mc-sum">
          <span><strong className="t-num">{cal.activeDays}</strong> treenipäivää</span>
          <span><strong className="t-num">{cal.sessions}</strong> valmennusta</span>
          <span><strong className="t-num">{cal.own}</strong> omaa</span>
          {cal.minutes > 0 && <span><strong className="t-num">{fmtMinutes(cal.minutes)}</strong></span>}
        </div>
        <div className="mc-grid" role="grid" aria-label={cal.label}>
          {WEEKDAYS.map((w) => <span key={w} className="mc-wd" role="columnheader">{w}</span>)}
          {days.map((d) => (
            <button key={d.date} type="button" role="gridcell" disabled={!d.inMonth}
              className={cx('mc-day', !d.inMonth && 'is-out', d.items.length && 'is-done', d.isToday && 'is-today', d.isFuture && 'is-future', day?.date === d.date && 'is-picked')}
              onClick={() => setPicked(d.date)} aria-label={`${d.day}. ${d.items.length ? d.items.map((x) => x.title).join(', ') : 'ei merkintöjä'}`}>
              <span className="mc-day-num t-num">{d.inMonth ? d.day : ''}</span>
              {d.items[0] && <span className="mc-day-icon"><ItemIcon item={d.items[0]} size={15} /></span>}
              {d.items.length > 1 && <span className="mc-day-more t-num">+{d.items.length - 1}</span>}
            </button>
          ))}
        </div>
        {day && (
          <section className="mc-dayinfo" aria-label={koutsiFmtShortDate(day.date)}>
            <div className="eyebrow">{koutsiFmtShortDate(day.date)}</div>
            {day.items.length === 0 ? <p className="k-quiet-text">Ei merkintöjä tältä päivältä.</p> : (
              <ul className="mc-items">
                {day.items.map((x) => (
                  <li key={`${x.key}-${day.date}`} className={cx('mc-item', `is-${x.kind}`)}>
                    <span className="mc-item-icon"><ItemIcon item={x} size={16} /></span>
                    <span className="mc-item-main">
                      <span className="mc-item-title">{x.title}</span>
                      {x.sub && <span className="mc-item-sub">{x.sub}</span>}
                    </span>
                    {x.time && <span className="mc-item-time t-num">{x.time}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </Sheet>
  );
}
