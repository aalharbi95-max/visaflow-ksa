export const AUTHORIZATION_AGENCY_STATUSES = Object.freeze([
  'New',
  'Viewed',
  'Acknowledged',
  'Accepted',
  'Rejected',
])

export const AUTHORIZATION_TIMELINE_STAGES = Object.freeze([
  'Created',
  'Sent',
  'Viewed',
  'Acknowledged',
  'Accepted / Rejected',
])

const COMPANY_ACTION_ROLES = new Set([
  'Admin',
  'Company Admin',
  'Visa Team',
])

export function isAuthorizationCompanyActor(role) {
  return COMPANY_ACTION_ROLES.has(String(role || '').trim())
}

export function getAuthorizationAgencyStatus(authorization = {}) {
  const value = String(authorization.agency_status || '').trim()
  return AUTHORIZATION_AGENCY_STATUSES.includes(value) ? value : 'New'
}

export function getAuthorizationActions(authorization = {}, role = '') {
  if (String(role || '').trim() === 'Agency') {
    const status = getAuthorizationAgencyStatus(authorization)
    return {
      canView: status === 'New',
      canAcknowledge: ['New', 'Viewed'].includes(status),
      canAccept: status === 'Acknowledged',
      canReject: status === 'Acknowledged',
    }
  }

  const canSend = isAuthorizationCompanyActor(role)
    && authorization.status !== 'Cancelled'
    && Boolean(authorization.agency_id)

  return {
    canSend: canSend && !authorization.sent_at,
    canResend: canSend && Boolean(authorization.sent_at),
  }
}

export function buildAuthorizationTimeline(events = []) {
  const sorted = [...events].sort(
    (left, right) => {
      const timeDifference = new Date(left.created_at || 0) - new Date(right.created_at || 0)
      return timeDifference || Number(left.id || 0) - Number(right.id || 0)
    }
  )

  if (sorted.length) {
    return sorted.map((event) => ({
      stage: event.event_type,
      complete: true,
      at: event.created_at || null,
      by: event.actor_name || event.actor_email || null,
      reason: event.reason || null,
    }))
  }
  return AUTHORIZATION_TIMELINE_STAGES.map((stage) => {
    return {
      stage,
      complete: false,
      at: null,
      by: null,
      reason: null,
    }
  })
}

export async function invokeAuthorizationWorkflow(
  supabase,
  action,
  authorizationId = null,
  input = {},
  idempotencyKey = globalThis.crypto?.randomUUID?.()
) {
  if (!supabase?.functions?.invoke) {
    throw new Error('Authorization workflow service is unavailable.')
  }

  const body = {
    action,
    idempotency_key: idempotencyKey,
    ...(authorizationId ? { authorization_id: authorizationId } : {}),
    input,
  }

  if ('company_id' in input) {
    throw new Error('company_id is server-controlled and cannot be supplied by the client.')
  }
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(idempotencyKey || ''))) {
    throw new Error('A valid idempotency key is required.')
  }

  const { data, error } = await supabase.functions.invoke('authorization-workflow', { body })

  if (error) throw error
  if (!data?.ok) throw new Error(data?.error || 'Authorization workflow failed.')

  return data
}
