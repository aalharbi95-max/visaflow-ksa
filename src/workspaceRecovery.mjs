export const WORKSPACE_RECOVERY_SUCCESS_MESSAGE =
  "Password updated successfully. Sign in using your new password.";

const COMPLETED_KEY = "visaflow-workspace-recovery-completed";
const WORKSPACE_IDENTITY_KEYS = [
  "visaflow_user",
  "visaflow_workspace_display",
  "visaflow_agency_company_id",
  "visaflow_agency_company_name",
  "visaflow_agency_access_id",
];
const CALLBACK_KEYS = [
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
  "workspace_recovery",
];

function toUrl(locationLike) {
  if (locationLike instanceof URL) return new URL(locationLike.toString());
  if (typeof locationLike === "string") return new URL(locationLike);
  return new URL(
    `${locationLike?.pathname || "/"}${locationLike?.search || ""}${locationLike?.hash || ""}`,
    locationLike?.origin || "http://localhost"
  );
}

export function getWorkspaceRecoveryUrlState(locationLike) {
  try {
    const url = toUrl(locationLike);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    const callbackType =
      url.searchParams.get("type") || hash.get("type") || "";
    const requested =
      (url.searchParams.get("auth_flow") === "workspace" &&
        url.searchParams.get("recovery") === "1") ||
      url.searchParams.get("workspace_recovery") === "1" ||
      callbackType === "recovery";
    const errorType = url.searchParams.get("error") || hash.get("error") || "";
    const errorCode =
      url.searchParams.get("error_code") || hash.get("error_code") || "";
    const errorDescription =
      url.searchParams.get("error_description") ||
      hash.get("error_description") ||
      "";

    return {
      requested,
      error:
        requested && (errorType || errorCode || errorDescription)
          ? { code: errorCode || errorType, message: errorDescription }
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
  CALLBACK_KEYS.forEach((key) => url.searchParams.delete(key));
  url.searchParams.delete("talent");
  url.searchParams.set("login", "1");
  url.hash = "";
  return url;
}

export function clearWorkspaceRecoveryLocalState({
  localStorage,
  sessionStorage,
  workspaceAuthStorageKey = "visaflow-workspace-auth",
  preserveAuthSession = false,
} = {}) {
  try {
    if (!preserveAuthSession) {
      localStorage?.removeItem(workspaceAuthStorageKey);
    }
    WORKSPACE_IDENTITY_KEYS.forEach((key) => localStorage?.removeItem(key));
  } catch {
    // Browser storage cleanup is best effort.
  }
  try {
    WORKSPACE_IDENTITY_KEYS.forEach((key) => sessionStorage?.removeItem(key));
  } catch {
    // Browser storage cleanup is best effort.
  }
}

export function getWorkspaceRecoveryErrorMessage(error, isArabic = false) {
  const value =
    `${error?.code || ""} ${error?.message || ""} ${error?.error_description || ""}`.toLowerCase();
  if (value.includes("otp_expired") || value.includes("expired")) {
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
    value.includes("access_denied") ||
    value.includes("flow_state_not_found")
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

  return {
    success: true,
    passwordUpdated: true,
    message: WORKSPACE_RECOVERY_SUCCESS_MESSAGE,
  };
}

export async function finalizeWorkspaceRecoverySuccess({
  auth,
  localStorage,
  sessionStorage,
  clearRecoveryProof,
  cleanCallbackUrl,
  storeSuccessMessage,
  redirectToLogin,
  logger = console.warn,
}) {
  const errors = [];
  const attempt = async (step, action) => {
    if (typeof action !== "function") return;
    try {
      const result = await action();
      if (result?.error) throw result.error;
    } catch (error) {
      errors.push({ step, error });
      logger?.(`Workspace recovery ${step} failed after password update`, error);
    }
  };

  await attempt("success message storage", () =>
    storeSuccessMessage?.(WORKSPACE_RECOVERY_SUCCESS_MESSAGE)
  );
  await attempt("proof cleanup", clearRecoveryProof);
  await attempt("URL cleanup", cleanCallbackUrl);

  let signOutFailed = false;
  try {
    const result = await auth?.signOut?.({ scope: "local" });
    if (result?.error) throw result.error;
  } catch (error) {
    signOutFailed = true;
    errors.push({ step: "local sign-out", error });
    logger?.(
      "Workspace recovery local sign-out failed after password update",
      error
    );
  }

  let sessionRemained = true;
  try {
    const { data, error } = (await auth?.getSession?.()) || {};
    if (error) throw error;
    sessionRemained = Boolean(data?.session);
  } catch (error) {
    errors.push({ step: "session verification", error });
    logger?.(
      "Workspace recovery session verification failed after password update",
      error
    );
  }

  const usedManualCleanup = signOutFailed || sessionRemained;
  if (usedManualCleanup) {
    await attempt("manual workspace cleanup", () =>
      clearWorkspaceRecoveryLocalState({ localStorage, sessionStorage })
    );
  } else {
    // Auth storage is already gone, but workspace identity metadata must also
    // be removed before the login page can render.
    await attempt("workspace identity cleanup", () =>
      clearWorkspaceRecoveryLocalState({ localStorage, sessionStorage })
    );
  }

  await attempt("login redirect", redirectToLogin);

  return {
    success: true,
    passwordUpdated: true,
    sessionVerifiedAbsent: !sessionRemained,
    workspaceSessionBlocked: !sessionRemained || usedManualCleanup,
    usedManualCleanup,
    redirected: !errors.some(({ step }) => step === "login redirect"),
    cleanupErrors: errors.map(({ step }) => step),
  };
}

export function storeWorkspaceRecoverySuccess(storage, message) {
  try {
    storage?.setItem(
      COMPLETED_KEY,
      message || WORKSPACE_RECOVERY_SUCCESS_MESSAGE
    );
  } catch {
    // Redirect still succeeds without flash storage.
  }
}

export function consumeWorkspaceRecoverySuccess(storage) {
  try {
    const message = storage?.getItem(COMPLETED_KEY) || "";
    storage?.removeItem(COMPLETED_KEY);
    return message;
  } catch {
    return "";
  }
}

export function getWorkspaceRecoveryLoginGuard({
  storage,
  locationLike,
} = {}) {
  try {
    const url = toUrl(locationLike);
    if (url.searchParams.get("login") !== "1") {
      return { active: false, message: "" };
    }
    const message = storage?.getItem(COMPLETED_KEY) || "";
    if (!message) return { active: false, message: "" };
    storage?.removeItem(COMPLETED_KEY);
    return { active: true, message };
  } catch {
    return { active: false, message: "" };
  }
}
