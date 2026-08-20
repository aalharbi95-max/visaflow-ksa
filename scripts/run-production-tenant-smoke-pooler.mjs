import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

const fixturePath = process.argv[2] || "";
const token = process.env.SUPABASE_ACCESS_TOKEN || "";
const password = process.env.SUPABASE_DB_PASSWORD || "";
const projectRef = process.env.SUPABASE_PROJECT_REF || "";
const runnerTemp = process.env.RUNNER_TEMP || ".";
assert.ok(fixturePath, "Prepared tenant smoke path is required");
assert.ok(token, "SUPABASE_ACCESS_TOKEN is required");
assert.ok(password, "SUPABASE_DB_PASSWORD is required");
assert.equal(projectRef, "zeocbftriydodzfgixjv", "Production project mismatch");
assert.equal(process.env.PRODUCTION_TENANT_DML_SMOKE, "ROLLBACK_ONLY_EXPLICITLY_APPROVED");

const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const api = async (path) => {
  const response = await fetch(`https://api.supabase.com/v1${path}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok, `Supabase Management API failed with HTTP ${response.status}`);
  return response.json();
};
const [metadata, poolers] = await Promise.all([
  api(`/projects/${projectRef}`),
  api(`/projects/${projectRef}/config/database/pooler`),
]);
assert.equal(metadata.id || metadata.ref, projectRef, "Supabase returned a different Production project");
assert.ok(Array.isArray(poolers) && poolers.length > 0, "Supabase returned no pooler configuration");
const primary = poolers.find((item) => String(item.database_type || "").toUpperCase() === "PRIMARY") || poolers[0];
const connectionString = String(primary.connection_string || primary.connectionString || "");
const parsed = connectionString.match(/^postgres(?:ql)?:\/\/([^:@/]+)(?::[^@]*)?@([^:/?#]+)(?::\d+)?\/([^?]+)/i);
const host = String(primary.db_host || parsed?.[2] || "");
const user = String(parsed?.[1] || primary.db_user || "");
const database = String(primary.db_name || parsed?.[3] || "postgres");
assert.match(host, /^[a-z0-9.-]+\.pooler\.supabase\.com$/i, "Authoritative Session Pooler host is invalid");
assert.equal(user, `postgres.${projectRef}`, "Authoritative Session Pooler user mismatch");

let sqlSequence = 0;
async function runSql(sql, { capture = false, safeRetry = false } = {}) {
  sqlSequence += 1;
  const sqlPath = join(runnerTemp, `production-tenant-smoke-${sqlSequence}.sql`);
  await writeFile(sqlPath, sql, { encoding: "utf8", mode: 0o600 });
  try {
    for (let attempt = 1; attempt <= (safeRetry ? 3 : 1); attempt += 1) {
      const result = spawnSync("psql", [
        "--no-psqlrc", "--set=ON_ERROR_STOP=1",
        "--host", host, "--port", "5432",
        "--username", user, "--dbname", database,
        "--quiet", "--tuples-only", "--no-align", "--field-separator", "|",
        "--file", sqlPath,
      ], {
        encoding: "utf8",
        shell: false,
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, PGPASSWORD: password, PGSSLMODE: "require", PGCONNECT_TIMEOUT: "60" },
      });
      if (result.error) throw result.error;
      if (result.status === 0) return capture ? String(result.stdout || "").trim() : "";
      const diagnostic = `${String(result.stderr || "")}\n${String(result.stdout || "")}`;
      const checkoutFailure = /ECHECKOUTTIMEOUT|authentication did not complete within/i.test(diagnostic);
      if (safeRetry && checkoutFailure && attempt < 3) {
        console.error(`Session Pooler checkout unavailable; retrying safe read-only acquisition (${attempt}/3).`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5_000);
        continue;
      }
      if (result.stderr) process.stderr.write(String(result.stderr));
      throw new Error(`Production tenant smoke SQL failed with exit code ${result.status}`);
    }
  } finally {
    await unlink(sqlPath).catch(() => {});
  }
  throw new Error("Production tenant smoke SQL did not complete");
}

const triggerPrecheckSql = `
begin;
set transaction read only;
set local statement_timeout = '60s';
do $trigger_safety$
declare trigger_row record;
begin
  for trigger_row in
    select n.nspname as table_schema,c.relname as table_name,t.tgname as trigger_name,
      l.lanname as language,pg_get_triggerdef(t.oid,true) as trigger_definition,
      pg_get_functiondef(p.oid) as function_definition
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    join pg_proc p on p.oid=t.tgfoid
    join pg_language l on l.oid=p.prolang
    where not t.tgisinternal
      and ((n.nspname='public' and c.relname=any(array['companies','agencies','users','company_email_settings','agency_penalties']))
        or (n.nspname='auth' and c.relname='users'))
  loop
    if lower(trigger_row.language) not in ('sql','plpgsql')
      or concat(trigger_row.trigger_definition,E'\\n',trigger_row.function_definition)
        ~* '(pg_notify|dblink|lo_export|supabase_functions|pg_net|net\\.http|http_(get|post|put|delete)|aws_lambda|webhook|nextval|insert[[:space:]]+into)'
    then
      raise exception 'UNSAFE_NONTRANSACTIONAL_OR_SEQUENCE_TRIGGER:% %.%',
        trigger_row.trigger_name,trigger_row.table_schema,trigger_row.table_name;
    end if;
  end loop;
end $trigger_safety$;
rollback;
`;
await runSql(triggerPrecheckSql, { safeRetry: true });

const fixtureIds = {
  companies: ["82000000-0000-4000-8000-000000000001", "82000000-0000-4000-8000-000000000002"],
  agencies: ["82000000-0000-4000-8000-000000000021", "82000000-0000-4000-8000-000000000022"],
  authUsers: [
    "82000000-0000-4000-8000-000000000011", "82000000-0000-4000-8000-000000000012",
    "82000000-0000-4000-8000-000000000031", "82000000-0000-4000-8000-000000000032",
  ],
  companySettings: [
    "82000000-0000-4000-8000-000000000041", "82000000-0000-4000-8000-000000000042",
    "82000000-0000-4000-8000-000000000043",
  ],
  agencyPenalties: [
    "82000000-0000-4000-8000-000000000051", "82000000-0000-4000-8000-000000000052",
    "82000000-0000-4000-8000-000000000053",
  ],
};
const uuidList = (items) => items.map((id) => `'${id}'::uuid`).join(",");
const stateSql = `
begin;
set transaction read only;
set local statement_timeout = '60s';
select 'count_companies',count(*)::bigint::text from public.companies
union all select 'count_agencies',count(*)::bigint::text from public.agencies
union all select 'count_users',count(*)::bigint::text from public.users
union all select 'count_company_email_settings',count(*)::bigint::text from public.company_email_settings
union all select 'count_agency_penalties',count(*)::bigint::text from public.agency_penalties
union all select 'count_auth_users',count(*)::bigint::text from auth.users
union all select 'fixture_companies',count(*)::bigint::text from public.companies where id in (${uuidList(fixtureIds.companies)})
union all select 'fixture_agencies',count(*)::bigint::text from public.agencies where id in (${uuidList(fixtureIds.agencies)})
union all select 'fixture_public_users',count(*)::bigint::text from public.users where auth_user_id in (${uuidList(fixtureIds.authUsers)})
union all select 'fixture_auth_users',count(*)::bigint::text from auth.users where id in (${uuidList(fixtureIds.authUsers)})
union all select 'fixture_company_settings',count(*)::bigint::text from public.company_email_settings where id in (${uuidList(fixtureIds.companySettings)})
union all select 'fixture_agency_penalties',count(*)::bigint::text from public.agency_penalties where id in (${uuidList(fixtureIds.agencyPenalties)});
rollback;
`;
function parseState(output) {
  return Object.fromEntries(output.split(/\r?\n/).filter((line) => line.includes("|")).map((line) => line.split("|")));
}
const before = parseState(await runSql(stateSql, { capture: true, safeRetry: true }));
for (const [key, value] of Object.entries(before)) {
  if (key.startsWith("fixture_")) assert.equal(value, "0", `Predetermined fixture already exists: ${key}`);
}

const preparedSource = await readFile(fixturePath, "utf8");
const startMarker = "await query(`\n  begin;";
const endMarker = "  rollback;`);";
const start = preparedSource.indexOf(startMarker);
const sqlStart = preparedSource.indexOf("  begin;", start);
const end = preparedSource.indexOf(endMarker, sqlStart);
assert.ok(start >= 0 && sqlStart > start && end > sqlStart, "Prepared canonical rollback SQL was not found");
const rollbackSql = preparedSource.slice(sqlStart, end + "  rollback;".length);
await runSql(rollbackSql, { safeRetry: false });

const after = parseState(await runSql(stateSql, { capture: true, safeRetry: true }));
assert.deepEqual(after, before, "Rollback verification failed: fixture presence or row counts changed");
for (const [key, value] of Object.entries(after)) {
  if (key.startsWith("fixture_")) assert.equal(value, "0", `Rollback verification failed: ${key}`);
}
console.log("Production tenant-isolation PASS: Company A/B and Agency A/B SELECT/INSERT/UPDATE isolation.");
console.log("Rollback verification PASS: all predetermined UUIDs absent and public/auth row counts restored.");
