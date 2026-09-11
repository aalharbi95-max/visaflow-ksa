import fs from 'node:fs';
import assert from 'node:assert/strict';
import {accountantTasks} from './accountant-readiness-data.mjs';
const file='supabase/migrations/20260911000400_accountant_readiness.sql';
const marker='-- TASK_SEEDS: generated from scripts/accountant-readiness-data.mjs';
const base=fs.readFileSync(file,'utf8').split(marker)[0];
const quote=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
const statements=accountantTasks.map(({code,version,skill,reviewer,...task})=>{
  assert.equal(task.fields.reduce((n,f)=>n+f.weight,0),100);
  const keys=Object.fromEntries(task.fields.map(f=>[f.key,f.expected]));
  const definition={...task,threshold:80,fields:task.fields.map(({expected,...f})=>f)};
  return `insert into public.talent_readiness_tasks(code,version,skill,definition,answer_key,review_guide) values('${code}',${version},'${skill}',${quote(definition)},${quote(keys)},${quote(reviewer)}) on conflict(code) do nothing;`;
});
fs.writeFileSync(file,base+marker+'\n'+statements.join('\n')+'\n');
