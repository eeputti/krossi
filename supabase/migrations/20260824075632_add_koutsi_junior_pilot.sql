-- Junior pilot: coaches may add players of any age, but activating a minor's
-- account requires an age-group-specific acknowledgement. We intentionally store
-- only a broad age group and confirmation timestamps -- no date of birth, guardian
-- identity/contact details, or identity-document data.

alter table public.koutsi_students
  add column pilot_age_group text not null default 'adult',
  add column minor_notice_confirmed_at timestamptz,
  add column minor_notice_confirmed_by uuid references auth.users(id) on delete set null,
  add column guardian_approval_confirmed_at timestamptz,
  add column guardian_approval_confirmed_by uuid references auth.users(id) on delete set null;

alter table public.koutsi_students
  add constraint koutsi_students_pilot_age_group_check
  check (pilot_age_group in ('adult', 'junior_13_17', 'child_under_13')),
  add constraint koutsi_students_minor_confirmation_check
  check (
    pilot_age_group = 'adult'
    or (minor_notice_confirmed_at is not null and minor_notice_confirmed_by is not null)
  ),
  add constraint koutsi_students_guardian_confirmation_check
  check (
    pilot_age_group <> 'child_under_13'
    or (guardian_approval_confirmed_at is not null and guardian_approval_confirmed_by is not null)
  );

comment on column public.koutsi_students.pilot_age_group is
  'Coarse pilot age group only; no date of birth or identity document is collected.';
comment on column public.koutsi_students.guardian_approval_confirmed_at is
  'Coach confirmation that guardian approval was obtained; guardian identity/contact details are not stored.';

-- Existing rows were created while the pilot was contractually limited to adults.
-- Preserve that state explicitly before the junior flow is opened.
update public.koutsi_students
   set pilot_age_group = 'adult';

-- Exact age remains optional. If supplied, it may now represent a junior and must
-- agree with the privacy-friendly age group selected by the coach.
alter table public.profiles drop constraint if exists profiles_age_range_check;
alter table public.profiles
  add constraint profiles_age_range_check check (
    age is null
    or age in ('alle20', '20-30', '30-40', '40-50', '50-60', '60+')
    or case
      when age ~ '^[0-9]{1,3}$' then age::integer between 1 and 119
      else false
    end
  );

create or replace function public.koutsi_enforce_pilot_student_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_profile_age text;
begin
  if nullif(btrim(coalesce(new.background, '')), '') is not null then
    if tg_op = 'INSERT' or new.background is distinct from old.background then
      raise exception 'Terveys- ja taustatietoja ei voi tallentaa Koutsi-pilotissa';
    end if;
  end if;

  new.background := null;

  if new.placeholder_coach_id is null then
    select p.age
      into v_profile_age
      from public.profiles p
     where p.id = new.id;

    if found then
      if v_profile_age ~ '^[0-9]{1,3}$' then
        new.age := v_profile_age::integer;
      else
        new.age := null;
      end if;
    end if;
  end if;

  if new.age is not null and (new.age < 1 or new.age > 119) then
    if tg_op = 'INSERT' or new.age is distinct from old.age then
      raise exception 'Pelaajan iän pitää olla väliltä 1–119 vuotta';
    end if;
  end if;

  if new.age is not null and not (
    (new.pilot_age_group = 'adult' and new.age >= 18)
    or (new.pilot_age_group = 'junior_13_17' and new.age between 13 and 17)
    or (new.pilot_age_group = 'child_under_13' and new.age between 1 and 12)
  ) then
    raise exception 'Pelaajan ikä ja valittu ikäryhmä eivät vastaa toisiaan';
  end if;

  return new;
end;
$$;

-- A player must not be able to rewrite the coach/guardian confirmations on their
-- own row. Coaches retain their existing ability to update coach-owned fields.
create or replace function public.koutsi_enforce_student_column_ownership()
returns trigger
language plpgsql
set search_path = 'public'
as $$
begin
  if coalesce(current_setting('app.koutsi_claiming', true), '') = 'on' then
    return new;
  end if;
  if auth.uid() = old.id then
    new.background := old.background;
    new.last_session_note := old.last_session_note;
    new.focus := old.focus;
    new.level := old.level;
    new.age := old.age;
    new.pilot_age_group := old.pilot_age_group;
    new.minor_notice_confirmed_at := old.minor_notice_confirmed_at;
    new.minor_notice_confirmed_by := old.minor_notice_confirmed_by;
    new.guardian_approval_confirmed_at := old.guardian_approval_confirmed_at;
    new.guardian_approval_confirmed_by := old.guardian_approval_confirmed_by;
  else
    new.goal := old.goal;
    new.player_note := old.player_note;
    new.player_wish := old.player_wish;
  end if;
  return new;
end;
$$;

-- Versioned create RPC for the web client. The legacy RPC remains adult-only via
-- the default age group and the consistency trigger above.
create or replace function public.koutsi_create_player_v2(
  name_input text,
  age_input integer default null,
  level_input text default null,
  coach_id_input uuid default null,
  age_group_input text default 'adult',
  minor_notice_confirmed_input boolean default false,
  guardian_approved_input boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_coach uuid := coalesce(coach_id_input, auth.uid());
  v_id uuid;
  v_age_group text := coalesce(nullif(age_group_input, ''), 'adult');
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
  if v_age_group not in ('adult', 'junior_13_17', 'child_under_13') then
    raise exception 'Valitse pelaajan ikäryhmä';
  end if;
  if v_age_group <> 'adult' and not coalesce(minor_notice_confirmed_input, false) then
    raise exception 'Vahvista, että alaikäinen tietää Koutsin käytöstä';
  end if;
  if v_age_group = 'child_under_13' and not coalesce(guardian_approved_input, false) then
    raise exception 'Alle 13-vuotiaan lisääminen vaatii huoltajan hyväksynnän';
  end if;

  v_id := gen_random_uuid();
  insert into public.koutsi_students (
    id, display_name, placeholder_coach_id, age, level, pilot_age_group,
    minor_notice_confirmed_at, minor_notice_confirmed_by,
    guardian_approval_confirmed_at, guardian_approval_confirmed_by
  ) values (
    v_id, btrim(name_input), v_coach, age_input, level_input, v_age_group,
    case when v_age_group <> 'adult' then now() end,
    case when v_age_group <> 'adult' then v_uid end,
    case when v_age_group = 'child_under_13' then now() end,
    case when v_age_group = 'child_under_13' then v_uid end
  );

  insert into public.koutsi_coach_students (coach_id, student_id)
  values (v_coach, v_id);
  return v_id;
end;
$$;

revoke all on function public.koutsi_create_player_v2(text, integer, text, uuid, text, boolean, boolean) from public, anon;
grant execute on function public.koutsi_create_player_v2(text, integer, text, uuid, text, boolean, boolean) to authenticated, service_role;

-- Keep the existing guided import atomic by calling the proven bulk function with
-- temporary adult/null-age rows, then applying reviewed junior fields in the same
-- database transaction.
create or replace function public.koutsi_bulk_setup_v2(
  payload jsonb,
  coach_id_input uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_players jsonb;
  v_safe_players jsonb := '[]'::jsonb;
  v_player jsonb;
  v_result jsonb;
  v_age integer;
  v_age_group text;
  v_minor_confirmed boolean;
  v_guardian_approved boolean;
  v_student_id uuid;
  v_index integer;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
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
      v_minor_confirmed := coalesce((v_player ->> 'minor_notice_confirmed')::boolean, false);
      v_guardian_approved := coalesce((v_player ->> 'guardian_approved')::boolean, false);
    exception when invalid_text_representation then
      raise exception 'Pelaajan ikä tai vahvistus on virheellinen';
    end;
    v_age_group := coalesce(nullif(v_player ->> 'age_group', ''), '');
    if v_age_group not in ('adult', 'junior_13_17', 'child_under_13') then
      raise exception 'Valitse jokaiselle pelaajalle ikäryhmä';
    end if;
    if v_age_group <> 'adult' and not v_minor_confirmed then
      raise exception 'Vahvista, että jokainen alaikäinen tietää Koutsin käytöstä';
    end if;
    if v_age_group = 'child_under_13' and not v_guardian_approved then
      raise exception 'Alle 13-vuotiaan lisääminen vaatii huoltajan hyväksynnän';
    end if;
    if v_age is not null and not (
      (v_age_group = 'adult' and v_age between 18 and 119)
      or (v_age_group = 'junior_13_17' and v_age between 13 and 17)
      or (v_age_group = 'child_under_13' and v_age between 1 and 12)
    ) then
      raise exception 'Pelaajan ikä ja valittu ikäryhmä eivät vastaa toisiaan';
    end if;

    v_safe_players := v_safe_players || jsonb_build_array(
      jsonb_set(v_player, '{age}', 'null'::jsonb, true)
    );
  end loop;

  v_result := public.koutsi_bulk_setup(
    jsonb_set(payload, '{players}', v_safe_players, true),
    coach_id_input
  );

  for v_index in 0 .. jsonb_array_length(v_players) - 1 loop
    v_player := v_players -> v_index;
    v_age := nullif(v_player ->> 'age', '')::integer;
    v_age_group := v_player ->> 'age_group';
    v_student_id := (v_result -> 'players' -> v_index ->> 'id')::uuid;

    update public.koutsi_students
       set age = v_age,
           pilot_age_group = v_age_group,
           minor_notice_confirmed_at = case when v_age_group <> 'adult' then now() end,
           minor_notice_confirmed_by = case when v_age_group <> 'adult' then v_uid end,
           guardian_approval_confirmed_at = case when v_age_group = 'child_under_13' then now() end,
           guardian_approval_confirmed_by = case when v_age_group = 'child_under_13' then v_uid end
     where id = v_student_id;
  end loop;

  return v_result;
end;
$$;

revoke all on function public.koutsi_bulk_setup_v2(jsonb, uuid) from public, anon;
grant execute on function public.koutsi_bulk_setup_v2(jsonb, uuid) to authenticated, service_role;

-- Claiming a personal placeholder carries the coach/guardian confirmations to the
-- player's account row. The random placeholder UUID in the personal link replaces
-- the old roster-enumeration screen.
create or replace function public.koutsi_claim_player(code_input text, student_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_coach uuid;
  v_ph koutsi_students%rowtype;
  v_coach_name text;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not exists (select 1 from profiles where id = v_uid) then
    raise exception 'profile required';
  end if;

  v_coach := public.koutsi_coach_for_code(code_input);
  if v_coach is null then raise exception 'invalid invite code'; end if;
  if v_coach = v_uid then raise exception 'own coach code'; end if;

  select * into v_ph from koutsi_students where id = student_id_input for update;
  if not found or v_ph.placeholder_coach_id is null or v_ph.placeholder_coach_id <> v_coach then
    raise exception 'Tätä profiilia ei voi lunastaa';
  end if;

  perform set_config('app.koutsi_claiming', 'on', true);

  insert into koutsi_students (
    id, age, pilot_age_group,
    minor_notice_confirmed_at, minor_notice_confirmed_by,
    guardian_approval_confirmed_at, guardian_approval_confirmed_by
  ) values (
    v_uid, v_ph.age, v_ph.pilot_age_group,
    v_ph.minor_notice_confirmed_at, v_ph.minor_notice_confirmed_by,
    v_ph.guardian_approval_confirmed_at, v_ph.guardian_approval_confirmed_by
  ) on conflict (id) do nothing;
  update koutsi_students t set
    age = coalesce(t.age, v_ph.age),
    level = coalesce(t.level, v_ph.level),
    goal = coalesce(t.goal, v_ph.goal),
    focus = coalesce(t.focus, v_ph.focus),
    background = coalesce(t.background, v_ph.background),
    last_session_note = coalesce(t.last_session_note, v_ph.last_session_note),
    player_note = coalesce(t.player_note, v_ph.player_note),
    player_wish = coalesce(t.player_wish, v_ph.player_wish),
    pilot_age_group = v_ph.pilot_age_group,
    minor_notice_confirmed_at = v_ph.minor_notice_confirmed_at,
    minor_notice_confirmed_by = v_ph.minor_notice_confirmed_by,
    guardian_approval_confirmed_at = v_ph.guardian_approval_confirmed_at,
    guardian_approval_confirmed_by = v_ph.guardian_approval_confirmed_by
  where t.id = v_uid;

  update koutsi_diary_entries set student_id = v_uid where student_id = v_ph.id;
  update koutsi_homework set student_id = v_uid where student_id = v_ph.id;
  update koutsi_videos set student_id = v_uid where student_id = v_ph.id;
  update koutsi_moods set student_id = v_uid where student_id = v_ph.id;
  update koutsi_match_notes set student_id = v_uid where student_id = v_ph.id;
  update koutsi_player_history set student_id = v_uid where student_id = v_ph.id;
  update koutsi_trainings set student_id = v_uid where student_id = v_ph.id;

  delete from koutsi_coach_students a
   where a.student_id = v_ph.id
     and exists (select 1 from koutsi_coach_students b
                 where b.coach_id = a.coach_id and b.student_id = v_uid);
  update koutsi_coach_students set student_id = v_uid, ended_at = null where student_id = v_ph.id;

  delete from koutsi_group_members a
   where a.student_id = v_ph.id
     and exists (select 1 from koutsi_group_members b
                 where b.group_id = a.group_id and b.student_id = v_uid);
  update koutsi_group_members set student_id = v_uid, ended_at = null where student_id = v_ph.id;

  delete from koutsi_training_absences a
   where a.student_id = v_ph.id
     and exists (select 1 from koutsi_training_absences b
                 where b.training_id = a.training_id and b.student_id = v_uid);
  update koutsi_training_absences set student_id = v_uid where student_id = v_ph.id;

  insert into koutsi_coach_students (coach_id, student_id)
  values (v_coach, v_uid)
  on conflict (coach_id, student_id) do update set ended_at = null;

  delete from koutsi_students where id = v_ph.id;
  select name into v_coach_name from profiles where id = v_coach;
  return jsonb_build_object('coach_id', v_coach, 'coach_name', v_coach_name, 'claimed', true);
end;
$$;

revoke all on function public.koutsi_claim_player(text, uuid) from public, anon;
grant execute on function public.koutsi_claim_player(text, uuid) to authenticated, service_role;

-- Do not reveal a coach's unclaimed roster to everyone who knows the shared code.
revoke all on function public.koutsi_unclaimed_players(text) from public, anon, authenticated;

-- Age-specific acknowledgement. The database, not browser metadata, verifies that
-- a junior account came through a coach-confirmed placeholder and that an under-13
-- account also has the guardian confirmation.
alter table public.koutsi_pilot_acknowledgements
  alter column adult_confirmed_at drop not null,
  add column age_group text not null default 'adult',
  add column junior_privacy_confirmed_at timestamptz,
  add column guardian_approval_verified_at timestamptz;

alter table public.koutsi_pilot_acknowledgements
  add constraint koutsi_pilot_ack_age_group_check
  check (age_group in ('adult', 'junior_13_17', 'child_under_13'));

create or replace function public.koutsi_validate_pilot_acknowledgement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_student public.koutsi_students%rowtype;
begin
  if auth.uid() is null or auth.uid() <> new.user_id then
    raise exception 'authentication required';
  end if;
  if new.restricted_data_rules_confirmed_at is null then
    raise exception 'Vahvista, ettei Koutsiin tallenneta terveystietoja';
  end if;

  select * into v_student
    from public.koutsi_students s
   where s.id = new.user_id;

  if new.age_group = 'adult' then
    if new.adult_confirmed_at is null then
      raise exception 'Vahvista olevasi vähintään 18-vuotias';
    end if;
    if found and v_student.pilot_age_group <> 'adult' then
      raise exception 'Valitse valmentajan vahvistama ikäryhmä';
    end if;
    new.junior_privacy_confirmed_at := null;
    new.guardian_approval_verified_at := null;
  else
    if not found then
      raise exception 'Liity ensin valmentajan sinulle lähettämällä henkilökohtaisella linkillä';
    end if;
    if v_student.pilot_age_group <> new.age_group then
      raise exception 'Valitse valmentajan vahvistama ikäryhmä';
    end if;
    if v_student.minor_notice_confirmed_at is null then
      raise exception 'Valmentajan pitää vahvistaa, että alaikäinen tietää Koutsin käytöstä';
    end if;
    if new.junior_privacy_confirmed_at is null then
      raise exception 'Tutustu juniorin tietosuojaan ennen jatkamista';
    end if;
    new.adult_confirmed_at := null;

    if new.age_group = 'child_under_13' then
      if v_student.guardian_approval_confirmed_at is null then
        raise exception 'Alle 13-vuotiaan tilin aktivointi vaatii huoltajan hyväksynnän';
      end if;
      new.guardian_approval_verified_at := v_student.guardian_approval_confirmed_at;
    else
      new.guardian_approval_verified_at := null;
    end if;
  end if;

  if v_student.id is not null then
    update public.profiles
       set is_discoverable = false
     where id = new.user_id;
  end if;

  return new;
end;
$$;

drop trigger if exists koutsi_pilot_ack_validate on public.koutsi_pilot_acknowledgements;
create trigger koutsi_pilot_ack_validate
before insert or update on public.koutsi_pilot_acknowledgements
for each row execute function public.koutsi_validate_pilot_acknowledgement();

-- Koutsi-created player profiles are private by default. Existing main-Krossi
-- profiles remain discoverable, so this does not silently change current users.
alter table public.profiles
  add column is_discoverable boolean not null default true;

create or replace function public.koutsi_is_linked_student(coach_id_input uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.koutsi_coach_students cs
     where cs.coach_id = coach_id_input
       and cs.student_id = auth.uid()
       and cs.ended_at is null
  );
$$;

revoke all on function public.koutsi_is_linked_student(uuid) from public, anon;
grant execute on function public.koutsi_is_linked_student(uuid) to authenticated, service_role;

drop policy if exists "profiles are readable by signed-in users" on public.profiles;
drop policy if exists profiles_visible_to_allowed_users on public.profiles;
create policy profiles_visible_to_allowed_users
on public.profiles for select to authenticated
using (
  (select auth.uid()) is not null
  and (
    id = (select auth.uid())
    or is_discoverable
    or public.koutsi_is_admin()
    or public.koutsi_is_linked_coach(id)
    or public.koutsi_is_linked_student(id)
  )
);

comment on column public.profiles.is_discoverable is
  'False for profiles created through the private Koutsi player onboarding; own user and linked coach can still read it.';
