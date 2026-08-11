import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildHousingNotificationRecipient, buildHousingNotificationSettings, summarizeHousingNotifications } from './housingNotifications.mjs'

test('notification summary separates operational and delivery states', () => {
  const result = summarizeHousingNotifications(
    [{ status: 'Unread', severity: 'Critical' }, { status: 'Read', severity: 'Info' }],
    [{ status: 'Queued' }, { status: 'Sent' }, { status: 'Failed' }],
  )
  assert.deepEqual(result, { unread: 1, critical: 1, queued: 1, sent: 1, failed: 1 })
})

test('notification settings keep safe defaults and bounded schedules', () => {
  const result = buildHousingNotificationSettings({ sms_enabled: true, digest_hour: 99 }, 'company-1')
  assert.equal(result.sms_enabled, true)
  assert.equal(result.digest_hour, 8)
  assert.deepEqual(result.critical_incident_channels, ['In App'])
})

test('recipients require channel-specific verified-looking destinations', () => {
  const result = buildHousingNotificationRecipient({ name: 'HSE Manager', channels: ['SMS', 'WhatsApp'], phone_e164: '+966 50 000 0000', whatsapp_e164: '+966500000001' }, 'company-1')
  assert.equal(result.phone_e164, '+966500000000')
  assert.throws(() => buildHousingNotificationRecipient({ name: 'HSE', channels: ['Email'], email: 'bad' }, 'company-1'), /valid email/)
})
