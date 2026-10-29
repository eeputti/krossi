// today.jsx — the coach's day as a timeline: on Koti every session today by time, each saying
// whether it is over (and who was there), running (and for how long still) or still to come, with
// a "Nyt" line between them. A tap on the name opens the group (a private lesson opens the session).
// EHDOTUS (haara koutsi-selkeys): the session on now or just over carries its attendance right
// on the card — everyone is there unless tapped away, a player's own "En pääse" is already marked
// — and "Viesti ryhmälle". Earlier sessions today fold to one line that opens the same list.
// Tomorrow's sessions follow the same way under "Huomenna", each with Läsnäolo (who won't come),
// Runko (the session's plan) and Teema (the group's theme for that week) one tap away. A group's
// page shows its own session today the same way (GroupTodayCard).
import { useState } from 'react';
import { Link, navigate } from '../app/router.js';
import { Block, Quiet } from '../shared/bits.jsx';
import { Button, Icon, IconButton } from '../ui/index.js';
import {
  koutsiAddDays, koutsiFmtShortDate, koutsiIsoWeekOfDateStr, koutsiPad, koutsiThemeForDate, koutsiTodayStr,
} from '../domain/core.js';
import { dayTimeline, JUST_ENDED_MINUTES, minutesLabel, todayTimeline } from '../domain/week.js';
import { planSummary, readPlan } from '../domain/plan.js';
import { AttendanceChips } from './attendance.jsx';
import { GroupThemeSheet } from './GroupThemeSheet.jsx';
import { groupPath, sessionPath } from './nav.js';
import { useRecord } from './merkitse.jsx';
import { track } from './usage.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const players = (n) => (n === 1 ? '1 pelaaja' : `${n} pelaajaa`);
const nameOf = (it) => it.group?.name || it.student?.name || it.training.type;
const targetOf = (it) => (it.group ? groupPath(it.group.id) : sessionPath(it.training.id));
// A group opened from here lights Ryhmät (Koti stays one back-tap away).
const tabOf = (it) => (it.group ? { tab: 'ryhmat' } : undefined);
const toMinutes = (hhmm) => { const [h, m] = String(hhmm || '00:00').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

/** "Ohi · läsnä 5/6", "Käynnissä · 25 min jäljellä", "4 pelaajaa · alkaa 1 h päästä". */
export function sessionStateText(it) {
  if (it.status === 'past') return it.roster ? `Ohi, läsnä ${it.present}/${it.roster}` : 'Ohi';
  if (it.status === 'now') return `Käynnissä, ${minutesLabel(it.minutesLeft)} jäljellä${it.absent ? `, ${it.absent} poissa` : ''}`;
  return [players(it.roster), it.minutesUntil != null && it.minutesUntil <= 180 ? `alkaa ${minutesLabel(it.minutesUntil)} päästä` : '', it.absent ? `${it.absent} ei pääse` : ''].filter(Boolean).join(', ');
}

function TimelineItem({ it, open, now }) {
  const record = useRecord();
  const [expanded, setExpanded] = useState(false);
  const theme = it.group ? koutsiThemeForDate(it.group, it.training.date) : null;
  const viesti = () => { track('koti.viesti'); record.openMerkinta({ trainingId: it.training.id }); };
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const ago = it.status === 'past' ? minutesNow - toMinutes(it.end) : null;
  const state = open && it.status === 'past' ? `Päättyi ${minutesLabel(ago)} sitten` : sessionStateText(it);
  const showChips = open || expanded;
  return (
    <li className={cx('tt-item', `is-${it.status}`, open && 'is-highlight')}>
      <span className="tt-dot" aria-hidden="true">{it.status === 'past' && <Icon name="check" size={11} strokeWidth={3} />}</span>
      <div className={cx('tt-card', showChips && 'is-open')}>
        <div className="tt-row">
          <Link to={targetOf(it)} state={tabOf(it)} className="tt-main">
            <span className="tt-time t-num">{it.training.time}–{it.end}</span>
            <span className="tt-name">{nameOf(it)}</span>
            <span className="tt-state">{it.status === 'now' && <span className="k-ctx-live" aria-hidden="true" />}{state}</span>
            {theme && <span className="tt-theme"><Icon name="sparkles" size={13} />{theme.title}</span>}
            {it.status === 'now' && <span className="tt-progress" aria-hidden="true"><span style={{ width: `${Math.round(it.progress * 100)}%` }} /></span>}
          </Link>
          {!showChips && (it.status === 'past' ? (
            <Button variant="outline" size="sm" icon="user-check" onClick={() => setExpanded(true)}>Läsnäolo</Button>
          ) : (
            <IconButton icon="plus" label={`Merkitse: ${nameOf(it)}`} variant="soft" size="sm" className="tt-plus" onClick={viesti} />
          ))}
        </div>
        {showChips && <AttendanceChips training={it.training} />}
        {showChips && (
          <div className="tt-foot">
            <Button variant="lime" size="sm" icon="plus" onClick={viesti}>{it.group ? 'Merkitse ryhmälle' : 'Merkitse pelaajalle'}</Button>
            <Button variant="ghost" size="sm" onClick={() => navigate(sessionPath(it.training.id))}>Avaa treeni</Button>
            {expanded && !open && <Button variant="ghost" size="sm" icon="chevron-up" onClick={() => setExpanded(false)}>Piilota</Button>}
          </div>
        )}
      </div>
    </li>
  );
}

/** "5 treeniä · 12:00–20:15" next to a day's title. */
function DaySummary({ items }) {
  if (!items.length) return null;
  return (
    <span className="tt-summary">{items.length === 1 ? '1 treeni' : `${items.length} treeniä`} klo <span className="t-num">{items[0].training.time}–{items[items.length - 1].end}</span></span>
  );
}

/** One of tomorrow's sessions: who is coming, its plan and theme, each one tap away. */
function ComingItem({ it, onTheme }) {
  const [attendance, setAttendance] = useState(false);
  const theme = it.group ? koutsiThemeForDate(it.group, it.training.date) : null;
  const plan = readPlan(it.training.notes);
  const toggle = () => { track(attendance ? 'koti.huomenna-piilota' : 'koti.huomenna-lasnaolo'); setAttendance(!attendance); };
  const runko = () => { track('koti.huomenna-runko'); navigate(`${sessionPath(it.training.id)}?runko=1`); };
  const teema = () => { track('koti.huomenna-teema'); onTheme(it.group, koutsiIsoWeekOfDateStr(it.training.date)); };
  return (
    <li className="tt-item is-upcoming is-coming">
      <span className="tt-dot" aria-hidden="true" />
      <div className={cx('tt-card', attendance && 'is-open')}>
        <div className="tt-row">
          <Link to={targetOf(it)} state={tabOf(it)} className="tt-main">
            <span className="tt-time t-num">{it.training.time}–{it.end}</span>
            <span className="tt-name">{nameOf(it)}</span>
            <span className="tt-state">{sessionStateText(it)}</span>
            {theme && <span className="tt-theme"><Icon name="sparkles" size={13} />{theme.title}</span>}
            {plan.items.length > 0 && <span className="tt-plan"><Icon name="list" size={13} />Runko: {planSummary(plan)}</span>}
          </Link>
          <div className="tt-actions">
            <Button variant={attendance ? 'dark' : 'outline'} size="sm" icon="user-check" aria-expanded={attendance} onClick={toggle}>Läsnäolo</Button>
            <Button variant="outline" size="sm" icon="list" onClick={runko}>Runko</Button>
            {it.group && <Button variant="outline" size="sm" icon="sparkles" onClick={teema}>Teema</Button>}
          </div>
        </div>
        {attendance && <AttendanceChips training={it.training} source="koti.huomenna" countLabel="Tulossa" awayLabel="Ei pääse" hint="Napauta, kuka ei pääse" />}
      </div>
    </li>
  );
}

/** Koti's "Huomenna": tomorrow's sessions the same way as today's. */
function TomorrowTimeline({ state, now }) {
  const tomorrow = koutsiAddDays(koutsiTodayStr(), 1);
  const items = dayTimeline(state, tomorrow, now);
  const [themeFor, setThemeFor] = useState(null); // { group, week }
  if (!items.length) return null;
  return (
    <Block eyebrow="Huomenna" title={koutsiFmtShortDate(tomorrow)} action={<DaySummary items={items} />}>
      <ol className="tt-line">
        {items.map((it) => <ComingItem key={it.training.id} it={it} onTheme={(group, week) => setThemeFor({ group, week })} />)}
      </ol>
      <GroupThemeSheet open={Boolean(themeFor)} group={themeFor?.group} week={themeFor?.week} onClose={() => setThemeFor(null)} />
    </Block>
  );
}

/** Koti's "Tänään": today's sessions on a timeline, then tomorrow's the same way. */
export function TodayTimeline({ state, now }) {
  const today = koutsiTodayStr();
  const items = todayTimeline(state, now);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  // On the card itself: what is on now and what ended within the last two hours.
  const open = new Set(items.filter((it) => it.status === 'now'
    || (it.status === 'past' && minutesNow - toMinutes(it.end) <= JUST_ENDED_MINUTES)).map((it) => it.training.id));
  // The "Nyt" line goes before the first session still to come (after the last, once all are
  // over); while a session runs, its own card says so.
  const running = items.some((it) => it.status === 'now');
  const nextIdx = items.findIndex((it) => it.status === 'upcoming');
  const nowAt = running || !items.length ? -1 : nextIdx === -1 ? items.length : nextIdx;
  const nowLine = (
    <li key="nyt" className="tt-now" aria-label="Nyt">
      <span className="tt-now-label t-num">Nyt {koutsiPad(now.getHours())}:{koutsiPad(now.getMinutes())}</span>
    </li>
  );
  return (
    <>
      <Block eyebrow="Tänään" title={koutsiFmtShortDate(today)} action={<DaySummary items={items} />}>
        {items.length === 0 ? <Quiet icon="calendar">Ei treenejä tänään.</Quiet> : (
          <ol className="tt-line">
            {items.flatMap((it, i) => [i === nowAt ? nowLine : null, <TimelineItem key={it.training.id} it={it} open={open.has(it.training.id)} now={now} />])}
            {nowAt === items.length && nowLine}
          </ol>
        )}
      </Block>
      <TomorrowTimeline state={state} now={now} />
    </>
  );
}

/** On a group's page: its session today, with Läsnäolo and Viesti one tap away. */
export function GroupTodayCard({ state, group, now }) {
  const record = useRecord();
  const mine = todayTimeline(state, now).filter((it) => it.training.groupId === group.id);
  const it = mine.find((x) => x.status !== 'past') || mine[mine.length - 1];
  if (!it) return null;
  return (
    <div className={cx('tt-group-today', `is-${it.status}`)}>
      <div className="tt-group-today-text">
        <span className="tt-group-today-eyebrow">{it.status === 'now' && <span className="k-ctx-live" aria-hidden="true" />}Tänään klo <span className="t-num">{it.training.time}–{it.end}</span></span>
        <span className="tt-group-today-state">{sessionStateText(it)}</span>
        {it.status === 'now' && <span className="tt-progress" aria-hidden="true"><span style={{ width: `${Math.round(it.progress * 100)}%` }} /></span>}
      </div>
      <div className="tt-actions">
        <Button variant={it.status === 'now' ? 'lime' : 'dark'} size="sm" icon="user-check" onClick={() => navigate(sessionPath(it.training.id))}>Läsnäolo</Button>
        <Button variant={it.status === 'now' ? 'on-dark' : 'outline'} size="sm" icon="plus" onClick={() => { track('ryhma.viesti'); record.openMerkinta({ trainingId: it.training.id }); }}>Merkitse</Button>
      </div>
    </div>
  );
}
