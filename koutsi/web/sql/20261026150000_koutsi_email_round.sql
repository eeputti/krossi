-- koutsi_email_round — the owner's e-mail wishes of 2026-10-26:
--   * clearer texts: "huomio" (as in the app), the coach's name with homework and videos, the
--     group's name and weekday with session changes;
--   * "Miten meni?" after a session for every player with an account (was: beta testers only);
--   * a reminder on the morning of a training day (players only): time, theme, place, coach;
--   * a place for a group (koutsi_groups.place), carried into the next season;
--   * every person chooses which e-mails they get (koutsi_notification_prefs.email_off).
-- The burst and digest rules of koutsi_smart_notifications stay: a reminder and "Miten meni?"
-- are their own mails and go at once, everything else waits for the digest.

-- ── 1. a group's place ───────────────────────────────────────────────────────
alter table public.koutsi_groups add column if not exists place text;
alter table public.koutsi_groups drop constraint if exists koutsi_groups_place_len;
alter table public.koutsi_groups add constraint koutsi_groups_place_len check (place is null or char_length(place) <= 120);

-- a group continued into the next season keeps its place
create or replace function public.koutsi_group_keeps_place()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.place is null and new.continues_from is not null then
    select g.place into new.place from koutsi_groups g where g.id = new.continues_from;
  end if;
  return new;
end;
$function$;
revoke all on function public.koutsi_group_keeps_place() from public, anon, authenticated;
drop trigger if exists koutsi_group_keeps_place on public.koutsi_groups;
create trigger koutsi_group_keeps_place before insert on public.koutsi_groups
  for each row execute function public.koutsi_group_keeps_place();

-- ── 2. which e-mails a person wants ─────────────────────────────────────────
alter table public.koutsi_notification_prefs add column if not exists email_off text[] not null default '{}';

-- the choice a notice belongs to (Profiili → Sähköpostit); null = always sent
create or replace function public.koutsi_email_category(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind in ('diary', 'homework', 'video') then 'valmentaja'
    when p_kind = 'announcement' then 'tiedotteet'
    when p_kind in ('training_added', 'training_cancelled') then 'treenit'
    when p_kind = 'session_reminder' then 'muistutus'
    when p_kind = 'session_checkin' then 'mitenmeni'
    when p_kind = 'match_note' then 'ottelut'
  end
$$;

-- "ti 3.11. klo 18:30" for a session
create or replace function public.koutsi_session_when(p_date date, p_time time)
returns text
language sql
immutable
set search_path = ''
as $$
  select (array['su','ma','ti','ke','to','pe','la'])[extract(dow from p_date)::int + 1]
         || ' ' || to_char(p_date, 'FMDD.FMMM.') || ' klo ' || to_char(p_time, 'HH24:MI')
$$;

-- ── 3. clearer texts ────────────────────────────────────────────────────────
create or replace function public.koutsi_on_diary_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_coach text;
begin
  select coalesce(name, 'Valmentajasi') into v_coach from profiles where id = new.coach_id;
  perform koutsi_notify(new.student_id, new.coach_id, 'diary',
    'Uusi huomio valmentajaltasi',
    coalesce(v_coach, 'Valmentajasi') || ': ' || new.text, '/pelaaja');
  return new;
end; $function$;

create or replace function public.koutsi_on_homework_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_coach text;
begin
  select coalesce(name, 'Valmentajasi') into v_coach from profiles where id = auth.uid();
  perform koutsi_notify(new.student_id, auth.uid(), 'homework',
    'Sait uuden kotiläksyn',
    coalesce(v_coach, 'Valmentajasi') || ': ' || new.text, '/pelaaja');
  return new;
end; $function$;

create or replace function public.koutsi_on_video_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_coach text;
begin
  select coalesce(name, 'Valmentajasi') into v_coach from profiles where id = new.added_by_id;
  perform koutsi_notify(new.student_id, new.added_by_id, 'video',
    'Valmentajasi jakoi videon',
    coalesce(v_coach, 'Valmentajasi') || ': ' || coalesce(nullif(new.title, ''), 'video'), '/pelaaja');
  return new;
end; $function$;

create or replace function public.koutsi_on_training_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_student uuid; v_what text;
begin
  if coalesce(current_setting('koutsi.bulk_trainings', true), '') = 'on' then
    return new;
  end if;
  if new.logged_by = 'player' then
    return new;
  end if;
  select coalesce(g.name, new.type) into v_what from (select 1) x left join koutsi_groups g on g.id = new.group_id;
  for v_student in select * from koutsi_training_audience(new) loop
    perform koutsi_notify(v_student, new.coach_id, 'training_added',
      'Uusi treeni kalenterissasi',
      coalesce(v_what, new.type) || ' · ' || public.koutsi_session_when(new.date, new.time),
      '/pelaaja');
  end loop;
  return new;
end; $function$;

create or replace function public.koutsi_on_training_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_student uuid; v_what text;
begin
  if old.date < current_date then
    return old;
  end if;
  if coalesce(current_setting('koutsi.bulk_trainings', true), '') = 'on' then
    return old;
  end if;
  if old.logged_by = 'player' then
    return old;
  end if;
  select coalesce(g.name, old.type) into v_what from (select 1) x left join koutsi_groups g on g.id = old.group_id;
  for v_student in select * from koutsi_training_audience(old) loop
    perform koutsi_notify(v_student, old.coach_id, 'training_cancelled',
      'Treeni peruttu',
      coalesce(v_what, old.type) || ' · ' || public.koutsi_session_when(old.date, old.time),
      '/pelaaja');
  end loop;
  return old;
end; $function$;

-- koutsi_notify: the burst titles say "huomio" too (rest as in koutsi_smart_notifications)
create or replace function public.koutsi_notify(p_recipient uuid, p_actor uuid, p_kind text, p_title text, p_body text, p_link text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_prev record;
  v_n integer;
  v_session boolean := p_kind in ('training_added', 'training_cancelled')
                       and p_title in ('Uusi treeni kalenterissasi', 'Treeni peruttu');
begin
  if p_recipient is null or p_recipient = p_actor then
    return;
  end if;
  if not exists (select 1 from auth.users u where u.id = p_recipient) then
    return;
  end if;
  if public.koutsi_notifications_paused()
     and not exists (select 1 from public.koutsi_admins a where a.user_id = p_recipient) then
    return;
  end if;
  if v_session or p_kind in ('diary', 'homework', 'video', 'announcement') then
    select n.id, n.kind, n.title, n.burst_count into v_prev
      from koutsi_notifications n
     where n.recipient_id = p_recipient
       and n.actor_id is not distinct from p_actor
       and n.created_at > now() - interval '10 minutes'
       and n.email_status in ('pending', 'skipped')
       and (case when v_session
                 then n.kind in ('training_added', 'training_cancelled')
                      and n.title in ('Uusi treeni kalenterissasi', 'Treeni peruttu', 'Uusia treenejä kalenterissasi', 'Treenejä peruttu', 'Treenisi muuttuivat')
                 else n.kind = p_kind end)
     order by n.created_at desc
     limit 1
     for update;
    if found then
      v_n := v_prev.burst_count + 1;
      update koutsi_notifications n
         set burst_count = v_n,
             read_at = null,
             title = case
               when v_session and (v_prev.kind <> p_kind or v_prev.title = 'Treenisi muuttuivat') then 'Treenisi muuttuivat'
               when v_session and p_kind = 'training_added' then 'Uusia treenejä kalenterissasi'
               when v_session then 'Treenejä peruttu'
               when p_kind = 'diary' then v_n || ' uutta huomiota valmentajaltasi'
               when p_kind = 'homework' then 'Sait ' || v_n || ' uutta kotiläksyä'
               when p_kind = 'video' then 'Valmentajasi jakoi ' || v_n || ' videota'
               else v_n || ' tiedotetta valmentajaltasi'
             end,
             body = case
               when v_session and (v_prev.kind <> p_kind or v_prev.title = 'Treenisi muuttuivat') then 'Valmentajasi muutti treenejäsi. Katso uudet ajat Koutsin kalenterista.'
               when v_session and p_kind = 'training_added' then 'Valmentajasi lisäsi useita treenejä. Katso ne Koutsin kalenterista.'
               when v_session then 'Useita treenejä poistui kalenteristasi. Katso muutokset Koutsista.'
               else 'Uusin: ' || left(coalesce(p_body, ''), 480)
             end
       where n.id = v_prev.id;
      return;
    end if;
  end if;
  insert into koutsi_notifications (recipient_id, actor_id, kind, title, body, link_path)
  values (p_recipient, p_actor, p_kind, p_title, left(coalesce(p_body, ''), 500), p_link);
end;
$function$;

-- ── 4. "Miten meni?" for every player (the beta-tester gate is gone) ─────────
create or replace function public.koutsi_queue_session_checkins()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
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
      continue when not exists (select 1 from auth.users u where u.id = v_student);
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

      -- no actor: the question comes from Koutsi, not from the coach
      perform public.koutsi_notify(
        v_student, null, 'session_checkin',
        'Treenit ohi! Miten meni?',
        coalesce(v_session.group_name, v_session.type) || ' · ' || to_char(v_session.date, 'FMDD.FMMM.') || ' klo '
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

-- ── 5. the training-day reminder (players only, 07:30 Helsinki) ──────────────
create table if not exists public.koutsi_session_reminder_log (
  student_id uuid not null references auth.users(id) on delete cascade,
  reminder_date date not null,
  created_at timestamptz not null default now(),
  primary key (student_id, reminder_date)
);
alter table public.koutsi_session_reminder_log enable row level security;
revoke all on public.koutsi_session_reminder_log from anon, authenticated;

create or replace function public.koutsi_queue_session_reminders()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_local timestamp := now() at time zone 'Europe/Helsinki';
  v_today date := (now() at time zone 'Europe/Helsinki')::date;
  v_row record;
  v_queued integer := 0;
begin
  -- the first reminders go out on the morning after the release (27.10.2026), never mid-day
  if v_local::time < time '07:30' or v_today < date '2026-10-27' then
    return 0;
  end if;
  for v_row in
    select a.sid,
           string_agg(
             coalesce(g.name, t.type) || ' klo ' || to_char(t.time, 'HH24:MI') || '–'
               || to_char(t.time + make_interval(mins => coalesce(t.duration_minutes, g.duration_minutes, 60)), 'HH24:MI')
               || coalesce(E'\nTeema: ' || nullif(th.title, ''), '')
               || coalesce(E'\nPaikka: ' || nullif(g.place, ''), '')
               || coalesce(E'\nValmentaja: ' || nullif(pc.name, ''), ''),
             E'\n\n' order by t.time) as lines
      from public.koutsi_trainings t
      left join public.koutsi_groups g on g.id = t.group_id
      left join public.koutsi_group_themes th
             on th.group_id = t.group_id
            and th.iso_year = extract(isoyear from t.date)::int
            and th.iso_week = extract(week from t.date)::int
      left join public.profiles pc on pc.id = t.coach_id
      cross join lateral public.koutsi_training_audience(t) as a(sid)
     where t.date = v_today
       and t.logged_by = 'coach'
       and ((t.date + t.time) at time zone 'Europe/Helsinki') > now() + interval '10 minutes'
       and exists (select 1 from auth.users u where u.id = a.sid)
       and not exists (select 1 from public.koutsi_training_absences ab where ab.training_id = t.id and ab.student_id = a.sid)
       and not exists (select 1 from public.koutsi_session_reminder_log l where l.student_id = a.sid and l.reminder_date = v_today)
     group by a.sid
  loop
    insert into public.koutsi_session_reminder_log (student_id, reminder_date)
    values (v_row.sid, v_today) on conflict do nothing;
    perform public.koutsi_notify(v_row.sid, null, 'session_reminder', 'Tänään on treenipäivä!', v_row.lines, '/pelaaja/treenit');
    v_queued := v_queued + 1;
  end loop;
  return v_queued;
end;
$function$;
revoke all on function public.koutsi_queue_session_reminders() from public, anon, authenticated;

select cron.schedule('koutsi-session-reminders', '*/15 * * * *', 'select public.koutsi_queue_session_reminders()');

-- ── 6. e-mail round: honour each person's choices; reminder and check-in are their own mails ──
create or replace function public.koutsi_claim_notification_batch(batch_size integer default 25)
 returns table(id uuid, email text, recipient_name text, kind text, title text, body text, link_path text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_hour integer := extract(hour from (now() at time zone 'Europe/Helsinki'))::integer;
  v_quiet boolean := v_hour >= 21 or v_hour < 7;
  v_ids uuid[];
begin
  -- the kinds a person turned off in Profiili → Sähköpostit are not mailed (the bell keeps them)
  update koutsi_notifications n
     set email_status = 'skipped'
   where n.email_status = 'pending'
     and exists (select 1 from koutsi_notification_prefs np
                  where np.user_id = n.recipient_id
                    and public.koutsi_email_category(n.kind) = any(np.email_off));

  with ready as (
    select n.recipient_id
      from koutsi_notifications n
     where n.email_status = 'pending'
       and n.email_attempts < 3
       and n.created_at < now() - interval '2 minutes'
     group by n.recipient_id
    having bool_or(n.kind in ('training_cancelled', 'session_checkin', 'session_reminder'))
        or (not v_quiet
            and coalesce((select max(s.emailed_at) from koutsi_notifications s
                           where s.recipient_id = n.recipient_id and s.email_status = 'sent'), '-infinity'::timestamptz)
                < now() - interval '3 hours')
     order by min(n.created_at)
     limit greatest(coalesce(batch_size, 25), 1)
  ), claimed as (
    update koutsi_notifications n
       set email_status = 'sending',
           email_attempts = n.email_attempts + 1
     where n.recipient_id in (select r.recipient_id from ready r)
       and n.email_status = 'pending'
       and n.email_attempts < 3
       and n.created_at < now() - interval '2 minutes'
    returning n.id
  )
  select array_agg(c.id) into v_ids from claimed c;

  if v_ids is null then
    return;
  end if;

  return query
  with c as (
    select n.id, n.recipient_id, n.kind, n.title, n.body, n.link_path, n.created_at
      from koutsi_notifications n where n.id = any(v_ids)
  ), per as (
    select r.recipient_id,
           (array_agg(r.id order by r.created_at desc))[1] as keep_id,
           count(*)::integer as cnt,
           string_agg('• ' || r.title, E'\n' order by r.created_at) as titles,
           bool_or(coalesce(r.link_path, '') like '/valmentaja%') as coach_side
      from c r
     where r.kind not in ('session_checkin', 'session_reminder')
     group by r.recipient_id
  ), outgoing as (
    select c.id, c.recipient_id, c.kind, c.title, c.body, c.link_path
      from c where c.kind in ('session_checkin', 'session_reminder')
    union all
    select p.keep_id, p.recipient_id,
           case when p.cnt = 1 then k.kind else 'digest' end,
           case when p.cnt = 1 then k.title else p.cnt || ' uutta asiaa Koutsissa' end,
           case when p.cnt = 1 then k.body else p.titles end,
           case when p.cnt = 1 then k.link_path when p.coach_side then '/valmentaja' else '/pelaaja' end
      from per p join c k on k.id = p.keep_id
  )
  select o.id, u.email::text, coalesce(pr.name, 'Pelaaja')::text, o.kind, o.title, o.body, o.link_path
    from outgoing o
    join auth.users u on u.id = o.recipient_id
    left join profiles pr on pr.id = o.recipient_id
    left join koutsi_notification_prefs np on np.user_id = o.recipient_id
   where u.email is not null
     and coalesce(np.email_enabled, true);

  update koutsi_notifications n
     set email_status = 'sent', emailed_at = now(), email_error = 'merged'
   where n.id = any(v_ids)
     and n.kind not in ('session_checkin', 'session_reminder')
     and n.id not in (
       select (array_agg(x.id order by x.created_at desc))[1]
         from koutsi_notifications x
        where x.id = any(v_ids) and x.kind not in ('session_checkin', 'session_reminder')
        group by x.recipient_id
     );

  update koutsi_notifications n
     set email_status = 'skipped'
   where n.id = any(v_ids)
     and n.email_status = 'sending'
     and not exists (
       select 1 from auth.users u
         left join koutsi_notification_prefs np on np.user_id = n.recipient_id
        where u.id = n.recipient_id and u.email is not null and coalesce(np.email_enabled, true)
     );
end;
$function$;
revoke all on function public.koutsi_claim_notification_batch(integer) from public, anon, authenticated;
revoke all on function public.koutsi_email_category(text) from public, anon, authenticated;
revoke all on function public.koutsi_session_when(date, time) from public, anon, authenticated;
