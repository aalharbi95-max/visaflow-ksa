-- READ-ONLY PREFLIGHT. Run against a staging clone before applying
-- 20260722000100_secure_agency_user_invitations.sql. This file performs no writes.
-- All *_count results must be zero. Existing-index booleans are informational:
-- the migration creates a missing compatible index after refusing duplicates.

select count(*) as missing_required_columns_count
from (values
  ('users', 'id'), ('users', 'email'), ('users', 'auth_user_id'),
  ('agency_members', 'agency_id'), ('agency_members', 'user_id'),
  ('agency_company_user_access', 'company_id'),
  ('agency_company_user_access', 'agency_id'),
  ('agency_company_user_access', 'user_id')
) as required(table_name, column_name)
where not exists (
  select 1
  from information_schema.columns as column_info
  where column_info.table_schema = 'public'
    and column_info.table_name = required.table_name
    and column_info.column_name = required.column_name
);

select count(*) as duplicate_normalized_email_groups_count
from (
  select lower(btrim(email))
  from public.users
  where nullif(btrim(email), '') is not null
  group by lower(btrim(email))
  having count(*) > 1
) as duplicates;

select count(*) as duplicate_auth_user_id_groups_count
from (
  select auth_user_id
  from public.users
  where auth_user_id is not null
  group by auth_user_id
  having count(*) > 1
) as duplicates;

select count(*) as ambiguous_normalized_auth_email_groups_count
from (
  select lower(btrim(email))
  from auth.users
  where nullif(btrim(email), '') is not null
  group by lower(btrim(email))
  having count(*) > 1
) as duplicates;

select count(*) as legacy_agency_auth_collisions_requiring_trusted_migration_count
from public.users as app_user
join auth.users as auth_user
  on lower(btrim(auth_user.email)) = lower(btrim(app_user.email))
where app_user.role = 'Agency'
  and app_user.auth_user_id is null;

select count(*) as mismatched_linked_auth_emails_count
from public.users as app_user
join auth.users as auth_user on auth_user.id = app_user.auth_user_id
where app_user.auth_user_id is not null
  and lower(btrim(auth_user.email)) <> lower(btrim(app_user.email));

select count(*) as duplicate_agency_memberships_count
from (
  select agency_id, user_id
  from public.agency_members
  group by agency_id, user_id
  having count(*) > 1
) as duplicates;

select count(*) as duplicate_agency_company_user_access_count
from (
  select company_id, agency_id, user_id
  from public.agency_company_user_access
  group by company_id, agency_id, user_id
  having count(*) > 1
) as duplicates;

with expected(table_name, columns) as (values
  ('agency_members', array['agency_id', 'user_id']::text[]),
  ('agency_company_user_access', array['company_id', 'agency_id', 'user_id']::text[])
)
select expected.table_name,
       expected.columns,
       exists (
         select 1
         from pg_index as index_info
         join pg_class as table_info on table_info.oid = index_info.indrelid
         join pg_namespace as schema_info on schema_info.oid = table_info.relnamespace
         where schema_info.nspname = 'public'
           and table_info.relname = expected.table_name
           and index_info.indisunique
           and index_info.indpred is null
           and (
             select array_agg(attribute.attname::text order by key_column.ordinality)
             from unnest(index_info.indkey::smallint[]) with ordinality as key_column(attnum, ordinality)
             join pg_attribute as attribute
               on attribute.attrelid = table_info.oid
              and attribute.attnum = key_column.attnum
           ) = expected.columns
       ) as matching_unique_index_exists
from expected
order by expected.table_name;

-- After applying the migration to local/staging, every value below must be true.
select
  to_regclass('private.auth_identity_directory') is not null as auth_directory_exists,
  exists (
    select 1
    from pg_index as index_info
    join pg_class as table_info on table_info.oid = index_info.indrelid
    join pg_namespace as schema_info on schema_info.oid = table_info.relnamespace
    where schema_info.nspname = 'private'
      and table_info.relname = 'auth_identity_directory'
      and index_info.indisvalid
      and index_info.indisready
      and index_info.indpred is null
      and (
        select array_agg(attribute.attname::text order by key_column.ordinality)
        from unnest(index_info.indkey::smallint[]) with ordinality as key_column(attnum, ordinality)
        join pg_attribute as attribute
          on attribute.attrelid = table_info.oid
         and attribute.attnum = key_column.attnum
      ) = array['normalized_email']::text[]
  ) as auth_directory_exact_email_index_exists,
  not coalesce(has_function_privilege('anon', to_regprocedure('public.lookup_auth_identity_by_email(text)'), 'EXECUTE'), false)
    and not coalesce(has_function_privilege('authenticated', to_regprocedure('public.lookup_auth_identity_by_email(text)'), 'EXECUTE'), false)
    and coalesce(has_function_privilege('service_role', to_regprocedure('public.lookup_auth_identity_by_email(text)'), 'EXECUTE'), false)
    as auth_lookup_grants_are_safe,
  not coalesce(has_function_privilege('anon', to_regprocedure('public.cleanup_agency_user_invitations(integer)'), 'EXECUTE'), false)
    and not coalesce(has_function_privilege('authenticated', to_regprocedure('public.cleanup_agency_user_invitations(integer)'), 'EXECUTE'), false)
    and coalesce(has_function_privilege('service_role', to_regprocedure('public.cleanup_agency_user_invitations(integer)'), 'EXECUTE'), false)
    as cleanup_grants_are_safe;
