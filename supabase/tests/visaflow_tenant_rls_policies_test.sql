begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(20);

-- Fixed, synthetic identifiers only. This file must run against an isolated test DB.
insert into public.companies (id, name, status) values
  ('10000000-0000-4000-8000-000000000001', 'RLS Test Company A', 'Active'),
  ('10000000-0000-4000-8000-000000000002', 'RLS Test Company B', 'Active');

insert into public.agencies (id, name, status, company_id) values
  ('20000000-0000-4000-8000-000000000001', 'RLS Test Agency A', 'Active', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'RLS Test Agency B', 'Active', '10000000-0000-4000-8000-000000000002');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'rls-admin-a@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'rls-admin-b@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'rls-agency@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'rls-owner@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'rls-candidate@example.invalid', '', now(), '{}', '{}', now(), now());

insert into public.users (
  id, name, email, role, status, is_active, company_id, agency_id, auth_user_id
) values
  (900001, 'Admin A', 'rls-admin-a@example.invalid', 'Admin', 'Active', true, '10000000-0000-4000-8000-000000000001', null, '30000000-0000-4000-8000-000000000001'),
  (900002, 'Admin B', 'rls-admin-b@example.invalid', 'Admin', 'Active', true, '10000000-0000-4000-8000-000000000002', null, '30000000-0000-4000-8000-000000000002'),
  (900003, 'Agency User', 'rls-agency@example.invalid', 'Agency', 'Active', true, null, '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003'),
  (900004, 'Platform Owner', 'rls-owner@example.invalid', 'Platform Owner', 'Active', true, null, null, '30000000-0000-4000-8000-000000000004');

insert into public.agency_members (agency_id, user_id, status)
values ('20000000-0000-4000-8000-000000000001', 900003, 'Active');

insert into public.company_agency_access (
  company_id, agency_id, status, can_view_requests, can_upload_candidates,
  can_update_candidates, can_view_interviews
) values (
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'Active', true, true, true, true
);

insert into public.agency_company_user_access (
  company_id, agency_id, user_id, status, can_view_requests,
  can_upload_candidates, can_update_candidates, can_view_interviews
) values (
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  900003, 'Active', true, true, true, true
);

insert into public.requests (id, request_no, company_id, status) values
  (990001, 'RLS-A-1', '10000000-0000-4000-8000-000000000001', 'Open'),
  (990002, 'RLS-B-1', '10000000-0000-4000-8000-000000000002', 'Open');

insert into public.candidates (id, candidate_name, company_id) values
  ('40000000-0000-4000-8000-000000000001', 'Candidate A', '10000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000002', 'Candidate B', '10000000-0000-4000-8000-000000000002');

select ok(
  not has_function_privilege('public', 'public.visaflow_tenant_can(uuid,text,text)', 'EXECUTE'),
  'PUBLIC cannot execute the tenant authorization helper'
);
select ok(
  not has_function_privilege('anon', 'public.visaflow_tenant_can(uuid,text,text)', 'EXECUTE'),
  'anon cannot execute the tenant authorization helper'
);
select ok(
  has_function_privilege('authenticated', 'public.visaflow_tenant_can(uuid,text,text)', 'EXECUTE'),
  'authenticated may execute only the self-scoped tenant helper'
);
select ok(
  has_function_privilege('service_role', 'public.visaflow_tenant_can(uuid,text,text)', 'EXECUTE'),
  'service_role may execute the tenant helper'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.requests), 1::bigint, 'company A sees only company A requests');
select is((select count(*) from public.candidates), 1::bigint, 'company A sees only company A candidates');
select lives_ok(
  $$insert into public.requests (id, request_no, company_id) values (990003, 'RLS-A-2', '10000000-0000-4000-8000-000000000001')$$,
  'company A can create its own request'
);
select throws_ok(
  $$insert into public.requests (id, request_no, company_id) values (990004, 'RLS-CROSS', '10000000-0000-4000-8000-000000000002')$$,
  '42501', null,
  'company A cannot insert into company B'
);
select throws_ok(
  $$update public.requests set company_id = '10000000-0000-4000-8000-000000000002' where id = 990001$$,
  '42501', null,
  'company A cannot move a row to company B'
);
select throws_ok(
  $$insert into public.request_lines (request_no, company_id, request_id) values ('RLS-CROSS-PARENT', '10000000-0000-4000-8000-000000000001', 990002)$$,
  '42501', null,
  'a child row cannot reference a parent from another company'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000003', true);
select ok(public.visaflow_agency_can('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'read'), 'linked agency relationship is accepted');
select ok(not public.visaflow_agency_can('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'read'), 'agency cannot access an unlinked company');
select is((select count(*) from public.agency_company_user_access), 1::bigint, 'agency sees only its own access row');
select is((select count(*) from public.requests), 0::bigint, 'agency cannot use company_id alone to read requests');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000005', true);
select is((select count(*) from public.candidates), 0::bigint, 'an Auth candidate without a linked app-user row cannot read legacy candidates');
reset role;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$select count(*) from public.requests$$,
  '42501', null,
  'anon cannot read internal requests'
);
select throws_ok(
  $$select count(*) from public.ai_interview_sessions$$,
  '42501', null,
  'anon cannot read AI interview sessions'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000004', true);
select is((select count(*) from public.requests), 3::bigint, 'Platform Owner may read all tenant requests');
select is(
  (with changed as (update public.requests set notes = 'forbidden' where id = 990001 returning id) select count(*) from changed),
  0::bigint,
  'Platform Owner cannot mutate operational tenant rows'
);
reset role;

set local role service_role;
select is((select count(*) from public.requests), 3::bigint, 'service_role can run required background access');
reset role;

select * from finish();
rollback;
