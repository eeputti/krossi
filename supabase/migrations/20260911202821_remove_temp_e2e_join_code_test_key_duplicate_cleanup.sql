-- The E2EJOIN911 test key (added outside any tracked migration during today's join-code
-- E2E verification, then removed by 20260911173052_remove_temp_e2e_join_code_test_key.sql)
-- turned up again — reused for the follow-up "new player" verification round instead of a
-- fresh code — so it needed removing a second time. Captured here purely so this repo's
-- migration history matches what actually ran against the live project; the delete itself
-- is a no-op if the key is already gone.
delete from public.koutsi_coach_invite_codes where code = upper('e2ejoin911');
