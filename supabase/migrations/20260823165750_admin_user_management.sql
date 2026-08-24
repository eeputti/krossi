-- Give Koutsi administrators a single, server-authorised user directory. The browser
-- never reads auth.users or storage.objects directly: this RPC returns only the fields
-- needed by the Yllapito view and re-checks koutsi_admins on every request.
create or replace function public.koutsi_admin_users()
returns table (
  user_id uuid,
  display_name text,
  email text,
  joined_at timestamptz,
  is_admin boolean,
  is_coach boolean,
  is_player boolean,
  storage_bytes bigint,
  student_count integer,
  group_count integer,
  training_count integer,
  active_codes jsonb,
  pending_plans integer
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not public.koutsi_is_admin() then
    raise exception 'not allowed';
  end if;

  return query
  select
    u.id,
    coalesce(
      nullif(btrim(p.name), ''),
      nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
      split_part(coalesce(u.email, ''), '@', 1),
      'Nimetön'
    )::text,
    u.email::text,
    u.created_at,
    exists (
      select 1 from public.koutsi_admins a where a.user_id = u.id
    ),
    exists (
      select 1
        from public.koutsi_coaches c
       where c.id = u.id and c.archived_at is null
    ),
    exists (
      select 1 from public.koutsi_students s where s.id = u.id
    ),
    usage.storage_bytes,
    (select count(*)::integer
       from public.koutsi_coach_students cs
      where cs.coach_id = u.id and cs.ended_at is null),
    (select count(*)::integer
       from public.koutsi_groups g
      where g.coach_id = u.id),
    (select count(*)::integer
       from public.koutsi_trainings t
      where t.coach_id = u.id),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'code', k.code,
          'label', k.label,
          'group_name', (select g2.name from public.koutsi_groups g2 where g2.id = k.group_id),
          'used', k.use_count,
          'max_uses', k.max_uses,
          'expires_at', k.expires_at
        ) order by k.created_at desc
      )
        from public.koutsi_group_invite_codes k
       where k.coach_id = u.id
         and k.revoked_at is null
         and (k.expires_at is null or k.expires_at > now())
         and (k.max_uses is null or k.use_count < k.max_uses)
    ), '[]'::jsonb),
    (select count(*)::integer
       from public.koutsi_groups g3
      where g3.coach_id = u.id
        and g3.annual_plan_status = 'review'
        and g3.annual_plan_storage_path is not null)
  from auth.users u
  left join public.profiles p on p.id = u.id
  cross join lateral (
    select coalesce(sum(
      case
        when o.metadata ->> 'size' ~ '^[0-9]+$' then (o.metadata ->> 'size')::bigint
        else 0::bigint
      end
    ), 0)::bigint as storage_bytes
      from storage.objects o
     where o.owner_id = u.id::text
        or o.owner = u.id
        or (
          o.bucket_id in ('profile-avatars', 'koutsi-videos')
          and split_part(o.name, '/', 1) = u.id::text
        )
        or (
          o.bucket_id = 'koutsi-plans'
          and exists (
            select 1
              from public.koutsi_groups storage_group
             where storage_group.id::text = split_part(o.name, '/', 1)
               and storage_group.coach_id = u.id
          )
        )
  ) usage
  order by u.created_at desc;
end;
$function$;

revoke all on function public.koutsi_admin_users() from public, anon;
grant execute on function public.koutsi_admin_users() to authenticated, service_role;

-- Supabase Auth refuses to delete a user while that user owns Storage objects. It also
-- cannot know that an annual plan belongs to the coach whose group id starts its path.
-- Return one de-duplicated manifest for the Edge Function to remove through Storage API
-- before it calls auth.admin.deleteUser(). Nothing is deleted by this read-only RPC.
create or replace function public.koutsi_admin_user_deletion_manifest(
  target_user_id_input uuid
)
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
  v_is_coach boolean;
  v_is_player boolean;
  v_files jsonb;
  v_storage_bytes bigint;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if not public.koutsi_is_admin() then
    raise exception 'not allowed';
  end if;
  if target_user_id_input is null then
    raise exception 'user not found';
  end if;
  if target_user_id_input = v_uid then
    raise exception 'cannot delete your own admin account';
  end if;
  if exists (
    select 1 from public.koutsi_admins a where a.user_id = target_user_id_input
  ) then
    raise exception 'cannot delete an administrator';
  end if;

  select
    u.email,
    coalesce(
      nullif(btrim(p.name), ''),
      nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
      split_part(coalesce(u.email, ''), '@', 1),
      'Nimetön'
    ),
    exists (
      select 1
        from public.koutsi_coaches c
       where c.id = u.id and c.archived_at is null
    ),
    exists (
      select 1 from public.koutsi_students s where s.id = u.id
    )
  into v_email, v_name, v_is_coach, v_is_player
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = target_user_id_input;

  if not found then
    raise exception 'user not found';
  end if;

  with attributed_objects as (
    select distinct
      o.id,
      o.bucket_id,
      o.name,
      case
        when o.metadata ->> 'size' ~ '^[0-9]+$' then (o.metadata ->> 'size')::bigint
        else 0::bigint
      end as size_bytes
    from storage.objects o
    where o.owner_id = target_user_id_input::text
       or o.owner = target_user_id_input
       or (
         o.bucket_id in ('profile-avatars', 'koutsi-videos')
         and split_part(o.name, '/', 1) = target_user_id_input::text
       )
       or (
         o.bucket_id = 'koutsi-plans'
         and exists (
           select 1
             from public.koutsi_groups storage_group
            where storage_group.id::text = split_part(o.name, '/', 1)
              and storage_group.coach_id = target_user_id_input
         )
       )
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'bucket', bucket_id,
          'path', name,
          'size_bytes', size_bytes
        ) order by bucket_id, name
      ),
      '[]'::jsonb
    ),
    coalesce(sum(size_bytes), 0)::bigint
  into v_files, v_storage_bytes
  from attributed_objects;

  return jsonb_build_object(
    'user_id', target_user_id_input,
    'email', v_email,
    'name', v_name,
    'is_coach', v_is_coach,
    'is_player', v_is_player,
    'storage_bytes', v_storage_bytes,
    'files', v_files
  );
end;
$function$;

revoke all on function public.koutsi_admin_user_deletion_manifest(uuid) from public, anon;
grant execute on function public.koutsi_admin_user_deletion_manifest(uuid) to authenticated, service_role;

-- Keep an immutable snapshot after a privileged deletion. The target id is intentionally
-- not a foreign key because auth.users no longer contains it by the time this row is made.
create table if not exists public.koutsi_admin_deletions (
  id bigint generated by default as identity primary key,
  admin_id uuid references auth.users(id) on delete set null,
  admin_email text,
  target_user_id uuid not null,
  target_email text,
  target_name text,
  target_roles text[] not null default '{}'::text[],
  storage_bytes bigint not null default 0 check (storage_bytes >= 0),
  deleted_at timestamptz not null default now()
);

alter table public.koutsi_admin_deletions enable row level security;
revoke all on table public.koutsi_admin_deletions from public, anon, authenticated;
grant select, insert on table public.koutsi_admin_deletions to service_role;
