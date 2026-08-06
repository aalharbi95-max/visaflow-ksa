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
  getWorkspaceRecoveryLoginGuard,
  getWorkspaceRecoveryUrlState,
  storeWorkspaceRecoverySuccess,
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
      "http://localhost:5173/?workspace_recovery=1"
    ).requested,
    true
  );
  assert.equal(
    getWorkspaceRecoveryUrlState(
      "https://visaflowksa.com/#access_token=secret&type=recovery"
    ).requested,
    true
  );
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

test("successful update signs out, verifies the session, and redirects to login", async () => {
  const events = [];
  const localStorage = memoryStorage({
    "visaflow-workspace-auth": "recovery-session",
    "visaflow-talent-auth": "candidate-session",
    visaflow_user: "office",
  });
  const sessionStorage = memoryStorage({
    visaflow_agency_company_id: "company",
  });
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

  const cleanupResult = await finalizeWorkspaceRecoverySuccess({
    auth: {
      signOut: async (options) => {
        events.push(["signout", options]);
        localStorage.removeItem("visaflow-workspace-auth");
        return { error: null };
      },
      getSession: async () => {
        events.push(["get-session"]);
        return { data: { session: null }, error: null };
      },
    },
    localStorage,
    sessionStorage,
    clearRecoveryProof: () => events.push(["clear-proof"]),
    cleanCallbackUrl: () => events.push(["clean-url"]),
    storeSuccessMessage: (value) => {
      events.push(["success", value]);
      storeWorkspaceRecoverySuccess(sessionStorage, value);
    },
    redirectToLogin: () => events.push(["redirect", "/?login=1"]),
  });

  assert.equal(cleanupResult.success, true);
  assert.equal(cleanupResult.passwordUpdated, true);
  assert.equal(cleanupResult.redirected, true);
  assert.equal(cleanupResult.sessionVerifiedAbsent, true);
  assert.equal(cleanupResult.workspaceSessionBlocked, true);
  assert.equal(cleanupResult.usedManualCleanup, false);
  assert.equal(localStorage.getItem("visaflow-workspace-auth"), null);
  assert.equal(localStorage.getItem("visaflow-talent-auth"), "candidate-session");
  assert.deepEqual(events, [
    ["update", { password: "correct horse battery staple" }],
    ["success", WORKSPACE_RECOVERY_SUCCESS_MESSAGE],
    ["clear-proof"],
    ["clean-url"],
    ["signout", { scope: "local" }],
    ["get-session"],
    ["redirect", "/?login=1"],
  ]);

  const loginGuard = getWorkspaceRecoveryLoginGuard({
    storage: sessionStorage,
    locationLike: "https://visaflowksa.com/?login=1",
  });
  assert.deepEqual(loginGuard, {
    active: true,
    message: WORKSPACE_RECOVERY_SUCCESS_MESSAGE,
  });
  assert.equal(
    getWorkspaceRecoveryLoginGuard({
      storage: sessionStorage,
      locationLike: "https://visaflowksa.com/?login=1",
    }).active,
    false
  );
});

test("failed sign-out clears only workspace storage and still redirects", async () => {
  const events = [];
  const warnings = [];
  const localStorage = memoryStorage({
    "visaflow-workspace-auth": "stale-workspace-session",
    "visaflow-talent-auth": "candidate-session",
    visaflow_user: "office",
  });
  const sessionStorage = memoryStorage({
    visaflow_agency_company_id: "company",
    visaflow_agency_company_name: "Agency workspace",
  });

  const result = await finalizeWorkspaceRecoverySuccess({
    auth: {
      signOut: async () => ({
        error: new Error("local sign-out failed"),
      }),
      getSession: async () => ({
        data: { session: { user: { id: "stale-user" } } },
        error: null,
      }),
    },
    localStorage,
    sessionStorage,
    clearRecoveryProof: () => events.push("clear-proof"),
    cleanCallbackUrl: () => events.push("clean-url"),
    storeSuccessMessage: (message) =>
      storeWorkspaceRecoverySuccess(sessionStorage, message),
    redirectToLogin: () => events.push("redirect"),
    logger: (...args) => warnings.push(args),
  });

  assert.equal(result.success, true);
  assert.equal(result.passwordUpdated, true);
  assert.equal(result.usedManualCleanup, true);
  assert.equal(result.sessionVerifiedAbsent, false);
  assert.equal(result.workspaceSessionBlocked, true);
  assert.equal(result.redirected, true);
  assert.equal(localStorage.getItem("visaflow-workspace-auth"), null);
  assert.equal(localStorage.getItem("visaflow_user"), null);
  assert.equal(sessionStorage.getItem("visaflow_agency_company_id"), null);
  assert.equal(sessionStorage.getItem("visaflow_agency_company_name"), null);
  assert.equal(localStorage.getItem("visaflow-talent-auth"), "candidate-session");
  assert.deepEqual(events, ["clear-proof", "clean-url", "redirect"]);
  assert.equal(warnings.length, 1);
});

test("callback cleanup removes tokens and keeps login", () => {
  const url = getCleanWorkspaceRecoveryUrl(
    "https://visaflowksa.com/?workspace_recovery=1&auth_flow=workspace&recovery=1&code=secret#access_token=secret"
  );
  assert.equal(url.searchParams.get("login"), "1");
  assert.equal(url.searchParams.get("workspace_recovery"), null);
  assert.equal(url.searchParams.get("code"), null);
  assert.equal(url.hash, "");
});

test("App blocks stale workspace reconciliation until a verified manual login", async () => {
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
  assert.match(effect, /workspaceRecoveryLoginGuard/);
  assert.match(effect, /clearWorkspaceRecoveryLocalState/);
  assert.ok(
    app.indexOf("return <WorkspacePasswordRecoveryScreen") <
      app.indexOf('if (currentRole === "Agency" && !currentCompanyId)')
  );

  const loginStart = app.indexOf("async function handleLogin()");
  const loginEnd = app.indexOf("async function handleLogout()", loginStart);
  const login = app.slice(loginStart, loginEnd);
  assert.ok(
    login.indexOf("setWorkspaceRecoveryLoginGuard(false)") >
      login.indexOf("const loggedUser =")
  );
  assert.ok(
    login.indexOf("setWorkspaceRecoveryLoginGuard(false)") <
      login.indexOf("activateWorkspaceUser(loggedUser")
  );
});
