// Vapaat ajat: the helpers (domain/openSlots.js), the demo backend (a time the coach adds is booked on
// the player page and lands in both weeks, the first booker wins, a freed lesson is offered once) and
// the real backend on a fake client (hidden until the database has it; then the coach's gate decides).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { koutsiAddDays, koutsiAddIsoWeeks, koutsiIsoWeekOfDateStr, koutsiTodayStr } from '../src/domain/core.js';
import { weekDates } from '../src/domain/week.js';
import { weekBoard } from '../src/domain/board.js';
import { playerWeek } from '../src/domain/ownWeek.js';
import {
  draftProblem, draftSlots, firstDraftRow, hasStarted, isPrivateLesson, listLine, nextDraftRow, offerOf, openToBook,
  slotFromLesson, slotStartLabel, slotWhen,
} from '../src/domain/openSlots.js';

const NOW = new Date(2026, 9, 29, 15, 40); // Thu 29.10.2026 15:40
const S = (id, date, time, extra = {}) => ({ id, coachId: 'c', date, time, durationMinutes: 60, place: '', sourceTrainingId: null, bookedBy: null, bookedAt: null, trainingId: null, ...extra });
const lesson = (id, date, time, extra = {}) => ({ id, date, time, type: 'Yksityistunti', durationMinutes: 60, loggedBy: 'coach', studentId: 's1', groupId: null, coachId: 'c', absences: [], ...extra });

test('times read like the rest of Koutsi', () => {
  assert.equal(slotWhen(S('a', '2026-11-03', '17:00', { durationMinutes: 90 })), 'ti 3.11. klo 17:00–18:30');
  assert.equal(slotStartLabel(S('a', '2026-11-03', '17:00')), 'ti 3.11. klo 17:00');
  assert.equal(hasStarted(S('a', '2026-10-29', '15:40'), NOW), true);
  assert.equal(hasStarted(S('a', '2026-10-29', '15:45'), NOW), false);
  assert.equal(listLine(['a']), 'a');
  assert.equal(listLine(['a', 'b']), 'a ja b');
  assert.equal(listLine(['a', 'b', 'c']), 'a, b ja c');
  assert.equal(listLine(['a', 'b', 'c', 'd']), 'a, b, c ja 1 muu');
  assert.equal(listLine(['a', 'b', 'c', 'd', 'e']), 'a, b, c ja 2 muuta');
});

test('a player books only open times still to come, soonest first', () => {
  const slots = [
    S('later', '2026-11-02', '14:00'),
    S('soon', '2026-10-30', '09:00'),
    S('gone', '2026-10-29', '08:00'),
    S('taken', '2026-10-30', '10:00', { bookedBy: 's2', trainingId: 't9' }),
    S('same-day', '2026-10-30', '08:00'),
  ];
  assert.deepEqual(openToBook(slots, NOW).map((s) => s.id), ['same-day', 'soon', 'later']);
});

test('free times are blocks of their own in both weeks: not sessions, not past, not booked', () => {
  // a week wholly ahead, so nothing in it has started
  const week = koutsiAddIsoWeeks(koutsiIsoWeekOfDateStr(koutsiTodayStr()), 2);
  const [, tue, wed] = weekDates(week);
  const slots = [
    S('free', tue, '15:00', { place: 'Kenttä 2', durationMinutes: 90 }),
    S('taken', tue, '17:00', { bookedBy: 's1', trainingId: 't1' }),
    S('other-week', koutsiAddDays(tue, 7), '15:00'),
  ];
  const lesson1 = lesson('t1', tue, '17:00');
  const coachState = { groups: [], students: [{ id: 's1', name: 'Maria K.' }], clubEvents: [], trainings: [lesson1] };
  const board = weekBoard(coachState, week, new Date(), { openSlots: slots });
  const tuesday = board.days[1].items;
  assert.deepEqual(tuesday.map((it) => [it.kind, it.time]), [['open', '15:00'], ['private', '17:00']], 'the free time and the booked lesson');
  const open = tuesday[0];
  assert.equal(open.tone, 'open');
  assert.equal(open.slot.place, 'Kenttä 2');
  assert.equal(open.end - open.start, 90);
  assert.equal(board.sessions, 1, 'a free time is not a session');
  assert.equal(board.issues, 0);
  assert.equal(board.grid.startH, 15, 'the grid makes room for it');
  assert.equal(weekBoard(coachState, week).days[1].items.length, 1, 'without the feature nothing changes');
  const past = weekBoard(coachState, koutsiIsoWeekOfDateStr(koutsiTodayStr()), new Date(), { openSlots: [S('gone', koutsiAddDays(koutsiTodayStr(), -1), '10:00')] });
  assert.ok(past.days.every((d) => d.items.every((it) => it.kind !== 'open')), 'a free time that went by unbooked is gone');

  const me = { id: 's1', name: 'Maria K.', matchNotes: [], homework: [] };
  const playerState = { groups: [], students: [me], clubEvents: [], coaches: [{ id: 'c', name: 'Anna Koskinen' }], trainings: [lesson1] };
  const w = playerWeek(playerState, me, week, new Date(), { openSlots: slots.filter((s) => !s.bookedBy) });
  const items = w.days[1].items;
  assert.deepEqual(items.map((it) => [it.kind, it.time]), [['open', '15:00'], ['coach', '17:00']]);
  assert.equal(items[0].title, 'Vapaa aika');
  assert.equal(items[0].coach.name, 'Anna Koskinen');
  assert.equal(w.summary.coach, 1, 'the week counts only real sessions');
  assert.equal(w.days[2].items.length, 0, wed);
});

test('a freed lesson: a private lesson becomes a free time with its day, start, length and place', () => {
  const absent = [{ studentId: 's1', reason: 'poissa' }];
  const free = lesson('free', '2026-10-31', '10:00', { absences: absent });
  const slots = [S('o1', '2026-11-01', '10:00', { sourceTrainingId: 'offered' }), S('b1', '2026-10-31', '10:00', { place: 'Kenttä 2', bookedBy: 's1', trainingId: 'free' })];
  assert.equal(isPrivateLesson(free), true);
  assert.equal(isPrivateLesson(lesson('g', '2026-10-31', '12:00', { studentId: null, groupId: 'g1' })), false, 'not a group session');
  assert.equal(isPrivateLesson(lesson('o', '2026-10-31', '07:00', { loggedBy: 'player' })), false, "not a player's own log");
  assert.equal(offerOf(slots, 'offered').id, 'o1');
  assert.equal(offerOf(slots, 'free'), null);
  assert.deepEqual(slotFromLesson(free, slots), { date: '2026-10-31', time: '10:00', durationMinutes: 60, place: 'Kenttä 2', sourceTrainingId: 'free' });
});

test('the add form: the next row follows the last one, and what still blocks publishing', () => {
  assert.deepEqual(firstDraftRow(NOW), { date: '2026-10-29', time: '' }, 'today, no time: nothing guessed');
  assert.deepEqual(nextDraftRow({ date: '2026-10-30', time: '17:00' }, 60, NOW), { date: '2026-10-30', time: '18:00' });
  assert.deepEqual(nextDraftRow({ date: '2026-10-30', time: '20:30' }, 90, NOW), { date: '2026-10-31', time: '20:30' }, 'not past 21:00');
  assert.deepEqual(nextDraftRow({ date: '2026-10-30', time: '' }, 60, NOW), { date: '2026-10-30', time: '' });
  const ok = { durationMinutes: 60, place: 'Kenttä 2' };
  assert.equal(draftProblem([{ date: '2026-10-30', time: '17:00' }], ok, NOW), null);
  assert.equal(draftProblem([], ok, NOW), 'Lisää vähintään yksi aika.');
  assert.equal(draftProblem([{ date: '2026-10-30', time: '' }], ok, NOW), 'Valitse kellonaika.');
  assert.equal(draftProblem([{ date: '2026-10-29', time: '15:00' }], ok, NOW), 'Vapaan ajan pitää olla tulevaisuudessa.');
  assert.equal(draftProblem([{ date: '2027-06-01', time: '15:00' }], ok, NOW), 'Vapaita aikoja voi lisätä enintään puoli vuotta eteenpäin.');
  assert.equal(draftProblem([{ date: '2026-10-30', time: '17:00' }, { date: '2026-10-30', time: '17:00' }], ok, NOW), 'Sama aika on listalla kahdesti.');
  assert.equal(draftProblem([{ date: '2026-10-30', time: '17:00' }], { durationMinutes: 300 }, NOW), 'Keston pitää olla 15–240 minuuttia.');
  assert.match(draftProblem([{ date: '2026-10-30', time: '17:00' }], { durationMinutes: 60, place: 'x'.repeat(121) }, NOW), /liian pitkä/);
  assert.deepEqual(draftSlots([{ date: '2026-10-30', time: '17:00' }], { durationMinutes: 90, place: ' Kenttä 2 ' }),
    [{ date: '2026-10-30', time: '17:00', durationMinutes: 90, place: 'Kenttä 2' }]);
});

// A browser's localStorage for the demo pages to share (node has none).
function fakeStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

test('demo: the coach adds a time, the player books it, and the lesson is in both weeks', async () => {
  Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage(), configurable: true });
  try {
    const { backend, configureDemo } = await import('../src/api/demo/index.js');
    const { COACH, PLAYER } = await import('../src/api/demo/seed.js');
    const day = koutsiAddDays(koutsiTodayStr(), 3);

    // the coach page
    configureDemo({ role: 'coach', latency: 0 });
    let coach = await backend.coach.load(COACH);
    assert.equal(coach.openSlotsReady, true, 'Anna has Vapaat ajat in the demo');
    assert.ok(coach.openSlots.some((s) => !s.bookedBy), 'with open times');
    const jussi = coach.openSlots.find((s) => s.bookedBy === 'demo-s-jussi');
    assert.ok(coach.trainings.some((t) => t.id === jussi.trainingId && t.type === 'Yksityistunti'), "Jussi's booking is a lesson in her week");
    const leo = coach.trainings.find((t) => t.id === 'tr-private-leo');
    assert.ok(leo.absences.some((a) => a.studentId === 'demo-s-leo'), 'Leo cannot come to his lesson');
    assert.equal(offerOf(coach.openSlots, leo.id), null, '…and it is not offered yet');

    assert.equal(await backend.openSlots.add(COACH, [{ date: day, time: '12:00', durationMinutes: 60, place: 'Kenttä 3' }, { date: day, time: '13:00', durationMinutes: 60, place: 'Kenttä 3' }]), 2);
    assert.equal(await backend.openSlots.add(COACH, [{ date: day, time: '12:00', durationMinutes: 60 }]), 0, 'a time that is open already is skipped');
    await assert.rejects(() => backend.openSlots.add(COACH, [{ date: koutsiAddDays(koutsiTodayStr(), -1), time: '12:00', durationMinutes: 60 }]), /tulevaisuudessa/);
    assert.equal(await backend.openSlots.add(COACH, [slotFromLesson(leo, coach.openSlots)]), 1, 'Leo\'s time is offered with one tap');
    assert.equal(await backend.openSlots.add(COACH, [slotFromLesson(leo, coach.openSlots)]), 0, '…once');
    coach = await backend.coach.load(COACH);
    const extra = coach.openSlots.find((s) => s.date === day && s.time === '13:00');
    await backend.openSlots.remove(extra.id);
    await assert.rejects(() => backend.openSlots.remove(jussi.id), /varattu/, 'a booked time goes only with its lesson');
    await assert.rejects(() => backend.openSlots.book(extra.id), /demossa/, 'the coach does not book');
    coach = await backend.coach.load(COACH);
    assert.ok(offerOf(coach.openSlots, leo.id), "Leo's time is open to the others");

    // the player page: its own memory, the shared browser
    configureDemo({ role: 'player', latency: 0 });
    let me = await backend.player.load(PLAYER);
    const added = me.openSlots.find((s) => s.date === day && s.time === '12:00');
    assert.ok(added, 'the time the coach added is there');
    assert.equal(added.place, 'Kenttä 3');
    assert.ok(!me.openSlots.some((s) => s.date === day && s.time === '13:00'), 'the removed one is not');
    assert.ok(me.openSlots.some((s) => s.sourceTrainingId === leo.id), "Leo's freed time is open to Maria");
    assert.ok(!me.openSlots.some((s) => s.bookedBy && s.bookedBy !== PLAYER), "nobody else's booking shows");
    const bell = await backend.notifications.list(PLAYER);
    assert.ok(bell.some((n) => n.kind === 'open_slots' && n.linkPath === '/pelaaja/vapaat'), 'Maria hears about the new times');
    await assert.rejects(() => backend.openSlots.book(jussi.id), /Joku ehti/, 'a booked time cannot be booked again');

    const { trainingId } = await backend.openSlots.book(added.id);
    assert.deepEqual(await backend.openSlots.book(added.id), { trainingId }, 'a double tap books nothing new');
    me = await backend.player.load(PLAYER);
    const mine = me.trainings.find((t) => t.id === trainingId);
    assert.deepEqual({ date: mine.date, time: mine.time, type: mine.type, studentId: mine.studentId, loggedBy: mine.loggedBy, durationMinutes: mine.durationMinutes },
      { date: day, time: '12:00', type: 'Yksityistunti', studentId: PLAYER, loggedBy: 'coach', durationMinutes: 60 }, "in Maria's week");
    assert.equal(openToBook(me.openSlots).some((s) => s.id === added.id), false, 'no longer open');
    await assert.rejects(() => backend.openSlots.add(COACH, [{ date: day, time: '15:00', durationMinutes: 60 }]), /demossa/, 'a player does not add');

    // back on the coach page
    configureDemo({ role: 'coach', latency: 0 });
    coach = await backend.coach.load(COACH);
    const booked = coach.openSlots.find((s) => s.id === added.id);
    assert.equal(booked.bookedBy, PLAYER);
    assert.ok(coach.trainings.some((t) => t.id === trainingId && t.studentId === PLAYER), "and in Anna's week");
    const notes = await backend.notifications.list(COACH);
    assert.ok(notes.some((n) => n.kind === 'slot_booked' && n.title === 'Maria K. varasi ajan' && n.linkPath === `/valmentaja/treeni/${trainingId}`), 'Anna hears who booked');

    // removing the lesson takes its slot with it, as in the database
    await backend.trainings.remove(trainingId);
    coach = await backend.coach.load(COACH);
    assert.equal(coach.openSlots.some((s) => s.id === added.id), false);
  } finally {
    delete globalThis.localStorage;
  }
});

test('demo without browser storage still works on its own page', async () => {
  const { backend, configureDemo } = await import('../src/api/demo/index.js');
  const { PLAYER } = await import('../src/api/demo/seed.js');
  configureDemo({ role: 'player', latency: 0 });
  const me = await backend.player.load(PLAYER);
  const first = openToBook(me.openSlots)[0];
  const { trainingId } = await backend.openSlots.book(first.id);
  assert.ok((await backend.player.load(PLAYER)).trainings.some((t) => t.id === trainingId));
});

// The real backend (api/supabase/openSlots.js) on a fake client.
function fakeClient(answers, calls) {
  const chain = (table) => {
    const q = { table, ops: [] };
    const self = new Proxy(q, {
      get(target, prop) {
        if (prop === 'then') {
          calls.push({ table, ops: target.ops });
          const answer = answers[`${table}:${target.ops.some((o) => o[0] === 'delete') ? 'delete' : 'select'}`];
          return (resolve) => resolve(answer);
        }
        return (...args) => { target.ops.push([prop, ...args]); return self; };
      },
    });
    return self;
  };
  return { from: chain, rpc: async (name, params) => { calls.push({ rpc: name, params }); return answers[name]; } };
}

test('the real app keeps Vapaat ajat hidden until the database has it; then the coach\'s gate decides', async () => {
  const { setClientForTests } = await import('../src/api/supabase/client.js');
  const { withOpenSlots, openSlots } = await import('../src/api/supabase/openSlots.js');
  const calls = [];
  const missingTable = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.koutsi_open_slots' in the schema cache" } };
  const missingFn = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.koutsi_open_slots_enabled' } };
  const row = { id: 'o1', coach_id: 'c', date: '2026-11-03', time: '17:00:00', duration_minutes: 90, place: 'Kenttä 2', source_training_id: null, booked_by: null, booked_at: null, training_id: null, created_at: '2026-10-29T10:00:00Z' };

  setClientForTests(fakeClient({ 'koutsi_open_slots:select': missingTable, koutsi_open_slots_enabled: missingFn }, calls));
  assert.deepEqual(await withOpenSlots('coach', 'c', Promise.resolve({ x: 1 })), { x: 1, openSlots: [], openSlotsReady: false });
  assert.deepEqual(await withOpenSlots('player', 's', Promise.resolve({ x: 1 })), { x: 1, openSlots: [], openSlotsReady: false });
  assert.ok(!calls.some((c) => c.rpc), 'before the migration: one quiet miss, no gate asked');

  setClientForTests(fakeClient({ 'koutsi_open_slots:select': { data: [row], error: null }, koutsi_open_slots_enabled: { data: false, error: null } }, calls));
  assert.deepEqual(await withOpenSlots('coach', 'c', Promise.resolve({})), { openSlots: [], openSlotsReady: false }, 'a coach without the feature (Alpo) sees nothing');

  calls.length = 0;
  setClientForTests(fakeClient({ 'koutsi_open_slots:select': { data: [row], error: null }, koutsi_open_slots_enabled: { data: true, error: null } }, calls));
  const coach = await withOpenSlots('coach', 'c', Promise.resolve({}));
  assert.equal(coach.openSlotsReady, true);
  assert.deepEqual(coach.openSlots, [{ id: 'o1', coachId: 'c', date: '2026-11-03', time: '17:00', durationMinutes: 90, place: 'Kenttä 2', sourceTrainingId: null, bookedBy: null, bookedAt: null, trainingId: null, at: '2026-10-29T10:00:00Z' }]);
  assert.ok(calls.some((c) => c.table === 'koutsi_open_slots' && c.ops.some((o) => o[0] === 'eq' && o[1] === 'coach_id' && o[2] === 'c')), "only the coach's own");

  calls.length = 0;
  const player = await withOpenSlots('player', 's', Promise.resolve({}));
  assert.equal(player.openSlotsReady, true);
  assert.equal(player.openSlots.length, 1);
  assert.ok(!calls.some((c) => c.rpc), 'a player has no gate to ask: row security decides');

  calls.length = 0;
  setClientForTests(fakeClient({ koutsi_add_open_slots: { data: 2, error: null }, koutsi_book_open_slot: { data: 't1', error: null }, 'koutsi_open_slots:delete': { data: [], error: null } }, calls));
  assert.equal(await openSlots.add('c', [{ date: '2026-11-03', time: '17:00', durationMinutes: 90, place: ' ' }, { date: '2026-11-04', time: '18:00', durationMinutes: 60, place: 'Kenttä 1', sourceTrainingId: 't0' }]), 2);
  assert.deepEqual(calls[0], { rpc: 'koutsi_add_open_slots', params: { p_slots: [
    { date: '2026-11-03', time: '17:00', duration: 90, place: null, source: null },
    { date: '2026-11-04', time: '18:00', duration: 60, place: 'Kenttä 1', source: 't0' },
  ] } });
  assert.deepEqual(await openSlots.book('o1'), { trainingId: 't1' });
  await assert.rejects(() => openSlots.remove('o1'), /varattu tai poistettu/, 'nothing removed = booked or gone');
  await assert.rejects(() => openSlots.add('c', []), /vähintään yksi/);
  setClientForTests(null);
});
