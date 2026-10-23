// today.jsx — the coach's day as a timeline: on Koti every session today by time, each saying
// whether it is over (and who was there), running (and for how long still) or still to come, with
// a "Nyt" line between them. A tap on the name opens the group (a private lesson opens the session).
// EHDOTUS (haara koutsi-selkeys): the session on now or just over carries its attendance right
// on the card — everyone is there unless tapped away, a player's own "En pääse" is already marked
// — and "Viesti ryhmälle". Earlier sessions today fold to one line that opens the same list.
// Tomorrow's sessions follow in one line. A group's page shows its own session today the same way
// (GroupTodayCard).
import { useState } from 'react';
import { Link, navigate } from '../app/router.js';
import { Block, Quiet } from '../shared/bits.jsx';
import { Button, Icon, IconButton } from '../ui/index.js';
import { koutsiAddDays, koutsiFmtShortDate, koutsiPad, koutsiThemeForDate, koutsiTodayStr } from '../domain/core.js';
import { coachSessionsOn, JUST_ENDED_MINUTES, minutesLabel, todayTimeline } from '../domain/week.js';
import { AttendanceChips } from './attendance.jsx';
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
  if (it.status === 'past') return it.roster ? `Ohi · läsnä ${it.present}/${it.roster}` : 'Ohi';
  if (it.status === 'now') return `Käynnissä · ${minutesLabel(it.minutesLeft)} jäljellä${it.absent ? ` · ${it.absent} poissa` : ''}`;
  return [players(it.roster), it.minutesUntil <= 180 ? `alkaa ${minutesLabel(it.minutesUntil)} päästä` : '', it.absent ? `${it.absent} ilmoitti poissaolon` : ''].filter(Boolean).join(' · ');
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
            <IconButton icon="send" label={`Viesti: ${nameOf(it)}`} variant="soft" size="sm" className="tt-plus" onClick={viesti} />
          ))}
        </div>
        {showChips && <AttendanceChips training={it.training} />}
        {showChips && (
          <div className="tt-foot">
            <Button variant="lime" size="sm" icon="send" onClick={viesti}>{it.group ? 'Viesti ryhmälle' : 'Viesti pelaajalle'}</Button>
            <Button variant="ghost" size="sm" onClick={() => navigate(sessionPath(it.training.id))}>Avaa treeni</Button>
          </div>
        )}
      </div>
    </li>
  );
}

/** Koti's "Tänään": today's sessions on a timeline, then tomorrow's in one line. */
export function TodayTimeline({ state, now }) {
  const today = koutsiTodayStr();
  const items = todayTimeline(state, now);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  // On the card itself: what is on now and what ended within the last two hours.
  const open = new Set(items.filter((it) => it.status === 'now'
    || (it.status === 'past' && minutesNow - toMinutes(it.end) <= JUST_ENDED_MINUTES)).map((it) => it.training.id));
  const tomorrow = coachSessionsOn(state, koutsiAddDays(today, 1));
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
  const span = items.length ? `${items[0].training.time}–${items[items.length - 1].end}` : '';
  return (
    <Block eyebrow="Tänään" title={koutsiFmtShortDate(today)}
      action={items.length ? <span className="tt-summary">{items.length === 1 ? '1 treeni' : `${items.length} treeniä`} · <span className="t-num">{span}</span></span> : null}>
      {items.length === 0 ? <Quiet icon="calendar">Ei treenejä tänään.</Quiet> : (
        <ol className="tt-line">
          {items.flatMap((it, i) => [i === nowAt ? nowLine : null, <TimelineItem key={it.training.id} it={it} open={open.has(it.training.id)} now={now} />])}
          {nowAt === items.length && nowLine}
        </ol>
      )}
      {tomorrow.length > 0 && (
        <div className="tt-tomorrow">
          <span className="tt-tomorrow-label">Huomenna</span>
          {tomorrow.map((it) => (
            <Link key={it.training.id} to={targetOf(it)} state={tabOf(it)} className="tt-chip">
              <span className="t-num">{it.training.time}</span><span className="truncate">{nameOf(it)}</span>
            </Link>
          ))}
        </div>
      )}
    </Block>
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
        <Button variant={it.status === 'now' ? 'on-dark' : 'outline'} size="sm" icon="send" onClick={() => { track('ryhma.viesti'); record.openMerkinta({ trainingId: it.training.id }); }}>Viesti</Button>
      </div>
    </div>
  );
}
