export function classifyAgencyInvitation({ appUser, authUser, agencyId }) {
  if (appUser && String(appUser.role || "") !== "Agency") {
    return { allowed: false, error: "incompatible_role" };
  }
  if (appUser && (appUser.status !== "Active" || appUser.is_active !== true)) {
    return { allowed: false, error: "inactive_agency_user" };
  }
  if (appUser?.agency_id && String(appUser.agency_id) !== String(agencyId)) {
    return { allowed: false, error: "agency_mismatch" };
  }
  if (authUser && !appUser) {
    return { allowed: false, error: "unlinked_auth_account" };
  }
  if (
    authUser &&
    appUser?.auth_user_id &&
    String(appUser.auth_user_id) !== String(authUser.id)
  ) {
    return { allowed: false, error: "auth_identity_mismatch" };
  }
  if (!authUser && appUser?.auth_user_id) {
    return { allowed: false, error: "auth_identity_mismatch" };
  }

  return {
    allowed: true,
    mode: authUser ? "link_existing" : "invite_new",
  };
}
