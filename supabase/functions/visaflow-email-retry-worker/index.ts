import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

const identifierFields: Record<string, string> = {
  AI_INTERVIEW_INVITATION: "interview_session_id",
  TALENT_INTERVIEW_INVITATION: "talent_interview_id",
  IMPORTED_TALENT_INTERVIEW_INVITATION: "imported_talent_interview_id",
  HIRING_PIPELINE_OFFER: "hiring_offer_id",
  AGENCY_USER_INVITATION: "request_id",
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const dispatcherSecret = Deno.env.get("VISAFLOW_EMAIL_DISPATCHER_SECRET") || "";
  const retrySecret = Deno.env.get("VISAFLOW_EMAIL_RETRY_WORKER_SECRET") || "";
  if (!url || !serviceKey || !dispatcherSecret || !retrySecret) return json({ error: "worker_not_configured" }, 503);
  if ((request.headers.get("x-visaflow-retry-secret") || "") !== retrySecret) return json({ error: "unauthorized" }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const body = await request.json().catch(() => ({}));
  const maxJobs = Math.max(1, Math.min(25, Number(body.max_jobs || 10)));
  const { data: jobs, error } = await admin.rpc("claim_email_retry_jobs", { p_limit: maxJobs });
  if (error) return json({ error: "retry_claim_failed" }, 500);

  let sent = 0;
  let failed = 0;
  for (const job of jobs || []) {
    const identifierField = identifierFields[job.message_type];
    if (!identifierField) continue;
    const payload = {
      message_type: job.message_type,
      [identifierField]: job.related_id,
      company_id: job.company_id,
      agency_id: job.agency_id,
      email_log_id: job.email_log_id,
      idempotency_key: job.idempotency_key,
      recipient: job.recipient,
      variables: {},
    };
    try {
      const response = await fetch(`${url}/functions/v1/visaflow-email-dispatcher-v2`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-visaflow-email-secret": dispatcherSecret },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        await admin.rpc("fail_claimed_email_retry", { p_email_log_id: job.email_log_id, p_error: `dispatcher_${response.status}` });
        throw new Error(`dispatcher_${response.status}`);
      }
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "retry_handoff_failed";
      if (!message.startsWith("dispatcher_")) {
        await admin.rpc("fail_claimed_email_retry", { p_email_log_id: job.email_log_id, p_error: message });
      }
      failed += 1;
    }
  }
  return json({ ok: failed === 0, claimed: (jobs || []).length, sent, failed });
});
