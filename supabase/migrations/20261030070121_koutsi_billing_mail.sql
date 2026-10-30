-- 20261030070121_koutsi_billing_mail.sql — Laskutus, vaihe 3: the coach's own message on an invoice,
-- a logo, invoices e-mailed with their PDF, reminders, and "En tarvitse laskutusta vielä".
--
-- APPLIED 30.10.2026 on the user's go-ahead (apply_migration koutsi_billing_mail). Tested in PGlite on top
-- of phases 1–2: koutsi/web/sql/20261030070121_koutsi_billing_mail.check.mjs
-- Additive: new columns, a small prefs table, a public logo bucket, one new function, and replaced
-- versions of the invoice guard, koutsi_send_invoice, koutsi_invoice_public, koutsi_invoice_paid_online
-- and koutsi_my_billing_terms.
--
--   * koutsi_invoices.note — a message from the coach on the invoice (drafts only, like everything else).
--     mailed_at / mail_to / reminded_at are written by the koutsi-invoice edge function and
--     koutsi_remind_invoice; they may move on a sent invoice.
--   * koutsi_billers.logo_path — the coach's logo in the public bucket koutsi-logos (<coach id>/…, PNG or
--     JPEG, ≤ 1 MB). Sending copies it into the invoice's seller details (logoPath), so an old invoice keeps
--     the logo it was sent with.
--   * koutsi_billing_prefs.hidden — the coach chose "En tarvitse laskutusta vielä": Laskutus leaves the
--     side nav and Lisää, and comes back from Profiili. The coach's own row; nothing else reads it.
--   * koutsi_billers.stripe_methods — what the coach's Stripe account takes ('card', 'mobilepay',
--     'klarna'), written by koutsi-pay like the other stripe_* columns. Klarna has its own "Maksa
--     Klarnalla" button (its fee is bigger, and the coach pays the fee of the way the player chose), so
--     the link and the player's terms say whether it is there ('klarna').
--   * No "·" between words in the texts (the notifications of sending and of a payment): a comma.

-- ── columns ─────────────────────────────────────────────────────────────────

alter table public.koutsi_invoices
  add column if not exists note text,
  add column if not exists mailed_at timestamptz,
  add column if not exists mail_to text,
  add column if not exists reminded_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'koutsi_invoices_note_length') then
    alter table public.koutsi_invoices
      add constraint koutsi_invoices_note_length check (note is null or char_length(note) <= 500);
  end if;
end $$;

alter table public.koutsi_billers
  add column if not exists logo_path text,
  add column if not exists stripe_methods text[] not null default '{}'::text[];

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'koutsi_billers_logo_path') then
    alter table public.koutsi_billers
      add constraint koutsi_billers_logo_path check (logo_path is null or logo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$');
  end if;
end $$;

grant insert (logo_path), update (logo_path) on public.koutsi_billers to authenticated;

-- ── "En tarvitse laskutusta vielä" ──────────────────────────────────────────

create table if not exists public.koutsi_billing_prefs (
  coach_id uuid primary key references public.koutsi_coaches(id) on delete cascade,
  hidden boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.koutsi_billing_prefs enable row level security;
drop policy if exists koutsi_billing_prefs_select on public.koutsi_billing_prefs;
create policy koutsi_billing_prefs_select on public.koutsi_billing_prefs for select to authenticated
  using (public.koutsi_acts_as(coach_id));
drop policy if exists koutsi_billing_prefs_insert on public.koutsi_billing_prefs;
create policy koutsi_billing_prefs_insert on public.koutsi_billing_prefs for insert to authenticated
  with check (public.koutsi_acts_as(coach_id));
drop policy if exists koutsi_billing_prefs_update on public.koutsi_billing_prefs;
create policy koutsi_billing_prefs_update on public.koutsi_billing_prefs for update to authenticated
  using (public.koutsi_acts_as(coach_id)) with check (public.koutsi_acts_as(coach_id));
revoke all on public.koutsi_billing_prefs from anon, authenticated;
grant select, insert, update on public.koutsi_billing_prefs to authenticated;

-- ── the logo bucket ─────────────────────────────────────────────────────────
-- Public read (the invoice page, the PDF and the e-mail show it); each coach writes only their own folder.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('koutsi-logos', 'koutsi-logos', true, 1048576, array['image/png', 'image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/png', 'image/jpeg'];

drop policy if exists koutsi_logos_insert on storage.objects;
create policy koutsi_logos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'koutsi-logos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists koutsi_logos_update on storage.objects;
create policy koutsi_logos_update on storage.objects for update to authenticated
  using (bucket_id = 'koutsi-logos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'koutsi-logos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists koutsi_logos_delete on storage.objects;
create policy koutsi_logos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'koutsi-logos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── the invoice guard: the message on drafts, the mail columns on sent invoices ──
create or replace function public.koutsi_invoice_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_biller public.koutsi_billers%rowtype;
  v_fixed text[] := array['status', 'paid_at', 'voided_at', 'updated_at', 'student_id',
                          'checkout_session_id', 'paid_via', 'stripe_payment_intent',
                          'mailed_at', 'mail_to', 'reminded_at'];
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
    new.mailed_at := null;
    new.mail_to := null;
    new.reminded_at := null;
    new.note := nullif(btrim(coalesce(new.note, '')), '');
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

-- ── sending: the logo goes into the seller's details too ────────────────────
-- Against phase 1: seller.logoPath.
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
      'email', v_b.email, 'phone', v_b.phone, 'iban', v_b.iban, 'bic', v_b.bic, 'logoPath', v_b.logo_path)),
    sent_at = now()
   where id = p_invoice;
  if v_inv.student_id is not null then
    perform public.koutsi_notify(v_inv.student_id, v_inv.coach_id, 'invoice',
      'Uusi lasku: ' || public.koutsi_euros(v_total),
      v_b.name || ', eräpäivä ' || to_char(v_due, 'FMDD.FMMM.YYYY'),
      '/pelaaja/laskut/' || p_invoice);
  end if;
  return jsonb_build_object('id', p_invoice, 'number', v_number, 'reference', public.koutsi_reference(v_number), 'dueDate', v_due);
end;
$function$;

-- ── what the link shows: the coach's message too, and whether Klarna is there ──
-- Against phase 2: 'note' and 'klarna'.
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
    'paidVia', i.paid_via, 'note', i.note,
    'payable', (i.status = 'sent' and i.total_cents > 0 and b.pay_online and b.stripe_charges_enabled and b.stripe_account_id is not null),
    'klarna', (i.status = 'sent' and i.total_cents > 0 and b.pay_online and b.stripe_charges_enabled and b.stripe_account_id is not null
               and 'klarna' = any(b.stripe_methods)),
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

-- ── a reminder: the player hears it in the app (the e-mail is the edge function's) ──
-- At most once a day per invoice; false when it was too soon.
create or replace function public.koutsi_remind_invoice(p_invoice uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_inv public.koutsi_invoices%rowtype;
  v_name text;
begin
  select * into v_inv from public.koutsi_invoices i where i.id = p_invoice for update;
  if v_inv.id is null or not public.koutsi_acts_as(v_inv.coach_id) then
    raise exception 'Laskua ei löytynyt.' using errcode = 'P0002';
  end if;
  if v_inv.status <> 'sent' then
    raise exception 'Muistutuksen voi lähettää vain avoimesta laskusta.' using errcode = 'check_violation';
  end if;
  if v_inv.reminded_at is not null and v_inv.reminded_at > now() - interval '20 hours' then
    return false;
  end if;
  update public.koutsi_invoices set reminded_at = now() where id = p_invoice;
  v_name := coalesce(v_inv.seller->>'name', '');
  if v_inv.student_id is not null then
    perform public.koutsi_notify(v_inv.student_id, v_inv.coach_id, 'invoice',
      'Muistutus: lasku ' || v_inv.number || ' (' || public.koutsi_euros(v_inv.total_cents) || ')',
      v_name || ', eräpäivä oli ' || to_char(v_inv.due_date, 'FMDD.FMMM.YYYY'),
      '/pelaaja/laskut/' || p_invoice);
  end if;
  return true;
end;
$function$;

-- ── paid online: the coach's notification without the "·" ──────────────────
-- Against phase 2: only the text ('Aatu L., 240,00 €').
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
    v_inv.payer_name || ', ' || public.koutsi_euros(v_inv.total_cents),
    '/valmentaja/laskutus?lasku=' || p_invoice);
  return true;
end;
$function$;

-- ── the player's terms: whether Klarna is there ─────────────────────────────
-- Against phase 2: klarna.
drop function if exists public.koutsi_my_billing_terms();
create function public.koutsi_my_billing_terms()
returns table (coach_id uuid, seller_name text, cancel_hours integer, charge_late boolean, charge_no_show boolean,
               terms text, payment_days integer, pay_online boolean, klarna boolean)
language sql
stable
security definer
set search_path = ''
as $function$
  select b.coach_id, b.name, b.cancel_hours, b.charge_late, b.charge_no_show, b.terms, b.payment_days,
         (b.pay_online and b.stripe_charges_enabled and b.stripe_account_id is not null),
         (b.pay_online and b.stripe_charges_enabled and b.stripe_account_id is not null and 'klarna' = any(b.stripe_methods))
    from public.koutsi_billers b
    join public.koutsi_coach_students cs
      on cs.coach_id = b.coach_id and cs.student_id = (select auth.uid()) and cs.ended_at is null
   where public.koutsi_billing_coach_enabled(b.coach_id);
$function$;

revoke all on function public.koutsi_remind_invoice(uuid) from public, anon;
grant execute on function public.koutsi_remind_invoice(uuid) to authenticated;
revoke all on function public.koutsi_send_invoice(uuid) from public, anon;
grant execute on function public.koutsi_send_invoice(uuid) to authenticated;
revoke all on function public.koutsi_invoice_public(uuid) from public;
grant execute on function public.koutsi_invoice_public(uuid) to anon, authenticated;
revoke all on function public.koutsi_invoice_paid_online(uuid, text, text) from public, anon, authenticated;
grant execute on function public.koutsi_invoice_paid_online(uuid, text, text) to service_role;
revoke all on function public.koutsi_my_billing_terms() from public, anon;
grant execute on function public.koutsi_my_billing_terms() to authenticated;
