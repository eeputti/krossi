-- Krossi: "Peli huomenna" -muistutukset sähköpostilla.
--
-- Krossi: game reminder emails. Once an hour pg_cron runs krossi_dispatch_game_reminders(),
-- which POSTs to the krossi-reminders edge function with the x-krossi-cron-key header. The
-- function checks that header with krossi_cron_key_valid() and emails everyone in a Krossi
-- game starting in 2–26 hours (see supabase/functions/krossi-reminders/index.ts).
--
-- Mirrors Koutsi's koutsi_dispatch_notification_emails() / 'koutsi-notify-dispatch' pattern
-- with its own names. Krossi-only and purely additive: no Koutsi object, table, policy or
-- cron job is touched.
--
--   krossi_cron_key_valid(text)          edge function's caller check (service_role only)
--   krossi_dispatch_game_reminders()     pg_cron -> edge function call
--   krossi_email_log_kind_ref_idx        "has this game's reminder gone out?" lookups
--   cron job 'krossi-game-reminders'     hourly at minute 7
--
-- The key lives only in Vault. It is NOT created here, so its value never lands in the
-- migration history. Create it once, out of band (SQL editor / execute_sql), after this
-- migration and after deploying the function:
--
--   select vault.create_secret(
--     encode(extensions.gen_random_bytes(32), 'hex'),
--     'krossi_cron_key',
--     'Krossi game reminder cron key'
--   );
--
-- Until the secret exists the cron job does nothing (the dispatcher returns quietly) and
-- the edge function rejects every caller. To rotate: vault.update_secret(<id>, <new value>).


-- ── Cron key check ───────────────────────────────────────────────────────────
-- Compares SHA-256 digests rather than the raw strings, so an early-exit comparison
-- leaks nothing useful about the key. A missing / empty secret or input is always false.
create or replace function public.krossi_cron_key_valid(key_input text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secret text;
begin
  if key_input is null or length(key_input) = 0 or length(key_input) > 256 then
    return false;
  end if;

  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'krossi_cron_key';

  if v_secret is null or length(v_secret) = 0 then
    return false;
  end if;

  return extensions.digest(key_input, 'sha256') = extensions.digest(v_secret, 'sha256');
end;
$function$;

revoke all on function public.krossi_cron_key_valid(text) from public, anon, authenticated;
grant execute on function public.krossi_cron_key_valid(text) to service_role;


-- ── Dispatcher (pg_cron -> krossi-reminders) ─────────────────────────────────
-- Same shape as koutsi_dispatch_notification_emails(). The URL is fixed (it isn't a
-- secret); only the key comes from Vault. pg_net is asynchronous: this returns at once
-- and the response lands in net._http_response.
create or replace function public.krossi_dispatch_game_reminders()
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'krossi_cron_key';
  if v_key is null or v_key = '' then
    return;
  end if;

  perform net.http_post(
    url     := 'https://hhybjpgrvlbazbqiaaao.supabase.co/functions/v1/krossi-reminders',
    headers := jsonb_build_object('content-type', 'application/json', 'x-krossi-cron-key', v_key),
    body    := '{"type":"game_reminders"}'::jsonb,
    timeout_milliseconds := 20000
  );
end;
$function$;

revoke all on function public.krossi_dispatch_game_reminders() from public, anon, authenticated;
grant execute on function public.krossi_dispatch_game_reminders() to service_role;


-- ── Email log lookup by game ─────────────────────────────────────────────────
-- krossi-reminders asks "who already got kind 'game_reminder' for these game ids?";
-- the existing (user_id, kind, ref_id, sent_at) index can't serve that without user_id.
create index if not exists krossi_email_log_kind_ref_idx
  on public.krossi_email_log (kind, ref_id);


-- ── Schedule: hourly at minute 7 ─────────────────────────────────────────────
-- Idempotent: drop an existing job of the same name first, then schedule it fresh.
do $do$
declare
  v_job record;
begin
  for v_job in select jobid from cron.job where jobname = 'krossi-game-reminders' loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$do$;

select cron.schedule(
  'krossi-game-reminders',
  '7 * * * *',
  $cron$select public.krossi_dispatch_game_reminders();$cron$
);

notify pgrst, 'reload schema';
