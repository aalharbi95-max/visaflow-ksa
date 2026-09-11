-- Entry-level accounting campaign; study and training examples are accepted.

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
    raise exception 'A company is required before seeding Junior Accountant interview template.';
  end if;

  for v_role in
    select * from jsonb_to_recordset('[{"name":"Junior Accountant | محاسب مبتدئ","competencies":["Double-entry bookkeeping","Accrual accounting","Invoice verification","Bank reconciliation","Spreadsheet basics","Integrity and confidentiality"]}]'::jsonb) as role(name text, competencies jsonb)
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
        v_company_id, v_role.name, v_role.name, 'Junior Accounting', 'Arabic / English',
        'Voice', 'Recorded', 'Optional',
        'Entry-level bilingual accounting interview for graduates and junior accountants; no employment history required.',
        'أجب بالعربية أو الإنجليزية. تقبل أمثلة الدراسة والتدريب والسيناريوهات الافتراضية، ولا تشترط خبرة وظيفية. Answer in Arabic or English; study, training and hypothetical examples are welcome. No employment history is required.',
        'مرحبًا بك في مقابلة المحاسب المبتدئ لدى VisaFlow. سنناقش أساسيات المحاسبة في ثمانية أسئلة. Welcome to the VisaFlow Junior Accountant interview.',
        'شكرًا لك. اكتملت المقابلة. Thank you. Your interview is complete.',
        'أوافق على تسجيل وتحليل إجاباتي بالذكاء الاصطناعي لأغراض التقييم الوظيفي، والقرار النهائي للبشر.',
        20, 8, 70, true, true, 1, false, 0, true, true,
        'Active', true, 'Ready Template', 8, 'Basic', 'Generated',
        'Approved', 'Platform Owner', now(), true, true, 'Platform Owner', 'Platform Owner',
        jsonb_build_object('framework', 'Junior Accounting', 'bilingual', true),
        v_role.competencies,
        '["Record basic journal entries","Check invoices","Reconcile bank balances","Use spreadsheets under supervision"]'::jsonb,
        v_role.competencies,
        '["Confidentiality","Accuracy","Segregation of duties","Fraud awareness","Data protection"]'::jsonb
      ) returning id into v_template_id;
    else
      update public.ai_interview_templates set
        profession = v_role.name,
        profession_category = 'Junior Accounting',
        language = 'Arabic / English',
        duration_minutes = 20,
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
    from jsonb_to_recordset('[{"ord":1,"kind":"Experience","competency":"Learning readiness","weight":10,"ar":"عرّفنا بدراستك أو تدريبك، واذكر مهارة محاسبية تعلمتها وكيف طبقتها. يمكنك استخدام مشروع دراسي.","en":"Tell us about your studies or training and one accounting skill you applied. A study project is welcome.","points":["Relevant learning","Clear personal contribution","Willingness to learn"],"ideal":"يوضح ما تعلمه ومساهمته في مثال دراسي أو تدريبي. لا تشترط خبرة وظيفية.","difficulty":"Easy","seconds":120,"keywords":["Relevant learning","Clear personal contribution","Willingness to learn"],"guide":{"excellent":"Accurately covers all listed key points and explains the reasoning.","acceptable":"Covers the core principle with minor omissions and safe judgment.","weak":"Misses the core principle or proposes unsupported or unsafe actions."},"notes":"Assess at entry level against the question key points. Accept Arabic or English and study, training or hypothetical examples. Do not penalize lack of employment history or accent. Human review is required; this is not an automatic hiring decision."},{"ord":2,"kind":"Technical","competency":"Double-entry bookkeeping","weight":15,"ar":"دفعت المنشأة إيجار الشهر نقدًا بمبلغ ٣٬٠٠٠ ريال. تجاهل الضرائب في هذا المثال: ما القيد المحاسبي ولماذا؟","en":"The business paid this month rent of SAR 3,000 in cash. Ignore taxes in this example: what is the journal entry and why?","points":["Debit rent expense 3000","Credit cash 3000","Balanced entry and explanation"],"ideal":"من حـ/ مصروف الإيجار ٣٬٠٠٠ إلى حـ/ النقدية ٣٬٠٠٠؛ يزيد المصروف وتنخفض النقدية ويتوازن القيد.","difficulty":"Medium","seconds":120,"keywords":["Debit rent expense 3000","Credit cash 3000","Balanced entry and explanation"],"guide":{"excellent":"Accurately covers all listed key points and explains the reasoning.","acceptable":"Covers the core principle with minor omissions and safe judgment.","weak":"Misses the core principle or proposes unsupported or unsafe actions."},"notes":"Assess at entry level against the question key points. Accept Arabic or English and study, training or hypothetical examples. Do not penalize lack of employment history or accent. Human review is required; this is not an automatic hiring decision."},{"ord":3,"kind":"Technical","competency":"Accrual accounting","weight":15,"ar":"قدمت المنشأة خدمة بقيمة ٥٬٠٠٠ ريال على الحساب ولم تستلم المبلغ بعد. تجاهل الضرائب: كيف تسجل العملية ثم التحصيل لاحقًا؟","en":"The business provided a SAR 5,000 service on credit and has not collected payment. Ignore taxes: how do you record the service and the later collection?","points":["Debit receivables and credit revenue 5000","Debit bank and credit receivables on collection","Do not recognize revenue twice"],"ideal":"عند تقديم الخدمة: مدين العملاء ودائن إيراد الخدمات ٥٬٠٠٠. عند التحصيل: مدين البنك ودائن العملاء ٥٬٠٠٠، دون تكرار الإيراد.","difficulty":"Medium","seconds":120,"keywords":["Debit receivables and credit revenue 5000","Debit bank and credit receivables on collection","Do not recognize revenue twice"],"guide":{"excellent":"Accurately covers all listed key points and explains the reasoning.","acceptable":"Covers the core principle with minor omissions and safe judgment.","weak":"Misses the core principle or proposes unsupported or unsafe actions."},"notes":"Assess at entry level against the question key points. Accept Arabic or English and study, training or hypothetical examples. Do not penalize lack of employment history or accent. Human review is required; this is not an automatic hiring decision."},{"ord":4,"kind":"Technical","competency":"Invoice verification","weight":15,"ar":"وصلتك فاتورة مورد لإدخالها في النظام. ما الذي تراجعه قبل التسجيل، وماذا تفعل إذا اشتبهت أنها مكررة؟","en":"You received a supplier invoice to enter in the system. What do you check before recording it, and what if it appears duplicated?","points":["Supplier invoice number date and amounts","Match supporting documents and approval","Check duplicates and escalate before posting"],"ideal":"يراجع المورد والرقم والتاريخ والمبلغ والمستندات والاستلام والاعتماد، ويبحث عن تكرار الفاتورة ويطلب التحقق قبل التسجيل.","difficulty":"Medium","seconds":120,"keywords":["Supplier invoice number date and amounts","Match supporting documents and approval","Check duplicates and escalate before posting"],"guide":{"excellent":"Accurately covers all listed key points and explains the reasoning.","acceptable":"Covers the core principle with minor omissions and safe judgment.","weak":"Misses the core principle or proposes unsupported or unsafe actions."},"notes":"Assess at entry level against the question key points. Accept Arabic or English and study, training or hypothetical examples. Do not penalize lack of employment history or accent. Human review is required; this is not an automatic hiring decision."},{"ord":5,"kind":"Technical","competency":"Bank reconciliation","weight":15,"ar":"رصيد البنك في الدفاتر ١٠٬٠٠٠ ريال وفي كشف البنك ٩٬٩٠٠ ريال. أظهر الكشف رسومًا بنكية ١٠٠ ريال لم تسجل. كيف تسوي الفرق؟","en":"The bank balance is SAR 10,000 in the ledger and SAR 9,900 on the bank statement. The statement shows an unrecorded SAR 100 bank fee. How do you reconcile the difference?","points":["Verify bank fee evidence","Debit bank charges 100 and credit bank 100","Adjusted ledger balance 9900 with review"],"ideal":"يتحقق من الرسوم ثم يسجل ١٠٠ مدين مصروف رسوم بنكية و١٠٠ دائن البنك؛ يصبح الرصيد ٩٬٩٠٠ مع حفظ المستند ومراجعة التسوية.","difficulty":"Medium","seconds":120,"keywords":["Verify bank fee evidence","Debit bank charges 100 and credit bank 100","Adjusted ledger balance 9900 with review"],"guide":{"excellent":"Accurately covers all listed key points and explains the reasoning.","acceptable":"Covers the core principle with minor omissions and safe judgment.","weak":"Misses the core principle or proposes unsupported or unsafe actions."},"notes":"Assess at entry level against the question key points. Accept Arabic or English and study, training or hypothetical examples. Do not penalize lack of employment history or accent. Human review is required; this is not an automatic hiring decision."},{"ord":6,"kind":"Technical","competency":"Spreadsheet basics","weight":10,"ar":"لديك جدول فواتير في Excel يحتوي على رقم الفاتورة والمورد والمبلغ. كيف تجمع المبالغ وتكتشف الفواتير المكررة وتتحقق من صحة النتائج؟","en":"An Excel invoice list contains invoice number, supplier and amount. How would you total amounts, identify duplicate invoices and verify the results?","points":["SUM or equivalent total","Check supplier plus invoice number with COUNTIFS or equivalent","Review against source without blindly deleting duplicates"],"ideal":"يستخدم SUM للجمع وCOUNTIFS أو وسيلة مكافئة لفحص المورد مع رقم الفاتورة، ويتحقق من تنسيق الأرقام ويطابق المستندات قبل معالجة التكرار.","difficulty":"Medium","seconds":120,"keywords":["SUM or equivalent total","Check supplier plus invoice number with COUNTIFS or equivalent","Review against source without blindly deleting duplicates"],"guide":{"excellent":"Accurately covers all listed key points and explains the reasoning.","acceptable":"Covers the core principle with minor omissions and safe judgment.","weak":"Misses the core principle or proposes unsupported or unsafe actions."},"notes":"Assess at entry level against the question key points. Accept Arabic or English and study, training or hypothetical examples. Do not penalize lack of employment history or accent. Human review is required; this is not an automatic hiring decision."},{"ord":7,"kind":"Behavioral","competency":"Integrity and confidentiality","weight":10,"ar":"طلب منك زميل تسجيل مصروف بلا مستند لإقفال الحسابات بسرعة. كيف تتصرف كمحاسب مبتدئ؟","en":"A colleague asks you to record an unsupported expense to close the accounts quickly. How would you respond as a junior accountant?","points":["Request supporting evidence","Consult supervisor and follow approved policy","Document issue and protect confidential data"],"ideal":"يطلب المستند والتوضيح ويرجع للمشرف والسياسة المعتمدة ويوثق الحالة، ولا يختلق دليلًا أو قيدًا لمجرد إقفال الحسابات.","difficulty":"Medium","seconds":120,"keywords":["Request supporting evidence","Consult supervisor and follow approved policy","Document issue and protect confidential data"],"guide":{"excellent":"Accurately covers all listed key points and explains the reasoning.","acceptable":"Covers the core principle with minor omissions and safe judgment.","weak":"Misses the core principle or proposes unsupported or unsafe actions."},"notes":"Assess at entry level against the question key points. Accept Arabic or English and study, training or hypothetical examples. Do not penalize lack of employment history or accent. Human review is required; this is not an automatic hiring decision."},{"ord":8,"kind":"Behavioral","competency":"Accuracy and teamwork","weight":10,"ar":"اكتشفت خطأ في عملك قبل موعد تسليم قريب. كيف تبلغ المشرف وتصححه وتقلل تكراره؟ يمكنك استخدام مثال دراسي أو افتراضي.","en":"You discover an error in your work close to a deadline. How would you notify your supervisor, correct it and prevent recurrence? A study or hypothetical example is welcome.","points":["Notify supervisor promptly with impact","Correct with review and audit trail","Use checklist to prevent recurrence"],"ideal":"يبلغ المشرف بوضوح ويحدد الأثر ويصحح وفق الاعتماد والمراجعة ويحفظ أثر التعديل ويستخدم قائمة تحقق لمنع التكرار.","difficulty":"Medium","seconds":120,"keywords":["Notify supervisor promptly with impact","Correct with review and audit trail","Use checklist to prevent recurrence"],"guide":{"excellent":"Accurately covers all listed key points and explains the reasoning.","acceptable":"Covers the core principle with minor omissions and safe judgment.","weak":"Misses the core principle or proposes unsupported or unsafe actions."},"notes":"Assess at entry level against the question key points. Accept Arabic or English and study, training or hypothetical examples. Do not penalize lack of employment history or accent. Human review is required; this is not an automatic hiring decision."}]'::jsonb) as q(ord integer, ar text, en text, kind text, competency text,
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
    'junior-accountants-2026',
    'VisaFlow Junior Accountant Interview Campaign',
    'حملة VisaFlow لمقابلات المحاسب المبتدئ',
    'An entry-level AI practice interview for graduates and junior accountants of all nationalities. Eight questions in about 20 minutes. Employment experience is not required; participation does not guarantee employment.',
    'حملة مقابلات تدريبية بالذكاء الاصطناعي للمحاسبين المبتدئين وحديثي التخرج من جميع الجنسيات. ٨ أسئلة خلال نحو ٢٠ دقيقة دون اشتراط خبرة وظيفية. المشاركة لا تضمن التوظيف.',
    v_company_id, 'Active', now(),
    '{"market":"Open","channel":"Multi-channel","template_filter":"junior_accounting","nationality_restriction":false}'::jsonb
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
        when 'junior_accounting' then lower(coalesce(template.profession_category, '')) = 'junior accounting'
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
