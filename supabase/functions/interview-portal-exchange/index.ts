import { corsHeaders, json, readJson, requireAuthUser, safeError, sha256Hex } from "../_shared/visaflow-security.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, message: "Method not allowed." }, 405);
  try {
    const { user } = await requireAuthUser(req, { interview: true });
    const body = await readJson(req, 4096);
    const secret = String(body.invitation_secret || "");
    if (!/^[0-9a-f]{64}$/i.test(secret)) return json({ ok: false, message: "This interview link is invalid or expired." }, 403);
    const { data, error } = await user.rpc("exchange_ai_interview_invitation", { p_token_hash: await sha256Hex(secret) });
    if (error || !data?.capability_id) return json({ ok: false, message: "This interview link is invalid, expired, or already used." }, 403);
    return json({ ok: true, capability_id: data.capability_id, expires_at: data.expires_at });
  } catch (error) {
    const code = safeError(error);
    return json({ ok: false, message: code === "unauthorized" ? "A secure interview session is required." : "This interview link is unavailable." }, code === "unauthorized" ? 401 : 403);
  }
});
