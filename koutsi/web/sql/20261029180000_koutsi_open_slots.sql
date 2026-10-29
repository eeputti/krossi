-- 20261029180000_koutsi_open_slots.sql — Vapaat ajat: a coach publishes single free times, their own
-- players book them, and a booked time is an ordinary private lesson for both (instead of Calendly).
--
-- NOT APPLIED — a proposal (29.10.2026). Apply only on the user's "aja migraatio" (apply_migration
-- with this name), then move the file to supabase/migrations. Tested in PGlite against a stub of the
-- production schema whose notification functions are the live ones, read from the migration files:
--   koutsi/web/sql/20261029180000_koutsi_open_slots.check.mjs
-- Everything is additive: two new tables, seven functions, two policies and one trigger on
-- koutsi_training_absences. No existing table, function or policy changes, and the old Koutsi
-- reads none of it (a booked time is a normal koutsi_trainings row: it shows it as a private lesson).
-- Rollback: drop the trigger koutsi_open_slot_unfree, the two tables (cascade) and the functions.
--
-- Rules the app relies on:
--   * Off by default. A coach has Vapaat ajat when their e-mail is on koutsi_open_slot_coaches, or
--     they are an admin (koutsi_open_slots_coach_enabled). Nobody else sees anything: no coach page,
--     and their players get no slots and no notices. Opening it for one coach:
--       insert into public.koutsi_open_slot_coaches (email) values ('valmentaja@example.com');
--     Opening it for every coach is a one-line replace of koutsi_open_slots_coach_enabled.
--   * A slot = day, start, length (15–240 min) and an optional place. The coach adds many at once
--     (koutsi_add_open_slots): one publish sends each current player ONE notice, and another publish
--     within 10 minutes brings that notice up to date instead of adding one. The e-mail goes through
--     the existing queue (koutsi_notify → koutsi-notify): the 3-hour digest and the 21–07 quiet
--     hours apply.
--   * A player sees the open, coming slots of their current coaches (coaching on, the coach has the
--     feature) and their own bookings — never who booked another slot.
--   * Booking is one call (koutsi_book_open_slot) and the first one wins: the slot row is locked, so
--     a second booker gets "Joku ehti varata tämän ajan". It creates an ordinary private lesson
--     (koutsi_trainings: logged_by 'coach', student_id = the player, type 'Yksityistunti', the slot's
--     length) without "Uusi treeni kalenterissasi" (the player booked it themself) and tells the
--     coach "<nimi> varasi ajan". Laskutus bills it like any private lesson, and cancelling it is
--     the usual "En pääse": the lesson row stays, so the late-cancellation rule still sees it.
--   * Vapautunut aika: when a player cannot come to a private lesson, the coach can offer the same
--     time to the others with one tap — a new slot with source_training_id = that lesson (each lesson
--     at most once; its own player hears nothing). If the player takes the "En pääse" back while the
--     slot is still open, the slot goes away (trigger koutsi_open_slot_unfree).
--   * The coach removes open slots; a booked one goes with its lesson (removing the lesson removes
--     the slot). Deleting a player or a coach takes their slots with them.

-- ── tables ──────────────────────────────────────────────────────────────────

-- Who has Vapaat ajat (admins always). By e-mail, like koutsi_beta_testers, so a coach can be
-- added before they sign up. Read only by the functions below.
create table if not exists public.koutsi_open_slot_coaches (
  email text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.koutsi_open_slots (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.koutsi_coaches(id) on delete cascade,
  date date not null,
  time time not null,
  duration_minutes integer not null default 60,
  place text,
  -- "Tarjoa aika muille": the private lesson whose player cannot come
  source_training_id uuid references public.koutsi_trainings(id) on delete set null,
  booked_by uuid references public.koutsi_students(id) on update cascade on delete cascade,
  booked_at timestamptz,
  -- the private lesson the booking created; removing the lesson removes the slot
  training_id uuid references public.koutsi_trainings(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint koutsi_open_slots_length check (duration_minutes between 15 and 240),
  constraint koutsi_open_slots_place_len check (place is null or char_length(place) <= 120),
  constraint koutsi_open_slots_booking check (
    (booked_by is null) = (training_id is null) and (booked_by is null) = (booked_at is null)
  ),
  constraint koutsi_open_slots_one_offer unique (source_training_id),
  constraint koutsi_open_slots_one_lesson unique (training_id)
);

-- one open slot per coach and start time
create unique index if not exists koutsi_open_slots_open_time
  on public.koutsi_open_slots (coach_id, date, time) where booked_by is null;
create index if not exists koutsi_open_slots_coach_date_idx on public.koutsi_open_slots (coach_id, date);
create index if not exists koutsi_open_slots_booked_by_idx on public.koutsi_open_slots (booked_by) where booked_by is not null;

-- ── who may ─────────────────────────────────────────────────────────────────

-- The feature gate, per coach: the list above and admins.
create or replace function public.koutsi_open_slots_coach_enabled(p_coach uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_coach is not null and (
    exists (select 1 from public.koutsi_admins a where a.user_id = p_coach)
    or exists (
      select 1 from public.koutsi_open_slot_coaches c
        join auth.users u on lower(u.email) = lower(btrim(c.email))
       where u.id = p_coach
    )
  );
$function$;

-- For the coach's app: is Vapaat ajat on for me?
create or replace function public.koutsi_open_slots_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select public.koutsi_open_slots_coach_enabled((select auth.uid()));
$function$;

-- For the player: may the signed-in user see (and book) this coach's open slots? A current player
-- of the coach, and the coach has the feature.
create or replace function public.koutsi_open_slots_visible(p_coach uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.koutsi_coach_students cs
     where cs.coach_id = p_coach and cs.student_id = (select auth.uid()) and cs.ended_at is null
  ) and public.koutsi_open_slots_coach_enabled(p_coach);
$function$;

-- ── row security ────────────────────────────────────────────────────────────

alter table public.koutsi_open_slots enable row level security;
alter table public.koutsi_open_slot_coaches enable row level security;

-- The coach (and an admin acting as them) reads all their slots; a player their own bookings and
-- the open slots of today and later of their current coaches who have the feature.
drop policy if exists koutsi_open_slots_select on public.koutsi_open_slots;
create policy koutsi_open_slots_select on public.koutsi_open_slots
  for select to authenticated
  using (
    public.koutsi_acts_as(coach_id)
    or booked_by = (select auth.uid())
    or (
      booked_by is null
      and date >= (now() at time zone 'Europe/Helsinki')::date
      and public.koutsi_open_slots_visible(coach_id)
    )
  );

-- The coach removes an open slot; a booked one goes with its lesson.
drop policy if exists koutsi_open_slots_delete on public.koutsi_open_slots;
create policy koutsi_open_slots_delete on public.koutsi_open_slots
  for delete to authenticated
  using (coach_id = (select auth.uid()) and booked_by is null);

-- Slots are added and booked only by the functions below; the list is never read directly.
revoke all on public.koutsi_open_slots from anon, authenticated;
revoke all on public.koutsi_open_slot_coaches from anon, authenticated;
grant select, delete on public.koutsi_open_slots to authenticated;

-- ── writes ──────────────────────────────────────────────────────────────────

-- "ti 3.11. klo 17:00, ke 4.11. klo 18:00 ja 2 muuta": the coach's open slots added since p_since
-- (one publish, or a burst of them), for the players' notice.
create or replace function public.koutsi_open_slots_list(p_coach uuid, p_since timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_items text[];
  v_total integer;
begin
  select array_agg(public.koutsi_session_when(o.date, o.time) order by o.date, o.time), count(*)
    into v_items, v_total
    from public.koutsi_open_slots o
   where o.coach_id = p_coach and o.booked_by is null and o.created_at >= p_since;
  if coalesce(v_total, 0) = 0 then
    return '';
  end if;
  if v_total = 1 then
    return v_items[1];
  end if;
  if v_total <= 3 then
    return array_to_string(v_items[1:v_total - 1], ', ') || ' ja ' || v_items[v_total];
  end if;
  return array_to_string(v_items[1:3], ', ') || ' ja ' || (v_total - 3)::text
    || case when v_total - 3 = 1 then ' muu' else ' muuta' end;
end;
$function$;

-- The coach publishes free times. p_slots = [{ "date": "2026-11-03", "time": "17:00", "duration": 60,
-- "place": "Kenttä 2", "source": <private lesson id, optional> }], at most 50, each starting later
-- than now and within half a year. A time that is already open (or a lesson already offered) is
-- skipped. Returns how many were added; then each current player of the coach — not the player of
-- an offered lesson — gets one notice, or their unread one from the last 10 minutes is brought up
-- to date (koutsi_notify itself skips people without an account and paused notifications).
create or replace function public.koutsi_add_open_slots(p_slots jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_coach uuid := (select auth.uid());
  v_now timestamptz := now();
  v_local timestamp := (now() at time zone 'Europe/Helsinki');
  v_slot jsonb;
  v_date date;
  v_time time;
  v_len integer;
  v_place text;
  v_source uuid;
  v_source_player uuid;
  v_skip uuid[] := '{}';
  v_added integer := 0;
  v_n integer;
  v_name text;
  v_student uuid;
  v_prev record;
  v_merge boolean;
begin
  if v_coach is null then
    raise exception 'authentication required';
  end if;
  if not public.koutsi_open_slots_coach_enabled(v_coach) then
    raise exception 'Vapaat ajat eivät ole käytössä';
  end if;
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) = 0 then
    return 0;
  end if;
  if jsonb_array_length(p_slots) > 50 then
    raise exception 'Enintään 50 aikaa kerralla';
  end if;

  for v_slot in select value from jsonb_array_elements(p_slots) loop
    begin
      v_date := (v_slot ->> 'date')::date;
      v_time := (v_slot ->> 'time')::time;
      v_len := coalesce(nullif(v_slot ->> 'duration', '')::integer, 60);
      v_source := nullif(v_slot ->> 'source', '')::uuid;
    exception when others then
      raise exception 'Tarkista päivä, kellonaika ja kesto';
    end;
    if v_date is null or v_time is null then
      raise exception 'Valitse päivä ja kellonaika';
    end if;
    if v_date + v_time <= v_local then
      raise exception 'Vapaan ajan pitää olla tulevaisuudessa';
    end if;
    if v_date > v_local::date + 183 then
      raise exception 'Vapaita aikoja voi lisätä enintään puoli vuotta eteenpäin';
    end if;
    if v_len < 15 or v_len > 240 then
      raise exception 'Keston pitää olla 15–240 minuuttia';
    end if;
    v_place := nullif(btrim(coalesce(v_slot ->> 'place', '')), '');
    if v_place is not null and char_length(v_place) > 120 then
      raise exception 'Paikka on liian pitkä (enintään 120 merkkiä)';
    end if;
    if v_source is not null then
      select t.student_id into v_source_player
        from public.koutsi_trainings t
       where t.id = v_source and t.coach_id = v_coach and t.student_id is not null and t.logged_by <> 'player';
      if not found then
        raise exception 'Treeniä ei löytynyt';
      end if;
      v_skip := v_skip || v_source_player;
    end if;

    insert into public.koutsi_open_slots (coach_id, date, time, duration_minutes, place, source_training_id, created_at)
    values (v_coach, v_date, v_time, v_len, v_place, v_source, v_now)
    on conflict do nothing;
    get diagnostics v_n = row_count;
    v_added := v_added + v_n;
  end loop;

  -- slots that passed unbooked over a month ago are of no use to anyone
  delete from public.koutsi_open_slots
   where coach_id = v_coach and booked_by is null and date < v_local::date - 30;

  if v_added = 0 then
    return 0;
  end if;

  select coalesce(nullif(btrim(p.name), ''), 'Valmentajasi') into v_name
    from (select 1) x left join public.profiles p on p.id = v_coach;

  for v_student in
    select cs.student_id from public.koutsi_coach_students cs
     where cs.coach_id = v_coach and cs.ended_at is null and not (cs.student_id = any (v_skip))
  loop
    select n.id, n.created_at into v_prev
      from public.koutsi_notifications n
     where n.recipient_id = v_student
       and n.actor_id = v_coach
       and n.kind = 'open_slots'
       and n.created_at > v_now - interval '10 minutes'
       and n.read_at is null
       and n.email_status in ('pending', 'skipped')
     order by n.created_at desc
     limit 1
     for update;
    v_merge := found;
    if v_merge then
      update public.koutsi_notifications n
         set body = left(v_name || ': ' || public.koutsi_open_slots_list(v_coach, v_prev.created_at), 500),
             burst_count = n.burst_count + 1
       where n.id = v_prev.id;
    else
      perform public.koutsi_notify(v_student, v_coach, 'open_slots', 'Uusia vapaita aikoja',
        v_name || ': ' || public.koutsi_open_slots_list(v_coach, v_now), '/pelaaja/vapaat');
    end if;
  end loop;
  return v_added;
end;
$function$;

-- A player books an open slot; the first one wins. Returns the private lesson's id (the same id
-- again if this player already booked it — a double tap). Errors are the app's words.
create or replace function public.koutsi_book_open_slot(p_slot uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_quiet text := current_setting('koutsi.bulk_trainings', true);
  v_slot record;
  v_training uuid;
  v_who text;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  select * into v_slot from public.koutsi_open_slots where id = p_slot for update;
  if not found then
    raise exception 'Aikaa ei löytynyt. Se on ehkä poistettu.';
  end if;
  if v_slot.booked_by = v_uid then
    return v_slot.training_id;
  end if;
  if not public.koutsi_open_slots_visible(v_slot.coach_id) then
    raise exception 'Aikaa ei löytynyt. Se on ehkä poistettu.';
  end if;
  if v_slot.booked_by is not null then
    raise exception 'Joku ehti varata tämän ajan.';
  end if;
  if v_slot.date + v_slot.time <= (now() at time zone 'Europe/Helsinki') then
    raise exception 'Tämä aika on jo mennyt.';
  end if;

  -- The player booked it themself: no "Uusi treeni kalenterissasi" for them.
  perform set_config('koutsi.bulk_trainings', 'on', true);
  insert into public.koutsi_trainings (coach_id, student_id, date, time, type, logged_by, duration_minutes)
  values (v_slot.coach_id, v_uid, v_slot.date, v_slot.time, 'Yksityistunti', 'coach', v_slot.duration_minutes)
  returning id into v_training;
  perform set_config('koutsi.bulk_trainings', coalesce(v_quiet, ''), true);

  update public.koutsi_open_slots
     set booked_by = v_uid, booked_at = now(), training_id = v_training
   where id = p_slot;

  select coalesce(nullif(btrim(p.name), ''), nullif(btrim(s.display_name), ''), 'Pelaaja') into v_who
    from (select 1) x
    left join public.profiles p on p.id = v_uid
    left join public.koutsi_students s on s.id = v_uid;
  perform public.koutsi_notify(v_slot.coach_id, v_uid, 'slot_booked', v_who || ' varasi ajan',
    public.koutsi_session_when(v_slot.date, v_slot.time) || coalesce(' · ' || v_slot.place, ''),
    '/valmentaja/treeni/' || v_training);
  return v_training;
end;
$function$;

-- "Pääsen sittenkin" on a lesson that was offered to others: the time is not free any more, so its
-- slot goes away while nobody has booked it.
create or replace function public.koutsi_open_slot_unfree()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  delete from public.koutsi_open_slots o
   using public.koutsi_trainings t
   where o.source_training_id = old.training_id
     and o.booked_by is null
     and t.id = old.training_id
     and t.student_id = old.student_id;
  return old;
end;
$function$;

drop trigger if exists koutsi_open_slot_unfree on public.koutsi_training_absences;
create trigger koutsi_open_slot_unfree
  after delete on public.koutsi_training_absences
  for each row execute function public.koutsi_open_slot_unfree();

-- ── function rights ─────────────────────────────────────────────────────────

revoke all on function public.koutsi_open_slots_coach_enabled(uuid) from public, anon, authenticated;
revoke all on function public.koutsi_open_slots_list(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.koutsi_open_slot_unfree() from public, anon, authenticated;
revoke all on function public.koutsi_open_slots_enabled() from public, anon;
revoke all on function public.koutsi_open_slots_visible(uuid) from public, anon;
revoke all on function public.koutsi_add_open_slots(jsonb) from public, anon;
revoke all on function public.koutsi_book_open_slot(uuid) from public, anon;
grant execute on function public.koutsi_open_slots_enabled() to authenticated;
grant execute on function public.koutsi_open_slots_visible(uuid) to authenticated;
grant execute on function public.koutsi_add_open_slots(jsonb) to authenticated;
grant execute on function public.koutsi_book_open_slot(uuid) to authenticated;
