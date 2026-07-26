import { corsHeaders, json, readJson, requireAuthUser } from "../_shared/visaflow-security.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, message: "Method not allowed." }, 405);
  try {
    const { user, admin } = await requireAuthUser(req, { interview: true });
    const body = await readJson(req);
    const { data: path, error } = await user.rpc("get_ai_interview_answer_media_path", {
      p_capability_id: body.capability_id,
      p_answer_id: body.answer_id,
    });
    if (error || !path) return json({ ok: false, message: "The interview media is unavailable." }, 403);
    const { data: signed, error: signError } = await admin.storage.from("ai-interview-audio").createSignedUrl(path, 60);
    if (signError || !signed?.signedUrl) return json({ ok: false, message: "The interview media is unavailable." }, 503);
    return json({ ok: true, signed_url: signed.signedUrl, expires_in: 60 });
  } catch {
    return json({ ok: false, message: "The interview media is unavailable." }, 403);
  }
});
