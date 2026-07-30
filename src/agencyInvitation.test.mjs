import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_AGENCY_PERMISSIONS,
  buildAgencyInvitationPayload,
  canInviteAgencyUser,
  canSendAgencyInvitation,
  getAgencyInvitationAcceptanceMessage,
  getAgencyInvitationCallbackError,
  getCleanAgencyInvitationUrl,
  getAgencyInvitationErrorMessage,
  getAgencyInvitationStatus,
  isAgencyInvitationUrl,
} from "./agencyInvitation.mjs";

test("agency invitation statuses cover the required UI states", () => {
  const now = Date.parse("2026-07-30T12:00:00Z");
  assert.equal(getAgencyInvitationStatus(null, now), "Not Invited");
  assert.equal(
    getAgencyInvitationStatus({
      status: "Provisioning",
      updated_at: "2026-07-30T11:59:00Z",
    }, now),
    "Invitation Sending"
  );
  assert.equal(
    getAgencyInvitationStatus({
      status: "Provisioning",
      updated_at: "2026-07-30T11:00:00Z",
    }, now),
    "Failed"
  );
  assert.equal(
    getAgencyInvitationStatus({
      status: "Invitation Sent",
      invitation_sent_at: "2026-07-30T11:00:00Z",
    }, now),
    "Invitation Sent"
  );
  assert.equal(
    getAgencyInvitationStatus({
      status: "Invitation Sent",
      invitation_sent_at: "2026-07-28T11:00:00Z",
    }, now),
    "Expired"
  );
  assert.equal(getAgencyInvitationStatus({ status: "Active" }, now), "Accepted");
  assert.equal(getAgencyInvitationStatus({ status: "Failed" }, now), "Failed");
});

test("resend is allowed only for not invited, failed, or expired states", () => {
  for (const status of ["Not Invited", "Failed", "Expired"]) {
    assert.equal(canSendAgencyInvitation(status), true);
  }
  for (const status of [
    "Invitation Sending",
    "Invitation Sent",
    "Accepted",
  ]) {
    assert.equal(canSendAgencyInvitation(status), false);
  }
});

test("browser payload contains only the action and untrusted agency hint", () => {
  assert.deepEqual(
    buildAgencyInvitationPayload({
      id: "agency-a",
      company_id: "untrusted-company",
      email: "untrusted@example.test",
    }),
    {
      action: "invite_existing",
      agency_id: "agency-a",
      permissions: DEFAULT_AGENCY_PERMISSIONS,
    }
  );
});

test("only active Admin and Company Admin users can create agency login access", () => {
  assert.equal(canInviteAgencyUser("Admin", true), true);
  assert.equal(canInviteAgencyUser("Company Admin", true), true);
  assert.equal(canInviteAgencyUser("Recruitment Manager", true), false);
  assert.equal(canInviteAgencyUser("Agency", true), false);
  assert.equal(canInviteAgencyUser("Admin", false), false);
});

test("agency invitation permissions reject unknown or non-boolean values", () => {
  assert.throws(
    () =>
      buildAgencyInvitationPayload(
        { id: "agency-a" },
        { ...DEFAULT_AGENCY_PERMISSIONS, can_delete_requests: true }
      ),
    (error) => error.code === "AGENCY_INVITATION_INVALID_PERMISSIONS"
  );
  assert.throws(
    () =>
      buildAgencyInvitationPayload(
        { id: "agency-a" },
        { ...DEFAULT_AGENCY_PERMISSIONS, can_view_requests: "yes" }
      ),
    (error) => error.code === "AGENCY_INVITATION_INVALID_PERMISSIONS"
  );
});

test("invite callback detection supports Supabase invite fragments", () => {
  assert.equal(
    isAgencyInvitationUrl({
      href: "https://preview.example.test/#access_token=secret&type=invite",
    }),
    true
  );
  assert.equal(
    isAgencyInvitationUrl({
      href: "https://preview.example.test/?type=recovery",
    }),
    false
  );
});

test("invite callback errors distinguish expired, used, and invalid links", () => {
  assert.equal(
    getAgencyInvitationCallbackError({
      href: "https://staging.example.test/?agency_invite=1#error_code=otp_expired&error_description=Email+link+is+expired",
    }),
    "AGENCY_INVITATION_LINK_EXPIRED"
  );
  assert.equal(
    getAgencyInvitationCallbackError({
      href: "https://staging.example.test/?agency_invite=1#error=access_denied&error_description=This+link+has+been+used",
    }),
    "AGENCY_INVITATION_LINK_USED"
  );
  assert.equal(
    getAgencyInvitationCallbackError({
      href: "https://staging.example.test/?agency_invite=1#error=access_denied",
    }),
    "AGENCY_INVITATION_LINK_INVALID"
  );
  assert.equal(
    getAgencyInvitationCallbackError({
      href: "https://staging.example.test/?agency_invite=1",
    }),
    null
  );
});

test("acceptance messages cover every required failure state", () => {
  assert.match(
    getAgencyInvitationAcceptanceMessage("AGENCY_INVITATION_LINK_EXPIRED"),
    /انتهى/
  );
  assert.match(
    getAgencyInvitationAcceptanceMessage("AGENCY_INVITATION_LINK_USED"),
    /مسبقًا/
  );
  assert.match(
    getAgencyInvitationAcceptanceMessage("AGENCY_INVITATION_LINK_INVALID"),
    /غير صالح/
  );
  assert.match(
    getAgencyInvitationAcceptanceMessage(
      "AGENCY_INVITATION_ACCOUNT_NOT_LINKED"
    ),
    /غير مرتبط/
  );
  assert.match(
    getAgencyInvitationAcceptanceMessage(
      "AGENCY_INVITATION_ACTIVATION_FAILED"
    ),
    /تعذر/
  );
});

test("clean invite URL removes callback credentials and invite routing state", () => {
  const cleaned = getCleanAgencyInvitationUrl({
    href: "https://staging.example.test/?agency_invite=1&safe=kept#access_token=secret&type=invite",
  });
  assert.equal(cleaned.origin, "https://staging.example.test");
  assert.equal(cleaned.pathname, "/");
  assert.equal(cleaned.search, "?safe=kept");
  assert.equal(cleaned.hash, "");
});

test("required Arabic error messages map to stable server codes", () => {
  assert.equal(
    getAgencyInvitationErrorMessage({
      code: "AGENCY_INVITATION_ALREADY_SENT",
    }),
    "المكتب مدعو مسبقًا."
  );
  assert.equal(
    getAgencyInvitationErrorMessage({
      code: "AGENCY_INVITATION_EMAIL_ALREADY_ASSIGNED",
    }),
    "البريد مستخدم في حساب آخر."
  );
  assert.equal(
    getAgencyInvitationErrorMessage({
      code: "AGENCY_INVITATION_UNAUTHORIZED",
    }),
    "غير مخول."
  );
  assert.equal(
    getAgencyInvitationErrorMessage({
      code: "AGENCY_INVITATION_SEND_FAILED",
    }),
    "تعذر إرسال الدعوة."
  );
});

test("App uses the Edge Function and contains no invitation table writes", async () => {
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const invitation = await readFile(
    new URL("./agencyInvitation.mjs", import.meta.url),
    "utf8"
  );
  assert.match(app, /Invite Agency/);
  assert.match(app, /invokeAgencyInvitation/);
  assert.match(app, /action:\s*"activate"/);
  assert.match(app, /AgencyInvitationPasswordScreen/);
  assert.match(app, /auth\.updateUser\(\{\s*password:/);
  assert.match(app, /setActivePage\("Office Portal"\)/);
  assert.match(app, /get_authenticated_app_user/);
  assert.match(app, /agency_company_user_access/);
  assert.doesNotMatch(
    app,
    /AgencyInvitationPasswordScreen[\s\S]{0,5000}auth\.signOut/
  );
  assert.doesNotMatch(
    app + invitation,
    /\.from\(\s*["'](?:users|agency_company_user_access|agency_provisioning_requests)["']\s*\)[\s\S]{0,200}\.(?:insert|update|upsert|delete)\s*\(/
  );
});

test("Edge validates JWT and keeps the service key server-side", async () => {
  const edge = await readFile(
    new URL(
      "../supabase/functions/visaflow-agency-provisioner/index.ts",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edge, /auth\.getUser\(token\)/);
  assert.match(edge, /agency_invitation_begin/);
  assert.match(edge, /agency_invitation_complete/);
  assert.doesNotMatch(
    await readFile(new URL("./agencyInvitation.mjs", import.meta.url), "utf8"),
    /SUPABASE_SERVICE_ROLE_KEY/
  );
});
