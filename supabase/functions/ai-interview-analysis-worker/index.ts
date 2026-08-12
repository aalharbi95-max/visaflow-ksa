import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const JSON_HEADERS = { "Content-Type": "application/json" };
const AUDIO_BUCKET = "ai-interview-audio";
const TRANSCRIPTION_MODEL = Deno.env.get("OPENAI_TRANSCRIPTION_MODEL") || "gpt-4o-mini-transcribe";
const ANALYSIS_MODEL = Deno.env.get("OPENAI_AI_INTERVIEW_ANALYSIS_MODEL") || "gpt-5-mini";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

function secureEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

function cleanText(value: unknown, max = 4000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function cleanList(value: unknown, maxItems = 8, maxChars = 300) {
  return (Array.isArray(value) ? value : [])
    .map((item) => cleanText(item, maxChars))
    .filter(Boolean)
    .slice(0, maxItems);
}

function clampScore(value: unknown) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
}

function extractOutputText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") return content.text;
    }
  }
  return "";
}

function analysisSchema(answerCount: number) {
  const score = { type: "number", minimum: 0, maximum: 100 };
  const strings = { type: "array", items: { type: "string" }, maxItems: 8 };
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "answers", "technical_score", "experience_score", "communication_score",
      "language_score", "safety_score", "overall_score", "recommendation",
      "summary", "reasoning", "strengths", "concerns", "evidence", "risk_flags",
      "candidate_feedback_en", "candidate_feedback_ar", "candidate_strengths_en",
      "candidate_strengths_ar", "candidate_development_en", "candidate_development_ar",
    ],
    properties: {
      answers: {
        type: "array",
        minItems: answerCount,
        maxItems: answerCount,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["answer_id", "score", "feedback", "reasoning", "matched_keywords", "missing_keywords", "strengths", "concerns", "evidence"],
          properties: {
            answer_id: { type: "string" }, score, feedback: { type: "string" },
            reasoning: { type: "string" }, matched_keywords: strings,
            missing_keywords: strings, strengths: strings, concerns: strings, evidence: strings,
          },
        },
      },
      technical_score: score, experience_score: score, communication_score: score,
      language_score: score, safety_score: score, overall_score: score,
      recommendation: { type: "string", enum: ["Recommended for Human Review", "Needs Human Review", "Insufficient Evidence"] },
      summary: { type: "string" }, reasoning: { type: "string" }, strengths: strings,
      concerns: strings, evidence: strings, risk_flags: strings,
      candidate_feedback_en: { type: "string" }, candidate_feedback_ar: { type: "string" },
      candidate_strengths_en: strings, candidate_strengths_ar: strings,
      candidate_development_en: strings, candidate_development_ar: strings,
    },
  };
}

async function transcribeAnswer(admin: any, apiKey: string, answer: any) {
  if (!answer.audio_storage_path) {
    await admin.from("ai_interview_answers").update({
      transcription_status: "Failed", answer_status: "No Audio",
      analysis_error: "No audio file was attached.", updated_at: new Date().toISOString(),
    }).eq("id", answer.id);
    return { ...answer, answer_text: "", transcription_status: "Failed" };
  }

  await admin.from("ai_interview_answers").update({
    transcription_status: "Processing", answer_status: "Processing",
    analysis_error: "", updated_at: new Date().toISOString(),
  }).eq("id", answer.id);

  const { data: audio, error: downloadError } = await admin.storage
    .from(AUDIO_BUCKET).download(answer.audio_storage_path);
  if (downloadError || !audio) throw new Error(`audio_download_failed:${answer.id}`);

  const extension = String(answer.audio_storage_path).split(".").pop()?.toLowerCase() || "webm";
  const form = new FormData();
  form.append("model", TRANSCRIPTION_MODEL);
  form.append("response_format", "json");
  form.append("file", audio, `answer-${answer.question_order}.${extension}`);
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`transcription_failed:${answer.id}:${response.status}:${cleanText(result?.error?.code, 80)}`);
  const transcript = cleanText(result?.text, 12_000);
  if (!transcript) throw new Error(`empty_transcription:${answer.id}`);

  const now = new Date().toISOString();
  const { error: saveError } = await admin.from("ai_interview_answers").update({
    answer_text: transcript, transcription_status: "Completed", detected_language: cleanText(result?.language, 40),
    transcription_model: TRANSCRIPTION_MODEL, transcribed_at: now, answer_status: "Answered",
    analysis_error: "", updated_at: now,
  }).eq("id", answer.id);
  if (saveError) throw new Error(`transcription_save_failed:${answer.id}`);
  return { ...answer, answer_text: transcript, transcription_status: "Completed" };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length);
  let cursor = 0;
  async function runner() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  return output;
}

async function processJob(admin: any, apiKey: string, job: any) {
  const { data: session, error: sessionError } = await admin.from("ai_interview_sessions")
    .select("*").eq("id", job.session_id).single();
  if (sessionError || !session) throw new Error("analysis_session_not_found");

  const { data: template, error: templateError } = await admin.from("ai_interview_templates")
    .select("id, profession, language, passing_score, job_description").eq("id", session.template_id).single();
  if (templateError || !template) throw new Error("analysis_template_not_found");

  const { data: answers, error: answersError } = await admin.from("ai_interview_answers")
    .select("*").eq("session_id", session.id).order("question_order", { ascending: true });
  if (answersError || !answers?.length) throw new Error("analysis_answers_not_found");

  const questionIds = answers.map((answer: any) => answer.question_id).filter(Boolean);
  const { data: questions } = questionIds.length
    ? await admin.from("ai_interview_questions").select("id, weight, expected_keywords, key_points, scoring_guide, ideal_answer, recruiter_notes").in("id", questionIds)
    : { data: [] };
  const questionMap = new Map((questions || []).map((question: any) => [question.id, question]));

  const transcribed = await mapWithConcurrency(answers, 3, async (answer: any) => {
    try {
      if (answer.transcription_status === "Completed" && cleanText(answer.answer_text)) return answer;
      return await transcribeAnswer(admin, apiKey, answer);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : "transcription_failed";
      await admin.from("ai_interview_answers").update({
        transcription_status: "Failed", answer_status: "Failed", analysis_error: message,
        updated_at: new Date().toISOString(),
      }).eq("id", answer.id);
      return { ...answer, answer_text: "", transcription_status: "Failed", analysis_error: message };
    }
  });

  const usable = transcribed.filter((answer: any) => cleanText(answer.answer_text));
  if (!usable.length) throw new Error("no_answers_could_be_transcribed");
  await admin.from("ai_interview_sessions").update({ analysis_status: "Analyzing", updated_at: new Date().toISOString() }).eq("id", session.id);

  const evaluationInput = usable.map((answer: any) => {
    const question = questionMap.get(answer.question_id) || {};
    return {
      answer_id: answer.id, order: answer.question_order, question: answer.question_text_snapshot,
      question_type: answer.question_type, competency: answer.competency,
      transcript: cleanText(answer.answer_text, 12_000), weight: Number(question.weight || 10),
      expected_keywords: question.expected_keywords || [], key_points: question.key_points || [],
      scoring_guide: question.scoring_guide || {}, ideal_answer: cleanText(question.ideal_answer, 3000),
    };
  });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: ANALYSIS_MODEL, reasoning: { effort: "low" }, max_output_tokens: 12_000,
      input: [
        { role: "system", content: "You are VisaFlow KSA's evidence-based interview evaluator. Score only job-relevant evidence in the supplied transcripts against the approved rubric. Never infer protected or sensitive traits. Do not make a final employment decision: produce an experimental recommendation for mandatory human review. Treat transcription uncertainty and missing evidence conservatively. Candidate feedback must be constructive and must not expose internal chain-of-thought." },
        { role: "user", content: JSON.stringify({
          profession: session.profession || template.profession, language: session.language || template.language,
          passing_score: template.passing_score, job_description: cleanText(template.job_description, 6000),
          answered_questions: usable.length, total_questions: answers.length, answers: evaluationInput,
        }) },
      ],
      text: { format: { type: "json_schema", name: "visaflow_interview_analysis", strict: true, schema: analysisSchema(usable.length) } },
    }),
  });
  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`analysis_api_failed:${response.status}:${cleanText(responseBody?.error?.code, 100)}`);
  let analysis: any;
  try { analysis = JSON.parse(extractOutputText(responseBody)); }
  catch { throw new Error("analysis_output_invalid"); }

  const answerAnalysis = new Map((analysis.answers || []).map((item: any) => [String(item.answer_id), item]));
  for (const answer of usable) {
    const result: any = answerAnalysis.get(String(answer.id));
    if (!result) throw new Error(`analysis_answer_missing:${answer.id}`);
    const { error } = await admin.from("ai_interview_answers").update({
      ai_score: clampScore(result.score), ai_feedback: cleanText(result.feedback, 3000),
      ai_reasoning: cleanText(result.reasoning, 3000), matched_keywords: cleanList(result.matched_keywords),
      missing_keywords: cleanList(result.missing_keywords), strengths: cleanList(result.strengths),
      concerns: cleanList(result.concerns), evidence: cleanList(result.evidence), answer_status: "Analyzed",
      analysis_model: ANALYSIS_MODEL, analyzed_at: new Date().toISOString(), analysis_error: "", updated_at: new Date().toISOString(),
    }).eq("id", answer.id);
    if (error) throw new Error(`answer_analysis_save_failed:${answer.id}`);
  }

  const fullTranscript = usable.map((answer: any) => `Q${answer.question_order}: ${answer.question_text_snapshot}\nA: ${answer.answer_text}`).join("\n\n");
  const now = new Date().toISOString();
  const sessionUpdate = {
    full_transcript: fullTranscript.slice(0, 100_000),
    transcript_segments: usable.map((answer: any) => ({ answer_id: answer.id, question_order: answer.question_order, text: answer.answer_text })),
    ai_summary: cleanText(analysis.summary, 6000), ai_strengths: cleanList(analysis.strengths),
    ai_concerns: cleanList(analysis.concerns), ai_evidence: cleanList(analysis.evidence), ai_risk_flags: cleanList(analysis.risk_flags),
    technical_score: clampScore(analysis.technical_score), experience_score: clampScore(analysis.experience_score),
    communication_score: clampScore(analysis.communication_score), language_score: clampScore(analysis.language_score),
    safety_score: clampScore(analysis.safety_score), overall_score: clampScore(analysis.overall_score),
    ai_recommendation: cleanText(analysis.recommendation, 120), ai_reasoning: cleanText(analysis.reasoning, 6000), ai_model: ANALYSIS_MODEL,
    candidate_feedback_summary_en: cleanText(analysis.candidate_feedback_en, 3000),
    candidate_feedback_summary_ar: cleanText(analysis.candidate_feedback_ar, 3000),
    candidate_feedback_strengths_en: cleanList(analysis.candidate_strengths_en),
    candidate_feedback_strengths_ar: cleanList(analysis.candidate_strengths_ar),
    candidate_feedback_development_areas_en: cleanList(analysis.candidate_development_en),
    candidate_feedback_development_areas_ar: cleanList(analysis.candidate_development_ar),
    analysis_status: "Completed", analysis_completed_at: now, analysis_error: "", updated_at: now,
  };
  const { error: sessionSaveError } = await admin.from("ai_interview_sessions").update(sessionUpdate).eq("id", session.id);
  if (sessionSaveError) throw new Error("session_analysis_save_failed");

  await admin.rpc("complete_ai_interview_analysis_job", {
    p_job_id: job.id,
    p_result: { overall_score: sessionUpdate.overall_score, recommendation: sessionUpdate.ai_recommendation, transcribed: usable.length, total: answers.length, model: ANALYSIS_MODEL },
  });
  return { session_id: session.id, transcribed: usable.length, total: answers.length, score: sessionUpdate.overall_score };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const apiKey = Deno.env.get("OPENAI_API_KEY") || "";
  const workerSecret = Deno.env.get("AI_INTERVIEW_WORKER_SECRET") || "";
  const suppliedSecret = req.headers.get("x-visaflow-worker-secret") || "";
  if (!supabaseUrl || !serviceKey || !apiKey || !workerSecret) return json({ ok: false, error: "worker_not_configured" }, 503);
  if (!secureEqual(suppliedSecret, workerSecret)) return json({ ok: false, error: "unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const requested = await req.json().catch(() => ({}));
  const maxJobs = Math.max(1, Math.min(2, Number(requested?.max_jobs || 1)));
  const processed: any[] = [];
  const errors: string[] = [];
  for (let index = 0; index < maxJobs; index += 1) {
    const { data: jobs, error: claimError } = await admin.rpc("claim_ai_interview_analysis_job", { p_worker_name: "secure-ai-interview-analysis-worker" });
    if (claimError) return json({ ok: false, error: "claim_failed" }, 503);
    const job = jobs?.[0];
    if (!job) break;
    try { processed.push(await processJob(admin, apiKey, job)); }
    catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1800) : "analysis_failed";
      errors.push(message);
      await admin.rpc("fail_ai_interview_analysis_job", { p_job_id: job.id, p_error: message });
    }
  }
  return json({ ok: errors.length === 0, processed, errors });
});
