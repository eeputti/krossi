-- Merkitse taps (koutsi_ui_events, 20261014122952) are kept no longer than the anonymous usage
-- events: the nightly koutsi-usage-prune job now deletes rows older than 180 days from both.
-- The Merkitse rows keep their user_id (the user chose that, so Ylläpito can show how many
-- different coaches use each tile); they also go with the account (on delete cascade). The
-- privacy notice (koutsi-tietosuoja.html, "Käyttötilastot") says both.
--
-- Replaces one function; the cron job from 20261014085856 keeps calling it unchanged.
-- Applied to production 2026-10-14 with the user's go-ahead (version 20261014123344).
create or replace function public.koutsi_prune_usage_events()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_usage integer;
  v_taps integer;
begin
  delete from public.koutsi_usage_events where at < now() - interval '180 days';
  get diagnostics v_usage = row_count;
  delete from public.koutsi_ui_events where created_at < now() - interval '180 days';
  get diagnostics v_taps = row_count;
  return v_usage + v_taps;
end;
$function$;

revoke all on function public.koutsi_prune_usage_events() from public, anon, authenticated;
grant execute on function public.koutsi_prune_usage_events() to service_role;
