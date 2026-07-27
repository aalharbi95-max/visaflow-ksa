export const AGENCY_PROVISIONING_FUNCTION = "visaflow-agency-provisioner";
export const AGENCY_PROVISIONING_STATUSES = Object.freeze([
  "Draft",
  "Provisioning",
  "Invitation Sent",
  "Active",
  "Failed",
  "Suspended",
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

const ERROR_MESSAGES = Object.freeze({
  EXISTING_AGENCY_REQUIRES_MANUAL_REVIEW:
    "An existing agency account requires manual review before it can be linked.",
  EMAIL_ALREADY_ASSIGNED: "This email is already assigned to another account.",
  MANUAL_REVIEW_REQUIRED: "Manual review is required before provisioning can continue.",
  DUPLICATE_ACTIVE_REQUEST: "An active provisioning request already exists for this email.",
  AGENCY_PROVISIONING_IN_PROGRESS:
    "This provisioning request is already in progress. Refresh the status before retrying.",
  FORBIDDEN: "You are not authorized to perform this action.",
  TENANT_MISMATCH: "The selected company does not match your authenticated workspace.",
  INVITATION_FAILED: "The invitation could not be sent. Retry is available.",
  INVITATION_DISABLED: "Invitation sending is disabled for this request.",
  INVITATION_RESEND_FAILED: "The invitation could not be resent. Retry is available.",
  RESEND_INVITATION_NOT_CONFIGURED:
    "Invitation resend is temporarily unavailable.",
  DATABASE_FINALIZATION_FAILED:
    "Provisioning was not finalized. Retry will continue the existing request safely.",
  COMPANY_SETTINGS_INVALID_FIELDS:
    "One or more company settings cannot be changed from this screen.",
  SHARED_AGENCY_REQUIRES_MANUAL_REVIEW:
    "This agency is linked to multiple companies and requires manual review.",
  DUPLICATE_AGENCY_REQUIRES_MANUAL_REVIEW:
    "This agency matches a duplicate global record and requires manual review.",
  AGENCY_NOT_LINKED: "This agency is not linked to your company.",
});

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

export function createAgencyIdempotencyKey(randomUUID = globalThis.crypto?.randomUUID) {
  if (typeof randomUUID !== "function") {
    throw new Error("Secure UUID generation is unavailable.");
  }
  return randomUUID.call(globalThis.crypto);
}

export function buildAgencyDraftPayload(form, idempotencyKey) {
  return {
    action: "create_draft",
    idempotency_key: idempotencyKey,
    agency_name: String(form?.name || "").trim(),
    country: String(form?.country || "").trim(),
    contact_person: String(form?.contact_person || "").trim(),
    admin_email: String(form?.admin_email || form?.email || "").trim().toLowerCase(),
    phone: String(form?.phone || "").trim(),
    permissions: Object.fromEntries(
      AGENCY_PERMISSION_KEYS.map((key) => [key, form?.permissions?.[key] === true])
    ),
    send_invitation: form?.send_invitation !== false,
  };
}

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

export function getAgencyProvisioningErrorMessage(error) {
  const context = error?.context;
  const code =
    error?.code ||
    context?.code ||
    context?.error?.code ||
    error?.details?.code;
  return ERROR_MESSAGES[code] || error?.message || "Agency provisioning failed.";
}

export async function invokeAgencyProvisioner(supabase, payload) {
  const { data, error } = await supabase.functions.invoke(
    AGENCY_PROVISIONING_FUNCTION,
    { body: payload }
  );
  if (error || data?.ok === false) {
    const nextError = error || new Error(data?.message || "Agency provisioning failed.");
    let responseBody = data;
    if (!responseBody?.code && error?.context && typeof error.context.json === "function") {
      try {
        responseBody = await error.context.json();
      } catch {
        // Keep the generic SDK error when the response body is unavailable.
      }
    }
    nextError.code = responseBody?.code || nextError.code;
    throw nextError;
  }
  return data?.request || data?.company || data?.agency || data?.result || data || null;
}

export function canCreateAgencyDraft(role) {
  return ["Admin", "Company Admin", "Recruitment Manager"].includes(role);
}

export function canProvisionAgency(role) {
  return ["Admin", "Company Admin"].includes(role);
}

export function shouldBlockAgencyWorkspace(user) {
  return (
    user?.role === "Agency" &&
    (String(user?.status || "").toLowerCase() !== "active" || user?.is_active !== true)
  );
}

export function isAgencyInvitationUrl(locationLike) {
  const url = new URL(locationLike?.href || "https://invalid.local/");
  return url.searchParams.get("agency_invite") === "1";
}

export function getAgencyInvitationLoginUrl(locationLike) {
  const url = new URL(locationLike?.href || "https://invalid.local/");
  for (const key of [
    "agency_invite",
    "access_token",
    "refresh_token",
    "expires_at",
    "expires_in",
    "token_type",
    "type",
  ]) {
    url.searchParams.delete(key);
  }
  url.hash = "";
  url.searchParams.set("login", "1");
  url.searchParams.set("agency_invite_complete", "1");
  return url.toString();
}

export function getAgencyInvitationRequestId(user) {
  if (user?.user_metadata?.account_type !== "agency") return "";
  return String(user?.user_metadata?.provisioning_request_id || "").trim();
}
