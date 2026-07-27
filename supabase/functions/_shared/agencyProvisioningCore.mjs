export const AGENCY_PERMISSION_KEYS = Object.freeze([
  "can_view_requests",
  "can_upload_candidates",
  "can_update_candidates",
  "can_view_interviews",
]);

export const FAILURE_METADATA_KEYS = Object.freeze([
  "retryable",
  "auth_user_created",
  "auth_user_recorded",
  "auth_user_id",
  "failure_stage",
]);

export class ProvisioningError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ProvisioningError";
    this.code = code;
    this.status = status;
  }
}

const PROVISION_ROLES = new Set(["Admin", "Company Admin"]);
const DRAFT_ROLES = new Set([...PROVISION_ROLES, "Recruitment Manager"]);
const TENANT_COMPANY_FIELDS = new Set(["name", "domain", "notes"]);
const PLATFORM_COMPANY_FIELDS = new Set([
  ...TENANT_COMPANY_FIELDS,
  "status",
  "subscription_plan",
  "subscription_status",
  "subscription_start",
  "subscription_end",
  "max_users",
]);
const AGENCY_UPDATE_FIELDS = new Set([
  "name",
  "country",
  "contact_person",
  "email",
  "phone",
]);

export function sanitizePermissions(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProvisioningError("INVALID_PERMISSIONS", "Permissions must be an object.");
  }
  const unknown = Object.keys(value).filter((key) => !AGENCY_PERMISSION_KEYS.includes(key));
  if (unknown.length) {
    throw new ProvisioningError("INVALID_PERMISSIONS", "One or more permissions are not allowed.");
  }
  return Object.fromEntries(
    AGENCY_PERMISSION_KEYS.map((key) => [key, value[key] === true])
  );
}

export function sanitizeFailureMetadata(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProvisioningError(
      "INVALID_FAILURE_METADATA",
      "Failure metadata must be an object."
    );
  }
  const unknown = Object.keys(value).filter(
    (key) => !FAILURE_METADATA_KEYS.includes(key)
  );
  if (unknown.length) {
    throw new ProvisioningError(
      "INVALID_FAILURE_METADATA",
      "One or more failure metadata fields are not allowed."
    );
  }
  const sanitized = {};
  for (const key of ["retryable", "auth_user_created", "auth_user_recorded"]) {
    if (key in value) sanitized[key] = value[key] === true;
  }
  if (value.auth_user_id != null) {
    sanitized.auth_user_id = String(value.auth_user_id).slice(0, 64);
  }
  if (value.failure_stage != null) {
    sanitized.failure_stage = String(value.failure_stage).slice(0, 80);
  }
  return sanitized;
}

function requireActor(actor, allowedRoles, action) {
  if (!actor?.authUserId || !actor?.userId || !actor?.companyId || actor?.isActive !== true) {
    throw new ProvisioningError("UNAUTHORIZED", "An active company user is required.", 401);
  }
  if (!allowedRoles.has(actor.role)) {
    throw new ProvisioningError(
      "FORBIDDEN",
      `Your role cannot perform ${action}.`,
      403
    );
  }
}

function requireAuthenticatedActor(actor) {
  if (!actor?.authUserId || !actor?.userId || actor?.isActive !== true) {
    throw new ProvisioningError("UNAUTHORIZED", "An active workspace user is required.", 401);
  }
}

function sanitizeUpdate(value, allowedFields, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProvisioningError(code, "A settings object is required.");
  }
  const unknown = Object.keys(value).filter((key) => !allowedFields.has(key));
  if (unknown.length) {
    throw new ProvisioningError(code, "One or more fields are not allowed.");
  }
  if (!Object.keys(value).length) {
    throw new ProvisioningError(code, "At least one field is required.");
  }
  return { ...value };
}

function requireRequestId(body) {
  if (!body?.request_id) {
    throw new ProvisioningError("REQUEST_ID_REQUIRED", "Provisioning request ID is required.");
  }
  return String(body.request_id);
}

function validateTenantHint(body, actor) {
  if (body?.company_id && String(body.company_id) !== String(actor.companyId)) {
    throw new ProvisioningError(
      "TENANT_MISMATCH",
      "The requested company does not match the authenticated workspace.",
      403
    );
  }
}

function draftInput(body, actor) {
  validateTenantHint(body, actor);
  const agencyName = String(body?.agency_name || "").trim();
  const adminEmail = String(body?.admin_email || "").trim().toLowerCase();
  if (!agencyName) {
    throw new ProvisioningError("AGENCY_NAME_REQUIRED", "Agency name is required.");
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) {
    throw new ProvisioningError("ADMIN_EMAIL_INVALID", "A valid admin email is required.");
  }
  if (!body?.idempotency_key) {
    throw new ProvisioningError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency key is required.");
  }
  return {
    idempotencyKey: String(body.idempotency_key),
    actor,
    agencyName,
    country: String(body.country || "").trim() || null,
    contactPerson: String(body.contact_person || "").trim() || null,
    adminEmail,
    phone: String(body.phone || "").trim() || null,
    permissions: sanitizePermissions(body.permissions),
    sendInvitation: body.send_invitation !== false,
  };
}

function publicResult(result) {
  const source = result?.request || result || {};
  return {
    ok: true,
    request: {
      id: source.id,
      agency_id: source.agency_id || null,
      agency_name: source.agency_name,
      country: source.country || null,
      contact_person: source.contact_person || null,
      admin_email: source.admin_email,
      phone: source.phone || null,
      permissions: source.permissions || {},
      send_invitation: source.send_invitation !== false,
      status: source.status,
      attempt_count: source.attempt_count || 0,
      failure_code: source.failure_code || null,
      invitation_sent_at: source.invitation_sent_at || null,
      activated_at: source.activated_at || null,
      created_at: source.created_at || null,
      updated_at: source.updated_at || null,
    },
  };
}

function inviteOptions(request, inviteRedirectUrl) {
  return {
    redirectTo: inviteRedirectUrl,
    data: {
      account_type: "agency",
      provisioning_request_id: request.id,
    },
  };
}

export async function runAgencyProvisioningAction({
  body,
  actor,
  repository,
  authAdmin,
  inviteRedirectUrl,
}) {
  const action = String(body?.action || "").trim();

  if (action === "update_company_settings") {
    requireAuthenticatedActor(actor);
    const isPlatformOwner =
      actor.role === "Platform Owner" && !actor.companyId;
    if (!isPlatformOwner && !PROVISION_ROLES.has(actor.role)) {
      throw new ProvisioningError("FORBIDDEN", "Your role cannot update company settings.", 403);
    }
    const targetCompanyId = isPlatformOwner
      ? String(body?.company_id || "")
      : String(actor.companyId || "");
    if (!targetCompanyId) {
      throw new ProvisioningError("COMPANY_ID_REQUIRED", "Company is required.");
    }
    if (
      !isPlatformOwner &&
      body?.company_id &&
      String(body.company_id) !== String(actor.companyId)
    ) {
      throw new ProvisioningError("TENANT_MISMATCH", "Company does not match your workspace.", 403);
    }
    const settings = sanitizeUpdate(
      body?.settings,
      isPlatformOwner ? PLATFORM_COMPANY_FIELDS : TENANT_COMPANY_FIELDS,
      "COMPANY_SETTINGS_INVALID_FIELDS"
    );
    return {
      ok: true,
      company: await repository.updateCompanySettings({
        actor,
        targetCompanyId,
        settings,
      }),
    };
  }

  if (action === "update_agency") {
    requireActor(actor, PROVISION_ROLES, action);
    validateTenantHint(body, actor);
    const agencyId = requireRequestId({ request_id: body?.agency_id });
    const updates = sanitizeUpdate(
      body?.agency,
      AGENCY_UPDATE_FIELDS,
      "AGENCY_UPDATE_INVALID_FIELDS"
    );
    return {
      ok: true,
      agency: await repository.updateAgency({ actor, agencyId, updates }),
    };
  }

  if (action === "unlink_agency") {
    requireActor(actor, PROVISION_ROLES, action);
    validateTenantHint(body, actor);
    return {
      ok: true,
      result: await repository.unlinkAgency({
        actor,
        agencyId: requireRequestId({ request_id: body?.agency_id }),
      }),
    };
  }

  if (action === "create_draft") {
    requireActor(actor, DRAFT_ROLES, action);
    return publicResult(await repository.createDraft(draftInput(body, actor)));
  }

  if (action === "provision") {
    requireActor(actor, PROVISION_ROLES, action);
    validateTenantHint(body, actor);
    const started = await repository.begin({
      requestId: requireRequestId(body),
      actor,
      permissions: body.permissions ? sanitizePermissions(body.permissions) : undefined,
    });
    const request = started?.request || started;
    if (["Invitation Sent", "Active"].includes(request.status)) return publicResult(request);
    if (request.send_invitation === false) {
      throw new ProvisioningError(
        "INVITATION_DISABLED",
        "Invitation sending is disabled for this provisioning request.",
        409
      );
    }

    let authUserId = request.auth_user_id || null;
    if (!authUserId) {
      try {
        const invited = await authAdmin.inviteUserByEmail(
          request.admin_email,
          inviteOptions(request, inviteRedirectUrl)
        );
        authUserId = invited?.data?.user?.id;
        if (!authUserId) throw new Error("Auth invitation did not return a user.");
      } catch (error) {
        await repository.markFailed({
          requestId: request.id,
          actor,
          code: "INVITATION_FAILED",
          metadata: sanitizeFailureMetadata({
            retryable: true,
            failure_stage: "invite_user",
          }),
        });
        throw new ProvisioningError(
          "INVITATION_FAILED",
          "The invitation could not be sent. Retry is available.",
          502
        );
      }
      try {
        await repository.recordAuthUser({ requestId: request.id, actor, authUserId });
      } catch {
        await repository.markFailed({
          requestId: request.id,
          actor,
          code: "DATABASE_FINALIZATION_FAILED",
          metadata: sanitizeFailureMetadata({
            retryable: true,
            auth_user_created: true,
            auth_user_id: authUserId,
            failure_stage: "record_auth_user",
          }),
        });
        throw new ProvisioningError(
          "DATABASE_FINALIZATION_FAILED",
          "The invitation was created but provisioning was not finalized. Retry safely.",
          503
        );
      }
    }

    try {
      return publicResult(
        await repository.completeInvitation({ requestId: request.id, actor, authUserId })
      );
    } catch {
      await repository.markFailed({
        requestId: request.id,
        actor,
        code: "DATABASE_FINALIZATION_FAILED",
        metadata: sanitizeFailureMetadata({
          retryable: true,
          auth_user_recorded: true,
          auth_user_id: authUserId,
          failure_stage: "complete_invitation",
        }),
      });
      throw new ProvisioningError(
        "DATABASE_FINALIZATION_FAILED",
        "The invitation was created but provisioning was not finalized. Retry safely.",
        503
      );
    }
  }

  if (action === "resend_invitation") {
    requireActor(actor, PROVISION_ROLES, action);
    validateTenantHint(body, actor);
    requireRequestId(body);
    throw new ProvisioningError(
      "RESEND_INVITATION_NOT_CONFIGURED",
      "Invitation resend is not configured.",
      503
    );
  }

  if (action === "activate") {
    if (!actor?.authUserId) {
      throw new ProvisioningError("UNAUTHORIZED", "Authentication is required.", 401);
    }
    return publicResult(await repository.activate({ actor }));
  }

  if (action === "get_status") {
    if (!actor?.authUserId) {
      throw new ProvisioningError("UNAUTHORIZED", "Authentication is required.", 401);
    }
    validateTenantHint(body, actor);
    return publicResult(
      await repository.getStatus({ requestId: requireRequestId(body), actor })
    );
  }

  throw new ProvisioningError("INVALID_ACTION", "Unsupported provisioning action.");
}
