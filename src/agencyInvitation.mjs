export const AGENCY_INVITATION_FUNCTION = "visaflow-agency-provisioner";
export const AGENCY_INVITATION_EXPIRY_MS = 24 * 60 * 60 * 1000;
export const AGENCY_INVITATION_SENDING_TIMEOUT_MS = 5 * 60 * 1000;

const ERROR_MESSAGES = Object.freeze({
  AGENCY_INVITATION_ALREADY_SENT: "المكتب مدعو مسبقًا.",
  AGENCY_INVITATION_ALREADY_ACCEPTED: "المكتب مدعو مسبقًا.",
  AGENCY_INVITATION_IN_PROGRESS: "جارٍ إرسال دعوة المكتب بالفعل.",
  AGENCY_INVITATION_EMAIL_ALREADY_ASSIGNED:
    "البريد مستخدم في حساب آخر.",
  AGENCY_INVITATION_UNAUTHORIZED: "غير مخول.",
  AGENCY_INVITATION_USER_INACTIVE: "المستخدم غير فعال.",
  AGENCY_INVITATION_COMPANY_INACTIVE: "الشركة غير فعالة.",
  AGENCY_INVITATION_AGENCY_NOT_AVAILABLE:
    "الوكالة غير فعالة أو غير مرتبطة بشركتك.",
  AGENCY_INVITATION_EMAIL_REQUIRED:
    "يجب حفظ بريد صحيح للوكالة قبل إرسال الدعوة.",
  AGENCY_INVITATION_SEND_FAILED: "تعذر إرسال الدعوة.",
  AGENCY_INVITATION_FINALIZATION_FAILED: "تعذر إرسال الدعوة.",
});

const ACCEPTANCE_MESSAGES = Object.freeze({
  AGENCY_INVITATION_LINK_EXPIRED:
    "انتهى رابط دعوة المكتب. اطلب إعادة إرسال دعوة جديدة.",
  AGENCY_INVITATION_LINK_USED:
    "استُخدم رابط دعوة المكتب مسبقًا. سجّل الدخول بكلمة المرور التي عيّنتها.",
  AGENCY_INVITATION_LINK_INVALID:
    "رابط دعوة المكتب غير صالح.",
  AGENCY_INVITATION_ACCOUNT_NOT_LINKED:
    "الحساب غير مرتبط بوكالة فعالة.",
  AGENCY_INVITATION_ACTIVATION_FAILED:
    "تعذر إكمال تفعيل حساب المكتب.",
});

function callbackParams(locationLike) {
  const url = new URL(locationLike?.href || "https://invalid.local/");
  const hash = new URLSearchParams(String(url.hash || "").replace(/^#/, ""));
  return { url, hash };
}

export function getAgencyInvitationCallbackError(locationLike) {
  try {
    const { url, hash } = callbackParams(locationLike);
    const code = String(
      url.searchParams.get("error_code") ||
      hash.get("error_code") ||
      url.searchParams.get("error") ||
      hash.get("error") ||
      ""
    ).toLowerCase();
    const description = String(
      url.searchParams.get("error_description") ||
      hash.get("error_description") ||
      ""
    ).toLowerCase();
    const details = `${code} ${description}`;

    if (!code && !description) return null;
    if (
      details.includes("already used") ||
      details.includes("has been used") ||
      details.includes("replayed")
    ) {
      return "AGENCY_INVITATION_LINK_USED";
    }
    if (
      details.includes("expired") ||
      code === "otp_expired" ||
      code === "link_expired"
    ) {
      return "AGENCY_INVITATION_LINK_EXPIRED";
    }
    return "AGENCY_INVITATION_LINK_INVALID";
  } catch {
    return "AGENCY_INVITATION_LINK_INVALID";
  }
}

export function getAgencyInvitationAcceptanceMessage(error) {
  const code = typeof error === "string" ? error : error?.code;
  return (
    ACCEPTANCE_MESSAGES[code] ||
    ACCEPTANCE_MESSAGES.AGENCY_INVITATION_ACTIVATION_FAILED
  );
}

export function createAgencyInvitationAcceptanceError(code) {
  const error = new Error(getAgencyInvitationAcceptanceMessage(code));
  error.code = code;
  return error;
}

export function getCleanAgencyInvitationUrl(locationLike) {
  const { url } = callbackParams(locationLike);
  [
    "agency_invite",
    "type",
    "token",
    "token_hash",
    "code",
    "error",
    "error_code",
    "error_description",
  ].forEach((key) => url.searchParams.delete(key));
  url.hash = "";
  return url;
}

export function getAgencyInvitationStatus(request, now = Date.now()) {
  if (!request) return "Not Invited";
  const status = String(request.status || "");
  if (status === "Active") return "Accepted";
  if (status === "Failed") return "Failed";
  if (status === "Provisioning") {
    const updatedAt = Date.parse(request.updated_at || "");
    if (
      Number.isFinite(updatedAt) &&
      now - updatedAt >= AGENCY_INVITATION_SENDING_TIMEOUT_MS
    ) {
      return "Failed";
    }
    return "Invitation Sending";
  }
  if (status === "Draft") return "Not Invited";
  if (status === "Invitation Sent") {
    const sentAt = Date.parse(request.invitation_sent_at || "");
    if (
      !Number.isFinite(sentAt) ||
      now - sentAt >= AGENCY_INVITATION_EXPIRY_MS
    ) {
      return "Expired";
    }
    return "Invitation Sent";
  }
  return "Not Invited";
}

export function canSendAgencyInvitation(status) {
  return ["Not Invited", "Failed", "Expired"].includes(status);
}

export function buildAgencyInvitationPayload(agency) {
  return {
    action: "invite_existing",
    agency_id: String(agency?.id || "").trim(),
  };
}

export function isAgencyInvitationUrl(locationLike) {
  try {
    const url = new URL(locationLike?.href || "https://invalid.local/");
    const hash = new URLSearchParams(String(url.hash || "").replace(/^#/, ""));
    return (
      url.searchParams.get("type") === "invite" ||
      hash.get("type") === "invite" ||
      url.searchParams.get("agency_invite") === "1"
    );
  } catch {
    return false;
  }
}

export function getAgencyInvitationErrorMessage(error) {
  const code =
    error?.code ||
    error?.context?.code ||
    error?.context?.error?.code ||
    error?.details?.code;
  return ERROR_MESSAGES[code] || "تعذر إرسال الدعوة.";
}

export async function invokeAgencyInvitation(supabase, payload) {
  const { data, error } = await supabase.functions.invoke(
    AGENCY_INVITATION_FUNCTION,
    { body: payload }
  );
  if (error || data?.ok === false) {
    const nextError = error || new Error(data?.message || "Agency invitation failed.");
    let responseBody = data;
    if (!responseBody?.code && error?.context &&
        typeof error.context.json === "function") {
      try {
        responseBody = await error.context.json();
      } catch {
        // Preserve the SDK error when a structured Edge response is unavailable.
      }
    }
    nextError.code = responseBody?.code || nextError.code;
    throw nextError;
  }
  return data?.request || null;
}
