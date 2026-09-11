-- Bug found by an actual end-to-end test against production (not just a code read-through):
-- `min(s.id)` in koutsi_match_unclaimed_player's exact-name and first-name tiers fails
-- outright — postgres has no min()/max() aggregate registered for uuid — with
-- "function min(uuid) does not exist". This is a parse-time type-check failure, so it fired
-- on every single call that reached either tier (i.e. every shared coach/group code lookup
-- that wasn't a direct per-placeholder code), not just when a match existed. The
-- per-placeholder direct-code path never hit this (it returns before reaching either tier),
-- which is why the earlier demo-mode click-through didn't catch it — the demo mock doesn't
-- run this SQL at all.
--
-- Fix: stop aggregating id/display_name with min(); take the count and, only when it's
-- exactly 1, a separate plain `limit 1` select for the row itself.
create or replace function public.koutsi_match_unclaimed_player(code_input text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_coach uuid;
  v_group uuid;
  v_direct_student uuid;
  v_name  text;
  v_norm  text;
  v_first text;
  v_id    uuid;
  v_display_name text;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select coach_id, group_id, student_id into v_coach, v_group, v_direct_student
    from public.koutsi_resolve_join_code(code_input);

  if v_coach is null or v_coach = v_uid then
    return null;
  end if;

  if v_direct_student is not null then
    select s.display_name into v_display_name from public.koutsi_students s where s.id = v_direct_student;
    if v_display_name is null then
      return null;
    end if;
    return jsonb_build_object('id', v_direct_student, 'name', v_display_name, 'direct', true);
  end if;

  select p.name into v_name from public.profiles p where p.id = v_uid;
  v_norm := lower(btrim(regexp_replace(coalesce(v_name, ''), '\s+', ' ', 'g')));
  if v_norm = '' then
    return null;
  end if;
  v_first := split_part(v_norm, ' ', 1);

  select count(*) into v_count
    from public.koutsi_students s
   where s.placeholder_coach_id = v_coach
     and (v_group is null or exists (
       select 1 from public.koutsi_group_members gm
        where gm.group_id = v_group and gm.student_id = s.id and gm.ended_at is null
     ))
     and lower(btrim(regexp_replace(s.display_name, '\s+', ' ', 'g'))) = v_norm;

  if v_count = 1 then
    select s.id, s.display_name into v_id, v_display_name
      from public.koutsi_students s
     where s.placeholder_coach_id = v_coach
       and (v_group is null or exists (
         select 1 from public.koutsi_group_members gm
          where gm.group_id = v_group and gm.student_id = s.id and gm.ended_at is null
       ))
       and lower(btrim(regexp_replace(s.display_name, '\s+', ' ', 'g'))) = v_norm
     limit 1;
    return jsonb_build_object('id', v_id, 'name', v_display_name);
  end if;
  if v_count > 1 then
    return null;
  end if;

  select count(*) into v_count
    from public.koutsi_students s
   where s.placeholder_coach_id = v_coach
     and (v_group is null or exists (
       select 1 from public.koutsi_group_members gm
        where gm.group_id = v_group and gm.student_id = s.id and gm.ended_at is null
     ))
     and split_part(lower(btrim(regexp_replace(s.display_name, '\s+', ' ', 'g'))), ' ', 1) = v_first;

  if v_count <> 1 then
    return null;
  end if;

  select s.id, s.display_name into v_id, v_display_name
    from public.koutsi_students s
   where s.placeholder_coach_id = v_coach
     and (v_group is null or exists (
       select 1 from public.koutsi_group_members gm
        where gm.group_id = v_group and gm.student_id = s.id and gm.ended_at is null
     ))
     and split_part(lower(btrim(regexp_replace(s.display_name, '\s+', ' ', 'g'))), ' ', 1) = v_first
   limit 1;

  return jsonb_build_object('id', v_id, 'name', v_display_name);
end;
$$;
