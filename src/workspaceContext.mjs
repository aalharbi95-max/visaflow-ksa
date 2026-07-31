export const WORKSPACE_CONTEXT_RPC = "get_authenticated_workspace_context";

export const WORKSPACE_LOGIN_MESSAGES = Object.freeze({
  INVALID_CREDENTIALS: "Invalid email or password",
  ACCOUNT_NOT_LINKED: "Account is not linked to an active workspace.",
  USER_INACTIVE: "Your account is inactive.",
  COMPANY_INACTIVE: "Your company account is inactive.",
  UNAVAILABLE: "Unable to load workspace. Please contact support.",
});

export class WorkspaceContextError extends Error {
  constructor(code, cause = null) {
    super(WORKSPACE_LOGIN_MESSAGES[code] || WORKSPACE_LOGIN_MESSAGES.UNAVAILABLE);
    this.name = "WorkspaceContextError";
    this.code = code;
    this.cause = cause;
  }
}

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

export function validateWorkspaceContext(context, authUserId) {
  const actor = context?.actor || null;
  if (!actor?.id || !actor?.auth_user_id) {
    throw new WorkspaceContextError("ACCOUNT_NOT_LINKED");
  }
  if (String(actor.auth_user_id) !== String(authUserId || "")) {
    throw new WorkspaceContextError("UNAVAILABLE");
  }
  if (normalized(actor.status) !== "active" || actor.is_active === false) {
    throw new WorkspaceContextError("USER_INACTIVE");
  }

  const company = context?.company || null;
  if (actor.company_id) {
    if (!company || String(company.id) !== String(actor.company_id)) {
      throw new WorkspaceContextError("ACCOUNT_NOT_LINKED");
    }
    if (
      normalized(company.status) !== "active" ||
      !["active", "trial", "grace period"].includes(
        normalized(company.subscription_status || "active")
      )
    ) {
      throw new WorkspaceContextError("COMPANY_INACTIVE");
    }
    if (company.subscription_end) {
      const subscriptionEnd = new Date(company.subscription_end);
      subscriptionEnd.setHours(23, 59, 59, 999);
      if (!Number.isNaN(subscriptionEnd.getTime()) && subscriptionEnd < new Date()) {
        throw new WorkspaceContextError("COMPANY_INACTIVE");
      }
    }
  } else if (company) {
    throw new WorkspaceContextError("UNAVAILABLE");
  }

  const agency = context?.agency || null;
  if (normalized(actor.role) === "agency") {
    if (
      actor.company_id ||
      !actor.agency_id ||
      !agency ||
      String(agency.id) !== String(actor.agency_id)
    ) {
      throw new WorkspaceContextError("ACCOUNT_NOT_LINKED");
    }
    if (normalized(agency.status) !== "active") {
      throw new WorkspaceContextError("USER_INACTIVE");
    }
  } else if (agency) {
    throw new WorkspaceContextError("UNAVAILABLE");
  }

  return { ...context, actor, company, agency };
}

export async function loadAuthenticatedWorkspaceContext(client, authUserId) {
  let result;
  try {
    result = await client.rpc(WORKSPACE_CONTEXT_RPC);
  } catch (error) {
    throw new WorkspaceContextError("UNAVAILABLE", error);
  }

  if (result?.error) {
    const safeMessage = normalized(result.error.message);
    if (safeMessage.includes("account not linked")) {
      throw new WorkspaceContextError("ACCOUNT_NOT_LINKED", result.error);
    }
    throw new WorkspaceContextError("UNAVAILABLE", result.error);
  }

  return validateWorkspaceContext(result?.data, authUserId);
}

export function getWorkspaceLoginErrorMessage(phase, error) {
  if (phase === "auth") return WORKSPACE_LOGIN_MESSAGES.INVALID_CREDENTIALS;
  if (error instanceof WorkspaceContextError) return error.message;
  return WORKSPACE_LOGIN_MESSAGES.UNAVAILABLE;
}
