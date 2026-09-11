-- Removes the single-use test coach key added in 20260911090000, its verification now
-- complete (found and fixed a real bug — see 20260911100000). The test coach account and
-- all its test player accounts were already deleted via their own self-service account
-- deletion, same as a real user would use.
delete from public.koutsi_coach_invite_codes where code = upper('e2etest911');
