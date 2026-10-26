-- koutsi_resume_notifications — notifications on again (owner's OK 2026-10-26: "Korjaa tulva,
-- sitten päälle"), now with the burst and e-mail rules of koutsi_smart_notifications.
-- To pause them again: replace this function with one that returns true.
create or replace function public.koutsi_notifications_paused()
returns boolean
language sql
stable
set search_path = ''
as $$ select false $$;

revoke all on function public.koutsi_notifications_paused() from public, anon, authenticated;
