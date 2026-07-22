import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260722000100_secure_agency_user_invitations.sql", import.meta.url), "utf8");
const edge = readFileSync(new URL("../supabase/functions/invite-agency-user/index.ts", import.meta.url), "utf8");
const policy = readFileSync(new URL("../supabase/functions/_shared/agencyInvitationPolicy.mjs", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const checks = [
  ["migration refuses duplicate normalized emails", /duplicate normalized emails exist/],
  ["migration refuses duplicate Auth links", /duplicate auth_user_id values exist/],
  ["required application columns are checked", /required application columns are missing/],
  ["membership duplicates are rejected", /duplicate agency memberships exist/],
  ["company access duplicates are rejected", /duplicate agency company user access rows exist/],
  ["membership conflict index is created", /agency_members_agency_id_user_id_unique[\s\S]+agency_members \(agency_id, user_id\)/],
  ["company access conflict index is created", /agency_company_user_access_company_agency_user_unique[\s\S]+agency_company_user_access \(company_id, agency_id, user_id\)/],
  ["private Auth directory is indexed", /auth_identity_directory_normalized_email_idx[\s\S]+normalized_email/],
  ["private Auth directory index is catalog-verified", /Required Auth identity directory email index is missing or incompatible/],
  ["Auth directory is synchronized by trigger", /sync_agency_auth_identity_directory/],
  ["ambiguous Auth identities fail closed", /cardinality\(identity_ids\) > 1/],
  ["Auth lookup is explicitly service-role only", /revoke all on function public\.lookup_auth_identity_by_email\(text\) from public, anon, authenticated;\s*grant execute on function public\.lookup_auth_identity_by_email\(text\) to service_role;/],
  ["linking is serialized", /pg_advisory_xact_lock/],
  ["database rejects mismatched Auth identities", /target_user_auth_user_id <> p_auth_user_id/],
  ["legacy rows require an invite-created identity or trusted migration", /target_user_auth_user_id is null and p_delivery_kind is distinct from 'invite'/],
  ["only one active invitation is allowed", /agency_user_invitations_one_active_per_user/],
  ["active invitation index is catalog-verified", /Required unique active-invitation index is missing or incompatible/],
  ["superseded invitations are retained as invalidated", /set invalidated_at = now\(\)/],
  ["invitation verification checks expiry", /invitation\.expires_at > now\(\)/],
  ["activation identifier is bound to auth.uid", /verify_pending_agency_user_invitation\(p_invitation_id uuid\)[\s\S]+invitation\.id = p_invitation_id[\s\S]+invitation\.auth_user_id = auth\.uid\(\)/],
  ["cleanup retains at least 30 days", /p_retention_days < 30/],
  ["cleanup is explicitly service-role only", /revoke all on function public\.cleanup_agency_user_invitations\(integer\) from public, anon, authenticated;\s*grant execute on function public\.cleanup_agency_user_invitations\(integer\) to service_role;/],
  ["cross-agency identity remains blocked", /agency_mismatch/],
];

const failures = checks.filter(([, pattern]) => !pattern.test(migration) && !pattern.test(policy));
if (/listUsers/.test(edge)) failures.push(["Edge Function must not enumerate Auth users", /never/]);
if (/console\.error\([^\n]+\.message/.test(edge)) failures.push(["Edge Function must not log provider messages", /never/]);
if (!/lookup_auth_identity_by_email/.test(edge)) failures.push(["Edge Function must use indexed Auth lookup", /never/]);
if (/["']agency_invite["']|invitationToken|token_hash|sha256/i.test(edge)) failures.push(["Email redirect must not contain an application invitation secret", /never/]);
if (!/agency_activation/.test(edge)) failures.push(["Email redirect must contain only a non-secret activation marker", /never/]);
if (!/<meta name="referrer" content="no-referrer"\/>/.test(html)) failures.push(["Referrer policy must be no-referrer", /never/]);

if (failures.length) {
  for (const [label] of failures) console.error(`FAIL: ${label}`);
  process.exit(1);
}

for (const [label] of checks) console.log(`PASS: ${label}`);
console.log("PASS: Edge Function does not enumerate the Auth directory");
console.log("PASS: Email redirect contains no application invitation secret");
console.log("PASS: Referrer-Policy is no-referrer");
console.log("Static preflight passed. Run supabase/preflight/agency_user_invitations.sql against staging before applying the migration.");
