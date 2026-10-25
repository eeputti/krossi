// glance.js — EHDOTUS (haara koutsi-selkeys): the numbers a coach reads at one glance, as pure
// functions over the coach's state.
//   weekGlance       the week on the phone's Koti: each day's sessions, held / attendance / the
//                    players' own trainings / feelings, the theme status, who trained the most
//                    and who missed their last two sessions
//   playerMonthFacts one player's month: attendance, training days a week (sessions + own),
//                    own trainings, feeling — with last month beside it
//   coachMonthCalendar the player's month calendar (domain/monthCal.js) plus the sessions they
//                    missed, so a coach sees the gaps too
// Facts only — no labels like "laiska": many players are juniors.
import {
  koutsiGroupById, koutsiGroupThemeForWeek, koutsiIsoWeekOfDateStr, koutsiTodayStr, koutsiWeekThemeStatus,
} from './core.js';
import { monthCalendar } from './monthCal.js';
import { sessionRoster, sessionStatus, weekDates, weekRecap } from './week.js';

const DAY_SHORT = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];
const pad = (n) => String(n).padStart(2, '0');
const dayStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isCoachRun = (t) => t.loggedBy !== 'player';
const absentFrom = (t, id) => (t.absences || []).some((a) => a.studentId === id);

/** The week at a glance → { days, held, sessions, attendance, own, moodAverage, themes, active, missedTwice }. */
export function weekGlance(state, week, now = new Date()) {
  const dates = weekDates(week);
  const today = koutsiTodayStr();
  const recap = weekRecap(state, week, now);
  const days = dates.map((date, i) => {
    const sessions = state.trainings.filter((t) => isCoachRun(t) && t.date === date)
      .sort((a, b) => String(a.time).localeCompare(String(b.time)))
      .map((t) => {
        const group = t.groupId ? koutsiGroupById(state, t.groupId) : null;
        const status = sessionStatus(t, group, now);
        const themeMissing = Boolean(group) && !koutsiGroupThemeForWeek(group, koutsiIsoWeekOfDateStr(t.date));
        return { id: t.id, status, themeMissing };
      });
    return { date, label: DAY_SHORT[i], day: Number(date.slice(8, 10)), isToday: date === today, isPast: date < today, sessions };
  });
  const ownLogs = state.trainings.filter((t) => t.loggedBy === 'player' && t.date >= dates[0] && t.date <= dates[6] && t.date <= today);

  // Training days this week per player: sessions they were at (held) and their own logs.
  const count = new Map();
  const bump = (id, date) => { if (!count.has(id)) count.set(id, new Set()); count.get(id).add(date); };
  state.trainings.filter((t) => isCoachRun(t) && t.date >= dates[0] && t.date <= dates[6]).forEach((t) => {
    const group = t.groupId ? koutsiGroupById(state, t.groupId) : null;
    if (sessionStatus(t, group, now) !== 'past') return;
    sessionRoster(state, t).forEach((s) => { if (!absentFrom(t, s.id)) bump(s.id, t.date); });
  });
  ownLogs.forEach((t) => bump(t.studentId, `${t.date}-own-${t.id}`));
  const active = [...count.entries()]
    .map(([id, set]) => ({ student: state.students.find((s) => s.id === id), times: set.size }))
    .filter((x) => x.student && x.times >= 2)
    .sort((a, b) => b.times - a.times || a.student.name.localeCompare(b.student.name, 'fi'))
    .slice(0, 3);

  // Who missed both of their last two held sessions (any group).
  const held = state.trainings.filter((t) => isCoachRun(t) && t.date <= today)
    .filter((t) => sessionStatus(t, t.groupId ? koutsiGroupById(state, t.groupId) : null, now) === 'past')
    .sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  const missedTwice = state.students.filter((s) => {
    const mine = held.filter((t) => sessionRoster(state, t).some((x) => x.id === s.id)).slice(0, 2);
    return mine.length === 2 && mine.every((t) => absentFrom(t, s.id));
  });

  return {
    days,
    held: recap.held,
    sessions: recap.sessions,
    attendance: recap.attendance,
    own: ownLogs.length,
    moodAverage: recap.moodAverage,
    themes: koutsiWeekThemeStatus(state.groups, state.trainings, week, now),
    active,
    missedTwice,
  };
}

function monthRange(year, month) {
  return { first: dayStr(new Date(year, month, 1)), last: dayStr(new Date(year, month + 1, 0)) };
}

/** One player's month → { held, present, rate, own, matches, perWeek, moodAverage, moods }. */
function monthFacts(state, student, year, month, now) {
  const { first, last } = monthRange(year, month);
  const today = dayStr(now);
  const end = last < today ? last : today;
  const mine = state.trainings.filter((t) => t.date >= first && t.date <= end);
  const sessions = mine.filter((t) => isCoachRun(t) && sessionRoster(state, t).some((s) => s.id === student.id)
    && sessionStatus(t, t.groupId ? koutsiGroupById(state, t.groupId) : null, now) === 'past');
  const present = sessions.filter((t) => !absentFrom(t, student.id)).length;
  const own = mine.filter((t) => t.loggedBy === 'player' && t.studentId === student.id).length;
  const matches = (student.matchNotes || []).filter((n) => n.date >= first && n.date <= end).length;
  const days = Math.max(1, Math.round((new Date(`${end}T12:00:00`) - new Date(`${first}T12:00:00`)) / 86400000) + 1);
  const moods = (student.moods || []).filter((m) => { const d = String(m.at || '').slice(0, 10); return d >= first && d <= end; });
  return {
    held: sessions.length,
    present,
    rate: sessions.length ? Math.round((present / sessions.length) * 100) : null,
    own: own + matches,
    perWeek: (present + own + matches) / (days / 7),
    moodAverage: moods.length ? moods.reduce((s, m) => s + m.score, 0) / moods.length : null,
    moods: moods.length,
  };
}

/** This month and the one before, side by side. */
export function playerMonthFacts(state, student, year, month, now = new Date()) {
  const prev = new Date(year, month - 1, 1);
  return { current: monthFacts(state, student, year, month, now), previous: monthFacts(state, student, prev.getFullYear(), prev.getMonth(), now) };
}

/** monthCalendar with the sessions the player missed added as { kind: 'absent' } items. */
export function coachMonthCalendar(state, student, year, month, { hidden, now = new Date() } = {}) {
  const cal = monthCalendar(state, student, year, month, { hidden, now });
  const today = dayStr(now);
  const byDate = new Map(cal.weeks.flat().filter((d) => d.inMonth).map((d) => [d.date, d]));
  state.trainings.filter((t) => isCoachRun(t) && absentFrom(t, student.id) && t.date <= today && byDate.has(t.date)).forEach((t) => {
    const group = t.groupId ? koutsiGroupById(state, t.groupId) : null;
    const a = (t.absences || []).find((x) => x.studentId === student.id);
    byDate.get(t.date).items.push({
      key: `absent-${t.id}`, kind: 'absent', activity: 'tennis', title: group?.name || t.type,
      sub: a?.reportedBy === student.id ? 'Poissa · ilmoitti itse' : 'Poissa', time: t.time || '', minutes: 0,
    });
  });
  return { ...cal, missed: [...byDate.values()].reduce((n, d) => n + d.items.filter((x) => x.kind === 'absent').length, 0) };
}

