import assert from "node:assert/strict";
import test from "node:test";
import {
  filterNotificationCenterRows,
  getNotificationFolderCounts,
  getNotificationMessage,
  selectNotification,
} from "./notificationCenter.mjs";

const row = (id, status, createdAt, extra = {}) => ({
  id,
  status,
  created_at: createdAt,
  type: "Workflow",
  title: `Notification ${id}`,
  message: `Message ${id}`,
  ...extra,
});

test("notification folders separate unread and read rows and keep newest first", () => {
  const rows = [
    row("old", "Unread", "2026-08-01T09:00:00Z"),
    row("read", "Read", "2026-08-03T09:00:00Z"),
    row("new", "Unread", "2026-08-02T09:00:00Z"),
  ];
  assert.deepEqual(getNotificationFolderCounts(rows), { unread: 2, read: 1 });
  assert.deepEqual(
    filterNotificationCenterRows(rows, { folder: "Unread" }).map(({ id }) => id),
    ["new", "old"],
  );
  assert.deepEqual(
    filterNotificationCenterRows(rows, { folder: "Read" }).map(({ id }) => id),
    ["read"],
  );
});

test("type and search filters use the visible notification content", () => {
  const rows = [
    row("agency", "Unread", "2026-08-02T09:00:00Z", { type: "Agency", title: "Agency response" }),
    row("visa", "Unread", "2026-08-03T09:00:00Z", { type: "Visa", data: { message: "Authorization acknowledged" }, message: "" }),
  ];
  assert.deepEqual(filterNotificationCenterRows(rows, { folder: "Unread", type: "Agency" }).map(({ id }) => id), ["agency"]);
  assert.deepEqual(filterNotificationCenterRows(rows, { folder: "Unread", search: "acknowledged" }).map(({ id }) => id), ["visa"]);
  assert.equal(getNotificationMessage(rows[1]), "Authorization acknowledged");
});

test("selection stays on the requested message and falls back to the first visible row", () => {
  const rows = [row("new", "Read", "2026-08-03T09:00:00Z"), row("old", "Read", "2026-08-02T09:00:00Z")];
  assert.equal(selectNotification(rows, "old").id, "old");
  assert.equal(selectNotification(rows, "missing").id, "new");
  assert.equal(selectNotification([], "missing"), null);
});
