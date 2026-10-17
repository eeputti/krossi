// exercises.js — the drill bank as homework: which drills suit the players a homework is for
// (their group's theme this week, something to do alone at home, a video to watch) and the
// homework text a drill becomes. Pure functions over the loaded state.

import { koutsiThemeForDate, koutsiTodayStr, KOUTSI_TAG_LABELS } from './core.js';

const lower = (s) => (s || '').toLocaleLowerCase('fi');
const words = (s) => lower(s).split(/[^a-z0-9åäö]+/).filter((w) => w.length >= 4);

/** "1 pel. · 12 min · Keskitaso · Syöttö" — a drill's row in a list. */
export function exerciseFacts(ex) {
  return [ex.players && `${ex.players} pel.`, ex.duration, ex.level, ...(ex.tags || []).map((t) => KOUTSI_TAG_LABELS[t])].filter(Boolean).join(' · ');
}

/** "Kakkossyöttö + suunta: Kymmenen kakkossyöttöä…" — one line: both player apps show homework on one line. */
export function exerciseHomeworkText(ex) {
  const goal = (ex.goal || '').replace(/\s+/g, ' ').trim();
  return goal ? `${ex.name}: ${goal}` : ex.name;
}

/**
 * Drills for a homework, best first.
 *   → { items: [{ exercise, reason: 'teema' | 'yksin' | null }], theme: title of the theme matched, or null }
 * A drill fits the theme when one of its topics or name words appears in this week's theme of a
 * group the picked players train in; a one-player drill can be done alone; a video helps at home.
 */
export function homeworkSuggestions(state, ids, { date = koutsiTodayStr(), limit = 4 } = {}) {
  const picked = new Set(ids);
  const themes = state.groups
    .filter((g) => g.memberIds.some((id) => picked.has(id)))
    .map((g) => koutsiThemeForDate(g, date))
    .filter(Boolean);
  const scored = (state.exercises || []).map((exercise) => {
    let matched = null;
    let fit = 0;
    for (const t of themes) {
      const f = themeFit(exercise, t);
      if (f > fit) { fit = f; matched = t; }
    }
    const alone = exercise.playerCount === 1;
    return { exercise, matched, reason: matched ? 'teema' : alone ? 'yksin' : null, score: fit + (alone ? 2 : 0) + (exercise.video ? 1 : 0) };
  });
  const top = scored
    .sort((a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name, 'fi'))
    .slice(0, limit);
  return { items: top.map(({ exercise, reason }) => ({ exercise, reason })), theme: top.find((i) => i.matched)?.matched.title || null };
}

/**
 * How well a drill fits a theme: 6 when the theme's title is in its name ("Kakkossyöttö" →
 * "Kakkossyöttö + suunta"), 5 when a word of its name is in the theme, 4 when one of its topics
 * is, else 0.
 */
function themeFit(exercise, theme) {
  const text = lower(`${theme.title} ${theme.lead || ''}`);
  const name = lower(exercise.name);
  if (words(theme.title).some((w) => name.includes(w))) return 6;
  if (words(exercise.name).some((w) => text.includes(w))) return 5;
  return (exercise.tags || []).some((t) => KOUTSI_TAG_LABELS[t] && text.includes(lower(KOUTSI_TAG_LABELS[t]))) ? 4 : 0;
}
