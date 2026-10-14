-- Renewed Koutsi (koutsi/web): "Treenit ohi! Miten meni?" e-mails for players, and the coach's
-- private week diary ("Viikko paketissa" → "Miten treeniviikko sujui?").
--
-- NOT APPLIED automatically. Run only with the user's go-ahead ("aja migraatio").
--
-- 1. koutsi_coach_week_notes — one row per coach per ISO week: score 1–5 and a note, visible
--    only to the coach (and an admin acting as them). The new app reads it if it exists and
--    works without it until then.
-- 2. koutsi_beta_testers — e-mail addresses that get the after-session e-mail while the
--    renewed Koutsi is an opt-in beta. Nobody else gets one until this gate is lifted.
-- 3. koutsi_session_checkin_log — who was already asked about which session (no repeats).
-- 4. koutsi_queue_session_checkins() — every 15 minutes (pg_cron): for coach-run sessions
--    that ended 15 min–3 h ago, queue one notification per player who
--      * is a beta tester (see 2) and an active member of the group / the session's student,
--      * was not marked absent,
--      * has not given a feeling since the session began,
--      * has not been asked about this session, nor about another one the same day.
--    The notification goes through the existing queue: in-app bell + e-mail via koutsi-notify
--    (already every 5 minutes), which respects koutsi_notification_prefs.email_enabled.
--    The link opens the renewed app's pop-up: /pelaaja?uusi=1&fiilis=<session>; the e-mail
--    template adds &arvo=1…5 for its number buttons (supabase/functions/koutsi-notify).
--
-- The old Koutsi does not use any of this; it only shows the bell item to a beta tester.

-- ── 1. the coach's week diary ───────────────────────────────────────────────
create table if not exists public.koutsi_coach_week_notes (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.koutsi_coaches(id) on delete cascade,
  iso_year integer not null check (iso_year between 2000 and 2100),
  iso_week integer not null check (iso_week between 1 and 53),
  score integer not null check (score between 1 and 5),
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (coach_id, iso_year, iso_week)
);

alter table public.koutsi_coach_week_notes enable row level security;

create policy koutsi_coach_week_notes_select on public.koutsi_coach_week_notes
  for select using (public.koutsi_acts_as(coach_id));
create policy koutsi_coach_week_notes_insert on public.koutsi_coach_week_notes
  for insert with check (public.koutsi_acts_as(coach_id));
create policy koutsi_coach_week_notes_update on public.koutsi_coach_week_notes
  for update using (public.koutsi_acts_as(coach_id)) with check (public.koutsi_acts_as(coach_id));
create policy koutsi_coach_week_notes_delete on public.koutsi_coach_week_notes
  for delete using (public.koutsi_acts_as(coach_id));

grant select, insert, update, delete on public.koutsi_coach_week_notes to authenticated;
revoke all on public.koutsi_coach_week_notes from anon;

-- ── 2. who gets the after-session e-mail during the beta ────────────────────
create table if not exists public.koutsi_beta_testers (
  email text primary key check (email = lower(email)),
  note text,
  created_at timestamptz not null default now()
);
alter table public.koutsi_beta_testers enable row level security;  -- no policies: functions only
revoke all on public.koutsi_beta_testers from anon, authenticated;

insert into public.koutsi_beta_testers (email, note) values
  ('eelispuro@gmail.com', 'omistaja'),
  ('eelispuro+pelaaja@gmail.com', 'omistajan testipelaaja')
on conflict (email) do nothing;

-- ── 3. who was asked about which session ────────────────────────────────────
create table if not exists public.koutsi_session_checkin_log (
  training_id uuid not null references public.koutsi_trainings(id) on delete cascade,
  student_id uuid not null,
  session_date date not null,
  created_at timestamptz not null default now(),
  primary key (training_id, student_id)
);
create index if not exists koutsi_session_checkin_log_student_day on public.koutsi_session_checkin_log (student_id, session_date);
alter table public.koutsi_session_checkin_log enable row level security;  -- no policies: functions only
revoke all on public.koutsi_session_checkin_log from anon, authenticated;

-- ── 4. the queue ────────────────────────────────────────────────────────────
create or replace function public.koutsi_queue_session_checkins()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session record;
  v_student uuid;
  v_queued integer := 0;
begin
  for v_session in
    select t.id, t.date, t.time, t.type, t.coach_id, g.name as group_name,
           (t.date + t.time) at time zone 'Europe/Helsinki' as starts_at,
           ((t.date + t.time) at time zone 'Europe/Helsinki')
             + make_interval(mins => coalesce(t.duration_minutes, g.duration_minutes, 60)) as ends_at
      from public.koutsi_trainings t
      left join public.koutsi_groups g on g.id = t.group_id
     where t.logged_by = 'coach'
       and t.date between ((now() at time zone 'Europe/Helsinki')::date - 1) and (now() at time zone 'Europe/Helsinki')::date
  loop
    continue when v_session.ends_at > now() - interval '15 minutes'
               or v_session.ends_at < now() - interval '3 hours';

    for v_student in
      select a.id
        from public.koutsi_training_audience(
               (select t from public.koutsi_trainings t where t.id = v_session.id)
             ) as a(id)
    loop
      continue when not exists (
        select 1 from auth.users u
          join public.koutsi_beta_testers b on b.email = lower(u.email)
         where u.id = v_student
      );
      continue when exists (
        select 1 from public.koutsi_training_absences ab
         where ab.training_id = v_session.id and ab.student_id = v_student
      );
      continue when exists (
        select 1 from public.koutsi_moods m
         where m.student_id = v_student and m.created_at >= v_session.starts_at
      );
      continue when exists (
        select 1 from public.koutsi_session_checkin_log l
         where l.student_id = v_student and (l.training_id = v_session.id or l.session_date = v_session.date)
      );

      insert into public.koutsi_session_checkin_log (training_id, student_id, session_date)
      values (v_session.id, v_student, v_session.date);

      -- no actor: the reminder comes from Koutsi, not from the coach
      perform public.koutsi_notify(
        v_student, null, 'session_checkin',
        'Treenit ohi! Miten meni?',
        coalesce(v_session.group_name, v_session.type) || ' · ' || to_char(v_session.date, 'DD.MM.') || ' klo '
          || to_char(v_session.time, 'HH24:MI')
          || '. Toivottavasti oli hyvä valmennus! Kerro yhdellä napautuksella, millaiset fiilikset jäi.',
        '/pelaaja?uusi=1&fiilis=' || v_session.id
      );
      v_queued := v_queued + 1;
    end loop;
  end loop;
  return v_queued;
end;
$function$;

revoke all on function public.koutsi_queue_session_checkins() from public, anon, authenticated;
grant execute on function public.koutsi_queue_session_checkins() to service_role;

-- Every 15 minutes. Idempotent: an existing job of the same name is replaced.
do $$
declare v_job record;
begin
  for v_job in select jobid from cron.job where jobname = 'koutsi-session-checkins' loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  perform cron.schedule('koutsi-session-checkins', '*/15 * * * *', 'select public.koutsi_queue_session_checkins()');
end;
$$;
