-- Product-level access modes allow Housing-only clients without a recruitment workspace.

alter table public.platform_clients
  add column if not exists product_access_mode text not null default 'Recruitment Only',
  add column if not exists recruitment_access_enabled boolean not null default true,
  add column if not exists housing_admin_name text,
  add column if not exists housing_admin_email text,
  add column if not exists housing_workspace_id uuid;

alter table public.platform_clients drop constraint if exists platform_clients_product_access_mode_check;
alter table public.platform_clients
  add constraint platform_clients_product_access_mode_check
  check (product_access_mode in ('Recruitment Only', 'Housing Only', 'Recruitment + Housing'));

update public.platform_clients
set product_access_mode = case
  when housing_access_enabled and recruitment_access_enabled then 'Recruitment + Housing'
  when housing_access_enabled then 'Housing Only'
  else 'Recruitment Only'
end;

create index if not exists idx_platform_clients_product_access
  on public.platform_clients (product_access_mode, subscription_status, housing_subscription_status);

create index if not exists idx_platform_clients_housing_admin_email
  on public.platform_clients (lower(housing_admin_email))
  where housing_admin_email is not null;

comment on column public.platform_clients.product_access_mode is
  'Commercial product access: recruitment only, Housing only, or both products.';
comment on column public.platform_clients.housing_workspace_id is
  'Optional reference to housing_companies.id in the isolated Housing Supabase project.';
