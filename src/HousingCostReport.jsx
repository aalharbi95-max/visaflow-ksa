import { Building2, Download, Users, Wallet } from 'lucide-react'
import { useMemo } from 'react'
import { buildHousingCostReport } from './housingCostReport.mjs'
import { useHousingLanguage } from './housingI18n.jsx'
import { exportHousingExcel } from './housingExcelExport.mjs'

const money = (value, locale) => value == null ? '—' : new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)

export function HousingCostReport({ data }) {
  const { language, locale } = useHousingLanguage()
  const b = (ar, en) => language === 'ar' ? ar : en
  const report = useMemo(() => buildHousingCostReport(data), [data])
  const currency = (value) => `${money(value, locale)} ${b('ر.س','SAR')}`

  return <section className="housing-cost-report">
    <div className="housing-panel-head"><div><h2>{b('تكلفة سكن العامل','Worker Housing Cost')}</h2><p>{b('تقدير سنوي يشمل الإيجار والفواتير والصيانة المسجلة خلال آخر 12 شهرًا','Annual estimate including rent, annualized utilities and maintenance recorded in the last 12 months')}</p></div><button className="housing-secondary-button" onClick={()=>exportHousingExcel(`housing-worker-cost-${new Date().toISOString().slice(0,10)}.xlsx`,report.rows,{sheetName:b('تكلفة العامل','Worker Cost'),language,reportType:'cost'})}><Download size={16}/>{b('تصدير التقرير','Export Report')}</button></div>
    <div className="housing-cost-summary">
      <article><Building2 size={20}/><span>{b('إجمالي السكنات','All housing sites')}</span><strong>{report.totals.sites_count}</strong></article>
      <article><Users size={20}/><span>{b('العمال المسكنون','Housed workers')}</span><strong>{report.totals.worker_count}</strong></article>
      <article><Wallet size={20}/><span>{b('إجمالي التكلفة السنوية','Total annual cost')}</span><strong>{currency(report.totals.total_annual_cost)}</strong></article>
      <article><Users size={20}/><span>{b('متوسط تكلفة العامل شهريًا','Average monthly cost per worker')}</span><strong>{currency(report.totals.monthly_cost_per_worker)}</strong></article>
    </div>
    <div className="housing-table-wrap"><table><thead><tr><th>{b('السكن','Housing')}</th><th>{b('العمال','Workers')}</th><th>{b('الإيجار السنوي','Annual Rent')}</th><th>{b('الخدمات السنوية','Annual Utilities')}</th><th>{b('الصيانة','Maintenance')}</th><th>{b('الإجمالي السنوي','Annual Total')}</th><th>{b('للعامل سنويًا','Per Worker / Year')}</th><th>{b('للعامل شهريًا','Per Worker / Month')}</th></tr></thead><tbody>{report.rows.map((row)=><tr key={row.site_id}><td><strong>{row.site_name}</strong><small>{row.site_code} · {row.city}</small></td><td>{row.worker_count}</td><td>{currency(row.annual_rent)}</td><td>{currency(row.annual_utilities)}</td><td>{currency(row.annual_maintenance)}</td><td><strong>{currency(row.total_annual_cost)}</strong></td><td>{currency(row.annual_cost_per_worker)}</td><td><strong>{currency(row.monthly_cost_per_worker)}</strong></td></tr>)}</tbody></table></div>
    {report.rows.length===0&&<div className="housing-inline-empty">{b('لا توجد سكنات لحساب التكلفة','No housing sites available for cost calculation')}</div>}
    <p className="housing-cost-note">{b('ملاحظة: إذا لم يوجد عمال مسكنون في السكن تظهر تكلفة العامل كشرطة (—). فواتير الخدمات تُحوّل إلى تقدير سنوي بحسب مدة كل فاتورة.','Note: Per-worker cost is shown as — when a site has no active residents. Utility bills are annualized from each bill period.')}</p>
  </section>
}
