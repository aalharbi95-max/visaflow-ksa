import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("./App.jsx", import.meta.url);
const migrationUrl = new URL("../supabase/migrations/20260717000070_visaflow_application_security_contracts.sql", import.meta.url);
const guardedMigrationUrl = new URL("../supabase/migrations/20260717000090_visaflow_guarded_product_contracts.sql", import.meta.url);
const smtpFunctionUrl = new URL("../supabase/functions/manage-company-email-settings/index.ts", import.meta.url);
const legacyUpgradeUrl = new URL("../supabase/functions/legacy-account-upgrade/index.ts", import.meta.url);
const portalBehaviorTestUrl = new URL("../supabase/tests/visaflow_interview_portal_behavior_test.sql", import.meta.url);
const commanderFunctionUrl = new URL("../supabase/functions/visaflow-ai-commander/index.ts", import.meta.url);
const aiAgentFunctionUrl = new URL("../supabase/functions/visaflow-ai-agent-action/index.ts", import.meta.url);
const invitationWorkerUrl = new URL("../supabase/functions/ai-interview-invitation-worker/index.ts", import.meta.url);
const finalizationMigrationUrl = new URL("../supabase/migrations/20260722000100_visaflow_security_finalization.sql", import.meta.url);
const sharedEdgeSecurityUrl = new URL("../supabase/functions/_shared/visaflow-security.ts", import.meta.url);
const mediaFinalizeUrl = new URL("../supabase/functions/interview-media-finalize/index.ts", import.meta.url);
const storageBucketsUrl = new URL("../supabase/migrations/20260717000050_visaflow_storage_buckets.sql", import.meta.url);

test("public interview portal has no direct table or Storage access", async () => {
  const source = await readFile(appUrl, "utf8");
  const portalStart = source.indexOf("function AIInterviewCandidatePortal");
  const portalEnd = source.indexOf("function TalentField", portalStart);
  assert.notEqual(portalStart, -1, "candidate portal component must exist");
  assert.notEqual(portalEnd, -1, "candidate portal boundary must exist");
  const portal = source.slice(portalStart, portalEnd);
  assert.doesNotMatch(portal, /\.from\("ai_interview_(?:sessions|answers|templates|questions)"\)/);
  assert.doesNotMatch(portal, /\.storage\b/);
  assert.doesNotMatch(portal, /X-AI-Interview-Token|\?ai_interview=/);
  assert.match(portal, /exchangeInterviewInvitation/);
  assert.match(portal, /uploadInterviewMedia/);
  assert.match(portal, /X-Interview-Capability/);
  assert.match(portal, /if \(accessToken\)[\s\S]*signOut\(\{ scope: "local" \}\)[\s\S]*exchangeInterviewInvitation/);
});

test("workspace login has no application-only legacy session or raw company read", async () => {
  const source = await readFile(appUrl, "utf8");
  const login = source.slice(source.indexOf("async function handleLogin"), source.indexOf("async function handleLogout"));
  assert.doesNotMatch(login, /legacy_app_login/);
  assert.match(login, /legacy-account-upgrade/);
  assert.match(login, /get_authenticated_workspace_context/);
  assert.doesNotMatch(login, /\.from\("companies"\)/);
  assert.doesNotMatch(source, /\.from\("companies"\)/);
});

test("browser SMTP path cannot send or select smtp_password", async () => {
  const source = await readFile(appUrl, "utf8");
  const save = source.slice(source.indexOf("async function saveCompanyEmailSettings"), source.indexOf("async function testCompanyEmailSettings"));
  const testPath = source.slice(source.indexOf("async function testCompanyEmailSettings"), source.indexOf("async function saveCompany()"));
  assert.match(save, /manage-company-email-settings/);
  assert.doesNotMatch(save, /\.select\(|company_email_settings/);
  assert.doesNotMatch(save, /payload\.smtp_password/);
  assert.doesNotMatch(testPath, /\.from\(["']company_email_settings["']\)/);
});

test("company SMTP Edge contract is platform-only and never returns a password", async () => {
  const source = await readFile(smtpFunctionUrl, "utf8");
  assert.match(source, /body\.smtp_password/);
  assert.match(source, /temporarily disabled/);
  const responseSource = source.slice(source.indexOf("const safe ="));
  assert.doesNotMatch(responseSource, /smtp_password\s*:/);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)/);
});

test("security migration uses hashed one-time invitations and isolated capabilities", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /gen_random_bytes\(32\)/);
  assert.match(sql, /digest\(v_secret, 'sha256'\)/);
  assert.match(sql, /ai_interview_one_active_invitation/);
  assert.match(sql, /portal_auth_user_id = auth\.uid\(\)/);
  assert.match(sql, /auth\.jwt\(\)\s*->>\s*'is_anonymous'/);
  assert.match(sql, /where consumed_at is null and revoked_at is null/);
  assert.match(sql, /revoke all on table public\.ai_interview_portal_invitations from public, anon, authenticated/);
});

test("interview Edge CORS and media finalization enforce the declared contract", async () => {
  const [shared, finalize, buckets] = await Promise.all([
    readFile(sharedEdgeSecurityUrl, "utf8"),
    readFile(mediaFinalizeUrl, "utf8"),
    readFile(storageBucketsUrl, "utf8"),
  ]);
  assert.match(shared, /Access-Control-Allow-Headers[^\n]*x-interview-capability/);
  assert.match(finalize, /storedMime\s*!==\s*expectedMime/);
  assert.doesNotMatch(finalize, /return json\([^\n]*object_path/);
  assert.match(buckets, /'ai-interview-audio'[\s\S]*104857600/);
  assert.match(buckets, /'video\/mp4'/);
});

test("agency migration is additive and performs no production backfill", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /alter table public\.candidates add column if not exists agency_id uuid/);
  assert.match(sql, /alter table public\.interviews add column if not exists agency_id uuid/);
  assert.match(sql, /candidates_company_agency_idx/);
  assert.match(sql, /interviews_company_agency_candidate_idx/);
  assert.doesNotMatch(sql, /update public\.(?:candidates|interviews)\s+set agency_id/i);
});

test("worker locks and legacy password RPC are not executable by browsers", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /revoke all on function public\.legacy_app_login\(text, text\) from public, anon, authenticated/);
  assert.match(sql, /revoke all on function public\.ai_agent_try_acquire_lock[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.ai_agent_try_acquire_lock[\s\S]*to service_role/);
});

test("legacy account upgrade binds the exact invited Auth id without email-only linking", async () => {
  const edge = await readFile(legacyUpgradeUrl, "utf8");
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(edge, /inviteUserByEmail/);
  assert.match(edge, /p_auth_user_id:\s*invited\.user\.id/);
  assert.match(edge, /consume_workspace_upgrade_rate_limit/);
  assert.match(edge, /sha256Hex\(`\$\{ip\}\|\$\{email\}`\)/);
  assert.doesNotMatch(edge, /new Map/);
  assert.match(sql, /v_upgrade\.invited_auth_user_id is distinct from auth\.uid\(\)/);
  assert.match(sql, /auth_user_id = auth\.uid\(\)/);
  assert.doesNotMatch(sql, /auth_user_id\s*=\s*[^;]*email/i);
});

test("authenticated session reads cannot expose legacy invitation columns", async () => {
  const sql = await readFile(guardedMigrationUrl, "utf8");
  assert.match(sql, /revoke select on table public\.ai_interview_sessions from authenticated/);
  assert.match(sql, /a\.attname not in \('access_token', 'invitation_url'\)/);
  assert.match(sql, /to_jsonb\(s\) - 'access_token' - 'invitation_url'/);
});

test("behavioral pgTAP covers one-time links, capability isolation, and media limits", async () => {
  const sql = await readFile(portalBehaviorTestUrl, "utf8");
  const assertionCount = (sql.match(/^select (?:ok|is|like|throws_ok|lives_ok)\(/gm) || []).length;
  assert.match(sql, /select plan\(22\)/);
  assert.equal(assertionCount, 22);
  assert.match(sql, /consumed invitation cannot be reused/);
  assert.match(sql, /different Auth session cannot use the capability/);
  assert.match(sql, /oversized audio is rejected/);
  assert.match(sql, /anon cannot list interview audio directly/);
});

test("AI Commander derives its operational snapshot from the verified tenant", async () => {
  const [app, edge] = await Promise.all([readFile(appUrl, "utf8"), readFile(commanderFunctionUrl, "utf8")]);
  const runner = app.slice(app.indexOf("async function runAICommander"), app.indexOf("function getAIAgentSettingsModeLabel"));
  assert.doesNotMatch(runner, /snapshot:\s*\{/);
  assert.doesNotMatch(runner, /company_id\s*:/);
  assert.match(edge, /getVerifiedTenantContext/);
  assert.match(edge, /query = query\.eq\("company_id", actor\.company_id\)/);
  assert.match(edge, /untrusted_tenant_context/);
});

test("AI Agent agency locks require an active relationship in the actor tenant", async () => {
  const source = await readFile(aiAgentFunctionUrl, "utf8");
  assert.match(source, /company_agency_access/);
  assert.match(source, /\.eq\("company_id", actor\.company_id\)/);
  assert.match(source, /\.eq\("agency_id", candidateAgencyId\)/);
  assert.match(source, /p_agency_id: verifiedAgencyId/);
});

test("campaign invitation worker is secret-gated and uses service-only queue contracts", async () => {
  const [worker, sql] = await Promise.all([readFile(invitationWorkerUrl, "utf8"), readFile(guardedMigrationUrl, "utf8")]);
  assert.match(worker, /x-visaflow-worker-secret/);
  assert.match(worker, /claim_ai_interview_invitation_jobs/);
  assert.match(worker, /complete_ai_interview_invitation_job/);
  assert.match(worker, /fail_ai_interview_invitation_job/);
  assert.doesNotMatch(worker, /console\.(?:log|warn|error)/);
  assert.match(sql, /revoke execute on function public\.claim_ai_interview_invitation_jobs[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.claim_ai_interview_invitation_jobs[\s\S]*to service_role/);
});

test("the final migration cannot be superseded by historical compatibility grants", async () => {
  const sql = await readFile(finalizationMigrationUrl, "utf8");
  assert.match(sql, /revoke execute on function public\.legacy_app_login\(text, text\) from public, anon, authenticated/);
  assert.match(sql, /revoke all on table public\.users from public, anon, authenticated/);
  assert.match(sql, /revoke all on table public\.companies from public, anon, authenticated/);
  assert.match(sql, /has_function_privilege\('authenticated', 'public\.legacy_app_login\(text,text\)'/);
  assert.match(sql, /raise exception 'legacy_app_login remained browser executable'/);
});
