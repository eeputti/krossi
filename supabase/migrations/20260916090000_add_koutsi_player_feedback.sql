-- Quick in-app feedback channel for pilot players: "something doesn't work / doesn't
-- match / is a bit awkward to use". No email notification yet — the coach/admin checks
-- this table directly (via the table editor or a service-role query); can be wired to
-- a notification later if volume warrants it.

create table public.koutsi_feedback (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.koutsi_students(id) on delete cascade,
  category text not null check (category in ('ei_toimi', 'ei_tasmaa', 'hankala_kayttaa', 'muu')),
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.koutsi_feedback enable row level security;

create policy "koutsi_feedback_player_insert" on public.koutsi_feedback
  for insert to authenticated
  with check (student_id = (select auth.uid()));
