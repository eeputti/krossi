-- Nelinpeli (doubles) has two players per side, but koutsi_match_notes only ever had
-- room for one opponent and no way to record who your own partner was.
alter table public.koutsi_match_notes
  add column if not exists partner_name text,
  add column if not exists opponent2_name text;

comment on column public.koutsi_match_notes.partner_name is 'Nelinpelissä pelaajan oma pari.';
comment on column public.koutsi_match_notes.opponent2_name is 'Nelinpelissä toinen vastustaja (opponent_name on ensimmäinen).';
