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
    'Recruitment Director'
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
    { reason: 'Received' }
  )

  assert.equal(received.name, 'authorization-workflow')
  assert.deepEqual(received.options.body, {
    action: 'acknowledge',
    authorization_id: 'auth-1',
    input: { reason: 'Received' },
  })
  assert.equal(result.authorization.id, 'auth-1')
})

test('protected Authorization writes are absent from the browser application', async () => {
  const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\.from\(["']visa_authorizations["']\)\s*\.(insert|update|upsert|delete)/s)
})

test('migration enforces agency isolation and server-controlled protected writes', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20260729000100_prelaunch_authorization_workflow.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /revoke insert, update, delete on table public\.visa_authorizations from anon, authenticated/i)
  assert.match(migration, /agency_id = public\.current_app_user_agency_id\(\)/i)
  assert.match(migration, /agency_company_user_access/i)
  assert.match(migration, /authorization_events/i)
})

test('Edge Function covers send, resend, view, acknowledge, accept and reject transitions', async () => {
  const source = await readFile(
    new URL('../supabase/functions/authorization-workflow/index.ts', import.meta.url),
    'utf8'
  )
  assert.match(source, /confirm_resend/)
  assert.match(source, /expected_sent_at/)
  assert.match(source, /view: \{ allowed: \["New"\], status: "Viewed"/)
  assert.match(source, /acknowledge: \{ allowed: \["New", "Viewed"\], status: "Acknowledged"/)
  assert.match(source, /accept: \{ allowed: \["Acknowledged"\], status: "Accepted"/)
  assert.match(source, /reject: \{ allowed: \["Acknowledged"\], status: "Rejected"/)
  assert.match(source, /rejection_reason_required/)
})

test('Edge Function creates role-targeted notifications and immutable timeline events', async () => {
  const source = await readFile(
    new URL('../supabase/functions/authorization-workflow/index.ts', import.meta.url),
    'utf8'
  )
  assert.match(source, /AUTHORIZATION_SENT/)
  assert.match(source, /AUTHORIZATION_ACCEPTED/)
  assert.match(source, /AUTHORIZATION_REJECTED/)
  assert.match(source, /MANAGER_NOTIFICATION_ROLES = \["Recruitment Manager", "Recruitment Director"\]/)
  assert.match(source, /\.from\("notification_events"\)\.insert\(notificationRows\)/)
  assert.match(source, /\.from\("authorization_events"\)\.insert/)
  assert.match(source, /company_id_is_server_controlled/)
  assert.match(source, /requireAgencyMembership/)
})
