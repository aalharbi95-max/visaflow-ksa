-- Ajeer details for housing contracts.
-- Apply ONLY to the dedicated Housing Supabase project after 0005.

alter table public.housing_contracts
  add column if not exists ajeer_contract_number text,
  add column if not exists ajeer_provider_name text,
  add column if not exists ajeer_service_type text,
  add column if not exists ajeer_issue_date date,
  add column if not exists ajeer_expiry_date date,
  add column if not exists ajeer_status text,
  add column if not exists ajeer_document_url text;

alter table public.housing_contracts
  drop constraint if exists housing_contracts_ajeer_status_check;
alter table public.housing_contracts
  add constraint housing_contracts_ajeer_status_check
  check (ajeer_status is null or ajeer_status in ('Not Required','Pending','Active','Expired','Cancelled'));

alter table public.housing_contracts
  drop constraint if exists housing_contracts_ajeer_dates_check;
alter table public.housing_contracts
  add constraint housing_contracts_ajeer_dates_check
  check (ajeer_expiry_date is null or ajeer_issue_date is null or ajeer_expiry_date >= ajeer_issue_date);

create index if not exists housing_contracts_ajeer_expiry_idx
  on public.housing_contracts(company_id,ajeer_expiry_date,ajeer_status);
