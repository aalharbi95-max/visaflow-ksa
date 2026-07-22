-- pgTAP contract test for a disposable local Supabase database or staging clone.
-- Run only after applying migrations and preparing one active Agency user with
-- access to two active companies through the same agency. Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(37);

select ok(
  not has_function_privilege('anon', 'public.lookup_auth_identity_by_email(text)', 'EXECUTE'),
  'anon cannot execute the Auth identity lookup'
);
select ok(
  not has_function_privilege('authenticated', 'public.lookup_auth_identity_by_email(text)', 'EXECUTE'),
  'authenticated cannot execute the Auth identity lookup'
);
select ok(
  not has_function_privilege('anon', 'public.cleanup_agency_user_invitations(integer)', 'EXECUTE'),
  'anon cannot execute invitation cleanup'
);
select ok(
  not has_function_privilege('authenticated', 'public.cleanup_agency_user_invitations(integer)', 'EXECUTE'),
  'authenticated cannot execute invitation cleanup'
);
select ok(
  has_function_privilege('service_role', 'public.lookup_auth_identity_by_email(text)', 'EXECUTE'),
  'service_role can execute the Auth identity lookup'
);
select ok(
  has_function_privilege('service_role', 'public.cleanup_agency_user_invitations(integer)', 'EXECUTE'),
  'service_role can execute invitation cleanup'
);
select ok(
  to_regclass('private.auth_identity_directory_normalized_email_idx') is not null,
  'the private Auth identity directory has its email index'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agency_user_invitations'
      and column_name in ('token', 'token_hash')
  ),
  'agency invitations store no application invitation secret'
);

create temporary table _agency_invitation_fixture (
  auth_user_id uuid not null,
  user_id text not null,
  agency_id text not null,
  company_a_id text not null,
  company_b_id text not null,
  invitation_id uuid,
  previous_invitation_id uuid
) on commit drop;

insert into _agency_invitation_fixture (
  auth_user_id, user_id, agency_id, company_a_id, company_b_id
)
select candidate.auth_user_id,
       candidate.user_id,
       candidate.agency_id,
       candidate.company_ids[1],
       candidate.company_ids[2]
from (
  select app_user.auth_user_id,
         app_user.id::text as user_id,
         membership.agency_id::text as agency_id,
         array_agg(distinct access.company_id::text order by access.company_id::text) as company_ids
  from public.users as app_user
  join public.agency_members as membership
    on membership.user_id = app_user.id
   and membership.status = 'Active'
  join public.agency_company_user_access as access
    on access.user_id = app_user.id
   and access.agency_id = membership.agency_id
   and access.status = 'Active'
  where app_user.role = 'Agency'
    and app_user.status = 'Active'
    and app_user.is_active is true
    and app_user.auth_user_id is not null
    and app_user.agency_id = membership.agency_id
  group by app_user.auth_user_id, app_user.id, membership.agency_id
  having count(distinct access.company_id) >= 2
  order by app_user.id
  limit 1
) as candidate;

do $fixture$
begin
  if not exists (select 1 from _agency_invitation_fixture) then
    raise exception 'pgTAP fixture requires one active Agency user with the same agency linked to two companies';
  end if;

  perform set_config(
    'request.jwt.claim.sub',
    (select auth_user_id::text from _agency_invitation_fixture),
    true
  );
end;
$fixture$;

create temporary table _saved_agency_membership on commit drop as
select membership.*
from public.agency_members as membership
join _agency_invitation_fixture as fixture
  on membership.user_id::text = fixture.user_id
 and membership.agency_id::text = fixture.agency_id;

create temporary table _saved_company_access on commit drop as
select access.*
from public.agency_company_user_access as access
join _agency_invitation_fixture as fixture
  on access.user_id::text = fixture.user_id
 and access.agency_id::text = fixture.agency_id
 and access.company_id::text = fixture.company_b_id;

update public.agency_user_invitations as invitation
set invalidated_at = now()
from _agency_invitation_fixture as fixture
where invitation.auth_user_id = fixture.auth_user_id
  and invitation.consumed_at is null
  and invitation.invalidated_at is null;

with created as (
  insert into public.agency_user_invitations (
    auth_user_id, agency_id, company_id, delivery_kind
  )
  select auth_user_id, agency_id, company_a_id, 'invite'
  from _agency_invitation_fixture
  returning id
)
update _agency_invitation_fixture
set invitation_id = (select id from created);

select ok(
  coalesce((public.verify_pending_agency_user_invitation(invitation_id) ->> 'valid')::boolean, false),
  'verify accepts a valid invitation for company A'
)
from _agency_invitation_fixture;

update _agency_invitation_fixture
set previous_invitation_id = invitation_id;
update public.agency_user_invitations as invitation
set invalidated_at = now()
from _agency_invitation_fixture as fixture
where invitation.id = fixture.invitation_id;
with created as (
  insert into public.agency_user_invitations (
    auth_user_id, agency_id, company_id, delivery_kind
  )
  select auth_user_id, agency_id, company_b_id, 'resend'
  from _agency_invitation_fixture
  returning id
)
update _agency_invitation_fixture
set invitation_id = (select id from created);

select ok(
  coalesce((public.verify_pending_agency_user_invitation(invitation_id) ->> 'valid')::boolean, false),
  'the same agency user is valid for company B'
)
from _agency_invitation_fixture;
select ok(
  (
    select count(distinct access.company_id) >= 2
    from public.agency_company_user_access as access
    join _agency_invitation_fixture as fixture
      on access.user_id::text = fixture.user_id
     and access.agency_id::text = fixture.agency_id
    where access.status = 'Active'
  ),
  'the same user and agency retain at least two active company access rows'
);

delete from public.agency_members as membership
using _agency_invitation_fixture as fixture
where membership.user_id::text = fixture.user_id
  and membership.agency_id::text = fixture.agency_id;
select ok(
  not coalesce((public.verify_pending_agency_user_invitation(invitation_id) ->> 'valid')::boolean, false),
  'verify rejects a deleted agency membership'
)
from _agency_invitation_fixture;
select ok(
  not coalesce((public.consume_pending_agency_user_invitation(invitation_id) ->> 'consumed')::boolean, false),
  'direct consume rejects a deleted agency membership'
)
from _agency_invitation_fixture;
insert into public.agency_members select * from _saved_agency_membership;

update public.agency_members as membership
set status = 'Inactive'
from _agency_invitation_fixture as fixture
where membership.user_id::text = fixture.user_id
  and membership.agency_id::text = fixture.agency_id;
select ok(
  not coalesce((public.verify_pending_agency_user_invitation(invitation_id) ->> 'valid')::boolean, false),
  'verify rejects an inactive agency membership'
)
from _agency_invitation_fixture;
select ok(
  not coalesce((public.consume_pending_agency_user_invitation(invitation_id) ->> 'consumed')::boolean, false),
  'direct consume rejects an inactive agency membership'
)
from _agency_invitation_fixture;
update public.agency_members as membership
set status = saved.status
from _saved_agency_membership as saved
where membership.user_id = saved.user_id
  and membership.agency_id = saved.agency_id;

delete from public.agency_company_user_access as access
using _agency_invitation_fixture as fixture
where access.user_id::text = fixture.user_id
  and access.agency_id::text = fixture.agency_id
  and access.company_id::text = fixture.company_b_id;
select ok(
  not coalesce((public.verify_pending_agency_user_invitation(invitation_id) ->> 'valid')::boolean, false),
  'verify rejects deleted company access'
)
from _agency_invitation_fixture;
select ok(
  not coalesce((public.consume_pending_agency_user_invitation(invitation_id) ->> 'consumed')::boolean, false),
  'direct consume rejects deleted company access'
)
from _agency_invitation_fixture;
insert into public.agency_company_user_access select * from _saved_company_access;

update public.agency_company_user_access as access
set status = 'Inactive'
from _agency_invitation_fixture as fixture
where access.user_id::text = fixture.user_id
  and access.agency_id::text = fixture.agency_id
  and access.company_id::text = fixture.company_b_id;
select ok(
  not coalesce((public.verify_pending_agency_user_invitation(invitation_id) ->> 'valid')::boolean, false),
  'verify rejects inactive company access'
)
from _agency_invitation_fixture;
select ok(
  not coalesce((public.consume_pending_agency_user_invitation(invitation_id) ->> 'consumed')::boolean, false),
  'direct consume rejects inactive company access'
)
from _agency_invitation_fixture;
update public.agency_company_user_access as access
set status = saved.status
from _saved_company_access as saved
where access.user_id = saved.user_id
  and access.agency_id = saved.agency_id
  and access.company_id = saved.company_id;

do $identity_mismatch$
begin
  perform set_config('request.jwt.claim.sub', extensions.gen_random_uuid()::text, true);
end;
$identity_mismatch$;
select ok(
  not coalesce((public.verify_pending_agency_user_invitation(invitation_id) ->> 'valid')::boolean, false),
  'verify rejects a different authenticated user'
)
from _agency_invitation_fixture;
select ok(
  not coalesce((public.consume_pending_agency_user_invitation(invitation_id) ->> 'consumed')::boolean, false),
  'direct consume rejects a different authenticated user'
)
from _agency_invitation_fixture;
do $restore_identity$
begin
  perform set_config(
    'request.jwt.claim.sub',
    (select auth_user_id::text from _agency_invitation_fixture),
    true
  );
end;
$restore_identity$;

update public.agency_user_invitations as invitation
set agency_id = '__different_agency__'
from _agency_invitation_fixture as fixture
where invitation.id = fixture.invitation_id;
select ok(
  not coalesce((public.verify_pending_agency_user_invitation(invitation_id) ->> 'valid')::boolean, false),
  'verify rejects an invitation for a different agency'
)
from _agency_invitation_fixture;
select ok(
  not coalesce((public.consume_pending_agency_user_invitation(invitation_id) ->> 'consumed')::boolean, false),
  'direct consume rejects an invitation for a different agency'
)
from _agency_invitation_fixture;
update public.agency_user_invitations as invitation
set agency_id = fixture.agency_id
from _agency_invitation_fixture as fixture
where invitation.id = fixture.invitation_id;

update public.agency_user_invitations as invitation
set company_id = '__different_company__'
from _agency_invitation_fixture as fixture
where invitation.id = fixture.invitation_id;
select ok(
  not coalesce((public.verify_pending_agency_user_invitation(invitation_id) ->> 'valid')::boolean, false),
  'verify rejects an invitation for a different company'
)
from _agency_invitation_fixture;
select ok(
  not coalesce((public.consume_pending_agency_user_invitation(invitation_id) ->> 'consumed')::boolean, false),
  'direct consume rejects an invitation for a different company'
)
from _agency_invitation_fixture;
update public.agency_user_invitations as invitation
set company_id = fixture.company_b_id
from _agency_invitation_fixture as fixture
where invitation.id = fixture.invitation_id;

update public.agency_user_invitations as invitation
set expires_at = now() - interval '1 minute'
from _agency_invitation_fixture as fixture
where invitation.id = fixture.invitation_id;
select ok(
  not coalesce((public.verify_pending_agency_user_invitation(invitation_id) ->> 'valid')::boolean, false),
  'verify rejects an expired invitation'
)
from _agency_invitation_fixture;
select ok(
  not coalesce((public.consume_pending_agency_user_invitation(invitation_id) ->> 'consumed')::boolean, false),
  'direct consume rejects an expired invitation'
)
from _agency_invitation_fixture;
update public.agency_user_invitations as invitation
set expires_at = now() + interval '24 hours'
from _agency_invitation_fixture as fixture
where invitation.id = fixture.invitation_id;

update public.agency_user_invitations as invitation
set consumed_at = now()
from _agency_invitation_fixture as fixture
where invitation.id = fixture.invitation_id;
select ok(
  not coalesce((public.verify_pending_agency_user_invitation(invitation_id) ->> 'valid')::boolean, false),
  'verify rejects a consumed invitation'
)
from _agency_invitation_fixture;
select ok(
  not coalesce((public.consume_pending_agency_user_invitation(invitation_id) ->> 'consumed')::boolean, false),
  'direct consume rejects an already consumed invitation'
)
from _agency_invitation_fixture;

update public.agency_user_invitations as invitation
set consumed_at = null,
    invalidated_at = null,
    expires_at = now() + interval '24 hours'
from _agency_invitation_fixture as fixture
where invitation.id = fixture.invitation_id;
select ok(
  coalesce((public.consume_pending_agency_user_invitation(invitation_id) ->> 'consumed')::boolean, false),
  'direct consume independently validates and consumes a valid invitation'
)
from _agency_invitation_fixture;
select ok(
  not coalesce((public.verify_pending_agency_user_invitation(invitation_id) ->> 'valid')::boolean, false),
  'a directly consumed invitation cannot be verified again'
)
from _agency_invitation_fixture;

with created as (
  insert into public.agency_user_invitations (
    auth_user_id, agency_id, company_id, delivery_kind
  )
  select auth_user_id, agency_id, company_a_id, 'resend'
  from _agency_invitation_fixture
  returning id
)
update _agency_invitation_fixture
set invitation_id = (select id from created);

select throws_ok(
  $sql$
    insert into public.agency_user_invitations (
      auth_user_id, agency_id, company_id, delivery_kind
    )
    select auth_user_id, agency_id, company_a_id, 'resend'
    from _agency_invitation_fixture
  $sql$,
  '23505',
  null,
  'the database rejects a second active invitation for the same Auth user'
);
select is(
  (
    select count(*)::bigint
    from public.agency_user_invitations as invitation
    join _agency_invitation_fixture as fixture
      on invitation.auth_user_id = fixture.auth_user_id
    where invitation.consumed_at is null
      and invitation.invalidated_at is null
  ),
  1::bigint,
  'exactly one active invitation remains'
);

update _agency_invitation_fixture
set previous_invitation_id = invitation_id;
update public.agency_user_invitations as invitation
set invalidated_at = now()
from _agency_invitation_fixture as fixture
where invitation.id = fixture.invitation_id;
with created as (
  insert into public.agency_user_invitations (
    auth_user_id, agency_id, company_id, delivery_kind
  )
  select auth_user_id, agency_id, company_b_id, 'resend'
  from _agency_invitation_fixture
  returning id
)
update _agency_invitation_fixture
set invitation_id = (select id from created);

select ok(
  not coalesce((public.verify_pending_agency_user_invitation(previous_invitation_id) ->> 'valid')::boolean, false),
  'a superseded invitation identifier is invalid'
)
from _agency_invitation_fixture;
select ok(
  coalesce((public.verify_pending_agency_user_invitation(invitation_id) ->> 'valid')::boolean, false),
  'the replacement invitation is valid'
)
from _agency_invitation_fixture;

select lives_ok(
  $sql$
    insert into public.agency_members
    select source.* from public.agency_members as source limit 1
    on conflict (agency_id, user_id) do update
    set status = excluded.status
  $sql$,
  'the agency membership ON CONFLICT target is executable'
);
select lives_ok(
  $sql$
    insert into public.agency_company_user_access
    select source.* from public.agency_company_user_access as source limit 1
    on conflict (company_id, agency_id, user_id) do update
    set status = excluded.status
  $sql$,
  'the company access ON CONFLICT target is executable'
);

select * from finish();
rollback;
