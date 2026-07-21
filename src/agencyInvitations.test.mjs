import test from "node:test";
import assert from "node:assert/strict";
import {
  clearAgencyInviteCallbackUrl,
  getAgencyInvitationErrorMessage,
  getAgencyInvitationSuccessMessage,
  getAgencyInviteUrlState,
  isValidAgencyInviteEmail,
  normalizeAgencyInviteEmail,
} from "./agencyInvitations.mjs";
import { classifyAgencyInvitation } from "../supabase/functions/_shared/agencyInvitationPolicy.mjs";

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
