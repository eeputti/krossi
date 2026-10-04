// StreakBadge — SHARED component. Owner: profile agent (wave 2). Other screens import it with exactly this interface:
//   <StreakBadge streak={{current,best,activeThisWeek,weeksAtRisk}} size='sm'|'md'|'lg' tone='light'|'dark' />  — flame + 'N vk' with a little flicker animation
//
// sm  inline pill "🔥 4 vk putki" (at risk: amber dot on the flame + tooltip)
// md  pill with the flame in a circle, "4 vk" over "putki" (at risk: label turns into "putki vaarassa")
// lg  block that fills its container: big flame, "4 vk", "viikkoputki · paras 6 vk" and a hint line
//     ("Pelaa tällä viikolla, ettei putki katkea" / "Tämän viikon peli pelattu" / "Pelaa tällä viikolla ja sytytä putki")
// A streak of 0 shows an unlit (grey) flame.
import { Icon } from '../../ui/index.js';

const cx = (...c) => c.filter(Boolean).join(' ');

export const STREAK_AT_RISK_HINT = 'Pelaa tällä viikolla, ettei putki katkea';

function Flame({ size }) {
  return (
    <svg className="streak-badge-svg" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path className="streak-badge-outer" d="M12 23c4.6 0 7.8-3.1 7.8-7.5 0-3.7-2.3-6.2-4.1-8.2-.3 2.3-1.5 3.7-3.1 4.4.3-4.1-1.4-7.6-5.1-10.2-.1 3.6-2 5.9-3.6 8.1C2.4 11.9 4.2 23 12 23z" />
      <path className="streak-badge-inner" d="M12 21.2c2.4 0 4-1.6 4-3.9 0-1.9-1.1-3.2-2.1-4.3-.2 1.2-.8 1.9-1.6 2.3.1-2.1-.7-3.9-2.6-5.3-.1 1.9-1 3-1.8 4.2-.6.9-.9 1.8-.9 2.9 0 2.4 2 4.1 5 4.1z" />
    </svg>
  );
}

export function StreakBadge({ streak, size = 'md', tone = 'light', className }) {
  const current = Math.max(0, Number(streak?.current) || 0);
  const best = Math.max(current, Number(streak?.best) || 0);
  const lit = current > 0;
  const atRisk = lit && (streak?.weeksAtRisk ?? !streak?.activeThisWeek);
  const value = `${current} vk`;

  let hint = null;
  if (atRisk) hint = STREAK_AT_RISK_HINT;
  else if (lit && streak?.activeThisWeek) hint = 'Tämän viikon peli pelattu';
  else if (!lit) hint = best > 0 ? `Paras putkesi ${best} vk — aloita uusi tällä viikolla` : 'Pelaa tällä viikolla ja sytytä putki';

  const aria = `Viikkoputki ${current} viikkoa${hint ? `. ${hint}` : ''}`;
  const classes = cx('streak-badge', `streak-badge-${size}`, `streak-badge-${tone}`, lit ? 'is-lit' : 'is-out', atRisk && 'is-at-risk', className);

  if (size === 'sm') {
    return (
      <span className={classes} title={hint || undefined} aria-label={aria} role="img">
        <span className="streak-badge-flame"><Flame size={15} />{atRisk && <span className="streak-badge-dot" />}</span>
        <span className="streak-badge-value t-num">{value}</span>
        <span className="streak-badge-label">putki</span>
      </span>
    );
  }

  if (size === 'md') {
    return (
      <span className={classes} title={hint || undefined} aria-label={aria} role="img">
        <span className="streak-badge-flame"><Flame size={22} />{atRisk && <span className="streak-badge-dot" />}</span>
        <span className="streak-badge-text">
          <span className="streak-badge-value t-num">{value}</span>
          <span className="streak-badge-label">{atRisk ? 'putki vaarassa' : 'putki'}</span>
        </span>
      </span>
    );
  }

  return (
    <div className={classes} aria-label={aria} role="group">
      <span className="streak-badge-flame"><Flame size={34} /></span>
      <span className="streak-badge-text">
        <span className="streak-badge-value t-num">{value}</span>
        <span className="streak-badge-label">viikkoputki{best > 0 ? ` · paras ${best} vk` : ''}</span>
      </span>
      {hint && (
        <span className="streak-badge-hint">
          <Icon name={atRisk ? 'clock' : lit ? 'check-circle' : 'sparkles'} size={15} />
          <span>{hint}</span>
        </span>
      )}
    </div>
  );
}
