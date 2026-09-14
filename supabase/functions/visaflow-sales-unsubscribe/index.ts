import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async request=>{
 const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
 const token=new URL(request.url).searchParams.get('token')||'';
 if(!/^[a-f0-9]{64}$/.test(token))return new Response('Invalid link',{status:400,headers});
 if(request.method==='GET')return new Response('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>إيقاف رسائل VisaFlow</title><h1>إيقاف رسائل VisaFlow</h1><p>اضغط لتأكيد إلغاء الاشتراك في رسائل فيصل.</p><form method="post"><button type="submit">إلغاء الاشتراك</button></form></html>',{headers});
 if(request.method!=='POST')return new Response('Method not allowed',{status:405,headers});
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 const {error}=await admin.rpc('sales_intro_suppress',{p_token:token});
 if(error)return new Response('Please try again',{status:503,headers});
 // Same response for unknown/already-used tokens, no recipient disclosure.
 return new Response('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>VisaFlow</title><h1>تم إيقاف الرسائل</h1><p>لن تُدرجوا في رسائل فيصل المستقبلية.</p></html>',{headers});
});
