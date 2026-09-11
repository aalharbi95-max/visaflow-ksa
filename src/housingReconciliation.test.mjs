import test from 'node:test'
import assert from 'node:assert/strict'
import { detectReconciliationColumns, normalizeReconciliationRows, reconcileHousingWorkforce, summarizeReconciliation } from './housingReconciliation.mjs'

const employees = [
  { id: 'e1', employee_no: '1001', iqama_no: '2111111111', full_name: 'Ali Hassan', project: { code: 'P1' } },
  { id: 'e2', employee_no: '1002', iqama_no: '2222222222', full_name: 'Ravi Kumar', project: { code: 'P2' } },
  { id: 'e3', employee_no: '1003', iqama_no: '2333333333', full_name: 'John Smith', project: { code: 'P1' } },
]
const assignments = [
  { id: 'a1', employee_id: 'e1', status: 'Active' },
  { id: 'a2', employee_id: 'e2', status: 'Active' },
]

test('detects Arabic and English workforce columns', () => {
  assert.deepEqual(detectReconciliationColumns(['الرقم الوظيفي', 'رقم الإقامة', 'Employee Name', 'HR Status']), {
    employee_no: 'الرقم الوظيفي', iqama_no: 'رقم الإقامة', full_name: 'Employee Name',
    employment_status: 'HR Status', leave_status: null, project_code: null,
  })
})

test('normalizes imported workforce rows', () => {
  const rows = normalizeReconciliationRows([{ 'الرقم الوظيفي': 1001, 'اسم العامل': 'Ali Hassan', 'الحالة': 'Active' }])
  assert.equal(rows[0].employee_no, '1001')
  assert.equal(rows[0].full_name, 'Ali Hassan')
  assert.equal(rows[0].row_number, 2)
})

test('matches active residents and flags checkout and not-housed cases', () => {
  const source = normalizeReconciliationRows([
    { employee_no: '1001', full_name: 'Ali Hassan', employment_status: 'Active' },
    { employee_no: '1002', full_name: 'Ravi Kumar', employment_status: 'Final Exit' },
    { employee_no: '1003', full_name: 'John Smith', employment_status: 'Active' },
  ])
  const results = reconcileHousingWorkforce(source, employees, assignments)
  assert.equal(results.find((item) => item.employee_no === '1001').match_status, 'Matched')
  assert.equal(results.find((item) => item.employee_no === '1002').match_status, 'Ghost Occupancy')
  assert.equal(results.find((item) => item.employee_no === '1002').recommended_action, 'Checkout')
  assert.equal(results.find((item) => item.employee_no === '1003').match_status, 'Not Housed')
})

test('flags active residents absent from the HR file as ghost occupancy', () => {
  const source = normalizeReconciliationRows([{ employee_no: '1001', full_name: 'Ali Hassan', employment_status: 'Active' }])
  const results = reconcileHousingWorkforce(source, employees, assignments)
  const missing = results.find((item) => item.employee_no === '1002')
  assert.equal(missing.match_status, 'Ghost Occupancy')
  assert.match(missing.differences[0], /missing/i)
})

test('detects duplicate identifiers and conflicting employee number/Iqama', () => {
  const source = normalizeReconciliationRows([
    { employee_no: '1001', iqama_no: '2222222222' },
    { employee_no: '1003', iqama_no: '2333333333' },
    { employee_no: '1003', iqama_no: '2333333333' },
  ])
  const results = reconcileHousingWorkforce(source, employees, assignments)
  assert.equal(results[0].match_status, 'Conflict')
  assert.equal(results[1].match_status, 'Duplicate')
})

test('summarizes reconciliation results', () => {
  const summary = summarizeReconciliation([{ match_status: 'Matched' }, { match_status: 'Ghost Occupancy' }, { match_status: 'Not Housed' }])
  assert.deepEqual(summary, { total: 3, matched: 1, exceptions: 2, ghost: 1, notHoused: 1 })
})
