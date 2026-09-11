-- Temporary: a single-use coach key for an automated end-to-end verification of the
-- placeholder/group join-code feature (20260910070000 / 20260911070000), using fully
-- fictional data per KOUTSI-PILOTTI-OHJE.md's pre-DPA rule. Expires in a day and is
-- max_uses 1 as a safety net; the test coach account it creates is deleted via its own
-- koutsi_delete_account call at the end of the verification, and this row is removed by a
-- follow-up migration.
insert into public.koutsi_coach_invite_codes (code, note, expires_at, max_uses)
values (upper('e2etest911'), 'Claude E2E-testi — poistetaan heti verifioinnin jälkeen', now() + interval '1 day', 1);
