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

export function parsePublicHttpResponse(bytes) {
  const buffer=Buffer.from(bytes),split=buffer.indexOf('\r\n\r\n');
  if(split<0||split>16384)throw new Error('invalid_source_response');
  const lines=buffer.subarray(0,split).toString('latin1').split('\r\n');
  if(!/^HTTP\/1\.[01] 200(?: |$)/.test(lines.shift()))throw new Error('source_unavailable');
  const headers=new Map();
  for(const line of lines){const colon=line.indexOf(':');if(colon<1)throw new Error('invalid_source_response');const key=line.slice(0,colon).toLowerCase();if(headers.has(key)){if(['content-length','transfer-encoding','content-type','content-encoding'].includes(key))throw new Error('invalid_source_response');continue;}headers.set(key,line.slice(colon+1).trim().toLowerCase());}
  if(!/^text\/(html|plain)(?:;|$)/.test(headers.get('content-type')||'')||headers.has('content-encoding')&&headers.get('content-encoding')!=='identity')throw new Error('source_unavailable');
  let body=buffer.subarray(split+4);
  if(headers.has('transfer-encoding')){
    if(headers.get('transfer-encoding')!=='chunked'||headers.has('content-length'))throw new Error('invalid_source_response');
    let offset=0;const chunks=[];
    while(true){const end=body.indexOf('\r\n',offset);if(end<0)throw new Error('invalid_source_response');const hex=body.subarray(offset,end).toString().split(';')[0];if(!/^[0-9a-f]+$/i.test(hex))throw new Error('invalid_source_response');const size=parseInt(hex,16);offset=end+2;if(size===0)break;if(!Number.isSafeInteger(size)||offset+size+2>body.length||body.subarray(offset+size,offset+size+2).toString()!=='\r\n')throw new Error('invalid_source_response');chunks.push(body.subarray(offset,offset+size));offset+=size+2;}
    body=Buffer.concat(chunks);
  }else if(headers.has('content-length')&&Number(headers.get('content-length'))!==body.length)throw new Error('invalid_source_response');
  if(body.length>512000)throw new Error('source_too_large');
  return body.toString('utf8');
}

async function readDenoWebsite(url,address) {
  const runtime=globalThis.Deno;let connection,expired=false,timer;
  const close=()=>{try{connection?.close();}catch{/* Already closed by TLS or timeout. */}};
  const read=async()=>{
    try{
      connection=await runtime.connect({hostname:address,port:443});
      if(expired)throw new Error('source_timeout');
      // Upgrade the existing pinned TCP connection; hostname controls SNI and
      // certificate verification, without performing another DNS lookup.
      connection=await runtime.startTls(connection,{hostname:url.hostname,alpnProtocols:['http/1.1']});
      if(expired)throw new Error('source_timeout');
      const requestBytes=new TextEncoder().encode(`GET ${url.pathname+url.search} HTTP/1.0\r\nHost: ${url.hostname}\r\nAccept: text/html,text/plain\r\nAccept-Encoding: identity\r\nConnection: close\r\nUser-Agent: VisaFlow-Faisal/1.0\r\n\r\n`);
      let written=0;while(written<requestBytes.length)written+=await connection.write(requestBytes.subarray(written));
      const chunks=[];let size=0;
      while(true){const chunk=new Uint8Array(16384),n=await connection.read(chunk);if(n===null)break;size+=n;if(size>530000)throw new Error('source_too_large');chunks.push(chunk.slice(0,n));}
      return parsePublicHttpResponse(Buffer.concat(chunks));
    }finally{close();}
  };
  try{return await Promise.race([read(),new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;close();reject(new Error('source_timeout'));},12000);})]);}
  finally{expired=true;clearTimeout(timer);close();}
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
  if(globalThis.Deno?.startTls)return readDenoWebsite(url,address);
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
