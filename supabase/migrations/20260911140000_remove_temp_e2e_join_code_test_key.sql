-- Cleanup for the temporary single-use coach key added in
-- 20260911131428_temp_e2e_join_code_test_key.sql to verify the join-code flow end to end.
-- It already served its purpose (use_count reached its max_uses of 1) and its own comment
-- promised removal right after verification — same pattern as
-- 20260911124923_remove_temp_e2e_test_coach_key.sql.
delete from public.koutsi_coach_invite_codes where code = upper('e2ejoin911');
