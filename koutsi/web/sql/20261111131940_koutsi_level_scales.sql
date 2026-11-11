-- 20261111131940_koutsi_level_scales.sql — "Pelaajien tasot": each coach's own level scale.
--
-- kind 'sanat'   = Aloittelija, Keskitaso, Edistynyt, Kilpapelaaja (the old fixed list; also what a coach
--                  without a row has, so nothing changes for anyone who never opens the setting)
--      'numerot' = 1..size, a bigger number is a better player (e.g. 1 = harrastaja, 6 = C-tason kilpapelaaja)
--      'ei'      = the coach doesn't use levels: the level fields hide in the app
-- notes[i] = the coach's own short words for step i + 1 (optional).
--
-- The levels themselves stay where they are: koutsi_students.level ('4') and koutsi_groups.level ('3–4') as
-- text, so old data and the old app are untouched. The app never converts old texts by itself.
--
-- Read: the coach (and an admin acting as one) and the coach's current players, who see the note under their
-- own level (the app shows a level only to a player whose age is 18 or more). Write: the coach only.
-- Without this table the app keeps the words and hides the setting.
-- The other change: the group roster RPC stops sending group mates' levels to players (end of the file).

create table if not exists public.koutsi_level_scales (
  coach_id uuid primary key references public.koutsi_coaches(id) on delete cascade,
  kind text not null default 'sanat',
  size smallint,
  notes text[] not null default '{}',
  updated_at timestamptz not null default now(),
  constraint koutsi_level_scales_kind check (kind in ('sanat', 'numerot', 'ei')),
  constraint koutsi_level_scales_size check (size is null or size between 3 and 10),
  constraint koutsi_level_scales_numbers check (kind <> 'numerot' or size is not null),
  constraint koutsi_level_scales_notes check (cardinality(notes) <= 10 and length(array_to_string(notes, '')) <= 700)
);

alter table public.koutsi_level_scales enable row level security;

drop policy if exists koutsi_level_scales_select on public.koutsi_level_scales;
create policy koutsi_level_scales_select on public.koutsi_level_scales for select to authenticated
  using (public.koutsi_acts_as(coach_id) or public.koutsi_is_my_coach(coach_id));

drop policy if exists koutsi_level_scales_insert on public.koutsi_level_scales;
create policy koutsi_level_scales_insert on public.koutsi_level_scales for insert to authenticated
  with check (public.koutsi_acts_as(coach_id));

drop policy if exists koutsi_level_scales_update on public.koutsi_level_scales;
create policy koutsi_level_scales_update on public.koutsi_level_scales for update to authenticated
  using (public.koutsi_acts_as(coach_id)) with check (public.koutsi_acts_as(coach_id));

revoke all on public.koutsi_level_scales from anon, authenticated;
grant select, insert, update on public.koutsi_level_scales to authenticated;

-- ── group mates' levels stay with the coach ──────────────────────────────────
-- koutsi_player_group_roster() gave every player their group mates' levels (the old app showed them on the
-- group page). A level is the coach's note about one player, so the roster now sends none: same columns,
-- level always null, so both apps keep working. A player's own level comes from their own row as before.
create or replace function public.koutsi_player_group_roster()
 returns TABLE(group_id uuid, student_id uuid, name text, avatar_url text, level text)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select distinct
         mine.group_id,
         peer.student_id,
         coalesce(nullif(btrim(p.name), ''), nullif(btrim(s.display_name), ''), 'Pelaaja') as name,
         p.avatar_url,
         null::text as level
    from public.koutsi_group_members mine
    join public.koutsi_groups g
      on g.id = mine.group_id
    join public.koutsi_coach_students mine_link
      on mine_link.coach_id = g.coach_id
     and mine_link.student_id = mine.student_id
     and mine_link.ended_at is null
    join public.koutsi_group_members peer
      on peer.group_id = mine.group_id
     and peer.ended_at is null
    join public.koutsi_coach_students peer_link
      on peer_link.coach_id = g.coach_id
     and peer_link.student_id = peer.student_id
     and peer_link.ended_at is null
    join public.koutsi_students s
      on s.id = peer.student_id
    left join public.profiles p
      on p.id = peer.student_id
   where (select auth.uid()) is not null
     and mine.student_id = (select auth.uid())
     and mine.ended_at is null
   order by mine.group_id, name, peer.student_id;
$function$;
