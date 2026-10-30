// 20261030181313_koutsi_breaks.check.mjs — runs the break migration (supabase/migrations/20261030181313_koutsi_breaks.sql, applied 30.10.2026)
// in PGlite on a small stub of the Koutsi tables: who sees a break, that the groups must be the coach's own,
// that notified_at belongs to the job, the notification text, and when the players are told. koutsi_notify is
// a recorder here (its merging is checked in 20261030124009_koutsi_mail_and_key_fixes.check.mjs). The
// Helsinki time is pinned per test (koutsi.test_now, patched in here only).
// PGlite is not a dependency of the repo, so this is not part of `npm run test:koutsi`. To run it:
//   (in an empty temp folder) npm i @electric-sql/pglite@0.3
//   PGLITE=<that folder>/node_modules/@electric-sql/pglite/dist/index.js node --test koutsi/web/sql/20261030181313_koutsi_breaks.check.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite');

const here = dirname(fileURLToPath(import.meta.url));
const SQL = await readFile(join(here, '../../../supabase/migrations/20261030181313_koutsi_breaks.sql'), 'utf8');
const NOW = `v_local timestamp := now() at time zone 'Europe/Helsinki';`;
assert.ok(SQL.includes(NOW), 'the time expression moved: update the check');
const PINNED = SQL.replace(NOW, `v_local timestamp := coalesce(nullif(current_setting('koutsi.test_now', true), '')::timestamp, now() at time zone 'Europe/Helsinki');`);

const ANNA = '00000000-0000-4000-8000-0000000000a1'; // coach
const OTTO = '00000000-0000-4000-8000-0000000000a2'; // another coach
const MARIA = '00000000-0000-4000-8000-000000000001'; // Anna's Monday group A
const JUSSI = '00000000-0000-4000-8000-000000000002'; // Anna's groups A and C (Thursday)
const LIISA = '00000000-0000-4000-8000-000000000003'; // Anna's group B, not on the break
const PEKKA = '00000000-0000-4000-8000-000000000004'; // Otto's player
const GA = '00000000-0000-4000-8000-00000000c001';
const GB = '00000000-0000-4000-8000-00000000c002';
const GC = '00000000-0000-4000-8000-00000000c003';
const GO = '00000000-0000-4000-8000-00000000c009'; // Otto's group

const STUB = `
create schema if not exists auth;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema cron;
create table cron.job (jobname text primary key, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job values (n, s, c) on conflict (jobname) do update set schedule = s, command = c; select 1::bigint $$;
create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n; select true $$;

create table public.koutsi_coaches (id uuid primary key);
create table public.koutsi_groups (id uuid primary key, coach_id uuid not null, name text);
create table public.koutsi_group_members (group_id uuid, student_id uuid, ended_at timestamptz, primary key (group_id, student_id));
create table public.koutsi_trainings (id uuid primary key default gen_random_uuid(), coach_id uuid not null, group_id uuid,
  date date not null, time time not null, logged_by text not null default 'coach');
create table public.koutsi_coach_events (
  id uuid primary key default gen_random_uuid(), coach_id uuid not null references public.koutsi_coaches(id) on delete cascade,
  date date not null, title text not null, kind text, created_at timestamptz not null default now(), end_date date,
  constraint koutsi_coach_events_end_date_not_before_start check (end_date is null or end_date >= date));
create table public.sent (recipient uuid, actor uuid, kind text, title text, body text, link text);

create function public.koutsi_acts_as(c uuid) returns boolean language sql stable as $$ select auth.uid() = c $$;
create function public.koutsi_is_my_coach(c uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.koutsi_group_members m join public.koutsi_groups g on g.id = m.group_id
                  where g.coach_id = c and m.student_id = auth.uid() and m.ended_at is null) $$;
create function public.koutsi_session_when(p_date date, p_time time) returns text language sql immutable set search_path = '' as $$
  select (array['su','ma','ti','ke','to','pe','la'])[extract(dow from p_date)::int + 1]
         || ' ' || to_char(p_date, 'FMDD.FMMM.') || ' klo ' || to_char(p_time, 'HH24:MI') $$;
create function public.koutsi_notify(p_recipient uuid, p_actor uuid, p_kind text, p_title text, p_body text, p_link text)
  returns void language sql security definer as $$ insert into public.sent values (p_recipient, p_actor, p_kind, p_title, p_body, p_link) $$;

alter table public.koutsi_coach_events enable row level security;
create policy koutsi_coach_events_select on public.koutsi_coach_events for select using (public.koutsi_acts_as(coach_id) or public.koutsi_is_my_coach(coach_id));
create policy koutsi_coach_events_insert on public.koutsi_coach_events for insert with check (public.koutsi_acts_as(coach_id));
create policy koutsi_coach_events_update on public.koutsi_coach_events for update using (public.koutsi_acts_as(coach_id)) with check (public.koutsi_acts_as(coach_id));
create policy koutsi_coach_events_delete on public.koutsi_coach_events for delete using (public.koutsi_acts_as(coach_id));
grant usage on schema public, auth to authenticated;
grant select, insert, update, delete on public.koutsi_coach_events to authenticated;
grant select on public.koutsi_groups, public.koutsi_group_members to authenticated;

insert into public.koutsi_coaches values ('${ANNA}'), ('${OTTO}');
insert into public.koutsi_groups values ('${GA}', '${ANNA}', 'A ma'), ('${GB}', '${ANNA}', 'B ti'), ('${GC}', '${ANNA}', 'C to'), ('${GO}', '${OTTO}', 'Otto');
insert into public.koutsi_group_members values ('${GA}', '${MARIA}', null), ('${GA}', '${JUSSI}', null), ('${GC}', '${JUSSI}', null),
  ('${GB}', '${LIISA}', null), ('${GO}', '${PEKKA}', null);
-- the calendar: autumn up to 18.12., spring from 7.1.
insert into public.koutsi_trainings (coach_id, group_id, date, time) values
  ('${ANNA}', '${GA}', '2026-12-14', '17:00'), ('${ANNA}', '${GA}', '2027-01-11', '17:00'),
  ('${ANNA}', '${GC}', '2026-12-17', '18:30'), ('${ANNA}', '${GC}', '2027-01-07', '18:30'),
  ('${ANNA}', '${GB}', '2026-12-15', '16:00'), ('${ANNA}', '${GB}', '2026-12-22', '16:00');
`;

async function world() {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(PINNED);
  return db;
}

/** Runs `sql` as a signed-in user (RLS on). */
async function as(db, uid, sql, params = []) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}

const at = (db, local) => db.exec(`select set_config('koutsi.test_now', '${local}', false)`);
const addBreak = (db, extra = {}) => as(db, ANNA,
  `insert into public.koutsi_coach_events (coach_id, date, end_date, title, kind, message, group_ids)
   values ($1, $2, $3, $4, 'tauko', $5, $6) returning id`,
  [ANNA, extra.from || '2026-12-19', extra.to || '2027-01-06', extra.title || 'Joululoma', extra.message ?? 'Hyvää joulua!', extra.groups || [GA, GC]]);

test('the notification text: dates, the next session and the greeting', async () => {
  const db = await world();
  const body = async (...a) => (await db.query('select public.koutsi_break_notice_body($1, $2, $3, $4, $5) as b', a)).rows[0].b;
  assert.equal(await body('2026-12-19', '2027-01-06', '2027-01-07', '17:00', 'Hyvää joulua!'),
    'Ei treenejä la 19.12.–ke 6.1. Seuraava treenisi on to 7.1. klo 17:00. Hyvää joulua!');
  assert.equal(await body('2027-05-13', '2027-05-13', null, null, '  '), 'Ei treenejä to 13.5.');
  assert.equal(await body('2027-02-22', '2027-02-28', '2027-03-01', '09:15', null),
    'Ei treenejä ma 22.2.–su 28.2. Seuraava treenisi on ma 1.3. klo 09:15.');
});

test('players of the groups on the break see it; others of the same coach and other coaches do not', async () => {
  const db = await world();
  await addBreak(db);
  await as(db, ANNA, `insert into public.koutsi_coach_events (coach_id, date, title, kind) values ($1, '2026-11-14', 'Syyskisat', 'kilpailu')`, [ANNA]);
  const titles = async (uid) => (await as(db, uid, 'select title from public.koutsi_coach_events order by title')).rows.map((r) => r.title);
  assert.deepEqual(await titles(MARIA), ['Joululoma', 'Syyskisat']);
  assert.deepEqual(await titles(JUSSI), ['Joululoma', 'Syyskisat']);
  assert.deepEqual(await titles(LIISA), ['Syyskisat'], 'group B is not on the break');
  assert.deepEqual(await titles(PEKKA), []);
  assert.deepEqual(await titles(ANNA), ['Joululoma', 'Syyskisat']);
});

test('a break only for the coach\'s own groups; the greeting has a length limit', async () => {
  const db = await world();
  await assert.rejects(addBreak(db, { groups: [GA, GO] }), /row-level security/);
  await assert.rejects(addBreak(db, { message: 'x'.repeat(301) }), /message_length/);
  const { rows } = await addBreak(db, { groups: [GB] });
  await assert.rejects(as(db, ANNA, 'update public.koutsi_coach_events set group_ids = $1 where id = $2', [[GO], rows[0].id]), /row-level security/);
});

test('notified_at is the job\'s: a coach can neither set nor clear it', async () => {
  const db = await world();
  const { rows } = await as(db, ANNA, `insert into public.koutsi_coach_events (coach_id, date, title, kind, notified_at)
    values ($1, '2026-12-19', 'Joululoma', 'tauko', now()) returning notified_at`, [ANNA]);
  assert.equal(rows[0].notified_at, null);
  await db.exec(`update public.koutsi_coach_events set notified_at = now()`);
  await as(db, ANNA, 'update public.koutsi_coach_events set notified_at = null, message = $1', ['Hyvää joulua!']);
  const after = (await db.query('select notified_at, message from public.koutsi_coach_events')).rows[0];
  assert.ok(after.notified_at, 'kept');
  assert.equal(after.message, 'Hyvää joulua!');
});

test('the morning before the break each player gets one notice with their own next session; once', async () => {
  const db = await world();
  await addBreak(db);
  const send = async () => (await db.query('select public.koutsi_send_break_notices() as n')).rows[0].n;
  await at(db, '2026-12-17 09:00');
  assert.equal(await send(), 0, 'two days before: not yet');
  await at(db, '2026-12-18 07:10');
  assert.equal(await send(), 0, 'before 07:30');
  await at(db, '2026-12-18 08:07');
  assert.equal(await send(), 2);
  const sent = (await db.query('select recipient, actor, kind, title, body, link from public.sent order by body')).rows;
  assert.deepEqual(sent.map((r) => [r.recipient, r.title]).sort(), [[MARIA, 'Joululoma'], [JUSSI, 'Joululoma']].sort());
  const of = (uid) => sent.find((r) => r.recipient === uid).body;
  assert.equal(of(MARIA), 'Ei treenejä la 19.12.–ke 6.1. Seuraava treenisi on ma 11.1. klo 17:00. Hyvää joulua!');
  assert.equal(of(JUSSI), 'Ei treenejä la 19.12.–ke 6.1. Seuraava treenisi on to 7.1. klo 18:30. Hyvää joulua!', 'the earlier of his two groups');
  assert.ok(sent.every((r) => r.actor === ANNA && r.kind === 'announcement' && r.link === '/pelaaja/treenit'));
  await at(db, '2026-12-18 09:07');
  assert.equal(await send(), 0, 'told once');
});

test('a break saved late is told at once in the daytime; a past one never; nothing at night', async () => {
  const db = await world();
  await addBreak(db, { from: '2026-12-10', to: '2026-12-12', title: 'Tauko', message: '', groups: [GB] });
  await addBreak(db, { from: '2026-12-01', to: '2026-12-03', title: 'Mennyt', groups: [GB] });
  await at(db, '2026-12-11 22:30');
  assert.equal((await db.query('select public.koutsi_send_break_notices() as n')).rows[0].n, 0, 'quiet hours');
  await at(db, '2026-12-11 07:45');
  assert.equal((await db.query('select public.koutsi_send_break_notices() as n')).rows[0].n, 1);
  assert.deepEqual((await db.query('select recipient, title, body from public.sent')).rows,
    [{ recipient: LIISA, title: 'Tauko', body: 'Ei treenejä to 10.12.–la 12.12. Seuraava treenisi on ti 15.12. klo 16:00.' }]);
});

test('only the job runs the notices, and it is scheduled hourly', async () => {
  const db = await world();
  await assert.rejects(as(db, ANNA, 'select public.koutsi_send_break_notices()'), /permission denied/);
  assert.deepEqual((await db.query(`select schedule, command from cron.job where jobname = 'koutsi-break-notices'`)).rows,
    [{ schedule: '7 * * * *', command: 'select public.koutsi_send_break_notices()' }]);
});
