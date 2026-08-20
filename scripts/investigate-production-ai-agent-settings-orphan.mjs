import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const token = process.env.SUPABASE_ACCESS_TOKEN || "";
const projectRef = process.env.SUPABASE_PROJECT_REF || "";
const expectedRef = "zeocbftriydodzfgixjv";
assert.ok(token, "SUPABASE_ACCESS_TOKEN is required");
assert.equal(projectRef, expectedRef, "Production project identity mismatch");
assert.notEqual(projectRef, "iijhdilfzndqlguefipn", "Refusing to inspect Staging");

async function management(path) {
  const response = await fetch(`https://api.supabase.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error(`Management API failed with HTTP ${response.status}`);
  return response.json();
}

async function query(sql) {
  const retryable = new Set([408, 429, 500, 502, 503, 504, 522, 524, 544]);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, read_only: true }),
    });
    if (response.ok) return response.json();
    let detail = {};
    try { detail = await response.json(); } catch { detail = {}; }
    const code = String(detail.code || detail.error_code || "unknown").slice(0, 80);
    if (!retryable.has(response.status) || attempt === 3) {
      throw new Error(`Read-only Production query failed with HTTP ${response.status} (${code}) after ${attempt} attempt(s)`);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
  }
  throw new Error("Read-only Production query returned no result");
}

function identifier(value) {
  assert.match(value, /^[a-z_][a-z0-9_]*$/);
  return `"${value}"`;
}

const metadata = await management(`/projects/${projectRef}`);
assert.equal(metadata.id || metadata.ref, expectedRef, "Supabase returned a different Production project");

const orphanRows = await query(`
  select settings.id::text as row_id,
         settings.company_id::text as orphan_company_id,
         settings.created_at::text as created_at,
         settings.updated_at::text as updated_at,
         settings.is_active::text as is_active
  from public.ai_agent_settings settings
  left join public.companies company on company.id = settings.company_id
  where settings.company_id is not null and company.id is null
  order by settings.id`);
assert.equal(orphanRows.length, 1, "Expected exactly one ai_agent_settings orphan");
const orphan = orphanRows[0];
assert.match(orphan.orphan_company_id, /^[0-9a-f-]{36}$/i, "Orphan company id is not a UUID");
const companyId = orphan.orphan_company_id;

const directCounts = (await query(`
  select
    (select count(*)::integer from public.platform_clients where operational_company_id = '${companyId}'::uuid) as platform_clients,
    (select count(*)::integer from public.users where company_id = '${companyId}'::uuid) as users,
    (select count(*)::integer from public.companies where id = '${companyId}'::uuid) as companies`))[0];
assert.equal(directCounts.companies, 0, "Orphan company unexpectedly exists");

const companyColumns = await query(`
  select columns.table_name,columns.data_type,columns.udt_name
  from information_schema.columns columns
  join information_schema.tables tables
    on tables.table_schema=columns.table_schema and tables.table_name=columns.table_name
  where columns.table_schema='public'
    and columns.column_name='company_id'
    and tables.table_type='BASE TABLE'
  order by columns.table_name`);
const companyTables = companyColumns.map((row) => String(row.table_name));
companyTables.forEach(identifier);
const referenceSql = companyColumns.map((row) => {
  const table = String(row.table_name);
  if (row.udt_name === "uuid") {
    return `select '${table}'::text as table_name,count(*)::integer as match_count from public.${identifier(table)} where company_id='${companyId}'::uuid`;
  }
  if (["text", "character varying", "character"].includes(String(row.data_type))) {
    return `select '${table}'::text as table_name,count(*)::integer as match_count from public.${identifier(table)} where company_id='${companyId}'`;
  }
  return `select '${table}'::text as table_name,0::integer as match_count`;
}).join(" union all ");
const references = referenceSql ? await query(referenceSql) : [];
const positiveReferences = references.filter((row) => Number(row.match_count) > 0);
const aiAgentReferences = positiveReferences.filter((row) =>
  row.table_name.startsWith("ai_agent_") && row.table_name !== "ai_agent_settings");
const operationalReferences = positiveReferences.filter((row) =>
  !row.table_name.startsWith("ai_agent_") && row.table_name !== "users");

const searchableLogColumns = await query(`
  select columns.table_name,columns.column_name
  from information_schema.columns columns
  join information_schema.tables tables
    on tables.table_schema=columns.table_schema and tables.table_name=columns.table_name
  where columns.table_schema='public'
    and tables.table_type='BASE TABLE'
    and columns.table_name ~* '(audit|activity|event|history|log)'
    and columns.column_name ~* '((company|tenant).*id|id.*(company|tenant))'
    and columns.data_type in ('text','character varying','uuid')
  order by columns.table_name,columns.ordinal_position`);
for (const row of searchableLogColumns) {
  identifier(String(row.table_name));
  identifier(String(row.column_name));
}
const logMatches = [];
for (let offset = 0; offset < searchableLogColumns.length; offset += 20) {
  const batch = searchableLogColumns.slice(offset, offset + 20);
  const sql = batch.map(({ table_name: table, column_name: column }) =>
    `select '${table}'::text as table_name,'${column}'::text as column_name,count(*)::integer as match_count from public.${identifier(table)} where position('${companyId}' in coalesce(${identifier(column)}::text,'')) > 0`).join(" union all ");
  logMatches.push(...(await query(sql)).filter((row) => Number(row.match_count) > 0));
}

const result = {
  orphan: {
    row_id: orphan.row_id,
    orphan_company_id: companyId,
    created_at: orphan.created_at,
    updated_at: orphan.updated_at,
    is_active: orphan.is_active,
  },
  direct_references: {
    platform_clients_operational_company_id: Number(directCounts.platform_clients),
    users_company_id: Number(directCounts.users),
  },
  other_ai_agent_company_references: aiAgentReferences.map((row) => ({
    table: row.table_name,
    count: Number(row.match_count),
  })),
  operational_company_references: operationalReferences.map((row) => ({
    table: row.table_name,
    count: Number(row.match_count),
  })),
  system_activity_log_uuid_evidence: logMatches.map((row) => ({
    table: row.table_name,
    column: row.column_name,
    count: Number(row.match_count),
  })),
};

const output = process.env.ORPHAN_AUDIT_OUTPUT || "";
assert.ok(output, "ORPHAN_AUDIT_OUTPUT is required");
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log("Read-only orphan investigation completed; plaintext evidence retained only in runner temporary storage.");
