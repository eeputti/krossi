-- Coaches have no way to permanently remove a player at all — "Päätä valmennussuhde"
-- deliberately only unlinks (keeps history, in case the player later claims their own
-- account), and koutsi_merge_students only ever folds one placeholder into another
-- profile, never just erases one outright. That leaves no way to undo a mistake like an
-- accidentally created or duplicate placeholder player.
--
-- This adds a real, permanent delete — restricted to unclaimed placeholders only, same
-- guard as merge: a player who has already claimed their account has a real login of
-- their own, so a coach must never be able to unilaterally erase it. Every table with a
-- student_id foreign key is already ON DELETE CASCADE, so removing the koutsi_students
-- row is enough to clear that player from everywhere (groups, trainings, diary, homework,
-- videos, moods, match notes, attendance, join codes).
create or replace function public.koutsi_delete_placeholder_student(
  coach_id_input uuid,
  student_id_input uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid     uuid := auth.uid();
  v_coach   uuid := coalesce(coach_id_input, auth.uid());
  v_student public.koutsi_students%rowtype;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if v_coach <> v_uid and not public.koutsi_is_admin() then
    raise exception 'not allowed';
  end if;
  if not exists (
    select 1 from public.koutsi_coaches c
     where c.id = v_coach and c.archived_at is null
  ) then
    raise exception 'not a coach';
  end if;

  select * into v_student from public.koutsi_students where id = student_id_input for update;
  if not found
     or v_student.placeholder_coach_id is null
     or v_student.placeholder_coach_id <> v_coach
  then
    raise exception 'Tätä pelaajaa ei voi poistaa — hän on jo lunastanut oman tilinsä, tai ei ole oppilaslistallasi';
  end if;

  delete from public.koutsi_students where id = student_id_input;
end;
$function$;

revoke all on function public.koutsi_delete_placeholder_student(uuid, uuid) from public, anon;
grant execute on function public.koutsi_delete_placeholder_student(uuid, uuid) to authenticated, service_role;
