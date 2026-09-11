import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildResendRequest,
  buildTwilioForm,
  retryDelayMinutes,
  sanitizeProviderError,
} from "../_shared/housingNotificationCore.mjs";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

function secureEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

async function sendEmail(delivery: any, event: any) {
  const apiKey = Deno.env.get("RESEND_API_KEY") || "";
  const from = Deno.env.get("HOUSING_FROM_EMAIL") || "";
  if (!apiKey || !from) throw new Error("resend_not_configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildResendRequest(delivery, event, from)),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`resend_${response.status}:${body?.message || "delivery_failed"}`);
  return { provider: "Resend", id: body?.id || null };
}

async function sendTwilio(delivery: any, event: any) {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
  const token = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
  const from = delivery.channel === "WhatsApp"
    ? Deno.env.get("TWILIO_WHATSAPP_FROM") || ""
    : Deno.env.get("TWILIO_SMS_FROM") || "";
  if (!sid || !token || !from) throw new Error("twilio_not_configured");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${btoa(`${sid}:${token}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: buildTwilioForm(delivery, event, from),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`twilio_${response.status}:${body?.message || "delivery_failed"}`);
  return { provider: "Twilio", id: body?.sid || null };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false, message: "Method not allowed." }, 405);
  const workerSecret = Deno.env.get("HOUSING_NOTIFICATION_WORKER_SECRET") || "";
  const suppliedSecret = request.headers.get("x-housing-worker-secret") || "";
  if (!workerSecret || !secureEqual(workerSecret, suppliedSecret)) return json({ ok: false, message: "Unauthorized." }, 401);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !serviceKey) return json({ ok: false, message: "Worker configuration is incomplete." }, 503);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { error: digestError } = await admin.rpc("housing_prepare_due_weekly_digests");
  const { data: deliveries, error: claimError } = await admin.rpc("housing_claim_notification_deliveries", { p_limit: 30 });
  if (claimError) return json({ ok: false, message: "Notification queue could not be claimed." }, 503);

  let sent = 0;
  let failed = 0;
  for (const delivery of deliveries || []) {
    try {
      const { data: event, error } = await admin.from("housing_notification_events").select("*").eq("id", delivery.event_id).single();
      if (error || !event) throw new Error("notification_event_missing");
      const result = delivery.channel === "Email" ? await sendEmail(delivery, event) : await sendTwilio(delivery, event);
      await admin.from("housing_notification_deliveries").update({
        status: "Sent", provider: result.provider, provider_message_id: result.id,
        sent_at: new Date().toISOString(), last_error: null,
      }).eq("id", delivery.id).eq("status", "Processing");
      sent += 1;
    } catch (error) {
      const delay = retryDelayMinutes(delivery.attempts);
      await admin.from("housing_notification_deliveries").update({
        status: "Failed", last_error: sanitizeProviderError(error),
        available_at: new Date(Date.now() + delay * 60_000).toISOString(),
      }).eq("id", delivery.id).eq("status", "Processing");
      failed += 1;
    }
  }
  return json({ ok: true, claimed: deliveries?.length || 0, sent, failed, digest_error: digestError?.message || null });
});
