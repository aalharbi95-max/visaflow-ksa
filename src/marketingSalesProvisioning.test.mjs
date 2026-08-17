import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const edge = await readFile(new URL("../supabase/functions/visaflow-marketing-sales-manager/index.ts", import.meta.url), "utf8");
const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");

test("only an active platform owner can approve a marketing deal", () => {
  assert.match(edge, /actor\.role !== "Platform Owner"/);
  assert.match(edge, /\.eq\("status", "Pending"\)/);
  assert.match(edge, /action === "reject"/);
});

test("approval provisions and links a company without duplicate identities", () => {
  assert.match(edge, /\.from\("companies"\)\.insert/);
  assert.match(edge, /\.from\("platform_clients"\)\.insert/);
  assert.match(edge, /admin\.auth\.admin\.createUser/);
  assert.match(edge, /\.from\("users"\)\.insert/);
  assert.match(edge, /EMAIL_ALREADY_REGISTERED/);
  assert.match(edge, /platform_client_id: platformClient\.id/);
});

test("the approved company administrator receives a secure password setup route", () => {
  assert.match(edge, /resetPasswordForEmail\(adminEmail/);
  assert.match(edge, /auth_flow", "workspace"/);
  assert.match(edge, /recovery", "1"/);
});

test("the browser delegates owner approval to the protected sales manager", () => {
  assert.match(app, /functions\.invoke\("visaflow-marketing-sales-manager"/);
  assert.doesNotMatch(app, /Existing Platform Client ID \(optional now/);
});
