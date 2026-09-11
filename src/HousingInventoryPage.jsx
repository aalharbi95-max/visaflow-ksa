import { useMemo, useState } from 'react'
import { AlertTriangle, Boxes, PackageCheck, PackagePlus, Warehouse } from 'lucide-react'
import { postHousingInventoryTransaction } from './housingService.mjs'
import { useHousingLanguage } from './housingI18n.jsx'

export default function HousingInventoryPage({ client, data, canManage, onRefresh }) {
  const { language } = useHousingLanguage(); const ar=language==='ar'
  const [form,setForm]=useState({locationId:'',itemId:'',movementType:'Receipt',quantity:'',maintenanceRequestId:'',referenceNo:'',notes:''})
  const [busy,setBusy]=useState(false); const [error,setError]=useState('')
  const balances=data.inventoryBalances||[]; const items=data.inventoryItems||[]; const locations=data.inventoryLocations||[]
  const low=useMemo(()=>balances.filter((row)=>Number(row.quantity)<=Number(row.item?.reorder_level||0)),[balances])
  const stockValue=balances.reduce((sum,row)=>sum+Number(row.quantity||0)*Number(row.item?.unit_cost||0),0)
  const submit=async(e)=>{e.preventDefault();setBusy(true);setError('');try{await postHousingInventoryTransaction(client,{...form,clientOperationId:crypto.randomUUID()});setForm({...form,quantity:'',referenceNo:'',notes:''});await onRefresh()}catch(reason){setError(reason.message)}finally{setBusy(false)}}
  return <div className="housing-inventory-stack">
    <section className="housing-advanced-stats">
      <article className="housing-advanced-stat"><span className="green"><Warehouse/></span><div><small>{ar?'المستودعات الفرعية':'Sub-warehouses'}</small><strong>{locations.length}</strong><p>{ar?'مستودع مرتبط بالسكن':'Site-linked stores'}</p></div></article>
      <article className="housing-advanced-stat"><span className="blue"><Boxes/></span><div><small>{ar?'أصناف قطع الغيار':'Spare-part items'}</small><strong>{items.length}</strong><p>{ar?'أصناف نشطة':'Active catalog items'}</p></div></article>
      <article className="housing-advanced-stat"><span className="amber"><AlertTriangle/></span><div><small>{ar?'تحت حد إعادة الطلب':'Below reorder level'}</small><strong>{low.length}</strong><p>{ar?'تحتاج توريد':'Need replenishment'}</p></div></article>
      <article className="housing-advanced-stat"><span className="purple"><PackageCheck/></span><div><small>{ar?'قيمة المخزون':'Stock value'}</small><strong>{stockValue.toLocaleString(ar?'ar-SA':'en-US',{maximumFractionDigits:0})}</strong><p>{ar?'ريال سعودي':'SAR'}</p></div></article>
    </section>
    {canManage&&<form className="housing-panel housing-inventory-form" onSubmit={submit}><header className="housing-panel-header"><div><h2>{ar?'تسجيل حركة مخزون':'Post stock movement'}</h2><p>{ar?'اربط صرف القطع ببلاغ الصيانة لحساب التكلفة الفعلية':'Link issued parts to maintenance for actual cost tracking'}</p></div><PackagePlus/></header>
      <select required value={form.locationId} onChange={e=>setForm({...form,locationId:e.target.value})}><option value="">{ar?'اختر المستودع':'Select warehouse'}</option>{locations.map(x=><option key={x.id} value={x.id}>{x.name} · {x.site?.name}</option>)}</select>
      <select required value={form.itemId} onChange={e=>setForm({...form,itemId:e.target.value})}><option value="">{ar?'اختر الصنف':'Select item'}</option>{items.map(x=><option key={x.id} value={x.id}>{x.sku} · {x.name}</option>)}</select>
      <select value={form.movementType} onChange={e=>setForm({...form,movementType:e.target.value})}>{['Receipt','Issue','Return','Adjustment Increase','Adjustment Decrease'].map(x=><option key={x}>{x}</option>)}</select>
      <input required type="number" min="0.001" step="0.001" value={form.quantity} onChange={e=>setForm({...form,quantity:e.target.value})} placeholder={ar?'الكمية':'Quantity'}/>
      <select value={form.maintenanceRequestId} onChange={e=>setForm({...form,maintenanceRequestId:e.target.value})}><option value="">{ar?'بدون بلاغ صيانة':'No maintenance request'}</option>{data.maintenance.map(x=><option key={x.id} value={x.id}>{x.request_no} · {x.title}</option>)}</select>
      <input value={form.referenceNo} onChange={e=>setForm({...form,referenceNo:e.target.value})} placeholder={ar?'رقم المرجع / الفاتورة':'Reference / invoice'}/>
      <input className="full" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder={ar?'ملاحظات':'Notes'}/>
      {error&&<p className="housing-inline-error full">{error}</p>}<button className="housing-primary-button full" disabled={busy}>{ar?'حفظ الحركة':'Post movement'}</button>
    </form>}
    <section className="housing-panel"><header className="housing-panel-header"><div><h2>{ar?'أرصدة المستودعات':'Warehouse balances'}</h2><p>{ar?'الرصيد الحالي وحد إعادة الطلب':'Current stock and reorder threshold'}</p></div></header><div className="housing-table-wrap"><table><thead><tr><th>{ar?'المستودع':'Warehouse'}</th><th>{ar?'الصنف':'Item'}</th><th>{ar?'الرصيد':'Balance'}</th><th>{ar?'حد الطلب':'Reorder'}</th><th>{ar?'الحالة':'Status'}</th></tr></thead><tbody>{balances.map(row=><tr key={`${row.location_id}-${row.item_id}`}><td>{row.location?.name}<small>{row.location?.site?.name}</small></td><td><b>{row.item?.sku}</b><small>{row.item?.name}</small></td><td>{Number(row.quantity).toLocaleString()} {row.item?.unit}</td><td>{row.item?.reorder_level}</td><td><span className={`housing-status ${Number(row.quantity)<=Number(row.item?.reorder_level)?'amber':'green'}`}>{Number(row.quantity)<=Number(row.item?.reorder_level)?(ar?'إعادة طلب':'Reorder'):(ar?'متوفر':'Available')}</span></td></tr>)}</tbody></table>{!balances.length&&<p className="housing-empty-copy">{ar?'ستظهر الأرصدة بعد أول حركة استلام.':'Balances appear after the first receipt.'}</p>}</div></section>
    <section className="housing-panel"><header className="housing-panel-header"><div><h2>{ar?'سجل حركات المخزون':'Inventory transactions'}</h2><p>{ar?'سجل مالي وتشغيلي قابل للتتبع':'Auditable operational and financial log'}</p></div></header><div className="housing-table-wrap"><table><thead><tr><th>{ar?'التاريخ':'Date'}</th><th>{ar?'الحركة':'Movement'}</th><th>{ar?'الصنف':'Item'}</th><th>{ar?'الكمية':'Qty'}</th><th>{ar?'التكلفة':'Cost'}</th><th>{ar?'بلاغ الصيانة':'Maintenance'}</th></tr></thead><tbody>{(data.inventoryTransactions||[]).map(x=><tr key={x.id}><td>{new Date(x.created_at).toLocaleString(ar?'ar-SA':'en-US')}</td><td>{x.movement_type}</td><td>{x.item?.sku}<small>{x.location?.name}</small></td><td>{x.quantity}</td><td>{Number(x.total_cost).toLocaleString()} {ar?'ر.س':'SAR'}</td><td>{x.maintenance?.request_no||'—'}</td></tr>)}</tbody></table></div></section>
  </div>
}
