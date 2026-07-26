import { corsHeaders, json, readJson, requireAuthUser } from "../_shared/visaflow-security.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, message: "Method not allowed." }, 405);
  try {
    const { user } = await requireAuthUser(req, { interview: true });
    const body = await readJson(req);
    const { data, error } = await user.rpc("get_ai_interview_portal_state", { p_capability_id: body.capability_id });
    if (error || !data?.session) return json({ ok: false, message: "This interview session is unavailable." }, 403);
    return json({ ok: true, ...data });
  } catch {
    return json({ ok: false, message: "This interview session is unavailable." }, 403);
  }
});
