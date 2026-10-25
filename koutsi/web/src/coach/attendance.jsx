// attendance.jsx — EHDOTUS (haara koutsi-selkeys): one session's attendance as tap-to-flip chips,
// used on Koti's Tänään card and in Merkitse → Läsnäolo. Everyone is there unless tapped away
// (presence is "no row", like on the session page); a player's own "En pääse" is already marked.
// A tap shows at once and is saved in the background.
import { useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Avatar, Icon, useToast } from '../ui/index.js';
import { sessionRoster } from '../domain/week.js';
import { track } from './usage.js';

const cx = (...c) => c.filter(Boolean).join(' ');

/** toggle(student, 'paikalla' | 'poissa') for one session: optimistic, then saved. */
export function useAttendanceToggle(training, source = 'koti') {
  const { mutate, reload } = useData();
  const toast = useToast();
  const [pending, setPending] = useState(() => new Set());
  return async (student, next) => {
    if (!training || pending.has(student.id)) return;
    setPending((p) => new Set(p).add(student.id));
    track(`${source}.${next === 'poissa' ? 'poissa' : 'paikalla'}`);
    mutate((s) => ({
      ...s,
      trainings: s.trainings.map((t) => (t.id !== training.id ? t : {
        ...t,
        absences: next === 'poissa'
          ? [...(t.absences || []).filter((a) => a.studentId !== student.id), { studentId: student.id, reason: 'poissa', reportedBy: null, updatedAt: new Date().toISOString() }]
          : (t.absences || []).filter((a) => a.studentId !== student.id),
      })),
    }));
    try {
      await api.attendance.set([training.id], student.id, next);
    } catch (err) {
      toast(err);
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(student.id); return n; });
      reload().catch(() => {});
    }
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
