export const HOUSING_EMPLOYEE_EVENT_TYPES = Object.freeze([
  'Annual Leave', 'Exit Reentry', 'Final Exit', 'Termination', 'Resignation', 'Transfer', 'Return to Work',
])

const CHECKOUT_EVENTS = new Set(['Annual Leave', 'Exit Reentry', 'Final Exit', 'Termination', 'Resignation', 'Transfer'])
const TEMPORARY_EVENTS = new Set(['Annual Leave', 'Exit Reentry'])

function clean(value) { return String(value ?? '').trim() }

export function eventRequiresCheckout(eventType, hasActiveAssignment = true) {
  return CHECKOUT_EVENTS.has(clean(eventType)) && Boolean(hasActiveAssignment)
}

export function isTemporaryEmployeeEvent(eventType) {
  return TEMPORARY_EVENTS.has(clean(eventType))
}

export function buildEmployeeStatusEventInput(input = {}) {
  const employeeId = clean(input.employeeId)
  const eventType = clean(input.eventType)
  const effectiveDate = clean(input.effectiveDate)
  const expectedReturnDate = clean(input.expectedReturnDate)
  if (!employeeId) throw new Error('Employee is required.')
  if (!HOUSING_EMPLOYEE_EVENT_TYPES.includes(eventType)) throw new Error('Unsupported employee event type.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw new Error('Effective date is required.')
  if (expectedReturnDate && expectedReturnDate < effectiveDate) throw new Error('Expected return date cannot precede effective date.')
  return {
    employeeId, eventType, effectiveDate,
    expectedReturnDate: expectedReturnDate || null,
    source: clean(input.source) || 'Manual',
    sourceReference: clean(input.sourceReference) || null,
  }
}

export function summarizeEmployeeStatusEvents(events = [], today = new Date().toISOString().slice(0, 10)) {
  return events.reduce((summary, event) => {
    if (event.status === 'Open') summary.open += 1
    if (event.checkout_required && event.status === 'Open') summary.checkoutRequired += 1
    if (TEMPORARY_EVENTS.has(event.event_type) && ['Open','Acknowledged'].includes(event.status)) summary.temporary += 1
    if (['Final Exit','Termination','Resignation'].includes(event.event_type) && ['Open','Acknowledged'].includes(event.status)) summary.final += 1
    if (event.expected_return_date && event.expected_return_date < today && ['Open','Acknowledged'].includes(event.status)) summary.overdueReturns += 1
    return summary
  }, { total: events.length, open: 0, checkoutRequired: 0, temporary: 0, final: 0, overdueReturns: 0 })
}

export function employeeEventUrgency(event, today = new Date().toISOString().slice(0, 10)) {
  if (event.status === 'Completed' || event.status === 'Cancelled') return 'closed'
  if (['Final Exit','Termination'].includes(event.event_type)) return 'critical'
  if (event.effective_date <= today && event.checkout_required) return 'high'
  if (event.expected_return_date && event.expected_return_date < today) return 'overdue'
  return 'normal'
}
