// levels.js — "Pelaajien tasot": the coach's own level scale (koutsi_level_scales) and writing many levels at
// once. The levels themselves stay in koutsi_students.level and koutsi_groups.level (domain/levels.js).
import { db, must } from './client.js';
import { scaleForSave } from '../../domain/levels.js';

const from = (table) => db().from(table);

/** [{ id, level }] → Map(level → ids), so each new value is one update. */
function byLevel(rows) {
  const out = new Map();
  for (const r of rows || []) {
    const key = r.level ?? null;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(r.id);
  }
  return out;
}

async function writeIn(table, rows, extra) {
  for (const [level, ids] of byLevel(rows)) {
    for (let i = 0; i < ids.length; i += 100) {
      let q = from(table).update({ level }).in('id', ids.slice(i, i + 100));
      if (extra) q = extra(q);
      must(await q);
    }
  }
}

export const levels = {
  async saveScale(coachId, scale) {
    const s = scaleForSave(scale);
    must(await from('koutsi_level_scales').upsert({
      coach_id: coachId, kind: s.kind, size: s.size, notes: s.notes, updated_at: new Date().toISOString(),
    }, { onConflict: 'coach_id' }));
  },
  async relabel(coachId, { students = [], groups = [] } = {}) {
    await writeIn('koutsi_students', students);
    await writeIn('koutsi_groups', groups, (q) => q.eq('coach_id', coachId));
  },
};
