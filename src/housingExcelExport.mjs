import XLSX from 'xlsx-js-style'

const MIN_COLUMN_WIDTH = 12
const MAX_COLUMN_WIDTH = 42
const HEADER_ROW = 3

const STATUS_AR = {
  Active: 'نشط', Open: 'مفتوح', Closed: 'مغلق', Draft: 'مسودة', Submitted: 'مُرسل',
  'Action Required': 'يتطلب إجراء', Acknowledged: 'تمت المراجعة', Resolved: 'تم الحل', Dismissed: 'مستبعد',
  Completed: 'مكتمل', Cancelled: 'ملغي', Expiring: 'قارب على الانتهاء', Expired: 'منتهي',
  Pending: 'قيد الانتظار', 'Not Required': 'غير مطلوب', Reserved: 'محجوز', Ended: 'منتهي',
  CheckIn: 'تسكين', Transfer: 'نقل', Temporary: 'مؤقت', Low: 'منخفض', Medium: 'متوسط',
  High: 'مرتفع', Critical: 'حرج', Emergency: 'طارئ', Yes: 'نعم', No: 'لا',
  Passed: 'مطابق', Failed: 'غير مطابق', Note: 'ملاحظة',
}

const CHECKLIST_AR = {
  'Fire extinguishers': 'طفايات الحريق',
  'Emergency exits': 'مخارج الطوارئ',
  Ventilation: 'التهوية',
  'Kitchen hygiene': 'نظافة المطبخ',
  Cleanliness: 'النظافة',
}

const column = (key, ar, en, type = 'text', width = 18, get) => ({ key, ar, en, type, width, get })
const pathValue = (row, path) => path.split('.').reduce((current, part) => current?.[part], row)
const lookup = (rows, id) => (rows || []).find((row) => row.id === id)
const siteName = (row, context) => row.site?.name || row['site.name'] || lookup(context?.sites, row.site_id)?.name || ''
const roomNumber = (row, context) => row.room?.room_number || row['room.room_number'] || lookup(context?.rooms, row.room_id)?.room_number || ''

const REPORT_COLUMNS = {
  occupancy: [
    column('employee_no', 'رقم العامل', 'Employee No.', 'text', 16, (row) => row.employee?.employee_no),
    column('employee_name', 'اسم العامل', 'Employee Name', 'text', 26, (row) => row.employee?.full_name),
    column('site_name', 'السكن', 'Housing Site', 'text', 25, siteName),
    column('room_number', 'الغرفة', 'Room', 'text', 14, roomNumber),
    column('bed_number', 'السرير', 'Bed', 'text', 12, (row) => row.bed?.bed_number),
    column('work_shift', 'الوردية', 'Work Shift', 'status', 14, (row) => row.employee?.work_shift),
    column('nationality', 'الجنسية', 'Nationality', 'text', 16, (row) => row.employee?.nationality),
    column('preferred_language', 'اللغة', 'Language', 'text', 14, (row) => row.employee?.preferred_language),
    column('assignment_type', 'نوع التسكين', 'Assignment Type', 'status', 16),
    column('start_date', 'تاريخ البداية', 'Start Date', 'date', 15),
    column('expected_end_date', 'النهاية المتوقعة', 'Expected End', 'date', 17),
    column('status', 'الحالة', 'Status', 'status', 16),
    column('reason', 'السبب', 'Reason', 'text', 24),
    column('notes', 'ملاحظات', 'Notes', 'text', 30),
  ],
  maintenance: [
    column('request_no', 'رقم الطلب', 'Request No.', 'text', 16),
    column('site_name', 'السكن', 'Housing Site', 'text', 25, siteName),
    column('room_number', 'الغرفة', 'Room', 'text', 14, roomNumber),
    column('category', 'التصنيف', 'Category', 'text', 18),
    column('title', 'العطل', 'Issue', 'text', 28),
    column('description', 'الوصف', 'Description', 'text', 36),
    column('priority', 'الأولوية', 'Priority', 'status', 14),
    column('status', 'الحالة', 'Status', 'status', 16),
    column('assigned_to', 'المسند إليه', 'Assigned To', 'text', 20),
    column('vendor_name', 'المورد', 'Vendor', 'text', 20),
    column('reported_at', 'تاريخ البلاغ', 'Reported At', 'datetime', 20),
    column('due_at', 'موعد الاستحقاق', 'Due At', 'datetime', 20),
    column('completed_at', 'تاريخ الإكمال', 'Completed At', 'datetime', 20),
    column('estimated_cost', 'التكلفة التقديرية', 'Estimated Cost', 'currency', 18),
    column('actual_cost', 'التكلفة الفعلية', 'Actual Cost', 'currency', 18),
  ],
  hse: [
    column('report_no', 'رقم التقرير', 'Report No.', 'text', 17),
    column('site_name', 'السكن', 'Housing Site', 'text', 26, siteName),
    column('inspection_date', 'تاريخ الفحص', 'Inspection Date', 'date', 16),
    column('score', 'النتيجة %', 'Score %', 'number', 13),
    column('critical_findings', 'الملاحظات الحرجة', 'Critical Findings', 'number', 18),
    column('corrective_action_due', 'موعد الإجراء التصحيحي', 'Corrective Action Due', 'date', 21),
    column('status', 'الحالة', 'Status', 'status', 18),
    column('attachments_count', 'عدد المرفقات', 'Attachments', 'number', 14, (row) => normalizeArray(row.attachments).length),
    column('notes', 'الملاحظات', 'Notes', 'text', 36),
  ],
  contracts: [
    column('contract_no', 'رقم العقد', 'Contract No.', 'text', 17),
    column('site_name', 'السكن', 'Housing Site', 'text', 25, siteName),
    column('contract_type', 'نوع العقد', 'Contract Type', 'text', 16),
    column('landlord_name', 'المؤجر', 'Landlord', 'text', 24),
    column('landlord_contact', 'تواصل المؤجر', 'Landlord Contact', 'text', 20),
    column('start_date', 'بداية العقد', 'Start Date', 'date', 15),
    column('end_date', 'نهاية العقد', 'End Date', 'date', 15),
    column('annual_value', 'القيمة السنوية', 'Annual Value', 'currency', 18),
    column('payment_frequency', 'دورية الدفع', 'Payment Frequency', 'status', 18),
    column('deposit_amount', 'مبلغ التأمين', 'Deposit', 'currency', 16),
    column('next_payment_date', 'الدفعة القادمة', 'Next Payment', 'date', 16),
    column('auto_renew', 'تجديد تلقائي', 'Auto Renew', 'boolean', 15),
    column('status', 'حالة العقد', 'Contract Status', 'status', 17),
    column('ajeer_contract_number', 'رقم عقد أجير', 'Ajeer Contract No.', 'text', 19),
    column('ajeer_provider_name', 'مقدم خدمة أجير', 'Ajeer Provider', 'text', 23),
    column('ajeer_service_type', 'نوع خدمة أجير', 'Ajeer Service Type', 'text', 20),
    column('ajeer_issue_date', 'إصدار أجير', 'Ajeer Issue Date', 'date', 16),
    column('ajeer_expiry_date', 'انتهاء أجير', 'Ajeer Expiry Date', 'date', 16),
    column('ajeer_status', 'حالة أجير', 'Ajeer Status', 'status', 16),
    column('ajeer_document_url', 'مستند أجير', 'Ajeer Document', 'text', 32),
    column('notes', 'ملاحظات', 'Notes', 'text', 30),
  ],
  compliance: [
    column('alert_type', 'نوع التنبيه', 'Alert Type', 'text', 24),
    column('severity', 'الخطورة', 'Severity', 'status', 14),
    column('title', 'التنبيه', 'Alert', 'text', 34),
    column('site_name', 'السكن', 'Housing Site', 'text', 25, siteName),
    column('room_number', 'الغرفة', 'Room', 'text', 14, roomNumber),
    column('employee_no', 'رقم العامل', 'Employee No.', 'text', 16, (row) => row.employee?.employee_no),
    column('employee_name', 'اسم العامل', 'Employee Name', 'text', 24, (row) => row.employee?.full_name),
    column('details', 'التفاصيل', 'Details', 'text', 38, (row) => objectLines(row.details)),
    column('status', 'الحالة', 'Status', 'status', 16),
    column('acknowledged_at', 'تاريخ المراجعة', 'Acknowledged At', 'datetime', 20),
    column('created_at', 'تاريخ الإنشاء', 'Created At', 'datetime', 20),
  ],
  management: [
    column('code', 'رمز السكن', 'Site Code', 'text', 16),
    column('name', 'اسم السكن', 'Housing Site', 'text', 28),
    column('city', 'المدينة', 'City', 'text', 16),
    column('district', 'الحي', 'District', 'text', 18),
    column('address', 'العنوان', 'Address', 'text', 36),
    column('housing_type', 'نوع السكن', 'Housing Type', 'status', 16),
    column('ownership_type', 'الملكية', 'Ownership', 'status', 16),
    column('capacity', 'السعة', 'Capacity', 'number', 13),
    column('status', 'الحالة', 'Status', 'status', 16),
    column('latitude', 'خط العرض', 'Latitude', 'decimal', 15),
    column('longitude', 'خط الطول', 'Longitude', 'decimal', 15),
    column('notes', 'ملاحظات', 'Notes', 'text', 30),
  ],
  cost: [
    column('site_code', 'رمز السكن', 'Site Code', 'text', 16),
    column('site_name', 'السكن', 'Housing Site', 'text', 27),
    column('city', 'المدينة', 'City', 'text', 16),
    column('worker_count', 'عدد العمال', 'Workers', 'number', 14),
    column('annual_rent', 'الإيجار السنوي', 'Annual Rent', 'currency', 18),
    column('annual_utilities', 'الخدمات السنوية', 'Annual Utilities', 'currency', 19),
    column('annual_maintenance', 'الصيانة السنوية', 'Annual Maintenance', 'currency', 20),
    column('total_annual_cost', 'إجمالي التكلفة السنوية', 'Total Annual Cost', 'currency', 22),
    column('annual_cost_per_worker', 'تكلفة العامل سنويًا', 'Annual Cost / Worker', 'currency', 22),
    column('monthly_cost_per_worker', 'تكلفة العامل شهريًا', 'Monthly Cost / Worker', 'currency', 23),
  ],
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return []
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
}

function objectLines(value) {
  if (value == null) return ''
  if (typeof value === 'string') {
    try { return objectLines(JSON.parse(value)) } catch { return value }
  }
  if (Array.isArray(value)) return value.map((item) => typeof item === 'object' ? objectLines(item) : String(item)).join('\n')
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}: ${item ?? ''}`).join('\n')
  return String(value)
}

function normalizeCellValue(value, type, language) {
  if (value == null) return ''
  if (type === 'boolean') return language === 'ar' ? (value ? 'نعم' : 'لا') : (value ? 'Yes' : 'No')
  if (type === 'status') return language === 'ar' ? (STATUS_AR[value] || value) : value
  if ((type === 'date' || type === 'datetime') && typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.valueOf())) return parsed
  }
  if (Array.isArray(value) || typeof value === 'object') return objectLines(value)
  return value
}

function flattenRecord(record, prefix = '', output = {}) {
  Object.entries(record || {}).forEach(([key, value]) => {
    const name = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) flattenRecord(value, name, output)
    else output[name] = value == null ? '' : value
  })
  return output
}

export function prepareHousingExcelRows(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return [{ message: 'No records' }]
  return rows.map((row) => flattenRecord(row))
}

function checklistColumns(rows, language) {
  const labels = new Map()
  rows.forEach((row) => normalizeArray(row.checklist).forEach((item) => {
    const name = item?.item || item?.title || item?.name
    if (name) labels.set(name, language === 'ar' ? (CHECKLIST_AR[name] || name) : name)
  }))
  return [...labels.entries()].map(([name, label]) => column(
    `checklist.${name}`,
    `فحص: ${label}`,
    `Check: ${label}`,
    'status',
    20,
    (row) => normalizeArray(row.checklist).find((item) => (item?.item || item?.title || item?.name) === name)?.result || '',
  ))
}

export function prepareHousingReport(rows = [], { reportType, language = 'en', context = {} } = {}) {
  const records = Array.isArray(rows) ? rows : []
  let columns = REPORT_COLUMNS[reportType]
  if (!columns) {
    const genericRows = prepareHousingExcelRows(records)
    columns = [...new Set(genericRows.flatMap((row) => Object.keys(row)))]
      .filter((key) => !['id', 'company_id'].includes(key) && !key.endsWith('_id'))
      .map((key) => column(key, key, key, 'text', 18))
    rows = genericRows
  }
  if (reportType === 'hse') columns = [...columns.slice(0, 7), ...checklistColumns(records, language), ...columns.slice(7)]
  const headers = columns.map((item) => language === 'ar' ? item.ar : item.en)
  const matrix = (records.length ? records : [{}]).map((row) => columns.map((item) => {
    const raw = item.get ? item.get(row, context) : pathValue(row, item.key)
    return normalizeCellValue(raw, item.type, language)
  }))
  return { columns, headers, matrix }
}

export function calculateHousingColumnWidths(rows = [], headers = []) {
  return headers.map((header) => {
    const longest = rows.reduce((length, row) => {
      const text = String(row?.[header] ?? '')
      return Math.max(length, ...text.split(/\r?\n/).map((line) => line.length))
    }, String(header).length)
    return { wch: Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, longest + 2)) }
  })
}

const thinBorder = { style: 'thin', color: { rgb: 'D9E2E7' } }
const statusFill = (value) => {
  const text = String(value || '').toLowerCase()
  if (/closed|completed|active|resolved|مغلق|مكتمل|نشط|تم الحل/.test(text)) return 'DDF4EC'
  if (/critical|emergency|expired|action required|حرج|طارئ|منتهي|يتطلب إجراء/.test(text)) return 'FDE2E2'
  if (/high|open|expiring|مرتفع|مفتوح|قارب/.test(text)) return 'FFF0D5'
  return 'EAF2F8'
}

function applyWorksheetFormatting(worksheet, report, language) {
  const columnCount = report.columns.length
  const dataCount = report.matrix.length
  const lastColumn = Math.max(0, columnCount - 1)
  worksheet['!cols'] = report.columns.map((item) => ({ wch: Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, item.width || 18)) }))
  worksheet['!rows'] = [{ hpt: 30 }, { hpt: 20 }, { hpt: 8 }, { hpt: 26 }, ...report.matrix.map(() => ({ hpt: 32 }))]
  worksheet['!merges'] = [XLSX.utils.decode_range(`A1:${XLSX.utils.encode_col(lastColumn)}1`)]
  worksheet['!autofilter'] = { ref: `${XLSX.utils.encode_col(0)}${HEADER_ROW + 1}:${XLSX.utils.encode_col(lastColumn)}${HEADER_ROW + dataCount + 1}` }
  worksheet['!views'] = [{ RTL: language === 'ar' }]

  const titleCell = worksheet.A1
  if (titleCell) titleCell.s = { fill: { fgColor: { rgb: '0F766E' } }, font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 16 }, alignment: { horizontal: language === 'ar' ? 'right' : 'left', vertical: 'center' } }
  const metaCell = worksheet.A2
  if (metaCell) metaCell.s = { font: { color: { rgb: '607D86' }, italic: true, sz: 10 }, alignment: { horizontal: language === 'ar' ? 'right' : 'left' } }

  report.columns.forEach((definition, columnIndex) => {
    const headerCell = worksheet[XLSX.utils.encode_cell({ r: HEADER_ROW, c: columnIndex })]
    if (headerCell) headerCell.s = {
      fill: { fgColor: { rgb: '123C44' } },
      font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder },
    }
    for (let dataIndex = 0; dataIndex < dataCount; dataIndex += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: HEADER_ROW + 1 + dataIndex, c: columnIndex })]
      if (!cell) continue
      const fill = definition.type === 'status' ? statusFill(cell.v) : (dataIndex % 2 ? 'F7FAFB' : 'FFFFFF')
      cell.s = {
        fill: { fgColor: { rgb: fill } },
        font: { color: { rgb: '17343B' }, sz: 10 },
        alignment: { horizontal: ['number', 'decimal', 'currency', 'date', 'datetime'].includes(definition.type) ? 'center' : (language === 'ar' ? 'right' : 'left'), vertical: 'top', wrapText: true },
        border: { bottom: thinBorder },
        numFmt: definition.type === 'currency' ? '#,##0.00' : definition.type === 'number' ? '#,##0' : definition.type === 'decimal' ? '0.000000' : definition.type === 'date' ? 'yyyy-mm-dd' : definition.type === 'datetime' ? 'yyyy-mm-dd hh:mm' : undefined,
      }
    }
  })
}

export function createHousingExcelWorkbook(rows = [], { sheetName = 'Report', language = 'en', reportType, context = {} } = {}) {
  const report = prepareHousingReport(rows, { reportType, language, context })
  const generatedLabel = language === 'ar' ? 'تاريخ التصدير' : 'Exported at'
  const displayTitle = sheetName || (language === 'ar' ? 'تقرير السكن' : 'Housing Report')
  const worksheet = XLSX.utils.aoa_to_sheet([
    [displayTitle],
    [`${generatedLabel}: ${new Date().toLocaleString(language === 'ar' ? 'ar-SA' : 'en-GB')}`],
    [],
    report.headers,
    ...report.matrix,
  ], { cellDates: true })
  applyWorksheetFormatting(worksheet, report, language)

  const workbook = XLSX.utils.book_new()
  const safeSheetName = String(displayTitle).replace(/[\\/?*\[\]:]/g, '-').slice(0, 31) || 'Report'
  XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName)
  workbook.Props = { Title: safeSheetName, Subject: 'Housing management report', Author: 'Sakan Housing Management', CreatedDate: new Date() }
  return workbook
}

export function exportHousingExcel(filename, rows = [], options = {}) {
  const workbook = createHousingExcelWorkbook(rows, options)
  const safeFilename = String(filename || 'housing-report.xlsx').replace(/\.csv$/i, '.xlsx')
  XLSX.writeFile(workbook, safeFilename.endsWith('.xlsx') ? safeFilename : `${safeFilename}.xlsx`, { compression: true, cellStyles: true })
}
