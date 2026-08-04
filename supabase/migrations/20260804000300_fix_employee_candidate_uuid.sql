-- Employee records must retain the UUID of the candidate they came from.
-- Text preserves legacy numeric references and prevents duplicate conversions.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.employees
  alter column source_candidate_id type text
  using source_candidate_id::text;

commit;
