import { useMemo, useState } from 'react'
import { Building2, Calculator, Download, Plus, ReceiptText, Wallet } from 'lucide-react'
import { exportHousingExcel } from './housingExcelExport.mjs'
import { monthPeriod, summarizeCostAllocations, validateCostCenter, validateCostEntry } from './housingCostAllocation.mjs'
import { createHousingCostCenter, createHousingCostEntry, generateHousingDailyCostAllocation } from './housingService.mjs'
import { useHousingLanguage } from './housingI18n.jsx'

const money = (value, locale) => value == null ? '—' : new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0))

export default function HousingCostCentersPage({ client, companyId, data, canManage, onRefresh }) {
  const { language, locale } = useHousingLanguage()
  const ar = language === 'ar'
  const b = (a, e) => ar ? a : e
  const initialPeriod = monthPeriod()
  const [period, setPeriod] = useState(initialPeriod)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [centerForm, setCenterForm] = useState({ code: '', name: '', project_id: '', external_system: '', external_code: '' })
  const [costForm, setCostForm] = useState({ site_id: '', cost_center_id: '', category: 'Catering', description: '', period_start: initialPeriod.start, period_end: initialPeriod.end, amount: '' })
  const run = data.costAllocationRuns?.[0]
  const allocationRows = useMemo(() => (data.dailyCostAllocations || []).filter((row) => !run?.id || row.run_id === run.id), [data.dailyCostAllocations, run?.id])
  const summary = useMemo(() => summarizeCostAllocations(allocationRows), [allocationRows])
  const currency = (value) => `${money(value, locale)} ${b('ر.س','SAR')}`

  const act = async (work) => {
    setBusy(true); setNotice('')
    try { await work(); await onRefresh?.(); setNotice(b('تم الحفظ والتحديث بنجاح','Saved and refreshed successfully')) }
    catch (error) { setNotice(error.message || b('تعذر تنفيذ العملية','Action failed')) }
    finally { setBusy(false) }
  }
  const addCenter = (event) => { event.preventDefault(); act(async () => {
    await createHousingCostCenter(client, companyId, validateCostCenter(centerForm))
    setCenterForm({ code: '', name: '', project_id: '', external_system: '', external_code: '' })
  }) }
  const addCost = (event) => { event.preventDefault(); act(async () => {
    await createHousingCostEntry(client, companyId, validateCostEntry(costForm))
    setCostForm((current) => ({ ...current, description: '', amount: '' }))
  }) }
  const generate = () => act(() => generateHousingDailyCostAllocation(client, period.start, period.end))
  const exportRows = allocationRows.map((row) => ({
    allocation_date: row.allocation_date, cost_center: row.cost_center?.code || b('غير مخصص','Unassigned'),
    project: row.project?.name || b('غير مخصص','Unassigned'), site: row.site?.name || '-', employee: row.employee?.full_name || b('غير مخصص','Unallocated'),
    employee_no: row.employee?.employee_no || '', category: row.category, source_type: row.source_type, amount: Number(row.amount || 0),
  }))

  return <section className="housing-cost-center-stack">
    <div className="housing-cost-toolbar housing-panel">
      <div><h2>{b('محرك التخصيص اليومي','Daily Allocation Engine')}</h2><p>{b('يوزع تكلفة السكن الفعلية حسب أيام إقامة العامل ومشروعه ومركز تكلفته.','Allocates actual housing cost by worker-day, project and cost center.')}</p></div>
      <label>{b('من','From')}<input type="date" value={period.start} onChange={(e)=>setPeriod({...period,start:e.target.value})}/></label>
      <label>{b('إلى','To')}<input type="date" value={period.end} onChange={(e)=>setPeriod({...period,end:e.target.value})}/></label>
      <button className="housing-primary-button" disabled={!canManage||busy} onClick={generate}><Calculator size={17}/>{b('احتساب التخصيص','Run Allocation')}</button>
      <button className="housing-secondary-button" disabled={!exportRows.length} onClick={()=>exportHousingExcel(`housing-daily-cost-allocation-${period.start}-${period.end}.xlsx`,exportRows,{sheetName:b('التخصيص اليومي','Daily Allocation'),language,reportType:'cost-allocation'})}><Download size={16}/>{b('تصدير','Export')}</button>
    </div>
    {notice && <div className="housing-live-banner">{notice}</div>}
    <div className="housing-cost-summary">
      <article><Wallet size={20}/><span>{b('إجمالي التكلفة','Total Cost')}</span><strong>{currency(run?.total_cost ?? summary.totals.total)}</strong></article>
      <article><Building2 size={20}/><span>{b('التكلفة المخصصة','Allocated')}</span><strong>{currency(run?.allocated_cost ?? summary.totals.allocated)}</strong></article>
      <article><ReceiptText size={20}/><span>{b('غير مخصصة','Unallocated')}</span><strong>{currency(run?.unallocated_cost ?? summary.totals.unallocated)}</strong></article>
      <article><Calculator size={20}/><span>{b('تكلفة يوم العامل','Cost / Worker Day')}</span><strong>{currency(summary.totals.cost_per_worker_day)}</strong></article>
    </div>
    <div className="housing-cost-center-grid">
      <article className="housing-panel">
        <div className="housing-panel-head"><div><h2>{b('مراكز التكلفة','Cost Centers')}</h2><p>{b('ربط المشروع بالرمز المحاسبي الخارجي','Map projects to external accounting codes')}</p></div></div>
        {canManage && <form className="housing-cost-inline-form" onSubmit={addCenter}>
          <input required placeholder={b('الرمز','Code')} value={centerForm.code} onChange={(e)=>setCenterForm({...centerForm,code:e.target.value})}/>
          <input required placeholder={b('الاسم','Name')} value={centerForm.name} onChange={(e)=>setCenterForm({...centerForm,name:e.target.value})}/>
          <select value={centerForm.project_id} onChange={(e)=>setCenterForm({...centerForm,project_id:e.target.value})}><option value="">{b('بدون مشروع','No project')}</option>{(data.projects||[]).map((p)=><option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select>
          <input placeholder={b('النظام: SAP / Odoo','System: SAP / Odoo')} value={centerForm.external_system} onChange={(e)=>setCenterForm({...centerForm,external_system:e.target.value})}/>
          <input placeholder={b('الرمز الخارجي','External code')} value={centerForm.external_code} onChange={(e)=>setCenterForm({...centerForm,external_code:e.target.value})}/>
          <button className="housing-primary-button" disabled={busy}><Plus size={16}/>{b('إضافة','Add')}</button>
        </form>}
        <div className="housing-table-wrap"><table><thead><tr><th>{b('الرمز','Code')}</th><th>{b('المركز','Center')}</th><th>{b('المشروع','Project')}</th><th>{b('الربط المحاسبي','ERP Mapping')}</th><th>{b('الحالة','Status')}</th></tr></thead><tbody>{(data.costCenters||[]).map((row)=><tr key={row.id}><td><strong>{row.code}</strong></td><td>{row.name}</td><td>{row.project?.name||'—'}</td><td>{[row.external_system,row.external_code].filter(Boolean).join(' · ')||'—'}</td><td>{row.status}</td></tr>)}{!data.costCenters?.length&&<tr><td colSpan="5">{b('لا توجد مراكز تكلفة بعد.','No cost centers yet.')}</td></tr>}</tbody></table></div>
      </article>
      <article className="housing-panel">
        <div className="housing-panel-head"><div><h2>{b('إضافة تكلفة تشغيلية','Add Operating Cost')}</h2><p>{b('للوجبات والمغاسل وأي مصروف غير موجود تلقائيًا','For catering, laundry and other manual costs')}</p></div></div>
        <form className="housing-cost-entry-form" onSubmit={addCost}>
          <select required value={costForm.site_id} disabled={!canManage} onChange={(e)=>setCostForm({...costForm,site_id:e.target.value})}><option value="">{b('اختر السكن','Select housing')}</option>{(data.sites||[]).map((s)=><option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select>
          <select value={costForm.cost_center_id} disabled={!canManage} onChange={(e)=>setCostForm({...costForm,cost_center_id:e.target.value})}><option value="">{b('تلقائي حسب المشروع','Automatic by project')}</option>{(data.costCenters||[]).map((c)=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
          <select value={costForm.category} disabled={!canManage} onChange={(e)=>setCostForm({...costForm,category:e.target.value})}>{['Catering','Laundry','Rent','Electricity','Water','Maintenance','Other'].map((x)=><option key={x}>{x}</option>)}</select>
          <input required placeholder={b('الوصف','Description')} value={costForm.description} disabled={!canManage} onChange={(e)=>setCostForm({...costForm,description:e.target.value})}/>
          <input type="date" value={costForm.period_start} disabled={!canManage} onChange={(e)=>setCostForm({...costForm,period_start:e.target.value})}/>
          <input type="date" value={costForm.period_end} disabled={!canManage} onChange={(e)=>setCostForm({...costForm,period_end:e.target.value})}/>
          <input required type="number" min="0" step="0.01" placeholder={b('المبلغ','Amount')} value={costForm.amount} disabled={!canManage} onChange={(e)=>setCostForm({...costForm,amount:e.target.value})}/>
          <button className="housing-primary-button" disabled={!canManage||busy}><Plus size={16}/>{b('حفظ التكلفة','Save Cost')}</button>
        </form>
      </article>
    </div>
    <article className="housing-panel housing-table-panel">
      <div className="housing-panel-head"><div><h2>{b('ملخص التخصيص حسب مركز التكلفة','Allocation by Cost Center')}</h2><p>{b('يشمل انتقال العامل بين المشاريع على مستوى اليوم','Includes project transfers at worker-day level')}</p></div></div>
      <div className="housing-table-wrap"><table><thead><tr><th>{b('المركز','Center')}</th><th>{b('المشروع','Project')}</th><th>{b('أيام العمال','Worker Days')}</th><th>{b('إجمالي التكلفة','Total Cost')}</th><th>{b('تكلفة يوم العامل','Cost / Worker Day')}</th></tr></thead><tbody>{summary.centers.map((row)=><tr key={row.cost_center_id||'unassigned'}><td><strong>{row.cost_center_code}</strong><small>{row.cost_center_name}</small></td><td>{row.project_name}</td><td>{row.worker_days}</td><td>{currency(row.amount)}</td><td>{currency(row.cost_per_worker_day)}</td></tr>)}{!summary.centers.length&&<tr><td colSpan="5">{b('شغّل الاحتساب لإنشاء تقرير التخصيص.','Run allocation to create the report.')}</td></tr>}</tbody></table></div>
    </article>
  </section>
}
