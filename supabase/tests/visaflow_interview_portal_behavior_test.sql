begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(22);

insert into public.companies (id, name, status)
values ('71000000-0000-4000-8000-000000000001', 'Portal Test Company', 'Active');

insert into public.ai_interview_templates (id, company_id, template_name, status, is_active)
values ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'Portal Test Template', 'Active', true);

insert into public.ai_interview_questions (
  id, company_id, template_id, question_order, question_text, is_active
) values (
  '73000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  1, 'Portal test question', true
);

insert into public.ai_interview_sessions (
  id, company_id, template_id, candidate_id, candidate_name, candidate_email,
  status, expires_at, consent_required
) values (
  '74000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  'portal-candidate-1', 'Portal Candidate', 'portal-candidate@example.invalid',
  'Created', now() + interval '2 days', true
);

create temporary table portal_test_state (
  first_invitation jsonb,
  second_invitation jsonb,
  capability jsonb,
  upload jsonb
) on commit drop;
insert into portal_test_state default values;
grant all on table pg_temp.portal_test_state to authenticated, service_role;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
update pg_temp.portal_test_state
   set first_invitation = public.issue_secure_ai_interview_invitation(
     '74000000-0000-4000-8000-000000000001', 'https://test.visaflow.invalid'
   );
reset role;

select like(first_invitation->>'url', 'https://test.visaflow.invalid/#interview_invite=%', 'invitation uses a fragment')
from pg_temp.portal_test_state;
select ok(position('?' in first_invitation->>'url') = 0, 'invitation URL has no query string')
from pg_temp.portal_test_state;
select ok((first_invitation->>'url') ~ '#interview_invite=[0-9a-f]{64}$', 'invitation carries a 256-bit random secret')
from pg_temp.portal_test_state;
select ok(not exists(
  select 1 from public.ai_interview_portal_invitations i, pg_temp.portal_test_state s
  where i.token_hash = split_part(s.first_invitation->>'url', '#interview_invite=', 2)
), 'raw invitation secret is not stored');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
update pg_temp.portal_test_state
   set second_invitation = public.issue_secure_ai_interview_invitation(
     '74000000-0000-4000-8000-000000000001', 'https://test.visaflow.invalid'
   );
reset role;

select is((
  select count(*) from public.ai_interview_portal_invitations
  where session_id = '74000000-0000-4000-8000-000000000001'
    and consumed_at is null and revoked_at is null
), 1::bigint, 'resend leaves exactly one active invitation');
select ok((
  select i.revoked_at is not null
  from public.ai_interview_portal_invitations i, pg_temp.portal_test_state s
  where i.id = (s.first_invitation->>'invitation_id')::uuid
), 'resend revokes the previous invitation');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '75000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"75000000-0000-4000-8000-000000000001","is_anonymous":true}', true);
update pg_temp.portal_test_state s
   set capability = public.exchange_ai_interview_invitation(
     encode(extensions.digest(split_part(s.second_invitation->>'url', '#interview_invite=', 2), 'sha256'), 'hex')
   );
select ok((select (capability->>'capability_id')::uuid is not null from pg_temp.portal_test_state), 'valid invitation creates a capability');
select throws_ok(
  $$select public.exchange_ai_interview_invitation(encode(extensions.digest(split_part(second_invitation->>'url', '#interview_invite=', 2), 'sha256'), 'hex')) from pg_temp.portal_test_state$$,
  '42501', null, 'consumed invitation cannot be reused'
);
select lives_ok(
  $$select public.get_ai_interview_portal_state((capability->>'capability_id')::uuid) from pg_temp.portal_test_state$$,
  'capability owner can read the safe portal state'
);
select ok(not (
  select public.get_ai_interview_portal_state((capability->>'capability_id')::uuid)::text
    ~ '(access_token|invitation_url|audio_storage_path)'
  from pg_temp.portal_test_state
), 'portal state omits legacy secrets and storage paths');
select throws_ok(
  $$select public.transition_ai_interview_portal((capability->>'capability_id')::uuid, 'start', '{"question_order":1}', 'start0001') from pg_temp.portal_test_state$$,
  'P0001', 'consent required', 'interview cannot start before required consent and device test'
);
select lives_ok(
  $$select public.transition_ai_interview_portal((capability->>'capability_id')::uuid, 'accept_consent', '{"participation_consent":true,"recording_consent":true}', 'consent01') from pg_temp.portal_test_state$$,
  'required interview consent is accepted through the capability'
);
select lives_ok(
  $$select public.transition_ai_interview_portal((capability->>'capability_id')::uuid, 'microphone_test', '{}', 'microph01') from pg_temp.portal_test_state$$,
  'microphone readiness is recorded through the capability'
);
select lives_ok(
  $$select public.transition_ai_interview_portal((capability->>'capability_id')::uuid, 'start', '{"question_order":1}', 'start0002') from pg_temp.portal_test_state$$,
  'authorized candidate can start the interview'
);
select throws_ok(
  $$select public.prepare_ai_interview_media_upload((capability->>'capability_id')::uuid, '73000000-0000-4000-8000-000000000001', 'application/octet-stream', 1024) from pg_temp.portal_test_state$$,
  '22023', null, 'unapproved media MIME is rejected'
);
select throws_ok(
  $$select public.prepare_ai_interview_media_upload((capability->>'capability_id')::uuid, '73000000-0000-4000-8000-000000000001', 'audio/webm', 26214401) from pg_temp.portal_test_state$$,
  '22023', null, 'oversized audio is rejected'
);
update pg_temp.portal_test_state
   set upload = public.prepare_ai_interview_media_upload(
     (capability->>'capability_id')::uuid,
     '73000000-0000-4000-8000-000000000001', 'audio/webm', 1024
   );
select like(upload->>'object_path', 'company/71000000-0000-4000-8000-000000000001/session/74000000-0000-4000-8000-000000000001/question/73000000-0000-4000-8000-000000000001/%', 'upload is restricted to the exact tenant/session/question path')
from pg_temp.portal_test_state;

select set_config('request.jwt.claim.sub', '75000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"75000000-0000-4000-8000-000000000002","is_anonymous":true}', true);
select throws_ok(
  $$select public.get_ai_interview_portal_state((capability->>'capability_id')::uuid) from pg_temp.portal_test_state$$,
  '42501', null, 'a different Auth session cannot use the capability'
);
reset role;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
update pg_temp.portal_test_state
   set first_invitation = public.issue_secure_ai_interview_invitation(
     '74000000-0000-4000-8000-000000000001', 'https://test.visaflow.invalid'
   );
reset role;
update public.ai_interview_portal_invitations
   set expires_at = now() - interval '1 second'
 where id = (select (first_invitation->>'invitation_id')::uuid from pg_temp.portal_test_state);
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '75000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"75000000-0000-4000-8000-000000000003","is_anonymous":true}', true);
select throws_ok(
  $$select public.exchange_ai_interview_invitation(encode(extensions.digest(split_part(first_invitation->>'url', '#interview_invite=', 2), 'sha256'), 'hex')) from pg_temp.portal_test_state$$,
  '42501', null, 'expired invitation cannot be exchanged'
);
reset role;

set local role anon;
select throws_ok($$select count(*) from public.ai_interview_sessions$$, '42501', null, 'anon cannot read interview sessions directly');
select throws_ok($$select count(*) from public.ai_interview_answers$$, '42501', null, 'anon cannot read interview answers directly');
select throws_ok($$select count(*) from storage.objects where bucket_id = 'ai-interview-audio'$$, '42501', null, 'anon cannot list interview audio directly');
reset role;

select * from finish();
rollback;
