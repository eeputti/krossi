-- koutsi_claim_player copied a claimed placeholder's pilot_age_group and
-- minor_notice_confirmed_*/guardian_approval_confirmed_* columns onto the target account
-- unconditionally, unlike every other field it merges (age, level, goal, ... all use
-- coalesce(t.x, v_ph.x) — keep what the real account already has, only fill in what's
-- missing). A player who already has a real Koutsi account — because they'd already
-- claimed one placeholder — and then claims a second placeholder from a different coach
-- would have their existing, already-confirmed pilot age-group/consent silently
-- overwritten by whatever that second placeholder happened to hold, which can desync from
-- what koutsi_validate_pilot_acknowledgement expects them to have already confirmed.
-- Switch these four fields to the same coalesce-keep-existing pattern as the rest.
create or replace function public.koutsi_claim_player(code_input text, student_id_input uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_coach uuid;
  v_ph koutsi_students%rowtype;
  v_coach_name text;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not exists (select 1 from profiles where id = v_uid) then
    raise exception 'profile required';
  end if;

  v_coach := public.koutsi_coach_for_code(code_input);
  if v_coach is null then raise exception 'invalid invite code'; end if;
  if v_coach = v_uid then raise exception 'own coach code'; end if;

  select * into v_ph from koutsi_students where id = student_id_input for update;
  if not found or v_ph.placeholder_coach_id is null or v_ph.placeholder_coach_id <> v_coach then
    raise exception 'Tätä profiilia ei voi lunastaa';
  end if;

  perform set_config('app.koutsi_claiming', 'on', true);

  insert into koutsi_students (
    id, age, pilot_age_group,
    minor_notice_confirmed_at, minor_notice_confirmed_by,
    guardian_approval_confirmed_at, guardian_approval_confirmed_by
  ) values (
    v_uid, v_ph.age, v_ph.pilot_age_group,
    v_ph.minor_notice_confirmed_at, v_ph.minor_notice_confirmed_by,
    v_ph.guardian_approval_confirmed_at, v_ph.guardian_approval_confirmed_by
  ) on conflict (id) do nothing;
  update koutsi_students t set
    age = coalesce(t.age, v_ph.age),
    level = coalesce(t.level, v_ph.level),
    goal = coalesce(t.goal, v_ph.goal),
    focus = coalesce(t.focus, v_ph.focus),
    background = coalesce(t.background, v_ph.background),
    last_session_note = coalesce(t.last_session_note, v_ph.last_session_note),
    player_note = coalesce(t.player_note, v_ph.player_note),
    player_wish = coalesce(t.player_wish, v_ph.player_wish),
    pilot_age_group = coalesce(t.pilot_age_group, v_ph.pilot_age_group),
    minor_notice_confirmed_at = coalesce(t.minor_notice_confirmed_at, v_ph.minor_notice_confirmed_at),
    minor_notice_confirmed_by = coalesce(t.minor_notice_confirmed_by, v_ph.minor_notice_confirmed_by),
    guardian_approval_confirmed_at = coalesce(t.guardian_approval_confirmed_at, v_ph.guardian_approval_confirmed_at),
    guardian_approval_confirmed_by = coalesce(t.guardian_approval_confirmed_by, v_ph.guardian_approval_confirmed_by)
  where t.id = v_uid;

  update koutsi_diary_entries set student_id = v_uid where student_id = v_ph.id;
  update koutsi_homework set student_id = v_uid where student_id = v_ph.id;
  update koutsi_videos set student_id = v_uid where student_id = v_ph.id;
  update koutsi_moods set student_id = v_uid where student_id = v_ph.id;
  update koutsi_match_notes set student_id = v_uid where student_id = v_ph.id;
  update koutsi_player_history set student_id = v_uid where student_id = v_ph.id;
  update koutsi_trainings set student_id = v_uid where student_id = v_ph.id;

  delete from koutsi_coach_students a
   where a.student_id = v_ph.id
     and exists (select 1 from koutsi_coach_students b
                 where b.coach_id = a.coach_id and b.student_id = v_uid);
  update koutsi_coach_students set student_id = v_uid, ended_at = null where student_id = v_ph.id;

  delete from koutsi_group_members a
   where a.student_id = v_ph.id
     and exists (select 1 from koutsi_group_members b
                 where b.group_id = a.group_id and b.student_id = v_uid);
  update koutsi_group_members set student_id = v_uid, ended_at = null where student_id = v_ph.id;

  delete from koutsi_training_absences a
   where a.student_id = v_ph.id
     and exists (select 1 from koutsi_training_absences b
                 where b.training_id = a.training_id and b.student_id = v_uid);
  update koutsi_training_absences set student_id = v_uid where student_id = v_ph.id;

  insert into koutsi_coach_students (coach_id, student_id)
  values (v_coach, v_uid)
  on conflict (coach_id, student_id) do update set ended_at = null;

  delete from koutsi_students where id = v_ph.id;
  select name into v_coach_name from profiles where id = v_coach;
  return jsonb_build_object('coach_id', v_coach, 'coach_name', v_coach_name, 'claimed', true);
end;
$function$;
