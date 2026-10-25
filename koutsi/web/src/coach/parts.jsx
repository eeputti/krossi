// parts.jsx — rows and lines the coach screens share.
import { Link } from '../app/router.js';
import { Avatar, Chip, Icon } from '../ui/index.js';
import {
  koutsiThemeForDate, koutsiTimeRangeLabel, koutsiGroupThemeForWeek,
} from '../domain/core.js';
import { relativeDay, sessionStatus } from '../domain/week.js';
import { ownEntry } from '../domain/ownWeek.js';
import { MOOD_LABELS } from '../lib/constants.js';
import { groupPath, playerPath, sessionPath } from './nav.js';

const cx = (...c) => c.filter(Boolean).join(' ');

/** "Ti 17:00–18:30 · Keskitaso" — enough to tell four "tiistai aikuiset" apart. */
export function groupWhen(group) {
  if (!group) return '';
  return [group.day ? `${group.day} ${koutsiTimeRangeLabel(group.time, group.durationMinutes)}` : '', group.level].filter(Boolean).join(' · ');
}

/** A session in a list: time, who, the week's theme, and how attendance stands. */
export function SessionRow({ item, showDate, now }) {
  const { training, group, student } = item;
  const status = sessionStatus(training, group, now);
  const theme = group ? koutsiThemeForDate(group, training.date) : null;
  const absent = (training.absences || []).length;
  const members = group ? group.memberIds.length : 1;
  const title = group ? group.name : (student?.name || training.type);
  const kind = training.type && training.type !== 'Ryhmätreeni' ? training.type : '';
  return (
    <Link to={sessionPath(training.id)} className={cx('k-session', `is-${status}`)}>
      <span className="k-session-time">
        {showDate && <span className="k-session-date">{relativeDay(training.date)}</span>}
        <span className="t-num">{training.time}</span>
      </span>
      <span className="k-session-main">
        <span className="k-session-title truncate">{title}</span>
        <span className="k-session-sub truncate">
          {group && kind ? `${kind} · ` : ''}
          {theme ? <><Icon name="sparkles" size={13} /> {theme.title}</> : group ? <span className="k-faint">Ei teemaa</span> : student ? (kind || 'Yksityistunti') : ''}
        </span>
      </span>
      <span className="k-session-side">
        {status === 'now' && <Chip tone="lime" size="sm" dot="live">Käynnissä</Chip>}
        {status !== 'now' && absent > 0 && <Chip tone="warn" size="sm">{absent} poissa</Chip>}
        {status !== 'now' && absent === 0 && group && <span className="k-session-count t-num"><Icon name="users" size={14} />{members}</span>}
        <Icon name="chevron-right" size={18} className="k-chevron" />
      </span>
    </Link>
  );
}

/** A group in a list: schedule, name, members, this week's theme status. */
export function GroupRow({ group, week, linkState }) {
  const theme = week ? koutsiGroupThemeForWeek(group, week) : group.theme;
  return (
    <Link to={groupPath(group.id)} state={linkState} className="k-row k-group-row">
      <span className="k-group-time t-num">{group.time || '—'}</span>
      <span className="k-row-main">
        <span className="k-row-title truncate">{group.name}</span>
        <span className="k-row-sub truncate">
          {[koutsiTimeRangeLabel(group.time, group.durationMinutes), group.level, `${group.memberIds.length} pel.`].filter(Boolean).join(' · ')}
        </span>
        <span className={cx('k-theme-line', theme ? 'has-theme' : 'no-theme')}>
          {theme ? <><Icon name="sparkles" size={13} />{theme.title}</> : 'Ei teemaa tällä viikolla'}
        </span>
      </span>
      <Icon name="chevron-right" size={18} className="k-chevron" />
    </Link>
  );
}

/** A player in a list. `right` replaces the default status chip. */
export function PlayerRow({ student, sub, right, to }) {
  return (
    <Link to={to || playerPath(student.id)} className="k-row k-player-row">
      <Avatar person={student} name={student.name} src={student.avatarUrl} size={42} />
      <span className="k-row-main">
        <span className="k-row-title truncate">{student.name}</span>
        {sub && <span className="k-row-sub truncate">{sub}</span>}
      </span>
      {right !== undefined ? right : (student.isPlaceholder ? <Chip tone="warn" size="sm">Ei liittynyt</Chip> : null)}
      <Icon name="chevron-right" size={18} className="k-chevron" />
    </Link>
  );
}

const ACTIVITY_ICON = { mood: 'heart', self: 'bolt', wish: 'chat', note: 'edit', match: 'trophy', homework: 'check-circle' };

/** A player's own log as the player wrote it: "Kuntosali · 45 min — jalat ja keskivartalo". */
function selfLogLine(training) {
  const { activity, title, text } = ownEntry(training);
  if (activity === 'turnaus') return `Turnaus — ${title}`;
  const minutes = training.durationMinutes ? ` · ${training.durationMinutes} min` : '';
  return `${title}${minutes}${text ? ` — ${text}` : ''}`;
}

/** One line of "Pelaajilta": what a player did, and when. */
export function ActivityRow({ item }) {
  const s = item.student;
  let text;
  if (item.kind === 'mood') text = <>Fiilis {item.mood.score}/5 — {MOOD_LABELS[item.mood.score]}{item.mood.note ? `: “${item.mood.note}”` : ''}</>;
  else if (item.kind === 'self') text = selfLogLine(item.training);
  else if (item.kind === 'wish') text = <>Toive: “{item.text}”</>;
  else if (item.kind === 'note') text = <>Muistiinpano: “{item.text}”</>;
  else if (item.kind === 'match') text = <>Ottelu vs. {item.match.opponentName}{item.match.result ? ` — ${item.match.result === 'voitto' ? 'voitto' : 'tappio'}` : ''}{item.match.score ? ` ${item.match.score}` : ''}</>;
  else if (item.kind === 'homework') text = <>Teki kotiläksyn: {item.text}</>;
  return (
    <Link to={playerPath(s.id)} className="k-activity">
      <span className={cx('k-activity-icon', `is-${item.kind}`)}><Icon name={ACTIVITY_ICON[item.kind] || 'info'} size={16} /></span>
      <span className="k-activity-text">
        <span className="k-activity-who">{s.name}</span>
        <span className="k-activity-what clamp-2">{text}</span>
      </span>
      <span className="k-activity-when">{relativeDay(String(item.at).slice(0, 10))}</span>
    </Link>
  );
}
