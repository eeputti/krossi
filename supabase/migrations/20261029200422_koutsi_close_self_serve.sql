-- 20261029200422_koutsi_close_self_serve.sql — new coaches need a coach key again: the 3-month trial
-- without a key is closed (20261029195741_koutsi_open_self_serve had opened it).
--
-- Applied to production 2026-10-29 (apply_migration koutsi_close_self_serve) on the user's word
-- ("tarttee valmentaja-avaimen"). Trials already started keep running (one, started 20:02 UTC).
-- Open again with `select true`; the coach key works either way. Grants are kept (create or replace).
create or replace function public.koutsi_self_serve_open()
returns boolean
language sql
stable
set search_path = ''
as $$ select false $$;
