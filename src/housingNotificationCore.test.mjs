import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildResendRequest,
  buildTwilioForm,
  formatNotificationMessage,
  retryDelayMinutes,
  sanitizeProviderError,
} from '../supabase/functions/_shared/housingNotificationCore.mjs'

const event = { title_ar: 'حادث عاجل', title_en: 'Urgent incident', body_ar: 'تسرب مياه', body_en: 'Water leak' }

test('notification messages support Arabic and English', () => {
  assert.equal(formatNotificationMessage(event, 'ar').text, 'حادث عاجل\nتسرب مياه')
  assert.equal(formatNotificationMessage(event, 'en').text, 'Urgent incident\nWater leak')
})

test('email payload is server-owned and escapes HTML', () => {
  const request = buildResendRequest({ channel: 'Email', destination: 'hse@example.com' }, { ...event, body_ar: '<script>' }, 'alerts@example.com')
  assert.deepEqual(request.to, ['hse@example.com'])
  assert.match(request.html, /&lt;script&gt;/)
  assert.equal(request.subject, 'حادث عاجل')
})

test('Twilio forms distinguish SMS and WhatsApp destinations', () => {
  const sms = buildTwilioForm({ channel: 'SMS', destination: '+966500000000' }, event, '+12025550123')
  const whatsapp = buildTwilioForm({ channel: 'WhatsApp', destination: '+966500000000' }, event, '+14155238886')
  assert.equal(sms.get('To'), '+966500000000')
  assert.equal(whatsapp.get('To'), 'whatsapp:+966500000000')
})

test('provider failures are sanitized and retries use bounded backoff', () => {
  assert.equal(retryDelayMinutes(1), 5)
  assert.equal(retryDelayMinutes(9), 240)
  assert.equal(sanitizeProviderError(new Error('bad\nsecret')), 'bad secret')
})
