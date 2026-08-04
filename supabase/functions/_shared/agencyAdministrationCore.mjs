export class AgencyAdministrationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AgencyAdministrationError";
    this.code = code;
    this.status = status;
  }
}

const COMPANY_ADMIN_ROLES = new Set(["Admin", "Company Admin"]);
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

function requireAuthenticatedActor(actor) {
  if (!actor?.authUserId || !actor?.userId || actor?.isActive !== true) {
    throw new AgencyAdministrationError(
      "WORKSPACE_ADMIN_UNAUTHORIZED",
      "An active workspace user is required.",
      401
    );
  }
}

function requireCompanyAdministrator(actor) {
  requireAuthenticatedActor(actor);
  if (!actor?.companyId || !COMPANY_ADMIN_ROLES.has(actor.role)) {
    throw new AgencyAdministrationError(
      "WORKSPACE_ADMIN_UNAUTHORIZED",
      "An active company administrator is required.",
      403
    );
  }
}

function sanitizeUpdate(value, allowedFields, code) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Object.keys(value).length
  ) {
    throw new AgencyAdministrationError(
      code,
      "At least one settings field is required."
    );
  }
  const unknown = Object.keys(value).filter((key) => !allowedFields.has(key));
  if (unknown.length) {
    throw new AgencyAdministrationError(
      code,
      "One or more fields are not allowed."
    );
  }
  return { ...value };
}

function requireAgencyId(body) {
  const agencyId = String(body?.agency_id || "").trim();
  if (!agencyId) {
    throw new AgencyAdministrationError(
      "AGENCY_ID_REQUIRED",
      "Agency is required."
    );
  }
  return agencyId;
}

export const AGENCY_ADMINISTRATION_ACTIONS = Object.freeze([
  "update_company_settings",
  "update_agency",
  "unlink_agency",
]);

export async function runAgencyAdministrationAction({
  body,
  actor,
  repository,
}) {
  const action = String(body?.action || "").trim();

  if (action === "update_company_settings") {
    requireAuthenticatedActor(actor);
    const isPlatformOwner =
      actor.role === "Platform Owner" && !actor.companyId;
    if (!isPlatformOwner && !COMPANY_ADMIN_ROLES.has(actor.role)) {
      throw new AgencyAdministrationError(
        "WORKSPACE_ADMIN_UNAUTHORIZED",
        "Your role cannot update company settings.",
        403
      );
    }
    const targetCompanyId = isPlatformOwner
      ? String(body?.company_id || "").trim()
      : String(actor.companyId || "").trim();
    if (!targetCompanyId) {
      throw new AgencyAdministrationError(
        "COMPANY_ID_REQUIRED",
        "Company is required."
      );
    }
    if (
      !isPlatformOwner &&
      body?.company_id &&
      String(body.company_id) !== String(actor.companyId)
    ) {
      throw new AgencyAdministrationError(
        "TENANT_MISMATCH",
        "Company does not match your workspace.",
        403
      );
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
    requireCompanyAdministrator(actor);
    const updates = sanitizeUpdate(
      body?.agency,
      AGENCY_UPDATE_FIELDS,
      "AGENCY_UPDATE_INVALID_FIELDS"
    );
    return {
      ok: true,
      agency: await repository.updateAgency({
        actor,
        agencyId: requireAgencyId(body),
        updates,
      }),
    };
  }

  if (action === "unlink_agency") {
    requireCompanyAdministrator(actor);
    return {
      ok: true,
      result: await repository.unlinkAgency({
        actor,
        agencyId: requireAgencyId(body),
      }),
    };
  }

  throw new AgencyAdministrationError(
    "AGENCY_ADMINISTRATION_INVALID_ACTION",
    "Unsupported agency administration action."
  );
}
