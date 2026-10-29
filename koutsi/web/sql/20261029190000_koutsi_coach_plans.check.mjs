// 20261029190000_koutsi_coach_plans.check.mjs — runs the proposed coach-plan migration
// (koutsi/web/sql/20261029190000_koutsi_coach_plans.sql, NOT applied) in PGlite against a small stub
// of production's Koutsi schema (the tables and functions it leans on, the coach key function copied
// from supabase/migrations/20260911211833_…, Laskutus' gate from 20261029162350_koutsi_billing), then
// checks: today's coaches stay free, the key path still makes free coaches, who can start a trial and
// when, the trial ending by itself, what Stripe may change, that nobody writes a plan from the app, what
// an ended trial locks (sending to players, sending invoices — never a player), Laskutus' gate, and the
// 7-day reminder.
// PGlite is not a dependency of the repo, so this is not part of `npm run test:koutsi`. Before
// "aja migraatio":
//   (in an empty temp folder) npm i @electric-sql/pglite@0.3
//   PGLITE=<that folder>/node_modules/@electric-sql/pglite/dist/index.js node --test koutsi/web/sql/20261029190000_koutsi_coach_plans.check.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite');

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = await readFile(join(here, '20261029190000_koutsi_coach_plans.sql'), 'utf8');

const ALPO = '00000000-0000-4000-8000-0000000000a1'; // a coach today (club, contract customer)
const ADMIN = '00000000-0000-4000-8000-0000000000e1'; // admin, a coach today
const NEW = '00000000-0000-4000-8000-0000000000c1'; // new private coach: profile, confirmed e-mail
const NOMAIL = '00000000-0000-4000-8000-0000000000c2'; // profile, e-mail not confirmed
const NOPROF = '00000000-0000-4000-8000-0000000000c3'; // confirmed e-mail, no profile yet
const KEYED = '00000000-0000-4000-8000-0000000000c4'; // gets a coach key after the migration
const LATE = '00000000-0000-4000-8000-0000000000c5'; // tries after sign-ups are paused
const PLAYER = '00000000-0000-4000-8000-000000000001'; // a player, no coach row
const ENDED = '00000000-0000-4000-8000-0000000000d1'; // trial over, no subscription
const TRIAL = '00000000-0000-4000-8000-0000000000d2'; // on the trial (reminders, Laskutus)
const LISTED = '00000000-0000-4000-8000-0000000000d3'; // a key coach on Laskutus' own list

const STUB = `
create schema if not exists auth;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
-- Supabase's defaults: new tables and functions in public are open to the API roles until revoked.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create table public.profiles (id uuid primary key, name text);
create table public.koutsi_admins (user_id uuid primary key);
create table public.koutsi_coaches (id uuid primary key, welcome_seen_at timestamptz);
create table public.koutsi_exercises (id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.koutsi_coaches(id) on delete cascade, name text not null);
create table public.koutsi_coach_invite_codes (code text primary key, max_uses integer not null default 1,
  use_count integer not null default 0, expires_at timestamptz, revoked_at timestamptz, redeemed_by uuid, redeemed_at timestamptz);

create function public.koutsi_is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (select 1 from public.koutsi_admins a where a.user_id = (select auth.uid())); $$;

-- Same checks as production's; two starter drills instead of the template table.
create function public.koutsi_seed_exercises(target_coach uuid default null) returns integer
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := coalesce(target_coach, auth.uid()); v_count integer;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if target_coach is not null and target_coach <> coalesce(auth.uid(), target_coach) and not koutsi_is_admin() then
    raise exception 'not allowed';
  end if;
  if not exists (select 1 from koutsi_coaches where id = v_uid) then raise exception 'not a coach'; end if;
  insert into koutsi_exercises (coach_id, name)
  select v_uid, n from unnest(array['Rytmiharjoitus', 'Syöttö ja ensimmäinen lyönti']) n
   where not exists (select 1 from koutsi_exercises e where e.coach_id = v_uid and e.name = n);
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

create table public.koutsi_students (id uuid primary key, name text);
create table public.koutsi_coach_students (coach_id uuid not null references public.koutsi_coaches(id) on delete cascade,
  student_id uuid not null references public.koutsi_students(id) on delete cascade, ended_at timestamptz, primary key (coach_id, student_id));
-- what a coach sends through (columns the guard and these tests use)
create table public.koutsi_diary_entries (id uuid primary key default gen_random_uuid(), student_id uuid not null, coach_id uuid, text text not null);
create table public.koutsi_homework (id uuid primary key default gen_random_uuid(), student_id uuid not null, coach_id uuid, text text not null);
create table public.koutsi_videos (id uuid primary key default gen_random_uuid(), student_id uuid not null, added_by_id uuid, title text);
create table public.koutsi_announcements (id uuid primary key default gen_random_uuid(), coach_id uuid not null, body text not null,
  group_ids uuid[] not null default '{}', student_ids uuid[] not null default '{}', until date not null default current_date);
create table public.koutsi_sends (id uuid primary key default gen_random_uuid(), coach_id uuid not null, kind text not null, ref_id uuid not null, title text not null);
create table public.koutsi_threads (id uuid primary key default gen_random_uuid(), coach_id uuid not null, student_id uuid not null);
create table public.koutsi_messages (id uuid primary key default gen_random_uuid(), thread_id uuid not null references public.koutsi_threads(id), body text not null);
create table public.koutsi_trainings (id uuid primary key default gen_random_uuid(), coach_id uuid not null, date date not null);
create table public.koutsi_notifications (id uuid primary key default gen_random_uuid(), recipient_id uuid not null, actor_id uuid,
  kind text not null, title text not null, body text, link_path text, created_at timestamptz not null default now());
create function public.koutsi_notify(p_recipient uuid, p_actor uuid, p_kind text, p_title text, p_body text, p_link text) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if p_recipient is null or p_recipient = p_actor then return; end if;
  if not exists (select 1 from auth.users u where u.id = p_recipient) then return; end if;
  insert into koutsi_notifications (recipient_id, actor_id, kind, title, body, link_path) values (p_recipient, p_actor, p_kind, p_title, p_body, p_link);
end; $$;

-- Laskutus as applied 29.10.2026 (20261029162350_koutsi_billing): the gate, the seller, the invoice.
create table public.koutsi_billing_coaches (coach_id uuid primary key references public.koutsi_coaches(id) on delete cascade);
create table public.koutsi_billers (id uuid primary key default gen_random_uuid(), coach_id uuid not null references public.koutsi_coaches(id) on delete cascade);
create table public.koutsi_invoices (id uuid primary key default gen_random_uuid(), biller_id uuid not null references public.koutsi_billers(id) on delete cascade,
  coach_id uuid not null references public.koutsi_coaches(id) on delete cascade, status text not null default 'draft');
create function public.koutsi_billing_coach_enabled(p_coach uuid) returns boolean language sql stable security definer set search_path = '' as $function$
  select p_coach is not null and (
    exists (select 1 from public.koutsi_admins a where a.user_id = p_coach)
    or exists (select 1 from public.koutsi_billing_coaches b where b.coach_id = p_coach)
  );
$function$;
revoke all on function public.koutsi_billing_coach_enabled(uuid) from public, anon, authenticated;

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

const SEED = `
insert into auth.users (id, email, email_confirmed_at) values
  ('${ALPO}', 'alpo@example.test', now()), ('${ADMIN}', 'admin@example.test', now()), ('${NEW}', 'uusi@example.test', now()),
  ('${NOMAIL}', 'eivahv@example.test', null), ('${NOPROF}', 'eiprof@example.test', now()), ('${KEYED}', 'avain@example.test', now()),
  ('${LATE}', 'myoh@example.test', now()), ('${PLAYER}', 'pelaaja@example.test', now()),
  ('${ENDED}', 'loppui@example.test', now()), ('${TRIAL}', 'kokeilu@example.test', now()), ('${LISTED}', 'listalla@example.test', now());
insert into profiles (id, name) values ('${ALPO}', 'Alpo'), ('${ADMIN}', 'Ylläpitäjä'), ('${NEW}', 'Uusi Valmentaja'),
  ('${NOMAIL}', 'Ei Vahvistettu'), ('${KEYED}', 'Avain Valmentaja'), ('${LATE}', 'Myöhäinen'), ('${PLAYER}', 'Pelaaja'),
  ('${ENDED}', 'Kokeilu Loppui'), ('${TRIAL}', 'Kokeilu Käynnissä'), ('${LISTED}', 'Listalla');
insert into koutsi_admins (user_id) values ('${ADMIN}');
insert into koutsi_coaches (id) values ('${ALPO}'), ('${ADMIN}');
insert into koutsi_coach_invite_codes (code) values ('AVAIN1');
insert into koutsi_students (id, name) values ('${PLAYER}', 'Pelaaja'), ('${ENDED}', 'Kokeilu Loppui');
`;

const db = new PGlite();
await db.exec(STUB);
await db.exec(SEED);
await db.exec(MIGRATION);
// It ships with sign-ups without a key closed; opening them is a separate one-line replace.
const OPEN = `create or replace function public.koutsi_self_serve_open() returns boolean language sql stable set search_path = '' as $$ select true $$`;
const closedAtFirst = (await db.query('select public.koutsi_self_serve_open() as o')).rows[0].o === false;
const startClosed = await (async () => {
  await db.exec('begin');
  try {
    await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${NEW}', true);`);
    await db.query(`select public.koutsi_start_trial('2026-10-29')`);
    return null;
  } catch (error) { return error; } finally { await db.exec('rollback'); }
})();
await db.exec(OPEN);

/** Runs `sql` as `uid` (role authenticated; anon when uid is null) in a transaction. */
async function as(uid, sql, { keep = true } = {}) {
  await db.exec('begin');
  try {
    await db.exec(uid
      ? `set local role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);`
      : `set local role anon; select set_config('request.jwt.claim.sub', '', true);`);
    const res = await db.query(sql);
    await db.exec(keep ? 'commit' : 'rollback');
    return { rows: res.rows, error: null };
  } catch (error) {
    await db.exec('rollback');
    return { rows: [], error };
  }
}
const asService = async (sql) => {
  await db.exec('begin');
  try {
    await db.exec(`set local role service_role; select set_config('request.jwt.claim.sub', '', true);`);
    const res = await db.query(sql);
    await db.exec('commit');
    return { rows: res.rows, error: null };
  } catch (error) {
    await db.exec('rollback');
    return { rows: [], error };
  }
};
const one = async (sql) => (await db.query(sql)).rows[0];
const planOf = async (uid) => (await one(`select public.koutsi_coach_plan('${uid}') as p`)).p;
const status = async (uid) => (await as(uid, 'select public.koutsi_plan_status() as s')).rows[0]?.s;
const apply = (coach, sub, st, extra = {}) => asService(`select public.koutsi_plan_apply_stripe('${coach}', ${extra.customer === null ? 'null' : `'${extra.customer || 'cus_1'}'`}, '${sub}', '${st}',
  ${extra.periodEnd ? `'${extra.periodEnd}'` : `now() + interval '30 days'`}, ${extra.cancel ? 'true' : 'false'}) as p`);

test('sign-ups without a key ship closed; running the migration again never closes them', async () => {
  assert.equal(closedAtFirst, true);
  assert.match(String(startClosed?.message), /Kokeilua ei voi juuri nyt aloittaa/);
  await db.exec(MIGRATION);
  assert.equal((await db.query('select public.koutsi_self_serve_open() as o')).rows[0].o, true, 'still open after a re-run');
});

test('the migration can run again and changes nothing the second time', async () => {
  await db.exec(MIGRATION);
  const rows = (await db.query('select coach_id, plan from koutsi_coach_plans order by coach_id')).rows;
  assert.deepEqual(rows.map((r) => [r.coach_id, r.plan]), [[ALPO, 'free'], [ADMIN, 'free']]);
});

test("today's coaches are free and see no trial or payment", async () => {
  assert.equal(await planOf(ALPO), 'free');
  assert.equal(await planOf(ADMIN), 'free');
  const s = await status(ALPO);
  assert.equal(s.plan, 'free');
  assert.equal(s.trial_ends_at, null);
  assert.equal(s.has_customer, false);
  // starting a trial as an existing coach changes nothing
  const again = await as(ALPO, `select public.koutsi_start_trial('2026-10-29') as s`);
  assert.equal(again.error, null);
  assert.equal(again.rows[0].s.plan, 'free');
  assert.equal((await one(`select plan, trial_ends_at from koutsi_coach_plans where coach_id = '${ALPO}'`)).plan, 'free');
});

test('before signing in: the status says whether sign-up without a key is open, nothing else', async () => {
  const anon = await as(null, 'select public.koutsi_plan_status() as s');
  assert.equal(anon.error, null);
  assert.equal(anon.rows[0].s.self_serve, true);
  assert.equal(anon.rows[0].s.plan, null);
  const player = await status(PLAYER);
  assert.equal(player.plan, null, 'a player is not a coach');
  assert.equal(player.self_serve, true);
});

test('the plan of another coach, and the Stripe writers, are not for the app', async () => {
  for (const sql of [
    `select public.koutsi_coach_plan('${ALPO}')`,
    'select public.koutsi_self_serve_open()',
    `select public.koutsi_plan_set_customer('${NEW}', 'cus_x')`,
    `select public.koutsi_plan_apply_stripe('${ALPO}', 'cus_x', 'sub_x', 'active', now(), false)`,
  ]) {
    for (const who of [null, NEW, ALPO, ADMIN]) {
      const r = await as(who, sql);
      assert.match(String(r.error?.message), /permission denied/, `${who || 'anon'}: ${sql}`);
    }
  }
  const anonStart = await as(null, `select public.koutsi_start_trial('2026-10-29')`);
  assert.match(String(anonStart.error?.message), /permission denied/);
});

test('starting a trial needs a profile, a confirmed e-mail and the terms', async () => {
  let r = await as(NOPROF, `select public.koutsi_start_trial('2026-10-29') as s`);
  assert.match(String(r.error?.message), /profile required/);
  r = await as(NOMAIL, `select public.koutsi_start_trial('2026-10-29') as s`);
  assert.match(String(r.error?.message), /Vahvista ensin sähköpostiosoitteesi/);
  r = await as(NEW, `select public.koutsi_start_trial('  ') as s`);
  assert.match(String(r.error?.message), /Tilausehtojen hyväksyntä puuttuu/);
  for (const uid of [NOPROF, NOMAIL, NEW]) {
    assert.equal(await planOf(uid), null, 'nobody became a coach on the way');
  }
});

test('a new coach starts a 3-month trial without a key, once', async () => {
  const r = await as(NEW, `select public.koutsi_start_trial('2026-10-29') as s`);
  assert.equal(r.error, null);
  assert.equal(r.rows[0].s.plan, 'trial');
  const row = await one(`select plan, terms_version, terms_accepted_at is not null as accepted,
    (trial_ends_at - now()) between interval '89 days' and interval '93 days' as three_months, stripe_customer_id
    from koutsi_coach_plans where coach_id = '${NEW}'`);
  assert.deepEqual({ ...row }, { plan: 'trial', terms_version: '2026-10-29', accepted: true, three_months: true, stripe_customer_id: null });
  assert.ok(await one(`select 1 as ok from koutsi_coaches where id = '${NEW}'`), 'the coach row exists');
  assert.equal(Number((await one(`select count(*) as n from koutsi_exercises where coach_id = '${NEW}'`)).n), 2, 'starter drills like after a key');

  // again: same trial, not extended
  const before = (await one(`select trial_ends_at from koutsi_coach_plans where coach_id = '${NEW}'`)).trial_ends_at;
  await db.exec(`update koutsi_coach_plans set trial_ends_at = trial_ends_at - interval '10 days' where coach_id = '${NEW}'`);
  const again = await as(NEW, `select public.koutsi_start_trial('2026-12-01') as s`);
  assert.equal(again.error, null);
  const after = await one(`select trial_ends_at, terms_version from koutsi_coach_plans where coach_id = '${NEW}'`);
  assert.equal(after.terms_version, '2026-10-29');
  assert.equal(after.trial_ends_at.getTime(), before.getTime() - 10 * 24 * 3600 * 1000);
  await db.exec(`update koutsi_coach_plans set trial_ends_at = trial_ends_at + interval '10 days' where coach_id = '${NEW}'`);
});

test('the coach reads their own plan only and cannot change it', async () => {
  const own = await as(NEW, 'select coach_id, plan from koutsi_coach_plans');
  assert.deepEqual(own.rows.map((r) => r.coach_id), [NEW]);
  let r = await as(NEW, `update koutsi_coach_plans set plan = 'active' where coach_id = '${NEW}' returning plan`);
  assert.match(String(r.error?.message), /permission denied/);
  r = await as(NEW, `update koutsi_coach_plans set trial_ends_at = now() + interval '10 years' where coach_id = '${NEW}'`);
  assert.match(String(r.error?.message), /permission denied/);
  r = await as(PLAYER, `insert into koutsi_coach_plans (coach_id, plan) values ('${PLAYER}', 'free')`);
  assert.match(String(r.error?.message), /permission denied/);
  r = await as(NEW, `delete from koutsi_coach_plans where coach_id = '${NEW}'`);
  assert.match(String(r.error?.message), /permission denied/);
  r = await as(null, 'select * from koutsi_coach_plans');
  assert.match(String(r.error?.message), /permission denied/);
  assert.equal(await planOf(NEW), 'trial');
});

test('the coach key keeps working and makes a free coach', async () => {
  const r = await as(KEYED, `select public.redeem_koutsi_coach_key('avain1') as k`);
  assert.equal(r.error, null);
  assert.equal(r.rows[0].k.already_coach, false);
  assert.equal(await planOf(KEYED), 'free');
  assert.equal((await status(KEYED)).plan, 'free');
});

test('pausing sign-ups stops new trials but not the coach key', async () => {
  await db.exec(OPEN.replace('select true', 'select false'));
  try {
    assert.equal((await as(null, 'select public.koutsi_plan_status() as s')).rows[0].s.self_serve, false);
    const r = await as(LATE, `select public.koutsi_start_trial('2026-10-29') as s`);
    assert.match(String(r.error?.message), /Kokeilua ei voi juuri nyt aloittaa/);
    assert.equal(await planOf(LATE), null);
    // an existing coach is unaffected
    assert.equal((await as(NEW, `select public.koutsi_start_trial('2026-10-29') as s`)).rows[0].s.plan, 'trial');
  } finally {
    await db.exec(OPEN);
  }
});

test('the trial ends by itself', async () => {
  await db.exec(`update koutsi_coach_plans set trial_ends_at = now() - interval '1 minute' where coach_id = '${NEW}'`);
  assert.equal(await planOf(NEW), 'ended');
  assert.equal((await status(NEW)).plan, 'ended');
  await db.exec(`update koutsi_coach_plans set trial_ends_at = now() + interval '60 days' where coach_id = '${NEW}'`);
  assert.equal(await planOf(NEW), 'trial');
});

test('Stripe: subscribing inside the trial, renewals, a failed payment, cancelling', async () => {
  let r = await asService(`select public.koutsi_plan_set_customer('${NEW}', 'cus_new')`);
  assert.equal(r.error, null);
  assert.equal((await status(NEW)).has_customer, true);
  assert.equal(await planOf(NEW), 'trial', 'a customer alone changes nothing');

  // taken during the trial: Stripe says trialing until the first charge
  r = await apply(NEW, 'sub_a', 'trialing', { customer: 'cus_new' });
  assert.equal(r.rows[0].p, 'active');
  let s = await status(NEW);
  assert.equal(s.plan, 'active');
  assert.equal(s.stripe_status, 'trialing');
  assert.ok(s.period_end);

  // the first charge fails, then goes through
  assert.equal((await apply(NEW, 'sub_a', 'past_due')).rows[0].p, 'past_due');
  assert.equal((await apply(NEW, 'sub_a', 'active')).rows[0].p, 'active');
  // incomplete / paused: plan stays, details kept
  assert.equal((await apply(NEW, 'sub_a', 'paused')).rows[0].p, 'active');
  assert.equal((await one(`select stripe_status from koutsi_coach_plans where coach_id = '${NEW}'`)).stripe_status, 'paused');
  await apply(NEW, 'sub_a', 'active');

  // cancelled at the period's end: still active, then ended — but inside the trial window it is the trial again
  await apply(NEW, 'sub_a', 'active', { cancel: true });
  s = await status(NEW);
  assert.equal(s.plan, 'active');
  assert.equal(s.cancel_at_period_end, true);
  assert.equal((await apply(NEW, 'sub_a', 'canceled')).rows[0].p, 'trial');
  await db.exec(`update koutsi_coach_plans set trial_ends_at = now() - interval '1 day' where coach_id = '${NEW}'`);
  assert.equal(await planOf(NEW), 'ended');
});

test('Stripe: a late event of an old subscription never ends a newer live one', async () => {
  assert.equal((await apply(NEW, 'sub_b', 'active')).rows[0].p, 'active');
  assert.equal((await apply(NEW, 'sub_a', 'canceled')).rows[0].p, 'active', 'old one ignored');
  assert.equal((await apply(NEW, 'sub_c', 'incomplete')).rows[0].p, 'active', 'an unfinished new checkout does not replace it');
  const row = await one(`select stripe_subscription_id, plan from koutsi_coach_plans where coach_id = '${NEW}'`);
  assert.deepEqual({ ...row }, { stripe_subscription_id: 'sub_b', plan: 'active' });
  // a newer live one replaces it
  assert.equal((await apply(NEW, 'sub_d', 'active')).rows[0].p, 'active');
  assert.equal((await one(`select stripe_subscription_id from koutsi_coach_plans where coach_id = '${NEW}'`)).stripe_subscription_id, 'sub_d');
});

test('Stripe never changes a free coach, and a gone coach is skipped', async () => {
  assert.equal((await apply(ALPO, 'sub_alpo', 'active', { customer: 'cus_alpo' })).rows[0].p, 'free');
  assert.equal((await apply(KEYED, 'sub_keyed', 'past_due', { customer: 'cus_keyed' })).rows[0].p, 'free', 'a key coach without a row');
  assert.equal(await planOf(ALPO), 'free');
  assert.equal(await planOf(KEYED), 'free');
  assert.equal((await apply(PLAYER, 'sub_p', 'active', { customer: 'cus_p' })).rows[0].p, null);
  assert.equal((await one(`select count(*) as n from koutsi_coach_plans where coach_id = '${PLAYER}'`)).n, 0);
  await asService(`select public.koutsi_plan_set_customer('${PLAYER}', 'cus_p2')`);
  assert.equal((await one(`select count(*) as n from koutsi_coach_plans where coach_id = '${PLAYER}'`)).n, 0);
});

test('an ended trial stops sending to players — and nothing else, and never a player', async () => {
  // ENDED: a trial that ran out; TRIAL: on the trial; PLAYER is ENDED's player and also writes himself
  for (const uid of [ENDED, TRIAL]) assert.equal((await as(uid, `select public.koutsi_start_trial('2026-10-29') as s`)).error, null);
  await db.exec(`update koutsi_coach_plans set trial_ends_at = now() - interval '1 day' where coach_id = '${ENDED}'`);
  assert.equal(await planOf(ENDED), 'ended');
  await db.exec(`insert into koutsi_coach_students (coach_id, student_id) values ('${ENDED}', '${PLAYER}');
    insert into koutsi_threads (id, coach_id, student_id) values ('00000000-0000-4000-8000-00000000f001', '${ENDED}', '${PLAYER}')`);
  const THREAD = '00000000-0000-4000-8000-00000000f001';
  const sends = (coach) => [
    `insert into koutsi_diary_entries (student_id, coach_id, text) values ('${PLAYER}', '${coach}', 'Hyvä treeni')`,
    `insert into koutsi_homework (student_id, coach_id, text) values ('${PLAYER}', '${coach}', 'Syötöt 50 kpl')`,
    `insert into koutsi_videos (student_id, added_by_id, title) values ('${PLAYER}', '${coach}', 'Syöttö')`,
    `insert into koutsi_announcements (coach_id, body, student_ids) values ('${coach}', 'Huomenna kenttä 3', array['${PLAYER}']::uuid[])`,
    `insert into koutsi_sends (coach_id, kind, ref_id, title) values ('${coach}', 'homework', gen_random_uuid(), 'Syötöt')`,
  ];
  for (const sql of [...sends(ENDED), `insert into koutsi_messages (thread_id, body) values ('${THREAD}', 'Moi!')`]) {
    const r = await as(ENDED, sql);
    assert.match(String(r.error?.message), /Kokeilusi on päättynyt\. Ota tilaus/, sql);
  }
  assert.equal(Number((await one('select count(*) as n from koutsi_homework')).n), 0, 'nothing was written');
  // planning goes on
  assert.equal((await as(ENDED, `insert into koutsi_trainings (coach_id, date) values ('${ENDED}', current_date)`)).error, null);
  // a player is never stopped: own homework and video, a message to the coach
  for (const sql of [
    `insert into koutsi_homework (student_id, text) values ('${PLAYER}', 'Oma läksy')`,
    `insert into koutsi_videos (student_id, added_by_id, title) values ('${PLAYER}', '${PLAYER}', 'Oma video')`,
    `insert into koutsi_messages (thread_id, body) values ('${THREAD}', 'Moi valmentaja')`,
  ]) assert.equal((await as(PLAYER, sql)).error, null, sql);
  // the ended coach as somebody's player: their own rows go through
  for (const sql of [
    `insert into koutsi_homework (student_id, text) values ('${ENDED}', 'Oma läksy')`,
    `insert into koutsi_videos (student_id, added_by_id, title) values ('${ENDED}', '${ENDED}', 'Oma video')`,
  ]) assert.equal((await as(ENDED, sql)).error, null, sql);
  // on the trial, free (today's coaches), an admin acting, the service role: all send
  for (const coach of [TRIAL, ALPO, ADMIN]) {
    for (const sql of sends(coach)) assert.equal((await as(coach, sql)).error, null, `${coach}: ${sql}`);
  }
  assert.equal((await asService(sends(ENDED)[0])).error, null, 'no signed-in coach: not stopped');
  // after subscribing, ENDED sends again
  assert.equal((await apply(ENDED, 'sub_e', 'active', { customer: 'cus_e' })).rows[0].p, 'active');
  for (const sql of sends(ENDED)) assert.equal((await as(ENDED, sql)).error, null, sql);
  assert.equal((await apply(ENDED, 'sub_e', 'canceled', { customer: 'cus_e' })).rows[0].p, 'ended');
});

test("Laskutus: open on the trial and with a subscription; after the trial old invoices stay, sending doesn't", async () => {
  await db.exec(`insert into koutsi_coaches (id) values ('${LISTED}'); insert into koutsi_billing_coaches (coach_id) values ('${LISTED}')`);
  const gate = async (uid) => (await one(`select public.koutsi_billing_coach_enabled('${uid}') as g`)).g;
  assert.equal(await gate(ALPO), false, 'free coach: as before, nothing');
  assert.equal(await gate(KEYED), false);
  assert.equal(await gate(LISTED), true, "Laskutus' own list as before");
  assert.equal(await gate(ADMIN), true);
  assert.equal(await gate(TRIAL), true, 'on the trial');
  assert.equal(await gate(ENDED), false, 'trial over, never used Laskutus');
  assert.equal(await gate(PLAYER), false);
  const r = await as(ALPO, `select public.koutsi_billing_coach_enabled('${ALPO}')`);
  assert.match(String(r.error?.message), /permission denied/, 'rights kept');

  // ENDED had set up Laskutus during the trial: still sees it, can mark paid, cannot send
  await db.exec(`insert into koutsi_billers (id, coach_id) values ('00000000-0000-4000-8000-00000000b001', '${ENDED}');
    insert into koutsi_invoices (id, biller_id, coach_id, status) values
      ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-00000000b001', '${ENDED}', 'draft'),
      ('00000000-0000-4000-8000-00000000a002', '00000000-0000-4000-8000-00000000b001', '${ENDED}', 'sent')`);
  assert.equal(await gate(ENDED), true);
  await assert.rejects(db.query(`update koutsi_invoices set status = 'sent' where id = '00000000-0000-4000-8000-00000000a001'`), /Kokeilusi on päättynyt\. Ota tilaus .* laskuja/);
  await db.query(`update koutsi_invoices set status = 'paid' where id = '00000000-0000-4000-8000-00000000a002'`);
  await db.query(`update koutsi_invoices set status = 'void' where id = '00000000-0000-4000-8000-00000000a002'`);
  // on the trial an invoice goes
  await db.exec(`insert into koutsi_billers (id, coach_id) values ('00000000-0000-4000-8000-00000000b002', '${TRIAL}');
    insert into koutsi_invoices (id, biller_id, coach_id) values ('00000000-0000-4000-8000-00000000a003', '00000000-0000-4000-8000-00000000b002', '${TRIAL}')`);
  await db.query(`update koutsi_invoices set status = 'sent' where id = '00000000-0000-4000-8000-00000000a003'`);
});

test('one reminder 7 days before the trial ends, only to a coach who has not subscribed', async () => {
  await db.exec(`update koutsi_coach_plans set trial_ends_at = now() + interval '5 days 2 hours' where coach_id = '${TRIAL}'`);
  await db.exec(`update koutsi_coach_plans set trial_ends_at = now() + interval '3 days' where coach_id = '${ENDED}'`); // subscribed once: stored 'ended'
  const run = async () => (await asService('select public.koutsi_trial_reminders() as n')).rows[0].n;
  assert.equal(await run(), 1);
  const n = await one(`select kind, title, body, link_path, actor_id from koutsi_notifications where recipient_id = '${TRIAL}' and kind = 'trial_ending'`);
  assert.deepEqual({ ...n }, {
    kind: 'trial_ending', title: 'Koutsi-kokeilusi päättyy 6 päivän päästä',
    body: 'Sen jälkeen pelaajille lähettäminen vaatii tilauksen. Ota tilaus kohdasta Profiili → Tilaus.',
    link_path: '/valmentaja/profiili', actor_id: null,
  });
  assert.equal(await run(), 0, 'once per trial');
  // further away: not yet; a coach with a subscription: never
  await db.exec(`update koutsi_coach_plans set trial_reminded_at = null, trial_ends_at = now() + interval '20 days' where coach_id = '${TRIAL}'`);
  assert.equal(await run(), 0);
  await db.exec(`update koutsi_coach_plans set trial_ends_at = now() + interval '20 hours' where coach_id = '${TRIAL}'`);
  assert.equal(await run(), 1);
  assert.equal((await one(`select title from koutsi_notifications where recipient_id = '${TRIAL}' order by created_at desc limit 1`)).title, 'Koutsi-kokeilusi päättyy huomenna');
  const r = await as(TRIAL, 'select public.koutsi_trial_reminders()');
  assert.match(String(r.error?.message), /permission denied/, 'not for the app');
});

test('deleting the coach removes the plan', async () => {
  await db.exec(`delete from koutsi_coaches where id = '${NEW}'`);
  assert.equal((await one(`select count(*) as n from koutsi_coach_plans where coach_id = '${NEW}'`)).n, 0);
  assert.equal(await planOf(NEW), null);
});
