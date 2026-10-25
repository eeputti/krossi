// planning.js — Suunnittele: the coach's coming weeks planned ahead.
//   - the theme grid: groups × coming weeks, one cell = one group's theme for one week; the coach
//     picks cells (a week, a group, or one by one) and writes a theme to all of them at once
//   - absences ahead: one player away from many sessions ("Lumi on lomalla kaksi viikkoa")
// Pure: works on the loaded state only, so the demo and the real app plan the same way.
import {
  koutsiAddDays, koutsiAddIsoWeeks, koutsiCompareIsoWeeks, koutsiGroupThemeForWeek, koutsiIsoWeekKey,
  koutsiIsoWeekOfDateStr, koutsiPad, koutsiSortGroupsBySchedule, koutsiStudentById, koutsiThemeKey,
  koutsiTrainingsForStudent, koutsiGroupById,
} from './core.js';
import { sessionEnd } from './week.js';

export const GRID_WEEKS = 8;

/** `count` ISO weeks from `start`. */
export function gridWeeks(start, count = GRID_WEEKS) {
  return Array.from({ length: count }, (_, i) => koutsiAddIsoWeeks(start, i));
}

export const cellKey = (groupId, week) => `${groupId}|${koutsiIsoWeekKey(week)}`;

/**
 * One row per group (in schedule order), one cell per week: the theme, whether the group trains
 * that week, and if not why ('break' = a holiday week inside the calendar, 'ended' = past the
 * calendar's last session, so "Jatka kalenteria" comes first).
 */
export function themeGrid(groups, trainings, weeks) {
  const info = new Map();
  for (const t of trainings || []) {
    if (!t.groupId || t.loggedBy === 'player') continue;
    if (!info.has(t.groupId)) info.set(t.groupId, { weeks: new Set(), last: null });
    const entry = info.get(t.groupId);
    entry.weeks.add(koutsiIsoWeekKey(koutsiIsoWeekOfDateStr(t.date)));
    if (!entry.last || t.date > entry.last) entry.last = t.date;
  }
  return koutsiSortGroupsBySchedule(groups || []).map((group) => {
    const entry = info.get(group.id);
    const lastWeek = entry?.last ? koutsiIsoWeekOfDateStr(entry.last) : null;
    const cells = weeks.map((week) => {
      const sessions = Boolean(entry?.weeks.has(koutsiIsoWeekKey(week)));
      const gap = sessions ? null : (lastWeek && koutsiCompareIsoWeeks(week, lastWeek) < 0 ? 'break' : 'ended');
      return { key: cellKey(group.id, week), group, week, theme: koutsiGroupThemeForWeek(group, week), sessions, gap };
    });
    return { group, cells, lastDate: entry?.last || null };
  });
}

/** The cells a row header or a week header selects: only weeks the group actually trains. */
export const trainingCells = (cells) => cells.filter((c) => c.sessions);

/** The theme every picked cell shares (same title), for "Muokkaa": its title and lead, or null. */
export function commonTheme(cells) {
  if (!cells.length || cells.some((c) => !c.theme)) return null;
  const key = koutsiThemeKey(cells[0].theme.title);
  if (cells.some((c) => koutsiThemeKey(c.theme.title) !== key)) return null;
  const lead = cells[0].theme.lead || '';
  return { key, title: cells[0].theme.title, lead, mixedLead: cells.some((c) => (c.theme.lead || '') !== lead) };
}

/**
 * What writing `title` / `lead` to the picked cells does:
 *   fresh    — no theme yet (written insert-only)
 *   replace  — a theme there, changed (after the coach's OK when it is another theme)
 *   conflicts — the cells in `replace` holding a different theme than the one being edited
 *   same     — already exactly this (nothing to write)
 * An empty lead on a cell that already has this title keeps the cell's own lead, like the planner.
 * `editingKey`: the theme the coach opened for editing — renaming it is not a conflict.
 */
export function themeWritePlan(cells, title, lead, editingKey = null) {
  const cleanTitle = (title || '').trim();
  const cleanLead = (lead || '').trim();
  const key = koutsiThemeKey(cleanTitle);
  const out = { fresh: [], replace: [], conflicts: [], same: [] };
  for (const c of cells) {
    const row = { groupId: c.group.id, year: c.week.year, week: c.week.week, title: cleanTitle, lead: cleanLead };
    if (!c.theme) { out.fresh.push(row); continue; }
    const ownLead = c.theme.lead || '';
    const sameTitle = koutsiThemeKey(c.theme.title) === key;
    const lead2 = sameTitle && !cleanLead ? ownLead : cleanLead;
    if (c.theme.title === cleanTitle && ownLead === lead2) { out.same.push(row); continue; }
    out.replace.push({ ...row, lead: lead2 });
    const edited = editingKey != null && koutsiThemeKey(c.theme.title) === editingKey;
    // adding a lead where there was none is no clash; overwriting another one is
    if (!edited && (!sameTitle || (ownLead && ownLead !== lead2))) out.conflicts.push(c);
  }
  return out;
}

/** "4 ryhmää · 3 viikkoa" for a set of picked cells. */
export function pickSummary(cells) {
  const groups = new Set(cells.map((c) => c.group.id)).size;
  const weeks = new Set(cells.map((c) => koutsiIsoWeekKey(c.week))).size;
  return { groups, weeks, cells: cells.length };
}

// ── absences ahead ───────────────────────────────────────────────────────────

const pad2 = (n) => koutsiPad(n);
const dateOf = (now) => `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
const timeOf = (now) => `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

/**
 * A player's coach-run sessions that have not ended yet, within `days`, soonest first: the
 * sessions an absence can still be marked for ahead. Each says whether the player is already
 * marked away and whether the player said so themselves (their own "En pääse" carries their id).
 */
export function absenceCandidates(state, studentId, { now = new Date(), days = 42 } = {}) {
  const today = dateOf(now);
  const clock = timeOf(now);
  const limit = koutsiAddDays(today, days);
  return koutsiTrainingsForStudent(state, studentId)
    .filter((t) => t.loggedBy !== 'player' && t.date >= today && t.date <= limit)
    .map((t) => ({ training: t, group: t.groupId ? koutsiGroupById(state, t.groupId) : null }))
    .filter(({ training, group }) => training.date > today || sessionEnd(training, group) > clock)
    .map(({ training, group }) => {
      const entry = (training.absences || []).find((a) => a.studentId === studentId) || null;
      return { training, group, absent: Boolean(entry), byPlayer: Boolean(entry && entry.reportedBy === studentId) };
    });
}

export const ABSENCE_RANGES = [
  { id: 'next', label: 'Seuraava treeni' },
  { id: 'week', label: 'Tämä viikko' },
  { id: '2vk', label: '2 viikkoa' },
  { id: '4vk', label: '4 viikkoa' },
];

/** The candidates a quick range covers: the next one, the rest of this week, or the next 2 / 4 weeks. */
export function absenceRangeIds(candidates, range, now = new Date()) {
  const today = dateOf(now);
  if (range === 'next') return candidates.slice(0, 1).map((c) => c.training.id);
  if (range === 'week') {
    const week = koutsiIsoWeekOfDateStr(today);
    return candidates.filter((c) => koutsiCompareIsoWeeks(koutsiIsoWeekOfDateStr(c.training.date), week) === 0).map((c) => c.training.id);
  }
  const days = range === '2vk' ? 14 : range === '4vk' ? 28 : 0;
  const until = koutsiAddDays(today, days - 1);
  return candidates.filter((c) => c.training.date <= until).map((c) => c.training.id);
}

/** What saving the ticked set changes: sessions to mark away and sessions back to present. */
export function absenceChanges(candidates, selectedIds) {
  const picked = new Set(selectedIds);
  return {
    away: candidates.filter((c) => picked.has(c.training.id) && !c.absent).map((c) => c.training.id),
    back: candidates.filter((c) => !picked.has(c.training.id) && c.absent).map((c) => c.training.id),
  };
}

/** Candidates grouped by ISO week, for the list. */
export function byWeek(candidates) {
  const out = [];
  for (const c of candidates) {
    const week = koutsiIsoWeekOfDateStr(c.training.date);
    const key = koutsiIsoWeekKey(week);
    let bucket = out.find((b) => b.key === key);
    if (!bucket) { bucket = { key, week, items: [] }; out.push(bucket); }
    bucket.items.push(c);
  }
  return out;
}

/**
 * Every absence already known for coming sessions within `days`, by session: the coach's
 * "who is away" overview. Sessions with nobody away are left out.
 */
export function knownAbsences(state, { now = new Date(), days = 28 } = {}) {
  const today = dateOf(now);
  const limit = koutsiAddDays(today, days);
  return (state.trainings || [])
    .filter((t) => t.loggedBy !== 'player' && t.date >= today && t.date <= limit && (t.absences || []).length > 0)
    .sort((a, b) => `${a.date}T${a.time || ''}`.localeCompare(`${b.date}T${b.time || ''}`))
    .map((t) => ({
      training: t,
      group: t.groupId ? koutsiGroupById(state, t.groupId) : null,
      students: (t.absences || []).map((a) => koutsiStudentById(state, a.studentId)).filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, 'fi')),
    }))
    .filter((x) => x.students.length > 0);
}
