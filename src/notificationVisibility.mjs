export function isNotificationVisibleToWorkspace(notification, workspace = {}) {
  if (!notification || !workspace?.companyId) return false;
  if (String(notification.company_id || "") !== String(workspace.companyId)) return false;

  const role = String(workspace.role || "");
  const recipientRole = String(notification.recipient_role || "");
  const targetUserId = String(notification.user_id || "");
  const authUserId = String(workspace.authUserId || "");

  if (role === "Agency") {
    return recipientRole === "Agency" &&
      String(notification.agency_id || "") === String(workspace.agencyId || "") &&
      (!targetUserId || targetUserId === authUserId);
  }

  if (["Platform Owner", "Platform Accounts User", "Platform Support User"].includes(role)) {
    return targetUserId === authUserId || (!targetUserId && recipientRole === role);
  }

  return targetUserId === authUserId || (
    !targetUserId && ["", "Company", role].includes(recipientRole)
  );
}

export function filterNotificationsForWorkspace(notifications = [], workspace = {}) {
  return (notifications || []).filter((notification) =>
    isNotificationVisibleToWorkspace(notification, workspace)
  );
}

export function getNotificationCounts(notifications = [], workspace = {}) {
  const visible = filterNotificationsForWorkspace(notifications, workspace);
  return {
    rows: visible,
    total: visible.length,
    unread: visible.filter((item) => String(item.status || "Unread").toLowerCase() !== "read").length,
  };
}

export function admitRealtimeNotification(current = [], incoming, workspace = {}) {
  if (!isNotificationVisibleToWorkspace(incoming, workspace)) return current;
  return [incoming, ...current.filter((item) => String(item.id) !== String(incoming.id))];
}
