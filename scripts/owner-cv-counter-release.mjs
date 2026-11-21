import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const ref=process.env.SUPABASE_PROJECT_REF;
assert.equal(ref,'zeocbftriydodzfgixjv');
assert.equal(process.env.SUPABASE_URL,`https://${ref}.supabase.co`);
async function query(query){const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query})});if(!r.ok)throw Error(`${r.status} ${await r.text()}`);return r.json();}
const version='20261121000200';
const history=await query(`select version from supabase_migrations.schema_migrations where version='${version}'`);
const migration=await readFile(`supabase/migrations/${version}_owner_guest_cv_stats.sql`,'utf8');
if(process.argv.includes('--apply')&&!history.length){
 const literal=s=>`'${s.replaceAll("'","''")}'`;
 await query(migration.replace(/commit;\s*$/i,()=>`insert into supabase_migrations.schema_migrations(version,name,statements) values ('${version}','owner_guest_cv_stats',array[${literal(migration)}]); commit;`));
}
const report={version,counts:await query(`select count(*) total, count(*) filter(where created_at >= date_trunc('day',now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh') today from public.talent_guest_submissions`),installed:await query(`select proname from pg_proc where pronamespace='public'::regnamespace and proname='get_owner_guest_cv_stats'`)};
await writeFile('owner-cv-counter-report.json',JSON.stringify(report,null,2));console.log(report);
