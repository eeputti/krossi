-- Removes the three leftover fictional test accounts the join-code E2E verification (and
-- this diagnostic pass) left behind — no credentials were available to self-delete them the
-- normal way (koutsi-delete-account), so this deletes the auth.users rows directly; profiles
-- and everything keyed off them are expected to cascade from there the same way real account
-- deletion ultimately relies on. A NOTICE block confirms nothing related is left over.
delete from auth.users
 where id in (
   '057197d6-c548-453d-9031-6b7e29b56f22', -- "Probe Only" — this diagnostic's own throwaway probe
   'be234fd2-f3f2-4ef9-8d59-b2f68c34e6a7', -- "Player Suora Testi"
   'f5cdf747-fa30-49e4-97bd-33cd0d22292e'  -- "Testi Koutsi E2E"
 );

delete from public.koutsi_coach_invite_codes where code = 'E2EJOIN911';

do $$
declare
  v_left integer;
begin
  select count(*) into v_left from public.profiles
   where id in (
     '057197d6-c548-453d-9031-6b7e29b56f22',
     'be234fd2-f3f2-4ef9-8d59-b2f68c34e6a7',
     'f5cdf747-fa30-49e4-97bd-33cd0d22292e'
   );
  raise notice 'remaining profiles for the 3 test ids after cleanup: %', v_left;
end $$;
