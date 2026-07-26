import { corsHeaders, json, readJson, requireAuthUser } from "../_shared/visaflow-security.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, message: "Method not allowed." }, 405);
  try {
    const { user, admin } = await requireAuthUser(req, { interview: true });
    const body = await readJson(req);
    const { data: prepared, error } = await user.rpc("prepare_ai_interview_media_upload", {
      p_capability_id: body.capability_id,
      p_question_id: body.question_id,
      p_content_type: body.content_type,
      p_content_length: body.content_length,
    });
    if (error || !prepared?.object_path) return json({ ok: false, message: "The media upload is unavailable." }, 403);
    const { data: signed, error: signError } = await admin.storage.from("ai-interview-audio").createSignedUploadUrl(prepared.object_path, { upsert: false });
    if (signError || !signed?.signedUrl) return json({ ok: false, message: "The media upload is unavailable." }, 503);
    return json({ ok: true, upload_id: prepared.upload_id, upload_url: signed.signedUrl, expires_at: prepared.expires_at });
  } catch {
    return json({ ok: false, message: "The media upload is unavailable." }, 403);
  }
});
