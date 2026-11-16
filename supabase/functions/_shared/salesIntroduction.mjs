// Only this fixed, versioned introduction may be sent automatically. AI drafts
// and pricing/custom-commitment approvals never enter the automatic sender.
export const SALES_INTRO_VERSION = 'visaflow-platform-introduction-ar-v1';
export const SALES_INTRO_SUBJECT = 'تعرّفوا على VisaFlow KSA لإدارة التوظيف والتأشيرات والقوى العاملة';
export function salesIntroduction(unsubscribeUrl) {
  const url = new URL(unsubscribeUrl);
  if (url.protocol !== 'https:') throw new Error('invalid_unsubscribe_url');
  return `السادة/ فريق الموارد البشرية والتشغيل المحترمين،
تحية طيبة،

أنا فيصل، مساعد المبيعات الآلي لمنصة VisaFlow KSA. نود تعريفكم بمنصة تجمع إجراءات التوظيف والتأشيرات ومتابعة القوى العاملة في مساحة عمل واحدة للشركة، بدلًا من تشتتها بين الملفات والمراسلات.

ماذا يمكنكم إدارةُه داخل المنصة؟

• طلبات القوى العاملة: تسجيل احتياجات الإدارات والمشروعات، تنظيم الطلبات ومتابعة مراحلها والموافقات المرتبطة بها.
• التأشيرات والتفويضات: متابعة مخزون التأشيرات وتخصيصها والتفويضات المرتبطة بطلبات التوظيف والوكالات.
• المرشحون والوكالات: تنظيم بيانات المرشحين والسير الذاتية، متابعة الترشيحات، والتنسيق مع وكالات التوظيف من خلال بوابات وصلاحيات مناسبة.
• المقابلات والتقييمات: تنظيم المقابلات البشرية والمقابلات المدعومة بالذكاء الاصطناعي، ومراجعة نتائج التقييم لدعم قرار فريقكم. القرار النهائي يبقى للأشخاص المخوّلين.
• الاستقدام والمباشرة: متابعة مراحل الإجراءات والتعبئة والسفر والوصول والانضمام إلى العمل، مع توثيق حالة كل مرشح أو موظف.
• الموظفون ودورة العمل: متابعة بيانات الموظفين وإجراءات انتهاء التكليف وإعادة التوزيع وفق إجراءات الشركة.
• السكن: تنظيم المواقع والغرف والإشغال ومتابعة جوانب السلامة والامتثال والتكاليف المرتبطة بالسكن ضمن وحدة إدارة السكن.
• التقارير والمتابعة: عرض مؤشرات التوظيف والأداء والمتابعات والتنبيهات، بما يساعد الإدارة على رؤية حالة العمل وتحديد الإجراءات المطلوبة.
• المساعدات الذكية: دعم فرق العمل في التلخيص والتحليل والمتابعة وتجهيز المعلومات، مع مراجعة بشرية للقرارات المهمة.
• الصلاحيات: فصل مساحات بيانات الشركات وتنظيم وصول المستخدمين بحسب أدوارهم داخل المنصة.

تختلف الوحدات وحدود الاستخدام المتاحة بحسب الاشتراك والتفعيل؛ نوضح النطاق المناسب لكم عند مناقشة احتياجاتكم، ولا تتضمن هذه الرسالة عرض سعر أو التزامًا تعاقديًا.

للتعرف على المنصة:
https://www.visaflowksa.com

إذا رغبتم في عرض توضيحي، يكفي الرد على هذه الرسالة مع اسم المسؤول والوقت المناسب للتواصل. وإذا احتجتم عرض سعر، أرسلوا نبذة عن احتياجاتكم والوحدات المطلوبة؛ وسيُراجع الطلب مالك المنصة ويعتمد العرض قبل إرساله إليكم.

مع خالص التحية،
فيصل — مساعد مبيعات VisaFlow KSA
التواصل مع مالك المنصة: adel@visaflowksa.com

لإيقاف الرسائل المستقبلية:
${url.href}`;
}

export function normalizeBusinessEmail(value) {
  const email=String(value||'').trim().toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email) || /[\r\n]/.test(email)) throw new Error('invalid_email');
  return email;
}

export function validateProspectSource(candidate, sourceText) {
  const email=normalizeBusinessEmail(candidate.email);
  if (!/^(info|contact|sales|marketing|office|admin|hr|business|bd|enquiries|inquiries|enquiry|inquiry|reception|support|procurement)([._-][a-z0-9]+)?$/.test(email.split('@')[0])) throw new Error('published_role_inbox_required');
  const website=new URL(candidate.website), source=new URL(candidate.source_url);
  const host=website.hostname.toLowerCase().replace(/^www\./,'');
  if (website.protocol!=='https:' || source.protocol!=='https:' || source.hostname.replace(/^www\./,'')!==host || email.split('@')[1]!==host) throw new Error('official_business_source_required');
  if (['gmail.com','outlook.com','hotmail.com','yahoo.com','icloud.com'].includes(host)) throw new Error('business_domain_required');
  const emails=String(sourceText).toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g)||[];
  if (!emails.includes(email)) throw new Error('email_not_published_on_source');
  const name=String(candidate.company_name||'').trim();
  if (!name || name.length>200) throw new Error('invalid_company_name');
  return {company_name:name,contact_email:email,website:website.origin,source_url:source.href,industry:String(candidate.industry||'').slice(0,200)};
}
