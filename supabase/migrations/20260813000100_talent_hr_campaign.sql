-- Public HR Talent campaign with approved bilingual interview templates.

do $$
declare
  v_company_id uuid;
  v_role record;
  v_template_id uuid;
begin
  select t.company_id into v_company_id
  from public.ai_interview_templates t
  where t.is_global is true
  order by t.created_at asc
  limit 1;

  if v_company_id is null then
    select c.id into v_company_id from public.companies c order by c.created_at asc limit 1;
  end if;
  if v_company_id is null then
    raise exception 'A company is required before seeding HR interview templates.';
  end if;

  for v_role in
    select * from jsonb_to_recordset('[
      {"name":"HR Manager | مدير الموارد البشرية","competencies":["HR leadership","HR strategy","Compliance","Workforce planning"]},
      {"name":"Talent Acquisition | الاستقطاب والتوظيف","competencies":["Sourcing","Selection","Employer branding","Recruitment analytics"]},
      {"name":"HR Operations | عمليات الموارد البشرية","competencies":["Employee lifecycle","HRIS","Policies","Service delivery"]},
      {"name":"Payroll | الرواتب والأجور","competencies":["Payroll controls","WPS","Reconciliation","Confidentiality"]},
      {"name":"Compensation & Benefits | التعويضات والمزايا","competencies":["Job evaluation","Salary benchmarking","Benefits","Pay equity"]},
      {"name":"Learning & Development | التعلم والتطوير","competencies":["Needs analysis","Learning design","Evaluation","Capability building"]},
      {"name":"Employee Relations | علاقات الموظفين","competencies":["Case management","Investigations","Labor compliance","Conflict resolution"]},
      {"name":"HR Business Partner | شريك أعمال الموارد البشرية","competencies":["Business partnering","Workforce planning","Change management","Stakeholder influence"]},
      {"name":"People Analytics & OD | تحليلات الموارد البشرية والتطوير التنظيمي","competencies":["People analytics","Organization design","Dashboards","Change management"]}
    ]'::jsonb) as role(name text, competencies jsonb)
  loop
    select t.id into v_template_id
    from public.ai_interview_templates t
    where t.company_id = v_company_id and t.template_name = v_role.name and t.version = 1
    limit 1;

    if v_template_id is null then
      insert into public.ai_interview_templates (
        company_id, template_name, profession, profession_category, language,
        interview_mode, interaction_mode, camera_mode, description,
        candidate_instructions, opening_message, closing_message, consent_text,
        duration_minutes, maximum_questions, passing_score, allow_ai_follow_up,
        allow_ai_follow_ups, max_dynamic_follow_ups, allow_candidate_retry,
        maximum_retries, require_microphone_test, require_consent, status,
        is_active, source_type, requested_question_count, interview_difficulty,
        generation_status, approval_status, approved_by, approved_at, is_locked,
        is_global, created_by, updated_by, ai_analysis, extracted_competencies,
        extracted_tasks, extracted_skills, extracted_safety_requirements
      ) values (
        v_company_id, v_role.name, v_role.name, 'Human Resources', 'Arabic / English',
        'Voice', 'Recorded', 'Optional',
        'Bilingual competency interview for Saudi Human Resources professionals.',
        'أجب بأمثلة عملية مختصرة، وحدد دورك والنتيجة. Answer with concise real examples, your role and the outcome.',
        'مرحباً بك في مقابلة الموارد البشرية لدى VisaFlow. Welcome to the VisaFlow HR interview.',
        'شكراً لك. اكتملت المقابلة. Thank you. Your interview is complete.',
        'أوافق على تسجيل وتحليل إجاباتي بالذكاء الاصطناعي لأغراض التقييم الوظيفي، والقرار النهائي للبشر.',
        25, 8, 70, true, true, 1, false, 0, true, true,
        'Active', true, 'Ready Template', 8, 'Professional', 'Generated',
        'Approved', 'Platform Owner', now(), true, true, 'Platform Owner', 'Platform Owner',
        jsonb_build_object('framework', 'Human Resources', 'bilingual', true),
        v_role.competencies,
        '["Deliver HR services","Manage employee cases","Monitor HR KPIs","Advise stakeholders"]'::jsonb,
        v_role.competencies,
        '["Confidentiality","Fairness","Saudi labor compliance","Data protection"]'::jsonb
      ) returning id into v_template_id;
    else
      update public.ai_interview_templates set
        profession = v_role.name, profession_category = 'Human Resources',
        language = 'Arabic / English', duration_minutes = 25,
        maximum_questions = 8, requested_question_count = 8,
        passing_score = 70, status = 'Active', is_active = true,
        approval_status = 'Approved', approved_by = 'Platform Owner',
        approved_at = coalesce(approved_at, now()), is_locked = true,
        is_global = true, updated_by = 'Platform Owner', updated_at = now()
      where id = v_template_id;
    end if;

    insert into public.ai_interview_questions (
      company_id, template_id, question_order, question_text, question_text_ar,
      question_text_en, question_type, competency, difficulty_level, weight,
      maximum_answer_seconds, expected_keywords, key_points, scoring_guide,
      ideal_answer, recruiter_notes, allow_follow_up, maximum_follow_ups,
      is_required, is_active, source_type, is_ai_generated, approved_by,
      approved_at, is_locked, is_global, created_by, updated_by
    )
    select v_company_id, v_template_id, q.ord, q.ar || ' / ' || q.en, q.ar, q.en,
      q.kind, q.competency, q.difficulty, q.weight, q.seconds,
      q.keywords, q.points, q.guide, q.ideal, q.notes,
      true, 1, true, true, 'Manual', false, 'Platform Owner', now(), true, true,
      'Platform Owner', 'Platform Owner'
    from jsonb_to_recordset('[
      {"ord":1,"ar":"عرّفنا بخبرتك في هذا المسار من الموارد البشرية ونطاق مسؤولياتك.","en":"Describe your experience in this HR discipline and the scope of your responsibilities.","kind":"Experience","competency":"Relevant experience","difficulty":"Medium","weight":10,"seconds":120,"keywords":["scope","experience","results"],"points":["Relevant scope","Personal accountability","Measurable result"],"guide":{"excellent":"Specific scope and measurable outcomes","acceptable":"Relevant experience with adequate detail","weak":"Generic answer"},"ideal":"يوضح نطاق العمل والمسؤولية والنتائج بأرقام أو أمثلة.","notes":"Verify scope and ownership."},
      {"ord":2,"ar":"اذكر إجراءً في الموارد البشرية حسّنته، وكيف قست أثر التحسين؟","en":"Describe an HR process you improved and how you measured the impact.","kind":"Behavioral","competency":"Process improvement","difficulty":"Advanced","weight":14,"seconds":150,"keywords":["process","KPI","cycle time","quality"],"points":["Problem diagnosis","Action","Measured impact"],"guide":{"excellent":"Clear before/after metrics and sustainable control","acceptable":"Relevant improvement with evidence","weak":"No measurable impact"},"ideal":"يشرح المشكلة والتحليل والتنفيذ ومؤشرات ما قبل وبعد التحسين.","notes":"Look for measurable impact."},
      {"ord":3,"ar":"كيف تحمي سرية بيانات الموظفين وتتعامل مع طلب وصول غير مصرح؟","en":"How do you protect employee confidentiality and handle an unauthorized access request?","kind":"Situational","competency":"Confidentiality","difficulty":"Advanced","weight":14,"seconds":130,"keywords":["need to know","authorization","privacy","escalation"],"points":["Refuse unauthorized disclosure","Verify authority","Document and escalate"],"guide":{"excellent":"Applies least privilege, verification and documented escalation","acceptable":"Protects confidentiality and seeks approval","weak":"Shares sensitive data informally"},"ideal":"يتحقق من الصلاحية ويطبق مبدأ الحاجة للمعرفة ويوثق ويصعّد عند الحاجة.","notes":"Unsafe disclosure is a critical concern."},
      {"ord":4,"ar":"اشرح حالة معقدة طبقت فيها سياسة الشركة أو نظام العمل السعودي بعدالة.","en":"Explain a complex case where you applied company policy or Saudi labor requirements fairly.","kind":"Behavioral","competency":"Compliance and fairness","difficulty":"Advanced","weight":14,"seconds":170,"keywords":["policy","Saudi labor","evidence","fairness"],"points":["Fact finding","Correct policy basis","Consistent decision"],"guide":{"excellent":"Evidence-based, compliant and consistently documented","acceptable":"Reasonable compliant handling","weak":"Biased or undocumented decision"},"ideal":"يجمع الوقائع ويراجع السياسة والنظام ويطبق قراراً متسقاً وموثقاً.","notes":"Do not treat AI output as legal advice."},
      {"ord":5,"ar":"ما أهم مؤشرات الأداء التي تتابعها في تخصصك، وكيف تتخذ قراراً منها؟","en":"Which KPIs matter most in your HR specialization and how do you act on them?","kind":"Technical","competency":"HR analytics","difficulty":"Advanced","weight":12,"seconds":140,"keywords":["KPI","trend","target","action"],"points":["Relevant metrics","Interpretation","Action loop"],"guide":{"excellent":"Connects leading and lagging KPIs to decisions","acceptable":"Names useful KPIs and actions","weak":"Lists metrics without decisions"},"ideal":"يربط مؤشرات مناسبة بالهدف ويحلل الاتجاه ثم يحدد إجراءً ومسؤولاً وموعداً.","notes":"Expect discipline-specific KPIs."},
      {"ord":6,"ar":"كيف تعاملت مع مدير أو موظف اختلف مع توصيتك المهنية؟","en":"How did you handle a manager or employee who disagreed with your professional recommendation?","kind":"Behavioral","competency":"Stakeholder management","difficulty":"Medium","weight":12,"seconds":140,"keywords":["listen","evidence","options","influence"],"points":["Active listening","Evidence","Constructive resolution"],"guide":{"excellent":"Balances empathy, evidence and business outcome","acceptable":"Communicates and resolves professionally","weak":"Escalates immediately or avoids conflict"},"ideal":"يستمع ويفهم المصلحة ويعرض الأدلة والخيارات ويتفق على قرار موثق.","notes":"Look for influence without authority."},
      {"ord":7,"ar":"اذكر خطأً في عملية موارد بشرية كان قد يؤثر على الموظفين، وكيف صححته ومنعت تكراره؟","en":"Describe an HR process error that could affect employees and how you corrected and prevented recurrence.","kind":"Situational","competency":"Controls and accountability","difficulty":"Advanced","weight":14,"seconds":160,"keywords":["containment","root cause","correction","control"],"points":["Protect employees","Root cause","Preventive control"],"guide":{"excellent":"Contains impact, corrects records and installs a preventive control","acceptable":"Corrects and documents the issue","weak":"Hides or shifts blame"},"ideal":"يحتوي الأثر ويصحح البيانات ويبلغ الأطراف ويحلل السبب ويضيف رقابة وقائية.","notes":"Accountability is essential."},
      {"ord":8,"ar":"ما خطة أول 90 يوماً لك إذا انضممت إلى جهة جديدة في هذا الدور؟","en":"What would your first 90-day plan be if you joined a new organization in this role?","kind":"Strategic","competency":"Planning","difficulty":"Advanced","weight":10,"seconds":150,"keywords":["30 60 90","stakeholders","baseline","priorities"],"points":["Listen and assess","Prioritize","Deliver and measure"],"guide":{"excellent":"Practical phased plan with stakeholders and measures","acceptable":"Logical priorities and early wins","weak":"Unstructured activity list"},"ideal":"خطة 30-60-90 للاستماع وبناء خط أساس وتحديد الأولويات وتحقيق مكاسب قابلة للقياس.","notes":"Assess prioritization and realism."}
    ]'::jsonb) as q(ord integer, ar text, en text, kind text, competency text,
      difficulty text, weight numeric, seconds integer, keywords jsonb, points jsonb,
      guide jsonb, ideal text, notes text)
    where not exists (
      select 1 from public.ai_interview_questions existing
      where existing.template_id = v_template_id
    );
  end loop;

  update public.talent_public_campaigns
  set settings = coalesce(settings, '{}'::jsonb) || '{"template_filter":"engineering"}'::jsonb,
      updated_at = now()
  where slug = 'saudi-engineers-2026';

  insert into public.talent_public_campaigns (
    slug, name_en, name_ar, description_en, description_ar,
    template_owner_company_id, status, registration_starts_at, settings
  ) values (
    'saudi-hr-professionals-2026',
    'VisaFlow Human Resources Talent Campaign',
    'حملة VisaFlow لمواهب الموارد البشرية',
    'A public registration and AI interview campaign for approved Human Resources specializations.',
    'حملة تسجيل ومقابلات بالذكاء الاصطناعي لمسارات الموارد البشرية المعتمدة في منصة المالك.',
    v_company_id, 'Active', now(),
    '{"market":"Saudi Arabia","channel":"LinkedIn","template_filter":"human_resources"}'::jsonb
  ) on conflict (slug) do update set
    name_en = excluded.name_en, name_ar = excluded.name_ar,
    description_en = excluded.description_en, description_ar = excluded.description_ar,
    template_owner_company_id = excluded.template_owner_company_id,
    status = excluded.status, settings = excluded.settings, updated_at = now();
end;
$$;

create or replace function public.talent_campaign_template_is_eligible(
  p_campaign_id uuid,
  p_template_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.talent_public_campaigns campaign
    join public.ai_interview_templates template
      on template.id = p_template_id
     and template.company_id = campaign.template_owner_company_id
    where campaign.id = p_campaign_id
      and template.is_active is true
      and template.is_current_version is true
      and template.status = 'Active'
      and template.approval_status = 'Approved'
      and nullif(btrim(template.profession), '') is not null
      and case campaign.settings ->> 'template_filter'
        when 'human_resources' then lower(coalesce(template.profession_category, '')) = 'human resources'
        when 'engineering' then
          lower(coalesce(template.profession_category, '')) like '%engineer%'
          or lower(template.profession) like '%engineer%'
          or lower(template.profession) like '%engineering%'
        else true
      end
  );
$$;

create or replace function public.get_public_talent_campaign(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_campaign public.talent_public_campaigns%rowtype;
  v_templates jsonb;
begin
  select * into v_campaign from public.talent_public_campaigns campaign
  where campaign.slug = nullif(btrim(p_slug), '') and campaign.status = 'Active'
    and (campaign.registration_starts_at is null or campaign.registration_starts_at <= now())
    and (campaign.registration_ends_at is null or campaign.registration_ends_at >= now());
  if not found then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', template.id, 'profession', template.profession,
    'template_name', template.template_name, 'language', template.language,
    'interview_mode', template.interview_mode,
    'duration_minutes', template.duration_minutes,
    'question_count', (select count(*) from public.ai_interview_questions question
      where question.template_id = template.id and question.is_active is true)
  ) order by template.profession, template.template_name), '[]'::jsonb)
  into v_templates
  from public.ai_interview_templates template
  where public.talent_campaign_template_is_eligible(v_campaign.id, template.id);

  return jsonb_build_object(
    'id', v_campaign.id, 'slug', v_campaign.slug,
    'name_en', v_campaign.name_en, 'name_ar', v_campaign.name_ar,
    'description_en', v_campaign.description_en, 'description_ar', v_campaign.description_ar,
    'cv_sharing_required', v_campaign.cv_sharing_required,
    'result_sharing_optional', v_campaign.result_sharing_optional,
    'registration_ends_at', v_campaign.registration_ends_at,
    'templates', v_templates
  );
end;
$$;

-- Keep the existing enrolment workflow intact, changing only its hard-coded
-- engineering eligibility rule to the campaign-aware rule above.
do $migration$
declare
  v_definition text;
  v_old text := $old$    and template.company_id = v_campaign.template_owner_company_id
    and template.is_active is true
    and template.is_current_version is true and template.status = 'Active'
    and template.approval_status = 'Approved'
    and (lower(coalesce(template.profession_category, '')) like '%engineer%'
      or lower(template.profession) like '%engineer%'
      or lower(template.profession) like '%engineering%');$old$;
  v_new text := $new$    and public.talent_campaign_template_is_eligible(v_campaign.id, template.id);$new$;
begin
  select pg_get_functiondef(
    'public.enroll_in_talent_campaign(text,uuid,boolean,text,jsonb)'::regprocedure
  ) into v_definition;

  if position(v_old in v_definition) = 0 then
    raise exception 'Unable to upgrade Talent campaign enrolment eligibility safely.';
  end if;

  v_definition := replace(v_definition, v_old, v_new);
  v_definition := replace(
    v_definition,
    'Select an approved engineering interview template.',
    'Select an approved interview template for this campaign.'
  );
  execute v_definition;
end;
$migration$;

revoke all on function public.talent_campaign_template_is_eligible(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_public_talent_campaign(text) to anon, authenticated, service_role;
