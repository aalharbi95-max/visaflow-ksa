import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-visaflow-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

function secureEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, message: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const dispatcherSecret = Deno.env.get("VISAFLOW_EMAIL_DISPATCHER_SECRET") || "";
  const workerSecret = Deno.env.get("AI_INTERVIEW_WORKER_SECRET") || "";
  const suppliedSecret = req.headers.get("x-visaflow-worker-secret") || "";
  if (!supabaseUrl || !serviceKey || !dispatcherSecret || !workerSecret || !secureEqual(suppliedSecret, workerSecret)) {
    return json({ ok: false, message: "Unauthorized." }, 401);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: jobs, error: claimError } = await admin.rpc("claim_ai_interview_invitation_jobs", {
    p_limit: 20,
    p_worker: "secure-ai-interview-invitation-worker",
  });
  if (claimError) return json({ ok: false, message: "Invitation jobs could not be claimed." }, 503);

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const job of jobs || []) {
    try {
      if (!job?.id || !job?.session_id || !job?.company_id) throw new Error("invalid_job");
      const response = await fetch(`${supabaseUrl}/functions/v1/visaflow-email-dispatcher`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
          "apikey": serviceKey,
          "x-visaflow-email-secret": dispatcherSecret,
        },
        body: JSON.stringify({
          message_type: "AI_INTERVIEW_INVITATION",
          interview_session_id: job.session_id,
          company_id: job.company_id,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.ok !== true) {
        throw new Error(`delivery_failed:${response.status}:${String(result?.error || result?.message || "unknown")}`);
      }
      const { error: completeError } = await admin.rpc("complete_ai_interview_invitation_job", {
        p_job_id: job.id,
        p_message_id: String(result?.message_id || ""),
        p_provider: "VisaFlow Email Dispatcher",
      });
      if (completeError) throw new Error("completion_failed");
      sent += 1;
    } catch (error) {
      failed += 1;
      const errorMessage = error instanceof Error ? error.message.slice(0, 180) : "unknown_error";
      errors.push(errorMessage);
      await admin.rpc("fail_ai_interview_invitation_job", {
        p_job_id: job?.id,
        p_error: errorMessage,
        p_retry_delay_minutes: 5,
      });
    }
  }

  return json({ ok: true, claimed: (jobs || []).length, sent, failed, errors });
});
