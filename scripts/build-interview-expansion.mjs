import fs from 'node:fs';
import assert from 'node:assert/strict';
import {sectors,roles,levels} from './interview-expansion-data.mjs';
export const release = 'VF-EXPANSION-20260911';
const split = (s) => s.split('; ').map(x=>x.trim());
function makeQuestions(r,l) {
  const junior=l.id==='entry', lead=l.id==='supervisor';
  const depthAr=junior?'وضح خطواتك وما ستطلب فيه مساعدة المشرف.':lead?'حدد الأولويات وتوزيع المسؤوليات وضوابط التصعيد وكيف تتحقق من النتيجة.':'اشرح قرارك والأدلة والبدائل وكيف تتحقق من النتيجة.';
  const depthEn=junior?'Explain your steps and when you would seek supervisor help.':lead?'Define priorities, delegated responsibilities, escalation controls and outcome verification.':'Explain your decision, evidence, alternatives and verification.';
  const extra = junior ? ['Recognize limits and seek appropriate help'] : lead ? ['Assign ownership and verify team outcomes'] : ['Use evidence and justify alternatives'];
  const qs=[
    ['Experience','Role readiness',10,
      junior?`في مسار ${r.ar}، ما الذي تعلمته عن كيفية ${r.taskAr}؟ اذكر مثالًا دراسيًا أو تدريبيًا أو افتراضيًا.`:lead?`في فريق ${r.ar}، كيف توزع مسؤولية ${r.taskAr} وتتحقق من جاهزية أفراد الفريق؟`:`اشرح مثالًا عمليًا على ${r.taskAr}، وحدد مساهمتك والنتيجة.`,
      junior?`For ${r.en}, what have you learned about how to ${r.taskEn}? Use a study, training or hypothetical example.`:lead?`For a ${r.en} team, how would you assign responsibility to ${r.taskEn} and verify team readiness?`:`Explain a practical example of how to ${r.taskEn}, your contribution and the result.`,
      ['Understand the stated task','Describe personal contribution or practical approach',...extra], `${r.taskPointsAr}. يقبل المثال المكافئ ويراعى مستوى ${l.ar}.`],
    ['Technical','Workflow and controls',15,`كيف تنفذ عملية ${r.taskAr} من البداية إلى النهاية؟ ${depthAr}`,`How would you ${r.taskEn} from start to finish? ${depthEn}`,
      [...split(r.taskPointsEn),...extra],r.taskPointsAr],
    ['Technical','Incident judgment',15,`${r.incidentAr}. ما التصرف المناسب؟ ${depthAr}`,`${r.incidentEn}. What would you do? ${depthEn}`,
      [...split(r.incidentPointsEn),...extra],r.incidentPointsAr],
    ['Technical','Quality measurement',10,`في عينة من ١٠٠ عملية تخص ${r.taskAr}، استوفت ٩٠ عملية معايير الجودة المحددة من أول مرة. احسب نسبة الاجتياز ونسبة عدم الاجتياز، وما الذي يلزم قبل تعميم النتيجة؟ ${depthAr}`,`In a sample of 100 instances of the task "${r.taskEn}", 90 met defined quality criteria on the first attempt. Calculate pass and non-pass rates. What is needed before generalizing? ${depthEn}`,
      ['First-pass rate 90 percent and non-pass rate 10 percent','Check sampling period, criteria and representativeness','Investigate failure patterns without assuming causes',...extra], 'نسبة الاجتياز ٩٠٪ وعدم الاجتياز ١٠٪. يتحقق من تعريف الجودة والعينة والفترة وتوزيع الإخفاقات قبل التعميم، ولا يخلط المعدل بمؤشر آخر.'],
    ['Technical','Evidence and root cause',15,`تكرر الموقف التالي بعد اعتقاد الفريق أنه عولج: ${r.incidentAr}. ما الأدلة التي تجمعها لتحديد السبب، وكيف تتحقق من فعالية المعالجة؟ ${depthAr}`,`This issue recurs after the team believed it resolved: ${r.incidentEn}. What evidence would you gather to identify the cause and verify the fix? ${depthEn}`,
      [...split(r.incidentPointsEn),'Trace timeline and source records; test explanation; verify recurrence prevention',...extra],`${r.incidentPointsAr}. يراجع التسلسل والسجلات ويختبر السبب دون اتهام أو تخمين، ثم يتحقق من عدم التكرار.`],
    ['Behavioral','Prioritization and handover',10,`أثناء ${r.taskAr} وصل طلب عاجل وبدأ تسليم الوردية أو المهمة لزميل. كيف تمنع ضياع الطلب أو تكرار تنفيذه؟ ${depthAr}`,`While you ${r.taskEn}, an urgent request arrives as you hand over to a colleague. How do you prevent a missed or duplicated action? ${depthEn}`,
      ['Assess impact and agree priority','Document current status, next action and named owner','Confirm handover acceptance and follow-up',...extra],`يوضح حالة ${r.taskAr} والإجراء المفتوح وأولويته ومسؤوله، ويتأكد من استلام الزميل ويصعّد تعارض القدرة أو الموعد.`],
    ['Technical','Continuous improvement',15,`كيف تقيس وتحسن أداء ${r.ar} باستخدام المؤشر التالي: ${r.metricAr}؟ ${junior?'اشرح البيانات التي تسجلها وكيف تراجع دقتها.':lead?'ضع تجربة تحسين صغيرة وخطة تدريب ومراجعة للفريق.':'اقترح فرضية تحسين واختبارًا محدودًا مع مقارنة عادلة.'}`,`How would you measure and improve ${r.en} performance using: ${r.metricEn}? ${junior?'Explain which data you record and how you check accuracy.':lead?'Design a small improvement trial with team coaching and review.':'Propose an improvement hypothesis and a bounded test with a fair comparison.'}`,
      [`Define ${r.metricEn} with source and time period`,'Check data quality and baseline','Avoid improving speed or volume at the expense of quality or safety',...extra],`يعرّف ${r.metricAr} ومصدره وفترته وخط الأساس، ويراجع الجودة ويجرب تغييرًا محدودًا ويقيس أثره دون التضحية بالسلامة أو حقوق العميل.`],
    ['Behavioral','Integrity and data handling',10,`طُلب منك تسجيل ${r.taskAr} كمكتملة قبل التحقق، وإرسال سجلها عبر حساب شخصي لتسريع العمل. كيف تتصرف؟ ${depthAr}`,`You are asked to mark the task "${r.taskEn}" complete before verification and send its records through a personal account to speed things up. How do you respond? ${depthEn}`,
      ['Do not falsely mark work complete','Use authorized channels and minimum necessary data','Escalate pressure and document factual status',...extra],`لا يسجل إنجازًا غير متحقق منه، ويستخدم القنوات المعتمدة والحد اللازم من البيانات ويوضح الحالة الحقيقية ويصعّد الضغط وفق السياسة.`],
  ];
  return qs.map(([kind,competency,weight,ar,en,points,ideal],i)=>({ord:i+1,kind,competency,weight,ar,en,points,ideal,difficulty:l.difficulty,seconds:l.seconds,keywords:points,
    guide:{excellent:'Covers the question key points accurately, explains reasoning and demonstrates the expected level of autonomy.',acceptable:'Addresses the core task safely with some omissions; recognizes limitations and appropriate escalation.',weak:'Misses core controls, lacks relevant reasoning, fabricates evidence or proposes unsafe or unauthorized actions.'},
    notes:`Assess ${r.en} at ${l.en} level against these key points, not keywords alone. Accept Arabic or English and equivalent methods. ${l.experience} Do not infer competence from accent, nationality, age, gender or disability. No regulatory certification is conferred. Human review determines recruitment outcomes. Safety responses must stay within training and site procedures.`}));
}
export const templates=roles.flatMap(r=>levels.map(l=>({
  name:`${r.en} — ${l.en} | ${r.ar} — ${l.ar}`,profession:`${r.en} — ${l.en}`,professionAr:`${r.ar} — ${l.ar}`,
  category:sectors[r.sector].en,sector:r.sector,level:l.id,difficulty:l.difficulty,minutes:l.minutes,
  description:`${r.ar} — ${l.ar}: ${r.taskAr}. ${r.en} — ${l.en}: ${r.taskEn}.`,
  instructions:`أجب بالعربية أو الإنجليزية. ${l.id==='entry'?'تقبل أمثلة الدراسة والتدريب والسيناريوهات الافتراضية دون اشتراط خبرة وظيفية.':'وضح قراراتك وأدلتك ودورك والنتيجة، وتقبل الأمثلة العملية المكافئة.'} ${l.experience}`,
  competencies:['Role readiness','Workflow and controls','Incident judgment','Quality measurement','Evidence and root cause','Prioritization and handover','Continuous improvement','Integrity and data handling'],
  tasks:[r.taskEn,r.incidentEn,r.metricEn],questions:makeQuestions(r,l),
})));
assert.equal(templates.length,90);
assert.equal(new Set(templates.map(t=>t.name)).size,90);
for (const t of templates) { assert.equal(t.questions.length,8); assert.equal(t.questions.reduce((s,q)=>s+q.weight,0),100); }
const catalog=templates.map(t=>({profession:t.profession,profession_ar:t.professionAr,category:t.category,library:t.category,focus:t.description,job_description:t.description,years_experience:t.level==='entry'?'Entry level; no employment history required':'Assessed by demonstrated competence',qualifications:'Relevant job skills; assess employer-specific requirements separately.',certifications:'Only where required for the actual role; this interview is not a license or certification.',difficulty:t.difficulty,question_count:8,passing_score:70,source_type:'Ready Template'}));
fs.writeFileSync('src/expandedInterviewCatalog.mjs',`// Public catalog metadata only. Questions and scoring references remain in the database.\nexport const EXPANDED_INTERVIEW_CATALOG = ${JSON.stringify(catalog,null,2)};\n`);
fs.writeFileSync('src/expandedTalentCampaigns.mjs',`export const EXPANDED_TALENT_CAMPAIGNS = ${JSON.stringify(sectors.map(s=>({slug:s.slug,nameAr:`حملة ${s.ar}`,nameEn:`${s.en} Campaign`,descriptionAr:`١٥ قالب مقابلة في ${s.ar}: مبتدئ، ممارس ومشرف فريق.`,descriptionEn:`15 interview templates in ${s.en}: entry level, professional and team supervisor.`,professionLabelAr:'اختر المسار والمستوى الوظيفي',professionLabelEn:'Select your role and level',badgeAr:`VisaFlow — ${s.ar}`,badgeEn:`VisaFlow — ${s.en}`,headlineAr:`اختبر جاهزيتك في ${s.ar}.`,headlineEn:`Test your readiness in ${s.en}.`,introAr:'اختر المسار والمستوى المناسبين. كل مقابلة تتضمن ٨ أسئلة بالعربية أو الإنجليزية. تقبل أمثلة الدراسة والتدريب للمبتدئين. مشاركة السيرة وبيانات التواصل مع الشركات مطلوبة؛ مشاركة النتيجة اختيارية. المقابلة لا تضمن التوظيف ولا تمنح ترخيصًا مهنيًا.',introEn:'Choose the appropriate role and level. Each interview has 8 questions in Arabic or English. Study and training examples are welcome at entry level. CV and contact sharing with employers are required; result sharing is optional. This interview does not guarantee employment or confer a professional license.'})),null,2)};\n`);
const sql=`-- 90 approved bilingual templates across 30 roles and 3 levels, with 6 public campaigns.
do $seed$
declare
  v_company_id uuid; t jsonb; q jsonb; c jsonb; v_id uuid; v_existing jsonb;
begin
  select template_owner_company_id into v_company_id from public.talent_public_campaigns where slug='junior-accountants-2026';
  if v_company_id is null then raise exception 'Approved campaign owner must exist before expansion'; end if;
  for t in select value from jsonb_array_elements($catalog$${JSON.stringify(templates)}$catalog$::jsonb)
  loop
    select id, ai_analysis into v_id, v_existing from public.ai_interview_templates
      where company_id=v_company_id and template_name=t->>'name' and version=1 limit 1;
    if v_id is not null and coalesce(v_existing->>'catalog_release','') <> '${release}' then
      raise exception 'Existing unrelated template with same name: %', t->>'name';
    end if;
    if v_id is null then
      insert into public.ai_interview_templates (
        company_id,template_name,profession,profession_category,language,interview_mode,interaction_mode,camera_mode,
        description,candidate_instructions,opening_message,closing_message,consent_text,duration_minutes,maximum_questions,
        passing_score,allow_ai_follow_up,allow_ai_follow_ups,max_dynamic_follow_ups,allow_candidate_retry,maximum_retries,
        require_microphone_test,require_consent,status,is_active,source_type,requested_question_count,interview_difficulty,
        generation_status,approval_status,approved_by,approved_at,is_locked,is_global,created_by,updated_by,
        ai_analysis,extracted_competencies,extracted_tasks,extracted_skills,extracted_safety_requirements
      ) values (
        v_company_id,t->>'name',t->>'profession',t->>'category','Arabic / English','Voice','Recorded','Optional',
        t->>'description',t->>'instructions','مرحبًا بك في مقابلة VisaFlow: '||(t->>'name'),
        'شكرًا لك. اكتملت المقابلة وتراجع نتائجها بشريًا. Thank you. Your interview will be reviewed by a human.',
        'أوافق على تسجيل وتحليل إجاباتي بالذكاء الاصطناعي لأغراض التقييم الوظيفي، والقرار النهائي للبشر.',
        (t->>'minutes')::integer,8,70,true,true,1,false,0,true,true,'Active',true,'Ready Template',8,t->>'difficulty',
        'Generated','Approved','Platform Owner',now(),true,true,'Platform Owner','Platform Owner',
        jsonb_build_object('catalog_release','${release}','level',t->>'level','bilingual',true,'human_review_required',true),
        t->'competencies',t->'tasks',t->'competencies','["Privacy","Accuracy","Authorized actions","Work within training","Human review"]'::jsonb
      ) returning id into v_id;
      for q in select value from jsonb_array_elements(t->'questions') loop
        insert into public.ai_interview_questions (
          company_id,template_id,question_order,question_text,question_text_ar,question_text_en,question_type,competency,
          difficulty_level,weight,maximum_answer_seconds,expected_keywords,key_points,scoring_guide,ideal_answer,recruiter_notes,
          allow_follow_up,maximum_follow_ups,is_required,is_active,source_type,is_ai_generated,approved_by,approved_at,
          is_locked,is_global,created_by,updated_by
        ) values (
          v_company_id,v_id,(q->>'ord')::integer,(q->>'ar')||' / '||(q->>'en'),q->>'ar',q->>'en',q->>'kind',q->>'competency',
          q->>'difficulty',(q->>'weight')::numeric,(q->>'seconds')::integer,q->'keywords',q->'points',q->'guide',q->>'ideal',q->>'notes',
          true,1,true,true,'AI Generated',true,'Platform Owner',now(),true,true,'Platform Owner','Platform Owner'
        );
      end loop;
    end if;
    if (select count(*)=8 and sum(weight)=100 from public.ai_interview_questions where template_id=v_id and is_active) then null;
    else raise exception 'Unexpected question count: %', t->>'name'; end if;
  end loop;
  for c in select value from jsonb_array_elements($campaigns$${JSON.stringify(sectors)}$campaigns$::jsonb) loop
    if exists (select 1 from public.talent_public_campaigns where slug=c->>'slug' and coalesce(settings->>'catalog_release','')<>'${release}') then
      raise exception 'Existing unrelated campaign: %',c->>'slug';
    end if;
    insert into public.talent_public_campaigns (slug,name_en,name_ar,description_en,description_ar,template_owner_company_id,status,registration_starts_at,settings)
    values (c->>'slug','VisaFlow '||(c->>'en')||' Campaign','حملة VisaFlow — '||(c->>'ar'),
      '15 bilingual templates: 5 roles at entry, professional and supervisor levels. 8 questions each; human review required.',
      '١٥ قالبًا ثنائي اللغة: ٥ مسارات للمبتدئ والممارس ومشرف الفريق. ٨ أسئلة لكل مقابلة مع مراجعة بشرية للنتائج.',
      v_company_id,'Active',now(),jsonb_build_object('template_filter',c->>'filter','catalog_release','${release}','nationality_restriction',false))
    on conflict (slug) do nothing;
  end loop;
end;
$seed$;
`;
const previous=fs.readFileSync('supabase/migrations/20260911000100_talent_junior_accountant_campaign.sql','utf8');
const eligibility=previous.slice(previous.indexOf('create or replace function public.talent_campaign_template_is_eligible'))
  .replace("when 'junior_accounting'",sectors.map(s=>`when '${s.filter}' then lower(coalesce(template.profession_category, '')) = '${s.en.toLowerCase()}' and template.ai_analysis->>'catalog_release' = '${release}'`).join('\n        ')+"\n        when 'junior_accounting'");
fs.writeFileSync('supabase/migrations/20260911000200_expand_interview_library.sql',sql+'\n'+eligibility);
console.log(`Generated ${templates.length} templates, ${templates.length*8} question slots and ${sectors.length} campaigns.`);
