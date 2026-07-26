import { corsHeaders, json, readJson, requireAuthUser } from "../_shared/visaflow-security.ts";

const allowedRoles = new Set(["Admin", "Company Admin", "Recruitment Manager"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, message: "Method not allowed." }, 405);
  try {
    const { user, admin } = await requireAuthUser(req);
    const body = await readJson(req, 8192);
    const { data: context, error: contextError } = await user.rpc("get_authenticated_workspace_context");
    const actor = context?.actor;
    if (contextError || !actor?.company_id || !allowedRoles.has(actor.role)) return json({ ok: false, message: "Forbidden." }, 403);
    if (body.action !== "acquire_lock") return json({ ok: false, message: "Unsupported action." }, 400);
    let verifiedAgencyId: string | null = null;
    if (body.agency_id) {
      const candidateAgencyId = String(body.agency_id);
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(candidateAgencyId)) return json({ ok: false, message: "Forbidden." }, 403);
      const { data: accessRows, error: accessError } = await admin.from("company_agency_access")
        .select("id, agency_id, company_id, status")
        .eq("company_id", actor.company_id)
        .eq("agency_id", candidateAgencyId)
        .eq("status", "Active")
        .limit(2);
      if (accessError || accessRows?.length !== 1) return json({ ok: false, message: "Forbidden." }, 403);
      verifiedAgencyId = candidateAgencyId;
    }
    const { data, error } = await admin.rpc("ai_agent_try_acquire_lock", {
      p_company_id: actor.company_id,
      p_action_key: String(body.action_key || "").slice(0, 300),
      p_action_type: String(body.action_type || "AI_AGENT_ACTION").slice(0, 100),
      p_related_table: String(body.related_table || "").slice(0, 100) || null,
      p_related_id: String(body.related_id || "").slice(0, 200) || null,
      p_agency_id: verifiedAgencyId,
      p_cooldown_minutes: Math.min(1440, Math.max(5, Number(body.cooldown_minutes || 60))),
    });
    if (error) return json({ ok: false, message: "AI Agent action could not be authorized." }, 403);
    return json({ ok: true, acquired: data === true });
  } catch {
    return json({ ok: false, message: "AI Agent action could not be authorized." }, 403);
  }
});
