// 20261111135135_koutsi_level_scales.check.mjs — runs supabase/migrations/20261111135135_koutsi_level_scales.sql (applied
// 11.11.2026 with the user's OK) in PGlite
// against a small stub of production's schema and checks who reads and writes a coach's level scale and what the
// table accepts.
// PGlite is not a dependency of the repo, so this is not part of `npm run test:koutsi`. To run it:
//   (in an empty temp folder) npm i @electric-sql/pglite@0.3
//   PGLITE=<that folder>/node_modules/@electric-sql/pglite/dist/index.js node --test koutsi/web/sql/20261111135135_koutsi_level_scales.check.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite');

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = await readFile(join(here, '../../../supabase/migrations/20261111135135_koutsi_level_scales.sql'), 'utf8');

const JUKKA = '00000000-0000-4000-8000-0000000000a1'; // coach
const ALPO = '00000000-0000-4000-8000-0000000000b1'; // another coach
const ADMIN = '00000000-0000-4000-8000-0000000000e1';
const MAIJA = '00000000-0000-4000-8000-000000000001'; // Jukka's player
const OLLI = '00000000-0000-4000-8000-000000000002'; // Alpo's player
const ENTINEN = '00000000-0000-4000-8000-000000000003'; // Jukka's former player (coaching ended)
const PEKKA = '00000000-0000-4000-8000-000000000004'; // Jukka's player, in Maija's group
const G1 = '00000000-0000-4000-8000-0000000000c1';

const STUB = `
create schema if not exists auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

create table public.koutsi_admins (user_id uuid primary key);
create table public.koutsi_coaches (id uuid primary key);
create table public.profiles (id uuid primary key, name text, avatar_url text);
create table public.koutsi_students (id uuid primary key, display_name text, level text);
create table public.koutsi_coach_students (
  coach_id uuid not null references public.koutsi_coaches(id) on delete cascade,
  student_id uuid not null references public.koutsi_students(id) on delete cascade,
  ended_at timestamptz, primary key (coach_id, student_id));
create table public.koutsi_groups (id uuid primary key, coach_id uuid not null references public.koutsi_coaches(id) on delete cascade);
create table public.koutsi_group_members (group_id uuid not null references public.koutsi_groups(id) on delete cascade,
  student_id uuid not null references public.koutsi_students(id) on delete cascade, ended_at timestamptz, primary key (group_id, student_id));

create function public.koutsi_is_admin() returns boolean language sql stable security definer set search_path to '' as $$
  select (select auth.uid()) is not null and exists (select 1 from public.koutsi_admins a where a.user_id = (select auth.uid())); $$;
create function public.koutsi_acts_as(target uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select target is not null and (target = (select auth.uid()) or public.koutsi_is_admin()); $$;
create function public.koutsi_is_my_coach(p_coach_id uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from koutsi_coach_students where coach_id = p_coach_id and student_id = auth.uid() and ended_at is null); $$;

insert into public.koutsi_admins values ('${ADMIN}');
insert into public.koutsi_coaches values ('${JUKKA}'), ('${ALPO}');
insert into public.koutsi_students values ('${MAIJA}', 'Maija', '4'), ('${OLLI}', 'Olli', 'Edistynyt'), ('${ENTINEN}', 'Entinen', '2');
insert into public.koutsi_students values ('${PEKKA}', 'Pekka', '6');
insert into public.koutsi_coach_students values ('${JUKKA}', '${PEKKA}', null);
insert into public.koutsi_groups values ('${G1}', '${JUKKA}');
insert into public.koutsi_group_members values ('${G1}', '${MAIJA}', null), ('${G1}', '${PEKKA}', null);
insert into public.koutsi_coach_students values ('${JUKKA}', '${MAIJA}', null), ('${ALPO}', '${OLLI}', null), ('${JUKKA}', '${ENTINEN}', now());
`;

async function fresh() {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(MIGRATION);
  return db;
}

/** Runs `sql` as the signed-in user `uid` (or anon), like PostgREST does. */
async function as(db, uid, sql, params = []) {
  await db.exec('reset role');
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid || ''}', false)`);
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}

test('a coach saves and changes their own scale; a coach without a row has none', async () => {
  const db = await fresh();
  await as(db, JUKKA, `insert into public.koutsi_level_scales (coach_id, kind, size, notes) values ($1, 'numerot', 6, $2)`,
    [JUKKA, ['Harrastaja', '', '', '', '', 'C-tason kilpapelaaja']]);
  await as(db, JUKKA, `update public.koutsi_level_scales set size = 7, updated_at = now() where coach_id = $1`, [JUKKA]);
  const { rows } = await as(db, JUKKA, 'select kind, size, notes from public.koutsi_level_scales');
  assert.deepEqual(rows, [{ kind: 'numerot', size: 7, notes: ['Harrastaja', '', '', '', '', 'C-tason kilpapelaaja'] }]);
  assert.equal((await as(db, ALPO, 'select * from public.koutsi_level_scales')).rows.length, 0);
});

test("a coach can't write another coach's scale", async () => {
  const db = await fresh();
  await assert.rejects(as(db, ALPO, `insert into public.koutsi_level_scales (coach_id, kind) values ($1, 'ei')`, [JUKKA]));
  await as(db, JUKKA, `insert into public.koutsi_level_scales (coach_id, kind, size) values ($1, 'numerot', 6)`, [JUKKA]);
  const res = await as(db, ALPO, `update public.koutsi_level_scales set kind = 'ei' where coach_id = $1`, [JUKKA]);
  assert.equal(res.affectedRows, 0);
  await assert.rejects(as(db, JUKKA, `delete from public.koutsi_level_scales where coach_id = $1`, [JUKKA]));
});

test("the coach's current players read it; others, former players and anon don't", async () => {
  const db = await fresh();
  await as(db, JUKKA, `insert into public.koutsi_level_scales (coach_id, kind, size) values ($1, 'numerot', 6)`, [JUKKA]);
  await as(db, ALPO, `insert into public.koutsi_level_scales (coach_id, kind) values ($1, 'sanat')`, [ALPO]);
  const maija = await as(db, MAIJA, 'select coach_id from public.koutsi_level_scales');
  assert.deepEqual(maija.rows.map((r) => r.coach_id), [JUKKA]);
  const olli = await as(db, OLLI, 'select coach_id from public.koutsi_level_scales');
  assert.deepEqual(olli.rows.map((r) => r.coach_id), [ALPO]);
  assert.equal((await as(db, ENTINEN, 'select * from public.koutsi_level_scales')).rows.length, 0);
  await assert.rejects(as(db, null, 'select * from public.koutsi_level_scales'));
  await assert.rejects(as(db, MAIJA, `update public.koutsi_level_scales set kind = 'ei' where coach_id = $1 returning coach_id`, [JUKKA])
    .then((r) => { if (r.rows.length === 0) throw new Error('nothing updated'); }));
});

test('an admin acting as a coach reads and writes it', async () => {
  const db = await fresh();
  await as(db, ADMIN, `insert into public.koutsi_level_scales (coach_id, kind, size) values ($1, 'numerot', 5)`, [ALPO]);
  assert.equal((await as(db, ADMIN, 'select * from public.koutsi_level_scales')).rows.length, 1);
});

test('the table accepts only sane scales', async () => {
  const db = await fresh();
  const bad = [
    [`insert into public.koutsi_level_scales (coach_id, kind) values ($1, 'kirjaimet')`],
    [`insert into public.koutsi_level_scales (coach_id, kind) values ($1, 'numerot')`],
    [`insert into public.koutsi_level_scales (coach_id, kind, size) values ($1, 'numerot', 11)`],
    [`insert into public.koutsi_level_scales (coach_id, kind, size) values ($1, 'numerot', 2)`],
    [`insert into public.koutsi_level_scales (coach_id, kind, size, notes) values ($1, 'numerot', 10, $2)`, Array.from({ length: 11 }, () => 'x')],
    [`insert into public.koutsi_level_scales (coach_id, kind, size, notes) values ($1, 'numerot', 3, $2)`, ['x'.repeat(701)]],
  ];
  for (const [sql, notes] of bad) {
    await assert.rejects(as(db, JUKKA, sql, notes ? [JUKKA, notes] : [JUKKA]), undefined, sql);
  }
  await as(db, JUKKA, `insert into public.koutsi_level_scales (coach_id, kind) values ($1, 'ei')`, [JUKKA]);
  const { rows } = await as(db, JUKKA, 'select kind, size, notes from public.koutsi_level_scales');
  assert.deepEqual(rows, [{ kind: 'ei', size: null, notes: [] }]);
});

test("deleting a coach takes their scale with them", async () => {
  const db = await fresh();
  await as(db, JUKKA, `insert into public.koutsi_level_scales (coach_id, kind, size) values ($1, 'numerot', 6)`, [JUKKA]);
  await db.exec(`delete from public.koutsi_coaches where id = '${JUKKA}'`);
  assert.equal((await db.query('select * from public.koutsi_level_scales')).rows.length, 0);
});

test("the group roster gives names but no levels, not even the player's own", async () => {
  const db = await fresh();
  const { rows } = await as(db, MAIJA, 'select student_id, name, level from public.koutsi_player_group_roster()');
  assert.deepEqual(rows.map((r) => [r.name, r.level]), [['Maija', null], ['Pekka', null]]);
});
