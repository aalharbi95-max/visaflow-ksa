export const ENGINEERING_TALENT_CAMPAIGN_SLUG = "saudi-engineers-2026";
export const HR_TALENT_CAMPAIGN_SLUG = "saudi-hr-professionals-2026";

export function getTalentCampaignSlug(locationLike = globalThis.location) {
  try {
    return String(new URLSearchParams(locationLike?.search || "").get("talent_campaign") || "").trim();
  } catch {
    return "";
  }
}

export function getCampaignReadiness({ profile, primaryCv, consents, templateId }) {
  const missing = [];
  if (!String(profile?.full_name || "").trim()) missing.push("full_name");
  if (!String(profile?.phone || "").trim()) missing.push("phone");
  if (!primaryCv?.id) missing.push("cv");
  if (!consents?.["Platform Terms"]) missing.push("platform_terms");
  if (!consents?.["Privacy Policy"]) missing.push("privacy_policy");
  if (!consents?.["Employer Sharing"]) missing.push("cv_sharing");
  if (!consents?.["Employer Contact Sharing"]) missing.push("contact_sharing");
  if (!consents?.["AI Interview"]) missing.push("ai_interview");
  if (!String(templateId || "").trim()) missing.push("engineering_template");
  return { ready: missing.length === 0, missing };
}

export function buildCampaignUrl(currentHref, slug = ENGINEERING_TALENT_CAMPAIGN_SLUG) {
  const url = new URL(currentHref);
  url.searchParams.set("talent", "1");
  url.searchParams.set("talent_campaign", slug);
  url.hash = "";
  return url.toString();
}

export function buildLinkedInEngineeringCampaignDraft(campaignUrl) {
  return {
    title: "دعوة للمهندسين: اختبر جاهزيتك المهنية مع VisaFlow Talent",
    body: [
      "هل أنت مهندس وتبحث عن فرصة مهنية في المملكة العربية السعودية؟",
      "سجّل في VisaFlow Talent، ارفع سيرتك الذاتية، واختر تخصصك الهندسي لإجراء مقابلة مهنية مدعومة بالذكاء الاصطناعي.",
      "مشاركة السيرة الذاتية مع الشركات المشتركة شرط لدخول الاختبار، أما مشاركة نتيجة الاختبار فهي اختيارية بالكامل وتبقى تحت تحكمك.",
      `التسجيل: ${campaignUrl}`,
      "#Engineering #SaudiArabia #Jobs #مهندسين #وظائف_هندسية #VisaFlowTalent",
    ].join("\n\n"),
  };
}

export function getCampaignProfessionLabel(slug, language = "AR") {
  const isArabic = String(language).toUpperCase() === "AR";
  if (slug === ENGINEERING_TALENT_CAMPAIGN_SLUG) {
    return isArabic ? "اختر تخصصك الهندسي" : "Select your engineering profession";
  }
  if (slug === HR_TALENT_CAMPAIGN_SLUG) {
    return isArabic ? "اختر تخصصك في الموارد البشرية" : "Select your HR specialization";
  }
  return isArabic ? "اختر تخصصك المهني" : "Select your professional specialization";
}

export function buildLinkedInHrCampaignDraft(campaignUrl) {
  return {
    title: "دعوة لمتخصصي الموارد البشرية: اختبر جاهزيتك المهنية مع VisaFlow Talent",
    body: [
      "هل تعمل في الموارد البشرية وتبحث عن فرصة مهنية في المملكة العربية السعودية؟",
      "سجّل في VisaFlow Talent، وارفع سيرتك الذاتية، واختر مسارك المهني لإجراء مقابلة مدعومة بالذكاء الاصطناعي.",
      "تشمل الحملة: إدارة الموارد البشرية، الاستقطاب والتوظيف، العمليات، الرواتب، التعويضات والمزايا، التعلم والتطوير، علاقات الموظفين، شريك أعمال الموارد البشرية، والتحليلات والتطوير التنظيمي.",
      "مشاركة السيرة وبيانات التواصل مع الشركات المشتركة شرط لدخول الاختبار، أما مشاركة نتيجة الاختبار فهي اختيارية بالكامل.",
      `التسجيل: ${campaignUrl}`,
      "#HumanResources #HRJobs #SaudiArabia #موارد_بشرية #وظائف #VisaFlowTalent",
    ].join("\n\n"),
  };
}
