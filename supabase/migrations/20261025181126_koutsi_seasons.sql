-- 20261026120000_koutsi_seasons.sql — "Uusi kausi" for the renewed Koutsi.
--
-- NOT APPLIED. Apply only on the user's "aja migraatio" (apply_migration with this name), then move
-- the file to supabase/migrations. Everything here is additive: two new tables, two nullable columns
-- on koutsi_groups, one trigger, three functions and one replaced function (the invite redeem, one
-- line changed). Rollback: drop the new objects and restore redeem_koutsi_invite_code from git.
--
-- Rules the app relies on (koutsi/web/src/domain/season.js):
--   * A season = name + start + end + break days. A group belongs to one season (season_id).
--   * The next season's groups are NEW rows (continues_from → the group they continue). The season
--     that ends keeps its groups, members, sessions, attendance and themes exactly as they were.
--   * Old-season memberships are never ended: koutsi_is_group_member() needs ended_at IS NULL, so
--     ending them would hide a player's own past sessions. The app shows the current season instead.
--   * The draft lives in koutsi_season_drafts (coach only) — players see nothing before publish.
--   * Publishing is one call (koutsi_publish_season): season, groups, members, new placeholder
--     players and sessions at once, per-row training notifications muted, then ONE notification per
--     player about their own groups.
--   * koutsi_seasons_enabled() gates the feature: beta testers and admins first. Opening it to all
--     coaches is a one-line replace of that function.

-- ── tables ──────────────────────────────────────────────────────────────────

create table if not exists public.koutsi_seasons (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.koutsi_coaches(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  starts_on date not null,
  ends_on date not null,
  breaks jsonb not null default '[]'::jsonb check (jsonb_typeof(breaks) = 'array'),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on and ends_on <= starts_on + 400)
);
create index if not exists koutsi_seasons_coach_idx on public.koutsi_seasons (coach_id, starts_on);

create table if not exists public.koutsi_season_drafts (
  coach_id uuid primary key references public.koutsi_coaches(id) on delete cascade,
  from_season_id uuid references public.koutsi_seasons(id) on delete set null,
  draft jsonb not null check (jsonb_typeof(draft) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.koutsi_groups
  add column if not exists season_id uuid references public.koutsi_seasons(id) on delete set null,
  add column if not exists continues_from uuid references public.koutsi_groups(id) on delete set null;
create index if not exists koutsi_groups_season_idx on public.koutsi_groups (season_id);
create index if not exists koutsi_groups_continues_idx on public.koutsi_groups (continues_from);

-- ── who sees what ───────────────────────────────────────────────────────────

alter table public.koutsi_seasons enable row level security;
alter table public.koutsi_season_drafts enable row level security;

-- the coach (or an admin acting as them) manages their seasons; a player reads the seasons of
-- the groups they play in (the app shows "Kevät 2027 alkaa ma 11.1.")
drop policy if exists koutsi_seasons_select on public.koutsi_seasons;
create policy koutsi_seasons_select on public.koutsi_seasons for select using (
  public.koutsi_acts_as(coach_id)
  or exists (select 1 from public.koutsi_groups g where g.season_id = koutsi_seasons.id and public.koutsi_is_group_member(g.id))
);
drop policy if exists koutsi_seasons_insert on public.koutsi_seasons;
create policy koutsi_seasons_insert on public.koutsi_seasons for insert with check (public.koutsi_acts_as(coach_id));
drop policy if exists koutsi_seasons_update on public.koutsi_seasons;
create policy koutsi_seasons_update on public.koutsi_seasons for update using (public.koutsi_acts_as(coach_id)) with check (public.koutsi_acts_as(coach_id));
drop policy if exists koutsi_seasons_delete on public.koutsi_seasons;
create policy koutsi_seasons_delete on public.koutsi_seasons for delete using (public.koutsi_acts_as(coach_id));

drop policy if exists koutsi_season_drafts_all on public.koutsi_season_drafts;
create policy koutsi_season_drafts_all on public.koutsi_season_drafts for all
  using (public.koutsi_acts_as(coach_id)) with check (public.koutsi_acts_as(coach_id));

grant select, insert, update, delete on public.koutsi_seasons to authenticated;
grant select, insert, update, delete on public.koutsi_season_drafts to authenticated;

-- ── a new group joins the coach's current season ─────────────────────────────
-- Covers every way a group is made (new app, old app, bulk setup). The current season is the one
-- running today, else the latest that has started, else the first one coming.

create or replace function public.koutsi_current_season(p_coach uuid)
returns uuid
language sql
stable
security definer
set search_path to ''
as $$
  select s.id
    from public.koutsi_seasons s
   where s.coach_id = p_coach
   order by
     (s.starts_on <= (now() at time zone 'Europe/Helsinki')::date
      and s.ends_on >= (now() at time zone 'Europe/Helsinki')::date) desc,
     (s.starts_on <= (now() at time zone 'Europe/Helsinki')::date) desc,
     case when s.starts_on <= (now() at time zone 'Europe/Helsinki')::date then s.starts_on end desc nulls last,
     s.starts_on asc
   limit 1;
$$;

create or replace function public.koutsi_groups_set_season()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.season_id is null then
    new.season_id := public.koutsi_current_season(new.coach_id);
  end if;
  return new;
end;
$$;

drop trigger if exists koutsi_groups_set_season on public.koutsi_groups;
create trigger koutsi_groups_set_season before insert on public.koutsi_groups
  for each row execute function public.koutsi_groups_set_season();

-- ── the gate ────────────────────────────────────────────────────────────────

create or replace function public.koutsi_seasons_enabled()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select (select auth.uid()) is not null and (
    public.koutsi_is_admin()
    or exists (
      select 1 from public.koutsi_beta_testers b
        join auth.users u on lower(u.email) = lower(b.email)
       where u.id = (select auth.uid())
    )
  );
$$;
grant execute on function public.koutsi_seasons_enabled() to authenticated;

-- ── publish ─────────────────────────────────────────────────────────────────
-- draft = the app's Draft (domain/season.js): { name, startsOn, endsOn, breaks: [{ from, to, on }],
-- groups: [{ key, fromId, name, level, day, time, durationMinutes, status }], members: { key: [ref] },
-- newPlayers: [{ key, name }] }. A ref is a student id or a newPlayers key.

create or replace function public.koutsi_publish_season(draft jsonb, coach_id_input uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
  v_coach uuid := coalesce(coach_id_input, auth.uid());
  v_name text := btrim(coalesce(draft ->> 'name', ''));
  v_start date;
  v_end date;
  v_skip date[] := '{}';
  v_break jsonb;
  v_season uuid;
  v_group jsonb;
  v_key text;
  v_from uuid;
  v_gid uuid;
  v_dow integer;
  v_day date;
  v_series uuid;
  v_time time;
  v_duration integer;
  v_refs jsonb := '{}'::jsonb;
  v_player jsonb;
  v_sid uuid;
  v_groups integer := 0;
  v_sessions integer := 0;
  v_row record;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not public.koutsi_acts_as(v_coach) then raise exception 'not allowed'; end if;
  if draft is null or jsonb_typeof(draft) <> 'object' then raise exception 'Virheellinen kausi'; end if;
  if v_name = '' or char_length(v_name) > 60 then raise exception 'Anna kaudelle nimi'; end if;
  begin
    v_start := (draft ->> 'startsOn')::date;
    v_end := (draft ->> 'endsOn')::date;
  exception when others then
    raise exception 'Tarkista kauden päivät';
  end;
  if v_start is null or v_end is null or v_end <= v_start or v_end > v_start + 400 then
    raise exception 'Tarkista kauden päivät';
  end if;
  if jsonb_typeof(coalesce(draft -> 'groups', 'null'::jsonb)) <> 'array' then raise exception 'Virheellinen kausi'; end if;

  for v_break in select * from jsonb_array_elements(coalesce(draft -> 'breaks', '[]'::jsonb)) loop
    if coalesce((v_break ->> 'on')::boolean, false) then
      v_skip := v_skip || array(
        select d::date from generate_series((v_break ->> 'from')::date, coalesce((v_break ->> 'to')::date, (v_break ->> 'from')::date), interval '1 day') d
      );
    end if;
  end loop;

  insert into public.koutsi_seasons (coach_id, name, starts_on, ends_on, breaks)
  values (v_coach, v_name, v_start, v_end, coalesce(draft -> 'breaks', '[]'::jsonb))
  returning id into v_season;

  -- new players placed in some group of the season become placeholders (or the existing player of
  -- that exact name, so nobody becomes two rows)
  for v_player in select * from jsonb_array_elements(coalesce(draft -> 'newPlayers', '[]'::jsonb)) loop
    continue when not exists (
      select 1 from jsonb_array_elements(draft -> 'groups') g, jsonb_array_elements_text(coalesce(draft -> 'members' -> (g ->> 'key'), '[]'::jsonb)) r
       where coalesce(g ->> 'status', '') <> 'loppuu' and r = v_player ->> 'key'
    );
    select s.id into v_sid
      from public.koutsi_coach_students cs join public.koutsi_students s on s.id = cs.student_id
     where cs.coach_id = v_coach and cs.ended_at is null and lower(s.display_name) = lower(btrim(v_player ->> 'name'))
     limit 1;
    if v_sid is null then
      v_sid := public.koutsi_create_player(v_player ->> 'name', null, null, v_coach);
    end if;
    v_refs := v_refs || jsonb_build_object(v_player ->> 'key', v_sid);
  end loop;

  perform set_config('koutsi.bulk_trainings', 'on', true);
  for v_group in select * from jsonb_array_elements(draft -> 'groups') loop
    continue when coalesce(v_group ->> 'status', '') = 'loppuu';
    v_key := v_group ->> 'key';
    v_dow := case v_group ->> 'day'
      when 'Ma' then 1 when 'Ti' then 2 when 'Ke' then 3 when 'To' then 4
      when 'Pe' then 5 when 'La' then 6 when 'Su' then 7 end;
    if v_dow is null or btrim(coalesce(v_group ->> 'name', '')) = '' then raise exception 'Tarkista ryhmän nimi ja päivä'; end if;
    begin
      v_time := (v_group ->> 'time')::time;
    exception when others then
      raise exception 'Tarkista ryhmän kellonaika';
    end;
    if v_time is null then raise exception 'Tarkista ryhmän kellonaika'; end if;
    v_duration := coalesce(nullif(v_group ->> 'durationMinutes', '')::integer, 60);
    -- continues_from only to the coach's own group
    v_from := null;
    if coalesce(v_group ->> 'fromId', '') ~* '^[0-9a-f-]{36}$' then
      select g.id into v_from from public.koutsi_groups g where g.id = (v_group ->> 'fromId')::uuid and g.coach_id = v_coach;
    end if;

    insert into public.koutsi_groups (coach_id, name, level, weekday, time, duration_minutes, season_id, continues_from)
    values (v_coach, btrim(v_group ->> 'name'), nullif(btrim(coalesce(v_group ->> 'level', '')), ''), v_group ->> 'day', v_time, v_duration, v_season, v_from)
    returning id into v_gid;

    -- members: the coach's own players only
    insert into public.koutsi_group_members (group_id, student_id)
    select distinct v_gid, cs.student_id
      from jsonb_array_elements_text(coalesce(draft -> 'members' -> v_key, '[]'::jsonb)) r
      join public.koutsi_coach_students cs
        on cs.coach_id = v_coach and cs.ended_at is null
       and cs.student_id = coalesce(
             (v_refs ->> r)::uuid,
             case when r ~* '^[0-9a-f-]{36}$' then r::uuid end)
    on conflict (group_id, student_id) do nothing;

    v_series := gen_random_uuid();
    v_day := v_start + ((v_dow - extract(isodow from v_start)::integer + 7) % 7);
    while v_day <= v_end loop
      if not (v_day = any(v_skip)) then
        insert into public.koutsi_trainings (coach_id, group_id, date, time, type, duration_minutes, series_id, logged_by)
        values (v_coach, v_gid, v_day, v_time, 'Ryhmätreeni', v_duration, v_series, 'coach');
        v_sessions := v_sessions + 1;
      end if;
      v_day := v_day + 7;
    end loop;
    v_groups := v_groups + 1;
  end loop;
  perform set_config('koutsi.bulk_trainings', 'off', true);

  if v_groups = 0 then raise exception 'Kaudella ei ole yhtään ryhmää'; end if;

  -- one notification per player: "Kevät 2027 alkaa 11.1.2027: Ti klo 17.00 Aikuiset edistyneet, …"
  for v_row in
    select gm.student_id,
           string_agg(g.weekday || ' klo ' || to_char(g.time, 'FMHH24.MI') || ' ' || g.name, ', '
             order by array_position(array['Ma','Ti','Ke','To','Pe','La','Su'], g.weekday), g.time) as list
      from public.koutsi_group_members gm
      join public.koutsi_groups g on g.id = gm.group_id
     where g.season_id = v_season and gm.ended_at is null
     group by gm.student_id
  loop
    perform public.koutsi_notify(v_row.student_id, v_coach, 'training_added',
      v_name || ': ryhmäsi ovat valmiina',
      v_name || ' alkaa ' || to_char(v_start, 'FMDD.FMMM.YYYY') || ': ' || v_row.list,
      '/pelaaja');
  end loop;

  delete from public.koutsi_season_drafts where coach_id = v_coach;
  return jsonb_build_object('seasonId', v_season, 'groups', v_groups, 'sessions', v_sessions);
end;
$$;
grant execute on function public.koutsi_publish_season(jsonb, uuid) to authenticated;

-- ── a group link from an earlier season leads to the group that continues it ──

create or replace function public.koutsi_latest_group(p_group uuid)
returns uuid
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_current uuid := p_group;
  v_next uuid;
  v_hops integer := 0;
begin
  loop
    select g.id into v_next from public.koutsi_groups g
     where g.continues_from = v_current
     order by g.created_at desc limit 1;
    exit when v_next is null or v_hops > 20;
    v_current := v_next;
    v_next := null;
    v_hops := v_hops + 1;
  end loop;
  return v_current;
end;
$$;

-- redeem_koutsi_invite_code exactly as in production (2026-10-23), one line changed:
-- v_group_id := public.koutsi_latest_group(v_code.group_id)
CREATE OR REPLACE FUNCTION public.redeem_koutsi_invite_code(code_input text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- a link made in an earlier season joins the group that continues it now
    v_group_id  := public.koutsi_latest_group(v_code.group_id);
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

-- ── today's groups become each coach's first season ──────────────────────────
-- One season per coach with groups: from the first to the last coach-run session of those groups,
-- named by its start ("Syksy 2026"). The coach moves the end with "Muokkaa kautta" if the real
-- season runs longer than the calendar does now.

do $$
declare
  v_row record;
  v_season uuid;
  v_month integer;
begin
  for v_row in
    select g.coach_id, min(t.date) as first_day, max(t.date) as last_day
      from public.koutsi_groups g
      join public.koutsi_trainings t on t.group_id = g.id and t.logged_by = 'coach'
     where g.season_id is null
     group by g.coach_id
  loop
    continue when exists (select 1 from public.koutsi_seasons s where s.coach_id = v_row.coach_id);
    v_month := extract(month from v_row.first_day);
    insert into public.koutsi_seasons (coach_id, name, starts_on, ends_on)
    values (
      v_row.coach_id,
      case when v_month >= 8 then 'Syksy ' when v_month <= 5 then 'Kevät ' else 'Kesä ' end || extract(year from v_row.first_day)::text,
      v_row.first_day,
      greatest(v_row.last_day, v_row.first_day + 1)
    )
    returning id into v_season;
    update public.koutsi_groups set season_id = v_season where coach_id = v_row.coach_id and season_id is null;
  end loop;
end;
$$;
