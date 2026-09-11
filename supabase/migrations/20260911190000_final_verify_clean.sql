-- Final read-only confirmation that no test data from today's join-code E2E verification
-- remains (the pre-existing "Testi Testaaja" coach from 2026-08-14, unrelated to this
-- verification and predating it, is deliberately left alone).
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.profiles
   where (name ilike 'testi %' or name ilike 'lotta %' or name ilike '%testi%'
       or name ilike 'probe%' or name ilike 'ihan eri%' or name ilike 'totally unmatched%'
       or name ilike 'fiona %' or name ilike 'daniel %' or name ilike 'cecil %' or name ilike 'bertta %')
     and created_at > '2026-09-11'::date;
  raise notice 'leftover test profiles created today: %', v_count;

  select count(*) into v_count from public.koutsi_coach_invite_codes where code like 'E2E%';
  raise notice 'leftover E2E test coach keys: %', v_count;
end $$;
