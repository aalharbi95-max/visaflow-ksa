import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clearAgencyInviteCallbackUrl,
  clearAgencyInviteTokenFromUrl,
  getAgencyInvitationErrorMessage,
  getAgencyInvitationSuccessMessage,
  getAgencyInviteUrlState,
  isValidAgencyInviteEmail,
  normalizeAgencyInviteEmail,
} from "./agencyInvitations.mjs";
import {
  classifyAgencyInvitation,
  getAgencyInvitationAction,
} from "../supabase/functions/_shared/agencyInvitationPolicy.mjs";

const migrationSource = readFileSync(new URL("../supabase/migrations/20260722000100_secure_agency_user_invitations.sql", import.meta.url), "utf8");
const edgeSource = readFileSync(new URL("../supabase/functions/invite-agency-user/index.ts", import.meta.url), "utf8");
const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("normalizes and validates agency invitation email addresses", () => {
  assert.equal(normalizeAgencyInviteEmail("  Agency.User@Example.COM "), "agency.user@example.com");
  assert.equal(isValidAgencyInviteEmail("agency.user@example.com"), true);
  assert.equal(isValidAgencyInviteEmail("not-an-email"), false);
});

test("recognizes secure agency invitation callbacks and errors", () => {
  assert.deepEqual(
    getAgencyInviteUrlState({ search: "?agency_invite=1", hash: "#type=invite" }),
    { requested: true, token: "1", error: "" },
  );
  assert.deepEqual(
    getAgencyInviteUrlState({ search: "?agency_invite=1", hash: "#error_description=Invite+expired" }),
    { requested: true, token: "1", error: "Invite expired" },
  );
});

test("removes invitation credentials and markers from the browser URL", () => {
  let replacedUrl = "";
  clearAgencyInviteCallbackUrl(
    { href: "https://visaflowksa.com/?agency_invite=1#access_token=secret&type=invite&refresh_token=secret-2" },
    { replaceState: (_state, _title, url) => { replacedUrl = url; } },
  );
  assert.equal(replacedUrl, "https://visaflowksa.com/");
});

test("removes the app invitation token immediately while preserving Supabase callback credentials", () => {
  let replacedUrl = "";
  clearAgencyInviteTokenFromUrl(
    { href: "https://visaflowksa.com/?agency_invite=one-time-token#access_token=supabase-callback&type=invite" },
    { replaceState: (_state, _title, url) => { replacedUrl = url; } },
  );
  assert.equal(replacedUrl, "https://visaflowksa.com/#access_token=supabase-callback&type=invite");
});

test("provides explicit conflict and existing-account messages", () => {
  assert.match(getAgencyInvitationErrorMessage("incompatible_role"), /internal or incompatible/i);
  assert.match(getAgencyInvitationErrorMessage("agency_mismatch"), /different agency/i);
  assert.match(getAgencyInvitationSuccessMessage("linked_existing"), /password was not changed/i);
  assert.match(getAgencyInvitationSuccessMessage("invited"), /set a password/i);
});

test("invites a new email and links a verified existing agency identity", () => {
  assert.deepEqual(
    classifyAgencyInvitation({ appUser: null, authUser: null, agencyId: "agency-1" }),
    { allowed: true, mode: "invite_new" },
  );
  assert.deepEqual(
    classifyAgencyInvitation({
      appUser: { role: "Agency", status: "Active", is_active: true, agency_id: "agency-1", auth_user_id: "auth-1" },
      authUser: { id: "auth-1" },
      agencyId: "agency-1",
    }),
    { allowed: true, mode: "link_existing" },
  );
});

test("requires trusted migration when a legacy Agency row collides with an existing Auth account", () => {
  const result = classifyAgencyInvitation({
    appUser: { role: "Agency", status: "Active", is_active: true, agency_id: "agency-1", auth_user_id: null },
    authUser: { id: "candidate-auth-id", user_metadata: { account_type: "candidate" } },
    agencyId: "agency-1",
  });
  assert.deepEqual(result, { allowed: false, error: "trusted_auth_migration_required" });
  assert.match(getAgencyInvitationErrorMessage(result.error), /trusted administrator/i);
  assert.match(migrationSource, /target_user_auth_user_id is null and p_delivery_kind is distinct from 'invite'/);
  assert.match(migrationSource, /target_user_auth_user_id <> p_auth_user_id/);
});

test("blocks duplicate authentication identities, internal roles, and cross-agency reassignment", () => {
  assert.equal(classifyAgencyInvitation({ appUser: null, authUser: { id: "auth-1" }, agencyId: "agency-1" }).error, "unlinked_auth_account");
  assert.equal(classifyAgencyInvitation({
    appUser: { role: "Admin", status: "Active", is_active: true },
    authUser: { id: "auth-1" },
    agencyId: "agency-1",
  }).error, "incompatible_role");
  assert.equal(classifyAgencyInvitation({
    appUser: { role: "Agency", status: "Active", is_active: true, agency_id: "agency-2", auth_user_id: "auth-1" },
    authUser: { id: "auth-1" },
    agencyId: "agency-1",
  }).error, "agency_mismatch");
  assert.equal(classifyAgencyInvitation({
    appUser: { role: "Agency", status: "Active", is_active: true, agency_id: "agency-1", auth_user_id: "auth-2" },
    authUser: { id: "auth-1" },
    agencyId: "agency-1",
  }).error, "auth_identity_mismatch");
});

test("resends unconsumed invitations, including expired links, without creating a second Auth user", () => {
  const base = {
    appUser: { role: "Agency", status: "Active", is_active: true, agency_id: "agency-1", auth_user_id: "auth-1" },
    authUser: { id: "auth-1" },
    agencyId: "agency-1",
  };
  assert.equal(getAgencyInvitationAction({
    ...base,
    pendingInvitation: { expires_at: "2020-01-01T00:00:00Z", consumed_at: null, invalidated_at: null },
  }).action, "resend");
  assert.equal(getAgencyInvitationAction({ ...base, pendingInvitation: null }).action, "link_existing");
  assert.match(edgeSource, /resetPasswordForEmail/);
});

test("supports the same agency user across two client companies and blocks another agency", () => {
  const identity = {
    appUser: { role: "Agency", status: "Active", is_active: true, agency_id: "agency-1", auth_user_id: "auth-1" },
    authUser: { id: "auth-1" },
    agencyId: "agency-1",
    pendingInvitation: null,
  };
  assert.equal(getAgencyInvitationAction({ ...identity, companyId: "company-a" }).allowed, true);
  assert.equal(getAgencyInvitationAction({ ...identity, companyId: "company-b" }).allowed, true);
  assert.equal(getAgencyInvitationAction({ ...identity, agencyId: "agency-2", companyId: "company-b" }).error, "agency_mismatch");
  assert.match(migrationSource, /on conflict \(company_id, agency_id, user_id\) do update/);
});

test("blocks candidate-only and internal-company identities with the same email", () => {
  assert.equal(classifyAgencyInvitation({
    appUser: null,
    authUser: { id: "candidate-1", user_metadata: { account_type: "candidate" } },
    agencyId: "agency-1",
  }).error, "unlinked_auth_account");
  assert.equal(classifyAgencyInvitation({
    appUser: { role: "Admin", status: "Active", is_active: true, auth_user_id: "admin-1" },
    authUser: { id: "admin-1" },
    agencyId: "agency-1",
  }).error, "incompatible_role");
});

test("serializes concurrent invitation rotation and permits only one active token", () => {
  assert.match(migrationSource, /pg_advisory_xact_lock/);
  assert.match(migrationSource, /agency_user_invitations_one_active_per_user/);
  assert.match(migrationSource, /where consumed_at is null and invalidated_at is null/);
});

test("acceptance verifies expiry, updates the password, and consumes the one-time invitation", () => {
  assert.match(migrationSource, /invitation\.expires_at > now\(\)/);
  assert.match(migrationSource, /verify_agency_user_invitation/);
  assert.match(migrationSource, /consume_agency_user_invitation/);
  assert.ok(appSource.indexOf("supabase.auth.updateUser({ password })") < appSource.indexOf('"consume_agency_user_invitation"'));
});

test("uses an indexed service-only Auth lookup and defines 90-day audited retention", () => {
  assert.doesNotMatch(edgeSource, /listUsers/);
  assert.match(edgeSource, /lookup_auth_identity_by_email/);
  assert.match(migrationSource, /grant execute on function public\.lookup_auth_identity_by_email\(text\) to service_role/);
  assert.match(migrationSource, /cleanup_agency_user_invitations\(p_retention_days integer default 90\)/);
  assert.match(migrationSource, /p_retention_days < 30/);
  assert.doesNotMatch(edgeSource, /console\.error\([^\n]+\.message/);
});
