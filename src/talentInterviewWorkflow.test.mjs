import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../supabase/migrations/20260809000200_talent_interview_workflow.sql", import.meta.url);
const appUrl = new URL("./App.jsx", import.meta.url);
const dispatcherUrl = new URL("../supabase/functions/visaflow-email-dispatcher/index.ts", import.meta.url);

test("identity stays private until the candidate grants the new explicit consent", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /employer_contact_sharing_consent boolean not null default false/i);
  assert.match(sql, /case when candidate\.employer_contact_sharing_consent then candidate\.full_name else null end/i);
  assert.match(sql, /candidate\.employer_contact_sharing_consent is true/i);
});

test("interview scheduling is tenant-scoped and candidate-controlled", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /v_company_id uuid := public\.current_app_user_company_id\(\)/i);
  assert.match(sql, /company_id, candidate_id, requested_by_auth_user_id/i);
  assert.match(sql, /candidate\.auth_user_id = auth\.uid\(\)/i);
  assert.match(sql, /p_response not in \('Accepted', 'Declined'\)/i);
  assert.match(sql, /alter table public\.talent_interview_invitations enable row level security/i);
  assert.match(sql, /revoke all on table public\.talent_interview_invitations from public, anon, authenticated/i);
});

test("candidate and company portals expose the complete interview workflow", async () => {
  const app = await readFile(appUrl, "utf8");
  assert.match(app, /"Employer Contact Sharing": false/);
  assert.match(app, /list_candidate_talent_interviews/);
  assert.match(app, /respond_talent_interview/);
  assert.match(app, /schedule_talent_interview/);
  assert.match(app, /TALENT_INTERVIEW_INVITATION/);
});

test("AI interview start requires a fresh audible microphone signal", async () => {
  const app = await readFile(appUrl, "utf8");
  assert.match(app, /window\.AudioContext \|\| window\.webkitAudioContext/);
  assert.match(app, /createMediaStreamSource\(stream\)/);
  assert.match(app, /getByteTimeDomainData\(samples\)/);
  assert.match(app, /audibleFrames < 4 \|\| peakRms < 0\.025/);
  assert.match(app, /const interviewAlreadyStarted = \["In Progress", "Completed"\]\.includes\(nextSession\.status\)/);
  assert.match(app, /Please test your microphone before starting\./);
});

test("email recipient is resolved server-side from the authorized Talent candidate", async () => {
  const dispatcher = await readFile(dispatcherUrl, "utf8");
  assert.match(dispatcher, /TALENT_INTERVIEW_INVITATION:[\s\S]*?recipientSource: "talent_interview_invitations -> talent_candidates\.email"/);
  assert.match(dispatcher, /if \(type === "TALENT_INTERVIEW_INVITATION"\)[\s\S]*?\.eq\("company_id", caller\.actor\.company_id\)/);
  assert.match(dispatcher, /\.eq\("employer_contact_sharing_consent", true\)/);
  assert.doesNotMatch(dispatcher, /TALENT_INTERVIEW_INVITATION[\s\S]{0,500}body\.recipient/);
});
