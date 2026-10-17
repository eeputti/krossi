-- Krossi: kenttävarauksen kesken jääneet palautukset viiden minuutin välein (krossi-booking-cron).
--   * jaettu maksu: kaverin maksaman osuuden summa varaajalle, jos se ei heti mennyt läpi
--     (krossi_split_refunds_due)
--   * peruttu tai myyty vuoro: varaajan ja kavereiden maksut (krossi_booking_refunds_due)
-- Sovellus ja stripe-webhook tekevät palautukset heti; tämä viimeistelee vain sen, mikä jäi kesken.
--
-- Same pattern as krossi_dispatch_game_reminders (20261005120000_krossi_game_reminders): pg_cron
-- runs krossi_dispatch_booking_tasks(), which POSTs to the krossi-booking-cron edge function with
-- the x-krossi-cron-key header (the existing Vault secret 'krossi_cron_key', shared with
-- krossi-reminders). Apply this only after krossi-booking-cron is deployed (verify_jwt = false)
-- and 20261016130000_krossi_booking_split_and_resale is in. Until the secret exists the job does
-- nothing. Krossi-only and additive: no Koutsi object or job is touched.

create or replace function public.krossi_dispatch_booking_tasks()
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
    url     := 'https://hhybjpgrvlbazbqiaaao.supabase.co/functions/v1/krossi-booking-cron',
    headers := jsonb_build_object('content-type', 'application/json', 'x-krossi-cron-key', v_key),
    body    := '{"type":"booking_tasks"}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$function$;

revoke all on function public.krossi_dispatch_booking_tasks() from public, anon, authenticated;
grant execute on function public.krossi_dispatch_booking_tasks() to service_role;

-- Every five minutes. Idempotent: drop an existing job of the same name first.
do $do$
declare
  v_job record;
begin
  for v_job in select jobid from cron.job where jobname = 'krossi-booking-tasks' loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$do$;

select cron.schedule(
  'krossi-booking-tasks',
  '*/5 * * * *',
  $cron$select public.krossi_dispatch_booking_tasks();$cron$
);

notify pgrst, 'reload schema';
