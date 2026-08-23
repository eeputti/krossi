-- Finish the admin-as-coach flow without widening ordinary authenticated access.
-- Production migration version: 20260823131111.
-- This migration is data preserving: it only adds/replaces functions and RLS policies.

-- These two helpers are used by the existing Koutsi RLS policies. Keep them callable by
-- authenticated requests, but make the lookup independent of caller-controlled search_path.
create or replace function public.koutsi_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null
     and exists (
       select 1
         from public.koutsi_admins a
        where a.user_id = (select auth.uid())
     );
$function$;

create or replace function public.koutsi_acts_as(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select target is not null
     and (target = (select auth.uid()) or public.koutsi_is_admin());
$function$;

revoke all on function public.koutsi_is_admin() from public, anon;
revoke all on function public.koutsi_acts_as(uuid) from public, anon;
grant execute on function public.koutsi_is_admin() to authenticated, service_role;
grant execute on function public.koutsi_acts_as(uuid) to authenticated, service_role;

-- Restoring an acting target from sessionStorage must call this function again. Besides
-- validating the current JWT against koutsi_admins, it rejects archived/missing coaches
-- and records the successful view opening in koutsi_admin_actions.
create or replace function public.koutsi_admin_act_as(coach_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid  uuid := auth.uid();
  v_name text;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if not public.koutsi_is_admin() then
    raise exception 'not allowed';
  end if;

  select p.name
    into v_name
    from public.koutsi_coaches c
    left join public.profiles p on p.id = c.id
   where c.id = coach_id_input
     and c.archived_at is null;

  if not found then
    raise exception 'not a coach';
  end if;

  insert into public.koutsi_admin_actions (admin_id, coach_id, action)
  values (v_uid, coach_id_input, 'act_as');

  return jsonb_build_object('coach_id', coach_id_input, 'coach_name', v_name);
end;
$function$;

revoke all on function public.koutsi_admin_act_as(uuid) from public, anon;
grant execute on function public.koutsi_admin_act_as(uuid) to authenticated, service_role;

-- A player roster is deliberately not a wider SELECT policy on koutsi_students. This
-- SECURITY DEFINER RPC returns only the fields the group card needs and only for active
-- peers in groups where the caller also has an active membership and coaching link.
create or replace function public.koutsi_player_group_roster()
returns table (
  group_id uuid,
  student_id uuid,
  name text,
  avatar_url text,
  level text
)
language sql
stable
security definer
set search_path = ''
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

revoke all on function public.koutsi_player_group_roster() from public, anon;
grant execute on function public.koutsi_player_group_roster() to authenticated, service_role;

-- The existing Storage policies continue to cover a coach/player writing under their own
-- folder. These additive policies cover only a signed-in koutsi_admins member and only a
-- path whose first folder resolves to a live Koutsi coach or group. SELECT + UPDATE are
-- intentional: Supabase Storage requires both (plus INSERT) for safe upserts/replacements.
-- First remove the old whole-bucket admin branch and fix two legacy policies whose
-- subquery accidentally resolved `name` as koutsi_groups.name instead of objects.name.
drop policy if exists koutsi_plans_object_admin_select on storage.objects;

drop policy if exists koutsi_plans_object_select on storage.objects;
create policy koutsi_plans_object_select
on storage.objects for select
to authenticated
using (
  bucket_id = 'koutsi-plans'
  and exists (
    select 1
      from public.koutsi_groups g
     where g.id::text = (storage.foldername(objects.name))[1]
       and (g.coach_id = (select auth.uid()) or public.koutsi_is_group_member(g.id))
  )
);

drop policy if exists koutsi_plans_object_write on storage.objects;
create policy koutsi_plans_object_write
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'koutsi-plans'
  and exists (
    select 1
      from public.koutsi_groups g
     where g.id::text = (storage.foldername(objects.name))[1]
       and g.coach_id = (select auth.uid())
  )
);

drop policy if exists koutsi_admin_videos_storage_select on storage.objects;
create policy koutsi_admin_videos_storage_select
on storage.objects for select
to authenticated
using (
  bucket_id = 'koutsi-videos'
  and (select auth.uid()) is not null
  and public.koutsi_is_admin()
  and exists (
    select 1
      from public.koutsi_coaches c
     where c.id::text = (storage.foldername(objects.name))[1]
       and c.archived_at is null
  )
);

drop policy if exists koutsi_admin_videos_storage_insert on storage.objects;
create policy koutsi_admin_videos_storage_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'koutsi-videos'
  and (select auth.uid()) is not null
  and public.koutsi_is_admin()
  and exists (
    select 1
      from public.koutsi_coaches c
     where c.id::text = (storage.foldername(objects.name))[1]
       and c.archived_at is null
  )
);

drop policy if exists koutsi_admin_videos_storage_update on storage.objects;
create policy koutsi_admin_videos_storage_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'koutsi-videos'
  and (select auth.uid()) is not null
  and public.koutsi_is_admin()
  and exists (
    select 1
      from public.koutsi_coaches c
     where c.id::text = (storage.foldername(objects.name))[1]
       and c.archived_at is null
  )
)
with check (
  bucket_id = 'koutsi-videos'
  and (select auth.uid()) is not null
  and public.koutsi_is_admin()
  and exists (
    select 1
      from public.koutsi_coaches c
     where c.id::text = (storage.foldername(objects.name))[1]
       and c.archived_at is null
  )
);

drop policy if exists koutsi_admin_videos_storage_delete on storage.objects;
create policy koutsi_admin_videos_storage_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'koutsi-videos'
  and (select auth.uid()) is not null
  and public.koutsi_is_admin()
  and exists (
    select 1
      from public.koutsi_coaches c
     where c.id::text = (storage.foldername(objects.name))[1]
       and c.archived_at is null
  )
);

drop policy if exists koutsi_admin_plans_storage_select on storage.objects;
create policy koutsi_admin_plans_storage_select
on storage.objects for select
to authenticated
using (
  bucket_id = 'koutsi-plans'
  and (select auth.uid()) is not null
  and public.koutsi_is_admin()
  and exists (
    select 1
      from public.koutsi_groups g
      join public.koutsi_coaches c on c.id = g.coach_id and c.archived_at is null
     where g.id::text = (storage.foldername(objects.name))[1]
  )
);

drop policy if exists koutsi_admin_plans_storage_insert on storage.objects;
create policy koutsi_admin_plans_storage_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'koutsi-plans'
  and (select auth.uid()) is not null
  and public.koutsi_is_admin()
  and exists (
    select 1
      from public.koutsi_groups g
      join public.koutsi_coaches c on c.id = g.coach_id and c.archived_at is null
     where g.id::text = (storage.foldername(objects.name))[1]
  )
);

drop policy if exists koutsi_admin_plans_storage_update on storage.objects;
create policy koutsi_admin_plans_storage_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'koutsi-plans'
  and (select auth.uid()) is not null
  and public.koutsi_is_admin()
  and exists (
    select 1
      from public.koutsi_groups g
      join public.koutsi_coaches c on c.id = g.coach_id and c.archived_at is null
     where g.id::text = (storage.foldername(objects.name))[1]
  )
)
with check (
  bucket_id = 'koutsi-plans'
  and (select auth.uid()) is not null
  and public.koutsi_is_admin()
  and exists (
    select 1
      from public.koutsi_groups g
      join public.koutsi_coaches c on c.id = g.coach_id and c.archived_at is null
     where g.id::text = (storage.foldername(objects.name))[1]
  )
);

drop policy if exists koutsi_admin_plans_storage_delete on storage.objects;
create policy koutsi_admin_plans_storage_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'koutsi-plans'
  and (select auth.uid()) is not null
  and public.koutsi_is_admin()
  and exists (
    select 1
      from public.koutsi_groups g
      join public.koutsi_coaches c on c.id = g.coach_id and c.archived_at is null
     where g.id::text = (storage.foldername(objects.name))[1]
  )
);
