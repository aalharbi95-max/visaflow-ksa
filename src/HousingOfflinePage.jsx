import { CheckCircle2, CloudOff, CloudUpload, RefreshCw, ShieldCheck, Wifi, WifiOff } from 'lucide-react'
import { useHousingLanguage } from './housingI18n.jsx'

const typeLabel = {
  CREATE_RECORD: ['سجل ميداني', 'Field record'],
  UPDATE_INSPECTION: ['تحديث جولة تفتيش', 'Inspection update'],
  HSE_ATTACHMENT: ['مرفق سلامة HSE', 'HSE attachment'],
}

export default function HousingOfflinePage({ offline }) {
  const { language } = useHousingLanguage()
  const ar = language === 'ar'
  const s = offline.summary
  return <div className="housing-offline-stack">
    <section className={`housing-offline-hero ${offline.online ? 'online' : 'offline'}`}>
      <span>{offline.online ? <Wifi size={28} /> : <WifiOff size={28} />}</span>
      <div><h2>{offline.online ? (ar ? 'متصل بالإنترنت' : 'Online') : (ar ? 'تعمل الآن دون إنترنت' : 'Working offline')}</h2><p>{ar ? 'تُحفظ العمليات الميدانية على الجهاز وتُرفع تلقائياً عند عودة الاتصال.' : 'Field operations are stored on this device and synced automatically when connectivity returns.'}</p></div>
      <button className="housing-primary-button" onClick={offline.syncNow} disabled={!offline.online || offline.syncing}><RefreshCw size={17} className={offline.syncing ? 'housing-spin' : ''} />{ar ? 'مزامنة الآن' : 'Sync now'}</button>
    </section>
    <section className="housing-advanced-stats">
      <article className="housing-advanced-stat"><span className="amber"><CloudOff /></span><div><small>{ar ? 'بانتظار الرفع' : 'Pending'}</small><strong>{s.pending}</strong><p>{ar ? 'محفوظة محلياً' : 'Stored locally'}</p></div></article>
      <article className="housing-advanced-stat"><span className="blue"><CloudUpload /></span><div><small>{ar ? 'قيد المزامنة' : 'Syncing'}</small><strong>{s.syncing}</strong><p>{ar ? 'يتم رفعها الآن' : 'Uploading now'}</p></div></article>
      <article className="housing-advanced-stat"><span className="green"><CheckCircle2 /></span><div><small>{ar ? 'تمت مزامنتها' : 'Synced'}</small><strong>{s.synced}</strong><p>{ar ? 'وصلت إلى Supabase' : 'Saved to Supabase'}</p></div></article>
      <article className="housing-advanced-stat"><span className="red"><ShieldCheck /></span><div><small>{ar ? 'تحتاج مراجعة' : 'Needs review'}</small><strong>{s.failed}</strong><p>{ar ? 'يمكن إعادة المحاولة' : 'Retry is available'}</p></div></article>
    </section>
    <section className="housing-panel">
      <header className="housing-panel-header"><div><h2>{ar ? 'طابور المزامنة' : 'Sync queue'}</h2><p>{ar ? 'الجولات والصيانة والعدادات والصور المسجلة من الميدان' : 'Inspections, maintenance, meter readings and field attachments'}</p></div>{s.synced > 0 && <button className="housing-secondary-button" onClick={offline.clearSynced}>{ar ? 'مسح المكتمل' : 'Clear synced'}</button>}</header>
      <div className="housing-offline-list">{offline.operations.length ? offline.operations.map((item) => <div key={item.id}>
        <span className={item.status.toLowerCase()}>{item.status === 'Synced' ? <CheckCircle2 size={17} /> : item.status === 'Failed' ? <CloudOff size={17} /> : <CloudUpload size={17} />}</span>
        <div><strong>{typeLabel[item.type]?.[ar ? 0 : 1] || item.type}</strong><small>{new Date(item.created_at).toLocaleString(ar ? 'ar-SA' : 'en-US')} · {ar ? `المحاولات ${item.attempts}` : `${item.attempts} attempts`}</small>{item.last_error && <em>{item.last_error}</em>}</div>
        <b>{item.status}</b>
      </div>) : <p className="housing-empty-copy">{ar ? 'لا توجد عمليات معلقة. الجهاز متزامن.' : 'No pending operations. This device is in sync.'}</p>}</div>
    </section>
  </div>
}
