import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ENGINEERING_TALENT_CAMPAIGN_SLUG,
  HR_TALENT_CAMPAIGN_SLUG,
  buildCampaignUrl,
  buildLinkedInHrCampaignDraft,
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
