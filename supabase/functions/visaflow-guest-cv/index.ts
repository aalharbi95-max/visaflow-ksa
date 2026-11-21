import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const origins = new Set(['https://www.visaflowksa.com','https://visaflowksa.com','https://staging.visaflowksa.com','http://localhost:5173']);
const maxBytes = 10 * 1024 * 1024;
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {auth:{persistSession:false}});
async function hash(bytes: BufferSource) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), b=>b.toString(16).padStart(2,'0')).join('');
}
Deno.serve(async req => {
  const origin=req.headers.get('origin')||'';
  const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':origins.has(origin)?origin:'null','Access-Control-Allow-Headers':'apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
  const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
  if(!origins.has(origin)) return reply(403,{error:'ORIGIN_DENIED'});
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
  if(req.method!=='POST') return reply(405,{error:'METHOD_NOT_ALLOWED'});
  let path='';
  let committed=false;
  try {
    const length=Number(req.headers.get('content-length'));
    if(length>maxBytes+32768) return reply(413,{error:'TOO_LARGE'});
    // The edge gateway sets this address; never accept a client-supplied IP in form data.
    const ip=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
    const key=await hash(new TextEncoder().encode(`${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}:${ip}`));
    const quota=await admin.rpc('claim_guest_cv_attempt',{p_key:key});
    if(quota.error) throw quota.error;
    if(!quota.data) return reply(429,{error:'RATE_LIMIT'});
    // Bound streamed requests too, before parsing multipart data.
    const reader=req.body?.getReader();
    if(!reader) return reply(400,{error:'EMPTY_BODY'});
    const chunks:Uint8Array[]=[]; let total=0;
    while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>maxBytes+32768){await reader.cancel();return reply(413,{error:'TOO_LARGE'});}chunks.push(value);}
    const form=await new Response(new Blob(chunks),{headers:{'Content-Type':req.headers.get('content-type')||''}}).formData();
    const fields:Record<string,string>={};
    for(const name of ['full_name','email','phone','profession','location','years_experience','consent']) fields[name]=String(form.get(name)||'').trim();
    const requestId=String(form.get('request_id')||'');
    if(form.get('website') || fields.consent!=='yes' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
      || fields.full_name.length<2 || fields.full_name.length>160 || fields.profession.length<2 || fields.profession.length>160
      || !fields.location || fields.location.length>160 || !/^[+\d\s()-]{6,30}$/.test(fields.phone)
      || fields.email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)
      || !/^\d{1,2}$/.test(fields.years_experience) || Number(fields.years_experience)>60) return reply(400,{error:'INVALID_FORM'});
    const file=form.get('cv');
    if(!(file instanceof File)||!file.size||file.size>maxBytes) return reply(400,{error:'INVALID_FILE'});
    const bytes=new Uint8Array(await file.arrayBuffer());
    const pdf=/\.pdf$/i.test(file.name)&&new TextDecoder().decode(bytes.slice(0,5))==='%PDF-';
    const docx=/\.docx$/i.test(file.name)&&bytes[0]===0x50&&bytes[1]===0x4b&&bytes[2]===3&&bytes[3]===4;
    if(!pdf&&!docx) return reply(400,{error:'INVALID_FILE'});
    const fingerprint=await hash(new TextEncoder().encode(`${fields.email.toLowerCase()}:${await hash(bytes)}`));
    const prior=await admin.from('talent_guest_submissions').select('candidate_id,request_id').eq('fingerprint',fingerprint).maybeSingle();
    if(prior.error) throw prior.error;
    if(prior.data){
      // Do not expose another submission's reference based only on an email/file match.
      if(prior.data.request_id!==requestId) return reply(409,{error:'ALREADY_SUBMITTED'});
      const candidate=await admin.from('talent_candidates').select('public_reference,marketplace_status,published_at').eq('id',prior.data.candidate_id).single();
      if(candidate.error) throw candidate.error;
      if(candidate.data.marketplace_status!=='Approved'||!candidate.data.published_at) return reply(409,{error:'NOT_PUBLISHED'});
      return reply(200,{reference:candidate.data.public_reference});
    }
    const candidateId=crypto.randomUUID();
    path=`guest/${candidateId}/cv.${pdf?'pdf':'docx'}`;
    const mime=pdf?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const upload=await admin.storage.from('talent-cv').upload(path,bytes,{contentType:mime,upsert:false});
    if(upload.error) throw upload.error;
    const saved=await admin.rpc('publish_guest_cv',{p_request_id:requestId,p_candidate_id:candidateId,p_data:fields,
      p_path:path,p_filename:file.name.replace(/[\x00-\x1f]/g,'').slice(0,200),p_mime:mime,p_size:file.size,p_fingerprint:fingerprint});
    if(saved.error) throw saved.error;
    committed=true;
    return reply(201,saved.data);
  } catch {
    // Check the database before cleanup: a network failure may follow a commit.
    if(path&&!committed){
      const linked=await admin.from('talent_candidate_documents').select('id').eq('storage_path',path).limit(1);
      if(!linked.error&&!linked.data?.length) await admin.storage.from('talent-cv').remove([path]);
    }
    return reply(500,{error:'UPLOAD_FAILED'});
  }
});
