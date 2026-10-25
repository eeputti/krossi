// 20261025200000_koutsi_player_tennis_profile.check.mjs — runs the player tennis profile migration in
// PGlite on a minimal koutsi_students (the columns, RLS and the ownership trigger as in production
// 2026-10-25) and checks: the player can write the four columns, a linked coach cannot (the trigger
// keeps the old values), the coach can still set the level, and the checks refuse bad values.
// PGlite is not a dependency of the repo, so it is not part of `npm run test:koutsi`:
//   (in an empty temp folder) npm i @electric-sql/pglite@0.3
//   PGLITE=<that folder>/node_modules/@electric-sql/pglite/dist/index.js node --test koutsi/web/sql/20261025200000_koutsi_player_tennis_profile.check.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite');

const here = dirname(fileURLToPath(import.meta.url));
// The file lives in sql/ until it is applied, then in supabase/migrations/<version>_….
const applied = (await readdir(join(here, '../../../supabase/migrations'))).find((f) => f.endsWith('_koutsi_player_tennis_profile.sql'));
const MIGRATION = await readFile(applied ? join(here, '../../../supabase/migrations', applied) : join(here, '20261025200000_koutsi_player_tennis_profile.sql'), 'utf8');

const COACH = '00000000-0000-4000-8000-0000000000a1';
const P1 = '00000000-0000-4000-8000-000000000001';

const BASE = `
create schema if not exists auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true), '')::uuid $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to authenticated;
create table koutsi_coach_students (coach_id uuid not null, student_id uuid not null, ended_at timestamptz, primary key (coach_id, student_id));
create table koutsi_students (id uuid primary key, goal text, player_note text, player_wish text, background text, last_session_note text,
  focus text, level text, age integer, display_name text, placeholder_coach_id uuid, pilot_age_group text,
  minor_notice_confirmed_at timestamptz, minor_notice_confirmed_by uuid, guardian_approval_confirmed_at timestamptz,
  guardian_approval_confirmed_by uuid, welcome_seen_at timestamptz, long_goal text, ambition text);
create function public.koutsi_is_linked_coach(p_student uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from koutsi_coach_students where coach_id = auth.uid() and student_id = p_student and ended_at is null); $$;
create function public.koutsi_enforce_student_column_ownership() returns trigger language plpgsql set search_path to 'public' as $f$
begin
  if coalesce(current_setting('app.koutsi_claiming', true), '') = 'on' then return new; end if;
  if auth.uid() = old.id then
    new.background := old.background; new.last_session_note := old.last_session_note; new.focus := old.focus; new.level := old.level;
  else
    new.goal := old.goal; new.player_note := old.player_note; new.player_wish := old.player_wish; new.long_goal := old.long_goal; new.ambition := old.ambition;
  end if;
  return new;
end; $f$;
create trigger koutsi_student_column_ownership before update on koutsi_students for each row execute function koutsi_enforce_student_column_ownership();
alter table koutsi_students enable row level security;
create policy koutsi_students_select on koutsi_students for select to authenticated using ((id = auth.uid()) or koutsi_is_linked_coach(id));
create policy koutsi_students_update on koutsi_students for update to authenticated using ((id = auth.uid()) or koutsi_is_linked_coach(id)) with check ((id = auth.uid()) or koutsi_is_linked_coach(id));
grant select, update on koutsi_students to authenticated;
insert into koutsi_coach_students values ('${COACH}', '${P1}', null);
insert into koutsi_students (id, level) values ('${P1}', 'Keskitaso');
`;

async function setup() {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(MIGRATION);
  return db;
}
async function as(db, uid, sql) {
  await db.exec(`set role authenticated; select set_config('request.uid', '${uid}', false);`);
  try { return await db.query(sql); } finally { await db.exec('reset role;'); }
}
const row = async (db) => (await db.query(`select * from koutsi_students where id = '${P1}'`)).rows[0];

test('the player writes their tennis profile', async () => {
  const db = await setup();
  await as(db, P1, `update koutsi_students set plays_hand = 'vasen', favourite_shot = 'rysty', playing_since = 2012,
    tennis_story = 'Pelasin junnuna, kymmenen vuoden tauko, palasin 2023.' where id = '${P1}'`);
  const r = await row(db);
  assert.equal(r.plays_hand, 'vasen');
  assert.equal(r.favourite_shot, 'rysty');
  assert.equal(r.playing_since, 2012);
  assert.match(r.tennis_story, /tauko/);
});

test('a linked coach cannot change it, but still sets the level', async () => {
  const db = await setup();
  await as(db, P1, `update koutsi_students set plays_hand = 'oikea', tennis_story = 'oma' where id = '${P1}'`);
  await as(db, COACH, `update koutsi_students set plays_hand = 'vasen', favourite_shot = 'smash', playing_since = 2000,
    tennis_story = 'valmentajan', level = 'Edistynyt' where id = '${P1}'`);
  const r = await row(db);
  assert.equal(r.plays_hand, 'oikea');
  assert.equal(r.favourite_shot, null);
  assert.equal(r.playing_since, null);
  assert.equal(r.tennis_story, 'oma');
  assert.equal(r.level, 'Edistynyt');
});

test('the checks refuse values the app never sends', async () => {
  const db = await setup();
  for (const bad of [`plays_hand = 'molemmat'`, `favourite_shot = 'tweener'`, `playing_since = 1800`, `tennis_story = repeat('a', 301)`]) {
    await assert.rejects(as(db, P1, `update koutsi_students set ${bad} where id = '${P1}'`), /violates check constraint/, bad);
  }
  await as(db, P1, `update koutsi_students set tennis_story = repeat('a', 300), plays_hand = null where id = '${P1}'`);
  assert.equal((await row(db)).tennis_story.length, 300);
});

test('running it twice is harmless', async () => {
  const db = await setup();
  await db.exec(MIGRATION);
  const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'koutsi_students'
    and column_name in ('plays_hand', 'favourite_shot', 'playing_since', 'tennis_story')`)).rows;
  assert.equal(cols.length, 4);
});
