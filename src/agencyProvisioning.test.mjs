import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildProductionImportGraph,
  findProtectedTableMutationViolations,
} from "../scripts/checkProtectedTableWrites.mjs";
import {
  ProvisioningError,
  runAgencyProvisioningAction,
  sanitizePermissions,
} from "../supabase/functions/_shared/agencyProvisioningCore.mjs";
import {
  buildCorsHeaders,
  parseAllowedOrigins,
  resolveAllowedOrigin,
} from "../supabase/functions/_shared/corsPolicy.mjs";
import {
  buildAgencyDraftPayload,
  buildAgencyMaintenanceUpdate,
  buildCompanySettingsUpdate,
  canCreateAgencyDraft,
  canProvisionAgency,
  getAgencyInvitationLoginUrl,
  getAgencyInvitationRequestId,
  isAgencyInvitationUrl,
  invokeAgencyProvisioner,
  shouldBlockAgencyWorkspace,
} from "./agencyProvisioning.mjs";

const admin = {
  authUserId: "auth-admin",
  userId: 10,
  companyId: "company-a",
  role: "Admin",
  isActive: true,
};
const manager = { ...admin, role: "Recruitment Manager" };
const permissions = {
  can_view_requests: true,
  can_upload_candidates: true,
  can_update_candidates: false,
  can_view_interviews: true,
};
const draftBody = {
  action: "create_draft",
  idempotency_key: "11111111-1111-4111-8111-111111111111",
  agency_name: "Safe Agency",
  admin_email: "admin@agency.test",
  permissions,
};

function request(overrides = {}) {
  return {
    id: "request-1",
    agency_id: "agency-1",
    agency_name: "Safe Agency",
    admin_email: "admin@agency.test",
    permissions,
    status: "Draft",
    attempt_count: 0,
    ...overrides,
  };
}

function harness(overrides = {}) {
  const calls = [];
  const repository = {
    async createDraft(input) {
      calls.push(["createDraft", input]);
      return request();
    },
    async begin(input) {
      calls.push(["begin", input]);
      return request({ status: "Provisioning", ...overrides.beginResult });
    },
    async recordAuthUser(input) {
      calls.push(["recordAuthUser", input]);
      if (overrides.recordAuthUserError) throw overrides.recordAuthUserError;
      return request({ status: "Provisioning", auth_user_id: input.authUserId });
    },
    async completeInvitation(input) {
      calls.push(["completeInvitation", input]);
      if (overrides.completeError) throw overrides.completeError;
      return request({ status: "Invitation Sent" });
    },
    async markFailed(input) {
      calls.push(["markFailed", input]);
      return request({ status: "Failed", failure_code: input.code });
    },
    async prepareResend(input) {
      calls.push(["prepareResend", input]);
      return request({ status: "Invitation Sent", auth_user_id: "auth-agency" });
    },
    async recordResend(input) {
      calls.push(["recordResend", input]);
      return request({ status: "Invitation Sent", attempt_count: 2 });
    },
    async activate(input) {
      calls.push(["activate", input]);
      if (overrides.activateError) throw overrides.activateError;
      return request({ status: "Active" });
    },
    async getStatus(input) {
      calls.push(["getStatus", input]);
      return request({ status: "Invitation Sent" });
    },
    async updateCompanySettings(input) {
      calls.push(["updateCompanySettings", input]);
      if (overrides.companySettingsError) throw overrides.companySettingsError;
      return { id: input.targetCompanyId, ...input.settings };
    },
    async updateAgency(input) {
      calls.push(["updateAgency", input]);
      if (overrides.updateAgencyError) throw overrides.updateAgencyError;
      return { id: input.agencyId, ...input.updates };
    },
    async unlinkAgency(input) {
      calls.push(["unlinkAgency", input]);
      if (overrides.unlinkAgencyError) throw overrides.unlinkAgencyError;
      return {
        agency_id: input.agencyId,
        company_id: input.actor.companyId,
        status: overrides.unlinkStatus || "Inactive",
        agency_deleted: false,
        auth_user_deleted: false,
        public_user_deleted: false,
      };
    },
  };
  const authAdmin = {
    async inviteUserByEmail(email, options) {
      calls.push(["inviteUserByEmail", { email, options }]);
      if (overrides.inviteError) throw overrides.inviteError;
      return { data: { user: { id: "auth-agency" } } };
    },
  };
  return { calls, repository, authAdmin };
}

async function run(body, actor, overrides) {
  const mock = harness(overrides);
  const result = await runAgencyProvisioningAction({
    body,
    actor,
    repository: mock.repository,
    authAdmin: mock.authAdmin,
    inviteRedirectUrl: "https://example.test/agency-invite",
  });
  return { ...mock, result };
}

test("Recruitment Manager can create a Draft only", async () => {
  assert.equal(canCreateAgencyDraft(manager.role), true);
  assert.equal(canProvisionAgency(manager.role), false);
  const { result, calls } = await run(draftBody, manager);
  assert.equal(result.request.status, "Draft");
  assert.equal(calls[0][0], "createDraft");
  await assert.rejects(
    run({ action: "provision", request_id: "request-1" }, manager),
    (error) => error instanceof ProvisioningError && error.code === "FORBIDDEN"
  );
});

test("Admin can provision and invitation link is never returned", async () => {
  const { result, calls } = await run(
    { action: "provision", request_id: "request-1", permissions },
    admin
  );
  assert.equal(result.request.status, "Invitation Sent");
  assert.equal(JSON.stringify(result).includes("invite"), false);
  assert.deepEqual(
    calls.map(([name]) => name),
    ["begin", "inviteUserByEmail", "recordAuthUser", "completeInvitation"]
  );
});

test("company_id supplied by another tenant is rejected", async () => {
  await assert.rejects(
    run({ ...draftBody, company_id: "company-b" }, admin),
    (error) => error.code === "TENANT_MISMATCH"
  );
});

test("permissions outside the whitelist are rejected", () => {
  assert.throws(
    () => sanitizePermissions({ ...permissions, can_grant_admin: true }),
    (error) => error.code === "INVALID_PERMISSIONS"
  );
});

test("invitation failure marks the request Failed and non-active", async () => {
  const mock = harness({ inviteError: new Error("mail unavailable") });
  await assert.rejects(
    runAgencyProvisioningAction({
      body: { action: "provision", request_id: "request-1" },
      actor: admin,
      repository: mock.repository,
      authAdmin: mock.authAdmin,
      inviteRedirectUrl: "https://example.test/agency-invite",
    }),
    (error) => error.code === "INVITATION_FAILED"
  );
  assert.equal(mock.calls.at(-1)[0], "markFailed");
  assert.equal(mock.calls.at(-1)[1].code, "INVITATION_FAILED");
});

test("Auth success followed by DB failure records the same Auth user for retry", async () => {
  const mock = harness({ completeError: new Error("db unavailable") });
  await assert.rejects(
    runAgencyProvisioningAction({
      body: { action: "provision", request_id: "request-1" },
      actor: admin,
      repository: mock.repository,
      authAdmin: mock.authAdmin,
      inviteRedirectUrl: "https://example.test/agency-invite",
    }),
    (error) => error.code === "DATABASE_FINALIZATION_FAILED"
  );
  assert.equal(mock.calls.some(([name]) => name === "recordAuthUser"), true);
  assert.equal(
    mock.calls.find(([name]) => name === "recordAuthUser")[1].authUserId,
    "auth-agency"
  );

  const retry = await run(
    { action: "provision", request_id: "request-1" },
    admin,
    { beginResult: { auth_user_id: "auth-agency" } }
  );
  assert.equal(retry.calls.some(([name]) => name === "inviteUserByEmail"), false);
  assert.equal(retry.result.request.status, "Invitation Sent");
});

test("failure while recording an invited Auth user is retryable and never sends a second user", async () => {
  const mock = harness({ recordAuthUserError: new Error("db unavailable") });
  await assert.rejects(
    runAgencyProvisioningAction({
      body: { action: "provision", request_id: "request-1" },
      actor: admin,
      repository: mock.repository,
      authAdmin: mock.authAdmin,
      inviteRedirectUrl: "https://example.test/agency-invite",
    }),
    (error) => error.code === "DATABASE_FINALIZATION_FAILED"
  );
  assert.equal(mock.calls.filter(([name]) => name === "inviteUserByEmail").length, 1);
  assert.equal(mock.calls.at(-1)[0], "markFailed");
  assert.equal(mock.calls.at(-1)[1].code, "DATABASE_FINALIZATION_FAILED");
});

test("idempotent completed request performs no duplicate writes or invite", async () => {
  const { calls, result } = await run(
    { action: "provision", request_id: "request-1" },
    admin,
    { beginResult: { status: "Invitation Sent" } }
  );
  assert.equal(result.request.status, "Invitation Sent");
  assert.deepEqual(calls.map(([name]) => name), ["begin"]);
});

test("concurrent provisioning result is safe when the locked request is completed", async () => {
  const attempts = await Promise.all([
    run({ action: "provision", request_id: "request-1" }, admin, {
      beginResult: { status: "Invitation Sent" },
    }),
    run({ action: "provision", request_id: "request-1" }, admin, {
      beginResult: { status: "Invitation Sent" },
    }),
  ]);
  assert.equal(attempts.every(({ calls }) => calls.length === 1), true);
});

test("resend uses the same request and never returns Auth metadata", async () => {
  const { result, calls } = await run(
    { action: "resend_invitation", request_id: "request-1" },
    admin
  );
  assert.equal(result.request.status, "Invitation Sent");
  assert.equal("auth_user_id" in result.request, false);
  assert.deepEqual(
    calls.map(([name]) => name),
    ["prepareResend", "inviteUserByEmail", "recordResend"]
  );
});

test("activation only runs for the authenticated invited identity", async () => {
  const invited = { authUserId: "auth-agency" };
  const { result, calls } = await run({ action: "activate" }, invited);
  assert.equal(result.request.status, "Active");
  assert.equal(calls[0][1].actor.authUserId, "auth-agency");
  const other = harness({ activateError: new Error("AGENCY_PROVISIONING_AUTH_USER_MISMATCH") });
  await assert.rejects(
    runAgencyProvisioningAction({
      body: { action: "activate" },
      actor: { authUserId: "other-user" },
      repository: other.repository,
      authAdmin: other.authAdmin,
    })
  );
});

test("Agency workspace remains blocked until Active", () => {
  assert.equal(
    shouldBlockAgencyWorkspace({ role: "Agency", status: "Invitation Sent", is_active: false }),
    true
  );
  assert.equal(
    shouldBlockAgencyWorkspace({ role: "Agency", status: "Active", is_active: true }),
    false
  );
  assert.equal(shouldBlockAgencyWorkspace({ role: "Talent", status: "Active" }), false);
});

test("agency invitation setup is isolated, cleans callback tokens, and returns to manual login", () => {
  const inviteUrl =
    "https://example.test/?agency_invite=1#access_token=secret&refresh_token=secret&type=invite";
  assert.equal(isAgencyInvitationUrl({ href: inviteUrl }), true);
  assert.equal(
    getAgencyInvitationRequestId({
      user_metadata: { account_type: "agency", provisioning_request_id: "request-1" },
    }),
    "request-1"
  );
  assert.equal(
    getAgencyInvitationRequestId({
      user_metadata: { account_type: "candidate", provisioning_request_id: "request-1" },
    }),
    ""
  );
  const clean = new URL(getAgencyInvitationLoginUrl({ href: inviteUrl }));
  assert.equal(clean.hash, "");
  assert.equal(clean.searchParams.get("agency_invite"), null);
  assert.equal(clean.searchParams.get("login"), "1");
  assert.equal(clean.searchParams.get("agency_invite_complete"), "1");
});

test("App activates an invitation only after password sign-in, never during session reconciliation", async () => {
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  assert.match(
    app,
    /resolveAuthenticatedWorkspaceUser\(verifiedSession\.user\.id,\s*\{\s*activateInvitation: true/
  );
  assert.match(
    app,
    /resolveAuthenticatedWorkspaceUser\(verifiedAuth\.authUser\.id\)/
  );
  assert.match(app, /if \(!activateInvitation\) return result/);
  assert.match(
    app,
    /linkedUserMatchesSession[\s\S]{0,350}!shouldBlockAgencyWorkspace\(linkedUser\)/
  );
  assert.match(app, /AgencyInvitationPasswordScreen/);
  assert.match(app, /auth\.updateUser\(\{ password: form\.password \}\)/);
  assert.match(app, /password\.length < 12/);
  assert.doesNotMatch(
    app.match(/function AgencyInvitationPasswordScreen[\s\S]*?function WorkspacePasswordRecoveryScreen/)?.[0] || "",
    /talentSupabase/
  );
});

test("client draft payload excludes company identity and preserves whitelisted permissions", () => {
  const payload = buildAgencyDraftPayload(
    {
      name: " Agency ",
      admin_email: " ADMIN@AGENCY.TEST ",
      permissions,
      company_id: "untrusted-company",
    },
    "idempotency"
  );
  assert.equal(payload.company_id, undefined);
  assert.equal(payload.admin_email, "admin@agency.test");
  assert.deepEqual(payload.permissions, permissions);
});

test("company settings derive tenant identity and reject cross-tenant or sensitive writes", async () => {
  const own = await run(
    {
      action: "update_company_settings",
      company_id: "company-a",
      settings: { name: "Updated Company", domain: "example.test", notes: "Safe" },
    },
    admin
  );
  assert.equal(own.result.company.id, "company-a");
  assert.equal(own.calls[0][0], "updateCompanySettings");
  assert.equal(own.calls[0][1].targetCompanyId, admin.companyId);

  await assert.rejects(
    run(
      {
        action: "update_company_settings",
        company_id: "company-b",
        settings: { name: "Other Tenant" },
      },
      admin
    ),
    (error) => error.code === "TENANT_MISMATCH"
  );
  await assert.rejects(
    run(
      {
        action: "update_company_settings",
        settings: { subscription_status: "Active" },
      },
      admin
    ),
    (error) => error.code === "COMPANY_SETTINGS_INVALID_FIELDS"
  );
});

test("only Platform Owner can explicitly change protected company subscription fields", async () => {
  const platformOwner = {
    authUserId: "auth-owner",
    userId: 1,
    companyId: null,
    role: "Platform Owner",
    isActive: true,
  };
  const ownerResult = await run(
    {
      action: "update_company_settings",
      company_id: "company-b",
      settings: { subscription_status: "Active", max_users: 20 },
    },
    platformOwner
  );
  assert.equal(ownerResult.result.company.id, "company-b");
  assert.equal(ownerResult.calls[0][1].targetCompanyId, "company-b");

  await assert.rejects(
    run(
      {
        action: "update_company_settings",
        company_id: "company-b",
        settings: { subscription_status: "Active" },
      },
      { ...platformOwner, role: "Platform Admin" }
    ),
    (error) => error.code === "FORBIDDEN"
  );
});

test("agency update is server-mediated and shared-agency conflict is preserved", async () => {
  const update = buildAgencyMaintenanceUpdate({
    name: " Agency ",
    country: " KSA ",
    contact_person: " Contact ",
    email: " admin@example.test ",
    phone: " 123 ",
    status: "Active",
  });
  assert.deepEqual(Object.keys(update).sort(), [
    "contact_person",
    "country",
    "email",
    "name",
    "phone",
  ]);
  const success = await run(
    { action: "update_agency", agency_id: "agency-1", agency: update },
    admin
  );
  assert.equal(success.calls[0][0], "updateAgency");
  assert.equal(success.result.agency.name, "Agency");

  const sharedError = Object.assign(
    new Error("shared"),
    { code: "SHARED_AGENCY_REQUIRES_MANUAL_REVIEW" }
  );
  await assert.rejects(
    run(
      { action: "update_agency", agency_id: "agency-1", agency: update },
      admin,
      { updateAgencyError: sharedError }
    ),
    (error) => error.code === "SHARED_AGENCY_REQUIRES_MANUAL_REVIEW"
  );
});

test("unlink never deletes the global agency, Auth user, or public user", async () => {
  const { result, calls } = await run(
    { action: "unlink_agency", agency_id: "agency-1" },
    admin,
    { unlinkStatus: "Suspended" }
  );
  assert.equal(calls[0][0], "unlinkAgency");
  assert.deepEqual(result.result, {
    agency_id: "agency-1",
    company_id: "company-a",
    status: "Suspended",
    agency_deleted: false,
    auth_user_deleted: false,
    public_user_deleted: false,
  });
});

test("client field builders omit ownership and protected tenant fields", () => {
  assert.deepEqual(
    buildCompanySettingsUpdate({
      name: " Company ",
      domain: " example.test ",
      notes: " note ",
      id: "untrusted",
      ownership: "untrusted",
      subscription_status: "Active",
    }),
    { name: "Company", domain: "example.test", notes: "note" }
  );
  assert.deepEqual(
    buildCompanySettingsUpdate(
      { subscription_status: "Active", max_users: "9", ownership: "untrusted" },
      { platform: true }
    ),
    { subscription_status: "Active", max_users: 9 }
  );
});

test("server failure is surfaced and cannot produce a fake client-side success", async () => {
  const supabase = {
    functions: {
      async invoke() {
        return {
          data: { ok: false, code: "SHARED_AGENCY_REQUIRES_MANUAL_REVIEW" },
          error: null,
        };
      },
    },
  };
  await assert.rejects(
    invokeAgencyProvisioner(supabase, {
      action: "update_agency",
      agency_id: "agency-1",
      agency: { name: "Changed" },
    }),
    (error) => error.code === "SHARED_AGENCY_REQUIRES_MANUAL_REVIEW"
  );
});

test("production import graph excludes Legacy files and has no protected-table writes", async () => {
  const graph = await buildProductionImportGraph(
    new URL("./main.jsx", import.meta.url)
  );
  const relativeFiles = graph.files.map((file) => file.replaceAll("\\", "/"));
  assert.equal(relativeFiles.some((file) => file.endsWith("src/App.jsx")), true);
  assert.equal(
    relativeFiles.some((file) => file.endsWith("src/agencyProvisioning.mjs")),
    true
  );
  assert.equal(
    relativeFiles.some((file) => file.endsWith("src/App_Working_Backup.jsx")),
    false
  );
  assert.equal(
    relativeFiles.some((file) => file.endsWith("src/New folder/App.jsx")),
    false
  );
  assert.deepEqual(await findProtectedTableMutationViolations(graph), []);
});

test("migrations enforce RLS, service-only writes, tenant keys and no destructive duplicate cleanup", async () => {
  const baseline = await readFile(
    new URL("../supabase/migrations/20260726000100_secure_agency_access_baseline.sql", import.meta.url),
    "utf8"
  );
  const provisioning = await readFile(
    new URL("../supabase/migrations/20260726000200_add_agency_provisioning.sql", import.meta.url),
    "utf8"
  );
  for (const table of [
    "public.agencies",
    "public.companies",
    "public.company_agency_access",
    "public.agency_company_user_access",
  ]) {
    assert.match(baseline, new RegExp(`alter table ${table.replace(".", "\\.")} enable row level security`, "i"));
  }
  assert.match(baseline, /revoke all on table public\.agencies\s+from public, anon, authenticated/i);
  assert.match(provisioning, /unique \(company_id, idempotency_key\)/i);
  assert.match(provisioning, /for update/i);
  assert.match(provisioning, /AGENCY_PROVISIONING_IN_PROGRESS/i);
  assert.match(
    provisioning,
    /where request\.company_id = actor\.company_id\s+and request\.idempotency_key = p_idempotency_key/i
  );
  assert.doesNotMatch(baseline + provisioning, /delete\s+from\s+public\.agencies/i);
  assert.doesNotMatch(baseline + provisioning, /unique[\s\S]{0,80}agencies[\s\S]{0,80}email/i);
  for (const rpc of [
    "workspace_admin_update_company_settings",
    "workspace_admin_update_agency",
    "workspace_admin_unlink_agency",
  ]) {
    assert.match(provisioning, new RegExp(`function public\\.${rpc}`, "i"));
    assert.match(
      provisioning,
      new RegExp(`grant execute on function public\\.${rpc}[\\s\\S]{0,250}to service_role`, "i")
    );
  }
  assert.match(provisioning, /SHARED_AGENCY_REQUIRES_MANUAL_REVIEW/i);
  assert.match(provisioning, /update public\.agency_company_user_access\s+set status = 'Suspended'/i);
  assert.doesNotMatch(provisioning, /delete\s+from\s+(?:auth\.users|public\.users)/i);
  assert.match(
    baseline,
    /in \('Platform Owner', 'Platform Accounts User', 'Platform Support User'\)/i
  );
  assert.match(baseline, /agency_company_user_access[\s\S]{0,500}auth_user_id = auth\.uid\(\)/i);
  assert.match(
    baseline,
    /from public\.company_agency_access as access[\s\S]{0,300}coalesce\(access\.status, 'Active'\) <> 'Inactive'/i
  );
});

test("SQL activation updates only the request's agency, company and user links", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20260726000200_add_agency_provisioning.sql", import.meta.url),
    "utf8"
  );
  assert.match(sql, /where id = app_user\.id\s+and auth_user_id = p_actor_auth_user_id/i);
  assert.match(
    sql,
    /where company_id = request_row\.company_id\s+and agency_id = request_row\.agency_id\s+and user_id = app_user\.id/i
  );
  assert.match(sql, /auth_user_id = p_actor_auth_user_id/);
});

test("SELECT baseline preserves tenant roles, Agency links, and Office Portal isolation", async () => {
  const baseline = await readFile(
    new URL("../supabase/migrations/20260726000100_secure_agency_access_baseline.sql", import.meta.url),
    "utf8"
  );
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  assert.match(
    baseline,
    /id::text = public\.current_agency_access_actor\(\)->>'company_id'/
  );
  assert.match(
    baseline,
    /access\.user_id::text =\s*public\.current_agency_access_actor\(\)->>'id'[\s\S]{0,200}access\.status = 'Active'/
  );
  assert.match(
    baseline,
    /agency_id::text = public\.current_agency_access_actor\(\)->>'agency_id'/
  );
  assert.match(
    app,
    /\.from\("agency_company_user_access"\)[\s\S]{0,300}\.eq\("status", "Active"\)/
  );
  assert.match(
    app,
    /\.from\("company_agency_access"\)[\s\S]{0,300}\.eq\("status", "Active"\)/
  );
});

test("Edge source keeps privileged credentials server-side and validates JWT", async () => {
  const edge = await readFile(
    new URL("../supabase/functions/visaflow-agency-provisioner/index.ts", import.meta.url),
    "utf8"
  );
  const core = await readFile(
    new URL("../supabase/functions/_shared/agencyProvisioningCore.mjs", import.meta.url),
    "utf8"
  );
  const client = await readFile(new URL("./agencyProvisioning.mjs", import.meta.url), "utf8");
  const privilegedKeyName = ["SUPABASE", "SERVICE", "ROLE", "KEY"].join("_");
  assert.equal(edge.includes(privilegedKeyName), true);
  assert.match(edge, /auth\.getUser\(token\)/);
  assert.match(core, /inviteUserByEmail/);
  assert.equal(client.includes(["SERVICE", "ROLE"].join("_")), false);
  assert.doesNotMatch(client, /inviteUserByEmail/);
});

test("CORS uses the configured production, staging, and localhost allowlist only", () => {
  const origins = parseAllowedOrigins(
    [
      "https://app.visaflow.example",
      "https://staging.visaflow.example",
      "http://localhost:5173",
    ].join(",")
  );
  for (const origin of [
    "https://app.visaflow.example",
    "https://staging.visaflow.example",
    "http://localhost:5173",
  ]) {
    assert.equal(resolveAllowedOrigin(origin, origins), origin);
    assert.equal(
      buildCorsHeaders(origin, origins)["Access-Control-Allow-Origin"],
      origin
    );
  }
  assert.equal(resolveAllowedOrigin("https://rejected.example", origins), "");
  assert.equal(
    "Access-Control-Allow-Origin" in
      buildCorsHeaders("https://rejected.example", origins),
    false
  );
});

test("Edge rejects an unconfigured origin before handling preflight", async () => {
  const edge = await readFile(
    new URL("../supabase/functions/visaflow-agency-provisioner/index.ts", import.meta.url),
    "utf8"
  );
  assert.match(edge, /AGENCY_PROVISIONER_ALLOWED_ORIGINS/);
  assert.match(
    edge,
    /if \(origin && !resolveAllowedOrigin\(origin, ALLOWED_ORIGINS\)\)[\s\S]{0,180}ORIGIN_NOT_ALLOWED[\s\S]{0,180}request\.method === "OPTIONS"/
  );
  assert.doesNotMatch(edge, /vercel\.app/i);
  assert.doesNotMatch(edge, /localhost:\\d/);
});
