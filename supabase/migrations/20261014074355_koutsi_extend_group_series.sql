-- "Jatka kalenteria" for the renewed Koutsi (koutsi/web): every pilot group's calendar was
-- generated 12 weeks ahead and runs out between 25.11. and 3.12.2026. Extending it from the
-- client would insert one row per session, and koutsi_training_notify sends every group
-- member one notification (and email) per row — about 300 for the main pilot coach alone.
--
-- 1. koutsi_extend_group_series(): adds a group's weekly sessions — its own weekly time and
--    every extra slot — up to a date, skipping holiday weeks, and sends each player ONE
--    summary notification. Sessions that already exist are never duplicated.
-- 2. The per-row training triggers can be muted for the rest of a transaction by a bulk
--    operation that sends its own summary (set_config('koutsi.bulk_trainings', 'on', true)).
-- 3. A player is no longer notified about a session they logged (or removed) themselves:
--    the triggers used the coach as the actor, so koutsi_notify's "not to yourself" check
--    never matched a player's own log.
--
-- The trigger bodies are otherwise the ones in production on 2026-10-13
-- (pg_get_functiondef of koutsi_on_training_insert / koutsi_on_training_delete).

create or replace function public.koutsi_on_training_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_student uuid;
begin
  if coalesce(current_setting('koutsi.bulk_trainings', true), '') = 'on' then
    return new;
  end if;
  if new.logged_by = 'player' then
    return new;
  end if;
  for v_student in select * from koutsi_training_audience(new) loop
    perform koutsi_notify(v_student, new.coach_id, 'training_added',
      'Uusi treeni kalenterissasi',
      to_char(new.date, 'DD.MM.YYYY') || ' klo ' || to_char(new.time, 'HH24:MI') || ' — ' || new.type,
      '/pelaaja');
  end loop;
  return new;
end; $function$;

create or replace function public.koutsi_on_training_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_student uuid;
begin
  if old.date < current_date then
    return old;
  end if;
  if coalesce(current_setting('koutsi.bulk_trainings', true), '') = 'on' then
    return old;
  end if;
  if old.logged_by = 'player' then
    return old;
  end if;
  for v_student in select * from koutsi_training_audience(old) loop
    perform koutsi_notify(v_student, old.coach_id, 'training_cancelled',
      'Treeni peruttu',
      to_char(old.date, 'DD.MM.YYYY') || ' klo ' || to_char(old.time, 'HH24:MI') || ' — ' || old.type,
      '/pelaaja');
  end loop;
  return old;
end; $function$;

-- Returns { added, first, last }. skip_dates: every date of the weeks to leave empty.
create or replace function public.koutsi_extend_group_series(
  group_id_input uuid,
  until_date date,
  skip_dates date[] default '{}'::date[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_today date := (now() at time zone 'Europe/Helsinki')::date;
  v_group record;
  v_slot record;
  v_dow integer;
  v_series uuid;
  v_last date;
  v_day date;
  v_count integer;
  v_added integer := 0;
  v_first_added date;
  v_last_added date;
  v_student uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select g.id, g.coach_id, g.name, g.weekday, g.time, g.duration_minutes
    into v_group
    from public.koutsi_groups g
   where g.id = group_id_input;
  if not found or not public.koutsi_acts_as(v_group.coach_id) then
    raise exception 'Ryhmää ei löytynyt';
  end if;
  if until_date is null or until_date <= v_today then
    raise exception 'Valitse päivä tulevaisuudesta';
  end if;
  if until_date > v_today + 400 then
    raise exception 'Kalenteria voi jatkaa enintään vuoden eteenpäin';
  end if;

  perform set_config('koutsi.bulk_trainings', 'on', true);

  -- The group's own weekly time first, then every extra weekly slot.
  for v_slot in
    select null::uuid as slot_id, v_group.weekday as weekday, v_group.time as time,
           v_group.duration_minutes as duration_minutes, null::uuid as series_id
     where v_group.weekday is not null and v_group.time is not null
    union all
    select s.id, s.weekday, s.time, s.duration_minutes, s.series_id
      from public.koutsi_group_slots s
     where s.group_id = v_group.id
  loop
    v_dow := case v_slot.weekday
      when 'Ma' then 1 when 'Ti' then 2 when 'Ke' then 3 when 'To' then 4
      when 'Pe' then 5 when 'La' then 6 when 'Su' then 7 end;
    continue when v_dow is null;

    -- Keep the series the sessions already belong to, so "edit/delete the whole series"
    -- covers the new weeks too.
    if v_slot.slot_id is null then
      select t.series_id into v_series
        from public.koutsi_trainings t
       where t.group_id = v_group.id and t.logged_by = 'coach' and t.series_id is not null
         and t.time = v_slot.time and extract(isodow from t.date) = v_dow
         and not exists (select 1 from public.koutsi_group_slots s where s.group_id = v_group.id and s.series_id = t.series_id)
       order by t.date desc
       limit 1;
    else
      v_series := v_slot.series_id;
    end if;
    if v_series is null then
      v_series := gen_random_uuid();
      if v_slot.slot_id is not null then
        update public.koutsi_group_slots set series_id = v_series where id = v_slot.slot_id;
      end if;
    end if;

    select max(t.date) into v_last
      from public.koutsi_trainings t
     where t.group_id = v_group.id and t.logged_by = 'coach'
       and (t.series_id = v_series or (t.time = v_slot.time and extract(isodow from t.date) = v_dow));

    v_day := greatest(coalesce(v_last + 1, v_today), v_today);
    v_day := v_day + ((v_dow - extract(isodow from v_day)::integer + 7) % 7);
    v_count := 0;
    while v_day <= until_date and v_count < 60 loop
      if not (v_day = any(coalesce(skip_dates, '{}'::date[])))
         and not exists (
           select 1 from public.koutsi_trainings t
            where t.group_id = v_group.id and t.date = v_day and t.time = v_slot.time and t.logged_by = 'coach'
         ) then
        insert into public.koutsi_trainings (coach_id, group_id, date, time, type, duration_minutes, series_id, logged_by)
        values (v_group.coach_id, v_group.id, v_day, v_slot.time, 'Ryhmätreeni', v_slot.duration_minutes, v_series, 'coach');
        v_added := v_added + 1;
        v_first_added := least(coalesce(v_first_added, v_day), v_day);
        v_last_added := greatest(coalesce(v_last_added, v_day), v_day);
      end if;
      v_day := v_day + 7;
      v_count := v_count + 1;
    end loop;
  end loop;

  perform set_config('koutsi.bulk_trainings', 'off', true);

  if v_added > 0 then
    for v_student in
      select gm.student_id from public.koutsi_group_members gm
       where gm.group_id = v_group.id and gm.ended_at is null
    loop
      perform public.koutsi_notify(v_student, v_group.coach_id, 'training_added',
        'Lisää treenejä kalenterissasi',
        v_group.name || ': ' || v_added || case when v_added = 1 then ' uusi treeni ' else ' uutta treeniä ' end
          || to_char(v_first_added, 'DD.MM.') || '–' || to_char(v_last_added, 'DD.MM.YYYY'),
        '/pelaaja');
    end loop;
  end if;

  return jsonb_build_object('added', v_added, 'first', v_first_added, 'last', v_last_added);
end;
$function$;

revoke all on function public.koutsi_extend_group_series(uuid, date, date[]) from public, anon;
grant execute on function public.koutsi_extend_group_series(uuid, date, date[]) to authenticated, service_role;
