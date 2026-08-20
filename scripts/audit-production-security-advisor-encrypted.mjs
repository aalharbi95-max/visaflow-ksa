import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createCipheriv, constants, publicEncrypt, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const token = process.env.SUPABASE_ACCESS_TOKEN || "";
const password = process.env.SUPABASE_DB_PASSWORD || "";
const projectRef = process.env.SUPABASE_PROJECT_REF || "";
const outputPath = process.env.PRODUCTION_ADVISOR_AUDIT_OUTPUT || "production-security-advisor-audit.enc.json";
const publicKeyPath = new URL("../.github/audit-production-security-advisor-public.pem", import.meta.url);

assert.ok(token, "SUPABASE_ACCESS_TOKEN is required");
assert.ok(password, "SUPABASE_DB_PASSWORD is required");
assert.equal(projectRef, "zeocbftriydodzfgixjv", "Production project mismatch");

const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const [metadataResponse, poolerResponse] = await Promise.all([
  fetch(`https://api.supabase.com/v1/projects/${projectRef}`, { headers }),
  fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/database/pooler`, { headers }),
]);
assert.ok(metadataResponse.ok, `Supabase project metadata failed with HTTP ${metadataResponse.status}`);
assert.ok(poolerResponse.ok, `Supabase pooler config failed with HTTP ${poolerResponse.status}`);
const metadata = await metadataResponse.json();
assert.equal(metadata.id, projectRef, "Supabase project metadata does not match Production");

const poolers = await poolerResponse.json();
assert.ok(Array.isArray(poolers) && poolers.length > 0, "Supabase returned no pooler configuration");
const primary = poolers.find((pooler) => String(pooler.database_type || "").toUpperCase() === "PRIMARY") || poolers[0];
const connectionString = String(primary.connection_string || primary.connectionString || "");
const parsedConnection = connectionString.match(
  /^postgres(?:ql)?:\/\/([^:@/]+)(?::[^@]*)?@([^:/?#]+)(?::\d+)?\/([^?]+)/i,
);
const host = String(primary.db_host || parsedConnection?.[2] || "");
const user = String(parsedConnection?.[1] || primary.db_user || "");
const database = String(primary.db_name || parsedConnection?.[3] || "postgres");
assert.match(host, /^[a-z0-9.-]+\.pooler\.supabase\.com$/i, "Authoritative Supabase pooler host is invalid");
assert.equal(user, `postgres.${projectRef}`, "Authoritative Supabase pooler user does not match Production");

const sessionOptions = encodeURIComponent("-c pgrst.db_schemas=public");
const dbUrl = `postgresql://${user}:${encodeURIComponent(password)}@${host}:5432/${database}?sslmode=require&options=${sessionOptions}`;
const advisorResult = spawnSync("supabase", [
  "db", "advisors",
  "--type", "security",
  "--level", "error",
  "--fail-on", "none",
  "--output-format", "json",
  "--db-url", dbUrl,
], {
  encoding: "utf8",
  shell: false,
  // Supabase CLI 2.109.1 does not propagate the hosted PostgREST schema list
  // when using --db-url. Set it for this read-only session so API-exposure
  // lints match the hosted Security Advisor instead of silently false-passing.
  env: process.env,
  maxBuffer: 10 * 1024 * 1024,
});
if (advisorResult.error) throw advisorResult.error;
const stdout = String(advisorResult.stdout || "").trim();
let advisor;
try {
  advisor = JSON.parse(stdout);
} catch {
  const firstJson = [stdout.indexOf("{"), stdout.indexOf("[")]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  if (firstJson !== undefined) advisor = JSON.parse(stdout.slice(firstJson));
}
assert.ok(advisor, `Supabase CLI read-only Security Advisor returned no JSON (exit ${advisorResult.status})`);
const candidateArrays = [];
const visit = (value) => {
  if (Array.isArray(value)) {
    const isExactAdvisorSet = value.length === 38 && value.every((item) =>
      item
      && typeof item === "object"
      && typeof item.name === "string"
      && typeof item.title === "string"
      && item.metadata
      && typeof item.metadata === "object"
    );
    if (isExactAdvisorSet) {
      candidateArrays.push(value);
    }
    for (const item of value) visit(item);
    return;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) visit(nested);
  }
};
visit(advisor);
assert.equal(candidateArrays.length, 1, "Expected exactly one validated 38-item Advisor result set");
const advisorFindings = candidateArrays[0];
assert.ok(Array.isArray(advisorFindings), "Supabase CLI returned an invalid Advisor result");
assert.equal(advisorFindings.length, 38, "Refusing to encrypt an unexpected Advisor result count");

const findings = advisorFindings
  .map((lint) => ({
    // The CLI invocation already limits output to --level error.
    severity: String(lint.level || lint.severity || "ERROR").toUpperCase(),
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
