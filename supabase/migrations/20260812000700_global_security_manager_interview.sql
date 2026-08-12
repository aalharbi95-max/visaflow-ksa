-- Global bilingual Security Manager interview template.
-- The template is attached to the existing VisaFlow global-template owner
-- because ai_interview_templates.company_id is intentionally non-null.

do $$
declare
  v_company_id uuid;
  v_template_id uuid;
begin
  select t.company_id
    into v_company_id
  from public.ai_interview_templates t
  where t.is_global = true
  order by t.created_at asc
  limit 1;

  if v_company_id is null then
    select c.id into v_company_id
    from public.companies c
    order by c.created_at asc
    limit 1;
  end if;

  if v_company_id is null then
    raise exception 'A company is required before seeding the Security Manager interview template.';
  end if;

  select t.id into v_template_id
  from public.ai_interview_templates t
  where t.company_id = v_company_id
    and t.template_name = 'Security Manager | مدير الأمن'
    and t.version = 1
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
      v_company_id,
      'Security Manager | مدير الأمن',
      'Security Manager | مدير الأمن',
      'Security & Safety',
      'Arabic / English',
      'Voice',
      'Recorded',
      'Optional',
      'Bilingual leadership interview for Security Managers responsible for physical security, access control, emergency response, investigations, guard-force operations and compliance.',
      'أجب بأمثلة واقعية ومختصرة، ووضح دورك الشخصي والنتيجة. Answer with concise real examples, your personal role and the measurable outcome.',
      'مرحباً بك في مقابلة مدير الأمن لدى VisaFlow. سنناقش القيادة، إدارة المخاطر، الاستجابة للحوادث والامتثال. Welcome to the VisaFlow Security Manager interview.',
      'شكراً لك. اكتملت المقابلة وستراجع النتائج من قبل فريق التوظيف. Thank you. Your interview is complete and will be reviewed by the recruitment team.',
      'أوافق على تسجيل وتحليل إجاباتي بالذكاء الاصطناعي لأغراض التقييم الوظيفي، مع بقاء القرار النهائي للبشر. I consent to recording and AI-assisted analysis for recruitment evaluation; the final decision remains human.',
      25, 10, 75, true, true, 1, false, 0, true, true,
      'Active', true, 'Ready Template', 10, 'Advanced', 'Generated',
      'Approved', 'Platform Owner', now(), true, true,
      'Platform Owner', 'Platform Owner',
      '{"framework":"Security Manager","version":"SEC-MGR-1","bilingual":true}'::jsonb,
      '["Security leadership","Risk assessment","Emergency response","Incident investigation","Access control","Compliance","Team management","Stakeholder communication"]'::jsonb,
      '["Develop security plans","Lead guard operations","Manage incidents","Coordinate emergency response","Investigate losses","Report security KPIs"]'::jsonb,
      '["Leadership","Decision making","De-escalation","CCTV and access control","Report writing","Crisis communication"]'::jsonb,
      '["Life safety first","Evidence preservation","Emergency escalation","Civil Defense coordination","Confidentiality"]'::jsonb
    ) returning id into v_template_id;
  else
    update public.ai_interview_templates set
      profession = 'Security Manager | مدير الأمن',
      profession_category = 'Security & Safety',
      language = 'Arabic / English',
      duration_minutes = 25,
      maximum_questions = 10,
      requested_question_count = 10,
      passing_score = 75,
      interview_difficulty = 'Advanced',
      status = 'Active',
      is_active = true,
      approval_status = 'Approved',
      approved_by = 'Platform Owner',
      approved_at = coalesce(approved_at, now()),
      is_locked = true,
      is_global = true,
      updated_by = 'Platform Owner',
      updated_at = now()
    where id = v_template_id;
  end if;

  delete from public.ai_interview_questions where template_id = v_template_id;

  insert into public.ai_interview_questions (
    company_id, template_id, question_order, question_text, question_text_ar,
    question_text_en, question_type, competency, difficulty_level, weight,
    maximum_answer_seconds, expected_keywords, key_points, scoring_guide,
    ideal_answer, recruiter_notes, allow_follow_up, maximum_follow_ups,
    is_required, is_active, source_type, is_ai_generated, approved_by,
    approved_at, is_locked, is_global, created_by, updated_by
  ) values
  (v_company_id,v_template_id,1,
   'عرّفنا بخبرتك في إدارة الأمن وحجم المواقع والفرق التي قدتها. / Describe your security management experience and the scale of sites and teams you led.',
   'عرّفنا بخبرتك في إدارة الأمن وحجم المواقع والفرق التي قدتها.',
   'Describe your security management experience and the scale of sites and teams you led.',
   'Experience','Security leadership','Medium',8,120,
   '["سنوات الخبرة","حجم الفريق","عدد المواقع","نطاق المسؤولية","team size","sites"]'::jsonb,
   '["Relevant leadership scope","Clear accountability","Measurable scale"]'::jsonb,
   '{"excellent":"Quantifies scope, responsibilities and outcomes","acceptable":"Relevant experience with reasonable detail","weak":"Generic answer without leadership evidence"}'::jsonb,
   'يوضح خبرة مباشرة في قيادة فرق الأمن عبر مواقع متعددة، مع أرقام ونتائج قابلة للقياس.','Confirm claimed scope during reference checks.',true,1,true,true,'Manual',false,'Platform Owner',now(),true,true,'Platform Owner','Platform Owner'),

  (v_company_id,v_template_id,2,
   'كيف تُجري تقييماً للمخاطر وتحوّله إلى خطة أمنية قابلة للتنفيذ؟ / How do you turn a security risk assessment into an actionable security plan?',
   'كيف تُجري تقييماً للمخاطر وتحوّله إلى خطة أمنية قابلة للتنفيذ؟',
   'How do you turn a security risk assessment into an actionable security plan?',
   'Technical','Risk assessment','Advanced',12,150,
   '["التهديدات","الاحتمالية","الأثر","الضوابط","خطة المعالجة","risk register","controls"]'::jsonb,
   '["Identify assets and threats","Score likelihood and impact","Assign controls and owners","Review residual risk"]'::jsonb,
   '{"excellent":"Presents a complete risk-based method with ownership and review","acceptable":"Covers threats, controls and action planning","weak":"Relies only on guard presence or intuition"}'::jsonb,
   'يحدد الأصول والتهديدات ونقاط الضعف، يقيم الاحتمال والأثر، ثم يضع ضوابط ومسؤوليات ومواعيد ومراجعة للمخاطر المتبقية.','Look for a repeatable method rather than personal intuition.',true,1,true,true,'Manual',false,'Platform Owner',now(),true,true,'Platform Owner','Platform Owner'),

  (v_company_id,v_template_id,3,
   'اذكر حادثاً أمنياً حرجاً قدته، وكيف حميت الأرواح واستعدت السيطرة؟ / Describe a critical security incident you led and how you protected life and restored control.',
   'اذكر حادثاً أمنياً حرجاً قدته، وكيف حميت الأرواح واستعدت السيطرة؟',
   'Describe a critical security incident you led and how you protected life and restored control.',
   'Behavioral','Emergency response','Advanced',12,180,
   '["سلامة الأرواح","البلاغ","العزل","التصعيد","مركز القيادة","توثيق","lessons learned"]'::jsonb,
   '["Life safety priority","Command and escalation","Coordination","Recovery and lessons learned"]'::jsonb,
   '{"excellent":"Uses a clear incident-command approach and measurable recovery","acceptable":"Explains safe escalation and coordination","weak":"Takes unsafe unilateral action or omits escalation"}'::jsonb,
   'يبدأ بحماية الأرواح والبلاغ والتصعيد، يعزل الموقع، ينسق مع الجهات المختصة، يحفظ الأدلة، ثم يوثق الدروس والإجراءات التصحيحية.','A safety-compromising answer is a critical concern.',true,1,true,true,'Manual',false,'Platform Owner',now(),true,true,'Platform Owner','Platform Owner'),

  (v_company_id,v_template_id,4,
   'كيف تصمم وتراقب منظومة التحكم بالدخول والزوار والمركبات وCCTV؟ / How would you design and monitor access control, visitors, vehicles and CCTV?',
   'كيف تصمم وتراقب منظومة التحكم بالدخول والزوار والمركبات وكاميرات المراقبة؟',
   'How would you design and monitor access control, visitors, vehicles and CCTV?',
   'Technical','Access control','Advanced',10,150,
   '["صلاحيات الدخول","الزوار","البوابات","CCTV","الاحتفاظ بالتسجيلات","audit trail","privacy"]'::jsonb,
   '["Role-based access","Visitor and vehicle logs","Coverage and retention","Audit and privacy controls"]'::jsonb,
   '{"excellent":"Integrates people, process, technology, audit and privacy","acceptable":"Covers core access and CCTV controls","weak":"Focuses on cameras only without governance"}'::jsonb,
   'يربط الصلاحيات بالوظائف، يطبق سجلات الزوار والمركبات والتصاريح، يراجع تغطية الكاميرات وفترات الحفظ ويضمن الخصوصية والتدقيق.','Check knowledge of both physical and information governance.',true,1,true,true,'Manual',false,'Platform Owner',now(),true,true,'Platform Owner','Platform Owner'),

  (v_company_id,v_template_id,5,
   'كيف تدير الحراس والورديات وتضمن الانضباط والجاهزية على مدار الساعة؟ / How do you manage guards and shifts while ensuring 24/7 discipline and readiness?',
   'كيف تدير الحراس والورديات وتضمن الانضباط والجاهزية على مدار الساعة؟',
   'How do you manage guards and shifts while ensuring 24/7 discipline and readiness?',
   'Behavioral','Team management','Advanced',10,150,
   '["تخطيط الورديات","نقاط الحراسة","التدريب","التفتيش","الغياب","handover","briefing"]'::jsonb,
   '["Risk-based staffing","Shift briefing and handover","Training and inspections","Absence coverage"]'::jsonb,
   '{"excellent":"Explains staffing, briefing, supervision, training and contingency coverage","acceptable":"Covers shifts and supervision","weak":"No readiness checks or contingency plan"}'::jsonb,
   'يحدد القوى حسب المخاطر، ينظم التسليم والاستلام والإحاطات، يتابع التدريب والجولات المفاجئة ويضع بدائل للغياب والطوارئ.','Assess leadership style and treatment of frontline staff.',true,1,true,true,'Manual',false,'Platform Owner',now(),true,true,'Platform Owner','Platform Owner'),

  (v_company_id,v_template_id,6,
   'كيف تحقق في سرقة أو فقد ممتلكات مع الحفاظ على الأدلة والسرية؟ / How do you investigate theft or asset loss while preserving evidence and confidentiality?',
   'كيف تحقق في سرقة أو فقد ممتلكات مع الحفاظ على الأدلة والسرية؟',
   'How do you investigate theft or asset loss while preserving evidence and confidentiality?',
   'Technical','Incident investigation','Advanced',10,150,
   '["مسرح الحادث","سلسلة الحيازة","CCTV","إفادات","سرية","chain of custody","root cause"]'::jsonb,
   '["Secure the scene","Preserve chain of custody","Collect objective evidence","Escalate legally","Root cause and corrective action"]'::jsonb,
   '{"excellent":"Preserves evidence and due process with documented chain of custody","acceptable":"Uses structured evidence collection and escalation","weak":"Accuses individuals before evidence or breaches confidentiality"}'::jsonb,
   'يعزل الموقع ويحفظ سلسلة حيازة الأدلة، يجمع التسجيلات والإفادات بموضوعية، ينسق مع الشؤون القانونية والجهات المختصة ويعالج السبب الجذري.','Reject answers involving coercion, public accusation or evidence tampering.',true,1,true,true,'Manual',false,'Platform Owner',now(),true,true,'Platform Owner','Platform Owner'),

  (v_company_id,v_template_id,7,
   'كيف تضمن الامتثال للأنظمة والتنسيق مع الشرطة والدفاع المدني والجهات الحكومية؟ / How do you ensure compliance and coordinate with Police, Civil Defense and government authorities?',
   'كيف تضمن الامتثال للأنظمة والتنسيق مع الشرطة والدفاع المدني والجهات الحكومية؟',
   'How do you ensure compliance and coordinate with Police, Civil Defense and government authorities?',
   'Safety','Compliance and authorities','Advanced',10,150,
   '["الأنظمة","التراخيص","الدفاع المدني","الشرطة","خطط الطوارئ","تمارين الإخلاء","compliance calendar"]'::jsonb,
   '["Regulatory register","License tracking","Emergency plans and drills","Documented authority coordination"]'::jsonb,
   '{"excellent":"Maintains a compliance calendar, evidence, drills and formal coordination","acceptable":"Understands licensing and authority engagement","weak":"Reactive coordination only after an incident"}'::jsonb,
   'ينشئ سجلاً للمتطلبات والتراخيص ومواعيد التجديد، يحفظ الأدلة، ينفذ التمارين ويحدد نقاط اتصال وإجراءات بلاغ واضحة مع الجهات.','Saudi-specific examples are useful but do not over-reward memorized regulation names.',true,1,true,true,'Manual',false,'Platform Owner',now(),true,true,'Platform Owner','Platform Owner'),

  (v_company_id,v_template_id,8,
   'كيف تتعامل مع شخص غاضب أو اشتباك عند البوابة دون تصعيد غير ضروري؟ / How do you handle an angry person or gate conflict without unnecessary escalation?',
   'كيف تتعامل مع شخص غاضب أو اشتباك عند البوابة دون تصعيد غير ضروري؟',
   'How do you handle an angry person or gate conflict without unnecessary escalation?',
   'Behavioral','De-escalation','Advanced',10,120,
   '["الهدوء","المسافة الآمنة","الاستماع","التعزيز","التصعيد المتدرج","de-escalation","proportional response"]'::jsonb,
   '["Maintain safety and distance","Calm communication","Proportionate escalation","Call support when thresholds are met"]'::jsonb,
   '{"excellent":"Uses calm, proportionate and policy-based de-escalation with clear thresholds","acceptable":"Prioritizes safety and requests support","weak":"Threatens, provokes or uses disproportionate force"}'::jsonb,
   'يحافظ على مسافة آمنة ونبرة هادئة، يستمع ويضع حدوداً واضحة، يستدعي الدعم وفق مستوى الخطر ويوثق الواقعة دون استخدام قوة غير متناسبة.','Any advocacy of unlawful or disproportionate force is disqualifying.',true,1,true,true,'Manual',false,'Platform Owner',now(),true,true,'Platform Owner','Platform Owner'),

  (v_company_id,v_template_id,9,
   'ما مؤشرات الأداء والتقارير التي تستخدمها لقياس فعالية الأمن؟ / Which KPIs and reports do you use to measure security effectiveness?',
   'ما مؤشرات الأداء والتقارير التي تستخدمها لقياس فعالية الأمن؟',
   'Which KPIs and reports do you use to measure security effectiveness?',
   'Technical','Security performance','Advanced',8,120,
   '["زمن الاستجابة","الحوادث","إغلاق الإجراءات","التغطية","التدريب","response time","trend analysis"]'::jsonb,
   '["Leading and lagging indicators","Trends by site and cause","Corrective-action closure","Management reporting"]'::jsonb,
   '{"excellent":"Balances leading and lagging KPIs and explains how data changes decisions","acceptable":"Provides relevant measurable KPIs","weak":"Counts guards or incidents without analysis"}'::jsonb,
   'يقيس زمن الاستجابة واتجاهات الحوادث والمخالفات والتغطية والتدريب وإغلاق الإجراءات التصحيحية، ويحلل الأسباب والمواقع ويرفع توصيات للإدارة.','Look for decision-useful metrics rather than vanity counts.',true,1,true,true,'Manual',false,'Platform Owner',now(),true,true,'Platform Owner','Platform Owner'),

  (v_company_id,v_template_id,10,
   'سيناريو: محاولة دخول غير مصرح تتزامن مع إنذار حريق. ما أولوياتك وخطواتك؟ / Scenario: an unauthorized entry occurs during a fire alarm. What are your priorities and actions?',
   'سيناريو: محاولة دخول غير مصرح تتزامن مع إنذار حريق. ما أولوياتك وخطواتك؟',
   'Scenario: an unauthorized entry occurs during a fire alarm. What are your priorities and actions?',
   'Safety','Crisis decision making','Expert',10,180,
   '["الأرواح أولاً","الإخلاء","تقسيم الأدوار","الاتصال بالطوارئ","منع الاستغلال","accountability","incident command"]'::jsonb,
   '["Life safety first","Activate emergency plan","Split resources without compromising evacuation","Coordinate authorities","Account for people and preserve evidence"]'::jsonb,
   '{"excellent":"Prioritizes life safety while delegating proportionate containment and coordination","acceptable":"Activates evacuation and calls emergency support with basic containment","weak":"Delays evacuation to pursue the intruder or ignores the security threat"}'::jsonb,
   'يفعّل خطة الحريق والإخلاء فوراً ويبلغ الطوارئ، يقسم الموارد تحت قيادة واضحة، يحمي مخارج الإخلاء ويمنع استغلال الفوضى دون تعطيل إنقاذ الأرواح، ثم يجري الحصر والتوثيق.','Life safety must remain the first priority.',true,1,true,true,'Manual',false,'Platform Owner',now(),true,true,'Platform Owner','Platform Owner');
end $$;
