// GroupsScreen — the coach's groups as a week board: "Viikko 42" large at the top with arrows to
// other weeks, then Monday to Sunday side by side across the screen (a phone swipes one day at a
// time, with a day strip to jump), each day's groups by time with that week's theme. The board
// shows the calendar's real sessions, so a moved session sits on its new day and a group whose
// session is missing that week stays in place, faded, instead of disappearing.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../app/data.jsx';
import { useIsDesktop, useNow } from '../app/hooks.js';
import { Link, navigate } from '../app/router.js';
import { Block } from '../shared/bits.jsx';
import { Button, EmptyState, Icon, IconButton, Page } from '../ui/index.js';
import {
  koutsiAddIsoWeeks, koutsiCompareIsoWeeks, koutsiCurrentIsoWeek, koutsiGroupThemeForWeek, koutsiTimeRangeLabel,
  koutsiTodayStr, koutsiWeekThemeStatus,
} from '../domain/core.js';
import { groupWeekBoard, parseWeekParam, sessionStatus, themeWeekRelative, weekDates, weekParam } from '../domain/week.js';
import { GroupRow } from './parts.jsx';
import { groupPath, openPlanner } from './nav.js';
import { GroupFormSheet } from './groupForms.jsx';
import { BulkSetupSheet } from './BulkSetupSheet.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const DAY_SHORT = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];
const DAY_LONG = ['Maanantai', 'Tiistai', 'Keskiviikko', 'Torstai', 'Perjantai', 'Lauantai', 'Sunnuntai'];
const MISSING = { none: 'Ei treenejä kalenterissa', week: 'Ei treeniä tällä viikolla', day: 'Ei treeniä tänä päivänä' };

const dayMonth = (date) => `${Number(date.slice(8))}.${Number(date.slice(5, 7))}.`;

/** "12.–18.10.2026", or "28.9.–4.10.2026" across a month. */
function weekRange(dates) {
  const [a, b] = [dates[0], dates[6]];
  const year = b.slice(0, 4);
  return a.slice(5, 7) === b.slice(5, 7) ? `${Number(a.slice(8))}.–${dayMonth(b)}${year}` : `${dayMonth(a)}–${dayMonth(b)}${year}`;
}

/** One group on one day: its time that day, name, players and the week's theme. */
function BoardCard({ item, week, now }) {
  const { group, training, missing, why } = item;
  const theme = missing ? null : koutsiGroupThemeForWeek(group, week);
  const status = training ? sessionStatus(training, group, now) : null;
  const absent = training ? (training.absences || []).length : 0;
  return (
    <Link to={groupPath(group.id)} className={cx('gb-card', missing && 'is-missing', status && `is-${status}`)}>
      <span className="gb-card-time t-num">{koutsiTimeRangeLabel(item.time, item.durationMinutes)}</span>
      <span className="gb-card-name">{group.name}</span>
      <span className="gb-card-meta">
        <Icon name="users" size={13} />{group.memberIds.length}{group.level ? ` · ${group.level}` : ''}
      </span>
      {missing ? <span className="gb-card-note">{MISSING[why]}</span> : (
        <span className={cx('gb-card-theme', theme ? 'has-theme' : 'no-theme')}>
          {theme ? <><Icon name="sparkles" size={13} /><span className="gb-card-theme-text">{theme.title}</span></> : 'Ei teemaa'}
        </span>
      )}
      {status === 'now' && <span className="gb-card-live"><span className="k-ctx-live" aria-hidden="true" />Käynnissä</span>}
      {status !== 'now' && absent > 0 && <span className="gb-card-absent">{absent} poissa</span>}
    </Link>
  );
}

export function GroupsScreen({ query }) {
  const { state } = useData();
  const isDesktop = useIsDesktop();
  const nowMs = useNow(60_000);
  const now = new Date(nowMs);
  const [formOpen, setFormOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const current = koutsiCurrentIsoWeek();
  const week = parseWeekParam(query.vko) || current;
  const isCurrent = koutsiCompareIsoWeeks(week, current) === 0;
  const setWeek = (w) => navigate(koutsiCompareIsoWeeks(w, current) === 0 ? '/valmentaja/ryhmat' : `/valmentaja/ryhmat?vko=${weekParam(w)}`, { replace: true });
  const today = koutsiTodayStr();
  const dates = weekDates(week);
  const board = useMemo(() => groupWeekBoard(state, week), [state, week.year, week.week]); // eslint-disable-line react-hooks/exhaustive-deps
  const status = koutsiWeekThemeStatus(state.groups, state.trainings, week);
  const relative = themeWeekRelative(week);

  // On a phone the days scroll sideways one at a time: open on today (or the week's first day
  // with groups) and keep the strip above in step with the day in view.
  const boardRef = useRef(null);
  const [active, setActive] = useState(0);
  const startDay = Math.max(0, isCurrent ? dates.indexOf(today) : board.days.findIndex((d) => d.items.length));
  const scrollToDay = (i, smooth) => {
    const el = boardRef.current;
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
      const el = boardRef.current;
      if (!el || isDesktop) return;
      const step = el.children[1] ? el.children[1].offsetLeft - el.children[0].offsetLeft : el.clientWidth;
      setActive(Math.min(6, Math.max(0, Math.round(el.scrollLeft / step))));
    });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  if (state.groups.length === 0) {
    return (
      <Page>
        <div className="gb-head"><div className="gb-week-text"><h1 className="page-title">Ryhmät</h1></div></div>
        <EmptyState art="players" title="Luo ensimmäinen ryhmä" text="Ryhmän viikoittaiset treenit ilmestyvät kalenteriin, ja voit asettaa niille viikon teeman."
          action={<><Button variant="dark" icon="plus" onClick={() => setFormOpen(true)}>Luo ryhmä</Button><Button variant="outline" icon="list" onClick={() => setBulkOpen(true)}>Lisää monta kerralla</Button></>} />
        <GroupFormSheet open={formOpen} onClose={() => setFormOpen(false)} />
        <BulkSetupSheet open={bulkOpen} onClose={() => setBulkOpen(false)} />
      </Page>
    );
  }

  // On a wide screen a day with no groups this week takes less room than a busy one.
  const columns = board.days.map((d) => `minmax(0, ${d.items.length ? 1 : 0.6}fr)`).join(' ');
  const sessions = board.days.reduce((n, d) => n + d.items.filter((it) => !it.missing).length, 0);
  return (
    <Page width="full" className="gb-page">
      <header className="gb-head">
        <div className="gb-week">
          <IconButton icon="chevron-left" label="Edellinen viikko" variant="soft" onClick={() => setWeek(koutsiAddIsoWeeks(week, -1))} />
          <div className="gb-week-text">
            <div className="eyebrow">Ryhmät{relative ? ` · ${relative}` : ''}</div>
            <h1 className="gb-week-title">Viikko {week.week}</h1>
            <div className="gb-week-range">{weekRange(dates)}</div>
            {!isCurrent && <button type="button" className="k-textlink gb-back" onClick={() => setWeek(current)}>Takaisin tähän viikkoon</button>}
          </div>
          <IconButton icon="chevron-right" label="Seuraava viikko" variant="soft" onClick={() => setWeek(koutsiAddIsoWeeks(week, 1))} />
        </div>
        <div className="gb-actions">
          <Button variant="outline" size="sm" icon="sparkles" onClick={() => openPlanner({ week })}>Teemat</Button>
          <Button variant="dark" size="sm" icon="plus" onClick={() => setFormOpen(true)}>Uusi ryhmä</Button>
        </div>
      </header>
      <p className="gb-sub">
        {state.groups.length} ryhmää · {sessions === 1 ? '1 treeni' : `${sessions} treeniä`} · teema {status.covered}/{status.pool.length} ryhmällä
      </p>

      <div className="gb-strip" role="tablist" aria-label="Viikonpäivät">
        {board.days.map((d, i) => (
          <button key={d.date} type="button" role="tab" aria-selected={i === active} aria-label={`${DAY_LONG[i]} ${dayMonth(d.date)}`}
            className={cx('gb-strip-day', i === active && 'is-active', d.date === today && 'is-today')} onClick={() => scrollToDay(i, true)}>
            <span className="gb-strip-dow">{DAY_SHORT[i]}</span>
            <span className="gb-strip-num t-num">{Number(d.date.slice(8))}</span>
            <span className={cx('gb-strip-dot', d.items.some((it) => !it.missing) && 'has-groups')} aria-hidden="true" />
          </button>
        ))}
      </div>

      <div className="gb-board" ref={boardRef} onScroll={onScroll} style={isDesktop ? { gridTemplateColumns: columns } : undefined}>
        {board.days.map((d, i) => (
          <section key={d.date} className={cx('gb-day', d.date === today && 'is-today', d.date < today && 'is-past', !d.items.length && 'is-empty')}>
            <header className="gb-day-head">
              <span className="gb-day-name"><span className="gb-day-short">{DAY_SHORT[i]}</span><span className="gb-day-long">{DAY_LONG[i]}</span></span>
              <span className="gb-day-date t-num">{dayMonth(d.date)}</span>
              {d.date === today && <span className="gb-today">Tänään</span>}
            </header>
            {d.items.length === 0 ? <p className="gb-empty">Ei ryhmiä</p> : (
              <div className="gb-day-list">
                {d.items.map((it) => <BoardCard key={`${it.group.id}-${it.training?.id || it.time}`} item={it} week={week} now={now} />)}
              </div>
            )}
          </section>
        ))}
      </div>

      {board.loose.length > 0 && (
        <Block eyebrow="Ilman viikkopäivää" title={board.loose.length === 1 ? '1 ryhmä' : `${board.loose.length} ryhmää`} className="gb-loose">
          <div className="k-list">{board.loose.map((g) => <GroupRow key={g.id} group={g} week={week} />)}</div>
        </Block>
      )}
      <Button variant="ghost" icon="list" className="gb-bulk" onClick={() => setBulkOpen(true)}>Lisää monta ryhmää ja pelaajaa kerralla</Button>
      <GroupFormSheet open={formOpen} onClose={() => setFormOpen(false)} />
      <BulkSetupSheet open={bulkOpen} onClose={() => setBulkOpen(false)} />
    </Page>
  );
}
