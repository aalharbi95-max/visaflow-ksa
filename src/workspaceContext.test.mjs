import assert from "node:assert/strict";
import test from "node:test";
import {
  WORKSPACE_CONTEXT_RPC,
  WORKSPACE_LOGIN_MESSAGES,
  WorkspaceContextError,
  getWorkspaceLoginErrorMessage,
  loadAuthenticatedWorkspaceContext,
  validateWorkspaceContext,
} from "./workspaceContext.mjs";

const AUTH_ID = "448ed4dc-6022-457f-9eea-742e6381c3d4";

function companyContext(overrides = {}) {
  return {
    actor: {
      id: "user-1", auth_user_id: AUTH_ID, role: "Company Admin",
      status: "Active", is_active: true, company_id: "company-1", agency_id: null,
      ...overrides.actor,
    },
    company: {
      id: "company-1", name: "VisaFlow Staging QA Company", status: "Active",
      subscription_status: "Active", ...overrides.company,
    },
    agency: null,
  };
}

test("auth success followed by an RPC failure never becomes invalid credentials", async () => {
  const client = { rpc: async () => ({ data: null, error: { code: "PGRST202", message: "missing RPC" } }) };
  await assert.rejects(
    () => loadAuthenticatedWorkspaceContext(client, AUTH_ID),
    (error) => error instanceof WorkspaceContextError &&
      getWorkspaceLoginErrorMessage("workspace", error) === WORKSPACE_LOGIN_MESSAGES.UNAVAILABLE
  );
  assert.equal(getWorkspaceLoginErrorMessage("auth"), WORKSPACE_LOGIN_MESSAGES.INVALID_CREDENTIALS);
});

test("the canonical RPC loads the Company Admin workspace", async () => {
  let calledRpc = "";
  const client = { rpc: async (name) => { calledRpc = name; return { data: companyContext(), error: null }; } };
  const context = await loadAuthenticatedWorkspaceContext(client, AUTH_ID);
  assert.equal(calledRpc, WORKSPACE_CONTEXT_RPC);
  assert.equal(context.actor.role, "Company Admin");
  assert.equal(context.company.name, "VisaFlow Staging QA Company");
});

test("workspace auth_user_id must match the verified Auth session", () => {
  assert.throws(
    () => validateWorkspaceContext(companyContext({ actor: { auth_user_id: "other-user" } }), AUTH_ID),
    (error) => error.code === "UNAVAILABLE"
  );
});

test("a user cannot be accepted with another company context", () => {
  assert.throws(
    () => validateWorkspaceContext(companyContext({ company: { id: "company-2" } }), AUTH_ID),
    (error) => error.code === "ACCOUNT_NOT_LINKED"
  );
});

test("an inactive user is rejected with the inactive-account message", () => {
  assert.throws(
    () => validateWorkspaceContext(companyContext({ actor: { status: "Inactive" } }), AUTH_ID),
    (error) => error.code === "USER_INACTIVE" && error.message === WORKSPACE_LOGIN_MESSAGES.USER_INACTIVE
  );
});

test("agency context cannot be mixed with company context", () => {
  const agencyContext = {
    actor: { id: "agency-user", auth_user_id: AUTH_ID, role: "Agency", status: "Active",
      is_active: true, company_id: null, agency_id: "agency-1" },
    company: null,
    agency: { id: "agency-1", name: "Agency", status: "Active" },
  };
  assert.doesNotThrow(() => validateWorkspaceContext(agencyContext, AUTH_ID));
  assert.throws(
    () => validateWorkspaceContext({ ...agencyContext, company: { id: "company-1", status: "Active" } }, AUTH_ID),
    (error) => error.code === "UNAVAILABLE"
  );
});
