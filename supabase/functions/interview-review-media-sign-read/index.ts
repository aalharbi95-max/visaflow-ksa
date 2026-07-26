import { corsHeaders, json, readJson, requireAuthUser } from "../_shared/visaflow-security.ts";

const roles = new Set(["Admin", "Company Admin", "CEO", "Operations Manager", "Recruitment Manager", "Recruitment Officer", "Platform Owner"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, message: "Method not allowed." }, 405);
  try {
    const { user, admin } = await requireAuthUser(req);
    const body = await readJson(req);
    const { data: context, error: contextError } = await user.rpc("get_authenticated_workspace_context");
    const actor = context?.actor;
    if (contextError || !actor || !roles.has(actor.role)) return json({ ok: false, message: "Recording unavailable." }, 403);
    let query = admin.from("ai_interview_answers").select("id, company_id, audio_storage_path").eq("id", body.answer_id).limit(2);
    if (actor.role !== "Platform Owner") query = query.eq("company_id", actor.company_id);
    const { data: rows, error } = await query;
    const answer = rows?.[0];
    if (error || rows?.length !== 1 || !answer?.audio_storage_path) return json({ ok: false, message: "Recording unavailable." }, 403);
    const { data: signed, error: signError } = await admin.storage.from("ai-interview-audio").createSignedUrl(answer.audio_storage_path, 60);
    if (signError || !signed?.signedUrl) return json({ ok: false, message: "Recording unavailable." }, 503);
    return json({ ok: true, signed_url: signed.signedUrl, expires_in: 60 });
  } catch {
    return json({ ok: false, message: "Recording unavailable." }, 403);
  }
});
