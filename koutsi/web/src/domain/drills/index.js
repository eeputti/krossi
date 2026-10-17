// drills — Krossi's built-in tennis drill library and the helpers that sort, filter and label
// drills, the library's and the coach's own (koutsi_exercises) alike.
//
// The library is shipped with the app, not stored in the database: every coach and player of
// the new Koutsi sees the same, always up-to-date set, and the old app (which reads only
// koutsi_exercises) does not change. Its data (library.js) is served as /koutsi-uusi/drills.json
// and loaded when needed, so the helpers here take the library as an argument. A coach who
// saves a library drill gets an ordinary koutsi_exercises row (same name), so videos and edits
// work as before.
//
// A library drill:
//   { id, name, cat, players: [min, max], minutes, levels, tags, gear, solo,
//     goal, steps, cues, easier, harder, diagram, legacy? }
//   players  — how many fit on ONE court; max 12 means "a whole group"
//   levels   — consecutive LEVELS; [] = every level
//   tags     — the koutsi_exercises tags a saved copy gets (the database allows only these 8)
//   solo     — works without a coach or feeder: a player can do it alone or with a friend
//   diagram  — { view, players, ball, run, zones, cones } in court.js coordinates, or null
//   legacy   — only on the 25 starter drills every coach already has as koutsi_exercises rows:
//              the row's original values, so an untouched row can borrow the library's data

export const LEVELS = ['Aloittelija', 'Keskitaso', 'Edistynyt', 'Kilpapelaaja'];
export const DB_TAGS = ['syotto', 'liikkuminen', 'pistepeli', 'verkkopeli', 'tekniikka', 'lammittely', 'fysiikka', 'drilli'];

// The library's topics, in the order a session usually runs. `tag` is the database tag that
// stands for the topic when a coach's own drill has no library twin.
export const CATEGORIES = [
  { id: 'lammittely', label: 'Lämmittely', short: 'Lämmittely', tag: 'lammittely' },
  { id: 'pohjalyonnit', label: 'Pohjalyönnit', short: 'Pohjalyönnit', tag: 'tekniikka' },
  { id: 'syotto', label: 'Syöttö', short: 'Syöttö', tag: 'syotto' },
  { id: 'palautus', label: 'Palautus', short: 'Palautus', tag: null },
  { id: 'verkkopeli', label: 'Verkkopeli', short: 'Verkkopeli', tag: 'verkkopeli' },
  { id: 'liikkuminen', label: 'Liikkuminen', short: 'Liikkuminen', tag: 'liikkuminen' },
  { id: 'pistepeli', label: 'Pistepeli ja taktiikka', short: 'Pistepeli', tag: 'pistepeli' },
  { id: 'nelinpeli', label: 'Nelinpeli', short: 'Nelinpeli', tag: null },
  { id: 'lapset', label: 'Lapset ja minitennis', short: 'Lapset', tag: null },
  { id: 'fysiikka', label: 'Fysiikka ja liikkuvuus', short: 'Fysiikka', tag: 'fysiikka' },
];
export const CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

export const GEAR = {
  kori: 'Pallokori',
  kartiot: 'Kartiot',
  merkit: 'Maalimerkit',
  tikkaat: 'Koordinaatiotikkaat',
  kuminauha: 'Kuminauha',
  seina: 'Lyöntiseinä',
  pehmea: 'Pehmeät pallot',
  kuntopallo: 'Kuntopallo',
  naru: 'Hyppynaru',
  koysi: 'Naru verkon yläpuolelle',
};

// Name → drill per library list (the list is loaded once, so this is built once).
const byNameCache = new WeakMap();
function byName(library) {
  let map = byNameCache.get(library);
  if (!map) {
    map = new Map(library.map((d, i) => [nameKey(d.name), { d, i }]));
    byNameCache.set(library, map);
  }
  return map;
}

function nameKey(name) {
  return String(name || '').trim().toLocaleLowerCase('fi').replace(/[–—-]/g, '-').replace(/\s+/g, ' ');
}

// ── labels ──────────────────────────────────────────────────

/** "1", "2–4", "4+" (max 12 reads as "or more"). */
export function playersLabel([min, max]) {
  if (max >= 12 && min < 12) return `${min}+`;
  return min === max ? String(min) : `${min}–${max}`;
}

/** "1 pelaaja", "2–4 pelaajaa", "4+ pelaajaa". */
export function playersText(range) {
  const label = playersLabel(range);
  return label === '1' ? '1 pelaaja' : `${label} pelaajaa`;
}

/** 'Kaikki tasot', 'Aloittelija', 'Aloittelija–Keskitaso'. */
export function levelLabel(levels) {
  const on = LEVELS.filter((l) => (levels || []).includes(l));
  if (on.length === 0 || on.length === LEVELS.length) return 'Kaikki tasot';
  return on.length === 1 ? on[0] : `${on[0]}–${on[on.length - 1]}`;
}

// ── reading a coach's own row ───────────────────────────────

/** players_label/player_count of a koutsi_exercises row → [min, max]. "2+" and "4+" are open-ended. */
export function parsePlayers(label, count) {
  const text = String(label || '').replace(/\s/g, '');
  let m = text.match(/^(\d+)[–—-](\d+)/);
  if (m) return [Math.max(1, Number(m[1])), Math.max(Number(m[1]), Number(m[2]))];
  m = text.match(/^(\d+)\+/);
  if (m) return [Math.max(1, Number(m[1])), 12];
  m = text.match(/^(\d+)/);
  if (m) return [Math.max(1, Number(m[1])), Math.max(1, Number(m[1]))];
  const n = Number(count) || 1;
  return [n, n];
}

/** "15 min", "15–20 min", "1 h" → minutes (the first number), or null. */
export function parseMinutes(text) {
  const s = String(text || '').toLowerCase();
  const m = s.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return /\bh\b|tun/.test(s) && !/min/.test(s) ? Math.round(n * 60) : Math.round(n);
}

/** A level text ("Kaikki tasot", "Keskitaso", "Aloittelija–Keskitaso", "Aloittelija, Edistynyt") → LEVELS it covers; [] = all. */
export function parseLevels(text) {
  const s = String(text || '').toLocaleLowerCase('fi');
  if (!s.trim() || s.includes('kaikki')) return [];
  const idx = LEVELS.map((l, i) => (s.includes(l.toLocaleLowerCase('fi').slice(0, 6)) ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0) return [];
  if (/[–—-]/.test(s) && idx.length === 2) return LEVELS.slice(idx[0], idx[1] + 1);
  return idx.map((i) => LEVELS[i]);
}

const TAG_TO_CAT = [['lammittely', 'lammittely'], ['fysiikka', 'fysiikka'], ['syotto', 'syotto'], ['verkkopeli', 'verkkopeli'],
  ['pistepeli', 'pistepeli'], ['liikkuminen', 'liikkuminen'], ['tekniikka', 'pohjalyonnit'], ['drilli', 'pohjalyonnit']];

/** The topic a coach's own drill shows under when it has no library twin. */
export function categoryFromTags(tags) {
  const hit = TAG_TO_CAT.find(([tag]) => (tags || []).includes(tag));
  return hit ? hit[1] : null;
}

// ── one list for the screens ────────────────────────────────

/**
 * The drills a screen lists: the coach's own rows first, each joined to its library twin when
 * the names match (a saved or starter drill), then every library drill that has no own copy.
 *
 * Item: { key, own, lib, name, cat, players, minutes, levels, tags, gear, solo, goal,
 *         steps, cues, easier, harder, diagram, video, saved }
 *   own    — the koutsi_exercises row (mapped), or null for a library drill
 *   lib    — the library drill, or null for a drill the coach wrote
 *   saved  — the coach has the drill in their own bank
 */
export function buildDrillList(ownExercises = [], { library = [], dedupe = false } = {}) {
  const items = [];
  const taken = new Set();
  const names = byName(library);
  // dedupe: a player of two coaches has two copies of every starter drill; keep one (one with a video if any).
  const rows = dedupe ? [...ownExercises].sort((a, b) => Number(Boolean(b.video)) - Number(Boolean(a.video)))
    .filter((e, i, all) => all.findIndex((x) => nameKey(x.name) === nameKey(e.name)) === i) : ownExercises;
  rows.forEach((e) => {
    const hit = names.get(nameKey(e.name)) || null;
    if (hit) taken.add(hit.d.id);
    items.push(fromOwn(e, hit?.d || null, hit ? hit.i : null));
  });
  library.forEach((d, i) => { if (!taken.has(d.id)) items.push(fromLibrary(d, i)); });
  return items;
}

// rank = place in the library (topics run easy → hard), own drills without a twin last.
function fromLibrary(d, rank) {
  return {
    key: `k-${d.id}`, own: null, lib: d, rank, name: d.name, cat: d.cat, players: d.players, minutes: d.minutes,
    levels: d.levels, tags: d.tags, gear: d.gear || [], solo: Boolean(d.solo), goal: d.goal, steps: d.steps || [],
    cues: d.cues || [], easier: d.easier || '', harder: d.harder || '', diagram: d.diagram || null, video: null, saved: false,
  };
}

// An own row borrows the library's numbers only while the coach has not changed them, so an
// edited row always shows what the coach wrote (and what the old app shows).
function fromOwn(e, lib, rank) {
  const legacy = lib?.legacy;
  const untouched = Boolean(lib) && (legacy
    ? e.players === legacy.players_label && Number(e.playerCount) === legacy.player_count && e.duration === legacy.duration && e.level === legacy.level
    : e.players === playersLabel(lib.players) && e.duration === `${lib.minutes} min` && e.level === levelLabel(lib.levels));
  const goalIsLibrary = Boolean(lib) && [lib.goal, legacy?.goal, savedGoal(lib)].includes((e.goal || '').trim());
  return {
    key: e.id, own: e, lib, rank: rank ?? 1e6, name: e.name,
    cat: lib?.cat || categoryFromTags(e.tags) || 'pohjalyonnit',
    players: untouched ? lib.players : parsePlayers(e.players, e.playerCount),
    minutes: untouched ? lib.minutes : parseMinutes(e.duration),
    levels: untouched ? lib.levels : parseLevels(e.level),
    tags: e.tags || [], gear: lib?.gear || [], solo: Boolean(lib?.solo),
    // A coach's own words come first; the library's steps stay as "Krossin ohje" below them.
    goal: goalIsLibrary ? lib.goal : (e.goal || ''), ownGoal: !goalIsLibrary && Boolean((e.goal || '').trim()),
    steps: lib?.steps || [], cues: lib?.cues || [], easier: lib?.easier || '', harder: lib?.harder || '',
    diagram: lib?.diagram || null, video: e.video || null, saved: true,
  };
}

/** What a saved copy's goal field holds: the goal and the numbered steps (the old app shows this text). */
export function savedGoal(d) {
  const steps = (d.steps || []).map((s, i) => `${i + 1}. ${s}`).join('\n');
  return steps ? `${d.goal}\n\n${steps}` : d.goal;
}

/** The koutsi_exercises fields a coach's copy of a library drill gets. */
export function savedFields(d) {
  return {
    name: d.name, goal: savedGoal(d), players: playersLabel(d.players), playerCount: d.players[0],
    duration: `${d.minutes} min`, level: levelLabel(d.levels), tags: (d.tags || []).filter((t) => DB_TAGS.includes(t)),
  };
}

/** A drill a player can do on their own: no coach or feeder, alone or with one friend. */
export function selfGuided(item) {
  return Boolean(item.solo) && (item.players?.[0] || 1) <= 2;
}

/**
 * Every drill (own and library) in the koutsi_exercises shape that domain/exercises.js reads,
 * so homework suggestions and the Kotiläksy picker offer the whole library too. A drill a
 * player can do alone counts as a one-player drill there.
 */
export function asExercises(items) {
  return items.map((it) => ({
    id: it.key, name: it.name, goal: it.ownGoal ? it.own.goal : it.goal, cat: it.cat,
    players: playersLabel(it.players),
    // An own drill keeps its own count; a library drill counts as one-player ("yksin") only when
    // a player can do it alone (a coach-fed drill for 1–6 or a pair rally does not).
    playerCount: it.lib ? (it.solo && it.players[0] === 1 ? 1 : Math.max(2, it.players[0])) : (Number(it.own?.playerCount) || it.players[0]),
    duration: it.minutes ? `${it.minutes} min` : '', level: levelLabel(it.levels), tags: it.tags || [], video: it.video,
  }));
}

// ── filtering ───────────────────────────────────────────────

export const PLAYER_FILTERS = [
  { value: '1', label: '1', range: [1, 1] },
  { value: '2', label: '2', range: [2, 2] },
  { value: '3', label: '3', range: [3, 3] },
  { value: '4', label: '4', range: [4, 4] },
  { value: '5-6', label: '5–6', range: [5, 6] },
  { value: '7-8', label: '7–8', range: [7, 8] },
  { value: '9+', label: '9+', range: [9, 99] },
];
export const DURATION_FILTERS = [
  { value: 'short', label: 'Alle 10 min', test: (m) => m != null && m < 10 },
  { value: 'mid', label: '10–20 min', test: (m) => m != null && m >= 10 && m <= 20 },
  { value: 'long', label: 'Yli 20 min', test: (m) => m != null && m > 20 },
];

/** Does a drill fit `n` players (a number) or a range of group sizes ([lo, hi])? */
export function fitsPlayers(item, n) {
  const [lo, hi] = Array.isArray(n) ? n : [n, n];
  const [min, max] = item.players || [1, 1];
  return min <= hi && max >= lo;
}

/** Does a drill suit this level? Drills for every level suit everyone. */
export function fitsLevel(item, level) {
  return !item.levels?.length || item.levels.includes(level);
}

const fold = (s) => String(s || '').toLocaleLowerCase('fi').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Every word of the query must appear somewhere in the drill's text. */
export function matchesQuery(item, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fold([item.name, item.goal, CATEGORY[item.cat]?.label, ...(item.steps || []), ...(item.cues || []),
    item.easier, item.harder, ...(item.gear || []).map((g) => GEAR[g])].join(' '));
  return words.every((w) => hay.includes(w));
}

/**
 * filters: { query, cat, players (filter value | [lo, hi] for a group), level, duration,
 *            source ('all' | 'own' | 'library'), solo, video }
 */
export function filterDrills(items, f = {}) {
  const pf = typeof f.players === 'string' ? PLAYER_FILTERS.find((p) => p.value === f.players)?.range : f.players;
  const df = DURATION_FILTERS.find((d) => d.value === f.duration);
  return items.filter((it) => (!f.cat || it.cat === f.cat)
    && (!pf || fitsPlayers(it, pf))
    && (!f.level || fitsLevel(it, f.level))
    && (!df || df.test(it.minutes))
    && (!f.source || f.source === 'all' || (f.source === 'own' ? it.saved : !it.own))
    && (!f.solo || selfGuided(it))
    && (!f.video || Boolean(it.video))
    && matchesQuery(it, f.query));
}

/** Library order inside a topic (as written: easy to hard), own drills by name after their twins. */
export function sortDrills(items) {
  const catOrder = new Map(CATEGORIES.map((c, i) => [c.id, i]));
  return [...items].sort((a, b) => (catOrder.get(a.cat) ?? 99) - (catOrder.get(b.cat) ?? 99)
    || (a.rank ?? 1e6) - (b.rank ?? 1e6)
    || a.name.localeCompare(b.name, 'fi'));
}

/** Items grouped by topic in CATEGORIES order (empty topics left out). */
export function groupByCategory(items) {
  return CATEGORIES.map((c) => ({ cat: c, items: items.filter((it) => it.cat === c.id) })).filter((g) => g.items.length > 0);
}
