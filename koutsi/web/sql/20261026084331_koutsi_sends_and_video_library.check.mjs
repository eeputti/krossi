// 20261026084331_koutsi_sends_and_video_library.check.mjs — runs the Lähetetyt / video library migration
// (supabase/migrations/20261026084331_koutsi_sends_and_video_library.sql, applied 26.10.2026) in PGlite against a small stub of
// production's Koutsi schema (the tables, policies and helpers it leans on, copied 2026-10-26), then
// checks who can read and write, what may change afterwards, and the deletion cascades.
// PGlite is not a dependency of the repo, so this is not part of `npm run test:koutsi`. To run it:
//   (in an empty temp folder) npm i @electric-sql/pglite@0.3
//   PGLITE=<that folder>/node_modules/@electric-sql/pglite/dist/index.js node --test koutsi/web/sql/20261026084331_koutsi_sends_and_video_library.check.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite');

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = await readFile(join(here, '../../../supabase/migrations/20261026084331_koutsi_sends_and_video_library.sql'), 'utf8');

const ANNA = '00000000-0000-4000-8000-0000000000a1'; // coach
const JUHO = '00000000-0000-4000-8000-0000000000b1'; // another coach
const ADMIN = '00000000-0000-4000-8000-0000000000e1';
const MARIA = '00000000-0000-4000-8000-000000000001'; // Anna's player (and Juho's)
const JUSSI = '00000000-0000-4000-8000-000000000002'; // Anna's player
const OTTO = '00000000-0000-4000-8000-000000000003'; // was Anna's player, link ended
const PH = '00000000-0000-4000-8000-000000000004'; // Anna's placeholder, deleted in a test
const G_ANNA = '00000000-0000-4000-8000-00000000c001';
const G_JUHO = '00000000-0000-4000-8000-00000000c002';

const STUB = `
create schema if not exists auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
-- Supabase's defaults: new tables and functions in public are open to the API roles until revoked.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create table public.koutsi_admins (user_id uuid primary key);
create table public.koutsi_coaches (id uuid primary key);
create table public.koutsi_students (id uuid primary key, name text);
create table public.koutsi_coach_students (
  coach_id uuid not null references public.koutsi_coaches(id) on delete cascade,
  student_id uuid not null references public.koutsi_students(id) on delete cascade,
  ended_at timestamptz, primary key (coach_id, student_id));
create table public.koutsi_groups (id uuid primary key, coach_id uuid not null references public.koutsi_coaches(id) on delete cascade, name text);
create table public.koutsi_homework (id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.koutsi_students(id) on delete cascade,
  text text not null, done boolean not null default false, created_at timestamptz not null default now(), done_at timestamptz);
create table public.koutsi_diary_entries (id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.koutsi_students(id) on delete cascade,
  coach_id uuid references public.koutsi_coaches(id) on delete set null,
  text text not null, created_at timestamptz not null default now());

create function public.koutsi_is_admin() returns boolean language sql stable security definer set search_path to '' as $$
  select (select auth.uid()) is not null and exists (select 1 from public.koutsi_admins a where a.user_id = (select auth.uid())); $$;
create function public.koutsi_acts_as(target uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select target is not null and (target = (select auth.uid()) or public.koutsi_is_admin()); $$;
create function public.koutsi_is_linked_coach(p_student uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from koutsi_coach_students where coach_id = auth.uid() and student_id = p_student and ended_at is null); $$;

alter table public.koutsi_homework enable row level security;
create policy koutsi_homework_select on public.koutsi_homework for select using ((student_id = auth.uid()) or koutsi_is_linked_coach(student_id));
create policy koutsi_homework_insert on public.koutsi_homework for insert with check ((student_id = auth.uid()) or koutsi_is_linked_coach(student_id));
create policy koutsi_homework_update on public.koutsi_homework for update using ((student_id = auth.uid()) or koutsi_is_linked_coach(student_id)) with check ((student_id = auth.uid()) or koutsi_is_linked_coach(student_id));
create policy koutsi_homework_delete on public.koutsi_homework for delete using ((student_id = auth.uid()) or koutsi_is_linked_coach(student_id));
alter table public.koutsi_diary_entries enable row level security;
create policy koutsi_diary_select on public.koutsi_diary_entries for select using ((student_id = auth.uid()) or koutsi_is_linked_coach(student_id));
create policy koutsi_diary_insert on public.koutsi_diary_entries for insert with check (koutsi_is_linked_coach(student_id) and koutsi_acts_as(coach_id));
create policy koutsi_diary_update on public.koutsi_diary_entries for update using (koutsi_is_linked_coach(student_id) and koutsi_acts_as(coach_id)) with check (koutsi_is_linked_coach(student_id) and koutsi_acts_as(coach_id));
create policy koutsi_diary_delete on public.koutsi_diary_entries for delete using (koutsi_is_linked_coach(student_id) and koutsi_acts_as(coach_id));
`;

const SEED = `
insert into koutsi_admins (user_id) values ('${ADMIN}');
insert into koutsi_coaches (id) values ('${ANNA}'), ('${JUHO}'), ('${ADMIN}');
insert into koutsi_students (id, name) values ('${MARIA}', 'Maria'), ('${JUSSI}', 'Jussi'), ('${OTTO}', 'Otto'), ('${PH}', 'Pirjo');
insert into koutsi_coach_students (coach_id, student_id, ended_at) values ('${ANNA}', '${MARIA}', null), ('${ANNA}', '${JUSSI}', null),
  ('${ANNA}', '${OTTO}', now()), ('${ANNA}', '${PH}', null), ('${JUHO}', '${MARIA}', null);
insert into koutsi_groups (id, coach_id, name) values ('${G_ANNA}', '${ANNA}', 'Ma 17 Kilpa'), ('${G_JUHO}', '${JUHO}', 'Juhon ryhmä');
`;

const db = new PGlite();
await db.exec(STUB);
await db.exec(SEED);
await db.exec(MIGRATION);
await db.exec(MIGRATION); // must be re-runnable

/** Runs `sql` as `uid` (role authenticated) in a transaction, committed unless keep is false. */
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
const uuidArr = (ids) => `array[${ids.map((id) => `'${id}'`).join(',')}]::uuid[]`;

const VIDEO = '00000000-0000-4000-8000-00000000f001';
const sendRow = ({ id = 'gen_random_uuid()', coach = ANNA, kind = 'homework', videoId = null, refId = null, title = 'Seinälyönnit', groups = [], students = [MARIA] } = {}) => `
  insert into koutsi_sends (id, coach_id, kind, video_id, ref_id, title, group_ids, student_ids)
  values (${id === 'gen_random_uuid()' ? id : `'${id}'`}, '${coach}', '${kind}', ${videoId ? `'${videoId}'` : 'null'}, ${refId ? `'${refId}'` : 'gen_random_uuid()'},
    '${title}', ${uuidArr(groups)}, ${uuidArr(students)}) returning id`;

test('a coach keeps their own videos; nobody else sees them', async () => {
  let r = await as(ANNA, `insert into koutsi_coach_videos (id, coach_id, title, storage_path, mime_type, size_bytes)
    values ('${VIDEO}', '${ANNA}', 'Kakkossyötön malli', '${ANNA}/${VIDEO}.mp4', 'video/mp4', 1000) returning id`);
  assert.equal(r.error, null, r.error?.message);
  r = await as(ANNA, `insert into koutsi_coach_videos (coach_id, title, storage_path) values ('${ANNA}', 'Väärä kansio', '${JUHO}/x.mp4')`);
  assert.ok(r.error, 'a file must be in the coach\'s own folder');
  r = await as(ANNA, `insert into koutsi_coach_videos (coach_id, title, external_url, storage_path) values ('${ANNA}', 'Kaksi lähdettä', 'https://youtu.be/x', '${ANNA}/y.mp4')`);
  assert.ok(r.error, 'one source only');
  r = await as(ANNA, `insert into koutsi_coach_videos (coach_id, title, external_url) values ('${ANNA}', '  ', 'https://youtu.be/x')`);
  assert.ok(r.error, 'a name is needed');
  r = await as(JUHO, `insert into koutsi_coach_videos (coach_id, title, external_url) values ('${ANNA}', 'Annan nimissä', 'https://youtu.be/x')`);
  assert.ok(r.error, 'Juho cannot save into Anna\'s videos');
  r = await as(JUHO, `select id from koutsi_coach_videos`);
  assert.equal(r.rows.length, 0, 'Juho sees none of Anna\'s videos');
  r = await as(MARIA, `select id from koutsi_coach_videos`);
  assert.equal(r.rows.length, 0, 'a player sees none');
  r = await as(ADMIN, `select id from koutsi_coach_videos`);
  assert.equal(r.rows.length, 1, 'an admin (acting as a coach) does');
  r = await as(ANNA, `update koutsi_coach_videos set title = 'Kakkossyöttö', tags = '{syotto}' where id = '${VIDEO}' returning title`);
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.rows[0].title, 'Kakkossyöttö');
  r = await as(ANNA, `update koutsi_coach_videos set storage_path = '${ANNA}/other.mp4' where id = '${VIDEO}'`);
  assert.match(String(r.error?.message), /permission denied/, 'the file never changes after saving');
  r = await as(JUHO, `update koutsi_coach_videos set title = 'Juhon' where id = '${VIDEO}' returning id`);
  assert.equal(r.rows.length, 0, 'Juho cannot rename it');
});

test('sendings: only own groups, current players and own videos; only the coach reads them', async () => {
  let r = await as(ANNA, sendRow({ groups: [G_ANNA], students: [MARIA, JUSSI] }));
  assert.equal(r.error, null, r.error?.message);
  r = await as(ANNA, sendRow({ groups: [G_JUHO], students: [MARIA] }));
  assert.ok(r.error, 'not someone else\'s group');
  r = await as(ANNA, sendRow({ students: [OTTO] }));
  assert.ok(r.error, 'not a player whose coaching has ended');
  r = await as(ANNA, sendRow({ students: [] }));
  assert.ok(r.error, 'somebody must get it');
  r = await as(ANNA, sendRow({ kind: 'video', videoId: VIDEO, refId: VIDEO, title: 'Kakkossyöttö', students: [MARIA] }));
  assert.equal(r.error, null, r.error?.message);
  r = await as(ANNA, sendRow({ kind: 'video', videoId: VIDEO, title: 'Väärä ref', students: [MARIA] }));
  assert.ok(r.error, 'a video\'s sendings share the video\'s id');
  r = await as(ANNA, sendRow({ kind: 'video', title: 'Ilman videota', students: [MARIA] }));
  assert.ok(r.error, 'a video sending needs its video');
  r = await as(JUHO, sendRow({ coach: JUHO, kind: 'video', videoId: VIDEO, refId: VIDEO, title: 'Annan video', students: [MARIA] }));
  assert.ok(r.error, 'Juho cannot send Anna\'s video');
  r = await as(ANNA, sendRow({ kind: 'chat', students: [MARIA] }));
  assert.ok(r.error, 'only video, homework or note');
  r = await as(JUHO, sendRow({ coach: ANNA, students: [MARIA] }));
  assert.ok(r.error, 'nobody writes in another coach\'s name');

  r = await as(MARIA, `select id from koutsi_sends`);
  assert.equal(r.rows.length, 0, 'players never see the log');
  r = await as(JUHO, `select id from koutsi_sends`);
  assert.equal(r.rows.length, 0, 'nor do other coaches');
  r = await as(ANNA, `select id from koutsi_sends`);
  assert.equal(r.rows.length, 2);
  r = await as(ANNA, `update koutsi_sends set title = 'Seinälyönnit 50 kpl' where kind = 'homework' returning title`);
  assert.equal(r.rows[0]?.title, 'Seinälyönnit 50 kpl');
  r = await as(ANNA, `update koutsi_sends set student_ids = ${uuidArr([OTTO])} where kind = 'homework'`);
  assert.match(String(r.error?.message), /permission denied/, 'who got it never changes afterwards');
  r = await as(MARIA, `delete from koutsi_sends returning id`);
  assert.equal(r.rows.length, 0, 'a player deletes nothing');
});

test('each copy knows its sending; removing the sending leaves the copies alone', async () => {
  const SEND = '00000000-0000-4000-8000-00000000d001';
  let r = await as(ANNA, sendRow({ id: SEND, refId: SEND, title: 'Varjolyönnit', groups: [G_ANNA], students: [MARIA, JUSSI] }));
  assert.equal(r.error, null, r.error?.message);
  r = await as(ANNA, `insert into koutsi_homework (student_id, text, coach_id, send_id) values
    ('${MARIA}', 'Varjolyönnit', '${ANNA}', '${SEND}'), ('${JUSSI}', 'Varjolyönnit', '${ANNA}', '${SEND}') returning id`);
  assert.equal(r.error, null, r.error?.message);
  r = await as(ANNA, `insert into koutsi_diary_entries (student_id, coach_id, text, send_id) values ('${MARIA}', '${ANNA}', 'Hyvä nousu', '${SEND}') returning id`);
  assert.equal(r.error, null, r.error?.message);
  r = await as(MARIA, `update koutsi_homework set done = true, done_at = now() where send_id = '${SEND}' returning id`);
  assert.equal(r.rows.length, 1, 'Maria ticks her own copy');
  r = await as(ANNA, `select count(*) filter (where done) as done, count(*) as n from koutsi_homework where send_id = '${SEND}'`);
  assert.deepEqual([Number(r.rows[0].done), Number(r.rows[0].n)], [1, 2], '"1/2 tehty"');
  r = await as(ANNA, `insert into koutsi_homework (student_id, text) values ('${MARIA}', 'Vanha tapa') returning id`);
  assert.equal(r.error, null, 'a row without the new columns still goes in (the old app)');
  r = await as(MARIA, `insert into koutsi_homework (student_id, text) values ('${MARIA}', 'Oma läksy') returning id`);
  assert.equal(r.error, null, 'and a player\'s own');
  r = await as(ANNA, `delete from koutsi_sends where id = '${SEND}' returning id`);
  assert.equal(r.rows.length, 1);
  const left = await one(`select count(*) as n, count(send_id) as linked from koutsi_homework where text = 'Varjolyönnit'`);
  assert.deepEqual([Number(left.n), Number(left.linked)], [2, 0], 'the copies stay, unlinked');
});

test('deleting a video takes its sendings; deleting a player scrubs them; deleting a coach takes everything', async () => {
  const V2 = '00000000-0000-4000-8000-00000000f002';
  let r = await as(ANNA, `insert into koutsi_coach_videos (id, coach_id, title, external_url) values ('${V2}', '${ANNA}', 'Linkki', 'https://youtu.be/abc') returning id`);
  assert.equal(r.error, null, r.error?.message);
  r = await as(ANNA, sendRow({ kind: 'video', videoId: V2, refId: V2, title: 'Linkki', students: [JUSSI] }));
  assert.equal(r.error, null, r.error?.message);
  r = await as(ANNA, `delete from koutsi_coach_videos where id = '${V2}' returning id`);
  assert.equal(r.rows.length, 1);
  assert.equal(Number((await one(`select count(*) as n from koutsi_sends where video_id = '${V2}'`)).n), 0, 'its sendings went with it');

  // Pirjo alone in one sending, with Jussi in another
  r = await as(ANNA, sendRow({ title: 'Vain Pirjolle', students: [PH] }));
  assert.equal(r.error, null, r.error?.message);
  r = await as(ANNA, sendRow({ title: 'Pirjolle ja Jussille', students: [PH, JUSSI] }));
  assert.equal(r.error, null, r.error?.message);
  await db.exec(`delete from koutsi_students where id = '${PH}'`);
  assert.equal(Number((await one(`select count(*) as n from koutsi_sends where title = 'Vain Pirjolle'`)).n), 0, 'a sending to her alone is gone');
  const both = await one(`select student_ids from koutsi_sends where title = 'Pirjolle ja Jussille'`);
  assert.deepEqual(both.student_ids, [JUSSI], 'she is off the other one');
  assert.equal(Number((await one(`select count(*) as n from koutsi_sends where '${PH}' = any (student_ids)`)).n), 0);

  await db.exec(`insert into koutsi_homework (student_id, text, coach_id) values ('${JUSSI}', 'Annan läksy', '${ANNA}')`);
  await db.exec(`delete from koutsi_coaches where id = '${ANNA}'`);
  assert.equal(Number((await one(`select count(*) as n from koutsi_sends`)).n), 0, 'a deleted coach leaves no sendings');
  assert.equal(Number((await one(`select count(*) as n from koutsi_coach_videos`)).n), 0, 'nor videos');
  const hw = await one(`select coach_id from koutsi_homework where text = 'Annan läksy'`);
  assert.equal(hw.coach_id, null, 'the player keeps the homework, without the coach');
});

test('anon gets nothing', async () => {
  await db.exec('begin');
  try {
    await db.exec(`set local role anon`);
    await assert.rejects(db.query(`select * from koutsi_sends`), /permission denied/);
  } finally { await db.exec('rollback'); }
  await db.exec('begin');
  try {
    await db.exec(`set local role anon`);
    await assert.rejects(db.query(`select * from koutsi_coach_videos`), /permission denied/);
  } finally { await db.exec('rollback'); }
});
