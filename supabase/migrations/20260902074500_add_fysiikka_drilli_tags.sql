-- The exercise/video library only had tags for on-court skills (syotto, liikkuminen,
-- pistepeli, verkkopeli, tekniikka, lammittely) — no way to categorise physical training
-- or a plain drill link, which is exactly what should replace a coach's WhatsApp links.

alter table public.koutsi_exercises drop constraint koutsi_exercises_tags_check;
alter table public.koutsi_exercises add constraint koutsi_exercises_tags_check
  check (tags <@ array['syotto', 'liikkuminen', 'pistepeli', 'verkkopeli', 'tekniikka', 'lammittely', 'fysiikka', 'drilli']);

alter table public.koutsi_videos drop constraint koutsi_videos_tags_check;
alter table public.koutsi_videos add constraint koutsi_videos_tags_check
  check (tags <@ array['syotto', 'liikkuminen', 'pistepeli', 'verkkopeli', 'tekniikka', 'lammittely', 'fysiikka', 'drilli']);
