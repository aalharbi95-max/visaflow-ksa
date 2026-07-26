export const AUTH_AUDIENCE = Object.freeze({
  WORKSPACE: "workspace",
  TALENT: "talent",
  INTERVIEW: "interview",
});

export function getAuthAudience(user) {
  const accountType = String(user?.user_metadata?.account_type || "").trim().toLowerCase();
  if (accountType === "candidate") return AUTH_AUDIENCE.TALENT;
  if (accountType === "interview_portal") return AUTH_AUDIENCE.INTERVIEW;
  return AUTH_AUDIENCE.WORKSPACE;
}

export function authUserMatchesAudience(user, audience) {
  return Boolean(user?.id) && getAuthAudience(user) === audience;
}

export function toWorkspaceDisplayCache(context = {}) {
  const actor = context?.actor || context?.user || context;
  const company = context?.company || null;
  return {
    id: actor?.id || null,
    name: actor?.name || "",
    role: actor?.role || "",
    company_name: company?.name || actor?.company_name || "",
    agency_name: actor?.agency_name || "",
  };
}

export function selectRememberedAgencyWorkspace(workspaces = [], rememberedAccessId = "") {
  const active = workspaces.filter((item) => item?.access_id && item?.is_active !== false);
  return active.find((item) => String(item.access_id) === String(rememberedAccessId || "")) || active[0] || null;
}

export function assertSafeWorkspaceContext(context, authUserId) {
  const actor = context?.actor || context?.user || null;
  if (!actor?.auth_user_id || String(actor.auth_user_id) !== String(authUserId || "")) {
    throw new Error("Secure workspace identity could not be verified.");
  }
  return context;
}
