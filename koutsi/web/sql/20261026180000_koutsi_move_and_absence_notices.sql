-- koutsi_move_and_absence_notices — two notices that were missing (owner's wish 2026-10-26):
--   * a player hears when the coach moves a session to another day or time ("Treeni siirtyi");
--   * a coach hears when a player says "En pääse" ("Aatu Laine ei pääse"), and when the player
--     takes it back ("… pääseekin"). The player app already told the player "Poissaolo ilmoitettu
--     valmentajalle", but nothing reached the coach.
-- NOT APPLIED. Proposed for production; shown to the owner first.
--
-- Everything goes through koutsi_notify and keeps the koutsi_smart_notifications rules: a burst
-- within 10 minutes is one notice ("Treenisi muuttuivat", "Aatu Laine ei pääse 4 treeniin").
-- E-mail: these three kinds skip the 3-hour digest wait (a moved session or a missing player is
-- news for today), but keep the 21–07 quiet hours. A cancellation still goes at once, as before.
-- Nothing fires for: a player's own logs, bulk work (koutsi.bulk_trainings = 'on'), a session that
-- has already started, a coach marking attendance or planning absences, a type or length change.

-- ── 1. which e-mail choice the new kinds belong to ───────────────────────────
create or replace function public.koutsi_email_category(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind in ('diary', 'homework', 'video') then 'valmentaja'
    when p_kind = 'announcement' then 'tiedotteet'
    when p_kind in ('training_added', 'training_cancelled', 'training_moved') then 'treenit'
    when p_kind = 'session_reminder' then 'muistutus'
    when p_kind = 'session_checkin' then 'mitenmeni'
    when p_kind = 'match_note' then 'ottelut'
    when p_kind in ('player_absence', 'player_back') then 'poissaolot'
  end
$$;
revoke all on function public.koutsi_email_category(text) from public, anon, authenticated;

-- ── 2. a session that has started (Helsinki time) is no news any more ────────
create or replace function public.koutsi_session_started(p_date date, p_time time)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (p_date + p_time) <= (now() at time zone 'Europe/Helsinki')
$$;
revoke all on function public.koutsi_session_started(date, time) from public, anon, authenticated;

-- ── 3. koutsi_notify: the new kinds merge like the old ones ──────────────────
-- Changes against koutsi_email_round: 'Treeni siirtyi' joins the session family (a burst is
-- "Treenisi muuttuivat"); 'player_absence' / 'player_back' merge per player into
-- "<nimi> ei pääse N treeniin", listing every session, and then open the player's page.
create or replace function public.koutsi_notify(p_recipient uuid, p_actor uuid, p_kind text, p_title text, p_body text, p_link text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_prev record;
  v_n integer;
  v_session boolean := p_kind in ('training_added', 'training_cancelled', 'training_moved')
                       and p_title in ('Uusi treeni kalenterissasi', 'Treeni peruttu', 'Treeni siirtyi');
  v_absence boolean := p_kind in ('player_absence', 'player_back');
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
  if v_session or v_absence or p_kind in ('diary', 'homework', 'video', 'announcement') then
    select n.id, n.kind, n.title, n.body, n.burst_count into v_prev
      from koutsi_notifications n
     where n.recipient_id = p_recipient
       and n.actor_id is not distinct from p_actor
       and n.created_at > now() - interval '10 minutes'
       and n.email_status in ('pending', 'skipped')
       and (case when v_session
                 then n.kind in ('training_added', 'training_cancelled', 'training_moved')
                      and n.title in ('Uusi treeni kalenterissasi', 'Treeni peruttu', 'Treeni siirtyi', 'Uusia treenejä kalenterissasi', 'Treenejä peruttu', 'Treenisi muuttuivat')
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
               when v_session and (v_prev.kind <> p_kind or v_prev.title = 'Treenisi muuttuivat' or p_kind = 'training_moved') then 'Treenisi muuttuivat'
               when v_session and p_kind = 'training_added' then 'Uusia treenejä kalenterissasi'
               when v_session then 'Treenejä peruttu'
               when v_absence then p_title || ' ' || v_n || ' treeniin'
               when p_kind = 'diary' then v_n || ' uutta huomiota valmentajaltasi'
               when p_kind = 'homework' then 'Sait ' || v_n || ' uutta kotiläksyä'
               when p_kind = 'video' then 'Valmentajasi jakoi ' || v_n || ' videota'
               else v_n || ' tiedotetta valmentajaltasi'
             end,
             body = case
               when v_session and (v_prev.kind <> p_kind or v_prev.title = 'Treenisi muuttuivat' or p_kind = 'training_moved') then 'Valmentajasi muutti treenejäsi. Katso uudet ajat Koutsin kalenterista.'
               when v_session and p_kind = 'training_added' then 'Valmentajasi lisäsi useita treenejä. Katso ne Koutsin kalenterista.'
               when v_session then 'Useita treenejä poistui kalenteristasi. Katso muutokset Koutsista.'
               when v_absence then left(coalesce(v_prev.body, '') || E'\n' || coalesce(p_body, ''), 500)
               else 'Uusin: ' || left(coalesce(p_body, ''), 480)
             end,
             link_path = case
               when v_absence then '/valmentaja/pelaaja/' || p_actor
               else n.link_path
             end
       where n.id = v_prev.id;
      return;
    end if;
  end if;
  insert into koutsi_notifications (recipient_id, actor_id, kind, title, body, link_path)
  values (p_recipient, p_actor, p_kind, p_title, left(coalesce(p_body, ''), 500), p_link);
end;
$function$;

-- ── 4. "Treeni siirtyi" to the players of a moved session ────────────────────
create or replace function public.koutsi_on_training_moved()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_student uuid;
  v_what text;
  v_was text;
begin
  if coalesce(current_setting('koutsi.bulk_trainings', true), '') = 'on' then
    return new;
  end if;
  if new.logged_by = 'player' then
    return new;
  end if;
  if new.date = old.date and new.time = old.time then
    return new;
  end if;
  -- a time fixed afterwards on a session that is over is no news to anyone
  if public.koutsi_session_started(old.date, old.time) and public.koutsi_session_started(new.date, new.time) then
    return new;
  end if;
  select coalesce(g.name, new.type) into v_what from (select 1) x left join koutsi_groups g on g.id = new.group_id;
  v_was := case when new.date = old.date then 'klo ' || to_char(old.time, 'HH24:MI')
                else public.koutsi_session_when(old.date, old.time) end;
  for v_student in select * from koutsi_training_audience(new) loop
    perform koutsi_notify(v_student, new.coach_id, 'training_moved',
      'Treeni siirtyi',
      coalesce(v_what, new.type) || ' · ' || public.koutsi_session_when(new.date, new.time) || ' (oli ' || v_was || ')',
      '/pelaaja');
  end loop;
  return new;
end;
$function$;
revoke all on function public.koutsi_on_training_moved() from public, anon, authenticated;
drop trigger if exists koutsi_training_move_notify on public.koutsi_trainings;
create trigger koutsi_training_move_notify after update of date, time on public.koutsi_trainings
  for each row
  when (old.date is distinct from new.date or old.time is distinct from new.time)
  execute function public.koutsi_on_training_moved();

-- ── 5. "<nimi> ei pääse" / "<nimi> pääseekin" to the coach ──────────────────
-- Only the player's own report counts (reported_by = the player, stamped from auth.uid()); a
-- coach marking attendance or planning absences writes their own id and stays quiet.
create or replace function public.koutsi_absence_notice(p_training_id uuid, p_student uuid, out coach_id uuid, out who text, out what text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select t.coach_id,
         coalesce(nullif(btrim(p.name), ''), nullif(btrim(s.display_name), ''), 'Pelaaja'),
         coalesce(g.name, t.type) || ' · ' || public.koutsi_session_when(t.date, t.time)
    from koutsi_trainings t
    left join koutsi_groups g on g.id = t.group_id
    left join profiles p on p.id = p_student
    left join koutsi_students s on s.id = p_student
   where t.id = p_training_id
     and t.logged_by <> 'player'
     and not public.koutsi_session_started(t.date, t.time)
$function$;
revoke all on function public.koutsi_absence_notice(uuid, uuid) from public, anon, authenticated;

create or replace function public.koutsi_on_absence_reported()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v record;
begin
  if coalesce(current_setting('koutsi.bulk_trainings', true), '') = 'on' then
    return new;
  end if;
  if new.reported_by is distinct from new.student_id then
    return new;
  end if;
  select * into v from public.koutsi_absence_notice(new.training_id, new.student_id);
  if v.coach_id is null then
    return new;
  end if;
  perform koutsi_notify(v.coach_id, new.student_id, 'player_absence',
    v.who || ' ei pääse', v.what, '/valmentaja/treeni/' || new.training_id);
  return new;
end;
$function$;
revoke all on function public.koutsi_on_absence_reported() from public, anon, authenticated;
drop trigger if exists koutsi_absence_notify on public.koutsi_training_absences;
create trigger koutsi_absence_notify after insert on public.koutsi_training_absences
  for each row execute function public.koutsi_on_absence_reported();

create or replace function public.koutsi_on_absence_withdrawn()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v record;
begin
  if coalesce(current_setting('koutsi.bulk_trainings', true), '') = 'on' then
    return old;
  end if;
  -- only the player taking back their own "En pääse" (not the coach, not a deleted session)
  if (select auth.uid()) is distinct from old.student_id or old.reported_by is distinct from old.student_id then
    return old;
  end if;
  select * into v from public.koutsi_absence_notice(old.training_id, old.student_id);
  if v.coach_id is null then
    return old;
  end if;
  -- taken back within minutes, before the coach read it or got a mail: the notice just goes away
  delete from koutsi_notifications n
   where n.recipient_id = v.coach_id
     and n.actor_id = old.student_id
     and n.kind = 'player_absence'
     and n.burst_count = 1
     and n.body = v.what
     and n.read_at is null
     and n.email_status in ('pending', 'skipped')
     and n.created_at > now() - interval '10 minutes';
  if found then
    return old;
  end if;
  perform koutsi_notify(v.coach_id, old.student_id, 'player_back',
    v.who || ' pääseekin', v.what, '/valmentaja/treeni/' || old.training_id);
  return old;
end;
$function$;
revoke all on function public.koutsi_on_absence_withdrawn() from public, anon, authenticated;
drop trigger if exists koutsi_absence_withdrawn_notify on public.koutsi_training_absences;
create trigger koutsi_absence_withdrawn_notify after delete on public.koutsi_training_absences
  for each row execute function public.koutsi_on_absence_withdrawn();

-- ── 6. e-mail: the new kinds skip the 3-hour wait, but not the quiet hours ───
-- Only change against koutsi_email_round: the `having` clause of `ready`.
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
            and (bool_or(n.kind in ('training_moved', 'player_absence', 'player_back'))
                 or coalesce((select max(s.emailed_at) from koutsi_notifications s
                               where s.recipient_id = n.recipient_id and s.email_status = 'sent'), '-infinity'::timestamptz)
                    < now() - interval '3 hours'))
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
