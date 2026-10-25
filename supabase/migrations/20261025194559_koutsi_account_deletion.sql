-- Applied 25.10.2026 after the user's "aja migraatio".
-- Check: koutsi/web/sql/20261026090000_koutsi_account_deletion.check.mjs
--
-- Deleting an account must remove the person's Koutsi data, whoever deletes it. Until now only
-- the user's own "Poista tili" (koutsi-delete-account → delete_my_koutsi_data) removed the
-- koutsi_students row. Koutsi Ylläpito, Krossi Ylläpito, the Supabase dashboard and plain SQL
-- delete only auth.users, and koutsi_students.id has no foreign key to auth.users (placeholder
-- players have no account), so a deleted player's row and everything keyed on it stayed behind:
-- goal, notes, age and level, history, coach links, group places. On 25.10.2026 production had
-- 8 such rows, one of them a real player still on a coach's list.
--
-- Deleting a coach failed outright in two ways (3 of 5 coaches on 25.10.2026): a group slot
-- blocks it (koutsi_group_slots.coach_id has no ON DELETE action), and upcoming sessions break
-- it (the cascade removes them, the cancel trigger writes "Treeni peruttu" naming the coach as
-- actor, and the coach's account is already gone, so the koutsi_notifications foreign key fails).
--
-- 1. koutsi_private.delete_account_data(uuid): what a Koutsi account owns, in one place.
-- 2. A BEFORE DELETE trigger on auth.users runs it for every deleted account, in the same
--    transaction. If it fails, the account is not deleted either, so nothing is left half-done.
-- 3. One-off: remove the player rows whose account is already gone. Placeholder players
--    (placeholder_coach_id set) never had an account and are kept.
--
-- Storage files are not database rows: the admin and self-service Edge Functions still remove
-- them through the Storage API before they delete the account.

create or replace function koutsi_private.delete_account_data(target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_quiet text := current_setting('koutsi.bulk_trainings', true);
  v_student integer := 0;
  v_coach integer := 0;
begin
  if target_user_id is null then
    return jsonb_build_object('student', 0, 'coach', 0);
  end if;

  -- Removing sessions would otherwise write a "Treeni peruttu" notification for every future
  -- session (cleaned up again below, but a deletion should not write notifications at all).
  perform set_config('koutsi.bulk_trainings', 'on', true);

  -- As a player. The rest cascades from koutsi_students: moods, entries, history, diary,
  -- homework, match notes, absences, videos, own sessions, coach links, group places and
  -- personal codes; its delete trigger also takes the player off announcements.
  delete from public.koutsi_session_checkin_log where student_id = target_user_id;
  delete from public.koutsi_students where id = target_user_id;
  get diagnostics v_student = row_count;

  -- As a coach. koutsi_coaches cascades groups, sessions, seasons, codes, links and the coach's
  -- own placeholder players. These would stay behind (foreign key set null) or block it (no
  -- cascade on group slots), so they go first, the same way delete_my_koutsi_data() does it.
  delete from public.koutsi_diary_entries where coach_id = target_user_id;
  delete from public.koutsi_videos where added_by_id = target_user_id;
  delete from public.koutsi_group_slots where coach_id = target_user_id;
  delete from public.koutsi_trainings where coach_id = target_user_id;
  delete from public.koutsi_coaches where id = target_user_id;
  get diagnostics v_coach = row_count;

  -- Notifications this person caused name them in the text. Notifications to them, settings,
  -- feedback, app opens and the profile have a foreign key to auth.users and go with the account.
  delete from public.koutsi_notifications where actor_id = target_user_id;

  perform set_config('koutsi.bulk_trainings', coalesce(v_quiet, ''), true);
  return jsonb_build_object('student', v_student, 'coach', v_coach);
end;
$function$;

create or replace function koutsi_private.on_auth_user_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform koutsi_private.delete_account_data(old.id);
  -- A BEFORE DELETE trigger has to hand the row back, or the account would not be deleted.
  return old;
end;
$function$;

-- Only the trigger (running as the function owner) may call these, never the app.
revoke all on function koutsi_private.delete_account_data(uuid) from public, anon, authenticated, service_role;
revoke all on function koutsi_private.on_auth_user_delete() from public, anon, authenticated, service_role;

drop trigger if exists koutsi_delete_account_data on auth.users;
create trigger koutsi_delete_account_data
  before delete on auth.users
  for each row execute function koutsi_private.on_auth_user_delete();

-- One-off: player rows whose account was deleted before this trigger existed.
do $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select s.id
      from public.koutsi_students s
     where s.placeholder_coach_id is null
       and not exists (select 1 from auth.users u where u.id = s.id)
  loop
    perform koutsi_private.delete_account_data(v_id);
    v_count := v_count + 1;
  end loop;
  raise notice 'koutsi: removed % player rows whose account was already deleted', v_count;
end $$;
