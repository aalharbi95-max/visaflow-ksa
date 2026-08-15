import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.10";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[character] || character));

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const smtpUser = Deno.env.get("SMTP_USERNAME") || "";
  const smtpPass = Deno.env.get("SMTP_PASSWORD") || "";
  const secret = Deno.env.get("TALENT_PROSPECT_WORKER_SECRET") || "";
  const smtpHost = Deno.env.get("SMTP_HOSTNAME") || "mail.privateemail.com";
  const smtpPort = Number(Deno.env.get("SMTP_PORT") || "465");
  const from = Deno.env.get("SMTP_FROM_EMAIL") || Deno.env.get("SMTP_FROM") || smtpUser;

  if (!url || !key || !smtpUser || !smtpPass || !from || !secret) {
    return json({ error: "worker_not_configured" }, 503);
  }
  if ((request.headers.get("x-visaflow-worker-secret") || "") !== secret) {
    return json({ error: "unauthorized" }, 401);
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const body = await request.json().catch(() => ({}));
  const transport = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: (Deno.env.get("SMTP_SECURE") || String(smtpPort === 465)).toLowerCase() !== "false",
    auth: { user: smtpUser, pass: smtpPass },
  });
  const max = Math.max(1, Math.min(20, Number(body.max_jobs || 20)));
  let sent = 0;
  let contactRequestsSent = 0;
  let profileInvitationsSent = 0;
  const errors: string[] = [];

  // Contact approvals take priority because a company is waiting for the response.
  for (let index = 0; index < max; index += 1) {
    const { data, error } = await admin.rpc("claim_talent_company_contact_email_job", {
      p_worker: "talent-email-worker",
    });
    const job = data?.[0];
    if (error) {
      // Keep the older invitation worker usable during a rolling database deployment.
      if (!/claim_talent_company_contact_email_job|schema cache|function/i.test(error.message || "")) {
        errors.push(error.message);
      }
      break;
    }
    if (!job) break;

    try {
      const base = "https://www.visaflowksa.com/?talent=1";
      const token = encodeURIComponent(job.decision_token);
      const approveLink = `${base}&talent_contact_token=${token}&talent_contact_response=Approved`;
      const declineLink = `${base}&talent_contact_token=${token}&talent_contact_response=Declined`;
      const candidateName = esc(job.candidate_name || "Candidate");
      const companyName = esc(job.company_name || "A company using VisaFlow Talent");
      const html = `
        <div style="font-family:Arial,Tahoma,sans-serif;background:#f4f7fb;padding:24px;color:#10243e">
          <div style="max-width:680px;margin:auto;background:#fff;border-radius:18px;overflow:hidden">
            <div style="background:#071b3d;color:#fff;padding:24px">
              <h2 style="margin:0 0 8px">طلب تواصل لإجراء مقابلة شخصية</h2>
              <div>Direct interview contact request</div>
            </div>
            <div dir="rtl" style="padding:26px;line-height:1.9;text-align:right">
              <p>مرحباً ${candidateName}،</p>
              <p>ترغب شركة <strong>${companyName}</strong> بالتواصل معك مباشرة لاستكمال إجراءات المقابلة الشخصية.</p>
              <p>بيانات التواصل الخاصة بك وأسماء الجهات التي عملت لديها غير ظاهرة للشركة حالياً؛ المعروض فقط هو ملخص خبراتك المهنية. عند موافقتك ستظهر بيانات التواصل لهذه الشركة وحدها، ولن تظهر لبقية الشركات.</p>
              <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin:28px 0">
                <a href="${approveLink}" style="background:#12877b;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:bold">موافق / Approve</a>
                <a href="${declineLink}" style="background:#64748b;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:bold">غير موافق / Decline</a>
              </div>
              <div dir="ltr" style="text-align:left;border-top:1px solid #e2e8f0;padding-top:18px">
                <p>Hello ${candidateName},</p>
                <p><strong>${companyName}</strong> would like to contact you directly to proceed with an interview.</p>
                <p>Your contact details and previous employer names are currently hidden. Approval reveals your contact details only to this company.</p>
              </div>
              <p style="font-size:12px;color:#64748b">تنتهي صلاحية الطلب خلال 14 يوماً. لا تُرسل ردك على هذا البريد؛ استخدم أحد الزرين أعلاه.</p>
            </div>
          </div>
        </div>`;
      const result = await transport.sendMail({
        from,
        to: job.recipient,
        replyTo: "support@visaflowksa.com",
        subject: `طلب تواصل من ${job.company_name} | Interview contact request`,
        html,
      });
      await admin.rpc("complete_talent_company_contact_email", {
        p_request_id: job.request_id,
        p_provider_id: String(result.messageId || ""),
      });
      contactRequestsSent += 1;
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "send_failed";
      errors.push(message);
      await admin.rpc("fail_talent_company_contact_email", {
        p_request_id: job.request_id,
        p_error: message,
      });
    }
  }

  for (let index = sent; index < max; index += 1) {
    const { data, error } = await admin.rpc("claim_talent_prospect_email_invitation_job", {
      p_worker: "talent-email-worker",
    });
    const prospect = data?.[0];
    if (error) {
      errors.push(error.message);
      break;
    }
    if (!prospect) break;

    try {
      const link = `https://www.visaflowksa.com/?talent=1&prospect_invite=${encodeURIComponent(prospect.invitation_token)}`;
      const name = esc(prospect.full_name || "Candidate");
      const html = `
        <div style="font-family:Arial,Tahoma,sans-serif;background:#f4f7fb;padding:24px;color:#10243e">
          <div style="max-width:680px;margin:auto;background:#fff;border-radius:18px;overflow:hidden">
            <div style="background:#071b3d;color:#fff;padding:24px"><h2>Complete your VisaFlow Talent profile</h2><div dir="rtl">أكمل ملفك في منصة VisaFlow Talent</div></div>
            <div style="padding:26px;line-height:1.8"><p>Hello ${name},</p><p>You are invited to complete your professional profile and access career opportunities in Saudi Arabia. Your information will not be shared with employers without your consent.</p>
              <div dir="rtl" style="text-align:right;border-top:1px solid #ddd;padding-top:16px"><p>مرحباً ${name}،</p><p>ندعوك لإكمال ملفك المهني والوصول إلى الفرص الوظيفية. لن تتم مشاركة بيانات التواصل مع الشركات دون موافقتك.</p></div>
              <p style="text-align:center;margin:28px"><a href="${link}" style="background:#12a89d;color:#fff;padding:14px 24px;border-radius:10px;text-decoration:none;font-weight:bold">Complete Profile / إكمال الملف</a></p>
              <p style="font-size:12px;color:#64748b">This link expires in 14 days. If you did not expect this invitation, you may ignore it.</p>
            </div>
          </div>
        </div>`;
      const result = await transport.sendMail({
        from,
        to: prospect.email,
        replyTo: "support@visaflowksa.com",
        subject: "Complete your VisaFlow Talent profile | أكمل ملفك المهني",
        html,
      });
      await admin.rpc("complete_talent_prospect_email_invitation", {
        p_id: prospect.id,
        p_provider_id: String(result.messageId || ""),
      });
      profileInvitationsSent += 1;
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "send_failed";
      errors.push(message);
      await admin.rpc("fail_talent_prospect_email_invitation", {
        p_id: prospect.id,
        p_error: message,
      });
    }
  }

  return json({
    ok: errors.length === 0,
    sent,
    contact_requests_sent: contactRequestsSent,
    profile_invitations_sent: profileInvitationsSent,
    errors,
  });
});
