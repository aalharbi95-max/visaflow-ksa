import { buildWorkspaceRecoveryRedirectUrl } from "./workspaceRecovery.mjs";

const COMPANY_USER_MANAGER_FUNCTION = "visaflow-user-manager";

export const COMPANY_USER_ROLES = Object.freeze([
  "Admin",
  "CEO",
  "Operations Manager",
  "Project Manager",
  "Recruitment Director",
  "Recruitment Manager",
  "Recruitment Officer",
  "Visa Team",
  "Viewer",
]);

export const PLATFORM_USER_ROLES = Object.freeze([
  "Platform Owner",
  "Platform Accounts User",
  "Platform Support User",
  "Platform Marketing User",
]);

export function buildPlatformUserMutation(form, editingId = null) {
  const name = String(form?.name || "").trim();
  const email = String(form?.email || "").trim().toLowerCase();
  const role = String(form?.role || "Platform Marketing User").trim();
  const status = String(form?.status || "Active").trim();
  if (!name) throw new Error("User name is required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("A valid email address is required.");
  if (!PLATFORM_USER_ROLES.includes(role)) throw new Error("Select a valid platform role.");
  if (!["Active", "Inactive"].includes(status)) throw new Error("Select a valid user status.");
  return editingId
    ? { action: "update_platform_user", user_id: String(editingId), name, email, role, status }
    : { action: "invite_platform_user", name, email, role };
}

export function buildCompanyUserMutation(form, editingId = null) {
  const name = String(form?.name || "").trim();
  const email = String(form?.email || "").trim().toLowerCase();
  const role = String(form?.role || "Viewer").trim();
  const status = String(form?.status || "Active").trim();

  if (!name) throw new Error("User name is required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("A valid email address is required.");
  if (!COMPANY_USER_ROLES.includes(role)) throw new Error("Select a valid company role.");
  if (!["Active", "Inactive"].includes(status)) throw new Error("Select a valid user status.");

  return editingId
    ? { action: "update_user", user_id: String(editingId), name, email, role, status }
    : { action: "invite_user", name, email, role };
}

export async function invokeCompanyUserManager(supabase, body) {
  const { data, error } = await supabase.functions.invoke(COMPANY_USER_MANAGER_FUNCTION, { body });
  if (error || data?.ok === false) {
    const code = String(data?.code || data?.error || error?.message || "COMPANY_USER_ACTION_FAILED");
    const failure = new Error(getCompanyUserManagerError({ code }));
    failure.code = code;
    throw failure;
  }
  return data || { ok: true };
}

export function getCompanyUserManagerError(error) {
  const code = String(error?.code || error?.message || "").toUpperCase();
  if (code.includes("EMAIL_ALREADY_ASSIGNED")) return "This email is already assigned to another account or company.";
  if (code.includes("USER_LIMIT_REACHED")) return "The company user limit has been reached. Increase the subscription user limit first.";
  if (code.includes("LAST_ADMIN")) return "The final active company administrator cannot be disabled or downgraded.";
  if (code.includes("SELF_DEACTIVATION")) return "You cannot deactivate your own account.";
  if (code.includes("NOT_FOUND")) return "The selected user no longer exists in this company.";
  if (code.includes("UNAUTHORIZED") || code.includes("FORBIDDEN")) return "You do not have permission to manage company users.";
  if (code.includes("INVITATION_SEND_FAILED")) return "The account was created, but the invitation email could not be sent. Use Resend Invitation.";
  return "The user action could not be completed. Please try again.";
}

export async function sendCompanyUserSetupEmail(supabase, email, origin = window.location.origin) {
  const { error } = await supabase.auth.resetPasswordForEmail(
    String(email || "").trim().toLowerCase(),
    { redirectTo: buildWorkspaceRecoveryRedirectUrl(origin) }
  );
  if (error) {
    const failure = new Error("INVITATION_SEND_FAILED");
    failure.code = "INVITATION_SEND_FAILED";
    throw failure;
  }
}
