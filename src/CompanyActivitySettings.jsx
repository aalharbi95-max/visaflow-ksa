import {useEffect,useState} from 'react';

export default function CompanyActivitySettings({client,companyId}) {
  const [state,setState]=useState({companyId:null,name:'',loading:true,error:'',saved:false});
  const [saving,setSaving]=useState(false);
  useEffect(()=>{
    let cancelled=false;
    setState({companyId,name:'',loading:true,error:'',saved:false});
    if(!companyId)return ()=>{cancelled=true};
    client.from('company_compliance_profiles').select('economic_activity_name').eq('company_id',companyId).maybeSingle().then(({data,error})=>{
      if(!cancelled)setState({companyId,name:data?.economic_activity_name||'',loading:false,error:error?.message||'',saved:false});
    }).catch(error=>{if(!cancelled)setState({companyId,name:'',loading:false,error:error.message,saved:false});});
    return ()=>{cancelled=true};
  },[client,companyId]);
  async function save(event){
    event.preventDefault();
    if(!companyId||state.companyId!==companyId||state.loading||saving)return;
    const name=state.name.trim();
    if(!name)return setState(s=>({...s,error:'أدخل نشاط الشركة / Enter the company activity.'}));
    const target=companyId;setSaving(true);
    try{
      const {data,error}=await client.from('company_compliance_profiles').upsert({company_id:target,economic_activity_name:name,updated_at:new Date().toISOString()},{onConflict:'company_id'}).select('company_id,economic_activity_name').single();
      if(error)throw error;
      if(data?.company_id!==target||data.economic_activity_name!==name)throw Error('تعذر التحقق من حفظ النشاط / Could not verify the saved activity.');
      setState(s=>s.companyId===target?{...s,name:data.economic_activity_name,error:'',saved:true}:s);
    }catch(error){setState(s=>s.companyId===target?{...s,error:error.message,saved:false}:s);}
    finally{setSaving(false);}
  }
  return <section className="panel" dir="rtl" aria-label="Company activity settings">
    <h2>نشاط الشركة / Company activity</h2>
    <form onSubmit={save}>
      <label htmlFor="company-activity-name">اسم النشاط / Activity name</label>
      <input id="company-activity-name" maxLength={200} value={state.companyId===companyId?state.name:''} disabled={state.loading||saving||state.companyId!==companyId} onChange={e=>setState(s=>({...s,name:e.target.value,saved:false}))} style={{display:'block',width:'100%',maxWidth:500,padding:12,margin:'10px 0',border:'1px solid #b6cbd7',borderRadius:8}}/>
      <p>وصف نشاط الشركة. رمز النشاط المعتمد في نطاقات يُسجّل بشكل مستقل.</p>
      <button type="submit" disabled={state.loading||saving||state.companyId!==companyId}>{saving?'جارٍ الحفظ…':'حفظ النشاط / Save activity'}</button>
      {state.saved&&<p role="status">تم حفظ نشاط الشركة: {state.name}</p>}
      {state.error&&<p role="alert">{state.error}</p>}
    </form>
  </section>;
}
