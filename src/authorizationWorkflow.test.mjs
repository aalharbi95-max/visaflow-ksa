import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  buildAuthorizationTimeline,
  getAuthorizationActions,
  getAuthorizationAgencyStatus,
  invokeAuthorizationWorkflow,
} from './authorizationWorkflow.mjs'

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
