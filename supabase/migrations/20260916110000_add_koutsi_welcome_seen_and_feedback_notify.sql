-- Two small additions to the pilot's onboarding/feedback loop:
--
-- 1) welcome_seen_at gates the one-time "Tervetuloa Krossi Koutsiin!" popup shown on a
--    player's first visit. Covered by the existing koutsi_students_update RLS policy
--    (id = auth.uid()), so no new policy is needed.
-- 2) A player's feedback submission now emails the admin, reusing the existing
--    koutsi_notify -> koutsi_notifications -> cron -> Resend pipeline (same one
--    koutsi_notify_annual_plan already uses) instead of a new notification channel.

alter table public.koutsi_students add column if not exists welcome_seen_at timestamptz;

create or replace function public.koutsi_notify_feedback()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_admin uuid;
  v_player_name text;
  v_category_label text;
begin
  select coalesce(p.name, 'Pelaaja') into v_player_name from profiles p where p.id = new.student_id;
  v_category_label := case new.category
    when 'ei_toimi' then 'Jokin ei toimi'
    when 'ei_tasmaa' then 'Jokin ei täsmää'
    when 'hankala_kayttaa' then 'Jokin on hankala käyttää'
    when 'toimii_hyvin' then 'Jokin toimii tosi hyvin'
    else 'Muu'
  end;
  for v_admin in select user_id from koutsi_admins loop
    perform koutsi_notify(
      v_admin, new.student_id, 'player_feedback',
      'Uusi palaute Koutsista: ' || v_category_label,
      coalesce(v_player_name, 'Pelaaja') || ': ' || new.message,
      null
    );
  end loop;
  return new;
end;
$function$;

revoke all on function public.koutsi_notify_feedback() from public, anon, authenticated;

create trigger koutsi_feedback_notify_admin
after insert on public.koutsi_feedback
for each row execute function public.koutsi_notify_feedback();
