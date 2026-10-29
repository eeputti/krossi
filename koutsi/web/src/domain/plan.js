// plan.js — "treenin runko": the drills a coach plans for one session, in four parts that run
// in order (Lämmittely → Harjoitteet → Peli → Loppu), and the minutes they add up to.
//
// The plan is kept in the session row's free-text `notes` (koutsi_trainings.notes). No screen
// shows that field for a coach's session — the old app and this one show it only on a player's
// own logs — so the plan needs no new column, players of the group can already read it (RLS),
// and the old app does not change. Editing a session's notes fires no notification.
//
// Stored text: JSON { runko: 1, osat: [{ osa, ref, lib?, name, cat, min }], teksti? }
//   osa    — the part (PLAN_PARTS id)
//   ref    — the drill's key in buildDrillList: an own row's id, or 'k-<library id>'
//   lib    — the library id when the drill has a library twin, so a saved copy that is later
//            removed (or a library drill saved later) still finds its picture
//   name, cat — shown even if the drill is gone or the library has not loaded yet
//   min    — the coach's minutes for it in this session (starts at the drill's own)
//   teksti — whatever text the row held before the plan, given back when the plan is emptied
//
// In memory: { items: [{ part, ref, lib, name, cat, minutes }], note } with items in part order.
import { CATEGORY, LEVELS } from './drills/index.js';

export const PLAN_PARTS = [
  { id: 'lammittely', label: 'Lämmittely', add: 'Lisää lämmittely', cat: 'lammittely' },
  { id: 'harjoitteet', label: 'Harjoitteet', add: 'Lisää harjoite', cat: '' },
  { id: 'peli', label: 'Peli', add: 'Lisää peli', cat: 'pistepeli' },
  { id: 'loppu', label: 'Loppu', add: 'Lisää loppuun', cat: 'fysiikka' },
];
export const PLAN_PART = Object.fromEntries(PLAN_PARTS.map((p) => [p.id, p]));
const PART_ORDER = new Map(PLAN_PARTS.map((p, i) => [p.id, i]));

export const MAX_PLAN_ITEMS = 12;
export const MINUTES_STEP = 5;
export const MAX_ITEM_MINUTES = 90;

const EMPTY = Object.freeze({ items: Object.freeze([]), note: '' });

const clampMinutes = (n) => Math.max(1, Math.min(MAX_ITEM_MINUTES, Math.round(Number(n) || 0) || 10));
const nameKey = (name) => String(name || '').trim().toLocaleLowerCase('fi').replace(/[–—-]/g, '-').replace(/\s+/g, ' ');

function sortItems(items) {
  return items.map((it, i) => ({ it, i }))
    .sort((a, b) => (PART_ORDER.get(a.it.part) - PART_ORDER.get(b.it.part)) || a.i - b.i)
    .map(({ it }) => it);
}

/** The plan held in a session's notes ({ items: [], note } when it has none; free text stays as `note`). */
export function readPlan(notes) {
  const text = typeof notes === 'string' ? notes : notes?.notes || '';
  if (!text.trim().startsWith('{')) return { items: [], note: text };
  let data;
  try { data = JSON.parse(text); } catch { return { items: [], note: text }; }
  if (!data || data.runko !== 1 || !Array.isArray(data.osat)) return { items: [], note: text };
  const items = data.osat
    .filter((o) => o && PART_ORDER.has(o.osa) && typeof o.name === 'string' && o.name.trim())
    .slice(0, MAX_PLAN_ITEMS)
    .map((o) => ({
      part: o.osa, ref: String(o.ref || ''), lib: o.lib ? String(o.lib) : null, name: o.name.trim(),
      cat: CATEGORY[o.cat] ? o.cat : null, minutes: clampMinutes(o.min),
    }));
  return { items: sortItems(items), note: typeof data.teksti === 'string' ? data.teksti : '' };
}

/** The text a plan is saved as; an emptied plan gives back the row's earlier text (or null). */
export function writePlan(plan) {
  const items = sortItems(plan?.items || []);
  if (items.length === 0) return plan?.note ? plan.note : null;
  const data = {
    runko: 1,
    osat: items.map((it) => ({ osa: it.part, ref: it.ref, ...(it.lib ? { lib: it.lib } : {}), name: it.name, cat: it.cat || null, min: it.minutes })),
  };
  if (plan.note) data.teksti = plan.note;
  return JSON.stringify(data);
}

/** Does the session have a plan with drills in it? */
export const hasPlan = (training) => readPlan(training?.notes).items.length > 0;

/** Minutes the plan adds up to. */
export const planMinutes = (plan) => (plan?.items || []).reduce((sum, it) => sum + (it.minutes || 0), 0);

/** Items of one part, each with its index in the whole plan (what the edit functions take). */
export function partItems(plan, part) {
  return (plan?.items || []).map((item, index) => ({ item, index })).filter(({ item }) => item.part === part);
}

/** A plan entry for a buildDrillList item. */
export function planEntry(drill, part) {
  return {
    part, ref: drill.key, lib: drill.lib?.id || null, name: drill.name, cat: drill.cat || null,
    minutes: clampMinutes(drill.minutes || 10),
  };
}

/** Adds a drill at the end of its part. A full plan stays as it is. */
export function addToPlan(plan, part, drill) {
  const items = plan?.items || [];
  if (items.length >= MAX_PLAN_ITEMS || !PART_ORDER.has(part)) return plan || EMPTY;
  return { ...(plan || EMPTY), items: sortItems([...items, planEntry(drill, part)]) };
}

export function removeFromPlan(plan, index) {
  return { ...plan, items: plan.items.filter((_, i) => i !== index) };
}

export function setPlanMinutes(plan, index, minutes) {
  return { ...plan, items: plan.items.map((it, i) => (i === index ? { ...it, minutes: clampMinutes(minutes) } : it)) };
}

/**
 * Moves an item one place up (-1) or down (+1) in the plan as it reads. At the edge of its part
 * it crosses into the part next to it (the last place of the one above, the first of the one
 * below), so a drill can be moved anywhere with the same two buttons.
 */
export function movePlanItem(plan, index, dir) {
  const items = plan.items;
  const it = items[index];
  if (!it || (dir !== -1 && dir !== 1)) return plan;
  const next = items[index + dir];
  if (next && next.part === it.part) {
    const copy = [...items];
    copy[index] = next;
    copy[index + dir] = it;
    return { ...plan, items: copy };
  }
  const part = PLAN_PARTS[PART_ORDER.get(it.part) + dir];
  if (!part) return plan;
  // Same index in the flat list: it is now the last of the part above / the first of the one below.
  const copy = [...items];
  copy[index] = { ...it, part: part.id };
  return { ...plan, items: copy };
}

/** Can the item move that way? (the first item of Lämmittely can't go up, the last of Loppu can't go down) */
export function canMove(plan, index, dir) {
  const it = plan.items[index];
  if (!it) return false;
  const next = plan.items[index + dir];
  return Boolean((next && next.part === it.part) || PLAN_PARTS[PART_ORDER.get(it.part) + dir]);
}

/**
 * The drill an entry points at in a buildDrillList list: the same key, else the library twin,
 * else a drill with the same name. Null when it is gone (the entry still shows its name).
 */
export function resolvePlanItem(entry, drills) {
  if (!entry || !drills?.length) return null;
  return drills.find((d) => d.key === entry.ref)
    || (entry.lib && (drills.find((d) => d.lib?.id === entry.lib && d.own) || drills.find((d) => d.lib?.id === entry.lib)))
    || drills.find((d) => nameKey(d.name) === nameKey(entry.name))
    || null;
}

/**
 * The drill picker's starting filters for a part of this session: the part's topic, the group
 * (its size on one court, and its level when set), or one player for a private lesson.
 */
export function pickerFilters(part, { group = null, training = null } = {}) {
  const f = { cat: PLAN_PART[part]?.cat || '' };
  if (group?.memberIds?.length) {
    f.group = group.id;
    if (LEVELS.includes(group.level)) f.level = group.level;
  } else if (training?.studentId) {
    f.players = '1';
  }
  return f;
}

/** "4 harjoitetta · 55 min" */
export function planSummary(plan) {
  const n = plan?.items?.length || 0;
  if (n === 0) return 'Ei vielä runkoa';
  return `${n} ${n === 1 ? 'harjoite' : 'harjoitetta'}, ${planMinutes(plan)}\u00a0min`;
}

/**
 * How the plan fits the session's length: null when the length is unknown, else
 * { diff, text } — diff > 0 = that many minutes over.
 */
export function planFit(plan, sessionMinutes) {
  const total = planMinutes(plan);
  if (!sessionMinutes || total === 0) return null;
  const diff = total - sessionMinutes;
  if (diff > 0) return { diff, text: `${diff} min yli treenin ${sessionMinutes} minuutin` };
  if (diff === 0) return { diff, text: `Täsmälleen treenin ${sessionMinutes} min` };
  return { diff, text: `${-diff} min vapaata ${sessionMinutes} minuutista` };
}
