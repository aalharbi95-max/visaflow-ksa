import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const token = process.env.SUPABASE_ACCESS_TOKEN || "";
const projectRef = process.env.SUPABASE_PROJECT_REF || "";
const output = process.env.SUPABASE_AUDIT_OUTPUT || "staging-hardening-audit.json";
assert.ok(token, "SUPABASE_ACCESS_TOKEN is required");
assert.match(projectRef, /^[a-z]{20}$/i, "SUPABASE_PROJECT_REF is invalid");

async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) throw new Error(`Supabase audit query failed with HTTP ${response.status}`);
  return response.json();
}

async function securityAdvisor() {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/advisors/security`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error(`Supabase Security Advisor failed with HTTP ${response.status}`);
  return response.json();
}

const queries = {
  migrations: `select version::text from supabase_migrations.schema_migrations order by version`,
  tables: `
    select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p') order by c.relname`,
  columns: `
    select table_name, column_name, data_type, udt_name, is_nullable, column_default
    from information_schema.columns where table_schema = 'public'
    order by table_name, ordinal_position`,
  policies: `
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies where schemaname = 'public' order by tablename, policyname`,
  grants: `
    select table_name, grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon','authenticated','service_role')
    order by table_name, grantee, privilege_type`,
  functions: `
    select p.proname as function_name,
           pg_get_function_identity_arguments(p.oid) as arguments,
           p.prosecdef as security_definer,
           md5(pg_get_functiondef(p.oid)) as definition_md5
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' order by p.proname, arguments`,
  hiring_pipeline: `
    select p.proname as function_name,
           pg_get_function_identity_arguments(p.oid) as arguments,
           pg_get_functiondef(p.oid) as definition
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_company_hiring_pipeline'`,
  target_rls: `
    select c.relname as table_name, c.relrowsecurity as rls_enabled,
           coalesce((select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname),0) as policy_count
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in
      ('agency_members','agency_penalties','agency_scores','ai_agent_worker_runs','ai_interview_answers',
       'ai_interview_generation_runs','ai_interview_questions','ai_interview_sessions','ai_interview_templates',
       'candidate_technical_profiles','collections','company_agency_users','company_email_settings','demobilizations',
       'education_institutions','email_templates','invoice_items','invoices','local_content_project_targets',
       'local_content_settings','marketplace_deal_workers','marketplace_deals','marketplace_requests',
       'onboarding_validations','platform_clients','profession_aliases','subscription_invoices')
    order by c.relname`,
};

const evidence = { project_ref: projectRef, captured_at: new Date().toISOString(), queries: {}, security_advisor: null };
for (const [name, sql] of Object.entries(queries)) evidence.queries[name] = await query(sql);
evidence.security_advisor = await securityAdvisor();
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(`Captured read-only Staging evidence: ${evidence.queries.migrations.length} migrations, ${evidence.queries.tables.length} tables, ${evidence.security_advisor?.lints?.length || 0} Security Advisor findings.`);
