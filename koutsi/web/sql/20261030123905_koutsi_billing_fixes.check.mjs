// 20261030123905_koutsi_billing_fixes.check.mjs — runs Laskutus phases 1–3 (supabase/migrations) and the
// fixes of 30.10.2026 (supabase/migrations/20261030123905_koutsi_billing_fixes.sql) in PGlite against a small stub
// of production's schema, and checks: group membership history (removed and added back, claims and merges
// that keep left groups left), invoices and payers following a merged or claimed placeholder, the players
// who have left, a season fee once per season (and the old season lines getting their season), no voiding
// of an invoice paid online, a payment after voiding, the reminder's wording, and a group's new weekly time
// carrying the "En pääse" reports over.
// PGlite is not a dependency of the repo, so this is not part of `npm run test:koutsi`. To run it:
//   (in an empty temp folder) npm i @electric-sql/pglite@0.3
//   PGLITE=<that folder>/node_modules/@electric-sql/pglite/dist/index.js node --test koutsi/web/sql/20261030123905_koutsi_billing_fixes.check.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite');

const here = dirname(fileURLToPath(import.meta.url));
const PHASE1 = await readFile(join(here, '../../../supabase/migrations/20261029162350_koutsi_billing.sql'), 'utf8');
const PHASE2 = await readFile(join(here, '../../../supabase/migrations/20261029185432_koutsi_billing_pay.sql'), 'utf8');
const PHASE3 = await readFile(join(here, '../../../supabase/migrations/20261030070121_koutsi_billing_mail.sql'), 'utf8');
const FIXES = await readFile(join(here, '../../../supabase/migrations/20261030123905_koutsi_billing_fixes.sql'), 'utf8');

const ANNA = '00000000-0000-4000-8000-0000000000a1'; // coach, Laskutus on
const JUHO = '00000000-0000-4000-8000-0000000000b1'; // coach, Laskutus off
const MARIA = '00000000-0000-4000-8000-000000000001'; // Anna's player
const JUSSI = '00000000-0000-4000-8000-000000000002'; // Anna's player, leaves her later
const PH = '00000000-0000-4000-8000-000000000003'; // Anna's placeholder "Pirjo S."
const PIRJO = '00000000-0000-4000-8000-000000000004'; // Pirjo's own account, already Anna's player
const PH2 = '00000000-0000-4000-8000-000000000005'; // a duplicate of Maria the coach made by name
const G1 = '00000000-0000-4000-8000-0000000000c1'; // Anna's adults
const G2 = '00000000-0000-4000-8000-0000000000c2'; // Anna's juniors (season-fee group of season S2)
const G3 = '00000000-0000-4000-8000-0000000000c3'; // Anna's Friday group
const S1 = '00000000-0000-4000-8000-0000000000f1'; // Anna's autumn season
const S2 = '00000000-0000-4000-8000-0000000000f2'; // the juniors' own season
const T1 = '00000000-0000-4000-8000-0000000000d1';
const T2 = '00000000-0000-4000-8000-0000000000d2';
const T3 = '00000000-0000-4000-8000-0000000000d3';

const STUB = `
create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
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
create table public.koutsi_coaches (id uuid primary key, archived_at timestamptz);
create table public.koutsi_students (id uuid primary key, display_name text, placeholder_coach_id uuid,
  age integer, level text, goal text, focus text, background text, last_session_note text, player_note text, player_wish text,
  pilot_age_group text, minor_notice_confirmed_at timestamptz, minor_notice_confirmed_by uuid,
  guardian_approval_confirmed_at timestamptz, guardian_approval_confirmed_by uuid);
create table public.koutsi_coach_students (
  coach_id uuid not null references public.koutsi_coaches(id) on delete cascade,
  student_id uuid not null references public.koutsi_students(id) on delete cascade,
  ended_at timestamptz, created_at timestamptz not null default now(),
  primary key (coach_id, student_id));
create table public.koutsi_seasons (id uuid primary key, coach_id uuid not null references public.koutsi_coaches(id) on delete cascade,
  name text not null, starts_on date not null, ends_on date not null);
create table public.koutsi_groups (id uuid primary key, coach_id uuid not null references public.koutsi_coaches(id) on delete cascade,
  name text not null, created_at timestamptz not null default now(), season_id uuid references public.koutsi_seasons(id) on delete set null);
create table public.koutsi_group_members (group_id uuid not null references public.koutsi_groups(id) on delete cascade,
  student_id uuid not null references public.koutsi_students(id) on delete cascade,
  ended_at timestamptz, created_at timestamptz not null default now(), primary key (group_id, student_id));
create table public.koutsi_trainings (id uuid primary key default gen_random_uuid(), coach_id uuid not null references public.koutsi_coaches(id) on delete cascade,
  group_id uuid references public.koutsi_groups(id) on delete cascade, student_id uuid, date date not null, time time not null,
  type text not null, duration_minutes integer, logged_by text not null default 'coach', series_id uuid);
create table public.koutsi_training_absences (
  training_id uuid not null references public.koutsi_trainings(id) on delete cascade,
  student_id uuid not null, reason text not null default 'poissa', note text, reported_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (training_id, student_id));
create function public.koutsi_stamp_training_absence() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  new.reported_by := coalesce((select auth.uid()), new.reported_by);
  new.updated_at := now();
  return new;
end; $$;
create trigger koutsi_training_absences_stamp before insert or update on public.koutsi_training_absences
  for each row execute function public.koutsi_stamp_training_absence();
-- what the real notification triggers react to, logged in order (they skip under koutsi.bulk_trainings)
create table public.event_log (n serial primary key, what text not null, training_id uuid, student_id uuid);
create function public.log_training() returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  if coalesce(current_setting('koutsi.bulk_trainings', true), '') = 'on' then return coalesce(new, old); end if;
  insert into event_log (what, training_id) values (case when tg_op = 'INSERT' then 'added' else 'cancelled' end, coalesce(new.id, old.id));
  return coalesce(new, old);
end; $$;
create trigger trainings_added after insert on public.koutsi_trainings for each row execute function public.log_training();
create trigger trainings_cancelled after delete on public.koutsi_trainings for each row execute function public.log_training();
create function public.log_absence() returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  if coalesce(current_setting('koutsi.bulk_trainings', true), '') = 'on' then return new; end if;
  if new.reported_by is distinct from new.student_id then return new; end if;
  insert into event_log (what, training_id, student_id) values ('ei pääse', new.training_id, new.student_id);
  return new;
end; $$;
create trigger absence_reported after insert on public.koutsi_training_absences for each row execute function public.log_absence();
create table public.koutsi_notifications (id uuid primary key default gen_random_uuid(), recipient_id uuid not null, actor_id uuid,
  kind text not null, title text not null, body text, link_path text, created_at timestamptz not null default now(),
  read_at timestamptz, email_status text not null default 'pending');
-- the tables a claim or a merge moves rows in
create table public.koutsi_diary_entries (id uuid primary key default gen_random_uuid(), student_id uuid);
create table public.koutsi_homework (id uuid primary key default gen_random_uuid(), student_id uuid);
create table public.koutsi_videos (id uuid primary key default gen_random_uuid(), student_id uuid, share_id uuid);
create table public.koutsi_moods (id uuid primary key default gen_random_uuid(), student_id uuid);
create table public.koutsi_match_notes (id uuid primary key default gen_random_uuid(), student_id uuid);
create table public.koutsi_player_history (id uuid primary key default gen_random_uuid(), student_id uuid);

create function public.koutsi_is_admin() returns boolean language sql stable security definer set search_path to '' as $$
  select (select auth.uid()) is not null and exists (select 1 from public.koutsi_admins a where a.user_id = (select auth.uid())); $$;
create function public.koutsi_acts_as(target uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select target is not null and (target = (select auth.uid()) or public.koutsi_is_admin()); $$;
create function public.koutsi_coach_for_code(code text) returns uuid language sql stable as $$
  select case when code = 'ANNA01' then '${ANNA}'::uuid end; $$;
create function public.koutsi_notify(p_recipient uuid, p_actor uuid, p_kind text, p_title text, p_body text, p_link text) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if p_recipient is null or p_recipient = p_actor then return; end if;
  if not exists (select 1 from auth.users u where u.id = p_recipient) then return; end if;
  insert into koutsi_notifications (recipient_id, actor_id, kind, title, body, link_path)
  values (p_recipient, p_actor, p_kind, p_title, left(coalesce(p_body, ''), 500), p_link);
end; $$;

create schema if not exists storage;
grant usage on schema storage to authenticated, anon, service_role;
create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
`;

const SEED = `
insert into auth.users (id, email) values ('${ANNA}', 'anna@example.test'), ('${JUHO}', 'juho@example.test'),
  ('${MARIA}', 'maria@example.test'), ('${JUSSI}', 'jussi@example.test'), ('${PIRJO}', 'pirjo@example.test');
insert into profiles (id, name) values ('${ANNA}', 'Anna Virtanen'), ('${JUHO}', 'Juho Aalto'), ('${MARIA}', 'Maria Kallio'),
  ('${JUSSI}', 'Jussi Toivonen'), ('${PIRJO}', 'Pirjo Salo');
insert into koutsi_coaches (id) values ('${ANNA}'), ('${JUHO}');
insert into koutsi_students (id, display_name, placeholder_coach_id) values ('${MARIA}', null, null), ('${JUSSI}', null, null),
  ('${PH}', 'Pirjo S.', '${ANNA}'), ('${PIRJO}', null, null), ('${PH2}', 'Maria K.', '${ANNA}');
insert into koutsi_coach_students (coach_id, student_id) values ('${ANNA}', '${MARIA}'), ('${ANNA}', '${JUSSI}'), ('${ANNA}', '${PH}'),
  ('${ANNA}', '${PIRJO}'), ('${ANNA}', '${PH2}'), ('${JUHO}', '${MARIA}');
insert into koutsi_seasons (id, coach_id, name, starts_on, ends_on) values
  ('${S1}', '${ANNA}', 'Syksy 2026', '2026-08-17', '2026-12-20'), ('${S2}', '${ANNA}', 'Juniorit syksy', '2026-08-24', '2026-12-13');
insert into koutsi_groups (id, coach_id, name, created_at, season_id) values
  ('${G1}', '${ANNA}', 'Aikuiset', '2026-08-20T10:00:00Z', null),
  ('${G2}', '${ANNA}', 'Juniorit', '2026-08-20T10:00:00Z', '${S2}'),
  ('${G3}', '${ANNA}', 'Perjantai', '2026-08-20T10:00:00Z', null);
insert into koutsi_trainings (id, coach_id, group_id, date, time, type, duration_minutes) values
  ('${T1}', '${ANNA}', '${G1}', '2026-11-03', '17:00', 'Ryhmätreeni', 60),
  ('${T2}', '${ANNA}', '${G1}', '2026-11-10', '17:00', 'Ryhmätreeni', 60),
  ('${T3}', '${ANNA}', '${G2}', '2026-11-04', '17:00', 'Ryhmätreeni', 60);
`;

const db = new PGlite();
await db.exec(STUB);
await db.exec(SEED);
await db.exec(PHASE1);
await db.exec(PHASE2);
await db.exec(PHASE3);
await db.exec(`insert into koutsi_billing_coaches (coach_id) values ('${ANNA}');
  insert into koutsi_billers (coach_id, name, iban, payers) values ('${ANNA}', 'Anna Virtanen Tennis', 'FI2112345600000785',
    '{"${PH}": {"name": "Pirjon äiti", "email": "aiti@example.test"}, "${PH2}": {"name": "Marian isä", "email": "isa@example.test"}}');`);

/** Runs `sql` as `uid` (authenticated; anon when null; 'service' = service_role) in a transaction. */
async function as(uid, sql) {
  await db.exec('begin');
  try {
    await db.exec(uid === 'service'
      ? `set local role service_role; select set_config('request.jwt.claim.sub', '', true);`
      : uid
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
const all = async (sql) => (await db.query(sql)).rows;
const q = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
const drafts = (list) => `select public.koutsi_create_invoice_drafts('${ANNA}', ${q(list)}) as ids`;
const season = (groupId, date, extra = {}) => ({ kind: 'season', trainingId: null, groupId, date, description: 'Kausimaksu', unitCents: 28000, amountCents: 28000, charged: true, ...extra });
const session = (trainingId, extra = {}) => ({ kind: 'session', trainingId, groupId: G1, date: '2026-11-03', time: '17:00', description: 'Aikuiset', unitCents: 3000, amountCents: 3000, charged: true, ...extra });
const ids = (r) => r.rows[0].ids;

// Before the fixes: a season fee written by the phase-3 app (no season on the line), sent.
const legacy = ids(await as(ANNA, drafts([{ studentId: MARIA, payerName: 'Maria Kallio', lines: [season(G1, '2026-11-03')] }])))[0];
await as(ANNA, `select public.koutsi_send_invoice('${legacy}')`);
// a placeholder's invoices, from before a claim and a merge
const phInvoice = ids(await as(ANNA, drafts([{ studentId: PH, payerName: 'Pirjon äiti', lines: [session(T1)] }])))[0];
await as(ANNA, `select public.koutsi_send_invoice('${phInvoice}')`);
const ph2Invoice = ids(await as(ANNA, drafts([{ studentId: PH2, payerName: 'Marian isä', lines: [session(T2)] }])))[0];

await db.exec(FIXES);
await db.exec(FIXES); // must be re-runnable

test('the season lines written before get their season; sent lines stay fixed', async () => {
  const l = await one(`select period_key from koutsi_invoice_lines where invoice_id = '${legacy}'`);
  assert.equal(l.period_key, S1, 'Aikuiset has no season of its own: Anna\'s season on that day');
  await assert.rejects(db.query(`update koutsi_invoice_lines set amount_cents = 1 where invoice_id = '${legacy}'`), /rivejä ei voi muuttaa/, 'the guard is back on');
});

test('the season key: the group\'s own season, the coach\'s season that day, else the half-year', async () => {
  const k = async (g, d) => (await one(`select public.koutsi_season_key('${g}', '${d}') as k`)).k;
  assert.equal(await k(G2, '2026-11-04'), S2);
  assert.equal(await k(G1, '2026-11-03'), S1);
  assert.equal(await k(G1, '2027-02-02'), '2027-kevat');
  assert.equal(await k(G1, '2027-09-07'), '2027-syksy');
});

test('a season fee once per player, group and season', async () => {
  let r = await as(ANNA, drafts([{ studentId: MARIA, payerName: 'Maria Kallio', lines: [season(G1, '2026-11-10', { periodKey: S1 })] }]));
  assert.match(String(r.error?.message), /jo laskulla/, 'the same season again');
  r = await as(ANNA, drafts([{ studentId: MARIA, payerName: 'Maria Kallio', lines: [season(G1, '2027-02-02', { periodKey: '2027-kevat' })] }]));
  assert.equal(r.error, null, r.error?.message);
  const spring = ids(r)[0];
  assert.equal((await one(`select period_key from koutsi_invoice_lines where invoice_id = '${spring}'`)).period_key, '2027-kevat');
  r = await as(ANNA, drafts([{ studentId: MARIA, payerName: 'Maria Kallio', lines: [season(G1, '2027-03-02')] }]));
  assert.match(String(r.error?.message), /jo laskulla/, 'a line without a season gets it here (the older app)');
  r = await as(ANNA, drafts([{ studentId: JUSSI, payerName: 'Jussi Toivonen', lines: [season(G2, '2026-11-04')] }]));
  assert.equal(r.error, null, r.error?.message);
  assert.equal((await one(`select period_key from koutsi_invoice_lines where invoice_id = '${ids(r)[0]}'`)).period_key, S2);
  await as(ANNA, `delete from koutsi_invoices where id in ('${spring}', '${ids(r)[0]}')`);
});

test('membership history: removed and added back, the weeks between are not membership', async () => {
  await db.exec(`insert into koutsi_group_members (group_id, student_id, created_at) values ('${G1}', '${JUSSI}', '2026-08-21T10:00:00Z')`);
  let r = await as(ANNA, `update koutsi_group_members set ended_at = '2026-10-01T10:00:00Z' where group_id = '${G1}' and student_id = '${JUSSI}'`);
  assert.equal(r.error, null, r.error?.message);
  // groups.addMembers: PostgREST's upsert
  r = await as(ANNA, `insert into koutsi_group_members (group_id, student_id, ended_at) values ('${G1}', '${JUSSI}', null)
    on conflict (group_id, student_id) do update set group_id = excluded.group_id, student_id = excluded.student_id, ended_at = excluded.ended_at`);
  assert.equal(r.error, null, r.error?.message);
  let m = await one(`select created_at, ended_at, rejoined_at, past_periods from koutsi_group_members where group_id = '${G1}' and student_id = '${JUSSI}'`);
  assert.equal(m.ended_at, null);
  assert.ok(m.rejoined_at, 'the new period starts now');
  assert.equal(m.past_periods.length, 1);
  assert.equal(Date.parse(m.past_periods[0].from), Date.parse('2026-08-21T10:00:00Z'));
  assert.equal(Date.parse(m.past_periods[0].until), Date.parse('2026-10-01T10:00:00Z'));
  assert.equal(new Date(m.created_at).toISOString(), '2026-08-21T10:00:00.000Z', 'the first period still starts when they joined');

  // clients cannot write the history or move the start
  r = await as(ANNA, `update koutsi_group_members set past_periods = '[]', rejoined_at = null, created_at = '2026-01-01' where group_id = '${G1}' and student_id = '${JUSSI}'`);
  assert.equal(r.error, null);
  m = await one(`select created_at, rejoined_at, past_periods from koutsi_group_members where group_id = '${G1}' and student_id = '${JUSSI}'`);
  assert.equal(m.past_periods.length, 1);
  assert.ok(m.rejoined_at);
  assert.equal(new Date(m.created_at).toISOString(), '2026-08-21T10:00:00.000Z');
  r = await as(ANNA, `insert into koutsi_group_members (group_id, student_id, past_periods, rejoined_at) values ('${G3}', '${JUSSI}', '[{"from":"2026-01-01","until":"2026-02-01"}]', now())`);
  m = await one(`select rejoined_at, past_periods from koutsi_group_members where group_id = '${G3}' and student_id = '${JUSSI}'`);
  assert.deepEqual([m.rejoined_at, m.past_periods], [null, []], 'a new membership starts with no history');

  // removed twice: it ended the first time
  await as(ANNA, `update koutsi_group_members set ended_at = '2026-10-20T10:00:00Z' where group_id = '${G3}' and student_id = '${JUSSI}'`);
  await as(ANNA, `update koutsi_group_members set ended_at = '2026-11-20T10:00:00Z' where group_id = '${G3}' and student_id = '${JUSSI}'`);
  m = await one(`select ended_at from koutsi_group_members where group_id = '${G3}' and student_id = '${JUSSI}'`);
  assert.equal(new Date(m.ended_at).toISOString(), '2026-10-20T10:00:00.000Z');

  r = await as(ANNA, `select group_id, rejoined_at is not null as back, jsonb_array_length(past_periods) as periods
    from public.koutsi_billing_memberships('${ANNA}') where student_id = '${JUSSI}' order by group_id`);
  assert.deepEqual(r.rows, [{ group_id: G1, back: true, periods: 1 }, { group_id: G3, back: false, periods: 0 }]);
  r = await as(JUHO, `select * from public.koutsi_billing_memberships('${ANNA}')`);
  assert.equal(r.rows.length, 0, 'not another coach\'s');
});

test('a claim: invoices and payer follow even when the account was already the coach\'s; left groups stay left', async () => {
  await db.exec(`insert into koutsi_group_members (group_id, student_id, created_at, ended_at) values
      ('${G1}', '${PH}', '2026-09-01T10:00:00Z', null),
      ('${G2}', '${PH}', '2026-09-01T10:00:00Z', '2026-10-01T10:00:00Z'),
      ('${G1}', '${PIRJO}', '2026-08-21T10:00:00Z', '2026-08-30T10:00:00Z');`);
  // the same session on both (billed twice as two people): that one invoice cannot move, the claim still goes
  const [both] = ids(await as(ANNA, drafts([{ studentId: PH, payerName: 'Pirjon äiti', lines: [session(T2)] }])));
  await as(ANNA, drafts([{ studentId: PIRJO, payerName: 'Pirjo Salo', lines: [session(T2)] }]));
  const r = await as(PIRJO, `select public.koutsi_claim_player('ANNA01', '${PH}') as res`);
  assert.equal(r.error, null, r.error?.message);
  assert.equal((await one(`select student_id from koutsi_invoices where id = '${both}'`)).student_id, null);
  const inv = await one(`select student_id, status from koutsi_invoices where id = '${phInvoice}'`);
  assert.deepEqual(inv, { student_id: PIRJO, status: 'sent' }, 'the invoice did not lose its player');
  assert.deepEqual((await all(`select distinct student_id from koutsi_invoice_lines where invoice_id = '${phInvoice}'`)).map((x) => x.student_id), [PIRJO]);
  const payers = (await one(`select payers from koutsi_billers where coach_id = '${ANNA}'`)).payers;
  assert.equal(payers[PH], undefined);
  assert.equal(payers[PIRJO].name, 'Pirjon äiti', 'the payer the coach wrote down follows');

  const rows = await all(`select group_id, ended_at, rejoined_at, past_periods, created_at from koutsi_group_members where student_id = '${PIRJO}' order by group_id`);
  assert.equal(rows.length, 2);
  const [g1, g2] = rows;
  assert.equal(g1.group_id, G1);
  assert.equal(g1.ended_at, null, 'active on either: active');
  assert.equal(new Date(g1.created_at).toISOString(), '2026-08-21T10:00:00.000Z');
  assert.equal(new Date(g1.rejoined_at).toISOString(), '2026-09-01T10:00:00.000Z', 'the current period is the placeholder\'s');
  assert.deepEqual(g1.past_periods.map((p) => [new Date(p.from).toISOString(), new Date(p.until).toISOString()]),
    [['2026-08-21T10:00:00.000Z', '2026-08-30T10:00:00.000Z']], 'Pirjo\'s own earlier period is kept');
  assert.equal(g2.group_id, G2);
  assert.ok(g2.ended_at, 'the group the placeholder had left stays left');
  assert.equal((await one(`select count(*)::int as n from koutsi_group_members where student_id = '${PH}'`)).n, 0);
});

test('a merge: the duplicate\'s invoices and payer go to the kept player; left groups stay left', async () => {
  await db.exec(`insert into koutsi_group_members (group_id, student_id, created_at, ended_at) values
      ('${G2}', '${PH2}', '2026-09-01T10:00:00Z', '2026-09-15T10:00:00Z'),
      ('${G3}', '${PH2}', '2026-09-01T10:00:00Z', null);`);
  const r = await as(ANNA, `select public.koutsi_merge_students('${ANNA}', '${MARIA}', '${PH2}') as res`);
  assert.equal(r.error, null, r.error?.message);
  assert.equal((await one(`select student_id from koutsi_invoices where id = '${ph2Invoice}'`)).student_id, MARIA, 'the draft follows');
  const payers = (await one(`select payers from koutsi_billers where coach_id = '${ANNA}'`)).payers;
  assert.equal(payers[MARIA].name, 'Marian isä');
  assert.equal(payers[PH2], undefined);
  const rows = await all(`select group_id, ended_at is not null as ended from koutsi_group_members where student_id = '${MARIA}' order by group_id`);
  assert.deepEqual(rows, [{ group_id: G2, ended: true }, { group_id: G3, ended: false }]);
});

test('the players who have left: for the coach with Laskutus only', async () => {
  await db.exec(`update koutsi_coach_students set ended_at = now() where coach_id = '${ANNA}' and student_id = '${JUSSI}'`);
  let r = await as(ANNA, `select student_id, name, is_placeholder from public.koutsi_billing_students('${ANNA}')`);
  assert.deepEqual(r.rows, [{ student_id: JUSSI, name: 'Jussi Toivonen', is_placeholder: false }], 'only the ended ones');
  r = await as(JUHO, `select * from public.koutsi_billing_students('${ANNA}')`);
  assert.equal(r.rows.length, 0);
  r = await as(JUHO, `select * from public.koutsi_billing_students('${JUHO}')`);
  assert.equal(r.rows.length, 0, 'no Laskutus, nothing');
  r = await as(null, `select * from public.koutsi_billing_students('${ANNA}')`);
  assert.ok(r.error, 'not for anon');
  await db.exec(`update koutsi_coach_students set ended_at = null where coach_id = '${ANNA}' and student_id = '${JUSSI}'`);
});

test('void: never an invoice paid online; a payment that comes after voiding is kept and told', async () => {
  const [a, b] = ids(await as(ANNA, drafts([
    { studentId: MARIA, payerName: 'Maria Kallio', lines: [session(T1, { trainingId: null, kind: 'manual', groupId: null, description: 'Pallot' })] },
    { studentId: JUSSI, payerName: 'Jussi Toivonen', lines: [session(T2, { trainingId: null, kind: 'manual', groupId: null, description: 'Leiri' })] },
  ])));
  await as(ANNA, `select public.koutsi_send_invoices(array['${a}', '${b}']::uuid[])`);
  let r = await as('service', `select public.koutsi_invoice_paid_online('${a}', 'cs_test_a', 'pi_a') as ok`);
  assert.equal(r.rows[0].ok, true);
  r = await as(ANNA, `select public.koutsi_void_invoice('${a}')`);
  assert.match(String(r.error?.message), /Verkossa maksettua laskua ei voi mitätöidä/);

  r = await as(ANNA, `select public.koutsi_void_invoice('${b}')`);
  assert.equal(r.error, null, r.error?.message);
  await db.exec(`delete from koutsi_notifications`);
  r = await as(ANNA, `select public.koutsi_invoice_late_payment('${b}', 'cs_test_b', 'pi_b') as ok`);
  assert.ok(r.error, 'the edge function\'s only');
  r = await as('service', `select public.koutsi_invoice_late_payment('${b}', 'cs_test_b', 'pi_b') as ok`);
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.rows[0].ok, true);
  const row = await one(`select status, stripe_payment_intent, paid_via from koutsi_invoices where id = '${b}'`);
  assert.deepEqual(row, { status: 'void', stripe_payment_intent: 'pi_b', paid_via: null }, 'stored, the invoice stays void');
  const note = await one(`select title, body, link_path from koutsi_notifications where recipient_id = '${ANNA}'`);
  assert.match(note.title, /^Lasku \d+ maksettiin verkossa$/);
  assert.match(note.body, /^Jussi Toivonen, 30,00 €\. Lasku oli jo mitätöity\.$/);
  assert.ok(!note.body.includes('·'));
  r = await as('service', `select public.koutsi_invoice_late_payment('${b}', 'cs_test_b', 'pi_b') as ok`);
  assert.equal(r.rows[0].ok, false, 'once');
  r = await as('service', `select public.koutsi_invoice_late_payment('${a}', 'cs_test_a', 'pi_a') as ok`);
  assert.equal(r.rows[0].ok, false, 'paid online is not late');
  assert.equal((await one(`select count(*)::int as n from koutsi_notifications`)).n, 1);
});

test('Muistuta: "eräpäivä on" until the due date, "oli" after it', async () => {
  const [inv] = ids(await as(ANNA, drafts([{ studentId: MARIA, payerName: 'Maria Kallio', lines: [session(null, { trainingId: null, kind: 'manual', groupId: null, description: 'Tunti' })] }])));
  await as(ANNA, `select public.koutsi_send_invoice('${inv}')`);
  await db.exec(`delete from koutsi_notifications`);
  let r = await as(ANNA, `select public.koutsi_remind_invoice('${inv}') as ok`);
  assert.equal(r.rows[0].ok, true);
  let note = await one(`select body from koutsi_notifications where recipient_id = '${MARIA}'`);
  assert.match(note.body, /^Anna Virtanen Tennis, eräpäivä on \d{1,2}\.\d{1,2}\.\d{4}$/);
  // past due (the guard is off only to move the date for the check)
  await db.exec(`alter table koutsi_invoices disable trigger koutsi_invoices_guard;
    update koutsi_invoices set due_date = current_date - 3, reminded_at = null where id = '${inv}';
    alter table koutsi_invoices enable trigger koutsi_invoices_guard;
    delete from koutsi_notifications;`);
  r = await as(ANNA, `select public.koutsi_remind_invoice('${inv}') as ok`);
  note = await one(`select body from koutsi_notifications where recipient_id = '${MARIA}'`);
  assert.match(note.body, /^Anna Virtanen Tennis, eräpäivä oli \d{1,2}\.\d{1,2}\.\d{4}$/);
});

test('a group\'s new weekly time: the same delete + insert, and the "En pääse" reports move to the same week', async () => {
  const day = async (n) => (await one(`select ((now() at time zone 'Europe/Helsinki')::date + ${n})::text as d`)).d;
  // next week's Monday and the week after it (Tuesday sessions move to Thursdays)
  const monday = await day(`(8 - extract(isodow from (now() at time zone 'Europe/Helsinki')::date)::int)`);
  const plus = async (n) => (await one(`select ('${monday}'::date + ${n})::text as d`)).d;
  const oldA = (await one(`insert into koutsi_trainings (coach_id, group_id, date, time, type, series_id) values ('${ANNA}', '${G1}', '${await plus(1)}', '17:00', 'Ryhmätreeni', gen_random_uuid()) returning id`)).id;
  const oldB = (await one(`insert into koutsi_trainings (coach_id, group_id, date, time, type) values ('${ANNA}', '${G1}', '${await plus(8)}', '17:00', 'Ryhmätreeni') returning id`)).id;
  const past = (await one(`insert into koutsi_trainings (coach_id, group_id, date, time, type) values ('${ANNA}', '${G1}', '${await day(-7)}', '17:00', 'Ryhmätreeni') returning id`)).id;
  // Maria said "En pääse" herself two days ago; the coach marked Pirjo away
  await as(MARIA, `insert into koutsi_training_absences (training_id, student_id, created_at) values ('${oldA}', '${MARIA}', now() - interval '2 days')`);
  await as(ANNA, `insert into koutsi_training_absences (training_id, student_id) values ('${oldB}', '${PIRJO}')`);
  const before = await all(`select student_id, reported_by, created_at from koutsi_training_absences where training_id in ('${oldA}', '${oldB}') order by student_id`);
  await db.exec('delete from event_log');

  let r = await as(JUHO, `select public.koutsi_reschedule_group('${G1}', array['${oldA}', '${oldB}']::uuid[], array['${await plus(3)}']::date[], '18:00', 60) as res`);
  assert.ok(r.error, 'not another coach\'s group');
  r = await as(ANNA, `select public.koutsi_reschedule_group('${G1}', array[]::uuid[], array['2020-01-01']::date[], '18:00', 60) as res`);
  assert.match(String(r.error?.message), /Tarkista treenien päivät/);

  r = await as(ANNA, `select public.koutsi_reschedule_group('${G1}', array['${oldA}', '${oldB}', '${past}']::uuid[],
    array['${await plus(3)}', '${await plus(10)}', '${await plus(17)}']::date[], '18:00', 75) as res`);
  assert.equal(r.error, null, r.error?.message);
  const res = r.rows[0].res;
  assert.equal(res.count, 3);
  assert.equal(res.carried, 2);
  assert.equal((await one(`select count(*)::int as n from koutsi_trainings where id in ('${oldA}', '${oldB}')`)).n, 0, 'the old ones are gone');
  assert.equal((await one(`select count(*)::int as n from koutsi_trainings where id = '${past}'`)).n, 1, 'a past session is never touched');
  const fresh = await all(`select id, date::text as date, time::text as time, duration_minutes, type from koutsi_trainings where series_id = '${res.seriesId}' order by date`);
  assert.deepEqual(fresh.map((t) => [t.date, t.time, t.duration_minutes, t.type]), [
    [await plus(3), '18:00:00', 75, 'Ryhmätreeni'], [await plus(10), '18:00:00', 75, 'Ryhmätreeni'], [await plus(17), '18:00:00', 75, 'Ryhmätreeni'],
  ]);
  const after = await all(`select a.student_id, a.reported_by, a.created_at, t.date::text as date from koutsi_training_absences a
    join koutsi_trainings t on t.id = a.training_id where t.series_id = '${res.seriesId}' order by a.student_id`);
  assert.deepEqual(after.map((a) => [a.student_id, a.reported_by, new Date(a.created_at).toISOString(), a.date]), [
    [MARIA, MARIA, new Date(before[0].created_at).toISOString(), await plus(3)],
    [PIRJO, ANNA, new Date(before[1].created_at).toISOString(), await plus(10)],
  ], 'who reported it and when are kept; each lands in its own week');
  const log = (await all(`select what from event_log order by n`)).map((x) => x.what);
  assert.deepEqual(log, ['cancelled', 'cancelled', 'added', 'added', 'added'], 'the same notifications, deletes first; no new "ei pääse"');

  // the stamp works as before outside the carry
  await as(MARIA, `insert into koutsi_training_absences (training_id, student_id, reported_by) values ('${fresh[2].id}', '${MARIA}', '${ANNA}')`);
  assert.equal((await one(`select reported_by from koutsi_training_absences where training_id = '${fresh[2].id}'`)).reported_by, MARIA);
});
