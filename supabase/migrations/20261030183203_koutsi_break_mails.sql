-- 20261030183203_koutsi_break_mails.sql (applied 30.10.2026): a break's mail as a holiday letter, and reminders before the
-- sessions start again (on top of 20261030181313_koutsi_breaks).
--
-- The morning before a break (as before, from 07:35) each player in its groups gets their own mail. It is
-- kind 'session_reminder' now, so it always goes as a mail of its own and is never folded into a digest:
--
--   Joululoma alkaa huomenna
--   Treenit ovat tauolla la 19.12.–ke 6.1.
--   Treenisi jatkuvat to 7.1. klo 17:00.
--
--   Valmentajan terveiset
--   Hyvää joulua ja kiitos syksystä!
--   – Alpo
--
--   Koutsi on käytössä myös tauon aikana.
--   Treenaa omatoimisesti ja merkitse treenit kuten ennenkin. Vain yhteiset treenit ovat tauolla.
--
-- (the mail shows the first line of each paragraph in bold). After a break of a week or more each player
-- also gets "Treenit alkavat taas to 7.1." three days before their own first session and "Treenit alkavat
-- taas huomenna" the day before, with that week's theme when the coach has set one;
-- koutsi_break_reminders keeps them to one each. The app's domain/continueGroups.js writes the same texts
-- for the coach's preview. The greeting is now at most 200 characters so a letter always fits the 500
-- characters of a notification (no break had been saved yet). The job runs at :35 so the morning's
-- letters are out before 8.

alter table public.koutsi_coach_events drop constraint if exists koutsi_coach_events_message_length;
alter table public.koutsi_coach_events
  add constraint koutsi_coach_events_message_length check (message is null or char_length(message) <= 200);

-- the restart reminders already sent: one per break, player and stage
create table if not exists public.koutsi_break_reminders (
  event_id uuid not null references public.koutsi_coach_events(id) on delete cascade,
  student_id uuid not null references public.koutsi_students(id) on delete cascade,
  stage text not null check (stage in ('3d', '1d')),
  sent_at timestamptz not null default now(),
  primary key (event_id, student_id, stage));
alter table public.koutsi_break_reminders enable row level security;
revoke all on public.koutsi_break_reminders from anon, authenticated; -- only the job uses it

drop function if exists public.koutsi_break_notice_body(date, date, date, time, text);

-- "Joululoma alkaa huomenna" the day before; the name alone when the break has started
create or replace function public.koutsi_break_notice_title(p_name text, p_from date, p_today date)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case when p_today < p_from then btrim(p_name) || ' alkaa huomenna' else btrim(p_name) end
$fn$;

-- The holiday letter; the app's breakNotice() writes the same.
create or replace function public.koutsi_break_notice_body(p_from date, p_to date, p_next_date date, p_next_time time, p_message text, p_coach text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select concat_ws(E'\n\n',
    concat_ws(E'\n',
      'Treenit ovat tauolla ' || public.koutsi_day_label(p_from)
        || case when p_to > p_from then '–' || public.koutsi_day_label(p_to) else '' end, -- the date ends the sentence: "6.1."
      case when p_next_date is not null then 'Treenisi jatkuvat ' || public.koutsi_session_when(p_next_date, p_next_time) || '.' end),
    case when nullif(btrim(coalesce(p_message, '')), '') is not null then
      concat_ws(E'\n', 'Valmentajan terveiset', btrim(p_message),
        case when nullif(btrim(coalesce(p_coach, '')), '') is not null then '– ' || btrim(p_coach) end)
    end,
    E'Koutsi on käytössä myös tauon aikana.\nTreenaa omatoimisesti ja merkitse treenit kuten ennenkin. Vain yhteiset treenit ovat tauolla.')
$fn$;

-- "Treenit alkavat taas …": the first session after the break, the week's theme, and a nudge to look
create or replace function public.koutsi_break_restart_body(p_next_date date, p_next_time time, p_theme text, p_tomorrow boolean)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select concat_ws(E'\n\n',
    concat_ws(E'\n',
      'Ensimmäinen treenisi tauon jälkeen on ' || case when p_tomorrow then 'huomenna ' else '' end
        || public.koutsi_session_when(p_next_date, p_next_time) || '.',
      case when nullif(rtrim(btrim(coalesce(p_theme, '')), '.'), '') is not null then 'Viikon teema: ' || rtrim(btrim(p_theme), '.') || '.' end),
    'Avaa Koutsi ja katso, miten treenit alkavat.')
$fn$;

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
  v_coach text;
  v_theme text;
  v_stage text;
  v_sent integer := 0;
begin
  if v_local::time < time '07:30' or v_local::time >= time '21:00' then
    return 0;
  end if;

  -- 1. the holiday letter, the morning before the break (or at once when it was saved later)
  for v_event in
    select e.* from public.koutsi_coach_events e
     where e.kind = 'tauko' and e.notified_at is null
       and e.date - 1 <= v_today and coalesce(e.end_date, e.date) >= v_today
     order by e.date
     for update skip locked
  loop
    select left(split_part(btrim(p.name), ' ', 1), 20) into v_coach from public.profiles p where p.id = v_event.coach_id;
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
      perform public.koutsi_notify(v_student, v_event.coach_id, 'session_reminder',
        public.koutsi_break_notice_title(v_event.title, v_event.date, v_today),
        public.koutsi_break_notice_body(v_event.date, coalesce(v_event.end_date, v_event.date), v_next.date, v_next.time, v_event.message, v_coach),
        '/pelaaja/treenit');
      v_sent := v_sent + 1;
    end loop;
    update public.koutsi_coach_events set notified_at = now() where id = v_event.id;
  end loop;

  -- 2. after a break of a week or more: 3 days and 1 day before each player's own first session
  for v_event in
    select e.* from public.koutsi_coach_events e
     where e.kind = 'tauko'
       and coalesce(e.end_date, e.date) - e.date >= 6
       and e.date <= v_today and coalesce(e.end_date, e.date) >= v_today - 14
     order by e.date
  loop
    for v_student in
      select distinct m.student_id
        from public.koutsi_group_members m
        join public.koutsi_groups g on g.id = m.group_id and g.coach_id = v_event.coach_id
       where m.ended_at is null
         and (v_event.group_ids is null or m.group_id = any (v_event.group_ids))
    loop
      select t.date, t.time, t.group_id into v_next
        from public.koutsi_trainings t
        join public.koutsi_group_members m on m.group_id = t.group_id and m.student_id = v_student and m.ended_at is null
       where t.coach_id = v_event.coach_id and t.logged_by = 'coach'
         and t.date > coalesce(v_event.end_date, v_event.date)
         and (v_event.group_ids is null or t.group_id = any (v_event.group_ids))
       order by t.date, t.time
       limit 1;
      continue when v_next.date is null;
      v_stage := case when v_next.date - 3 = v_today then '3d' when v_next.date - 1 = v_today then '1d' end;
      continue when v_stage is null;
      insert into public.koutsi_break_reminders (event_id, student_id, stage)
      values (v_event.id, v_student, v_stage)
      on conflict do nothing;
      continue when not found;
      select th.title into v_theme
        from public.koutsi_group_themes th
       where th.group_id = v_next.group_id
         and th.iso_year = extract(isoyear from v_next.date)::int and th.iso_week = extract(week from v_next.date)::int
       limit 1;
      perform public.koutsi_notify(v_student, v_event.coach_id, 'session_reminder',
        case when v_stage = '1d' then 'Treenit alkavat taas huomenna' else 'Treenit alkavat taas ' || public.koutsi_day_label(v_next.date) end,
        public.koutsi_break_restart_body(v_next.date, v_next.time, v_theme, v_stage = '1d'),
        '/pelaaja/treenit');
      v_sent := v_sent + 1;
    end loop;
  end loop;
  return v_sent;
end;
$fn$;

revoke all on function public.koutsi_send_break_notices() from public, anon, authenticated;

select cron.unschedule('koutsi-break-notices') where exists (select 1 from cron.job where jobname = 'koutsi-break-notices');
select cron.schedule('koutsi-break-notices', '35 * * * *', 'select public.koutsi_send_break_notices()');
