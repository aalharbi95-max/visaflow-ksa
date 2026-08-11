import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCompanyUserMutation,
  COMPANY_USER_ROLES,
  getCompanyUserManagerError,
  sendCompanyUserSetupEmail,
} from "./companyUserManagement.mjs";

test("new company users are normalized into invitation payloads", () => {
  assert.deepEqual(
    buildCompanyUserMutation({ name: "  Sara Ali ", email: " SARA@EXAMPLE.COM ", role: "Recruitment Manager", status: "Active" }),
    { action: "invite_user", name: "Sara Ali", email: "sara@example.com", role: "Recruitment Manager" }
  );
});

test("platform and agency roles cannot use the company invitation route", () => {
  assert.equal(COMPANY_USER_ROLES.includes("Platform Owner"), false);
  assert.equal(COMPANY_USER_ROLES.includes("Agency"), false);
  assert.throws(() => buildCompanyUserMutation({ name: "Bad", email: "bad@example.com", role: "Agency" }), /valid company role/);
});

test("editing keeps the immutable account email in the server payload", () => {
  assert.deepEqual(
    buildCompanyUserMutation({ name: "Sara", email: "sara@example.com", role: "Viewer", status: "Inactive" }, 42),
    { action: "update_user", user_id: "42", name: "Sara", email: "sara@example.com", role: "Viewer", status: "Inactive" }
  );
});

test("setup email uses only the approved workspace recovery route", async () => {
  let captured;
  await sendCompanyUserSetupEmail({ auth: { resetPasswordForEmail: async (email, options) => { captured = { email, options }; return { error: null }; } } }, " User@Example.com ", "https://visaflowksa.com");
  assert.equal(captured.email, "user@example.com");
  assert.equal(captured.options.redirectTo, "https://visaflowksa.com/?login=1&auth_flow=workspace&recovery=1");
});

test("server error codes are translated into safe operator messages", () => {
  assert.match(getCompanyUserManagerError({ code: "COMPANY_USER_LIMIT_REACHED" }), /user limit/i);
  assert.doesNotMatch(getCompanyUserManagerError({ message: "database secret detail" }), /database secret detail/);
});
