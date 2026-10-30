// 20261030131000_koutsi_mail_and_key_fixes.check.mjs — runs the proposed mail + key fixes
// (koutsi/web/sql/20261030131000_koutsi_mail_and_key_fixes.sql, NOT applied) in PGlite on top of the live
// definitions read from supabase/migrations, in two small worlds:
//   * e-mail: production's notification pipeline (koutsi_email_round, koutsi_move_and_absence_notices, the
//     training triggers of no_middle_dots, koutsi_mark_notifications_sent / koutsi_requeue_stuck_notifications
//     of 20260914083405). Checks that a row is mailed only when it is itself due (quiet hours 21–07, the
//     3-hour digest, the kinds that skip either), that a failed digest comes back whole, and the kind of a
//     burst of session changes. The Helsinki hour is pinned per test (koutsi.test_hour, patched into the
//     claim function here only) so the quiet-hour cases run at any time of day.
//   * valmentaja-avaimet: koutsi_coach_plans (20261029193756) + koutsi_trial_codes (20261030080055,
//     20261030082914). Checks that a free-use key works for a new account only. Key names here are made up.
// PGlite is not a dependency of the repo, so this is not part of `npm run test:koutsi`. To run it:
//   (in an empty temp folder) npm i @electric-sql/pglite@0.3
//   PGLITE=<that folder>/node_modules/@electric-sql/pglite/dist/index.js node --test koutsi/web/sql/20261030131000_koutsi_mail_and_key_fixes.check.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite');

const here = dirname(fileURLToPath(import.meta.url));
const mig = (name) => readFile(join(here, '../../../supabase/migrations', name), 'utf8');
const FIXES = await readFile(join(here, '20261030131000_koutsi_mail_and_key_fixes.sql'), 'utf8');
const EMAIL_ROUND = await mig('20261026110257_koutsi_email_round.sql');
const MOVES = await mig('20261026183340_koutsi_move_and_absence_notices.sql');
const NO_DOTS = await mig('20261030070237_no_middle_dots.sql');
const CAPTURE = await mig('20260914083405_capture_untracked_notification_admin_and_misc_functions.sql');
const PLANS = await mig('20261029193756_koutsi_coach_plans.sql');
const CODES = await mig('20261030080055_koutsi_trial_codes.sql');
const PLUS = await mig('20261030082914_koutsi_trial_codes_plus.sql');

/** One `create or replace function public.<name>(…) … $tag$;` statement, exactly as in the file. */
function fnStatement(src, name) {
  const start = src.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} not in the file`);
  const asIdx = src.indexOf('\nas ', start);
  const tag = src.slice(asIdx + 4).match(/^(\$[a-z_]*\$)/)[1];
  const end = src.indexOf(tag, asIdx + 4 + tag.length) + tag.length;
  return src.slice(start, end) + ';';
}

// The claim function reads the Helsinki hour from now(); the checks pin it (only here, never in the file).
const HOUR = `extract(hour from (now() at time zone 'Europe/Helsinki'))::integer`;
assert.ok(FIXES.includes(`v_hour integer := ${HOUR};`), 'the hour expression moved: update the check');
const FIXES_PINNED = FIXES.replace(`v_hour integer := ${HOUR};`,
  `v_hour integer := coalesce(nullif(current_setting('koutsi.test_hour', true), '')::integer, ${HOUR});`);

const ROLES = `
create schema if not exists auth;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

// ════════════════════════════════════════════════════════════════════════════
// E-mail
// ════════════════════════════════════════════════════════════════════════════

const ANNA = '00000000-0000-4000-8000-0000000000a1'; // coach
const MARIA = '00000000-0000-4000-8000-000000000001'; // player in Anna's group
const JUSSI = '00000000-0000-4000-8000-000000000002'; // player in Anna's group
const NOMAIL = '00000000-0000-4000-8000-000000000003'; // account without an address
const GROUP = '00000000-0000-4000-8000-00000000c001';

const MAIL_STUB = `${ROLES}
create table auth.users (id uuid primary key, email text);
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
  created_at timestamptz not null default now(), updated_at timestamptz, primary key (training_id, student_id));
create table public.koutsi_notifications (
  id uuid primary key default gen_random_uuid(), recipient_id uuid not null, actor_id uuid, kind text not null,
  title text not null, body text, link_path text, created_at timestamptz not null default now(), read_at timestamptz,
  email_status text not null default 'pending', email_attempts integer not null default 0, email_error text,
  emailed_at timestamptz, burst_count integer not null default 1);
create table public.koutsi_notification_prefs (user_id uuid primary key, email_enabled boolean default true, email_off text[] not null default '{}');
-- koutsi_use_code's %rowtype needs the table to exist (the key world checks the function itself)
create table public.koutsi_trial_codes (code text primary key, shown text, months integer, max_uses integer not null default 1,
  use_count integer not null default 0, expires_at timestamptz, revoked_at timestamptz, created_at timestamptz not null default now());
create function public.koutsi_notifications_paused() returns boolean language sql stable as $$ select false $$;
create function public.koutsi_training_audience(p_training koutsi_trainings) returns setof uuid language sql stable security definer set search_path to 'public' as $$
  select p_training.student_id where p_training.student_id is not null
  union
  select gm.student_id from koutsi_group_members gm
   where p_training.group_id is not null and gm.group_id = p_training.group_id and gm.ended_at is null;
$$;
${['koutsi_email_category', 'koutsi_session_when', 'koutsi_notify', 'koutsi_claim_notification_batch'].map((n) => fnStatement(EMAIL_ROUND, n)).join('\n')}
${['koutsi_mark_notifications_sent', 'koutsi_requeue_stuck_notifications'].map((n) => fnStatement(CAPTURE, n)).join('\n')}

insert into auth.users values ('${ANNA}', 'anna@example.test'), ('${MARIA}', 'maria@example.test'), ('${JUSSI}', 'jussi@example.test'), ('${NOMAIL}', null);
insert into public.profiles values ('${ANNA}', 'Anna Koutsi'), ('${MARIA}', 'Maria Kallio'), ('${JUSSI}', 'Jussi Toivonen'), ('${NOMAIL}', 'Nella N');
insert into public.koutsi_students values ('${MARIA}', 'Maria K.'), ('${JUSSI}', 'Jussi T.');
insert into public.koutsi_groups values ('${GROUP}', '${ANNA}', 'Aikuiset jatko');
insert into public.koutsi_group_members values ('${GROUP}', '${MARIA}', null), ('${GROUP}', '${JUSSI}', null);
`;

async function mailWorld() {
  const db = await PGlite.create();
  await db.exec(MAIL_STUB);
  await db.exec(MOVES); // the live notify / claim / triggers of 26.10.
  await db.exec(['koutsi_on_training_insert', 'koutsi_on_training_delete', 'koutsi_on_training_moved'].map((n) => fnStatement(NO_DOTS, n)).join('\n'));
  await db.exec(`create trigger koutsi_training_notify after insert on public.koutsi_trainings for each row execute function koutsi_on_training_insert();
    create trigger koutsi_training_cancel_notify after delete on public.koutsi_trainings for each row execute function koutsi_on_training_delete();`);
  await db.exec(FIXES_PINNED);
  await db.exec(FIXES_PINNED); // must be re-runnable
  return db;
}

const all = async (db, sql, params = []) => (await db.query(sql, params)).rows;
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const at = (db, hour) => db.query(`select set_config('koutsi.test_hour', $1, false)`, [String(hour)]);
const asUser = (db, uid) => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
/** One koutsi-notify run's batch, sorted by address and kind. */
const claim = async (db) => (await all(db, 'select * from koutsi_claim_notification_batch(25)'))
  .sort((a, b) => a.email.localeCompare(b.email) || a.kind.localeCompare(b.kind));
const statusOf = async (db, id) => (await one(db, 'select email_status s, email_error e from koutsi_notifications where id = $1', [id]));

/** A waiting notice, `minutes` old. */
async function notice(db, who, kind, title, minutes = 5, link = '/pelaaja') {
  return (await one(db, `insert into koutsi_notifications (recipient_id, actor_id, kind, title, body, link_path, created_at)
    values ($1, $2, $3, $4, 'x', $5, now() - make_interval(mins => $6)) returning id`, [who, ANNA, kind, title, link, minutes])).id;
}
/** The person's last mail went out `hours` ago. */
const mailedAgo = (db, who, hours) => db.query(`insert into koutsi_notifications (recipient_id, kind, title, email_status, emailed_at, created_at)
  values ($1, 'diary', 'vanha', 'sent', now() - make_interval(hours => $2), now() - make_interval(hours => $2))`, [who, hours]);

test('quiet hours: "Miten meni?" goes alone; the huomio written at 21:05 waits for the morning', async () => {
  const db = await mailWorld();
  await at(db, 21);
  await mailedAgo(db, MARIA, 6);
  const huomio = await notice(db, MARIA, 'diary', 'Uusi huomio valmentajaltasi', 12);
  await notice(db, MARIA, 'session_checkin', 'Treenit ohi! Miten meni?', 3);
  const out = await claim(db);
  assert.deepEqual(out.map((o) => [o.email, o.kind, o.title]), [['maria@example.test', 'session_checkin', 'Treenit ohi! Miten meni?']]);
  assert.deepEqual(await statusOf(db, huomio), { s: 'pending', e: null });
  // a cancellation and a reminder go at once even at night; a moved session and an absence wait
  await at(db, 23);
  const cancelled = await notice(db, JUSSI, 'training_cancelled', 'Treeni peruttu');
  const moved = await notice(db, JUSSI, 'training_moved', 'Treeni siirtyi');
  const absence = await notice(db, ANNA, 'player_absence', 'Maria Kallio ei pääse', 5, '/valmentaja/treeni/1');
  assert.deepEqual((await claim(db)).map((o) => [o.email, o.kind]), [['jussi@example.test', 'training_cancelled']]);
  assert.equal((await statusOf(db, moved)).s, 'pending');
  assert.equal((await statusOf(db, absence)).s, 'pending');
  assert.equal((await statusOf(db, cancelled)).s, 'sending');
  // 07:00: the night's rows that are due go, as one digest per person
  await at(db, 7);
  const morning = await claim(db);
  assert.deepEqual(morning.map((o) => [o.email, o.kind]), [['anna@example.test', 'player_absence'], ['jussi@example.test', 'training_moved'], ['maria@example.test', 'diary']]);
});

test('daytime, a mail an hour ago: a cancellation goes on its own, the huomio keeps waiting', async () => {
  const db = await mailWorld();
  await at(db, 14);
  await mailedAgo(db, MARIA, 1);
  const huomio = await notice(db, MARIA, 'diary', 'Uusi huomio valmentajaltasi', 30);
  await notice(db, MARIA, 'training_cancelled', 'Treeni peruttu', 4); // a minute apart: the digest lists them in order
  await notice(db, MARIA, 'training_moved', 'Treeni siirtyi', 3);
  const out = await claim(db);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'digest', 'the two due rows are one mail');
  assert.equal(out[0].title, '2 uutta asiaa Koutsissa');
  assert.equal(out[0].body, '• Treeni peruttu\n• Treeni siirtyi');
  assert.equal((await statusOf(db, huomio)).s, 'pending');
});

test('daytime, last mail over 3 hours ago: everything waiting is one digest; reminders keep their own mail', async () => {
  const db = await mailWorld();
  await at(db, 9);
  await mailedAgo(db, MARIA, 4);
  await notice(db, MARIA, 'diary', 'Uusi huomio valmentajaltasi', 50);
  await notice(db, MARIA, 'homework', 'Sait uuden kotiläksyn', 40);
  await notice(db, MARIA, 'session_reminder', 'Tänään treenit', 3);
  const out = await claim(db);
  assert.deepEqual(out.map((o) => [o.kind, o.title]), [['digest', '2 uutta asiaa Koutsissa'], ['session_reminder', 'Tänään treenit']]);
  assert.deepEqual(Object.keys(out[0]), ['id', 'email', 'recipient_name', 'kind', 'title', 'body', 'link_path'], 'koutsi-notify reads these');
  assert.equal(out[0].recipient_name, 'Maria Kallio');
  assert.equal(out[0].link_path, '/pelaaja');
  // a row younger than 2 minutes is never taken
  await notice(db, JUSSI, 'training_cancelled', 'Treeni peruttu', 1);
  assert.deepEqual(await claim(db), []);
});

test('a sent digest marks the folded rows sent with it; nothing is marked before', async () => {
  const db = await mailWorld();
  await at(db, 12);
  const a = await notice(db, MARIA, 'diary', 'Uusi huomio valmentajaltasi', 30);
  const b = await notice(db, MARIA, 'homework', 'Sait uuden kotiläksyn', 20);
  const c = await notice(db, MARIA, 'video', 'Valmentajasi jakoi videon', 10);
  const [mail] = await claim(db);
  assert.equal(mail.id, c, 'the newest row carries the mail');
  assert.deepEqual(await statusOf(db, a), { s: 'sending', e: `merged:${c}` });
  assert.deepEqual(await statusOf(db, b), { s: 'sending', e: `merged:${c}` });
  assert.deepEqual(await statusOf(db, c), { s: 'sending', e: null });
  await db.query('select koutsi_mark_notifications_sent($1::uuid[])', [[c]]);
  assert.deepEqual(await statusOf(db, a), { s: 'sent', e: 'merged' });
  assert.deepEqual(await statusOf(db, b), { s: 'sent', e: 'merged' });
  assert.deepEqual(await statusOf(db, c), { s: 'sent', e: null });
  // the 3-hour digest wait now counts from this mail
  await notice(db, MARIA, 'diary', 'Uusi huomio valmentajaltasi', 5);
  assert.deepEqual(await claim(db), []);
});

test('a failed digest comes back whole and is retried at once, not 3 hours later; 3 failures = failed', async () => {
  const db = await mailWorld();
  await at(db, 12);
  await mailedAgo(db, MARIA, 5);
  const a = await notice(db, MARIA, 'diary', 'Uusi huomio valmentajaltasi', 30);
  const b = await notice(db, MARIA, 'homework', 'Sait uuden kotiläksyn', 20);
  const other = await notice(db, JUSSI, 'diary', 'Uusi huomio valmentajaltasi', 20);
  let out = await claim(db);
  assert.equal(out.length, 2);
  // Maria's mail failed, Jussi's went
  await db.query('select koutsi_mark_notifications_sent($1::uuid[])', [[other]]);
  await db.query(`select koutsi_mark_notifications_sent($1::uuid[], 'resend 500: oops')`, [[b]]);
  assert.deepEqual(await statusOf(db, a), { s: 'pending', e: 'resend 500: oops' });
  assert.deepEqual(await statusOf(db, b), { s: 'pending', e: 'resend 500: oops' });
  assert.equal((await statusOf(db, other)).s, 'sent');
  out = await claim(db);
  assert.deepEqual(out.map((o) => [o.id, o.kind, o.title]), [[b, 'digest', '2 uutta asiaa Koutsissa']]);
  await db.query(`select koutsi_mark_notifications_sent($1::uuid[], 'resend 500: oops')`, [[b]]);
  await claim(db);
  await db.query(`select koutsi_mark_notifications_sent($1::uuid[], 'resend 500: again')`, [[b]]);
  assert.deepEqual(await statusOf(db, a), { s: 'failed', e: 'resend 500: again' });
  assert.deepEqual(await statusOf(db, b), { s: 'failed', e: 'resend 500: again' });
  assert.deepEqual(await claim(db), [], 'no fourth try');
});

test('a run that died mid-send: the stuck rows, folded ones too, go back to the queue', async () => {
  const db = await mailWorld();
  await at(db, 12);
  const a = await notice(db, MARIA, 'diary', 'Uusi huomio valmentajaltasi', 50);
  const b = await notice(db, MARIA, 'homework', 'Sait uuden kotiläksyn', 40);
  await claim(db); // and nothing marks them
  await db.query('select koutsi_requeue_stuck_notifications()');
  assert.equal((await statusOf(db, a)).s, 'pending');
  assert.equal((await statusOf(db, b)).s, 'pending');
  const out = await claim(db);
  assert.deepEqual(out.map((o) => [o.id, o.title]), [[b, '2 uutta asiaa Koutsissa']]);
  assert.deepEqual(await statusOf(db, a), { s: 'sending', e: `merged:${b}` });
});

test('no address or e-mail turned off: every claimed row is skipped, none is marked sent', async () => {
  const db = await mailWorld();
  await at(db, 12);
  const a = await notice(db, NOMAIL, 'diary', 'Uusi huomio valmentajaltasi', 30);
  const b = await notice(db, NOMAIL, 'homework', 'Sait uuden kotiläksyn', 20);
  await db.query(`insert into koutsi_notification_prefs (user_id, email_enabled) values ($1, false)`, [JUSSI]);
  const c = await notice(db, JUSSI, 'training_cancelled', 'Treeni peruttu', 20);
  assert.deepEqual(await claim(db), []);
  for (const id of [a, b, c]) assert.deepEqual(await statusOf(db, id), { s: 'skipped', e: null });
});

test('a group\'s new time (cancel + add) is one "Treenisi muuttuivat": quiet hours kept, no 3-hour wait', async () => {
  const db = await mailWorld();
  await asUser(db, ANNA);
  const day = async (n) => (await one(db, `select ((now() at time zone 'Europe/Helsinki')::date + $1::int)::text d`, [n])).d;
  for (const n of [2, 9]) await db.query(`insert into koutsi_trainings (coach_id, group_id, date, time, type) values ($1, $2, $3, '18:00', 'Ryhmätreeni')`, [ANNA, GROUP, await day(n)]);
  await db.exec('delete from koutsi_notifications');
  // what the app does when the weekly slot moves: the coming sessions out, the new ones in
  await db.query(`delete from koutsi_trainings where group_id = $1`, [GROUP]);
  for (const n of [3, 10]) await db.query(`insert into koutsi_trainings (coach_id, group_id, date, time, type) values ($1, $2, $3, '19:00', 'Ryhmätreeni')`, [ANNA, GROUP, await day(n)]);
  const list = await all(db, `select recipient_id, kind, title, burst_count from koutsi_notifications order by recipient_id`);
  assert.deepEqual(list.map((n) => [n.recipient_id, n.kind, n.title, n.burst_count]), [
    [MARIA, 'training_moved', 'Treenisi muuttuivat', 4],
    [JUSSI, 'training_moved', 'Treenisi muuttuivat', 4],
  ]);
  await db.exec(`update koutsi_notifications set created_at = now() - interval '5 minutes'`);
  await mailedAgo(db, MARIA, 1);
  await at(db, 22);
  assert.deepEqual(await claim(db), [], 'not at night');
  await at(db, 8);
  assert.deepEqual((await claim(db)).map((o) => [o.email, o.kind, o.title]), [
    ['jussi@example.test', 'training_moved', 'Treenisi muuttuivat'],
    ['maria@example.test', 'training_moved', 'Treenisi muuttuivat'],
  ], 'in the morning, even an hour after the last mail');
});

test('a burst keeps its kind: additions wait for the digest, cancellations go at once, an addition after a cancellation is a change', async () => {
  const db = await mailWorld();
  const kinds = async () => (await all(db, `select kind, title, burst_count from koutsi_notifications where recipient_id = $1`, [MARIA]))
    .map((n) => [n.kind, n.title, n.burst_count]);
  const notify = (kind, title) => db.query(`select koutsi_notify($1, $2, $3, $4, 'x', '/pelaaja')`, [MARIA, ANNA, kind, title]);
  await notify('training_added', 'Uusi treeni kalenterissasi');
  await notify('training_added', 'Uusi treeni kalenterissasi');
  assert.deepEqual(await kinds(), [['training_added', 'Uusia treenejä kalenterissasi', 2]]);
  await notify('training_cancelled', 'Treeni peruttu');
  assert.deepEqual(await kinds(), [['training_moved', 'Treenisi muuttuivat', 3]]);
  await db.exec('delete from koutsi_notifications');
  await notify('training_cancelled', 'Treeni peruttu');
  await notify('training_cancelled', 'Treeni peruttu');
  assert.deepEqual(await kinds(), [['training_cancelled', 'Treenejä peruttu', 2]]);
  await db.exec(`update koutsi_notifications set created_at = now() - interval '5 minutes'`);
  await at(db, 23);
  assert.deepEqual((await claim(db)).map((o) => [o.kind, o.title]), [['training_cancelled', 'Treenejä peruttu']], 'cancellations go even at night');
  await db.exec('delete from koutsi_notifications');
  await notify('training_moved', 'Treeni siirtyi');
  await notify('training_cancelled', 'Treeni peruttu');
  assert.deepEqual(await kinds(), [['training_moved', 'Treenisi muuttuivat', 2]]);
  // other kinds never change on a merge
  await db.exec('delete from koutsi_notifications');
  await notify('diary', 'Uusi huomio valmentajaltasi');
  await notify('diary', 'Uusi huomio valmentajaltasi');
  assert.deepEqual(await kinds(), [['diary', '2 uutta huomiota valmentajaltasi', 2]]);
});

test('only the service role runs the mail functions', async () => {
  const db = await mailWorld();
  for (const fn of ['koutsi_claim_notification_batch(integer)', 'koutsi_mark_notifications_sent(uuid[], text)']) {
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await one(db, `select has_function_privilege($1, $2, 'execute') ok`, [role, `public.${fn}`])).ok, false, `${role} ${fn}`);
    }
    assert.equal((await one(db, `select has_function_privilege('service_role', $1, 'execute') ok`, [`public.${fn}`])).ok, true, fn);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Valmentaja-avaimet
// ════════════════════════════════════════════════════════════════════════════

const ADMIN = '00000000-0000-4000-8000-0000000000e1';
const FREE = '00000000-0000-4000-8000-0000000000f1'; // a contract coach

const KEY_STUB = `${ROLES}
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
grant usage on schema public, auth to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create table public.profiles (id uuid primary key, name text);
create table public.koutsi_admins (user_id uuid primary key);
create table public.koutsi_coaches (id uuid primary key);
create table public.koutsi_exercises (id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.koutsi_coaches(id) on delete cascade, name text not null);
create table public.koutsi_coach_invite_codes (code text primary key, max_uses integer not null default 1,
  use_count integer not null default 0, expires_at timestamptz, revoked_at timestamptz, redeemed_by uuid, redeemed_at timestamptz);
create table public.koutsi_billing_coaches (coach_id uuid primary key);
create table public.koutsi_billers (id uuid primary key default gen_random_uuid(), coach_id uuid not null);
create function public.koutsi_is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (select 1 from public.koutsi_admins a where a.user_id = (select auth.uid())); $$;
create function public.koutsi_seed_exercises(target_coach uuid default null) returns integer
language plpgsql security definer set search_path to 'public' as $$
begin
  insert into koutsi_exercises (coach_id, name) select target_coach, 'Rytmiharjoitus'
   where not exists (select 1 from koutsi_exercises e where e.coach_id = target_coach);
  return 1;
end; $$;
-- production's coach key, its rules unchanged (20260911211833)
create function public.redeem_koutsi_coach_key(key_input text) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_code koutsi_coach_invite_codes%rowtype;
begin
  if exists (select 1 from koutsi_coaches where id = v_uid) then
    return jsonb_build_object('ok', true, 'already_coach', true, 'seeded_exercises', 0);
  end if;
  select * into v_code from koutsi_coach_invite_codes where code = upper(btrim(key_input)) for update;
  if not found then raise exception 'invalid coach key'; end if;
  insert into koutsi_coaches (id) values (v_uid) on conflict (id) do nothing;
  update koutsi_coach_invite_codes set use_count = use_count + 1 where code = v_code.code;
  return jsonb_build_object('ok', true, 'already_coach', false, 'seeded_exercises', 1);
end;
$function$;
insert into auth.users (id, email, email_confirmed_at) values ('${ADMIN}', 'admin@example.test', now()), ('${FREE}', 'free@example.test', now());
insert into profiles (id, name) values ('${ADMIN}', 'Ylläpito'), ('${FREE}', 'Sopimusvalmentaja');
insert into koutsi_admins (user_id) values ('${ADMIN}');
insert into koutsi_coaches (id) values ('${ADMIN}'), ('${FREE}');
insert into koutsi_coach_invite_codes (code, max_uses) values ('VANHAKEY', 50);
`;

const kdb = new PGlite();
await kdb.exec(KEY_STUB);
await kdb.exec(PLANS);
await kdb.exec(CODES);
await kdb.exec(PLUS);
await kdb.exec(FIXES);
await kdb.exec(FIXES); // must be re-runnable

async function as(uid, sql) {
  await kdb.exec('begin');
  try {
    await kdb.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);`);
    const res = await kdb.query(sql);
    await kdb.exec('commit');
    return { rows: res.rows, error: null };
  } catch (error) {
    await kdb.exec('rollback');
    return { rows: [], error };
  }
}
const kone = async (sql) => (await kdb.query(sql)).rows[0];
const plan = async (uid) => (await kone(`select public.koutsi_coach_plan('${uid}') as p`)).p;
const use = (uid, code) => as(uid, `select public.koutsi_use_code('${code}', '2026-10-30') as s`);
const make = async (months, code) => (await as(ADMIN, `select public.koutsi_admin_create_trial_code(${months ?? 'null'}, 100, null, null, '${code}') as c`)).rows[0]?.c;
const usesOf = async (code) => Number((await kone(`select use_count from koutsi_trial_codes where code = '${code}'`)).use_count);
let people = 0;
async function newPerson() {
  people += 1;
  const id = `00000000-0000-4000-8000-0000000002${String(people).padStart(2, '0')}`;
  await kdb.exec(`insert into auth.users (id, email, email_confirmed_at) values ('${id}', 'p${people}@example.test', now());
    insert into profiles (id, name) values ('${id}', 'Henkilö ${people}');`);
  return id;
}

// one made-up name, free use without the "+", a 6-month trial with it
assert.equal(await make(null, 'Esimerkki'), 'Esimerkki');
assert.equal(await make(6, 'Esimerkki+'), 'Esimerkki+');
const GUARD = /Tämä avain toimii vain uuden tilin luonnissa/;

test('a new account: the free key gives free use, the "+" key the trial (unchanged)', async () => {
  const a = await newPerson();
  const r = await use(a, 'esimerkki');
  assert.equal(r.error, null);
  assert.equal(r.rows[0].s.plan, 'free');
  assert.equal(await plan(a), 'free');
  const b = await newPerson();
  assert.equal((await use(b, 'ESIMERKKI +')).error, null);
  assert.equal(await plan(b), 'trial');
});

test('a coach on the trial cannot turn it into free use with the same key without "+"', async () => {
  const c = await newPerson();
  assert.equal((await use(c, 'Esimerkki+')).error, null);
  const before = await usesOf('ESIMERKKI');
  const r = await use(c, 'Esimerkki');
  assert.match(String(r.error?.message), GUARD);
  assert.equal(await plan(c), 'trial');
  assert.equal(await usesOf('ESIMERKKI'), before, 'the key is not used up');
  assert.equal(Number((await kone(`select count(*) n from koutsi_trial_code_uses where coach_id = '${c}' and code = 'ESIMERKKI'`)).n), 0);
  // the default trial (no key) the same
  await kdb.exec(`create or replace function public.koutsi_self_serve_open() returns boolean language sql stable set search_path = '' as $$ select true $$`);
  const d = await newPerson();
  assert.equal((await as(d, `select public.koutsi_start_trial('2026-10-30')`)).error, null);
  await kdb.exec(`create or replace function public.koutsi_self_serve_open() returns boolean language sql stable set search_path = '' as $$ select false $$`);
  assert.match(String((await use(d, 'Esimerkki')).error?.message), GUARD);
  // a trial key still adds months
  assert.equal((await use(d, 'Esimerkki+')).error, null);
  assert.equal(await plan(d), 'trial');
});

test('nor after the trial, nor with a subscription, nor after a subscription ended', async () => {
  const ended = await newPerson();
  assert.equal((await use(ended, 'Esimerkki+')).error, null);
  await kdb.exec(`update koutsi_coach_plans set trial_ends_at = now() - interval '1 day' where coach_id = '${ended}'`);
  assert.equal(await plan(ended), 'ended');
  assert.match(String((await use(ended, 'Esimerkki')).error?.message), GUARD);
  assert.equal(await plan(ended), 'ended');

  const cancelled = await newPerson();
  assert.equal((await use(cancelled, 'Esimerkki+')).error, null);
  await kdb.exec(`update koutsi_coach_plans set plan = 'ended', trial_ends_at = now() - interval '1 day', stripe_subscription_id = 'sub_x', stripe_status = 'canceled' where coach_id = '${cancelled}'`);
  assert.match(String((await use(cancelled, 'Esimerkki')).error?.message), GUARD);

  for (const state of ['active', 'past_due']) {
    const paying = await newPerson();
    assert.equal((await use(paying, 'Esimerkki+')).error, null);
    await kdb.exec(`update koutsi_coach_plans set plan = '${state}', stripe_subscription_id = 'sub_${state}', stripe_status = '${state}' where coach_id = '${paying}'`);
    assert.match(String((await use(paying, 'Esimerkki')).error?.message), /jo tilaus/);
    assert.equal(await plan(paying), state);
  }
});

test('unchanged: a free coach is told it is free already; an old coach key changes nothing for a coach', async () => {
  assert.match(String((await use(FREE, 'Esimerkki')).error?.message), /jo maksuton/);
  const t = await newPerson();
  assert.equal((await use(t, 'Esimerkki+')).error, null);
  const r = await use(t, 'vanhakey');
  assert.equal(r.error, null);
  assert.equal(r.rows[0].s.already_coach, true);
  assert.equal(await plan(t), 'trial');
});
