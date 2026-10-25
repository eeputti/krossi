// Viestit helpers (domain/messages.js): unread and unanswered, list times, the conversation as
// day separators and bubble groups, "Nähty", who messages are on for, the health-word check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayLabel, listTime, unreadTotal, unanswered, previewOf, namesLine, timeline, seen, messagingOf, groupMessaging, looksLikeHealth, sortThreads,
} from '../src/domain/messages.js';

const NOW = new Date(2026, 9, 27, 15, 40); // Tue 27.10.2026
const at = (d, h, m) => new Date(2026, 9, d, h, m).toISOString();

const T = (over) => ({ id: 't', coachId: 'c', studentId: 's', enabled: true, enabledAt: at(20, 9, 0), lastMessageAt: null, coachReadAt: null, playerReadAt: null, last: null, unread: 0, ...over });

test('day separators and list times read like a phone', () => {
  assert.equal(dayLabel('2026-10-27', NOW), 'Tänään');
  assert.equal(dayLabel('2026-10-26', NOW), 'Eilen');
  assert.equal(dayLabel('2026-10-21', NOW), 'ke 21.10.');
  assert.equal(listTime(at(27, 9, 5), NOW), '09:05');
  assert.equal(listTime(at(26, 18, 42), NOW), 'eilen');
  assert.equal(listTime(at(25, 18, 42), NOW), 'su');
  assert.equal(listTime(at(19, 18, 42), NOW), '19.10.');
  assert.equal(listTime(null, NOW), '');
});

test('unread, unanswered and previews', () => {
  const threads = [
    T({ id: 'a', unread: 2, lastMessageAt: at(26, 18, 42), last: { body: 'Pääsenkö torstaina?', sender: 'player' } }),
    T({ id: 'b', unread: 0, lastMessageAt: at(27, 9, 0), last: { body: 'Kiitos!', sender: 'coach' } }),
    T({ id: 'c', unread: 1, lastMessageAt: at(27, 10, 0), last: { body: 'Toiveesta  vielä', sender: 'player' } }),
    T({ id: 'd' }),
  ];
  assert.equal(unreadTotal(threads), 3);
  assert.deepEqual(unanswered(threads).map((t) => t.id), ['c', 'a'], 'the player wrote last, newest first');
  assert.deepEqual(unanswered(threads, 'player').map((t) => t.id), ['b'], 'for a player: the coach wrote last');
  assert.equal(previewOf(threads[1], 'coach'), 'Sinä: Kiitos!');
  assert.equal(previewOf(threads[2], 'coach'), 'Toiveesta vielä');
  assert.equal(previewOf(threads[3], 'coach'), '');
  assert.deepEqual(sortThreads(threads).map((t) => t.id), ['c', 'b', 'a', 'd']);
});

test('names line', () => {
  assert.equal(namesLine([]), '');
  assert.equal(namesLine(['Maria K.']), 'Maria K.');
  assert.equal(namesLine(['Maria K.', 'Jussi T.']), 'Maria K. ja Jussi T.');
  assert.equal(namesLine(['Maria K.', 'Jussi T.', 'Pirjo S.', 'Aleksi R.']), 'Maria K., Jussi T. ja 2 muuta');
});

test('the conversation: days, groups of one side in a row, ten minutes at most apart', () => {
  const messages = [
    { id: '3', sender: 'coach', body: 'Pääset!', at: at(27, 15, 12) },
    { id: '1', sender: 'player', body: 'Moi!', at: at(26, 18, 41) },
    { id: '2', sender: 'player', body: 'Pääsenkö torstaina?', at: at(26, 18, 42) },
    { id: '4', sender: 'coach', body: 'Ja vielä', at: at(27, 15, 40) },
  ];
  const items = timeline(messages, 'coach', NOW);
  assert.deepEqual(items.map((i) => (i.kind === 'day' ? i.label : `${i.mine ? 'me' : 'them'}:${i.bubbles.map((b) => b.id).join(',')}@${i.time}`)),
    ['Eilen', 'them:1,2@18:42', 'Tänään', 'me:3@15:12', 'me:4@15:40']);
});

test('"Nähty": own latest message, read by the other side since', () => {
  const messages = [{ id: '1', sender: 'player', body: 'Moi', at: at(26, 18, 42) }, { id: '2', sender: 'coach', body: 'Pääset!', at: at(27, 15, 12) }];
  assert.equal(seen(T({ playerReadAt: at(27, 15, 30) }), messages, 'coach'), true);
  assert.equal(seen(T({ playerReadAt: at(27, 15, 0) }), messages, 'coach'), false, 'read before the reply');
  assert.equal(seen(T({ playerReadAt: null }), messages, 'coach'), false);
  assert.equal(seen(T({ coachReadAt: at(27, 16, 0) }), messages, 'player'), false, 'the latest is not the player\'s own');
});

test('who messages are on for, by player and by group', () => {
  const threads = [T({ studentId: 'a', enabled: true }), T({ studentId: 'b', enabled: false })];
  assert.equal(messagingOf(threads, 'a'), 'on');
  assert.equal(messagingOf(threads, 'b'), 'off');
  assert.equal(messagingOf(threads, 'c'), 'unset');
  assert.equal(groupMessaging({ memberIds: ['a'] }, threads), 'on');
  assert.equal(groupMessaging({ memberIds: ['a', 'b'] }, threads), 'some');
  assert.equal(groupMessaging({ memberIds: ['b', 'c'] }, threads), 'off');
  assert.equal(groupMessaging({ memberIds: [] }, threads), 'off');
});

test('the health reminder: illness and injury words, not tennis words', () => {
  for (const t of ['Olen kipeänä tänään', 'Flunssa iski', 'Nilkka nyrjähti', 'lääkäri sanoi että', 'Polvessa vamma']) assert.equal(looksLikeHealth(t), true, t);
  for (const t of ['Polvet koukkuun syötössä', 'Pääsenkö torstaina?', 'Jalat olivat raskaat', 'Kiitos treenistä!']) assert.equal(looksLikeHealth(t), false, t);
});

// The real backend (api/supabase/messages.js) on a fake client: before the migration Viestit stays
// hidden (ready: false) and nothing else is asked; after it, the coach's gate decides.
test('the real app keeps Viestit hidden until the database has it', async () => {
  const { setClientForTests } = await import('../src/api/supabase/client.js');
  const { messages } = await import('../src/api/supabase/messages.js');
  const calls = [];
  const fake = (answers) => ({ rpc: async (name) => { calls.push(name); return answers[name]; } });
  const missing = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.koutsi_thread_overview' } };

  setClientForTests(fake({ koutsi_thread_overview: missing }));
  assert.deepEqual(await messages.overview('coach'), { ready: false, enabled: false, threads: [] });
  assert.deepEqual(await messages.overview('player'), { ready: false, enabled: false, threads: [] });
  assert.deepEqual(calls, ['koutsi_thread_overview', 'koutsi_thread_overview'], 'no gate asked before the migration');

  const row = { id: 't1', coach_id: 'c', student_id: 's', enabled: true, enabled_at: '2026-10-25T10:00:00Z', last_message_at: '2026-10-26T18:42:00Z',
    coach_read_at: null, player_read_at: null, last_body: 'Pääsenkö torstaina?', last_sender: 'player', last_ref_kind: null, unread: 2 };
  setClientForTests(fake({ koutsi_thread_overview: { data: [row], error: null }, koutsi_messages_enabled: { data: false, error: null } }));
  const off = await messages.overview('coach');
  assert.equal(off.ready, true);
  assert.equal(off.enabled, false, 'a coach outside the beta still sees nothing');
  setClientForTests(fake({ koutsi_thread_overview: { data: [row], error: null }, koutsi_messages_enabled: { data: true, error: null } }));
  const on = await messages.overview('coach');
  assert.equal(on.enabled, true);
  assert.deepEqual(on.threads[0].last, { body: 'Pääsenkö torstaina?', sender: 'player', refKind: null });
  assert.equal(on.threads[0].unread, 2);
  const player = await messages.overview('player');
  assert.equal(player.enabled, true, 'a player with an open conversation');
  setClientForTests(null);
});
