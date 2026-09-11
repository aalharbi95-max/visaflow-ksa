import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, History, LoaderCircle, Search, Upload, UserMinus, Users } from 'lucide-react'
import * as XLSX from 'xlsx'
import { useHousingLanguage } from './housingI18n.jsx'
import { normalizeReconciliationRows, reconcileHousingWorkforce, summarizeReconciliation, toReconciliationDatabaseRow } from './housingReconciliation.mjs'
import { listHousingReconciliationImports, listHousingReconciliationRows, resolveHousingReconciliationRow, saveHousingReconciliation } from './housingService.mjs'

const LABELS = {
  ar: {
    title: 'محرك المطابقة والربط الذكي', intro: 'ارفع قائمة الموارد البشرية أو البصمة لمطابقتها مع المقيمين واكتشاف التسكين الوهمي.',
    upload: 'رفع ملف Excel أو CSV', choose: 'اختيار الملف', template: 'تحميل قالب الاستيراد', source: 'مصدر البيانات', period: 'شهر المطابقة',
    total: 'إجمالي النتائج', matched: 'مطابق', exceptions: 'استثناءات', ghost: 'تسكين وهمي', notHoused: 'غير مسكنين',
    save: 'حفظ نتائج المطابقة', saving: 'جارٍ الحفظ...', history: 'عمليات المطابقة السابقة', results: 'نتائج المطابقة',
    employee: 'العامل', identifiers: 'الرقم الوظيفي / الإقامة', hrStatus: 'حالة HR / الإجازة', housing: 'السكن الحالي', result: 'نتيجة المطابقة', action: 'الإجراء المقترح', resolution: 'المعالجة',
    approveCheckout: 'اعتماد الإخلاء', reject: 'رفض', ignore: 'تجاهل', pending: 'بانتظار المراجعة', saved: 'تم حفظ نتائج المطابقة بنجاح.',
    noResults: 'ارفع ملفًا لبدء المطابقة أو اختر عملية سابقة.', missingColumns: 'يجب أن يحتوي الملف على الرقم الوظيفي أو رقم الإقامة.',
    confirmCheckout: 'هل تريد اعتماد الإخلاء وإنهاء التسكين وإتاحة السرير؟', readOnly: 'لديك صلاحية عرض النتائج فقط.', all: 'الكل', search: 'بحث في النتائج...',
  },
  en: {
    title: 'Workforce Reconciliation Engine', intro: 'Upload an HR or biometric list to match residents and detect ghost occupancy.',
    upload: 'Upload Excel or CSV', choose: 'Choose File', template: 'Download Import Template', source: 'Data Source', period: 'Reconciliation Month',
    total: 'Total Results', matched: 'Matched', exceptions: 'Exceptions', ghost: 'Ghost Occupancy', notHoused: 'Not Housed',
    save: 'Save Reconciliation Results', saving: 'Saving...', history: 'Previous Reconciliations', results: 'Reconciliation Results',
    employee: 'Employee', identifiers: 'Employee No. / Iqama', hrStatus: 'HR / Leave Status', housing: 'Current Housing', result: 'Match Result', action: 'Recommended Action', resolution: 'Resolution',
    approveCheckout: 'Approve Checkout', reject: 'Reject', ignore: 'Ignore', pending: 'Pending Review', saved: 'Reconciliation results saved successfully.',
    noResults: 'Upload a file to start reconciliation or select a previous import.', missingColumns: 'The file must contain employee number or Iqama number.',
    confirmCheckout: 'Approve checkout, end the assignment and release the bed?', readOnly: 'You have read-only access to reconciliation results.', all: 'All', search: 'Search results...',
  },
}

const STATUS_TONES = { Matched: 'green', 'Ghost Occupancy': 'red', 'Not Housed': 'amber', 'Not Found': 'amber', Conflict: 'red', Duplicate: 'red' }

function monthValue() { return new Date().toISOString().slice(0, 7) }

export default function HousingReconciliationPage({ client, companyId, data, canManage = false }) {
  const { language } = useHousingLanguage()
  const tx = LABELS[language]
  const fileInput = useRef(null)
  const [file, setFile] = useState(null)
  const [sourceType, setSourceType] = useState('HR')
  const [periodMonth, setPeriodMonth] = useState(monthValue())
  const [results, setResults] = useState([])
  const [history, setHistory] = useState([])
  const [selectedImport, setSelectedImport] = useState(null)
  const [filter, setFilter] = useState('All')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const summary = useMemo(() => summarizeReconciliation(results), [results])

  const loadHistory = async () => {
    if (!client) return
    try { setHistory(await listHousingReconciliationImports(client)) } catch (reason) { setError(reason.message) }
  }
  useEffect(() => { loadHistory() }, [client])

  const parseFile = async (selected) => {
    setError(''); setMessage(''); setFile(selected); setSelectedImport(null); setBusy(true)
    try {
      const workbook = XLSX.read(await selected.arrayBuffer(), { type: 'array', cellDates: true })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
      const normalized = normalizeReconciliationRows(rawRows)
      setResults(reconcileHousingWorkforce(normalized, data.employees || [], data.assignments || []))
    } catch (reason) { setResults([]); setError(reason.message || tx.missingColumns) }
    finally { setBusy(false) }
  }

  const downloadTemplate = () => {
    const rows = [{ employee_no: '10001', iqama_no: '2000000001', full_name: 'Worker Name', employment_status: 'Active', leave_status: '', project_code: 'PRJ-001' }]
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Workforce')
    XLSX.writeFile(workbook, 'housing-workforce-reconciliation-template.xlsx')
  }

  const saveResults = async () => {
    if (!client || !companyId || !results.length || !file) return
    setBusy(true); setError(''); setMessage('')
    try {
      const stored = await saveHousingReconciliation(client, companyId, {
        fileName: file.name, sourceType, periodMonth: `${periodMonth}-01`, summary,
        rows: results.map((item) => toReconciliationDatabaseRow(item, companyId, 'temporary')).map(({ import_id, ...row }) => row),
      })
      setSelectedImport(stored)
      setResults(await listHousingReconciliationRows(client, stored.id))
      await loadHistory(); setMessage(tx.saved)
    } catch (reason) { setError(reason.message) }
    finally { setBusy(false) }
  }

  const openImport = async (item) => {
    setBusy(true); setError(''); setMessage(''); setSelectedImport(item); setFile(null)
    try { setResults(await listHousingReconciliationRows(client, item.id)) } catch (reason) { setError(reason.message) }
    finally { setBusy(false) }
  }

  const resolve = async (row, decision) => {
    if (!row.id || busy) return
    if (decision === 'Approved' && row.recommended_action === 'Checkout' && !window.confirm(tx.confirmCheckout)) return
    setBusy(true); setError('')
    try {
      await resolveHousingReconciliationRow(client, row.id, decision)
      setResults(await listHousingReconciliationRows(client, row.import_id))
    } catch (reason) { setError(reason.message) }
    finally { setBusy(false) }
  }

  const visibleResults = results.filter((row) => (filter === 'All' || row.match_status === filter) && JSON.stringify(row).toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const location = (row) => {
    const assignment = row.assignment || row.matched_assignment
    return assignment ? [assignment.site?.name, assignment.room?.room_number, assignment.bed?.bed_number].filter(Boolean).join(' / ') || 'Assigned' : '—'
  }

  return <div className="housing-reconciliation-page">
    <section className="housing-panel housing-reconciliation-upload">
      <div className="housing-panel-head"><div><h2>{tx.upload}</h2><p>{tx.intro}</p></div><button className="housing-secondary-button" onClick={downloadTemplate}><Download size={17} />{tx.template}</button></div>
      <div className="housing-reconciliation-form">
        <button className="housing-file-drop" onClick={() => canManage && fileInput.current?.click()} disabled={!canManage || busy}>
          {busy ? <LoaderCircle className="housing-spin" size={28} /> : <Upload size={28} />}<strong>{file?.name || tx.choose}</strong><small>.xlsx, .xls, .csv</small>
        </button>
        <input ref={fileInput} hidden type="file" accept=".xlsx,.xls,.csv" onChange={(event) => event.target.files?.[0] && parseFile(event.target.files[0])} />
        <label><span>{tx.source}</span><select value={sourceType} onChange={(event) => setSourceType(event.target.value)} disabled={!canManage}><option>HR</option><option>Biometric</option><option>Payroll</option><option>Other</option></select></label>
        <label><span>{tx.period}</span><input type="month" value={periodMonth} onChange={(event) => setPeriodMonth(event.target.value)} disabled={!canManage} /></label>
        {canManage && results.length > 0 && !selectedImport && <button className="housing-primary-button" onClick={saveResults} disabled={busy}>{busy ? tx.saving : tx.save}</button>}
      </div>
      {!canManage && <p className="housing-reconciliation-note">{tx.readOnly}</p>}
      {error && <div className="housing-access-message error"><AlertTriangle size={17} />{error}</div>}
      {message && <div className="housing-access-message success"><CheckCircle2 size={17} />{message}</div>}
    </section>

    <section className="housing-reconciliation-metrics">
      {[['total', summary.total, FileSpreadsheet, 'blue'], ['matched', summary.matched, CheckCircle2, 'green'], ['ghost', summary.ghost, UserMinus, 'red'], ['notHoused', summary.notHoused, Users, 'amber']].map(([label, value, Icon, tone]) => <article className="housing-panel" key={label}><span className={`housing-icon-box ${tone}`}><Icon size={20} /></span><div><small>{tx[label]}</small><strong>{value}</strong></div></article>)}
    </section>

    <section className="housing-reconciliation-layout">
      <article className="housing-panel housing-reconciliation-history">
        <div className="housing-panel-head"><div><h2><History size={17} />{tx.history}</h2><p>{history.length}</p></div></div>
        <div>{history.map((item) => <button key={item.id} className={selectedImport?.id === item.id ? 'active' : ''} onClick={() => openImport(item)}><strong>{item.file_name}</strong><span>{item.period_month} · {item.total_rows}</span><small>{item.ghost_rows} {tx.ghost}</small></button>)}</div>
      </article>

      <article className="housing-panel housing-table-panel housing-reconciliation-results">
        <div className="housing-panel-head"><div><h2>{tx.results}</h2><p>{visibleResults.length} / {results.length}</p></div></div>
        <div className="housing-reconciliation-toolbar"><div className="housing-search housing-search-wide"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tx.search} /></div><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="All">{tx.all}</option>{Object.keys(STATUS_TONES).map((status) => <option key={status}>{status}</option>)}</select></div>
        {!visibleResults.length ? <div className="housing-reconciliation-empty"><FileSpreadsheet size={32} /><p>{tx.noResults}</p></div> : <div className="housing-table-wrap"><table><thead><tr><th>{tx.employee}</th><th>{tx.identifiers}</th><th>{tx.hrStatus}</th><th>{tx.housing}</th><th>{tx.result}</th><th>{tx.action}</th><th>{tx.resolution}</th></tr></thead><tbody>{visibleResults.map((row, index) => <tr key={row.id || `${row.row_number}-${index}`}>
          <td><strong>{row.full_name || row.employee?.full_name || row.matched_employee?.full_name || '—'}</strong></td>
          <td><strong>{row.employee_no || '—'}</strong><small className="housing-table-sub">{row.iqama_no || '—'}</small></td>
          <td>{row.employment_status || '—'}<small className="housing-table-sub">{row.leave_status || '—'}</small></td>
          <td>{location(row)}</td>
          <td><span className={`housing-reconciliation-status ${STATUS_TONES[row.match_status] || 'blue'}`}>{row.match_status}</span><small className="housing-table-sub">{row.confidence}%</small></td>
          <td>{row.recommended_action || '—'}<small className="housing-table-sub">{(row.differences || []).join(' · ')}</small></td>
          <td>{row.resolution_status && row.resolution_status !== 'Pending' ? <span className="housing-reconciliation-status green">{row.resolution_status}</span> : row.id && canManage ? <div className="housing-reconciliation-actions">{row.recommended_action === 'Checkout' && <button onClick={() => resolve(row, 'Approved')}>{tx.approveCheckout}</button>}<button onClick={() => resolve(row, 'Rejected')}>{tx.reject}</button><button onClick={() => resolve(row, 'Ignored')}>{tx.ignore}</button></div> : <span>{tx.pending}</span>}</td>
        </tr>)}</tbody></table></div>}
      </article>
    </section>
  </div>
}
