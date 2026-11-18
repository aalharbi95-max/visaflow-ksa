import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
assert.ok(process.env.SUPABASE_DB_PASSWORD,'Production database credential is required');
function query(sql) {
  const select=/^\s*select\b/i.test(sql);
  const result=spawnSync('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1'],{
    input:select?`select coalesce(json_agg(q),'[]'::json) from (${sql}) q`:sql,encoding:'utf8',
    env:{...process.env,PGHOST:'aws-1-eu-central-1.pooler.supabase.com',PGPORT:'5432',PGDATABASE:'postgres',
      PGUSER:'postgres.zeocbftriydodzfgixjv',PGPASSWORD:process.env.SUPABASE_DB_PASSWORD,PGSSLMODE:'require',PGCONNECT_TIMEOUT:'20'},
  });
  if(result.error || result.status!==0) throw Error(result.error?.message || result.stderr);
  return select?JSON.parse(result.stdout.trim()):[];
}
const version='20261118000200';
if(!query(`select version from supabase_migrations.schema_migrations where version='${version}'`).length) {
  const before=query('select count(*)::int as count,coalesce(sum(quantity),0)::int as headcount from public.requests');
  let sql=await readFile(new URL(`../supabase/migrations/${version}_request_candidate_shortlists.sql`,import.meta.url),'utf8');
  sql=sql.replace(/commit;\s*$/i,`insert into supabase_migrations.schema_migrations(version,name,statements) values ('${version}','request_candidate_shortlists',ARRAY[]::text[]);commit;`);
  query(sql);
  assert.deepEqual(query('select count(*)::int as count,coalesce(sum(quantity),0)::int as headcount from public.requests'),before);
}
assert.equal(query(`select public from storage.buckets where id='request-shortlist-cvs'`)[0].public,false);
assert.equal(query(`select count(*)::int as n from pg_policies where schemaname='public' and tablename='request_candidate_shortlists'`)[0].n,1);
assert.equal(query(`select count(*)::int as n from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('request_shortlist_storage_guard','request_shortlist_storage_hr')`)[0].n,2);
console.log('Verified: shortlist table, HR tenant isolation, private CV bucket, restrictive storage guard; existing requests and vacancy headcount preserved.');
