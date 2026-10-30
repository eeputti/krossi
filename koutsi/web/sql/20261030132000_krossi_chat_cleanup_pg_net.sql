-- 20261030132000_krossi_chat_cleanup_pg_net.sql — Krossi's nightly chat-image cleanup has failed every
-- night since 2026-05-25: its cron job calls extensions.http_post (the `http` extension), which is not
-- installed. pg_net is, so the job now calls the same edge function (cleanup-chat-images, no JWT) with
-- net.http_post. Behaviour is as designed: images on chat messages older than 14 days are removed.
-- On 2026-10-30 there were no chat images at all, so the first run removes nothing.
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'cleanup-expired-chat-images'),
  command := $job$
    select net.http_post(
      url := 'https://hhybjpgrvlbazbqiaaao.supabase.co/functions/v1/cleanup-chat-images',
      body := '{}'::jsonb,
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  $job$
);
