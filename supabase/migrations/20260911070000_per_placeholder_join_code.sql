-- The coach's own permanent code, shown on every "Ei vielä Krossissa" player card
-- (PlaceholderNotice), is identical for every placeholder — only the full link/QR (via the
-- hidden ?oppilas= id) is actually specific to one player. That's correct but genuinely
-- confusing to look at: two different cards showing the exact same short code reads as "one
-- shared link for everyone", which is the opposite of what's true. This gives each
-- placeholder its own real, unique code instead, so what's on screen matches what's true.
--
-- Reuses koutsi_group_invite_codes (one more nullable column) rather than a new table —
-- same shape (a code resolves to a coach, optionally scoped further), just scoped to one
-- student instead of one group.
alter table public.koutsi_group_invite_codes
  add column if not exists student_id uuid references public.koutsi_students(id) on delete cascade;

create unique index if not exists koutsi_group_invite_codes_student_id_key
  on public.koutsi_group_invite_codes (student_id) where student_id is not null;

-- Six characters from a wide, unambiguous alphabet (no 0/O/1/I/L, so a coach dictating it
-- over the phone doesn't have to spell out which is which) — matches the format already
-- used elsewhere in the app (e.g. "VHDC6P"). Retries on the rare collision.
create or replace function public.koutsi_generate_short_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_attempt integer := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
    end loop;
    exit when not exists (select 1 from public.koutsi_group_invite_codes where code = v_code)
      and not exists (select 1 from public.koutsi_coach_join_codes where code = v_code);
    if v_attempt > 20 then
      raise exception 'Koodin generointi epäonnistui, yritä uudelleen';
    end if;
  end loop;
  return v_code;
end;
$$;

revoke all on function public.koutsi_generate_short_code() from public, anon, authenticated;

-- Returns this placeholder's own persistent code, generating one on first call — including
-- for a placeholder created before this migration existed, so nothing needs a separate
-- backfill pass. Deliberately does not touch koutsi_create_player_v2 / koutsi_bulk_setup_v2
-- themselves (their bodies aren't in any tracked migration, so — same reasoning as
-- koutsi_resolve_join_code in the previous migration — they can't be safely replaced from
-- here); generating lazily, the first time a coach opens that player's own card, sidesteps
-- needing to touch them at all.
create or replace function public.koutsi_placeholder_join_code(student_id_input uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_coach uuid;
  v_code  text;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select placeholder_coach_id into v_coach
    from public.koutsi_students
   where id = student_id_input;

  if v_coach is null then
    raise exception 'Pelaajaa ei löytynyt, tai hän on jo lunastanut profiilinsa';
  end if;
  if v_coach <> v_uid and not public.koutsi_is_admin() then
    raise exception 'not allowed';
  end if;

  select code into v_code
    from public.koutsi_group_invite_codes
   where student_id = student_id_input;

  if v_code is not null then
    return v_code;
  end if;

  v_code := public.koutsi_generate_short_code();
  insert into public.koutsi_group_invite_codes (code, coach_id, student_id)
  values (v_code, v_coach, student_id_input);

  return v_code;
end;
$$;

revoke all on function public.koutsi_placeholder_join_code(uuid) from public, anon;
grant execute on function public.koutsi_placeholder_join_code(uuid) to authenticated;

-- koutsi_resolve_join_code now also reports the code's bound student_id, if any, so a
-- per-placeholder code resolves deterministically to that one player — no name-guessing
-- needed at all for this kind of code, unlike the coach-wide/group-shared codes. A third
-- OUT parameter changes the function's row type, which CREATE OR REPLACE can't do in
-- place — drop and recreate.
drop function if exists public.koutsi_resolve_join_code(text);
create function public.koutsi_resolve_join_code(code_input text, out coach_id uuid, out group_id uuid, out student_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(code_input, '')));
begin
  if v_code = '' then
    return;
  end if;

  select cj.coach_id into coach_id
    from public.koutsi_coach_join_codes cj
   where cj.code = v_code;

  if coach_id is null then
    select gi.coach_id, gi.group_id, gi.student_id into coach_id, group_id, student_id
      from public.koutsi_group_invite_codes gi
     where gi.code = v_code
       and gi.revoked_at is null
       and (gi.expires_at is null or gi.expires_at > now())
       and (gi.max_uses is null or gi.use_count < gi.max_uses);
  end if;
end;
$$;

-- A fresh function grants EXECUTE to PUBLIC by default — the drop above lost the lockdown
-- the previous migration put on this function, so restore it.
revoke all on function public.koutsi_resolve_join_code(text) from public, anon, authenticated;

-- A code bound to one placeholder is already fully unambiguous — no exact/first-name
-- guessing needed, and the "direct" flag tells the join screen to claim immediately (same
-- as the ?oppilas= personal-link path) instead of asking "is this you?" first.
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
      return null; -- placeholder already claimed/removed since the code was generated
    end if;
    return jsonb_build_object('id', v_direct_student, 'name', v_display_name, 'direct', true);
  end if;

  select p.name into v_name from public.profiles p where p.id = v_uid;
  v_norm := lower(btrim(regexp_replace(coalesce(v_name, ''), '\s+', ' ', 'g')));
  if v_norm = '' then
    return null;
  end if;
  v_first := split_part(v_norm, ' ', 1);

  select count(*), min(s.id), min(s.display_name) into v_count, v_id, v_display_name
    from public.koutsi_students s
   where s.placeholder_coach_id = v_coach
     and (v_group is null or exists (
       select 1 from public.koutsi_group_members gm
        where gm.group_id = v_group and gm.student_id = s.id and gm.ended_at is null
     ))
     and lower(btrim(regexp_replace(s.display_name, '\s+', ' ', 'g'))) = v_norm;

  if v_count = 1 then
    return jsonb_build_object('id', v_id, 'name', v_display_name);
  end if;
  if v_count > 1 then
    return null;
  end if;

  select count(*), min(s.id), min(s.display_name) into v_count, v_id, v_display_name
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

  return jsonb_build_object('id', v_id, 'name', v_display_name);
end;
$$;
