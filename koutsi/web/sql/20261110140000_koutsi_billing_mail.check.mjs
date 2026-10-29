// 20261110140000_koutsi_billing_mail.check.mjs — runs Laskutus phases 1–2 (supabase/migrations) and the
// proposed phase 3 (koutsi/web/sql/20261110140000_koutsi_billing_mail.sql, NOT applied) in PGlite against a
// small stub of production's schema (incl. a storage stub), and checks the coach's message on drafts, the mail
// columns, the logo (column, path rule, its folder in the bucket), reminders and "En tarvitse laskutusta vielä".
// PGlite is not a dependency of the repo, so this is not part of `npm run test:koutsi`. To run it:
//   (in an empty temp folder) npm i @electric-sql/pglite@0.3
//   PGLITE=<that folder>/node_modules/@electric-sql/pglite/dist/index.js node --test koutsi/web/sql/20261110140000_koutsi_billing_mail.check.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite');

const here = dirname(fileURLToPath(import.meta.url));
const PHASE1 = await readFile(join(here, '../../../supabase/migrations/20261029162350_koutsi_billing.sql'), 'utf8');
const PHASE2 = await readFile(join(here, '../../../supabase/migrations/20261029185432_koutsi_billing_pay.sql'), 'utf8');
const PHASE3 = await readFile(join(here, '20261110140000_koutsi_billing_mail.sql'), 'utf8');

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

create schema if not exists storage;
grant usage on schema storage to authenticated, anon, service_role;
create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null, owner uuid);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant execute on function storage.foldername(text) to authenticated, anon;
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
await db.exec(PHASE3);
await db.exec(PHASE3); // must be re-runnable
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

test('the logo: a path in the coach\'s own folder, written by the coach; the bucket only takes their folder', async () => {
  let r = await as(ANNA, `insert into koutsi_billers (coach_id, name, iban, logo_path) values ('${ANNA}', 'Anna Virtanen Tennis', 'FI2112345600000785', '${ANNA}/logo-1.png')`);
  assert.equal(r.error, null, r.error?.message);
  r = await as(ANNA, `update koutsi_billers set logo_path = '../evil.png' where coach_id = '${ANNA}'`);
  assert.ok(r.error, 'only <coach id>/<file name>');
  r = await as(ANNA, `update koutsi_billers set stripe_charges_enabled = true where coach_id = '${ANNA}'`);
  assert.ok(r.error, 'the Stripe columns stay the edge function\'s');
  assert.equal((await one(`select public from storage.buckets where id = 'koutsi-logos'`)).public, true);
  r = await as(ANNA, `insert into storage.objects (bucket_id, name) values ('koutsi-logos', '${ANNA}/logo-1.png')`);
  assert.equal(r.error, null, r.error?.message);
  r = await as(ANNA, `insert into storage.objects (bucket_id, name) values ('koutsi-logos', '${JUHO}/logo-1.png')`);
  assert.ok(r.error, 'not into another coach\'s folder');
  r = await as(JUHO, `delete from storage.objects where name = '${ANNA}/logo-1.png' returning id`);
  assert.equal(r.rows.length, 0, 'nor delete it');
});

test('the coach\'s message: on drafts only, trimmed, and on the link; the logo goes with the sent invoice', async () => {
  let r = await as(ANNA, drafts([{ studentId: MARIA, payerName: 'Maria K.', lines: [line(T1, 3000)] }, { studentId: JUSSI, payerName: 'Jussi T.', payerEmail: 'aiti@example.test', lines: [line(T1, 3000), line(T2, 2500)] }]));
  assert.equal(r.error, null, r.error?.message);
  const [mariaId, jussiId] = r.rows[0].ids;
  r = await as(ANNA, `update koutsi_invoices set note = '  Kiitos syksystä!  ' where id = '${mariaId}' returning note`);
  assert.equal(r.rows[0].note, 'Kiitos syksystä!');
  r = await as(ANNA, `update koutsi_invoices set note = '${'x'.repeat(501)}' where id = '${mariaId}'`);
  assert.ok(r.error, 'at most 500 characters');
  await db.query(`update koutsi_invoices set mailed_at = now(), mail_to = 'x@example.test' where id = '${mariaId}'`);
  assert.deepEqual(await one(`select mailed_at, mail_to from koutsi_invoices where id = '${mariaId}'`), { mailed_at: null, mail_to: null }, 'a draft is not mailed');
  r = await as(ANNA, `select public.koutsi_send_invoices(array['${mariaId}', '${jussiId}']::uuid[])`);
  assert.equal(r.error, null, r.error?.message);
  const sent = await one(`select seller, note, public_token from koutsi_invoices where id = '${mariaId}'`);
  assert.equal(sent.seller.logoPath, `${ANNA}/logo-1.png`);
  assert.equal(sent.note, 'Kiitos syksystä!');
  r = await as(null, `select public.koutsi_invoice_public('${sent.public_token}') as d`);
  assert.equal(r.rows[0].d.note, 'Kiitos syksystä!');
  assert.equal(r.rows[0].d.seller.logoPath, `${ANNA}/logo-1.png`);
  await assert.rejects(db.query(`update koutsi_invoices set note = 'muutettu' where id = '${mariaId}'`), /ei voi muuttaa/, 'the message is part of a sent invoice');
  await db.query(`update koutsi_invoices set mailed_at = now(), mail_to = 'aiti@example.test' where id = '${jussiId}'`);
  assert.equal((await one(`select mail_to from koutsi_invoices where id = '${jussiId}'`)).mail_to, 'aiti@example.test', 'the edge function records the e-mail');
  // a later logo doesn't change a sent invoice
  await as(ANNA, `update koutsi_billers set logo_path = '${ANNA}/logo-2.png' where coach_id = '${ANNA}'`);
  assert.equal((await one(`select seller from koutsi_invoices where id = '${mariaId}'`)).seller.logoPath, `${ANNA}/logo-1.png`);
});

test('a reminder: the coach\'s open invoices, once a day, and the player hears it', async () => {
  const inv = await one(`select id, number from koutsi_invoices where student_id = '${MARIA}'`);
  let r = await as(JUHO, `select public.koutsi_remind_invoice('${inv.id}') as ok`);
  assert.ok(r.error, 'not another coach');
  r = await as(ANNA, `select public.koutsi_remind_invoice('${inv.id}') as ok`);
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.rows[0].ok, true);
  const note = await one(`select title, link_path from koutsi_notifications where recipient_id = '${MARIA}' and title like 'Muistutus%'`);
  assert.equal(note.title, `Muistutus: lasku ${inv.number} (30,00 €)`);
  assert.equal(note.link_path, `/pelaaja/laskut/${inv.id}`);
  r = await as(ANNA, `select public.koutsi_remind_invoice('${inv.id}') as ok`);
  assert.equal(r.rows[0].ok, false, 'not twice in a day');
  assert.equal((await one(`select count(*)::int as n from koutsi_notifications where title like 'Muistutus%'`)).n, 1);
  await as(ANNA, `select public.koutsi_set_invoice_paid('${inv.id}', true)`);
  r = await as(ANNA, `select public.koutsi_remind_invoice('${inv.id}') as ok`);
  assert.match(String(r.error?.message), /avoimesta laskusta/, 'a paid invoice needs no reminder');
});

test('"En tarvitse laskutusta vielä": the coach\'s own setting', async () => {
  let r = await as(ANNA, `insert into koutsi_billing_prefs (coach_id, hidden) values ('${ANNA}', true) on conflict (coach_id) do update set hidden = excluded.hidden returning hidden`);
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.rows[0].hidden, true);
  r = await as(ANNA, `update koutsi_billing_prefs set hidden = false where coach_id = '${ANNA}' returning hidden`);
  assert.equal(r.rows[0].hidden, false);
  r = await as(JUHO, `select * from koutsi_billing_prefs`);
  assert.equal(r.rows.length, 0, 'nobody else reads it');
  r = await as(JUHO, `insert into koutsi_billing_prefs (coach_id, hidden) values ('${ANNA}', true)`);
  assert.ok(r.error, 'nor writes it');
  r = await as(null, `select * from koutsi_billing_prefs`);
  assert.ok(r.error || r.rows.length === 0);
});

test('Klarna: on the link and in the player\'s terms only when the account takes it; a payment\'s notice has no "·"', async () => {
  const inv = await one(`select id, number, public_token from koutsi_invoices where student_id = '${JUSSI}'`);
  let r = await as(ANNA, `update koutsi_billers set stripe_methods = array['card', 'klarna'] where coach_id = '${ANNA}'`);
  assert.ok(r.error, 'the Stripe columns stay the edge function\'s');
  await db.query(`update koutsi_billers set stripe_account_id = 'acct_1', stripe_charges_enabled = true, stripe_methods = array['card', 'mobilepay'] where coach_id = '${ANNA}'`);
  r = await as(null, `select public.koutsi_invoice_public('${inv.public_token}') as d`);
  assert.equal(r.rows[0].d.payable, true);
  assert.equal(r.rows[0].d.klarna, false);
  r = await as(JUSSI, `select pay_online, klarna from public.koutsi_my_billing_terms()`);
  assert.deepEqual(r.rows[0], { pay_online: true, klarna: false });
  await db.query(`update koutsi_billers set stripe_methods = array['card', 'mobilepay', 'klarna'] where coach_id = '${ANNA}'`);
  r = await as(null, `select public.koutsi_invoice_public('${inv.public_token}') as d`);
  assert.equal(r.rows[0].d.klarna, true);
  r = await as(JUSSI, `select klarna from public.koutsi_my_billing_terms()`);
  assert.equal(r.rows[0].klarna, true);
  assert.equal((await one(`select public.koutsi_invoice_paid_online('${inv.id}', 'cs_test_1', 'pi_1') as ok`)).ok, true);
  const note = await one(`select title, body from koutsi_notifications where recipient_id = '${ANNA}' and kind = 'invoice_paid'`);
  assert.equal(note.title, `Lasku ${inv.number} maksettu`);
  assert.match(note.body, /^Jussi T\., 55,00\s€$/u);
  r = await as(null, `select public.koutsi_invoice_public('${inv.public_token}') as d`);
  assert.equal(r.rows[0].d.klarna, false, 'nothing to pay any more');
});
