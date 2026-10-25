-- koutsi_seasons follow-up: the new SECURITY DEFINER functions are not for anonymous callers.
-- The app calls koutsi_seasons_enabled and koutsi_publish_season as a signed-in user; the other three
-- run only inside the koutsi_groups trigger and other definer functions (as their owner).
revoke all on function public.koutsi_current_season(uuid) from public, anon, authenticated;
revoke all on function public.koutsi_latest_group(uuid) from public, anon, authenticated;
revoke all on function public.koutsi_groups_set_season() from public, anon, authenticated;
revoke all on function public.koutsi_seasons_enabled() from public, anon;
revoke all on function public.koutsi_publish_season(jsonb, uuid) from public, anon;
grant execute on function public.koutsi_seasons_enabled() to authenticated;
grant execute on function public.koutsi_publish_season(jsonb, uuid) to authenticated;
