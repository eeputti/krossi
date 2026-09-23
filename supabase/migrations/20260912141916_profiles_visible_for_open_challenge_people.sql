-- Captured from production history: applied directly to the database, no local file
-- existed for it yet. Superseded later the same week by the payment-gated version of
-- this same policy (see 20260912155033_add_krossi_payment_gate.sql), kept here so the
-- migration history stays complete and replayable.

create policy "challenge people visible to browsers"
on public.profiles
for select
to authenticated
using (
  exists (
    select 1
    from public.challenges c
    where c.status in ('open', 'filled')
      and (
        c.creator_id = profiles.id
        or exists (
          select 1
          from public.challenge_participants cp
          where cp.challenge_id = c.id
            and cp.user_id = profiles.id
        )
      )
  )
);
