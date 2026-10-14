// TrainingsScreen (player) — the month: coach sessions (with "En pääse"), the player's own
// logs, matches and club events per day; logging something for the chosen day.
import { useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { useNow } from '../app/hooks.js';
import { Button, Chip, Icon, IconButton, Page, PageHeader, useConfirm } from '../ui/index.js';
import { Quiet } from '../shared/bits.jsx';
import {
  koutsiTodayStr, koutsiAddDays, koutsiPad, koutsiTrainingsForStudent, koutsiGroupById, koutsiThemeForDate, koutsiClubEventsOnDate,
  koutsiTimeRangeLabel, koutsiFmtShortDate, KOUTSI_MONTHS, KOUTSI_EVENT_KINDS,
} from '../domain/core.js';
import { sessionStatus, shortDay } from '../domain/week.js';
import { usePlayerActions } from './PlayerApp.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

export function TrainingsScreen() {
  const { state, run } = useData();
  const actions = usePlayerActions();
  const confirm = useConfirm();
  const student = state.students[0];
  const now = new Date(useNow(60_000));
  const today = koutsiTodayStr();
  const [cursor, setCursor] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const [selected, setSelected] = useState(today);
  const mine = useMemo(() => koutsiTrainingsForStudent(state, student.id), [state, student.id]);
  const prefix = `${cursor.y}-${koutsiPad(cursor.m + 1)}`;
  const marks = useMemo(() => {
    const map = new Map();
    const add = (d, k) => { const s = map.get(d) || new Set(); s.add(k); map.set(d, s); };
    mine.forEach((t) => { if (t.date.startsWith(prefix)) add(t.date, t.loggedBy === 'player' ? 'own' : (t.absences || []).some((a) => a.studentId === student.id) ? 'absent' : 'coach'); });
    (student.matchNotes || []).forEach((n) => { if (n.date.startsWith(prefix)) add(n.date, 'match'); });
    (state.clubEvents || []).forEach((e) => { if (e.date.startsWith(prefix)) add(e.date, 'event'); });
    return map;
  }, [mine, student, state.clubEvents, prefix]);
  const first = new Date(cursor.y, cursor.m, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${prefix}-${koutsiPad(i + 1)}`)];
  const move = (n) => setCursor(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

  const dayTrainings = mine.filter((t) => t.date === selected);
  const dayMatches = (student.matchNotes || []).filter((n) => n.date === selected);
  const dayEvents = koutsiClubEventsOnDate(state, selected);
  const removeOwn = async (t) => {
    if (await confirm({ title: 'Poista merkintä?', message: `${t.type} — ${koutsiFmtShortDate(t.date)}`, confirmLabel: 'Poista', danger: true })) await run(() => api.player.deleteSelfTraining(t.id), 'Merkintä poistettu.');
  };
  const monthName = KOUTSI_MONTHS[cursor.m];
  return (
    <Page>
      <PageHeader title="Treenit" actions={<Button variant="dark" size="sm" icon="plus" onClick={() => actions.openSelfTraining(selected)}>Kirjaa</Button>} />
      <div className="stack-5">
        <div className="cal-month">
          <div className="cal-month-head">
            <IconButton icon="chevron-left" label="Edellinen kuukausi" variant="soft" onClick={() => move(-1)} />
            <span className="cal-month-title">{monthName.charAt(0).toUpperCase() + monthName.slice(1)} {cursor.y}</span>
            <IconButton icon="chevron-right" label="Seuraava kuukausi" variant="soft" onClick={() => move(1)} />
          </div>
          <div className="cal-grid">
            {['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'].map((d) => <span key={d} className="cal-dow">{d}</span>)}
            {cells.map((date, i) => {
              if (!date) return <span key={`e${i}`} />;
              const set = marks.get(date);
              return (
                <button key={date} type="button" className={cx('cal-cell', date === today && 'is-today', date === selected && 'is-selected')} onClick={() => setSelected(date)}>
                  <span className="cal-cell-num">{Number(date.slice(8))}</span>
                  {set && <span className="cal-dots">{[...set].map((k) => <span key={k} className={`cal-dot cal-dot-${k}`} />)}</span>}
                </button>
              );
            })}
          </div>
          <div className="cal-legend">
            <span><span className="cal-dot cal-dot-coach" /> Valmennus</span>
            <span><span className="cal-dot cal-dot-own" /> Oma treeni</span>
            <span><span className="cal-dot cal-dot-match" /> Ottelu</span>
            <span><span className="cal-dot cal-dot-absent" /> Poissa</span>
          </div>
        </div>

        <section className="cal-day is-selected-day">
          <div className="cal-day-head">
            <span className="cal-day-name">{selected === today ? 'Tänään' : shortDay(selected)}</span>
            <span className="grow" />
            <IconButton icon="plus" label="Kirjaa tälle päivälle" size="sm" onClick={() => actions.openSelfTraining(selected)} />
          </div>
          {dayEvents.map((e) => (
            <div key={e.id} className="k-event-row is-static"><Icon name="flag" size={16} /><span className="grow"><span className="k-row-title">{e.title}</span><span className="k-faint">{KOUTSI_EVENT_KINDS.find((k) => k.value === e.kind)?.label || 'Tapahtuma'}</span></span></div>
          ))}
          {dayTrainings.length === 0 && dayMatches.length === 0 && dayEvents.length === 0 && <p className="cal-empty">Ei merkintöjä tälle päivälle.</p>}
          <div className="k-list">
            {dayTrainings.map((t) => {
              const group = t.groupId ? koutsiGroupById(state, t.groupId) : null;
              const theme = group ? koutsiThemeForDate(group, t.date) : null;
              const absent = (t.absences || []).some((a) => a.studentId === student.id);
              const own = t.loggedBy === 'player';
              // "En pääse" until the session starts; once it is over, ask how it went instead
              // (for three days, and only if no feeling was logged after it began).
              const status = own ? null : sessionStatus(t, group, now);
              const upcoming = status === 'upcoming';
              const start = new Date(`${t.date}T${t.time || '00:00'}:00`);
              const askMood = status === 'past' && !absent && t.date >= koutsiAddDays(today, -3)
                && !(student.moods || []).some((m) => new Date(m.at) >= start);
              return (
                <div key={t.id} className={cx('p-session', own && 'is-own', absent && 'is-absent')}>
                  <span className="p-session-time t-num">{t.type === 'Turnaus' ? '—' : t.time}</span>
                  <span className="grow">
                    <span className="k-row-title">{t.type}{group ? ` · ${group.name}` : ''}</span>
                    <span className="k-faint">
                      {own ? [t.durationMinutes ? `${t.durationMinutes} min` : '', t.endDate && t.endDate !== t.date ? `– ${koutsiFmtShortDate(t.endDate)}` : '', t.notes].filter(Boolean).join(' · ')
                        : [koutsiTimeRangeLabel(t.time, t.durationMinutes || group?.durationMinutes), theme ? `Teema: ${theme.title}` : ''].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {own && <IconButton icon="trash" label="Poista" size="sm" onClick={() => removeOwn(t)} />}
                  {!own && absent && (upcoming
                    ? <Button variant="ghost" size="sm" onClick={() => actions.openAbsence(t)}>Poissa · muuta</Button>
                    : <Chip tone="danger" size="sm">Poissa</Chip>)}
                  {!own && !absent && upcoming && <Button variant="outline" size="sm" onClick={() => actions.openAbsence(t)}>En pääse</Button>}
                  {askMood && <Button variant="outline" size="sm" icon="heart" onClick={() => actions.openCheckIn(t)}>Miten meni?</Button>}
                </div>
              );
            })}
            {dayMatches.map((n) => (
              <button key={n.id} type="button" className="p-session is-match" onClick={() => actions.openMatch({ editing: n })}>
                <Icon name="trophy" size={16} />
                <span className="grow"><span className="k-row-title">Ottelu vs. {n.opponentName}</span><span className="k-faint">{[n.result === 'voitto' ? 'Voitto' : n.result === 'tappio' ? 'Tappio' : '', n.score].filter(Boolean).join(' · ')}</span></span>
                <Icon name="edit" size={15} />
              </button>
            ))}
          </div>
        </section>

        {student.homework.length > 0 && (
          <section className="stack-2">
            <div className="eyebrow">Kotiläksyt</div>
            <div className="k-list">
              {student.homework.map((h) => (
                <button key={h.id} type="button" className={cx('k-hw', h.done && 'is-done')} onClick={() => run(() => api.homework.toggleDone(h.id, !h.done), h.done ? null : 'Merkitty tehdyksi — hienoa!')}>
                  <span className={cx('k-check-btn', h.done && 'is-on')}><Icon name="check" size={14} strokeWidth={3} /></span>
                  <span className="grow">{h.text}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {mine.length === 0 && <Quiet icon="calendar">Valmentajasi treenit ja omat kirjauksesi näkyvät täällä.</Quiet>}
      </div>
    </Page>
  );
}
