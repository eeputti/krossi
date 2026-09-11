-- Re-checks for profiles created since the previous check (20260911160000, up to
-- 2026-09-11 17:16:48) to see whether new test accounts are still actively appearing
-- (a concurrent process still running) or the batch was static (safe to clean up now).
do $$
declare
  r record;
  v_count integer;
begin
  select count(*) into v_count from public.profiles where created_at > '2026-09-11 17:16:48+00'::timestamptz;
  raise notice 'profiles created since last check (17:16:48): %', v_count;
  for r in
    select id, name, created_at from public.profiles
     where created_at > '2026-09-11 17:16:48+00'::timestamptz
     order by created_at desc
  loop
    raise notice 'NEW SINCE LAST CHECK: id=% name=% created_at=%', r.id, r.name, r.created_at;
  end loop;
end $$;
