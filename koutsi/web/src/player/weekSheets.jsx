// weekSheets.jsx — the pop-ups of the player's week (Treenit): a coach's session (theme, plan,
// "En pääse" before it, "Miten meni?" after it), the player's own entry (edit, remove), and the
// month grid for jumping to another week.
import { useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Button, Icon, IconButton, Sheet, useConfirm } from '../ui/index.js';
import { koutsiAddDays, koutsiPad, koutsiTimeRangeLabel, koutsiTodayStr, koutsiTrainingsForStudent, KOUTSI_MONTHS } from '../domain/core.js';
import { minutesLabel, weekDates } from '../domain/week.js';
import { eventRangeLabel } from '../domain/board.js';
import { readPlan, planSummary } from '../domain/plan.js';
import { ownEntry } from '../domain/ownWeek.js';
import { ActivityIcon } from './ActivityIcon.jsx';
import { usePlayerActions } from './PlayerApp.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const DAY_LONG = ['sunnuntai', 'maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'lauantai'];

/** "Tiistai 21.10." */
export function longDay(date) {
  const [y, m, d] = date.split('-').map(Number);
  const name = DAY_LONG[new Date(y, m - 1, d).getDay()];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${d}.${m}.`;
}

/** A coach's session: when, who, the week's theme, the plan, and what the player can do about it. */
export function CoachSessionSheet({ open, item, onClose }) {
  const { state } = useData();
  const actions = usePlayerActions();
  if (!item) return null;
  const live = state.trainings.find((t) => t.id === item.training.id) || item.training;
  const student = state.students[0];
  const absent = (live.absences || []).some((a) => a.studentId === student.id);
  const { group, coach, theme, status } = item;
  const plan = readPlan(live.notes);
  const start = new Date(`${live.date}T${live.time || '00:00'}:00`);
  // "Miten meni?" for three days after it, unless a feeling was logged after it began
  const askMood = status === 'past' && !absent && live.date >= koutsiAddDays(koutsiTodayStr(), -3)
    && !(student.moods || []).some((m) => new Date(m.at) >= start);
  const then = (fn) => () => { onClose(); fn(); };
  return (
    <Sheet open={open} onClose={onClose} size="sm" title={group ? group.name : live.type}
      subtitle={`${longDay(live.date)} klo ${koutsiTimeRangeLabel(live.time, live.durationMinutes || group?.durationMinutes)}`}
      footer={status === 'upcoming' ? (absent
        ? <Button variant="dark" size="lg" block onClick={then(() => actions.openAbsence(live))}>Pääsenkin paikalle</Button>
        : <Button variant="outline" size="lg" block icon="close" onClick={then(() => actions.openAbsence(live))}>En pääse</Button>)
        : askMood ? <Button variant="dark" size="lg" block icon="heart" onClick={then(() => actions.openCheckIn(live))}>Miten meni?</Button> : null}>
      <div className="stack-4">
        <div className={cx('pw-state', absent ? 'is-absent' : status === 'now' ? 'is-now' : status === 'past' ? 'is-past' : 'is-ok')}>
          <Icon name={absent ? 'close' : status === 'past' ? 'check' : 'clock'} size={18} />
          <span>{absent ? (status === 'upcoming' ? 'Ilmoitit, ettet pääse' : 'Poissa') : status === 'now' ? 'Käynnissä nyt' : status === 'past' ? 'Pidetty' : 'Tulossa'}</span>
        </div>
        <div className="wb-facts">
          <span className="wb-fact">{live.type}</span>
          {coach && <span className="wb-fact">Valmentaja: {coach.name}</span>}
        </div>
        {theme && (
          <div className="pw-theme">
            <div className="eyebrow"><Icon name="sparkles" size={13} /> Viikon teema</div>
            <strong className="pw-theme-title">{theme.title}</strong>
            {theme.lead && <p className="pw-theme-lead">{theme.lead}</p>}
          </div>
        )}
        {plan.items.length > 0 && (
          <button type="button" className="tp-link" onClick={then(() => actions.openPlan(live))}>
            <Icon name="list" size={16} /><span className="grow"><strong>Treenin runko</strong> · {planSummary(plan)}</span><Icon name="chevron-right" size={16} />
          </button>
        )}
      </div>
    </Sheet>
  );
}

/** The player's own entry: what, when, their words — and edit / remove. */
export function OwnEntrySheet({ open, training, onClose }) {
  const { run } = useData();
  const actions = usePlayerActions();
  const confirm = useConfirm();
  if (!training) return null;
  const e = ownEntry(training);
  const tournament = e.activity === 'turnaus';
  const when = tournament
    ? eventRangeLabel({ date: training.date, endDate: training.endDate })
    : `${longDay(training.date)} klo ${koutsiTimeRangeLabel(training.time, training.durationMinutes || 60)}`;
  const remove = async () => {
    const ok = await confirm({ title: 'Poista merkintä?', message: `${e.title} — ${when}`, confirmLabel: 'Poista', danger: true });
    if (!ok) return;
    const res = await run(() => api.player.deleteSelfTraining(training.id), 'Merkintä poistettu.');
    if (res.ok) onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} size="sm" title={e.title} subtitle={when}
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" icon="trash" onClick={remove}>Poista</Button><Button variant="dark" size="lg" icon="edit" onClick={() => { onClose(); actions.openSelfTraining(training.date, { editing: training }); }}>Muokkaa</Button></div>}>
      <div className="stack-4">
        <div className="pw-own-head">
          <span className="pw-own-icon"><ActivityIcon activity={e.activity} size={22} /></span>
          <span className="grow">
            <strong>{tournament ? 'Turnaus' : training.type}</strong>
            {!tournament && training.durationMinutes ? <span className="k-faint">{minutesLabel(training.durationMinutes)}</span> : null}
          </span>
        </div>
        {e.text && <p className="pw-own-text">{e.text}</p>}
        <p className="k-faint pw-own-seen"><Icon name="eye" size={14} /> Kaikki valmentajasi näkevät tämän merkinnän.</p>
      </div>
    </Sheet>
  );
}

/** The month, for jumping to another week: a dot on days with something on them. */
export function PlayerWeekPicker({ open, week, onClose, onPick }) {
  const { state } = useData();
  const student = state.students[0];
  const monday = weekDates(week)[0];
  const [cursor, setCursor] = useState(null);
  const y = cursor?.y ?? Number(monday.slice(0, 4));
  const m = cursor?.m ?? Number(monday.slice(5, 7)) - 1;
  const move = (n) => { const d = new Date(y, m + n, 1); setCursor({ y: d.getFullYear(), m: d.getMonth() }); };
  const inWeek = new Set(weekDates(week));
  const today = koutsiTodayStr();
  const prefix = `${y}-${koutsiPad(m + 1)}`;
  const marks = useMemo(() => {
    const map = new Map();
    const add = (d, k) => { const s = map.get(d) || new Set(); s.add(k); map.set(d, s); };
    koutsiTrainingsForStudent(state, student.id).forEach((t) => { if (t.date.startsWith(prefix)) add(t.date, t.loggedBy === 'player' ? 'own' : 'coach'); });
    (student.matchNotes || []).forEach((n) => { if (n.date.startsWith(prefix)) add(n.date, 'own'); });
    return map;
  }, [state, student, prefix]);
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${prefix}-${koutsiPad(i + 1)}`)];
  while (cells.length < 42) cells.push(null);
  const monthName = KOUTSI_MONTHS[m];
  return (
    <Sheet open={open} onClose={() => { setCursor(null); onClose(); }} title="Siirry viikkoon" size="sm">
      <div className="cal-month">
        <div className="cal-month-head">
          <IconButton icon="chevron-left" label="Edellinen kuukausi" variant="soft" onClick={() => move(-1)} />
          <span className="cal-month-title">{monthName.charAt(0).toUpperCase() + monthName.slice(1)} {y}</span>
          <IconButton icon="chevron-right" label="Seuraava kuukausi" variant="soft" onClick={() => move(1)} />
        </div>
        <div className="cal-grid" role="grid">
          {['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'].map((d) => <span key={d} className="cal-dow">{d}</span>)}
          {cells.map((date, i) => {
            if (!date) return <span key={`e${i}`} className="cal-blank" aria-hidden="true" />;
            const set = marks.get(date);
            return (
              <button key={date} type="button" className={cx('cal-cell', date === today && 'is-today', inWeek.has(date) && 'is-week')}
                onClick={() => { setCursor(null); onPick(date); }}>
                <span className="cal-cell-num">{Number(date.slice(8))}</span>
                {set && <span className="cal-dots">{[...set].map((k) => <span key={k} className={`cal-dot pw-dot-${k}`} />)}</span>}
              </button>
            );
          })}
        </div>
        <div className="cal-legend">
          <span><span className="cal-dot pw-dot-coach" /> Valmennus</span>
          <span><span className="cal-dot pw-dot-own" /> Oma merkintä</span>
        </div>
      </div>
    </Sheet>
  );
}
