-- 20261030123905_koutsi_billing_fixes.sql — Laskutus fixes after the review of 30.10.2026.
--
-- APPLIED 30.10.2026 as 20261030123905_koutsi_billing_fixes. Runs on top of every earlier migration (Laskutus phases 1–3 included).
-- Tested in PGlite: koutsi/web/sql/20261030123905_koutsi_billing_fixes.check.mjs. Re-runnable.
-- Each replaced function starts from its latest definition in supabase/migrations; grants are restated.
--
--   1. Group membership history. A player removed from a group and added back used to be billed for
--      the weeks between (the row kept its first created_at and only ended_at went back to null).
--      koutsi_group_members gets past_periods (jsonb [{ from, until }]) and rejoined_at, kept by a
--      trigger: ended → active pushes the old period and starts a new one now; an ended membership
--      keeps the day it ended; clients cannot write the history. koutsi_billing_memberships returns both.
--      Claims and merges no longer bring back every group the placeholder had left: each membership
--      moves with its history (koutsi_move_group_membership); one on both players becomes one row,
--      active if either was.
--   2. A placeholder's invoices follow the player they are merged into or claimed by also when that
--      player was already the coach's (the coaching row is deleted there, which used to leave the
--      invoices without a player, so their sessions could be billed again), and so does the payer the
--      coach wrote down for them (koutsi_billers.payers) — koutsi_move_billing.
--   3. koutsi_billing_students: the players who have left the coach, for the sessions they had.
--   4. A season fee once per player, group and season (was: once ever). koutsi_invoice_lines.period_key
--      = the season (koutsi_season_key: the group's season, the coach's season on that day, else the
--      half-year 'YYYY-kevat' / 'YYYY-syksy'; the app's seasonKeyFor is the same rule); existing season
--      lines get theirs, the unique index includes it, and koutsi_create_invoice_drafts stores it.
--   5. An invoice paid online cannot be voided (refund it instead). A payment that still comes through
--      after the coach voided an invoice or marked it paid is recorded and the coach told
--      (koutsi_invoice_late_payment, service role: koutsi-pay).
--   6. "Muistuta": "eräpäivä on <date>" until the due date, "eräpäivä oli <date>" after it.
--   7. A group's weekly time moved: koutsi_reschedule_group drops and remakes the coming sessions in one
--      go (the same rows and notifications as the app's two steps) and moves each "En pääse" report to
--      the new session of the same week, as it was reported (koutsi_stamp_training_absence keeps
--      reported_by and the times while it does that).
-- Rollback: drop the new functions, the trigger koutsi_group_members_history, the new columns and the
-- index, and re-run the old definitions (they are in supabase/migrations).

-- ── 1. group membership history ─────────────────────────────────────────────

alter table public.koutsi_group_members
  add column if not exists rejoined_at timestamptz,
  add column if not exists past_periods jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'koutsi_group_members_past_periods') then
    alter table public.koutsi_group_members
      add constraint koutsi_group_members_past_periods check (jsonb_typeof(past_periods) = 'array');
  end if;
end $$;

-- The history is the database's: koutsi_move_group_membership writes it for claims and merges
-- (koutsi.membership_merge), nobody else can.
create or replace function public.koutsi_group_member_history()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if coalesce(current_setting('koutsi.membership_merge', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.past_periods := '[]'::jsonb;
    new.rejoined_at := null;
    return new;
  end if;
  new.past_periods := old.past_periods;
  new.rejoined_at := old.rejoined_at;
  new.created_at := old.created_at;
  if old.ended_at is not null and new.ended_at is not null then
    new.ended_at := old.ended_at; -- removed again: it still ended the first time
  elsif old.ended_at is not null and new.ended_at is null then
    new.past_periods := old.past_periods || jsonb_build_array(jsonb_build_object(
      'from', coalesce(old.rejoined_at, old.created_at), 'until', old.ended_at));
    new.rejoined_at := now();
  end if;
  return new;
end;
$function$;

drop trigger if exists koutsi_group_members_history on public.koutsi_group_members;
create trigger koutsi_group_members_history before insert or update on public.koutsi_group_members
  for each row execute function public.koutsi_group_member_history();

-- p_from's membership of p_group becomes p_to's (a claim, a merge). Alone it moves as it is, ended or
-- not. On both: one row with both histories, active if either is (from the earlier start when both are).
create or replace function public.koutsi_move_group_membership(p_group uuid, p_from uuid, p_to uuid)
returns void
language plpgsql
set search_path = ''
as $function$
declare
  a public.koutsi_group_members%rowtype;
  b public.koutsi_group_members%rowtype;
  v_a_start timestamptz;
  v_b_start timestamptz;
  v_periods jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_first timestamptz;
  v_both boolean;
begin
  if p_from is null or p_to is null or p_from = p_to then
    return;
  end if;
  select * into a from public.koutsi_group_members m where m.group_id = p_group and m.student_id = p_from for update;
  if not found then
    return;
  end if;
  select * into b from public.koutsi_group_members m where m.group_id = p_group and m.student_id = p_to for update;
  v_both := found;
  perform set_config('koutsi.membership_merge', 'on', true);
  if not v_both then
    update public.koutsi_group_members set student_id = p_to where group_id = p_group and student_id = p_from;
  else
    v_a_start := coalesce(a.rejoined_at, a.created_at);
    v_b_start := coalesce(b.rejoined_at, b.created_at);
    v_periods := coalesce(b.past_periods, '[]'::jsonb) || coalesce(a.past_periods, '[]'::jsonb);
    if a.ended_at is null and b.ended_at is null then
      v_start := least(v_a_start, v_b_start);
    elsif a.ended_at is null then
      v_periods := v_periods || jsonb_build_array(jsonb_build_object('from', v_b_start, 'until', b.ended_at));
      v_start := v_a_start;
    elsif b.ended_at is null then
      v_periods := v_periods || jsonb_build_array(jsonb_build_object('from', v_a_start, 'until', a.ended_at));
      v_start := v_b_start;
    elsif a.ended_at > b.ended_at then
      v_periods := v_periods || jsonb_build_array(jsonb_build_object('from', v_b_start, 'until', b.ended_at));
      v_start := v_a_start;
      v_end := a.ended_at;
    else
      v_periods := v_periods || jsonb_build_array(jsonb_build_object('from', v_a_start, 'until', a.ended_at));
      v_start := v_b_start;
      v_end := b.ended_at;
    end if;
    v_first := least(a.created_at, b.created_at);
    delete from public.koutsi_group_members where group_id = p_group and student_id = p_from;
    update public.koutsi_group_members
       set created_at = v_first, ended_at = v_end, past_periods = v_periods,
           rejoined_at = case when v_start > v_first then v_start end
     where group_id = p_group and student_id = p_to;
  end if;
  perform set_config('koutsi.membership_merge', '', true);
end;
$function$;

-- Against phase 1: rejoined_at and past_periods (the earlier periods of a player who came back).
drop function if exists public.koutsi_billing_memberships(uuid);
create function public.koutsi_billing_memberships(p_coach uuid)
returns table (group_id uuid, student_id uuid, joined_at timestamptz, ended_at timestamptz, group_created_at timestamptz,
               rejoined_at timestamptz, past_periods jsonb)
language sql
stable
security definer
set search_path = ''
as $function$
  select m.group_id, m.student_id, m.created_at, m.ended_at, g.created_at, m.rejoined_at, m.past_periods
    from public.koutsi_group_members m
    join public.koutsi_groups g on g.id = m.group_id
   where g.coach_id = p_coach
     and public.koutsi_acts_as(p_coach);
$function$;

-- ── 2. invoices and payers follow a merged or claimed placeholder ───────────

-- p_from's invoices move to p_to under every coach p_to already has (where the coaching row is about
-- to be deleted, not renamed), and so does p_from's payer in each seller's list (p_to's own is kept).
create or replace function public.koutsi_move_billing(p_from uuid, p_to uuid)
returns void
language plpgsql
set search_path = ''
as $function$
declare
  v_id uuid;
begin
  if p_from is null or p_to is null or p_from = p_to then
    return;
  end if;
  for v_id in
    select i.id from public.koutsi_invoices i
     where i.student_id = p_from
       and exists (select 1 from public.koutsi_coach_students cs where cs.coach_id = i.coach_id and cs.student_id = p_to)
  loop
    begin
      update public.koutsi_invoices set student_id = p_to where id = v_id;
    exception when unique_violation then
      null; -- the same session is on both players' invoices: this one keeps only the payer's name
    end;
  end loop;
  update public.koutsi_billers b
     set payers = (b.payers - p_from::text)
               || case when b.payers ? p_to::text then '{}'::jsonb
                       else jsonb_build_object(p_to::text, b.payers -> p_from::text) end
   where b.payers ? p_from::text;
end;
$function$;

-- Against 20260911202750: the invoices and the payer move (koutsi_move_billing), and each group
-- membership moves with its history instead of every one coming back (ended_at = null).
create or replace function public.koutsi_claim_player(code_input text, student_id_input uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_coach uuid;
  v_ph koutsi_students%rowtype;
  v_coach_name text;
  v_group uuid;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not exists (select 1 from profiles where id = v_uid) then
    raise exception 'profile required';
  end if;

  v_coach := public.koutsi_coach_for_code(code_input);
  if v_coach is null then raise exception 'invalid invite code'; end if;
  if v_coach = v_uid then raise exception 'own coach code'; end if;

  select * into v_ph from koutsi_students where id = student_id_input for update;
  if not found or v_ph.placeholder_coach_id is null or v_ph.placeholder_coach_id <> v_coach then
    raise exception 'Tätä profiilia ei voi lunastaa';
  end if;

  perform set_config('app.koutsi_claiming', 'on', true);

  insert into koutsi_students (
    id, age, pilot_age_group,
    minor_notice_confirmed_at, minor_notice_confirmed_by,
    guardian_approval_confirmed_at, guardian_approval_confirmed_by
  ) values (
    v_uid, v_ph.age, v_ph.pilot_age_group,
    v_ph.minor_notice_confirmed_at, v_ph.minor_notice_confirmed_by,
    v_ph.guardian_approval_confirmed_at, v_ph.guardian_approval_confirmed_by
  ) on conflict (id) do nothing;
  update koutsi_students t set
    age = coalesce(t.age, v_ph.age),
    level = coalesce(t.level, v_ph.level),
    goal = coalesce(t.goal, v_ph.goal),
    focus = coalesce(t.focus, v_ph.focus),
    background = coalesce(t.background, v_ph.background),
    last_session_note = coalesce(t.last_session_note, v_ph.last_session_note),
    player_note = coalesce(t.player_note, v_ph.player_note),
    player_wish = coalesce(t.player_wish, v_ph.player_wish),
    pilot_age_group = coalesce(t.pilot_age_group, v_ph.pilot_age_group),
    minor_notice_confirmed_at = coalesce(t.minor_notice_confirmed_at, v_ph.minor_notice_confirmed_at),
    minor_notice_confirmed_by = coalesce(t.minor_notice_confirmed_by, v_ph.minor_notice_confirmed_by),
    guardian_approval_confirmed_at = coalesce(t.guardian_approval_confirmed_at, v_ph.guardian_approval_confirmed_at),
    guardian_approval_confirmed_by = coalesce(t.guardian_approval_confirmed_by, v_ph.guardian_approval_confirmed_by)
  where t.id = v_uid;

  update koutsi_diary_entries set student_id = v_uid where student_id = v_ph.id;
  update koutsi_homework set student_id = v_uid where student_id = v_ph.id;
  update koutsi_videos set student_id = v_uid where student_id = v_ph.id;
  update koutsi_moods set student_id = v_uid where student_id = v_ph.id;
  update koutsi_match_notes set student_id = v_uid where student_id = v_ph.id;
  update koutsi_player_history set student_id = v_uid where student_id = v_ph.id;
  update koutsi_trainings set student_id = v_uid where student_id = v_ph.id;

  -- before the coaching row of a coach the account already has is deleted: its invoices move first
  perform public.koutsi_move_billing(v_ph.id, v_uid);
  delete from koutsi_coach_students a
   where a.student_id = v_ph.id
     and exists (select 1 from koutsi_coach_students b
                 where b.coach_id = a.coach_id and b.student_id = v_uid);
  update koutsi_coach_students set student_id = v_uid, ended_at = null where student_id = v_ph.id;

  -- each group membership moves with its history; one the placeholder had left stays ended
  for v_group in select m.group_id from koutsi_group_members m where m.student_id = v_ph.id loop
    perform public.koutsi_move_group_membership(v_group, v_ph.id, v_uid);
  end loop;

  delete from koutsi_training_absences a
   where a.student_id = v_ph.id
     and exists (select 1 from koutsi_training_absences b
                 where b.training_id = a.training_id and b.student_id = v_uid);
  update koutsi_training_absences set student_id = v_uid where student_id = v_ph.id;

  insert into koutsi_coach_students (coach_id, student_id)
  values (v_coach, v_uid)
  on conflict (coach_id, student_id) do update set ended_at = null;

  delete from koutsi_students where id = v_ph.id;
  select name into v_coach_name from profiles where id = v_coach;
  return jsonb_build_object('coach_id', v_coach, 'coach_name', v_coach_name, 'claimed', true);
end;
$function$;

-- Against 20260910060000: the invoices and the payer move (koutsi_move_billing), and each group
-- membership moves with its history (one the duplicate had left stays ended).
create or replace function public.koutsi_merge_students(coach_id_input uuid, keep_student_id uuid, remove_student_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid    uuid := auth.uid();
  v_coach  uuid := coalesce(coach_id_input, auth.uid());
  v_remove public.koutsi_students%rowtype;
  v_group  uuid;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if v_coach <> v_uid and not public.koutsi_is_admin() then
    raise exception 'not allowed';
  end if;
  if not exists (
    select 1 from public.koutsi_coaches c
     where c.id = v_coach and c.archived_at is null
  ) then
    raise exception 'not a coach';
  end if;
  if keep_student_id is null or remove_student_id is null or keep_student_id = remove_student_id then
    raise exception 'Valitse kaksi eri pelaajaa yhdistämistä varten';
  end if;

  if not exists (
    select 1 from public.koutsi_coach_students
     where coach_id = v_coach and student_id = keep_student_id and ended_at is null
  ) then
    raise exception 'Säilytettävää pelaajaa ei löytynyt oppilaslistaltasi';
  end if;

  perform 1 from public.koutsi_students where id = keep_student_id for update;

  select * into v_remove from public.koutsi_students where id = remove_student_id for update;
  if not found
     or v_remove.placeholder_coach_id is null
     or v_remove.placeholder_coach_id <> v_coach
  then
    raise exception 'Tätä pelaajaa ei voi yhdistää — hän on jo lunastanut oman tilinsä, tai ei ole oppilaslistallasi';
  end if;

  -- Tables with no uniqueness on student_id: a plain move.
  update public.koutsi_diary_entries set student_id = keep_student_id where student_id = remove_student_id;
  update public.koutsi_homework set student_id = keep_student_id where student_id = remove_student_id;
  update public.koutsi_moods set student_id = keep_student_id where student_id = remove_student_id;
  update public.koutsi_match_notes set student_id = keep_student_id where student_id = remove_student_id;
  update public.koutsi_player_history set student_id = keep_student_id where student_id = remove_student_id;
  update public.koutsi_trainings set student_id = keep_student_id where student_id = remove_student_id;

  -- Shared-video rows are unique per (share_id, student_id): drop the duplicate's copy of
  -- any video the kept student was already sent, then move the rest.
  delete from public.koutsi_videos v
   where v.student_id = remove_student_id
     and exists (
       select 1 from public.koutsi_videos k
        where k.share_id = v.share_id and k.student_id = keep_student_id
     );
  update public.koutsi_videos set student_id = keep_student_id where student_id = remove_student_id;

  -- Absence rows are keyed per (training_id, student_id): same dance.
  delete from public.koutsi_training_absences a
   where a.student_id = remove_student_id
     and exists (
       select 1 from public.koutsi_training_absences b
        where b.training_id = a.training_id and b.student_id = keep_student_id
     );
  update public.koutsi_training_absences set student_id = keep_student_id where student_id = remove_student_id;

  -- Group membership is the point of the merge: the kept student ends up in the union of both
  -- students' groups (e.g. one had a Wednesday group and the other a Friday group; the survivor gets
  -- both). Each membership moves with its history; a group the duplicate had left stays left.
  for v_group in select m.group_id from public.koutsi_group_members m where m.student_id = remove_student_id loop
    perform public.koutsi_move_group_membership(v_group, remove_student_id, keep_student_id);
  end loop;

  -- The duplicate's invoices (and the payer the coach wrote down) go to the kept student before
  -- the coaching row goes.
  perform public.koutsi_move_billing(remove_student_id, keep_student_id);
  delete from public.koutsi_coach_students where coach_id = v_coach and student_id = remove_student_id;
  delete from public.koutsi_students where id = remove_student_id;

  return jsonb_build_object('kept_id', keep_student_id, 'removed_id', remove_student_id);
end;
$function$;

-- ── 3. the players who have left, for Laskutus ──────────────────────────────

-- Only ended coaching rows (the roster has the rest); the name as the coach's app shows it.
create or replace function public.koutsi_billing_students(p_coach uuid)
returns table (student_id uuid, name text, is_placeholder boolean, ended_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $function$
  select cs.student_id,
         coalesce(nullif(btrim(p.name), ''), nullif(btrim(s.display_name), ''), 'Pelaaja'),
         s.placeholder_coach_id is not null,
         cs.ended_at
    from public.koutsi_coach_students cs
    join public.koutsi_students s on s.id = cs.student_id
    left join public.profiles p on p.id = cs.student_id
   where cs.coach_id = p_coach
     and cs.ended_at is not null
     and public.koutsi_billing_enabled(p_coach);
$function$;

-- ── 4. a season fee once per season ─────────────────────────────────────────

-- The season a session of a group belongs to: the group's own season, the coach's season on that
-- day (the earliest starting when they overlap), else the half-year. Same rule as seasonKeyFor in
-- koutsi/web/src/domain/billing.js.
create or replace function public.koutsi_season_key(p_group uuid, p_date date)
returns text
language sql
stable
set search_path = ''
as $function$
  select coalesce(
    (select g.season_id::text from public.koutsi_groups g where g.id = p_group),
    (select s.id::text
       from public.koutsi_seasons s
       join public.koutsi_groups g on g.id = p_group and s.coach_id = g.coach_id
      where p_date between s.starts_on and s.ends_on
      order by s.starts_on
      limit 1),
    extract(year from p_date)::integer::text || case when extract(month from p_date) >= 8 then '-syksy' else '-kevat' end);
$function$;

alter table public.koutsi_invoice_lines add column if not exists period_key text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'koutsi_invoice_lines_period_key') then
    alter table public.koutsi_invoice_lines
      add constraint koutsi_invoice_lines_period_key check (period_key is null or char_length(period_key) <= 80);
  end if;
  -- the season lines written before this get their season (sent lines are otherwise fixed: the guard
  -- is off only for this one update)
  if exists (select 1 from public.koutsi_invoice_lines l where l.kind = 'season' and l.group_id is not null and l.period_key is null) then
    alter table public.koutsi_invoice_lines disable trigger koutsi_invoice_lines_guard;
    update public.koutsi_invoice_lines l
       set period_key = public.koutsi_season_key(l.group_id, l.line_date)
     where l.kind = 'season' and l.group_id is not null and l.period_key is null;
    alter table public.koutsi_invoice_lines enable trigger koutsi_invoice_lines_guard;
  end if;
end $$;

drop index if exists public.koutsi_invoice_lines_season_once;
create unique index koutsi_invoice_lines_season_once
  on public.koutsi_invoice_lines (group_id, student_id, coalesce(period_key, ''))
  where kind = 'season' and group_id is not null and not voided;

-- Against phase 1: each line's periodKey (period_key); a season line without one gets its season here.
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
                                               description, quantity, unit_cents, amount_cents, charged, period_key)
      select v_invoice, coalesce((l->>'sortOrder')::integer, (x.ord - 1)::integer), l->>'kind',
             nullif(l->>'trainingId', '')::uuid, nullif(l->>'groupId', '')::uuid, nullif(l->>'date', '')::date,
             nullif(left(coalesce(l->>'time', ''), 5), ''), l->>'description', coalesce((l->>'quantity')::numeric, 1),
             coalesce((l->>'unitCents')::integer, 0), coalesce((l->>'amountCents')::integer, 0), coalesce((l->>'charged')::boolean, true),
             coalesce(nullif(btrim(coalesce(l->>'periodKey', '')), ''),
                      case when l->>'kind' = 'season' and nullif(l->>'groupId', '') is not null
                           then public.koutsi_season_key((l->>'groupId')::uuid, nullif(l->>'date', '')::date) end)
        from jsonb_array_elements(coalesce(v_draft->'lines', '[]'::jsonb)) with ordinality as x(l, ord);
      v_ids := v_ids || v_invoice;
    end loop;
  exception when unique_violation then
    raise exception 'Osa treeneistä on jo laskulla. Päivitä näkymä ja yritä uudelleen.' using errcode = 'check_violation';
  end;
  return v_ids;
end;
$function$;

-- ── 5. paid online: no voiding, and a payment after voiding is not lost ─────

-- Against phase 1: an invoice paid online is not voided (it is refunded in Stripe).
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
  if v_inv.paid_via = 'stripe' then
    raise exception 'Verkossa maksettua laskua ei voi mitätöidä.' using errcode = 'check_violation';
  end if;
  update public.koutsi_invoices set status = 'void', voided_at = now() where id = p_invoice;
  update public.koutsi_invoice_lines set voided = true where invoice_id = p_invoice;
  if v_inv.student_id is not null then
    perform public.koutsi_notify(v_inv.student_id, v_inv.coach_id, 'invoice',
      'Lasku ' || v_inv.number || ' peruttu', 'Sinun ei tarvitse maksaa sitä.', '/pelaaja/laskut');
  end if;
end;
$function$;

-- The edge function, when Stripe says an invoice the coach had voided or marked paid was paid online
-- after all: the payment is stored on it (once) and the coach told. The invoice stays as it is.
create or replace function public.koutsi_invoice_late_payment(p_invoice uuid, p_session text, p_payment_intent text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_inv public.koutsi_invoices%rowtype;
begin
  select * into v_inv from public.koutsi_invoices i where i.id = p_invoice for update;
  if v_inv.id is null or v_inv.status not in ('paid', 'void') or v_inv.paid_via is not distinct from 'stripe'
     or v_inv.stripe_payment_intent is not null then
    return false;
  end if;
  update public.koutsi_invoices
     set stripe_payment_intent = coalesce(p_payment_intent, p_session, 'tuntematon'),
         checkout_session_id = coalesce(p_session, checkout_session_id)
   where id = p_invoice;
  perform public.koutsi_notify(v_inv.coach_id, v_inv.student_id, 'invoice_paid',
    'Lasku ' || v_inv.number || ' maksettiin verkossa',
    v_inv.payer_name || ', ' || public.koutsi_euros(v_inv.total_cents)
      || case when v_inv.status = 'void' then '. Lasku oli jo mitätöity.' else '. Lasku oli jo merkitty maksetuksi.' end,
    '/valmentaja/laskutus?lasku=' || p_invoice);
  return true;
end;
$function$;

-- ── 6. the reminder: "on" until the due date, "oli" after it ────────────────

-- Against 20261030070121: only the body's wording.
create or replace function public.koutsi_remind_invoice(p_invoice uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_inv public.koutsi_invoices%rowtype;
  v_name text;
  v_today date := (now() at time zone 'Europe/Helsinki')::date;
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
      v_name || case when v_inv.due_date >= v_today then ', eräpäivä on ' else ', eräpäivä oli ' end
        || to_char(v_inv.due_date, 'FMDD.FMMM.YYYY'),
      '/pelaaja/laskut/' || p_invoice);
  end if;
  return true;
end;
$function$;

-- ── 7. a group's weekly time moves: the "En pääse" reports move along ───────

-- Against 20260823170209: while koutsi_reschedule_group carries reports over (koutsi.carry_absences)
-- the row keeps who reported it and when.
create or replace function public.koutsi_stamp_training_absence()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  if coalesce(current_setting('koutsi.carry_absences', true), '') = 'on' then
    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;
  new.reported_by := coalesce((select auth.uid()), new.reported_by);
  new.updated_at := now();
  return new;
end;
$function$;

-- groups.update in the app: the group's coming sessions p_delete go and new ones come on p_dates (the
-- same rows and the same notifications as the app's delete + insert, in that order). Each absence of a
-- deleted session moves to the new session of the same ISO week (the nearest date), as it was: who
-- reported it and when (Laskutus sorts late cancellations by that); the coach hears no new "ei pääse".
-- → { count, seriesId, carried }.
create or replace function public.koutsi_reschedule_group(p_group uuid, p_delete uuid[], p_dates date[], p_time time, p_duration integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_coach uuid;
  v_today date := (now() at time zone 'Europe/Helsinki')::date;
  v_series uuid := gen_random_uuid();
  v_carry jsonb;
  v_count integer := 0;
  v_carried integer := 0;
  v_target uuid;
  r record;
begin
  select g.coach_id into v_coach from public.koutsi_groups g where g.id = p_group;
  if v_coach is null or not public.koutsi_acts_as(v_coach) then
    raise exception 'Ryhmää ei löytynyt.' using errcode = 'P0002';
  end if;
  if coalesce(cardinality(p_dates), 0) > 0 and p_time is null then
    raise exception 'Tarkista ryhmän kellonaika' using errcode = 'check_violation';
  end if;
  if coalesce(cardinality(p_dates), 0) > 60
     or exists (select 1 from unnest(coalesce(p_dates, '{}'::date[])) d where d is null or d < v_today - 1 or d > v_today + 400) then
    raise exception 'Tarkista treenien päivät.' using errcode = 'check_violation';
  end if;
  if p_duration is not null and (p_duration < 5 or p_duration > 600) then
    raise exception 'Tarkista treenin kesto.' using errcode = 'check_violation';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'student_id', a.student_id, 'session_date', t.date, 'reason', a.reason, 'reported_by', a.reported_by,
           'created_at', a.created_at, 'updated_at', a.updated_at) order by a.created_at), '[]'::jsonb)
    into v_carry
    from public.koutsi_training_absences a
    join public.koutsi_trainings t on t.id = a.training_id
   where t.id = any(coalesce(p_delete, '{}'::uuid[])) and t.group_id = p_group and t.date >= v_today - 1;

  delete from public.koutsi_trainings t
   where t.id = any(coalesce(p_delete, '{}'::uuid[])) and t.group_id = p_group and t.date >= v_today - 1;

  insert into public.koutsi_trainings (coach_id, group_id, date, time, type, duration_minutes, series_id)
  select v_coach, p_group, d, p_time, 'Ryhmätreeni', nullif(p_duration, 0), v_series
    from (select distinct d from unnest(coalesce(p_dates, '{}'::date[])) d) x
   order by d;
  get diagnostics v_count = row_count;

  perform set_config('koutsi.bulk_trainings', 'on', true);
  perform set_config('koutsi.carry_absences', 'on', true);
  for r in select * from jsonb_to_recordset(v_carry)
             as x(student_id uuid, session_date date, reason text, reported_by uuid, created_at timestamptz, updated_at timestamptz) loop
    select n.id into v_target
      from public.koutsi_trainings n
     where n.series_id = v_series and date_trunc('week', n.date::timestamp) = date_trunc('week', r.session_date::timestamp)
     order by abs(n.date - r.session_date), n.date
     limit 1;
    continue when v_target is null;
    continue when exists (select 1 from public.koutsi_training_absences x where x.training_id = v_target and x.student_id = r.student_id);
    insert into public.koutsi_training_absences (training_id, student_id, reason, reported_by, created_at, updated_at)
    values (v_target, r.student_id, coalesce(r.reason, 'poissa'), r.reported_by, coalesce(r.created_at, now()), r.updated_at);
    v_carried := v_carried + 1;
  end loop;
  perform set_config('koutsi.carry_absences', '', true);
  perform set_config('koutsi.bulk_trainings', '', true);
  return jsonb_build_object('count', v_count, 'seriesId', v_series, 'carried', v_carried);
end;
$function$;

-- ── function rights ─────────────────────────────────────────────────────────

revoke all on function public.koutsi_group_member_history() from public, anon, authenticated;
revoke all on function public.koutsi_move_group_membership(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.koutsi_move_billing(uuid, uuid) from public, anon, authenticated;
revoke all on function public.koutsi_stamp_training_absence() from public, anon, authenticated;

revoke all on function public.koutsi_billing_memberships(uuid) from public, anon;
grant execute on function public.koutsi_billing_memberships(uuid) to authenticated;
revoke all on function public.koutsi_billing_students(uuid) from public, anon;
grant execute on function public.koutsi_billing_students(uuid) to authenticated;
-- koutsi_create_invoice_drafts runs as the caller and fills a missing season with this
revoke all on function public.koutsi_season_key(uuid, date) from public, anon;
grant execute on function public.koutsi_season_key(uuid, date) to authenticated, service_role;
revoke all on function public.koutsi_create_invoice_drafts(uuid, jsonb) from public, anon;
grant execute on function public.koutsi_create_invoice_drafts(uuid, jsonb) to authenticated;
revoke all on function public.koutsi_void_invoice(uuid) from public, anon;
grant execute on function public.koutsi_void_invoice(uuid) to authenticated;
revoke all on function public.koutsi_invoice_late_payment(uuid, text, text) from public, anon, authenticated;
grant execute on function public.koutsi_invoice_late_payment(uuid, text, text) to service_role;
revoke all on function public.koutsi_remind_invoice(uuid) from public, anon;
grant execute on function public.koutsi_remind_invoice(uuid) to authenticated;
revoke all on function public.koutsi_reschedule_group(uuid, uuid[], date[], time, integer) from public, anon;
grant execute on function public.koutsi_reschedule_group(uuid, uuid[], date[], time, integer) to authenticated;

revoke all on function public.koutsi_claim_player(text, uuid) from public, anon;
grant execute on function public.koutsi_claim_player(text, uuid) to authenticated, service_role;
revoke all on function public.koutsi_merge_students(uuid, uuid, uuid) from public, anon;
grant execute on function public.koutsi_merge_students(uuid, uuid, uuid) to authenticated, service_role;
