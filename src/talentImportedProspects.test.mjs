import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../supabase/migrations/20260812000300_talent_imported_prospects.sql", import.meta.url);
const publicCounterMigrationUrl = new URL("../supabase/migrations/20260812000400_talent_public_imported_counter.sql", import.meta.url);
const consentedMarketplaceMigrationUrl = new URL("../supabase/migrations/20260814000100_publish_consented_imported_talent.sql", import.meta.url);
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
  assert.match(app, /Call Candidate/);
});
