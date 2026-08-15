import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../supabase/migrations/20260812000300_talent_imported_prospects.sql", import.meta.url);
const publicCounterMigrationUrl = new URL("../supabase/migrations/20260812000400_talent_public_imported_counter.sql", import.meta.url);
const consentedMarketplaceMigrationUrl = new URL("../supabase/migrations/20260814000100_publish_consented_imported_talent.sql", import.meta.url);
const marketplaceReadyTotalMigrationUrl = new URL("../supabase/migrations/20260814000200_talent_marketplace_ready_total.sql", import.meta.url);
const companyContactConsentMigrationUrl = new URL("../supabase/migrations/20260815000100_imported_talent_company_contact_consent.sql", import.meta.url);
const registrationConsentMigrationUrl = new URL("../supabase/migrations/20260815000300_talent_registration_company_data_consent.sql", import.meta.url);
const prospectEmailWorkerUrl = new URL("../supabase/functions/talent-prospect-email-worker/index.ts", import.meta.url);
const appUrl = new URL("./App.jsx", import.meta.url);

test("imported Talent prospects remain private and require a candidate claim", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /status text not null default 'Awaiting Candidate'/i);
  assert.match(migration, /claimed_candidate_id uuid references public\.talent_candidates/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /platform owner access required/i);
  assert.match(migration, /on conflict \(email_normalized\) do update/i);
  assert.doesNotMatch(migration, /employer_sharing_consent\s*=\s*true/i);
});

test("Platform Owner Talent Dashboard loads imported prospects", async () => {
  const app = await readFile(appUrl, "utf8");
  assert.match(app, /list_owner_talent_prospects/);
  assert.match(app, /Imported Talent Counter/);
  assert.match(app, /Awaiting Candidate/);
  assert.doesNotMatch(app, /ownerTalentProspects\.map/);
});

test("public Talent page exposes only the aggregate imported prospect counter", async () => {
  const app = await readFile(appUrl, "utf8");
  const migration = await readFile(publicCounterMigrationUrl, "utf8");
  assert.match(app, /talentStats\.imported_prospects/);
  assert.match(app, /مرشح مستورد/);
  assert.match(migration, /imported_prospects bigint/i);
  assert.match(migration, /select count\(\*\)::bigint[\s\S]*from public\.talent_imported_prospects/i);
  assert.doesNotMatch(migration, /returns table\([\s\S]*email/i);
});

test("owner email invitations require explicit confirmation and use a background queue", async () => {
  const app = await readFile(appUrl, "utf8");
  const migration = await readFile(new URL("../supabase/migrations/20260812000500_talent_prospect_email_invitations.sql", import.meta.url), "utf8");
  assert.match(app, /queueOwnerTalentEmailInvitations/);
  assert.match(app, /window\.confirm/);
  assert.match(app, /Queue Email Invitations/);
  assert.match(migration, /queue_talent_prospect_email_invitations/);
  assert.match(migration, /visaflow-talent-prospect-email-every-minute/);
});

test("Talent prospect email delivery is capped at 250 messages per rolling hour", async () => {
  const throttle = await readFile(new URL("../supabase/migrations/20260812000600_talent_email_hourly_throttle.sql", import.meta.url), "utf8");
  assert.match(throttle, /pg_advisory_xact_lock/);
  assert.match(throttle, /interval '60 minutes'/);
  assert.match(throttle, /v_in_window\s*>=\s*250/);
  assert.match(throttle, /email_delivery_status\s*=\s*'Sending'/);
  assert.match(throttle, /set status\s*=\s*'Invitation Queued'[\s\S]*email_delivery_status\s*=\s*'Queued'[\s\S]*where email_delivery_status\s*=\s*'Failed'/);
});

test("only imported applicants with a documented sharing basis reach company cards", async () => {
  const migration = await readFile(consentedMarketplaceMigrationUrl, "utf8");
  const app = await readFile(appUrl, "utf8");
  assert.match(migration, /employer_contact_sharing_consent boolean not null default false/i);
  assert.match(migration, /employer_contact_sharing_basis text/i);
  assert.match(migration, /employer_contact_sharing_recorded_at timestamptz/i);
  assert.match(migration, /where prospect\.employer_contact_sharing_consent is true/i);
  assert.match(migration, /Job_Applicant_Report_2026-02-08_2026-02-07%/i);
  assert.match(migration, /'email', prospect\.email/i);
  assert.match(migration, /'phone', prospect\.phone/i);
  assert.match(migration, /auth\.uid\(\) is null or v_company_id is null/i);
  assert.match(app, /Experience Summary/);
  assert.match(app, /Email Candidate/);
  assert.match(app, /Schedule Interview/);
  assert.match(app, /Interview invitation email draft opened for the imported candidate/);
});

test("Marketplace Ready public counter includes consented imported cards", async () => {
  const migration = await readFile(marketplaceReadyTotalMigrationUrl, "utf8");
  assert.match(migration, /marketplace_ready bigint/i);
  assert.match(migration, /candidate\.marketplace_status = 'Approved'/i);
  assert.match(migration, /prospect\.employer_contact_sharing_consent is true/i);
  assert.match(migration, /prospect\.status <> 'Archived'/i);
  assert.match(migration, /grant execute on function public\.get_talent_public_stats\(\) to anon, authenticated, service_role/i);
});

test("all approved imported profiles become anonymous cards and identity unlock is company-scoped", async () => {
  const migration = await readFile(companyContactConsentMigrationUrl, "utf8");
  assert.match(migration, /marketplace_profile_consent boolean not null default false/i);
  assert.match(migration, /import_talent_prospects_with_marketplace_consent/i);
  assert.match(migration, /update public\.talent_imported_prospects[\s\S]*marketplace_profile_consent = true/i);
  assert.match(migration, /unique \(company_id, prospect_id\)/i);
  assert.match(migration, /contact_request\.company_id = v_company_id/i);
  assert.match(migration, /'identity_shared', coalesce\(contact_request\.status = 'Approved', false\)/i);
  assert.match(migration, /'full_name', case when contact_request\.status = 'Approved' then prospect\.full_name else null end/i);
  assert.match(migration, /'current_company', null/i);
  assert.doesNotMatch(migration, /concat_ws\(' at ', prospect\.current_title, prospect\.current_company\)/i);
  assert.match(migration, /where prospect\.marketplace_profile_consent is true and prospect\.claimed_candidate_id is null/i);
});

test("company request and candidate approve or decline flow is email-backed", async () => {
  const migration = await readFile(companyContactConsentMigrationUrl, "utf8");
  const worker = await readFile(prospectEmailWorkerUrl, "utf8");
  const app = await readFile(appUrl, "utf8");
  assert.match(migration, /request_imported_talent_contact/i);
  assert.match(migration, /respond_imported_talent_contact/i);
  assert.match(migration, /grant execute on function public\.respond_imported_talent_contact\(text, text\) to anon, authenticated/i);
  assert.match(worker, /claim_talent_company_contact_email_job/i);
  assert.match(worker, /talent_contact_response=Approved/i);
  assert.match(worker, /talent_contact_response=Declined/i);
  assert.match(worker, /previous employer names are currently hidden/i);
  assert.match(app, /Request Contact Approval/);
  assert.match(app, /TalentContactConsentPage/);
  assert.match(app, /respond_imported_talent_contact/);
  assert.doesNotMatch(app, /const legacy = await supabase\.rpc\("list_company_talent_marketplace"\)/i);
});

test("candidate signup requires explicit company data sharing consent and claims a matching import", async () => {
  const migration = await readFile(registrationConsentMigrationUrl, "utf8");
  const app = await readFile(appUrl, "utf8");
  assert.match(app, /company_data_sharing_consent:\s*false/i);
  assert.match(app, /Consent to share my information with companies/i);
  assert.match(app, /name, email, phone number, and employment history may be shown/i);
  assert.match(app, /complete_my_talent_registration/i);
  assert.match(app, /company_data_sharing_consent_at:\s*new Date\(\)\.toISOString\(\)/i);
  assert.match(migration, /registration_company_data_consent boolean not null default false/i);
  assert.match(migration, /Employer Contact Sharing/i);
  assert.match(migration, /auth_user\.email_confirmed_at is not null/i);
  assert.match(migration, /prospect\.email_normalized = lower\(btrim\(coalesce\(v_candidate\.email, ''\)\)\)/i);
  assert.match(migration, /claimed_candidate_id = v_candidate\.id/i);
  assert.match(migration, /marketplace_status = 'Approved'/i);
  assert.match(migration, /profile_visibility = 'Public'/i);
});
