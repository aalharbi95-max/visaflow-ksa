export const ENGINEERING_TALENT_CAMPAIGN_SLUG = "saudi-engineers-2026";
export const HR_TALENT_CAMPAIGN_SLUG = "saudi-hr-professionals-2026";
export const FINANCE_TALENT_CAMPAIGN_SLUG = "finance-accounting-professionals-2026";
export const IT_TALENT_CAMPAIGN_SLUG = "it-digital-professionals-2026";

const TALENT_CAMPAIGN_CONTENT = {
  [ENGINEERING_TALENT_CAMPAIGN_SLUG]: {
    nameAr: "حملة المهندسين",
    nameEn: "Engineering Campaign",
    descriptionAr: "محاكاة مقابلات لجميع التخصصات الهندسية المعتمدة.",
    descriptionEn: "Interview simulations for approved engineering professions.",
    professionLabelAr: "اختر تخصصك الهندسي",
    professionLabelEn: "Select your engineering profession",
    badgeAr: "حملة VisaFlow للمواهب الهندسية",
    badgeEn: "VisaFlow Engineering Talent Campaign",
    headlineAr: "للمهندسين: سجّل، اختر تخصصك، واختبر جاهزيتك.",
    headlineEn: "Engineers: register, choose your profession, and test your readiness.",
    introAr: "الحملة تشمل جميع التخصصات الهندسية التي لها قالب معتمد. مشاركة السيرة مع الشركات مطلوبة لدخول الاختبار، ومشاركة النتيجة اختيارية وتحت تحكمك.",
    introEn: "The campaign includes every engineering profession with an approved template. CV sharing is required to enter the assessment; sharing the result is optional and remains under your control.",
  },
  [HR_TALENT_CAMPAIGN_SLUG]: {
    nameAr: "حملة الموارد البشرية",
    nameEn: "Human Resources Campaign",
    descriptionAr: "محاكاة مقابلات لمسارات وتخصصات الموارد البشرية.",
    descriptionEn: "Interview simulations for Human Resources specializations.",
    professionLabelAr: "اختر تخصصك في الموارد البشرية",
    professionLabelEn: "Select your HR specialization",
    badgeAr: "حملة VisaFlow لمواهب الموارد البشرية",
    badgeEn: "VisaFlow Human Resources Talent Campaign",
    headlineAr: "لمتخصصي الموارد البشرية: سجّل، اختر مسارك، واختبر جاهزيتك.",
    headlineEn: "HR professionals: register, choose your track, and test your readiness.",
    introAr: "الحملة تشمل مسارات الموارد البشرية المعتمدة. مشاركة السيرة مع الشركات مطلوبة لدخول الاختبار، ومشاركة النتيجة اختيارية وتحت تحكمك.",
    introEn: "The campaign includes approved HR specializations. CV sharing is required to enter the assessment; result sharing remains optional.",
  },
  [FINANCE_TALENT_CAMPAIGN_SLUG]: {
    nameAr: "حملة الكفاءات المالية والمحاسبية",
    nameEn: "Finance & Accounting Campaign",
    descriptionAr: "محاكاة مقابلات لمسارات المالية والمحاسبة والمراجعة والمخاطر.",
    descriptionEn: "Interview simulations for finance, accounting, audit, treasury, and risk tracks.",
    professionLabelAr: "اختر تخصصك في المالية والمحاسبة",
    professionLabelEn: "Select your finance or accounting specialization",
    badgeAr: "حملة VisaFlow للكفاءات المالية والمحاسبية",
    badgeEn: "VisaFlow Finance & Accounting Talent Campaign",
    headlineAr: "للكفاءات المالية والمحاسبية: سجّل، اختر مسارك، واختبر جاهزيتك.",
    headlineEn: "Finance and accounting professionals: register, choose your track, and test your readiness.",
    introAr: "الحملة متاحة لجميع المتخصصين المؤهلين في المالية والمحاسبة دون اشتراط جنسية. مشاركة السيرة مع الشركات مطلوبة لدخول الاختبار، ومشاركة النتيجة اختيارية وتحت تحكمك.",
    introEn: "The campaign is open to qualified finance and accounting professionals of all nationalities. CV sharing is required to enter the assessment; result sharing remains optional.",
  },
  [IT_TALENT_CAMPAIGN_SLUG]: {
    nameAr: "حملة كفاءات تقنية المعلومات",
    nameEn: "IT & Digital Talent Campaign",
    descriptionAr: "محاكاة مقابلات لمسارات البرمجيات والبيانات والأمن السيبراني والبنية التحتية والدعم التقني.",
    descriptionEn: "Interview simulations for software, data, cybersecurity, infrastructure, and IT support tracks.",
    professionLabelAr: "اختر تخصصك في تقنية المعلومات",
    professionLabelEn: "Select your IT specialization",
    badgeAr: "حملة VisaFlow لكفاءات تقنية المعلومات",
    badgeEn: "VisaFlow IT & Digital Talent Campaign",
    headlineAr: "لمتخصصي تقنية المعلومات: سجّل، اختر مسارك، واختبر جاهزيتك.",
    headlineEn: "IT professionals: register, choose your track, and test your readiness.",
    introAr: "الحملة متاحة لجميع المتخصصين المؤهلين في تقنية المعلومات دون اشتراط جنسية. مشاركة السيرة وبيانات التواصل مع الشركات مطلوبة لدخول الاختبار، ومشاركة النتيجة اختيارية وتحت تحكمك.",
    introEn: "The campaign is open to qualified IT professionals of all nationalities. CV and contact sharing with employers are required to enter the assessment; result sharing remains optional.",
  },
};

export function getTalentCampaignContent(slug, language = "AR") {
  const content = TALENT_CAMPAIGN_CONTENT[slug] || null;
  if (!content) return null;
  const isArabic = String(language).toUpperCase() === "AR";
  return {
    slug,
    name: isArabic ? content.nameAr : content.nameEn,
    description: isArabic ? content.descriptionAr : content.descriptionEn,
    professionLabel: isArabic ? content.professionLabelAr : content.professionLabelEn,
    badge: isArabic ? content.badgeAr : content.badgeEn,
    headline: isArabic ? content.headlineAr : content.headlineEn,
    intro: isArabic ? content.introAr : content.introEn,
  };
}

export function getAvailableTalentCampaigns(language = "AR") {
  return Object.keys(TALENT_CAMPAIGN_CONTENT).map((slug) => getTalentCampaignContent(slug, language));
}

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
  if (!String(templateId || "").trim()) missing.push("campaign_template");
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
  const content = getTalentCampaignContent(slug, language);
  if (content) return content.professionLabel;
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

export function buildLinkedInFinanceCampaignDraft(campaignUrl) {
  return {
    title: "دعوة للكفاءات المالية والمحاسبية: اختبر جاهزيتك المهنية مع VisaFlow Talent",
    body: [
      "هل تعمل في المالية أو المحاسبة وتبحث عن فرصة مهنية جديدة؟",
      "سجّل في VisaFlow Talent، ارفع سيرتك الذاتية، واختر مسارك لإجراء مقابلة مهنية مدعومة بالذكاء الاصطناعي.",
      "تشمل الحملة: المحاسبة، الحسابات الدائنة والمدينة، محاسبة التكاليف، التخطيط والتحليل المالي، المراجعة الداخلية، الزكاة والضرائب، الخزينة، الائتمان، المخاطر والالتزام، والاستثمار وتمويل الشركات.",
      "الحملة متاحة لجميع المتخصصين المؤهلين دون اشتراط جنسية. مشاركة السيرة وبيانات التواصل مع الشركات المشتركة شرط لدخول الاختبار، أما مشاركة نتيجة الاختبار فهي اختيارية بالكامل.",
      `التسجيل: ${campaignUrl}`,
      "#Finance #Accounting #Audit #FinancialJobs #محاسبة #مالية #وظائف #VisaFlowTalent",
    ].join("\n\n"),
  };
}

export function buildLinkedInItCampaignDraft(campaignUrl) {
  return {
    title: "دعوة لكفاءات تقنية المعلومات: اختبر جاهزيتك المهنية مع VisaFlow Talent",
    body: [
      "هل تعمل في تقنية المعلومات وتريد قياس جاهزيتك للمقابلات المهنية؟",
      "سجّل في VisaFlow Talent، ارفع سيرتك الذاتية، واختر مسارك لإجراء مقابلة مهنية مدعومة بالذكاء الاصطناعي.",
      "تشمل الحملة: تطوير البرمجيات، تحليل البيانات والذكاء الاصطناعي، الأمن السيبراني، الحوسبة السحابية وDevOps، الشبكات، إدارة الأنظمة، الدعم التقني، ضمان الجودة، أنظمة ERP، وتحليل الأعمال وإدارة مشاريع التقنية.",
      "الحملة متاحة لجميع المتخصصين المؤهلين دون اشتراط جنسية. مشاركة السيرة وبيانات التواصل مع الشركات المشتركة شرط لدخول الاختبار، أما مشاركة نتيجة الاختبار فهي اختيارية بالكامل.",
      `التسجيل: ${campaignUrl}`,
      "#InformationTechnology #Cybersecurity #SoftwareEngineering #Data #تقنية_المعلومات #وظائف #VisaFlowTalent",
    ].join("\n\n"),
  };
}
