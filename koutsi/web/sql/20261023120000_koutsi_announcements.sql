-- Tiedotteet (new Koutsi, branch koutsi-selkeys): a coach's practical notice to some groups or
-- players — another coach tomorrow, a different court. Shown on the players' Koti until `until`
-- and never on anyone's Kehitys (that is what koutsi_diary_entries is for).
--
-- PENDING: apply only on the user's "aja migraatio"; then move this file into
-- supabase/migrations under the version the database gives it.
--
-- Who sees what (RLS):
--   * the coach reads, writes and deletes their own (koutsi_acts_as, so admins too)
--   * a player reads the ones sent to a group they are in (membership not ended) or to them
--   * a coach can only address their own groups and their own current players
-- Every addressed player with an account gets one notification (kind 'announcement'), which the
-- existing e-mail queue sends like any other Koutsi notification.

create table if not exists public.koutsi_announcements (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.koutsi_coaches(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  group_ids uuid[] not null default '{}',
  student_ids uuid[] not null default '{}',
  until date not null,
  created_at timestamptz not null default now(),
  constraint koutsi_announcements_has_audience check (cardinality(group_ids) + cardinality(student_ids) > 0),
  constraint koutsi_announcements_audience_size check (cardinality(group_ids) <= 60 and cardinality(student_ids) <= 400)
);

create index if not exists koutsi_announcements_coach_until_idx on public.koutsi_announcements (coach_id, until);
create index if not exists koutsi_announcements_groups_idx on public.koutsi_announcements using gin (group_ids);
create index if not exists koutsi_announcements_students_idx on public.koutsi_announcements using gin (student_ids);

alter table public.koutsi_announcements enable row level security;

drop policy if exists koutsi_announcements_select on public.koutsi_announcements;
create policy koutsi_announcements_select on public.koutsi_announcements
  for select to authenticated
  using (
    public.koutsi_acts_as(coach_id)
    or (select auth.uid()) = any (student_ids)
    or exists (
      select 1 from public.koutsi_group_members m
      where m.group_id = any (koutsi_announcements.group_ids)
        and m.student_id = (select auth.uid())
        and m.ended_at is null
    )
  );

drop policy if exists koutsi_announcements_insert on public.koutsi_announcements;
create policy koutsi_announcements_insert on public.koutsi_announcements
  for insert to authenticated
  with check (
    public.koutsi_acts_as(coach_id)
    and not exists (
      select 1 from unnest(group_ids) as gid
      where not exists (select 1 from public.koutsi_groups g where g.id = gid and g.coach_id = koutsi_announcements.coach_id)
    )
    and not exists (
      select 1 from unnest(student_ids) as sid
      where not exists (
        select 1 from public.koutsi_coach_students cs
        where cs.student_id = sid and cs.coach_id = koutsi_announcements.coach_id and cs.ended_at is null
      )
    )
  );

drop policy if exists koutsi_announcements_delete on public.koutsi_announcements;
create policy koutsi_announcements_delete on public.koutsi_announcements
  for delete to authenticated
  using (public.koutsi_acts_as(coach_id));

-- One notification per addressed player (a group's current members and the players named),
-- through koutsi_notify, which skips players without an account and the sender.
create or replace function public.koutsi_on_announcement_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coach text;
  r record;
begin
  select coalesce(name, 'Valmentajasi') into v_coach from profiles where id = new.coach_id;
  for r in
    select m.student_id as sid
      from koutsi_group_members m
     where m.group_id = any (new.group_ids) and m.ended_at is null
    union
    select unnest(new.student_ids) as sid
  loop
    perform koutsi_notify(r.sid, new.coach_id, 'announcement',
      'Tiedote valmentajaltasi',
      coalesce(v_coach, 'Valmentajasi') || ': ' || new.body, '/pelaaja');
  end loop;
  return new;
end;
$$;

drop trigger if exists koutsi_announcement_notify on public.koutsi_announcements;
create trigger koutsi_announcement_notify
  after insert on public.koutsi_announcements
  for each row execute function public.koutsi_on_announcement_insert();

-- A deleted player leaves no trace in the arrays; a notice left with nobody to reach is deleted.
-- (A deleted group's id is only a dangling uuid, no personal data, so groups get no trigger —
-- and deleting a coach cascades their notices away anyway.)
create or replace function public.koutsi_scrub_announcement_student()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from koutsi_announcements
   where old.id = any (student_ids) and cardinality(group_ids) = 0 and cardinality(array_remove(student_ids, old.id)) = 0;
  update koutsi_announcements set student_ids = array_remove(student_ids, old.id) where old.id = any (student_ids);
  return old;
end;
$$;

drop trigger if exists koutsi_students_scrub_announcements on public.koutsi_students;
create trigger koutsi_students_scrub_announcements
  after delete on public.koutsi_students
  for each row execute function public.koutsi_scrub_announcement_student();

revoke all on function public.koutsi_on_announcement_insert() from public, anon, authenticated;
revoke all on function public.koutsi_scrub_announcement_student() from public, anon, authenticated;

grant select, insert, delete on public.koutsi_announcements to authenticated;

-- Old notices go by themselves, 60 days after the last day they showed: a coach sees the past
-- month's in the app, and nothing needs them longer.
create or replace function public.koutsi_prune_announcements()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_deleted integer;
begin
  delete from public.koutsi_announcements where until < (now() - interval '60 days')::date;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

revoke all on function public.koutsi_prune_announcements() from public, anon, authenticated;
grant execute on function public.koutsi_prune_announcements() to service_role;

-- Every night at 03:27 UTC (the usage prune runs at 03:17). Idempotent; skipped where pg_cron
-- is not installed.
do $$
declare v_job record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;
  for v_job in select jobid from cron.job where jobname = 'koutsi-announcements-prune' loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  perform cron.schedule('koutsi-announcements-prune', '27 3 * * *', 'select public.koutsi_prune_announcements()');
end;
$$;
