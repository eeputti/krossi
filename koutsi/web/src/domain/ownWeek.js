// ownWeek.js — the player's week (Treenit): the coach's sessions and the player's own logs on one
// time grid, the same look as the coach's Viikkohallinta. Pure functions over the player state.
//
// A player's own log is a normal koutsi_trainings row (logged_by 'player'). Its `type` stays one
// of the old app's categories (Omatoiminen harjoitus / Fysiikka / Muu liikunta / Turnaus), so the
// old app and every coach view keep reading it as before. What exactly was done ("Lenkki",
// "Kuntosali", "Liikkuvuus", "Kotiläksy") is the first word of `notes`: "Lenkki — 5 km".

import { koutsiCoachById, koutsiGroupById, koutsiThemeForDate, koutsiTodayStr, koutsiTrainingsForStudent, koutsiPad } from './core.js';
import { sessionStatus, weekDates } from './week.js';
import { assignLanes } from './board.js';

/** What a player can log. `word` goes first in notes; `hidden` shows only when editing such a row. */
export const ACTIVITIES = [
  { id: 'tennis', label: 'Tennis', title: 'Omatoiminen tennis', type: 'Omatoiminen harjoitus', icon: 'racket', placeholder: 'Esim. Syöttöjä seinää vasten, lyöntejä kaverin kanssa.', duration: 60 },
  { id: 'lenkki', label: 'Lenkki', title: 'Lenkki', type: 'Fysiikka', word: 'Lenkki', icon: 'run', placeholder: 'Esim. 5 km rauhallisesti.', duration: 30 },
  { id: 'sali', label: 'Kuntosali', title: 'Kuntosali', type: 'Fysiikka', word: 'Kuntosali', icon: 'dumbbell', placeholder: 'Esim. Jalat ja keskivartalo.', duration: 60 },
  { id: 'liikkuvuus', label: 'Liikkuvuus', title: 'Liikkuvuus', type: 'Fysiikka', word: 'Liikkuvuus', icon: 'stretch', placeholder: 'Esim. Venyttely ja rullaus.', duration: 30 },
  { id: 'muu', label: 'Muu laji', title: 'Muu laji', type: 'Muu liikunta', icon: 'sport', placeholder: 'Esim. Sulkapallo, uinti, pyöräily.', duration: 60 },
  { id: 'kotilaksy', label: 'Kotiläksy', title: 'Kotiläksy', type: 'Omatoiminen harjoitus', word: 'Kotiläksy', icon: 'book', placeholder: '', duration: 30, homework: true },
  { id: 'ottelu', label: 'Ottelu', title: 'Ottelu', icon: 'trophy', match: true },
  { id: 'turnaus', label: 'Turnaus', title: 'Turnaus', type: 'Turnaus', icon: 'medal', placeholder: 'Esim. Piirinmestaruuskisat, Lahti.', allDay: true },
  { id: 'fysiikka', label: 'Fysiikka', title: 'Fysiikka', type: 'Fysiikka', icon: 'dumbbell', placeholder: 'Esim. Kuntosali, juoksu, liikkuvuus.', duration: 60, hidden: true },
];
export const activityById = (id) => ACTIVITIES.find((a) => a.id === id) || ACTIVITIES[0];

const WORDS = ACTIVITIES.filter((a) => a.word).map((a) => a.word);
const WORD_RE = new RegExp(`^(${WORDS.join('|')})(?:\\s*[—–-]\\s*([\\s\\S]*))?$`);
const BY_TYPE = { 'Omatoiminen harjoitus': 'tennis', Fysiikka: 'fysiikka', 'Muu liikunta': 'muu', Turnaus: 'turnaus' };

/** A logged row read back: { activity, title, text } — "Lenkki — 5 km" → lenkki, "Lenkki", "5 km". */
export function ownEntry(training) {
  const notes = String(training.notes || '').trim();
  const m = WORD_RE.exec(notes);
  if (m) {
    const activity = ACTIVITIES.find((a) => a.word === m[1]);
    return { activity: activity.id, title: activity.title, text: (m[2] || '').trim() };
  }
  const activity = activityById(BY_TYPE[training.type] || 'tennis');
  if (activity.id === 'turnaus') return { activity: 'turnaus', title: notes || 'Turnaus', text: '' };
  return { activity: activity.id, title: activity.title, text: notes };
}

/** The notes column for an activity and the player's own words. */
export function ownNotes(activityId, text) {
  const a = activityById(activityId);
  const t = String(text || '').trim();
  if (a.word) return t ? `${a.word} — ${t}` : a.word;
  return t;
}

const toMin = (hhmm) => {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
export const toHHMM = (minute) => `${koutsiPad(Math.floor(minute / 60))}:${koutsiPad(minute % 60)}`;

/**
 * The hours the player's grid shows: a plain day from 8 to 21 (wider when something falls
 * outside), never folded — an empty evening is exactly where a run gets logged.
 * Same shape as board.js gridHours, plus minuteAt(px, hourPx) for a tap on the grid.
 */
export function dayGrid(intervals, from = 8, to = 21) {
  let startH = from;
  let endH = to;
  for (const x of intervals) {
    startH = Math.min(startH, Math.floor(x.start / 60));
    endH = Math.max(endH, Math.ceil(x.end / 60));
  }
  startH = Math.max(0, startH);
  endH = Math.min(24, endH);
  const hours = endH - startH;
  const at = (minute) => ({ h: Math.min(hours, Math.max(0, (minute - startH * 60) / 60)), g: 0 });
  /** The quarter hour under a tap `px` from the grid's top, for logging at that time. */
  const minuteAt = (px, hourPx) => {
    const minute = startH * 60 + Math.floor(((px / hourPx) * 60) / 15) * 15;
    return Math.min(endH * 60 - 15, Math.max(startH * 60, minute));
  };
  return { startH, endH, rows: [{ type: 'hours', from: startH, to: endH }], at, minuteAt, hours, folds: 0 };
}

/** Bars over the days ({ from, to, before, after, row }), each in the first row it fits. */
export function layBars(list, dates) {
  const first = dates[0];
  const last = dates[6];
  const bars = list
    .filter((b) => b.date <= last && (b.endDate || b.date) >= first)
    .sort((a, b) => a.date.localeCompare(b.date) || (b.endDate || b.date).localeCompare(a.endDate || a.date))
    .map((b) => {
      const end = b.endDate || b.date;
      return {
        ...b,
        from: dates.indexOf(b.date < first ? first : b.date),
        to: dates.indexOf(end > last ? last : end),
        before: b.date < first,
        after: end > last,
      };
    });
  const rowEnds = [];
  for (const b of bars) {
    let row = rowEnds.findIndex((end) => end < b.from);
    if (row < 0) { row = rowEnds.length; rowEnds.push(b.to); } else rowEnds[row] = b.to;
    b.row = row;
  }
  return { bars, rows: rowEnds.length };
}

/**
 * The player's week.
 *   days: [{ date, items }] — timed items by time, each { key, kind: 'coach' | 'own', training,
 *     group, coach, theme, date, time, durationMinutes, start, end, status, absent, tone
 *     ('ok' | 'past' | 'absent' | 'own'), title, text, activity (own only), lane, lanes }
 *   allDay: layBars() of club events, the player's tournaments and match notes — each bar
 *     { key, kind: 'event' | 'tournament' | 'match', title, sub, date, endDate, event | training | note }
 *   grid: dayGrid(), summary: { coach, attended, absent, own, ownMinutes, matches }
 */
export function playerWeek(state, student, week, now = new Date()) {
  const dates = weekDates(week);
  const days = dates.map((date) => ({ date, items: [] }));
  const allDay = [];
  const summary = { coach: 0, attended: 0, absent: 0, own: 0, ownMinutes: 0, matches: 0 };

  for (const t of koutsiTrainingsForStudent(state, student.id)) {
    const own = t.loggedBy === 'player';
    if (own && t.studentId !== student.id) continue;
    if (own && t.type === 'Turnaus') {
      const e = ownEntry(t);
      allDay.push({ key: `t-${t.id}`, kind: 'tournament', title: e.title, sub: 'Turnaus', date: t.date, endDate: t.endDate || null, training: t });
      if (t.date >= dates[0] && t.date <= dates[6]) summary.own += 1;
      continue;
    }
    const i = dates.indexOf(t.date);
    if (i < 0) continue;
    const group = t.groupId ? koutsiGroupById(state, t.groupId) : null;
    const durationMinutes = t.durationMinutes || group?.durationMinutes || 60;
    const start = toMin(t.time);
    const base = { training: t, group, date: t.date, time: t.time, durationMinutes, start, end: Math.min(24 * 60, start + durationMinutes) };
    if (own) {
      const e = ownEntry(t);
      summary.own += 1;
      summary.ownMinutes += t.durationMinutes || 0;
      days[i].items.push({ ...base, key: `o-${t.id}`, kind: 'own', tone: 'own', status: null, absent: false, coach: null, theme: null, ...e });
      continue;
    }
    const status = sessionStatus(t, group, now);
    const absent = (t.absences || []).some((a) => a.studentId === student.id);
    summary.coach += 1;
    if (absent) summary.absent += 1;
    else if (status === 'past') summary.attended += 1;
    days[i].items.push({
      ...base, key: `c-${t.id}`, kind: 'coach', status, absent,
      tone: absent ? 'absent' : status === 'past' ? 'past' : 'ok',
      coach: koutsiCoachById(state, t.coachId), theme: group ? koutsiThemeForDate(group, t.date) : null,
      title: group ? group.name : t.type, text: group ? t.type : '',
    });
  }

  for (const n of student.matchNotes || []) {
    if (n.date < dates[0] || n.date > dates[6]) continue;
    summary.matches += 1;
    const result = n.result === 'voitto' ? 'Voitto' : n.result === 'tappio' ? 'Tappio' : '';
    allDay.push({ key: `m-${n.id}`, kind: 'match', title: `Ottelu vs. ${n.opponentName}`, sub: [result, n.score].filter(Boolean).join(', ') || 'Ottelu', date: n.date, endDate: null, note: n });
  }
  for (const e of state.clubEvents || []) {
    allDay.push({ key: `e-${e.id}`, kind: 'event', title: e.title, sub: null, date: e.date, endDate: e.endDate || null, event: e });
  }

  days.forEach((d) => { d.items = assignLanes(d.items); });
  const all = days.flatMap((d) => d.items);
  return { days, allDay: layBars(allDay, dates), grid: dayGrid(all), summary };
}

/** Where a new log starts by default: an hour ago today (it was just done), 17:00 on other days. */
export function defaultLogTime(date, now = new Date(), today = koutsiTodayStr()) {
  if (date !== today) return '17:00';
  const minute = Math.max(6 * 60, Math.floor((now.getHours() * 60 + now.getMinutes() - 60) / 15) * 15);
  return toHHMM(minute);
}
