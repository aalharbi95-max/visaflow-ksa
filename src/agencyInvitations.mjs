export const AGENCY_INVITE_QUERY_PARAM = "agency_invite";

export function normalizeAgencyInviteEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function isValidAgencyInviteEmail(value) {
  const email = normalizeAgencyInviteEmail(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function getAgencyInviteUrlState(locationLike = {}) {
  const search = new URLSearchParams(locationLike.search || "");
  const hash = new URLSearchParams(String(locationLike.hash || "").replace(/^#/, ""));
  const token = String(search.get(AGENCY_INVITE_QUERY_PARAM) || "").trim();
  const inviteRequested = Boolean(token) || hash.get("type") === "invite";
  const error = search.get("error_description") || hash.get("error_description") || search.get("error") || hash.get("error") || "";

  let decodedError = "";
  if (error) {
    try {
      decodedError = decodeURIComponent(String(error).replaceAll("+", " "));
    } catch {
      decodedError = "The invitation link contains an invalid error response.";
    }
  }

  return {
    requested: inviteRequested,
    token,
    error: decodedError,
  };
}

export function clearAgencyInviteTokenFromUrl(locationLike = window.location, historyLike = window.history) {
  const url = new URL(locationLike.href);
  url.searchParams.delete(AGENCY_INVITE_QUERY_PARAM);
  historyLike.replaceState({}, "", url.toString());
}

export function clearAgencyInviteCallbackUrl(locationLike = window.location, historyLike = window.history) {
  const url = new URL(locationLike.href);
  [
    AGENCY_INVITE_QUERY_PARAM,
    "code",
    "token_hash",
    "type",
    "error",
    "error_code",
    "error_description",
  ].forEach((key) => url.searchParams.delete(key));

  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  ["access_token", "refresh_token", "expires_at", "expires_in", "token_type", "type", "error", "error_code", "error_description"]
    .forEach((key) => hash.delete(key));
  url.hash = hash.toString() ? `#${hash.toString()}` : "";
  historyLike.replaceState({}, "", url.toString());
}

const INVITATION_ERROR_MESSAGES = {
  unauthorized: "Your secure session has expired. Please sign in again.",
  forbidden: "Only an active company administrator can invite agency users.",
  agency_not_found: "The selected agency is unavailable or inactive.",
  agency_not_linked_to_company: "This agency is not linked to your company.",
  incompatible_role: "This email belongs to an internal or incompatible user and cannot be linked as an agency user.",
  agency_mismatch: "This agency user belongs to a different agency and cannot be reassigned.",
  inactive_agency_user: "This agency user is inactive. Reactivate the account through an approved administrator workflow before linking it.",
  auth_identity_mismatch: "The authentication identity does not match the agency user record. Contact platform support.",
  auth_directory_limit: "The authentication directory could not be verified safely. Contact platform support.",
  unlinked_auth_account: "This email already has an authentication account, but it is not a verified agency user.",
  trusted_auth_migration_required: "This email has a legacy agency record and a separate authentication account. A trusted administrator must migrate and verify the identity before access can be granted.",
  invitation_in_progress: "Another invitation request created this authentication account. Wait briefly, then retry.",
  resend_failed: "The invitation was renewed securely, but the replacement email could not be sent. Please retry.",
  duplicate_app_user: "More than one application user uses this email. Contact platform support before inviting.",
  invalid_email: "Enter a valid email address.",
  invalid_name: "Enter the user's full name.",
  rate_limited: "Too many invitation attempts. Please wait and try again.",
  invite_failed: "The secure invitation could not be sent. Please try again.",
};

export function getAgencyInvitationErrorMessage(code, fallback = "Unable to invite this agency user.") {
  return INVITATION_ERROR_MESSAGES[String(code || "").trim()] || fallback;
}

export function getAgencyInvitationSuccessMessage(mode) {
  if (mode === "already_linked") return "This agency user already has access to the company.";
  if (mode === "linked_existing") return "Existing agency user linked to this company. Their password was not changed.";
  if (mode === "resent") return "A replacement invitation was sent. Earlier invitation links are no longer valid.";
  return "Secure invitation sent. The user can set a password from the email link.";
}
