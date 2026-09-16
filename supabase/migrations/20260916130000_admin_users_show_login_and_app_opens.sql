-- Surface "viimeksi kirjautunut" (auth.users.last_sign_in_at) and app-open activity
-- (koutsi_app_opens, added in the previous migration) in both Ylläpito user directories,
-- so admins can spot dormant accounts instead of only seeing when a tile was created.
--
-- Changing the RETURNS TABLE shape requires drop + create, not just create or replace.
drop function if exists public.koutsi_admin_users();

create function public.koutsi_admin_users()
returns table (
  user_id uuid,
  display_name text,
  email text,
  joined_at timestamptz,
  last_sign_in_at timestamptz,
  app_open_count integer,
  last_app_open_at timestamptz,
  is_admin boolean,
  is_coach boolean,
  is_player boolean,
  storage_bytes bigint,
  student_count integer,
  group_count integer,
  training_count integer,
  active_codes jsonb,
  pending_plans integer,
  pending_students jsonb
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
    u.last_sign_in_at,
    coalesce(opens.open_count, 0)::integer,
    opens.last_opened_at,
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
        and g3.annual_plan_storage_path is not null),
    coalesce((
      select jsonb_agg(
        jsonb_build_object('id', ph.id, 'name', ph.display_name)
        order by ph.display_name
      )
        from public.koutsi_students ph
       where ph.placeholder_coach_id = u.id
    ), '[]'::jsonb)
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join lateral (
    select sum(o.open_count)::integer as open_count, max(o.last_opened_at) as last_opened_at
      from public.koutsi_app_opens o
     where o.user_id = u.id
       and o.app in ('koutsi_valmentaja', 'koutsi_pelaaja')
  ) opens on true
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

drop function if exists public.krossi_admin_users();

create function public.krossi_admin_users()
returns table (
  user_id uuid,
  display_name text,
  email text,
  joined_at timestamptz,
  last_sign_in_at timestamptz,
  app_open_count integer,
  last_app_open_at timestamptz,
  is_admin boolean,
  area text,
  hidden_from_feed boolean,
  paid_at timestamptz,
  challenges_created integer,
  matches_recorded integer,
  admin_cities text[]
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
    u.last_sign_in_at,
    coalesce(opens.open_count, 0)::integer,
    opens.last_opened_at,
    exists (select 1 from public.koutsi_admins a where a.user_id = u.id),
    p.area,
    coalesce(p.hidden_from_feed, false),
    p.paid_at,
    (select count(*)::integer from public.challenges c where c.creator_id = u.id),
    (select count(*)::integer from public.match_results m where m.created_by = u.id),
    coalesce((select array_agg(ca.city order by ca.city) from public.krossi_city_admins ca where ca.user_id = u.id), '{}'::text[])
  from auth.users u
  join public.profiles p on p.id = u.id
  left join lateral (
    select sum(o.open_count)::integer as open_count, max(o.last_opened_at) as last_opened_at
      from public.koutsi_app_opens o
     where o.user_id = u.id
       and o.app = 'krossi_web'
  ) opens on true
  order by u.created_at desc;
end;
$function$;

revoke all on function public.krossi_admin_users() from public, anon;
grant execute on function public.krossi_admin_users() to authenticated, service_role;
