import assert from "node:assert/strict";
import { createCipheriv, constants, publicEncrypt, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const token = process.env.SUPABASE_ACCESS_TOKEN || "";
const projectRef = process.env.SUPABASE_PROJECT_REF || "";
const outputPath = process.env.PRODUCTION_ADVISOR_AUDIT_OUTPUT || "production-security-advisor-audit.enc.json";
const publicKeyPath = new URL("../.github/audit-production-security-advisor-public.pem", import.meta.url);

assert.ok(token, "SUPABASE_ACCESS_TOKEN is required");
assert.equal(projectRef, "zeocbftriydodzfgixjv", "Production project mismatch");

const retryable = new Set([408, 429, 500, 502, 503, 504, 522, 524, 544]);
let advisor;

const maxAttempts = 3;
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  let response;
  try {
    response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/advisors/security`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    if (attempt === maxAttempts) {
      throw new Error(`Production Security Advisor timed out after ${attempt} attempt(s)`, { cause: error });
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
    continue;
  }

  if (response.ok) {
    advisor = await response.json();
    break;
  }

  await response.text();
  if (!retryable.has(response.status) || attempt === maxAttempts) {
    throw new Error(`Production Security Advisor failed with HTTP ${response.status} after ${attempt} attempt(s)`);
  }
  await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
}

assert.ok(advisor, "Production Security Advisor returned no result");

const blockingLevels = new Set(["ERROR", "CRITICAL", "HIGH", "BLOCKER"]);
const findings = (advisor.lints || [])
  .filter((lint) => blockingLevels.has(String(lint.level || lint.severity || "").toUpperCase()))
  .map((lint) => ({
    severity: String(lint.level || lint.severity || "UNKNOWN").toUpperCase(),
    rule: String(lint.name || lint.code || lint.id || "unknown"),
    title: String(lint.title || ""),
    schema: String(lint.metadata?.schema || ""),
    object: String(lint.metadata?.name || lint.metadata?.entity || ""),
    object_type: String(lint.metadata?.type || ""),
  }))
  .sort((a, b) =>
    a.rule.localeCompare(b.rule) || a.schema.localeCompare(b.schema) || a.object.localeCompare(b.object));

const plaintext = Buffer.from(JSON.stringify({ project_ref: projectRef, findings }), "utf8");
const contentKey = randomBytes(32);
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", contentKey, iv);
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const authTag = cipher.getAuthTag();
const publicKey = await readFile(publicKeyPath, "utf8");
const wrappedKey = publicEncrypt(
  { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
  contentKey,
);

await writeFile(outputPath, `${JSON.stringify({
  version: 1,
  algorithms: { key: "RSA-OAEP-SHA256", content: "AES-256-GCM" },
  wrapped_key: wrappedKey.toString("base64"),
  iv: iv.toString("base64"),
  auth_tag: authTag.toString("base64"),
  ciphertext: ciphertext.toString("base64"),
})}\n`, { encoding: "utf8", mode: 0o600 });

plaintext.fill(0);
contentKey.fill(0);
console.log(`Captured and encrypted ${findings.length} sanitized Production Security Advisor Critical/High/ERROR findings.`);
