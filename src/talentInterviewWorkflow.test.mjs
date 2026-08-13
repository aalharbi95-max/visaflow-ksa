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

test("recorded answers show a live sound meter and playback before approval", async () => {
  const app = await readFile(appUrl, "utf8");
  assert.match(app, /startRecordingLevelMeter\(stream\)/);
  assert.match(app, /recordingAudioLevel/);
  assert.match(app, /Voice is being received/);
  assert.match(app, /Listen to your answer before continuing/);
  assert.match(app, /Record answer again/);
  assert.match(app, /disabled=\{savingAnswer \|\| !currentAudioUrl\}/);
});

test("completed interviews poll until the result is shown or analysis fails", async () => {
  const app = await readFile(appUrl, "utf8");
  assert.match(app, /async function refreshInterviewResult\(\)/);
  assert.match(app, /window\.setTimeout\(refreshInterviewResult, 3000\)/);
  assert.match(app, /Interview result/);
  assert.match(app, /The result will appear here automatically/);
  assert.match(app, /The result could not be calculated/);
});

test("CV download retrieves an authenticated blob and saves it with the real filename", async () => {
  const app = await readFile(appUrl, "utf8");
  assert.match(app, /const previewWindow = download \? null : window\.open\("", "_blank"\)/);
  assert.match(app, /\.download\(document\.path\)/);
  assert.match(app, /window\.URL\.createObjectURL\(fileBlob\)/);
  assert.match(app, /link\.download = document\.file_name/);
  assert.match(app, /window\.URL\.revokeObjectURL\(blobUrl\)/);
});

test("company interview scheduling opens in a visible modal instead of below the profile grid", async () => {
  const app = await readFile(appUrl, "utf8");
  assert.match(app, /className="form-card talent-interview-modal"/);
  assert.match(app, /role="dialog" aria-modal="true"/);
  assert.match(app, /Send Interview Invitation/);
});

test("email recipient is resolved server-side from the authorized Talent candidate", async () => {
  const dispatcher = await readFile(dispatcherUrl, "utf8");
  assert.match(dispatcher, /TALENT_INTERVIEW_INVITATION:[\s\S]*?recipientSource: "talent_interview_invitations -> talent_candidates\.email"/);
  assert.match(dispatcher, /if \(type === "TALENT_INTERVIEW_INVITATION"\)[\s\S]*?\.eq\("company_id", caller\.actor\.company_id\)/);
  assert.match(dispatcher, /\.eq\("employer_contact_sharing_consent", true\)/);
  assert.doesNotMatch(dispatcher, /TALENT_INTERVIEW_INVITATION[\s\S]{0,500}body\.recipient/);
});
