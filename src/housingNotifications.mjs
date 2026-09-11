export const HOUSING_NOTIFICATION_CHANNELS = ['In App', 'Email', 'SMS', 'WhatsApp']

export function summarizeHousingNotifications(events = [], deliveries = []) {
  return {
    unread: events.filter((item) => item.status === 'Unread').length,
    critical: events.filter((item) => item.status === 'Unread' && ['High', 'Critical'].includes(item.severity)).length,
    queued: deliveries.filter((item) => ['Queued', 'Processing'].includes(item.status)).length,
    sent: deliveries.filter((item) => item.status === 'Sent').length,
    failed: deliveries.filter((item) => item.status === 'Failed').length,
  }
}

export function buildHousingNotificationSettings(input = {}, companyId) {
  const channels = (key, fallback) => {
    const value = Array.isArray(input[key]) ? input[key] : fallback
    const unique = [...new Set(value.filter((item) => HOUSING_NOTIFICATION_CHANNELS.includes(item)))]
    return unique.length ? unique : ['In App']
  }
  return {
    company_id: String(companyId || '').trim(),
    in_app_enabled: input.in_app_enabled !== false,
    email_enabled: input.email_enabled !== false,
    sms_enabled: Boolean(input.sms_enabled),
    whatsapp_enabled: Boolean(input.whatsapp_enabled),
    critical_incident_channels: channels('critical_incident_channels', ['In App']),
    weekly_digest_channels: channels('weekly_digest_channels', ['In App', 'Email']),
    license_days_before: boundedInteger(input.license_days_before, 30, 1, 365),
    maintenance_sla_hours: boundedInteger(input.maintenance_sla_hours, 24, 1, 720),
    digest_weekday: boundedInteger(input.digest_weekday, 0, 0, 6),
    digest_hour: boundedInteger(input.digest_hour, 8, 0, 23),
    timezone: String(input.timezone || 'Asia/Riyadh').trim(),
  }
}

export function buildHousingNotificationRecipient(input = {}, companyId) {
  const channels = [...new Set((input.channels || []).filter((item) => HOUSING_NOTIFICATION_CHANNELS.includes(item)))]
  const email = String(input.email || '').trim() || null
  const phone = normalizeE164(input.phone_e164)
  const whatsapp = normalizeE164(input.whatsapp_e164)
  if (!String(input.name || '').trim()) throw new Error('Recipient name is required.')
  if (!channels.length) throw new Error('Select at least one notification channel.')
  if (channels.includes('Email') && !/^\S+@\S+\.\S+$/.test(email || '')) throw new Error('A valid email is required.')
  if (channels.includes('SMS') && !phone) throw new Error('An E.164 SMS number is required.')
  if (channels.includes('WhatsApp') && !whatsapp) throw new Error('An E.164 WhatsApp number is required.')
  return {
    company_id: String(companyId || '').trim(), name: String(input.name).trim(),
    role_label: String(input.role_label || '').trim() || null, site_id: input.site_id || null,
    email, phone_e164: phone, whatsapp_e164: whatsapp, channels,
    critical_only: Boolean(input.critical_only), is_active: input.is_active !== false,
  }
}

function normalizeE164(value) {
  const normalized = String(value || '').replace(/[\s()-]/g, '')
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value)
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback
}
