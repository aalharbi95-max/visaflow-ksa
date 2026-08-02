import assert from "node:assert/strict";
import test from "node:test";
import {
  AgencyInvitationError,
  DEFAULT_AGENCY_PERMISSIONS,
  runAgencyInvitationAction,
} from "../supabase/functions/_shared/agencyInvitationCore.mjs";

function activeActor(role = "Company Admin", companyId = "company-a") {
  return {
    authUserId: "actor-auth",
    userId: "actor-user",
    companyId,
    role,
    isActive: true,
  };
}

function recoveryHarness({
  authFailure = false,
  recordFailures = 0,
  completeFailures = 0,
  deliveryFailure = false,
  persistFailureAuthUser = true,
} = {}) {
  const state = {
    request: {
      id: "request-a",
      agency_id: "agency-a",
      admin_email: "agency@example.test",
      auth_user_id: null,
      auth_identity_preexisting: false,
      status: "Provisioning",
      attempt_count: 0,
    },
    authUsers: [],
    authCalls: 0,
    deliveryCalls: 0,
    recordCalls: 0,
    completeCalls: 0,
    invitationRows: 0,
    failure: null,
  };

  const repository = {
    async begin({ permissions }) {
      state.request.attempt_count += 1;
      state.request.status = "Provisioning";
      state.request.permissions = permissions;
      return { ...state.request, outcome: "send" };
    },
    async findRecoverableAuthUser({ email, requestId, agencyId }) {
      return (
        state.authUsers.find(
          (user) =>
            user.email === email &&
            user.requestId === requestId &&
            user.agencyId === agencyId
        )?.id || null
      );
    },
    async findExistingAuthUser() { return null; },
    async deliverInvitation({ requestId, actionLink, companyId }) {
      state.deliveryCalls += 1;
      assert.equal(requestId, state.request.id);
      assert.equal(companyId, "company-a");
      assert.match(actionLink, /^https:\/\/supabase\.example\.test\/auth\/v1\/verify/);
      if (deliveryFailure) throw new Error("provider rejected delivery");
    },
    async recordAuthUser({ authUserId, existingIdentity }) {
      state.recordCalls += 1;
      if (state.recordCalls <= recordFailures) {
        throw new Error("record failed");
      }
      state.request.auth_user_id = authUserId;
      state.request.auth_identity_preexisting = existingIdentity === true;
    },
    async complete({ authUserId }) {
      state.completeCalls += 1;
      if (state.completeCalls <= completeFailures) {
        throw new Error("complete failed");
      }
      assert.equal(authUserId, state.request.auth_user_id);
      state.request.status = "Invitation Sent";
      state.invitationRows = 1;
      return { ...state.request };
    },
    async markFailed(details) {
      state.failure = details;
      state.request.status = "Failed";
      if (details.authUserId && persistFailureAuthUser) {
        state.request.auth_user_id = details.authUserId;
      }
    },
  };

  const authAdmin = {
    async generateLink({ type, email, options }) {
      state.authCalls += 1;
      if (authFailure) {
        return { data: null, error: new Error("mail provider failed") };
      }
      let user = state.authUsers.find((item) => item.email === email);
      if (!user) {
        user = { id: "auth-agency-a", email, requestId: options.data.provisioning_request_id, agencyId: options.data.agency_id };
        state.authUsers.push(user);
      }
      return { data: { user, properties: { action_link: `https://supabase.example.test/auth/v1/verify?type=${type}` } }, error: null };
    },
  };

  const run = () =>
    runAgencyInvitationAction({
      body: {
        action: "invite_existing",
        agency_id: "agency-a",
        permissions: DEFAULT_AGENCY_PERMISSIONS,
      },
      actor: activeActor(),
      repository,
      authAdmin,
      inviteRedirectUrl: "https://staging.example.test/agency-invite",
    });

  return { state, run };
}

test("failure before Auth creation records a retryable AUTH_CREATE stage", async () => {
  const harness = recoveryHarness({ authFailure: true });
  await assert.rejects(
    harness.run(),
    (error) =>
      error instanceof AgencyInvitationError &&
      error.code === "AGENCY_INVITATION_SEND_FAILED"
  );
  assert.equal(harness.state.request.auth_user_id, null);
  assert.equal(harness.state.failure.stage, "AUTH_CREATE");
  assert.equal(
    harness.state.failure.lastSuccessfulOperation,
    "REQUEST_STARTED"
  );
});

test("provider handoff failure changes the invitation to Failed and remains retryable", async () => {
  const harness = recoveryHarness({ deliveryFailure: true });
  await assert.rejects(harness.run(), (error) => error.code === "AGENCY_INVITATION_EMAIL_DELIVERY_FAILED");
  assert.equal(harness.state.request.status, "Failed");
  assert.equal(harness.state.failure.stage, "INVITATION_FINALIZATION");
  assert.equal(harness.state.failure.metadata.retryable, true);
});

test("retry after Auth creation reuses the same identity without a second Auth user", async () => {
  const harness = recoveryHarness({
    recordFailures: 1,
    persistFailureAuthUser: false,
  });
  await assert.rejects(
    harness.run(),
    (error) =>
      error.code === "AGENCY_INVITATION_AUTH_USER_RECORD_FAILED"
  );
  assert.equal(harness.state.failure.stage, "AUTH_USER_RECORD");
  assert.equal(harness.state.request.auth_user_id, null);

  const result = await harness.run();
  assert.equal(result.request.status, "Invitation Sent");
  assert.equal(result.request.auth_user_id, "auth-agency-a");
  assert.equal(harness.state.authCalls, 2);
  assert.equal(harness.state.authUsers.length, 1);
  assert.equal(harness.state.invitationRows, 1);
});

test("finalization retry resumes after the recorded Auth identity", async () => {
  const harness = recoveryHarness({ completeFailures: 1 });
  await assert.rejects(
    harness.run(),
    (error) => error.code === "AGENCY_INVITATION_FINALIZATION_FAILED"
  );
  assert.equal(harness.state.failure.stage, "INVITATION_FINALIZATION");
  assert.equal(
    harness.state.failure.lastSuccessfulOperation,
    "AUTH_USER_RECORDED"
  );

  const result = await harness.run();
  assert.equal(result.request.status, "Invitation Sent");
  assert.equal(harness.state.authCalls, 2);
  assert.equal(harness.state.invitationRows, 1);
});

test("role authorization rejects Recruitment Manager, agency, inactive and cross-tenant actors", async () => {
  for (const actor of [
    activeActor("Recruitment Manager"),
    activeActor("Agency"),
    activeActor("Platform Owner", null),
    { ...activeActor("Admin"), isActive: false },
  ]) {
    await assert.rejects(
      runAgencyInvitationAction({
        body: { action: "invite_existing", agency_id: "agency-a" },
        actor,
        repository: { begin: async () => assert.fail("must not begin") },
        authAdmin: {},
      }),
      (error) => error.code === "AGENCY_INVITATION_UNAUTHORIZED"
    );
  }

  await assert.rejects(
    runAgencyInvitationAction({
      body: { action: "invite_existing", agency_id: "agency-b" },
      actor: activeActor("Admin", "company-a"),
      repository: {
        begin: async () => {
          throw new Error("AGENCY_INVITATION_AGENCY_NOT_AVAILABLE");
        },
      },
      authAdmin: {},
    }),
    /AGENCY_INVITATION_AGENCY_NOT_AVAILABLE/
  );
});

test("server validation rejects unknown permission keys before repository access", async () => {
  await assert.rejects(
    runAgencyInvitationAction({
      body: {
        action: "invite_existing",
        agency_id: "agency-a",
        permissions: {
          ...DEFAULT_AGENCY_PERMISSIONS,
          can_delete_requests: true,
        },
      },
      actor: activeActor("Admin"),
      repository: { begin: async () => assert.fail("must not begin") },
      authAdmin: {},
    }),
    (error) => error.code === "AGENCY_INVITATION_INVALID_PERMISSIONS"
  );
});

test("activation failure records a resumable activation stage", async () => {
  let marked = null;
  await assert.rejects(
    runAgencyInvitationAction({
      body: { action: "activate" },
      actor: { authUserId: "agency-auth" },
      repository: {
        activate: async () => {
          throw new Error("activation failed");
        },
        markActivationFailed: async (details) => {
          marked = details;
        },
      },
      authAdmin: {},
    }),
    (error) => error.code === "AGENCY_INVITATION_ACTIVATION_FAILED"
  );
  assert.deepEqual(marked, {
    code: "AGENCY_INVITATION_ACTIVATION_FAILED",
    stage: "ACTIVATION",
    lastSuccessfulOperation: "INVITATION_SENT",
  });
});

test("an existing compatible Auth identity receives a recovery invitation link", async () => {
  let generatedType = "";
  let recordedAsPreexisting = false;
  const result = await runAgencyInvitationAction({
    body: { action: "resend_invitation", agency_id: "agency-a", permissions: DEFAULT_AGENCY_PERMISSIONS },
    actor: activeActor(),
    repository: {
      begin: async () => ({ id: "request-a", agency_id: "agency-a", admin_email: "agency@example.test", auth_user_id: null, outcome: "resend" }),
      findRecoverableAuthUser: async () => null,
      findExistingAuthUser: async () => "existing-auth",
      deliverInvitation: async ({ actionLink }) => assert.match(actionLink, /type=recovery/),
      recordAuthUser: async ({ authUserId, existingIdentity }) => {
        assert.equal(authUserId, "existing-auth");
        recordedAsPreexisting = existingIdentity;
      },
      complete: async () => ({ status: "Invitation Sent", auth_user_id: "existing-auth" }),
      markFailed: async () => assert.fail("must not fail"),
    },
    authAdmin: { generateLink: async ({ type }) => {
      generatedType = type;
      return { data: { user: { id: "existing-auth" }, properties: { action_link: `https://supabase.example.test/auth/v1/verify?type=${type}` } } };
    } },
    inviteRedirectUrl: "https://staging.example.test/agency-invite",
  });
  assert.equal(generatedType, "recovery");
  assert.equal(recordedAsPreexisting, true);
  assert.equal(result.request.auth_user_id, "existing-auth");
});

test("a new Auth identity receives an invite link with the staging activation redirect", async () => {
  let generatedType = "";
  let generatedRedirect = "";
  await runAgencyInvitationAction({
    body: { action: "invite_existing", agency_id: "agency-a", permissions: DEFAULT_AGENCY_PERMISSIONS },
    actor: activeActor(),
    repository: {
      begin: async () => ({ id: "request-new", agency_id: "agency-a", admin_email: "new@example.test", auth_user_id: null, outcome: "send" }),
      findRecoverableAuthUser: async () => null,
      findExistingAuthUser: async () => null,
      deliverInvitation: async ({ actionLink }) => assert.match(actionLink, /type=invite/),
      recordAuthUser: async () => {}, complete: async () => ({ status: "Invitation Sent" }),
      markFailed: async () => assert.fail("must not fail"),
    },
    authAdmin: { generateLink: async ({ type, options }) => {
      generatedType = type;
      generatedRedirect = options.redirectTo;
      return { data: { user: { id: "new-auth" }, properties: { action_link: `https://supabase.example.test/auth/v1/verify?type=${type}` } } };
    } },
    inviteRedirectUrl: "https://staging.visaflowksa.com/agency/activate?agency_invite=1",
  });
  assert.equal(generatedType, "invite");
  assert.equal(generatedRedirect, "https://staging.visaflowksa.com/agency/activate?agency_invite=1");
  assert.doesNotMatch(generatedRedirect, /localhost|127\.0\.0\.1|visaflowksa\.com\/(?!agency)/);
});

test("revocation is tenant-authorized and delegated to the protected repository", async () => {
  let agencyId = "";
  const result = await runAgencyInvitationAction({
    body: { action: "revoke_invitation", agency_id: "agency-a" }, actor: activeActor(),
    repository: { revoke: async (input) => { agencyId = input.agencyId; return { status: "Revoked" }; } }, authAdmin: {},
  });
  assert.equal(agencyId, "agency-a");
  assert.equal(result.request.status, "Revoked");
});
