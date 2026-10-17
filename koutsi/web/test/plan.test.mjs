// "Treenin runko": the plan kept in a coach's session notes reads back as written, never eats
// earlier text, keeps its parts in order, moves across part edges, finds its drills again after
// the coach's own copy changes, starts the picker from the session's group — and the demo saves it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_PARTS, MAX_PLAN_ITEMS, readPlan, writePlan, hasPlan, planMinutes, partItems, addToPlan, removeFromPlan,
  setPlanMinutes, movePlanItem, canMove, resolvePlanItem, pickerFilters, planSummary, planFit,
} from '../src/domain/plan.js';
import { buildDrillList } from '../src/domain/drills/index.js';
import { LIBRARY } from '../src/domain/drills/library.js';
import { backend as demo, configureDemo } from '../src/api/demo/index.js';

const drills = buildDrillList([], { library: LIBRARY });
const lib = (id) => drills.find((d) => d.lib?.id === id);
const empty = readPlan('');
const sample = () => {
  let p = empty;
  p = addToPlan(p, 'peli', lib('pis-03'));
  p = addToPlan(p, 'lammittely', lib('lam-11'));
  p = addToPlan(p, 'harjoitteet', lib('syo-08'));
  p = addToPlan(p, 'harjoitteet', lib('syo-09'));
  p = addToPlan(p, 'loppu', lib('fys-03'));
  return p;
};
const names = (p) => p.items.map((it) => `${it.part}:${it.name}`);

test('a plan round-trips through the notes text', () => {
  const p = sample();
  const text = writePlan(p);
  assert.equal(typeof text, 'string');
  assert.deepEqual(readPlan(text), p);
  assert.equal(hasPlan({ notes: text }), true);
  assert.equal(hasPlan({ notes: '' }), false);
  assert.equal(hasPlan({ notes: null }), false);
});

test('items keep the part order whatever order they were added in', () => {
  assert.deepEqual(names(sample()).map((n) => n.split(':')[0]), ['lammittely', 'harjoitteet', 'harjoitteet', 'peli', 'loppu']);
  assert.deepEqual(PLAN_PARTS.map((p) => p.id), ['lammittely', 'harjoitteet', 'peli', 'loppu']);
});

test('an entry starts at the drill\'s own minutes and remembers its library twin', () => {
  const p = sample();
  const warm = p.items[0];
  assert.equal(warm.minutes, lib('lam-11').minutes);
  assert.equal(warm.ref, 'k-lam-11');
  assert.equal(warm.lib, 'lam-11');
  assert.equal(planMinutes(p), ['lam-11', 'syo-08', 'syo-09', 'pis-03', 'fys-03'].reduce((s, id) => s + lib(id).minutes, 0));
  assert.match(planSummary(p), /^5 harjoitetta · \d+ min$/);
  assert.equal(planSummary(empty), 'Ei vielä runkoa');
});

test('earlier free text in the notes is kept and given back when the plan is emptied', () => {
  const before = readPlan('Kentät 3 ja 4');
  assert.deepEqual(before, { items: [], note: 'Kentät 3 ja 4' });
  const planned = addToPlan(before, 'lammittely', lib('lam-01'));
  const text = writePlan(planned);
  assert.equal(readPlan(text).note, 'Kentät 3 ja 4');
  assert.equal(writePlan(removeFromPlan(readPlan(text), 0)), 'Kentät 3 ja 4');
  assert.equal(writePlan(removeFromPlan(addToPlan(empty, 'peli', lib('pis-03')), 0)), null);
});

test('text that is not a plan stays text (other JSON, broken JSON, unknown parts)', () => {
  assert.deepEqual(readPlan('{"a":1}'), { items: [], note: '{"a":1}' });
  assert.deepEqual(readPlan('{oops'), { items: [], note: '{oops' });
  const odd = JSON.stringify({ runko: 1, osat: [{ osa: 'tauko', ref: 'x', name: 'Kahvi', min: 10 }, { osa: 'peli', ref: 'k-pis-03', name: 'Pistepeli', min: 999 }] });
  const read = readPlan(odd);
  assert.equal(read.items.length, 1);
  assert.equal(read.items[0].minutes, 90, 'minutes are clamped');
});

test('a full plan takes no more drills', () => {
  let p = empty;
  for (let i = 0; i < MAX_PLAN_ITEMS + 3; i += 1) p = addToPlan(p, 'harjoitteet', drills[i]);
  assert.equal(p.items.length, MAX_PLAN_ITEMS);
});

test('moving swaps inside a part and crosses into the next part at its edge', () => {
  const p = sample(); // lam-11 | syo-08, syo-09 | pis-03 | fys-03
  const swapped = movePlanItem(p, 2, -1);
  assert.deepEqual(names(swapped).slice(1, 3), ['harjoitteet:Syöttö + ensimmäinen lyönti', 'harjoitteet:Kakkossyöttö + suunta']);
  // the first drill of Harjoitteet moving up becomes the last of Lämmittely
  const up = movePlanItem(p, 1, -1);
  assert.equal(up.items[1].part, 'lammittely');
  assert.deepEqual(partItems(up, 'lammittely').map((r) => r.item.name), ['Minitennis ristiin', 'Kakkossyöttö + suunta']);
  // the last of Harjoitteet moving down becomes the first of Peli
  const down = movePlanItem(p, 2, 1);
  assert.deepEqual(partItems(down, 'peli').map((r) => r.item.name), ['Syöttö + ensimmäinen lyönti', 'Pistepeli 7 pisteeseen']);
  // still a well-ordered plan after a round trip
  assert.deepEqual(readPlan(writePlan(down)), down);
  // the very first can't go up, the very last can't go down
  assert.equal(canMove(p, 0, -1), false);
  assert.equal(canMove(p, p.items.length - 1, 1), false);
  assert.equal(movePlanItem(p, 0, -1), p);
  assert.equal(canMove(p, 0, 1), true);
});

test('minutes are the coach\'s for this session, within 1–90', () => {
  const p = setPlanMinutes(sample(), 0, 25);
  assert.equal(p.items[0].minutes, 25);
  assert.equal(setPlanMinutes(p, 0, 500).items[0].minutes, 90);
  assert.equal(setPlanMinutes(p, 0, 0).items[0].minutes, 10, 'nonsense falls back to ten');
});

test('a planned drill is found by its key, then its library twin, then its name', () => {
  const entry = sample().items[1]; // Kakkossyöttö + suunta, from the library
  assert.equal(resolvePlanItem(entry, drills).lib.id, 'syo-08');
  // the coach saves it later: the own copy (with their video) wins
  const own = { id: 'own-1', name: 'Kakkossyöttö + suunta', goal: '', players: '1', playerCount: 1, duration: '20 min', level: 'Keskitaso', tags: ['syotto'], video: { title: 'Video' } };
  const withOwn = buildDrillList([own], { library: LIBRARY });
  assert.equal(resolvePlanItem(entry, withOwn).own.id, 'own-1');
  // planned from the own copy, which the coach then deletes: back to the library drill
  const fromOwn = { ...entry, ref: 'own-1' };
  assert.equal(resolvePlanItem(fromOwn, drills).lib.id, 'syo-08');
  // a coach's own drill with no twin, renamed nowhere: found by name; gone: null
  const mine = { id: 'own-2', name: 'Oma vauhtipeli', goal: 'x', players: '4', playerCount: 4, duration: '15 min', level: 'Kaikki tasot', tags: [], video: null };
  const list = buildDrillList([mine], { library: LIBRARY });
  assert.equal(resolvePlanItem({ ref: 'old-id', lib: null, name: 'oma  VAUHTIPELI' }, list).own.id, 'own-2');
  assert.equal(resolvePlanItem({ ref: 'old-id', lib: null, name: 'Poistettu' }, list), null);
  assert.equal(resolvePlanItem(entry, []), null);
});

test('the picker starts from the part\'s topic and the session\'s group or private lesson', () => {
  const group = { id: 'g1', level: 'Keskitaso', memberIds: ['a', 'b', 'c', 'd'] };
  assert.deepEqual(pickerFilters('lammittely', { group }), { cat: 'lammittely', group: 'g1', level: 'Keskitaso' });
  assert.deepEqual(pickerFilters('harjoitteet', { group: { ...group, level: 'Muu' } }), { cat: '', group: 'g1' });
  assert.deepEqual(pickerFilters('peli', { training: { studentId: 's1' } }), { cat: 'pistepeli', players: '1' });
  assert.deepEqual(pickerFilters('loppu', { group: { id: 'g2', memberIds: [] } }), { cat: 'fysiikka' });
});

test('the total is compared with the session\'s length', () => {
  const p = sample();
  const total = planMinutes(p);
  assert.equal(planFit(p, null), null);
  assert.equal(planFit(empty, 60), null);
  assert.equal(planFit(p, total - 10).diff, 10);
  assert.match(planFit(p, total - 10).text, /^10 min yli/);
  assert.match(planFit(p, total).text, /^Täsmälleen/);
  assert.match(planFit(p, total + 15).text, /^15 min vapaata/);
});

test('demo: a coach saves a plan on a group session and the group\'s player sees it', async () => {
  configureDemo({ role: 'coach', latency: 0 });
  const state = await demo.coach.load('demo-coach');
  // the seed already plans Maria's next Tuesday session
  assert.ok(state.trainings.some((t) => t.groupId === 'demo-g-ti-aik1' && hasPlan(t)));
  const t = state.trainings.find((x) => x.groupId === 'demo-g-to-aik' && !hasPlan(x));
  const p = addToPlan(empty, 'lammittely', lib('lam-01'));
  await demo.trainings.setPlan(t.id, p);
  const after = await demo.coach.load('demo-coach');
  assert.deepEqual(readPlan(after.trainings.find((x) => x.id === t.id).notes), p);
  await demo.trainings.setPlan(t.id, empty);
  assert.equal((await demo.coach.load('demo-coach')).trainings.find((x) => x.id === t.id).notes, '');
  await assert.rejects(demo.trainings.setPlan('no-such-session', p), /Treeniä ei löytynyt/);
  // a player's own log is never a coach's plan
  const own = after.trainings.find((x) => x.loggedBy === 'player');
  await assert.rejects(demo.trainings.setPlan(own.id, p), /Treeniä ei löytynyt/);

  configureDemo({ role: 'player', latency: 0 });
  const mine = await demo.player.load('demo-s-maria');
  const planned = mine.trainings.find((x) => hasPlan(x));
  assert.ok(planned, 'Maria sees the planned session');
  const plan = readPlan(planned.notes);
  const theirs = buildDrillList(mine.exercises, { library: LIBRARY, dedupe: true });
  // every drill is found, with the library's court picture when it has one (stretching has none)
  for (const item of plan.items) {
    const found = resolvePlanItem(item, theirs);
    assert.ok(found, item.name);
    assert.deepEqual(found.diagram, LIBRARY.find((d) => d.id === item.lib).diagram || null, item.name);
  }
  assert.ok(plan.items.filter((item) => resolvePlanItem(item, theirs).diagram).length >= 5);
});
