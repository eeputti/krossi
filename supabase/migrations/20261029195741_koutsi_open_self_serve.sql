-- 20261029195741_koutsi_open_self_serve.sql — new coaches can start the 3-month free trial without a
-- coach key (20261029193756_koutsi_coach_plans created this closed).
--
-- Applied to production 2026-10-29 (apply_migration koutsi_open_self_serve) after the user ran
-- scripts/koutsi-stripe-setup.mjs (KOUTSI_* secrets present) and the final tilausehdot,
-- käsittelysopimus and tietosuojaseloste went live (CF a7b6f564 = koutsi-prod df807dc).
-- Pause again with `select false`; the coach key works either way. Grants are kept (create or replace).
create or replace function public.koutsi_self_serve_open()
returns boolean
language sql
stable
set search_path = ''
as $$ select true $$;
