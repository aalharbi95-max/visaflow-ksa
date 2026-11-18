import test from 'node:test'
import assert from 'node:assert/strict'
import { housingRecoveryUser, housingRecoveryRedirect, validateHousingPassword, housingRecoveryError } from './housingPasswordRecovery.mjs'

test('only the recovery event grants password-reset UI access', () => {
  const session = { user: { id: 'user-1' } }
  for (const event of ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'SIGNED_OUT']) assert.equal(housingRecoveryUser(event, session), null)
  assert.equal(housingRecoveryUser('PASSWORD_RECOVERY', null), null)
  assert.equal(housingRecoveryUser('PASSWORD_RECOVERY', session), 'user-1')
})
test('owner and tenant callbacks stay on the housing recovery route', () => {
  assert.equal(housingRecoveryRedirect('https://www.visaflowksa.com'), 'https://www.visaflowksa.com/housing/reset-password')
  assert.equal(housingRecoveryRedirect('https://www.visaflowksa.com', true), 'https://www.visaflowksa.com/housing/reset-password?owner=1')
})
test('rejects short or mismatched passwords without silently trimming them', () => {
  assert.ok(validateHousingPassword('short', 'short'))
  assert.ok(validateHousingPassword('long-password', 'different'))
  assert.equal(validateHousingPassword(' long-password ', ' long-password '), '')
})
test('rate limiting and errors never expose provider details', () => {
  assert.match(housingRecoveryError({ status: 429 }), /دقيقة/)
  assert.ok(!housingRecoveryError({ message: 'private diagnostic' }).includes('private'))
})
