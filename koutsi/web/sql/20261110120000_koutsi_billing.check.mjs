// 20261110120000_koutsi_billing.check.mjs — runs the proposed Laskutus migration
// (koutsi/web/sql/20261110120000_koutsi_billing.sql, NOT applied) in PGlite against a small stub of
// production's Koutsi schema (the tables, policies and helpers it leans on, as of 2026-10-29), then
// checks who can do what, billing once, the lock after sending, numbers, links, claims and deletions.
// PGlite is not a dependency of the repo, so this is not part of `npm run test:koutsi`. Before
// "aja migraatio":
//   (in an empty temp folder) npm i @electric-sql/pglite@0.3
//   PGLITE=<that folder>/node_modules/@electric-sql/pglite/dist/index.js node --test koutsi/web/sql/20261110120000_koutsi_billing.check.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite');

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = await readFile(join(here, '20261110120000_koutsi_billing.sql'), 'utf8');

const ANNA = '00000000-0000-4000-8000-0000000000a1'; // coach, Laskutus on
const JUHO = '00000000-0000-4000-8000-0000000000b1'; // coach, Laskutus off (like Alpo)
const ADMIN = '00000000-0000-4000-8000-0000000000e1';
const MARIA = '00000000-0000-4000-8000-000000000001'; // Anna's player, has an account
const JUSSI = '00000000-0000-4000-8000-000000000002'; // Anna's player, has an account
const PH = '00000000-0000-4000-8000-000000000003'; // Anna's placeholder (no account)
const PIRJO = '00000000-0000-4000-8000-000000000004'; // the placeholder's real account, claims later
const OTTO = '00000000-0000-4000-8000-000000000005'; // Juho's player
const G1 = '00000000-0000-4000-8000-0000000000c1'; // Anna's group
const GJ = '00000000-0000-4000-8000-0000000000c2'; // Juho's group
const T1 = '00000000-0000-4000-8000-0000000000d1';
const T2 = '00000000-0000-4000-8000-0000000000d2';
const T3 = '00000000-0000-4000-8000-0000000000d3';
const TJ = '00000000-0000-4000-8000-0000000000d9'; // Juho's session

const STUB = `
create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
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
insert into auth.users (id, email) values ('${ANNA}', 'anna@example.test'), ('${JUHO}', 'juho@example.test'), ('${ADMIN}', 'admin@example.test'),
  ('${MARIA}', 'maria@example.test'), ('${JUSSI}', 'jussi@example.test'), ('${OTTO}', 'otto@example.test');
insert into profiles (id, name) values ('${ANNA}', 'Anna Virtanen'), ('${JUHO}', 'Juho Aalto'), ('${ADMIN}', 'Ylläpitäjä');
insert into koutsi_admins (user_id) values ('${ADMIN}');
insert into koutsi_coaches (id) values ('${ANNA}'), ('${JUHO}'), ('${ADMIN}');
insert into koutsi_students (id, name) values ('${MARIA}', 'Maria K.'), ('${JUSSI}', 'Jussi T.'), ('${PH}', 'Pirjo S.'), ('${OTTO}', 'Otto L.');
insert into koutsi_coach_students (coach_id, student_id) values ('${ANNA}', '${MARIA}'), ('${ANNA}', '${JUSSI}'), ('${ANNA}', '${PH}'), ('${JUHO}', '${OTTO}'), ('${JUHO}', '${MARIA}');
insert into koutsi_groups (id, coach_id, name) values ('${G1}', '${ANNA}', 'Aikuiset'), ('${GJ}', '${JUHO}', 'Juhon ryhmä');
insert into koutsi_group_members (group_id, student_id) values ('${G1}', '${MARIA}'), ('${G1}', '${JUSSI}'), ('${G1}', '${PH}'), ('${GJ}', '${OTTO}');
update koutsi_group_members set ended_at = now() where group_id = '${G1}' and student_id = '${JUSSI}';
insert into koutsi_trainings (id, coach_id, group_id, student_id, date, time, type, duration_minutes) values
  ('${T1}', '${ANNA}', '${G1}', null, '2026-11-03', '17:00', 'Ryhmätreeni', 60),
  ('${T2}', '${ANNA}', '${G1}', null, '2026-11-10', '17:00', 'Ryhmätreeni', 60),
  ('${T3}', '${ANNA}', null, '${MARIA}', '2026-11-12', '15:30', 'Yksityistunti', 90),
  ('${TJ}', '${JUHO}', '${GJ}', null, '2026-11-04', '18:00', 'Ryhmätreeni', 60);
`;

const db = new PGlite();
await db.exec(STUB);
await db.exec(SEED);
await db.exec(MIGRATION);
await db.exec(MIGRATION); // must be re-runnable
await db.exec(`insert into koutsi_billing_coaches (coach_id, note) values ('${ANNA}', 'pilotti')`);

/** Runs `sql` as `uid` (role authenticated, or anon when uid is null) in a transaction, rolled back unless `keep`. */
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
const one = async (sql) => (await db.query(sql)).rows[0];
const all = async (sql) => (await db.query(sql)).rows;

const BILLER = `insert into koutsi_billers (coach_id, name, business_id, iban, payment_days, prices)
  values ('${ANNA}', 'Anna Virtanen Tennis', '3413406-6', 'FI2112345600000785', 14, '{"groups":{"${G1}":{"mode":"kerta","cents":3000}},"privateHourCents":6000}')`;
const line = (kind, trainingId, amountCents, extra = {}) => ({
  kind, trainingId, groupId: kind === 'season' ? G1 : null, date: '2026-11-03', time: '17:00', description: 'Aikuiset',
  quantity: 1, unitCents: amountCents, amountCents, charged: true, ...extra,
});
const drafts = (list) => `select cardinality(public.koutsi_create_invoice_drafts('${ANNA}', '${JSON.stringify(list).replace(/'/g, "''")}'::jsonb)) as n`;

test('only coaches with Laskutus on can set it up', async () => {
  let r = await as(JUHO, `insert into koutsi_billers (coach_id, name, iban) values ('${JUHO}', 'Juho', 'FI2112345600000785')`);
  assert.ok(r.error, 'a coach without the feature cannot');
  r = await as(ANNA, `insert into koutsi_billers (coach_id, name, iban) values ('${JUHO}', 'Juho', 'FI2112345600000785')`);
  assert.ok(r.error, 'nor for someone else');
  r = await as(ANNA, `select public.koutsi_billing_enabled('${ANNA}') as on_, public.koutsi_billing_enabled('${JUHO}') as other`);
  assert.deepEqual(r.rows[0], { on_: true, other: false });
  r = await as(JUHO, `select public.koutsi_billing_enabled('${JUHO}') as on_`);
  assert.equal(r.rows[0].on_, false);
  r = await as(ADMIN, `select public.koutsi_billing_enabled('${ADMIN}') as on_`);
  assert.equal(r.rows[0].on_, true, 'admins have it');
  r = await as(ANNA, `insert into koutsi_billers (coach_id, name, iban) values ('${ANNA}', 'Anna', 'FI21 1234')`);
  assert.ok(r.error, 'the IBAN is checked');
  r = await as(ANNA, BILLER);
  assert.equal(r.error, null, r.error?.message);
  r = await as(JUHO, `select * from koutsi_billers`);
  assert.equal(r.rows.length, 0, 'nobody else reads it');
  r = await as(JUHO, `select * from koutsi_billing_coaches`);
  assert.ok(r.error, 'the list is closed to clients');
});

test('drafts: all or nothing, the coach\'s own sessions only, each session once per player', async () => {
  let r = await as(JUHO, drafts([{ studentId: OTTO, payerName: 'Otto L.', lines: [line('session', TJ, 3000)] }]));
  assert.ok(r.error, 'no drafts without the feature');

  r = await as(ANNA, drafts([
    { studentId: MARIA, payerName: 'Maria K.', periodStart: '2026-11-01', periodEnd: '2026-11-30',
      lines: [line('session', T1, 3000), line('late', T2, 3000), line('session', T3, 9000, { description: 'Yksityistunti 90 min' })] },
    { studentId: PH, payerName: 'Pirjon äiti', payerEmail: 'aiti@example.test', lines: [line('session', T1, 3000), line('cancelled', T2, 3000, { charged: false })] },
  ]));
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.rows[0].n, 2);
  const maria = await one(`select * from koutsi_invoices where student_id = '${MARIA}'`);
  assert.equal(maria.status, 'draft');
  assert.equal(maria.total_cents, 15000);
  assert.equal(maria.number, null);
  const ph = await one(`select * from koutsi_invoices where student_id = '${PH}'`);
  assert.equal(ph.total_cents, 3000, 'uncharged lines do not count');
  assert.deepEqual((await all(`select distinct student_id from koutsi_invoice_lines where invoice_id = '${ph.id}'`)).map((x) => x.student_id), [PH], 'lines carry the invoice\'s player');

  r = await as(ANNA, drafts([{ studentId: MARIA, payerName: 'Maria K.', lines: [line('session', T1, 3000)] }]));
  assert.match(String(r.error?.message), /jo laskulla/, 'the same session twice');
  r = await as(ANNA, drafts([
    { studentId: JUSSI, payerName: 'Jussi T.', lines: [line('session', T1, 3000)] },
    { studentId: MARIA, payerName: 'Maria K.', lines: [line('session', T1, 3000)] },
  ]));
  assert.ok(r.error);
  assert.equal((await one(`select count(*)::int as n from koutsi_invoices where student_id = '${JUSSI}'`)).n, 0, 'nothing of a failed batch stays');

  r = await as(ANNA, drafts([{ studentId: JUSSI, payerName: 'Jussi T.', lines: [line('session', TJ, 3000)] }]));
  assert.ok(r.error, 'another coach\'s session');
  r = await as(ANNA, drafts([{ studentId: OTTO, payerName: 'Otto L.', lines: [line('manual', null, 3000)] }]));
  assert.ok(r.error, 'another coach\'s player');
  r = await as(ANNA, drafts([{ studentId: JUSSI, payerName: 'Jussi T.', lines: [line('session', null, 3000)] }]));
  assert.ok(r.error, 'a session line needs its session');
});

test('a draft can be edited by its coach; clients can never send or number it themselves', async () => {
  const inv = await one(`select * from koutsi_invoices where student_id = '${MARIA}'`);
  const late = await one(`select id from koutsi_invoice_lines where invoice_id = '${inv.id}' and kind = 'late'`);
  let r = await as(ANNA, `update koutsi_invoice_lines set charged = false where id = '${late.id}'`);
  assert.equal(r.error, null, r.error?.message);
  assert.equal((await one(`select total_cents from koutsi_invoices where id = '${inv.id}'`)).total_cents, 12000, 'the total follows');
  r = await as(ANNA, `insert into koutsi_invoice_lines (invoice_id, kind, description, amount_cents, unit_cents) values ('${inv.id}', 'manual', 'Pallot', 500, 500)`);
  assert.equal(r.error, null, r.error?.message);
  assert.equal((await one(`select total_cents from koutsi_invoices where id = '${inv.id}'`)).total_cents, 12500);
  r = await as(ANNA, `update koutsi_invoices set number = 5, total_cents = 1 where id = '${inv.id}'`);
  assert.equal(r.error, null);
  const after = await one(`select number, total_cents from koutsi_invoices where id = '${inv.id}'`);
  assert.deepEqual(after, { number: null, total_cents: 12500 }, 'a draft has no number and its total is its lines');
  r = await as(ANNA, `update koutsi_invoices set status = 'sent' where id = '${inv.id}'`);
  assert.ok(r.error, 'sending is the function\'s job');
  r = await as(JUHO, `update koutsi_invoices set payer_name = 'X' where id = '${inv.id}' returning id`);
  assert.equal(r.rows.length, 0, 'another coach cannot touch it');
  r = await as(MARIA, `select * from koutsi_invoices`);
  assert.equal(r.rows.length, 0, 'the player does not see drafts');
});

test('sending fixes number, viitenumero, dates and seller, and tells a player with an account', async () => {
  const inv = await one(`select * from koutsi_invoices where student_id = '${MARIA}'`);
  let r = await as(JUHO, `select public.koutsi_send_invoice('${inv.id}') as res`);
  assert.ok(r.error, 'not someone else\'s');
  r = await as(ANNA, `select public.koutsi_send_invoice('${inv.id}') as res`);
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.rows[0].res.number, 1);
  assert.equal(r.rows[0].res.reference, '10016');
  const sent = await one(`select *, (due_date - issue_date) as days from koutsi_invoices where id = '${inv.id}'`);
  assert.equal(sent.status, 'sent');
  assert.equal(sent.days, 14);
  assert.equal(sent.total_cents, 12500);
  assert.deepEqual(sent.seller, { name: 'Anna Virtanen Tennis', businessId: '3413406-6', iban: 'FI2112345600000785' });
  const note = await one(`select * from koutsi_notifications where recipient_id = '${MARIA}' and kind = 'invoice'`);
  assert.equal(note.title, 'Uusi lasku: 125,00 €');
  assert.match(note.body, /^Anna Virtanen Tennis · eräpäivä \d{1,2}\.\d{1,2}\.\d{4}$/);
  assert.equal(note.link_path, `/pelaaja/laskut/${inv.id}`);

  r = await as(ANNA, `select public.koutsi_send_invoice('${inv.id}') as res`);
  assert.match(String(r.error?.message), /jo lähetetty/);
  r = await as(ANNA, `update koutsi_invoices set payer_name = 'Joku muu' where id = '${inv.id}' returning id`);
  assert.equal(r.rows.length, 0, 'a sent invoice is not the coach\'s to edit');
  await assert.rejects(db.query(`update koutsi_invoices set payer_name = 'Joku muu' where id = '${inv.id}'`), /ei voi muuttaa/, 'not even from the server side');
  await assert.rejects(db.query(`update koutsi_invoice_lines set amount_cents = 1 where invoice_id = '${inv.id}'`), /rivejä ei voi muuttaa/);
  r = await as(ANNA, `delete from koutsi_invoices where id = '${inv.id}' returning id`);
  assert.equal(r.rows.length, 0, 'a sent invoice is not deleted');

  // the placeholder's invoice: numbered next, nobody to notify
  const ph = await one(`select id from koutsi_invoices where student_id = '${PH}'`);
  r = await as(ANNA, `select public.koutsi_send_invoices(array['${ph.id}']::uuid[]) as res`);
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.rows[0].res[0].number, 2);
  assert.equal((await one(`select count(*)::int as n from koutsi_notifications where kind = 'invoice'`)).n, 1);

  // the coach continues an old series: the next number is theirs to set, a used one is skipped
  await as(ANNA, `update koutsi_billers set next_number = 2 where coach_id = '${ANNA}'`);
  await as(ANNA, drafts([{ studentId: JUSSI, payerName: 'Jussi T.', lines: [line('manual', null, 2000, { description: 'Kesäleiri' })] }]));
  const jussi = await one(`select id from koutsi_invoices where student_id = '${JUSSI}'`);
  r = await as(ANNA, `select public.koutsi_send_invoice('${jussi.id}') as res`);
  assert.equal(r.rows[0].res.number, 3, 'number 2 is taken');
  assert.equal((await one(`select next_number from koutsi_billers where coach_id = '${ANNA}'`)).next_number, 4);
});

test('the player reads their own sent invoice; the link opens one invoice for anyone', async () => {
  let r = await as(MARIA, `select i.number, i.total_cents, (select count(*)::int from koutsi_invoice_lines l where l.invoice_id = i.id) as lines from koutsi_invoices i`);
  assert.deepEqual(r.rows, [{ number: 1, total_cents: 12500, lines: 4 }]);
  r = await as(JUSSI, `select i.number from koutsi_invoices i where i.student_id = '${MARIA}'`);
  assert.equal(r.rows.length, 0);
  r = await as(JUSSI, `select * from koutsi_invoice_lines l join koutsi_invoices i on i.id = l.invoice_id where i.student_id = '${MARIA}'`);
  assert.equal(r.rows.length, 0, 'nor her lines');

  const { public_token: token } = await one(`select public_token from koutsi_invoices where student_id = '${MARIA}'`);
  r = await as(null, `select public.koutsi_invoice_public('${token}') as doc`);
  assert.equal(r.error, null, r.error?.message);
  const doc = r.rows[0].doc;
  assert.equal(doc.number, 1);
  assert.equal(doc.payerName, 'Maria K.');
  assert.equal(doc.lines.length, 4);
  assert.ok(!JSON.stringify(doc).includes(MARIA), 'no ids of people');
  r = await as(null, `select public.koutsi_invoice_public(gen_random_uuid()) as doc`);
  assert.equal(r.rows[0].doc, null);
  await as(ANNA, drafts([{ studentId: JUSSI, payerName: 'Jussi T.', lines: [line('manual', null, 1000, { description: 'Luonnos' })] }]));
  const draft = await one(`select public_token from koutsi_invoices where status = 'draft' and student_id = '${JUSSI}'`);
  r = await as(null, `select public.koutsi_invoice_public('${draft.public_token}') as doc`);
  assert.equal(r.rows[0].doc, null, 'a draft has no public page');
  r = await as(null, `select * from koutsi_invoices`);
  assert.ok(r.error || r.rows.length === 0, 'anon reads no tables');
  r = await as(ANNA, `delete from koutsi_invoices where status = 'draft' and student_id = '${JUSSI}' returning id`);
  assert.equal(r.rows.length, 1, 'a draft can be thrown away');
});

test('paid, unpaid and void: a void invoice frees its sessions', async () => {
  const inv = await one(`select id from koutsi_invoices where student_id = '${MARIA}'`);
  let r = await as(ANNA, `select public.koutsi_set_invoice_paid('${inv.id}', true)`);
  assert.equal(r.error, null, r.error?.message);
  let row = await one(`select status, paid_at from koutsi_invoices where id = '${inv.id}'`);
  assert.equal(row.status, 'paid');
  assert.ok(row.paid_at);
  r = await as(ANNA, `select public.koutsi_set_invoice_paid('${inv.id}', false)`);
  row = await one(`select status, paid_at from koutsi_invoices where id = '${inv.id}'`);
  assert.deepEqual(row, { status: 'sent', paid_at: null });
  r = await as(JUHO, `select public.koutsi_void_invoice('${inv.id}')`);
  assert.ok(r.error);
  r = await as(ANNA, `select public.koutsi_void_invoice('${inv.id}')`);
  assert.equal(r.error, null, r.error?.message);
  assert.equal((await one(`select status from koutsi_invoices where id = '${inv.id}'`)).status, 'void');
  assert.equal((await one(`select bool_and(voided) as v from koutsi_invoice_lines where invoice_id = '${inv.id}'`)).v, true);
  assert.equal((await one(`select title from koutsi_notifications where recipient_id = '${MARIA}' order by created_at desc limit 1`)).title, 'Lasku 1 peruttu');
  r = await as(MARIA, `select * from koutsi_invoices`);
  assert.equal(r.rows.length, 0, 'the player no longer sees it as owed');
  r = await as(ANNA, `select public.koutsi_set_invoice_paid('${inv.id}', true)`);
  assert.ok(r.error, 'a void invoice stays void');
  r = await as(ANNA, drafts([{ studentId: MARIA, payerName: 'Maria K.', lines: [line('session', T1, 3000)] }]));
  assert.equal(r.error, null, 'the session can be billed again');
});

test('a claimed placeholder takes their invoices along; a deleted player leaves them with the payer\'s name', async () => {
  const before = await one(`select id, number from koutsi_invoices where student_id = '${PH}'`);
  // koutsi_claim_player: the real account takes the placeholder's coaching row
  await db.exec(`insert into auth.users (id, email) values ('${PIRJO}', 'pirjo@example.test');
    insert into koutsi_students (id, name) values ('${PIRJO}', 'Pirjo S.');
    update koutsi_coach_students set student_id = '${PIRJO}' where student_id = '${PH}';
    update koutsi_group_members set student_id = '${PIRJO}' where student_id = '${PH}';
    delete from koutsi_students where id = '${PH}';`);
  const moved = await one(`select id, number, student_id from koutsi_invoices where id = '${before.id}'`);
  assert.equal(moved.student_id, PIRJO);
  assert.deepEqual((await all(`select distinct student_id from koutsi_invoice_lines where invoice_id = '${before.id}'`)).map((x) => x.student_id), [PIRJO]);
  let r = await as(PIRJO, `select number from koutsi_invoices`);
  assert.deepEqual(r.rows, [{ number: before.number }], 'Pirjo now reads it');

  // the player deletes their account: the coaching row goes, the invoice stays
  await db.exec(`delete from koutsi_students where id = '${PIRJO}'`);
  const left = await one(`select student_id, payer_name, status from koutsi_invoices where id = '${before.id}'`);
  assert.deepEqual(left, { student_id: null, payer_name: 'Pirjon äiti', status: 'sent' });
  assert.equal((await one(`select count(*)::int as n from koutsi_invoice_lines where invoice_id = '${before.id}' and student_id is null`)).n, 2);
});

test('a deleted session leaves the invoice as it was; the coach\'s memberships and the player\'s terms', async () => {
  const inv = await one(`select id, total_cents from koutsi_invoices where student_id = '${JUSSI}' and status = 'sent'`);
  await db.exec(`insert into koutsi_trainings (id, coach_id, group_id, date, time, type) values ('00000000-0000-4000-8000-0000000000d4', '${ANNA}', '${G1}', '2026-11-17', '17:00', 'Ryhmätreeni')`);
  await as(ANNA, drafts([{ studentId: JUSSI, payerName: 'Jussi T.', lines: [line('session', '00000000-0000-4000-8000-0000000000d4', 3000)] }]));
  const d = await one(`select id from koutsi_invoices where student_id = '${JUSSI}' and status = 'draft'`);
  await as(ANNA, `select public.koutsi_send_invoice('${d.id}')`);
  await db.exec(`delete from koutsi_trainings where id = '00000000-0000-4000-8000-0000000000d4'`);
  const lineRow = await one(`select training_id, description, amount_cents from koutsi_invoice_lines where invoice_id = '${d.id}'`);
  assert.deepEqual(lineRow, { training_id: null, description: 'Aikuiset', amount_cents: 3000 });
  assert.equal((await one(`select status from koutsi_invoices where id = '${inv.id}'`)).status, 'sent');

  let r = await as(ANNA, `select student_id, ended_at is not null as ended from public.koutsi_billing_memberships('${ANNA}') order by student_id`);
  assert.deepEqual(r.rows, [{ student_id: MARIA, ended: false }, { student_id: JUSSI, ended: true }], 'ended memberships too');
  r = await as(JUHO, `select * from public.koutsi_billing_memberships('${ANNA}')`);
  assert.equal(r.rows.length, 0, 'not another coach\'s');

  r = await as(MARIA, `select coach_id, seller_name, cancel_hours from public.koutsi_my_billing_terms()`);
  assert.deepEqual(r.rows, [{ coach_id: ANNA, seller_name: 'Anna Virtanen Tennis', cancel_hours: 24 }], 'only coaches with Laskutus on');
  r = await as(OTTO, `select * from public.koutsi_my_billing_terms()`);
  assert.equal(r.rows.length, 0);
});

test('deleting the coach deletes their billing', async () => {
  await db.exec(`delete from koutsi_coaches where id = '${ANNA}'`);
  for (const table of ['koutsi_billers', 'koutsi_invoices', 'koutsi_invoice_lines', 'koutsi_billing_coaches']) {
    assert.equal((await one(`select count(*)::int as n from ${table}`)).n, 0, table);
  }
});
