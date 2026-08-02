function escapeHtml(value = "") {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export function renderAgencyInvitationEmail({ agencyName, actionUrl, expiresHours = 24 }) {
  const safeAgency = escapeHtml(String(agencyName || "Agency"));
  const safeUrl = escapeHtml(String(actionUrl || ""));
  const subject = "VisaFlow Agency Account Invitation";
  const text = [
    subject,
    `Agency: ${String(agencyName || "Agency")}`,
    `This secure invitation expires in ${expiresHours} hours.`,
    "Open the HTML version and select Accept Invitation. If the button is unavailable, request a fresh invitation from your administrator.",
    "دعوة آمنة لتفعيل حساب المكتب. تنتهي صلاحية الرابط خلال 24 ساعة.",
    "VisaFlow KSA",
  ].join("\n");
  const html = `<div style="margin:0;padding:24px;background:#f4f7fb;font-family:Arial,Tahoma,sans-serif;color:#0f172a;"><div style="max-width:680px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;"><div style="background:#061b49;color:#fff;padding:22px 26px;"><h2 style="margin:0;">${subject}</h2></div><div style="padding:26px;line-height:1.7;font-size:15px;"><p>Hello ${safeAgency},</p><p>You have been invited to activate your VisaFlow Agency Portal account.</p><p dir="rtl">مرحبًا ${safeAgency}، تمت دعوتك لتفعيل حساب بوابة المكتب في VisaFlow.</p><p style="margin:26px 0;text-align:center;"><a href="${safeUrl}" style="display:inline-block;background:#0b5cff;color:#fff;text-decoration:none;padding:13px 24px;border-radius:10px;font-weight:700;">Accept Invitation / قبول الدعوة</a></p><p>This secure link expires in ${Number(expiresHours)} hours.</p><p dir="rtl">تنتهي صلاحية رابط التفعيل خلال ${Number(expiresHours)} ساعة.</p><p style="color:#64748b;font-size:13px;">If the button does not work, request a fresh invitation from your administrator. For security, the raw activation link is not displayed.</p></div><div style="padding:14px 26px;background:#f8fafc;color:#64748b;font-size:12px;">VisaFlow KSA</div></div></div>`;
  return { subject, text, html };
}
