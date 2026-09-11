export function getNotificationStatus(item) {
  return String(item?.status || "Unread").toLowerCase() === "read" ? "Read" : "Unread";
}

export function getNotificationTitle(item) {
  const payload = item?.data || {};
  return item?.title || payload.title || item?.type || payload.type || "Notification";
}

export function getNotificationMessage(item) {
  const payload = item?.data || {};
  return (
    item?.message ||
    payload.message ||
    payload.provider_message ||
    payload.recommendation ||
    payload.candidate_name ||
    "No additional details were provided."
  );
}

export function getNotificationType(item) {
  return item?.type || item?.data?.type || "Notification";
}

export function isNotificationSchemaCacheMiss(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return code === "PGRST202" || (
    message.includes("schema cache") &&
    message.includes("notification_center_list_v1")
  );
}

export function getNotificationFolderCounts(notifications = []) {
  return notifications.reduce((counts, item) => {
    counts[getNotificationStatus(item).toLowerCase()] += 1;
    return counts;
  }, { unread: 0, read: 0 });
}

export function filterNotificationCenterRows(
  notifications = [],
  { folder = "Unread", type = "All", search = "" } = {},
) {
  const keyword = String(search || "").trim().toLowerCase();
  return notifications
    .filter((item) => getNotificationStatus(item) === folder)
    .filter((item) => type === "All" || getNotificationType(item) === type)
    .filter((item) => {
      if (!keyword) return true;
      return [
        getNotificationType(item),
        getNotificationTitle(item),
        getNotificationMessage(item),
        item?.recipient_role,
        item?.priority,
      ].join(" ").toLowerCase().includes(keyword);
    })
    .sort((a, b) => {
      const createdA = Date.parse(a?.created_at || "") || 0;
      const createdB = Date.parse(b?.created_at || "") || 0;
      return createdB - createdA;
    });
}

export function selectNotification(rows = [], selectedId = "") {
  return rows.find((item) => String(item?.id) === String(selectedId)) || rows[0] || null;
}
