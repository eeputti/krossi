-- Captured from production history: applied directly to the database, no local file
-- existed for it yet. 20260912155238 revoked execute from "public", which in Postgres
-- does not imply anon — anon still had it via its own default grant.

revoke execute on function public.current_user_has_paid() from anon;
