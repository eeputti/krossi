// planning.js — Suunnittele: the coach's coming weeks planned ahead.
//   - the theme grid: groups × coming weeks, one cell = one group's theme for one week; the coach
//     picks cells (a week, a group, or one by one) and writes a theme to all of them at once
//   - absences ahead: one player away from many sessions ("Lumi on lomalla kaksi viikkoa")
// Pure: works on the loaded state only, so the demo and the real app plan the same way.
import {
  koutsiAddDays, koutsiAddIsoWeeks, koutsiCompareIsoWeeks, koutsiGroupThemeForWeek, koutsiIsoWeekKey,
  koutsiIsoWeekOfDateStr, koutsiPad, koutsiSortGroupsBySchedule, koutsiStudentById, koutsiThemeKey,
  koutsiTrainingsForStudent, koutsiGroupById, KOUTSI_THEME_TITLE_MAX,
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

// ── Excel-like editing of the theme grid ─────────────────────────────────────
// Cells are addressed by position: r = row (group, schedule order), c = column (week). A change is
// { cell, theme: { title, lead } | null } — null clears the cell. Every write keeps a snapshot of
// what the cells held before, so one "Kumoa" (⌘Z) puts them back.

/** The rectangle between two positions, corners in any order. */
export const rectOf = (a, b) => ({ r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) });

/** Cells inside `rect`; by default only weeks the group trains (a break week is never painted). */
export function cellsIn(rows, rect, { trainingOnly = true } = {}) {
  const out = [];
  for (let r = rect.r0; r <= rect.r1; r += 1) {
    for (let c = rect.c0; c <= rect.c1; c += 1) {
      const cell = rows[r]?.cells[c];
      if (cell && (!trainingOnly || cell.sessions)) out.push(cell);
    }
  }
  return out;
}

/** Where each cell key sits: key → { r, c }. */
export function positions(rows) {
  const out = new Map();
  rows.forEach((row, r) => row.cells.forEach((cell, c) => out.set(cell.key, { r, c })));
  return out;
}

/** The smallest rectangle around the picked keys, or null when nothing is picked. */
export function boundsOf(rows, keys) {
  const pos = positions(rows);
  let rect = null;
  for (const k of keys) {
    const p = pos.get(k);
    if (!p) continue;
    rect = rect ? { r0: Math.min(rect.r0, p.r), r1: Math.max(rect.r1, p.r), c0: Math.min(rect.c0, p.c), c1: Math.max(rect.c1, p.c) } : { r0: p.r, r1: p.r, c0: p.c, c1: p.c };
  }
  return rect;
}

/** The picked rectangle if the pick is one solid block (every training cell in it picked), else null. */
export function pickedRect(rows, keys) {
  const set = keys instanceof Set ? keys : new Set(keys);
  if (!set.size) return null;
  const rect = boundsOf(rows, set);
  if (!rect) return null;
  return cellsIn(rows, rect).every((c) => set.has(c.key)) ? rect : null;
}

/** A theme written over a cell keeps the cell's own lead when the title stays the same. */
export function withLead(cell, theme) {
  if (!theme) return null;
  const title = (theme.title || '').trim().slice(0, KOUTSI_THEME_TITLE_MAX);
  if (!title) return null;
  const lead = (theme.lead || '').trim();
  if (!lead && cell.theme && koutsiThemeKey(cell.theme.title) === koutsiThemeKey(title)) return { title, lead: cell.theme.lead || '' };
  return { title, lead };
}

/** Only the changes that change something. */
export function effectiveChanges(changes) {
  return changes.filter(({ cell, theme }) => (theme
    ? !(cell.theme && cell.theme.title === theme.title && (cell.theme.lead || '') === (theme.lead || ''))
    : Boolean(cell.theme)));
}

/** Rows to save and theme ids to remove for a list of (effective) changes. */
export function changesToWrites(changes) {
  const save = [];
  const remove = [];
  for (const { cell, theme } of changes) {
    if (theme) save.push({ groupId: cell.group.id, year: cell.week.year, week: cell.week.week, title: theme.title, lead: theme.lead || '' });
    else if (cell.theme) remove.push(cell.theme.id);
  }
  return { save, remove };
}

/** What the changed cells held before: enough to undo. */
export function snapshotOf(changes) {
  return changes.map(({ cell }) => ({
    groupId: cell.group.id, year: cell.week.year, week: cell.week.week,
    before: cell.theme ? { title: cell.theme.title, lead: cell.theme.lead || '' } : null,
  }));
}

/** Undo against the groups as they are now: put back what was there, remove what was added. */
export function undoWrites(groups, snapshot) {
  const save = [];
  const remove = [];
  for (const s of snapshot) {
    const group = (groups || []).find((g) => g.id === s.groupId);
    if (!group) continue;
    const now = koutsiGroupThemeForWeek(group, s);
    if (s.before) {
      if (!now || now.title !== s.before.title || (now.lead || '') !== s.before.lead) {
        save.push({ groupId: s.groupId, year: s.year, week: s.week, title: s.before.title, lead: s.before.lead });
      }
    } else if (now) remove.push(now.id);
  }
  return { save, remove };
}

/**
 * The fill handle: dragged from the picked block `src` to position `to`, the block grows along one
 * axis (the one dragged further, like Excel) and every new cell copies the source cell at the same
 * offset, so a 2-week pattern repeats. Empty source cells and weeks without training are skipped.
 */
export function fillChanges(rows, src, to) {
  const down = to.r > src.r1 ? to.r - src.r1 : to.r < src.r0 ? to.r - src.r0 : 0;
  const right = to.c > src.c1 ? to.c - src.c1 : to.c < src.c0 ? to.c - src.c0 : 0;
  if (!down && !right) return { rect: src, changes: [] };
  const vertical = Math.abs(down) >= Math.abs(right);
  const rect = vertical
    ? (down > 0 ? { ...src, r1: to.r } : { ...src, r0: to.r })
    : (right > 0 ? { ...src, c1: to.c } : { ...src, c0: to.c });
  const h = src.r1 - src.r0 + 1;
  const w = src.c1 - src.c0 + 1;
  const mod = (n, m) => ((n % m) + m) % m;
  const changes = [];
  for (let r = rect.r0; r <= rect.r1; r += 1) {
    for (let c = rect.c0; c <= rect.c1; c += 1) {
      if (r >= src.r0 && r <= src.r1 && c >= src.c0 && c <= src.c1) continue;
      const cell = rows[r]?.cells[c];
      if (!cell || !cell.sessions) continue;
      const from = rows[src.r0 + mod(r - src.r0, h)].cells[src.c0 + mod(c - src.c0, w)];
      if (!from.theme) continue;
      changes.push({ cell, theme: { title: from.theme.title, lead: from.theme.lead || '' } });
    }
  }
  return { rect, changes };
}

/** The picked cells' themes as a block (rows × weeks); unpicked or empty cells are null. */
export function clipOf(rows, keys) {
  const set = keys instanceof Set ? keys : new Set(keys);
  const rect = boundsOf(rows, set);
  if (!rect) return [];
  const out = [];
  for (let r = rect.r0; r <= rect.r1; r += 1) {
    const line = [];
    for (let c = rect.c0; c <= rect.c1; c += 1) {
      const cell = rows[r].cells[c];
      line.push(set.has(cell.key) && cell.theme ? { title: cell.theme.title, lead: cell.theme.lead || '' } : null);
    }
    out.push(line);
  }
  return out;
}

/** A block as tab-separated text, the way Excel and Google Sheets copy and paste. */
export const clipToText = (clip) => clip.map((line) => line.map((x) => (x ? x.title.replace(/[\t\n\r]+/g, ' ') : '')).join('\t')).join('\n');

/** Text pasted from anywhere (Excel, Sheets, a list) as a block of titles. */
export function clipFromText(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  if (lines.length === 1 && !lines[0].trim()) return [];
  return lines.map((line) => line.split('\t').map((v) => {
    const title = v.trim().replace(/^"(.*)"$/, '$1').trim().slice(0, KOUTSI_THEME_TITLE_MAX);
    return title ? { title, lead: '' } : null;
  }));
}

/**
 * Pasting a block: one value fills every picked cell (Excel's "paste into a selection"); a bigger
 * block lands with its top-left corner at `at`, cell by cell. Empty values never clear a cell, and
 * weeks without training are skipped (the block keeps its shape).
 */
export function pasteChanges(rows, clip, at, pickedCells = []) {
  if (!clip.length || !clip[0].length) return [];
  if (clip.length === 1 && clip[0].length === 1) {
    const value = clip[0][0];
    if (!value) return [];
    const targets = pickedCells.length ? pickedCells : [rows[at.r]?.cells[at.c]].filter(Boolean);
    return targets.map((cell) => ({ cell, theme: withLead(cell, value) })).filter((x) => x.theme);
  }
  const changes = [];
  clip.forEach((line, i) => line.forEach((value, j) => {
    const cell = rows[at.r + i]?.cells[at.c + j];
    if (!value || !cell || !cell.sessions) return;
    changes.push({ cell, theme: withLead(cell, value) });
  }));
  return changes.filter((x) => x.theme);
}
