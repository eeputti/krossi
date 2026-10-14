// DaySummarySheet — "Päivän yhteenveto": opened from the Merkitse menu once the day's last
// session is over. Sessions held and attendance, the players' feelings and wishes of the day,
// and the day's sessions and player activity, each one tap from its page.
import { useMemo } from 'react';
import { useData } from '../app/data.jsx';
import { Sheet, StatTile } from '../ui/index.js';
import { Block, Quiet } from '../shared/bits.jsx';
import { koutsiFmtLongDate } from '../domain/core.js';
import { coachSessionsOn, dayRecap, playerActivity } from '../domain/week.js';
import { ActivityRow, SessionRow } from './parts.jsx';

const percent = (x) => `${Math.round(x * 100)} %`;
const average = (x) => x.toFixed(1).replace('.', ',');
const localDay = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** open, date (YYYY-MM-DD), onClose() */
export function DaySummarySheet({ open, date, onClose }) {
  const { state } = useData();
  const recap = useMemo(() => (date ? dayRecap(state, date) : null), [state, date]);
  const sessions = useMemo(() => (date ? coachSessionsOn(state, date) : []), [state, date]);
  const activity = useMemo(() => (date ? playerActivity(state, 1, date).filter((item) => localDay(item.at) === date) : []), [state, date]);
  if (!date || !recap) return null;
  return (
    <Sheet open={open} onClose={onClose} size="md" title="Päivän yhteenveto"
      subtitle={koutsiFmtLongDate(date).replace(/^./, (c) => c.toUpperCase())}>
      <div className="stack-5">
        <div className="k-stats k-stats-3">
          <StatTile label="Treenejä" value={recap.sessions ? `${recap.held}/${recap.sessions}` : '0'} />
          <StatTile label="Läsnäolo" value={recap.attendance == null ? '–' : percent(recap.attendance)}
            sub={recap.expected ? `${recap.present}/${recap.expected} pelaajaa` : undefined} />
          <StatTile label="Fiilis" value={recap.moodAverage == null ? '–' : average(recap.moodAverage)}
            sub={recap.moodCount ? `${recap.moodCount} ${recap.moodCount === 1 ? 'vastaus' : 'vastausta'}` : 'ei vastauksia'} />
        </div>
        <Block eyebrow="Treenit" title={sessions.length === 1 ? '1 treeni' : `${sessions.length} treeniä`}>
          {sessions.length === 0 ? <Quiet icon="calendar">Ei treenejä tänä päivänä.</Quiet> : (
            <div className="k-list">{sessions.map((item) => <SessionRow key={item.training.id} item={item} />)}</div>
          )}
        </Block>
        <Block eyebrow="Pelaajilta" title="Tänään">
          {activity.length === 0 ? <Quiet icon="heart">Pelaajien fiilikset, omat treenit ja toiveet näkyvät tässä.</Quiet> : (
            <div className="k-list">{activity.slice(0, 8).map((item, i) => <ActivityRow key={`${item.kind}-${item.student.id}-${i}`} item={item} />)}</div>
          )}
        </Block>
      </div>
    </Sheet>
  );
}
