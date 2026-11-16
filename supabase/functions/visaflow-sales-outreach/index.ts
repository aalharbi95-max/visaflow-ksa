import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.10';
import {createSalesOutreachHandler} from '../_shared/salesOutreachRuntime.mjs';
import {readPublicWebsite} from '../_shared/salesPublicWebsite.mjs';

const env=(name:string)=>Deno.env.get(name)||'';
Deno.serve(createSalesOutreachHandler({createClient,env,readWebsite:readPublicWebsite,sendMail:async(message:any)=>{
 const user=env('SMTP_USERNAME'),pass=env('SMTP_PASSWORD');
 const from=env('FAISAL_FROM_EMAIL')||'adel@visaflowksa.com';
 if(!user||!pass||!/^[a-z0-9._+-]+@visaflowksa\.com$/i.test(from))throw new Error('mail_not_configured');
 const port=Number(env('SMTP_PORT')||465);
 const transport=nodemailer.createTransport({host:env('SMTP_HOSTNAME')||'mail.privateemail.com',port,secure:port===465,requireTLS:port!==465,auth:{user,pass},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000});
 try {
  const info=await transport.sendMail({from:`فيصل | VisaFlow KSA <${from}>`,replyTo:'adel@visaflowksa.com',to:message.to,subject:message.subject,text:message.text,messageId:`<faisal-${message.id}@visaflowksa.com>`,headers:message.unsubscribeUrl?{'List-Unsubscribe':`<${message.unsubscribeUrl}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}:{}});
  if(!info.accepted?.length)throw new Error('recipient_not_accepted');
  return {messageId:String(info.messageId||'').slice(0,255)};
 }finally{transport.close();}
}}));
