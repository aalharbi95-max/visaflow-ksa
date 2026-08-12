import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.10";
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const esc=(v:unknown)=>String(v??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));
Deno.serve(async(req)=>{
 if(req.method!=="POST")return json({error:"method_not_allowed"},405);
 const url=Deno.env.get("SUPABASE_URL")||"",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 const smtpUser=Deno.env.get("SMTP_USERNAME")||"",smtpPass=Deno.env.get("SMTP_PASSWORD")||"",secret=Deno.env.get("AI_INTERVIEW_WORKER_SECRET")||"";
 const smtpHost=Deno.env.get("SMTP_HOSTNAME")||"mail.privateemail.com",smtpPort=Number(Deno.env.get("SMTP_PORT")||"465");
 const from=Deno.env.get("SMTP_FROM_EMAIL")||Deno.env.get("SMTP_FROM")||smtpUser;
 if(!url||!key||!smtpUser||!smtpPass||!from||!secret)return json({error:"worker_not_configured"},503);
 if((req.headers.get("x-visaflow-worker-secret")||"")!==secret)return json({error:"unauthorized"},401);
 const admin=createClient(url,key,{auth:{persistSession:false}}); const body=await req.json().catch(()=>({}));
 const transport=nodemailer.createTransport({host:smtpHost,port:smtpPort,secure:(Deno.env.get("SMTP_SECURE")||String(smtpPort===465)).toLowerCase()!=="false",auth:{user:smtpUser,pass:smtpPass}});
 const max=Math.max(1,Math.min(20,Number(body.max_jobs||20))); let sent=0; const errors:string[]=[];
 for(let i=0;i<max;i++){
  const {data,error}=await admin.rpc("claim_talent_prospect_email_invitation_job",{p_worker:"talent-email-worker"});
  const p=data?.[0]; if(error){errors.push(error.message);break;} if(!p)break;
  try{
   const link=`https://www.visaflowksa.com/?talent=1&prospect_invite=${encodeURIComponent(p.invitation_token)}`;
   const name=esc(p.full_name||"Candidate");
   const html=`<div style="font-family:Arial,Tahoma,sans-serif;background:#f4f7fb;padding:24px;color:#10243e"><div style="max-width:680px;margin:auto;background:white;border-radius:18px;overflow:hidden"><div style="background:#071b3d;color:white;padding:24px"><h2>Complete your VisaFlow Talent profile</h2><div dir="rtl">أكمل ملفك في منصة VisaFlow Talent</div></div><div style="padding:26px;line-height:1.8"><p>Hello ${name},</p><p>You are invited to complete your professional profile and access career opportunities in Saudi Arabia. Your information will not be shared with employers without your consent.</p><div dir="rtl" style="text-align:right;border-top:1px solid #ddd;padding-top:16px"><p>مرحباً ${name}،</p><p>ندعوك لإكمال ملفك المهني والوصول إلى الفرص الوظيفية في المملكة. لن تتم مشاركة بياناتك مع الشركات دون موافقتك.</p></div><p style="text-align:center;margin:28px"><a href="${link}" style="background:#12a89d;color:white;padding:14px 24px;border-radius:10px;text-decoration:none;font-weight:bold">Complete Profile / إكمال الملف</a></p><p style="font-size:12px;color:#64748b">This link expires in 14 days. If you did not expect this invitation, you may ignore it.</p></div></div></div>`;
   const result=await transport.sendMail({from,to:p.email,replyTo:"support@visaflowksa.com",subject:"Complete your VisaFlow Talent profile | أكمل ملفك المهني",html});
   await admin.rpc("complete_talent_prospect_email_invitation",{p_id:p.id,p_provider_id:String(result.messageId||"")}); sent++;
  }catch(e){const message=e instanceof Error?e.message:"send_failed";errors.push(message);await admin.rpc("fail_talent_prospect_email_invitation",{p_id:p.id,p_error:message});}
 }
 return json({ok:errors.length===0,sent,errors});
});
