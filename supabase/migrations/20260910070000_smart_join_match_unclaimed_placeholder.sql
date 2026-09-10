-- The "share one code with the whole group" flow (InviteCodeBox already offers a
-- "koko ryhmälle" / max-20-uses code) only ever inserted a brand-new koutsi_students row
-- on redeem, even when the coach had already pre-created that exact player by name. A
-- player who joins through the shared code instead of their own personal link — the coach
-- dictated the code by voice, a chat app's link preview stripped the ?oppilas= param, they
-- open the app from a bookmark later instead of the original link — silently got a second,
-- empty profile while the one the coach had been logging work into sat unclaimed. That
-- already happened for real: see koutsi_merge_students, added to let a coach clean it up
-- after the fact, and the "Nämä saattavat olla sama pelaaja kahdesti" banner in
-- StudentsView that surfaces it once it's happened.
--
-- Deliberately does not call the existing koutsi_coach_for_code helper: its body isn't
-- captured in any tracked migration (see the coach_join_codes / group_invite_codes schema
-- in general — it predates this repo's migration history), so its side effects can't be
-- verified from here. Resolving the code with a plain, read-only select instead — mirroring
-- the exact "active" rule koutsiListInviteCodes already computes client-side in
-- koutsi-data.js — keeps this provably free of side effects like consuming a limited-use
-- code's use_count just for a lookup. Shared by both functions below via this helper, which
-- also resolves the code's group_id when it's a group-specific invite code (not the coach's
-- coach-wide permanent code) — so a code minted from inside one group only ever matches or
-- lists players who are actually members of that group, never the coach's other groups.
create or replace function public.koutsi_resolve_join_code(code_input text, out coach_id uuid, out group_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(code_input, '')));
begin
  if v_code = '' then
    return;
  end if;

  select cj.coach_id into coach_id
    from public.koutsi_coach_join_codes cj
   where cj.code = v_code;
  -- The coach's own permanent code has no single group — group_id stays null.

  if coach_id is null then
    select gi.coach_id, gi.group_id into coach_id, group_id
      from public.koutsi_group_invite_codes gi
     where gi.code = v_code
       and gi.revoked_at is null
       and (gi.expires_at is null or gi.expires_at > now())
       and (gi.max_uses is null or gi.use_count < gi.max_uses);
  end if;
end;
$$;

revoke all on function public.koutsi_resolve_join_code(text) from public, anon, authenticated;

-- This lets the join screen ask "is this you?" before defaulting to a new profile: given a
-- code and the player's own (already-typed, already-authenticated) profile name, look for
-- exactly one unclaimed placeholder — among the coach's roster, or that group's members
-- only when the code is group-specific — with a matching name. Tries an exact normalized
-- match first; if that finds nobody, falls back to matching on first name alone (split on
-- the first space) — a coach is explicitly told elsewhere in the UI to tell two
-- same-first-name players apart with a surname initial ("Lotta W."), so the player's own
-- full name ("Lotta Wirtanen") won't literally equal the placeholder's and needs this
-- looser tier to still be found. Either tier only ever returns a result when it is the
-- single unambiguous candidate — two placeholders sharing a (first) name, or none at all,
-- and this stays silent — so someone holding the shared code still cannot use it to browse
-- or fish through the coach's roster (koutsi_unclaimed_players stays locked down for the
-- same reason), and a coincidence never causes the wrong profile to be offered. This
-- function only ever *suggests*; the actual claim still goes through koutsi_claim_player,
-- which independently re-checks that the placeholder belongs to the coach behind the code
-- before moving any data. Whatever this can't resolve — different tiers matching different
-- people, nicknames, typos — is left to koutsi_unclaimed_players_for_code below, which the
-- join screen falls back to on an explicit "I think I'm already on the list" tap, same as
-- the existing "Nämä saattavat olla sama pelaaja kahdesti" banner + koutsi_merge_students
-- clean up a duplicate that still slips through, after the fact.
create or replace function public.koutsi_match_unclaimed_player(code_input text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_coach uuid;
  v_group uuid;
  v_name  text;
  v_norm  text;
  v_first text;
  v_id    uuid;
  v_display_name text;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select coach_id, group_id into v_coach, v_group from public.koutsi_resolve_join_code(code_input);

  -- Invalid/expired/revoked/own-code cases are left for the real claim/redeem call that
  -- follows to raise its normal, already-handled error — this function just declines to
  -- suggest anything.
  if v_coach is null or v_coach = v_uid then
    return null;
  end if;

  select p.name into v_name from public.profiles p where p.id = v_uid;
  v_norm := lower(btrim(regexp_replace(coalesce(v_name, ''), '\s+', ' ', 'g')));
  if v_norm = '' then
    return null;
  end if;
  v_first := split_part(v_norm, ' ', 1);

  select count(*), min(s.id), min(s.display_name) into v_count, v_id, v_display_name
    from public.koutsi_students s
   where s.placeholder_coach_id = v_coach
     and (v_group is null or exists (
       select 1 from public.koutsi_group_members gm
        where gm.group_id = v_group and gm.student_id = s.id and gm.ended_at is null
     ))
     and lower(btrim(regexp_replace(s.display_name, '\s+', ' ', 'g'))) = v_norm;

  if v_count = 1 then
    return jsonb_build_object('id', v_id, 'name', v_display_name);
  end if;
  if v_count > 1 then
    return null; -- ambiguous even at the exact tier — never guess
  end if;

  -- Nobody matched the full name exactly (v_count = 0 above) — fall back to first-name-only.
  select count(*), min(s.id), min(s.display_name) into v_count, v_id, v_display_name
    from public.koutsi_students s
   where s.placeholder_coach_id = v_coach
     and (v_group is null or exists (
       select 1 from public.koutsi_group_members gm
        where gm.group_id = v_group and gm.student_id = s.id and gm.ended_at is null
     ))
     and split_part(lower(btrim(regexp_replace(s.display_name, '\s+', ' ', 'g'))), ' ', 1) = v_first;

  if v_count <> 1 then
    return null;
  end if;

  return jsonb_build_object('id', v_id, 'name', v_display_name);
end;
$$;

revoke all on function public.koutsi_match_unclaimed_player(text) from public, anon;
grant execute on function public.koutsi_match_unclaimed_player(text) to authenticated;

-- No automatic match above can be fully trusted — a nickname, a typo, a name given in a
-- different order all defeat it silently, and silently is exactly the failure mode that
-- must not happen here: it's what creates the duplicate profile this whole feature exists
-- to prevent. So when the automatic tiers find nothing, the join screen offers an explicit
-- "I think I'm already on the list" step, and only then calls this to show the coach's (or,
-- for a group-specific code, just that group's) still-unclaimed player names for the player
-- to pick themselves — a person recognizing their own name in a short list cannot fail the
-- way string matching can.
--
-- This is deliberately a separate, narrower function from koutsi_unclaimed_players (which
-- stays revoked from everyone): it only returns names, not the fuller roster detail that
-- function exposes, and — like koutsi_match_unclaimed_player — only after independently
-- resolving the code itself (and its group, if any) rather than trusting a caller-supplied
-- id. The coach's roster is small by design in this pilot (koutsi-pilotti-ohje.md: 2-5
-- players) and the shared code itself is only ever handed to that same small,
-- already-mutually-known group, so this trades a small, deliberate disclosure — gated
-- behind an explicit ask, not shown by default, and scoped to one group when the code is
-- group-specific — for removing the silent-failure risk entirely.
create or replace function public.koutsi_unclaimed_players_for_code(code_input text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_coach uuid;
  v_group uuid;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select coach_id, group_id into v_coach, v_group from public.koutsi_resolve_join_code(code_input);

  if v_coach is null or v_coach = v_uid then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.display_name) order by s.display_name), '[]'::jsonb)
    into v_result
    from (
      select s.id, s.display_name
        from public.koutsi_students s
       where s.placeholder_coach_id = v_coach
         and (v_group is null or exists (
           select 1 from public.koutsi_group_members gm
            where gm.group_id = v_group and gm.student_id = s.id and gm.ended_at is null
         ))
       order by s.display_name
       limit 100
    ) s;

  return v_result;
end;
$$;

revoke all on function public.koutsi_unclaimed_players_for_code(text) from public, anon;
grant execute on function public.koutsi_unclaimed_players_for_code(text) to authenticated;
