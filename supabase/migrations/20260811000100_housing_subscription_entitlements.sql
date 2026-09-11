-- Independent Housing Management subscriptions controlled by the Platform Owner.

alter table public.platform_clients
  add column if not exists housing_access_enabled boolean not null default false,
  add column if not exists housing_plan text not null default 'Standard',
  add column if not exists housing_subscription_status text not null default 'Inactive',
  add column if not exists housing_start_date date,
  add column if not exists housing_end_date date,
  add column if not exists housing_monthly_amount numeric(14, 2) not null default 0,
  add column if not exists housing_users_limit integer not null default 0;

alter table public.platform_clients drop constraint if exists platform_clients_housing_plan_check;
alter table public.platform_clients
  add constraint platform_clients_housing_plan_check
  check (housing_plan in ('Standard', 'Professional', 'Enterprise'));

alter table public.platform_clients drop constraint if exists platform_clients_housing_subscription_status_check;
alter table public.platform_clients
  add constraint platform_clients_housing_subscription_status_check
  check (housing_subscription_status in ('Inactive', 'Trial', 'Active', 'Suspended', 'Expired', 'Cancelled'));

alter table public.platform_clients drop constraint if exists platform_clients_housing_amount_check;
alter table public.platform_clients
  add constraint platform_clients_housing_amount_check check (housing_monthly_amount >= 0);

alter table public.platform_clients drop constraint if exists platform_clients_housing_users_limit_check;
alter table public.platform_clients
  add constraint platform_clients_housing_users_limit_check check (housing_users_limit >= 0);

alter table public.platform_clients drop constraint if exists platform_clients_housing_dates_check;
alter table public.platform_clients
  add constraint platform_clients_housing_dates_check
  check (housing_start_date is null or housing_end_date is null or housing_end_date >= housing_start_date);

create index if not exists idx_platform_clients_housing_access
  on public.platform_clients (operational_company_id, housing_subscription_status)
  where housing_access_enabled = true;

alter table public.subscription_invoices
  add column if not exists subscription_type text not null default 'Recruitment';

alter table public.subscription_invoices drop constraint if exists subscription_invoices_subscription_type_check;
alter table public.subscription_invoices
  add constraint subscription_invoices_subscription_type_check
  check (subscription_type in ('Recruitment', 'Housing', 'Combined', 'Talent', 'AI Agent'));

create index if not exists idx_subscription_invoices_product
  on public.subscription_invoices (client_id, subscription_type, due_date desc);

create or replace function public.get_my_housing_entitlement()
returns jsonb
language sql
security definer
stable
set search_path = ''
as $function$
  select coalesce((
    select jsonb_build_object(
      'enabled', client.housing_access_enabled,
      'housing_plan', client.housing_plan,
      'subscription_status', client.housing_subscription_status,
      'start_date', client.housing_start_date,
      'end_date', client.housing_end_date,
      'monthly_amount', client.housing_monthly_amount,
      'users_limit', client.housing_users_limit,
      'available', client.housing_access_enabled
        and client.housing_subscription_status in ('Active', 'Trial')
        and (client.housing_start_date is null or client.housing_start_date <= current_date)
        and (client.housing_end_date is null or client.housing_end_date >= current_date)
    )
    from public.users actor
    join public.platform_clients client on client.operational_company_id = actor.company_id
    where actor.auth_user_id = auth.uid()
      and actor.status = 'Active'
      and actor.is_active = true
    limit 1
  ), jsonb_build_object(
    'enabled', false,
    'available', false,
    'housing_plan', 'Standard',
    'subscription_status', 'Inactive'
  ));
$function$;

revoke all on function public.get_my_housing_entitlement() from public, anon;
grant execute on function public.get_my_housing_entitlement() to authenticated, service_role;

comment on function public.get_my_housing_entitlement() is
  'Returns the signed-in company Housing entitlement managed by the Platform Owner.';
