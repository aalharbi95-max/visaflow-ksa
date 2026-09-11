import { CheckCircle2, ClipboardCheck, LoaderCircle, PlayCircle, Save, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useHousingLanguage } from './housingI18n.jsx'

const CHECKS = [
  { key: 'cleanliness', ar: 'نظافة الغرفة والمرافق', en: 'Room and facility cleanliness' },
  { key: 'fire_extinguishers', ar: 'صلاحية طفايات الحريق', en: 'Fire extinguishers' },
  { key: 'emergency_exits', ar: 'خلو مخارج الطوارئ', en: 'Emergency exits are clear' },
  { key: 'ventilation', ar: 'التهوية والتكييف', en: 'Ventilation and air conditioning' },
  { key: 'kitchen_hygiene', ar: 'نظافة المطبخ وحفظ الأغذية', en: 'Kitchen and food hygiene' },
]

const STATUS_SCORE = { Pass: 100, 'Needs Attention': 50, Fail: 0 }

function initialChecklist(inspection) {
  const saved = Array.isArray(inspection.checklist) ? inspection.checklist : []
  return CHECKS.map((item) => saved.find((entry) => entry.key === item.key) || { ...item, status: 'Pass', note: '' })
}

export function HousingInspectionWorkflow({ inspection, onClose, onUpdate, saving }) {
  const { language, t } = useHousingLanguage()
  const b = (ar, en) => language === 'ar' ? ar : en
  const [current, setCurrent] = useState(inspection)
  const [checklist, setChecklist] = useState(() => initialChecklist(inspection))
  const [summary, setSummary] = useState(inspection.summary || '')
  const [attachmentText, setAttachmentText] = useState(() => (inspection.attachments || []).map((item) => typeof item === 'string' ? item : item.url).filter(Boolean).join('\n'))
  const [message, setMessage] = useState('')
  const score = useMemo(() => Math.round(checklist.reduce((sum, item) => sum + STATUS_SCORE[item.status], 0) / checklist.length), [checklist])
  const result = score >= 85 ? 'Passed' : score >= 60 ? 'Passed with Notes' : 'Failed'
  const updateCheck = (index, key, value) => setChecklist((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item))
  const attachments = () => attachmentText.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean).map((url) => ({ url }))
  const persist = async (payload) => { setMessage(''); const updated = await onUpdate(current.id, payload); setCurrent((value) => ({ ...value, ...updated, ...payload })); return updated }
  const start = async () => { await persist({ status: 'In Progress' }); setMessage(b('تم بدء الجولة. عبّئ عناصر الفحص ثم أكملها.', 'Inspection started. Complete the checklist.')) }
  const saveProgress = async () => { await persist({ status: 'In Progress', checklist, summary, attachments: attachments() }); setMessage(b('تم حفظ تقدم الجولة.', 'Inspection progress saved.')) }
  const complete = async () => { await persist({ status: 'Completed', completed_at: new Date().toISOString(), checklist, summary, attachments: attachments(), score, result }); setMessage(b('اكتملت الجولة وحُفظ التقييم.', 'Inspection completed and scored.')) }
  const isScheduled = current.status === 'Scheduled'
  const isCompleted = current.status === 'Completed'

  return <div className="housing-modal-backdrop" onMouseDown={onClose}>
    <div className="housing-modal housing-inspection-modal" role="dialog" aria-modal="true" aria-label={b('تنفيذ الجولة', 'Run Inspection')} onMouseDown={(event) => event.stopPropagation()}>
      <header><div><h2>{current.inspection_no} · {current.inspection_type}</h2><p>{current.scheduled_date} · {current.inspector_name || b('دون مفتش', 'No inspector')}</p></div><button type="button" onClick={onClose} aria-label={t('cancel')}><X size={20} /></button></header>
      <div className="housing-inspection-body">
        <div className="housing-inspection-status"><ClipboardCheck size={20}/><div><span>{b('حالة الجولة', 'Inspection status')}</span><strong>{current.status}</strong></div>{isCompleted&&<b>{current.score ?? score}% · {current.result || result}</b>}</div>
        {isScheduled ? <div className="housing-inspection-start"><PlayCircle size={34}/><h3>{b('الجولة مجدولة ولم تبدأ بعد', 'This inspection has not started')}</h3><p>{b('ابدأ الجولة لتفعيل قائمة فحص النظافة والسلامة.', 'Start it to enable the safety and cleanliness checklist.')}</p><button className="housing-primary-button" onClick={start} disabled={saving}>{saving?<LoaderCircle className="housing-spin" size={17}/>:<PlayCircle size={17}/>} {b('بدء الجولة', 'Start Inspection')}</button></div> : <>
          <div className="housing-inspection-checklist">{checklist.map((item,index)=><div key={item.key}><div><CheckCircle2 size={18}/><strong>{language==='ar'?item.ar:item.en}</strong></div><select disabled={isCompleted} value={item.status} onChange={(event)=>updateCheck(index,'status',event.target.value)}><option value="Pass">{b('سليم','Pass')}</option><option value="Needs Attention">{b('يحتاج معالجة','Needs Attention')}</option><option value="Fail">{b('غير سليم','Fail')}</option></select><input disabled={isCompleted} value={item.note||''} onChange={(event)=>updateCheck(index,'note',event.target.value)} placeholder={b('ملاحظة اختيارية','Optional note')}/></div>)}</div>
          <label className="housing-inspection-field"><span>{b('ملخص الجولة والإجراءات التصحيحية','Summary and corrective actions')}</span><textarea disabled={isCompleted} rows="3" value={summary} onChange={(event)=>setSummary(event.target.value)}/></label>
          <label className="housing-inspection-field"><span>{b('روابط الصور والمرفقات — رابط في كل سطر','Photo and attachment links — one per line')}</span><textarea disabled={isCompleted} rows="2" value={attachmentText} onChange={(event)=>setAttachmentText(event.target.value)} placeholder="https://..."/></label>
          <div className="housing-inspection-score"><span>{b('التقييم المحسوب','Calculated score')}</span><strong>{score}%</strong><b>{result}</b></div>
        </>}
        {message&&<div className="housing-inspection-message"><CheckCircle2 size={17}/>{message}</div>}
      </div>
      <footer className="housing-modal-actions"><button className="housing-secondary-button" type="button" onClick={onClose}>{b('إغلاق','Close')}</button>{!isScheduled&&!isCompleted&&<><button className="housing-secondary-button" type="button" onClick={saveProgress} disabled={saving}><Save size={16}/>{b('حفظ التقدم','Save Progress')}</button><button className="housing-primary-button" type="button" onClick={complete} disabled={saving}>{saving?<LoaderCircle className="housing-spin" size={17}/>:<CheckCircle2 size={17}/>} {b('إكمال الجولة','Complete Inspection')}</button></>}</footer>
    </div>
  </div>
}
