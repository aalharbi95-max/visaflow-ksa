import { useEffect, useMemo, useState } from 'react'
import { Building2, CheckCircle2, Clock3, Copy, LogOut, RefreshCw, ShieldCheck, Users, Wallet, XCircle } from 'lucide-react'
import { getHousingSupabaseClient } from './housingSupabase.js'
import './housingOwner.css'

const emptyReview = { plan: 'Standard', start: new Date().toISOString().slice(0,10), end: '', users: 10, sites: 10, amount: 0 }

function OwnerLogin({ onLogin, busy, error }) {
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  return <main className="housing-owner-login" dir="rtl"><form onSubmit={(event)=>{event.preventDefault();onLogin(email,password)}}>
    <span className="housing-owner-mark"><ShieldCheck size={30}/></span><h1>منصة مالك السكنات</h1><p>دخول مستقل لإدارة طلبات الشركات والاشتراكات.</p>
    <label>البريد الإلكتروني<input required type="email" value={email} onChange={(e)=>setEmail(e.target.value)}/></label>
    <label>كلمة المرور<input required type="password" value={password} onChange={(e)=>setPassword(e.target.value)}/></label>
    {error&&<div className="housing-owner-error">{error}</div>}<button disabled={busy}>{busy?'جاري الدخول...':'تسجيل الدخول'}</button>
    <a href="/housing">العودة إلى منصة السكنات</a>
  </form></main>
}

export default function HousingOwnerApp(){
  const client=useMemo(()=>getHousingSupabaseClient(),[])
  const [state,setState]=useState({loading:true,session:null,owner:null,error:''})
  const [dashboard,setDashboard]=useState({stats:{},requests:[],companies:[]})
  const [selected,setSelected]=useState(null)
  const [review,setReview]=useState(emptyReview)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')

  const load=async()=>{
    setState((value)=>({...value,loading:true,error:''}))
    const {data:{session}}=await client.auth.getSession()
    if(!session)return setState({loading:false,session:null,owner:null,error:''})
    const {data:context,error:contextError}=await client.rpc('housing_owner_context')
    if(contextError)return setState({loading:false,session,owner:null,error:'هذا الحساب غير مصرح له بالدخول إلى منصة مالك السكنات.'})
    const {data,error}=await client.rpc('housing_owner_dashboard')
    if(error)return setState({loading:false,session,owner:context?.owner,error:error.message})
    setDashboard(data||{stats:{},requests:[],companies:[]});setState({loading:false,session,owner:context?.owner,error:''})
  }

  useEffect(()=>{load();const {data}=client.auth.onAuthStateChange(()=>setTimeout(load,0));return()=>data?.subscription?.unsubscribe()},[client])
  const login=async(email,password)=>{setBusy(true);setState((v)=>({...v,error:''}));const {error}=await client.auth.signInWithPassword({email,password});if(error)setState({loading:false,session:null,owner:null,error:'بيانات الدخول غير صحيحة.'});setBusy(false)}
  const logout=async()=>{await client.auth.signOut();window.location.assign('/housing-owner')}
  const openReview=(request)=>{const end=new Date();end.setDate(end.getDate()+30);setSelected(request);setReview({plan:request.requested_plan||'Standard',start:new Date().toISOString().slice(0,10),end:end.toISOString().slice(0,10),users:request.expected_users||10,sites:request.expected_sites||1,amount:0});setMessage('')}
  const approve=async()=>{setBusy(true);setMessage('');const {data,error}=await client.rpc('housing_owner_review_request',{p_request_id:selected.id,p_action:'Approve',p_plan:review.plan,p_subscription_start:review.start,p_subscription_end:review.end,p_users_limit:Number(review.users),p_sites_limit:Number(review.sites),p_monthly_amount:Number(review.amount),p_rejection_reason:null});if(error)setMessage(error.message);else{setMessage(`تم الاعتماد. رابط الدعوة: ${data.invite_url}`);await load()}setBusy(false)}
  const reject=async(request)=>{const reason=window.prompt('سبب الرفض (اختياري):','');if(reason===null)return;setBusy(true);const {error}=await client.rpc('housing_owner_review_request',{p_request_id:request.id,p_action:'Reject',p_plan:'Standard',p_rejection_reason:reason});if(error)setMessage(error.message);else await load();setBusy(false)}
  const setCompanyStatus=async(company,status)=>{setBusy(true);const {error}=await client.rpc('housing_owner_set_company_status',{p_company_id:company.id,p_status:status});if(error)setMessage(error.message);else await load();setBusy(false)}
  const copyInvite=async()=>{const url=message.match(/https:\/\/\S+/)?.[0];if(url){await navigator.clipboard.writeText(url);setMessage('تم نسخ رابط الدعوة.')}}

  if(state.loading)return <div className="housing-owner-loading">جاري تحميل منصة المالك...</div>
  if(!state.session||!state.owner)return <OwnerLogin onLogin={login} busy={busy} error={state.error}/>
  const stats=dashboard.stats||{}
  return <main className="housing-owner-app" dir="rtl">
    <aside><div className="housing-owner-logo"><Building2 size={25}/><div><strong>سكن</strong><span>منصة المالك</span></div></div><nav><a href="#requests">طلبات التسجيل</a><a href="#companies">الشركات والاشتراكات</a></nav><div className="housing-owner-account"><strong>{state.owner.full_name}</strong><span>{state.owner.email}</span><button onClick={logout}><LogOut size={17}/> خروج</button></div></aside>
    <section className="housing-owner-content"><header><div><p>HOUSING PLATFORM OWNER</p><h1>إدارة منتج السكنات</h1><span>اعتماد الشركات وإدارة الاشتراكات بمعزل عن منصة التوظيف.</span></div><button onClick={load}><RefreshCw size={17}/> تحديث</button></header>
      {message&&<div className="housing-owner-message">{message}{message.includes('https://')&&<button onClick={copyInvite}><Copy size={16}/> نسخ الرابط</button>}</div>}
      <div className="housing-owner-stats"><article><Clock3/><span>طلبات معلقة</span><strong>{stats.pending_requests||0}</strong></article><article><Building2/><span>شركات نشطة</span><strong>{stats.active_companies||0}</strong></article><article><Users/><span>شركات موقوفة</span><strong>{stats.suspended_companies||0}</strong></article><article><Wallet/><span>الإيراد الشهري</span><strong>{Number(stats.monthly_revenue||0).toLocaleString()} ر.س</strong></article></div>
      <section id="requests" className="housing-owner-panel"><div className="housing-owner-panel-head"><div><h2>طلبات التسجيل</h2><p>لا يتم إنشاء أي شركة أو حساب قبل اعتمادك.</p></div></div><div className="housing-owner-table"><table><thead><tr><th>الشركة</th><th>مدير الحساب</th><th>الطلب</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>{(dashboard.requests||[]).map((request)=><tr key={request.id}><td><strong>{request.company_name}</strong><small>{request.email}<br/>{request.phone||'-'}</small></td><td>{request.admin_name}</td><td>{request.requested_plan}<small>{request.expected_users} مستخدم · {request.expected_sites} سكن</small></td><td><span className={`housing-owner-status ${request.status.toLowerCase()}`}>{request.status}</span></td><td>{request.status==='Pending'?<div className="housing-owner-actions"><button onClick={()=>openReview(request)}><CheckCircle2 size={15}/> اعتماد</button><button className="danger" onClick={()=>reject(request)}><XCircle size={15}/> رفض</button></div>:'—'}</td></tr>)}{!(dashboard.requests||[]).length&&<tr><td colSpan="5">لا توجد طلبات حتى الآن.</td></tr>}</tbody></table></div></section>
      <section id="companies" className="housing-owner-panel"><div className="housing-owner-panel-head"><div><h2>الشركات والاشتراكات</h2><p>التحكم في وصول كل شركة إلى منتج السكنات.</p></div></div><div className="housing-owner-company-grid">{(dashboard.companies||[]).map((company)=><article key={company.id}><header><div><h3>{company.name}</h3><span>{company.primary_admin_email||'-'}</span></div><span className={`housing-owner-status ${String(company.status).toLowerCase()}`}>{company.status}</span></header><div><span>الخطة<strong>{company.plan}</strong></span><span>المستخدمون<strong>{company.users_limit}</strong></span><span>السكنات<strong>{company.sites}/{company.sites_limit}</strong></span><span>المقيمون<strong>{company.residents}</strong></span></div><footer><span>{Number(company.monthly_amount||0).toLocaleString()} ر.س شهريًا</span>{company.status==='Active'?<button className="danger" onClick={()=>setCompanyStatus(company,'Suspended')}>إيقاف</button>:<button onClick={()=>setCompanyStatus(company,'Active')}>تفعيل</button>}</footer></article>)}</div></section>
    </section>
    {selected&&<div className="housing-owner-modal-backdrop"><form className="housing-owner-modal" onSubmit={(e)=>{e.preventDefault();approve()}}><header><div><h2>اعتماد {selected.company_name}</h2><p>سيُنشئ النظام الشركة ودعوة مديرها بعد الحفظ.</p></div><button type="button" onClick={()=>setSelected(null)}>×</button></header><div className="housing-owner-form-grid"><label>الخطة<select value={review.plan} onChange={(e)=>setReview(v=>({...v,plan:e.target.value}))}><option>Starter</option><option>Standard</option><option>Enterprise</option></select></label><label>عدد المستخدمين<input type="number" min="1" value={review.users} onChange={(e)=>setReview(v=>({...v,users:e.target.value}))}/></label><label>عدد السكنات<input type="number" min="1" value={review.sites} onChange={(e)=>setReview(v=>({...v,sites:e.target.value}))}/></label><label>القيمة الشهرية<input type="number" min="0" value={review.amount} onChange={(e)=>setReview(v=>({...v,amount:e.target.value}))}/></label><label>بداية الاشتراك<input type="date" required value={review.start} onChange={(e)=>setReview(v=>({...v,start:e.target.value}))}/></label><label>نهاية الاشتراك<input type="date" required value={review.end} onChange={(e)=>setReview(v=>({...v,end:e.target.value}))}/></label></div><footer><button type="button" onClick={()=>setSelected(null)}>إلغاء</button><button className="primary" disabled={busy}>{busy?'جاري الاعتماد...':'اعتماد وإنشاء الدعوة'}</button></footer></form></div>}
  </main>
}
