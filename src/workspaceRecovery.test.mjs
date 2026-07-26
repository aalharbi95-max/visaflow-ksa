import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildWorkspaceRecoveryRedirectUrl,
  clearWorkspaceRecoveryLocalState,
  completeWorkspacePasswordRecovery,
  getCleanWorkspaceRecoveryUrl,
  getWorkspaceRecoveryErrorMessage,
  getWorkspaceRecoveryUrlState,
  WORKSPACE_RECOVERY_SUCCESS_MESSAGE,
} from "./workspaceRecovery.mjs";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
    snapshot: () => Object.fromEntries(values),
  };
}

test("recognizes only an explicit workspace recovery URL", () => {
  assert.equal(
    getWorkspaceRecoveryUrlState(
      "http://localhost:5173/?login=1&auth_flow=workspace&recovery=1"
    ).requested,
    true
  );
  assert.equal(
    getWorkspaceRecoveryUrlState(
      "http://localhost:5173/?talent=1&auth_flow=candidate&recovery=1"
    ).requested,
    false
  );
});

test("preserves an expired callback error for the recovery screen", () => {
  const state = getWorkspaceRecoveryUrlState(
    "https://visaflowksa.com/?login=1&auth_flow=workspace&recovery=1#error=access_denied&error_code=otp_expired"
  );
  assert.equal(state.requested, true);
  assert.equal(state.error.code, "otp_expired");
  assert.match(getWorkspaceRecoveryErrorMessage(state.error), /expired/i);
});

test("workspace recovery redirect is derived from the active origin", () => {
  assert.equal(
    buildWorkspaceRecoveryRedirectUrl("http://localhost:5173"),
    "http://localhost:5173/?login=1&auth_flow=workspace&recovery=1"
  );
  assert.equal(
    new URL(
      buildWorkspaceRecoveryRedirectUrl("https://visaflowksa.com")
    ).origin,
    "https://visaflowksa.com"
  );
});

test("old workspace state is removed without clearing talent auth", () => {
  const localStorage = memoryStorage({
    "visaflow-workspace-auth": "old-workspace-session",
    "visaflow-talent-auth": "candidate-session",
    visaflow_user: "old-office",
    visaflow_workspace_display: "old-company",
  });
  const sessionStorage = memoryStorage({
    visaflow_user: "old-office",
    visaflow_agency_company_id: "company-id",
    "visaflow-interview-auth": "interview-session",
  });

  clearWorkspaceRecoveryLocalState({ localStorage, sessionStorage });

  assert.equal(localStorage.getItem("visaflow-workspace-auth"), null);
  assert.equal(localStorage.getItem("visaflow-talent-auth"), "candidate-session");
  assert.equal(localStorage.getItem("visaflow_user"), null);
  assert.equal(sessionStorage.getItem("visaflow_agency_company_id"), null);
  assert.equal(
    sessionStorage.getItem("visaflow-interview-auth"),
    "interview-session"
  );
});

test("a stale session cannot update a password without recovery proof", async () => {
  let updateCalls = 0;
  await assert.rejects(
    completeWorkspacePasswordRecovery({
      auth: {
        updateUser: async () => {
          updateCalls += 1;
          return { error: null };
        },
      },
      userId: "old-session-user",
      password: "correct horse battery staple",
      confirmation: "correct horse battery staple",
      hasRecoveryProof: () => false,
    }),
    /invalid/i
  );
  assert.equal(updateCalls, 0);
});

test("successful recovery updates the password, cleans the URL, and signs out locally", async () => {
  const events = [];
  const result = await completeWorkspacePasswordRecovery({
    auth: {
      updateUser: async (payload) => {
        events.push(["updateUser", payload]);
        return { error: null };
      },
      signOut: async (options) => {
        events.push(["signOut", options]);
        return { error: null };
      },
    },
    userId: "recovery-user",
    password: "correct horse battery staple",
    confirmation: "correct horse battery staple",
    hasRecoveryProof: (userId) => userId === "recovery-user",
    clearRecoveryProof: (userId) => events.push(["clearProof", userId]),
    cleanCallbackUrl: () => events.push(["cleanUrl"]),
    storeSuccessMessage: (message) => events.push(["success", message]),
  });

  assert.deepEqual(events, [
    ["updateUser", { password: "correct horse battery staple" }],
    ["clearProof", "recovery-user"],
    ["cleanUrl"],
    ["signOut", { scope: "local" }],
    ["success", WORKSPACE_RECOVERY_SUCCESS_MESSAGE],
  ]);
  assert.equal(result.message, WORKSPACE_RECOVERY_SUCCESS_MESSAGE);
});

test("recovery callback cleanup removes tokens and keeps company login", () => {
  const url = getCleanWorkspaceRecoveryUrl(
    "https://visaflowksa.com/?login=1&auth_flow=workspace&recovery=1&code=secret#access_token=secret"
  );
  assert.equal(url.searchParams.get("login"), "1");
  assert.equal(url.searchParams.get("auth_flow"), null);
  assert.equal(url.searchParams.get("recovery"), null);
  assert.equal(url.searchParams.get("code"), null);
  assert.equal(url.hash, "");
});

test("workspace data reconciliation is blocked while recovery is active", async () => {
  const appSource = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const authEffect = appSource.slice(
    appSource.indexOf("useEffect(() => {\n  let mounted = true;"),
    appSource.indexOf("const reconcileAuthenticatedWorkspace")
  );
  const recoveryRoute = appSource.indexOf(
    "return <WorkspacePasswordRecoveryScreen"
  );
  const officeRoute = appSource.indexOf(
    'if (currentRole === "Agency" && !currentCompanyId)'
  );

  assert.match(authEffect, /if \(workspaceRecoveryRequested\)/);
  assert.match(authEffect, /clearTenantSensitiveState\(\)/);
  assert.match(authEffect, /clearStoredWorkspaceIdentity\(\)/);
  assert.ok(recoveryRoute > -1 && recoveryRoute < officeRoute);
});

test("workspace recovery proof is established only from PASSWORD_RECOVERY", async () => {
  const supabaseSource = await readFile(
    new URL("./supabase.js", import.meta.url),
    "utf8"
  );
  const proofSource = supabaseSource.slice(
    supabaseSource.indexOf(
      "export function establishWorkspaceRecoveryProof"
    ),
    supabaseSource.indexOf(
      "export function hasWorkspaceRecoveryProof"
    )
  );

  assert.match(proofSource, /event === 'PASSWORD_RECOVERY'/);
  assert.match(proofSource, /workspaceRecoveryRequested/);
  assert.doesNotMatch(proofSource, /INITIAL_SESSION|SIGNED_IN|USER_UPDATED/);
});
