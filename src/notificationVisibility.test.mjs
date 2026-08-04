import test from "node:test";
import assert from "node:assert/strict";
import {
  admitRealtimeNotification,
  filterNotificationsForWorkspace,
  getNotificationCounts,
} from "./notificationVisibility.mjs";

const agencyWorkspace = { companyId: "company-a", agencyId: "agency-a", authUserId: "auth-a", role: "Agency" };
const companyWorkspace = { companyId: "company-a", authUserId: "admin-a", role: "Company Admin" };
const row = (overrides = {}) => ({ id: crypto.randomUUID(), company_id: "company-a", agency_id: null, recipient_role: "Company", user_id: null, status: "Unread", ...overrides });

test("agency sees only Agency notifications for its office and active company", () => {
  const allowed = row({ agency_id: "agency-a", recipient_role: "Agency" });
  const company = row({ agency_id: "agency-a", recipient_role: "Company" });
  const legacyCompany = row({ agency_id: "agency-a", recipient_role: null });
  const otherAgency = row({ agency_id: "agency-b", recipient_role: "Agency" });
  const otherCompany = row({ company_id: "company-b", agency_id: "agency-a", recipient_role: "Agency" });
  assert.deepEqual(filterNotificationsForWorkspace([allowed, company, legacyCompany, otherAgency, otherCompany], agencyWorkspace), [allowed]);
});

test("company excludes Agency notifications unless explicitly addressed to the user", () => {
  const company = row();
  const legacyCompany = row({ recipient_role: null });
  const agency = row({ recipient_role: "Agency", agency_id: "agency-a" });
  const explicit = row({ recipient_role: "Agency", agency_id: "agency-a", user_id: "admin-a" });
  assert.deepEqual(filterNotificationsForWorkspace([company, legacyCompany, agency, explicit], companyWorkspace), [company, legacyCompany, explicit]);
});

test("total and unread counts use only visible rows", () => {
  const visibleUnread = row({ agency_id: "agency-a", recipient_role: "Agency" });
  const visibleRead = row({ agency_id: "agency-a", recipient_role: "Agency", status: "Read" });
  const hidden = row({ agency_id: "agency-a", recipient_role: "Company" });
  assert.deepEqual(getNotificationCounts([visibleUnread, visibleRead, hidden], agencyWorkspace), {
    rows: [visibleUnread, visibleRead], total: 2, unread: 1,
  });
});

test("realtime admission applies the same tenant and recipient isolation", () => {
  const allowed = row({ agency_id: "agency-a", recipient_role: "Agency" });
  const company = row({ agency_id: "agency-a", recipient_role: "Company" });
  const crossCompany = row({ company_id: "company-b", agency_id: "agency-a", recipient_role: "Agency" });
  assert.deepEqual(admitRealtimeNotification([], company, agencyWorkspace), []);
  assert.deepEqual(admitRealtimeNotification([], crossCompany, agencyWorkspace), []);
  assert.deepEqual(admitRealtimeNotification([], allowed, agencyWorkspace), [allowed]);
});
