import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  buildAuthorizationTimeline,
  getAuthorizationActions,
  getAuthorizationAgencyStatus,
  invokeAuthorizationWorkflow,
} from './authorizationWorkflow.mjs'
import { buildNotificationDedupeKey } from './notificationDedupe.mjs'

test('new agency authorization exposes View and Acknowledge only', () => {
  assert.deepEqual(getAuthorizationActions({ agency_status: 'New' }, 'Agency'), {
    canView: true,
    canAcknowledge: true,
    canAccept: false,
    canReject: false,
  })
})

test('acknowledged authorization exposes Accept and Reject', () => {
  assert.deepEqual(getAuthorizationActions({ agency_status: 'Acknowledged' }, 'Agency'), {
    canView: false,
    canAcknowledge: false,
    canAccept: true,
    canReject: true,
  })
})

test('unknown legacy status is normalized to New', () => {
  assert.equal(getAuthorizationAgencyStatus({ status: 'Open' }), 'New')
})

test('company sees Send before first delivery', () => {
  const actions = getAuthorizationActions(
    { agency_id: 'agency-1', status: 'New', sent_at: null },
    'Visa Team'
  )
  assert.equal(actions.canSend, true)
  assert.equal(actions.canResend, false)
})

test('company sees Resend after first delivery', () => {
  const actions = getAuthorizationActions(
    { agency_id: 'agency-1', status: 'Sent to Agency', sent_at: '2026-07-29T10:00:00Z' },
    'Company Admin'
  )
  assert.equal(actions.canSend, false)
  assert.equal(actions.canResend, true)
})

test('timeline contains Created through final Rejected with reason', () => {
  const timeline = buildAuthorizationTimeline([
    { event_type: 'Rejected', created_at: '2026-07-29T12:00:00Z', actor_name: 'Agency User', reason: 'Quota unavailable' },
    { event_type: 'Created', created_at: '2026-07-29T08:00:00Z', actor_name: 'Visa User' },
    { event_type: 'Sent', created_at: '2026-07-29T09:00:00Z', actor_name: 'Visa User' },
    { event_type: 'Viewed', created_at: '2026-07-29T10:00:00Z', actor_name: 'Agency User' },
    { event_type: 'Acknowledged', created_at: '2026-07-29T11:00:00Z', actor_name: 'Agency User' },
  ])

  assert.equal(timeline.length, 5)
  assert.equal(timeline.every((item) => item.complete), true)
  assert.equal(timeline.at(-1).stage, 'Rejected')
  assert.equal(timeline.at(-1).reason, 'Quota unavailable')
})

test('timeline preserves every Resend and Cancelled event chronologically', () => {
  const timeline = buildAuthorizationTimeline([
    { id: 4, event_type: 'Cancelled', created_at: '2026-07-29T11:00:00Z' },
    { id: 2, event_type: 'Sent', created_at: '2026-07-29T09:00:00Z' },
    { id: 3, event_type: 'Resent', created_at: '2026-07-29T10:00:00Z' },
    { id: 1, event_type: 'Created', created_at: '2026-07-29T08:00:00Z' },
  ])
  assert.deepEqual(timeline.map((event) => event.stage), ['Created', 'Sent', 'Resent', 'Cancelled'])
})

test('recruitment managers and directors cannot mutate authorizations', () => {
  assert.equal(getAuthorizationActions({ agency_id: 'agency-1' }, 'Recruitment Manager').canSend, false)
  assert.equal(getAuthorizationActions({ agency_id: 'agency-1' }, 'Recruitment Director').canSend, false)
})

test('client invocation never accepts company_id', async () => {
  await assert.rejects(
    invokeAuthorizationWorkflow(
      { functions: { invoke: async () => ({ data: { ok: true } }) } },
      'send',
      'auth-1',
      { company_id: 'attacker-company' }
    ),
    /server-controlled/
  )
})

test('workflow invokes the protected Edge Function with an idempotent-shaped body', async () => {
  let received
  const result = await invokeAuthorizationWorkflow(
    {
      functions: {
        invoke: async (name, options) => {
          received = { name, options }
          return { data: { ok: true, authorization: { id: 'auth-1' } }, error: null }
        },
      },
    },
    'acknowledge',
    'auth-1',
    { reason: 'Received' },
    '123e4567-e89b-42d3-a456-426614174000'
  )

  assert.equal(received.name, 'authorization-workflow')
  assert.deepEqual(received.options.body, {
    action: 'acknowledge',
    idempotency_key: '123e4567-e89b-42d3-a456-426614174000',
    authorization_id: 'auth-1',
    input: { reason: 'Received' },
  })
  assert.equal(result.authorization.id, 'auth-1')
})

test('protected Authorization writes are absent from the browser application', async () => {
  const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\.from\(["']visa_authorizations["']\)\s*\.(insert|update|upsert|delete)/s)
})

test('protected notification writes are absent from browser production files', async () => {
  const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\.from\(["']notification_events["']\)\s*\.(insert|update|upsert|delete)/s)
  assert.match(source, /\.rpc\(["']notification_event_mutate["']/)
})

test('migration enforces agency isolation and server-controlled protected writes', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20260729000100_prelaunch_authorization_workflow.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /revoke insert, update, delete on table public\.visa_authorizations from anon, authenticated/i)
  assert.match(migration, /public\.current_log_actor\(\)/i)
  assert.match(migration, /agency_company_user_access/i)
  assert.match(migration, /authorization_events/i)
  assert.match(migration, /revoke insert, update, delete on table public\.notification_events from anon, authenticated/i)
})

test('Edge Function delegates all writes to one atomic RPC', async () => {
  const source = await readFile(
    new URL('../supabase/functions/authorization-workflow/index.ts', import.meta.url),
    'utf8'
  )
  assert.match(source, /\.rpc\("authorization_workflow_mutate"/)
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.doesNotMatch(source, /\.from\(/)
})

test('atomic RPC locks allocation and authorization rows and creates events and notifications', async () => {
  const source = await readFile(
    new URL('../supabase/migrations/20260729000110_prelaunch_workflow_atomic_rpcs.sql', import.meta.url),
    'utf8'
  )
  assert.match(source, /public\.visa_allocations[\s\S]*for update/i)
  assert.match(source, /public\.visa_authorizations[\s\S]*for update/i)
  assert.match(source, /AUTHORIZATION_SENT/)
  assert.match(source, /AUTHORIZATION_ACCEPTED/)
  assert.match(source, /AUTHORIZATION_REJECTED/)
  assert.match(source, /'Recruitment Manager', 'Recruitment Director'/)
  assert.match(source, /idempotency_key/)
  assert.match(source, /set search_path = ''/i)
})

test('Edge Function enforces CORS allowlist, body limit, JWT and rate limit', async () => {
  const source = await readFile(
    new URL('../supabase/functions/authorization-workflow/index.ts', import.meta.url),
    'utf8'
  )
  assert.match(source, /AUTHORIZATION_WORKFLOW_ALLOWED_ORIGINS/)
  assert.match(source, /Vary/)
  assert.match(source, /MAX_BODY_BYTES/)
  assert.match(source, /auth\.getUser/)
  assert.match(source, /rate_limit_exceeded/)
  assert.doesNotMatch(source, /Access-Control-Allow-Origin["']:\s*["']\*["']/)
})

test('migration documents preflight, timeouts and inactive/ambiguous backfill safety', async () => {
  const source = await readFile(
    new URL('../supabase/migrations/20260729000100_prelaunch_authorization_workflow.sql', import.meta.url),
    'utf8'
  )
  assert.match(source, /lock_timeout/)
  assert.match(source, /statement_timeout/)
  assert.match(source, /duplicate auth identities/)
  assert.match(source, /agency\.status = 'Active'/)
  assert.match(source, /having count\(distinct access\.agency_id\) = 1/i)
})

test('preflight does not read agency_id before adding it to the staging schema', async () => {
  const source = await readFile(
    new URL('../supabase/migrations/20260729000100_prelaunch_authorization_workflow.sql', import.meta.url),
    'utf8'
  )
  const agencyColumnDdl = source.indexOf('add column if not exists agency_id')
  const firstAgencyIdRead = source.indexOf('where authorization_row.agency_id is null')
  assert.notEqual(agencyColumnDdl, -1)
  assert.notEqual(firstAgencyIdRead, -1)
  assert.ok(agencyColumnDdl < firstAgencyIdRead)
})

test('notification mutation requires tenant membership and recipient access', async () => {
  const source = await readFile(
    new URL('../supabase/migrations/20260729000110_prelaunch_workflow_atomic_rpcs.sql', import.meta.url),
    'utf8'
  )
  const mutation = source.slice(source.indexOf('create or replace function public.notification_event_mutate'))
  assert.match(
    mutation,
    /access\.company_id = notification_events\.company_id[\s\S]*access\.agency_id = notification_events\.agency_id/i
  )
  assert.match(mutation, /user_id is null or user_id = auth\.uid\(\)/i)
  assert.match(mutation, /recipient_role is null or recipient_role = 'Agency'/i)
  assert.doesNotMatch(
    mutation,
    /or \(actor->>'role' = 'Agency' and agency_id::text = actor->>'agency_id'\)/
  )
})

test('idempotent return occurs only after authorization tenant access checks', async () => {
  const source = await readFile(
    new URL('../supabase/migrations/20260729000110_prelaunch_workflow_atomic_rpcs.sql', import.meta.url),
    'utf8'
  )
  const protectedMutation = source.slice(source.indexOf('if p_authorization_id is null'))
  const companyAccessCheck = protectedMutation.indexOf('company_authorization_access_denied')
  const agencyAccessCheck = protectedMutation.indexOf('agency_authorization_access_denied')
  const priorEventLookup = protectedMutation.indexOf('idempotency_key = operation_idempotency_key')
  const earlyReturn = protectedMutation.indexOf("'idempotent', true")
  assert.ok(companyAccessCheck >= 0 && companyAccessCheck < priorEventLookup)
  assert.ok(agencyAccessCheck >= 0 && agencyAccessCheck < priorEventLookup)
  assert.ok(priorEventLookup < earlyReturn)
  assert.match(protectedMutation, /authorization_row\.company_id = actor\.company_id[\s\S]*for update/i)
  assert.match(
    protectedMutation,
    /authorization_row\.agency_id = actor\.agency_id[\s\S]*access\.company_id = authorization_row\.company_id/i
  )
})

test('authorization create omits visa_id when the request needs the column default', async () => {
  const source = await readFile(
    new URL('../supabase/migrations/20260729000110_prelaunch_workflow_atomic_rpcs.sql', import.meta.url),
    'utf8'
  )
  const defaultBranchStart = source.indexOf("if nullif(p_input->>'visa_id', '') is null then")
  const explicitVisaBranch = source.indexOf('else', defaultBranchStart)
  const defaultBranch = source.slice(defaultBranchStart, explicitVisaBranch)
  assert.notEqual(defaultBranchStart, -1)
  assert.match(defaultBranch, /company_id,\s*visa_no,\s*request_no/i)
  assert.doesNotMatch(defaultBranch, /company_id,\s*visa_id,/i)
})

test('authorization idempotency keys are bound to the requested operation', async () => {
  const source = await readFile(
    new URL('../supabase/migrations/20260729000110_prelaunch_workflow_atomic_rpcs.sql', import.meta.url),
    'utf8'
  )
  assert.match(source, /operation_idempotency_key := normalized_action \|\| ':' \|\| p_idempotency_key/i)
  assert.match(source, /creation_idempotency_key = operation_idempotency_key/i)
  assert.match(source, /idempotency_key = operation_idempotency_key/i)
  assert.doesNotMatch(source, /idempotency_key = p_idempotency_key/i)
})

test('notification create is deduplicated and audit timeline deletion is restricted', async () => {
  const workflowMigration = await readFile(
    new URL('../supabase/migrations/20260729000100_prelaunch_authorization_workflow.sql', import.meta.url),
    'utf8'
  )
  const rpcMigration = await readFile(
    new URL('../supabase/migrations/20260729000110_prelaunch_workflow_atomic_rpcs.sql', import.meta.url),
    'utf8'
  )
  assert.match(rpcMigration, /notification_idempotency_key := 'notification:create:'/i)
  assert.match(rpcMigration, /coalesce\(requested_agency::text, 'company'\)/i)
  assert.match(rpcMigration, /on conflict \(company_id, dedupe_key\)[\s\S]*do nothing/i)
  assert.match(workflowMigration, /authorization_id uuid not null[\s\S]*on delete restrict/i)
  assert.match(workflowMigration, /drop policy if exists visa_authorizations_insert_tenant_policy/i)
  assert.match(workflowMigration, /drop policy if exists visa_authorizations_update_tenant_policy/i)
  assert.match(workflowMigration, /drop policy if exists visa_authorizations_delete_tenant_policy/i)
})

test('notification dedupe identity survives retry text and timestamp changes', async () => {
  const base = {
    company_id: 'company-1',
    agency_id: 'agency-1',
    related_table: 'candidates',
    related_id: 'candidate-1',
    response_status: 'Pending',
    message: 'First message',
    response_at: '2026-07-29T10:00:00Z',
  }
  const first = await buildNotificationDedupeKey('CANDIDATE_UPDATED', base, 'company-1')
  const retry = await buildNotificationDedupeKey(
    'CANDIDATE_UPDATED',
    {
      ...base,
      message: 'Retry message changed',
      response_at: '2026-07-29T10:05:00Z',
    },
    'company-1'
  )
  assert.equal(retry, first)
})

test('notification dedupe identity differs across operation types', async () => {
  const identity = {
    company_id: 'company-1',
    related_table: 'interviews',
    related_id: 'interview-1',
  }
  const approved = await buildNotificationDedupeKey(
    'INTERVIEW_SCHEDULE_APPROVED',
    identity,
    'company-1'
  )
  const rejected = await buildNotificationDedupeKey(
    'INTERVIEW_SCHEDULE_REJECTED',
    identity,
    'company-1'
  )
  assert.notEqual(approved, rejected)
})

test('notification caller sends dedupe_key at the payload top level', async () => {
  const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8')
  const helper = source.slice(
    source.indexOf('async function triggerExternalNotification'),
    source.indexOf('const REPORT_STUDIO_TEMPLATES')
  )
  assert.match(helper, /const dedupeKey = await buildNotificationDedupeKey/)
  assert.match(helper, /dedupe_key:\s*dedupeKey/)
})
