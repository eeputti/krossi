// 20261030190000_koutsi_break_mails.check.mjs — runs the break migrations in PGlite, the applied first one
// (supabase/migrations/20261030181313_koutsi_breaks.sql) and this one on top (koutsi/web/sql/20261030190000_koutsi_break_mails.sql),
// on the stub world of 20261030181313_koutsi_breaks.check.mjs (who sees a break is checked there): the holiday
// letter the morning before a break, the reminders before the sessions start again, and that each goes once.
// koutsi_notify is a recorder. The Helsinki time is pinned per test (koutsi.test_now, patched in here only).
// PGlite is not a dependency of the repo, so this is not part of `npm run test:koutsi`. To run it:
//   (in an empty temp folder) npm i @electric-sql/pglite@0.3
//   PGLITE=<that folder>/node_modules/@electric-sql/pglite/dist/index.js node --test koutsi/web/sql/20261030190000_koutsi_break_mails.check.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite');

const here = dirname(fileURLToPath(import.meta.url));
const FIRST = await readFile(join(here, '../../../supabase/migrations/20261030181313_koutsi_breaks.sql'), 'utf8');
const SQL = await readFile(join(here, '20261030190000_koutsi_break_mails.sql'), 'utf8');
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
create table public.profiles (id uuid primary key, name text);
create table public.koutsi_students (id uuid primary key);
create table public.koutsi_group_themes (id uuid primary key default gen_random_uuid(), group_id uuid, iso_year int, iso_week int, title text);
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
insert into public.profiles values ('${ANNA}', 'Anna Virtanen'), ('${OTTO}', 'Otto');
insert into public.koutsi_students values ('${MARIA}'), ('${JUSSI}'), ('${LIISA}'), ('${PEKKA}');
-- group C's theme for the first week of 2027
insert into public.koutsi_group_themes (group_id, iso_year, iso_week, title) values ('${GC}', 2027, 1, 'Syöttö');
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
  await db.exec(FIRST);
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

const send = async (db) => (await db.query('select public.koutsi_send_break_notices() as n')).rows[0].n;
const sent = async (db) => (await db.query('select recipient, kind, title, body, link from public.sent')).rows;
const clear = (db) => db.exec('delete from public.sent');

const LETTER_MARIA = 'Treenit ovat tauolla la 19.12.–ke 6.1.\nTreenisi jatkuvat ma 11.1. klo 17:00.\n\n'
  + 'Valmentajan terveiset\nHyvää joulua!\n– Anna\n\n'
  + 'Koutsi on käytössä myös tauon aikana.\nTreenaa omatoimisesti ja merkitse treenit kuten ennenkin. Vain yhteiset treenit ovat tauolla.';

test('the letter, word for word as the app shows it to the coach', async () => {
  const db = await world();
  const body = async (...a) => (await db.query('select public.koutsi_break_notice_body($1, $2, $3, $4, $5, $6) as b', a)).rows[0].b;
  assert.equal(await body('2026-12-19', '2027-01-06', '2027-01-11', '17:00', 'Hyvää joulua!', 'Anna'), LETTER_MARIA);
  assert.equal(await body('2027-05-13', '2027-05-13', null, null, '  ', 'Anna'),
    'Treenit ovat tauolla to 13.5.\n\nKoutsi on käytössä myös tauon aikana.\nTreenaa omatoimisesti ja merkitse treenit kuten ennenkin. Vain yhteiset treenit ovat tauolla.');
  const title = async (...a) => (await db.query('select public.koutsi_break_notice_title($1, $2, $3) as t', a)).rows[0].t;
  assert.equal(await title('Joululoma', '2026-12-19', '2026-12-18'), 'Joululoma alkaa huomenna');
  assert.equal(await title('Joululoma', '2026-12-19', '2026-12-20'), 'Joululoma');
  const restart = async (...a) => (await db.query('select public.koutsi_break_restart_body($1, $2, $3, $4) as b', a)).rows[0].b;
  assert.equal(await restart('2027-01-07', '18:30', 'Syöttö.', false),
    'Ensimmäinen treenisi tauon jälkeen on to 7.1. klo 18:30.\nViikon teema: Syöttö.\n\nAvaa Koutsi ja katso, miten treenit alkavat.');
  assert.equal(await restart('2027-01-11', '17:00', null, true),
    'Ensimmäinen treenisi tauon jälkeen on huomenna ma 11.1. klo 17:00.\n\nAvaa Koutsi ja katso, miten treenit alkavat.');
});

test('the morning before the break: one letter each, a mail of its own, once', async () => {
  const db = await world();
  await addBreak(db);
  await at(db, '2026-12-18 07:35');
  assert.equal(await send(db), 2);
  const rows = await sent(db);
  assert.ok(rows.every((r) => r.kind === 'session_reminder' && r.title === 'Joululoma alkaa huomenna' && r.link === '/pelaaja/treenit'));
  assert.equal(rows.find((r) => r.recipient === MARIA).body, LETTER_MARIA);
  assert.match(rows.find((r) => r.recipient === JUSSI).body, /Treenisi jatkuvat to 7\.1\. klo 18:30\./);
  await clear(db);
  await at(db, '2026-12-18 12:35');
  assert.equal(await send(db), 0);
});

test('before the sessions start again: three days and one day before each player\'s own first session, once', async () => {
  const db = await world();
  await addBreak(db);
  await at(db, '2026-12-18 07:35'); await send(db); await clear(db);
  await at(db, '2027-01-04 07:35');
  assert.equal(await send(db), 1, 'Jussi: Thursday group, 3 days before 7.1.');
  assert.deepEqual(await sent(db), [{ recipient: JUSSI, kind: 'session_reminder', title: 'Treenit alkavat taas to 7.1.',
    body: 'Ensimmäinen treenisi tauon jälkeen on to 7.1. klo 18:30.\nViikon teema: Syöttö.\n\nAvaa Koutsi ja katso, miten treenit alkavat.', link: '/pelaaja/treenit' }]);
  await clear(db);
  await at(db, '2027-01-04 09:35');
  assert.equal(await send(db), 0, 'once');
  await at(db, '2027-01-06 07:35');
  assert.equal(await send(db), 1);
  assert.equal((await sent(db))[0].title, 'Treenit alkavat taas huomenna');
  await clear(db);
  await at(db, '2027-01-08 07:35');
  assert.equal(await send(db), 1, 'Maria: Monday group, 3 days before 11.1.');
  assert.deepEqual((await sent(db)).map((r) => [r.recipient, r.title]), [[MARIA, 'Treenit alkavat taas ma 11.1.']]);
  await clear(db);
  await at(db, '2027-01-10 07:35');
  assert.deepEqual((await (async () => { await send(db); return sent(db); })()).map((r) => [r.recipient, r.title]), [[MARIA, 'Treenit alkavat taas huomenna']]);
});

test('a short break gets the letter but no restart reminders; nothing at night', async () => {
  const db = await world();
  await addBreak(db, { from: '2026-12-21', to: '2026-12-23', title: 'Tauko', message: '', groups: [GB] });
  await at(db, '2026-12-20 22:35');
  assert.equal(await send(db), 0, 'quiet hours');
  await at(db, '2026-12-20 07:35');
  assert.equal(await send(db), 1);
  assert.equal((await sent(db))[0].title, 'Tauko alkaa huomenna');
  await clear(db);
  await db.exec(`insert into public.koutsi_trainings (coach_id, group_id, date, time) values ('${ANNA}', '${GB}', '2026-12-29', '16:00')`);
  for (const day of ['2026-12-26', '2026-12-28']) { await at(db, `${day} 07:35`); assert.equal(await send(db), 0, day); }
});

test('the greeting fits the letter; only the job sees the reminder log; the job runs at :35', async () => {
  const db = await world();
  await assert.rejects(addBreak(db, { message: 'x'.repeat(201) }), /message_length/);
  await assert.rejects(as(db, ANNA, 'select * from public.koutsi_break_reminders'), /permission denied/);
  assert.deepEqual((await db.query(`select schedule from cron.job where jobname = 'koutsi-break-notices'`)).rows, [{ schedule: '35 * * * *' }]);
});
