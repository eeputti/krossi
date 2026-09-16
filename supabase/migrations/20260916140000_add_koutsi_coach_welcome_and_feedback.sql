-- Extends the player-only welcome popup + feedback form to coaches too.
--
-- 1) welcome_seen_at on koutsi_coaches, same gate as koutsi_students.welcome_seen_at.
--    Covered by the existing koutsi_coaches_update RLS policy (id = auth.uid()).
-- 2) koutsi_feedback.student_id was FK'd to koutsi_students(id), which only players
--    have a row in. Loosen it to auth.users(id) — every koutsi_students/koutsi_coaches
--    id is already a subset of auth.users(id), so this is a strict widening, not a
--    behavior change for existing rows. RLS (student_id = auth.uid()) already covers both.

alter table public.koutsi_coaches add column if not exists welcome_seen_at timestamptz;

alter table public.koutsi_feedback drop constraint koutsi_feedback_student_id_fkey;
alter table public.koutsi_feedback add constraint koutsi_feedback_student_id_fkey
  foreign key (student_id) references auth.users(id) on delete cascade;
