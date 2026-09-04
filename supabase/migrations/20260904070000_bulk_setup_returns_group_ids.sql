-- koutsi_bulk_setup already builds v_group_ids (a client_id -> real group uuid map) to
-- link players and themes to the groups it just created, but never returned it. The bulk
-- setup wizard needs those ids client-side to attach extra weekly training times (via
-- koutsi_add_group_slot-equivalent client calls) to a newly created group right after
-- this RPC returns. Purely additive — every existing caller ignores the new field.
create or replace function public.koutsi_bulk_setup(
  payload jsonb,
  coach_id_input uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid              uuid := auth.uid();
  v_coach            uuid := coalesce(coach_id_input, auth.uid());
  v_groups           jsonb;
  v_players          jsonb;
  v_themes           jsonb;
  v_group             jsonb;
  v_player            jsonb;
  v_theme             jsonb;
  v_group_ref         text;
  v_group_id          uuid;
  v_student_id        uuid;
  v_existing_id       uuid;
  v_client_id         text;
  v_name              text;
  v_level             text;
  v_day               text;
  v_time              time;
  v_duration_minutes  integer;
  v_dow               integer;
  v_first_date        date;
  v_series_id         uuid;
  v_age               integer;
  v_year              integer;
  v_week              integer;
  v_title             text;
  v_lead              text;
  v_group_ids         jsonb := '{}'::jsonb;
  v_player_ids        jsonb := '[]'::jsonb;
  v_created_groups    integer := 0;
  v_reused_groups     integer := 0;
  v_created_players   integer := 0;
  v_saved_themes      integer := 0;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if v_coach <> v_uid and not public.koutsi_is_admin() then
    raise exception 'not allowed';
  end if;
  if not exists (
    select 1
      from public.koutsi_coaches c
     where c.id = v_coach
       and c.archived_at is null
  ) then
    raise exception 'not a coach';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Virheellinen tuonti';
  end if;

  v_groups := coalesce(payload -> 'groups', '[]'::jsonb);
  v_players := coalesce(payload -> 'players', '[]'::jsonb);
  v_themes := coalesce(payload -> 'themes', '[]'::jsonb);

  if jsonb_typeof(v_groups) <> 'array'
     or jsonb_typeof(v_players) <> 'array'
     or jsonb_typeof(v_themes) <> 'array' then
    raise exception 'Virheellinen tuonti';
  end if;
  if jsonb_array_length(v_groups) > 50 then
    raise exception 'Voit lisätä kerralla enintään 50 ryhmää';
  end if;
  if jsonb_array_length(v_players) > 200 then
    raise exception 'Voit lisätä kerralla enintään 200 pelaajaa';
  end if;
  if jsonb_array_length(v_themes) > 520 then
    raise exception 'Voit lisätä kerralla enintään 520 viikkoteemaa';
  end if;
  if jsonb_array_length(v_groups) = 0
     and jsonb_array_length(v_players) = 0
     and jsonb_array_length(v_themes) = 0 then
    raise exception 'Lisää vähintään yksi pelaaja, ryhmä tai viikkoteema';
  end if;

  -- Build a server-side map from the browser's temporary row keys to real group UUIDs.
  for v_group in select value from jsonb_array_elements(v_groups)
  loop
    if jsonb_typeof(v_group) <> 'object' then
      raise exception 'Virheellinen ryhmärivi';
    end if;
    v_client_id := btrim(coalesce(v_group ->> 'client_id', ''));
    if v_client_id = '' or length(v_client_id) > 100 then
      raise exception 'Ryhmän tunniste puuttuu';
    end if;
    if v_group_ids ? v_client_id then
      raise exception 'Sama ryhmä on tuonnissa kahdesti';
    end if;

    begin
      v_existing_id := nullif(v_group ->> 'existing_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'Virheellinen olemassa olevan ryhmän tunniste';
    end;

    if v_existing_id is not null then
      select g.id
        into v_group_id
        from public.koutsi_groups g
       where g.id = v_existing_id
         and g.coach_id = v_coach;
      if not found then
        raise exception 'Ryhmää ei löytynyt tai se ei kuulu valmentajalle';
      end if;
      v_reused_groups := v_reused_groups + 1;
    else
      v_name := btrim(coalesce(v_group ->> 'name', ''));
      v_level := nullif(btrim(coalesce(v_group ->> 'level', '')), '');
      v_day := coalesce(nullif(btrim(coalesce(v_group ->> 'day', '')), ''), 'Ma');
      if v_name = '' then
        raise exception 'Anna uudelle ryhmälle nimi';
      end if;
      if length(v_name) > 120 or length(coalesce(v_level, '')) > 80 then
        raise exception 'Ryhmän nimi tai taso on liian pitkä';
      end if;
      if v_day not in ('Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su') then
        raise exception 'Virheellinen viikonpäivä';
      end if;
      begin
        v_time := nullif(v_group ->> 'time', '')::time;
      exception when invalid_datetime_format then
        raise exception 'Virheellinen kellonaika';
      end;
      if v_time is null then
        raise exception 'Anna ryhmälle kellonaika';
      end if;
      begin
        v_duration_minutes := coalesce(nullif(v_group ->> 'duration_minutes', '')::integer, 60);
      exception when invalid_text_representation then
        raise exception 'Virheellinen treenin kesto';
      end;
      if v_duration_minutes < 15 or v_duration_minutes > 240 or v_duration_minutes % 15 <> 0 then
        raise exception 'Treenin kesto pitää olla 15 minuutin tarkkuudella, 15–240 minuuttia';
      end if;

      insert into public.koutsi_groups (coach_id, name, level, weekday, time, duration_minutes)
      values (v_coach, v_name, v_level, v_day, v_time, v_duration_minutes)
      returning id into v_group_id;
      v_created_groups := v_created_groups + 1;

      -- Materialize the group's first year of weekly sessions right away, starting from
      -- the next occurrence of its weekday, so it shows up on the calendar immediately.
      v_dow := case v_day
        when 'Su' then 0 when 'Ma' then 1 when 'Ti' then 2 when 'Ke' then 3
        when 'To' then 4 when 'Pe' then 5 when 'La' then 6
      end;
      v_first_date := current_date + (((v_dow - extract(dow from current_date)::integer) + 7) % 7);
      v_series_id := gen_random_uuid();
      insert into public.koutsi_trainings (coach_id, group_id, date, time, type, duration_minutes, series_id)
      select v_coach, v_group_id, d::date, v_time, 'Ryhmätreeni', v_duration_minutes, v_series_id
        from generate_series(v_first_date, v_first_date + interval '364 days', interval '7 days') as d;
    end if;

    v_group_ids := jsonb_set(
      v_group_ids,
      array[v_client_id],
      to_jsonb(v_group_id::text),
      true
    );
  end loop;

  for v_player in select value from jsonb_array_elements(v_players)
  loop
    if jsonb_typeof(v_player) <> 'object' then
      raise exception 'Virheellinen pelaajarivi';
    end if;
    v_name := btrim(coalesce(v_player ->> 'name', ''));
    v_level := nullif(btrim(coalesce(v_player ->> 'level', '')), '');
    if v_name = '' then
      raise exception 'Anna jokaiselle pelaajalle nimi';
    end if;
    if length(v_name) > 120 or length(coalesce(v_level, '')) > 80 then
      raise exception 'Pelaajan nimi tai taso on liian pitkä';
    end if;
    begin
      v_age := nullif(v_player ->> 'age', '')::integer;
    exception when invalid_text_representation then
      raise exception 'Pelaajan ikä ei ole numero';
    end;
    if v_age is not null and (v_age < 1 or v_age > 99) then
      raise exception 'Pelaajan iän pitää olla väliltä 1–99';
    end if;
    if coalesce(jsonb_typeof(v_player -> 'group_refs'), 'array') <> 'array' then
      raise exception 'Virheellinen pelaajan ryhmävalinta';
    end if;

    v_student_id := gen_random_uuid();
    insert into public.koutsi_students (
      id, display_name, placeholder_coach_id, age, level
    ) values (
      v_student_id, v_name, v_coach, v_age, v_level
    );
    insert into public.koutsi_coach_students (coach_id, student_id)
    values (v_coach, v_student_id);

    for v_group_ref in
      select value
        from jsonb_array_elements_text(coalesce(v_player -> 'group_refs', '[]'::jsonb))
    loop
      begin
        v_group_id := (v_group_ids ->> v_group_ref)::uuid;
      exception when invalid_text_representation then
        v_group_id := null;
      end;
      if v_group_id is null then
        raise exception 'Pelaajalle valittua ryhmää ei löytynyt';
      end if;
      insert into public.koutsi_group_members (group_id, student_id)
      values (v_group_id, v_student_id)
      on conflict (group_id, student_id)
      do update set ended_at = null;
    end loop;

    v_player_ids := v_player_ids || jsonb_build_array(
      jsonb_build_object('id', v_student_id, 'name', v_name)
    );
    v_created_players := v_created_players + 1;
  end loop;

  for v_theme in select value from jsonb_array_elements(v_themes)
  loop
    if jsonb_typeof(v_theme) <> 'object' then
      raise exception 'Virheellinen viikkoteema';
    end if;
    v_group_ref := btrim(coalesce(v_theme ->> 'group_ref', ''));
    begin
      v_group_id := (v_group_ids ->> v_group_ref)::uuid;
    exception when invalid_text_representation then
      v_group_id := null;
    end;
    if v_group_id is null then
      raise exception 'Viikkoteeman ryhmää ei löytynyt';
    end if;
    begin
      v_year := (v_theme ->> 'year')::integer;
      v_week := (v_theme ->> 'week')::integer;
    exception when invalid_text_representation or null_value_not_allowed then
      raise exception 'Virheellinen viikkonumero';
    end;
    v_title := btrim(coalesce(v_theme ->> 'title', ''));
    v_lead := nullif(btrim(coalesce(v_theme ->> 'lead', '')), '');
    if v_year is null or v_week is null
       or v_year < 2000 or v_year > 2100 or v_week < 1 or v_week > 53 then
      raise exception 'Virheellinen viikkonumero';
    end if;
    if v_title = '' then
      raise exception 'Anna viikkoteemalle nimi';
    end if;
    if length(v_title) > 160 or length(coalesce(v_lead, '')) > 1000 then
      raise exception 'Viikkoteeman teksti on liian pitkä';
    end if;

    insert into public.koutsi_group_themes (
      group_id, iso_year, iso_week, title, lead, updated_at
    ) values (
      v_group_id, v_year, v_week, v_title, v_lead, now()
    )
    on conflict (group_id, iso_year, iso_week)
    do update set
      title = excluded.title,
      lead = excluded.lead,
      updated_at = now();
    v_saved_themes := v_saved_themes + 1;
  end loop;

  return jsonb_build_object(
    'players_created', v_created_players,
    'groups_created', v_created_groups,
    'groups_reused', v_reused_groups,
    'themes_saved', v_saved_themes,
    'players', v_player_ids,
    'group_ids', v_group_ids
  );
end;
$function$;
