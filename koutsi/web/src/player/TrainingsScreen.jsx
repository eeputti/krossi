// TrainingsScreen (player) — Treenit: the player's week, the same calendar as the coach's
// Viikkohallinta. The homework first, then "Viikko 43" with arrows (the date range opens a month to
// jump from), what the week holds, and one plus button for logging. Below, Monday to Sunday on a
// time grid: the coach's sessions light lime (grey once held, dashed when the player said they
// can't come), the player's own logs dark — a run, the gym, own tennis — and tournaments, matches
// and club events as bars over the days. A tap on empty time logs something at that time; a tap on
// a block opens it. A phone shows one day at a time under a day strip, as the coach's does.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { useIsDesktop, useNow } from '../app/hooks.js';
import { navigate } from '../app/router.js';
import { Icon, IconButton, Page, useToast } from '../ui/index.js';
import {
  koutsiAddIsoWeeks, koutsiCompareIsoWeeks, koutsiCurrentIsoWeek, koutsiIsoWeekOfDateStr, koutsiTimeRangeLabel, koutsiTodayStr,
  KOUTSI_EVENT_KINDS,
} from '../domain/core.js';
import { koutsiFmtEventDate } from '../domain/timeline.js';
import { minutesLabel, parseWeekParam, themeWeekRelative, weekDates, weekParam, weekRangeLabel } from '../domain/week.js';
import { eventRangeLabel } from '../domain/board.js';
import { playerWeek, toHHMM } from '../domain/ownWeek.js';
import { ActivityIcon } from './ActivityIcon.jsx';
import { CoachSessionSheet, OwnEntrySheet, PlayerWeekPicker } from './weekSheets.jsx';
import { usePlayerActions } from './PlayerApp.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const DAY_SHORT = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];
const DAY_LONG = ['Maanantai', 'Tiistai', 'Keskiviikko', 'Torstai', 'Perjantai', 'Lauantai', 'Sunnuntai'];
const BASE = '/pelaaja/treenit';
const EVENT_ICON = { kilpailu: 'trophy', leiri: 'compass', seura: 'users', muu: 'flag' };

const dayMonth = (date) => `${Number(date.slice(8))}.${Number(date.slice(5, 7))}.`;
const plural = (n, one, many) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
const kindLabel = (k) => KOUTSI_EVENT_KINDS.find((x) => x.value === k)?.label || 'Tapahtuma';
const y = ({ h }) => `calc(${h.toFixed(4)} * var(--wb-hour))`;
const span = (a, b) => `calc(${(b.h - a.h).toFixed(4)} * var(--wb-hour) - 3px)`;

/** Homework first: what the coach asked for, one tap to mark it done (and to log it as a session). */
function Homework({ student, onLog }) {
  const { run } = useData();
  const toast = useToast();
  const [showDone, setShowDone] = useState(false);
  const open = student.homework.filter((h) => !h.done);
  const done = student.homework.filter((h) => h.done);
  if (!student.homework.length) return null;
  const markDone = async (h) => {
    const res = await run(() => api.homework.toggleDone(h.id, true), null);
    if (res.ok) toast('Merkitty tehdyksi — hienoa!', { action: { label: 'Kirjaa treeniksi', onClick: () => onLog(h) }, duration: 6000 });
  };
  const undo = (h) => run(() => api.homework.toggleDone(h.id, false), 'Merkitty tekemättömäksi.');
  return (
    <section className={cx('pw-hw', open.length === 0 && 'is-clear')} aria-label="Kotiläksyt">
      <div className="pw-hw-head">
        <span className="pw-hw-badge"><Icon name="book" size={18} /></span>
        <span className="grow">
          <span className="eyebrow">Kotiläksyt</span>
          <span className="pw-hw-title">{open.length ? `${open.length} tekemättä` : 'Kaikki tehty — hyvää työtä!'}</span>
        </span>
        {done.length > 0 && (
          <button type="button" className="pw-hw-toggle" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
            Tehdyt <span className="t-num">{done.length}</span><Icon name={showDone ? 'chevron-up' : 'chevron-down'} size={14} />
          </button>
        )}
      </div>
      {open.length > 0 && (
        <ul className="pw-hw-list">
          {open.map((h) => (
            <li key={h.id} className="pw-hw-row">
              <button type="button" className="k-check-btn pw-hw-check" aria-label={`Merkitse tehdyksi: ${h.text}`} onClick={() => markDone(h)}>
                <Icon name="check" size={14} strokeWidth={3} />
              </button>
              <span className="grow">
                <span className="pw-hw-text">{h.text}</span>
                {h.at && <span className="k-faint">Annettu {koutsiFmtEventDate(h.at).toLowerCase()}</span>}
              </span>
              <button type="button" className="pw-hw-log" onClick={() => onLog(h)}>Tein tämän</button>
            </li>
          ))}
        </ul>
      )}
      {showDone && (
        <ul className="pw-hw-list is-done">
          {done.map((h) => (
            <li key={h.id} className="pw-hw-row">
              <button type="button" className="k-check-btn is-on pw-hw-check" aria-label={`Merkitse tekemättömäksi: ${h.text}`} onClick={() => undo(h)}>
                <Icon name="check" size={14} strokeWidth={3} />
              </button>
              <span className="grow"><span className="pw-hw-text">{h.text}</span></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One thing on the grid: a coach's session (light) or the player's own log (dark). */
function Block({ item, grid, onOpen }) {
  const top = grid.at(item.start);
  const bottom = grid.at(item.end);
  const style = {
    top: y(top), height: span(top, bottom),
    left: `calc(${(item.lane / item.lanes) * 100}% + 2px)`, width: `calc(${100 / item.lanes}% - 4px)`,
  };
  const time = koutsiTimeRangeLabel(item.time, item.durationMinutes);
  const [from, to] = time.split('–');
  const own = item.kind === 'own';
  const state = item.absent ? 'Poissa' : '';
  const line = own ? (item.text || minutesLabel(item.durationMinutes)) : item.theme?.title || '';
  const label = [item.title, time, own ? 'oma merkintä' : item.coach?.name, state, line].filter(Boolean).join(', ');
  return (
    <button type="button" className={cx('wb-block', `is-${item.tone}`, item.status === 'now' && 'is-now', item.lanes > 1 && 'is-shared')}
      style={style} onClick={() => onOpen(item)} aria-label={label} title={label}>
      <span className="wb-b">
        <span className="wb-b-top">
          <span className="wb-b-time t-num">{from}{to && <span className="wb-b-end">–{to}</span>}</span>
          {own && <span className="pw-b-icon"><ActivityIcon activity={item.activity} size={14} strokeWidth={2.2} /></span>}
          {item.status === 'now' && <span className="k-ctx-live wb-b-live" aria-hidden="true" />}
        </span>
        <span className="wb-b-name">{item.title}</span>
        {!own && (
          <span className="wb-b-meta">
            {item.absent ? <span className="pw-b-absent">Poissa</span> : <span className="wb-b-level">{item.coach?.name || item.training.type}</span>}
          </span>
        )}
        {line && (
          <span className={cx('wb-b-line', !own && 'is-theme')}>
            {!own && <Icon name="sparkles" size={12} />}
            <span className="wb-b-theme">{line}</span>
          </span>
        )}
      </span>
    </button>
  );
}

/** A tournament, a match or a club event over its days. Club events are only shown. */
function Bar({ bar, onOpen, style }) {
  const own = bar.kind !== 'event';
  const sub = own ? (bar.kind === 'tournament' ? `Turnaus · ${eventRangeLabel(bar)}` : bar.sub) : `${kindLabel(bar.event.kind)} · ${eventRangeLabel(bar)}`;
  const inner = (
    <>
      <span className="wb-event-icon">
        {own ? <ActivityIcon activity={bar.kind === 'tournament' ? 'turnaus' : 'ottelu'} size={14} strokeWidth={2.2} /> : <Icon name={EVENT_ICON[bar.event.kind] || 'flag'} size={14} strokeWidth={2.2} />}
      </span>
      <span className="wb-event-text">
        <span className="wb-event-title">{bar.title}</span>
        <span className="wb-event-sub">{sub}</span>
      </span>
    </>
  );
  const cls = cx('wb-event', !own && 'pw-bar-club', bar.before && 'is-before', bar.after && 'is-after');
  if (!own) return <div className={cls} style={style} title={`${bar.title} · ${sub}`}>{inner}</div>;
  return (
    <button type="button" className={cls} style={style} onClick={() => onOpen(bar)} aria-label={`${bar.title} · ${sub}`} title={`${bar.title} · ${sub}`}>
      {inner}<Icon name="chevron-right" size={16} className="wb-event-go" />
    </button>
  );
}

export function TrainingsScreen({ query }) {
  const { state } = useData();
  const actions = usePlayerActions();
  const isDesktop = useIsDesktop();
  const nowMs = useNow(60_000);
  const now = new Date(nowMs);
  const student = state.students[0];
  const current = koutsiCurrentIsoWeek();
  const week = parseWeekParam(query.vko) || current;
  const isCurrent = koutsiCompareIsoWeeks(week, current) === 0;
  const setWeek = (w) => navigate(koutsiCompareIsoWeeks(w, current) === 0 ? BASE : `${BASE}?vko=${weekParam(w)}`, { replace: true });
  const today = koutsiTodayStr();
  const dates = weekDates(week);
  const board = useMemo(() => playerWeek(state, student, week, now), [state, student, week.year, week.week, Math.floor(nowMs / 60_000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const { grid, summary } = board;
  const relative = themeWeekRelative(week);

  const [sheet, setSheet] = useState(null); // { kind: 'coach' | 'own' | 'pick', item | training }
  const close = () => setSheet(null);
  const last = useRef({});
  if (sheet?.kind === 'coach') last.current.coach = sheet.item;
  if (sheet?.kind === 'own') last.current.own = sheet.training;
  const openItem = (item) => setSheet(item.kind === 'own' ? { kind: 'own', training: item.training } : { kind: 'coach', item });
  const openBar = (bar) => {
    if (bar.kind === 'tournament') setSheet({ kind: 'own', training: bar.training });
    else if (bar.kind === 'match') actions.openMatch({ editing: bar.note });
  };
  const logOn = (date, time) => actions.openSelfTraining(date, time ? { time } : undefined);
  const logHomework = (h) => actions.openSelfTraining(today, { activity: 'kotilaksy', homeworkId: h.id });

  // On a phone the days scroll sideways one at a time: open on today (or the week's first day
  // with something on it) and keep the strip above in step with the day in view.
  const daysRef = useRef(null);
  const [active, setActive] = useState(0);
  const startDay = Math.max(0, isCurrent ? dates.indexOf(today) : board.days.findIndex((d) => d.items.length));
  const scrollToDay = (i, smooth) => {
    const el = daysRef.current;
    const col = el?.children[i];
    if (!el || !col) return;
    el.scrollTo({ left: col.offsetLeft - el.children[0].offsetLeft, behavior: smooth ? 'smooth' : 'auto' });
    setActive(i);
  };
  useLayoutEffect(() => {
    if (!isDesktop) scrollToDay(startDay, false);
  }, [isDesktop, week.year, week.week]); // eslint-disable-line react-hooks/exhaustive-deps
  const frame = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = daysRef.current;
      if (!el || isDesktop) return;
      const step = el.children[1] ? el.children[1].offsetLeft - el.children[0].offsetLeft : el.clientWidth;
      setActive(Math.min(6, Math.max(0, Math.round(el.scrollLeft / step))));
    });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // A tap on empty time logs something then; with a mouse, a ghost shows where.
  const [ghost, setGhost] = useState(null); // { date, minute }
  // on the half hour: a tap is never that exact, and the time can be fine-tuned in the form
  const minuteFromEvent = (e) => {
    const el = e.currentTarget;
    const hourPx = parseFloat(getComputedStyle(el).getPropertyValue('--wb-hour')) || 64;
    return Math.floor(grid.minuteAt(e.clientY - el.getBoundingClientRect().top, hourPx) / 30) * 30;
  };
  const onDayClick = (date) => (e) => {
    if (e.target !== e.currentTarget) return;
    logOn(date, toHHMM(minuteFromEvent(e)));
  };
  const onDayMove = (date) => (e) => {
    if (!isDesktop) return;
    if (e.target !== e.currentTarget) { if (ghost) setGhost(null); return; }
    const minute = minuteFromEvent(e);
    if (!ghost || ghost.date !== date || ghost.minute !== minute) setGhost({ date, minute });
  };

  const hourLines = Array.from({ length: grid.hours + 1 }, (_, k) => grid.startH + k);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const showNow = isCurrent && nowMin >= grid.startH * 60 && nowMin <= grid.endH * 60;
  const columns = 'repeat(7, minmax(0, 1fr))';
  const bars = board.allDay.bars;
  const phoneBars = bars.filter((b) => b.from <= active && b.to >= active);
  const activeDay = board.days[active];
  const counts = [
    summary.coach ? plural(summary.coach, 'valmennus', 'valmennusta') : '',
    summary.own ? `${plural(summary.own, 'oma treeni', 'omaa treeniä')}${summary.ownMinutes ? ` (${minutesLabel(summary.ownMinutes)})` : ''}` : '',
    summary.matches ? plural(summary.matches, 'ottelu', 'ottelua') : '',
  ].filter(Boolean).join(' · ') || 'Ei vielä merkintöjä';
  const dayCount = (d) => {
    const own = d.items.filter((it) => it.kind === 'own').length;
    const coach = d.items.length - own;
    return [coach ? plural(coach, 'valmennus', 'valmennusta') : '', own ? plural(own, 'oma', 'omaa') : ''].filter(Boolean).join(' · ') || 'Ei merkintöjä';
  };

  return (
    <Page width="full" className="wb-page pw-page">
      <header className="wb-head">
        <div className="eyebrow wb-eyebrow">Treenit{relative ? ` · ${relative}` : ''}</div>
        <div className="wb-head-row">
          <div className="wb-week">
            <IconButton icon="chevron-left" label="Edellinen viikko" variant="soft" onClick={() => setWeek(koutsiAddIsoWeeks(week, -1))} />
            <h1 className="wb-title">Viikko {week.week}</h1>
            <IconButton icon="chevron-right" label="Seuraava viikko" variant="soft" onClick={() => setWeek(koutsiAddIsoWeeks(week, 1))} />
          </div>
          <div className="wb-meta">
            <button type="button" className="wb-range" onClick={() => setSheet({ kind: 'pick' })} aria-label={`${weekRangeLabel(week)} — valitse viikko`}>
              <span className="t-num">{weekRangeLabel(week)}</span><Icon name="chevron-down" size={14} />
            </button>
            <span className="wb-counts">{counts}</span>
          </div>
          {!isCurrent && <button type="button" className="wb-today-btn" onClick={() => setWeek(current)}>Tämä viikko</button>}
          <span className="wb-add-slot">
            <button type="button" className="wb-add" aria-label="Kirjaa oma treeni" title="Kirjaa oma treeni" onClick={() => logOn(isCurrent ? today : dates[0])}>
              <Icon name="plus" size={24} strokeWidth={2.4} />
            </button>
          </span>
        </div>
      </header>

      <Homework student={student} onLog={logHomework} />

      <div className="wb-strip" role="tablist" aria-label="Viikonpäivät">
        {board.days.map((d, i) => (
          <button key={d.date} type="button" role="tab" aria-selected={i === active} aria-label={`${DAY_LONG[i]} ${dayMonth(d.date)}`}
            className={cx('wb-strip-day', i === active && 'is-active', d.date === today && 'is-today')} onClick={() => scrollToDay(i, true)}>
            <span className="wb-strip-dow">{DAY_SHORT[i]}</span>
            <span className="wb-strip-num t-num">{Number(d.date.slice(8))}</span>
            <span className={cx('wb-strip-dot', d.items.some((it) => it.kind === 'own') ? 'has-own' : d.items.length > 0 && 'has-sessions')} aria-hidden="true" />
          </button>
        ))}
        {bars.map((b) => (
          <span key={b.key} className={cx('wb-strip-ev', b.before && 'is-before', b.after && 'is-after')} aria-hidden="true"
            style={{ gridColumn: `${b.from + 1} / ${b.to + 2}`, gridRow: b.row + 2 }} />
        ))}
      </div>

      <div className="wb-dayline">
        <h2 className="wb-dayline-title">{DAY_LONG[active]} <span className="t-num">{dayMonth(activeDay.date)}</span></h2>
        <span className="wb-dayline-sub">
          {activeDay.date === today && <span className="wb-dayline-today">Tänään</span>}
          {dayCount(activeDay)}
        </span>
      </div>

      <div className="wb-cal" style={{ '--wb-hours': grid.hours, '--wb-folds': 0 }}>
        <div className="wb-top">
          <div className="wb-heads" style={{ gridTemplateColumns: `var(--wb-axis) ${columns}` }}>
            <span className="wb-corner" aria-hidden="true" />
            {board.days.map((d, i) => (
              <div key={d.date} className={cx('wb-dayhead', d.date === today && 'is-today', d.date < today && 'is-past')}>
                <span className="wb-dayhead-dow">{DAY_SHORT[i]}</span>
                <span className="wb-dayhead-date t-num">{dayMonth(d.date)}</span>
              </div>
            ))}
          </div>
          {bars.length > 0 && (
            <div className="wb-allday" style={{ gridTemplateColumns: `var(--wb-axis) ${columns}` }}>
              {bars.map((b) => <Bar key={b.key} bar={b} onOpen={openBar} style={{ gridColumn: `${b.from + 2} / ${b.to + 3}`, gridRow: b.row + 1 }} />)}
            </div>
          )}
        </div>
        {phoneBars.length > 0 && (
          <div className="wb-allday-phone">
            {phoneBars.map((b) => <Bar key={b.key} bar={b} onOpen={openBar} />)}
          </div>
        )}

        <div className="wb-main">
          <div className="wb-axis" aria-hidden="true">
            {hourLines.map((h) => <span key={h} className="wb-axis-label t-num" style={{ top: y(grid.at(h * 60)) }}>{String(h).padStart(2, '0')}:00</span>)}
          </div>
          <div className="wb-area">
            <div className="wb-lines" aria-hidden="true">
              {hourLines.map((h) => <span key={h} className="wb-line" style={{ top: y(grid.at(h * 60)) }} />)}
            </div>
            <div className="wb-days" ref={daysRef} onScroll={onScroll} style={isDesktop ? { gridTemplateColumns: columns } : undefined}
              onMouseLeave={() => setGhost(null)}>
              {board.days.map((d, i) => (
                <section key={d.date} aria-label={`${DAY_LONG[i]} ${dayMonth(d.date)}`}
                  className={cx('wb-day', 'pw-day', d.date === today && 'is-today', d.date < today && 'is-past')}
                  onClick={onDayClick(d.date)} onMouseMove={onDayMove(d.date)}>
                  {d.items.length === 0 && (
                    <div className="wb-day-empty">
                      <button type="button" className="wb-day-add" onClick={() => logOn(d.date)} aria-label={`Kirjaa treeni: ${DAY_LONG[i]} ${dayMonth(d.date)}`}>
                        <Icon name="plus" size={15} strokeWidth={2.4} />Kirjaa treeni
                      </button>
                    </div>
                  )}
                  {ghost?.date === d.date && (
                    <span className="pw-ghost" style={{ top: y(grid.at(ghost.minute)), height: span(grid.at(ghost.minute), grid.at(Math.min(grid.endH * 60, ghost.minute + 60))) }} aria-hidden="true">
                      <Icon name="plus" size={13} strokeWidth={2.6} />Kirjaa klo {toHHMM(ghost.minute).replace(':', '.')}
                    </span>
                  )}
                  {d.items.map((it) => <Block key={it.key} item={it} grid={grid} onOpen={openItem} />)}
                  {showNow && d.date === today && <span className="wb-now" style={{ top: y(grid.at(nowMin)) }} aria-hidden="true" />}
                </section>
              ))}
            </div>
          </div>
        </div>
      </div>
      <p className="pw-foot k-faint"><Icon name="eye" size={14} /> Omat merkintäsi näkyvät kaikille valmentajillesi. Napauta tyhjää kohtaa kirjataksesi siihen aikaan.</p>

      <CoachSessionSheet open={sheet?.kind === 'coach'} item={last.current.coach} onClose={close} />
      <OwnEntrySheet open={sheet?.kind === 'own'} training={last.current.own} onClose={close} />
      <PlayerWeekPicker open={sheet?.kind === 'pick'} week={week} onClose={close} onPick={(date) => { close(); setWeek(koutsiIsoWeekOfDateStr(date)); }} />
    </Page>
  );
}
