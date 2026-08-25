-- Import one reviewed annual-plan workbook into several existing groups. The browser
-- parses Excel, while this function is the final authorization and integrity boundary:
-- only a Koutsi administrator may target a coach, and every group must belong to them.
create or replace function public.koutsi_admin_import_annual_plan(
  coach_id_input uuid,
  themes_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_theme jsonb;
  v_group_id uuid;
  v_year integer;
  v_week integer;
  v_title text;
  v_lead text;
  v_key text;
  v_seen jsonb := '{}'::jsonb;
  v_groups jsonb := '{}'::jsonb;
  v_group_count integer := 0;
  v_saved integer := 0;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if not public.koutsi_is_admin() then
    raise exception 'not allowed';
  end if;
  if coach_id_input is null or not exists (
    select 1
      from public.koutsi_coaches c
     where c.id = coach_id_input
       and c.archived_at is null
  ) then
    raise exception 'Valmentajaa ei löytynyt';
  end if;
  if themes_input is null or jsonb_typeof(themes_input) <> 'array' then
    raise exception 'Virheellinen vuosisuunnitelma';
  end if;
  if jsonb_array_length(themes_input) = 0 then
    raise exception 'Vuosisuunnitelmassa ei ole viikkoteemoja';
  end if;
  if jsonb_array_length(themes_input) > 5200 then
    raise exception 'Voit tuoda kerralla enintään 5200 viikkoteemaa';
  end if;

  for v_theme in select value from jsonb_array_elements(themes_input)
  loop
    if jsonb_typeof(v_theme) <> 'object' then
      raise exception 'Virheellinen viikkoteema';
    end if;
    begin
      v_group_id := nullif(v_theme ->> 'group_id', '')::uuid;
      v_year := nullif(v_theme ->> 'year', '')::integer;
      v_week := nullif(v_theme ->> 'week', '')::integer;
    exception when invalid_text_representation then
      raise exception 'Virheellinen ryhmä tai viikkonumero';
    end;
    if v_group_id is null or not exists (
      select 1
        from public.koutsi_groups g
       where g.id = v_group_id
         and g.coach_id = coach_id_input
    ) then
      raise exception 'Vuosisuunnitelman ryhmä ei kuulu valitulle valmentajalle';
    end if;
    if v_year is null or v_year < 2000 or v_year > 2100
       or v_week is null or v_week < 1
       or v_week > extract(week from make_date(v_year, 12, 28))::integer then
      raise exception 'Virheellinen viikkonumero';
    end if;

    v_title := btrim(coalesce(v_theme ->> 'title', ''));
    v_lead := nullif(btrim(coalesce(v_theme ->> 'lead', '')), '');
    if v_title = '' then
      raise exception 'Anna jokaiselle viikkoteemalle nimi';
    end if;
    if length(v_title) > 160 or length(coalesce(v_lead, '')) > 1000 then
      raise exception 'Viikkoteeman teksti on liian pitkä';
    end if;

    v_key := v_group_id::text || ':' || v_year::text || '-' || v_week::text;
    if v_seen ? v_key then
      raise exception 'Sama ryhmä ja viikko on vuosisuunnitelmassa kahdesti';
    end if;
    v_seen := jsonb_set(v_seen, array[v_key], 'true'::jsonb, true);
    if not v_groups ? v_group_id::text then
      v_group_count := v_group_count + 1;
    end if;
    v_groups := jsonb_set(v_groups, array[v_group_id::text], 'true'::jsonb, true);

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
    v_saved := v_saved + 1;
  end loop;

  insert into public.koutsi_admin_actions (admin_id, coach_id, action)
  values (v_uid, coach_id_input, 'import_annual_plan:' || v_saved::text || '_themes');

  return jsonb_build_object(
    'themes_saved', v_saved,
    'groups_updated', v_group_count
  );
end;
$function$;

revoke all on function public.koutsi_admin_import_annual_plan(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.koutsi_admin_import_annual_plan(uuid, jsonb) to authenticated, service_role;
