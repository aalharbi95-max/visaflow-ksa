import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260722000100_secure_agency_user_invitations.sql", import.meta.url), "utf8");
const edge = readFileSync(new URL("../supabase/functions/invite-agency-user/index.ts", import.meta.url), "utf8");
const policy = readFileSync(new URL("../supabase/functions/_shared/agencyInvitationPolicy.mjs", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const checks = [
  ["migration refuses duplicate normalized emails", /duplicate normalized emails exist/],
  ["migration refuses duplicate Auth links", /duplicate auth_user_id values exist/],
  ["Auth lookup is service-role only", /lookup_auth_identity_by_email[\s\S]+grant execute[\s\S]+service_role/],
  ["linking is serialized", /pg_advisory_xact_lock/],
  ["database rejects mismatched Auth identities", /target_user_auth_user_id <> p_auth_user_id/],
  ["legacy rows require an invite-created identity or trusted migration", /target_user_auth_user_id is null and p_delivery_kind is distinct from 'invite'/],
  ["only one active invitation is allowed", /agency_user_invitations_one_active_per_user/],
  ["superseded tokens are retained as invalidated", /set invalidated_at = now\(\)/],
  ["invitation verification checks expiry", /invitation\.expires_at > now\(\)/],
  ["cleanup retains at least 30 days", /p_retention_days < 30/],
  ["cross-agency identity remains blocked", /agency_mismatch/],
];

const failures = checks.filter(([, pattern]) => !pattern.test(migration) && !pattern.test(policy));
if (/listUsers/.test(edge)) failures.push(["Edge Function must not enumerate Auth users", /never/]);
if (/console\.error\([^\n]+\.message/.test(edge)) failures.push(["Edge Function must not log provider messages", /never/]);
if (!/lookup_auth_identity_by_email/.test(edge)) failures.push(["Edge Function must use indexed Auth lookup", /never/]);
if (!/<meta name="referrer" content="no-referrer"\/>/.test(html)) failures.push(["Referrer policy must be no-referrer", /never/]);

if (failures.length) {
  for (const [label] of failures) console.error(`FAIL: ${label}`);
  process.exit(1);
}

for (const [label] of checks) console.log(`PASS: ${label}`);
console.log("PASS: Edge Function does not enumerate the Auth directory");
console.log("PASS: Referrer-Policy is no-referrer");
console.log("Static preflight passed. Run supabase/preflight/agency_user_invitations.sql against staging before applying the migration.");
