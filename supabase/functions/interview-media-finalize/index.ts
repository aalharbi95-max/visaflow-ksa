import { corsHeaders, json, readJson, requireAuthUser } from "../_shared/visaflow-security.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, message: "Method not allowed." }, 405);
  try {
    const { user, admin } = await requireAuthUser(req, { interview: true });
    const body = await readJson(req);
    const { data: finalized, error } = await user.rpc("finalize_ai_interview_media_upload", {
      p_capability_id: body.capability_id,
      p_upload_id: body.upload_id,
    });
    if (error || !finalized?.object_path) return json({ ok: false, message: "The media upload could not be finalized." }, 403);
    const slash = finalized.object_path.lastIndexOf("/");
    const folder = finalized.object_path.slice(0, slash);
    const name = finalized.object_path.slice(slash + 1);
    const { data: objects, error: listError } = await admin.storage.from("ai-interview-audio").list(folder, { search: name, limit: 2 });
    const object = (objects || []).find((item) => item.name === name);
    const storedMime = String(object?.metadata?.mimetype || object?.metadata?.contentType || "").toLowerCase();
    const expectedMime = String(finalized.content_type || "").toLowerCase();
    if (
      listError ||
      !object ||
      Number(object.metadata?.size || 0) !== Number(finalized.content_length) ||
      storedMime !== expectedMime
    ) {
      await admin.storage.from("ai-interview-audio").remove([finalized.object_path]);
      return json({ ok: false, message: "The uploaded media did not pass verification." }, 400);
    }
    const { error: confirmError } = await admin.rpc("confirm_ai_interview_media_upload", { p_upload_id: finalized.upload_id });
    if (confirmError) {
      await admin.storage.from("ai-interview-audio").remove([finalized.object_path]);
      return json({ ok: false, message: "The media upload could not be finalized." }, 503);
    }
    return json({ ok: true, upload_id: finalized.upload_id, question_id: finalized.question_id });
  } catch {
    return json({ ok: false, message: "The media upload could not be finalized." }, 403);
  }
});
