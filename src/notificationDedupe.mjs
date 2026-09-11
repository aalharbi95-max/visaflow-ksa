const textEncoder = new TextEncoder()

function clean(value) {
  return String(value ?? '').trim()
}

function stableTargetIdentity(data) {
  return (
    clean(data.operation_id) ||
    clean(data.action_key) ||
    clean(data.event_id) ||
    clean(data.related_id) ||
    clean(data.request_id) ||
    clean(data.request_no) ||
    clean(data.requestNo) ||
    clean(data.candidate_id) ||
    clean(data.notification_id)
  )
}

async function sha256Hex(value) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', textEncoder.encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function buildNotificationDedupeKey(type, data = {}, workspaceCompanyId = null) {
  const normalizedType = clean(type)
  const explicitIdentity = clean(data.dedupe_key)
  const targetIdentity = stableTargetIdentity(data)

  if (!normalizedType) {
    throw new Error('notification type is required for dedupe')
  }
  if (!explicitIdentity && !targetIdentity) {
    throw new Error('stable notification operation identity is required for dedupe')
  }

  const logicalIdentity = JSON.stringify([
    'notification-create-v1',
    normalizedType,
    clean(workspaceCompanyId || data.company_id),
    clean(data.agency_id || data.original_agency_id),
    clean(data.related_table),
    explicitIdentity || targetIdentity,
    clean(data.response_status || data.agency_decision || data.status || data.delivery_status),
  ])

  return `v1:${normalizedType}:${await sha256Hex(logicalIdentity)}`
}

