-- Mobilization records must accept the UUID identifiers used by candidates.
-- Text preserves any legacy numeric references while allowing current UUIDs.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.mobilizations
  alter column candidate_id type text
  using candidate_id::text;

commit;
