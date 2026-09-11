-- Second and (per the recheck in 20260911170000 — no new accounts appearing, batch is
-- static) final round of leftover fictional test accounts from the join-code E2E
-- verification, missed by the first name-pattern diagnostic (20260911140000) because their
-- names didn't match its filter.
delete from auth.users
 where id in (
   '5f3da33b-a8d9-40c6-86cb-16c0e95f5d6e', -- "Fiona Uusipelaaja"
   '200db0e3-b33d-4292-8a43-147865a2caee', -- "Daniel Ambigu Kolmas"
   '2ecf5b6f-e2ff-4947-a2d6-5af1c6c66339', -- "Cecil Uusisukunimi"
   '52717207-181e-4744-ac29-859fcee019a7'  -- "Bertta Tarkkanimi"
 );

do $$
declare
  v_left integer;
begin
  select count(*) into v_left from public.profiles
   where id in (
     '5f3da33b-a8d9-40c6-86cb-16c0e95f5d6e',
     '200db0e3-b33d-4292-8a43-147865a2caee',
     '2ecf5b6f-e2ff-4947-a2d6-5af1c6c66339',
     '52717207-181e-4744-ac29-859fcee019a7'
   );
  raise notice 'remaining profiles for these 4 test ids after cleanup: %', v_left;
end $$;
