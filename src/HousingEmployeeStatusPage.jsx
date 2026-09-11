import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, CheckCircle2, DoorOpen, LoaderCircle, Plane, Plus, Search, UserCheck, UserMinus, X } from 'lucide-react'
import { useHousingLanguage } from './housingI18n.jsx'
import { buildEmployeeStatusEventInput, employeeEventUrgency, HOUSING_EMPLOYEE_EVENT_TYPES, isTemporaryEmployeeEvent, summarizeEmployeeStatusEvents } from './housingEmployeeStatus.mjs'
import { createHousingEmployeeStatusEvent, listHousingEmployeeStatusEvents, reviewHousingEmployeeStatusEvent } from './housingService.mjs'

const COPY = {
  ar: {
    title: 'الإجازات والخروج ونهاية الخدمة', subtitle: 'اربط حالة العامل بالتسكين ونبّه المشرف قبل استمرار إشغال السرير والتكاليف.', add: 'تسجيل حالة جديدة',
    employee: 'العامل', eventType: 'نوع الحالة', effective: 'تاريخ السريان', expectedReturn: 'العودة المتوقعة', source: 'مصدر البيانات', reference: 'رقم المرجع', save: 'حفظ وإرسال التنبيه', cancel: 'إلغاء',
    open: 'تنبيهات مفتوحة', checkout: 'تحتاج قرار إخلاء', temporary: 'إجازة أو خروج وعودة', final: 'نهاية علاقة وظيفية', overdue: 'عودة متأخرة',
    records: 'سجل الإجازات والخروج', housing: 'السكن والسرير', dates: 'التواريخ', status: 'الحالة', decision: 'قرار المشرف', noRecords: 'لا توجد حالات مسجلة.', search: 'بحث باسم العامل أو رقمه...', all: 'الكل',
    approve: 'اعتماد الإخلاء', keepBed: 'إبقاء السرير', acknowledge: 'تم الاطلاع', cancelEvent: 'إلغاء الحالة', confirmCheckout: 'سيتم إنهاء تسكين العامل وإتاحة السرير. هل تريد المتابعة؟',
    readOnly: 'لديك صلاحية عرض الحالات فقط.', saved: 'تم تسجيل الحالة وإرسال التنبيه للمشرف.', reviewed: 'تم حفظ قرار المشرف.', noAssignment: 'لا يوجد تسكين نشط', needsReassignment: 'عند عودة العامل يتم تسكينه من جديد إذا كان السرير قد أُخلي.',
  },
  en: {
    title: 'Leave, Exit & End of Service', subtitle: 'Link employee status to accommodation and alert supervisors before beds and costs remain occupied.', add: 'Register New Status',
    employee: 'Employee', eventType: 'Event Type', effective: 'Effective Date', expectedReturn: 'Expected Return', source: 'Data Source', reference: 'Reference Number', save: 'Save & Alert Supervisor', cancel: 'Cancel',
    open: 'Open Alerts', checkout: 'Checkout Decision', temporary: 'Leave / Exit-Reentry', final: 'End of Employment', overdue: 'Overdue Return',
    records: 'Leave and Exit Register', housing: 'Housing & Bed', dates: 'Dates', status: 'Status', decision: 'Supervisor Decision', noRecords: 'No employee status events.', search: 'Search by employee name or number...', all: 'All',
    approve: 'Approve Checkout', keepBed: 'Keep Bed', acknowledge: 'Acknowledge', cancelEvent: 'Cancel Event', confirmCheckout: 'This will end the assignment and release the bed. Continue?',
    readOnly: 'You have read-only access to employee status events.', saved: 'Status registered and supervisor alerted.', reviewed: 'Supervisor decision saved.', noAssignment: 'No active assignment', needsReassignment: 'When the employee returns, assign a new bed if the previous bed was released.',
  },
}

const EVENT_LABELS = {
  ar: { 'Annual Leave': 'إجازة سنوية', 'Exit Reentry': 'خروج وعودة', 'Final Exit': 'خروج نهائي', Termination: 'إنهاء خدمة', Resignation: 'استقالة', Transfer: 'نقل', 'Return to Work': 'عودة للعمل' },
  en: Object.fromEntries(HOUSING_EMPLOYEE_EVENT_TYPES.map((item) => [item, item])),
}

function today() { return new Date().toISOString().slice(0, 10) }

export default function HousingEmployeeStatusPage({ client, data, canManage = false }) {
  const { language } = useHousingLanguage()
  const tx = COPY[language]
  const [events, setEvents] = useState([])
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ employeeId: '', eventType: 'Annual Leave', effectiveDate: today(), expectedReturnDate: '', source: 'Manual', sourceReference: '' })
  const [filter, setFilter] = useState('Open')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const summary = useMemo(() => summarizeEmployeeStatusEvents(events), [events])

  const refresh = async () => {
    if (!client) return
    try { setEvents(await listHousingEmployeeStatusEvents(client)) } catch (reason) { setError(reason.message) }
  }
  useEffect(() => { refresh() }, [client])

  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    try {
      const input = buildEmployeeStatusEventInput(form)
      await createHousingEmployeeStatusEvent(client, input)
      await refresh(); setFormOpen(false); setMessage(tx.saved)
      setForm({ employeeId: '', eventType: 'Annual Leave', effectiveDate: today(), expectedReturnDate: '', source: 'Manual', sourceReference: '' })
    } catch (reason) { setError(reason.message) }
    finally { setBusy(false) }
  }

  const review = async (item, decision) => {
    if (decision === 'Checkout Approved' && !window.confirm(tx.confirmCheckout)) return
    setBusy(true); setError(''); setMessage('')
    try { await reviewHousingEmployeeStatusEvent(client, item.id, decision); await refresh(); setMessage(tx.reviewed) }
    catch (reason) { setError(reason.message) }
    finally { setBusy(false) }
  }

  const visible = events.filter((item) => {
    const statusMatch = filter === 'All' || (filter === 'Open' ? ['Open','Acknowledged'].includes(item.status) : item.event_type === filter)
    return statusMatch && JSON.stringify(item).toLocaleLowerCase().includes(query.toLocaleLowerCase())
  })
  const location = (item) => item.assignment ? [item.assignment.site?.name, item.assignment.room?.room_number, item.assignment.bed?.bed_number].filter(Boolean).join(' / ') : tx.noAssignment

  return <div className="housing-employee-status-page">
    <section className="housing-employee-status-actions">
      <div><p>{tx.subtitle}</p>{!canManage && <small>{tx.readOnly}</small>}</div>
      {canManage && <button className="housing-primary-button" onClick={() => setFormOpen(true)}><Plus size={18} />{tx.add}</button>}
    </section>

    {error && <div className="housing-access-message error"><AlertTriangle size={17} />{error}</div>}
    {message && <div className="housing-access-message success"><CheckCircle2 size={17} />{message}</div>}

    <section className="housing-employee-status-metrics">
      {[['open', summary.open, CalendarClock, 'blue'], ['checkout', summary.checkoutRequired, UserMinus, 'red'], ['temporary', summary.temporary, Plane, 'amber'], ['final', summary.final, DoorOpen, 'purple'], ['overdue', summary.overdueReturns, AlertTriangle, 'red']].map(([label, value, Icon, tone]) => <article className="housing-panel" key={label}><span className={`housing-icon-box ${tone}`}><Icon size={20} /></span><div><small>{tx[label]}</small><strong>{value}</strong></div></article>)}
    </section>

    <section className="housing-panel housing-table-panel housing-employee-status-register">
      <div className="housing-panel-head"><div><h2>{tx.records}</h2><p>{events.length}</p></div></div>
      <div className="housing-reconciliation-toolbar"><div className="housing-search housing-search-wide"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tx.search} /></div><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="Open">{tx.open}</option><option value="All">{tx.all}</option>{HOUSING_EMPLOYEE_EVENT_TYPES.map((type) => <option value={type} key={type}>{EVENT_LABELS[language][type]}</option>)}</select></div>
      {!visible.length ? <div className="housing-reconciliation-empty"><CalendarClock size={32} /><p>{tx.noRecords}</p></div> : <div className="housing-table-wrap"><table><thead><tr><th>{tx.employee}</th><th>{tx.eventType}</th><th>{tx.dates}</th><th>{tx.housing}</th><th>{tx.source}</th><th>{tx.status}</th><th>{tx.decision}</th></tr></thead><tbody>{visible.map((item) => {
        const urgency = employeeEventUrgency(item)
        return <tr key={item.id}>
          <td><strong>{item.employee?.full_name || '—'}</strong><small className="housing-table-sub">{item.employee?.employee_no || '—'} · {item.employee?.iqama_no || '—'}</small></td>
          <td><span className={`housing-event-type ${urgency}`}>{EVENT_LABELS[language][item.event_type] || item.event_type}</span>{item.checkout_required && <small className="housing-table-sub">{tx.checkout}</small>}</td>
          <td><strong>{item.effective_date}</strong><small className="housing-table-sub">{item.expected_return_date || '—'}</small></td>
          <td>{location(item)}</td><td>{item.source}<small className="housing-table-sub">{item.source_reference || '—'}</small></td>
          <td><span className={`housing-reconciliation-status ${['Completed','Cancelled'].includes(item.status) ? 'green' : 'amber'}`}>{item.status}</span><small className="housing-table-sub">{item.review_decision || '—'}</small></td>
          <td>{canManage && ['Open','Acknowledged'].includes(item.status) ? <div className="housing-event-actions">{item.checkout_required && <button className="danger" onClick={() => review(item, 'Checkout Approved')}>{tx.approve}</button>}<button onClick={() => review(item, 'Keep Bed')}>{tx.keepBed}</button><button onClick={() => review(item, 'Acknowledged')}>{tx.acknowledge}</button><button onClick={() => review(item, 'Cancelled')}>{tx.cancelEvent}</button></div> : item.review_note || '—'}</td>
        </tr>
      })}</tbody></table></div>}
    </section>

    {formOpen && <div className="housing-modal-backdrop" onMouseDown={() => !busy && setFormOpen(false)}><div className="housing-modal housing-event-modal" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><h2>{tx.add}</h2><p>{tx.subtitle}</p></div><button onClick={() => setFormOpen(false)}><X size={20} /></button></header>
      <form onSubmit={submit}><div className="housing-form-grid">
        <label className="full"><span>{tx.employee}</span><select required value={form.employeeId} onChange={(event) => setForm({ ...form, employeeId: event.target.value })}><option value="">—</option>{(data.employees || []).map((employee) => <option key={employee.id} value={employee.id}>{employee.employee_no} · {employee.full_name}</option>)}</select></label>
        <label><span>{tx.eventType}</span><select value={form.eventType} onChange={(event) => setForm({ ...form, eventType: event.target.value, expectedReturnDate: isTemporaryEmployeeEvent(event.target.value) ? form.expectedReturnDate : '' })}>{HOUSING_EMPLOYEE_EVENT_TYPES.map((type) => <option value={type} key={type}>{EVENT_LABELS[language][type]}</option>)}</select></label>
        <label><span>{tx.effective}</span><input required type="date" value={form.effectiveDate} onChange={(event) => setForm({ ...form, effectiveDate: event.target.value })} /></label>
        <label><span>{tx.expectedReturn}</span><input type="date" disabled={!isTemporaryEmployeeEvent(form.eventType)} value={form.expectedReturnDate} onChange={(event) => setForm({ ...form, expectedReturnDate: event.target.value })} /></label>
        <label><span>{tx.source}</span><select value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })}><option>Manual</option><option>HR</option><option>Muqeem</option><option>Visa System</option><option>Payroll</option></select></label>
        <label className="full"><span>{tx.reference}</span><input value={form.sourceReference} onChange={(event) => setForm({ ...form, sourceReference: event.target.value })} /></label>
      </div>{form.eventType === 'Return to Work' && <p className="housing-event-form-note"><UserCheck size={16} />{tx.needsReassignment}</p>}<footer><button type="button" className="housing-secondary-button" onClick={() => setFormOpen(false)}>{tx.cancel}</button><button className="housing-primary-button" disabled={busy}>{busy ? <LoaderCircle className="housing-spin" size={17} /> : null}{tx.save}</button></footer></form>
    </div></div>}
  </div>
}
