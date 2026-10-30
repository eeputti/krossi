// BoardScreen — Viikkohallinta, the coach's week as a calendar (it replaced both the Ryhmät
// board and the Kalenteri tab). "Viikko 42" large with arrows, "Tämä viikko" beside them on any
// other week, the week's groups and sessions small next to it, and one plus button for
// everything new: a group, a session, an event, a theme, or many groups and players at once.
// Below, Monday to Sunday on a time grid — hour lines, times on the left — with every session
// as a block at its time: light lime when all is set, light clay with a warning sign when
// something is missing (no theme, no players, the calendar runs out), grey once held, dashed
// when a group's usual session is missing that week. Club events are dark bars over the days
// they cover, right under the day heads — kind, name and days in each. A tap on a block opens
// everything that can be done for that session. A phone shows one day at a time under a day
// strip (dark lines under the days an event covers), the day's name, and its events as cards.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../app/data.jsx';
import { useIsDesktop, useNow } from '../app/hooks.js';
import { navigate } from '../app/router.js';
import { Block } from '../shared/bits.jsx';
import { Button, EmptyState, Icon, IconButton, Page } from '../ui/index.js';
import {
  koutsiAddIsoWeeks, koutsiCompareIsoWeeks, koutsiCurrentIsoWeek, koutsiIsoWeekOfDateStr, koutsiTimeRangeLabel, koutsiTodayStr,
  KOUTSI_EVENT_KINDS,
} from '../domain/core.js';
import { parseWeekParam, themeWeekRelative, weekDates, weekParam, weekRangeLabel } from '../domain/week.js';
import { eventRangeLabel, weekBoard } from '../domain/board.js';
import { GroupRow } from './parts.jsx';
import { AddSheet, BoardItemSheet, WeekPickerSheet } from './boardSheets.jsx';
import { GroupFormSheet } from './groupForms.jsx';
import { BulkSetupSheet } from './BulkSetupSheet.jsx';
import { EVENT_ICON, EventSheet, TrainingSheet } from './trainingForms.jsx';
import { openPlanner, openSeason } from './nav.js';
import { track } from './usage.js';
import { AddOpenSlotsSheet, useOpenSlotTap, useOpenSlotsOn } from './openSlots.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const DAY_SHORT = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];
const DAY_LONG = ['Maanantai', 'Tiistai', 'Keskiviikko', 'Torstai', 'Perjantai', 'Lauantai', 'Sunnuntai'];
const MISSING = { none: 'Ei treenejä kalenterissa', week: 'Ei treeniä tällä viikolla', day: 'Ei treeniä tänä päivänä' };
const BASE = '/valmentaja/ryhmat';

export const dayMonth = (date) => `${Number(date.slice(8))}.${Number(date.slice(5, 7))}.`;
const kindLabel = (k) => KOUTSI_EVENT_KINDS.find((x) => x.value === k)?.label || 'Tapahtuma';
const plural = (n, one, many) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** A point on the grid: `calc(hours * hour height + folds * fold height)`. */
const y = ({ h, g }) => `calc(${h.toFixed(4)} * var(--wb-hour) + ${g} * var(--wb-fold))`;
const span = (a, b) => `calc(${(b.h - a.h).toFixed(4)} * var(--wb-hour) + ${b.g - a.g} * var(--wb-fold) - 3px)`;

export const itemName = (item) => (item.kind === 'open' ? 'Vapaa aika' : item.group?.name || item.student?.name || item.training?.type || 'Treeni');

/** One session on the grid. Its height is its length, so what shows inside adapts to it. */
function BoardBlock({ item, grid, onOpen }) {
  const { group, training, tone, issues, status, theme } = item;
  const top = grid.at(item.start);
  const bottom = grid.at(item.end);
  const style = {
    top: y(top), height: span(top, bottom),
    left: `calc(${(item.lane / item.lanes) * 100}% + 2px)`, width: `calc(${100 / item.lanes}% - 4px)`,
  };
  const name = itemName(item);
  const time = koutsiTimeRangeLabel(item.time, item.durationMinutes);
  const [from, to] = time.split('–');
  const missing = item.kind === 'missing';
  const label = [name, time, missing ? MISSING[item.why] : '', ...issues.map((i) => i.label), item.absent ? `${item.absent} poissa` : ''].filter(Boolean).join(', ');
  return (
    <button type="button" className={cx('wb-block', `is-${tone}`, missing && 'is-missing', status === 'now' && 'is-now', item.lanes > 1 && 'is-shared')}
      style={style} onClick={() => onOpen(item)} aria-label={label} title={label}>
      <span className="wb-b">
        <span className="wb-b-top">
          <span className="wb-b-time t-num">{from}{to && <span className="wb-b-end">–{to}</span>}</span>
          {issues.length > 0 && <Icon name="alert" size={14} strokeWidth={2.4} className="wb-b-alert" />}
          {status === 'now' && <span className="k-ctx-live wb-b-live" aria-hidden="true" />}
        </span>
        <span className="wb-b-name">{name}</span>
        {item.kind === 'open' ? (
          item.slot.place ? <span className="wb-b-meta"><span className="truncate">{item.slot.place}</span></span> : null
        ) : !missing && (
          <span className="wb-b-meta">
            {group ? (
              <><Icon name="users" size={12} /><span className="t-num">{item.members}</span>{group.level && <span className="wb-b-level">{group.level}</span>}</>
            ) : <span className="wb-b-level">{training?.type || 'Yksityistunti'}</span>}
            {item.absent > 0 && <span className="wb-b-absent">{item.absent} poissa</span>}
          </span>
        )}
        {missing ? (
          <span className="wb-b-line">{issues.length ? issues[0].label : MISSING[item.why]}</span>
        ) : issues.length > 0 ? (
          <span className="wb-b-line is-issue"><span className="wb-b-issue">{issues.map((i) => i.label).join(', ')}</span></span>
        ) : theme ? (
          <span className="wb-b-line is-theme"><Icon name="sparkles" size={12} /><span className="wb-b-theme">{theme.title}</span></span>
        ) : null}
      </span>
    </button>
  );
}

/** A club event: its kind's icon, its name, and its kind and days under it. */
function EventBar({ bar, onOpen, style }) {
  const { event } = bar;
  const label = `${event.title}, ${kindLabel(event.kind)}, ${eventRangeLabel(event)}`;
  return (
    <button type="button" className={cx('wb-event', bar.before && 'is-before', bar.after && 'is-after')} style={style}
      onClick={() => onOpen(event)} aria-label={`${label} — muokkaa`} title={label}>
      <span className="wb-event-icon"><Icon name={EVENT_ICON[event.kind] || 'flag'} size={14} strokeWidth={2.2} /></span>
      <span className="wb-event-text">
        <span className="wb-event-title">{event.title}</span>
        <span className="wb-event-sub">{kindLabel(event.kind)}<span className="wb-event-range">, <span className="t-num">{eventRangeLabel(event)}</span></span></span>
      </span>
      <Icon name="chevron-right" size={16} className="wb-event-go" />
    </button>
  );
}

// the phone's day in view, kept while the app is open (back from a session lands on the same day)
const lastBoardDay = { date: null };

export function BoardScreen({ query }) {
  const { state } = useData();
  const isDesktop = useIsDesktop();
  const nowMs = useNow(60_000);
  const now = new Date(nowMs);
  const current = koutsiCurrentIsoWeek();
  const week = parseWeekParam(query.vko) || current;
  const isCurrent = koutsiCompareIsoWeeks(week, current) === 0;
  const setWeek = (w) => navigate(koutsiCompareIsoWeeks(w, current) === 0 ? BASE : `${BASE}?vko=${weekParam(w)}`, { replace: true });
  const today = koutsiTodayStr();
  const dates = weekDates(week);
  // Vapaat ajat: the coach's free times are blocks of their own (when the feature is on)
  const slotsOn = useOpenSlotsOn();
  const tapSlot = useOpenSlotTap();
  const board = useMemo(() => weekBoard(state, week, now, { openSlots: slotsOn ? state.openSlots || [] : [] }), [state, week.year, week.week, Math.floor(nowMs / 60_000), slotsOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const openCount = board.days.reduce((n, d) => n + d.items.filter((it) => it.kind === 'open').length, 0);
  const relative = themeWeekRelative(week);
  const { grid } = board;

  // What is open: the plus menu, a block, the week picker, or one of the forms.
  const [sheet, setSheet] = useState(null); // { kind: 'add' | 'item' | 'pick' | 'group' | 'bulk' | 'training' | 'event', ... }
  const close = () => setSheet(null);
  const lastItem = useRef(null);
  if (sheet?.kind === 'item') lastItem.current = sheet.item;
  const openItem = (item) => {
    if (item.kind === 'open') { track('viikko.vapaa'); tapSlot(item.slot); return; }
    track('viikko.treeni'); setSheet({ kind: 'item', item });
  };
  const onAdd = (what) => {
    track(`viikko.lisaa-${what}`);
    if (what === 'teema') { close(); openPlanner({ week }); return; }
    if (what === 'kausi') { close(); openSeason(); return; }
    const defaultDate = isCurrent ? today : dates[0];
    if (what === 'vapaat') { setSheet({ kind: 'slots', date: defaultDate }); return; }
    setSheet(what === 'ryhma' ? { kind: 'group' } : what === 'monta' ? { kind: 'bulk' } : what === 'tapahtuma' ? { kind: 'event', date: defaultDate } : { kind: 'training', date: defaultDate });
  };

  // On a phone the days scroll sideways one at a time: open on today (or the week's first day
  // with sessions) and keep the strip above in step with the day in view.
  const daysRef = useRef(null);
  const [active, setActiveState] = useState(0);
  const setActive = (i) => { setActiveState(i); if (dates[i]) lastBoardDay.date = dates[i]; };
  // Koti's day strip links straight to a day (?pv=): the phone opens on it, a computer marks it.
  // Else the day you were on (back from a session lands there again), else today.
  const focusDate = query.pv && dates.includes(query.pv) ? query.pv : null;
  const remembered = dates.includes(lastBoardDay.date) ? lastBoardDay.date : null;
  const startDay = focusDate ? dates.indexOf(focusDate) : remembered ? dates.indexOf(remembered) : Math.max(0, isCurrent ? dates.indexOf(today) : board.days.findIndex((d) => d.items.length));
  const scrollToDay = (i, smooth) => {
    const el = daysRef.current;
    const col = el?.children[i];
    if (!el || !col) return;
    el.scrollTo({ left: col.offsetLeft - el.children[0].offsetLeft, behavior: smooth ? 'smooth' : 'auto' });
    setActive(i);
  };
  useLayoutEffect(() => {
    if (isDesktop) return;
    scrollToDay(startDay, false);
    // and down to what matters on that day: the now line, else its first session (the grid
    // starts early, and at 17:30 the running session sat below the tab bar)
    // (after the page's own scroll restore, which runs after this effect)
    const raf = requestAnimationFrame(() => {
      if (window.scrollY > 40) return; // coming back to a scrolled page: keep it
      const col = daysRef.current?.children[startDay];
      const target = col?.querySelector('.wb-now') || col?.querySelector('.wb-block');
      if (!target) return;
      const top = target.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.3;
      if (top > 0) window.scrollTo({ top, behavior: 'auto' });
    });
    return () => cancelAnimationFrame(raf);
  }, [isDesktop, week.year, week.week, focusDate]); // eslint-disable-line react-hooks/exhaustive-deps
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

  const sheets = (
    <>
      <AddSheet open={sheet?.kind === 'add'} onClose={close} onPick={onAdd} week={week} slots={slotsOn} />
      <AddOpenSlotsSheet open={sheet?.kind === 'slots'} defaultDate={sheet?.date} onClose={close} />
      <BoardItemSheet open={sheet?.kind === 'item'} item={lastItem.current} week={week} onClose={close} />
      <WeekPickerSheet open={sheet?.kind === 'pick'} week={week} onClose={close} onPick={(date) => { close(); lastBoardDay.date = date; setWeek(koutsiIsoWeekOfDateStr(date)); }} />
      <GroupFormSheet open={sheet?.kind === 'group'} onClose={close} />
      <BulkSetupSheet open={sheet?.kind === 'bulk'} onClose={close} />
      <TrainingSheet open={sheet?.kind === 'training'} defaultDate={sheet?.date} onClose={close} />
      <EventSheet open={sheet?.kind === 'event'} editing={sheet?.editing} defaultDate={sheet?.date} onClose={close} />
    </>
  );
  const addButton = (
    <button type="button" className="wb-add" aria-label="Lisää ryhmä, treeni, tapahtuma tai teema" title="Lisää" onClick={() => { track('viikko.lisaa'); setSheet({ kind: 'add' }); }}>
      <Icon name="plus" size={24} strokeWidth={2.4} />
    </button>
  );

  // Only a coach with nothing at all gets the "first group" page: a coach with private lessons
  // but no groups must still be able to step to the weeks that have sessions.
  const hasOwnSessions = (state.trainings || []).some((t) => t.loggedBy !== 'player');
  if (state.groups.length === 0 && !hasOwnSessions && board.sessions === 0 && board.events.bars.length === 0 && openCount === 0) {
    return (
      <Page>
        <header className="wb-head">
          <div className="wb-head-row is-empty"><h1 className="wb-title">Viikkohallinta</h1>{addButton}</div>
        </header>
        <EmptyState art="calendar" title="Luo ensimmäinen ryhmä" text="Ryhmän viikoittaiset treenit ilmestyvät tähän viikkonäkymään, ja voit asettaa niille viikon teeman."
          action={<><Button variant="dark" icon="plus" onClick={() => setSheet({ kind: 'group' })}>Luo ryhmä</Button><Button variant="outline" icon="list" onClick={() => setSheet({ kind: 'bulk' })}>Lisää monta kerralla</Button></>} />
        {sheets}
      </Page>
    );
  }

  // On a wide screen a day with nothing on it takes less room than a busy one.
  const columns = board.days.map((d, i) => `minmax(0, ${d.items.length || board.events.bars.some((b) => b.from <= i && b.to >= i) ? 1 : 0.6}fr)`).join(' ');
  const hourLines = grid.rows.flatMap((r) => (r.type === 'hours' ? Array.from({ length: r.to - r.from + 1 }, (_, k) => r.from + k) : []))
    .filter((h, i, all) => all.indexOf(h) === i);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const showNow = isCurrent && nowMin >= grid.startH * 60 && nowMin <= grid.endH * 60;
  const gridStyle = { '--wb-hours': grid.hours, '--wb-folds': grid.folds };
  const phoneEvents = board.events.bars.filter((b) => b.from <= active && b.to >= active);
  const activeDay = board.days[active];
  const activeSessions = activeDay.items.filter((it) => it.training).length;
  const activeOpen = activeDay.items.filter((it) => it.kind === 'open').length;
  const openEvent = (event) => setSheet({ kind: 'event', editing: event });
  const addOn = (date) => { track('viikko.lisaa-treeni'); setSheet({ kind: 'training', date }); };
  return (
    <Page width="full" className="wb-page">
      <header className="wb-head">
        <div className="eyebrow wb-eyebrow">Viikkohallinta{relative ? `, ${relative}` : ''}</div>
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
            <span className="wb-counts">{plural(state.groups.length, 'ryhmä', 'ryhmää')}, {plural(board.sessions, 'treeni', 'treeniä')}{openCount > 0 && `, ${plural(openCount, 'vapaa aika', 'vapaata aikaa')}`}</span>
          </div>
          {!isCurrent && <button type="button" className="wb-today-btn" onClick={() => setWeek(current)}>Tämä viikko</button>}
          <span className="wb-add-slot">{addButton}</span>
        </div>
      </header>

      <div className="wb-strip" role="tablist" aria-label="Viikonpäivät">
        {board.days.map((d, i) => (
          <button key={d.date} type="button" role="tab" aria-selected={i === active} aria-label={`${DAY_LONG[i]} ${dayMonth(d.date)}`}
            className={cx('wb-strip-day', i === active && 'is-active', d.date === today && 'is-today')} onClick={() => scrollToDay(i, true)}>
            <span className="wb-strip-dow">{DAY_SHORT[i]}</span>
            <span className="wb-strip-num t-num">{Number(d.date.slice(8))}</span>
            <span className={cx('wb-strip-dot', d.items.some((it) => it.tone === 'issue') ? 'has-issue' : d.items.some((it) => it.training) ? 'has-sessions' : d.items.some((it) => it.kind === 'open') && 'has-open')} aria-hidden="true" />
          </button>
        ))}
        {board.events.bars.map((b) => (
          <span key={b.event.id} className={cx('wb-strip-ev', b.before && 'is-before', b.after && 'is-after')} aria-hidden="true"
            style={{ gridColumn: `${b.from + 1} / ${b.to + 2}`, gridRow: b.row + 2 }} />
        ))}
      </div>

      <div className="wb-dayline">
        <h2 className="wb-dayline-title">{DAY_LONG[active]} <span className="t-num">{dayMonth(activeDay.date)}</span></h2>
        <span className="wb-dayline-sub">
          {activeDay.date === today && <span className="wb-dayline-today">Tänään</span>}
          {activeSessions ? plural(activeSessions, 'treeni', 'treeniä') : 'Ei treenejä'}{activeOpen > 0 && `, ${plural(activeOpen, 'vapaa aika', 'vapaata aikaa')}`}
        </span>
      </div>

      <div className="wb-cal" style={gridStyle}>
        <div className="wb-top">
          <div className="wb-heads" style={{ gridTemplateColumns: `var(--wb-axis) ${columns}` }}>
            <span className="wb-corner" aria-hidden="true" />
            {board.days.map((d, i) => (
              <div key={d.date} className={cx('wb-dayhead', d.date === today && 'is-today', d.date < today && 'is-past', d.date === focusDate && 'is-focus')}>
                <span className="wb-dayhead-dow">{DAY_SHORT[i]}</span>
                <span className="wb-dayhead-date t-num">{dayMonth(d.date)}</span>
              </div>
            ))}
          </div>
          {board.events.bars.length > 0 && (
            <div className="wb-allday" style={{ gridTemplateColumns: `var(--wb-axis) ${columns}` }}>
              {board.events.bars.map((b) => (
                <EventBar key={b.event.id} bar={b} onOpen={openEvent} style={{ gridColumn: `${b.from + 2} / ${b.to + 3}`, gridRow: b.row + 1 }} />
              ))}
            </div>
          )}
        </div>
        {phoneEvents.length > 0 && (
          <div className="wb-allday-phone">
            {phoneEvents.map((b) => <EventBar key={b.event.id} bar={b} onOpen={openEvent} />)}
          </div>
        )}

        <div className="wb-main">
          <div className="wb-axis" aria-hidden="true">
            {hourLines.map((h) => <span key={h} className="wb-axis-label t-num" style={{ top: y(grid.at(h * 60)) }}>{String(h).padStart(2, '0')}:00</span>)}
            {grid.rows.filter((r) => r.type === 'fold').map((r) => (
              <span key={`f${r.from}`} className="wb-axis-fold" style={{ top: y(grid.at(r.from * 60)) }}>…</span>
            ))}
          </div>
          <div className="wb-area">
            <div className="wb-lines" aria-hidden="true">
              {hourLines.map((h) => <span key={h} className="wb-line" style={{ top: y(grid.at(h * 60)) }} />)}
              {grid.rows.filter((r) => r.type === 'fold').map((r) => (
                <span key={`f${r.from}`} className="wb-fold" style={{ top: y(grid.at(r.from * 60)) }} title={`${r.from}–${r.to} ei treenejä`} />
              ))}
            </div>
            <div className="wb-days" ref={daysRef} onScroll={onScroll} style={isDesktop ? { gridTemplateColumns: columns } : undefined}>
              {board.days.map((d, i) => (
                <section key={d.date} aria-label={`${DAY_LONG[i]} ${dayMonth(d.date)}`}
                  className={cx('wb-day', d.date === today && 'is-today', d.date < today && 'is-past', d.date === focusDate && 'is-focus')}>
                  {d.items.length === 0 && (
                    <div className="wb-day-empty">
                      <span className="wb-day-empty-text">Ei treenejä</span>
                      {d.date >= today && (
                        <button type="button" className="wb-day-add" onClick={() => addOn(d.date)} aria-label={`Lisää treeni: ${DAY_LONG[i]} ${dayMonth(d.date)}`}>
                          <Icon name="plus" size={15} strokeWidth={2.4} />Lisää treeni
                        </button>
                      )}
                    </div>
                  )}
                  {d.items.map((it) => <BoardBlock key={it.key} item={it} grid={grid} onOpen={openItem} />)}
                  {showNow && d.date === today && <span className="wb-now" style={{ top: y(grid.at(nowMin)) }} aria-hidden="true" />}
                </section>
              ))}
            </div>
          </div>
        </div>
      </div>

      {board.loose.length > 0 && (
        <Block eyebrow="Ilman viikkopäivää" title={plural(board.loose.length, 'ryhmä', 'ryhmää')} className="wb-loose">
          <div className="k-list">{board.loose.map((g) => <GroupRow key={g.id} group={g} week={week} />)}</div>
        </Block>
      )}
      {sheets}
    </Page>
  );
}
