import { corsHeaders, json, readJson, requireAuthUser } from "../_shared/visaflow-security.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, message: "Method not allowed." }, 405);
  try {
    const { user } = await requireAuthUser(req);
    const body = await readJson(req, 12 * 1024);
    if (body.smtp_password || String(body.mode || "platform").toLowerCase() !== "platform") {
      return json({ ok: false, message: "Company SMTP credentials are temporarily disabled; VisaFlow Platform SMTP remains active." }, 400);
    }
    const safe = {
      mode: "platform",
      from_name: String(body.from_name || "").slice(0, 120),
      from_email: String(body.from_email || "").slice(0, 320),
      reply_to: String(body.reply_to || "").slice(0, 320),
      agreements_email: String(body.agreements_email || "").slice(0, 320),
      notifications_email: String(body.notifications_email || "").slice(0, 320),
      support_email: String(body.support_email || "").slice(0, 320),
      is_active: body.is_active !== false,
    };
    const { data, error } = await user.rpc("save_platform_email_settings", { p_settings: safe });
    if (error || !data?.id) return json({ ok: false, message: "Email settings could not be saved." }, 403);
    return json({ ok: true, settings: data });
  } catch {
    return json({ ok: false, message: "Email settings could not be saved." }, 403);
  }
});
