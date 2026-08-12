import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workerUrl = new URL("../supabase/functions/ai-interview-analysis-worker/index.ts", import.meta.url);
const migrationUrl = new URL("../supabase/migrations/20260812000200_automatic_ai_interview_analysis.sql", import.meta.url);

test("analysis worker is secret-gated and uses service-only queue contracts", async () => {
  const worker = await readFile(workerUrl, "utf8");
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(worker, /AI_INTERVIEW_WORKER_SECRET/);
  assert.match(worker, /secureEqual\(suppliedSecret, workerSecret\)/);
  assert.match(worker, /claim_ai_interview_analysis_job/);
  assert.match(migration, /revoke all on function public\.claim_ai_interview_analysis_job\(text\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.claim_ai_interview_analysis_job\(text\) to service_role/i);
});

test("worker transcribes private recordings and stores structured evidence-based analysis", async () => {
  const worker = await readFile(workerUrl, "utf8");
  assert.match(worker, /ai-interview-audio/);
  assert.match(worker, /https:\/\/api\.openai\.com\/v1\/audio\/transcriptions/);
  assert.match(worker, /gpt-4o-mini-transcribe/);
  assert.match(worker, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(worker, /type: "json_schema"/);
  assert.match(worker, /Never infer protected or sensitive traits/);
  assert.match(worker, /mandatory human review/);
  assert.match(worker, /overall_score/);
  assert.match(worker, /candidate_feedback_summary_ar/);
});

test("completion triggers immediate analysis with a recurring retry fallback", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /perform public\.queue_ai_interview_analysis\(new\.id\)/i);
  assert.match(migration, /perform public\.trigger_ai_interview_analysis_worker\(\)/i);
  assert.match(migration, /visaflow-ai-interview-analysis-every-minute/i);
  assert.match(migration, /'\* \* \* \* \*'/);
  assert.match(migration, /where s\.status = 'Completed'/i);
});
