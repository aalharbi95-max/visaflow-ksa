import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH_AUDIENCE,
  assertSafeWorkspaceContext,
  authUserMatchesAudience,
  selectRememberedAgencyWorkspace,
  toWorkspaceDisplayCache,
} from "./securityContracts.mjs";

test("auth audiences cannot be confused", () => {
  const workspace = { id: "w", user_metadata: {} };
  const talent = { id: "t", user_metadata: { account_type: "candidate" } };
  const interview = { id: "i", user_metadata: { account_type: "interview_portal" } };
  assert.equal(authUserMatchesAudience(workspace, AUTH_AUDIENCE.WORKSPACE), true);
  assert.equal(authUserMatchesAudience(talent, AUTH_AUDIENCE.WORKSPACE), false);
  assert.equal(authUserMatchesAudience(interview, AUTH_AUDIENCE.TALENT), false);
  assert.equal(authUserMatchesAudience(interview, AUTH_AUDIENCE.INTERVIEW), true);
});

test("workspace cache excludes tenant and authorization identifiers", () => {
  assert.deepEqual(toWorkspaceDisplayCache({
    actor: { id: 7, name: "User", role: "Admin", auth_user_id: "auth", company_id: "tenant", agency_name: "Office" },
    company: { id: "tenant", name: "Company" },
  }), { id: 7, name: "User", role: "Admin", company_name: "Company", agency_name: "Office" });
});

test("remembered agency selection uses an authorized opaque access id only", () => {
  const rows = [
    { access_id: "first", company_id: "a", is_active: true },
    { access_id: "second", company_id: "b", is_active: true },
  ];
  assert.equal(selectRememberedAgencyWorkspace(rows, "second").company_id, "b");
  assert.equal(selectRememberedAgencyWorkspace(rows, "untrusted").company_id, "a");
});

test("workspace context must match the verified auth user", () => {
  assert.throws(() => assertSafeWorkspaceContext({ actor: { auth_user_id: "other" } }, "verified"));
  assert.doesNotThrow(() => assertSafeWorkspaceContext({ actor: { auth_user_id: "verified" } }, "verified"));
});
