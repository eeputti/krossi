// 20261110130000_koutsi_billing_pay.check.mjs — runs the phase-1 Laskutus migration
// (supabase/migrations/20261029162350_koutsi_billing.sql) and then the proposed phase 2
// (koutsi/web/sql/20261110130000_koutsi_billing_pay.sql, NOT applied) in PGlite against a small
// stub of production's Koutsi schema, and checks the payment columns' rights, the guard, paying
// online once, paying by hand, and what the invoice link and the player see.
// PGlite is not a dependency of the repo, so this is not part of `npm run test:koutsi`. To run it:
//   (in an empty temp folder) npm i @electric-sql/pglite@0.3
//   PGLITE=<that folder>/node_modules/@electric-sql/pglite/dist/index.js node --test koutsi/web/sql/20261110130000_koutsi_billing_pay.check.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite');

const here = dirname(fileURLToPath(import.meta.url));
const PHASE1 = await readFile(join(here, '../../../supabase/migrations/20261029162350_koutsi_billing.sql'), 'utf8');
const PHASE2 = await readFile(join(here, '20261110130000_koutsi_billing_pay.sql'), 'utf8');

const ANNA = '00000000-0000-4000-8000-0000000000a1'; // coach, Laskutus on
const JUHO = '00000000-0000-4000-8000-0000000000b1'; // coach, Laskutus off
const MARIA = '00000000-0000-4000-8000-000000000001'; // Anna's player, has an account
const JUSSI = '00000000-0000-4000-8000-000000000002'; // Anna's player, has an account
const G1 = '00000000-0000-4000-8000-0000000000c1';
const T1 = '00000000-0000-4000-8000-0000000000d1';
const T2 = '00000000-0000-4000-8000-0000000000d2';

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
create table public.koutsi_coaches (id uuid primary key);
create table public.koutsi_students (id uuid primary key, name text);
create table public.koutsi_coach_students (
  coach_id uuid not null references public.koutsi_coaches(id) on delete cascade,
  student_id uuid not null references public.koutsi_students(id) on delete cascade,
  ended_at timestamptz, created_at timestamptz not null default now(),
  primary key (coach_id, student_id));
create table public.koutsi_groups (id uuid primary key, coach_id uuid not null references public.koutsi_coaches(id) on delete cascade,
  name text not null, created_at timestamptz not null default now());
create table public.koutsi_group_members (group_id uuid not null references public.koutsi_groups(id) on delete cascade,
  student_id uuid not null references public.koutsi_students(id) on delete cascade,
  ended_at timestamptz, created_at timestamptz not null default now(), primary key (group_id, student_id));
create table public.koutsi_trainings (id uuid primary key, coach_id uuid not null references public.koutsi_coaches(id) on delete cascade,
  group_id uuid references public.koutsi_groups(id) on delete cascade, student_id uuid, date date not null, time time not null,
  type text not null, duration_minutes integer, logged_by text not null default 'coach');
create table public.koutsi_notifications (id uuid primary key default gen_random_uuid(), recipient_id uuid not null, actor_id uuid,
  kind text not null, title text not null, body text, link_path text, created_at timestamptz not null default now(),
  read_at timestamptz, email_status text not null default 'pending');

create function public.koutsi_is_admin() returns boolean language sql stable security definer set search_path to '' as $$
  select (select auth.uid()) is not null and exists (select 1 from public.koutsi_admins a where a.user_id = (select auth.uid())); $$;
create function public.koutsi_acts_as(target uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select target is not null and (target = (select auth.uid()) or public.koutsi_is_admin()); $$;
create function public.koutsi_notify(p_recipient uuid, p_actor uuid, p_kind text, p_title text, p_body text, p_link text) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if p_recipient is null or p_recipient = p_actor then return; end if;
  if not exists (select 1 from auth.users u where u.id = p_recipient) then return; end if;
  insert into koutsi_notifications (recipient_id, actor_id, kind, title, body, link_path)
  values (p_recipient, p_actor, p_kind, p_title, left(coalesce(p_body, ''), 500), p_link);
end; $$;
`;

const SEED = `
insert into auth.users (id, email) values ('${ANNA}', 'anna@example.test'), ('${JUHO}', 'juho@example.test'),
  ('${MARIA}', 'maria@example.test'), ('${JUSSI}', 'jussi@example.test');
insert into koutsi_coaches (id) values ('${ANNA}'), ('${JUHO}');
insert into koutsi_students (id, name) values ('${MARIA}', 'Maria K.'), ('${JUSSI}', 'Jussi T.');
insert into koutsi_coach_students (coach_id, student_id) values ('${ANNA}', '${MARIA}'), ('${ANNA}', '${JUSSI}');
insert into koutsi_groups (id, coach_id, name) values ('${G1}', '${ANNA}', 'Aikuiset');
insert into koutsi_group_members (group_id, student_id) values ('${G1}', '${MARIA}'), ('${G1}', '${JUSSI}');
insert into koutsi_trainings (id, coach_id, group_id, date, time, type, duration_minutes) values
  ('${T1}', '${ANNA}', '${G1}', '2026-11-03', '17:00', 'Ryhmätreeni', 60),
  ('${T2}', '${ANNA}', '${G1}', '2026-11-10', '17:00', 'Ryhmätreeni', 60);
`;

const db = new PGlite();
await db.exec(STUB);
await db.exec(SEED);
await db.exec(PHASE1);
await db.exec(PHASE2);
await db.exec(PHASE2); // must be re-runnable
await db.exec(`insert into koutsi_billing_coaches (coach_id) values ('${ANNA}')`);

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
const line = (trainingId, amountCents) => ({ kind: 'session', trainingId, date: '2026-11-03', time: '17:00', description: 'Aikuiset', unitCents: amountCents, amountCents, charged: true });
const drafts = (list) => `select public.koutsi_create_invoice_drafts('${ANNA}', '${JSON.stringify(list)}'::jsonb) as ids`;

test('the coach writes their own details and pay_online, never the Stripe columns', async () => {
  let r = await as(ANNA, `insert into koutsi_billers (coach_id, name, iban, stripe_account_id, stripe_charges_enabled)
    values ('${ANNA}', 'Anna', 'FI2112345600000785', 'acct_x', true)`);
  assert.ok(r.error, 'no Stripe columns on insert');
  r = await as(ANNA, `insert into koutsi_billers (coach_id, name, iban) values ('${ANNA}', 'Anna Virtanen Tennis', 'FI2112345600000785')`);
  assert.equal(r.error, null, r.error?.message);
  r = await as(ANNA, `update koutsi_billers set stripe_charges_enabled = true where coach_id = '${ANNA}'`);
  assert.ok(r.error, 'no Stripe columns on update');
  r = await as(ANNA, `update koutsi_billers set pay_online = false, name = 'Anna V. Tennis' where coach_id = '${ANNA}' returning name, pay_online`);
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(r.rows[0], { name: 'Anna V. Tennis', pay_online: false });
  // the app's upsert (insert … on conflict do update) still works
  r = await as(ANNA, `insert into koutsi_billers (coach_id, name, iban, pay_online) values ('${ANNA}', 'Anna Virtanen Tennis', 'FI2112345600000785', true)
    on conflict (coach_id) do update set coach_id = excluded.coach_id, name = excluded.name, iban = excluded.iban, pay_online = excluded.pay_online returning name`);
  assert.equal(r.error, null, r.error?.message);
  r = await as(ANNA, `select stripe_account_id, stripe_charges_enabled from koutsi_billers`);
  assert.deepEqual(r.rows[0], { stripe_account_id: null, stripe_charges_enabled: false }, 'the coach can read them');
  // the edge function (service role) can
  await db.query(`update koutsi_billers set stripe_account_id = 'acct_anna', stripe_details_submitted = true where coach_id = '${ANNA}'`);
});

test('the link says when the invoice can be paid online; the player sees whether the coach takes payments', async () => {
  let r = await as(ANNA, drafts([{ studentId: MARIA, payerName: 'Maria K.', lines: [line(T1, 3000)] }, { studentId: JUSSI, payerName: 'Jussi T.', lines: [line(T1, 3000), line(T2, 3000)] }]));
  assert.equal(r.error, null, r.error?.message);
  const [mariaId, jussiId] = r.rows[0].ids;
  const draft = await one(`select checkout_session_id, paid_via from koutsi_invoices where id = '${mariaId}'`);
  assert.deepEqual(draft, { checkout_session_id: null, paid_via: null });
  await db.query(`update koutsi_invoices set checkout_session_id = 'cs_draft' where id = '${mariaId}'`);
  assert.equal((await one(`select checkout_session_id from koutsi_invoices where id = '${mariaId}'`)).checkout_session_id, null, 'a draft keeps no session');
  r = await as(ANNA, `select public.koutsi_send_invoices(array['${mariaId}', '${jussiId}']::uuid[])`);
  assert.equal(r.error, null, r.error?.message);
  const token = (await one(`select public_token from koutsi_invoices where id = '${mariaId}'`)).public_token;
  const payable = async () => (await as(null, `select public.koutsi_invoice_public('${token}') as d`)).rows[0].d.payable;
  assert.equal(await payable(), false, 'not before the account takes payments');
  r = await as(MARIA, `select coach_id, pay_online from public.koutsi_my_billing_terms()`);
  assert.deepEqual(r.rows, [{ coach_id: ANNA, pay_online: false }]);
  await db.query(`update koutsi_billers set stripe_charges_enabled = true where coach_id = '${ANNA}'`);
  assert.equal(await payable(), true);
  r = await as(MARIA, `select pay_online from public.koutsi_my_billing_terms()`);
  assert.equal(r.rows[0].pay_online, true);
  await as(ANNA, `update koutsi_billers set pay_online = false where coach_id = '${ANNA}'`);
  assert.equal(await payable(), false, 'the coach turned it off');
  await as(ANNA, `update koutsi_billers set pay_online = true where coach_id = '${ANNA}'`);
  assert.equal(await payable(), true);

  // the edge function stores the Checkout session on the sent invoice; nothing else may move
  await db.query(`update koutsi_invoices set checkout_session_id = 'cs_1' where id = '${mariaId}'`);
  assert.equal((await one(`select checkout_session_id from koutsi_invoices where id = '${mariaId}'`)).checkout_session_id, 'cs_1');
  await assert.rejects(db.query(`update koutsi_invoices set payer_name = 'X', checkout_session_id = 'cs_2' where id = '${mariaId}'`), /ei voi muuttaa/);
  r = await as(ANNA, `update koutsi_invoices set checkout_session_id = 'cs_evil' where id = '${mariaId}' returning id`);
  assert.equal(r.rows.length, 0, 'clients cannot touch a sent invoice');
});

test('paid online: once, by the edge function only, and the coach hears about it', async () => {
  const inv = await one(`select id, number from koutsi_invoices where student_id = '${MARIA}'`);
  let r = await as(ANNA, `select public.koutsi_invoice_paid_online('${inv.id}', 'cs_1', 'pi_1') as ok`);
  assert.ok(r.error, 'not callable by clients');
  r = await as(MARIA, `select public.koutsi_invoice_paid_online('${inv.id}', 'cs_1', 'pi_1') as ok`);
  assert.ok(r.error, 'not by the payer either');
  assert.equal((await one(`select public.koutsi_invoice_paid_online('${inv.id}', 'cs_1', 'pi_1') as ok`)).ok, true);
  assert.equal((await one(`select public.koutsi_invoice_paid_online('${inv.id}', 'cs_1', 'pi_1') as ok`)).ok, false, 'a second confirmation changes nothing');
  const paid = await one(`select status, paid_via, stripe_payment_intent, paid_at is not null as at from koutsi_invoices where id = '${inv.id}'`);
  assert.deepEqual(paid, { status: 'paid', paid_via: 'stripe', stripe_payment_intent: 'pi_1', at: true });
  const notes = (await db.query(`select title, body, link_path from koutsi_notifications where recipient_id = '${ANNA}' and kind = 'invoice_paid'`)).rows;
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, `Lasku ${inv.number} maksettu`);
  assert.equal(notes[0].body, 'Maria K. · 30,00 €');
  assert.equal(notes[0].link_path, `/valmentaja/laskutus?lasku=${inv.id}`);
  r = await as(ANNA, `select public.koutsi_set_invoice_paid('${inv.id}', false)`);
  assert.match(String(r.error?.message), /maksettu verkossa/, 'an online payment is refunded in Stripe, not unticked');
  const token = (await one(`select public_token from koutsi_invoices where id = '${inv.id}'`)).public_token;
  r = await as(null, `select public.koutsi_invoice_public('${token}') as d`);
  assert.deepEqual([r.rows[0].d.payable, r.rows[0].d.paidVia, r.rows[0].d.status], [false, 'stripe', 'paid']);
});

test('paid by hand: marked manual, and can be undone', async () => {
  const inv = await one(`select id from koutsi_invoices where student_id = '${JUSSI}'`);
  let r = await as(ANNA, `select public.koutsi_set_invoice_paid('${inv.id}', true)`);
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(await one(`select status, paid_via from koutsi_invoices where id = '${inv.id}'`), { status: 'paid', paid_via: 'manual' });
  assert.equal((await one(`select public.koutsi_invoice_paid_online('${inv.id}', 'cs_x', 'pi_x') as ok`)).ok, false, 'already paid');
  r = await as(ANNA, `select public.koutsi_set_invoice_paid('${inv.id}', false)`);
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(await one(`select status, paid_via from koutsi_invoices where id = '${inv.id}'`), { status: 'sent', paid_via: null });
  r = await as(JUHO, `select public.koutsi_set_invoice_paid('${inv.id}', true)`);
  assert.ok(r.error, 'not another coach');
});
