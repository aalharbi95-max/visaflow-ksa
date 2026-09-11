import test from 'node:test'
import assert from 'node:assert/strict'
import { createOfflineOperation, isHousingNetworkError, OFFLINE_OPERATION_TYPES, summarizeOfflineOperations } from './housingOffline.mjs'

test('creates a durable pending field operation', () => {
  const item = createOfflineOperation(OFFLINE_OPERATION_TYPES.CREATE_RECORD, { table: 'housing_inspections', input: { score: 91 } }, new Date('2026-08-11T10:00:00Z'))
  assert.equal(item.status, 'Pending')
  assert.equal(item.attempts, 0)
  assert.equal(item.payload.input.score, 91)
  assert.equal(item.created_at, '2026-08-11T10:00:00.000Z')
})

test('rejects unsupported offline operations', () => {
  assert.throws(() => createOfflineOperation('DELETE_ALL', {}), /Unsupported offline operation/)
})

test('summarizes queue states for the offline dashboard', () => {
  assert.deepEqual(summarizeOfflineOperations([{ status: 'Pending' }, { status: 'Pending' }, { status: 'Failed' }, { status: 'Synced' }]), { total: 4, pending: 2, syncing: 0, failed: 1, synced: 1 })
})

test('recognizes browser connectivity failures', () => {
  assert.equal(isHousingNetworkError(new TypeError('Failed to fetch')), true)
  assert.equal(isHousingNetworkError(new Error('Validation failed')), false)
})
