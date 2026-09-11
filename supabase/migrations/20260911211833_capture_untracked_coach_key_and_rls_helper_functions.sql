-- Several more functions central to coach provisioning and to the group/roster RLS
-- policies exist only as live state in this project, same gap as
-- 20260911174157_capture_untracked_invite_functions.sql already fixed for the invite-code
-- ones: koutsi_is_linked_coach/koutsi_is_my_coach/koutsi_is_group_member gate who can see a
-- student, coach, or group row at all (pg_policies on koutsi_students/koutsi_groups/
-- koutsi_group_members reference them directly), and redeem_koutsi_coach_key/
-- create_koutsi_coach_invite_code/koutsi_seed_exercises gate the closed-pilot coach signup
-- path. None were captured anywhere, so none were reviewable from git and none could be
-- restored from migration history alone.
--
-- Pure "create or replace" pulled verbatim via pg_get_functiondef against the live
-- project, no behavior change. Existing grants are untouched by CREATE OR REPLACE and are
-- deliberately not restated here.

create or replace function public.koutsi_is_group_member(p_group_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from koutsi_group_members
    where group_id = p_group_id
      and student_id = auth.uid()
      and ended_at is null
  );
$function$;

create or replace function public.koutsi_is_linked_coach(p_student_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.koutsi_is_admin() or exists (
    select 1 from koutsi_coach_students
    where student_id = p_student_id
      and coach_id = auth.uid()
      and ended_at is null
  );
$function$;

create or replace function public.koutsi_is_my_coach(p_coach_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from koutsi_coach_students
    where coach_id = p_coach_id
      and student_id = auth.uid()
      and ended_at is null
  );
$function$;

create or replace function public.koutsi_seed_exercises(target_coach uuid DEFAULT NULL::uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := coalesce(target_coach, auth.uid());
  v_count integer;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  -- omaan pankkiin aina; toisen valmentajan pankkiin vain ylläpitäjä
  if target_coach is not null
     and target_coach <> coalesce(auth.uid(), target_coach)
     and not koutsi_is_admin() then
    raise exception 'not allowed';
  end if;
  if not exists (select 1 from koutsi_coaches where id = v_uid) then
    raise exception 'not a coach';
  end if;

  insert into koutsi_exercises (coach_id, name, goal, players_label, player_count, duration, level, tags)
  select v_uid, t.name, t.goal, t.players_label, t.player_count, t.duration, t.level, t.tags
  from koutsi_exercise_templates t
  where not exists (
    select 1 from koutsi_exercises e where e.coach_id = v_uid and e.name = t.name
  )
  order by t.sort_order;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

create or replace function public.redeem_koutsi_coach_key(key_input text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_code koutsi_coach_invite_codes%rowtype;
  v_seeded integer := 0;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  if not exists (select 1 from profiles where id = v_uid) then
    raise exception 'Luo ensin profiilisi ennen valmentaja-avaimen käyttöä';
  end if;

  if key_input is null or btrim(key_input) = '' then
    raise exception 'invalid coach key';
  end if;

  if exists (select 1 from koutsi_coaches where id = v_uid) then
    return jsonb_build_object('ok', true, 'already_coach', true, 'seeded_exercises', 0);
  end if;

  select * into v_code
  from koutsi_coach_invite_codes
  where code = upper(btrim(key_input))
  for update;

  if not found then
    raise exception 'invalid coach key';
  end if;
  if v_code.revoked_at is not null then
    raise exception 'coach key has been revoked';
  end if;
  if v_code.expires_at is not null and v_code.expires_at < now() then
    raise exception 'coach key has expired';
  end if;
  if v_code.use_count >= v_code.max_uses then
    raise exception 'coach key has already been used';
  end if;

  insert into koutsi_coaches (id) values (v_uid) on conflict (id) do nothing;

  update koutsi_coach_invite_codes
  set use_count   = use_count + 1,
      redeemed_by = v_uid,
      redeemed_at = now()
  where code = v_code.code;

  v_seeded := koutsi_seed_exercises(v_uid);

  return jsonb_build_object('ok', true, 'already_coach', false, 'seeded_exercises', v_seeded);
end;
$function$;

create or replace function public.create_koutsi_coach_invite_code(note_input text DEFAULT NULL::text, max_uses_input integer DEFAULT 1, valid_days_input integer DEFAULT 30)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- ei I/O/0/1
  v_code  text;
  i       integer;
begin
  loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    end loop;
    exit when not exists (select 1 from koutsi_coach_invite_codes where code = v_code);
  end loop;

  insert into koutsi_coach_invite_codes (code, note, max_uses, expires_at)
  values (
    v_code,
    note_input,
    greatest(coalesce(max_uses_input, 1), 1),
    case when valid_days_input is null then null else now() + (valid_days_input || ' days')::interval end
  );

  return v_code;
end;
$function$;
