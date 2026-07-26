import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const migrationsDirectory = join(root, "supabase", "migrations");
const migrationNames = readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql")).sort();
const migrationText = migrationNames.map((name) => read(`supabase/migrations/${name}`)).join("\n");

const expectedOrder = [
  "20260717000000_visaflow_schema_baseline.sql",
  "20260717000040_visaflow_tenant_rls_policies.sql",
  "20260717000050_visaflow_storage_buckets.sql",
  "20260717000060_visaflow_storage_policies.sql",
  "20260717000070_visaflow_application_security_contracts.sql",
  "20260717000080_visaflow_private_interview_storage.sql",
  "20260717000090_visaflow_guarded_product_contracts.sql",
  "20260718000100_owner_talent_dashboard.sql",
  "20260719000100_add_secure_public_users_rpcs.sql",
  "20260719000200_revoke_public_users_browser_access.sql",
  "20260719000300_add_secure_log_policies.sql",
  "20260719000400_enforce_secure_log_access.sql",
  "20260722000100_visaflow_security_finalization.sql",
];
assert.deepEqual(migrationNames, expectedOrder, "migration chain changed or is out of order");
assert.doesNotMatch(migrationText, /\b(?:insert|update|delete)\s+(?:into\s+|from\s+)?supabase_migrations\b/i);

const baseline = read("supabase/migrations/20260717000000_visaflow_schema_baseline.sql");
assert.doesNotMatch(baseline, /^(?:COPY|INSERT INTO)\b/im, "baseline must remain schema-only");
assert.doesNotMatch(baseline, /(?:postgres(?:ql)?:\/\/|sb_secret_|eyJ[A-Za-z0-9_-]{40,}|zeocbftriydodzfgixjv|iijhdilfzndqlguefipn)/i);

const tenantTables = [
  "agency_agreements", "agency_client_access", "agency_company_user_access", "agency_penalties", "agency_scores",
  "ai_interview_answers", "ai_interview_questions", "ai_interview_sessions", "candidate_technical_profiles", "candidates",
  "collections", "company_agency_access", "company_agency_users", "company_email_settings", "demobilizations", "employees",
  "interviews", "invoice_items", "invoices", "local_content_project_targets", "marketplace_deal_workers", "marketplace_deals",
  "marketplace_requests", "mobilizations", "onboarding_validations", "request_lines", "requests", "visa_allocations",
  "visa_authorizations", "visa_batch_lines", "visa_batches",
];
for (const table of tenantTables) {
  const match = baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\(([\\s\\S]*?)\\n\\);`, "i"));
  assert.ok(match, `baseline is missing public.${table}`);
  assert.match(match[1], /^\s*company_id\s/im, `public.${table} is missing company_id required by tenant RLS`);
}
assert.match(baseline, /CREATE TABLE public\.agency_members\s*\(/i);

const rls = read("supabase/migrations/20260717000040_visaflow_tenant_rls_policies.sql");
for (const table of tenantTables) assert.match(rls, new RegExp(`'${table}'`), `RLS map is missing ${table}`);

const buckets = read("supabase/migrations/20260717000050_visaflow_storage_buckets.sql");
const storagePolicies = read("supabase/migrations/20260717000060_visaflow_storage_policies.sql");
const contracts = read("supabase/migrations/20260717000070_visaflow_application_security_contracts.sql");
const privateStorage = read("supabase/migrations/20260717000080_visaflow_private_interview_storage.sql");
const guarded = read("supabase/migrations/20260717000090_visaflow_guarded_product_contracts.sql");
assert.match(buckets, /'ai-interview-audio'[\s\S]*104857600[\s\S]*'video\/mp4'/);
assert.match(storagePolicies, /VisaFlow AI audio temporary insert/);
assert.match(privateStorage, /drop policy if exists "VisaFlow AI audio temporary insert"/);
assert.match(contracts, /alter table public\.candidates add column if not exists agency_id uuid/);
assert.match(contracts, /auth\.jwt\(\)\s*->>\s*'is_anonymous'/);
assert.match(guarded, /agency_id is not null and public\.visaflow_agency_can/);

for (const path of [
  "supabase/migrations/20260717000040_visaflow_tenant_rls_policies.sql",
  "supabase/migrations/20260717000070_visaflow_application_security_contracts.sql",
  "supabase/migrations/20260717000090_visaflow_guarded_product_contracts.sql",
  "supabase/migrations/20260718000100_owner_talent_dashboard.sql",
  "supabase/migrations/20260719000100_add_secure_public_users_rpcs.sql",
  "supabase/migrations/20260719000300_add_secure_log_policies.sql",
]) {
  const sql = read(path);
  const headers = sql.match(/create\s+(?:or\s+replace\s+)?function[\s\S]*?(?=\bas\s+\$)/gi) || [];
  for (const header of headers) {
    if (/security\s+definer/i.test(header)) {
      assert.match(header, /set\s+search_path\s*(?:=|to)\s*''/i, `${path} has SECURITY DEFINER without an empty search_path`);
    }
  }
}

const createdFunctions = new Set(
  [...migrationText.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([a-z_][\w]*\.[a-z_][\w]*)\s*\(/gi)]
    .map((match) => match[1].toLowerCase()),
);
for (const match of migrationText.matchAll(/(?:grant|revoke)[^;]*?\bon\s+function\s+([a-z_][\w]*\.[a-z_][\w]*)\s*\(/gi)) {
  assert.ok(createdFunctions.has(match[1].toLowerCase()), `GRANT/REVOKE references missing ${match[1]}`);
}

const createdTables = new Set(
  [...migrationText.matchAll(/create\s+table(?:\s+if\s+not\s+exists)?\s+([a-z_][\w]*\.[a-z_][\w]*)\s*\(/gi)]
    .map((match) => match[1].toLowerCase()),
);

const testDirectory = join(root, "supabase", "tests");
let planned = 0;
let assertions = 0;
for (const name of readdirSync(testDirectory).filter((item) => item.endsWith(".sql"))) {
  const sql = read(`supabase/tests/${name}`);
  const plan = Number(sql.match(/select\s+plan\((\d+)\)/i)?.[1] || 0);
  const count = [...sql.matchAll(/^\s*select\s+(?:ok|is|isnt|like|unlike|throws_ok|lives_ok)\s*\(/gim)].length;
  assert.equal(count, plan, `${name} plan(${plan}) does not match ${count} assertions`);
  assert.match(sql, /select\s+\*\s+from\s+finish\(\)/i, `${name} is missing finish()`);
  planned += plan;
  assertions += count;
}
assert.equal(planned, 79, "the isolated database package must contain exactly 79 planned assertions");
assert.equal(assertions, 79, "the isolated database package must contain exactly 79 pgTAP assertions");

const edgeRoot = join(root, "supabase", "functions");
const collectTypeScript = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? collectTypeScript(path) : entry.name.endsWith(".ts") ? [path] : [];
});
const edgeTypeScriptFiles = collectTypeScript(edgeRoot);
for (const path of edgeTypeScriptFiles) {
  execFileSync(process.execPath, ["--experimental-strip-types", "--check", path], { stdio: "pipe" });
}
const reviewedEdges = [
  "ai-interview-invitation-worker", "create-ai-realtime-session", "interview-media-finalize",
  "interview-media-sign-read", "interview-media-sign-upload", "interview-portal-exchange", "interview-portal-state",
  "interview-portal-transition", "interview-review-media-sign-read", "legacy-account-upgrade",
  "manage-company-email-settings", "visaflow-ai-agent-action", "visaflow-ai-commander", "visaflow-email-dispatcher",
];
for (const name of reviewedEdges) {
  const path = join(edgeRoot, name, "index.ts");
  assert.ok(existsSync(path), `missing Edge Function ${name}`);
  const source = readFileSync(path, "utf8");
  assert.match(source, /req\.method\s*===\s*["']OPTIONS["']/, `${name} has no OPTIONS handling`);
  assert.match(source, /req\.method\s*!==\s*["']POST["']/, `${name} has no POST-only guard`);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)\([^\n]*(?:token|secret|signed|password|authorization)/i, `${name} may log sensitive material`);
  for (const localImport of source.matchAll(/from\s+["'](\.\.[^"']+)["']/g)) {
    assert.ok(existsSync(resolve(dirname(path), localImport[1])), `${name} has unresolved import ${localImport[1]}`);
  }
}

const sharedEdge = read("supabase/functions/_shared/visaflow-security.ts");
assert.match(sharedEdge, /Access-Control-Allow-Headers[^\n]*x-interview-capability/);
assert.match(sharedEdge, /data\.user\.is_anonymous\s*!==\s*true/);

const client = read("src/supabase.js");
assert.equal((client.match(/createClient\(/g) || []).length, 3, "browser must have exactly three audience clients");
assert.match(client, /WORKSPACE_AUTH_STORAGE_KEY[\s\S]*window\.localStorage/);
assert.match(client, /TALENT_AUTH_STORAGE_KEY[\s\S]*window\.localStorage/);
assert.match(client, /INTERVIEW_AUTH_STORAGE_KEY[\s\S]*window\.sessionStorage/);
assert.match(client, /VITE_SUPABASE_EXPECTED_PROJECT_REF/);
assert.match(client, /activeProjectRef\s*!==\s*expectedProjectRef/);

const app = read("src/App.jsx");
assert.doesNotMatch(app, /\.from\(["']companies["']\)/, "App must not read companies directly");
const portal = app.slice(app.indexOf("function AIInterviewCandidatePortal"), app.indexOf("function TalentField"));
assert.doesNotMatch(portal, /\.from\(["']ai_interview_/);
assert.doesNotMatch(portal, /\.storage\b/);

const applicationSources = [app, ...reviewedEdges.map((name) => read(`supabase/functions/${name}/index.ts`))].join("\n");
const storageBuckets = new Set(["ai-interview-audio", "talent-cv", "talent-resume-versions"]);
for (const match of applicationSources.matchAll(/\.from\(["']([^"']+)["']\)/g)) {
  const table = match[1].toLowerCase();
  if (!storageBuckets.has(table)) assert.ok(createdTables.has(`public.${table}`), `application references missing public.${table}`);
}
for (const match of applicationSources.matchAll(/\.rpc\(["']([^"']+)["']/g)) {
  assert.ok(createdFunctions.has(`public.${match[1].toLowerCase()}`), `application references missing RPC public.${match[1]}`);
}
const externallyManagedEdges = new Set([
  "visaflow-talent-cv-analyzer",
  "visaflow-talent-resume-studio",
  "visaflowbackupworker",
  "visaflowrestoreworker",
]);
const missingExternalEdges = new Set();
for (const match of app.matchAll(/functions\.invoke\(["']([^"']+)["']/g)) {
  if (!existsSync(join(edgeRoot, match[1], "index.ts"))) {
    assert.ok(externallyManagedEdges.has(match[1]), `App references undocumented missing Edge Function ${match[1]}`);
    missingExternalEdges.add(match[1]);
  }
}
assert.deepEqual(missingExternalEdges, externallyManagedEdges, "externally managed Edge inventory changed");

const preflight = read("supabase/preflight/20260717000070_visaflow_application_security_preflight.sql");
assert.doesNotMatch(preflight, /\b(?:c|i)\.agency_id\b/, "preflight must run before agency_id exists");

console.log(JSON.stringify({
  ok: true,
  migrations: migrationNames.length,
  tenant_tables: tenantTables.length + 1,
  edge_functions: reviewedEdges.length,
  edge_typescript_syntax: edgeTypeScriptFiles.length,
  externally_managed_edge_functions_without_source: missingExternalEdges.size,
  pgtap_planned: planned,
  pgtap_assertions: assertions,
}, null, 2));
