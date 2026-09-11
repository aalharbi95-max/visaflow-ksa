export function getSafeAuthDiagnostics(session, currentUser, verifiedAuthUser = null) {
  const authUserId = verifiedAuthUser?.id || "";
  const currentAuthUserId = currentUser?.auth_user_id || "";

  return {
    auth_session_present: Boolean(session),
    auth_user_present: Boolean(authUserId),
    auth_user_matches_current_user: Boolean(
      authUserId && currentAuthUserId && String(authUserId) === String(currentAuthUserId)
    ),
  };
}

export function reportSafeAuthDiagnostics(
  session,
  currentUser,
  context,
  verifiedAuthUser = null,
  logger = console.info
) {
  logger("VisaFlow auth diagnostic", {
    context,
    ...getSafeAuthDiagnostics(session, currentUser, verifiedAuthUser),
  });
}

export async function getSessionWithSingleRefresh(auth) {
  const { data: sessionData, error: sessionError } = await auth.getSession();
  const existingSession = sessionData?.session || null;

  if (existingSession) {
    return { session: existingSession, error: null, refreshAttempted: false };
  }

  const { data: refreshedData, error: refreshError } = await auth.refreshSession();
  const refreshedSession = refreshedData?.session || null;
  return {
    session: refreshedSession,
    error: refreshedSession ? null : (refreshError || sessionError || null),
    refreshAttempted: true,
  };
}

export async function verifyWorkspaceAuthSession(auth) {
  const { session, error: sessionError, refreshAttempted } = await getSessionWithSingleRefresh(auth);
  const { data: userData, error: userError } = await auth.getUser();
  const authUser = userData?.user || null;
  const sessionUserMatchesVerifiedUser = Boolean(
    session?.user?.id &&
    authUser?.id &&
    String(session.user.id) === String(authUser.id)
  );

  return {
    session,
    authUser,
    error: sessionError || userError || null,
    refreshAttempted,
    isVerified: Boolean(session?.access_token && sessionUserMatchesVerifiedUser),
  };
}

const CONTINUITY_AUTH_EVENTS = new Set([
  "INITIAL_SESSION",
  "SIGNED_IN",
  "TOKEN_REFRESHED",
  "USER_UPDATED",
]);

export function classifyWorkspaceAuthTransition({
  event,
  currentAuthUserId = "",
  nextAuthUserId = "",
  workspaceReady = false,
}) {
  const currentId = String(currentAuthUserId || "");
  const nextId = String(nextAuthUserId || "");
  const isSameAuthenticatedUser = Boolean(currentId && nextId && currentId === nextId);
  const shouldPreserveWorkspace = Boolean(
    workspaceReady &&
    isSameAuthenticatedUser &&
    CONTINUITY_AUTH_EVENTS.has(event)
  );

  return {
    isSameAuthenticatedUser,
    shouldPreserveWorkspace,
    shouldResetPage: Boolean(
      event === "SIGNED_OUT" ||
      (nextId && currentId !== nextId)
    ),
  };
}
