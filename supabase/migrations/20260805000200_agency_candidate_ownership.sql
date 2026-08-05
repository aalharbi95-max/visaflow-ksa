-- Give agency-originated candidate and interview rows immutable UUID ownership.
-- This removes the fragile dependency on a mutable agency display name.

alter table public.candidates
  add column if not exists agency_id uuid;

alter table public.interviews
  add column if not exists agency_id uuid;

create index if not exists candidates_company_agency_created_idx
  on public.candidates (company_id, agency_id, created_at desc);

create index if not exists interviews_company_agency_candidate_idx
  on public.interviews (company_id, agency_id, candidate_id);

-- Backfill only deterministic name matches. Ambiguous or unmatched legacy rows stay
-- null and remain visible to the owning company, but not to an agency account.
update public.candidates as candidate
set agency_id = matched.id
from (
  select lower(trim(name)) as normalized_name, min(id) as id
  from public.agencies
  where nullif(trim(name), '') is not null
  group by lower(trim(name))
  having count(*) = 1
) as matched
where candidate.agency_id is null
  and nullif(trim(candidate.agency), '') is not null
  and lower(trim(candidate.agency)) = matched.normalized_name;

update public.interviews as interview
set agency_id = candidate.agency_id
from public.candidates as candidate
where interview.agency_id is null
  and interview.candidate_id = candidate.id
  and interview.company_id = candidate.company_id
  and candidate.agency_id is not null;

update public.interviews as interview
set agency_id = matched.id
from (
  select lower(trim(name)) as normalized_name, min(id) as id
  from public.agencies
  where nullif(trim(name), '') is not null
  group by lower(trim(name))
  having count(*) = 1
) as matched
where interview.agency_id is null
  and nullif(trim(interview.agency), '') is not null
  and lower(trim(interview.agency)) = matched.normalized_name;

drop policy if exists vf_candidates_agency_select on public.candidates;
create policy vf_candidates_agency_select on public.candidates
for select to authenticated
using (
  agency_id is not null
  and public.visaflow_agency_can(company_id, agency_id, 'read')
);

drop policy if exists vf_candidates_agency_insert on public.candidates;
create policy vf_candidates_agency_insert on public.candidates
for insert to authenticated
with check (
  agency_id is not null
  and public.visaflow_agency_can(company_id, agency_id, 'upload_candidates')
);

drop policy if exists vf_candidates_agency_update on public.candidates;
create policy vf_candidates_agency_update on public.candidates
for update to authenticated
using (
  agency_id is not null
  and public.visaflow_agency_can(company_id, agency_id, 'update_candidates')
)
with check (
  agency_id is not null
  and public.visaflow_agency_can(company_id, agency_id, 'update_candidates')
);

drop policy if exists vf_interviews_agency_select on public.interviews;
create policy vf_interviews_agency_select on public.interviews
for select to authenticated
using (
  agency_id is not null
  and public.visaflow_agency_can(company_id, agency_id, 'view_interviews')
);

drop policy if exists vf_interviews_agency_insert on public.interviews;
create policy vf_interviews_agency_insert on public.interviews
for insert to authenticated
with check (
  agency_id is not null
  and public.visaflow_agency_can(company_id, agency_id, 'view_interviews')
);

drop policy if exists vf_interviews_agency_update on public.interviews;
create policy vf_interviews_agency_update on public.interviews
for update to authenticated
using (
  agency_id is not null
  and public.visaflow_agency_can(company_id, agency_id, 'view_interviews')
)
with check (
  agency_id is not null
  and public.visaflow_agency_can(company_id, agency_id, 'view_interviews')
);

