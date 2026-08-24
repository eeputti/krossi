-- Attendance is shared between coach and player. Keep one row per missed training:
-- no row means present, while a row carries the absence type and an optional explanation.
alter table public.koutsi_training_absences
  add column note text,
  add column reported_by uuid references auth.users(id) on delete set null,
  add column updated_at timestamptz not null default now();

alter table public.koutsi_training_absences
  add constraint koutsi_training_absences_note_length
  check (note is null or char_length(note) <= 2000);

-- The primary key starts with training_id because the calendar loads attendance per
-- training. These indexes cover player history, RLS lookups and the new reporter FK.
create index koutsi_training_absences_student_id_idx
  on public.koutsi_training_absences (student_id, training_id);

create index koutsi_training_absences_reported_by_idx
  on public.koutsi_training_absences (reported_by)
  where reported_by is not null;

create or replace function public.koutsi_stamp_training_absence()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  new.reported_by := coalesce((select auth.uid()), new.reported_by);
  new.updated_at := now();
  return new;
end;
$function$;

revoke all on function public.koutsi_stamp_training_absence() from public, anon, authenticated;

create trigger koutsi_training_absences_stamp
before insert or update on public.koutsi_training_absences
for each row execute function public.koutsi_stamp_training_absence();

-- Anonymous visitors do not need any access. Signed-in coaches can manage attendance for
-- their own sessions, and a signed-in player can manage only their own row on a session
-- they are actually assigned to (individual or active group membership).
revoke all on table public.koutsi_training_absences from anon, authenticated;
grant select, insert, update, delete on table public.koutsi_training_absences to authenticated;

drop policy if exists koutsi_absences_select on public.koutsi_training_absences;
create policy koutsi_absences_select
on public.koutsi_training_absences for select
to authenticated
using (
  student_id = (select auth.uid())
  or exists (
    select 1
      from public.koutsi_trainings t
     where t.id = koutsi_training_absences.training_id
       and public.koutsi_acts_as(t.coach_id)
  )
);

drop policy if exists koutsi_absences_insert on public.koutsi_training_absences;
create policy koutsi_absences_insert
on public.koutsi_training_absences for insert
to authenticated
with check (
  exists (
    select 1
      from public.koutsi_trainings t
     where t.id = koutsi_training_absences.training_id
       and (
         (
           public.koutsi_acts_as(t.coach_id)
           and (
             t.student_id = koutsi_training_absences.student_id
             or exists (
               select 1
                 from public.koutsi_group_members gm
                where gm.group_id = t.group_id
                  and gm.student_id = koutsi_training_absences.student_id
                  and gm.ended_at is null
             )
           )
         )
         or (
           koutsi_training_absences.student_id = (select auth.uid())
           and (
             t.student_id = (select auth.uid())
             or (
               t.group_id is not null
               and (select public.koutsi_is_group_member(t.group_id))
             )
           )
         )
       )
  )
);

drop policy if exists koutsi_absences_update on public.koutsi_training_absences;
create policy koutsi_absences_update
on public.koutsi_training_absences for update
to authenticated
using (
  student_id = (select auth.uid())
  or exists (
    select 1
      from public.koutsi_trainings t
     where t.id = koutsi_training_absences.training_id
       and public.koutsi_acts_as(t.coach_id)
  )
)
with check (
  exists (
    select 1
      from public.koutsi_trainings t
     where t.id = koutsi_training_absences.training_id
       and (
         (
           public.koutsi_acts_as(t.coach_id)
           and (
             t.student_id = koutsi_training_absences.student_id
             or exists (
               select 1
                 from public.koutsi_group_members gm
                where gm.group_id = t.group_id
                  and gm.student_id = koutsi_training_absences.student_id
                  and gm.ended_at is null
             )
           )
         )
         or (
           koutsi_training_absences.student_id = (select auth.uid())
           and (
             t.student_id = (select auth.uid())
             or (
               t.group_id is not null
               and (select public.koutsi_is_group_member(t.group_id))
             )
           )
         )
       )
  )
);

drop policy if exists koutsi_absences_delete on public.koutsi_training_absences;
create policy koutsi_absences_delete
on public.koutsi_training_absences for delete
to authenticated
using (
  student_id = (select auth.uid())
  or exists (
    select 1
      from public.koutsi_trainings t
     where t.id = koutsi_training_absences.training_id
       and public.koutsi_acts_as(t.coach_id)
  )
);
