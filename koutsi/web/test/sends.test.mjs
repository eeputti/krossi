// sends.test.mjs — Lähetetyt (domain/sends.js): groups by name, homework progress, who already has it,
// the same thing's other sendings, the coach's videos, and the demo world's sendings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  audienceIds, filterSent, groupsCovering, homeworkProgress, libraryItems, libraryLine, receivedBy, recipientsLabel,
  relatedSends, sendLogFor, sentByDay, sentDayLabel, sentItems,
} from '../src/domain/sends.js';
import { seed } from '../src/api/demo/seed.js';

const student = (id, name, extra = {}) => ({ id, name, homework: [], diary: [], videos: [], ...extra });
const groups = [
  { id: 'g-kilpa', name: 'Juniorit kilpa', day: 'Ma', memberIds: ['leo', 'ilona', 'emil'] },
  { id: 'g-kilpa-ke', name: 'Juniorit kilpa', day: 'Ke', memberIds: ['leo', 'ilona', 'emil'] },
  { id: 'g-pari', name: 'Pari', day: 'Ti', memberIds: ['leo', 'ilona'] },
  { id: 'g-aik', name: 'Aikuiset', day: 'Ti', memberIds: ['maria', 'aleksi'] },
];

test('groupsCovering: whole groups only, the biggest first, none that adds nobody', () => {
  assert.deepEqual(groupsCovering(groups, ['leo', 'ilona', 'emil']), ['g-kilpa']);
  assert.deepEqual(groupsCovering(groups, ['leo', 'ilona']), ['g-pari']);
  assert.deepEqual(groupsCovering(groups, ['leo', 'ilona', 'emil', 'maria', 'aleksi']), ['g-kilpa', 'g-aik']);
  assert.deepEqual(groupsCovering(groups, ['maria']), []);
  assert.deepEqual(groupsCovering([{ id: 'empty', name: 'Tyhjä', memberIds: [] }], ['maria']), [], 'an empty group covers nobody');
});

test('recipientsLabel: groups by name (with the weekday when two share a name), the rest by first name', () => {
  const state = {
    groups, students: ['leo', 'ilona', 'emil', 'maria', 'aleksi', 'sanna', 'petri', 'otto'].map((id) => student(id, `${id[0].toUpperCase()}${id.slice(1)} K.`)),
  };
  assert.equal(recipientsLabel(state, { groupIds: ['g-aik'], studentIds: ['maria', 'aleksi'] }), 'Aikuiset');
  assert.equal(recipientsLabel(state, { groupIds: ['g-kilpa'], studentIds: ['leo', 'ilona', 'emil'] }), 'Juniorit kilpa (ma)');
  assert.equal(recipientsLabel(state, { groupIds: ['g-aik'], studentIds: ['maria', 'aleksi', 'sanna'] }), 'Aikuiset + Sanna');
  assert.equal(recipientsLabel(state, { groupIds: [], studentIds: ['maria'] }), 'Maria');
  assert.equal(recipientsLabel(state, { groupIds: [], studentIds: ['maria', 'sanna'] }), 'Maria ja Sanna');
  assert.equal(recipientsLabel(state, { groupIds: [], studentIds: ['maria', 'sanna', 'petri', 'otto'] }), 'Maria, Sanna ja 2 muuta');
  assert.equal(recipientsLabel(state, { groupIds: [], studentIds: ['gone'] }), 'Ei enää ketään');
});

test('sentItems: sendings and tiedotteet newest first; homework progress from the copies still there', () => {
  const state = {
    groups,
    students: [
      student('maria', 'Maria K.', { homework: [{ id: 'h1', at: '2026-10-20T16:40:00Z', text: 'Syötöt', done: false, sendId: 's1' }] }),
      student('aleksi', 'Aleksi R.', { homework: [{ id: 'h2', at: '2026-10-20T16:40:00Z', text: 'Syötöt', done: true, doneAt: '2026-10-22T05:00:00Z', sendId: 's1' }] }),
    ],
    sends: [{ id: 's1', kind: 'homework', refId: 's1', title: 'Syötöt', groupIds: ['g-aik'], studentIds: ['maria', 'aleksi'], at: '2026-10-20T16:40:00Z' }],
    announcements: [{ id: 'a1', text: 'Kenttä 3', groupIds: ['g-aik'], studentIds: [], until: '2026-11-01', at: '2026-10-21T08:00:00Z' }],
  };
  const items = sentItems(state);
  assert.deepEqual(items.map((it) => it.kind), ['notice', 'homework']);
  assert.deepEqual(homeworkProgress(items[1]), { done: 1, total: 2 });
  assert.equal(homeworkProgress(items[0]), null);
  assert.deepEqual(audienceIds(state, items[0]).sort(), ['aleksi', 'maria'], 'a tiedote reaches its groups\' members');
  assert.equal(filterSent(items, { kind: 'laksy' }).length, 1);
  assert.equal(filterSent(items, { kind: 'tiedote' }).length, 1);
  assert.equal(filterSent(items, { groupId: 'g-kilpa' }).length, 0);
  assert.equal(filterSent(items, { groupId: 'g-aik' }).length, 2);
});

test('receivedBy and relatedSends: whoever has it from any sending of the same thing', () => {
  const state = {
    groups,
    students: [
      student('maria', 'Maria K.', { diary: [{ id: 'd1', at: '2026-10-20T10:00:00Z', text: 'Hyvä', sendId: 's1' }], videos: [{ id: 'v1', shareId: 'vid', at: '2026-10-19T10:00:00Z' }] }),
      student('leo', 'Leo K.', { diary: [{ id: 'd2', at: '2026-10-22T10:00:00Z', text: 'Hyvä', sendId: 's2' }] }),
      student('sanna', 'Sanna P.', { diary: [{ id: 'd3', at: '2026-10-22T10:00:00Z', text: 'Muu', sendId: 's3' }] }),
    ],
    sends: [
      { id: 's1', kind: 'note', refId: 's1', title: 'Hyvä', groupIds: [], studentIds: ['maria'], at: '2026-10-20T10:00:00Z' },
      { id: 's2', kind: 'note', refId: 's1', title: 'Hyvä', groupIds: [], studentIds: ['leo'], at: '2026-10-22T10:00:00Z' },
      { id: 's3', kind: 'note', refId: 's3', title: 'Muu', groupIds: [], studentIds: ['sanna'], at: '2026-10-22T10:00:00Z' },
    ],
  };
  const item = sentItems(state).find((it) => it.id === 's1');
  assert.deepEqual([...receivedBy(state, item).keys()].sort(), ['leo', 'maria'], 'Sanna got another note, not this one');
  assert.deepEqual(relatedSends(state, item).map((x) => x.id), ['s2']);
  assert.deepEqual([...receivedBy(state, { kind: 'video', videoId: 'vid' }).keys()], ['maria']);
});

test('libraryItems: who has each video now and where it went; a saved one nobody has yet', () => {
  const state = {
    groups,
    students: [student('maria', 'Maria K.', { videos: [{ id: 'v1', shareId: 'vid', addedBy: 'coach', at: '2026-10-19T10:00:00Z' }, { id: 'own', shareId: 'own', addedBy: 'player' }] }),
      student('aleksi', 'Aleksi R.', { videos: [{ id: 'v2', shareId: 'vid', addedBy: 'coach', at: '2026-10-19T10:00:00Z' }] })],
    videoLibrary: [{ id: 'vid', title: 'Kick', at: '2026-10-19T09:00:00Z' }, { id: 'new', title: 'Nelinpeli', at: '2026-10-25T09:00:00Z' }],
    sends: [{ id: 's1', kind: 'video', videoId: 'vid', refId: 'vid', title: 'Kick', groupIds: ['g-aik'], studentIds: ['maria', 'aleksi'], at: '2026-10-19T10:00:00Z' }],
  };
  const [fresh, kick] = libraryItems(state);
  assert.equal(fresh.id, 'new');
  assert.deepEqual(fresh.holderIds, []);
  assert.equal(libraryLine(state, fresh), 'Ei vielä jaettu');
  assert.deepEqual(kick.holderIds.sort(), ['aleksi', 'maria']);
  assert.equal(kick.sends.length, 1);
  assert.match(libraryLine(state, kick), /^Aikuiset · /);
});

test('sendLogFor: nothing before the database has Lähetetyt; the covered groups after', () => {
  assert.equal(sendLogFor({ sendsReady: false, groups }, 'c', ['maria', 'aleksi']), null);
  assert.deepEqual(sendLogFor({ sendsReady: true, groups }, 'c', ['maria', 'aleksi']), { coachId: 'c', groupIds: ['g-aik'] });
  assert.deepEqual(sendLogFor({ sendsReady: true, groups }, 'c', ['maria'], 's1'), { coachId: 'c', groupIds: [], refId: 's1' });
});

test('sentByDay / sentDayLabel', () => {
  const now = new Date(2026, 9, 26, 12, 0);
  assert.equal(sentDayLabel('2026-10-26', now), 'Tänään');
  assert.equal(sentDayLabel('2026-10-25', now), 'Eilen');
  assert.equal(sentDayLabel('2026-10-19', now), 'ma 19.10.');
  const days = sentByDay([
    { at: new Date(2026, 9, 26, 10).toISOString() }, { at: new Date(2026, 9, 26, 9).toISOString() }, { at: new Date(2026, 9, 24, 9).toISOString() },
  ], now);
  assert.deepEqual(days.map((d) => [d.label, d.items.length]), [['Tänään', 2], ['la 24.10.', 1]]);
});

test('the demo world: Maria\'s Tuesday group got one homework together, two videos went out, one waits', () => {
  const s = seed();
  const state = { ...s, sendsReady: true };
  const items = sentItems(state);
  const hw = items.find((it) => it.kind === 'homework' && it.title.startsWith('20 kakkossyöttöä'));
  assert.ok(hw, 'the group homework is one sending');
  assert.equal(hw.copies.length, 4);
  assert.deepEqual(homeworkProgress(hw), { done: 2, total: 4 });
  assert.match(recipientsLabel(state, hw), /^Aikuiset edistyneet/);
  const lib = libraryItems(state);
  assert.equal(lib.length, 3);
  assert.equal(lib.filter((v) => v.holderIds.length === 0).length, 1, 'one saved video nobody has yet');
  for (const st of s.students) {
    for (const h of st.homework) assert.ok(h.sendId, `${st.name}'s homework belongs to a sending`);
    for (const d of st.diary) assert.ok(d.sendId, `${st.name}'s note belongs to a sending`);
  }
});
