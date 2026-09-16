-- Negative feedback is always more useful, but a quick "this works really well" option
-- costs nothing and makes the form feel less like a complaint box.

alter table public.koutsi_feedback drop constraint koutsi_feedback_category_check;
alter table public.koutsi_feedback add constraint koutsi_feedback_category_check
  check (category in ('ei_toimi', 'ei_tasmaa', 'hankala_kayttaa', 'toimii_hyvin', 'muu'));
