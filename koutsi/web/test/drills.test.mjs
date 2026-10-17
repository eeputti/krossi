// The built-in drill library: every drill has the shape the screens rely on, the 25 starter
// drills every coach already owns keep their names (that is how a coach's row finds its twin),
// and the list/filter helpers treat own and library drills alike.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES, CATEGORY, GEAR, LEVELS, DB_TAGS, buildDrillList, filterDrills, playersLabel, levelLabel,
  parsePlayers, parseMinutes, parseLevels, savedFields, fitsPlayers, sortDrills, asExercises, selfGuided,
} from '../src/domain/drills/index.js';
import { LIBRARY } from '../src/domain/drills/library.js';
import { VIEWS, pointOf, zoneOf } from '../src/domain/drills/court.js';

const PREFIX = { lammittely: 'lam', pohjalyonnit: 'poh', syotto: 'syo', palautus: 'pal', verkkopeli: 'ver', liikkuminen: 'lii', pistepeli: 'pis', nelinpeli: 'nel', lapset: 'lap', fysiikka: 'fys' };
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

// The koutsi_exercise_templates rows as they are in production (koutsi_seed_exercises copies them).
const STARTERS = [
  ['lammittely', 'Pallonkuljetus mailalla', '1', 1, '5 min', 'Kaikki tasot'],
  ['lammittely', 'Minitennis ristiin', '2', 2, '10 min', 'Kaikki tasot'],
  ['lammittely', 'Sivuttaisliike ja kosketus', '1', 1, '8 min', 'Kaikki tasot'],
  ['liikkuminen', 'Split step -ajoitus', '1', 1, '10 min', 'Kaikki tasot'],
  ['liikkuminen', 'Kahdeksikko kartioiden ympäri', '1', 1, '10 min', 'Keskitaso'],
  ['pohjalyonnit', 'Kämmen ristiin 10 palloa', '2', 2, '12 min', 'Aloittelija'],
  ['pohjalyonnit', 'Rysty ristiin 10 palloa', '2', 2, '12 min', 'Aloittelija'],
  ['pohjalyonnit', 'Kämmen–rysty vuorottelu', '2', 2, '12 min', 'Keskitaso'],
  ['pohjalyonnit', 'Suora vs. risto -päätös', '2', 2, '15 min', 'Edistynyt'],
  ['pohjalyonnit', 'Syvyyspeli — kolmen metrin vyöhyke', '2', 2, '15 min', 'Keskitaso'],
  ['syotto', 'Ensimmäinen syöttö — 20 palloa', '1', 1, '12 min', 'Kaikki tasot'],
  ['syotto', 'Kakkossyöttö + suunta', '1', 1, '12 min', 'Keskitaso'],
  ['syotto', 'Syöttö kohdealueisiin', '1', 1, '15 min', 'Edistynyt'],
  ['syotto', 'Syöttö + ensimmäinen lyönti', '2', 2, '15 min', 'Keskitaso'],
  ['palautus', 'Palautus jalkojen kanssa', '2', 2, '15 min', 'Keskitaso'],
  ['verkkopeli', 'Lentolyönti läheltä verkkoa', '2', 2, '10 min', 'Aloittelija'],
  ['verkkopeli', 'Lähestymislyönti ja verkkoon', '2', 2, '15 min', 'Keskitaso'],
  ['verkkopeli', 'Verkkorefleksit', '2', 2, '8 min', 'Edistynyt'],
  ['verkkopeli', 'Ylälyönti paikaltaan', '2', 2, '10 min', 'Keskitaso'],
  ['pistepeli', 'Pistepeli 7 pisteeseen', '2+', 2, '15 min', 'Kaikki tasot'],
  ['pistepeli', 'Tie-break -harjoitus', '2', 2, '20 min', 'Edistynyt'],
  ['pistepeli', 'Piste alkaa 0–30', '2', 2, '20 min', 'Edistynyt'],
  ['pistepeli', 'Kuningaskenttä', '4+', 4, '20 min', 'Kaikki tasot'],
  ['nelinpeli', 'Nelinpeliasemat', '4', 4, '20 min', 'Keskitaso'],
  ['fysiikka', 'Jäähdyttely ja venyttely', '1', 1, '8 min', 'Kaikki tasot'],
];

// DRILLS_CAT=syotto,palautus checks only those topics (and skips the whole-library counts), so
// one topic can be written and checked while the others are still empty.
const ONLY = process.env.DRILLS_CAT ? new Set(process.env.DRILLS_CAT.split(',')) : null;
const DRAWN = ONLY ? LIBRARY.filter((d) => ONLY.has(d.cat)) : LIBRARY;

const str = (v, min, max) => typeof v === 'string' && v.trim() === v && v.length >= min && v.length <= max;

function checkDiagram(d, where) {
  assert.equal(typeof d, 'object', `${where}: diagram must be an object or null`);
  assert.ok(!d.view || VIEWS[d.view], `${where}: unknown view ${d.view}`);
  assert.ok(Array.isArray(d.players) && d.players.length > 0, `${where}: a diagram needs players`);
  d.players.forEach(([who, at]) => {
    assert.match(who, /^(A|B|C|D|E|F|V)$/, `${where}: player letter ${who}`);
    assert.ok(pointOf(at), `${where}: unknown player point ${JSON.stringify(at)}`);
  });
  for (const key of ['ball', 'run']) {
    (d[key] || []).forEach((seg) => {
      assert.ok(Array.isArray(seg) && seg.length >= 2 && pointOf(seg[0]) && pointOf(seg[1]), `${where}: bad ${key} ${JSON.stringify(seg)}`);
    });
  }
  (d.zones || []).forEach((z) => assert.ok(zoneOf(z), `${where}: unknown zone ${JSON.stringify(z)}`));
  (d.cones || []).forEach((c) => assert.ok(pointOf(c), `${where}: unknown cone ${JSON.stringify(c)}`));
  const known = new Set(['view', 'players', 'ball', 'run', 'zones', 'cones']);
  Object.keys(d).forEach((k) => assert.ok(known.has(k), `${where}: unknown diagram key ${k}`));
}

test('every library drill has the full shape', () => {
  if (!ONLY) assert.ok(LIBRARY.length >= 150, `library has only ${LIBRARY.length} drills`);
  const ids = new Set();
  const names = new Set();
  for (const d of DRAWN) {
    const at = `${d.id || '?'} ${d.name || ''}`;
    assert.ok(CATEGORY[d.cat], `${at}: unknown cat ${d.cat}`);
    assert.match(d.id, new RegExp(`^${PREFIX[d.cat]}-\\d{2}$`), `${at}: id must be ${PREFIX[d.cat]}-NN`);
    assert.ok(!ids.has(d.id), `${at}: duplicate id`); ids.add(d.id);
    const key = d.name.toLocaleLowerCase('fi');
    assert.ok(!names.has(key), `${at}: duplicate name`); names.add(key);
    assert.ok(str(d.name, 3, 48), `${at}: name 3–48 chars`);
    assert.ok(Array.isArray(d.players) && d.players.length === 2 && d.players.every(Number.isInteger)
      && d.players[0] >= 1 && d.players[0] <= d.players[1] && d.players[1] <= 12, `${at}: players [min, max] 1..12`);
    assert.ok(Number.isInteger(d.minutes) && d.minutes >= 3 && d.minutes <= 60, `${at}: minutes 3..60`);
    assert.ok(Array.isArray(d.levels) && d.levels.every((l) => LEVELS.includes(l)), `${at}: levels`);
    const idx = d.levels.map((l) => LEVELS.indexOf(l));
    assert.ok(idx.every((v, i) => i === 0 || v === idx[i - 1] + 1), `${at}: levels must be consecutive and in order`);
    assert.ok(d.levels.length < 4, `${at}: all four levels → write []`);
    assert.ok(Array.isArray(d.tags) && d.tags.length >= 1 && d.tags.length <= 3 && d.tags.every((t) => DB_TAGS.includes(t)), `${at}: tags 1–3 of ${DB_TAGS}`);
    assert.ok(Array.isArray(d.gear) && d.gear.every((g) => GEAR[g]), `${at}: gear`);
    assert.equal(typeof d.solo, 'boolean', `${at}: solo`);
    assert.ok(str(d.goal, 20, 240), `${at}: goal 20–240 chars`);
    assert.ok(Array.isArray(d.steps) && d.steps.length >= 3 && d.steps.length <= 5 && d.steps.every((s) => str(s, 8, 170) && !/^\d+[.)]/.test(s)), `${at}: 3–5 steps ≤170 chars, no numbering`);
    assert.ok(Array.isArray(d.cues) && d.cues.length >= 2 && d.cues.length <= 3 && d.cues.every((s) => str(s, 6, 120)), `${at}: 2–3 cues ≤120 chars`);
    assert.ok(str(d.easier, 10, 170) && str(d.harder, 10, 170), `${at}: easier/harder 10–170 chars`);
    if (d.diagram !== null) checkDiagram(d.diagram, at); else assert.equal(d.diagram, null);
    const text = [d.name, d.goal, ...d.steps, ...d.cues, d.easier, d.harder].join(' ');
    assert.ok(!EMOJI.test(text), `${at}: no emojis`);
    const known = new Set(['id', 'name', 'cat', 'players', 'minutes', 'levels', 'tags', 'gear', 'solo', 'goal', 'steps', 'cues', 'easier', 'harder', 'diagram', 'legacy']);
    Object.keys(d).forEach((k) => assert.ok(known.has(k), `${at}: unknown key ${k}`));
  }
});

test('every topic has drills, and most court drills have a diagram', () => {
  for (const c of CATEGORIES.filter((x) => !ONLY || ONLY.has(x.id))) {
    const n = LIBRARY.filter((d) => d.cat === c.id).length;
    assert.ok(n >= 10, `${c.id} has only ${n} drills`);
  }
  const court = DRAWN.filter((d) => !['fysiikka'].includes(d.cat));
  const drawn = court.filter((d) => d.diagram).length;
  assert.ok(drawn / court.length > 0.6, `only ${drawn}/${court.length} court drills have a diagram`);
});

test('the 25 starter drills keep their names and carry the rows they replace', () => {
  for (const [cat, name, label, count, duration, level] of STARTERS) {
    if (ONLY && !ONLY.has(cat)) continue;
    const d = LIBRARY.find((x) => x.name === name);
    assert.ok(d, `starter missing: ${name}`);
    assert.deepEqual(
      { players_label: d.legacy?.players_label, player_count: d.legacy?.player_count, duration: d.legacy?.duration, level: d.legacy?.level },
      { players_label: label, player_count: count, duration, level }, `${name}: legacy`,
    );
    assert.ok(str(d.legacy.goal, 10, 400), `${name}: legacy.goal`);
  }
  const mine = STARTERS.filter(([cat]) => !ONLY || ONLY.has(cat)).length;
  assert.equal(DRAWN.filter((d) => d.legacy).length, mine, 'only starters carry legacy');
});

test('labels and parsing round-trip', () => {
  assert.equal(playersLabel([1, 1]), '1');
  assert.equal(playersLabel([2, 4]), '2–4');
  assert.equal(playersLabel([4, 12]), '4+');
  assert.deepEqual(parsePlayers('2–4', 2), [2, 4]);
  assert.deepEqual(parsePlayers('2-4', 2), [2, 4]);
  assert.deepEqual(parsePlayers('4+', 4), [4, 12]);
  assert.deepEqual(parsePlayers('2', 2), [2, 2]);
  assert.deepEqual(parsePlayers('', 3), [3, 3]);
  assert.equal(parseMinutes('15 min'), 15);
  assert.equal(parseMinutes('1 h'), 60);
  assert.equal(parseMinutes(''), null);
  assert.equal(levelLabel([]), 'Kaikki tasot');
  assert.equal(levelLabel(['Aloittelija', 'Keskitaso']), 'Aloittelija–Keskitaso');
  assert.deepEqual(parseLevels('Kaikki tasot'), []);
  assert.deepEqual(parseLevels('Aloittelija–Edistynyt'), ['Aloittelija', 'Keskitaso', 'Edistynyt']);
  assert.deepEqual(parseLevels('Keskitaso'), ['Keskitaso']);
});

test('an untouched starter row borrows the library, an edited one keeps the coach’s values', { skip: Boolean(ONLY) }, () => {
  const lib = LIBRARY.find((d) => d.name === 'Kuningaskenttä');
  const row = { id: 'r1', name: 'Kuningaskenttä', goal: lib.legacy.goal, players: '4+', playerCount: 4, duration: '20 min', level: 'Kaikki tasot', tags: ['pistepeli'], video: null };
  const [item] = buildDrillList([row], { library: LIBRARY });
  assert.equal(item.lib, lib);
  assert.deepEqual(item.players, lib.players);
  assert.equal(item.goal, lib.goal);
  assert.equal(item.ownGoal, false);
  const [edited] = buildDrillList([{ ...row, players: '6', playerCount: 6, goal: 'Oma ohje' }], { library: LIBRARY });
  assert.deepEqual(edited.players, [6, 6]);
  assert.equal(edited.goal, 'Oma ohje');
  assert.equal(edited.ownGoal, true);
  assert.equal(edited.steps.length, lib.steps.length);
});

test('a saved library drill is listed once, as the coach’s own', { skip: Boolean(ONLY) }, () => {
  const lib = LIBRARY.find((d) => !d.legacy);
  const fields = savedFields(lib);
  const row = { id: 'r2', ...fields, video: null };
  const list = buildDrillList([row], { library: LIBRARY });
  assert.equal(list.filter((it) => it.name === lib.name).length, 1);
  const item = list.find((it) => it.name === lib.name);
  assert.equal(item.saved, true);
  assert.equal(item.goal, lib.goal);
  assert.equal(item.ownGoal, false);
  assert.deepEqual(item.players, lib.players);
  assert.equal(list.length, LIBRARY.length);
});

test('filters: players, level, source, query', { skip: Boolean(ONLY) }, () => {
  const list = sortDrills(buildDrillList([{ id: 'o1', name: 'Oma kuvio', goal: 'Kolme kämmentä ja verkkoon', players: '3', playerCount: 3, duration: '10 min', level: 'Keskitaso', tags: ['tekniikka'], video: null }], { library: LIBRARY }));
  const four = filterDrills(list, { players: '4' });
  assert.ok(four.length > 20 && four.every((it) => fitsPlayers(it, 4)));
  assert.ok(filterDrills(list, { players: '1' }).every((it) => it.players[0] === 1));
  const own = filterDrills(list, { source: 'own' });
  assert.deepEqual(own.map((it) => it.key), ['o1']);
  assert.ok(filterDrills(list, { source: 'library' }).every((it) => !it.own));
  assert.deepEqual(filterDrills(list, { query: 'oma KUVIO' }).map((it) => it.key), ['o1']);
  assert.ok(filterDrills(list, { query: 'syotto' }).length > 5, 'search ignores ä/ö');
  assert.ok(filterDrills(list, { level: 'Kilpapelaaja' }).every((it) => !it.levels.length || it.levels.includes('Kilpapelaaja')));
  assert.ok(filterDrills(list, { cat: 'nelinpeli', players: '1' }).length === 0, 'no singles player doubles drills');
  assert.ok(filterDrills(list, { solo: true }).every((it) => it.solo && it.players[0] <= 2), 'Omatoimiset = alone or with a friend');
});

test('without the library (still loading) the coach still sees their own drills', { skip: Boolean(ONLY) }, () => {
  const rows = [{ id: 'r1', name: 'Kuningaskenttä', goal: 'x', players: '4+', playerCount: 4, duration: '20 min', level: 'Kaikki tasot', tags: ['pistepeli'], video: null }];
  const items = buildDrillList(rows);
  assert.equal(items.length, 1);
  assert.equal(items[0].lib, null);
  assert.equal(items[0].cat, 'pistepeli');
});

test('a player of two coaches sees a shared starter once, the copy with a video first', { skip: Boolean(ONLY) }, () => {
  const row = (id, video) => ({ id, name: 'Kuningaskenttä', goal: 'x', players: '4+', playerCount: 4, duration: '20 min', level: 'Kaikki tasot', tags: ['pistepeli'], video });
  const items = buildDrillList([row('a', null), row('b', { title: 'v' })], { library: LIBRARY, dedupe: true });
  const kings = items.filter((it) => it.name === 'Kuningaskenttä');
  assert.equal(kings.length, 1);
  assert.equal(kings[0].own.id, 'b');
});

test('homework suggestions read every drill in the exercise shape', { skip: Boolean(ONLY) }, () => {
  const all = asExercises(buildDrillList([], { library: LIBRARY }));
  assert.equal(all.length, LIBRARY.length);
  const byId = new Map(all.map((e) => [e.id, e]));
  for (const d of LIBRARY) {
    const alone = byId.get(`k-${d.id}`).playerCount === 1;
    assert.equal(alone, d.solo && d.players[0] === 1, `${d.id}: one-player in homework only when it works alone`);
  }
  const doubles = LIBRARY.find((d) => d.cat === 'nelinpeli' && d.solo);
  if (doubles) assert.ok(!selfGuided(doubles), 'a doubles drill without a coach is not homework for one');
  assert.ok(all.every((e) => typeof e.goal === 'string' && e.name && e.cat));
});
