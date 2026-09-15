-- Krossi's own "Ylläpito" tab in the web app, mirroring Koutsi's admin console.
-- Both apps share this Supabase project and the same auth.users, so koutsi_admins
-- is reused as the one shared admin roster rather than introducing a second table.

create or replace function public.krossi_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null
     and exists (
       select 1 from public.koutsi_admins a where a.user_id = (select auth.uid())
     );
$function$;

revoke all on function public.krossi_is_admin() from public, anon;
grant execute on function public.krossi_is_admin() to authenticated, service_role;

create or replace function public.krossi_admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if not public.krossi_is_admin() then
    raise exception 'not allowed';
  end if;

  select jsonb_build_object(
    'total_players', (select count(*) from public.profiles),
    'new_players_7d', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'new_players_30d', (select count(*) from public.profiles where created_at > now() - interval '30 days'),
    'paid_players', (select count(*) from public.profiles where paid_at is not null),
    'hidden_players', (select count(*) from public.profiles where coalesce(hidden_from_feed, false)),
    'challenges_total', (select count(*) from public.challenges),
    'challenges_open', (select count(*) from public.challenges where status = 'open'),
    'challenges_filled', (select count(*) from public.challenges where status = 'filled'),
    'challenges_played', (select count(*) from public.challenges where outcome = 'played'),
    'matches_recorded', (select count(*) from public.match_results),
    'conversations_total', (select count(*) from public.conversations),
    'messages_total', (select count(*) from public.messages),
    'reports_open', (select count(*) from public.reports)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.krossi_admin_stats() from public, anon;
grant execute on function public.krossi_admin_stats() to authenticated, service_role;

create or replace function public.krossi_admin_users()
returns table (
  user_id uuid,
  display_name text,
  email text,
  joined_at timestamptz,
  is_admin boolean,
  area text,
  hidden_from_feed boolean,
  paid_at timestamptz,
  challenges_created integer,
  matches_recorded integer
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not public.krossi_is_admin() then
    raise exception 'not allowed';
  end if;

  return query
  select
    u.id,
    coalesce(nullif(btrim(p.name), ''), split_part(coalesce(u.email, ''), '@', 1), 'Nimetön')::text,
    u.email::text,
    u.created_at,
    exists (select 1 from public.koutsi_admins a where a.user_id = u.id),
    p.area,
    coalesce(p.hidden_from_feed, false),
    p.paid_at,
    (select count(*)::integer from public.challenges c where c.creator_id = u.id),
    (select count(*)::integer from public.match_results m where m.created_by = u.id)
  from auth.users u
  join public.profiles p on p.id = u.id
  order by u.created_at desc;
end;
$function$;

revoke all on function public.krossi_admin_users() from public, anon;
grant execute on function public.krossi_admin_users() to authenticated, service_role;

-- Deletion goes through a manifest step (checked server-side, storage files listed)
-- before the krossi-admin-delete-user edge function removes the auth.users row, which
-- cascades to profiles and every dependent table.
create or replace function public.krossi_admin_user_deletion_manifest(target_user_id_input uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_name text;
  v_files jsonb;
  v_storage_bytes bigint;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if not public.krossi_is_admin() then
    raise exception 'not allowed';
  end if;
  if target_user_id_input is null then
    raise exception 'user not found';
  end if;
  if target_user_id_input = v_uid then
    raise exception 'cannot delete your own admin account';
  end if;
  if exists (select 1 from public.koutsi_admins a where a.user_id = target_user_id_input) then
    raise exception 'cannot delete an administrator';
  end if;

  select u.email,
         coalesce(nullif(btrim(p.name), ''), split_part(coalesce(u.email, ''), '@', 1), 'Nimetön')
    into v_email, v_name
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.id = target_user_id_input;

  if not found then
    raise exception 'user not found';
  end if;

  with attributed_objects as (
    select distinct o.id, o.bucket_id, o.name,
      case when o.metadata ->> 'size' ~ '^[0-9]+$' then (o.metadata ->> 'size')::bigint else 0::bigint end as size_bytes
      from storage.objects o
     where o.owner_id = target_user_id_input::text
        or o.owner = target_user_id_input
        or (
          o.bucket_id in ('profile-avatars', 'chat-images')
          and split_part(o.name, '/', 1) = target_user_id_input::text
        )
  )
  select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket_id, 'path', name, 'size_bytes', size_bytes) order by bucket_id, name), '[]'::jsonb),
         coalesce(sum(size_bytes), 0)::bigint
    into v_files, v_storage_bytes
    from attributed_objects;

  return jsonb_build_object(
    'user_id', target_user_id_input,
    'email', v_email,
    'name', v_name,
    'storage_bytes', v_storage_bytes,
    'files', v_files
  );
end;
$function$;

revoke all on function public.krossi_admin_user_deletion_manifest(uuid) from public, anon;
grant execute on function public.krossi_admin_user_deletion_manifest(uuid) to authenticated, service_role;
