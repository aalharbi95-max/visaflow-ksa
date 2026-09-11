import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AGENCY_MAINTENANCE_FIELDS,
  PLATFORM_COMPANY_SETTING_FIELDS,
  TENANT_COMPANY_SETTING_FIELDS,
  buildAgencyMaintenanceUpdate,
  buildCompanySettingsUpdate,
} from "./agencyAdministration.mjs";
import {
  AgencyAdministrationError,
  runAgencyAdministrationAction,
} from "../supabase/functions/_shared/agencyAdministrationCore.mjs";

const adminActor = Object.freeze({
  authUserId: "auth-admin",
  userId: "user-admin",
  companyId: "company-a",
  role: "Admin",
  isActive: true,
});

test("authorized company administrator updates only the actor company", async () => {
  let received;
  const result = await runAgencyAdministrationAction({
    body: {
      action: "update_company_settings",
      company_id: "company-a",
      settings: { name: "Company A", domain: "a.example", notes: "Safe" },
    },
    actor: adminActor,
    repository: {
      updateCompanySettings: async (input) => {
        received = input;
        return { id: input.targetCompanyId, ...input.settings };
      },
    },
  });

  assert.equal(received.targetCompanyId, "company-a");
  assert.deepEqual(received.settings, {
    name: "Company A",
    domain: "a.example",
    notes: "Safe",
  });
  assert.equal(result.company.id, "company-a");
});

test("company administrator cannot update another company", async () => {
  await assert.rejects(
    runAgencyAdministrationAction({
      body: {
        action: "update_company_settings",
        company_id: "company-b",
        settings: { name: "Company B" },
      },
      actor: adminActor,
      repository: {
        updateCompanySettings: async () => {
          throw new Error("repository must not run");
        },
      },
    }),
    (error) =>
      error instanceof AgencyAdministrationError &&
      error.code === "TENANT_MISMATCH"
  );
});

test("agency update reaches only the tenant-checked repository path", async () => {
  const repository = {
    updateAgency: async ({ agencyId, updates }) => {
      if (agencyId !== "agency-linked") throw new Error("AGENCY_NOT_LINKED");
      return { id: agencyId, ...updates };
    },
  };

  const linked = await runAgencyAdministrationAction({
    body: {
      action: "update_agency",
      agency_id: "agency-linked",
      agency: { name: "Linked Agency", email: "office@example.com" },
    },
    actor: adminActor,
    repository,
  });
  assert.equal(linked.agency.id, "agency-linked");

  await assert.rejects(
    runAgencyAdministrationAction({
      body: {
        action: "update_agency",
        agency_id: "agency-other",
        agency: { name: "Other Agency" },
      },
      actor: adminActor,
      repository,
    }),
    /AGENCY_NOT_LINKED/
  );
});

test("unlink keeps global agency, Auth user and public user records", async () => {
  const result = await runAgencyAdministrationAction({
    body: {
      action: "unlink_agency",
      agency_id: "agency-linked",
    },
    actor: adminActor,
    repository: {
      unlinkAgency: async ({ agencyId }) => ({
        agency_id: agencyId,
        company_id: "company-a",
        status: "Suspended",
        agency_deleted: false,
        auth_user_deleted: false,
        public_user_deleted: false,
      }),
    },
  });

  assert.equal(result.result.agency_deleted, false);
  assert.equal(result.result.auth_user_deleted, false);
  assert.equal(result.result.public_user_deleted, false);
});

test("administration core rejects fields outside the server allowlists", async () => {
  await assert.rejects(
    runAgencyAdministrationAction({
      body: {
        action: "update_company_settings",
        settings: { company_id: "company-b" },
      },
      actor: adminActor,
      repository: {},
    }),
    (error) =>
      error instanceof AgencyAdministrationError &&
      error.code === "COMPANY_SETTINGS_INVALID_FIELDS"
  );

  await assert.rejects(
    runAgencyAdministrationAction({
      body: {
        action: "update_agency",
        agency_id: "agency-linked",
        agency: { company_id: "company-b" },
      },
      actor: adminActor,
      repository: {},
    }),
    (error) =>
      error instanceof AgencyAdministrationError &&
      error.code === "AGENCY_UPDATE_INVALID_FIELDS"
  );
});

test("client builders omit ownership and protected fields", () => {
  const tenant = buildCompanySettingsUpdate({
    name: " Company ",
    domain: " example.com ",
    notes: " Notes ",
    company_id: "company-b",
    subscription_status: "Active",
  });
  assert.deepEqual(tenant, {
    name: "Company",
    domain: "example.com",
    notes: "Notes",
  });

  const platform = buildCompanySettingsUpdate(
    {
      name: "Company",
      subscription_status: "Active",
      max_users: 10,
      company_id: "company-b",
    },
    { platform: true }
  );
  assert.deepEqual(platform, {
    name: "Company",
    subscription_status: "Active",
    max_users: 10,
  });

  const agency = buildAgencyMaintenanceUpdate({
    name: " Agency ",
    country: " SA ",
    contact_person: " Owner ",
    email: " office@example.com ",
    phone: " 123 ",
    company_id: "company-b",
    status: "Suspended",
  });
  assert.deepEqual(Object.keys(agency), [...AGENCY_MAINTENANCE_FIELDS]);
  assert.equal(agency.name, "Agency");
  assert.equal("company_id" in agency, false);
  assert.equal("status" in agency, false);
  assert.ok(TENANT_COMPANY_SETTING_FIELDS.includes("notes"));
  assert.ok(PLATFORM_COMPANY_SETTING_FIELDS.includes("subscription_status"));
});

test("existing RPC contracts enforce tenant links and unlink without deletes", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260726000200_add_agency_provisioning.sql",
      import.meta.url
    ),
    "utf8"
  );
  const updateAgency = migration.slice(
    migration.indexOf(
      "create or replace function public.workspace_admin_update_agency"
    ),
    migration.indexOf(
      "create or replace function public.workspace_admin_unlink_agency"
    )
  );
  const unlinkAgency = migration.slice(
    migration.indexOf(
      "create or replace function public.workspace_admin_unlink_agency"
    ),
    migration.indexOf(
      "revoke all on function public.agency_provisioning_public_result"
    )
  );

  assert.match(updateAgency, /public\.company_agency_access/);
  assert.match(updateAgency, /raise exception 'AGENCY_NOT_LINKED'/);
  assert.match(unlinkAgency, /'agency_deleted', false/);
  assert.match(unlinkAgency, /'auth_user_deleted', false/);
  assert.match(unlinkAgency, /'public_user_deleted', false/);
  assert.doesNotMatch(unlinkAgency, /\bdelete\s+from\b/i);
});

test("Edge maps only the three administration actions to existing RPCs", async () => {
  const edge = await readFile(
    new URL(
      "../supabase/functions/visaflow-agency-provisioner/index.ts",
      import.meta.url
    ),
    "utf8"
  );
  for (const rpc of [
    "workspace_admin_update_company_settings",
    "workspace_admin_update_agency",
    "workspace_admin_unlink_agency",
  ]) {
    assert.match(edge, new RegExp(rpc));
  }
  assert.match(edge, /runAgencyInvitationAction/);
  assert.match(edge, /runAgencyAdministrationAction/);
});
