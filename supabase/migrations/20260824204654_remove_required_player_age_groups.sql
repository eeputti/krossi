-- Koutsi player age is optional and exact-only. A player may be created with
-- just a name, and neither the coach nor the player has to disclose an age.
-- Keep the former age-group columns nullable for rolling-client compatibility.
-- Historical pilot confirmations remain intact, while every new row stores no age group.

alter table public.koutsi_students
  alter column pilot_age_group drop not null,
  alter column pilot_age_group drop default;

alter table public.koutsi_pilot_acknowledgements
  alter column age_group drop not null,
  alter column age_group drop default;

drop trigger if exists koutsi_pilot_ack_validate on public.koutsi_pilot_acknowledgements;

comment on column public.koutsi_students.pilot_age_group is
  'Deprecated compatibility column. Koutsi no longer collects or derives player age groups; historical pilot values are retained.';
comment on column public.koutsi_pilot_acknowledgements.age_group is
  'Deprecated compatibility column. Koutsi no longer requires an age-group acknowledgement; historical pilot values are retained.';

-- Preserve the health-data lock and exact-age bounds without inferring an age
-- group. Old clients cannot restore removed age-group data through direct writes.
create or replace function public.koutsi_enforce_pilot_student_limits()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if nullif(btrim(coalesce(new.background, '')), '') is not null then
    if tg_op = 'INSERT' or new.background is distinct from old.background then
      raise exception 'Terveys- ja taustatietoja ei voi tallentaa Koutsi-pilotissa';
    end if;
  end if;

  new.background := null;

  if new.age is not null and (new.age < 1 or new.age > 119) then
    if tg_op = 'INSERT' or new.age is distinct from old.age then
      raise exception 'Pelaajan iän pitää olla väliltä 1–119 vuotta';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.pilot_age_group := null;
    new.minor_notice_confirmed_at := null;
    new.minor_notice_confirmed_by := null;
    new.guardian_approval_confirmed_at := null;
    new.guardian_approval_confirmed_by := null;
  else
    new.pilot_age_group := old.pilot_age_group;
    new.minor_notice_confirmed_at := old.minor_notice_confirmed_at;
    new.minor_notice_confirmed_by := old.minor_notice_confirmed_by;
    new.guardian_approval_confirmed_at := old.guardian_approval_confirmed_at;
    new.guardian_approval_confirmed_by := old.guardian_approval_confirmed_by;
  end if;
  return new;
end;
$function$;

revoke all on function public.koutsi_enforce_pilot_student_limits() from public, anon, authenticated;

-- Exact age belongs to the player, but the coach may also fill it for a roster row.
-- The remaining ownership split is unchanged.
create or replace function public.koutsi_enforce_student_column_ownership()
returns trigger
language plpgsql
security invoker
set search_path = 'public'
as $function$
begin
  if coalesce(current_setting('app.koutsi_claiming', true), '') = 'on' then
    return new;
  end if;
  if auth.uid() = old.id then
    new.background := old.background;
    new.last_session_note := old.last_session_note;
    new.focus := old.focus;
    new.level := old.level;
  else
    new.goal := old.goal;
    new.player_note := old.player_note;
    new.player_wish := old.player_wish;
  end if;
  new.pilot_age_group := old.pilot_age_group;
  new.minor_notice_confirmed_at := old.minor_notice_confirmed_at;
  new.minor_notice_confirmed_by := old.minor_notice_confirmed_by;
  new.guardian_approval_confirmed_at := old.guardian_approval_confirmed_at;
  new.guardian_approval_confirmed_by := old.guardian_approval_confirmed_by;
  return new;
end;
$function$;

revoke all on function public.koutsi_enforce_student_column_ownership() from public, anon, authenticated;

-- Single-player creation accepts a name and optional exact age. The v2 signature is
-- retained so an already-open browser tab keeps working, but age-group arguments are
-- deliberately ignored and never stored.
create or replace function public.koutsi_create_player(
  name_input text,
  age_input integer default null,
  level_input text default null,
  coach_id_input uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_coach uuid := coalesce(coach_id_input, auth.uid());
  v_id uuid;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if v_coach <> v_uid and not public.koutsi_is_admin() then
    raise exception 'not allowed';
  end if;
  if not exists (
    select 1 from public.koutsi_coaches c
     where c.id = v_coach and c.archived_at is null
  ) then
    raise exception 'not a coach';
  end if;
  if name_input is null or btrim(name_input) = '' then
    raise exception 'Anna pelaajalle nimi';
  end if;
  if age_input is not null and (age_input < 1 or age_input > 119) then
    raise exception 'Pelaajan iän pitää olla väliltä 1–119 vuotta';
  end if;

  v_id := gen_random_uuid();
  insert into public.koutsi_students (id, display_name, placeholder_coach_id, age, level)
  values (v_id, btrim(name_input), v_coach, age_input, level_input);
  insert into public.koutsi_coach_students (coach_id, student_id)
  values (v_coach, v_id);
  return v_id;
end;
$function$;

revoke all on function public.koutsi_create_player(text, integer, text, uuid) from public, anon;
grant execute on function public.koutsi_create_player(text, integer, text, uuid) to authenticated, service_role;

create or replace function public.koutsi_create_player_v2(
  name_input text,
  age_input integer default null,
  level_input text default null,
  coach_id_input uuid default null,
  age_group_input text default null,
  minor_notice_confirmed_input boolean default false,
  guardian_approved_input boolean default false
)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select public.koutsi_create_player(name_input, age_input, level_input, coach_id_input);
$function$;

revoke all on function public.koutsi_create_player_v2(text, integer, text, uuid, text, boolean, boolean) from public, anon;
grant execute on function public.koutsi_create_player_v2(text, integer, text, uuid, text, boolean, boolean) to authenticated, service_role;

-- The proven atomic bulk setup still creates groups, memberships and themes. Pass
-- null ages through it, then apply each optional exact age in the same transaction so
-- values up to 119 remain supported. Former age-group payload keys are ignored.
create or replace function public.koutsi_bulk_setup_v2(
  payload jsonb,
  coach_id_input uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
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

revoke all on function public.koutsi_bulk_setup_v2(jsonb, uuid) from public, anon;
grant execute on function public.koutsi_bulk_setup_v2(jsonb, uuid) to authenticated, service_role;

-- Pilot acceptance now records only the current terms/privacy versions and the
-- health-data rule. It does not ask for or infer age.
create or replace function public.koutsi_validate_pilot_acknowledgement()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if auth.uid() is null or auth.uid() <> new.user_id then
    raise exception 'authentication required';
  end if;
  if new.restricted_data_rules_confirmed_at is null then
    raise exception 'Vahvista, ettei Koutsiin tallenneta terveystietoja';
  end if;

  if tg_op = 'INSERT' then
    new.age_group := null;
    new.adult_confirmed_at := null;
    new.junior_privacy_confirmed_at := null;
    new.guardian_approval_verified_at := null;
  else
    new.age_group := old.age_group;
    new.adult_confirmed_at := old.adult_confirmed_at;
    new.junior_privacy_confirmed_at := old.junior_privacy_confirmed_at;
    new.guardian_approval_verified_at := old.guardian_approval_verified_at;
  end if;

  update public.profiles
     set is_discoverable = false
   where id = new.user_id
     and exists (select 1 from public.koutsi_students s where s.id = new.user_id);
  return new;
end;
$function$;

revoke all on function public.koutsi_validate_pilot_acknowledgement() from public, anon, authenticated;

create trigger koutsi_pilot_ack_validate
before insert or update on public.koutsi_pilot_acknowledgements
for each row execute function public.koutsi_validate_pilot_acknowledgement();
