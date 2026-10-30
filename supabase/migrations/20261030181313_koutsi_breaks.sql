-- 20261030181313_koutsi_breaks.sql: a break (tauko) in the players' calendar. Applied 30.10.2026.
--
-- "Jatka kalenteria" can put groups on a break (Joululoma, Hiihtoloma …). The break is a club event
-- (koutsi_coach_events, kind 'tauko'), so the players' calendar draws it as one bar over the days like the
-- club's competitions. New on the table:
--   message      the coach's greeting to the players ("Hyvää joulua!"), at most 300 characters
--   group_ids    the groups on the break; null = every player of the coach, as before for other events
--   notified_at  when the players were told (koutsi_send_break_notices); a coach cannot set it
-- A player sees an event meant for some groups only when they are in one of them.
-- The morning before a break starts (07:30–21 Helsinki, the hourly job koutsi-break-notices) each player in
-- the groups gets one notification: the break's name as the title, then "Ei treenejä la 19.12.–ke 6.1.
-- Seuraava treenisi on to 7.1. klo 17:00. Hyvää joulua!" with their own next session. The app shows the
-- coach the same text before saving (domain/continueGroups.js breakNotice).
-- Additive: koutsi_coach_events had no rows in production when this was written.

alter table public.koutsi_coach_events
  add column if not exists message text,
  add column if not exists group_ids uuid[],
  add column if not exists notified_at timestamptz;

alter table public.koutsi_coach_events drop constraint if exists koutsi_coach_events_message_length;
alter table public.koutsi_coach_events
  add constraint koutsi_coach_events_message_length check (message is null or char_length(message) <= 300);

-- a player sees their coach's events; one for some groups only when they are in one of those groups
drop policy if exists koutsi_coach_events_select on public.koutsi_coach_events;
create policy koutsi_coach_events_select on public.koutsi_coach_events for select using (
  public.koutsi_acts_as(coach_id)
  or (public.koutsi_is_my_coach(coach_id) and (
    group_ids is null or exists (
      select 1 from public.koutsi_group_members m
       where m.group_id = any (koutsi_coach_events.group_ids)
         and m.student_id = (select auth.uid())
         and m.ended_at is null))));

-- the groups must be the coach's own
drop policy if exists koutsi_coach_events_insert on public.koutsi_coach_events;
create policy koutsi_coach_events_insert on public.koutsi_coach_events for insert with check (
  public.koutsi_acts_as(coach_id)
  and not exists (
    select 1 from unnest(coalesce(koutsi_coach_events.group_ids, '{}'::uuid[])) gid(gid)
     where not exists (select 1 from public.koutsi_groups g where g.id = gid.gid and g.coach_id = koutsi_coach_events.coach_id)));

drop policy if exists koutsi_coach_events_update on public.koutsi_coach_events;
create policy koutsi_coach_events_update on public.koutsi_coach_events for update
  using (public.koutsi_acts_as(coach_id))
  with check (
    public.koutsi_acts_as(coach_id)
    and not exists (
      select 1 from unnest(coalesce(koutsi_coach_events.group_ids, '{}'::uuid[])) gid(gid)
       where not exists (select 1 from public.koutsi_groups g where g.id = gid.gid and g.coach_id = koutsi_coach_events.coach_id)));

-- notified_at belongs to the job: a signed-in user's insert starts it empty and an update keeps it
create or replace function public.koutsi_coach_events_keep_notified()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if (select auth.uid()) is not null then
    new.notified_at := case when tg_op = 'INSERT' then null else old.notified_at end;
  end if;
  return new;
end;
$fn$;

drop trigger if exists koutsi_coach_events_keep_notified on public.koutsi_coach_events;
create trigger koutsi_coach_events_keep_notified
  before insert or update on public.koutsi_coach_events
  for each row execute function public.koutsi_coach_events_keep_notified();

-- "la 19.12." (the app's koutsiFmtShortDate)
create or replace function public.koutsi_day_label(p_date date)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select (array['su','ma','ti','ke','to','pe','la'])[extract(dow from p_date)::int + 1] || ' ' || to_char(p_date, 'FMDD.FMMM.')
$fn$;

-- The notification text of a break; the app's breakNotice() writes the same.
create or replace function public.koutsi_break_notice_body(p_from date, p_to date, p_next_date date, p_next_time time, p_message text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select concat_ws(' ',
    'Ei treenejä ' || public.koutsi_day_label(p_from)
      || case when p_to > p_from then '–' || public.koutsi_day_label(p_to) else '' end, -- the date ends the sentence: "6.1."
    case when p_next_date is not null then 'Seuraava treenisi on ' || public.koutsi_session_when(p_next_date, p_next_time) || '.' end,
    nullif(btrim(coalesce(p_message, '')), ''))
$fn$;

-- The morning before a break starts (or at once when it is saved later, 07:30–21 Helsinki), every player
-- in its groups gets one notification with their own next session after it. Each break is told once.
create or replace function public.koutsi_send_break_notices()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_local timestamp := now() at time zone 'Europe/Helsinki';
  v_today date := v_local::date;
  v_event record;
  v_student uuid;
  v_next record;
  v_sent integer := 0;
begin
  if v_local::time < time '07:30' or v_local::time >= time '21:00' then
    return 0;
  end if;

  for v_event in
    select e.* from public.koutsi_coach_events e
     where e.kind = 'tauko' and e.notified_at is null
       and e.date - 1 <= v_today and coalesce(e.end_date, e.date) >= v_today
     order by e.date
     for update skip locked
  loop
    for v_student in
      select distinct m.student_id
        from public.koutsi_group_members m
        join public.koutsi_groups g on g.id = m.group_id and g.coach_id = v_event.coach_id
       where m.ended_at is null
         and (v_event.group_ids is null or m.group_id = any (v_event.group_ids))
    loop
      select t.date, t.time into v_next
        from public.koutsi_trainings t
        join public.koutsi_group_members m on m.group_id = t.group_id and m.student_id = v_student and m.ended_at is null
       where t.coach_id = v_event.coach_id and t.logged_by = 'coach'
         and t.date > coalesce(v_event.end_date, v_event.date)
         and (v_event.group_ids is null or t.group_id = any (v_event.group_ids))
       order by t.date, t.time
       limit 1;
      perform public.koutsi_notify(v_student, v_event.coach_id, 'announcement', v_event.title,
        public.koutsi_break_notice_body(v_event.date, coalesce(v_event.end_date, v_event.date), v_next.date, v_next.time, v_event.message),
        '/pelaaja/treenit');
      v_sent := v_sent + 1;
    end loop;
    update public.koutsi_coach_events set notified_at = now() where id = v_event.id;
  end loop;
  return v_sent;
end;
$fn$;

revoke all on function public.koutsi_send_break_notices() from public, anon, authenticated;

select cron.unschedule('koutsi-break-notices') where exists (select 1 from cron.job where jobname = 'koutsi-break-notices');
select cron.schedule('koutsi-break-notices', '7 * * * *', 'select public.koutsi_send_break_notices()');
