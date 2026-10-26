// attendance.jsx — EHDOTUS (haara koutsi-selkeys): one session's attendance as tap-to-flip chips,
// used on Koti's Tänään card and in Merkitse → Läsnäolo. Everyone is there unless tapped away
// (presence is "no row", like on the session page); a player's own "En pääse" is already marked.
// A tap shows at once and is saved in the background.
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Avatar, Icon, useToast } from '../ui/index.js';
import { sessionRoster } from '../domain/week.js';
import { track } from './usage.js';

const cx = (...c) => c.filter(Boolean).join(' ');

// Taps are saved one after another per player (a quick second tap that undoes the first lands
// last), and the view reloads once, after the last write — a reload between two taps would flip
// the second chip back on a slow connection.
const chains = new Map(); // `${trainingId}:${studentId}` → the latest write
let writing = 0;
let reloadTimer = null;

/** Shows the change at once and saves it in the background (Koti, Merkitse → Läsnäolo, the session page). */
export function saveAttendance({ trainingId, studentId, next, mutate, reload, toast }) {
  mutate((s) => ({
    ...s,
    trainings: s.trainings.map((t) => (t.id !== trainingId ? t : {
      ...t,
      absences: next === 'poissa'
        ? [...(t.absences || []).filter((a) => a.studentId !== studentId), { studentId, reason: 'poissa', reportedBy: null, updatedAt: new Date().toISOString() }]
        : (t.absences || []).filter((a) => a.studentId !== studentId),
    })),
  }));
  writing += 1;
  clearTimeout(reloadTimer);
  const key = `${trainingId}:${studentId}`;
  const write = (chains.get(key) || Promise.resolve())
    .then(() => api.attendance.set([trainingId], studentId, next))
    .catch((err) => toast(err));
  chains.set(key, write);
  write.finally(() => {
    if (chains.get(key) === write) chains.delete(key);
    writing -= 1;
    if (writing === 0) reloadTimer = setTimeout(() => { reload().catch(() => {}); }, 400);
  });
}

/** toggle(student, 'paikalla' | 'poissa') for one session: optimistic, then saved. */
export function useAttendanceToggle(training, source = 'koti') {
  const { mutate, reload } = useData();
  const toast = useToast();
  return (student, next) => {
    if (!training) return;
    track(`${source}.${next === 'poissa' ? 'poissa' : 'paikalla'}`);
    saveAttendance({ trainingId: training.id, studentId: student.id, next, mutate, reload, toast });
  };
}

/** Everyone in the session as a chip: lime check = there, clay cross = away. */
export function AttendanceChips({ training, source = 'koti', hint = 'Napauta poissaolleet' }) {
  const { state } = useData();
  const live = state.trainings.find((t) => t.id === training.id) || training;
  const roster = sessionRoster(state, live);
  const toggle = useAttendanceToggle(live, source);
  const byId = new Map((live.absences || []).map((a) => [a.studentId, a]));
  const present = roster.filter((s) => !byId.has(s.id)).length;
  if (!roster.length) return <p className="k-quiet">Ryhmässä ei ole pelaajia.</p>;
  return (
    <div className="ta">
      <div className="ta-head">
        <span className="ta-count t-num">Läsnä {present}/{roster.length}</span>
        <span className="ta-hint">{hint}</span>
      </div>
      <ul className="ta-grid">
        {roster.map((s) => {
          const a = byId.get(s.id);
          const self = a && a.reportedBy === s.id;
          return (
            <li key={s.id}>
              <button type="button" className={cx('ta-chip', a && 'is-absent')} aria-pressed={!a}
                aria-label={`${s.name}: ${a ? 'poissa' : 'paikalla'}. Vaihda.`} onClick={() => toggle(s, a ? 'paikalla' : 'poissa')}>
                <Avatar person={s} size={28} />
                <span className="ta-who">
                  <span className="ta-name">{s.name}</span>
                  {a && <span className="ta-sub">{self ? 'Ilmoitti itse' : 'Poissa'}</span>}
                </span>
                <span className="ta-mark" aria-hidden="true">{a ? <Icon name="close" size={13} strokeWidth={3} /> : <Icon name="check" size={13} strokeWidth={3} />}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
