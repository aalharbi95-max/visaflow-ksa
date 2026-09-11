function escapeHtml(value = "") {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export function renderPlatformCompanyInvitationEmail({ companyName, adminEmail, actionUrl, loginUrl }) {
  const company = String(companyName || "Company");
  const email = String(adminEmail || "");
  const safeCompany = escapeHtml(company);
  const safeEmail = escapeHtml(email);
  const safeActionUrl = escapeHtml(String(actionUrl || ""));
  const safeLoginUrl = escapeHtml(String(loginUrl || "https://visaflowksa.com/"));
  const subject = "Activate Your VisaFlow Company Account | تفعيل حساب شركتك";
  const text = [
    "VisaFlow KSA Company Account Invitation",
    `Company: ${company}`,
    `Username: ${email}`,
    "Use the activation button in the HTML version to create your password and activate the account.",
    "For security, the activation link is time-limited. Request a new link if it expires.",
    "دعوة لتفعيل حساب شركتك في VisaFlow KSA.",
    `اسم الشركة: ${company}`,
    `اسم المستخدم: ${email}`,
    "استخدم زر التفعيل في نسخة HTML لإنشاء كلمة المرور وتفعيل الحساب.",
    "الرابط آمن ومحدود الصلاحية، ويمكن طلب رابط جديد عند انتهاء صلاحيته.",
    `Login page: ${String(loginUrl || "https://visaflowksa.com/")}`,
  ].join("\n");
  const html = `<div style="margin:0;padding:24px;background:#f4f7fb;font-family:Arial,Tahoma,sans-serif;color:#0f172a;"><div style="max-width:680px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;"><div style="background:#061b49;color:#fff;padding:22px 26px;"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.75;">VisaFlow KSA</div><h2 style="margin:8px 0 0;">Company Account Invitation</h2><div dir="rtl" style="margin-top:6px;font-size:17px;">دعوة تفعيل حساب الشركة</div></div><div style="padding:26px;line-height:1.7;font-size:15px;"><p>Hello ${safeCompany},</p><p>Your company workspace is ready. Use the secure button below to activate the account and create your password.</p><div dir="rtl" style="text-align:right;border-top:1px solid #e5e7eb;padding-top:16px;margin-top:16px;"><p>مرحبًا ${safeCompany}،</p><p>مساحة عمل شركتك جاهزة. استخدم الزر الآمن أدناه لتفعيل الحساب وإنشاء كلمة المرور.</p></div><div style="margin:20px 0;padding:14px 16px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;"><div><strong>Company / الشركة:</strong> ${safeCompany}</div><div><strong>Username / اسم المستخدم:</strong> ${safeEmail}</div></div><p style="margin:26px 0;text-align:center;"><a href="${safeActionUrl}" style="display:inline-block;background:#0b5cff;color:#fff;text-decoration:none;padding:14px 24px;border-radius:10px;font-weight:700;">Activate Account &amp; Create Password<br><span dir="rtl">تفعيل الحساب وإنشاء كلمة المرور</span></a></p><p style="color:#64748b;font-size:13px;">This secure link is time-limited. If it expires, ask the platform owner to send a new setup link.</p><p dir="rtl" style="color:#64748b;font-size:13px;text-align:right;">هذا الرابط آمن ومحدود الصلاحية. عند انتهاء صلاحيته اطلب من مالك المنصة إرسال رابط إعداد جديد.</p><p style="font-size:13px;">Login page: <a href="${safeLoginUrl}">${safeLoginUrl}</a></p></div><div style="padding:14px 26px;background:#f8fafc;color:#64748b;font-size:12px;">VisaFlow KSA</div></div></div>`;
  return { subject, text, html };
}
