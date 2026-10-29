// 20261029180000_koutsi_open_slots.check.mjs — runs the proposed Vapaat ajat migration
// (koutsi/web/sql/20261029180000_koutsi_open_slots.sql, NOT applied) in PGlite on top of a small stub of
// production's Koutsi schema. The notification pipeline is the live one: koutsi_notify, the training
// and absence triggers and koutsi_session_when are read from supabase/migrations (koutsi_email_round and
// koutsi_move_and_absence_notices), so the checks see exactly what players and coaches would be told.
// Checks: the gate, adding, who sees what, booking (first one wins), notices, removing, a freed lesson
// offered to others, and the cascades.
// PGlite is not a dependency of the repo, so this is not part of `npm run test:koutsi`. Before
// "aja migraatio":
//   (in an empty temp folder) npm i @electric-sql/pglite@0.3
//   PGLITE=<that folder>/node_modules/@electric-sql/pglite/dist/index.js node --test koutsi/web/sql/20261029180000_koutsi_open_slots.check.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite');

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = await readFile(join(here, '20261029180000_koutsi_open_slots.sql'), 'utf8');
const EMAIL_ROUND = await readFile(join(here, '../../../supabase/migrations/20261026110257_koutsi_email_round.sql'), 'utf8');
const MOVE_AND_ABSENCE = await readFile(join(here, '../../../supabase/migrations/20261026183340_koutsi_move_and_absence_notices.sql'), 'utf8');

/** One `create or replace function public.<name>(…) … $tag$;` statement, exactly as in the file. */
function fnStatement(src, name) {
  const start = src.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} not in the file`);
  const asIdx = src.indexOf('\nas ', start);
  const tag = src.slice(asIdx + 4).match(/^(\$[a-z_]*\$)/)[1];
  const end = src.indexOf(tag, asIdx + 4 + tag.length) + tag.length;
  return src.slice(start, end) + ';';
}

const ANNA = '00000000-0000-4000-8000-0000000000a1'; // a private coach, on the list
const JUHO = '00000000-0000-4000-8000-0000000000b1'; // a club coach, not on the list (like Alpo)
const ADMIN = '00000000-0000-4000-8000-0000000000e1';
const MARIA = '00000000-0000-4000-8000-000000000001'; // Anna's player
const JUSSI = '00000000-0000-4000-8000-000000000002'; // Anna's player
const OTTO = '00000000-0000-4000-8000-000000000003'; // was Anna's player (coaching ended)
const PH = '00000000-0000-4000-8000-000000000004'; // Anna's player added by name, no account
const PEKKA = '00000000-0000-4000-8000-000000000005'; // Juho's player only

const STUB = `
create schema if not exists auth;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
-- Supabase's defaults: new tables and functions in public are open to the API roles until revoked.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create table public.profiles (id uuid primary key, name text not null);
create table public.koutsi_admins (user_id uuid primary key);
create table public.koutsi_coaches (id uuid primary key);
create table public.koutsi_students (id uuid primary key, display_name text);
create table public.koutsi_coach_students (
  coach_id uuid not null references public.koutsi_coaches(id) on delete cascade,
  student_id uuid not null references public.koutsi_students(id) on update cascade on delete cascade,
  ended_at timestamptz, primary key (coach_id, student_id));
create table public.koutsi_groups (id uuid primary key, coach_id uuid not null, name text);
create table public.koutsi_group_members (group_id uuid, student_id uuid, ended_at timestamptz, primary key (group_id, student_id));
create table public.koutsi_trainings (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.koutsi_coaches(id) on delete cascade, group_id uuid,
  student_id uuid references public.koutsi_students(id) on update cascade on delete cascade,
  date date not null, time time not null, type text not null,
  logged_by text not null default 'coach' check (logged_by in ('coach', 'player')),
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
create function public.koutsi_is_admin() returns boolean language sql stable security definer set search_path to '' as $$
  select (select auth.uid()) is not null and exists (select 1 from public.koutsi_admins a where a.user_id = (select auth.uid())); $$;
create function public.koutsi_acts_as(target uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select target is not null and (target = (select auth.uid()) or public.koutsi_is_admin()); $$;
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
`;

const SEED = `
insert into auth.users (id, email) values ('${ANNA}', 'anna@example.test'), ('${JUHO}', 'juho@example.test'), ('${ADMIN}', 'admin@example.test'),
  ('${MARIA}', 'maria@example.test'), ('${JUSSI}', 'jussi@example.test'), ('${OTTO}', 'otto@example.test'), ('${PEKKA}', 'pekka@example.test');
insert into profiles (id, name) values ('${ANNA}', 'Anna Virtanen'), ('${JUHO}', 'Juho Aalto'), ('${ADMIN}', 'Ylläpitäjä'),
  ('${MARIA}', 'Maria Kallio'), ('${JUSSI}', 'Jussi Toivonen'), ('${OTTO}', 'Otto Ranta'), ('${PEKKA}', 'Pekka P.');
insert into koutsi_admins (user_id) values ('${ADMIN}');
insert into koutsi_coaches (id) values ('${ANNA}'), ('${JUHO}'), ('${ADMIN}');
insert into koutsi_students (id, display_name) values ('${MARIA}', 'Maria K.'), ('${JUSSI}', 'Jussi T.'), ('${OTTO}', 'Otto R.'), ('${PH}', 'Pirjo S.'), ('${PEKKA}', 'Pekka P.');
insert into koutsi_coach_students (coach_id, student_id, ended_at) values ('${ANNA}', '${MARIA}', null), ('${ANNA}', '${JUSSI}', null),
  ('${ANNA}', '${OTTO}', now() - interval '3 days'), ('${ANNA}', '${PH}', null), ('${JUHO}', '${PEKKA}', null), ('${JUHO}', '${MARIA}', null);
`;

const db = new PGlite();
await db.exec(STUB);
await db.exec(MOVE_AND_ABSENCE); // the live koutsi_notify and the absence notices
await db.exec(SEED);
await db.exec(MIGRATION);
await db.exec(MIGRATION); // must be re-runnable
// Anna is opened by the owner — in any letter case, with stray spaces.
await db.exec(`insert into koutsi_open_slot_coaches (email) values (' Anna@Example.TEST ')`);

/** Runs `sql` as `uid` (role authenticated) in its own transaction. */
async function as(uid, sql, params = []) {
  await db.exec('begin');
  try {
    await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);`);
    const res = await db.query(sql, params);
    await db.exec('commit');
    return { rows: res.rows, error: null };
  } catch (error) {
    await db.exec('rollback');
    return { rows: [], error };
  }
}
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await all(sql, params))[0];
const day = async (offset) => (await one(`select ((now() at time zone 'Europe/Helsinki')::date + $1::int)::text d`, [offset])).d;
const when = async (date, time) => (await one(`select koutsi_session_when($1::date, $2::time) w`, [date, time])).w;
const add = (uid, slots) => as(uid, `select public.koutsi_add_open_slots($1::jsonb) as n`, [JSON.stringify(slots)]);
const book = (uid, slotId) => as(uid, `select public.koutsi_book_open_slot($1::uuid) as id, current_setting('koutsi.bulk_trainings', true) as quiet`, [slotId]);
const slotAt = (date, time) => one(`select * from koutsi_open_slots where coach_id = $1 and date = $2 and time = $3::time and booked_by is null`, [ANNA, date, time]);
const notices = (who, kind) => all(`select kind, title, body, link_path, actor_id, burst_count from koutsi_notifications where recipient_id = $1 and ($2::text is null or kind = $2) order by created_at`, [who, kind || null]);

test('the gate: the owner\'s list (any letter case) and admins, nobody else', async () => {
  for (const [uid, on] of [[ANNA, true], [ADMIN, true], [JUHO, false], [MARIA, false]]) {
    const r = await as(uid, `select public.koutsi_open_slots_enabled() as on`);
    assert.equal(r.error, null, r.error?.message);
    assert.equal(r.rows[0].on, on, uid);
  }
  let r = await as(ANNA, `select public.koutsi_open_slots_coach_enabled('${JUHO}') as on`);
  assert.ok(r.error, 'the per-coach gate is not callable from the app');
  r = await as(ANNA, `select email from koutsi_open_slot_coaches`);
  assert.ok(r.error, 'the list is not readable from the app');
  r = await as(ANNA, `insert into koutsi_open_slot_coaches (email) values ('x@example.test')`);
  assert.ok(r.error, 'nor writable');
});

test('adding: only a coach with the feature, only coming times, each open time once', async () => {
  const d2 = await day(2); const d3 = await day(3);
  let r = await add(JUHO, [{ date: d2, time: '17:00' }]);
  assert.match(String(r.error?.message), /eivät ole käytössä/, 'a coach without the feature cannot add');
  r = await add(MARIA, [{ date: d2, time: '17:00' }]);
  assert.match(String(r.error?.message), /eivät ole käytössä/, 'nor a player');

  r = await add(ANNA, [
    { date: d2, time: '17:00' },
    { date: d2, time: '18:30', duration: 90, place: '  Kenttä 2 ' },
    { date: d3, time: '17:00', duration: 60, place: '' },
  ]);
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.rows[0].n, 3);
  const rows = await all(`select date::text, to_char(time, 'HH24:MI') as time, duration_minutes, place, booked_by from koutsi_open_slots order by date, time`);
  assert.deepEqual(rows, [
    { date: d2, time: '17:00', duration_minutes: 60, place: null, booked_by: null },
    { date: d2, time: '18:30', duration_minutes: 90, place: 'Kenttä 2', booked_by: null },
    { date: d3, time: '17:00', duration_minutes: 60, place: null, booked_by: null },
  ]);

  r = await add(ANNA, [{ date: d2, time: '17:00' }]);
  assert.equal(r.rows[0].n, 0, 'a time that is already open is skipped');
  r = await add(ANNA, [{ date: await day(-1), time: '17:00' }]);
  assert.match(String(r.error?.message), /tulevaisuudessa/, 'not in the past');
  r = await add(ANNA, [{ date: await day(0), time: '00:00' }]);
  assert.match(String(r.error?.message), /tulevaisuudessa/, 'not earlier today');
  r = await add(ANNA, [{ date: await day(200), time: '17:00' }]);
  assert.match(String(r.error?.message), /puoli vuotta/, 'at most half a year ahead');
  r = await add(ANNA, [{ date: d3, time: '19:00', duration: 5 }]);
  assert.match(String(r.error?.message), /15–240/);
  r = await add(ANNA, [{ date: d3, time: '19:00', place: 'x'.repeat(121) }]);
  assert.match(String(r.error?.message), /liian pitkä/);
  r = await add(ANNA, [{ date: '2026-02-31', time: '17:00' }]);
  assert.match(String(r.error?.message), /Tarkista/, 'a broken date is refused in Finnish');
  r = await add(ANNA, Array.from({ length: 51 }, (_, i) => ({ date: d3, time: `${String(6 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}` })));
  assert.match(String(r.error?.message), /50/);
  r = await as(ANNA, `insert into koutsi_open_slots (coach_id, date, time) values ('${ANNA}', '${d3}', '20:00') returning id`);
  assert.ok(r.error, 'nobody inserts slots directly');
  r = await as(ANNA, `update koutsi_open_slots set booked_by = '${MARIA}' returning id`);
  assert.ok(r.error || r.rows.length === 0, 'nor books them by an update');
  assert.equal((await one(`select count(*)::int n from koutsi_open_slots`)).n, 3, 'nothing else was written');
});

test('one notice per publish to each current player with an account; a second publish soon after updates it', async () => {
  const d2 = await day(2); const d3 = await day(3);
  const list3 = `${await when(d2, '17:00')}, ${await when(d2, '18:30')} ja ${await when(d3, '17:00')}`;
  for (const who of [MARIA, JUSSI]) {
    assert.deepEqual(await notices(who, 'open_slots'), [{
      kind: 'open_slots', title: 'Uusia vapaita aikoja', body: `Anna Virtanen: ${list3}`, link_path: '/pelaaja/vapaat', actor_id: ANNA, burst_count: 1,
    }], who);
  }
  for (const who of [OTTO, PEKKA, ANNA, JUHO]) assert.deepEqual(await notices(who, 'open_slots'), [], `${who} hears nothing`);
  assert.equal((await one(`select count(*)::int n from koutsi_notifications where recipient_id = '${PH}'`)).n, 0, 'no notice for a player without an account');
  assert.deepEqual(await notices(MARIA, 'training_added'), [], 'adding slots is not a new session');

  // a second publish within 10 minutes: the same notice, now listing the burst
  const d4 = await day(4);
  let r = await add(ANNA, [{ date: d4, time: '16:00' }]);
  assert.equal(r.rows[0].n, 1);
  const [m] = await notices(MARIA, 'open_slots');
  assert.equal((await notices(MARIA, 'open_slots')).length, 1, 'still one notice');
  assert.equal(m.burst_count, 2);
  assert.equal(m.body, `Anna Virtanen: ${await when(d2, '17:00')}, ${await when(d2, '18:30')}, ${await when(d3, '17:00')} ja 1 muu`);

  // once read, the next publish is news again; an unread one keeps merging
  await db.exec(`update koutsi_notifications set read_at = now() where recipient_id = '${MARIA}' and kind = 'open_slots'`);
  r = await add(ANNA, [{ date: d4, time: '17:00' }, { date: d4, time: '18:00' }]);
  assert.equal(r.rows[0].n, 2);
  const maria = await notices(MARIA, 'open_slots');
  assert.equal(maria.length, 2);
  assert.equal(maria[1].body, `Anna Virtanen: ${await when(d4, '17:00')} ja ${await when(d4, '18:00')}`);
  const jussi = await notices(JUSSI, 'open_slots');
  assert.equal(jussi.length, 1);
  assert.equal(jussi[0].burst_count, 3);
  assert.match(jussi[0].body, / ja 3 muuta$/);

  // ten minutes later it is a new publish
  await db.exec(`update koutsi_notifications set created_at = created_at - interval '11 minutes' where kind = 'open_slots'`);
  r = await add(ANNA, [{ date: d4, time: '19:00' }]);
  assert.equal((await notices(JUSSI, 'open_slots')).length, 2);
  await db.exec(`delete from koutsi_notifications`);
});

test('who sees what: a coach their own, a player the open coming slots of their coaches who have the feature', async () => {
  const d2 = await day(2);
  // Juho (no feature) has a slot only the database could have made; Anna one from yesterday
  await db.exec(`insert into koutsi_open_slots (coach_id, date, time) values ('${JUHO}', '${d2}', '10:00'), ('${ANNA}', '${await day(-1)}', '10:00')`);
  const annaOpen = (await one(`select count(*)::int n from koutsi_open_slots where coach_id = '${ANNA}' and date >= '${await day(0)}'`)).n;
  let r = await as(MARIA, `select coach_id from koutsi_open_slots`);
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.rows.length, annaOpen, "Maria sees Anna's coming open slots, not Juho's (he has no feature), not yesterday's");
  assert.ok(r.rows.every((x) => x.coach_id === ANNA));
  r = await as(PEKKA, `select id from koutsi_open_slots`);
  assert.equal(r.rows.length, 0, "Juho's player sees nothing");
  r = await as(OTTO, `select id from koutsi_open_slots`);
  assert.equal(r.rows.length, 0, 'a player whose coaching ended sees nothing');
  r = await as(JUHO, `select id from koutsi_open_slots where coach_id = '${ANNA}'`);
  assert.equal(r.rows.length, 0, "another coach sees nothing of Anna's");
  r = await as(ANNA, `select id from koutsi_open_slots`);
  assert.equal(r.rows.length, annaOpen + 1, 'Anna sees all of hers, the past one too');
});

test('booking: the first one wins, it is an ordinary private lesson, the coach hears who booked', async () => {
  const d2 = await day(2);
  const s = await slotAt(d2, '18:30');
  const r = await book(MARIA, s.id);
  assert.equal(r.error, null, r.error?.message);
  const lessonId = r.rows[0].id;
  assert.equal(r.rows[0].quiet, '', 'the per-session notices are on again after the booking');
  const lesson = await one(`select coach_id, student_id, group_id, date::text, to_char(time, 'HH24:MI') as time, type, logged_by, duration_minutes, series_id from koutsi_trainings where id = $1`, [lessonId]);
  assert.deepEqual(lesson, { coach_id: ANNA, student_id: MARIA, group_id: null, date: d2, time: '18:30', type: 'Yksityistunti', logged_by: 'coach', duration_minutes: 90, series_id: null });
  const after = await one(`select booked_by, training_id, booked_at from koutsi_open_slots where id = $1`, [s.id]);
  assert.equal(after.booked_by, MARIA);
  assert.equal(after.training_id, lessonId);
  assert.ok(after.booked_at);

  assert.deepEqual(await notices(ANNA), [{
    kind: 'slot_booked', title: 'Maria Kallio varasi ajan', body: `${await when(d2, '18:30')} · Kenttä 2`,
    link_path: `/valmentaja/treeni/${lessonId}`, actor_id: MARIA, burst_count: 1,
  }]);
  assert.deepEqual(await notices(MARIA), [], 'no "Uusi treeni kalenterissasi" for her own booking');

  let again = await book(JUSSI, s.id);
  assert.match(String(again.error?.message), /Joku ehti varata/, 'the second booker is told');
  again = await book(MARIA, s.id);
  assert.equal(again.error, null, 'a double tap is fine');
  assert.equal(again.rows[0].id, lessonId, '…and books nothing new');
  assert.equal((await one(`select count(*)::int n from koutsi_trainings where student_id = '${MARIA}'`)).n, 1);

  let seen = await as(JUSSI, `select id from koutsi_open_slots where id = '${s.id}'`);
  assert.equal(seen.rows.length, 0, "Jussi does not see Maria's booking");
  seen = await as(MARIA, `select place from koutsi_open_slots where id = '${s.id}'`);
  assert.deepEqual(seen.rows, [{ place: 'Kenttä 2' }], 'Maria sees her own, with its place');

  const other = await slotAt(d2, '17:00');
  let r2 = await book(PEKKA, other.id);
  assert.match(String(r2.error?.message), /ei löytynyt/, "not Anna's player: no such slot");
  r2 = await book(OTTO, other.id);
  assert.match(String(r2.error?.message), /ei löytynyt/, 'coaching ended: no such slot');
  const juhos = await one(`select id from koutsi_open_slots where coach_id = '${JUHO}'`);
  r2 = await book(PEKKA, juhos.id);
  assert.match(String(r2.error?.message), /ei löytynyt/, 'a coach without the feature: nothing to book');
  await db.exec(`insert into koutsi_open_slots (coach_id, date, time) values ('${ANNA}', '${await day(0)}', '00:00')`);
  const gone = await slotAt(await day(0), '00:00');
  r2 = await book(MARIA, gone.id);
  assert.match(String(r2.error?.message), /jo mennyt/, 'a time that has started cannot be booked');
  await db.exec(`delete from koutsi_open_slots where id = '${gone.id}'; delete from koutsi_notifications`);
});

test('removing: the coach removes open slots; a booked one goes with its lesson', async () => {
  const d2 = await day(2); const d3 = await day(3);
  const open = await slotAt(d3, '17:00');
  const booked = await one(`select id, training_id from koutsi_open_slots where booked_by = '${MARIA}'`);
  let r = await as(JUHO, `delete from koutsi_open_slots where id = '${open.id}' returning id`);
  assert.equal(r.rows.length, 0, 'another coach cannot');
  r = await as(MARIA, `delete from koutsi_open_slots where id = '${open.id}' returning id`);
  assert.equal(r.rows.length, 0, 'a player cannot');
  r = await as(ANNA, `delete from koutsi_open_slots where id = '${booked.id}' returning id`);
  assert.equal(r.rows.length, 0, 'a booked slot is not removed on its own');
  r = await as(ANNA, `delete from koutsi_open_slots where id = '${open.id}' returning id`);
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.rows.length, 1, 'Anna removes her open slot');
  assert.equal(await one(`select id from koutsi_open_slots where id = '${open.id}'`), undefined);

  await db.exec(`delete from koutsi_trainings where id = '${booked.training_id}'`);
  assert.equal(await one(`select id from koutsi_open_slots where id = '${booked.id}'`), undefined, 'removing the lesson removes its slot');
  assert.deepEqual((await notices(MARIA)).map((n) => n.title), ['Treeni peruttu'], 'and Maria hears the lesson was cancelled, as before');
  await db.exec(`delete from koutsi_notifications`);
  assert.ok(await slotAt(d2, '17:00'), 'the other slots stay');
});

test('a freed lesson: offered to the others with one tap, its own player hears nothing, "Pääsen sittenkin" takes it back', async () => {
  const d2 = await day(2);
  const s = await slotAt(d2, '17:00');
  const lessonId = (await book(MARIA, s.id)).rows[0].id;
  let r = await as(MARIA, `insert into koutsi_training_absences (training_id, student_id) values ('${lessonId}', '${MARIA}')`);
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual((await notices(ANNA)).map((n) => n.title), ['Maria Kallio varasi ajan', 'Maria Kallio ei pääse'], 'Anna hears it as before');
  await db.exec(`delete from koutsi_notifications`);

  const offer = { date: d2, time: '17:00', duration: 60, source: lessonId };
  r = await add(ANNA, [offer]);
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.rows[0].n, 1, 'the time is open again');
  const freed = await one(`select * from koutsi_open_slots where source_training_id = '${lessonId}'`);
  assert.equal(freed.booked_by, null);
  assert.deepEqual(await notices(MARIA), [], 'Maria is not offered her own lesson');
  assert.equal((await notices(JUSSI, 'open_slots')).length, 1, 'Jussi is');
  r = await add(ANNA, [offer]);
  assert.equal(r.rows[0].n, 0, 'a lesson is offered once');
  const juhoLesson = await one(`insert into koutsi_trainings (coach_id, student_id, date, time, type) values ('${JUHO}', '${PEKKA}', '${await day(5)}', '12:00', 'Yksityistunti') returning id`);
  r = await add(ANNA, [{ date: await day(5), time: '12:00', source: juhoLesson.id }]);
  assert.match(String(r.error?.message), /Treeniä ei löytynyt/, "not someone else's lesson");

  // Maria can come after all, before anyone booked: the time is not free any more
  r = await as(MARIA, `delete from koutsi_training_absences where training_id = '${lessonId}' and student_id = '${MARIA}'`);
  assert.equal(r.error, null, r.error?.message);
  assert.equal(await one(`select id from koutsi_open_slots where id = '${freed.id}'`), undefined, 'the offered slot went away');
  assert.ok(await one(`select id from koutsi_trainings where id = '${lessonId}'`), "Maria's lesson stays");

  // …but once Jussi has booked it, taking "En pääse" back leaves his lesson alone
  await as(MARIA, `insert into koutsi_training_absences (training_id, student_id) values ('${lessonId}', '${MARIA}')`);
  assert.equal((await add(ANNA, [offer])).rows[0].n, 1);
  const again = await one(`select id from koutsi_open_slots where source_training_id = '${lessonId}'`);
  const jussiLesson = (await book(JUSSI, again.id)).rows[0].id;
  await as(MARIA, `delete from koutsi_training_absences where training_id = '${lessonId}' and student_id = '${MARIA}'`);
  const kept = await one(`select booked_by, training_id from koutsi_open_slots where id = '${again.id}'`);
  assert.deepEqual(kept, { booked_by: JUSSI, training_id: jussiLesson });
  await db.exec(`delete from koutsi_notifications`);
});

test('deleting a player or a coach takes their slots with them', async () => {
  const before = (await one(`select count(*)::int n from koutsi_open_slots where booked_by = '${JUSSI}'`)).n;
  assert.equal(before, 1);
  await db.exec(`delete from koutsi_students where id = '${JUSSI}'`);
  assert.equal((await one(`select count(*)::int n from koutsi_open_slots where booked_by = '${JUSSI}'`)).n, 0, "Jussi's booking went with him");
  await db.exec(`delete from koutsi_trainings where coach_id = '${ANNA}'; delete from koutsi_coaches where id = '${ANNA}'`);
  assert.equal((await one(`select count(*)::int n from koutsi_open_slots where coach_id = '${ANNA}'`)).n, 0, "Anna's slots went with her");
});
