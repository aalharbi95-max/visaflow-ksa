import { corsHeaders, json, readJson, requireAuthUser } from "../_shared/visaflow-security.ts";

const actions = new Set(["accept_consent", "decline", "microphone_test", "camera_test", "start", "save_answer", "skip_answer", "set_question", "complete"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, message: "Method not allowed." }, 405);
  try {
    const { user } = await requireAuthUser(req, { interview: true });
    const body = await readJson(req);
    if (!actions.has(String(body.action || ""))) return json({ ok: false, message: "Unsupported interview action." }, 400);
    const { data, error } = await user.rpc("transition_ai_interview_portal", {
      p_capability_id: body.capability_id,
      p_action: body.action,
      p_payload: body.payload || {},
      p_idempotency_key: body.idempotency_key || null,
    });
    if (error || !data?.session) return json({ ok: false, message: "The interview action could not be completed." }, 403);
    return json({ ok: true, ...data });
  } catch {
    return json({ ok: false, message: "The interview action could not be completed." }, 403);
  }
});
