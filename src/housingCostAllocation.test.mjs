import test from 'node:test'
import assert from 'node:assert/strict'
import { monthPeriod, summarizeCostAllocations, validateCostCenter, validateCostEntry } from './housingCostAllocation.mjs'

test('daily allocation summary follows worker project transfers by cost center', () => {
  const rows = [
    { allocation_date: '2026-08-01', employee_id: 'e1', cost_center_id: 'a', amount: 50, cost_center: { code: 'PRJ-A', name: 'Project A' }, project: { name: 'A' } },
    { allocation_date: '2026-08-02', employee_id: 'e1', cost_center_id: 'b', amount: 60, cost_center: { code: 'PRJ-B', name: 'Project B' }, project: { name: 'B' } },
    { allocation_date: '2026-08-02', employee_id: null, cost_center_id: null, amount: 10 },
  ]
  const result = summarizeCostAllocations(rows)
  assert.deepEqual(result.totals, { total: 120, allocated: 110, unallocated: 10, worker_days: 2, cost_per_worker_day: 55 })
  assert.deepEqual(result.centers.map(({ cost_center_code, amount }) => ({ cost_center_code, amount })), [
    { cost_center_code: 'PRJ-B', amount: 60 }, { cost_center_code: 'PRJ-A', amount: 50 }, { cost_center_code: 'UNASSIGNED', amount: 10 },
  ])
})

test('cost center and manual cost inputs are normalized and validated', () => {
  assert.equal(validateCostCenter({ code: ' prj-1 ', name: ' Project One ' }).code, 'PRJ-1')
  assert.equal(validateCostEntry({ site_id: 's', category: 'Catering', period_start: '2026-08-01', period_end: '2026-08-31', amount: '3100' }).amount, 3100)
  assert.throws(() => validateCostEntry({ site_id: 's', category: 'Other', period_start: '2026-09-01', period_end: '2026-08-01', amount: 1 }), /cost_entry_period_invalid/)
  assert.deepEqual(monthPeriod('2026-08-10'), { start: '2026-08-01', end: '2026-08-31' })
})

