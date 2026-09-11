import fs from 'node:fs';
import {closingCases} from '../scripts/accountant-closing-data.mjs';
const prior=fs.readFileSync('supabase/migrations/20260911000400_accountant_readiness.sql','utf8');
let save=prior.match(/create or replace function public\.save_accountant_readiness\([^]*?end; \$\$;/)[0];
save=save.replace("octet_length(p_answers::text)>12000","octet_length(p_answers::text)>40000");
save=save.replace("select * into v_task from public.talent_readiness_tasks where code=p_task_code and active;",`if p_task_code like 'accountant-close-v2-%' and p_task_code <> ('accountant-close-v2-' || case when get_byte(decode(replace(v_candidate::text,'-',''),'hex'),0)%2=0 then 'a' else 'b' end) then
    raise exception using errcode='42501',message='Use your assigned case'; end if;
  select * into v_task from public.talent_readiness_tasks where code=p_task_code and active;`);
save=save.replace("<30 then","<coalesce((v_task.definition->>'rationaleMinLength')::integer,30) then");
save=save.replace('Explain your approach in at least 30 characters','Explain your approach using the minimum length shown in the task');
save=save.replace("if v_field->>'type'='number' then",`if v_field->>'type'='text' then
      if jsonb_typeof(v_value)<>'string' or length(v_value#>>'{}')>coalesce((v_field->>'maxLength')::integer,1200) or
        (p_submit and length(btrim(v_value#>>'{}'))<coalesce((v_field->>'minLength')::integer,60)) then
        raise exception using errcode='22023',message='Provide a substantive explanation for every entry'; end if;
      continue;
    elsif v_field->>'type'='number' then`);
const get=`create or replace function public.get_my_accountant_readiness() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_candidate uuid; v_case text;
begin
  if auth.uid() is null then raise exception using errcode='42501', message='Candidate authentication required'; end if;
  select id into v_candidate from public.talent_candidates where auth_user_id=auth.uid();
  if v_candidate is null then raise exception using errcode='P0002',message='Complete your Talent profile first'; end if;
  v_case:='accountant-close-v2-' || case when get_byte(decode(replace(v_candidate::text,'-',''),'hex'),0)%2=0 then 'a' else 'b' end;
  return jsonb_build_object('tasks',coalesce((select jsonb_agg(jsonb_build_object(
    'code',t.code,'version',t.version,'skill',t.skill,'definition',t.definition,'archived',not t.active,
    'attempt',(select to_jsonb(a)-'candidate_id' from public.talent_readiness_attempts a where a.candidate_id=v_candidate and a.task_code=t.code)
  ) order by t.version desc,t.code) from public.talent_readiness_tasks t
  where (t.active and t.code=v_case) or (not t.active and exists(select 1 from public.talent_readiness_attempts a where a.candidate_id=v_candidate and a.task_code=t.code))),'[]'::jsonb));
end; $$;`;
const quote=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
const seeds=closingCases.map(({code,version,skill,reviewer,...task})=>{
 const answerKey=Object.fromEntries(task.fields.filter(f=>f.type!=='text').map(f=>[f.key,f.expected]));
 const definition={...task,threshold:80,fields:task.fields.map(({expected,...f})=>f)};
 if(task.fields.reduce((n,f)=>n+f.weight,0)!==100)throw Error('weights');
 return `insert into public.talent_readiness_tasks(code,version,skill,definition,answer_key,review_guide) values('${code}',${version},'${skill}',${quote(definition)},${quote(answerKey)},${quote(reviewer)}) on conflict(code) do nothing;`;
});
fs.writeFileSync('supabase/migrations/20260911000500_accountant_month_close.sql',`-- Versioned month-close cases. Existing attempts, answers, scores and task definitions are preserved.\n${seeds.join('\n')}\nupdate public.talent_readiness_tasks set active=false where code in ('invoice-review-v1','bank-reconciliation-v1');\n${get}\n${save}\n`);
