import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildWorkspaceRecoveryRedirectUrl,
  clearWorkspaceRecoveryLocalState,
  completeWorkspacePasswordRecovery,
  finalizeWorkspaceRecoverySuccess,
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
  };
}

test("recognizes workspace recovery and rejects candidate recovery", () => {
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

test("reports expired links and builds redirects from the current origin", () => {
  const state = getWorkspaceRecoveryUrlState(
    "https://visaflowksa.com/?login=1&auth_flow=workspace&recovery=1#error=access_denied&error_code=otp_expired"
  );
  assert.equal(state.error.code, "otp_expired");
  assert.match(getWorkspaceRecoveryErrorMessage(state.error), /expired/i);
  assert.equal(
    buildWorkspaceRecoveryRedirectUrl("http://localhost:5173"),
    "http://localhost:5173/?login=1&auth_flow=workspace&recovery=1"
  );
});

test("clears old workspace state without clearing candidate auth", () => {
  const localStorage = memoryStorage({
    "visaflow-workspace-auth": "old",
    "visaflow-talent-auth": "candidate",
    visaflow_user: "office",
  });
  const sessionStorage = memoryStorage({
    visaflow_agency_company_id: "company",
  });
  clearWorkspaceRecoveryLocalState({ localStorage, sessionStorage });
  assert.equal(localStorage.getItem("visaflow-workspace-auth"), null);
  assert.equal(localStorage.getItem("visaflow-talent-auth"), "candidate");
  assert.equal(sessionStorage.getItem("visaflow_agency_company_id"), null);
});

test("a stale session cannot update the password without PASSWORD_RECOVERY proof", async () => {
  let updates = 0;
  await assert.rejects(
    completeWorkspacePasswordRecovery({
      auth: {
        updateUser: async () => {
          updates += 1;
          return { error: null };
        },
      },
      userId: "old-user",
      password: "correct horse battery staple",
      confirmation: "correct horse battery staple",
      hasRecoveryProof: () => false,
    }),
    /invalid/i
  );
  assert.equal(updates, 0);
});

test("a successful password update remains successful when local sign-out fails", async () => {
  const events = [];
  const updateResult = await completeWorkspacePasswordRecovery({
    auth: {
      updateUser: async (payload) => {
        events.push(["update", payload]);
        return { error: null };
      },
    },
    userId: "recovery-user",
    password: "correct horse battery staple",
    confirmation: "correct horse battery staple",
    hasRecoveryProof: () => true,
  });

  assert.equal(updateResult.success, true);
  assert.equal(updateResult.passwordUpdated, true);
  assert.equal(updateResult.message, WORKSPACE_RECOVERY_SUCCESS_MESSAGE);

  const warnings = [];
  const cleanupResult = await finalizeWorkspaceRecoverySuccess({
    clearRecoveryProof: () => events.push(["clear-proof"]),
    cleanCallbackUrl: () => events.push(["clean-url"]),
    storeSuccessMessage: (value) => events.push(["success", value]),
    signOut: async () => {
      events.push(["signout", { scope: "local" }]);
      return { error: new Error("local sign-out failed") };
    },
    redirectToLogin: () => events.push(["redirect", "/?login=1"]),
    logger: (...args) => warnings.push(args),
  });

  assert.equal(cleanupResult.success, true);
  assert.equal(cleanupResult.passwordUpdated, true);
  assert.equal(cleanupResult.redirected, true);
  assert.deepEqual(cleanupResult.cleanupErrors, ["local sign-out"]);
  assert.equal(warnings.length, 1);
  assert.deepEqual(events, [
    ["update", { password: "correct horse battery staple" }],
    ["clear-proof"],
    ["clean-url"],
    ["success", WORKSPACE_RECOVERY_SUCCESS_MESSAGE],
    ["signout", { scope: "local" }],
    ["redirect", "/?login=1"],
  ]);
});

test("callback cleanup removes tokens and keeps login", () => {
  const url = getCleanWorkspaceRecoveryUrl(
    "https://visaflowksa.com/?auth_flow=workspace&recovery=1&code=secret#access_token=secret"
  );
  assert.equal(url.searchParams.get("login"), "1");
  assert.equal(url.searchParams.get("code"), null);
  assert.equal(url.hash, "");
});

test("App blocks workspace reconciliation and portal rendering during recovery", async () => {
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const reconcileStart = app.indexOf("const reconcileAuthenticatedWorkspace");
  const authEffectStart = app.lastIndexOf(
    "useEffect(() => {",
    reconcileStart
  );
  const effect = app.slice(
    authEffectStart,
    reconcileStart
  );
  assert.match(effect, /workspaceRecoveryRequested/);
  assert.ok(
    app.indexOf("return <WorkspacePasswordRecoveryScreen") <
      app.indexOf('if (currentRole === "Agency" && !currentCompanyId)')
  );
});
