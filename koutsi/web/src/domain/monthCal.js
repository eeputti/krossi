// monthCal.js — the player's month calendar (Kehitys → Kalenteri): what was done on each day,
// as pure functions. A day shows the coach's sessions the player was at, their own logs (tennis,
// a run, the gym …), matches, tournaments and own Kehitys entries. Archived items stay out.
// Coach sessions carry groupId + trainingId so the coach's view can open the group.

import { koutsiAddDays, koutsiDateFromStr, koutsiGroupById, koutsiPad, koutsiTrainingsForStudent, KOUTSI_MONTHS } from './core.js';
import { activityById, ownEntry } from './ownWeek.js';

const dayStr = (d) => `${d.getFullYear()}-${koutsiPad(d.getMonth() + 1)}-${koutsiPad(d.getDate())}`;

/** Everything done on each day of a date range: Map(date → [item]); items keep timeline keys. */
export function doneByDay(state, student, from, to, { hidden = new Set(), today } = {}) {
  const end = today && today < to ? today : to;
  const days = new Map();
  const add = (date, item) => {
    if (date < from || date > end || hidden.has(item.key)) return;
    if (!days.has(date)) days.set(date, []);
    days.get(date).push(item);
  };
  for (const t of koutsiTrainingsForStudent(state, student.id)) {
    const key = `training-${t.id}`;
    if (t.loggedBy === 'player') {
      if (t.studentId !== student.id) continue;
      const e = ownEntry(t);
      if (e.activity === 'turnaus') {
        for (let d = t.date; d <= (t.endDate || t.date); d = koutsiAddDays(d, 1)) add(d, { key, kind: 'tournament', activity: 'turnaus', title: e.title, sub: 'Turnaus', time: '' });
        continue;
      }
      add(t.date, { key, kind: 'own', activity: e.activity, title: e.title, sub: [t.durationMinutes ? `${t.durationMinutes}\u00a0min` : '', e.text].filter(Boolean).join(', '), time: t.time || '', minutes: t.durationMinutes || 0 });
      continue;
    }
    if ((t.absences || []).some((a) => a.studentId === student.id)) continue;
    const group = t.groupId ? koutsiGroupById(state, t.groupId) : null;
    add(t.date, { key, kind: 'coach', activity: 'tennis', title: group?.name || t.type, sub: group ? t.type : 'Valmennus', time: t.time || '', minutes: t.durationMinutes || group?.durationMinutes || 0, groupId: group?.id || null, trainingId: t.id });
  }
  for (const n of student.matchNotes || []) {
    const result = n.result === 'voitto' ? 'Voitto' : n.result === 'tappio' ? 'Tappio' : '';
    add(n.date, { key: `match-${n.id}`, kind: 'match', activity: 'ottelu', title: `Ottelu vs. ${n.opponentName}`, sub: [result, n.score].filter(Boolean).join(', '), time: '', minutes: n.durationMinutes || 0 });
  }
  for (const e of student.entries || []) {
    add(e.date, { key: `entry-${e.id}`, kind: 'entry', activity: 'merkinta', title: 'Oma merkintä', sub: e.text, time: '' });
  }
  for (const list of days.values()) list.sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  return days;
}

/**
 * One month as Monday-first weeks: { year, month, label, weeks: [[{ date, day, inMonth, isToday,
 * isFuture, items }]], activeDays, sessions (coach), own (own logs, matches, tournaments, entries),
 * minutes }.
 */
export function monthCalendar(state, student, year, month, { hidden = new Set(), now = new Date() } = {}) {
  const today = dayStr(now);
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const done = doneByDay(state, student, dayStr(first), dayStr(last), { hidden, today });
  const weeks = [];
  const cursor = new Date(start);
  while (cursor <= last || cursor.getDay() !== 1) {
    if (cursor.getDay() === 1) weeks.push([]);
    const date = dayStr(cursor);
    const inMonth = cursor.getMonth() === month;
    weeks[weeks.length - 1].push({ date, day: cursor.getDate(), inMonth, isToday: date === today, isFuture: date > today, items: inMonth ? (done.get(date) || []) : [] });
    cursor.setDate(cursor.getDate() + 1);
  }
  const all = [...done.values()].flat();
  const name = KOUTSI_MONTHS[month] || '';
  return {
    year, month, label: `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`, weeks,
    activeDays: done.size,
    sessions: all.filter((x) => x.kind === 'coach').length,
    own: all.filter((x) => x.kind !== 'coach').length,
    minutes: all.reduce((s, x) => s + (x.minutes || 0), 0),
  };
}

/** This week Monday–Sunday with what was done each day, for the small card on Kehitys. */
export function weekStrip(state, student, { hidden = new Set(), now = new Date() } = {}) {
  const today = dayStr(now);
  const monday = koutsiDateFromStr(today);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const from = dayStr(monday);
  const to = koutsiAddDays(from, 6);
  const done = doneByDay(state, student, from, to, { hidden, today });
  return Array.from({ length: 7 }, (_, i) => {
    const date = koutsiAddDays(from, i);
    return { date, isToday: date === today, isFuture: date > today, items: done.get(date) || [] };
  });
}

/** The icon name an item shows (ActivityIcon handles own activities; the rest are Icon names). */
export function itemIcon(item) {
  if (item.kind === 'entry') return 'edit';
  if (item.kind === 'match') return 'trophy';
  if (item.kind === 'tournament') return 'medal';
  return activityById(item.activity).icon;
}
