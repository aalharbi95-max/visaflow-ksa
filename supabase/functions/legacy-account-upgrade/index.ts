import { corsHeaders, json, readJson, sha256Hex } from "../_shared/visaflow-security.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, message: "Method not allowed." }, 405);
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const body = await readJson(req, 4096);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) return json({ ok: true, message: "If this account is eligible, a secure setup email will be sent." });

    const url = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const appUrl = (Deno.env.get("VISAFLOW_APP_URL") || "https://visaflowksa.com").replace(/\/+$/, "");
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const rateKey = await sha256Hex(`${ip}|${email}`);
    const { data: allowed, error: rateError } = await admin.rpc("consume_workspace_upgrade_rate_limit", { p_key_hash: rateKey });
    if (rateError || allowed !== true) return json({ ok: false, message: "Please wait before trying again." }, 429);
    const { data: prepared, error } = await admin.rpc("prepare_workspace_auth_upgrade", { p_email: email, p_password: password });
    if (error || !prepared?.upgrade_id) return json({ ok: true, message: "If this account is eligible, a secure setup email will be sent." });
    const redirectTo = `${appUrl}/?auth_flow=workspace&upgrade_id=${encodeURIComponent(prepared.upgrade_id)}`;
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(prepared.email, {
      redirectTo,
      data: { account_type: "workspace", workspace_upgrade_id: prepared.upgrade_id },
    });
    if (inviteError || !invited?.user?.id) return json({ ok: true, message: "If this account is eligible, a secure setup email will be sent." });
    const { error: markError } = await admin.rpc("mark_workspace_auth_upgrade_invited", {
      p_upgrade_id: prepared.upgrade_id,
      p_auth_user_id: invited.user.id,
    });
    if (markError) return json({ ok: false, message: "The secure setup could not be prepared." }, 503);
    return json({ ok: true, upgrade_required: true, message: "Check your email to finish securing this account." });
  } catch {
    return json({ ok: true, message: "If this account is eligible, a secure setup email will be sent." });
  }
});
