-- Default privileges give service_role more table rights than the deletion endpoint
-- needs. Keep the audit append-only even for that client and allow the identity value to
-- be generated during INSERT.
revoke all on table public.koutsi_admin_deletions from service_role;
grant select, insert on table public.koutsi_admin_deletions to service_role;

revoke all on sequence public.koutsi_admin_deletions_id_seq
  from public, anon, authenticated, service_role;
grant usage, select on sequence public.koutsi_admin_deletions_id_seq to service_role;
