import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ENGINEERING_TALENT_CAMPAIGN_SLUG,
  FINANCE_TALENT_CAMPAIGN_SLUG,
  HR_TALENT_CAMPAIGN_SLUG,
  IT_TALENT_CAMPAIGN_SLUG,
  buildCampaignUrl,
  buildLinkedInFinanceCampaignDraft,
  buildLinkedInHrCampaignDraft,
  buildLinkedInItCampaignDraft,
  getAvailableTalentCampaigns,
  getCampaignProfessionLabel,
  getCampaignReadiness,
  getTalentCampaignSlug,
} from "./talentCampaign.mjs";

test("campaign URL keeps the Talent portal and campaign slug", () => {
  const url = new URL(buildCampaignUrl("https://www.visaflowksa.com/?login=1"));
  assert.equal(url.searchParams.get("talent"), "1");
  assert.equal(url.searchParams.get("talent_campaign"), ENGINEERING_TALENT_CAMPAIGN_SLUG);
  assert.equal(getTalentCampaignSlug(url), ENGINEERING_TALENT_CAMPAIGN_SLUG);
});

test("HR campaign has its own URL, profession label and LinkedIn copy", () => {
  const url = new URL(buildCampaignUrl("https://www.visaflowksa.com/", HR_TALENT_CAMPAIGN_SLUG));
  assert.equal(url.searchParams.get("talent_campaign"), HR_TALENT_CAMPAIGN_SLUG);
  assert.equal(getCampaignProfessionLabel(HR_TALENT_CAMPAIGN_SLUG, "AR"), "اختر تخصصك في الموارد البشرية");
  assert.match(buildLinkedInHrCampaignDraft(url.toString()).body, /الموارد البشرية/);
});

test("Finance campaign is nationality-neutral and available in the Talent portal", () => {
  const url = new URL(buildCampaignUrl("https://www.visaflowksa.com/", FINANCE_TALENT_CAMPAIGN_SLUG));
  assert.equal(url.searchParams.get("talent_campaign"), FINANCE_TALENT_CAMPAIGN_SLUG);
  assert.equal(getCampaignProfessionLabel(FINANCE_TALENT_CAMPAIGN_SLUG, "AR"), "اختر تخصصك في المالية والمحاسبة");
  assert.match(buildLinkedInFinanceCampaignDraft(url.toString()).body, /دون اشتراط جنسية/);
  const campaign = getAvailableTalentCampaigns("AR").find((item) => item.slug === FINANCE_TALENT_CAMPAIGN_SLUG);
  assert.equal(campaign?.name, "حملة الكفاءات المالية والمحاسبية");
  assert.doesNotMatch(campaign?.name || "", /سعود/);
});

test("IT campaign is nationality-neutral and has dedicated registration copy", () => {
  const url = new URL(buildCampaignUrl("https://www.visaflowksa.com/", IT_TALENT_CAMPAIGN_SLUG));
  assert.equal(url.searchParams.get("talent_campaign"), IT_TALENT_CAMPAIGN_SLUG);
  assert.equal(getCampaignProfessionLabel(IT_TALENT_CAMPAIGN_SLUG, "AR"), "اختر تخصصك في تقنية المعلومات");
  assert.match(buildLinkedInItCampaignDraft(url.toString()).body, /الأمن السيبراني/);
  assert.match(buildLinkedInItCampaignDraft(url.toString()).body, /دون اشتراط جنسية/);
  const campaign = getAvailableTalentCampaigns("AR").find((item) => item.slug === IT_TALENT_CAMPAIGN_SLUG);
  assert.equal(campaign?.name, "حملة كفاءات تقنية المعلومات");
});

test("campaign analytics counts privacy-safe unique visits and exposes owner conversion metrics", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260816000200_talent_campaign_analytics.sql", import.meta.url), "utf8");
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.talent_campaign_events/i);
  assert.match(sql, /digest\(p_visitor_id/i);
  assert.match(sql, /unique \(campaign_id, event_type, visitor_hash, event_date\)/i);
  assert.match(sql, /track_public_talent_campaign_event/i);
  assert.match(sql, /'unique_visitors'/i);
  assert.match(sql, /'sources'/i);
  assert.match(app, /track_public_talent_campaign_event/i);
  assert.match(app, /Campaign Performance/i);
  assert.match(app, /ownerHrTalentCampaign/i);
});

test("CV and employer sharing are required while result sharing is not", () => {
  const result = getCampaignReadiness({
    profile: { full_name: "Engineer", phone: "+966500000000" },
    primaryCv: { id: "cv-1" },
    templateId: "template-1",
    consents: {
      "Platform Terms": true,
      "Privacy Policy": true,
      "Employer Sharing": true,
      "Employer Contact Sharing": true,
      "AI Interview": true,
      "Evaluation Email": false,
    },
  });
  assert.equal(result.ready, true);
  assert.deepEqual(result.missing, []);
});

test("campaign blocks interview enrolment without a CV-sharing consent", () => {
  const result = getCampaignReadiness({
    profile: { full_name: "Engineer", phone: "+966500000000" },
    primaryCv: { id: "cv-1" },
    templateId: "template-1",
    consents: {
      "Platform Terms": true,
      "Privacy Policy": true,
      "Employer Sharing": false,
      "Employer Contact Sharing": true,
      "AI Interview": true,
    },
  });
  assert.equal(result.ready, false);
  assert.ok(result.missing.includes("cv_sharing"));
});

test("database campaign resolves owner templates dynamically and enforces candidate consent", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260812000100_talent_engineering_campaign.sql", import.meta.url), "utf8");
  assert.match(sql, /template\.company_id = v_campaign\.template_owner_company_id/i);
  assert.match(sql, /template\.approval_status = 'Approved'/i);
  assert.match(sql, /template\.is_current_version is true/i);
  assert.match(sql, /order by template\.is_global desc, template\.updated_at desc/i);
  assert.match(sql, /consent\.consent_type = 'Employer Sharing' and consent\.is_granted is true/i);
  assert.match(sql, /consent\.consent_type = 'Employer Contact Sharing' and consent\.is_granted is true/i);
  assert.match(sql, /consent\.consent_type = 'AI Interview' and consent\.is_granted is true/i);
  assert.match(sql, /case when application\.result_sharing_consent then session\.overall_score else null end/i);
});

test("HR campaign migration exposes HR templates through campaign-aware eligibility", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260813000100_talent_hr_campaign.sql", import.meta.url), "utf8");
  assert.match(sql, /saudi-hr-professionals-2026/i);
  assert.match(sql, /Human Resources/i);
  assert.match(sql, /talent_campaign_template_is_eligible/i);
  assert.match(sql, /Select an approved interview template for this campaign/i);
});

test("Finance campaign migration seeds finance templates and rejects cross-campaign templates", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260813000500_talent_finance_campaign.sql", import.meta.url), "utf8");
  assert.match(sql, /finance-accounting-professionals-2026/i);
  assert.match(sql, /Finance & Accounting/);
  assert.match(sql, /finance_accounting/);
  assert.match(sql, /nationality_restriction"\s*:\s*false/i);
  assert.match(sql, /else false/i);
  assert.match(sql, /General Accounting \| المحاسبة العامة/);
  assert.match(sql, /Corporate Finance & Investment \| تمويل الشركات والاستثمار/);
});

test("IT campaign migration seeds approved IT templates and isolates campaign eligibility", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260817001200_talent_it_campaign.sql", import.meta.url), "utf8");
  assert.match(sql, /it-digital-professionals-2026/i);
  assert.match(sql, /Information Technology/);
  assert.match(sql, /information_technology/);
  assert.match(sql, /nationality_restriction"\s*:\s*false/i);
  assert.match(sql, /else false/i);
  assert.match(sql, /Software Engineering \| تطوير البرمجيات/);
  assert.match(sql, /Cybersecurity \| الأمن السيبراني/);
});

test("failed campaign interviews can be retried without overwriting history", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260813000200_talent_campaign_failed_interview_retry.sql", import.meta.url), "utf8");
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");

  assert.match(sql, /create or replace function public\.retry_my_talent_campaign_interview\(p_slug text\)/i);
  assert.match(sql, /session\.overall_score is null/i);
  assert.match(sql, /session\.analysis_status = 'Failed'/i);
  assert.match(sql, /previous_session_ids = array_append\(previous_session_ids, v_previous_session\.id\)/i);
  assert.match(sql, /v_application\.retry_count >= 2/i);
  assert.match(sql, /A scored interview cannot be retried/i);
  assert.match(app, /supabase\.rpc\("retry_my_talent_campaign_interview"/i);
  assert.match(app, /campaignApplication\.can_retry/i);
  assert.match(app, /Retry Interview/i);
});
