import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
const styleSource = await readFile(new URL("./style.css", import.meta.url), "utf8");
const migrationSource = await readFile(
  new URL("../supabase/migrations/20260811000100_housing_subscription_entitlements.sql", import.meta.url),
  "utf8",
);

test("public launch page exposes the Housing application", () => {
  assert.match(appSource, /kind: "housing"/);
  assert.match(appSource, /window\.location\.assign\("\/housing"\)/);
  assert.match(styleSource, /\.vf-public-path-grid[\s\S]*repeat\(4, minmax\(0, 1fr\)\)/);
});

test("Platform Owner form manages an independent Housing subscription", () => {
  for (const field of [
    "housing_access_enabled",
    "housing_plan",
    "housing_subscription_status",
    "housing_start_date",
    "housing_end_date",
    "housing_monthly_amount",
    "housing_users_limit",
  ]) {
    assert.match(appSource, new RegExp(field));
    assert.match(migrationSource, new RegExp(field));
  }
  assert.match(appSource, /Housing Invoice/);
  assert.match(appSource, /activePage === "Housing Subscriptions"/);
  assert.match(appSource, /Manage Company Plans/);
  assert.match(appSource, /subscription_type/);
});

test("database exposes a signed-in company Housing entitlement", () => {
  assert.match(migrationSource, /get_my_housing_entitlement/);
  assert.match(migrationSource, /housing_subscription_status in \('Active', 'Trial'\)/);
  assert.match(migrationSource, /grant execute[\s\S]*authenticated, service_role/);
});
