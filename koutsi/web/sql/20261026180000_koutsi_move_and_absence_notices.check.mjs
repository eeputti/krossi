// 20261026180000_koutsi_move_and_absence_notices.check.mjs — runs the "Treeni siirtyi" / "<nimi> ei pääse"
// migration (koutsi/web/sql/20261026180000_koutsi_move_and_absence_notices.sql) in PGlite on top of a small
// stub of production's notification pipeline (the functions are the live koutsi_email_round versions, read
// from supabase/migrations/20261026110257_koutsi_email_round.sql), then checks who hears what.
// PGlite is not a dependency of the repo, so this is not part of `npm run test:koutsi`. To run it:
//   (in an empty temp folder) npm i @electric-sql/pglite@0.3
//   PGLITE=<that folder>/node_modules/@electric-sql/pglite/dist/index.js node --test koutsi/web/sql/20261026180000_koutsi_move_and_absence_notices.check.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite');

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = await readFile(join(here, '20261026180000_koutsi_move_and_absence_notices.sql'), 'utf8');
const EMAIL_ROUND = await readFile(join(here, '../../../supabase/migrations/20261026110257_koutsi_email_round.sql'), 'utf8');

/** One `create or replace function public.<name>(…) … $tag$;` statement, exactly as in the file. */
function fnStatement(src, name) {
  const start = src.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} not in the file`);
  const asIdx = src.indexOf('\nas ', start);
  const tag = src.slice(asIdx + 4).match(/^(\$[a-z_]*\$)/)[1];
  const end = src.indexOf(tag, asIdx + 4 + tag.length) + tag.length;
  return src.slice(start, end) + ';';
}

const ANNA = '00000000-0000-4000-8000-0000000000a1'; // coach
const MARIA = '00000000-0000-4000-8000-000000000001'; // private lessons with Anna, in her group
const JUSSI = '00000000-0000-4000-8000-000000000002'; // in the group
const OTTO = '00000000-0000-4000-8000-000000000003'; // left the group
const NOACC = '00000000-0000-4000-8000-000000000004'; // added by name, no account yet
const GROUP = '00000000-0000-4000-8000-00000000c001';

const STUB = `
create schema if not exists auth;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.profiles (id uuid primary key, name text not null);
create table public.koutsi_admins (user_id uuid primary key);
create table public.koutsi_students (id uuid primary key, display_name text);
create table public.koutsi_groups (id uuid primary key, coach_id uuid not null, name text);
create table public.koutsi_group_members (group_id uuid, student_id uuid, ended_at timestamptz, primary key (group_id, student_id));
create table public.koutsi_trainings (
  id uuid primary key default gen_random_uuid(), coach_id uuid not null, group_id uuid, student_id uuid,
  date date not null, time time not null, type text not null, logged_by text not null default 'coach',
  series_id uuid, duration_minutes integer, notes text, end_date date);
create table public.koutsi_training_absences (
  training_id uuid not null references public.koutsi_trainings(id) on delete cascade,
  student_id uuid not null, reason text not null default 'poissa', note text, reported_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz,
  primary key (training_id, student_id));
create function public.koutsi_stamp_training_absence() returns trigger language plpgsql set search_path to '' as $$
begin
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  new.reported_by := coalesce((select auth.uid()), new.reported_by);
  new.updated_at := now();
  return new;
end; $$;
create trigger koutsi_training_absences_stamp before insert or update on public.koutsi_training_absences
  for each row execute function public.koutsi_stamp_training_absence();
create table public.koutsi_notifications (
  id uuid primary key default gen_random_uuid(), recipient_id uuid not null, actor_id uuid, kind text not null,
  title text not null, body text, link_path text, created_at timestamptz not null default now(), read_at timestamptz,
  email_status text not null default 'pending', email_attempts integer not null default 0, email_error text,
  emailed_at timestamptz, burst_count integer not null default 1);
create table public.koutsi_notification_prefs (user_id uuid primary key, email_enabled boolean default true, email_off text[] not null default '{}');
create function public.koutsi_notifications_paused() returns boolean language sql stable as $$ select false $$;
create function public.koutsi_training_audience(p_training koutsi_trainings) returns setof uuid language sql stable security definer set search_path to 'public' as $$
  select p_training.student_id where p_training.student_id is not null
  union
  select gm.student_id from koutsi_group_members gm
   where p_training.group_id is not null and gm.group_id = p_training.group_id and gm.ended_at is null;
$$;
${['koutsi_email_category', 'koutsi_session_when', 'koutsi_on_training_insert', 'koutsi_on_training_delete', 'koutsi_notify', 'koutsi_claim_notification_batch']
    .map((n) => fnStatement(EMAIL_ROUND, n)).join('\n')}
create trigger koutsi_training_notify after insert on public.koutsi_trainings for each row execute function koutsi_on_training_insert();
create trigger koutsi_training_cancel_notify after delete on public.koutsi_trainings for each row execute function koutsi_on_training_delete();

insert into auth.users values ('${ANNA}', 'anna@example.test'), ('${MARIA}', 'maria@example.test'), ('${JUSSI}', 'jussi@example.test'), ('${OTTO}', 'otto@example.test');
insert into public.profiles values ('${ANNA}', 'Anna Koutsi'), ('${MARIA}', 'Maria Kallio'), ('${JUSSI}', 'Jussi Toivonen'), ('${OTTO}', 'Otto Ranta');
insert into public.koutsi_students values ('${MARIA}', 'Maria K.'), ('${JUSSI}', 'Jussi T.'), ('${OTTO}', 'Otto R.'), ('${NOACC}', 'Nella N.');
insert into public.koutsi_groups values ('${GROUP}', '${ANNA}', 'Aikuiset jatko');
insert into public.koutsi_group_members values ('${GROUP}', '${MARIA}', null), ('${GROUP}', '${JUSSI}', null), ('${GROUP}', '${OTTO}', now() - interval '1 day'), ('${GROUP}', '${NOACC}', null);
`;

async function fresh() {
  const db = await PGlite.create();
  await db.exec(STUB);
  await db.exec(MIGRATION);
  return db;
}
const as = (db, uid) => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (db, sql, params = []) => (await db.query(sql, params)).rows;
const notices = (db, who) => all(db, `select kind, title, body, link_path, burst_count from koutsi_notifications where recipient_id = $1 order by created_at, title`, [who]);
const when = async (db, date, time) => (await one(db, `select koutsi_session_when($1::date, $2::time) w`, [date, time])).w;
const day = async (db, offset) => (await one(db, `select ((now() at time zone 'Europe/Helsinki')::date + $1::int)::text d`, [offset])).d;

async function lesson(db, { student = MARIA, group = null, offset = 3, time = '15:00', type = group ? 'Ryhmätreeni' : 'Yksityistunti', loggedBy = 'coach', series = null } = {}) {
  const date = await day(db, offset);
  const row = await one(db, `insert into koutsi_trainings (coach_id, student_id, group_id, date, time, type, logged_by, series_id)
    values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`, [ANNA, group ? null : student, group, date, time, type, loggedBy, series]);
  await db.exec('delete from koutsi_notifications'); // the "Uusi treeni" notice is not what these tests look at
  return { id: row.id, date };
}

test('moving a private lesson to another day tells the player once, with the old time', async () => {
  const db = await fresh();
  await as(db, ANNA);
  const l = await lesson(db);
  const newDate = await day(db, 4);
  await db.query(`update koutsi_trainings set date = $2, time = '16:00' where id = $1`, [l.id, newDate]);
  assert.deepEqual(await notices(db, MARIA), [{
    kind: 'training_moved', title: 'Treeni siirtyi',
    body: `Yksityistunti · ${await when(db, newDate, '16:00')} (oli ${await when(db, l.date, '15:00')})`,
    link_path: '/pelaaja', burst_count: 1,
  }]);
  assert.deepEqual(await notices(db, ANNA), [], 'the coach is not told about their own change');
});

test('a time change on the same day says only the old time', async () => {
  const db = await fresh();
  await as(db, ANNA);
  const l = await lesson(db);
  await db.query(`update koutsi_trainings set time = '17:30' where id = $1`, [l.id]);
  const [n] = await notices(db, MARIA);
  assert.equal(n.body, `Yksityistunti · ${await when(db, l.date, '17:30')} (oli klo 15:00)`);
});

test('saving the same day and time, or changing only the type, length or plan, says nothing', async () => {
  const db = await fresh();
  await as(db, ANNA);
  const l = await lesson(db);
  await db.query(`update koutsi_trainings set date = date, time = time, type = 'Ottelu', duration_minutes = 90, notes = '{"plan":1}' where id = $1`, [l.id]);
  assert.deepEqual(await notices(db, MARIA), []);
});

test('moving a group session tells its current members with an account, not one who left', async () => {
  const db = await fresh();
  await as(db, ANNA);
  const g = await lesson(db, { group: GROUP, time: '18:30' });
  await db.query(`update koutsi_trainings set time = '19:00' where id = $1`, [g.id]);
  const body = `Aikuiset jatko · ${await when(db, g.date, '19:00')} (oli klo 18:30)`;
  assert.deepEqual((await notices(db, MARIA)).map((n) => n.body), [body]);
  assert.deepEqual((await notices(db, JUSSI)).map((n) => n.body), [body]);
  assert.deepEqual(await notices(db, OTTO), []);
  assert.equal((await one(db, `select count(*)::int c from koutsi_notifications where recipient_id = $1`, [NOACC])).c, 0);
});

test('a whole series moved at once is one notice per player ("Treenisi muuttuivat")', async () => {
  const db = await fresh();
  await as(db, ANNA);
  const series = '00000000-0000-4000-8000-00000000d001';
  for (const offset of [2, 9, 16, 23, 30]) await lesson(db, { offset, series });
  await db.query(`update koutsi_trainings set time = '16:00' where series_id = $1`, [series]);
  assert.deepEqual(await notices(db, MARIA), [{
    kind: 'training_moved', title: 'Treenisi muuttuivat',
    body: 'Valmentajasi muutti treenejäsi. Katso uudet ajat Koutsin kalenterista.',
    link_path: '/pelaaja', burst_count: 5,
  }]);
});

test('a move mixed with a cancellation in the same minutes stays one notice', async () => {
  const db = await fresh();
  await as(db, ANNA);
  const a = await lesson(db, { offset: 2 });
  const b = await lesson(db, { offset: 5 });
  await db.query(`update koutsi_trainings set time = '16:00' where id = $1`, [a.id]);
  await db.query(`delete from koutsi_trainings where id = $1`, [b.id]);
  const list = await notices(db, MARIA);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'Treenisi muuttuivat');
  assert.equal(list[0].burst_count, 2);
});

test('fixing the time of a session that is over, a player\'s own log, or bulk work says nothing', async () => {
  const db = await fresh();
  await as(db, ANNA);
  const past = await lesson(db, { offset: -2 });
  await db.query(`update koutsi_trainings set time = '16:00' where id = $1`, [past.id]);
  await as(db, MARIA);
  const own = await lesson(db, { loggedBy: 'player' });
  await db.query(`update koutsi_trainings set date = date + 1 where id = $1`, [own.id]);
  await as(db, ANNA);
  const l = await lesson(db);
  await db.exec(`begin; select set_config('koutsi.bulk_trainings', 'on', true); update koutsi_trainings set time = '16:00' where id = '${l.id}'; commit;`);
  assert.deepEqual(await all(db, 'select kind from koutsi_notifications'), []);
});

test('moving a session that has not started yet into the past still tells the player', async () => {
  const db = await fresh();
  await as(db, ANNA);
  const l = await lesson(db, { offset: 1 });
  const yesterday = await day(db, -1);
  await db.query(`update koutsi_trainings set date = $2 where id = $1`, [l.id, yesterday]);
  assert.equal((await notices(db, MARIA)).length, 1);
});

test('"En pääse" from the player reaches the coach and opens the session', async () => {
  const db = await fresh();
  await as(db, ANNA);
  const l = await lesson(db);
  await as(db, MARIA);
  await db.query(`insert into koutsi_training_absences (training_id, student_id) values ($1, $2)`, [l.id, MARIA]);
  assert.deepEqual(await notices(db, ANNA), [{
    kind: 'player_absence', title: 'Maria Kallio ei pääse',
    body: `Yksityistunti · ${await when(db, l.date, '15:00')}`,
    link_path: `/valmentaja/treeni/${l.id}`, burst_count: 1,
  }]);
  assert.deepEqual(await notices(db, MARIA), [], 'the player is not told about their own report');
});

test('"En pääse" for several sessions at once is one notice that lists them and opens the player', async () => {
  const db = await fresh();
  await as(db, ANNA);
  const sessions = [];
  for (const offset of [2, 9, 16]) sessions.push(await lesson(db, { offset }));
  await as(db, MARIA);
  await db.query(`insert into koutsi_training_absences (training_id, student_id) select unnest($1::uuid[]), $2`, [sessions.map((s) => s.id), MARIA]);
  const list = await notices(db, ANNA);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'Maria Kallio ei pääse 3 treeniin');
  assert.equal(list[0].burst_count, 3);
  assert.equal(list[0].link_path, `/valmentaja/pelaaja/${MARIA}`);
  const lines = await Promise.all(sessions.map(async (s) => `Yksityistunti · ${await when(db, s.date, '15:00')}`));
  assert.equal(list[0].body, lines.join('\n'));
});

test('two players\' absences stay two notices; a group session names the group', async () => {
  const db = await fresh();
  await as(db, ANNA);
  const g = await lesson(db, { group: GROUP, time: '18:30' });
  await as(db, MARIA);
  await db.query(`insert into koutsi_training_absences (training_id, student_id) values ($1, $2)`, [g.id, MARIA]);
  await as(db, JUSSI);
  await db.query(`insert into koutsi_training_absences (training_id, student_id) values ($1, $2)`, [g.id, JUSSI]);
  const list = await notices(db, ANNA);
  assert.deepEqual(list.map((n) => n.title).sort(), ['Jussi Toivonen ei pääse', 'Maria Kallio ei pääse']);
  assert.ok(list.every((n) => n.body === list[0].body && n.body.startsWith('Aikuiset jatko · ')));
});

test('the coach marking someone absent, or a session that has started, says nothing', async () => {
  const db = await fresh();
  await as(db, ANNA);
  const l = await lesson(db);
  await db.query(`insert into koutsi_training_absences (training_id, student_id) values ($1, $2)`, [l.id, MARIA]);
  const past = await lesson(db, { offset: -1 });
  await as(db, MARIA);
  await db.query(`insert into koutsi_training_absences (training_id, student_id) values ($1, $2)`, [past.id, MARIA]);
  assert.deepEqual(await all(db, 'select kind from koutsi_notifications'), []);
});

test('re-reporting an absence the coach already marked (upsert) says nothing', async () => {
  const db = await fresh();
  await as(db, ANNA);
  const l = await lesson(db);
  await db.query(`insert into koutsi_training_absences (training_id, student_id) values ($1, $2)`, [l.id, MARIA]);
  await as(db, MARIA);
  await db.query(`insert into koutsi_training_absences (training_id, student_id) values ($1, $2)
    on conflict (training_id, student_id) do update set reason = excluded.reason`, [l.id, MARIA]);
  assert.deepEqual(await all(db, 'select kind from koutsi_notifications'), []);
});

test('"Pääsenkin" right after "En pääse": the coach\'s notice just goes away', async () => {
  const db = await fresh();
  await as(db, ANNA);
  const l = await lesson(db);
  await as(db, MARIA);
  await db.query(`insert into koutsi_training_absences (training_id, student_id) values ($1, $2)`, [l.id, MARIA]);
  await db.query(`delete from koutsi_training_absences where training_id = $1 and student_id = $2`, [l.id, MARIA]);
  assert.deepEqual(await notices(db, ANNA), []);
});

test('"Pääsenkin" after the coach has read it is its own notice', async () => {
  const db = await fresh();
  await as(db, ANNA);
  const l = await lesson(db);
  await as(db, MARIA);
  await db.query(`insert into koutsi_training_absences (training_id, student_id) values ($1, $2)`, [l.id, MARIA]);
  await db.exec(`update koutsi_notifications set read_at = now()`);
  await db.query(`delete from koutsi_training_absences where training_id = $1 and student_id = $2`, [l.id, MARIA]);
  const list = await notices(db, ANNA);
  assert.deepEqual(list.map((n) => [n.kind, n.title, n.link_path]), [
    ['player_absence', 'Maria Kallio ei pääse', `/valmentaja/treeni/${l.id}`],
    ['player_back', 'Maria Kallio pääseekin', `/valmentaja/treeni/${l.id}`],
  ]);
});

test('the coach clearing an absence, or deleting the session, sends no "pääseekin"', async () => {
  const db = await fresh();
  await as(db, ANNA);
  const a = await lesson(db, { offset: 2 });
  const b = await lesson(db, { offset: 5 });
  await as(db, MARIA);
  await db.query(`insert into koutsi_training_absences (training_id, student_id) values ($1, $2), ($3, $2)`, [a.id, MARIA, b.id]);
  await db.exec(`update koutsi_notifications set read_at = now(), email_status = 'sent'`);
  await as(db, ANNA);
  await db.query(`delete from koutsi_training_absences where training_id = $1`, [a.id]);
  await db.query(`delete from koutsi_trainings where id = $1`, [b.id]);
  assert.deepEqual((await notices(db, ANNA)).map((n) => n.kind), ['player_absence']);
  assert.deepEqual((await notices(db, MARIA)).map((n) => n.kind), ['training_cancelled'], 'the player still hears of the cancellation');
});

test('e-mail choices: a moved session is "treenit", absences are "poissaolot"; old kinds unchanged', async () => {
  const db = await fresh();
  const cat = async (k) => (await one(db, 'select koutsi_email_category($1) c', [k])).c;
  assert.equal(await cat('training_moved'), 'treenit');
  assert.equal(await cat('player_absence'), 'poissaolot');
  assert.equal(await cat('player_back'), 'poissaolot');
  assert.equal(await cat('training_added'), 'treenit');
  assert.equal(await cat('diary'), 'valmentaja');
  assert.equal(await cat('match_note'), 'ottelut');
});

test('e-mail timing: the new kinds skip the 3-hour wait (outside quiet hours); a digest kind still waits', async () => {
  const db = await fresh();
  const hour = (await one(db, `select extract(hour from (now() at time zone 'Europe/Helsinki'))::int h`)).h;
  const quiet = hour >= 21 || hour < 7;
  // both had a mail an hour ago; each now has one pending notice older than 2 minutes
  await db.query(`insert into koutsi_notifications (recipient_id, kind, title, email_status, emailed_at, created_at)
    values ($1, 'diary', 'vanha', 'sent', now() - interval '1 hour', now() - interval '1 hour'),
           ($2, 'diary', 'vanha', 'sent', now() - interval '1 hour', now() - interval '1 hour')`, [ANNA, MARIA]);
  await db.query(`insert into koutsi_notifications (recipient_id, actor_id, kind, title, body, link_path, created_at)
    values ($1, $2, 'player_absence', 'Maria Kallio ei pääse', 'x', '/valmentaja/treeni/1', now() - interval '3 minutes'),
           ($2, $1, 'diary', 'Uusi huomio valmentajaltasi', 'y', '/pelaaja', now() - interval '3 minutes')`, [ANNA, MARIA]);
  const claimed = await all(db, 'select email, kind, title from koutsi_claim_notification_batch(25)');
  assert.deepEqual(claimed, quiet ? [] : [{ email: 'anna@example.test', kind: 'player_absence', title: 'Maria Kallio ei pääse' }]);
});

test('e-mail: a coach who turned off "poissaolot" still sees the notice in the app, gets no mail', async () => {
  const db = await fresh();
  await db.query(`insert into koutsi_notification_prefs (user_id, email_off) values ($1, '{poissaolot}')`, [ANNA]);
  await db.query(`insert into koutsi_notifications (recipient_id, actor_id, kind, title, created_at)
    values ($1, $2, 'player_absence', 'Maria Kallio ei pääse', now() - interval '3 minutes')`, [ANNA, MARIA]);
  assert.deepEqual(await all(db, 'select * from koutsi_claim_notification_batch(25)'), []);
  assert.equal((await one(db, `select email_status s from koutsi_notifications where recipient_id = $1`, [ANNA])).s, 'skipped');
});

test('the earlier bursts still read as before (diary, new sessions)', async () => {
  const db = await fresh();
  await as(db, ANNA);
  for (let i = 0; i < 3; i += 1) await db.query(`select koutsi_notify($1, $2, 'diary', 'Uusi huomio valmentajaltasi', $3, '/pelaaja')`, [MARIA, ANNA, `huomio ${i}`]);
  const series = '00000000-0000-4000-8000-00000000d002';
  for (const offset of [2, 9]) {
    const date = await day(db, offset);
    await db.query(`insert into koutsi_trainings (coach_id, student_id, date, time, type, series_id) values ($1, $2, $3, '15:00', 'Yksityistunti', $4)`, [ANNA, JUSSI, date, series]);
  }
  assert.deepEqual((await notices(db, MARIA)).map((n) => [n.title, n.body, n.burst_count]), [['3 uutta huomiota valmentajaltasi', 'Uusin: huomio 2', 3]]);
  assert.deepEqual((await notices(db, JUSSI)).map((n) => [n.title, n.burst_count]), [['Uusia treenejä kalenterissasi', 2]]);
});
