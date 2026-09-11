import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const project = process.env.SUPABASE_PROJECT_REF;
assert.equal(project, 'zeocbftriydodzfgixjv');
assert.ok(process.env.SUPABASE_ACCESS_TOKEN);
const file = 'supabase/migrations/20260911000100_talent_junior_accountant_campaign.sql';
const migration = await readFile(file, 'utf8');
async function query(sql, readOnly = false) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: readOnly }), signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Supabase database query failed: HTTP ${response.status}: ${(await response.text()).slice(0, 600)}`);
  return response.json();
}
const [definition] = await query("select pg_get_functiondef('public.talent_campaign_template_is_eligible(uuid,uuid)'::regprocedure) as definition");
assert.ok(definition?.definition);
// Fail closed if Production has additional eligibility logic not present in the reviewed migration.
const oldSql = await readFile('supabase/migrations/20260817001200_talent_it_campaign.sql', 'utf8');
const body = (sql) => sql.match(/as (\$[a-z_]*\$)([^]*?)\1/i)?.[2]?.replace(/\s+/g, ' ').trim();
const oldBody = body(oldSql);
const newBody = body(migration);
assert.ok(oldBody && newBody);
assert.ok([oldBody, newBody].includes(body(definition.definition)), 'Production eligibility differs from the reviewed version');
const before = await query("select slug, public.get_public_talent_campaign(slug)->'templates' as templates from public.talent_public_campaigns where status='Active' and slug <> 'junior-accountants-2026' order by slug");
const history = await query("select version from supabase_migrations.schema_migrations where version='20260911000100'");
if (!history.length) {
  await query(`begin; set local statement_timeout='45s'; ${migration}
    insert into supabase_migrations.schema_migrations (version, name, statements)
    values ('20260911000100', 'talent_junior_accountant_campaign', ARRAY[$campaign_sql$${migration}$campaign_sql$]); commit;`, false);
}
const after = await query("select slug, public.get_public_talent_campaign(slug)->'templates' as templates from public.talent_public_campaigns where status='Active' and slug <> 'junior-accountants-2026' order by slug");
assert.deepEqual(after, before, 'Existing campaign templates changed');
const [result] = await query("select public.get_public_talent_campaign('junior-accountants-2026') as campaign");
assert.equal(result.campaign?.templates?.length, 1);
assert.equal(result.campaign.templates[0].question_count, 8);
assert.equal(result.campaign.templates[0].duration_minutes, 20);
console.log(JSON.stringify({activated: true, slug: result.campaign.slug, templates: result.campaign.templates, existingCampaignsVerified: before.length}));
