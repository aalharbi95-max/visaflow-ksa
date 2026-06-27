import nodemailer from "npm:nodemailer@6.9.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type EmailPayload = {
  type?: string;
  to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  subject?: string;
  html?: string;
  text?: string;
  payload?: Record<string, unknown>;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function normalizeEmailList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value)
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value: string | undefined, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["true", "1", "yes", "ssl"].includes(String(value).toLowerCase());
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fallbackHtml(subject: string, text: string) {
  return `
  <div style="margin:0;padding:24px;background:#f4f7fb;font-family:Arial,Tahoma,sans-serif;color:#0f172a;">
    <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;">
      <div style="background:#061b49;color:#ffffff;padding:22px 26px;">
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.75;">VisaFlow KSA</div>
        <h1 style="margin:8px 0 0;font-size:22px;line-height:1.3;">${escapeHtml(subject)}</h1>
      </div>
      <div style="padding:24px 26px;line-height:1.7;font-size:15px;">
        ${escapeHtml(text || subject).replaceAll("\n", "<br />")}
      </div>
    </div>
  </div>`;
}

function requireSecret(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required secret: ${name}`);
  return value;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as EmailPayload;

    const to = normalizeEmailList(body.to);
    const cc = normalizeEmailList(body.cc);
    const bcc = normalizeEmailList(body.bcc);
    const subject = String(body.subject || "VisaFlow Notification").trim();
    const text = String(body.text || "").trim();
    const html = String(body.html || "").trim() || fallbackHtml(subject, text);

    if (!to.length) return jsonResponse({ ok: false, error: "Recipient email is required" }, 400);
    if (!subject) return jsonResponse({ ok: false, error: "Subject is required" }, 400);

    const smtpHost = Deno.env.get("SMTP_HOSTNAME") || "mail.privateemail.com";
    const smtpPort = Number(Deno.env.get("SMTP_PORT") || "465");
    const smtpSecure = parseBoolean(Deno.env.get("SMTP_SECURE"), smtpPort === 465);
    const smtpUser = requireSecret("SMTP_USERNAME");
    const smtpPass = requireSecret("SMTP_PASSWORD");
    const smtpFrom = Deno.env.get("SMTP_FROM") || `VisaFlow KSA <${smtpUser}>`;
    const defaultReplyTo = Deno.env.get("SMTP_REPLY_TO") || "support@visaflowksa.com";

    const transport = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const info = await new Promise<Record<string, unknown>>((resolve, reject) => {
      transport.sendMail(
        {
          from: smtpFrom,
          to,
          cc: cc.length ? cc : undefined,
          bcc: bcc.length ? bcc : undefined,
          replyTo: body.replyTo || defaultReplyTo,
          subject,
          text: text || undefined,
          html,
        },
        (error, info) => {
          if (error) return reject(error);
          resolve(info as unknown as Record<string, unknown>);
        },
      );
    });

    return jsonResponse({
      ok: true,
      type: body.type || "notification",
      messageId: String(info.messageId || ""),
      accepted: info.accepted || [],
      rejected: info.rejected || [],
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, 200);
  }
});
