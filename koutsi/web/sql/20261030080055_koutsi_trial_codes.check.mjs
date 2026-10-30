// 20261030080055_koutsi_trial_codes.check.mjs — runs the proposed kokeilukoodit migration
// (supabase/migrations/20261030080055_koutsi_trial_codes.sql, NOT applied) in PGlite on top of the applied
// coach-plan migration (supabase/migrations/20261029193756_koutsi_coach_plans.sql) and a small stub of
// production (coach key function copied from 20260911211833, Laskutus' gate from 20261029162350).
// Checks who makes codes, what a code gives a new person, a coach on the trial, an ended trial, a free
// coach and a subscriber, the limits (uses, last day, revoked, once per coach) and the old coach key
// through the same input.
// PGlite is not a dependency of the repo, so this is not part of `npm run test:koutsi`. To run it:
//   (in an empty temp folder) npm i @electric-sql/pglite@0.3
//   PGLITE=<that folder>/node_modules/@electric-sql/pglite/dist/index.js node --test koutsi/web/sql/20261030080055_koutsi_trial_codes.check.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite');

const here = dirname(fileURLToPath(import.meta.url));
const PLANS = await readFile(join(here, '../../../supabase/migrations/20261029193756_koutsi_coach_plans.sql'), 'utf8');
const MIGRATION = await readFile(join(here, '../../../supabase/migrations/20261030080055_koutsi_trial_codes.sql'), 'utf8');
const PLUS = await readFile(join(here, '../../../supabase/migrations/20261030082914_koutsi_trial_codes_plus.sql'), 'utf8');

const ADMIN = '00000000-0000-4000-8000-0000000000e1';
const ALPO = '00000000-0000-4000-8000-0000000000a1'; // free (contract) coach
const NEW1 = '00000000-0000-4000-8000-0000000000c1'; // new, gets a 12-month code
const NEW2 = '00000000-0000-4000-8000-0000000000c2'; // new, the same single-use code is gone
const TRIAL = '00000000-0000-4000-8000-0000000000c3'; // a coach on the default trial
const ENDED = '00000000-0000-4000-8000-0000000000c4'; // trial ran out
const PAYING = '00000000-0000-4000-8000-0000000000c5'; // has a subscription
const FREEBIE = '00000000-0000-4000-8000-0000000000c6'; // new, gets a free-use code
const KEYED = '00000000-0000-4000-8000-0000000000c7'; // new, types an old coach key
const NOMAIL = '00000000-0000-4000-8000-0000000000c8'; // e-mail not confirmed

const STUB = `
create schema if not exists auth;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
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
declare v_uid uuid := coalesce(target_coach, auth.uid()); v_count integer;
begin
  if not exists (select 1 from koutsi_coaches where id = v_uid) then raise exception 'not a coach'; end if;
  insert into koutsi_exercises (coach_id, name) select v_uid, 'Rytmiharjoitus'
   where not exists (select 1 from koutsi_exercises e where e.coach_id = v_uid);
  get diagnostics v_count = row_count;
  return v_count;
end; $$;
create function public.koutsi_billing_coach_enabled(p_coach uuid) returns boolean language sql stable as $$ select false $$;

-- Production's coach key, unchanged (20260911211833).
create function public.redeem_koutsi_coach_key(key_input text) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid  uuid := auth.uid();
  v_code koutsi_coach_invite_codes%rowtype;
  v_seeded integer := 0;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not exists (select 1 from profiles where id = v_uid) then
    raise exception 'Luo ensin profiilisi ennen valmentaja-avaimen käyttöä';
  end if;
  if key_input is null or btrim(key_input) = '' then raise exception 'invalid coach key'; end if;
  if exists (select 1 from koutsi_coaches where id = v_uid) then
    return jsonb_build_object('ok', true, 'already_coach', true, 'seeded_exercises', 0);
  end if;
  select * into v_code from koutsi_coach_invite_codes where code = upper(btrim(key_input)) for update;
  if not found then raise exception 'invalid coach key'; end if;
  if v_code.revoked_at is not null then raise exception 'coach key has been revoked'; end if;
  if v_code.expires_at is not null and v_code.expires_at < now() then raise exception 'coach key has expired'; end if;
  if v_code.use_count >= v_code.max_uses then raise exception 'coach key has already been used'; end if;
  insert into koutsi_coaches (id) values (v_uid) on conflict (id) do nothing;
  update koutsi_coach_invite_codes set use_count = use_count + 1, redeemed_by = v_uid, redeemed_at = now() where code = v_code.code;
  v_seeded := koutsi_seed_exercises(v_uid);
  return jsonb_build_object('ok', true, 'already_coach', false, 'seeded_exercises', v_seeded);
end;
$function$;
`;

const people = [ADMIN, ALPO, NEW1, NEW2, TRIAL, ENDED, PAYING, FREEBIE, KEYED, NOMAIL];
const SEED = `
insert into auth.users (id, email, email_confirmed_at) values
  ${people.map((u) => `('${u}', '${u.slice(-3)}@example.test', ${u === NOMAIL ? 'null' : 'now()'})`).join(',\n  ')};
insert into profiles (id, name) values ${people.map((u) => `('${u}', 'Henkilö ${u.slice(-3)}')`).join(', ')};
insert into koutsi_admins (user_id) values ('${ADMIN}');
insert into koutsi_coaches (id) values ('${ADMIN}'), ('${ALPO}');
insert into koutsi_coach_invite_codes (code) values ('AVAIN1');
insert into koutsi_coach_invite_codes (code, max_uses, use_count) values ('VANHA3', 25, 3);
`;

const db = new PGlite();
await db.exec(STUB);
await db.exec(SEED);
await db.exec(PLANS);
await db.exec(MIGRATION);
await db.exec(MIGRATION); // must be re-runnable
// a key made before the "+" counted, already used once
await db.exec(`insert into koutsi_trial_codes (code, shown, months, max_uses, use_count) values ('LEGACY6', 'Legacy6+', 6, 5, 1);
  insert into koutsi_trial_code_uses (code, coach_id) values ('LEGACY6', '${ALPO}');
  update koutsi_coach_plans set trial_code = 'LEGACY6' where coach_id = '${ALPO}';`);
await db.exec(PLUS);
await db.exec(PLUS); // must be re-runnable

async function as(uid, sql) {
  await db.exec('begin');
  try {
    await db.exec(uid
      ? `set local role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);`
      : `set local role anon; select set_config('request.jwt.claim.sub', '', true);`);
    const res = await db.query(sql);
    await db.exec('commit');
    return { rows: res.rows, error: null };
  } catch (error) {
    await db.exec('rollback');
    return { rows: [], error };
  }
}
const one = async (sql) => (await db.query(sql)).rows[0];
const plan = async (uid) => (await one(`select public.koutsi_coach_plan('${uid}') as p`)).p;
const daysLeft = async (uid) => Math.round(Number((await one(`select extract(epoch from (trial_ends_at - now())) / 86400 as d from koutsi_coach_plans where coach_id = '${uid}'`)).d));
const make = async (months, uses = 1, extra = {}) => (await as(ADMIN, `select public.koutsi_admin_create_trial_code(${months ?? 'null'}, ${uses},
  ${extra.expires ? `'${extra.expires}'` : 'null'}, ${extra.note ? `'${extra.note}'` : 'null'}, ${extra.code ? `'${extra.code}'` : 'null'}) as c`)).rows[0]?.c;
const use = (uid, code) => as(uid, `select public.koutsi_use_code('${code}', '2026-10-29') as s`);
const norm = (shown) => shown.toUpperCase().replace(/[^A-Z0-9+]/g, ''); // the stored key
async function newPerson(n) {
  const id = `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
  await db.exec(`insert into auth.users (id, email, email_confirmed_at) values ('${id}', 'p${n}@example.test', now());
    insert into profiles (id, name) values ('${id}', 'Henkilö ${n}');`);
  return id;
}

test('only admins make, list and revoke codes; nobody reads the tables directly', async () => {
  const code = await make(12, 1, { note: 'Mikkelin valmentaja' });
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/, 'no name: random');
  assert.equal(await make(6, 3, { code: 'Kesa-26' }), 'Kesa-26', 'an own key is kept as written');
  for (const sql of [`select public.koutsi_admin_create_trial_code(12, 1, null, null)`, 'select * from public.koutsi_admin_trial_codes()',
    `select public.koutsi_admin_revoke_trial_code('KESA26')`]) {
    assert.match(String((await as(ALPO, sql)).error?.message), /not allowed/, sql);
  }
  for (const who of [null, ALPO, NEW1]) {
    assert.match(String((await as(who, 'select * from koutsi_trial_codes')).error?.message), /permission denied/);
    assert.match(String((await as(who, 'select * from koutsi_trial_code_uses')).error?.message), /permission denied/);
  }
  assert.match(String((await as(null, `select public.koutsi_use_code('KESA26', 'x')`)).error?.message), /permission denied/);
  const dup = await as(ADMIN, `select public.koutsi_admin_create_trial_code(12, 1, null, null, 'KESA26')`);
  assert.match(String(dup.error?.message), /on jo olemassa ja antaa eri ajan/);
  // the same key again (any spelling) adds uses, never lowers them, and keeps how it was written
  const uses = async () => (await one(`select max_uses from koutsi_trial_codes where code = 'KESA26'`)).max_uses;
  const before = await uses();
  assert.equal(await make(6, 2, { code: 'kesa 26' }), 'Kesa-26');
  assert.equal(await uses(), before + 2);
  const list = (await as(ADMIN, 'select * from public.koutsi_admin_trial_codes()')).rows;
  assert.deepEqual(list.map((r) => r.shown).sort(), [code, 'Kesa-26', 'Legacy6+'].sort());
  assert.equal(list.find((r) => r.code === 'KESA26').shown, 'Kesa-26');
  const mine = list.find((r) => r.shown === code);
  assert.equal(mine.code, norm(code));
  assert.equal(mine.note, 'Mikkelin valmentaja');
});

test('a new person becomes a coach with 12 free months, even while the default trial is closed', async () => {
  assert.equal((await one('select public.koutsi_self_serve_open() as o')).o, false);
  const code = await make(12, 1, { code: 'Syksy12+' });
  // case, spaces and the "+" never matter
  const r = await use(NEW1, ' syksy 12 ');
  assert.equal(r.error, null);
  assert.equal(r.rows[0].s.plan, 'trial');
  assert.equal(r.rows[0].s.months, 12);
  assert.ok((await daysLeft(NEW1)) >= 364);
  const row = await one(`select terms_version, terms_accepted_at is not null as accepted, trial_code from koutsi_coach_plans where coach_id = '${NEW1}'`);
  assert.deepEqual({ ...row }, { terms_version: '2026-10-29', accepted: true, trial_code: norm(code) });
  assert.equal(Number((await one(`select count(*) as n from koutsi_exercises where coach_id = '${NEW1}'`)).n), 1, 'starter drills');
  // its uses are gone: the next person is told so, and stays no coach
  await db.exec(`update koutsi_trial_codes set max_uses = use_count where code = 'SYKSY12+'`);
  assert.match(String((await use(NEW2, code)).error?.message), /jo käytetty/);
  assert.equal(await plan(NEW2), null);
  // a new coach needs a confirmed e-mail like the default trial
  assert.match(String((await use(NOMAIL, await make(6))).error?.message), /Vahvista ensin/);
});

test('a coach on the trial gets more months; a shorter code never cuts a trial', async () => {
  await db.exec(`create or replace function public.koutsi_self_serve_open() returns boolean language sql stable set search_path = '' as $$ select true $$`);
  assert.equal((await as(TRIAL, `select public.koutsi_start_trial('2026-10-29')`)).error, null);
  await db.exec(`create or replace function public.koutsi_self_serve_open() returns boolean language sql stable set search_path = '' as $$ select false $$`);
  const before = await daysLeft(TRIAL);
  assert.ok(before >= 89 && before <= 93);
  assert.equal((await use(TRIAL, await make(6))).error, null);
  const six = await daysLeft(TRIAL);
  assert.ok(six >= 180, `6 months from today: ${six}`);
  assert.equal((await use(TRIAL, await make(1))).error, null);
  assert.equal(await daysLeft(TRIAL), six, 'the later end wins');
  // once per code
  const multi = await make(3, 5);
  assert.equal((await use(TRIAL, multi)).error, null);
  assert.match(String((await use(TRIAL, multi)).error?.message), /Olet jo käyttänyt/);
  assert.equal((await one(`select use_count from koutsi_trial_codes where code = '${norm(multi)}'`)).use_count, 1);
  // a reminder is due again for the new end
  assert.equal((await one(`select trial_reminded_at from koutsi_coach_plans where coach_id = '${TRIAL}'`)).trial_reminded_at, null);
});

test('an ended trial starts again; a free coach and a subscriber are told plainly', async () => {
  assert.equal((await use(ENDED, await make(3))).error, null);
  await db.exec(`update koutsi_coach_plans set plan = 'ended', trial_ends_at = now() - interval '10 days' where coach_id = '${ENDED}'`);
  assert.equal(await plan(ENDED), 'ended');
  assert.equal((await use(ENDED, await make(12))).error, null);
  assert.equal(await plan(ENDED), 'trial');
  assert.ok((await daysLeft(ENDED)) >= 364);

  assert.match(String((await use(ALPO, await make(12))).error?.message), /jo maksuton/);
  assert.equal(await plan(ALPO), 'free');

  assert.equal((await use(PAYING, await make(3))).error, null);
  await db.exec(`update koutsi_coach_plans set plan = 'active', stripe_subscription_id = 'sub_1', stripe_status = 'active' where coach_id = '${PAYING}'`);
  assert.match(String((await use(PAYING, await make(12))).error?.message), /jo tilaus/);
  assert.equal(await plan(PAYING), 'active');
});

test('a free-use code makes a contract customer: no trial, no payment', async () => {
  const r = await use(FREEBIE, await make(null));
  assert.equal(r.error, null);
  assert.equal(r.rows[0].s.plan, 'free');
  assert.equal(await plan(FREEBIE), 'free');
  // a coach on the trial can be made free too
  assert.equal((await use(TRIAL, await make(null))).error, null);
  assert.equal(await plan(TRIAL), 'free');
  assert.equal((await one(`select trial_ends_at from koutsi_coach_plans where coach_id = '${TRIAL}'`)).trial_ends_at, null);
});

test('a key made before the "+" counted gets it in its code; its uses and plans follow', async () => {
  assert.equal((await one(`select count(*) as n from koutsi_trial_codes where code = 'LEGACY6+'`)).n, 1);
  assert.equal((await one(`select count(*) as n from koutsi_trial_code_uses where code = 'LEGACY6+'`)).n, 1);
  assert.equal((await one(`select trial_code from koutsi_coach_plans where coach_id = '${ALPO}'`)).trial_code, 'LEGACY6+');
});

test('a "+" is part of a key: the same name can be free use without it and a trial with it', async () => {
  // an old free-use coach key and a trial key of the same name with "+"
  assert.equal(await make(3, 25, { code: 'Vanha3+' }), 'Vanha3+');
  const a = await newPerson(1);
  const r = await use(a, 'vanha3 +');
  assert.equal(r.error, null);
  assert.equal(r.rows[0].s.kind, 'code');
  assert.equal(r.rows[0].s.months, 3);
  assert.equal(await plan(a), 'trial');
  const left = await daysLeft(a);
  assert.ok(left >= 89 && left <= 93, `3 months: ${left}`);
  const b = await newPerson(2);
  const k = await use(b, 'Vanha3');
  assert.equal(k.error, null);
  assert.equal(k.rows[0].s.kind, 'key', 'without the "+": the old coach key, free use as before');
  assert.equal(await plan(b), 'free');

  // two trial keys: free use without the "+", three months with it
  assert.equal(await make(null, 5, { code: 'Ilmainen' }), 'Ilmainen');
  assert.equal(await make(3, 5, { code: 'Ilmainen+' }), 'Ilmainen+');
  const c = await newPerson(3);
  assert.equal((await use(c, 'ilmainen')).error, null);
  assert.equal(await plan(c), 'free');
  const d = await newPerson(4);
  assert.equal((await use(d, 'ILMAINEN+')).error, null);
  assert.equal(await plan(d), 'trial');

  // a "+" forgotten still finds the key; a "+" added to a key without one does not
  const e = await newPerson(5);
  assert.equal((await use(e, 'legacy6')).error, null);
  assert.equal(await plan(e), 'trial');
  assert.match(String((await use(await newPerson(6), 'Kesa-26+')).error?.message), /invalid coach key/);
  assert.match(String((await use(await newPerson(7), ' + ')).error?.message), /Kirjoita valmentaja-avain/);
});

test('limits: last day, revoked, unknown; an old coach key still works through the same input', async () => {
  const old = await make(6, 1, { expires: '2026-01-01T00:00:00Z' });
  assert.match(String((await use(NEW2, old)).error?.message), /vanhentunut/);
  const gone = await make(6, 10);
  assert.equal((await as(ADMIN, `select public.koutsi_admin_revoke_trial_code('${gone}')`)).error, null);
  assert.match(String((await use(NEW2, gone)).error?.message), /poistettu käytöstä/);
  // making it again puts it back in use
  assert.equal(await make(6, 1, { code: gone }), gone);
  assert.equal((await one(`select revoked_at from koutsi_trial_codes where code = '${gone}'`)).revoked_at, null);
  assert.equal((await as(ADMIN, `select public.koutsi_admin_revoke_trial_code('${gone}')`)).error, null);
  assert.match(String((await use(NEW2, 'EIOLE123')).error?.message), /invalid coach key/);
  assert.equal(await plan(NEW2), null);

  const key = await use(KEYED, 'avain1');
  assert.equal(key.error, null);
  assert.equal(key.rows[0].s.kind, 'key');
  assert.equal(await plan(KEYED), 'free', 'a key coach is free as before');
  const list = (await as(ADMIN, 'select * from public.koutsi_admin_trial_codes()')).rows;
  assert.equal(list[list.length - 1].shown, gone, 'revoked codes last');
});
