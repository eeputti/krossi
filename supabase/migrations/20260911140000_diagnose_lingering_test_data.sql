-- Read-only diagnostic (no schema/data change): lists any profile that looks like leftover
-- test data from the join-code E2E verification runs (20260911090000 / 20260911131408),
-- so it's clear whether those test accounts were already cleaned up via their own
-- self-service account deletion or are still lingering in production.
do $$
declare
  r record;
begin
  raise notice '--- profiles matching likely test-name patterns ---';
  for r in
    select p.id, p.name, p.created_at,
           exists(select 1 from public.koutsi_coaches c where c.id = p.id) as is_coach,
           exists(select 1 from public.koutsi_students s where s.id = p.id) as is_student
      from public.profiles p
     where p.name ilike 'testi %' or p.name ilike 'lotta %' or p.name ilike '%testi%'
        or p.name ilike 'probe%' or p.name ilike 'ihan eri%' or p.name ilike 'totally unmatched%'
     order by p.created_at desc
  loop
    raise notice 'id=% name=% created_at=% is_coach=% is_student=%', r.id, r.name, r.created_at, r.is_coach, r.is_student;
  end loop;

  raise notice '--- remaining koutsi_coach_invite_codes rows (test keys) ---';
  for r in select code, note, expires_at, use_count, max_uses from public.koutsi_coach_invite_codes
            where code in ('E2ETEST911', 'E2EJOIN911')
  loop
    raise notice 'code=% note=% expires_at=% use_count=%/%', r.code, r.note, r.expires_at, r.use_count, r.max_uses;
  end loop;
end $$;
