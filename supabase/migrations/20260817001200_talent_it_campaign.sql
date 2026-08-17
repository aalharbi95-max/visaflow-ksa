-- Public IT & Digital Talent campaign. Open to qualified professionals of all
-- nationalities, with approved bilingual templates isolated to IT roles.

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
    raise exception 'A company is required before seeding IT interview templates.';
  end if;

  for v_role in
    select * from jsonb_to_recordset('[
      {"name":"Software Engineering | تطوير البرمجيات","competencies":["Software design","Programming","Testing","Code quality"]},
      {"name":"Data & Artificial Intelligence | البيانات والذكاء الاصطناعي","competencies":["Data analysis","Data modeling","Machine learning","Responsible AI"]},
      {"name":"Cybersecurity | الأمن السيبراني","competencies":["Security operations","Risk assessment","Incident response","Security controls"]},
      {"name":"Cloud & DevOps | الحوسبة السحابية وDevOps","competencies":["Cloud architecture","CI/CD","Infrastructure as code","Reliability"]},
      {"name":"Networks | الشبكات","competencies":["Network design","Routing and switching","Monitoring","Troubleshooting"]},
      {"name":"Systems Administration | إدارة الأنظمة","competencies":["Operating systems","Identity and access","Backup and recovery","Automation"]},
      {"name":"IT Support & Service Desk | الدعم التقني ومكتب الخدمة","competencies":["Incident management","Troubleshooting","Customer service","Knowledge management"]},
      {"name":"Quality Assurance & Software Testing | ضمان الجودة واختبار البرمجيات","competencies":["Test design","Automation","Defect management","Quality metrics"]},
      {"name":"ERP & Business Applications | أنظمة ERP وتطبيقات الأعمال","competencies":["Business applications","Configuration","Integration","User support"]},
      {"name":"IT Business Analysis & Project Management | تحليل الأعمال وإدارة مشاريع التقنية","competencies":["Requirements","Stakeholder management","Delivery planning","Change management"]}
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
        v_company_id, v_role.name, v_role.name, 'Information Technology', 'Arabic / English',
        'Voice', 'Recorded', 'Optional',
        'Bilingual competency interview for qualified Information Technology professionals.',
        'أجب بأمثلة عملية مختصرة، وحدد دورك والتقنية المستخدمة والنتيجة. Answer with concise real examples, your role, the technology used, and the outcome.',
        'مرحبًا بك في مقابلة VisaFlow لكفاءات تقنية المعلومات. Welcome to the VisaFlow IT interview.',
        'شكرًا لك. اكتملت المقابلة. Thank you. Your interview is complete.',
        'أوافق على تسجيل وتحليل إجاباتي بالذكاء الاصطناعي لأغراض التقييم الوظيفي، والقرار النهائي للبشر.',
        25, 8, 70, true, true, 1, false, 0, true, true,
        'Active', true, 'Ready Template', 8, 'Advanced', 'Generated',
        'Approved', 'Platform Owner', now(), true, true, 'Platform Owner', 'Platform Owner',
        jsonb_build_object('framework', 'Information Technology', 'bilingual', true),
        v_role.competencies,
        '["Deliver reliable technology services","Protect systems and data","Troubleshoot incidents","Improve technical processes"]'::jsonb,
        v_role.competencies,
        '["Data protection","Secure access","Change control","Backup and recovery","Responsible AI"]'::jsonb
      ) returning id into v_template_id;
    else
      update public.ai_interview_templates set
        profession = v_role.name,
        profession_category = 'Information Technology',
        language = 'Arabic / English',
        duration_minutes = 25,
        maximum_questions = 8,
        requested_question_count = 8,
        passing_score = 70,
        status = 'Active',
        is_active = true,
        approval_status = 'Approved',
        approved_by = 'Platform Owner',
        approved_at = coalesce(approved_at, now()),
        is_locked = true,
        is_global = true,
        extracted_competencies = v_role.competencies,
        extracted_skills = v_role.competencies,
        updated_by = 'Platform Owner',
        updated_at = now()
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
      {"ord":1,"ar":"عرّفنا بخبرتك في هذا المسار التقني ونطاق مسؤولياتك.","en":"Describe your experience in this IT discipline and the scope of your responsibilities.","kind":"Experience","competency":"Relevant experience","difficulty":"Medium","weight":10,"seconds":120,"keywords":["scope","technology","ownership","results"],"points":["Relevant scope","Personal ownership","Measurable result"],"guide":{"excellent":"Specific technical scope, ownership and measurable results","acceptable":"Relevant experience with adequate detail","weak":"Generic answer without ownership"},"ideal":"يوضح نطاق العمل والمسؤولية الشخصية والتقنيات والنتيجة القابلة للقياس.","notes":"Verify actual ownership and technical depth."},
      {"ord":2,"ar":"اشرح مشكلة تقنية معقدة حللتها، وكيف وصلت إلى السبب الجذري.","en":"Explain a complex technical problem you solved and how you identified the root cause.","kind":"Technical","competency":"Problem solving","difficulty":"Advanced","weight":15,"seconds":170,"keywords":["diagnosis","evidence","root cause","resolution"],"points":["Structured diagnosis","Evidence","Sustainable fix"],"guide":{"excellent":"Uses evidence to isolate root cause and verifies a sustainable fix","acceptable":"Reasonable diagnosis and resolution","weak":"Guessing without evidence"},"ideal":"يجمع الأدلة ويعزل المتغيرات ويحدد السبب ويطبق الحل ويتحقق من النتيجة.","notes":"Look for method, not tool names alone."},
      {"ord":3,"ar":"اذكر مشروعًا تقنيًا شاركت فيه، وما دورك والنتيجة التي حققها.","en":"Describe a technology project you contributed to, your role, and the outcome delivered.","kind":"Behavioral","competency":"Delivery","difficulty":"Advanced","weight":13,"seconds":160,"keywords":["requirements","delivery","stakeholders","outcome"],"points":["Clear role","Delivery decisions","Measured outcome"],"guide":{"excellent":"Connects personal decisions to a measurable business or service outcome","acceptable":"Explains role and relevant delivery","weak":"Describes team activity without own contribution"},"ideal":"يحدد الهدف والدور والقرارات والعوائق والنتيجة القابلة للقياس.","notes":"Separate individual contribution from team output."},
      {"ord":4,"ar":"كيف تحمي البيانات والصلاحيات عند تصميم أو تشغيل حل تقني؟","en":"How do you protect data and access when designing or operating a technology solution?","kind":"Technical","competency":"Security and privacy","difficulty":"Advanced","weight":15,"seconds":150,"keywords":["least privilege","encryption","logging","privacy"],"points":["Risk-based controls","Least privilege","Monitoring and response"],"guide":{"excellent":"Applies layered controls, least privilege, logging and tested response","acceptable":"Uses appropriate access and data controls","weak":"Treats security as an afterthought"},"ideal":"يحدد المخاطر ويطبق أقل صلاحية والتشفير والتسجيل والمراجعة وخطة الاستجابة.","notes":"Unsafe handling of credentials or production data is a critical concern."},
      {"ord":5,"ar":"كيف تتعامل مع تغيير تقني قد يؤثر على خدمة إنتاجية؟","en":"How do you manage a technical change that could affect a production service?","kind":"Technical","competency":"Change and reliability","difficulty":"Advanced","weight":13,"seconds":150,"keywords":["risk","testing","rollback","monitoring"],"points":["Impact assessment","Test and rollback","Post-change monitoring"],"guide":{"excellent":"Uses risk assessment, staged testing, rollback and measurable monitoring","acceptable":"Plans, tests and monitors the change","weak":"Changes production without control"},"ideal":"يقيّم الأثر ويختبر ويعتمد خطة رجوع ويراقب المؤشرات ويوثق النتيجة.","notes":"Uncontrolled production changes are a critical concern."},
      {"ord":6,"ar":"اذكر قرارًا تقنيًا كان له أكثر من خيار، وكيف قارنت البدائل.","en":"Describe a technical decision with multiple options and how you compared the alternatives.","kind":"Technical","competency":"Technical judgment","difficulty":"Advanced","weight":12,"seconds":150,"keywords":["requirements","tradeoffs","cost","risk"],"points":["Decision criteria","Tradeoff analysis","Clear recommendation"],"guide":{"excellent":"Balances requirements, risk, cost, maintainability and evidence","acceptable":"Compares relevant options and selects reasonably","weak":"Chooses by preference only"},"ideal":"يحدد المعايير ويقارن الأمان والتكلفة والأداء والصيانة ثم يوثق القرار.","notes":"Assess reasoning rather than a preferred vendor."},
      {"ord":7,"ar":"كيف تشرح موضوعًا تقنيًا معقدًا لصاحب مصلحة غير تقني؟","en":"How do you explain a complex technical subject to a non-technical stakeholder?","kind":"Behavioral","competency":"Communication","difficulty":"Medium","weight":10,"seconds":130,"keywords":["plain language","impact","options","recommendation"],"points":["Clear language","Business impact","Actionable recommendation"],"guide":{"excellent":"Translates technical drivers into impact, options and action","acceptable":"Explains clearly with relevant context","weak":"Uses jargon without a decision"},"ideal":"يبسط المفهوم ويربطه بالأثر والمخاطر والخيارات والتوصية المطلوبة.","notes":"Look for audience awareness."},
      {"ord":8,"ar":"ما خطة أول 90 يومًا لك إذا انضممت إلى جهة جديدة في هذا الدور؟","en":"What would your first 90-day plan be if you joined a new organization in this role?","kind":"Technical","competency":"Planning","difficulty":"Advanced","weight":12,"seconds":150,"keywords":["30 60 90","baseline","stakeholders","priorities"],"points":["Learn and assess","Prioritize risks","Deliver and measure"],"guide":{"excellent":"Practical phased plan with stakeholders, risks and measures","acceptable":"Logical priorities and early wins","weak":"Unstructured activity list"},"ideal":"خطة 30-60-90 لفهم البيئة والأنظمة والمخاطر ثم ترتيب الأولويات وتحقيق نتائج قابلة للقياس.","notes":"Assess prioritization and realism."}
    ]'::jsonb) as q(ord integer, ar text, en text, kind text, competency text,
      difficulty text, weight numeric, seconds integer, keywords jsonb, points jsonb,
      guide jsonb, ideal text, notes text)
    where not exists (
      select 1 from public.ai_interview_questions existing
      where existing.template_id = v_template_id
    );
  end loop;

  insert into public.talent_public_campaigns (
    slug, name_en, name_ar, description_en, description_ar,
    template_owner_company_id, status, registration_starts_at, settings
  ) values (
    'it-digital-professionals-2026',
    'VisaFlow IT & Digital Talent Campaign',
    'حملة VisaFlow لكفاءات تقنية المعلومات',
    'A public registration and AI interview campaign for qualified IT and digital professionals of all nationalities.',
    'حملة تسجيل ومقابلات بالذكاء الاصطناعي للكفاءات المؤهلة في تقنية المعلومات من جميع الجنسيات.',
    v_company_id, 'Active', now(),
    '{"market":"Open","channel":"Multi-channel","template_filter":"information_technology","nationality_restriction":false}'::jsonb
  ) on conflict (slug) do update set
    name_en = excluded.name_en,
    name_ar = excluded.name_ar,
    description_en = excluded.description_en,
    description_ar = excluded.description_ar,
    template_owner_company_id = excluded.template_owner_company_id,
    status = excluded.status,
    settings = excluded.settings,
    updated_at = now();
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
        when 'finance_accounting' then lower(coalesce(template.profession_category, '')) = 'finance & accounting'
        when 'information_technology' then lower(coalesce(template.profession_category, '')) = 'information technology'
        when 'engineering' then
          lower(coalesce(template.profession_category, '')) like '%engineer%'
          or lower(template.profession) like '%engineer%'
          or lower(template.profession) like '%engineering%'
        else false
      end
  );
$$;

revoke all on function public.talent_campaign_template_is_eligible(uuid, uuid) from public, anon, authenticated;
grant execute on function public.talent_campaign_template_is_eligible(uuid, uuid) to service_role;
