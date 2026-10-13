// CalendarScreen — the week as an agenda (a coach with five sessions a day needs the list,
// not dots), with a month grid one tap away. Club events sit with the days they cover.
import { useMemo, useState } from 'react';
import { useData } from '../app/data.jsx';
import { useIsDesktop, useNow } from '../app/hooks.js';
import { navigate } from '../app/router.js';
import { Button, Icon, IconButton, Page, PageHeader, Segmented } from '../ui/index.js';
import { WeekStepper } from '../shared/bits.jsx';
import {
  koutsiAddIsoWeeks, koutsiCompareIsoWeeks, koutsiCurrentIsoWeek, koutsiTodayStr, koutsiClubEventsOnDate,
  koutsiFmtShortDate, koutsiPad, koutsiIsoWeekOfDateStr, KOUTSI_MONTHS, KOUTSI_EVENT_KINDS,
} from '../domain/core.js';
import { coachSessionsOn, parseWeekParam, weekDates, weekParam, shortDay } from '../domain/week.js';
import { SessionRow } from './parts.jsx';
import { EventSheet, TrainingSheet } from './trainingForms.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const kindLabel = (k) => KOUTSI_EVENT_KINDS.find((x) => x.value === k)?.label || 'Tapahtuma';

function EventRow({ event, onOpen }) {
  const span = event.endDate && event.endDate !== event.date ? `${koutsiFmtShortDate(event.date)}–${koutsiFmtShortDate(event.endDate)}` : null;
  return (
    <button type="button" className="k-event-row" onClick={() => onOpen(event)}>
      <Icon name="flag" size={16} />
      <span className="grow"><span className="k-row-title">{event.title}</span><span className="k-faint">{kindLabel(event.kind)}{span ? ` · ${span}` : ''}</span></span>
      <Icon name="edit" size={15} />
    </button>
  );
}

function WeekAgenda({ state, week, onAddOn, onOpenEvent, now }) {
  const today = koutsiTodayStr();
  return (
    <div className="stack-4">
      {weekDates(week).map((date) => {
        const items = coachSessionsOn(state, date);
        const events = koutsiClubEventsOnDate(state, date);
        const isToday = date === today;
        return (
          <section key={date} className={cx('cal-day', isToday && 'is-today', date < today && 'is-past')}>
            <div className="cal-day-head">
              <span className="cal-day-name">{isToday ? 'Tänään' : shortDay(date)}</span>
              {isToday && <span className="cal-day-date">{shortDay(date)}</span>}
              <span className="grow" />
              <IconButton icon="plus" label={`Lisää treeni ${shortDay(date)}`} size="sm" onClick={() => onAddOn(date)} />
            </div>
            {events.map((e) => <EventRow key={e.id} event={e} onOpen={onOpenEvent} />)}
            {items.length === 0 && events.length === 0 ? <p className="cal-empty">Ei treenejä</p> : (
              <div className="k-list">{items.map((item) => <SessionRow key={item.training.id} item={item} now={now} />)}</div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function MonthGrid({ state, year, month, selected, onSelect, onPrev, onNext }) {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const today = koutsiTodayStr();
  const counts = useMemo(() => {
    const map = new Map();
    const prefix = `${year}-${koutsiPad(month + 1)}`;
    for (const t of state.trainings) if (t.loggedBy !== 'player' && t.date.startsWith(prefix)) map.set(t.date, (map.get(t.date) || 0) + 1);
    return map;
  }, [state.trainings, year, month]);
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${year}-${koutsiPad(month + 1)}-${koutsiPad(i + 1)}`)];
  const name = KOUTSI_MONTHS[month];
  return (
    <div className="cal-month">
      <div className="cal-month-head">
        <IconButton icon="chevron-left" label="Edellinen kuukausi" variant="soft" onClick={onPrev} />
        <span className="cal-month-title">{name.charAt(0).toUpperCase() + name.slice(1)} {year}</span>
        <IconButton icon="chevron-right" label="Seuraava kuukausi" variant="soft" onClick={onNext} />
      </div>
      <div className="cal-grid" role="grid">
        {['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'].map((d) => <span key={d} className="cal-dow">{d}</span>)}
        {cells.map((date, i) => {
          if (!date) return <span key={`e${i}`} />;
          const n = counts.get(date) || 0;
          const ev = koutsiClubEventsOnDate(state, date).length;
          return (
            <button key={date} type="button" className={cx('cal-cell', date === today && 'is-today', date === selected && 'is-selected', n > 0 && 'has-sessions')} onClick={() => onSelect(date)}>
              <span className="cal-cell-num">{Number(date.slice(8))}</span>
              {(n > 0 || ev > 0) && <span className="cal-cell-count">{n > 0 ? n : ''}{ev > 0 ? <Icon name="flag" size={9} /> : null}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CalendarScreen({ query }) {
  const { state } = useData();
  const nowMs = useNow(60_000);
  const now = new Date(nowMs);
  const isDesktop = useIsDesktop();
  const [view, setView] = useState(query.nakyma === 'kk' ? 'month' : 'week');
  const week = parseWeekParam(query.vko) || koutsiCurrentIsoWeek();
  const setWeek = (w) => navigate(`/valmentaja/kalenteri?vko=${weekParam(w)}`, { replace: true });
  const today = koutsiTodayStr();
  const [monthCursor, setMonthCursor] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const [selected, setSelected] = useState(today);
  const [training, setTraining] = useState(null); // { date } | null
  const [eventSheet, setEventSheet] = useState(null); // { editing?, date? } | null
  const isCurrent = koutsiCompareIsoWeeks(week, koutsiCurrentIsoWeek()) === 0;
  const daySessions = coachSessionsOn(state, selected);
  const dayEvents = koutsiClubEventsOnDate(state, selected);
  const addEvent = () => setEventSheet({ date: view === 'month' ? selected : weekDates(week)[0] });
  const moveMonth = (n) => setMonthCursor(({ y, m }) => {
    const d = new Date(y, m + n, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  return (
    <Page>
      <PageHeader title="Kalenteri" actions={(
        <>
          {/* on a phone the title and two labelled buttons don't fit on one row */}
          {isDesktop
            ? <Button variant="outline" size="sm" icon="flag" onClick={addEvent}>Tapahtuma</Button>
            : <IconButton icon="flag" label="Uusi tapahtuma" variant="soft" onClick={addEvent} />}
          <Button variant="dark" size="sm" icon="plus" onClick={() => setTraining({ date: view === 'month' ? selected : (isCurrent ? today : weekDates(week)[0]) })}>Treeni</Button>
        </>
      )} />
      <div className="stack-4">
        <Segmented ariaLabel="Näkymä" value={view} onChange={setView} options={[{ value: 'week', label: 'Viikko' }, { value: 'month', label: 'Kuukausi' }]} />
        {view === 'week' ? (
          <>
            <WeekStepper week={week} isCurrent={isCurrent} onPrev={() => setWeek(koutsiAddIsoWeeks(week, -1))} onNext={() => setWeek(koutsiAddIsoWeeks(week, 1))} onToday={() => setWeek(koutsiCurrentIsoWeek())} />
            <WeekAgenda state={state} week={week} now={now} onAddOn={(date) => setTraining({ date })} onOpenEvent={(e) => setEventSheet({ editing: e })} />
          </>
        ) : (
          <>
            <MonthGrid state={state} year={monthCursor.y} month={monthCursor.m} selected={selected} onSelect={setSelected} onPrev={() => moveMonth(-1)} onNext={() => moveMonth(1)} />
            <section className="cal-day is-selected-day">
              <div className="cal-day-head">
                <span className="cal-day-name">{selected === today ? 'Tänään' : shortDay(selected)}</span>
                <span className="grow" />
                <Button variant="ghost" size="sm" onClick={() => { setView('week'); setWeek(koutsiIsoWeekOfDateStr(selected)); }}>Avaa viikko</Button>
              </div>
              {dayEvents.map((e) => <EventRow key={e.id} event={e} onOpen={(ev) => setEventSheet({ editing: ev })} />)}
              {daySessions.length === 0 && dayEvents.length === 0 ? <p className="cal-empty">Ei treenejä</p> : (
                <div className="k-list">{daySessions.map((item) => <SessionRow key={item.training.id} item={item} now={now} />)}</div>
              )}
            </section>
          </>
        )}
      </div>
      <TrainingSheet open={Boolean(training)} defaultDate={training?.date} onClose={() => setTraining(null)} />
      <EventSheet open={Boolean(eventSheet)} editing={eventSheet?.editing} defaultDate={eventSheet?.date} onClose={() => setEventSheet(null)} />
    </Page>
  );
}
