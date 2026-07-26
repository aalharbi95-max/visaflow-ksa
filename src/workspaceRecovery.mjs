export const WORKSPACE_RECOVERY_SUCCESS_MESSAGE =
  "Password updated successfully. Sign in using your new password.";

export const WORKSPACE_RECOVERY_SUCCESS_KEY =
  "visaflow-workspace-recovery-success";

const WORKSPACE_IDENTITY_KEYS = Object.freeze([
  "visaflow_user",
  "visaflow_workspace_display",
  "visaflow_agency_company_id",
  "visaflow_agency_company_name",
  "visaflow_agency_access_id",
]);

const AUTH_CALLBACK_KEYS = Object.freeze([
  "access_token",
  "refresh_token",
  "expires_in",
  "expires_at",
  "token_type",
  "type",
  "code",
  "error",
  "error_code",
  "error_description",
  "auth_flow",
  "recovery",
]);

function toUrl(locationLike) {
  if (locationLike instanceof URL) return new URL(locationLike.toString());
  if (typeof locationLike === "string") return new URL(locationLike);

  const origin = locationLike?.origin || "http://localhost";
  const pathname = locationLike?.pathname || "/";
  return new URL(
    `${pathname}${locationLike?.search || ""}${locationLike?.hash || ""}`,
    origin
  );
}

export function getWorkspaceRecoveryUrlState(locationLike) {
  try {
    const url = toUrl(locationLike);
    const search = url.searchParams;
    const hash = new URLSearchParams(String(url.hash || "").replace(/^#/, ""));
    const requested =
      search.get("auth_flow") === "workspace" &&
      search.get("recovery") === "1";
    const errorType = search.get("error") || hash.get("error") || "";
    const errorCode = search.get("error_code") || hash.get("error_code") || "";
    const errorDescription =
      search.get("error_description") || hash.get("error_description") || "";

    return {
      requested,
      error:
        requested && (errorType || errorCode || errorDescription)
          ? {
              code: errorCode || errorType,
              message: errorDescription,
            }
          : null,
    };
  } catch {
    return { requested: false, error: null };
  }
}

export function buildWorkspaceRecoveryRedirectUrl(origin) {
  const url = new URL("/", origin);
  url.searchParams.set("login", "1");
  url.searchParams.set("auth_flow", "workspace");
  url.searchParams.set("recovery", "1");
  return url.toString();
}

export function getCleanWorkspaceRecoveryUrl(currentHref) {
  const url = toUrl(currentHref);
  AUTH_CALLBACK_KEYS.forEach((key) => url.searchParams.delete(key));
  url.searchParams.delete("talent");
  url.searchParams.set("login", "1");
  url.hash = "";
  return url;
}

export function clearWorkspaceRecoveryLocalState({
  localStorage,
  sessionStorage,
  workspaceAuthStorageKey = "visaflow-workspace-auth",
} = {}) {
  try {
    localStorage?.removeItem(workspaceAuthStorageKey);
    WORKSPACE_IDENTITY_KEYS.forEach((key) => localStorage?.removeItem(key));
  } catch {
    // Best-effort cleanup for restricted browser storage.
  }

  try {
    WORKSPACE_IDENTITY_KEYS.forEach((key) => sessionStorage?.removeItem(key));
  } catch {
    // Best-effort cleanup for restricted browser storage.
  }
}

export function getWorkspaceRecoveryErrorMessage(error, isArabic = false) {
  const value =
    `${error?.code || ""} ${error?.message || ""} ${error?.error_description || ""}`.toLowerCase();

  if (value.includes("expired") || value.includes("otp_expired")) {
    return isArabic
      ? "انتهت صلاحية رابط الاستعادة. اطلب رابطًا جديدًا."
      : "The recovery link has expired. Request a new link.";
  }
  if (
    value.includes("rate limit") ||
    value.includes("rate_limit") ||
    value.includes("over_email_send_rate_limit")
  ) {
    return isArabic
      ? "تم تجاوز حد إرسال الرسائل. انتظر قليلًا ثم حاول مرة أخرى."
      : "The email sending limit was reached. Wait and try again.";
  }
  if (
    value.includes("invalid") ||
    value.includes("flow_state_not_found") ||
    value.includes("access_denied")
  ) {
    return isArabic
      ? "رابط الاستعادة غير صالح. اطلب رابطًا جديدًا."
      : "The recovery link is invalid. Request a new link.";
  }
  return isArabic
    ? "تعذر إكمال استعادة كلمة المرور. اطلب رابطًا جديدًا."
    : "Password recovery could not be completed. Request a new link.";
}

export async function completeWorkspacePasswordRecovery({
  auth,
  userId,
  password,
  confirmation,
  hasRecoveryProof,
  clearRecoveryProof,
  cleanCallbackUrl,
  storeSuccessMessage,
}) {
  if (!userId || !hasRecoveryProof?.(userId)) {
    const error = new Error("The recovery link is invalid.");
    error.code = "invalid_token";
    throw error;
  }
  if (String(password || "").length < 12) {
    const error = new Error("Use a password with at least 12 characters.");
    error.code = "password_too_short";
    throw error;
  }
  if (password !== confirmation) {
    const error = new Error("The password confirmation does not match.");
    error.code = "password_mismatch";
    throw error;
  }

  const { error: updateError } = await auth.updateUser({ password });
  if (updateError) throw updateError;

  clearRecoveryProof?.(userId);
  cleanCallbackUrl?.();
  await auth.signOut({ scope: "local" });
  storeSuccessMessage?.(WORKSPACE_RECOVERY_SUCCESS_MESSAGE);

  return { message: WORKSPACE_RECOVERY_SUCCESS_MESSAGE };
}

export function storeWorkspaceRecoverySuccess(storage, message) {
  try {
    storage?.setItem(
      WORKSPACE_RECOVERY_SUCCESS_KEY,
      message || WORKSPACE_RECOVERY_SUCCESS_MESSAGE
    );
  } catch {
    // The redirect still succeeds if flash storage is unavailable.
  }
}

export function consumeWorkspaceRecoverySuccess(storage) {
  try {
    const message = storage?.getItem(WORKSPACE_RECOVERY_SUCCESS_KEY) || "";
    storage?.removeItem(WORKSPACE_RECOVERY_SUCCESS_KEY);
    return message;
  } catch {
    return "";
  }
}
