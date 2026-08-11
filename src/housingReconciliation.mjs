const COLUMN_ALIASES = {
  employee_no: ['employee_no', 'employee number', 'employee id', 'emp no', 'emp_no', 'staff id', 'الرقم الوظيفي', 'رقم الموظف'],
  iqama_no: ['iqama_no', 'iqama', 'residency no', 'national id', 'id number', 'رقم الاقامة', 'رقم الإقامة', 'الاقامة', 'الإقامة'],
  full_name: ['full_name', 'employee name', 'name', 'worker name', 'اسم الموظف', 'اسم العامل', 'الاسم'],
  employment_status: ['employment_status', 'employee status', 'status', 'hr status', 'حالة الموظف', 'الحالة الوظيفية', 'الحالة'],
  leave_status: ['leave_status', 'leave status', 'visa status', 'absence status', 'حالة الاجازة', 'حالة الإجازة', 'حالة التأشيرة'],
  project_code: ['project_code', 'project code', 'project', 'cost center', 'رمز المشروع', 'المشروع', 'مركز التكلفة'],
}

const EXIT_STATUSES = new Set(['inactive', 'exited', 'terminated', 'termination', 'resigned', 'resignation', 'final exit', 'end of service', 'هروب', 'مستقيل', 'منتهي', 'نهاية خدمة', 'خروج نهائي'])
const CHECKOUT_LEAVE_STATUSES = new Set(['annual leave', 'exit reentry', 'exit/reentry', 'final exit', 'vacation', 'إجازة سنوية', 'خروج وعودة', 'خروج نهائي'])

function clean(value) { return String(value ?? '').trim() }
function key(value) { return clean(value).toLocaleLowerCase('en').replace(/[\s_-]+/g, ' ') }
function identifier(value) { return clean(value).replace(/\s+/g, '').toUpperCase() }

export function detectReconciliationColumns(headers = []) {
  const normalized = new Map(headers.map((header) => [key(header), header]))
  return Object.fromEntries(Object.entries(COLUMN_ALIASES).map(([field, aliases]) => {
    const matched = aliases.map(key).find((alias) => normalized.has(alias))
    return [field, matched ? normalized.get(matched) : null]
  }))
}

export function normalizeReconciliationRows(rows = [], explicitMapping) {
  if (!Array.isArray(rows) || !rows.length) return []
  const mapping = explicitMapping || detectReconciliationColumns(Object.keys(rows[0] || {}))
  if (!mapping.employee_no && !mapping.iqama_no) throw new Error('Employee number or Iqama number column is required.')
  return rows.filter((row) => row && Object.values(row).some((value) => clean(value))).map((row, index) => ({
    row_number: index + 2,
    employee_no: mapping.employee_no ? clean(row[mapping.employee_no]) : '',
    iqama_no: mapping.iqama_no ? clean(row[mapping.iqama_no]) : '',
    full_name: mapping.full_name ? clean(row[mapping.full_name]) : '',
    employment_status: mapping.employment_status ? clean(row[mapping.employment_status]) : 'Active',
    leave_status: mapping.leave_status ? clean(row[mapping.leave_status]) : '',
    project_code: mapping.project_code ? clean(row[mapping.project_code]) : '',
    source_payload: row,
  }))
}

function activeAssignmentFor(assignments, employeeId) {
  return assignments.find((item) => item.employee_id === employeeId && item.status === 'Active') || null
}

function checkoutRequired(row) {
  return EXIT_STATUSES.has(key(row.employment_status)) || CHECKOUT_LEAVE_STATUSES.has(key(row.leave_status))
}

function result(row, employee, assignment, status, method, confidence, differences, recommendedAction) {
  return {
    ...row,
    matched_employee_id: employee?.id || null,
    matched_assignment_id: assignment?.id || null,
    matched_employee: employee || null,
    matched_assignment: assignment || null,
    match_status: status,
    match_method: method,
    confidence,
    differences,
    recommended_action: recommendedAction,
    resolution_status: 'Pending',
  }
}

export function reconcileHousingWorkforce(sourceRows = [], employees = [], assignments = []) {
  const byEmployeeNo = new Map(employees.filter((item) => identifier(item.employee_no)).map((item) => [identifier(item.employee_no), item]))
  const byIqama = new Map(employees.filter((item) => identifier(item.iqama_no)).map((item) => [identifier(item.iqama_no), item]))
  const sourceKeys = new Map()
  for (const row of sourceRows) {
    for (const value of [row.employee_no, row.iqama_no].map(identifier).filter(Boolean)) sourceKeys.set(value, (sourceKeys.get(value) || 0) + 1)
  }

  const seenEmployees = new Set()
  const results = sourceRows.map((row) => {
    const empByNo = byEmployeeNo.get(identifier(row.employee_no))
    const empByIqama = byIqama.get(identifier(row.iqama_no))
    const duplicate = [row.employee_no, row.iqama_no].map(identifier).filter(Boolean).some((value) => sourceKeys.get(value) > 1)
    if (duplicate) return result(row, empByNo || empByIqama, null, 'Duplicate', 'None', 0, ['Duplicate identifier in source file'], 'Review')
    if (empByNo && empByIqama && empByNo.id !== empByIqama.id) return result(row, null, null, 'Conflict', 'None', 0, ['Employee number and Iqama belong to different employees'], 'Review')

    const employee = empByNo || empByIqama
    if (!employee) return result(row, null, null, 'Not Found', 'None', 0, ['Employee does not exist in Housing'], 'Update Employee')
    seenEmployees.add(employee.id)
    const assignment = activeAssignmentFor(assignments, employee.id)
    const method = empByNo && empByIqama ? 'Both' : empByNo ? 'Employee Number' : 'Iqama Number'
    const confidence = method === 'Both' ? 100 : 95
    const differences = []
    if (row.full_name && key(row.full_name) !== key(employee.full_name)) differences.push('Employee name differs')
    if (row.project_code && employee.project?.code && key(row.project_code) !== key(employee.project.code)) differences.push('Project differs')

    if (assignment && checkoutRequired(row)) return result(row, employee, assignment, 'Ghost Occupancy', method, confidence, differences.concat('HR/leave status requires checkout'), 'Checkout')
    if (!assignment && !checkoutRequired(row)) return result(row, employee, null, 'Not Housed', method, confidence, differences.concat('Active employee has no housing assignment'), 'Assign Housing')
    if (differences.length) return result(row, employee, assignment, 'Conflict', method, confidence, differences, 'Review')
    return result(row, employee, assignment, 'Matched', method, confidence, [], 'Ignore')
  })

  for (const assignment of assignments.filter((item) => item.status === 'Active')) {
    if (seenEmployees.has(assignment.employee_id)) continue
    const employee = employees.find((item) => item.id === assignment.employee_id) || assignment.employee
    if (!employee) continue
    results.push(result({
      row_number: sourceRows.length + results.length + 2,
      employee_no: employee.employee_no || '', iqama_no: employee.iqama_no || '', full_name: employee.full_name || '',
      employment_status: '', leave_status: '', project_code: employee.project?.code || '', source_payload: {},
    }, employee, assignment, 'Ghost Occupancy', 'None', 80, ['Active resident is missing from the uploaded workforce file'], 'Checkout'))
  }
  return results
}

export function summarizeReconciliation(results = []) {
  const counts = { total: results.length, matched: 0, exceptions: 0, ghost: 0, notHoused: 0 }
  for (const item of results) {
    if (item.match_status === 'Matched') counts.matched += 1
    else counts.exceptions += 1
    if (item.match_status === 'Ghost Occupancy') counts.ghost += 1
    if (item.match_status === 'Not Housed') counts.notHoused += 1
  }
  return counts
}

export function toReconciliationDatabaseRow(item, companyId, importId) {
  return {
    company_id: companyId, import_id: importId, row_number: item.row_number,
    employee_no: item.employee_no || null, iqama_no: item.iqama_no || null, full_name: item.full_name || null,
    employment_status: item.employment_status || null, leave_status: item.leave_status || null, project_code: item.project_code || null,
    source_payload: item.source_payload || {}, matched_employee_id: item.matched_employee_id, matched_assignment_id: item.matched_assignment_id,
    match_status: item.match_status, match_method: item.match_method, confidence: item.confidence,
    differences: item.differences || [], recommended_action: item.recommended_action, resolution_status: 'Pending',
  }
}
