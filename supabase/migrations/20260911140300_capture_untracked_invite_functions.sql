-- Several functions central to the join-code / invite flow exist only as live state in
-- this project — this repo's tracked migration history starts at
-- 20260823131111_finish_admin_acting_and_player_roster.sql, but these predate that (some
-- migrations already here say so explicitly, e.g. 20260910070000 and 20260911070000, which
-- deliberately avoided touching koutsi_create_player_v2/koutsi_bulk_setup_v2/
-- koutsi_coach_for_code precisely because their bodies weren't captured anywhere and so
-- couldn't be safely replaced from a diff). That leaves this part of the codebase outside
-- code review and unrecoverable from git alone.
--
-- This migration captures each one's exact current body as of 2026-09-11, verbatim (pulled
-- via pg_get_functiondef against the live project) — a pure "create or replace" with no
-- behavior change, purely so the actual, currently-running definition is finally in version
-- control. Existing grants on these functions are untouched by CREATE OR REPLACE and are
-- deliberately not restated here.

create or replace function public.koutsi_generate_join_code()
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code  text;
  i       integer;
  v_try   integer := 0;
begin
  loop
    v_try := v_try + 1;
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    end loop;
    exit when not exists (select 1 from koutsi_coach_join_codes where code = v_code)
          and not exists (select 1 from koutsi_group_invite_codes where code = v_code);
    if v_try > 200 then
      raise exception 'could not allocate a unique join code';
    end if;
  end loop;
  return v_code;
end;
$function$;

create or replace function public.koutsi_assign_join_code()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into koutsi_coach_join_codes (coach_id, code)
  values (new.id, public.koutsi_generate_join_code())
  on conflict (coach_id) do nothing;
  return new;
end;
$function$;

create or replace function public.koutsi_coach_for_code(code_input text)
 returns uuid
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_norm text := upper(btrim(coalesce(code_input, '')));
  v_coach uuid;
begin
  if v_norm = '' then return null; end if;
  select coach_id into v_coach from koutsi_coach_join_codes where code = v_norm;
  if v_coach is null then
    select coach_id into v_coach from koutsi_group_invite_codes
    where code = v_norm and revoked_at is null
      and (expires_at is null or expires_at > now())
      and (max_uses is null or use_count < max_uses);
  end if;
  return v_coach;
end;
$function$;

create or replace function public.koutsi_unclaimed_players(code_input text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_coach uuid;
  v_rows  jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  v_coach := public.koutsi_coach_for_code(code_input);
  if v_coach is null then raise exception 'invalid invite code'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.display_name) order by s.display_name), '[]'::jsonb)
  into v_rows
  from koutsi_students s
  where s.placeholder_coach_id = v_coach;

  return v_rows;
end;
$function$;

create or replace function public.create_koutsi_invite_code(group_id_input uuid DEFAULT NULL::uuid, expires_days integer DEFAULT 14, max_uses_input integer DEFAULT 1, coach_id_input uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_coach uuid := coalesce(coach_id_input, auth.uid());
  v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- no I/O/0/1: read aloud over the phone
  v_code  text;
  v_days  integer := least(greatest(coalesce(expires_days, 14), 1), 180);
  v_uses  integer := least(greatest(coalesce(max_uses_input, 1), 1), 100);
  v_try   integer := 0;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if v_coach <> v_uid and not koutsi_is_admin() then
    raise exception 'not allowed';
  end if;
  if not exists (select 1 from koutsi_coaches where id = v_coach) then
    raise exception 'not a coach';
  end if;
  if group_id_input is not null
     and not exists (select 1 from koutsi_groups where id = group_id_input and coach_id = v_coach) then
    raise exception 'group not found';
  end if;

  loop
    v_try := v_try + 1;
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
    end loop;
    exit when not exists (select 1 from koutsi_group_invite_codes where code = v_code);
    if v_try > 50 then
      raise exception 'could not allocate invite code';
    end if;
  end loop;

  insert into koutsi_group_invite_codes (code, coach_id, group_id, expires_at, max_uses)
  values (v_code, v_coach, group_id_input, now() + make_interval(days => v_days), v_uses);

  return jsonb_build_object('code', v_code, 'expires_at', now() + make_interval(days => v_days), 'max_uses', v_uses);
end;
$function$;

create or replace function public.koutsi_admin_bulk_invite_codes(coach_id_input uuid, names text[], group_id_input uuid DEFAULT NULL::uuid, expires_days integer DEFAULT 30)
 returns table(label text, code text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_name  text;
  v_code  text;
  v_try   integer;
  v_days  integer := least(greatest(coalesce(expires_days, 30), 1), 365);
begin
  if not koutsi_is_admin() then
    raise exception 'not allowed';
  end if;
  if not exists (select 1 from koutsi_coaches where id = coach_id_input) then
    raise exception 'Valmentajaa ei löytynyt';
  end if;
  if group_id_input is not null
     and not exists (select 1 from koutsi_groups where id = group_id_input and coach_id = coach_id_input) then
    raise exception 'Ryhmä ei kuulu tälle valmentajalle';
  end if;
  if array_length(names, 1) is null or array_length(names, 1) > 200 then
    raise exception 'Anna 1-200 nimeä';
  end if;

  foreach v_name in array names loop
    v_name := btrim(v_name);
    continue when v_name = '';
    v_try := 0;
    loop
      v_try := v_try + 1;
      v_code := '';
      for i in 1..6 loop
        v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
      end loop;
      exit when not exists (select 1 from koutsi_group_invite_codes where code = v_code);
      if v_try > 50 then
        raise exception 'could not allocate invite code';
      end if;
    end loop;

    insert into koutsi_group_invite_codes (code, coach_id, group_id, label, expires_at, max_uses)
    values (v_code, coach_id_input, group_id_input, v_name, now() + make_interval(days => v_days), 1);

    label := v_name;
    code := v_code;
    return next;
  end loop;
end;
$function$;

create or replace function public.koutsi_create_player_v2(name_input text, age_input integer DEFAULT NULL::integer, level_input text DEFAULT NULL::text, coach_id_input uuid DEFAULT NULL::uuid, age_group_input text DEFAULT NULL::text, minor_notice_confirmed_input boolean DEFAULT false, guardian_approved_input boolean DEFAULT false)
 returns uuid
 language sql
 set search_path to ''
as $function$
  select public.koutsi_create_player(name_input, age_input, level_input, coach_id_input);
$function$;

create or replace function public.koutsi_bulk_setup_v2(payload jsonb, coach_id_input uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_players jsonb;
  v_safe_players jsonb := '[]'::jsonb;
  v_player jsonb;
  v_result jsonb;
  v_age integer;
  v_student_id uuid;
  v_index integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Virheellinen tuonti';
  end if;
  v_players := coalesce(payload -> 'players', '[]'::jsonb);
  if jsonb_typeof(v_players) <> 'array' then
    raise exception 'Virheellinen tuonti';
  end if;

  for v_index in 0 .. jsonb_array_length(v_players) - 1 loop
    v_player := v_players -> v_index;
    if jsonb_typeof(v_player) <> 'object' then
      raise exception 'Virheellinen pelaajarivi';
    end if;
    begin
      v_age := nullif(v_player ->> 'age', '')::integer;
    exception when invalid_text_representation then
      raise exception 'Pelaajan ikä ei ole numero';
    end;
    if v_age is not null and (v_age < 1 or v_age > 119) then
      raise exception 'Pelaajan iän pitää olla väliltä 1–119 vuotta';
    end if;
    v_safe_players := v_safe_players || jsonb_build_array(
      jsonb_set(v_player - 'age_group' - 'minor_notice_confirmed' - 'guardian_approved', '{age}', 'null'::jsonb, true)
    );
  end loop;

  v_result := public.koutsi_bulk_setup(
    jsonb_set(payload, '{players}', v_safe_players, true),
    coach_id_input
  );

  for v_index in 0 .. jsonb_array_length(v_players) - 1 loop
    v_player := v_players -> v_index;
    v_age := nullif(v_player ->> 'age', '')::integer;
    v_student_id := (v_result -> 'players' -> v_index ->> 'id')::uuid;
    update public.koutsi_students set age = v_age where id = v_student_id;
  end loop;
  return v_result;
end;
$function$;

create or replace function public.redeem_koutsi_invite_code(code_input text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid        uuid := auth.uid();
  v_norm       text := upper(btrim(coalesce(code_input, '')));
  v_coach_id   uuid;
  v_group_id   uuid;
  v_code       koutsi_group_invite_codes%rowtype;
  v_is_legacy  boolean := false;
  v_group_name text;
  v_coach_name text;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if v_norm = '' then
    raise exception 'invalid invite code';
  end if;
  if not exists (select 1 from profiles where id = v_uid) then
    raise exception 'profile required';
  end if;

  -- 1) valmentajan pysyvä koodi
  select coach_id into v_coach_id
  from koutsi_coach_join_codes
  where code = v_norm;

  -- 2) muuten vanha ryhmäkoodi (rivilukko max_uses-kilpa-ajon varalta)
  if v_coach_id is null then
    select * into v_code from koutsi_group_invite_codes where code = v_norm for update;
    if not found then
      raise exception 'invalid invite code';
    end if;
    if v_code.revoked_at is not null then
      raise exception 'invite code has been revoked';
    end if;
    if v_code.expires_at is not null and v_code.expires_at < now() then
      raise exception 'invite code has expired';
    end if;
    if v_code.max_uses is not null and v_code.use_count >= v_code.max_uses then
      raise exception 'invite code has reached its use limit';
    end if;
    v_coach_id  := v_code.coach_id;
    v_group_id  := v_code.group_id;
    v_is_legacy := true;
  end if;

  -- Tämä oli se kaatuva tapaus: valmentaja syötti oman koodinsa.
  if v_coach_id = v_uid then
    raise exception 'own coach code';
  end if;

  -- Jo liitetty tähän valmentajaan -> onnistuu hiljaisesti, ei kuluta koodia.
  if exists (
    select 1 from koutsi_coach_students
    where coach_id = v_coach_id and student_id = v_uid and ended_at is null
  ) then
    select name into v_coach_name from profiles where id = v_coach_id;
    if v_group_id is not null then
      insert into koutsi_group_members (group_id, student_id) values (v_group_id, v_uid)
      on conflict (group_id, student_id) do update set ended_at = null;
      select name into v_group_name from koutsi_groups where id = v_group_id;
    end if;
    return jsonb_build_object(
      'coach_id', v_coach_id, 'coach_name', v_coach_name,
      'group_id', v_group_id, 'group_name', v_group_name, 'already_linked', true);
  end if;

  insert into koutsi_students (id) values (v_uid) on conflict do nothing;

  insert into koutsi_coach_students (coach_id, student_id, invite_code_used)
  values (v_coach_id, v_uid, v_norm)
  on conflict (coach_id, student_id)
  do update set ended_at = null, invite_code_used = excluded.invite_code_used;

  if v_group_id is not null then
    insert into koutsi_group_members (group_id, student_id) values (v_group_id, v_uid)
    on conflict (group_id, student_id) do update set ended_at = null;
    select name into v_group_name from koutsi_groups where id = v_group_id;
  end if;

  -- vain vanhat kertakoodit kuluvat; pysyvä valmentajakoodi ei koskaan
  if v_is_legacy then
    update koutsi_group_invite_codes set use_count = use_count + 1 where code = v_norm;
  end if;

  select name into v_coach_name from profiles where id = v_coach_id;

  return jsonb_build_object(
    'coach_id', v_coach_id, 'coach_name', v_coach_name,
    'group_id', v_group_id, 'group_name', v_group_name, 'already_linked', false);
end;
$function$;
