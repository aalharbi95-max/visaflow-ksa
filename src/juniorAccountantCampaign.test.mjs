import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { JUNIOR_ACCOUNTANT_CAMPAIGN_SLUG, getTalentCampaignContent, buildCampaignUrl } from './talentCampaign.mjs';

test('junior campaign migration is executable, idempotent and isolates eligible templates', async () => {
  const db = new PGlite();
  try {
    const snapshot = await readFile(new URL('../supabase/bootstrap/staging/production-schema-snapshot-20260727.sql', import.meta.url), 'utf8');
    for (const table of ['ai_interview_templates', 'ai_interview_questions']) {
      const ddl = snapshot.match(new RegExp(`CREATE TABLE public\\.${table} \\([^]*?\\n\\);`))?.[0];
      assert.ok(ddl);
      await db.exec(ddl);
    }
    const engineering = await readFile(new URL('../supabase/migrations/20260812000100_talent_engineering_campaign.sql', import.meta.url), 'utf8');
    await db.exec(engineering.match(/create table if not exists public\.talent_public_campaigns \([^]*?\n\);/)[0]);
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.companies (id uuid default gen_random_uuid(), created_at timestamptz default now());
      insert into public.companies default values;`);
    const sql = await readFile(new URL('../supabase/migrations/20260911000100_talent_junior_accountant_campaign.sql', import.meta.url), 'utf8');
    await db.exec(sql);
    await db.exec(sql);
    const { rows: templates } = await db.query('select * from public.ai_interview_templates');
    assert.equal(templates.length, 1);
    assert.equal(templates[0].interview_difficulty, 'Basic');
    assert.equal(templates[0].duration_minutes, 20);
    const { rows: questions } = await db.query('select * from public.ai_interview_questions order by question_order');
    assert.equal(questions.length, 8);
    assert.equal(questions.reduce((sum, q) => sum + Number(q.weight), 0), 100);
    assert.ok(questions.every(q => q.question_text_ar && q.question_text_en && q.key_points.length === 3));
    const { rows: campaigns } = await db.query('select * from public.talent_public_campaigns');
    assert.equal(campaigns.length, 1);
    assert.equal(campaigns[0].slug, JUNIOR_ACCOUNTANT_CAMPAIGN_SLUG);
    const eligible = async (id) => (await db.query('select public.talent_campaign_template_is_eligible($1, $2) as ok', [id, templates[0].id])).rows[0].ok;
    assert.equal(await eligible(campaigns[0].id), true);
    for (const [filter, category] of [['finance_accounting', 'Finance & Accounting'], ['human_resources', 'Human Resources'], ['information_technology', 'Information Technology'], ['engineering', 'Engineering']]) {
      const result = await db.query(`insert into public.talent_public_campaigns (slug, name_en, name_ar, template_owner_company_id, settings)
        values ($1, $1, $1, $2, $3) returning id`, [filter, templates[0].company_id, JSON.stringify({template_filter: filter})]);
      assert.equal(await eligible(result.rows[0].id), false);
      await db.query('update public.ai_interview_templates set profession_category = $1', [category]);
      assert.equal(await eligible(result.rows[0].id), true);
      assert.equal(await eligible(campaigns[0].id), false);
      await db.exec("update public.ai_interview_templates set profession_category = 'Junior Accounting'");
    }
    await db.exec("update public.ai_interview_templates set approval_status = 'Draft'");
    assert.equal(await eligible(campaigns[0].id), false);
    await db.exec("update public.ai_interview_templates set approval_status = 'Approved', is_current_version = false");
    assert.equal(await eligible(campaigns[0].id), false);
    await db.exec("update public.ai_interview_templates set is_current_version = true, company_id = gen_random_uuid()");
    assert.equal(await eligible(campaigns[0].id), false);
  } finally { await db.close(); }
});

test('junior campaign has bilingual content and its own registration URL', () => {
  for (const language of ['AR', 'EN']) {
    const content = getTalentCampaignContent(JUNIOR_ACCOUNTANT_CAMPAIGN_SLUG, language);
    assert.ok(content?.name && content?.headline && content?.intro);
  }
  const url = new URL(buildCampaignUrl('https://www.visaflowksa.com/', JUNIOR_ACCOUNTANT_CAMPAIGN_SLUG));
  assert.equal(url.searchParams.get('talent'), '1');
  assert.equal(url.searchParams.get('talent_campaign'), JUNIOR_ACCOUNTANT_CAMPAIGN_SLUG);
});
