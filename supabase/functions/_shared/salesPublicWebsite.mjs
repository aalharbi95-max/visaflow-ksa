import {request} from 'node:https';
import {lookup} from 'node:dns/promises';
import {Buffer} from 'node:buffer';
import {setTimeout,clearTimeout} from 'node:timers';

export function publicIPv4(address) {
  const parts=String(address).split('.').map(Number);
  if(parts.length!==4 || parts.some(x=>!Number.isInteger(x)||x<0||x>255))return false;
  const [a,b,c]=parts;
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}

// Resolve once and pin the validated address to the TLS connection. No redirects,
// credentials, internal addresses, proxy environment settings or arbitrary ports.
export async function readPublicWebsite(value) {
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname))throw new Error('public_https_source_required');
  let records;
  try{records=await lookup(url.hostname,{all:true,family:4});}catch(error){throw new Error(`source_dns_failure:${String(error.code||error.message).slice(0,160)}`);}
  if(!records.length||records.some(r=>!publicIPv4(r.address)))throw new Error('private_source_denied');
  const address=records[0].address;
  return new Promise((resolve,reject)=>{
    // Connect directly to the validated IP while verifying TLS for the original
    // hostname. Older Edge runtimes do not implement custom Node lookup hooks.
    const req=request({protocol:'https:',hostname:address,port:443,path:url.pathname+url.search,method:'GET',servername:url.hostname,agent:false,headers:{Host:url.hostname,'User-Agent':'VisaFlow-Faisal/1.0 (business contact verification)','Accept':'text/html,text/plain'}},res=>{
      if(res.statusCode!==200||!/text\/(html|plain)/i.test(String(res.headers['content-type']||''))){res.resume();reject(new Error('source_unavailable'));return;}
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>512000){req.destroy(new Error('source_too_large'));return;}chunks.push(chunk);});
      res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error',reject);
    });
    const timer=setTimeout(()=>req.destroy(new Error('source_timeout')),12000);
    req.on('close',()=>clearTimeout(timer));
    req.on('error',error=>reject(new Error(`source_connection_failure:${String(error.message).slice(0,160)}`)));req.end();
  }).catch(error=>{if(error.message.startsWith('source_'))throw error;throw new Error(`source_connection_failure:${String(error.message).slice(0,160)}`);});
}
