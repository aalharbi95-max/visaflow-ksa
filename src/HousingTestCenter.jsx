import { useMemo, useState } from 'react'
import { AlertTriangle, BedDouble, CheckCircle2, Database, LoaderCircle, PlayCircle, RefreshCw, Users } from 'lucide-react'
import { useHousingLanguage } from './housingI18n.jsx'

export default function HousingTestCenter({ data, loading, saving, error, onSeed, onAssign, onRefresh, onAcknowledge }) {
  const { language, t } = useHousingLanguage()
  const [employeeId, setEmployeeId] = useState('')
  const [bedId, setBedId] = useState('')
  const [result, setResult] = useState('')
  const availableBeds = useMemo(() => data.rooms.flatMap((room) => (room.beds || []).filter((bed) => bed.status === 'Available').map((bed) => ({ ...bed, room }))), [data.rooms])

  const seed = async () => {
    setResult('')
    try { await onSeed(); setResult(language === 'ar' ? 'تم إنشاء بيانات الاختبار بنجاح.' : 'Test data created successfully.') } catch { /* shared error */ }
  }
  const assign = async (event) => {
    event.preventDefault()
    setResult('')
    try {
      const assignment = await onAssign({ employeeId, bedId, startDate: new Date().toISOString().slice(0, 10), reason: 'Full-system test' })
      const warning = assignment?.compliance_snapshot?.warning_issued
      setResult(warning ? (language === 'ar' ? 'تم التسكين مع تسجيل تنبيه تجاوز 4 م².' : 'Assigned with a 4 m² compliance warning.') : (language === 'ar' ? 'تم التسكين بنجاح وبدون تجاوز.' : 'Assigned successfully with no compliance warning.'))
      setEmployeeId(''); setBedId('')
    } catch { /* shared error */ }
  }

  return <div className="housing-test-stack">
    <section className="housing-test-readiness">
      <article><Database size={21} /><div><small>{t('sitesCount')}</small><strong>{data.sites.length}</strong></div></article>
      <article><BedDouble size={21} /><div><small>{t('roomsCount')}</small><strong>{data.rooms.length}</strong></div></article>
      <article><Users size={21} /><div><small>{t('activeResidents')}</small><strong>{data.assignments.length}</strong></div></article>
      <article><AlertTriangle size={21} /><div><small>{t('complianceAlerts')}</small><strong>{data.alerts.filter((item) => item.status === 'Open').length}</strong></div></article>
    </section>

    <section className="housing-panel housing-test-actions">
      <div className="housing-panel-head"><div><h2>{t('testReady')}</h2><p>{t('liveData')}</p></div><button className="housing-secondary-button" onClick={onRefresh} disabled={loading}><RefreshCw size={16} className={loading ? 'housing-spin' : ''} />{t('refresh')}</button></div>
      {error && <div className="housing-access-message error">{error}</div>}
      {result && <div className="housing-access-message"><CheckCircle2 size={16} />{result}</div>}
      <div className="housing-test-action-grid">
        <article><PlayCircle size={28} /><div><h3>{t('testData')}</h3><p>{language === 'ar' ? 'ينشئ سكنًا وغرفتين و10 أسرّة و5 عمال وترخيصًا وفحص HSE واستبيانًا. يمكن تشغيله أكثر من مرة بأمان.' : 'Creates one site, two rooms, 10 beds, five workers, a license, an HSE report and a survey. Safe to run repeatedly.'}</p></div><button className="housing-primary-button" onClick={seed} disabled={saving}>{saving ? <LoaderCircle className="housing-spin" size={17} /> : null}{t('testData')}</button></article>
        <form onSubmit={assign}><BedDouble size={28} /><div><h3>{t('newAssignment')}</h3><p>{language === 'ar' ? 'اختر عاملًا وسريرًا متاحًا لاختبار التسكين والتنبيه.' : 'Select a worker and an available bed to test assignment and warnings.'}</p></div><select required value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">{language === 'ar' ? 'اختر العامل' : 'Select worker'}</option>{data.employees.filter((employee) => !data.assignments.some((assignment) => assignment.employee_id === employee.id)).map((employee) => <option key={employee.id} value={employee.id}>{employee.employee_no} · {employee.full_name} · {employee.work_shift}</option>)}</select><select required value={bedId} onChange={(event) => setBedId(event.target.value)}><option value="">{language === 'ar' ? 'اختر السرير' : 'Select bed'}</option>{availableBeds.map((bed) => <option key={bed.id} value={bed.id}>{bed.room.site?.name} · {bed.room.room_number} · {bed.bed_number} · {bed.room.area_sqm} m²</option>)}</select><button className="housing-primary-button" disabled={saving || !employeeId || !bedId}>{saving ? <LoaderCircle className="housing-spin" size={17} /> : null}{t('newAssignment')}</button></form>
      </div>
    </section>

    <section className="housing-panel"><div className="housing-panel-head"><div><h2>{t('complianceAlerts')}</h2><p>{t('warningOnly')} · {t('areaPerWorker')}</p></div></div><div className="housing-live-alerts">{data.alerts.length === 0 ? <p>{t('noRecords')}</p> : data.alerts.map((alert) => <div key={alert.id}><AlertTriangle size={18} /><div><strong>{alert.title}</strong><small>{alert.site?.name} · {alert.room?.room_number} · {alert.employee?.full_name}</small></div><span>{alert.details?.occupants_after_assignment}/{alert.details?.legal_capacity}</span>{alert.status === 'Open' && <button onClick={() => onAcknowledge(alert.id)}>{language === 'ar' ? 'تم الاطلاع' : 'Acknowledge'}</button>}</div>)}</div></section>
  </div>
}
