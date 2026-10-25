// 20261026090000_koutsi_account_deletion.check.mjs — runs the account-deletion migration (applied
// 25.10.2026 as supabase/migrations/20261025194559_koutsi_account_deletion.sql) in PGlite against a
// small copy of production's Koutsi schema: the foreign keys around auth.users, profiles, koutsi_coaches
// and koutsi_students, and every trigger that fires while those rows are deleted (copied 25.10.2026).
// An account is deleted the way Supabase Auth does it: DELETE FROM auth.users as supabase_auth_admin,
// a role with no rights on koutsi_private.
// PGlite is not a dependency of the repo, so it is not part of `npm run test:koutsi`. To run it
// (tested with @electric-sql/pglite 0.5.11):
//   (in an empty temp folder) npm i @electric-sql/pglite
//   PGLITE=<that folder>/node_modules/@electric-sql/pglite/dist/index.js node --test koutsi/web/sql/20261026090000_koutsi_account_deletion.check.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite');

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = await readFile(join(here, '../../../supabase/migrations/20261025194559_koutsi_account_deletion.sql'), 'utf8');

const C = '00000000-0000-4000-8000-0000000000c1'; // coach
const B = '00000000-0000-4000-8000-0000000000b1'; // another coach
const P1 = '00000000-0000-4000-8000-000000000001'; // player with an account, coached by C and B
const P2 = '00000000-0000-4000-8000-000000000002'; // player with an account, C's group
const P3 = '00000000-0000-4000-8000-000000000003'; // C's placeholder player, no account
const P4 = '00000000-0000-4000-8000-000000000004'; // B's player
const GONE = '00000000-0000-4000-8000-0000000000dd'; // account deleted earlier, student row left behind
const K = '00000000-0000-4000-8000-0000000000e1'; // Krossi-only account
const S1 = '00000000-0000-4000-8000-00000000005a';
const G1 = '00000000-0000-4000-8000-0000000000a1';
const GB = '00000000-0000-4000-8000-0000000000a2';
const T_FUT = '00000000-0000-4000-8000-0000000007f1'; // C's group session next week
const T_PAST = '00000000-0000-4000-8000-0000000007f2'; // C's group session last week
const T_P1 = '00000000-0000-4000-8000-0000000007f3'; // C's private lesson with P1
const T_B = '00000000-0000-4000-8000-0000000007f4'; // B's group session
const A1 = '00000000-0000-4000-8000-0000000000f1'; // announcement to P1 only
const A2 = '00000000-0000-4000-8000-0000000000f2'; // to P1 and P2
const A3 = '00000000-0000-4000-8000-0000000000f3'; // to group G1
const A4 = '00000000-0000-4000-8000-0000000000f4'; // to placeholder P3

const BASE = `
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
do $$ begin create role supabase_auth_admin nologin; exception when duplicate_object then null; end $$;

create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to public;
alter table auth.users owner to supabase_auth_admin;
alter schema auth owner to supabase_auth_admin;
grant usage on schema public to anon, authenticated, service_role, supabase_auth_admin;

-- production: koutsi_private is usable by authenticated and service_role, not anon or Supabase Auth
create schema koutsi_private;
revoke all on schema koutsi_private from public, anon;
grant usage on schema koutsi_private to authenticated, service_role;
-- worst case for the migration's revokes: new functions executable by every API role
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema koutsi_private grant execute on functions to anon, authenticated, service_role;

create table profiles (id uuid primary key references auth.users(id) on delete cascade, name text);
create table koutsi_coaches (id uuid primary key references profiles(id) on delete cascade, archived_at timestamptz);
create table koutsi_students (id uuid primary key, display_name text, placeholder_coach_id uuid references koutsi_coaches(id) on delete cascade,
  goal text, player_note text, player_wish text, background text, last_session_note text, focus text, level text, age integer,
  long_goal text, ambition text, pilot_age_group text,
  minor_notice_confirmed_at timestamptz, minor_notice_confirmed_by uuid references auth.users(id) on delete set null,
  guardian_approval_confirmed_at timestamptz, guardian_approval_confirmed_by uuid references auth.users(id) on delete set null);
create table koutsi_coach_students (coach_id uuid not null references koutsi_coaches(id) on delete cascade,
  student_id uuid not null references koutsi_students(id) on delete cascade, ended_at timestamptz, primary key (coach_id, student_id));
create table koutsi_seasons (id uuid primary key, coach_id uuid not null references koutsi_coaches(id) on delete cascade,
  name text not null, starts_on date not null, ends_on date not null);
create table koutsi_groups (id uuid primary key, coach_id uuid not null references koutsi_coaches(id) on delete cascade, name text not null,
  season_id uuid references koutsi_seasons(id) on delete set null, continues_from uuid references koutsi_groups(id) on delete set null);
create table koutsi_group_members (group_id uuid not null references koutsi_groups(id) on delete cascade,
  student_id uuid not null references koutsi_students(id) on delete cascade, ended_at timestamptz, primary key (group_id, student_id));
-- production: the coach foreign key has no ON DELETE action
create table koutsi_group_slots (id uuid primary key default gen_random_uuid(), group_id uuid not null references koutsi_groups(id) on delete cascade,
  coach_id uuid not null references koutsi_coaches(id), weekday text not null, time time not null);
create table koutsi_trainings (id uuid primary key default gen_random_uuid(), coach_id uuid not null references koutsi_coaches(id) on delete cascade,
  group_id uuid references koutsi_groups(id) on delete cascade, student_id uuid references koutsi_students(id) on delete cascade,
  date date not null, time time not null, type text not null, logged_by text not null default 'coach');
create table koutsi_notifications (id uuid primary key default gen_random_uuid(), recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null, kind text not null, title text not null, body text, link_path text,
  created_at timestamptz not null default now());
create table koutsi_notification_prefs (user_id uuid primary key references auth.users(id) on delete cascade, email_enabled boolean default true);
create table koutsi_feedback (id uuid primary key default gen_random_uuid(), student_id uuid not null references auth.users(id) on delete cascade,
  category text not null, message text not null);
create table koutsi_app_opens (user_id uuid not null references auth.users(id) on delete cascade, app text not null, primary key (user_id, app));
create table koutsi_moods (id uuid primary key default gen_random_uuid(), student_id uuid not null references koutsi_students(id) on delete cascade,
  score integer not null, training_id uuid references koutsi_trainings(id) on delete set null);
create table koutsi_player_entries (id uuid primary key default gen_random_uuid(), student_id uuid not null references koutsi_students(id) on delete cascade, text text not null);
create table koutsi_player_history (id uuid primary key default gen_random_uuid(), student_id uuid not null references koutsi_students(id) on delete cascade,
  field text, value text, changed_by uuid references auth.users(id) on delete set null);
create table koutsi_diary_entries (id uuid primary key default gen_random_uuid(), student_id uuid not null references koutsi_students(id) on delete cascade,
  coach_id uuid references koutsi_coaches(id) on delete set null, text text not null);
create table koutsi_homework (id uuid primary key default gen_random_uuid(), student_id uuid not null references koutsi_students(id) on delete cascade, text text not null);
create table koutsi_match_notes (id uuid primary key default gen_random_uuid(), student_id uuid not null references koutsi_students(id) on delete cascade,
  opponent_name text not null, date date not null, tournament_id uuid references koutsi_trainings(id) on delete set null);
create table koutsi_training_absences (training_id uuid not null references koutsi_trainings(id) on delete cascade,
  student_id uuid not null references koutsi_students(id) on delete cascade, reason text not null, note text,
  reported_by uuid references auth.users(id) on delete set null, updated_at timestamptz, primary key (training_id, student_id));
create table koutsi_videos (id uuid primary key default gen_random_uuid(), student_id uuid not null references koutsi_students(id) on delete cascade,
  added_by_id uuid references profiles(id) on delete set null, title text, storage_path text);
create table koutsi_timeline_archive (student_id uuid not null references koutsi_students(id) on delete cascade, item_key text not null, primary key (student_id, item_key));
create table koutsi_group_invite_codes (code text primary key, group_id uuid references koutsi_groups(id) on delete cascade,
  coach_id uuid not null references koutsi_coaches(id) on delete cascade, student_id uuid references koutsi_students(id) on delete cascade);
-- production: student_id has no foreign key
create table koutsi_session_checkin_log (training_id uuid not null references koutsi_trainings(id) on delete cascade, student_id uuid not null,
  session_date date not null, primary key (training_id, student_id));
create table koutsi_announcements (id uuid primary key, coach_id uuid not null references koutsi_coaches(id) on delete cascade, body text not null,
  group_ids uuid[] not null default '{}', student_ids uuid[] not null default '{}', until date not null default current_date + 7);
create table koutsi_coach_week_notes (id uuid primary key default gen_random_uuid(), coach_id uuid not null references koutsi_coaches(id) on delete cascade, note text);
grant select, insert, update, delete on all tables in schema public to authenticated;

-- production copies (pg_get_functiondef, 25.10.2026)
create function public.koutsi_notify(p_recipient uuid, p_actor uuid, p_kind text, p_title text, p_body text, p_link text)
 returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if p_recipient is null or p_recipient = p_actor then
    return;
  end if;
  if not exists (select 1 from auth.users u where u.id = p_recipient) then
    return;
  end if;
  insert into koutsi_notifications (recipient_id, actor_id, kind, title, body, link_path)
  values (p_recipient, p_actor, p_kind, p_title, left(coalesce(p_body, ''), 500), p_link);
end;
$function$;

create function public.koutsi_training_audience(p_training koutsi_trainings)
 returns setof uuid language sql stable security definer set search_path to 'public' as $function$
  select p_training.student_id where p_training.student_id is not null
  union
  select gm.student_id from koutsi_group_members gm
   where p_training.group_id is not null and gm.group_id = p_training.group_id and gm.ended_at is null;
$function$;

create function public.koutsi_on_training_delete()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_student uuid;
begin
  if old.date < current_date then
    return old;
  end if;
  if coalesce(current_setting('koutsi.bulk_trainings', true), '') = 'on' then
    return old;
  end if;
  if old.logged_by = 'player' then
    return old;
  end if;
  for v_student in select * from koutsi_training_audience(old) loop
    perform koutsi_notify(v_student, old.coach_id, 'training_cancelled',
      'Treeni peruttu',
      to_char(old.date, 'DD.MM.YYYY') || ' klo ' || to_char(old.time, 'HH24:MI') || ' — ' || old.type,
      '/pelaaja');
  end loop;
  return old;
end; $function$;
create trigger koutsi_training_cancel_notify after delete on koutsi_trainings for each row execute function koutsi_on_training_delete();

create function public.koutsi_scrub_announcement_student()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  delete from koutsi_announcements
   where student_ids @> array[old.id] and cardinality(group_ids) = 0 and cardinality(array_remove(student_ids, old.id)) = 0;
  update koutsi_announcements set student_ids = array_remove(student_ids, old.id) where student_ids @> array[old.id];
  return old;
end;
$function$;
create trigger koutsi_students_scrub_announcements after delete on koutsi_students for each row execute function koutsi_scrub_announcement_student();

create function public.koutsi_enforce_student_column_ownership()
 returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if coalesce(current_setting('app.koutsi_claiming', true), '') = 'on' then
    return new;
  end if;
  if auth.uid() = old.id then
    new.background := old.background;
    new.last_session_note := old.last_session_note;
    new.focus := old.focus;
    new.level := old.level;
  else
    new.goal := old.goal;
    new.player_note := old.player_note;
    new.player_wish := old.player_wish;
    new.long_goal := old.long_goal;
    new.ambition := old.ambition;
  end if;
  new.pilot_age_group := old.pilot_age_group;
  new.minor_notice_confirmed_at := old.minor_notice_confirmed_at;
  new.minor_notice_confirmed_by := old.minor_notice_confirmed_by;
  new.guardian_approval_confirmed_at := old.guardian_approval_confirmed_at;
  new.guardian_approval_confirmed_by := old.guardian_approval_confirmed_by;
  return new;
end;
$function$;
create trigger koutsi_student_column_ownership before update on koutsi_students for each row execute function koutsi_enforce_student_column_ownership();

create function public.koutsi_enforce_pilot_student_limits()
 returns trigger language plpgsql set search_path to '' as $function$
begin
  if nullif(btrim(coalesce(new.background, '')), '') is not null then
    if tg_op = 'INSERT' or new.background is distinct from old.background then
      raise exception 'Terveys- ja taustatietoja ei voi tallentaa Koutsi-pilotissa';
    end if;
  end if;
  new.background := null;
  if new.age is not null and (new.age < 1 or new.age > 119) then
    if tg_op = 'INSERT' or new.age is distinct from old.age then
      raise exception 'Pelaajan iän pitää olla väliltä 1–119 vuotta';
    end if;
  end if;
  if tg_op = 'INSERT' then
    new.pilot_age_group := null;
    new.minor_notice_confirmed_at := null;
    new.minor_notice_confirmed_by := null;
    new.guardian_approval_confirmed_at := null;
    new.guardian_approval_confirmed_by := null;
  else
    new.pilot_age_group := old.pilot_age_group;
    new.minor_notice_confirmed_at := old.minor_notice_confirmed_at;
    new.minor_notice_confirmed_by := old.minor_notice_confirmed_by;
    new.guardian_approval_confirmed_at := old.guardian_approval_confirmed_at;
    new.guardian_approval_confirmed_by := old.guardian_approval_confirmed_by;
  end if;
  return new;
end;
$function$;
create trigger koutsi_students_pilot_limits before insert or update on koutsi_students for each row execute function koutsi_enforce_pilot_student_limits();

create function public.koutsi_enforce_pilot_absence_limits()
 returns trigger language plpgsql set search_path to '' as $function$
begin
  if new.reason <> 'poissa' then
    raise exception 'Beta-pilotissa läsnäoloon voi merkitä vain poissaolon ilman terveystietoa';
  end if;
  if nullif(btrim(coalesce(new.note, '')), '') is not null then
    raise exception 'Beta-pilotissa poissaolon syytä ei tallenneta';
  end if;
  new.note := null;
  return new;
end;
$function$;
create trigger koutsi_training_absences_pilot_limits before insert or update on koutsi_training_absences for each row execute function koutsi_enforce_pilot_absence_limits();

create function public.koutsi_stamp_training_absence()
 returns trigger language plpgsql set search_path to '' as $function$
begin
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  new.reported_by := coalesce((select auth.uid()), new.reported_by);
  new.updated_at := now();
  return new;
end;
$function$;
create trigger koutsi_training_absences_stamp before insert or update on koutsi_training_absences for each row execute function koutsi_stamp_training_absence();

create function public.delete_my_koutsi_data()
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  delete from koutsi_moods        where student_id = v_uid;
  delete from koutsi_match_notes  where student_id = v_uid;
  delete from koutsi_videos       where student_id = v_uid or added_by_id = v_uid;
  delete from koutsi_homework     where student_id = v_uid;
  delete from koutsi_diary_entries where student_id = v_uid or coach_id = v_uid;
  delete from koutsi_training_absences where student_id = v_uid;

  delete from koutsi_group_members where student_id = v_uid;
  delete from koutsi_coach_students where student_id = v_uid or coach_id = v_uid;

  delete from koutsi_trainings    where coach_id = v_uid;
  delete from koutsi_groups       where coach_id = v_uid;
  delete from koutsi_exercises    where coach_id = v_uid;
  delete from koutsi_coach_events where coach_id = v_uid;
  delete from koutsi_group_invite_codes where coach_id = v_uid;

  delete from koutsi_notifications where recipient_id = v_uid or actor_id = v_uid;
  delete from koutsi_notification_prefs where user_id = v_uid;

  delete from koutsi_students where id = v_uid;
  delete from koutsi_coaches  where id = v_uid;
  delete from profiles        where id = v_uid;

  return jsonb_build_object('ok', true);
end;
$function$;
create table koutsi_exercises (id uuid primary key default gen_random_uuid(), coach_id uuid not null references koutsi_coaches(id) on delete cascade);
create table koutsi_coach_events (id uuid primary key default gen_random_uuid(), coach_id uuid not null references koutsi_coaches(id) on delete cascade);
`;

const SEED = `
insert into auth.users (id, email) values
  ('${C}', 'alpo@example.test'), ('${B}', 'bea@example.test'), ('${P1}', 'pia@example.test'),
  ('${P2}', 'pekka@example.test'), ('${P4}', 'paavo@example.test'), ('${K}', 'kaisa@example.test');
insert into profiles (id, name) values ('${C}', 'Alpo'), ('${B}', 'Bea'), ('${P1}', 'Pia'), ('${P2}', 'Pekka'), ('${P4}', 'Paavo'), ('${K}', 'Kaisa');
insert into koutsi_coaches (id) values ('${C}'), ('${B}');
insert into koutsi_students (id, goal, player_note, age, level) values
  ('${P1}', 'Kakkossyöttö varmaksi', 'Haluan pelata enemmän nelinpeliä', 34, 'Kilpa'),
  ('${P2}', 'Rystylyönti', null, 41, 'Harraste'),
  ('${P4}', null, null, null, null),
  ('${GONE}', 'Vanha tavoite', 'Vanha muistiinpano', 29, 'Kilpa');
insert into koutsi_students (id, display_name, placeholder_coach_id) values ('${P3}', 'Pirjo', '${C}');
insert into koutsi_coach_students (coach_id, student_id) values
  ('${C}', '${P1}'), ('${C}', '${P2}'), ('${C}', '${P3}'), ('${C}', '${GONE}'), ('${B}', '${P4}'), ('${B}', '${P1}');
insert into koutsi_seasons (id, coach_id, name, starts_on, ends_on) values ('${S1}', '${C}', 'Syksy 2026', '2026-08-31', '2026-12-18');
insert into koutsi_groups (id, coach_id, name, season_id) values ('${G1}', '${C}', 'Aikuiset ke', '${S1}'), ('${GB}', '${B}', 'Aikuiset ti', null);
insert into koutsi_group_members (group_id, student_id) values ('${G1}', '${P1}'), ('${G1}', '${P2}'), ('${G1}', '${P3}'), ('${GB}', '${P4}'), ('${GB}', '${P1}');
insert into koutsi_group_slots (group_id, coach_id, weekday, time) values ('${G1}', '${C}', 'Ke', '18:00');
insert into koutsi_trainings (id, coach_id, group_id, student_id, date, time, type) values
  ('${T_FUT}', '${C}', '${G1}', null, current_date + 7, '18:00', 'Ryhmätreeni'),
  ('${T_PAST}', '${C}', '${G1}', null, current_date - 7, '18:00', 'Ryhmätreeni'),
  ('${T_P1}', '${C}', null, '${P1}', current_date + 3, '17:00', 'Yksityistunti'),
  ('${T_B}', '${B}', '${GB}', null, current_date + 5, '19:00', 'Ryhmätreeni');
insert into koutsi_moods (student_id, score, training_id) values ('${P1}', 4, '${T_PAST}'), ('${P2}', 5, '${T_PAST}');
insert into koutsi_player_entries (student_id, text) values ('${P1}', 'Syöttö kulki'), ('${P2}', 'Hyvä treeni');
insert into koutsi_player_history (student_id, field, value, changed_by) values
  ('${P1}', 'goal', 'Kakkossyöttö', '${P1}'), ('${P1}', 'note', 'Valmentajan kirjaus', '${C}'),
  ('${P2}', 'goal', 'Rystylyönti', '${C}'), ('${GONE}', 'goal', 'Vanha tavoite', null);
insert into koutsi_diary_entries (student_id, coach_id, text) values
  ('${P1}', '${C}', 'Hyvä asenne'), ('${P2}', '${C}', 'Rysty paranee'), ('${GONE}', null, 'Vanha merkintä');
insert into koutsi_homework (student_id, text) values ('${P1}', '50 syöttöä');
insert into koutsi_match_notes (student_id, opponent_name, date) values ('${P1}', 'Vastustaja X', current_date - 3);
select set_config('request.uid', '${P1}', false);
insert into koutsi_training_absences (training_id, student_id, reason) values ('${T_FUT}', '${P1}', 'poissa');
select set_config('request.uid', '${C}', false);
insert into koutsi_training_absences (training_id, student_id, reason) values ('${T_FUT}', '${P2}', 'poissa');
select set_config('request.uid', '', false);
insert into koutsi_videos (student_id, added_by_id, title, storage_path) values
  ('${P1}', '${C}', 'Syöttö', '${C}/v1.mp4'), ('${P2}', '${C}', 'Rysty', '${C}/v2.mp4'), ('${P1}', '${P1}', 'Oma video', '${P1}/v3.mp4');
insert into koutsi_timeline_archive (student_id, item_key) values ('${P1}', 'mood:1');
insert into koutsi_group_invite_codes (code, group_id, coach_id, student_id) values ('PIA00001', '${G1}', '${C}', '${P1}'), ('RYHMA001', '${G1}', '${C}', null);
insert into koutsi_session_checkin_log (training_id, student_id, session_date) values
  ('${T_PAST}', '${P1}', current_date - 7), ('${T_PAST}', '${P2}', current_date - 7);
insert into koutsi_announcements (id, coach_id, body, group_ids, student_ids) values
  ('${A1}', '${C}', 'Vain Pialle', '{}', array['${P1}']::uuid[]),
  ('${A2}', '${C}', 'Pialle ja Pekalle', '{}', array['${P1}', '${P2}']::uuid[]),
  ('${A3}', '${C}', 'Koko ryhmälle', array['${G1}']::uuid[], '{}'),
  ('${A4}', '${C}', 'Pirjolle', '{}', array['${P3}']::uuid[]);
insert into koutsi_notifications (recipient_id, actor_id, kind, title, body) values
  ('${P1}', '${C}', 'diary', 'Uusi merkintä valmentajaltasi', 'Alpo: Hyvä asenne'),
  ('${C}', '${P1}', 'match_note', 'Uusi ottelumuistiinpano', 'Pia — vastustaja Vastustaja X'),
  ('${P2}', '${C}', 'diary', 'Uusi merkintä valmentajaltasi', 'Alpo: Rysty paranee');
insert into koutsi_notification_prefs (user_id) values ('${P1}'), ('${P2}');
insert into koutsi_feedback (student_id, category, message) values ('${P1}', 'idea', 'Tumma teema');
insert into koutsi_app_opens (user_id, app) values ('${P1}', 'koutsi'), ('${C}', 'koutsi');
insert into koutsi_coach_week_notes (coach_id, note) values ('${C}', 'Hyvä viikko');
`;

async function fresh({ migrate = true } = {}) {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(SEED);
  if (migrate) await db.exec(MIGRATION);
  return db;
}

// Supabase Auth deletes the account row as supabase_auth_admin, without a signed-in user.
async function deleteAccount(db, uid) {
  await db.exec(`select set_config('request.uid', '', false); set role supabase_auth_admin;`);
  try {
    await db.query('delete from auth.users where id = $1', [uid]);
  } finally {
    await db.exec('reset role');
  }
}

// Counts every notification row written from now on, even ones deleted again before commit.
async function watchNotifications(db) {
  await db.exec(`
    create table notifications_written (kind text);
    create function count_notification() returns trigger language plpgsql as $$
    begin insert into notifications_written values (new.kind); return new; end $$;
    create trigger count_notification after insert on koutsi_notifications for each row execute function count_notification();
  `);
}

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0];
const count = async (db, sql, params) => (await one(db, `select count(*)::int as n from ${sql}`, params)).n;

// Every row anywhere that belongs to or points at this person; only non-zero entries come back.
async function leftovers(db, uid) {
  const checks = {
    account: `auth.users where id = $1`,
    profiles: `profiles where id = $1`,
    koutsi_students: `koutsi_students where id = $1`,
    koutsi_coaches: `koutsi_coaches where id = $1`,
    koutsi_coach_students: `koutsi_coach_students where student_id = $1 or coach_id = $1`,
    koutsi_group_members: `koutsi_group_members where student_id = $1`,
    koutsi_groups: `koutsi_groups where coach_id = $1`,
    koutsi_group_slots: `koutsi_group_slots where coach_id = $1`,
    koutsi_seasons: `koutsi_seasons where coach_id = $1`,
    koutsi_trainings: `koutsi_trainings where student_id = $1 or coach_id = $1`,
    koutsi_moods: `koutsi_moods where student_id = $1`,
    koutsi_player_entries: `koutsi_player_entries where student_id = $1`,
    koutsi_player_history: `koutsi_player_history where student_id = $1 or changed_by = $1`,
    koutsi_diary_entries: `koutsi_diary_entries where student_id = $1 or coach_id = $1`,
    koutsi_homework: `koutsi_homework where student_id = $1`,
    koutsi_match_notes: `koutsi_match_notes where student_id = $1`,
    koutsi_training_absences: `koutsi_training_absences where student_id = $1 or reported_by = $1`,
    koutsi_videos: `koutsi_videos where student_id = $1 or added_by_id = $1`,
    koutsi_timeline_archive: `koutsi_timeline_archive where student_id = $1`,
    koutsi_group_invite_codes: `koutsi_group_invite_codes where student_id = $1 or coach_id = $1`,
    koutsi_session_checkin_log: `koutsi_session_checkin_log where student_id = $1`,
    koutsi_announcements: `koutsi_announcements where coach_id = $1 or student_ids @> array[$1::uuid]`,
    koutsi_notifications: `koutsi_notifications where recipient_id = $1 or actor_id = $1`,
    koutsi_notification_prefs: `koutsi_notification_prefs where user_id = $1`,
    koutsi_feedback: `koutsi_feedback where student_id = $1`,
    koutsi_app_opens: `koutsi_app_opens where user_id = $1`,
    koutsi_coach_week_notes: `koutsi_coach_week_notes where coach_id = $1`,
  };
  const left = {};
  for (const [name, sql] of Object.entries(checks)) {
    const n = await count(db, sql, [uid]);
    if (n) left[name] = n;
  }
  return left;
}

async function koutsiRowTotal(db) {
  const { rows } = await db.query(`select table_name from information_schema.tables where table_schema = 'public' and table_name like 'koutsi%'`);
  let total = 0;
  for (const { table_name } of rows) total += await count(db, table_name);
  return total;
}

test('today (no migration): a deleted player keeps their Koutsi rows, still on the coach list', async () => {
  const db = await fresh({ migrate: false });
  await deleteAccount(db, P1);
  const left = await leftovers(db, P1);
  assert.equal(left.account, undefined);
  assert.equal(left.profiles, undefined);
  assert.equal(left.koutsi_students, 1);
  assert.equal(left.koutsi_coach_students, 2);
  assert.equal(left.koutsi_group_members, 2);
  assert.equal(left.koutsi_moods, 1);
  assert.equal(left.koutsi_player_history, 2);
  assert.equal(left.koutsi_session_checkin_log, 1);
});

test('today (no migration): deleting a coach fails on the group slot, and without it on an upcoming session', async () => {
  const db = await fresh({ migrate: false });
  await assert.rejects(deleteAccount(db, C), /koutsi_group_slots_coach_id_fkey/);
  await db.exec(`delete from koutsi_group_slots`);
  await assert.rejects(deleteAccount(db, C), /koutsi_notifications_actor_id_fkey/);
  assert.equal(await count(db, `auth.users where id = $1`, [C]), 1);
});

test('a deleted player loses every Koutsi row; nobody else loses anything; no notifications', async () => {
  const db = await fresh();
  const before = { p2: await leftovers(db, P2), c: await leftovers(db, C), p4: await leftovers(db, P4) };
  await watchNotifications(db);
  await deleteAccount(db, P1);

  assert.deepEqual(await leftovers(db, P1), {});
  assert.equal(await count(db, 'notifications_written'), 0);

  // P2 keeps everything; C loses only P1's link, place, absence, check-in and the notifications about P1
  assert.deepEqual(await leftovers(db, P2), before.p2);
  const c = await leftovers(db, C);
  assert.equal(c.koutsi_coach_students, before.c.koutsi_coach_students - 1);
  assert.equal(c.koutsi_trainings, before.c.koutsi_trainings - 1); // P1's private lesson
  assert.equal(c.koutsi_notifications, before.c.koutsi_notifications - 2);
  assert.equal(c.koutsi_announcements, before.c.koutsi_announcements - 1); // "Vain Pialle"
  assert.equal(c.koutsi_groups, 1);
  assert.equal(c.koutsi_group_slots, 1);
  assert.deepEqual(await leftovers(db, P4), before.p4);

  const { student_ids } = await one(db, `select student_ids from koutsi_announcements where id = $1`, [A2]);
  assert.deepEqual(student_ids, [P2]);
  assert.equal(await count(db, `koutsi_group_invite_codes where code = 'RYHMA001'`), 1);
  assert.equal(await count(db, `koutsi_students where id = $1`, [P3]), 1);
});

test('a deleted coach: groups, sessions, notes and own placeholders go; players keep their own data', async () => {
  const db = await fresh();
  await watchNotifications(db);
  await deleteAccount(db, C);

  assert.deepEqual(await leftovers(db, C), {});
  assert.equal(await count(db, 'notifications_written'), 0);
  assert.deepEqual(await leftovers(db, P3), {}); // C's placeholder went with C

  // players with an account keep what is theirs
  const p2 = await leftovers(db, P2);
  assert.deepEqual(
    [p2.koutsi_students, p2.koutsi_moods, p2.koutsi_player_entries, p2.koutsi_player_history, p2.koutsi_coach_students, p2.koutsi_diary_entries],
    [1, 1, 1, 1, undefined, undefined],
  );
  const p1 = await leftovers(db, P1);
  assert.equal(p1.koutsi_coach_students, 1); // still B's player
  assert.equal(p1.koutsi_group_members, 1); // still in B's group
  assert.equal(p1.koutsi_videos, 1); // own video stays, C's videos went
  assert.equal(await count(db, `koutsi_player_history where student_id = $1 and changed_by is null`, [P2]), 1);

  // B untouched
  assert.equal(await count(db, `koutsi_trainings where id = $1`, [T_B]), 1);
  assert.equal(await count(db, `koutsi_groups where id = $1`, [GB]), 1);
});

test('own "Poista tili" still works; the trigger also takes what the old list missed', async () => {
  const db = await fresh();
  await db.exec(`select set_config('request.uid', '${P2}', false); set role authenticated;`);
  await db.query(`select public.delete_my_koutsi_data()`);
  await db.exec('reset role');
  assert.equal(await count(db, `koutsi_session_checkin_log where student_id = $1`, [P2]), 1); // missed by the old list
  await deleteAccount(db, P2);
  assert.deepEqual(await leftovers(db, P2), {});
});

test('a Krossi-only account: nothing in Koutsi changes', async () => {
  const db = await fresh();
  const before = await koutsiRowTotal(db);
  await deleteAccount(db, K);
  assert.equal(await koutsiRowTotal(db), before);
  assert.deepEqual(await leftovers(db, K), {});
});

test('one-off cleanup: player rows without an account go, placeholders stay; running it twice is fine', async () => {
  const db = await fresh({ migrate: false });
  const gone = await leftovers(db, GONE);
  assert.deepEqual(
    [gone.koutsi_students, gone.koutsi_coach_students, gone.koutsi_player_history, gone.koutsi_diary_entries],
    [1, 1, 1, 1],
  );
  const studentsBefore = await count(db, 'koutsi_students');
  await db.exec(MIGRATION);
  assert.deepEqual(await leftovers(db, GONE), {});
  assert.equal(await count(db, 'koutsi_students'), studentsBefore - 1);
  assert.equal(await count(db, `koutsi_students where id = $1 and placeholder_coach_id = $2`, [P3, C]), 1);
  assert.equal(await count(db, `koutsi_coach_students where student_id = $1`, [P3]), 1);
  await db.exec(MIGRATION);
  assert.equal(await count(db, 'koutsi_students'), studentsBefore - 1);
});

test('the app cannot call the cleanup: authenticated, anon and service_role are refused', async () => {
  const db = await fresh();
  for (const role of ['authenticated', 'anon', 'service_role']) {
    await db.exec(`select set_config('request.uid', '${P1}', false); set role ${role};`);
    try {
      await assert.rejects(db.query(`select koutsi_private.delete_account_data($1)`, [P2]), /permission denied/, role);
    } finally {
      await db.exec('reset role');
    }
  }
  assert.equal(await count(db, `koutsi_students where id = $1`, [P2]), 1);
});

test('the quiet mode lasts only for the deletion: a cancelled session later in the same transaction still notifies', async () => {
  const db = await fresh();
  await db.exec(`
    begin;
    select set_config('request.uid', '', true);
    set local role supabase_auth_admin;
    delete from auth.users where id = '${P1}';
    reset role;
    select set_config('request.uid', '${C}', true);
    delete from koutsi_trainings where id = '${T_FUT}';
    commit;
  `);
  assert.equal(await count(db, `koutsi_notifications where kind = 'training_cancelled' and recipient_id = $1`, [P2]), 1);
  assert.deepEqual(await leftovers(db, P1), {});
});

test('nothing is half-done: if the account cannot be deleted, the Koutsi rows stay too', async () => {
  const db = await fresh();
  await db.exec(`create table blocker (user_id uuid references auth.users(id)); insert into blocker values ('${P1}');`);
  await assert.rejects(deleteAccount(db, P1), /violates foreign key constraint/);
  const left = await leftovers(db, P1);
  assert.equal(left.account, 1);
  assert.equal(left.koutsi_students, 1);
  assert.equal(left.koutsi_moods, 1);
});
