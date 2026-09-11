export const AGENCY_ADMINISTRATION_FUNCTION = "visaflow-agency-provisioner";

export const TENANT_COMPANY_SETTING_FIELDS = Object.freeze([
  "name",
  "domain",
  "notes",
]);

export const PLATFORM_COMPANY_SETTING_FIELDS = Object.freeze([
  ...TENANT_COMPANY_SETTING_FIELDS,
  "status",
  "subscription_plan",
  "subscription_status",
  "subscription_start",
  "subscription_end",
  "max_users",
]);

export const AGENCY_MAINTENANCE_FIELDS = Object.freeze([
  "name",
  "country",
  "contact_person",
  "email",
  "phone",
]);

const ERROR_MESSAGES = Object.freeze({
  WORKSPACE_ADMIN_UNAUTHORIZED:
    "You are not authorized to perform this administration action.",
  TENANT_MISMATCH:
    "The selected company does not match your authenticated workspace.",
  COMPANY_ID_REQUIRED: "Company is required.",
  COMPANY_NOT_FOUND: "Company was not found.",
  COMPANY_NAME_REQUIRED: "Company name is required.",
  COMPANY_MAX_USERS_INVALID: "Maximum users must be at least one.",
  COMPANY_SETTINGS_INVALID_FIELDS:
    "One or more company settings cannot be changed from this screen.",
  AGENCY_NOT_LINKED: "This agency is not linked to your company.",
  AGENCY_NOT_FOUND: "Agency was not found.",
  AGENCY_NAME_REQUIRED: "Agency name is required.",
  AGENCY_UPDATE_INVALID_FIELDS:
    "One or more agency fields cannot be changed from this screen.",
  SHARED_AGENCY_REQUIRES_MANUAL_REVIEW:
    "This agency is linked to multiple companies and requires manual review.",
  DUPLICATE_AGENCY_REQUIRES_MANUAL_REVIEW:
    "This agency matches another global record and requires manual review.",
});

function pickFields(source, allowedFields) {
  return Object.fromEntries(
    allowedFields
      .filter((key) => Object.prototype.hasOwnProperty.call(source || {}, key))
      .map((key) => [key, source[key]])
  );
}

export function buildCompanySettingsUpdate(form, { platform = false } = {}) {
  const fields = platform
    ? PLATFORM_COMPANY_SETTING_FIELDS
    : TENANT_COMPANY_SETTING_FIELDS;
  const update = pickFields(form, fields);
  if (Object.prototype.hasOwnProperty.call(update, "name")) {
    update.name = String(update.name || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(update, "domain")) {
    update.domain = String(update.domain || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(update, "notes")) {
    update.notes = String(update.notes || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(update, "max_users")) {
    update.max_users = Math.max(1, Number(update.max_users || 1));
  }
  return update;
}

export function buildAgencyMaintenanceUpdate(form) {
  return Object.fromEntries(
    AGENCY_MAINTENANCE_FIELDS.map((key) => [
      key,
      String(form?.[key] || "").trim(),
    ])
  );
}

export function getAgencyAdministrationErrorMessage(error) {
  const context = error?.context;
  const code =
    error?.code ||
    context?.code ||
    context?.error?.code ||
    error?.details?.code;
  return (
    ERROR_MESSAGES[code] ||
    error?.message ||
    "Agency administration action failed."
  );
}

export async function invokeAgencyAdministration(supabase, payload) {
  const { data, error } = await supabase.functions.invoke(
    AGENCY_ADMINISTRATION_FUNCTION,
    { body: payload }
  );
  if (error || data?.ok === false) {
    const nextError =
      error ||
      new Error(data?.message || "Agency administration action failed.");
    let responseBody = data;
    if (
      !responseBody?.code &&
      error?.context &&
      typeof error.context.json === "function"
    ) {
      try {
        responseBody = await error.context.json();
      } catch {
        // Preserve the SDK error when no structured Edge response is available.
      }
    }
    nextError.code = responseBody?.code || nextError.code;
    throw nextError;
  }
  return data?.company || data?.agency || data?.result || data || null;
}
