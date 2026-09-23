-- Captured from production history: applied directly to the database, no local file
-- existed for it yet.

revoke execute on function public.current_user_has_paid() from public;
grant execute on function public.current_user_has_paid() to authenticated;
