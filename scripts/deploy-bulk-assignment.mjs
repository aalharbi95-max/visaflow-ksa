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
const version='20261122000100';
const name='bulk_assignment_open_requirements';
const signature='public.bulk_assign_candidates_v1(uuid[],uuid)';
const before=query(`select prosecdef, proacl::text as acl from pg_proc where oid='${signature}'::regprocedure`);
assert.equal(before.length,1);
assert.equal(before[0].prosecdef,true);
if(!query(`select version from supabase_migrations.schema_migrations where version='${version}'`).length) {
  let sql=await readFile(new URL(`../supabase/migrations/${version}_${name}.sql`,import.meta.url),'utf8');
  assert.match(sql,/commit;\s*$/i);
  sql=sql.replace(/commit;\s*$/i,`insert into supabase_migrations.schema_migrations(version,name,statements) values ('${version}','${name}',ARRAY[]::text[]);commit;`);
  query(sql);
}
const [installed]=query(`select prosecdef, proacl::text as acl, prosrc from pg_proc where oid='${signature}'::regprocedure`);
assert.deepEqual({prosecdef:installed.prosecdef,acl:installed.acl},before[0]);
assert.match(installed.prosrc,/target\.nationality.{0,40}not in/i);
assert.match(installed.prosrc,/target\.gender.{0,40}not in/i);
console.log('Verified: production assignment migration applied and RPC grants preserved.');