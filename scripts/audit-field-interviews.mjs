import assert from 'node:assert/strict';
assert.equal(process.env.SUPABASE_PROJECT_REF,'zeocbftriydodzfgixjv');
const response=await fetch('https://api.supabase.com/v1/projects/zeocbftriydodzfgixjv/database/query',{
method:'POST',headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},
body:JSON.stringify({read_only:false,query:`select t.id,t.template_name,t.profession,t.profession_category,t.interview_difficulty,t.company_id,
(select count(*)::integer from public.ai_interview_questions q where q.template_id=t.id and q.is_active) as question_count
from public.ai_interview_templates t where t.is_global and t.is_current_version and t.is_active and t.status='Active' and t.approval_status='Approved' order by t.profession_category,t.profession`}),signal:AbortSignal.timeout(30000)});
assert.ok(response.ok,`HTTP ${response.status}`);
for(const row of await response.json()) console.log('CATALOG_ROW '+JSON.stringify(row));
