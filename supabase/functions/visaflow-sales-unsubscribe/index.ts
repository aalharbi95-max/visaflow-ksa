import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async request=>{
 const headers={'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'content-type'};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 const token=new URL(request.url).searchParams.get('token')||'';
 if(!/^[a-f0-9]{64}$/.test(token))return new Response('Invalid link',{status:400,headers});
 if(request.method==='GET'){
  const project=new URL(Deno.env.get('SUPABASE_URL')!).hostname.split('.')[0];
  return new Response(null,{status:302,headers:{...headers,Location:`https://www.visaflowksa.com/faisal-unsubscribe.html#token=${token}&project=${project}`}});
 }
 if(request.method!=='POST')return new Response('Method not allowed',{status:405,headers});
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 const {error}=await admin.rpc('sales_intro_suppress',{p_token:token});
 if(error)return new Response('Please try again',{status:503,headers});
 // Same response for unknown/already-used tokens, no recipient disclosure.
 return new Response('تم إيقاف الرسائل. لن تُدرجوا في رسائل فيصل المستقبلية.',{headers});
});
