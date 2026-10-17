// board.js — Viikkohallinta: the coach's week as a time grid. Every coach-run session of the
// week (groups and private lessons) plus the scheduled group sessions that are missing, each
// with where it stands — held, fine, or something missing (no theme, no players, the calendar
// runs out) — the club events over the days, and the hours the grid needs, with long empty
// stretches folded away so one early session doesn't stretch the whole week.
// Pure functions over the loaded state (see week.js for groupWeekBoard, which this builds on).

import { koutsiGroupThemeForWeek, koutsiStudentById, koutsiTodayStr } from './core.js';
import { groupWeekBoard, sessionStatus, weekDates } from './week.js';

const toMin = (hhmm) => {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

export const ISSUE_LABELS = {
  theme: 'Ei teemaa',
  players: 'Ei pelaajia',
  last: 'Kalenteri loppuu',
  ended: 'Kalenteri loppunut',
  none: 'Ei treenejä kalenterissa',
};
const issue = (id) => ({ id, label: ISSUE_LABELS[id] });

/** The last coach-run session date of every group, for "the calendar runs out here". */
function lastSessionDates(state) {
  const last = new Map();
  for (const t of state.trainings) {
    if (!t.groupId || t.loggedBy === 'player') continue;
    if (!last.has(t.groupId) || t.date > last.get(t.groupId)) last.set(t.groupId, t.date);
  }
  return last;
}

/** Side by side when sessions overlap: each item gets lane (0…) and lanes (how many share). */
export function assignLanes(items) {
  const sorted = items.slice().sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster = [];
  let clusterEnd = -1;
  let laneEnds = [];
  const close = () => { cluster.forEach((it) => { it.lanes = laneEnds.length; }); };
  for (const it of sorted) {
    if (it.start >= clusterEnd && cluster.length) { close(); cluster = []; laneEnds = []; }
    let lane = laneEnds.findIndex((end) => end <= it.start);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(it.end); } else laneEnds[lane] = it.end;
    it.lane = lane;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) close();
  return sorted;
}

const FOLD_MIN_HOURS = 3;
const MIN_SPAN_HOURS = 4;

/**
 * The hours the grid shows: from the first start to the last end (whole hours, at least four),
 * with every run of three or more empty hours between sessions folded into one thin band.
 * rows: [{ type: 'hours' | 'fold', from, to }] (hours of the day); at(minute) → { h, g }: the
 * visible hours and the folds above that minute, for `calc(h * hour + g * fold)`.
 */
export function gridHours(intervals) {
  let startH = 16;
  let endH = 20;
  if (intervals.length) {
    startH = Math.floor(Math.min(...intervals.map((x) => x.start)) / 60);
    endH = Math.ceil(Math.max(...intervals.map((x) => x.end)) / 60);
  }
  endH = Math.min(24, Math.max(endH, startH + MIN_SPAN_HOURS));
  startH = Math.max(0, Math.min(startH, endH - MIN_SPAN_HOURS));
  const busy = [];
  for (let h = startH; h < endH; h += 1) busy.push(intervals.some((x) => x.start < (h + 1) * 60 && x.end > h * 60));
  const rows = [];
  let h = startH;
  while (h < endH) {
    const i = h - startH;
    let j = i;
    while (j < busy.length && busy[j] === busy[i]) j += 1;
    const from = h;
    const to = startH + j;
    // only a gap with sessions on both sides is folded; the edges are whole hours anyway
    const inner = !busy[i] && i > 0 && j < busy.length;
    rows.push({ type: inner && to - from >= FOLD_MIN_HOURS ? 'fold' : 'hours', from, to });
    h = to;
  }
  const merged = rows.reduce((out, r) => {
    const prev = out[out.length - 1];
    if (prev && prev.type === 'hours' && r.type === 'hours') prev.to = r.to; else out.push({ ...r });
    return out;
  }, []);
  const at = (minute) => {
    let hours = 0;
    let folds = 0;
    for (const r of merged) {
      if (minute >= r.to * 60) { if (r.type === 'fold') folds += 1; else hours += r.to - r.from; continue; }
      if (r.type === 'hours') hours += Math.max(0, minute - r.from * 60) / 60;
      break;
    }
    return { h: hours, g: folds };
  };
  return { startH, endH, rows: merged, at, hours: merged.reduce((n, r) => n + (r.type === 'hours' ? r.to - r.from : 0), 0), folds: merged.filter((r) => r.type === 'fold').length };
}

/** Club events of the week as bars over the days: { event, from, to (day index 0–6), row }. */
export function weekEvents(state, dates) {
  const first = dates[0];
  const last = dates[6];
  const bars = (state.clubEvents || [])
    .filter((e) => e.date <= last && (e.endDate || e.date) >= first)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || (b.endDate || b.date).localeCompare(a.endDate || a.date))
    .map((event) => ({
      event,
      from: Math.max(0, dates.indexOf(event.date < first ? first : event.date)),
      to: Math.min(6, dates.indexOf((event.endDate || event.date) > last ? last : (event.endDate || event.date))),
    }));
  const rowEnds = [];
  for (const b of bars) {
    let row = rowEnds.findIndex((end) => end < b.from);
    if (row < 0) { row = rowEnds.length; rowEnds.push(b.to); } else rowEnds[row] = b.to;
    b.row = row;
  }
  return { bars, rows: rowEnds.length };
}

/**
 * The week for Viikkohallinta.
 *   days: [{ date, items }] — items by time, each { key, kind: 'group' | 'private' | 'missing',
 *     group, student, training, date, time, durationMinutes, start, end, status ('past' | 'now' |
 *     'upcoming'), tone ('ok' | 'issue' | 'past' | 'missing'), issues, theme, members, absent,
 *     why (missing only), lane, lanes }
 *   loose: groups with no weekday and no session this week
 *   events: weekEvents(), grid: gridHours(), sessions: how many real sessions, issues: how many
 *   items need something
 */
export function weekBoard(state, week, now = new Date()) {
  const dates = weekDates(week);
  const today = koutsiTodayStr();
  const base = groupWeekBoard(state, week);
  const lastOf = lastSessionDates(state);
  const theme = (group) => koutsiGroupThemeForWeek(group, week);
  const days = base.days.map((d) => ({ date: d.date, items: [] }));

  base.days.forEach((d, i) => {
    for (const it of d.items) {
      const { group, training } = it;
      const durationMinutes = it.durationMinutes || group.durationMinutes || 60;
      const start = toMin(it.time);
      const item = {
        key: `${group.id}-${training?.id || `${d.date}-${it.time}`}`, kind: it.missing ? 'missing' : 'group',
        group, student: null, training, date: d.date, time: it.time, durationMinutes, start, end: Math.min(24 * 60, start + durationMinutes),
        theme: theme(group), members: group.memberIds.length, absent: training ? (training.absences || []).length : 0, why: it.why || null,
      };
      const issues = [];
      if (it.missing) {
        item.status = d.date < today ? 'past' : 'upcoming';
        if (d.date >= today) {
          if (it.why === 'none') issues.push(issue('none'));
          else if (it.why === 'week' && !(lastOf.get(group.id) > dates[6])) issues.push(issue('ended'));
        }
        item.tone = issues.length ? 'issue' : 'missing';
      } else {
        item.status = sessionStatus(training, group, now);
        if (item.status !== 'past') {
          if (!item.theme) issues.push(issue('theme'));
          if (!item.members) issues.push(issue('players'));
          if (lastOf.get(group.id) === training.date) issues.push(issue('last'));
        }
        item.tone = item.status === 'past' ? 'past' : issues.length ? 'issue' : 'ok';
      }
      item.issues = issues;
      days[i].items.push(item);
    }
  });

  // private lessons and other one-player sessions the coach runs
  for (const t of state.trainings) {
    if (t.groupId || !t.studentId || t.loggedBy === 'player') continue;
    const i = dates.indexOf(t.date);
    if (i < 0) continue;
    const durationMinutes = t.durationMinutes || 60;
    const start = toMin(t.time);
    const status = sessionStatus(t, null, now);
    days[i].items.push({
      key: `p-${t.id}`, kind: 'private', group: null, student: koutsiStudentById(state, t.studentId), training: t, date: t.date, time: t.time,
      durationMinutes, start, end: Math.min(24 * 60, start + durationMinutes), theme: null, members: 1, absent: (t.absences || []).length,
      status, tone: status === 'past' ? 'past' : 'ok', issues: [], why: null,
    });
  }

  days.forEach((d) => { d.items = assignLanes(d.items); });
  const all = days.flatMap((d) => d.items);
  return {
    days,
    loose: base.loose,
    events: weekEvents(state, dates),
    grid: gridHours(all),
    sessions: all.filter((it) => it.training).length,
    issues: all.filter((it) => it.tone === 'issue').length,
  };
}
