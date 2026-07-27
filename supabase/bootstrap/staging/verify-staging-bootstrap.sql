-- Read-only verification for the reviewed VisaFlow Staging bootstrap.
-- Run only after confirming the target project ref is iijhdilfzndqlguefipn.
-- This script reports schema metadata and aggregate object counts only.

begin transaction read only;

select current_database() as database_name, current_user as connected_role;

select
  n.nspname as schema_name,
  count(*) filter (where c.relkind in ('r', 'p')) as table_count,
  count(*) filter (where c.relkind = 'S') as sequence_count,
  count(*) filter (where c.relkind in ('v', 'm')) as view_count
from pg_catalog.pg_namespace n
left join pg_catalog.pg_class c on c.relnamespace = n.oid
where n.nspname = 'public'
group by n.nspname;

select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
order by c.relname;

select
  count(*) as public_column_count
from information_schema.columns
where table_schema = 'public';

select
  contype as constraint_type,
  count(*) as constraint_count
from pg_catalog.pg_constraint con
join pg_catalog.pg_namespace n on n.oid = con.connamespace
where n.nspname = 'public'
group by contype
order by contype;

select count(*) as public_index_count
from pg_catalog.pg_index i
join pg_catalog.pg_class t on t.oid = i.indrelid
join pg_catalog.pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public';

select count(*) as public_policy_count
from pg_catalog.pg_policy p
join pg_catalog.pg_class c on c.oid = p.polrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public';

select count(*) as public_trigger_count
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and not t.tgisinternal;

select
  p.proname as security_definer_function,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
  coalesce(
    (
      select setting
      from unnest(coalesce(p.proconfig, array[]::text[])) setting
      where setting like 'search_path=%'
      limit 1
    ),
    'MISSING'
  ) as configured_search_path
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
order by p.proname, arguments;

select
  e.extname as extension_name,
  e.extversion as extension_version,
  n.nspname as extension_schema
from pg_catalog.pg_extension e
join pg_catalog.pg_namespace n on n.oid = e.extnamespace
where e.extname not in ('plpgsql')
order by e.extname;

select
  to_regclass('public.agencies') is not null as agencies_exists,
  to_regclass('public.companies') is not null as companies_exists,
  to_regclass('public.users') is not null as users_exists,
  to_regclass('public.company_agency_access') is not null as company_agency_access_exists,
  to_regclass('public.agency_company_user_access') is not null as agency_company_user_access_exists;

select
  version,
  name
from supabase_migrations.schema_migrations
where version in (
  '20260718000100',
  '20260719000100',
  '20260719000200',
  '20260719000300',
  '20260719000400',
  '20260726000100',
  '20260726000200'
)
order by version;

rollback;
