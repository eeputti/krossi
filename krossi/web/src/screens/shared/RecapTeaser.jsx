// RecapTeaser — SHARED component. Owner: recap agent. Other screens import it with this interface:
//   <RecapTeaser recaps={availableRecaps(...)} />  — dark-green card linking to the newest month
//   recap (/pelaa/kooste/<key>); renders null when there is none.
//   Optional: activity={activity} (the same Activity the recaps came from, e.g. from useActivity())
//   adds the win count ("7 peliä · 5 voittoa"); className for layout.
import { useMemo } from 'react';
import { Card, Icon } from '../../ui/index.js';
import { Link } from '../../app/router.js';
import { buildRecap, parsePeriod } from '../../features/recap.js';
import { capitalize } from '../../lib/format.js';
import { periodWords, unit } from '../recap/copy.js';

const cx = (...c) => c.filter(Boolean).join(' ');

export function RecapTeaser({ recaps, activity, className }) {
  const latest = recaps?.find((r) => r.type === 'month') || null;
  const period = useMemo(() => (latest ? parsePeriod(latest.key) : null), [latest?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const wins = useMemo(() => {
    if (!period || !activity) return null;
    const recap = buildRecap(activity, period, new Date());
    return recap && recap.wins + recap.losses > 0 ? recap.wins : null;
  }, [period, activity]);
  if (!latest || !period) return null;

  const words = periodWords(period);
  const done = new Date() >= period.end;
  const games = latest.gamesPlayed;
  return (
    <Card as={Link} to={`/pelaa/kooste/${latest.key}`} interactive tone="dark" padding="lg" className={cx('court-lines', 'recap-teaser', className)}>
      <span className="recap-teaser-text">
        <span className="eyebrow">{done ? 'Kuukauden kooste' : 'Kuukausi käynnissä'}</span>
        <span className="recap-teaser-title">
          {capitalize(words.genitive)} kooste {done ? 'on valmis 🎉' : 'tähän asti'}
        </span>
        <span className="recap-teaser-stats">
          <span className="recap-teaser-num t-num">{games}</span> {unit.games(games)}
          {wins != null && (
            <>
              <span className="recap-teaser-dot" aria-hidden="true">·</span>
              <span className="recap-teaser-num t-num">{wins}</span> {unit.wins(wins)}
            </>
          )}
        </span>
      </span>
      <span className="recap-teaser-cta" aria-hidden="true">
        <span className="recap-teaser-bars"><span /><span /><span /></span>
        <span className="recap-teaser-play"><Icon name="play" size={20} strokeWidth={2.4} /></span>
      </span>
    </Card>
  );
}
