import assert from "node:assert/strict";
import test from "node:test";
import {
  getCompanyAdminPages,
  normalizeWorkspaceRole,
} from "./workspacePermissions.mjs";

test("Company Admin uses the full tenant Admin policy", () => {
  assert.equal(normalizeWorkspaceRole("Company Admin", ["Admin", "Viewer"]), "Admin");
});

test("Company Admin pages include operations and exclude platform administration", () => {
  const pages = [
    "Requests", "Agencies", "Visa Inventory", "Authorization", "Candidates",
    "Interviews", "Mobilization", "Reports", "Notifications", "Company Management",
    "Platform Dashboard", "Companies Management",
  ];
  const platformPages = ["Platform Dashboard", "Companies Management"];
  const visible = getCompanyAdminPages(pages, platformPages);

  for (const required of [
    "Requests", "Agencies", "Visa Inventory", "Authorization", "Candidates",
    "Interviews", "Mobilization", "Reports", "Notifications", "Company Management",
  ]) {
    assert.ok(visible.includes(required), `${required} must be visible`);
  }
  assert.equal(visible.some((page) => platformPages.includes(page)), false);
});
