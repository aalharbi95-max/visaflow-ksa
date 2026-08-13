-- Public Finance & Accounting Talent campaign. The campaign is open to all
-- qualified professionals and intentionally has no nationality restriction.

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
    raise exception 'A company is required before seeding Finance interview templates.';
  end if;

  for v_role in
    select * from jsonb_to_recordset('[
      {"name":"General Accounting | المحاسبة العامة","competencies":["Financial accounting","Month-end close","Reconciliation","Financial controls"]},
      {"name":"Accounts Payable & Receivable | الحسابات الدائنة والمدينة","competencies":["Invoice controls","Collections","Reconciliation","Working capital"]},
      {"name":"Cost Accounting | محاسبة التكاليف","competencies":["Cost allocation","Variance analysis","Inventory costing","Margin analysis"]},
      {"name":"FP&A | التخطيط والتحليل المالي","competencies":["Budgeting","Forecasting","Financial modeling","Business partnering"]},
      {"name":"Internal Audit | المراجعة الداخلية","competencies":["Risk assessment","Audit planning","Control testing","Issue follow-up"]},
      {"name":"Zakat & Tax | الزكاة والضرائب","competencies":["Zakat compliance","VAT","Tax controls","Regulatory filing"]},
      {"name":"Treasury | الخزينة وإدارة النقد","competencies":["Cash forecasting","Liquidity","Banking relations","Treasury controls"]},
      {"name":"Credit Analysis | التحليل الائتماني","competencies":["Credit assessment","Financial statements","Risk rating","Portfolio monitoring"]},
      {"name":"Financial Risk & Compliance | المخاطر والالتزام المالي","competencies":["Financial risk","Compliance","AML and KYC","Monitoring controls"]},
      {"name":"Corporate Finance & Investment | تمويل الشركات والاستثمار","competencies":["Valuation","Investment analysis","Capital structure","Due diligence"]}
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
        v_company_id, v_role.name, v_role.name, 'Finance & Accounting', 'Arabic / English',
        'Voice', 'Recorded', 'Optional',
        'Bilingual competency interview for Finance and Accounting professionals.',
        'أجب بأمثلة عملية مختصرة، وحدد دورك والنتيجة والأثر المالي. Answer with concise real examples, your role, the result, and the financial impact.',
        'مرحبًا بك في مقابلة VisaFlow للكفاءات المالية والمحاسبية. Welcome to the VisaFlow Finance and Accounting interview.',
        'شكرًا لك. اكتملت المقابلة. Thank you. Your interview is complete.',
        'أوافق على تسجيل وتحليل إجاباتي بالذكاء الاصطناعي لأغراض التقييم الوظيفي، والقرار النهائي للبشر.',
        25, 8, 70, true, true, 1, false, 0, true, true,
        'Active', true, 'Ready Template', 8, 'Advanced', 'Generated',
        'Approved', 'Platform Owner', now(), true, true, 'Platform Owner', 'Platform Owner',
        jsonb_build_object('framework', 'Finance & Accounting', 'bilingual', true),
        v_role.competencies,
        '["Prepare and review financial information","Apply financial controls","Analyze variances and risks","Advise business stakeholders"]'::jsonb,
        v_role.competencies,
        '["Confidentiality","Accuracy","Segregation of duties","Fraud awareness","Data protection"]'::jsonb
      ) returning id into v_template_id;
    else
      update public.ai_interview_templates set
        profession = v_role.name,
        profession_category = 'Finance & Accounting',
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
      {"ord":1,"ar":"عرّفنا بخبرتك في هذا المسار المالي ونطاق مسؤولياتك.","en":"Describe your experience in this finance discipline and the scope of your responsibilities.","kind":"Experience","competency":"Relevant experience","difficulty":"Medium","weight":10,"seconds":120,"keywords":["scope","responsibility","results"],"points":["Relevant scope","Personal ownership","Measurable outcome"],"guide":{"excellent":"Specific scope, ownership and measurable results","acceptable":"Relevant experience with adequate detail","weak":"Generic answer without ownership"},"ideal":"يوضح نطاق العمل والمسؤولية الشخصية ونتيجة قابلة للقياس.","notes":"Verify actual ownership and scale."},
      {"ord":2,"ar":"اشرح تقريرًا أو تحليلًا ماليًا أعددته وكيف أثّر في قرار عملي.","en":"Explain a financial report or analysis you prepared and how it influenced a business decision.","kind":"Technical","competency":"Financial analysis","difficulty":"Advanced","weight":14,"seconds":150,"keywords":["analysis","assumptions","decision","impact"],"points":["Sound analysis","Clear assumptions","Decision impact"],"guide":{"excellent":"Connects reliable analysis to a measurable decision","acceptable":"Relevant analysis and reasonable decision support","weak":"Produces figures without interpretation"},"ideal":"يربط بيانات موثوقة وافتراضات واضحة بقرار وأثر مالي.","notes":"Look for decision usefulness, not spreadsheet activity alone."},
      {"ord":3,"ar":"اذكر تسوية أو فرقًا ماليًا اكتشفته، وكيف حققت في السبب وعالجته.","en":"Describe a reconciliation difference or financial discrepancy you found, investigated, and resolved.","kind":"Technical","competency":"Accuracy and reconciliation","difficulty":"Advanced","weight":14,"seconds":150,"keywords":["reconciliation","root cause","evidence","correction"],"points":["Detection","Evidence-based root cause","Controlled correction"],"guide":{"excellent":"Traces evidence, fixes the cause and prevents recurrence","acceptable":"Finds and corrects the discrepancy","weak":"Forces a balance without evidence"},"ideal":"يتتبع المستندات ويحدد السبب ويصحح القيد ويضيف رقابة وقائية.","notes":"Forced balancing is a critical concern."},
      {"ord":4,"ar":"كيف تضمن صحة البيانات المالية وسرية المعلومات والفصل بين الصلاحيات؟","en":"How do you protect financial data accuracy, confidentiality, and segregation of duties?","kind":"Behavioral","competency":"Financial controls","difficulty":"Advanced","weight":14,"seconds":140,"keywords":["authorization","segregation","review","confidentiality"],"points":["Access control","Independent review","Documented evidence"],"guide":{"excellent":"Applies least privilege, segregation, review and evidence","acceptable":"Uses approvals and protects confidentiality","weak":"Relies on trust or shared access"},"ideal":"يطبق أقل صلاحية والفصل بين الإعداد والاعتماد والمراجعة والتوثيق.","notes":"Shared credentials or uncontrolled access are critical concerns."},
      {"ord":5,"ar":"اشرح حالة ضغط موعد إقفال أو تقرير عاجل، وكيف حافظت على الجودة.","en":"Describe a tight close or urgent reporting deadline and how you maintained quality.","kind":"Behavioral","competency":"Delivery under pressure","difficulty":"Medium","weight":12,"seconds":140,"keywords":["prioritize","checklist","review","deadline"],"points":["Prioritization","Quality controls","Transparent communication"],"guide":{"excellent":"Delivers on time with risk-based checks and escalation","acceptable":"Plans and reviews adequately","weak":"Skips controls to meet the deadline"},"ideal":"يرتب الأولويات ويستخدم قائمة تحقق ويراجع البنود عالية المخاطر ويصعّد مبكرًا.","notes":"Do not reward speed that bypasses controls."},
      {"ord":6,"ar":"اذكر مخاطرة مالية أو رقابية حددتها، وما الإجراء الذي اتخذته.","en":"Describe a financial or control risk you identified and the action you took.","kind":"Technical","competency":"Risk judgment","difficulty":"Advanced","weight":14,"seconds":150,"keywords":["risk","likelihood","impact","mitigation"],"points":["Risk identification","Proportionate response","Follow-up"],"guide":{"excellent":"Assesses impact and likelihood, mitigates and verifies closure","acceptable":"Identifies and addresses a relevant risk","weak":"Names a risk without action"},"ideal":"يحدد السبب والأثر والاحتمالية والمالك والإجراء ثم يتحقق من الإغلاق.","notes":"Look for proportionate judgment and follow-through."},
      {"ord":7,"ar":"كيف تشرح نتيجة مالية معقدة لمدير غير مالي وتوصي بإجراء؟","en":"How do you explain a complex financial result to a non-finance manager and recommend action?","kind":"Behavioral","competency":"Business partnering","difficulty":"Advanced","weight":12,"seconds":140,"keywords":["plain language","driver","option","recommendation"],"points":["Clear explanation","Business context","Actionable recommendation"],"guide":{"excellent":"Translates drivers into options, tradeoffs and action","acceptable":"Explains clearly and recommends a reasonable step","weak":"Uses jargon without a decision"},"ideal":"يبسط المحركات المالية ويربطها بالعمل ويعرض خيارات وتوصية واضحة.","notes":"Assess influence and commercial understanding."},
      {"ord":8,"ar":"ما خطة أول 90 يومًا لك إذا انضممت إلى جهة جديدة في هذا الدور؟","en":"What would your first 90-day plan be if you joined a new organization in this role?","kind":"Technical","competency":"Planning","difficulty":"Advanced","weight":10,"seconds":150,"keywords":["30 60 90","stakeholders","baseline","controls"],"points":["Learn and assess","Prioritize risks","Deliver and measure"],"guide":{"excellent":"Practical phased plan with stakeholders, controls and measures","acceptable":"Logical priorities and early wins","weak":"Unstructured activity list"},"ideal":"خطة 30-60-90 لفهم العمل والبيانات والضوابط ثم ترتيب المخاطر وتحقيق نتائج قابلة للقياس.","notes":"Assess prioritization and realism."}
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
    'finance-accounting-professionals-2026',
    'VisaFlow Finance & Accounting Talent Campaign',
    'حملة VisaFlow للكفاءات المالية والمحاسبية',
    'A public registration and AI interview campaign for qualified Finance and Accounting professionals of all nationalities.',
    'حملة تسجيل ومقابلات بالذكاء الاصطناعي للكفاءات المؤهلة في المالية والمحاسبة من جميع الجنسيات.',
    v_company_id, 'Active', now(),
    '{"market":"Open","channel":"Multi-channel","template_filter":"finance_accounting","nationality_restriction":false}'::jsonb
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

