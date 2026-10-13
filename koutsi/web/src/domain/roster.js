// roster.js — name matching that guards against one real player becoming two student rows.
// Same rules as the old coach app (koutsiMatchStudents / koutsiExactNameMatch).

const norm = (s) => String(s || '').trim().toLocaleLowerCase('fi');

/** Prefix match on what's typed so far: "p" shows every P, "pa" every Pa. */
export function matchStudents(students, query, { excludeIds, limit = 6 } = {}) {
  const q = norm(query);
  if (!q) return [];
  const excluded = excludeIds ? new Set(excludeIds) : null;
  return (students || []).filter((s) => (!excluded || !excluded.has(s.id)) && norm(s.name).startsWith(q)).slice(0, limit);
}

/**
 * Exact name already on the roster. Every place that can create or rename a student refuses
 * to proceed silently on this: it is exactly how one person ends up as two rows.
 */
export function exactNameMatch(students, name, { excludeIds } = {}) {
  const q = norm(name);
  if (!q) return null;
  const excluded = excludeIds ? new Set(excludeIds) : null;
  return (students || []).find((s) => (!excluded || !excluded.has(s.id)) && norm(s.name) === q) || null;
}

/** Groups of students sharing one exact name (likely duplicates to merge). */
export function duplicateNames(students) {
  const byName = new Map();
  for (const s of students || []) {
    const k = norm(s.name);
    if (!k) continue;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(s);
  }
  return [...byName.values()].filter((list) => list.length > 1);
}

/** Merge order: the side that hasn't claimed an account is the one removed. */
export function mergeSides(a, b) {
  if (!a || !b || a.id === b.id) return null;
  if (a.isPlaceholder) return { keep: b, remove: a };
  if (b.isPlaceholder) return { keep: a, remove: b };
  return null;
}

export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
