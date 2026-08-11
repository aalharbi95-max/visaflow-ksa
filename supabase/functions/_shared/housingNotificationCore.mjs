const CHANNELS = new Set(['Email', 'SMS', 'WhatsApp'])

export function cleanChannel(value) {
  const channel = String(value || '').trim()
  if (!CHANNELS.has(channel)) throw new Error('unsupported_channel')
  return channel
}

export function formatNotificationMessage(event = {}, language = 'ar') {
  const arabic = language !== 'en'
  const title = String(arabic ? event.title_ar : event.title_en || event.title_ar || '').trim()
  const body = String(arabic ? event.body_ar : event.body_en || event.body_ar || '').trim()
  if (!title || !body) throw new Error('notification_content_missing')
  return { title, body, text: `${title}\n${body}` }
}

export function buildResendRequest(delivery, event, fromEmail) {
  if (cleanChannel(delivery?.channel) !== 'Email') throw new Error('email_delivery_required')
  const message = formatNotificationMessage(event, 'ar')
  return {
    from: String(fromEmail || '').trim(),
    to: [String(delivery.destination || '').trim()],
    subject: message.title,
    text: message.text,
    html: `<div dir="rtl" style="font-family:Arial,sans-serif"><h2>${escapeHtml(message.title)}</h2><p>${escapeHtml(message.body)}</p></div>`,
  }
}

export function buildTwilioForm(delivery, event, from) {
  const channel = cleanChannel(delivery?.channel)
  if (!['SMS', 'WhatsApp'].includes(channel)) throw new Error('twilio_delivery_required')
  const message = formatNotificationMessage(event, 'ar')
  const prefix = channel === 'WhatsApp' ? 'whatsapp:' : ''
  const to = String(delivery.destination || '').trim()
  const sender = String(from || '').trim()
  return new URLSearchParams({ To: `${prefix}${to}`, From: `${prefix}${sender}`, Body: message.text })
}

export function retryDelayMinutes(attempts = 1) {
  return Math.min(240, Math.max(1, 2 ** Math.max(0, Number(attempts) - 1) * 5))
}

export function sanitizeProviderError(error) {
  return String(error?.message || error || 'provider_error').replace(/[\r\n]+/g, ' ').slice(0, 500)
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}
