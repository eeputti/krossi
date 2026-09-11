-- Final read-only check: any profile created in roughly the same window as today's E2E
-- testing, regardless of name pattern, to catch anything the name-based diagnostic
-- (20260911140000) might have missed before declaring cleanup complete.
do $$
declare
  r record;
begin
  raise notice '--- profiles created in the last 20 hours ---';
  for r in
    select id, name, created_at
      from public.profiles
     where created_at > now() - interval '20 hours'
     order by created_at desc
  loop
    raise notice 'id=% name=% created_at=%', r.id, r.name, r.created_at;
  end loop;
end $$;
