export const AGENCY_INVITATION_ROLES = Object.freeze([
  "Admin",
  "Company Admin",
]);

export const AGENCY_PERMISSION_KEYS = Object.freeze([
  "can_view_requests",
  "can_upload_candidates",
  "can_update_candidates",
  "can_view_interviews",
]);

export const DEFAULT_AGENCY_PERMISSIONS = Object.freeze({
  can_view_requests: true,
  can_upload_candidates: true,
  can_update_candidates: true,
  can_view_interviews: true,
});

export class AgencyInvitationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AgencyInvitationError";
    this.code = code;
    this.status = status;
  }
}

function requireInvitationActor(actor) {
  if (
    !actor?.authUserId ||
    !actor?.userId ||
    !actor?.companyId ||
    actor?.isActive !== true
  ) {
    throw new AgencyInvitationError(
      "AGENCY_INVITATION_UNAUTHORIZED",
      "An active company user is required.",
      401
    );
  }
  if (!AGENCY_INVITATION_ROLES.includes(actor.role)) {
    throw new AgencyInvitationError(
      "AGENCY_INVITATION_UNAUTHORIZED",
      "Your role cannot invite agency users.",
      403
    );
  }
}

function requireAgencyId(body) {
  const agencyId = String(body?.agency_id || "").trim();
  if (!agencyId) {
    throw new AgencyInvitationError(
      "AGENCY_INVITATION_AGENCY_REQUIRED",
      "Agency is required."
    );
  }
  return agencyId;
}

export function normalizeAgencyPermissions(value) {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : DEFAULT_AGENCY_PERMISSIONS;
  const unknown = Object.keys(source).filter(
    (key) => !AGENCY_PERMISSION_KEYS.includes(key)
  );
  if (
    unknown.length ||
    AGENCY_PERMISSION_KEYS.some(
      (key) => typeof source[key] !== "boolean"
    )
  ) {
    throw new AgencyInvitationError(
      "AGENCY_INVITATION_INVALID_PERMISSIONS",
      "Agency permissions contain unsupported values."
    );
  }
  return Object.fromEntries(
    AGENCY_PERMISSION_KEYS.map((key) => [key, source[key]])
  );
}

function inviteOptions(request, inviteRedirectUrl, existingIdentity) {
  return {
    redirectTo: inviteRedirectUrl,
    data: {
      account_type: "agency",
      provisioning_request_id: request.id,
      agency_id: request.agency_id,
      existing_identity: existingIdentity === true,
    },
  };
}

function authErrorCode(error) {
  const value = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  if (
    value.includes("email_exists") ||
    value.includes("already registered") ||
    value.includes("already been registered")
  ) {
    return "AGENCY_INVITATION_EMAIL_ALREADY_ASSIGNED";
  }
  return "AGENCY_INVITATION_SEND_FAILED";
}

export async function runAgencyInvitationAction({
  body,
  actor,
  repository,
  authAdmin,
  inviteRedirectUrl,
}) {
  const action = String(body?.action || "").trim();

  if (action === "revoke_invitation") {
    requireInvitationActor(actor);
    return { ok: true, request: await repository.revoke({ agencyId: requireAgencyId(body) }) };
  }

  if (action === "invite_existing" || action === "resend_invitation") {
    requireInvitationActor(actor);
    const permissions = normalizeAgencyPermissions(body?.permissions);
    const started = await repository.begin({
      agencyId: requireAgencyId(body),
      permissions,
      action,
    });
    const outcome = String(started?.outcome || "send");

    if (outcome === "accepted") {
      throw new AgencyInvitationError(
        "AGENCY_INVITATION_ALREADY_ACCEPTED",
        "The agency invitation has already been accepted.",
        409
      );
    }
    if (outcome === "already_invited") {
      throw new AgencyInvitationError(
        "AGENCY_INVITATION_ALREADY_SENT",
        "The agency has already been invited.",
        409
      );
    }
    if (outcome === "in_progress") {
      throw new AgencyInvitationError(
        "AGENCY_INVITATION_IN_PROGRESS",
        "The agency invitation is already being sent.",
        409
      );
    }

    let authUserId = started.auth_user_id || null;
    let authUserExists = Boolean(authUserId);
    let existingIdentity = started.auth_identity_preexisting === true;
    if (!authUserId && repository.findRecoverableAuthUser) {
      const recovered = await repository.findRecoverableAuthUser({
        email: started.admin_email,
        requestId: started.id,
        agencyId: started.agency_id,
      });
      authUserId = recovered?.authUserId || recovered || null;
      authUserExists = Boolean(authUserId);
      existingIdentity = recovered?.existingIdentity === true;
    }

    if (!authUserId && repository.findExistingAuthUser) {
      authUserId = await repository.findExistingAuthUser({ email: started.admin_email, agencyId: started.agency_id, requestId: started.id });
      authUserExists = Boolean(authUserId);
      existingIdentity = Boolean(authUserId);
    }

    let actionLink = "";
    try {
      const generated = await authAdmin.generateLink({
        type: authUserExists ? "recovery" : "invite",
        email: started.admin_email,
        options: inviteOptions(started, inviteRedirectUrl, existingIdentity),
      });
      if (generated?.error) throw generated.error;
      authUserId = authUserId || generated?.data?.user?.id || null;
      actionLink = generated?.data?.properties?.action_link || "";
      if (!authUserId || !actionLink) throw new Error("Auth invitation link was not generated.");
    } catch (error) {
      const code = authErrorCode(error);
      await repository.markFailed({ actorAuthUserId: actor.authUserId, requestId: started.id,
        code, stage: "AUTH_CREATE", lastSuccessfulOperation: "REQUEST_STARTED", metadata: { retryable: true } });
      throw new AgencyInvitationError(code, "The secure invitation link could not be generated.", 502);
    }

    try {
      await repository.recordAuthUser({
        actorAuthUserId: actor.authUserId,
        requestId: started.id,
        authUserId,
        existingIdentity,
      });
    } catch (error) {
      await repository.markFailed({
        actorAuthUserId: actor.authUserId,
        requestId: started.id,
        authUserId,
        code: "AGENCY_INVITATION_AUTH_USER_RECORD_FAILED",
        stage: "AUTH_USER_RECORD",
        lastSuccessfulOperation: "AUTH_USER_CREATED",
        metadata: { retryable: true },
      });
      throw new AgencyInvitationError(
        "AGENCY_INVITATION_AUTH_USER_RECORD_FAILED",
        "The invited identity could not be recorded.",
        503
      );
    }

    try {
      await repository.deliverInvitation({
        requestId: started.id,
        actionLink,
        companyId: started.company_id,
        agencyId: started.agency_id,
        recipient: started.admin_email,
        attemptCount: started.attempt_count || 0,
      });
    } catch (error) {
      await repository.markFailed({ actorAuthUserId: actor.authUserId, requestId: started.id, authUserId,
        code: "AGENCY_INVITATION_EMAIL_DELIVERY_FAILED", stage: "INVITATION_FINALIZATION",
        lastSuccessfulOperation: "AUTH_USER_RECORDED", metadata: { retryable: true } });
      throw new AgencyInvitationError("AGENCY_INVITATION_EMAIL_DELIVERY_FAILED", "The invitation reached the email provider handoff but delivery failed.", 502);
    }

    try {
      const completed = await repository.complete({
        actorAuthUserId: actor.authUserId,
        requestId: started.id,
        authUserId,
      });
      return { ok: true, request: completed };
    } catch (error) {
      await repository.markFailed({
        actorAuthUserId: actor.authUserId,
        requestId: started.id,
        authUserId,
        code: "AGENCY_INVITATION_FINALIZATION_FAILED",
        stage: "INVITATION_FINALIZATION",
        lastSuccessfulOperation: "AUTH_USER_RECORDED",
        metadata: { retryable: true },
      });
      throw new AgencyInvitationError(
        String(error?.message || "").includes("EMAIL_ALREADY_ASSIGNED")
          ? "AGENCY_INVITATION_EMAIL_ALREADY_ASSIGNED"
          : "AGENCY_INVITATION_FINALIZATION_FAILED",
        "The invitation could not be finalized.",
        503
      );
    }
  }

  if (action === "activate") {
    if (!actor?.authUserId) {
      throw new AgencyInvitationError(
        "AGENCY_INVITATION_UNAUTHORIZED",
        "Authentication is required.",
        401
      );
    }
    try {
      return {
        ok: true,
        request: await repository.activate(),
      };
    } catch (error) {
      await repository.markActivationFailed?.({
        code: "AGENCY_INVITATION_ACTIVATION_FAILED",
        stage: "ACTIVATION",
        lastSuccessfulOperation: "INVITATION_SENT",
      });
      throw new AgencyInvitationError(
        "AGENCY_INVITATION_ACTIVATION_FAILED",
        "The agency invitation could not be activated.",
        503
      );
    }
  }

  throw new AgencyInvitationError(
    "AGENCY_INVITATION_INVALID_ACTION",
    "Unsupported invitation action."
  );
}
