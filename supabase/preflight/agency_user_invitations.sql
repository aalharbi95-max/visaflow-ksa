-- READ-ONLY PREFLIGHT. Run against staging with the same schema/data shape as
-- production before applying 20260722000100_secure_agency_user_invitations.sql.
-- Every returned count must be zero. This file performs no writes.

select count(*) as duplicate_normalized_email_groups
from (
  select lower(btrim(email))
  from public.users
  where nullif(btrim(email), '') is not null
  group by lower(btrim(email))
  having count(*) > 1
) as duplicates;

select count(*) as duplicate_auth_user_id_groups
from (
  select auth_user_id
  from public.users
  where auth_user_id is not null
  group by auth_user_id
  having count(*) > 1
) as duplicates;

select count(*) as legacy_agency_auth_collisions_requiring_trusted_migration
from public.users as app_user
join auth.users as auth_user
  on lower(auth_user.email) = lower(btrim(app_user.email))
where app_user.role = 'Agency'
  and app_user.auth_user_id is null;

select count(*) as mismatched_linked_auth_emails
from public.users as app_user
join auth.users as auth_user on auth_user.id = app_user.auth_user_id
where app_user.auth_user_id is not null
  and lower(auth_user.email) <> lower(btrim(app_user.email));

select count(*) as duplicate_agency_memberships
from (
  select agency_id, user_id
  from public.agency_members
  group by agency_id, user_id
  having count(*) > 1
) as duplicates;

select count(*) as duplicate_agency_company_user_access
from (
  select company_id, agency_id, user_id
  from public.agency_company_user_access
  group by company_id, agency_id, user_id
  having count(*) > 1
) as duplicates;
