-- Renewed Koutsi (koutsi/web) — the player's tennis profile on Muokkaa profiilia.
-- APPLIED 2026-10-25 with the user's OK ("Tee tietokantamuutos ja aja se"), prod version 20261025194643.
-- Tested first in PGlite: koutsi/web/sql/20261025200000_koutsi_player_tennis_profile.check.mjs.
--
-- Four optional, player-owned columns on koutsi_students:
--   plays_hand      'oikea' | 'vasen'                       (Pelikäsi)
--   favourite_shot  one of the shots below                  (Lempilyönti)
--   playing_since   the year they started playing           (Pelannut vuodesta)
--   tennis_story    a few words of their tennis history,    (Tennistaustasi — e.g. breaks:
--                   at most 300 characters                   "pelasin junnuna, tauko, palasin 2023")
-- Only the player writes them, like goal / wish / note (the coach branch of the ownership trigger
-- keeps the old values); every coach of the player reads them with the student row. The app shows
-- the health-data reminder under tennis_story, as under every free-text field.
--
-- The old Koutsi is not affected: it never selects or writes these columns by name. The new app
-- works without this migration: the Tennis card stays hidden until the columns exist.

alter table public.koutsi_students
  add column if not exists plays_hand text,
  add column if not exists favourite_shot text,
  add column if not exists playing_since smallint,
  add column if not exists tennis_story text;

alter table public.koutsi_students
  drop constraint if exists koutsi_students_plays_hand_check,
  add constraint koutsi_students_plays_hand_check check (plays_hand is null or plays_hand in ('oikea', 'vasen')),
  drop constraint if exists koutsi_students_favourite_shot_check,
  add constraint koutsi_students_favourite_shot_check check (favourite_shot is null or favourite_shot in
    ('forehand', 'rysty', 'syotto', 'palautus', 'lentolyonti', 'smash', 'pudotus', 'lobbi')),
  drop constraint if exists koutsi_students_playing_since_check,
  add constraint koutsi_students_playing_since_check check (playing_since is null or playing_since between 1930 and 2100),
  drop constraint if exists koutsi_students_tennis_story_length,
  add constraint koutsi_students_tennis_story_length check (tennis_story is null or char_length(tennis_story) <= 300);

-- Same function as before (20261021083503), plus the four new player-owned columns in the coach branch.
create or replace function public.koutsi_enforce_student_column_ownership()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if coalesce(current_setting('app.koutsi_claiming', true), '') = 'on' then
    return new;
  end if;
  if auth.uid() = old.id then
    new.background := old.background;
    new.last_session_note := old.last_session_note;
    new.focus := old.focus;
    new.level := old.level;
  else
    new.goal := old.goal;
    new.player_note := old.player_note;
    new.player_wish := old.player_wish;
    new.long_goal := old.long_goal;
    new.ambition := old.ambition;
    new.plays_hand := old.plays_hand;
    new.favourite_shot := old.favourite_shot;
    new.playing_since := old.playing_since;
    new.tennis_story := old.tennis_story;
  end if;
  new.pilot_age_group := old.pilot_age_group;
  new.minor_notice_confirmed_at := old.minor_notice_confirmed_at;
  new.minor_notice_confirmed_by := old.minor_notice_confirmed_by;
  new.guardian_approval_confirmed_at := old.guardian_approval_confirmed_at;
  new.guardian_approval_confirmed_by := old.guardian_approval_confirmed_by;
  return new;
end;
$function$;
