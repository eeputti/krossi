// levels.js — "Pelaajien tasot": the coach's own level scale (koutsi_level_scales), how a player's and a
// group's level reads, who sees it, and the grouping of old free-text levels for the switch list in Profiili.
//
// A scale is { kind, size, notes }:
//   kind 'sanat'   — Aloittelija, Keskitaso, Edistynyt, Kilpapelaaja (the old fixed list and the default)
//        'numerot' — 1..size (3–10), a bigger number is a better player
//        'ei'      — the coach doesn't use levels: the level fields hide
//   notes[i]       — the coach's own short words for step i + 1 (optional)
//
// The levels stay text in their old columns: a player '4' or 'Keskitaso', a group '3–4', 'Keskitaso–Edistynyt'
// or 'Kaikki tasot'. A text that isn't on the coach's scale is an "old level": it shows as it is until the
// coach changes it, and the app never converts it by itself — the switch list only groups similar texts so
// the coach can change many at once.

export const WORD_LEVELS = ['Aloittelija', 'Keskitaso', 'Edistynyt', 'Kilpapelaaja'];
export const ALL_LEVELS = 'Kaikki tasot';
export const SCALE_MIN = 3;
export const SCALE_MAX = 10;
export const NOTE_MAX = 60;
/** A player sees their own level only when their age is known and at least this (decided 11.11.2026). */
export const LEVEL_VISIBLE_AGE = 18;
export const DEFAULT_SCALE = Object.freeze({ kind: 'sanat', size: null, notes: [] });

const DASH = '–';
const lower = (s) => String(s ?? '').trim().toLocaleLowerCase('fi');

/** A koutsi_level_scales row or a saved object → a clean scale; anything odd → the default (words). */
export function normalizeScale(raw) {
  if (!raw) return DEFAULT_SCALE;
  const kind = ['sanat', 'numerot', 'ei'].includes(raw.kind) ? raw.kind : 'sanat';
  const size = kind === 'numerot' ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, Number(raw.size) || 0)) : null;
  if (kind === 'numerot' && !Number(raw.size)) return DEFAULT_SCALE;
  const count = kind === 'numerot' ? size : kind === 'sanat' ? WORD_LEVELS.length : 0;
  const notes = Array.from({ length: count }, (_, i) => String(raw.notes?.[i] ?? '').trim().slice(0, NOTE_MAX));
  return { kind, size, notes };
}

/** The scale as it is saved: notes trimmed, trailing empty ones dropped. */
export function scaleForSave(scale) {
  const s = normalizeScale(scale);
  const notes = [...s.notes];
  while (notes.length && !notes[notes.length - 1]) notes.pop();
  return { kind: s.kind, size: s.size, notes };
}

export const usesLevels = (scale) => normalizeScale(scale).kind !== 'ei';

/** [{ value, label, note }] — value is what goes into the level column. */
export function scaleSteps(scale) {
  const s = normalizeScale(scale);
  if (s.kind === 'ei') return [];
  if (s.kind === 'numerot') return Array.from({ length: s.size }, (_, i) => ({ value: String(i + 1), label: String(i + 1), note: s.notes[i] || '' }));
  return WORD_LEVELS.map((w, i) => ({ value: w, label: w, note: s.notes[i] || '' }));
}

/** "Sanat", "Numerot 1–6", "Ei käytössä" — the Profiili row. */
export function scaleSummary(scale) {
  const s = normalizeScale(scale);
  if (s.kind === 'ei') return 'Ei käytössä';
  if (s.kind === 'numerot') return `Numerot 1${DASH}${s.size}`;
  return 'Sanat';
}

/** The step a text is on (case and spaces don't matter), or -1. */
export function stepIndex(scale, text) {
  const t = lower(text);
  if (!t) return -1;
  return scaleSteps(scale).findIndex((s) => lower(s.value) === t);
}

const isAll = (text) => lower(text).includes('kaikki');
const isNumberText = (text) => /^\d{1,2}(\s*[–—-]\s*\d{1,2})?$/.test(String(text ?? '').trim());

/**
 * A group level → 'all', { from, to } (step indexes) or null when it is an old text. A single step is a
 * range of one; the saved form of a range is "a–b" (en dash).
 */
export function parseLevelRange(scale, text) {
  if (!String(text ?? '').trim()) return null;
  if (isAll(text)) return 'all';
  const one = stepIndex(scale, text);
  if (one >= 0) return { from: one, to: one };
  const parts = String(text).split(/\s*[–—]\s*|\s+-\s+|(?<=\d)\s*-\s*(?=\d)/);
  if (parts.length !== 2) return null;
  const a = stepIndex(scale, parts[0]);
  const b = stepIndex(scale, parts[1]);
  if (a < 0 || b < 0) return null;
  return { from: Math.min(a, b), to: Math.max(a, b) };
}

/** The saved text of a range on the scale: "4", "3–4", "Keskitaso–Edistynyt". */
export function rangeValue(scale, from, to) {
  const steps = scaleSteps(scale);
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  if (!steps[a] || !steps[b]) return '';
  return a === b ? steps[a].value : `${steps[a].value}${DASH}${steps[b].value}`;
}

/**
 * How a level reads in the coach's lists: "Taso 4", "Taso 3–4", "Keskitaso", "Kaikki tasot". A text on the
 * scale reads with the step's own spelling ("keskitaso" → "Keskitaso"); an old text reads as it was typed.
 */
export function levelLabel(scale, text) {
  const raw = String(text ?? '').trim();
  if (!raw) return '';
  if (isAll(raw)) return ALL_LEVELS;
  const range = parseLevelRange(scale, raw);
  if (range && range !== 'all') {
    const steps = scaleSteps(scale);
    const v = range.from === range.to ? steps[range.from].value : `${steps[range.from].value}${DASH}${steps[range.to].value}`;
    return normalizeScale(scale).kind === 'numerot' ? `Taso ${v}` : v;
  }
  if (isNumberText(raw)) return `Taso ${raw.replace(/\s*[–—-]\s*/, DASH)}`;
  return raw;
}

/** The coach's note for a single step ("C-tason kilpapelaaja"), or ''. */
export function levelNote(scale, text) {
  const i = stepIndex(scale, text);
  return i >= 0 ? scaleSteps(scale)[i].note : '';
}

/** True when the text is a level on this scale (or "Kaikki tasot" for a group): nothing to switch. */
export function onScale(scale, text, { group = false } = {}) {
  if (!String(text ?? '').trim()) return true;
  if (group) return parseLevelRange(scale, text) !== null;
  return stepIndex(scale, text) >= 0;
}

// ── who sees a level ───────────────────────────────────────

/** A player sees their own level (and their group's) only when their age is known and 18 or more. */
export function playerSeesLevel(student) {
  return typeof student?.age === 'number' && student.age >= LEVEL_VISIBLE_AGE;
}

/** What the coach's level sheet says about the player seeing it. */
export function levelVisibilityText(student) {
  if (student?.isPlaceholder) return 'Ei näy pelaajalle, koska hän ei ole vielä liittynyt.';
  if (playerSeesLevel(student)) return 'Pelaaja näkee tasonsa.';
  if (typeof student?.age === 'number') return 'Ei näy pelaajalle, koska hän on alle 18-vuotias.';
  return 'Ei näy pelaajalle, koska hänen ikäänsä ei ole profiilissa.';
}

// ── old levels: grouping similar texts ─────────────────────

// Known level words, in the order a scale runs. A part of an old text belongs to a family when it starts with
// one of these (lower case): "alottelijat", "aloittaja" → aloittelija; "kilpa", "kilpataso" → kilpapelaaja.
const FAMILIES = [
  { key: 'aloittelija', label: 'Aloittelija', test: /^(aloit|alot|alku|alkee|alkeis|vasta-?alk)/ },
  { key: 'harrastaja', label: 'Harrastaja', test: /^(harrast|amatö|amato|kuntopel|kuntotenn|hobby)/ },
  { key: 'keskitaso', label: 'Keskitaso', test: /^keski/ },
  { key: 'edistynyt', label: 'Edistynyt', test: /^edist/ },
  { key: 'kilpapelaaja', label: 'Kilpapelaaja', test: /^kilpa/ },
];

function partKey(part) {
  const p = lower(part).replace(/\s+/g, ' ');
  if (/^\d{1,2}$/.test(p)) return { key: `n${p.padStart(2, '0')}`, label: p, rank: 100 + Number(p), number: true };
  const fam = FAMILIES.findIndex((f) => f.test.test(p));
  if (fam >= 0) return { key: FAMILIES[fam].key, label: FAMILIES[fam].label, rank: fam };
  return null;
}

/**
 * The family of an old text: "edistynyt / kilpataso" and "edistynyt/kilpataso" → { key: 'edistynyt–kilpapelaaja',
 * label: 'Edistynyt–Kilpapelaaja' }; "kilpa" → Kilpapelaaja; an unknown word ("normi") → its own key.
 */
export function oldLevelFamily(text) {
  const raw = String(text ?? '').trim();
  const parts = raw.split(/\s*[/–—]\s*|\s+-\s+|(?<=\d)\s*-\s*(?=\d)|\s+ja\s+/i).filter(Boolean);
  const keys = parts.length >= 1 && parts.length <= 2 ? parts.map(partKey) : [];
  if (keys.length && keys.every(Boolean)) {
    const [a, b] = keys.length === 2 && keys[1].rank < keys[0].rank ? [keys[1], keys[0]] : keys;
    const label = (k) => (k.number ? k.label : k.label);
    const numbers = keys.every((k) => k.number);
    const text1 = b && b.key !== a.key ? `${label(a)}${DASH}${label(b)}` : label(a);
    return { key: b && b.key !== a.key ? `${a.key}${DASH}${b.key}` : a.key, label: numbers ? `Taso ${text1}` : text1, rank: a.rank };
  }
  const key = `t:${lower(raw).replace(/\s+/g, ' ')}`;
  return { key, label: raw, rank: 1000 };
}

/**
 * The old levels of players or groups as rows for the switch list:
 *   items  [{ id, level }]
 *   split  Set of texts the coach separated ("Erota") — each becomes a row of its own
 * → [{ key, label, variants: [{ text, ids }], ids }], known words first in scale order, then the rest by size.
 */
export function oldLevelRows(scale, items, { group = false, split = new Set() } = {}) {
  const rows = new Map();
  for (const item of items || []) {
    const text = String(item.level ?? '').trim();
    if (!text || onScale(scale, text, { group })) continue;
    const fam = split.has(text) ? { key: `x:${text}`, label: text, rank: 1000 } : oldLevelFamily(text);
    if (!rows.has(fam.key)) rows.set(fam.key, { key: fam.key, label: fam.label, rank: fam.rank, variants: new Map() });
    const row = rows.get(fam.key);
    if (!row.variants.has(text)) row.variants.set(text, []);
    row.variants.get(text).push(item.id);
  }
  return [...rows.values()].map((r) => {
    const variants = [...r.variants.entries()].map(([text, ids]) => ({ text, ids })).sort((a, b) => b.ids.length - a.ids.length || a.text.localeCompare(b.text, 'fi'));
    return { key: r.key, label: r.label, rank: r.rank, variants, ids: variants.flatMap((v) => v.ids) };
  }).sort((a, b) => a.rank - b.rank || b.ids.length - a.ids.length || a.label.localeCompare(b.label, 'fi'));
}

export const REMOVE_LEVEL = '__poista';

/**
 * What saving the switch list writes: rows × the coach's choice per row key → [{ id, level, before }] for every
 * item whose level changes. A choice is the new level text ('' = keep, REMOVE_LEVEL = clear) or
 * { level, ids, picking }: while the coach picks players themself (picking), only the picked ones move.
 */
export function relabelPlan(rows, choices, items) {
  const before = new Map((items || []).map((i) => [i.id, i.level ?? null]));
  const out = [];
  for (const row of rows) {
    const c = choices[row.key];
    const choice = typeof c === 'string' ? c : c?.level;
    if (!choice) continue;
    const level = choice === REMOVE_LEVEL ? null : choice;
    const picked = typeof c === 'object' && (c?.picking || c?.ids?.length) ? new Set(c.ids || []) : null;
    for (const id of picked ? row.ids.filter((x) => picked.has(x)) : row.ids) {
      const old = before.get(id) ?? null;
      if ((old ?? '') !== (level ?? '')) out.push({ id, level, before: old });
    }
  }
  return out;
}

/** How many old levels a coach has: { players, groups } (the Profiili row's note). */
export function oldLevelCounts(scale, students, groups) {
  const count = (items, group) => (items || []).filter((i) => String(i.level ?? '').trim() && !onScale(scale, i.level, { group })).length;
  return { players: count(students, false), groups: count(groups, true) };
}

/** The steps a scale change would drop that are still in use: "3 pelaajalla on taso 6". */
export function stepsInUse(scale, students, groups) {
  const steps = scaleSteps(scale);
  const used = new Set();
  for (const s of students || []) { const i = stepIndex(scale, s.level); if (i >= 0) used.add(i); }
  for (const g of groups || []) { const r = parseLevelRange(scale, g.level); if (r && r !== 'all') { used.add(r.from); used.add(r.to); } }
  return [...used].sort((a, b) => a - b).map((i) => steps[i]);
}

// ── what a player sees ─────────────────────────────────────

const scalesOf = (state) => state?.levelScales || {};

/**
 * The player's own level as they see it: { label: 'Taso 4', note: 'Hyvä kerhopelaaja' } or null — under 18, no
 * age, no level, or the coach doesn't use levels. With several coaches, the scale the level is on wins.
 */
export function playerLevelView(state, me = state?.students?.[0]) {
  if (!playerSeesLevel(me) || !String(me?.level ?? '').trim()) return null;
  const ids = [state?.coach?.id, ...(state?.coaches || []).map((c) => c.id)].filter(Boolean);
  const scales = (ids.length ? ids : [null]).map((id) => normalizeScale(scalesOf(state)[id]));
  const scale = scales.find((s) => usesLevels(s) && stepIndex(s, me.level) >= 0) || scales[0];
  if (!usesLevels(scale)) return null;
  return { label: levelLabel(scale, me.level), note: levelNote(scale, me.level) };
}

/** A group's level as its player sees it ("Taso 3–4"), or '' under the same rule. */
export function playerGroupLevel(state, group, me = state?.students?.[0]) {
  if (!group || !playerSeesLevel(me)) return '';
  const scale = normalizeScale(scalesOf(state)[group.coachId]);
  return usesLevels(scale) ? levelLabel(scale, group.level) : '';
}

/** Moving picked players to one level ('' = nothing, REMOVE_LEVEL = clear) → [{ id, level, before }] that change. */
export function movePlan(ids, choice, items) {
  if (!choice || !ids?.length) return [];
  const level = choice === REMOVE_LEVEL ? null : choice;
  const byId = new Map((items || []).map((i) => [i.id, i.level ?? null]));
  return ids.filter((id) => byId.has(id) && (byId.get(id) ?? '') !== (level ?? '')).map((id) => ({ id, level, before: byId.get(id) }));
}

/** The coach's players on each step of the scale and with no level: [{ value, label, note, ids }] + { none }. */
export function playersByStep(scale, students) {
  const steps = scaleSteps(scale).map((s) => ({ ...s, ids: [] }));
  const none = [];
  for (const st of students || []) {
    const text = String(st.level ?? '').trim();
    if (!text) { none.push(st.id); continue; }
    const i = stepIndex(scale, text);
    if (i >= 0) steps[i].ids.push(st.id);
  }
  return { steps, none };
}
