-- A whole-app review (2026-09-14) found 22 more functions that exist only as live state in
-- this project, never captured in any tracked migration — the same gap
-- 20260911174157_capture_untracked_invite_functions.sql and
-- 20260911211833_capture_untracked_coach_key_and_rls_helper_functions.sql already closed
-- for two smaller groups. This closes it for: the entire email-notification pipeline
-- (koutsi_notify + every table trigger that calls it + the cron-driven email queue),
-- the admin annual-plan review workflow, and five standalone helpers
-- (delete_my_koutsi_data, koutsi_enforce_invite_code_coach_consistency,
-- koutsi_training_audience, koutsi_player_group_roster, koutsi_can_write_video) that gate
-- GDPR erasure, invite-code data integrity, notification fan-out, cross-player roster
-- visibility and video-sharing RLS respectively.
--
-- Pure "create or replace" pulled verbatim via pg_get_functiondef against the live
-- project, no behavior change. Trigger attachments (CREATE TRIGGER ...) and existing
-- grants are untouched by CREATE OR REPLACE and are deliberately not restated here.

create or replace function public.koutsi_notify(p_recipient uuid, p_actor uuid, p_kind text, p_title text, p_body text, p_link text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if p_recipient is null or p_recipient = p_actor then
    return;
  end if;
  if not exists (select 1 from auth.users u where u.id = p_recipient) then
    return;
  end if;
  insert into koutsi_notifications (recipient_id, actor_id, kind, title, body, link_path)
  values (p_recipient, p_actor, p_kind, p_title, left(coalesce(p_body, ''), 500), p_link);
end;
$function$;

create or replace function public.koutsi_notify_annual_plan()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_admin uuid;
  v_coach_name text;
begin
  if new.annual_plan_storage_path is not null
     and new.annual_plan_status = 'review'
     and (tg_op = 'INSERT' or new.annual_plan_storage_path is distinct from old.annual_plan_storage_path)
  then
    select coalesce(p.name, 'Valmentaja') into v_coach_name from profiles p where p.id = new.coach_id;
    for v_admin in select user_id from koutsi_admins loop
      perform koutsi_notify(
        v_admin, null, 'annual_plan_submitted',
        'Uusi vuosisuunnitelma odottaa lisäämistä',
        coalesce(v_coach_name, 'Valmentaja') || ' lähetti ryhmälle "' || new.name || '" tiedoston '
          || coalesce(new.annual_plan_filename, '(nimetön)') || '. Polku: koutsi-plans/'
          || coalesce(new.annual_plan_storage_path, '-'),
        '/valmentaja'
      );
    end loop;
  end if;

  if tg_op = 'UPDATE'
     and new.annual_plan_status = 'published'
     and old.annual_plan_status is distinct from 'published'
     and new.annual_plan_storage_path is not null
  then
    perform koutsi_notify(
      new.coach_id, null, 'annual_plan_published',
      'Vuosisuunnitelma on nyt järjestelmässä',
      'Ryhmän "' || new.name || '" vuosisuunnitelma on lisätty ja näkyy nyt sovelluksessa.',
      '/valmentaja'
    );
  end if;

  return new;
end;
$function$;

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
    'Uusi merkintä valmentajaltasi',
    coalesce(v_coach, 'Valmentajasi') || ': ' || new.text, '/pelaaja');
  return new;
end; $function$;

create or replace function public.koutsi_on_homework_insert()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform koutsi_notify(new.student_id, auth.uid(), 'homework',
    'Sait uuden kotiläksyn', new.text, '/pelaaja');
  return new;
end; $function$;

create or replace function public.koutsi_on_match_note_insert()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_coach uuid; v_player text;
begin
  select coalesce(name, 'Pelaajasi') into v_player from profiles where id = new.student_id;
  for v_coach in select coach_id from koutsi_coach_students where student_id = new.student_id and ended_at is null loop
    perform koutsi_notify(v_coach, new.student_id, 'match_note',
      'Uusi ottelumuistiinpano',
      coalesce(v_player, 'Pelaajasi') || ' — vastustaja ' || new.opponent_name, '/valmentaja');
  end loop;
  return new;
end; $function$;

create or replace function public.koutsi_on_training_delete()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_student uuid;
begin
  if old.date < current_date then
    return old;
  end if;
  for v_student in select * from koutsi_training_audience(old) loop
    perform koutsi_notify(v_student, old.coach_id, 'training_cancelled',
      'Treeni peruttu',
      to_char(old.date, 'DD.MM.YYYY') || ' klo ' || to_char(old.time, 'HH24:MI') || ' — ' || old.type,
      '/pelaaja');
  end loop;
  return old;
end; $function$;

create or replace function public.koutsi_on_training_insert()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_student uuid;
begin
  for v_student in select * from koutsi_training_audience(new) loop
    perform koutsi_notify(v_student, new.coach_id, 'training_added',
      'Uusi treeni kalenterissasi',
      to_char(new.date, 'DD.MM.YYYY') || ' klo ' || to_char(new.time, 'HH24:MI') || ' — ' || new.type,
      '/pelaaja');
  end loop;
  return new;
end; $function$;

create or replace function public.koutsi_on_video_insert()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform koutsi_notify(new.student_id, new.added_by_id, 'video',
    'Valmentajasi jakoi videon', new.title, '/pelaaja');
  return new;
end; $function$;

create or replace function public.koutsi_claim_notification_batch(batch_size integer DEFAULT 25)
 returns TABLE(id uuid, email text, recipient_name text, kind text, title text, body text, link_path text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  return query
  with claimed as (
    update koutsi_notifications n
       set email_status = 'sending',
           email_attempts = n.email_attempts + 1
     where n.id in (
       select n2.id from koutsi_notifications n2
        where n2.email_status = 'pending'
          and n2.email_attempts < 3
          and n2.created_at < now() - interval '2 minutes'
        order by n2.created_at
        limit greatest(coalesce(batch_size, 25), 1)
        for update skip locked
     )
    returning n.id, n.recipient_id, n.kind, n.title, n.body, n.link_path
  )
  select c.id,
         u.email::text,
         coalesce(p.name, 'Pelaaja')::text,
         c.kind, c.title, c.body, c.link_path
    from claimed c
    join auth.users u on u.id = c.recipient_id
    left join profiles p on p.id = c.recipient_id
    left join koutsi_notification_prefs np on np.user_id = c.recipient_id
   where u.email is not null
     and coalesce(np.email_enabled, true);

  update koutsi_notifications n
     set email_status = 'skipped'
   where n.email_status = 'sending'
     and not exists (
       select 1 from auth.users u
        left join koutsi_notification_prefs np on np.user_id = n.recipient_id
        where u.id = n.recipient_id and u.email is not null and coalesce(np.email_enabled, true)
     );
end;
$function$;

create or replace function public.koutsi_dispatch_notification_emails()
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'koutsi_notify_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'koutsi_cron_key';
  if v_url is null or v_key is null then
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('content-type', 'application/json', 'x-koutsi-cron-key', v_key),
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
end;
$function$;

create or replace function public.koutsi_mark_notifications_sent(ids uuid[], failed_error text DEFAULT NULL::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if failed_error is null then
    update koutsi_notifications
       set email_status = 'sent', emailed_at = now(), email_error = null
     where id = any(ids);
  else
    update koutsi_notifications
       set email_status = case when email_attempts >= 3 then 'failed' else 'pending' end,
           email_error = left(failed_error, 500)
     where id = any(ids);
  end if;
end;
$function$;

create or replace function public.koutsi_requeue_stuck_notifications()
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  update koutsi_notifications
     set email_status = 'pending'
   where email_status = 'sending'
     and created_at < now() - interval '30 minutes';
$function$;

create or replace function public.koutsi_admin_coaches()
 returns TABLE(coach_id uuid, coach_name text, email text, joined_at timestamp with time zone, student_count integer, group_count integer, training_count integer, active_codes jsonb, pending_plans integer)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not koutsi_is_admin() then
    raise exception 'not allowed';
  end if;
  return query
    select c.id,
           coalesce(p.name, 'Nimetön')::text,
           u.email::text,
           c.created_at,
           (select count(*)::int from koutsi_coach_students cs where cs.coach_id = c.id and cs.ended_at is null),
           (select count(*)::int from koutsi_groups g where g.coach_id = c.id),
           (select count(*)::int from koutsi_trainings t where t.coach_id = c.id),
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'code', k.code, 'label', k.label,
                      'group_name', (select g2.name from koutsi_groups g2 where g2.id = k.group_id),
                      'used', k.use_count, 'max_uses', k.max_uses, 'expires_at', k.expires_at)
                      order by k.created_at desc)
               from koutsi_group_invite_codes k
              where k.coach_id = c.id
                and k.revoked_at is null
                and (k.expires_at is null or k.expires_at > now())
                and (k.max_uses is null or k.use_count < k.max_uses)
           ), '[]'::jsonb),
           (select count(*)::int from koutsi_groups g3
             where g3.coach_id = c.id and g3.annual_plan_status = 'review' and g3.annual_plan_storage_path is not null)
      from koutsi_coaches c
      left join profiles p on p.id = c.id
      left join auth.users u on u.id = c.id
     order by c.created_at desc;
end;
$function$;

create or replace function public.koutsi_admin_groups(coach_id_input uuid)
 returns TABLE(group_id uuid, group_name text, member_count integer, plan_filename text, plan_status text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not koutsi_is_admin() then
    raise exception 'not allowed';
  end if;
  return query
    select g.id, g.name,
           (select count(*)::int from koutsi_group_members m where m.group_id = g.id and m.ended_at is null),
           g.annual_plan_filename, coalesce(g.annual_plan_status, 'published')
      from koutsi_groups g
     where g.coach_id = coach_id_input
     order by g.created_at;
end;
$function$;

create or replace function public.koutsi_admin_set_annual_plan(group_id_input uuid, filename_input text, storage_path_input text, size_bytes_input bigint DEFAULT NULL::bigint)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not koutsi_is_admin() then
    raise exception 'not allowed';
  end if;
  update koutsi_groups
     set annual_plan_filename = filename_input,
         annual_plan_storage_path = storage_path_input,
         annual_plan_size_bytes = size_bytes_input,
         annual_plan_uploaded_at = now(),
         annual_plan_status = 'published'
   where id = group_id_input;
  if not found then
    raise exception 'Ryhmää ei löytynyt';
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;

create or replace function public.koutsi_pending_annual_plans()
 returns TABLE(group_id uuid, group_name text, coach_id uuid, coach_name text, filename text, storage_path text, size_bytes bigint, uploaded_at timestamp with time zone)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not koutsi_is_admin() then
    raise exception 'not allowed';
  end if;
  return query
    select g.id, g.name, g.coach_id, coalesce(p.name, 'Valmentaja')::text,
           g.annual_plan_filename, g.annual_plan_storage_path,
           g.annual_plan_size_bytes, g.annual_plan_uploaded_at
      from koutsi_groups g
      left join profiles p on p.id = g.coach_id
     where g.annual_plan_storage_path is not null
       and g.annual_plan_status = 'review'
     order by g.annual_plan_uploaded_at;
end;
$function$;

create or replace function public.koutsi_publish_annual_plan(group_id_input uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not koutsi_is_admin() then
    raise exception 'not allowed';
  end if;
  update koutsi_groups
     set annual_plan_status = 'published'
   where id = group_id_input
     and annual_plan_storage_path is not null;
  if not found then
    raise exception 'Ryhmää tai suunnitelmaa ei löytynyt';
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;

create or replace function public.delete_my_koutsi_data()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  delete from koutsi_moods        where student_id = v_uid;
  delete from koutsi_match_notes  where student_id = v_uid;
  delete from koutsi_videos       where student_id = v_uid or added_by_id = v_uid;
  delete from koutsi_homework     where student_id = v_uid;
  delete from koutsi_diary_entries where student_id = v_uid or coach_id = v_uid;
  delete from koutsi_training_absences where student_id = v_uid;

  delete from koutsi_group_members where student_id = v_uid;
  delete from koutsi_coach_students where student_id = v_uid or coach_id = v_uid;

  delete from koutsi_trainings    where coach_id = v_uid;
  delete from koutsi_groups       where coach_id = v_uid;
  delete from koutsi_exercises    where coach_id = v_uid;
  delete from koutsi_coach_events where coach_id = v_uid;
  delete from koutsi_group_invite_codes where coach_id = v_uid;

  delete from koutsi_notifications where recipient_id = v_uid or actor_id = v_uid;
  delete from koutsi_notification_prefs where user_id = v_uid;

  delete from koutsi_students where id = v_uid;
  delete from koutsi_coaches  where id = v_uid;
  delete from profiles        where id = v_uid;

  return jsonb_build_object('ok', true);
end;
$function$;

create or replace function public.koutsi_enforce_invite_code_coach_consistency()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.group_id is not null then
    if new.coach_id <> (select coach_id from koutsi_groups where id = new.group_id) then
      raise exception 'invite code coach_id must match the group''s coach_id';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.koutsi_training_audience(p_training koutsi_trainings)
 returns SETOF uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p_training.student_id where p_training.student_id is not null
  union
  select gm.student_id from koutsi_group_members gm
   where p_training.group_id is not null and gm.group_id = p_training.group_id and gm.ended_at is null;
$function$;

create or replace function public.koutsi_player_group_roster()
 returns TABLE(group_id uuid, student_id uuid, name text, avatar_url text, level text)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select distinct
         mine.group_id,
         peer.student_id,
         coalesce(nullif(btrim(p.name), ''), nullif(btrim(s.display_name), ''), 'Pelaaja') as name,
         p.avatar_url,
         s.level
    from public.koutsi_group_members mine
    join public.koutsi_groups g
      on g.id = mine.group_id
    join public.koutsi_coach_students mine_link
      on mine_link.coach_id = g.coach_id
     and mine_link.student_id = mine.student_id
     and mine_link.ended_at is null
    join public.koutsi_group_members peer
      on peer.group_id = mine.group_id
     and peer.ended_at is null
    join public.koutsi_coach_students peer_link
      on peer_link.coach_id = g.coach_id
     and peer_link.student_id = peer.student_id
     and peer_link.ended_at is null
    join public.koutsi_students s
      on s.id = peer.student_id
    left join public.profiles p
      on p.id = peer.student_id
   where (select auth.uid()) is not null
     and mine.student_id = (select auth.uid())
     and mine.ended_at is null
   order by mine.group_id, name, peer.student_id;
$function$;

create or replace function public.koutsi_can_write_video(student_id_input uuid, added_by_id_input uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select (select auth.uid()) is not null
     and added_by_id_input is not null
     and (
       (
         student_id_input = added_by_id_input
         and added_by_id_input = (select auth.uid())
       )
       or exists (
         select 1
           from public.koutsi_coach_students cs
           join public.koutsi_coaches c
             on c.id = cs.coach_id
            and c.archived_at is null
          where cs.student_id = student_id_input
            and cs.coach_id = added_by_id_input
            and cs.ended_at is null
            and public.koutsi_acts_as(added_by_id_input)
       )
     );
$function$;
