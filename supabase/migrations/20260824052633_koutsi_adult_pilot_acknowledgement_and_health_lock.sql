-- The first external Koutsi pilot is deliberately limited to adults and excludes
-- special-category health data. The acknowledgement is stored server-side so an old
-- browser, a second device or a cleared localStorage cannot bypass the gate.
create table public.koutsi_pilot_acknowledgements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  terms_version text not null,
  privacy_version text not null,
  adult_confirmed_at timestamptz not null,
  restricted_data_rules_confirmed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint koutsi_pilot_ack_terms_version_length
    check (char_length(terms_version) between 1 and 80),
  constraint koutsi_pilot_ack_privacy_version_length
    check (char_length(privacy_version) between 1 and 80)
);

alter table public.koutsi_pilot_acknowledgements enable row level security;

revoke all on table public.koutsi_pilot_acknowledgements from public, anon, authenticated;
grant select, insert, update on table public.koutsi_pilot_acknowledgements to authenticated;

create policy koutsi_pilot_ack_select_own
on public.koutsi_pilot_acknowledgements for select
to authenticated
using ((select auth.uid()) = user_id);

create policy koutsi_pilot_ack_insert_own
on public.koutsi_pilot_acknowledgements for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy koutsi_pilot_ack_update_own
on public.koutsi_pilot_acknowledgements for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Remove any pre-pilot content from the fields that explicitly invited health data.
-- `background` also contained a few generic goals, but goals have their own dedicated
-- fields. Clearing the mixed-purpose field is safer than trying to classify free text.
update public.koutsi_students
   set background = null
 where background is not null;

-- Enforce the pilot limits below the UI as well. Adults with a real account may have a
-- null age because the shared Krossi profile stores an age range; the recorded adult
-- acknowledgement is the authoritative pilot gate. Placeholder players created by a
-- coach must always have an explicit adult age.
create or replace function public.koutsi_enforce_pilot_student_limits()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if nullif(btrim(coalesce(new.background, '')), '') is not null then
    if tg_op = 'INSERT' then
      raise exception 'Terveys- ja taustatietoja ei voi tallentaa aikuisten beta-pilotissa';
    elsif new.background is distinct from old.background then
      raise exception 'Terveys- ja taustatietoja ei voi tallentaa aikuisten beta-pilotissa';
    end if;
  end if;

  new.background := null;

  if new.age is not null and new.age < 18 then
    if tg_op = 'INSERT' then
      raise exception 'Koutsi-beta on rajattu vähintään 18-vuotiaille';
    elsif new.age is distinct from old.age then
      raise exception 'Koutsi-beta on rajattu vähintään 18-vuotiaille';
    end if;
  end if;

  if new.placeholder_coach_id is not null and new.age is null then
    raise exception 'Anna testipelaajalle vähintään 18 vuoden ikä';
  end if;

  return new;
end;
$function$;

revoke all on function public.koutsi_enforce_pilot_student_limits() from public, anon, authenticated;

create trigger koutsi_students_pilot_limits
before insert or update on public.koutsi_students
for each row execute function public.koutsi_enforce_pilot_student_limits();

-- A closed pilot must be invitation-only below the UI as well. Existing student rows are
-- left intact, but new users cannot create a standalone Koutsi without a coach invite.
revoke execute on function public.start_koutsi_without_code() from public, anon, authenticated;
