import test from 'node:test'
import assert from 'node:assert/strict'
import { createHousingExcelWorkbook, prepareHousingExcelRows, prepareHousingReport } from './housingExcelExport.mjs'

test('generic housing Excel rows flatten related data and keep numeric values', () => {
  const rows = prepareHousingExcelRows([{ site_code: 'H-01', workers: 12, site: { name: 'Riyadh Housing', city: 'Riyadh' } }])
  assert.deepEqual(rows, [{ site_code: 'H-01', workers: 12, 'site.name': 'Riyadh Housing', 'site.city': 'Riyadh' }])
})

test('HSE report removes technical identifiers and expands checklist items', () => {
  const report = prepareHousingReport([{
    id: 'hidden-id', company_id: 'hidden-company', report_no: 'HSE-1', site: { name: 'Riyadh Housing' },
    checklist: [{ item: 'Fire extinguishers', result: 'Passed' }], score: 95, status: 'Closed',
  }], { reportType: 'hse', language: 'ar' })
  assert.ok(report.headers.includes('رقم التقرير'))
  assert.ok(report.headers.includes('فحص: طفايات الحريق'))
  assert.ok(!report.headers.includes('id'))
  assert.ok(!report.headers.includes('company_id'))
  assert.ok(report.matrix[0].includes('مغلق'))
})

test('all housing report types use curated business columns', () => {
  const reportTypes = ['occupancy', 'maintenance', 'hse', 'contracts', 'compliance', 'management', 'cost']
  for (const reportType of reportTypes) {
    const report = prepareHousingReport([{ id: 'hidden-id', company_id: 'hidden-company' }], { reportType, language: 'en' })
    assert.ok(report.headers.length >= 9, `${reportType} should contain useful report columns`)
    assert.ok(!report.headers.includes('id'))
    assert.ok(!report.headers.includes('company_id'))
  }
})

test('housing Excel workbook includes title, styled headers, widths, filters and RTL view', () => {
  const workbook = createHousingExcelWorkbook([{ report_no: 'HSE-1', site: { name: 'سكن الرياض' }, score: 92, status: 'Closed' }], { sheetName: 'تقرير السلامة', language: 'ar', reportType: 'hse' })
  const worksheet = workbook.Sheets[workbook.SheetNames[0]]
  assert.equal(workbook.SheetNames[0], 'تقرير السلامة')
  assert.equal(worksheet.A1.v, 'تقرير السلامة')
  assert.equal(worksheet['!autofilter'].ref, 'A4:I5')
  assert.equal(worksheet['!views'][0].RTL, true)
  assert.equal(worksheet.A4.s.fill.fgColor.rgb, '123C44')
  assert.ok(worksheet['!cols'].every((item) => item.wch >= 12 && item.wch <= 42))
})
