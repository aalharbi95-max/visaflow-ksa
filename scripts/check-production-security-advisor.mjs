import assert from "node:assert/strict";

const token = process.env.SUPABASE_ACCESS_TOKEN || "";
const projectRef = process.env.SUPABASE_PROJECT_REF || "";
assert.ok(token, "SUPABASE_ACCESS_TOKEN is required");
assert.equal(projectRef, "zeocbftriydodzfgixjv", "Production project mismatch");

const retryable = new Set([408, 429, 500, 502, 503, 504, 522, 524, 544]);
let advisor;
for (let attempt = 1; attempt <= 3; attempt += 1) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/advisors/security`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (response.ok) {
    advisor = await response.json();
    break;
  }
  if (!retryable.has(response.status) || attempt === 3) {
    throw new Error(`Production Security Advisor failed with HTTP ${response.status} after ${attempt} attempt(s)`);
  }
  await response.text();
  await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
}
assert.ok(advisor, "Production Security Advisor returned no result");
const blockers = (advisor.lints || []).filter((lint) =>
  ["ERROR", "CRITICAL", "HIGH", "BLOCKER"].includes(String(lint.level || lint.severity || "").toUpperCase()));
console.log(`Production Security Advisor critical/high/error findings: ${blockers.length}`);
assert.equal(blockers.length, 0, "Production Security Advisor has blocking findings");
