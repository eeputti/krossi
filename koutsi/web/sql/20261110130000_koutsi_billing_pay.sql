-- 20261110130000_koutsi_billing_pay.sql — Laskutus, vaihe 2: the player pays an invoice online.
--
-- NOT APPLIED — a proposal (29.10.2026). Apply only on the user's go-ahead (apply_migration
-- koutsi_billing_pay), then move the file to supabase/migrations. Tested in PGlite on top of
-- 20261029162350_koutsi_billing: koutsi/web/sql/20261110130000_koutsi_billing_pay.check.mjs
-- Additive: new columns, one new function, and replaced versions of the phase-1 invoice guard,
-- koutsi_set_invoice_paid, koutsi_invoice_public and koutsi_my_billing_terms. The old Koutsi reads none of it.
--
-- How payments work (edge function supabase/functions/koutsi-pay):
--   * The coach connects their own Stripe account (a standard account: the coach is the seller,
--     pays Stripe's fee from each payment and handles refunds in their own Stripe dashboard;
--     Krossi takes nothing and carries no Connect fees or losses). Only the edge function (service
--     role) writes the stripe_* columns: clients can't, by column rights.
--   * "Maksa" on an invoice opens Stripe Checkout on the coach's account (card, Apple / Google Pay,
--     and MobilePay or Klarna when the coach has them on). The payment is confirmed when the payer
--     comes back (and again whenever the coach opens Laskutus): koutsi_invoice_paid_online marks
--     the invoice paid once and tells the coach.
--   * pay_online lets the coach keep a connected account but turn online payment off.

-- ── columns ─────────────────────────────────────────────────────────────────

alter table public.koutsi_billers
  add column if not exists stripe_account_id text,
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists stripe_details_submitted boolean not null default false,
  add column if not exists stripe_checked_at timestamptz,
  add column if not exists pay_online boolean not null default true;

create unique index if not exists koutsi_billers_stripe_account_idx
  on public.koutsi_billers (stripe_account_id) where stripe_account_id is not null;

alter table public.koutsi_invoices
  add column if not exists checkout_session_id text,
  add column if not exists paid_via text,
  add column if not exists stripe_payment_intent text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'koutsi_invoices_paid_via') then
    alter table public.koutsi_invoices
      add constraint koutsi_invoices_paid_via check (paid_via is null or paid_via in ('manual', 'stripe'));
  end if;
end $$;

-- Clients write only the seller's own details; the stripe_* columns are the edge function's.
revoke insert, update on public.koutsi_billers from authenticated;
grant insert (coach_id, name, business_id, address, email, phone, iban, bic, vat_mode, payment_days, cancel_hours,
  charge_late, charge_no_show, terms, next_number, prices, payers, pay_online) on public.koutsi_billers to authenticated;
grant update (coach_id, name, business_id, address, email, phone, iban, bic, vat_mode, payment_days, cancel_hours,
  charge_late, charge_no_show, terms, next_number, prices, payers, pay_online) on public.koutsi_billers to authenticated;

-- ── the invoice guard, now with the payment columns ─────────────────────────
-- Against phase 1: a draft clears the payment columns too, and on a sent invoice the payment
-- columns may move (the edge function stores the Checkout session and the payment).
create or replace function public.koutsi_invoice_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_biller public.koutsi_billers%rowtype;
  v_fixed text[] := array['status', 'paid_at', 'voided_at', 'updated_at', 'student_id',
                          'checkout_session_id', 'paid_via', 'stripe_payment_intent'];
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
    new.checkout_session_id := null;
    new.paid_via := null;
    new.stripe_payment_intent := null;
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

-- ── paid by hand (the coach) ────────────────────────────────────────────────
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
  if not p_paid and v_inv.paid_via = 'stripe' then
    raise exception 'Lasku on maksettu verkossa. Palauta maksu Stripessä, jos se pitää perua.' using errcode = 'check_violation';
  end if;
  update public.koutsi_invoices
     set status = case when p_paid then 'paid' else 'sent' end,
         paid_at = case when p_paid then coalesce(v_inv.paid_at, now()) else null end,
         paid_via = case when p_paid then coalesce(v_inv.paid_via, 'manual') else null end
   where id = p_invoice;
end;
$function$;

-- ── paid online (the edge function, after Stripe says paid) ─────────────────
-- Once: a second confirmation of the same payment changes nothing. The coach hears about it.
create or replace function public.koutsi_invoice_paid_online(p_invoice uuid, p_session text, p_payment_intent text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_inv public.koutsi_invoices%rowtype;
begin
  select * into v_inv from public.koutsi_invoices i where i.id = p_invoice for update;
  if v_inv.id is null or v_inv.status <> 'sent' then
    return false;
  end if;
  update public.koutsi_invoices
     set status = 'paid', paid_at = now(), paid_via = 'stripe',
         checkout_session_id = coalesce(p_session, checkout_session_id),
         stripe_payment_intent = coalesce(p_payment_intent, stripe_payment_intent)
   where id = p_invoice;
  perform public.koutsi_notify(v_inv.coach_id, v_inv.student_id, 'invoice_paid',
    'Lasku ' || v_inv.number || ' maksettu',
    v_inv.payer_name || ' · ' || public.koutsi_euros(v_inv.total_cents),
    '/valmentaja/laskutus?lasku=' || p_invoice);
  return true;
end;
$function$;

-- ── what the link and the player see ────────────────────────────────────────
-- Against phase 1: 'payable' (the payer can pay online now) and 'paidVia'.
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
    'paidVia', i.paid_via,
    'payable', (i.status = 'sent' and i.total_cents > 0 and b.pay_online and b.stripe_charges_enabled and b.stripe_account_id is not null),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'sortOrder', l.sort_order, 'kind', l.kind, 'date', l.line_date, 'time', l.line_time,
        'description', l.description, 'quantity', l.quantity, 'unitCents', l.unit_cents, 'amountCents', l.amount_cents,
        'charged', l.charged) order by l.sort_order, l.line_date, l.line_time)
        from public.koutsi_invoice_lines l where l.invoice_id = i.id), '[]'::jsonb))
    from public.koutsi_invoices i
    join public.koutsi_billers b on b.id = i.biller_id
   where i.public_token = p_token
     and i.status in ('sent', 'paid', 'void');
$function$;

-- Against phase 1: pay_online — the coach takes online payments right now.
drop function if exists public.koutsi_my_billing_terms();
create function public.koutsi_my_billing_terms()
returns table (coach_id uuid, seller_name text, cancel_hours integer, charge_late boolean, charge_no_show boolean,
               terms text, payment_days integer, pay_online boolean)
language sql
stable
security definer
set search_path = ''
as $function$
  select b.coach_id, b.name, b.cancel_hours, b.charge_late, b.charge_no_show, b.terms, b.payment_days,
         (b.pay_online and b.stripe_charges_enabled and b.stripe_account_id is not null)
    from public.koutsi_billers b
    join public.koutsi_coach_students cs
      on cs.coach_id = b.coach_id and cs.student_id = (select auth.uid()) and cs.ended_at is null
   where public.koutsi_billing_coach_enabled(b.coach_id);
$function$;

-- ── function rights ─────────────────────────────────────────────────────────
revoke all on function public.koutsi_invoice_paid_online(uuid, text, text) from public, anon, authenticated;
grant execute on function public.koutsi_invoice_paid_online(uuid, text, text) to service_role;
revoke all on function public.koutsi_my_billing_terms() from public, anon;
grant execute on function public.koutsi_my_billing_terms() to authenticated;
revoke all on function public.koutsi_set_invoice_paid(uuid, boolean) from public, anon;
grant execute on function public.koutsi_set_invoice_paid(uuid, boolean) to authenticated;
revoke all on function public.koutsi_invoice_public(uuid) from public;
grant execute on function public.koutsi_invoice_public(uuid) to anon, authenticated;
