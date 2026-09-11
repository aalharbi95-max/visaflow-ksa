import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEmployeeStatusEventInput, employeeEventUrgency, eventRequiresCheckout, isTemporaryEmployeeEvent, summarizeEmployeeStatusEvents } from './housingEmployeeStatus.mjs'

test('leave and exit events require supervisor-reviewed checkout when a bed is active', () => {
  assert.equal(eventRequiresCheckout('Annual Leave', true), true)
  assert.equal(eventRequiresCheckout('Final Exit', true), true)
  assert.equal(eventRequiresCheckout('Return to Work', true), false)
  assert.equal(eventRequiresCheckout('Termination', false), false)
})

test('builds and validates employee status events', () => {
  assert.deepEqual(buildEmployeeStatusEventInput({ employeeId: 'e1', eventType: 'Exit Reentry', effectiveDate: '2026-08-12', expectedReturnDate: '2026-09-12' }), {
    employeeId: 'e1', eventType: 'Exit Reentry', effectiveDate: '2026-08-12', expectedReturnDate: '2026-09-12', source: 'Manual', sourceReference: null,
  })
  assert.throws(() => buildEmployeeStatusEventInput({ employeeId: 'e1', eventType: 'Exit Reentry', effectiveDate: '2026-08-12', expectedReturnDate: '2026-08-11' }), /cannot precede/)
  assert.throws(() => buildEmployeeStatusEventInput({ eventType: 'Final Exit', effectiveDate: '2026-08-12' }), /Employee is required/)
})

test('identifies temporary leave events', () => {
  assert.equal(isTemporaryEmployeeEvent('Annual Leave'), true)
  assert.equal(isTemporaryEmployeeEvent('Exit Reentry'), true)
  assert.equal(isTemporaryEmployeeEvent('Final Exit'), false)
})

test('summarizes open actions and overdue returns', () => {
  const result = summarizeEmployeeStatusEvents([
    { event_type: 'Annual Leave', status: 'Open', checkout_required: true, expected_return_date: '2026-08-01' },
    { event_type: 'Final Exit', status: 'Acknowledged', checkout_required: true },
    { event_type: 'Return to Work', status: 'Completed', checkout_required: false },
  ], '2026-08-11')
  assert.deepEqual(result, { total: 3, open: 1, checkoutRequired: 1, temporary: 1, final: 1, overdueReturns: 1 })
})

test('assigns urgency for critical exits and due checkout', () => {
  assert.equal(employeeEventUrgency({ event_type: 'Final Exit', status: 'Open', effective_date: '2026-09-01' }, '2026-08-11'), 'critical')
  assert.equal(employeeEventUrgency({ event_type: 'Annual Leave', status: 'Open', effective_date: '2026-08-11', checkout_required: true }, '2026-08-11'), 'high')
  assert.equal(employeeEventUrgency({ event_type: 'Annual Leave', status: 'Completed' }, '2026-08-11'), 'closed')
})
