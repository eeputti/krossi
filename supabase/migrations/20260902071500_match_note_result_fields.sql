-- koutsi_match_notes has so far only held a free-text tactical note plus the opponent's
-- name and the date — no duration, no win/loss, no score, no singles/doubles. A player
-- could not build any real match history out of it. All four are optional so every
-- existing row stays valid; the note field remains the primary content.

alter table public.koutsi_match_notes
  add column duration_minutes integer
    check (duration_minutes is null or (duration_minutes > 0 and duration_minutes <= 300)),
  add column result text
    check (result is null or result in ('voitto', 'tappio')),
  add column format text
    check (format is null or format in ('kaksinpeli', 'nelinpeli')),
  add column score text;

comment on column public.koutsi_match_notes.duration_minutes is 'Ottelun kesto minuutteina.';
comment on column public.koutsi_match_notes.result is 'Ottelun lopputulos pelaajan kannalta: voitto tai tappio.';
comment on column public.koutsi_match_notes.format is 'Kaksinpeli tai nelinpeli.';
comment on column public.koutsi_match_notes.score is 'Erien tulos vapaana tekstinä, esim. "6-4 6-3".';
