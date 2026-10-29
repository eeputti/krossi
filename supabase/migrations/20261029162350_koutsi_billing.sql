-- 20261029162350_koutsi_billing.sql — Laskutus, vaihe 1, in the renewed Koutsi (koutsi/web).
--
-- Applied to production 2026-10-29 (apply_migration koutsi_billing) on the user's "Aja ja julkaise".
-- Tested in PGlite against a stub of the production schema: koutsi/web/sql/20261029162350_koutsi_billing.check.mjs
-- Everything is additive: four new tables and their functions. No existing table, function or
-- policy changes, and the old Koutsi reads none of it.
-- Rollback: drop the four tables (cascade) and the functions below.
--
-- Rules the app relies on:
--   * The feature is per coach: koutsi_billing_coach_enabled() = admins and the coaches listed in
--     koutsi_billing_coaches (filled by hand). Nobody else sees anything — Alpo and his players
--     included. Opening it to every paying coach later is a one-function replace.
--   * One laskuttaja (seller) per coach for now, kept apart from the coach row so an organisation
--     with many coaches can be added later: name, Y-tunnus, IBAN, VAT, payment days, cancellation
--     limit, prices (jsonb) and payers (jsonb: a guardian or a company per player).
--   * An invoice is a draft until koutsi_send_invoice(): it then gets its running number (per
--     seller, never reused), viitenumero, dates and a copy of the seller's details, and its
--     content never changes again — only sent ↔ paid, or void (which frees its sessions).
--   * A session is billed once per player (unique index), drafts included.
--   * The invoice follows the coaching row: a placeholder player's invoices move to the account
--     that claims them (ON UPDATE CASCADE); a deleted player leaves the invoice with the payer's
--     name (accounting records stay with the coach). Deleting the coach deletes everything.
--   * A player reads their own sent and paid invoices. Anyone with the invoice's link reads that
--     one invoice (koutsi_invoice_public: no ids of people, no e-mail).
--   * Sending tells a player with an account through the usual notifications (kind 'invoice': the
--     bell and the e-mail queue; it has no e-mail category, so it cannot be turned off by kind).
--   * Late cancellations need nothing new: koutsi_training_absences.created_at is the moment the
--     absence was first reported (an upsert keeps it), and the app sorts by it.

-- ── who has it ──────────────────────────────────────────────────────────────

create table if not exists public.koutsi_billing_coaches (
  coach_id uuid primary key references public.koutsi_coaches(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);
alter table public.koutsi_billing_coaches enable row level security; -- no policies: functions only
revoke all on public.koutsi_billing_coaches from anon, authenticated;

create or replace function public.koutsi_billing_coach_enabled(p_coach uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_coach is not null and (
    exists (select 1 from public.koutsi_admins a where a.user_id = p_coach)
    or exists (select 1 from public.koutsi_billing_coaches b where b.coach_id = p_coach)
  );
$function$;

-- For the app: may the signed-in user (or an admin acting as this coach) use Laskutus?
create or replace function public.koutsi_billing_enabled(p_coach uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select public.koutsi_acts_as(p_coach) and (public.koutsi_is_admin() or public.koutsi_billing_coach_enabled(p_coach));
$function$;

-- ── tables ──────────────────────────────────────────────────────────────────

create table if not exists public.koutsi_billers (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null unique references public.koutsi_coaches(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  business_id text check (business_id is null or business_id ~ '^[0-9]{7}-[0-9]$'),
  address text check (address is null or char_length(address) <= 300),
  email text check (email is null or char_length(email) <= 200),
  phone text check (phone is null or char_length(phone) <= 40),
  iban text not null check (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$'),
  bic text check (bic is null or bic ~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$'),
  vat_mode text not null default 'none' check (vat_mode in ('none', '25.5', '14', '10')),
  payment_days integer not null default 14 check (payment_days between 0 and 90),
  cancel_hours integer not null default 24 check (cancel_hours between 0 and 168),
  charge_late boolean not null default true,
  charge_no_show boolean not null default true,
  terms text check (terms is null or char_length(terms) <= 1000),
  next_number integer not null default 1 check (next_number between 1 and 999999999),
  -- { groups: { <group id>: { mode: 'kerta' | 'kausi' | 'ei', cents } }, privateHourCents }
  prices jsonb not null default '{}'::jsonb check (jsonb_typeof(prices) = 'object'),
  -- { <student id>: { name, email } } — who pays a player's invoices when it isn't the player
  payers jsonb not null default '{}'::jsonb check (jsonb_typeof(payers) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.koutsi_invoices (
  id uuid primary key default gen_random_uuid(),
  biller_id uuid not null references public.koutsi_billers(id) on delete cascade,
  coach_id uuid not null references public.koutsi_coaches(id) on delete cascade,
  student_id uuid,
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  number integer check (number is null or number > 0),
  reference text check (reference is null or reference ~ '^[0-9]{4,20}$'),
  issue_date date,
  due_date date,
  period_start date,
  period_end date,
  payer_name text not null check (char_length(btrim(payer_name)) between 1 and 120),
  payer_email text check (payer_email is null or char_length(payer_email) <= 200),
  payer_address text check (payer_address is null or char_length(payer_address) <= 300),
  seller jsonb,
  vat_mode text not null default 'none' check (vat_mode in ('none', '25.5', '14', '10')),
  total_cents integer not null default 0 check (total_cents >= 0),
  public_token uuid not null unique default gen_random_uuid(),
  sent_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint koutsi_invoices_number_once unique (biller_id, number),
  constraint koutsi_invoices_id_student unique (id, student_id),
  constraint koutsi_invoices_coaching foreign key (coach_id, student_id)
    references public.koutsi_coach_students (coach_id, student_id) on update cascade on delete set null (student_id),
  constraint koutsi_invoices_sent_complete check (status = 'draft' or (number is not null and reference is not null
    and issue_date is not null and due_date is not null and seller is not null and sent_at is not null)),
  constraint koutsi_invoices_period check (period_start is null or period_end is null or period_start <= period_end)
);

create index if not exists koutsi_invoices_coach_idx on public.koutsi_invoices (coach_id, created_at desc);
create index if not exists koutsi_invoices_student_idx on public.koutsi_invoices (student_id) where student_id is not null;
create index if not exists koutsi_invoices_biller_idx on public.koutsi_invoices (biller_id);

create table if not exists public.koutsi_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.koutsi_invoices(id) on delete cascade,
  -- always the invoice's player (set by the trigger), so a session is billed once per player
  student_id uuid,
  sort_order integer not null default 0,
  kind text not null check (kind in ('session', 'late', 'no_show', 'cancelled', 'season', 'manual')),
  training_id uuid references public.koutsi_trainings(id) on delete set null,
  group_id uuid references public.koutsi_groups(id) on delete set null,
  line_date date,
  line_time text check (line_time is null or line_time ~ '^[0-9]{2}:[0-9]{2}$'),
  description text not null check (char_length(btrim(description)) between 1 and 200),
  quantity numeric(8, 2) not null default 1 check (quantity > 0),
  unit_cents integer not null default 0 check (unit_cents between 0 and 10000000),
  amount_cents integer not null default 0 check (amount_cents between 0 and 10000000),
  charged boolean not null default true,
  voided boolean not null default false,
  created_at timestamptz not null default now(),
  constraint koutsi_invoice_lines_invoice_student foreign key (invoice_id, student_id)
    references public.koutsi_invoices (id, student_id) on update cascade on delete cascade
);

create index if not exists koutsi_invoice_lines_invoice_idx on public.koutsi_invoice_lines (invoice_id, sort_order);
create index if not exists koutsi_invoice_lines_training_idx on public.koutsi_invoice_lines (training_id) where training_id is not null;
create index if not exists koutsi_invoice_lines_group_idx on public.koutsi_invoice_lines (group_id) where group_id is not null;
create unique index if not exists koutsi_invoice_lines_session_once
  on public.koutsi_invoice_lines (training_id, student_id) where training_id is not null and not voided;
create unique index if not exists koutsi_invoice_lines_season_once
  on public.koutsi_invoice_lines (group_id, student_id) where kind = 'season' and group_id is not null and not voided;

-- ── small helpers ───────────────────────────────────────────────────────────

-- Viitenumero from an invoice number: "1" + the number (at least three digits) + the 7-3-1 check digit.
create or replace function public.koutsi_reference(p_number integer)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_base text := '1' || lpad(greatest(coalesce(p_number, 1), 1)::text, 3, '0');
  v_weights integer[] := array[7, 3, 1];
  v_sum integer := 0;
  i integer;
begin
  for i in 0 .. length(v_base) - 1 loop
    v_sum := v_sum + substr(v_base, length(v_base) - i, 1)::integer * v_weights[(i % 3) + 1];
  end loop;
  return v_base || ((10 - v_sum % 10) % 10)::text;
end;
$function$;

create or replace function public.koutsi_euros(p_cents integer)
returns text
language sql
immutable
set search_path = ''
as $function$
  select replace(to_char(coalesce(p_cents, 0) / 100.0, 'FM999999990.00'), '.', ',') || ' €';
$function$;

-- ── guards ──────────────────────────────────────────────────────────────────

-- A draft keeps none of a sent invoice's fields and its total is always its charged lines.
-- A sent invoice's content never changes: only sent ↔ paid and → void (and the database's own
-- moves of student_id when a player claims an account or is deleted).
create or replace function public.koutsi_invoice_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_biller public.koutsi_billers%rowtype;
  v_fixed text[] := array['status', 'paid_at', 'voided_at', 'updated_at', 'student_id'];
begin
  if tg_op = 'INSERT' or new.status = 'draft' then
    if tg_op = 'INSERT' and new.status <> 'draft' then
      raise exception 'Uusi lasku on aina luonnos.' using errcode = 'check_violation';
    end if;
    if tg_op = 'UPDATE' and old.status <> 'draft' then
      raise exception 'Lähetettyä laskua ei voi palauttaa luonnokseksi.' using errcode = 'check_violation';
    end if;
    select * into v_biller from public.koutsi_billers b where b.id = new.biller_id;
    if v_biller.id is null or v_biller.coach_id <> new.coach_id then
      raise exception 'Laskuttaja ei ole tämän valmentajan.' using errcode = 'check_violation';
    end if;
    new.number := null;
    new.reference := null;
    new.issue_date := null;
    new.due_date := null;
    new.seller := null;
    new.sent_at := null;
    new.paid_at := null;
    new.voided_at := null;
    new.vat_mode := v_biller.vat_mode;
    if tg_op = 'INSERT' then
      new.total_cents := 0;
      new.public_token := gen_random_uuid();
      new.created_at := now();
    else
      new.total_cents := coalesce((select sum(l.amount_cents) from public.koutsi_invoice_lines l
                                    where l.invoice_id = new.id and l.charged), 0);
    end if;
    new.updated_at := now();
    return new;
  end if;

  if old.status = 'draft' then
    return new; -- draft → sent: koutsi_send_invoice (row security keeps clients at drafts)
  end if;
  if old.status = 'void' and new.status is distinct from 'void' then
    raise exception 'Mitätöityä laskua ei voi muuttaa.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_fixed) <> (to_jsonb(old) - v_fixed) then
    raise exception 'Lähetettyä laskua ei voi muuttaa. Mitätöi se ja tee uusi.' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists koutsi_invoices_guard on public.koutsi_invoices;
create trigger koutsi_invoices_guard before insert or update on public.koutsi_invoices
  for each row execute function public.koutsi_invoice_guard();

-- Lines change only while their invoice is a draft; each line is the invoice's player's, and a
-- session or group on it must be the coach's own.
create or replace function public.koutsi_invoice_line_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_inv public.koutsi_invoices%rowtype;
  v_moves text[] := array['voided', 'training_id', 'group_id', 'student_id'];
begin
  select * into v_inv from public.koutsi_invoices i where i.id = coalesce(new.invoice_id, old.invoice_id);
  if v_inv.id is null then
    return coalesce(new, old); -- the invoice itself is being deleted
  end if;
  if v_inv.status <> 'draft' then
    -- voiding frees the sessions; deleted sessions and claimed players move by themselves
    if tg_op = 'UPDATE' and (to_jsonb(new) - v_moves) = (to_jsonb(old) - v_moves) then
      return new;
    end if;
    raise exception 'Lähetetyn laskun rivejä ei voi muuttaa.' using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and new.invoice_id <> old.invoice_id then
    raise exception 'Riviä ei voi siirtää toiselle laskulle.' using errcode = 'check_violation';
  end if;
  new.student_id := v_inv.student_id;
  new.voided := false;
  if new.training_id is not null and not exists (
    select 1 from public.koutsi_trainings t where t.id = new.training_id and t.coach_id = v_inv.coach_id
  ) then
    raise exception 'Treeni ei ole tämän valmentajan.' using errcode = 'check_violation';
  end if;
  if new.group_id is not null and not exists (
    select 1 from public.koutsi_groups g where g.id = new.group_id and g.coach_id = v_inv.coach_id
  ) then
    raise exception 'Ryhmä ei ole tämän valmentajan.' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' and new.kind in ('session', 'late', 'no_show', 'cancelled') and new.training_id is null then
    raise exception 'Treenirivi tarvitsee treenin.' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' and new.kind = 'season' and new.group_id is null then
    raise exception 'Kausimaksu tarvitsee ryhmän.' using errcode = 'check_violation';
  end if;
  if new.kind = 'manual' and new.training_id is not null then
    raise exception 'Oma rivi ei voi viitata treeniin.' using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

drop trigger if exists koutsi_invoice_lines_guard on public.koutsi_invoice_lines;
create trigger koutsi_invoice_lines_guard before insert or update or delete on public.koutsi_invoice_lines
  for each row execute function public.koutsi_invoice_line_guard();

-- A draft's total follows its lines (the invoice guard recounts on any update).
create or replace function public.koutsi_invoice_line_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.koutsi_invoices i set updated_at = now()
   where i.id = coalesce(new.invoice_id, old.invoice_id) and i.status = 'draft';
  return null;
end;
$function$;

drop trigger if exists koutsi_invoice_lines_total on public.koutsi_invoice_lines;
create trigger koutsi_invoice_lines_total after insert or update or delete on public.koutsi_invoice_lines
  for each row execute function public.koutsi_invoice_line_total();

create or replace function public.koutsi_biller_stamp()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists koutsi_billers_stamp on public.koutsi_billers;
create trigger koutsi_billers_stamp before update on public.koutsi_billers
  for each row execute function public.koutsi_biller_stamp();

-- ── who may read and write ──────────────────────────────────────────────────

create or replace function public.koutsi_invoice_readable(p_invoice uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.koutsi_invoices i
     where i.id = p_invoice
       and (public.koutsi_acts_as(i.coach_id) or (i.student_id = (select auth.uid()) and i.status in ('sent', 'paid')))
  );
$function$;

create or replace function public.koutsi_invoice_editable(p_invoice uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.koutsi_invoices i where i.id = p_invoice and i.status = 'draft' and public.koutsi_acts_as(i.coach_id)
  );
$function$;

alter table public.koutsi_billers enable row level security;
alter table public.koutsi_invoices enable row level security;
alter table public.koutsi_invoice_lines enable row level security;

drop policy if exists koutsi_billers_select on public.koutsi_billers;
create policy koutsi_billers_select on public.koutsi_billers for select to authenticated
  using (public.koutsi_acts_as(coach_id));
drop policy if exists koutsi_billers_insert on public.koutsi_billers;
create policy koutsi_billers_insert on public.koutsi_billers for insert to authenticated
  with check (public.koutsi_billing_enabled(coach_id));
drop policy if exists koutsi_billers_update on public.koutsi_billers;
create policy koutsi_billers_update on public.koutsi_billers for update to authenticated
  using (public.koutsi_acts_as(coach_id)) with check (public.koutsi_billing_enabled(coach_id));

drop policy if exists koutsi_invoices_select on public.koutsi_invoices;
create policy koutsi_invoices_select on public.koutsi_invoices for select to authenticated
  using (public.koutsi_acts_as(coach_id) or (student_id = (select auth.uid()) and status in ('sent', 'paid')));
drop policy if exists koutsi_invoices_insert on public.koutsi_invoices;
create policy koutsi_invoices_insert on public.koutsi_invoices for insert to authenticated
  with check (status = 'draft' and public.koutsi_billing_enabled(coach_id));
drop policy if exists koutsi_invoices_update on public.koutsi_invoices;
create policy koutsi_invoices_update on public.koutsi_invoices for update to authenticated
  using (status = 'draft' and public.koutsi_acts_as(coach_id))
  with check (status = 'draft' and public.koutsi_acts_as(coach_id));
drop policy if exists koutsi_invoices_delete on public.koutsi_invoices;
create policy koutsi_invoices_delete on public.koutsi_invoices for delete to authenticated
  using (status = 'draft' and public.koutsi_acts_as(coach_id));

drop policy if exists koutsi_invoice_lines_select on public.koutsi_invoice_lines;
create policy koutsi_invoice_lines_select on public.koutsi_invoice_lines for select to authenticated
  using (public.koutsi_invoice_readable(invoice_id));
drop policy if exists koutsi_invoice_lines_insert on public.koutsi_invoice_lines;
create policy koutsi_invoice_lines_insert on public.koutsi_invoice_lines for insert to authenticated
  with check (public.koutsi_invoice_editable(invoice_id));
drop policy if exists koutsi_invoice_lines_update on public.koutsi_invoice_lines;
create policy koutsi_invoice_lines_update on public.koutsi_invoice_lines for update to authenticated
  using (public.koutsi_invoice_editable(invoice_id)) with check (public.koutsi_invoice_editable(invoice_id));
drop policy if exists koutsi_invoice_lines_delete on public.koutsi_invoice_lines;
create policy koutsi_invoice_lines_delete on public.koutsi_invoice_lines for delete to authenticated
  using (public.koutsi_invoice_editable(invoice_id));

revoke all on public.koutsi_billers, public.koutsi_invoices, public.koutsi_invoice_lines from anon, authenticated;
grant select, insert, update on public.koutsi_billers to authenticated;
grant select, insert, update, delete on public.koutsi_invoices, public.koutsi_invoice_lines to authenticated;

-- ── reading ─────────────────────────────────────────────────────────────────

-- Every group membership of the coach's groups, ended ones too: a player who left is still billed
-- for the sessions before leaving, one who joined late only for those after joining.
create or replace function public.koutsi_billing_memberships(p_coach uuid)
returns table (group_id uuid, student_id uuid, joined_at timestamptz, ended_at timestamptz, group_created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $function$
  select m.group_id, m.student_id, m.created_at, m.ended_at, g.created_at
    from public.koutsi_group_members m
    join public.koutsi_groups g on g.id = m.group_id
   where g.coach_id = p_coach
     and public.koutsi_acts_as(p_coach);
$function$;

-- The player's coaches' cancellation terms (only coaches with Laskutus on and a seller saved).
create or replace function public.koutsi_my_billing_terms()
returns table (coach_id uuid, seller_name text, cancel_hours integer, charge_late boolean, charge_no_show boolean, terms text, payment_days integer)
language sql
stable
security definer
set search_path = ''
as $function$
  select b.coach_id, b.name, b.cancel_hours, b.charge_late, b.charge_no_show, b.terms, b.payment_days
    from public.koutsi_billers b
    join public.koutsi_coach_students cs
      on cs.coach_id = b.coach_id and cs.student_id = (select auth.uid()) and cs.ended_at is null
   where public.koutsi_billing_coach_enabled(b.coach_id);
$function$;

-- One invoice by its link, for anyone who has the link: what the page shows and nothing more.
create or replace function public.koutsi_invoice_public(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'status', i.status, 'number', i.number, 'reference', i.reference, 'issueDate', i.issue_date, 'dueDate', i.due_date,
    'periodStart', i.period_start, 'periodEnd', i.period_end, 'payerName', i.payer_name, 'payerAddress', i.payer_address,
    'seller', i.seller, 'vatMode', i.vat_mode, 'totalCents', i.total_cents, 'publicToken', i.public_token,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'sortOrder', l.sort_order, 'kind', l.kind, 'date', l.line_date, 'time', l.line_time,
        'description', l.description, 'quantity', l.quantity, 'unitCents', l.unit_cents, 'amountCents', l.amount_cents,
        'charged', l.charged) order by l.sort_order, l.line_date, l.line_time)
        from public.koutsi_invoice_lines l where l.invoice_id = i.id), '[]'::jsonb))
    from public.koutsi_invoices i
   where i.public_token = p_token
     and i.status in ('sent', 'paid', 'void');
$function$;

-- ── writing ─────────────────────────────────────────────────────────────────

-- Drafts from the app's preview: [{ studentId, payerName, payerEmail, periodStart, periodEnd,
-- lines: [{ sortOrder, kind, trainingId, groupId, date, time, description, quantity, unitCents,
-- amountCents, charged }] }] → the new invoices' ids, in order. All or nothing; runs as the caller,
-- so row security decides.
create or replace function public.koutsi_create_invoice_drafts(p_coach uuid, p_drafts jsonb)
returns uuid[]
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_biller uuid;
  v_draft jsonb;
  v_invoice uuid;
  v_ids uuid[] := '{}';
begin
  if not public.koutsi_billing_enabled(p_coach) then
    raise exception 'Laskutus ei ole käytössä.' using errcode = '42501';
  end if;
  select b.id into v_biller from public.koutsi_billers b where b.coach_id = p_coach;
  if v_biller is null then
    raise exception 'Täytä ensin laskuttajan tiedot.' using errcode = 'check_violation';
  end if;
  begin
    for v_draft in select d from jsonb_array_elements(coalesce(p_drafts, '[]'::jsonb)) as x(d) loop
      insert into public.koutsi_invoices (biller_id, coach_id, student_id, payer_name, payer_email, period_start, period_end)
      values (v_biller, p_coach, nullif(v_draft->>'studentId', '')::uuid, btrim(v_draft->>'payerName'),
              nullif(btrim(coalesce(v_draft->>'payerEmail', '')), ''),
              nullif(v_draft->>'periodStart', '')::date, nullif(v_draft->>'periodEnd', '')::date)
      returning id into v_invoice;
      insert into public.koutsi_invoice_lines (invoice_id, sort_order, kind, training_id, group_id, line_date, line_time,
                                               description, quantity, unit_cents, amount_cents, charged)
      select v_invoice, coalesce((l->>'sortOrder')::integer, (x.ord - 1)::integer), l->>'kind',
             nullif(l->>'trainingId', '')::uuid, nullif(l->>'groupId', '')::uuid, nullif(l->>'date', '')::date,
             nullif(left(coalesce(l->>'time', ''), 5), ''), l->>'description', coalesce((l->>'quantity')::numeric, 1),
             coalesce((l->>'unitCents')::integer, 0), coalesce((l->>'amountCents')::integer, 0), coalesce((l->>'charged')::boolean, true)
        from jsonb_array_elements(coalesce(v_draft->'lines', '[]'::jsonb)) with ordinality as x(l, ord);
      v_ids := v_ids || v_invoice;
    end loop;
  exception when unique_violation then
    raise exception 'Osa treeneistä on jo laskulla. Päivitä näkymä ja yritä uudelleen.' using errcode = 'check_violation';
  end;
  return v_ids;
end;
$function$;

-- Sends one draft: number, viitenumero, dates and the seller's details are fixed now, and a player
-- with an account hears about it.
create or replace function public.koutsi_send_invoice(p_invoice uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_inv public.koutsi_invoices%rowtype;
  v_b public.koutsi_billers%rowtype;
  v_number integer;
  v_total integer;
  v_today date := (now() at time zone 'Europe/Helsinki')::date;
  v_due date;
begin
  select * into v_inv from public.koutsi_invoices i where i.id = p_invoice for update;
  if v_inv.id is null or not public.koutsi_acts_as(v_inv.coach_id) then
    raise exception 'Laskua ei löytynyt.' using errcode = 'P0002';
  end if;
  if not public.koutsi_billing_enabled(v_inv.coach_id) then
    raise exception 'Laskutus ei ole käytössä.' using errcode = '42501';
  end if;
  if v_inv.status <> 'draft' then
    raise exception 'Lasku on jo lähetetty.' using errcode = 'check_violation';
  end if;
  select coalesce(sum(l.amount_cents), 0) into v_total
    from public.koutsi_invoice_lines l where l.invoice_id = p_invoice and l.charged;
  if v_total <= 0 then
    raise exception 'Laskulla ei ole mitään veloitettavaa.' using errcode = 'check_violation';
  end if;
  select * into v_b from public.koutsi_billers b where b.id = v_inv.biller_id for update;
  v_number := v_b.next_number;
  while exists (select 1 from public.koutsi_invoices i where i.biller_id = v_b.id and i.number = v_number) loop
    v_number := v_number + 1;
  end loop;
  update public.koutsi_billers set next_number = v_number + 1 where id = v_b.id;
  v_due := v_today + v_b.payment_days;
  update public.koutsi_invoices set
    status = 'sent', number = v_number, reference = public.koutsi_reference(v_number),
    issue_date = v_today, due_date = v_due, total_cents = v_total, vat_mode = v_b.vat_mode,
    seller = jsonb_strip_nulls(jsonb_build_object('name', v_b.name, 'businessId', v_b.business_id, 'address', v_b.address,
      'email', v_b.email, 'phone', v_b.phone, 'iban', v_b.iban, 'bic', v_b.bic)),
    sent_at = now()
   where id = p_invoice;
  if v_inv.student_id is not null then
    perform public.koutsi_notify(v_inv.student_id, v_inv.coach_id, 'invoice',
      'Uusi lasku: ' || public.koutsi_euros(v_total),
      v_b.name || ' · eräpäivä ' || to_char(v_due, 'FMDD.FMMM.YYYY'),
      '/pelaaja/laskut/' || p_invoice);
  end if;
  return jsonb_build_object('id', p_invoice, 'number', v_number, 'reference', public.koutsi_reference(v_number), 'dueDate', v_due);
end;
$function$;

-- Several drafts at once ("Lähetä kaikki"), in the given order; all or nothing.
create or replace function public.koutsi_send_invoices(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_out jsonb := '[]'::jsonb;
  v_id uuid;
begin
  foreach v_id in array coalesce(p_ids, '{}'::uuid[]) loop
    v_out := v_out || jsonb_build_array(public.koutsi_send_invoice(v_id));
  end loop;
  return v_out;
end;
$function$;

create or replace function public.koutsi_set_invoice_paid(p_invoice uuid, p_paid boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_inv public.koutsi_invoices%rowtype;
begin
  select * into v_inv from public.koutsi_invoices i where i.id = p_invoice for update;
  if v_inv.id is null or not public.koutsi_acts_as(v_inv.coach_id) then
    raise exception 'Laskua ei löytynyt.' using errcode = 'P0002';
  end if;
  if v_inv.status not in ('sent', 'paid') then
    raise exception 'Vain lähetetyn laskun voi merkitä maksetuksi.' using errcode = 'check_violation';
  end if;
  update public.koutsi_invoices
     set status = case when p_paid then 'paid' else 'sent' end,
         paid_at = case when p_paid then coalesce(v_inv.paid_at, now()) else null end
   where id = p_invoice;
end;
$function$;

-- Void: the invoice stays (its number is used) but nothing is owed, and its sessions can be billed again.
create or replace function public.koutsi_void_invoice(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_inv public.koutsi_invoices%rowtype;
begin
  select * into v_inv from public.koutsi_invoices i where i.id = p_invoice for update;
  if v_inv.id is null or not public.koutsi_acts_as(v_inv.coach_id) then
    raise exception 'Laskua ei löytynyt.' using errcode = 'P0002';
  end if;
  if v_inv.status not in ('sent', 'paid') then
    raise exception 'Vain lähetetyn laskun voi mitätöidä.' using errcode = 'check_violation';
  end if;
  update public.koutsi_invoices set status = 'void', voided_at = now() where id = p_invoice;
  update public.koutsi_invoice_lines set voided = true where invoice_id = p_invoice;
  if v_inv.student_id is not null then
    perform public.koutsi_notify(v_inv.student_id, v_inv.coach_id, 'invoice',
      'Lasku ' || v_inv.number || ' peruttu', 'Sinun ei tarvitse maksaa sitä.', '/pelaaja/laskut');
  end if;
end;
$function$;

-- ── function rights ─────────────────────────────────────────────────────────

revoke all on function public.koutsi_billing_coach_enabled(uuid) from public, anon, authenticated;
revoke all on function public.koutsi_reference(integer) from public, anon, authenticated;
revoke all on function public.koutsi_euros(integer) from public, anon, authenticated;
revoke all on function public.koutsi_invoice_guard() from public, anon, authenticated;
revoke all on function public.koutsi_invoice_line_guard() from public, anon, authenticated;
revoke all on function public.koutsi_invoice_line_total() from public, anon, authenticated;
revoke all on function public.koutsi_biller_stamp() from public, anon, authenticated;

revoke all on function public.koutsi_billing_enabled(uuid) from public, anon;
revoke all on function public.koutsi_invoice_readable(uuid) from public, anon;
revoke all on function public.koutsi_invoice_editable(uuid) from public, anon;
revoke all on function public.koutsi_billing_memberships(uuid) from public, anon;
revoke all on function public.koutsi_my_billing_terms() from public, anon;
revoke all on function public.koutsi_create_invoice_drafts(uuid, jsonb) from public, anon;
revoke all on function public.koutsi_send_invoice(uuid) from public, anon;
revoke all on function public.koutsi_send_invoices(uuid[]) from public, anon;
revoke all on function public.koutsi_set_invoice_paid(uuid, boolean) from public, anon;
revoke all on function public.koutsi_void_invoice(uuid) from public, anon;
grant execute on function public.koutsi_billing_enabled(uuid) to authenticated;
grant execute on function public.koutsi_invoice_readable(uuid) to authenticated;
grant execute on function public.koutsi_invoice_editable(uuid) to authenticated;
grant execute on function public.koutsi_billing_memberships(uuid) to authenticated;
grant execute on function public.koutsi_my_billing_terms() to authenticated;
grant execute on function public.koutsi_create_invoice_drafts(uuid, jsonb) to authenticated;
grant execute on function public.koutsi_send_invoice(uuid) to authenticated;
grant execute on function public.koutsi_send_invoices(uuid[]) to authenticated;
grant execute on function public.koutsi_set_invoice_paid(uuid, boolean) to authenticated;
grant execute on function public.koutsi_void_invoice(uuid) to authenticated;

revoke all on function public.koutsi_invoice_public(uuid) from public;
grant execute on function public.koutsi_invoice_public(uuid) to anon, authenticated;
