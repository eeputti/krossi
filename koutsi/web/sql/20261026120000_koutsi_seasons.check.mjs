// 20261026120000_koutsi_seasons.check.mjs — runs the koutsi_seasons migration (applied 2026-10-25 as
// supabase/migrations/20261025181126_koutsi_seasons.sql) in PGlite against a small
// copy of production's Koutsi schema (tables, RLS, the functions it calls; copied 2026-10-23), then
// checks the backfill, the trigger, the gate, publish, row security and the invite redeem.
// PGlite is not a dependency of the repo, so it is not part of `npm run test:koutsi`. Before
// "aja migraatio":
//   (in an empty temp folder) npm i @electric-sql/pglite@0.3
//   PGLITE=<that folder>/node_modules/@electric-sql/pglite/dist/index.js node --test koutsi/web/sql/20261026120000_koutsi_seasons.check.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite');

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = await readFile(join(here, '../../../supabase/migrations/20261025181126_koutsi_seasons.sql'), 'utf8');
const { seasonDates, nextSeasonPreset } = await import(join(here, '../src/domain/season.js'));

const COACH = '00000000-0000-4000-8000-0000000000a1';
const COACH_B = '00000000-0000-4000-8000-0000000000b1';
const P1 = '00000000-0000-4000-8000-000000000001';
const P2 = '00000000-0000-4000-8000-000000000002';
const P3 = '00000000-0000-4000-8000-000000000003'; // placeholder, no account
const P4 = '00000000-0000-4000-8000-000000000004'; // joins later with a group link
const G1 = '00000000-0000-4000-8000-0000000000c1';
const G2 = '00000000-0000-4000-8000-0000000000c2';
const GB = '00000000-0000-4000-8000-0000000000c9';

const BASE = `
create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true), '')::uuid $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to authenticated;

create table profiles (id uuid primary key, name text);
create table koutsi_admins (user_id uuid primary key);
create table koutsi_beta_testers (email text primary key, note text, created_at timestamptz not null default now());
create table koutsi_coaches (id uuid primary key, archived_at timestamptz, created_at timestamptz not null default now());
create table koutsi_students (id uuid primary key, display_name text, placeholder_coach_id uuid, age integer, level text);
create table koutsi_coach_students (coach_id uuid not null, student_id uuid not null, ended_at timestamptz, invite_code_used text, created_at timestamptz not null default now(), primary key (coach_id, student_id));
create table koutsi_groups (id uuid primary key default gen_random_uuid(), coach_id uuid not null references koutsi_coaches(id) on delete cascade, name text not null, level text,
  weekday text check (weekday = any (array['Ma','Ti','Ke','To','Pe','La','Su'])), time time, created_at timestamptz not null default now(), duration_minutes integer not null default 60
  check (duration_minutes > 0 and duration_minutes <= 480 and duration_minutes % 15 = 0));
create table koutsi_group_members (group_id uuid not null references koutsi_groups(id) on delete cascade, student_id uuid not null, ended_at timestamptz, created_at timestamptz not null default now(), primary key (group_id, student_id));
create table koutsi_group_slots (id uuid primary key default gen_random_uuid(), group_id uuid not null, coach_id uuid not null, weekday text not null, time time not null, duration_minutes integer not null default 60, series_id uuid);
create table koutsi_trainings (id uuid primary key default gen_random_uuid(), coach_id uuid not null, group_id uuid references koutsi_groups(id) on delete cascade, student_id uuid, date date not null, time time not null,
  type text not null, created_at timestamptz not null default now(), series_id uuid, duration_minutes integer, logged_by text not null default 'coach', notes text, end_date date);
create table koutsi_notifications (id uuid primary key default gen_random_uuid(), recipient_id uuid not null, actor_id uuid, kind text not null, title text not null, body text, link_path text, created_at timestamptz not null default now());
create table koutsi_group_invite_codes (code text primary key, group_id uuid, coach_id uuid not null, expires_at timestamptz, max_uses integer, use_count integer not null default 0, revoked_at timestamptz, created_at timestamptz not null default now(), label text, student_id uuid);
create table koutsi_coach_join_codes (code text primary key, coach_id uuid not null);

create function public.koutsi_is_admin() returns boolean language sql stable security definer set search_path to '' as $$
  select (select auth.uid()) is not null and exists (select 1 from public.koutsi_admins a where a.user_id = (select auth.uid())); $$;
create function public.koutsi_acts_as(target uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select target is not null and (target = (select auth.uid()) or public.koutsi_is_admin()); $$;
create function public.koutsi_is_group_member(p_group_id uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from koutsi_group_members where group_id = p_group_id and student_id = auth.uid() and ended_at is null); $$;
create function public.koutsi_notify(p_recipient uuid, p_actor uuid, p_kind text, p_title text, p_body text, p_link text) returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if p_recipient is null or p_recipient = p_actor then return; end if;
  if not exists (select 1 from auth.users u where u.id = p_recipient) then return; end if;
  insert into koutsi_notifications (recipient_id, actor_id, kind, title, body, link_path) values (p_recipient, p_actor, p_kind, p_title, left(coalesce(p_body, ''), 500), p_link);
end; $$;
create function public.koutsi_create_player(name_input text, age_input integer default null, level_input text default null, coach_id_input uuid default null) returns uuid language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := auth.uid(); v_coach uuid := coalesce(coach_id_input, auth.uid()); v_id uuid; v_name text := btrim(coalesce(name_input, ''));
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if v_coach <> v_uid and not public.koutsi_is_admin() then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.koutsi_coaches c where c.id = v_coach and c.archived_at is null) then raise exception 'not a coach'; end if;
  if v_name = '' then raise exception 'Anna pelaajalle nimi'; end if;
  if exists (select 1 from public.koutsi_coach_students cs join public.koutsi_students s on s.id = cs.student_id where cs.coach_id = v_coach and cs.ended_at is null and lower(s.display_name) = lower(v_name))
    then raise exception 'Sinulla on jo tismalleen tämän niminen oppilas'; end if;
  v_id := gen_random_uuid();
  insert into public.koutsi_students (id, display_name, placeholder_coach_id, age, level) values (v_id, v_name, v_coach, age_input, level_input);
  insert into public.koutsi_coach_students (coach_id, student_id) values (v_coach, v_id);
  return v_id;
end; $$;
create function public.koutsi_training_audience(p_training koutsi_trainings) returns setof uuid language sql stable security definer set search_path to 'public' as $$
  select p_training.student_id where p_training.student_id is not null
  union select gm.student_id from koutsi_group_members gm where p_training.group_id is not null and gm.group_id = p_training.group_id and gm.ended_at is null; $$;
create function public.koutsi_on_training_insert() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_student uuid;
begin
  if coalesce(current_setting('koutsi.bulk_trainings', true), '') = 'on' then return new; end if;
  if new.logged_by = 'player' then return new; end if;
  for v_student in select * from koutsi_training_audience(new) loop
    perform koutsi_notify(v_student, new.coach_id, 'training_added', 'Uusi treeni kalenterissasi', to_char(new.date, 'DD.MM.YYYY'), '/pelaaja');
  end loop;
  return new;
end; $$;
create trigger koutsi_training_notify after insert on koutsi_trainings for each row execute function koutsi_on_training_insert();
-- the production redeem before this migration (group code joins the code's own group)
create function public.redeem_koutsi_invite_code(code_input text) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_code koutsi_group_invite_codes%rowtype;
begin
  select * into v_code from koutsi_group_invite_codes where code = upper(code_input);
  insert into koutsi_group_members (group_id, student_id) values (v_code.group_id, auth.uid()) on conflict do nothing;
  return jsonb_build_object('group_id', v_code.group_id);
end; $$;

alter table koutsi_groups enable row level security;
alter table koutsi_group_members enable row level security;
alter table koutsi_trainings enable row level security;
create policy koutsi_groups_select on koutsi_groups for select using (koutsi_acts_as(coach_id) or koutsi_is_group_member(id));
create policy koutsi_groups_insert on koutsi_groups for insert with check (koutsi_acts_as(coach_id));
create policy koutsi_group_members_select on koutsi_group_members for select using (exists (select 1 from koutsi_groups g where g.id = group_id and koutsi_acts_as(g.coach_id)) or student_id = auth.uid());
create policy koutsi_trainings_select on koutsi_trainings for select using (koutsi_acts_as(coach_id) or (group_id is not null and koutsi_is_group_member(group_id)));
grant select, insert, update, delete on all tables in schema public to authenticated;
`;

async function fresh() {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(`
    insert into auth.users (id, email) values ('${COACH}', 'alpo@example.test'), ('${COACH_B}', 'b@example.test'), ('${P1}', 'p1@example.test'), ('${P2}', 'eelispuro+pelaaja@gmail.com'), ('${P4}', 'p4@example.test');
    insert into profiles (id, name) values ('${COACH}', 'Alpo'), ('${COACH_B}', 'Bea'), ('${P1}', 'Pia'), ('${P2}', 'Pekka'), ('${P4}', 'Paavo');
    insert into koutsi_beta_testers (email) values ('eelispuro+pelaaja@gmail.com'), ('alpo@example.test');
    insert into koutsi_coaches (id) values ('${COACH}'), ('${COACH_B}');
    insert into koutsi_students (id, display_name) values ('${P1}', 'Pia'), ('${P2}', 'Pekka'), ('${P4}', 'Paavo');
    insert into koutsi_students (id, display_name, placeholder_coach_id) values ('${P3}', 'Pirjo', '${COACH}');
    insert into koutsi_coach_students (coach_id, student_id) values ('${COACH}', '${P1}'), ('${COACH}', '${P2}'), ('${COACH}', '${P3}');
    insert into koutsi_groups (id, coach_id, name, weekday, time, duration_minutes) values
      ('${G1}', '${COACH}', 'Juniorit oranssi', 'Ma', '16:00', 60), ('${G2}', '${COACH}', 'Juniorit kilpa', 'Ke', '17:30', 90),
      ('${GB}', '${COACH_B}', 'Aikuiset', 'Ti', '18:00', 60);
    insert into koutsi_group_members (group_id, student_id) values ('${G1}', '${P1}'), ('${G1}', '${P2}'), ('${G2}', '${P2}'), ('${G2}', '${P3}');
    set koutsi.bulk_trainings = 'on';
    insert into koutsi_trainings (coach_id, group_id, date, time, type) select '${COACH}', '${G1}', d::date, '16:00', 'Ryhmätreeni' from generate_series('2026-09-14'::date, '2026-11-30'::date, interval '7 day') d;
    insert into koutsi_trainings (coach_id, group_id, date, time, type) select '${COACH}', '${G2}', d::date, '17:30', 'Ryhmätreeni' from generate_series('2026-09-09'::date, '2026-12-02'::date, interval '7 day') d;
    insert into koutsi_trainings (coach_id, group_id, date, time, type) select '${COACH_B}', '${GB}', d::date, '18:00', 'Ryhmätreeni' from generate_series('2026-09-01'::date, '2027-01-05'::date, interval '7 day') d;
    reset koutsi.bulk_trainings;
    insert into koutsi_group_invite_codes (code, group_id, coach_id) values ('ORANSSI1', '${G1}', '${COACH}');
  `);
  await db.exec(MIGRATION);
  return db;
}
const as = async (db, uid, sql, params) => {
  await db.exec(`select set_config('request.uid', '${uid || ''}', false)`);
  return db.query(sql, params);
};
const asRole = async (db, uid, sql) => {
  await db.exec(`select set_config('request.uid', '${uid}', false); set role authenticated;`);
  try { return await db.query(sql); } finally { await db.exec('reset role'); }
};

const spring = (() => {
  const p = nextSeasonPreset({ endsOn: '2026-12-02' });
  return {
    ...p,
    fromSeasonId: null,
    groups: [
      { key: 'k-g1', fromId: G1, name: 'Juniorit oranssi', level: '', day: 'Ma', time: '16:00', durationMinutes: 60, status: 'jatkuu' },
      { key: 'k-g2', fromId: G2, name: 'Juniorit kilpa', level: 'Kilpa', day: 'To', time: '17:30', durationMinutes: 90, status: 'muuttuu' },
      { key: 'uusi-g-1', fromId: null, name: 'Juniorit keltainen', level: '', day: 'La', time: '10:00', durationMinutes: 60, status: 'uusi' },
      { key: 'k-gb', fromId: GB, name: 'Vieras', level: '', day: 'Pe', time: '10:00', durationMinutes: 60, status: 'loppuu' },
    ],
    members: { 'k-g1': [P1, 'uusi-p-1'], 'k-g2': [P2], 'uusi-g-1': [P3, P2, '00000000-0000-4000-8000-0000000000ff'], 'k-gb': [P1] },
    newPlayers: [{ key: 'uusi-p-1', name: 'Ville S.' }, { key: 'uusi-p-2', name: 'Ei ryhmää' }],
  };
})();

test('backfill: one season per coach from the session dates; groups join it', async () => {
  const db = await fresh();
  const { rows } = await db.query(`select coach_id, name, starts_on::text, ends_on::text from koutsi_seasons order by name, coach_id`);
  assert.equal(rows.length, 2);
  const alpo = rows.find((r) => r.coach_id === COACH);
  assert.deepEqual([alpo.name, alpo.starts_on, alpo.ends_on], ['Syksy 2026', '2026-09-09', '2026-12-02']);
  const { rows: g } = await db.query(`select count(*)::int n from koutsi_groups where season_id is null`);
  assert.equal(g[0].n, 0);
});

test('a new group joins the current season by itself', async () => {
  const db = await fresh();
  const { rows } = await as(db, COACH, `insert into koutsi_groups (coach_id, name, weekday, time) values ($1, 'Uusi', 'Pe', '17:00') returning season_id`, [COACH]);
  const { rows: s } = await db.query(`select id from koutsi_seasons where coach_id = $1`, [COACH]);
  assert.equal(rows[0].season_id, s[0].id);
});

test('the gate: beta testers and admins only', async () => {
  const db = await fresh();
  assert.equal((await as(db, P2, `select public.koutsi_seasons_enabled() ok`)).rows[0].ok, true);
  assert.equal((await as(db, COACH, `select public.koutsi_seasons_enabled() ok`)).rows[0].ok, true);
  assert.equal((await as(db, COACH_B, `select public.koutsi_seasons_enabled() ok`)).rows[0].ok, false);
  await db.exec(`insert into koutsi_admins values ('${COACH_B}')`);
  assert.equal((await as(db, COACH_B, `select public.koutsi_seasons_enabled() ok`)).rows[0].ok, true);
  assert.equal((await as(db, null, `select public.koutsi_seasons_enabled() ok`)).rows[0].ok, false);
});

test('publish: season, groups, members, players and sessions at once; one notification each', async () => {
  const db = await fresh();
  await as(db, COACH, `insert into koutsi_season_drafts (coach_id, draft) values ($1, '{}'::jsonb)`, [COACH]);
  const before = (await db.query(`select count(*)::int n from koutsi_trainings where group_id in ($1, $2)`, [G1, G2])).rows[0].n;
  const res = (await as(db, COACH, `select public.koutsi_publish_season($1::jsonb) r`, [JSON.stringify(spring)])).rows[0].r;
  assert.equal(res.groups, 3);
  const { rows: groups } = await db.query(`select id, name, weekday, continues_from, level from koutsi_groups where season_id = $1 order by name`, [res.seasonId]);
  assert.deepEqual(groups.map((g) => [g.name, g.weekday]), [['Juniorit keltainen', 'La'], ['Juniorit kilpa', 'To'], ['Juniorit oranssi', 'Ma']]);
  assert.equal(groups.find((g) => g.name === 'Juniorit oranssi').continues_from, G1);
  assert.equal(groups.find((g) => g.name === 'Juniorit keltainen').continues_from, null);
  // sessions: same dates as the app computes, breaks left out
  const expected = spring.groups.filter((g) => g.status !== 'loppuu').reduce((n, g) => n + seasonDates(g, spring).length, 0);
  assert.equal(res.sessions, expected);
  const ma = (await db.query(`select date::text d from koutsi_trainings t join koutsi_groups g on g.id = t.group_id where g.season_id = $1 and g.weekday = 'Ma' order by date`, [res.seasonId])).rows.map((r) => r.d);
  assert.deepEqual(ma, seasonDates({ day: 'Ma' }, spring));
  assert.ok(!ma.includes('2027-03-01') && !ma.includes('2027-03-29'));
  // members: own players only; the stranger id is dropped; Ville became a placeholder
  const members = (await db.query(`select g.name, s.display_name from koutsi_group_members m join koutsi_groups g on g.id = m.group_id join koutsi_students s on s.id = m.student_id where g.season_id = $1 order by 1, 2`, [res.seasonId])).rows;
  assert.deepEqual(members.map((m) => `${m.name}: ${m.display_name}`), [
    'Juniorit keltainen: Pekka', 'Juniorit keltainen: Pirjo', 'Juniorit kilpa: Pekka', 'Juniorit oranssi: Pia', 'Juniorit oranssi: Ville S.',
  ]);
  const ville = (await db.query(`select s.placeholder_coach_id from koutsi_students s where display_name = 'Ville S.'`)).rows;
  assert.equal(ville.length, 1);
  assert.equal(ville[0].placeholder_coach_id, COACH);
  assert.equal((await db.query(`select count(*)::int n from koutsi_students where display_name = 'Ei ryhmää'`)).rows[0].n, 0, 'unplaced new names are not created');
  // notifications: one per player with an account, none per session
  const notes = (await db.query(`select recipient_id, title, body from koutsi_notifications order by recipient_id`)).rows;
  assert.deepEqual(notes.map((n) => n.recipient_id), [P1, P2]);
  assert.equal(notes[0].title, 'Kevät 2027: ryhmäsi ovat valmiina');
  assert.equal(notes[1].body, 'Kevät 2027 alkaa 11.1.2027: To klo 17.30 Juniorit kilpa, La klo 10.00 Juniorit keltainen');
  // the old season is untouched; the draft is gone
  assert.equal((await db.query(`select count(*)::int n from koutsi_trainings where group_id in ($1, $2)`, [G1, G2])).rows[0].n, before);
  assert.equal((await db.query(`select count(*)::int n from koutsi_group_members where group_id in ($1, $2) and ended_at is null`, [G1, G2])).rows[0].n, 4);
  assert.equal((await db.query(`select count(*)::int n from koutsi_season_drafts`)).rows[0].n, 0);
});

test('publish refuses other coaches, bad dates and an empty season — and writes nothing', async () => {
  const db = await fresh();
  await assert.rejects(as(db, COACH_B, `select public.koutsi_publish_season($1::jsonb, $2)`, [JSON.stringify(spring), COACH]), /not allowed/);
  await assert.rejects(as(db, COACH, `select public.koutsi_publish_season($1::jsonb)`, [JSON.stringify({ ...spring, endsOn: '2026-12-01' })]), /päivät/);
  await assert.rejects(as(db, COACH, `select public.koutsi_publish_season($1::jsonb)`, [JSON.stringify({ ...spring, groups: spring.groups.map((g) => ({ ...g, status: 'loppuu' })) })]), /yhtään ryhmää/);
  await assert.rejects(as(db, null, `select public.koutsi_publish_season($1::jsonb)`, [JSON.stringify(spring)]), /authentication/);
  assert.equal((await db.query(`select count(*)::int n from koutsi_seasons`)).rows[0].n, 2);
  assert.equal((await db.query(`select count(*)::int n from koutsi_students where display_name = 'Ville S.'`)).rows[0].n, 0);
  // a fromId of another coach's group is not linked
  const res = (await as(db, COACH_B, `select public.koutsi_publish_season($1::jsonb) r`, [JSON.stringify({
    ...spring, groups: [{ key: 'x', fromId: G1, name: 'Kaappaus', level: '', day: 'Ma', time: '09:00', durationMinutes: 60, status: 'jatkuu' }], members: { x: [P1] }, newPlayers: [],
  })])).rows[0].r;
  const row = (await db.query(`select continues_from from koutsi_groups where season_id = $1`, [res.seasonId])).rows[0];
  assert.equal(row.continues_from, null);
  assert.equal((await db.query(`select count(*)::int n from koutsi_group_members m join koutsi_groups g on g.id = m.group_id where g.season_id = $1`, [res.seasonId])).rows[0].n, 0, 'not B\'s player');
});

test('row security: players read their seasons, never drafts or other coaches\' seasons', async () => {
  const db = await fresh();
  await as(db, COACH, `insert into koutsi_season_drafts (coach_id, draft) values ($1, '{"name":"Kevät 2027"}'::jsonb)`, [COACH]);
  await as(db, COACH, `select public.koutsi_publish_season($1::jsonb)`, [JSON.stringify(spring)]);
  const p1 = (await asRole(db, P1, `select name from koutsi_seasons order by starts_on`)).rows.map((r) => r.name);
  assert.deepEqual(p1, ['Syksy 2026', 'Kevät 2027']);
  // P1 still sees the autumn sessions (memberships were not ended)
  assert.ok((await asRole(db, P1, `select count(*)::int n from koutsi_trainings where group_id = '${G1}'`)).rows[0].n > 5);
  const b = (await asRole(db, COACH_B, `select coach_id from koutsi_seasons`)).rows;
  assert.ok(b.every((r) => r.coach_id === COACH_B));
  await as(db, COACH, `insert into koutsi_season_drafts (coach_id, draft) values ($1, '{"name":"x"}'::jsonb)`, [COACH]);
  assert.equal((await asRole(db, P1, `select count(*)::int n from koutsi_season_drafts`)).rows[0].n, 0);
  assert.equal((await asRole(db, COACH_B, `select count(*)::int n from koutsi_season_drafts`)).rows[0].n, 0);
  assert.equal((await asRole(db, COACH, `select count(*)::int n from koutsi_season_drafts`)).rows[0].n, 1);
  await assert.rejects(asRole(db, COACH_B, `insert into koutsi_season_drafts (coach_id, draft) values ('${COACH}', '{}'::jsonb)`), /row-level security/);
  await assert.rejects(asRole(db, P1, `update koutsi_seasons set name = 'x' where coach_id = '${COACH}' returning id`).then((r) => { if (!r.rows.length) throw new Error('row-level security: no rows'); }), /row-level security/);
});

test('a group link from the autumn joins the spring group that continues it', async () => {
  const db = await fresh();
  const res = (await as(db, COACH, `select public.koutsi_publish_season($1::jsonb) r`, [JSON.stringify(spring)])).rows[0].r;
  const springG1 = (await db.query(`select id from koutsi_groups where season_id = $1 and continues_from = $2`, [res.seasonId, G1])).rows[0].id;
  const r = (await as(db, P4, `select public.redeem_koutsi_invite_code('oranssi1') r`)).rows[0].r;
  assert.equal(r.group_id, springG1);
  assert.equal((await db.query(`select count(*)::int n from koutsi_group_members where student_id = $1 and group_id = $2`, [P4, springG1])).rows[0].n, 1);
  assert.equal((await db.query(`select count(*)::int n from koutsi_group_members where student_id = $1 and group_id = $2`, [P4, G1])).rows[0].n, 0);
  // an ended group with no continuation keeps its own id
  assert.equal((await db.query(`select public.koutsi_latest_group($1) g`, [G2])).rows[0].g, (await db.query(`select id from koutsi_groups where continues_from = $1`, [G2])).rows[0].id);
  assert.equal((await db.query(`select public.koutsi_latest_group($1) g`, [GB])).rows[0].g, GB);
});

test('the migration can run twice without breaking', async () => {
  const db = await fresh();
  await db.exec(MIGRATION);
  assert.equal((await db.query(`select count(*)::int n from koutsi_seasons`)).rows[0].n, 2);
});
