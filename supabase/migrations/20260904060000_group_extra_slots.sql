-- A group has always had exactly one weekly day/time (koutsi_groups.weekday/time), but a
-- real group often trains twice a week at different times. Rather than reshaping the
-- group model (which koutsiMapGroup, the bulk-setup RPC, and the group form all assume
-- has a single primary slot), this adds *extra* slots as their own rows — the group's own
-- weekday/time stays the primary slot, unaffected. Each extra slot materializes its own
-- weekly koutsi_trainings series exactly like the primary slot does, so every existing
-- calendar view (coach, player, group detail) shows it with zero rendering changes: it's
-- just more rows with the same group_id.
create table public.koutsi_group_slots (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.koutsi_groups(id) on delete cascade,
  coach_id uuid not null references public.koutsi_coaches(id),
  weekday text not null check (weekday = any (array['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'])),
  time time not null,
  duration_minutes integer not null default 60
    check (duration_minutes > 0 and duration_minutes <= 480 and duration_minutes % 15 = 0),
  -- Ties this slot to the koutsi_trainings.series_id it generated, so deleting the slot
  -- can delete exactly its own future occurrences and nothing else.
  series_id uuid,
  created_at timestamptz not null default now()
);

comment on table public.koutsi_group_slots is
  'Additional weekly training times for a group beyond its primary koutsi_groups.weekday/time.';

alter table public.koutsi_group_slots enable row level security;

create policy "koutsi_group_slots_select" on public.koutsi_group_slots
  for select to authenticated
  using (public.koutsi_acts_as(coach_id) or public.koutsi_is_group_member(group_id));

create policy "koutsi_group_slots_insert" on public.koutsi_group_slots
  for insert to authenticated
  with check (public.koutsi_acts_as(coach_id));

create policy "koutsi_group_slots_update" on public.koutsi_group_slots
  for update to authenticated
  using (public.koutsi_acts_as(coach_id))
  with check (public.koutsi_acts_as(coach_id));

create policy "koutsi_group_slots_delete" on public.koutsi_group_slots
  for delete to authenticated
  using (public.koutsi_acts_as(coach_id));

create index koutsi_group_slots_group_id_idx on public.koutsi_group_slots (group_id);
