import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const project = 'zeocbftriydodzfgixjv';
const token = process.env.SUPABASE_ACCESS_TOKEN;
assert.ok(token || process.env.SUPABASE_DB_PASSWORD, 'Deployment credential is required');
async function query(query) {
  if (process.env.SUPABASE_DB_PASSWORD) {
    const isSelect = /^\s*select\b/i.test(query);
    const sql = isSelect ? `select coalesce(json_agg(q),'[]'::json) from (${query}) q` : query;
    const result = spawnSync('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
      input: sql, encoding: 'utf8', env: { ...process.env,
        PGHOST: 'aws-1-eu-central-1.pooler.supabase.com', PGPORT: '5432',
        PGUSER: `postgres.${project}`, PGDATABASE: 'postgres',
        PGPASSWORD: process.env.SUPABASE_DB_PASSWORD, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '20',
      },
    });
    if (result.error || result.status !== 0) throw Error(`Database connection/query failed: ${result.error?.message || result.stderr}`);
    return isSelect ? JSON.parse(result.stdout.trim()) : [];
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw Error(`Database query failed (${res.status}): ${(await res.text()).slice(0,500)}`);
  return res.json();
}
const version = '20261118000100';
const applied = await query(`select version from supabase_migrations.schema_migrations where version='${version}'`);
if (!applied.length) {
  const before = await query(`select count(*)::int as total from public.professions`);
  console.log('Profession count before:', before[0].total);
  let migration = await readFile(new URL(`../supabase/migrations/${version}_tenant_profession_management.sql`, import.meta.url), 'utf8');
  migration = migration.replace(/commit;\s*$/i, `insert into supabase_migrations.schema_migrations(version, name, statements) values ('${version}', 'tenant_profession_management', ARRAY[]::text[]); commit;`);
  await query(migration);
  const after = await query(`select count(*)::int as total from public.professions`);
  assert.equal(after[0].total, before[0].total, 'Migration must preserve catalogue rows');
} else console.log('Migration already applied; verifying.');
const policies = await query(`select tablename, policyname, cmd from pg_policies where schemaname='public' and tablename in ('professions','profession_aliases') order by tablename,policyname`);
assert.equal(policies.length, 6);
const isolation = await query(`select count(*)::int as total from pg_trigger where tgname in ('professions_preserve_scope','profession_aliases_preserve_scope') and not tgisinternal`);
assert.equal(isolation[0].total, 2);
console.log('Verified tenant profession migration, six RLS policies, both immutable scope triggers, preserved rows.');
console.log(JSON.stringify(policies));
