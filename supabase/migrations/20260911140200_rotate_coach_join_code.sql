-- The coach's own permanent code (koutsi_coach_join_codes: one row per coach, assigned by
-- koutsi_assign_join_code on coach creation) had no way to be changed once issued, even
-- though InviteCodeBox explicitly warns a coach not to share it publicly. If it leaks —
-- posted in the wrong chat, read over the phone to the wrong person — there was no way to
-- invalidate it short of a manual database edit, unlike the expiring/revocable group codes.
--
-- A coach's permanent code is looked up only by its `code` value (koutsi_coach_for_code,
-- redeem_koutsi_invite_code, koutsi_my_join_code via RLS), never by a separate stable id, so
-- simply replacing the value on that same row is already a full, immediate revocation of the
-- old code — no new column needed. Reuses koutsi_generate_join_code() so the replacement
-- draws from the same alphabet and the same collision check against both code tables.
create or replace function public.koutsi_rotate_join_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_code text;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if not exists (select 1 from public.koutsi_coaches where id = v_uid) then
    raise exception 'not a coach';
  end if;

  v_code := public.koutsi_generate_join_code();

  update public.koutsi_coach_join_codes
     set code = v_code
   where coach_id = v_uid;

  if not found then
    insert into public.koutsi_coach_join_codes (coach_id, code) values (v_uid, v_code);
  end if;

  return v_code;
end;
$$;

revoke all on function public.koutsi_rotate_join_code() from public, anon;
grant execute on function public.koutsi_rotate_join_code() to authenticated;
