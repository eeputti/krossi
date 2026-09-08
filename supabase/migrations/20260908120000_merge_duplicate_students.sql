-- Bulk setup and "luo uusi pelaaja tähän ryhmään" both always insert a brand-new student —
-- neither checks whether a same-named player already exists. A coach re-running either flow
-- for the same real player (typically because they now train in a second group) ends up
-- with two koutsi_students rows for one person. Give coaches a way to collapse the mistaken
-- duplicate into the real profile instead of losing its group memberships and history.
--
-- Merging only ever removes the "duplicate" side of the pair, and only when that side is
-- still an unclaimed placeholder (placeholder_coach_id is set): it has no auth account or
-- login of its own, so deleting its koutsi_students row after re-parenting its data is safe.
-- A player who has already claimed their account cannot be the side that disappears here —
-- doing that would silently kill a real login, which is well beyond what a coach should be
-- able to trigger. The same collapsing logic already exists for koutsi_claim_player, which
-- re-parents a placeholder's data onto the real account id it's being claimed into; this
-- mirrors that pattern in the other direction (coach-triggered, placeholder into placeholder
-- or placeholder into an already-claimed student).
create or replace function public.koutsi_merge_students(
  coach_id_input uuid,
  keep_student_id uuid,
  remove_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid    uuid := auth.uid();
  v_coach  uuid := coalesce(coach_id_input, auth.uid());
  v_remove public.koutsi_students%rowtype;
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
  if keep_student_id is null or remove_student_id is null or keep_student_id = remove_student_id then
    raise exception 'Valitse kaksi eri pelaajaa yhdistämistä varten';
  end if;

  if not exists (
    select 1 from public.koutsi_coach_students
     where coach_id = v_coach and student_id = keep_student_id and ended_at is null
  ) then
    raise exception 'Säilytettävää pelaajaa ei löytynyt oppilaslistaltasi';
  end if;

  select * into v_remove from public.koutsi_students where id = remove_student_id for update;
  if not found
     or v_remove.placeholder_coach_id is null
     or v_remove.placeholder_coach_id <> v_coach
  then
    raise exception 'Tätä pelaajaa ei voi yhdistää — hän on jo lunastanut oman tilinsä, tai ei ole oppilaslistallasi';
  end if;

  -- Tables with no uniqueness on student_id: a plain move.
  update public.koutsi_diary_entries set student_id = keep_student_id where student_id = remove_student_id;
  update public.koutsi_homework set student_id = keep_student_id where student_id = remove_student_id;
  update public.koutsi_moods set student_id = keep_student_id where student_id = remove_student_id;
  update public.koutsi_match_notes set student_id = keep_student_id where student_id = remove_student_id;
  update public.koutsi_player_history set student_id = keep_student_id where student_id = remove_student_id;
  update public.koutsi_trainings set student_id = keep_student_id where student_id = remove_student_id;

  -- Shared-video rows are unique per (share_id, student_id): drop the duplicate's copy of
  -- any video the kept student was already sent, then move the rest.
  delete from public.koutsi_videos v
   where v.student_id = remove_student_id
     and exists (
       select 1 from public.koutsi_videos k
        where k.share_id = v.share_id and k.student_id = keep_student_id
     );
  update public.koutsi_videos set student_id = keep_student_id where student_id = remove_student_id;

  -- Absence rows are keyed per (training_id, student_id): same dance.
  delete from public.koutsi_training_absences a
   where a.student_id = remove_student_id
     and exists (
       select 1 from public.koutsi_training_absences b
        where b.training_id = a.training_id and b.student_id = keep_student_id
     );
  update public.koutsi_training_absences set student_id = keep_student_id where student_id = remove_student_id;

  -- Group membership is keyed per (group_id, student_id) — this is the actual point of the
  -- merge: the kept student ends up in the union of both students' groups (e.g. one had a
  -- Wednesday group and the other a Friday group; the survivor gets both).
  delete from public.koutsi_group_members a
   where a.student_id = remove_student_id
     and exists (
       select 1 from public.koutsi_group_members b
        where b.group_id = a.group_id and b.student_id = keep_student_id
     );
  update public.koutsi_group_members set student_id = keep_student_id, ended_at = null
   where student_id = remove_student_id;

  delete from public.koutsi_coach_students where coach_id = v_coach and student_id = remove_student_id;
  delete from public.koutsi_students where id = remove_student_id;

  return jsonb_build_object('kept_id', keep_student_id, 'removed_id', remove_student_id);
end;
$function$;

revoke all on function public.koutsi_merge_students(uuid, uuid, uuid) from public, anon;
grant execute on function public.koutsi_merge_students(uuid, uuid, uuid) to authenticated, service_role;
