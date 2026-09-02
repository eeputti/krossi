-- Groups created before koutsi_bulk_setup started generating trainings (and before the
-- single-group "+ Uusi ryhmä" form did, client-side) have a weekly slot with nothing on
-- the calendar. One-time backfill: give every group without an upcoming training its
-- first year of weekly sessions from its existing weekday/time/duration. Idempotent —
-- skips any date a training already exists for that group, so re-running this file is
-- harmless.
do $$
declare
  g record;
  v_dow integer;
  v_first_date date;
  v_series_id uuid;
begin
  for g in
    select id, coach_id, weekday, time, duration_minutes
      from public.koutsi_groups
     where weekday is not null
       and time is not null
       and not exists (
         select 1 from public.koutsi_trainings t
          where t.group_id = koutsi_groups.id
            and t.date >= current_date
       )
  loop
    v_dow := case g.weekday
      when 'Su' then 0 when 'Ma' then 1 when 'Ti' then 2 when 'Ke' then 3
      when 'To' then 4 when 'Pe' then 5 when 'La' then 6 else null
    end;
    if v_dow is null then
      continue;
    end if;
    v_first_date := current_date + (((v_dow - extract(dow from current_date)::integer) + 7) % 7);
    v_series_id := gen_random_uuid();
    insert into public.koutsi_trainings (coach_id, group_id, date, time, type, duration_minutes, series_id)
    select g.coach_id, g.id, d::date, g.time, 'Ryhmätreeni', coalesce(g.duration_minutes, 60), v_series_id
      from generate_series(v_first_date, v_first_date + interval '364 days', interval '7 days') as d
     where not exists (
       select 1 from public.koutsi_trainings t where t.group_id = g.id and t.date = d::date
     );
  end loop;
end $$;
