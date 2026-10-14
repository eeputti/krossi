-- Lets the Koutsi admin be a player in their own groups, so one account can switch between the
-- coach view (/valmentaja) and the player view (/pelaaja) and see what a player sees.
--
-- redeem_koutsi_invite_code() refuses a coach's own code ('own coach code') and
-- koutsi_coach_students has no insert policy, so this is the only way in. Admins only
-- (koutsi_admins), and only into groups the admin coaches. Joining again is harmless: an
-- ended link or membership is reopened. Leaving works like for any player (the coach view's
-- "Päätä valmennus" / remove from group).
--
-- Additive only: one function. No table changes; the old Koutsi never calls it.

create function public.koutsi_admin_join_own_groups(group_ids_input uuid[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid    uuid := auth.uid();
  v_ids    uuid[] := coalesce(group_ids_input, '{}');
  v_groups integer := 0;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if not public.koutsi_is_admin() then
    raise exception 'not allowed';
  end if;
  if not exists (select 1 from public.koutsi_coaches where id = v_uid) then
    raise exception 'not a coach';
  end if;
  if exists (
    select 1 from unnest(v_ids) as gid
    where not exists (select 1 from public.koutsi_groups g where g.id = gid and g.coach_id = v_uid)
  ) then
    raise exception 'group not found';
  end if;

  -- Insert only when missing: the pilot-limit trigger runs before ON CONFLICT would.
  if not exists (select 1 from public.koutsi_students where id = v_uid) then
    insert into public.koutsi_students (id) values (v_uid);
  end if;

  insert into public.koutsi_coach_students (coach_id, student_id)
  values (v_uid, v_uid)
  on conflict (coach_id, student_id) do update set ended_at = null;

  insert into public.koutsi_group_members (group_id, student_id)
  select distinct gid, v_uid from unnest(v_ids) as gid
  on conflict (group_id, student_id) do update set ended_at = null;
  get diagnostics v_groups = row_count;

  return jsonb_build_object('groups', v_groups);
end;
$function$;

revoke all on function public.koutsi_admin_join_own_groups(uuid[]) from public, anon;
grant execute on function public.koutsi_admin_join_own_groups(uuid[]) to authenticated;
