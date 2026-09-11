export function getRecoveryAccountType(session) {
  if (!session?.user?.id) return null;
  return session.user.user_metadata?.account_type === "candidate"
    ? "candidate"
    : "workspace";
}

export function getRecoveryCompletionPath(accountType) {
  return accountType === "candidate" ? "/?talent=1" : "/?login=1";
}

