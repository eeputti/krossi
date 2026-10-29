-- 20261029190000_koutsi_coach_plans.sql — Koutsi for private coaches: a coach can start without a
-- coach key (a 3-month free trial, no card), then take a monthly subscription through Stripe
-- (paid to Roisku Media).
--
-- NOT APPLIED — a proposal. Apply only on the user's "aja migraatio" (apply_migration with this
-- name), then move the file to supabase/migrations. Tested in PGlite against a stub of the
-- production schema: koutsi/web/sql/20261029190000_koutsi_coach_plans.check.mjs
-- Additive: one table, eleven functions, send guards (triggers) on six existing tables, one cron job.
-- The one replaced function is koutsi_billing_coach_enabled (Laskutus' gate): same rule plus the plan.
-- Rollback: drop the triggers koutsi_plan_send_guard / koutsi_invoices_plan_guard, the cron job
-- koutsi-trial-reminders, table public.koutsi_coach_plans (cascade) and the new functions, and put
-- back koutsi_billing_coach_enabled from 20261029162350_koutsi_billing.sql.
--
-- Rules the app relies on:
--   * Every coach who exists when this runs is 'free' (contract customers, e.g. the Mikkeli club):
--     no trial counter, no payment request, nothing new. A coach with no row is 'free' too, so a
--     coach key keeps making free coaches exactly as before.
--   * A signed-in person with a profile and a confirmed e-mail becomes a coach without a key
--     (koutsi_start_trial): the coach row, a 3-month trial and the acceptance of the subscription
--     terms in one call. One trial per account; calling it again changes nothing.
--   * The trial ends by itself: koutsi_coach_plan() reads trial_ends_at (no cron).
--   * Stripe writes only through koutsi_plan_apply_stripe (service role: the edge functions
--     koutsi-subscription and koutsi-stripe-webhook). It never changes a 'free' coach's plan, and a
--     late event of an old subscription never ends a newer live one.
--   * The coach reads their own row; nobody writes it from the app.
--   * New coaches without a key: koutsi_self_serve_open() — pausing sign-ups is a one-line replace
--     of that function (select false); the coach key keeps working either way.
--   * koutsi_coach_plan(coach) is the one answer for other features: 'free' | 'trial' | 'active' |
--     'past_due' | 'ended', or null for someone who is not a coach.
--   * After the trial without a subscription ('ended', the user's decision of 29.10.2026): the coach
--     sees everything and keeps planning (calendar, themes, attendance, players, groups), but sending
--     something new to players needs a subscription — a note (huomio), homework, a video, a notice
--     (tiedote), a message (Viestit) or an invoice. Enforced here, so the old Koutsi is covered too
--     (koutsi_plan_send_guard: before insert; koutsi_invoice_plan_guard: draft → sent). Players are
--     never stopped: their own homework, videos and messages go through, and nothing they read changes.
--     Locking more later (new sessions, themes) = one more table name in the list below.
--   * Laskutus (20261029162350_koutsi_billing): koutsi_billing_coach_enabled() also opens it for a coach
--     on the trial or a subscription, and, after the trial, to a coach who already has a seller, so old
--     invoices can still be read and marked paid (sending stays locked). Admins and koutsi_billing_coaches
--     as before; Alpo and other free coaches see nothing new.
--   * One reminder 7 days before the trial ends (bell + e-mail through koutsi_notify, kind
--     'trial_ending'), daily cron koutsi-trial-reminders.

-- ── table ───────────────────────────────────────────────────────────────────

create table if not exists public.koutsi_coach_plans (
  coach_id uuid primary key references public.koutsi_coaches(id) on delete cascade,
  -- 'trial' and 'ended' both mean "no live subscription": which one applies is read from
  -- trial_ends_at (koutsi_coach_plan), so a subscription cancelled inside the trial gives the
  -- rest of the trial back.
  plan text not null check (plan in ('free', 'trial', 'active', 'past_due', 'ended')),
  trial_ends_at timestamptz,
  terms_version text,
  terms_accepted_at timestamptz,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_status text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  trial_reminded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint koutsi_coach_plans_trial_end check (plan <> 'trial' or trial_ends_at is not null)
);

alter table public.koutsi_coach_plans enable row level security;

drop policy if exists koutsi_coach_plans_own_read on public.koutsi_coach_plans;
create policy koutsi_coach_plans_own_read on public.koutsi_coach_plans
  for select to authenticated using (coach_id = (select auth.uid()));

-- Reads go through the policy above; every write goes through the functions below.
revoke all on table public.koutsi_coach_plans from anon;
revoke insert, update, delete, truncate on table public.koutsi_coach_plans from authenticated;

-- Today's coaches are contract customers: free, now and later.
insert into public.koutsi_coach_plans (coach_id, plan)
select c.id, 'free' from public.koutsi_coaches c
on conflict (coach_id) do nothing;

-- ── the answer ──────────────────────────────────────────────────────────────

-- New coaches without a key. Pause with `select false`; the coach key keeps working.
create or replace function public.koutsi_self_serve_open()
returns boolean
language sql
stable
set search_path = ''
as $function$
  select true;
$function$;

-- The coach's plan right now: 'free' | 'trial' | 'active' | 'past_due' | 'ended'; null = not a coach.
create or replace function public.koutsi_coach_plan(p_coach uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (select case
              when p.plan = 'free' then 'free'
              when p.plan in ('active', 'past_due') then p.plan
              when p.trial_ends_at > now() then 'trial'
              else 'ended'
            end
       from public.koutsi_coach_plans p
      where p.coach_id = p_coach),
    case when exists (select 1 from public.koutsi_coaches c where c.id = p_coach) then 'free' end
  );
$function$;

-- For the app (also before signing in): may a new coach start without a key, and what is mine?
create or replace function public.koutsi_plan_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'self_serve', public.koutsi_self_serve_open(),
    'plan', public.koutsi_coach_plan((select auth.uid())),
    'trial_ends_at', p.trial_ends_at,
    'stripe_status', p.stripe_status,
    'period_end', p.current_period_end,
    'cancel_at_period_end', coalesce(p.cancel_at_period_end, false),
    'has_customer', p.stripe_customer_id is not null
  )
  from (select 1) as one
  left join public.koutsi_coach_plans p on p.coach_id = (select auth.uid());
$function$;

-- ── starting without a key ──────────────────────────────────────────────────

-- "Aloita 3 kk ilmainen kokeilu": the coach row, the trial and the terms in one go. Someone who is
-- already a coach gets their status back unchanged (a free coach stays free, a trial is not
-- extended). The starter drills are added like after a coach key.
create or replace function public.koutsi_start_trial(p_terms_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if exists (select 1 from public.koutsi_coaches c where c.id = v_uid) then
    return public.koutsi_plan_status();
  end if;
  if not public.koutsi_self_serve_open() then
    raise exception 'Kokeilua ei voi juuri nyt aloittaa. Jos sinulla on valmentaja-avain, käytä sitä.';
  end if;
  if p_terms_version is null or btrim(p_terms_version) = '' then
    raise exception 'Tilausehtojen hyväksyntä puuttuu. Päivitä sivu ja yritä uudelleen.';
  end if;
  if not exists (select 1 from public.profiles pr where pr.id = v_uid) then
    raise exception 'profile required';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
    raise exception 'Vahvista ensin sähköpostiosoitteesi vahvistusviestin linkistä.';
  end if;

  insert into public.koutsi_coaches (id) values (v_uid) on conflict (id) do nothing;
  insert into public.koutsi_coach_plans (coach_id, plan, trial_ends_at, terms_version, terms_accepted_at)
  values (v_uid, 'trial', now() + interval '3 months', left(btrim(p_terms_version), 40), now())
  on conflict (coach_id) do nothing;
  perform public.koutsi_seed_exercises(v_uid);

  return public.koutsi_plan_status();
end;
$function$;

-- ── Stripe ──────────────────────────────────────────────────────────────────

-- The checkout's customer, saved before the coach is sent to Stripe (koutsi-subscription), so the
-- next checkout and the customer portal reuse it.
create or replace function public.koutsi_plan_set_customer(p_coach uuid, p_customer text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_coach is null or p_customer is null or btrim(p_customer) = '' then
    return;
  end if;
  insert into public.koutsi_coach_plans as p (coach_id, plan, stripe_customer_id, updated_at)
  select c.id, 'free', p_customer, now() from public.koutsi_coaches c where c.id = p_coach
  on conflict (coach_id) do update
    set stripe_customer_id = excluded.stripe_customer_id, updated_at = now();
end;
$function$;

-- A subscription's state from Stripe (the webhook, or a check right after Checkout / the portal).
-- Returns the coach's plan afterwards (null when the coach no longer exists).
--   active, trialing → 'active' (trialing = taken during the free trial, first charge at its end)
--   past_due, unpaid → 'past_due'
--   canceled, incomplete_expired → 'ended' (inside the free trial koutsi_coach_plan still says 'trial')
--   incomplete, paused, anything else → the plan stays as it was, the details are kept
create or replace function public.koutsi_plan_apply_stripe(
  p_coach uuid,
  p_customer text,
  p_subscription text,
  p_status text,
  p_period_end timestamptz,
  p_cancel_at_period_end boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_next text := case
    when p_status in ('active', 'trialing') then 'active'
    when p_status in ('past_due', 'unpaid') then 'past_due'
    when p_status in ('canceled', 'incomplete_expired') then 'ended'
  end;
  v_row public.koutsi_coach_plans%rowtype;
begin
  if p_coach is null or p_subscription is null then
    return null;
  end if;
  if not exists (select 1 from public.koutsi_coaches c where c.id = p_coach) then
    return null;
  end if;

  select * into v_row from public.koutsi_coach_plans where coach_id = p_coach for update;
  if not found then
    -- A coach from before this table had a row, or from a key: free. Record Stripe, keep free.
    insert into public.koutsi_coach_plans (coach_id, plan) values (p_coach, 'free');
    select * into v_row from public.koutsi_coach_plans where coach_id = p_coach for update;
  end if;

  -- A late event of an older subscription never ends a newer one that is live.
  if v_row.stripe_subscription_id is not null and v_row.stripe_subscription_id <> p_subscription
     and v_row.plan in ('active', 'past_due') and coalesce(v_next, 'ended') = 'ended' then
    return public.koutsi_coach_plan(p_coach);
  end if;

  update public.koutsi_coach_plans
     set plan = case when v_row.plan = 'free' then 'free' else coalesce(v_next, v_row.plan) end,
         stripe_customer_id = coalesce(p_customer, stripe_customer_id),
         stripe_subscription_id = p_subscription,
         stripe_status = p_status,
         current_period_end = p_period_end,
         cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
         updated_at = now()
   where coach_id = p_coach;

  return public.koutsi_coach_plan(p_coach);
end;
$function$;

-- ── after the trial ─────────────────────────────────────────────────────────

-- Sending something new to players when the trial ended without a subscription. Checks the person
-- sending (an admin acting for a coach is not stopped); a player's own row never is.
create or replace function public.koutsi_plan_send_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_row jsonb;
begin
  if v_uid is null or public.koutsi_coach_plan(v_uid) is distinct from 'ended' then
    return new;
  end if;
  v_row := to_jsonb(new);
  -- a player's own homework or video
  if tg_table_name in ('koutsi_homework', 'koutsi_videos') and v_row ->> 'student_id' = v_uid::text then
    return new;
  end if;
  -- a message the player writes (the coach of the conversation is someone else)
  if tg_table_name = 'koutsi_messages' and not exists (
       select 1 from public.koutsi_threads t
        where t.id = (v_row ->> 'thread_id')::uuid and t.coach_id = v_uid) then
    return new;
  end if;
  raise exception 'Kokeilusi on päättynyt. Ota tilaus kohdasta Profiili → Tilaus, niin voit taas lähettää pelaajille.'
    using errcode = '42501';
end;
$function$;

-- Laskutus: an invoice is sent (draft → sent) only with the trial or a subscription; reading,
-- drafts, paid and void stay open.
create or replace function public.koutsi_invoice_plan_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'draft' and new.status = 'sent' and public.koutsi_coach_plan(new.coach_id) = 'ended' then
    raise exception 'Kokeilusi on päättynyt. Ota tilaus kohdasta Profiili → Tilaus, niin voit taas lähettää laskuja.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

-- Every table a coach sends to players through. Viestit (koutsi_messages) only once it exists; its
-- own migration attaches the guard when it comes after this one.
do $$
declare
  v_table text;
begin
  foreach v_table in array array['koutsi_diary_entries', 'koutsi_homework', 'koutsi_videos', 'koutsi_announcements',
                                 'koutsi_sends', 'koutsi_messages'] loop
    if to_regclass('public.' || v_table) is not null then
      execute format('drop trigger if exists koutsi_plan_send_guard on public.%I', v_table);
      execute format('create trigger koutsi_plan_send_guard before insert on public.%I for each row execute function public.koutsi_plan_send_guard()', v_table);
    end if;
  end loop;
  if to_regclass('public.koutsi_invoices') is not null then
    drop trigger if exists koutsi_invoices_plan_guard on public.koutsi_invoices;
    create trigger koutsi_invoices_plan_guard before update on public.koutsi_invoices
      for each row execute function public.koutsi_invoice_plan_guard();
  end if;
end $$;

-- Laskutus' gate (20261029162350_koutsi_billing.sql), the same rule plus the plan.
create or replace function public.koutsi_billing_coach_enabled(p_coach uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  -- always true or false, never null: the billing functions test `not koutsi_billing_enabled(…)`
  select p_coach is not null and coalesce(
    exists (select 1 from public.koutsi_admins a where a.user_id = p_coach)
    or exists (select 1 from public.koutsi_billing_coaches b where b.coach_id = p_coach)
    or public.koutsi_coach_plan(p_coach) in ('trial', 'active', 'past_due')
    or (public.koutsi_coach_plan(p_coach) = 'ended' and exists (select 1 from public.koutsi_billers s where s.coach_id = p_coach)),
    false);
$function$;

-- One reminder per trial, 7 days before it ends (or at once when less is left), to a coach who has
-- not subscribed. Returns how many were sent.
create or replace function public.koutsi_trial_reminders(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row record;
  v_days integer;
  v_count integer := 0;
begin
  for v_row in
    select p.coach_id, p.trial_ends_at
      from public.koutsi_coach_plans p
     where p.plan = 'trial'
       and p.trial_reminded_at is null
       and p.trial_ends_at > p_now
       and p.trial_ends_at <= p_now + interval '7 days'
     for update skip locked
  loop
    v_days := greatest(1, ceil(extract(epoch from (v_row.trial_ends_at - p_now)) / 86400)::integer);
    perform public.koutsi_notify(v_row.coach_id, null, 'trial_ending',
      case when v_days = 1 then 'Koutsi-kokeilusi päättyy huomenna' else 'Koutsi-kokeilusi päättyy ' || v_days || ' päivän päästä' end,
      'Sen jälkeen pelaajille lähettäminen vaatii tilauksen. Ota tilaus kohdasta Profiili → Tilaus.',
      '/valmentaja/profiili');
    update public.koutsi_coach_plans set trial_reminded_at = p_now where coach_id = v_row.coach_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

-- Daily at 06:05 UTC (08:05 or 09:05 in Finland). Idempotent; skipped where pg_cron is not installed.
do $$
declare v_job record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;
  for v_job in select jobid from cron.job where jobname = 'koutsi-trial-reminders' loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  perform cron.schedule('koutsi-trial-reminders', '5 6 * * *', 'select public.koutsi_trial_reminders()');
end $$;

-- ── function rights ─────────────────────────────────────────────────────────

revoke all on function public.koutsi_self_serve_open() from public, anon, authenticated;
revoke all on function public.koutsi_coach_plan(uuid) from public, anon, authenticated;
revoke all on function public.koutsi_plan_status() from public;
revoke all on function public.koutsi_start_trial(text) from public, anon;
revoke all on function public.koutsi_plan_set_customer(uuid, text) from public, anon, authenticated;
revoke all on function public.koutsi_plan_apply_stripe(uuid, text, text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.koutsi_plan_status() to anon, authenticated;
grant execute on function public.koutsi_start_trial(text) to authenticated;
grant execute on function public.koutsi_coach_plan(uuid) to service_role;
grant execute on function public.koutsi_plan_set_customer(uuid, text) to service_role;
grant execute on function public.koutsi_plan_apply_stripe(uuid, text, text, text, timestamptz, boolean) to service_role;
revoke all on function public.koutsi_plan_send_guard() from public, anon, authenticated;
revoke all on function public.koutsi_invoice_plan_guard() from public, anon, authenticated;
revoke all on function public.koutsi_trial_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.koutsi_trial_reminders(timestamptz) to service_role;
-- koutsi_billing_coach_enabled keeps the rights it has (create or replace).
