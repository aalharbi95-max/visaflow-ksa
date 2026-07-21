import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  classifyWorkspaceAuthTransition,
  getSafeAuthDiagnostics,
  getSessionWithSingleRefresh,
  reportSafeAuthDiagnostics,
  verifyWorkspaceAuthSession,
} from "./authSession.mjs";

const session = {
  access_token: "secret-access-token",
  refresh_token: "secret-refresh-token",
  user: { id: "auth-user-123" },
};
const currentUser = { auth_user_id: "auth-user-123" };

test("safe diagnostics expose booleans only and never tokens or full identifiers", () => {
  const entries = [];
  reportSafeAuthDiagnostics(session, currentUser, "test", session.user, (...args) => entries.push(args));

  assert.deepEqual(getSafeAuthDiagnostics(session, currentUser, session.user), {
    auth_session_present: true,
    auth_user_present: true,
    auth_user_matches_current_user: true,
  });
  const serialized = JSON.stringify(entries);
  assert.doesNotMatch(serialized, /secret-access-token|secret-refresh-token|auth-user-123/);
});

test("getSession returns the access token after sign-in and after a simulated reload", async () => {
  const storage = new Map();
  const storageKey = "visaflow-workspace-auth";
  const createStorageBackedAuth = () => ({
    signInWithPassword: async () => {
      storage.set(storageKey, JSON.stringify(session));
      return { data: { session, user: session.user }, error: null };
    },
    getSession: async () => ({
      data: { session: JSON.parse(storage.get(storageKey) || "null") },
      error: null,
    }),
    getUser: async () => {
      const storedSession = JSON.parse(storage.get(storageKey) || "null");
      return { data: { user: storedSession?.user || null }, error: null };
    },
    refreshSession: async () => ({ data: { session: null }, error: null }),
  });

  const loginAuth = createStorageBackedAuth();
  const signInResult = await loginAuth.signInWithPassword();
  assert.equal(signInResult.data.session.access_token, session.access_token);
  assert.equal((await verifyWorkspaceAuthSession(loginAuth)).session.access_token, session.access_token);

  const reloadedAuth = createStorageBackedAuth();
  const afterReload = await verifyWorkspaceAuthSession(reloadedAuth);
  assert.equal(afterReload.isVerified, true);
  assert.equal(afterReload.session.access_token, session.access_token);
});

test("email session lookup uses the persisted session without refreshing", async () => {
  let refreshCalls = 0;
  const result = await getSessionWithSingleRefresh({
    getSession: async () => ({ data: { session }, error: null }),
    refreshSession: async () => {
      refreshCalls += 1;
      return { data: { session }, error: null };
    },
  });

  assert.equal(result.session, session);
  assert.equal(result.refreshAttempted, false);
  assert.equal(refreshCalls, 0);
});

test("email session lookup refreshes exactly once when storage has no session", async () => {
  let refreshCalls = 0;
  const result = await getSessionWithSingleRefresh({
    getSession: async () => ({ data: { session: null }, error: null }),
    refreshSession: async () => {
      refreshCalls += 1;
      return { data: { session }, error: null };
    },
  });

  assert.equal(result.session, session);
  assert.equal(result.refreshAttempted, true);
  assert.equal(refreshCalls, 1);
});

test("TOKEN_REFRESHED for the same user preserves the current workspace page", () => {
  const transition = classifyWorkspaceAuthTransition({
    event: "TOKEN_REFRESHED",
    currentAuthUserId: "owner-auth-id",
    nextAuthUserId: "owner-auth-id",
    workspaceReady: true,
  });

  assert.equal(transition.shouldPreserveWorkspace, true);
  assert.equal(transition.shouldResetPage, false);
});

test("repeated SIGNED_IN for the same user preserves the current workspace page", () => {
  const transition = classifyWorkspaceAuthTransition({
    event: "SIGNED_IN",
    currentAuthUserId: "owner-auth-id",
    nextAuthUserId: "owner-auth-id",
    workspaceReady: true,
  });

  assert.equal(transition.shouldPreserveWorkspace, true);
  assert.equal(transition.shouldResetPage, false);
});

test("a different authenticated user resets the page and requires full reconciliation", () => {
  const transition = classifyWorkspaceAuthTransition({
    event: "SIGNED_IN",
    currentAuthUserId: "first-auth-id",
    nextAuthUserId: "second-auth-id",
    workspaceReady: true,
  });

  assert.equal(transition.isSameAuthenticatedUser, false);
  assert.equal(transition.shouldPreserveWorkspace, false);
  assert.equal(transition.shouldResetPage, true);
});

test("browser auth contract persists the workspace session and keeps cleanup scoped", async () => {
  const [appSource, supabaseSource] = await Promise.all([
    readFile(new URL("./App.jsx", import.meta.url), "utf8"),
    readFile(new URL("./supabase.js", import.meta.url), "utf8"),
  ]);

  const loginSource = appSource.slice(
    appSource.indexOf("async function handleLogin()"),
    appSource.indexOf("async function handleLogout()")
  );
  const dispatcherSource = appSource.slice(
    appSource.indexOf("async function dispatchVisaFlowEmail"),
    appSource.indexOf("function getStatusBadgeClass")
  );

  assert.match(supabaseSource, /persistSession:\s*true/);
  assert.match(supabaseSource, /autoRefreshToken:\s*true/);
  assert.match(supabaseSource, /detectSessionInUrl:/);
  assert.match(supabaseSource, /WORKSPACE_AUTH_STORAGE_KEY = 'visaflow-workspace-auth'/);
  assert.match(supabaseSource, /storage: typeof window === 'undefined' \? undefined : window\.localStorage/);
  assert.match(appSource, /workspaceSupabase as supabase/);
  assert.match(appSource, /const supabase = talentSupabase/);
  assert.equal((supabaseSource.match(/createClient\(/g) || []).length, 2);
  assert.match(loginSource, /const verifiedSession = authData\.session \|\| null/);
  assert.match(loginSource, /verifyWorkspaceAuthSession\(supabase\.auth\)/);
  const successfulAuthSource = loginSource.slice(
    loginSource.indexOf("if (!authError && authData?.user?.id)"),
    loginSource.indexOf("// A legacy browser session")
  );
  assert.doesNotMatch(successfulAuthSource, /auth\.signOut\(/);
  assert.doesNotMatch(appSource, /localStorage\.clear\(|sessionStorage\.clear\(/);
  assert.match(appSource, /\["INITIAL_SESSION", "SIGNED_IN", "SIGNED_OUT", "TOKEN_REFRESHED", "USER_UPDATED"\]/);
  assert.match(dispatcherSource, /verifyWorkspaceAuthSession\(supabase\.auth\)/);
  assert.match(dispatcherSource, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(
    await readFile(new URL("./authSession.mjs", import.meta.url), "utf8"),
    /auth\.getUser\(\)/
  );

  const cleanupSource = appSource.slice(
    appSource.indexOf("function clearStoredWorkspaceIdentity()"),
    appSource.indexOf("function clearTenantSensitiveState()")
  );
  assert.doesNotMatch(cleanupSource, /sb-|supabase|auth-token/);
});
