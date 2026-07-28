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
  'Visa Team',
  'Recruitment Manager',
  'Recruitment Director',
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
    (left, right) => new Date(left.created_at || 0) - new Date(right.created_at || 0)
  )

  return AUTHORIZATION_TIMELINE_STAGES.map((stage) => {
    const matching = stage === 'Accepted / Rejected'
      ? sorted.find((event) => ['Accepted', 'Rejected'].includes(event.event_type))
      : sorted.find((event) => event.event_type === stage)

    return {
      stage: matching?.event_type || stage,
      complete: Boolean(matching),
      at: matching?.created_at || null,
      by: matching?.actor_name || matching?.actor_email || null,
      reason: matching?.reason || null,
    }
  })
}

export async function invokeAuthorizationWorkflow(
  supabase,
  action,
  authorizationId = null,
  input = {}
) {
  if (!supabase?.functions?.invoke) {
    throw new Error('Authorization workflow service is unavailable.')
  }

  const body = {
    action,
    ...(authorizationId ? { authorization_id: authorizationId } : {}),
    input,
  }

  if ('company_id' in input) {
    throw new Error('company_id is server-controlled and cannot be supplied by the client.')
  }

  const { data, error } = await supabase.functions.invoke('authorization-workflow', { body })

  if (error) throw error
  if (!data?.ok) throw new Error(data?.error || 'Authorization workflow failed.')

  return data
}
