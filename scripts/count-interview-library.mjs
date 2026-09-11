import assert from 'node:assert/strict';
assert.equal(process.env.SUPABASE_PROJECT_REF,'zeocbftriydodzfgixjv');
const response=await fetch('https://api.supabase.com/v1/projects/zeocbftriydodzfgixjv/database/query',{
 method:'POST',headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},
 body:JSON.stringify({read_only:false,query:`select count(*)::integer as all_template_records,
 count(*) filter(where is_global)::integer as global_records,
 count(*) filter(where is_global and is_current_version)::integer as current_global,
 count(*) filter(where is_global and is_current_version and is_active and status='Active' and approval_status='Approved')::integer as ready_global,
 count(*) filter(where is_global and is_current_version and is_active and status='Active' and approval_status='Approved' and ai_analysis->>'catalog_release'='VF-EXPANSION-20260911')::integer as new_ready_global
 from public.ai_interview_templates;`}),signal:AbortSignal.timeout(30000)
});
assert.ok(response.ok,`HTTP ${response.status}`); console.log('LIBRARY_COUNTS '+JSON.stringify(await response.json()));
