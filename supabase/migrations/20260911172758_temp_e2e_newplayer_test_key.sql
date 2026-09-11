-- Temporary: a second single-use coach key, needed because the previous verification's
-- test coach account (and its temp key row) was already cleaned up mid-run by a concurrent
-- session before the last remaining join-code branch ("brand new player via a shared code")
-- could be exercised. Same fully-fictional-data rule as 20260911131408. Expires in a day,
-- max_uses 1; the test coach and player accounts it creates are self-deleted at the end,
-- and this row is removed by a follow-up migration.
insert into public.koutsi_coach_invite_codes (code, note, expires_at, max_uses)
values (upper('e2ejoin912'), 'Claude E2E-testi (uusi pelaaja jaetulla koodilla) — poistetaan heti verifioinnin jälkeen', now() + interval '1 day', 1);
