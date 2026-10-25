// 20261109120000_koutsi_messages.check.mjs — runs the proposed Viestit migration
// (koutsi/web/sql/20261109120000_koutsi_messages.sql, NOT applied) in PGlite against a small stub
// of production's Koutsi schema (tables, policies and helpers it leans on, copied 2026-10-25), then
// checks who can read and write, the claim and deletion cascades, the e-mail streaks and the prune.
// PGlite is not a dependency of the repo, so this is not part of `npm run test:koutsi`. Before
// "aja migraatio":
//   (in an empty temp folder) npm i @electric-sql/pglite@0.3
//   PGLITE=<that folder>/node_modules/@electric-sql/pglite/dist/index.js node --test koutsi/web/sql/20261109120000_koutsi_messages.check.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite');

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = await readFile(join(here, '20261109120000_koutsi_messages.sql'), 'utf8');

const ANNA = '00000000-0000-4000-8000-0000000000a1'; // coach, beta tester
const JUHO = '00000000-0000-4000-8000-0000000000b1'; // coach, not in the beta
const ADMIN = '00000000-0000-4000-8000-0000000000e1';
const MARIA = '00000000-0000-4000-8000-000000000001'; // Anna's player, has an account
const JUSSI = '00000000-0000-4000-8000-000000000002'; // Anna's player, has an account
const PH = '00000000-0000-4000-8000-000000000003'; // Anna's placeholder (no account)
const PIRJO = '00000000-0000-4000-8000-000000000004'; // the placeholder's real account, claims later
const OTTO = '00000000-0000-4000-8000-000000000005'; // Anna's player, messages never turned on

const STUB = `
create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
-- Supabase's defaults: new tables and functions in public are open to the API roles until revoked.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create table public.profiles (id uuid primary key, name text);
create table public.koutsi_admins (user_id uuid primary key);
create table public.koutsi_beta_testers (email text primary key);
create table public.koutsi_coaches (id uuid primary key);
create table public.koutsi_students (id uuid primary key, name text);
create table public.koutsi_coach_students (
  coach_id uuid not null references public.koutsi_coaches(id) on delete cascade,
  student_id uuid not null references public.koutsi_students(id) on delete cascade,
  ended_at timestamptz, created_at timestamptz not null default now(),
  primary key (coach_id, student_id));
create table public.koutsi_notifications (id uuid primary key default gen_random_uuid(), recipient_id uuid not null, actor_id uuid,
  kind text not null, title text not null, body text, link_path text,
  created_at timestamptz not null default coalesce(nullif(current_setting('test.now', true), '')::timestamptz, now()),
  read_at timestamptz, email_status text not null default 'pending');

create function public.koutsi_is_admin() returns boolean language sql stable security definer set search_path to '' as $$
  select (select auth.uid()) is not null and exists (select 1 from public.koutsi_admins a where a.user_id = (select auth.uid())); $$;
create function public.koutsi_acts_as(target uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select target is not null and (target = (select auth.uid()) or public.koutsi_is_admin()); $$;
create function public.koutsi_notify(p_recipient uuid, p_actor uuid, p_kind text, p_title text, p_body text, p_link text) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if p_recipient is null or p_recipient = p_actor then return; end if;
  if not exists (select 1 from auth.users u where u.id = p_recipient) then return; end if;
  insert into koutsi_notifications (recipient_id, actor_id, kind, title, body, link_path)
  values (p_recipient, p_actor, p_kind, p_title, left(coalesce(p_body, ''), 500), p_link);
end; $$;

alter table public.koutsi_coach_students enable row level security;
create policy koutsi_coach_students_select on public.koutsi_coach_students for select using (koutsi_acts_as(coach_id) or student_id = auth.uid());
create policy koutsi_coach_students_update on public.koutsi_coach_students for update
  using (koutsi_acts_as(coach_id) or student_id = auth.uid()) with check (koutsi_acts_as(coach_id) or student_id = auth.uid());
alter table public.koutsi_notifications enable row level security;
create policy koutsi_notifications_select on public.koutsi_notifications for select to authenticated using (recipient_id = auth.uid());
`;

const SEED = `
insert into auth.users (id, email) values ('${ANNA}', 'anna@example.test'), ('${JUHO}', 'juho@example.test'), ('${ADMIN}', 'admin@example.test'),
  ('${MARIA}', 'maria@example.test'), ('${JUSSI}', 'jussi@example.test'), ('${OTTO}', 'otto@example.test');
insert into profiles (id, name) values ('${ANNA}', 'Anna Virtanen'), ('${JUHO}', 'Juho Aalto'), ('${ADMIN}', 'Ylläpitäjä'),
  ('${MARIA}', 'Maria K.'), ('${JUSSI}', 'Jussi T.'), ('${OTTO}', 'Otto L.'), ('${PIRJO}', 'Pirjo S.');
insert into koutsi_admins (user_id) values ('${ADMIN}');
insert into koutsi_beta_testers (email) values ('Anna@Example.test');
insert into koutsi_coaches (id) values ('${ANNA}'), ('${JUHO}'), ('${ADMIN}');
insert into koutsi_students (id, name) values ('${MARIA}', 'Maria K.'), ('${JUSSI}', 'Jussi T.'), ('${PH}', 'Pirjo S.'), ('${OTTO}', 'Otto L.');
insert into koutsi_coach_students (coach_id, student_id) values ('${ANNA}', '${MARIA}'), ('${ANNA}', '${JUSSI}'), ('${ANNA}', '${PH}'), ('${ANNA}', '${OTTO}'),
  ('${JUHO}', '${MARIA}');
`;

const db = new PGlite();
await db.exec(STUB);
await db.exec(SEED);
await db.exec(MIGRATION);
await db.exec(MIGRATION); // must be re-runnable

/** Runs `sql` as `uid` (role authenticated) in a transaction, rolled back unless `keep`. */
async function as(uid, sql, { keep = true } = {}) {
  await db.exec('begin');
  try {
    await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);`);
    const res = await db.query(sql);
    await db.exec(keep ? 'commit' : 'rollback');
    return { rows: res.rows, error: null };
  } catch (error) {
    await db.exec('rollback');
    return { rows: [], error };
  }
}
const one = async (sql) => (await db.query(sql)).rows[0];
/** Superuser SQL that inserts messages: the trigger takes the sender from the signed-in id. */
async function asSuper(uid, sql) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false)`);
  try { await db.exec(sql); } finally { await db.exec(`select set_config('request.jwt.claim.sub', '', false)`); }
}
const thread = async (coach, student) => one(`select * from koutsi_threads where coach_id = '${coach}' and student_id = '${student}'`);
const send = (uid, threadId, body, extra = '') => as(uid, `insert into koutsi_messages (thread_id, body${extra ? ', ref_kind, ref_id' : ''}) values ('${threadId}', '${body}'${extra}) returning id, sender, created_at`);

test('turning messages on: only the coach, only their own current players, only with the feature', async () => {
  let r = await as(JUHO, `select public.koutsi_set_messages(array['${MARIA}']::uuid[], true) as n`);
  assert.match(String(r.error?.message), /eivät ole vielä käytössä/, 'a coach outside the beta cannot turn messages on');
  r = await as(MARIA, `select public.koutsi_set_messages(array['${JUSSI}']::uuid[], true) as n`);
  assert.ok(r.error, 'a player cannot turn messages on');
  r = await as(ANNA, `select public.koutsi_set_messages(array['${MARIA}', '${JUSSI}', '${PH}']::uuid[], true) as n`);
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.rows[0].n, 3, 'three conversations turned on (the placeholder too)');
  r = await as(ANNA, `select public.koutsi_set_messages(array['${MARIA}']::uuid[], true) as n`);
  assert.equal(r.rows[0].n, 0, 'turning on again changes nothing');
  r = await as(ANNA, `select public.koutsi_set_messages(array['${JUHO}']::uuid[], true) as n`);
  assert.equal(r.rows[0].n, 0, 'someone who is not her player is ignored');
  r = await as(ANNA, `insert into koutsi_threads (coach_id, student_id, enabled) values ('${ANNA}', '${OTTO}', true) returning id`);
  assert.ok(r.error, 'nobody inserts conversations directly');
  assert.equal(await thread(ANNA, OTTO), undefined, 'Otto has no conversation');
  r = await as(ADMIN, `select public.koutsi_messages_enabled() as on`);
  assert.equal(r.rows[0].on, true, 'admins have the feature');
  r = await as(JUHO, `select public.koutsi_messages_enabled() as on`);
  assert.equal(r.rows[0].on, false, 'Juho does not');
});

test('the two of them write and read; nobody else sees anything', async () => {
  const t = await thread(ANNA, MARIA);
  let r = await send(MARIA, t.id, 'Pääsenkö torstain ryhmään tällä viikolla?');
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.rows[0].sender, 'player', 'the server decides who sent it');
  r = await as(MARIA, `insert into koutsi_messages (thread_id, body, sender, created_at) values ('${t.id}', 'Hei', 'coach', '2020-01-01') returning sender, created_at`);
  assert.equal(r.rows[0].sender, 'player', 'a player cannot send as the coach');
  assert.ok(new Date(r.rows[0].created_at).getFullYear() >= 2026, 'nor backdate a message');
  r = await send(ANNA, t.id, 'Pääset! Torstaina klo 18.');
  assert.equal(r.rows[0].sender, 'coach');

  r = await as(MARIA, `select body from koutsi_messages order by created_at`);
  assert.equal(r.rows.length, 3, 'Maria sees her conversation');
  r = await as(ANNA, `select body from koutsi_messages`);
  assert.equal(r.rows.length, 3, 'Anna sees it');
  r = await as(JUHO, `select id from koutsi_messages union all select id from koutsi_threads`);
  assert.equal(r.rows.length, 0, "Maria's other coach sees nothing");
  r = await as(ADMIN, `select id from koutsi_messages union all select id from koutsi_threads`);
  assert.equal(r.rows.length, 0, 'an admin sees nothing either');
  r = await as(JUSSI, `select id from koutsi_messages`);
  assert.equal(r.rows.length, 0, 'another player sees nothing');
  r = await as(JUSSI, `select student_id from koutsi_threads`);
  assert.deepEqual(r.rows.map((x) => x.student_id), [JUSSI], 'Jussi sees only his own conversation');
  r = await send(JUSSI, t.id, 'Moi');
  assert.ok(r.error, "Jussi cannot write in Maria's conversation");
  r = await send(JUHO, t.id, 'Moi');
  assert.ok(r.error, 'nor can another coach');
  r = await send(MARIA, t.id, '   ');
  assert.ok(r.error, 'an empty message is refused');
  r = await send(MARIA, t.id, 'x'.repeat(2001));
  assert.ok(r.error, 'over 2000 characters is refused');
  r = await send(MARIA, t.id, 'Vastaus tiedotteeseen', `, 'announcement', '${t.id}'`);
  assert.equal(r.error, null, 'a reply can point at a notice');
  r = await as(MARIA, `update koutsi_messages set body = 'muokattu' returning id`);
  assert.equal(r.rows.length, 0, 'messages are never edited');
});

test('read markers, "Nähty" and the order of conversations', async () => {
  const t = await thread(ANNA, MARIA);
  assert.ok(t.last_message_at, 'the conversation knows its latest message');
  assert.ok(t.player_read_at.getTime() >= t.last_message_at.getTime(), "Maria's own latest message counts as read by her");
  let r = await as(MARIA, `select public.koutsi_mark_thread_read('${t.id}')`);
  assert.equal(r.error, null, r.error?.message);
  const after = await thread(ANNA, MARIA);
  assert.ok(new Date(after.player_read_at) >= new Date(after.last_message_at), "Maria has read everything — Anna's app can show Nähty");
  r = await as(JUSSI, `select public.koutsi_mark_thread_read('${t.id}')`);
  assert.equal((await thread(ANNA, MARIA)).player_read_at.getTime(), after.player_read_at.getTime(), 'someone else cannot touch the markers');
  r = await as(MARIA, `update koutsi_threads set coach_read_at = now() returning id`);
  assert.ok(r.error || r.rows.length === 0, 'markers change only through the function');
});

test('a placeholder cannot be written to until they claim; then the conversation follows them', async () => {
  const t = await thread(ANNA, PH);
  let r = await send(ANNA, t.id, 'Tervetuloa!');
  assert.ok(r.error, 'no messages to a player without an account');
  // koutsi_claim_player: the real account takes the placeholder's coaching row
  await db.exec(`insert into auth.users (id, email) values ('${PIRJO}', 'pirjo@example.test');
    insert into koutsi_students (id, name) values ('${PIRJO}', 'Pirjo S.');
    update koutsi_coach_students set student_id = '${PIRJO}', ended_at = null where student_id = '${PH}';
    delete from koutsi_students where id = '${PH}';`);
  const moved = await thread(ANNA, PIRJO);
  assert.equal(moved?.id, t.id, 'the same conversation now belongs to the account');
  r = await send(ANNA, moved.id, 'Tervetuloa!');
  assert.equal(r.error, null, r.error?.message);
  r = await as(PIRJO, `select body from koutsi_messages`);
  assert.deepEqual(r.rows.map((x) => x.body), ['Tervetuloa!'], 'Pirjo reads it');
});

test('turning off, and coaching that ends', async () => {
  const t = await thread(ANNA, JUSSI);
  let r = await send(JUSSI, t.id, 'Kiitos treenistä!');
  assert.equal(r.error, null);
  r = await as(ANNA, `select public.koutsi_set_messages(array['${JUSSI}']::uuid[], false) as n`);
  assert.equal(r.rows[0].n, 1);
  r = await send(JUSSI, t.id, 'Vielä yksi');
  assert.ok(r.error, 'turned off: no new messages');
  r = await send(ANNA, t.id, 'Vielä yksi');
  assert.ok(r.error, 'not from the coach either');
  r = await as(JUSSI, `select body from koutsi_messages`);
  assert.equal(r.rows.length, 1, 'the history stays readable');
  r = await as(ANNA, `select public.koutsi_set_messages(array['${OTTO}']::uuid[], false) as n`);
  assert.equal((await thread(ANNA, OTTO)).enabled, false, '"not for this player" is stored as a decision');

  const m = await thread(ANNA, MARIA);
  await db.exec(`update koutsi_coach_students set ended_at = now() where coach_id = '${ANNA}' and student_id = '${MARIA}'`);
  r = await as(ANNA, `select id from koutsi_messages m where m.thread_id = '${m.id}' union all select id from koutsi_threads where id = '${m.id}'`);
  assert.equal(r.rows.length, 0, 'coaching ended: the coach no longer sees the conversation');
  r = await as(MARIA, `select id from koutsi_messages`);
  assert.ok(r.rows.length > 0, 'the player keeps it');
  r = await send(MARIA, m.id, 'Hei?');
  assert.ok(r.error, 'nobody writes after the coaching ended');
  await db.exec(`update koutsi_coach_students set ended_at = null where coach_id = '${ANNA}' and student_id = '${MARIA}'`);
});

test('the sender deletes their own message, never the other one', async () => {
  const t = await thread(ANNA, MARIA);
  const before = await thread(ANNA, MARIA);
  const mine = (await send(MARIA, t.id, 'Poistan tämän')).rows[0];
  const theirs = (await as(ANNA, `select id from koutsi_messages where sender = 'coach' and thread_id = '${t.id}' limit 1`)).rows[0];
  let r = await as(MARIA, `delete from koutsi_messages where id = '${theirs.id}' returning id`);
  assert.equal(r.rows.length, 0, "Maria cannot delete Anna's message");
  r = await as(ANNA, `delete from koutsi_messages where id = '${mine.id}' returning id`);
  assert.equal(r.rows.length, 0, "Anna cannot delete Maria's message");
  r = await as(MARIA, `delete from koutsi_messages where id = '${mine.id}' returning id`);
  assert.equal(r.rows.length, 1, 'Maria deletes her own');
  const after = await thread(ANNA, MARIA);
  assert.equal(after.last_message_at.getTime(), before.last_message_at.getTime(), 'the order falls back to the latest remaining message');
});

test('at most 30 messages an hour per sender in one conversation', async () => {
  const t = await thread(ANNA, PIRJO);
  await db.exec(`delete from koutsi_messages where thread_id = '${t.id}'`);
  await asSuper(ANNA, `insert into koutsi_messages (thread_id, body) select '${t.id}', 'viesti ' || g from generate_series(1, 29) g`);
  let r = await send(ANNA, t.id, '30.');
  assert.equal(r.error, null, 'the 30th goes');
  r = await send(ANNA, t.id, '31.');
  assert.match(String(r.error?.message), /Liian monta viestiä/, 'the 31st waits');
  r = await send(PIRJO, t.id, 'Rauhoitu :)');
  assert.equal(r.error, null, 'the other side is not blocked');
  await db.exec(`delete from koutsi_messages where thread_id = '${t.id}'`);
});

test('e-mail: one per unread streak, names only, never at night', async () => {
  await db.exec(`delete from koutsi_messages; delete from koutsi_notifications;
    update koutsi_threads set coach_read_at = null, player_read_at = null;`);
  // Noon yesterday in Helsinki: in the past whenever this runs, so reading "now" comes after.
  const noon = (await one(`select ((date_trunc('day', now() at time zone 'Europe/Helsinki') - interval '12 hours') at time zone 'Europe/Helsinki') as t`)).t;
  const at = (minutes) => `('${noon.toISOString()}'::timestamptz + interval '${minutes} minutes')`;
  const queue = async (minutes) => {
    await db.exec(`select set_config('test.now', ${at(minutes)}::text, false)`);
    return (await one(`select public.koutsi_queue_message_emails(${at(minutes)}) as n`)).n;
  };
  const tm = await thread(ANNA, MARIA);
  const tp = await thread(ANNA, PIRJO);
  await send(MARIA, tm.id, 'Salainen sisältö: pääsenkö torstaina?');
  await send(PIRJO, tp.id, 'Kiitos!');
  await db.exec(`update koutsi_messages set created_at = ${at(-20)}`);

  assert.equal(await queue(-10 * 60), 0, 'never between 21 and 07 (02:00 the night before)');
  assert.equal(await queue(-10), 0, 'not before 15 minutes have passed');
  assert.equal(await queue(0), 1, 'one mail for Anna about two players');
  const n = await one(`select * from koutsi_notifications`);
  assert.equal(n.recipient_id, ANNA);
  assert.equal(n.kind, 'message');
  assert.equal(n.title, 'Uusia viestejä pelaajilta');
  assert.equal(n.body, 'Maria K. ja Pirjo S. lähettivät sinulle viestejä Koutsissa.');
  assert.ok(!n.body.includes('Salainen'), 'the text is never in the mail');
  assert.equal(n.actor_id, null, 'two senders: no single actor');
  assert.equal(n.link_path, '/valmentaja/viestit?uusi=1');
  assert.equal(await queue(10), 0, 'the same streak: no second mail');

  await send(MARIA, tm.id, 'Ja vielä yksi');
  await db.exec(`update koutsi_messages set created_at = ${at(5)} where body = 'Ja vielä yksi'`);
  // her own message means she has read the conversation up to then (the trigger used the real clock)
  await db.exec(`update koutsi_threads set player_read_at = ${at(5)} where id = '${tm.id}'`);
  assert.equal(await queue(40), 0, 'something new within a day: still no second mail');
  assert.equal(await queue(25 * 60), 1, 'a day later, with something new since: one reminder');

  await as(ANNA, `select public.koutsi_mark_thread_read('${tm.id}')`);
  await as(ANNA, `select public.koutsi_mark_thread_read('${tp.id}')`);
  assert.equal(await queue(26 * 60), 0, 'read in the app: nothing to send');

  await send(ANNA, tm.id, 'Pääset!');
  await db.exec(`update koutsi_messages set created_at = ${at(25 * 60 + 30)} where body = 'Pääset!'`);
  assert.equal(await queue(25 * 60 + 50), 1, "Maria gets one about Anna's reply");
  const p = await one(`select * from koutsi_notifications where recipient_id = '${MARIA}'`);
  assert.equal(p.title, 'Uusi viesti valmentajaltasi');
  assert.equal(p.body, 'Anna Virtanen lähetti sinulle viestin Koutsissa.');
  assert.equal(p.actor_id, ANNA, 'one sender is the actor, so the row goes if Anna deletes her account');
  assert.equal(p.link_path, '/pelaaja/viestit?uusi=1');
  assert.ok(!p.body.includes('Pääset'), 'no text');

  let r = await as(MARIA, `select public.koutsi_queue_message_emails()`);
  assert.ok(r.error, 'only the cron (service role) runs the queue');
  r = await as(MARIA, `select public.koutsi_prune_messages()`);
  assert.ok(r.error, 'and the prune');
});

test('retention: 12 months per message, 90 days after the coaching ended', async () => {
  const tm = await thread(ANNA, MARIA);
  await asSuper(ANNA, `insert into koutsi_messages (thread_id, body) values ('${tm.id}', 'vanha'), ('${tm.id}', 'uusi')`);
  await db.exec(`update koutsi_messages set created_at = now() - interval '13 months' where body = 'vanha'`);
  await db.exec(`update koutsi_coach_students set ended_at = now() - interval '91 days' where coach_id = '${ANNA}' and student_id = '${JUSSI}'`);
  const n = (await one(`select public.koutsi_prune_messages() as n`)).n;
  assert.ok(n >= 2, `pruned ${n}`);
  assert.equal((await db.query(`select 1 from koutsi_messages where body = 'vanha'`)).rows.length, 0, 'the 13-month-old message is gone');
  assert.equal((await db.query(`select 1 from koutsi_messages where body = 'uusi'`)).rows.length, 1, 'a fresh one stays');
  assert.equal(await thread(ANNA, JUSSI), undefined, "Jussi's conversation went 90 days after the coaching ended");
  assert.ok(await thread(ANNA, MARIA), "Maria's stays");
});

test('an account deletion takes the conversations with it', async () => {
  const tm = await thread(ANNA, MARIA);
  assert.ok((await db.query(`select 1 from koutsi_messages where thread_id = '${tm.id}'`)).rows.length > 0);
  // delete_my_koutsi_data() deletes the coaching rows, then the student row
  await db.exec(`delete from koutsi_coach_students where student_id = '${MARIA}' or coach_id = '${MARIA}'; delete from koutsi_students where id = '${MARIA}';`);
  assert.equal(await thread(ANNA, MARIA), undefined, 'the conversation is gone');
  assert.equal((await db.query(`select 1 from koutsi_messages where thread_id = '${tm.id}'`)).rows.length, 0, 'and its messages');
});

test('function rights: the API roles get only what the app calls', async () => {
  const rows = (await db.query(`
    select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('koutsi_messages_coach_enabled', 'koutsi_messages_enabled', 'koutsi_thread_open_for_me',
       'koutsi_set_messages', 'koutsi_mark_thread_read', 'koutsi_message_before_insert', 'koutsi_message_after_change',
       'koutsi_queue_message_emails', 'koutsi_prune_messages') order by 1`)).rows;
  const map = Object.fromEntries(rows.map((r) => [r.proname, r]));
  for (const name of Object.keys(map)) assert.equal(map[name].anon, false, `anon cannot run ${name}`);
  for (const name of ['koutsi_messages_enabled', 'koutsi_thread_open_for_me', 'koutsi_set_messages', 'koutsi_mark_thread_read']) {
    assert.equal(map[name].auth, true, `the app can run ${name}`);
  }
  for (const name of ['koutsi_messages_coach_enabled', 'koutsi_message_before_insert', 'koutsi_message_after_change', 'koutsi_queue_message_emails', 'koutsi_prune_messages']) {
    assert.equal(map[name].auth, false, `the app cannot run ${name}`);
  }
  const grants = (await db.query(`select table_name, privilege_type from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated') and table_name in ('koutsi_threads', 'koutsi_messages') order by 1, 2`)).rows
    .map((g) => `${g.table_name}:${g.privilege_type}`);
  assert.deepEqual(grants, ['koutsi_messages:DELETE', 'koutsi_messages:INSERT', 'koutsi_messages:SELECT', 'koutsi_threads:SELECT']);
});
