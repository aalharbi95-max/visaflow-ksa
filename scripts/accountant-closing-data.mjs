// Server-only answer keys. Never import this module into a production browser bundle.
const text=(ar,en)=>({ar,en});
const accounts=[
 ['1001','البنك','Bank'],['1200','العملاء','Accounts receivable'],['1300','إيجار مدفوع مقدمًا','Prepaid rent'],
 ['1400','المخزون','Inventory'],['2100','مصروفات مستحقة','Accrued expenses'],['2200','إيراد مؤجل / دفعات عملاء مقدمة','Deferred revenue / customer advances'],
 ['2300','الموردون','Accounts payable'],['3000','رأس المال','Capital'],['4000','إيراد خدمات','Service revenue'],
 ['5000','مصروف إيجار','Rent expense'],['5100','مصروف كهرباء','Electricity expense'],
].map(([value,ar,en])=>({value,ar,en}));
const direction=[{value:'up',ar:'زيادة',en:'Increase'},{value:'down',ar:'نقص',en:'Decrease'},{value:'same',ar:'لا تغير',en:'No change'}];
function variant(code,rent,utility,advance,collection){
 const prepaid=rent*11/12,profit=prepaid-utility-advance-collection,assets=prepaid-collection;
 const fields=[];
 const addEntry=(n,ar,en,dr,cr,amount)=>{
  fields.push({key:`e${n}_debit`,type:'select',label:text(`${n}. ${ar} — الحساب المدين`,`${n}. ${en} — debit account`),options:accounts,weight:6,expected:dr});
  fields.push({key:`e${n}_credit`,type:'select',label:text(`${n}. ${ar} — الحساب الدائن`,`${n}. ${en} — credit account`),options:accounts,weight:6,expected:cr});
  fields.push({key:`e${n}_amount`,type:'number',label:text(`${n}. مبلغ القيد التصحيحي / قيد التسوية`,`${n}. Correction / adjustment amount`),weight:8,expected:amount});
  fields.push({key:`e${n}_reason`,type:'text',label:text(`${n}. فسّر المعالجة وتوقيت الاعتراف وأثرها على الحسابات`,`${n}. Explain the treatment, recognition timing and account impact`),weight:0,minLength:60,maxLength:1200});
 };
 addEntry(1,'عقد الإيجار','Rent contract','1300','5000',prepaid);
 addEntry(2,'الكهرباء','Electricity','5100','2100',utility);
 addEntry(3,'المبلغ المقبوض قبل تقديم الخدمة','Cash received before service delivery','4000','2200',advance);
 addEntry(4,'تحصيل فاتورة سابقة','Collection of a prior invoice','4000','1200',collection);
 for(const [key,ar,en,value] of [['profit','صافي ربح أكتوبر','October net profit',profit],['assets','إجمالي الأصول','Total assets',assets]]){
  fields.push({key:`${key}_direction`,type:'select',label:text(`بعد القيود الأربعة، اتجاه التغير في ${ar} مقارنة بالدفاتر الحالية`,`After all four entries, direction of change in ${en} versus the current books`),options:direction,weight:5,expected:value>0?'up':value<0?'down':'same'});
  fields.push({key:`${key}_amount`,type:'number',label:text(`المقدار المطلق للتغير في ${ar}`,`Absolute amount of change in ${en}`),weight:5,expected:Math.abs(value)});
 }
 return {code,version:2,skill:'month_end_closing',title:text('إقفال أكتوبر — محاسب مبتدئ','October close — junior accountant'),minutes:35,
 introduction:text('أنت محاسب جديد في منشأة خدمات، ومطلوب إقفال 31 أكتوبر على أساس الاستحقاق. راجع المستندات والسجلات التالية وأنشئ قيد التصحيح أو التسوية لكل عملية كما هي مسجلة الآن. جميع المبالغ بالريال، والضرائب خارج نطاق الحالة. استخدم قيدًا صافيًا واحدًا لكل عملية؛ لا تعكس العملية كاملة ثم تعيد تسجيلها. كل عملية مستقلة ولا توجد فروق أخرى. حسابات قائمة الدخل لم تُقفل بعد.','You are a junior accountant closing 31 October on the accrual basis. Review the documents and current postings, then construct the correction or adjustment needed for each. All amounts are SAR; taxes are outside scope. Use one net correcting entry per transaction, not a full reversal and repost. Transactions are independent and there are no other differences. Income statement accounts have not yet been closed.'),
 columns:{ar:['المستند / العملية','الوقائع المثبتة','التسجيل الحالي'],en:['Document / transaction','Established facts','Current posting']},
 rows:[
 ['1',text(`عقد إيجار من 1 أكتوبر حتى 30 سبتمبر التالي. دُفع ${rent} مقدمًا لتغطية 12 شهرًا متساوية؛ لا توجد تأمينات أو خدمات إضافية.`,`Rent contract runs 1 October to the following 30 September. ${rent} paid upfront for 12 equal months; no deposits or additional services.`),text(`مدين مصروف إيجار ${rent} / دائن البنك ${rent}`,`Debit rent expense ${rent} / credit bank ${rent}`)],
 ['2',text(`فاتورة كهرباء ${utility} تخص استهلاك أكتوبر بالكامل، وصلت 5 نوفمبر قبل اعتماد إقفال أكتوبر. الاستهلاك مؤكد ولم تُدفع الفاتورة.`,`Electricity invoice ${utility}, entirely for October consumption, received 5 November before October close approval. Consumption is confirmed; invoice is unpaid.`),text('لم تُسجل أي عملية. استخدم حساب مصروفات مستحقة للالتزام.','No entry recorded. Use accrued expenses for the liability.')],
 ['3',text(`وصل ${advance} يوم 28 أكتوبر مقابل خدمات ستقدم بالكامل في نوفمبر. حتى 31 أكتوبر لم تقدم أي خدمة للعميل.`,`${advance} received on 28 October for services wholly scheduled for November. No service delivered by 31 October.`),text(`مدين البنك ${advance} / دائن إيراد خدمات ${advance}`,`Debit bank ${advance} / credit service revenue ${advance}`)],
 ['4',text(`تحصيل ${collection} من عميل مقابل فاتورة سبتمبر. إيراد الفاتورة ومديونية العميل سُجلا بصورة صحيحة في سبتمبر.`,`${collection} collected against a September invoice. Revenue and receivable were correctly recorded in September.`),text(`مدين البنك ${collection} / دائن إيراد خدمات ${collection}`,`Debit bank ${collection} / credit service revenue ${collection}`)],
 ],fields,
 rationale:text('موقف إضافي لا يدخل في حساب الأثر العددي أعلاه: وصل طلب شراء مسودة لصيانة بقيمة 3,000 ريال، وقال المشرف إن العمل «ربما اكتمل» في أكتوبر، ولا يوجد محضر إنجاز أو فاتورة. ما الأدلة التي تطلبها، وكيف تحدد فترة الاعتراف والالتزام؟ اشرح قرارك إذا ثبت الإنجاز قبل نهاية أكتوبر، وإذا لم يثبت. ثم وضح كيف تتحقق من توازن قيودك وأثرها قبل الاعتماد.','Additional scenario, excluded from the numerical impact above: a draft maintenance purchase order for SAR 3,000 arrives; a supervisor says the work "may have finished" in October. There is no completion report or invoice. What evidence do you request, and how do you determine recognition period and liability? Explain your decision if October completion is established and if it is not. Then explain how you verify balanced entries and their impact before approval.'),
 rationaleMinLength:180,
 reviewer:text('راجع تبرير كل قيد؛ صحة اختيارات الحسابات وحدها لا تكفي. يجب تفسير توزيع الإيجار على مدة الانتفاع، استحقاق الكهرباء رغم تأخر الفاتورة، التزام الخدمة قبل أدائها، وعدم تكرار الإيراد عند تحصيل مديونية سابقة. في الموقف الإضافي: اطلب أدلة الإنجاز والفترة والتكلفة والاعتماد؛ لا تثبت مصروفًا من مسودة شراء وحدها ولا تؤجل مصروفًا مؤكد الاستحقاق لمجرد غياب الفاتورة. تحقق من تفسير أثر القيود مجتمعة. دوّن الملاحظات لكل جزء، وأعد الحالة للتطوير إذا كان الشرح لا يدعم صحة المعالجة.','Review the explanation for every entry; correct account selections alone are insufficient. Require benefit-period allocation for rent, electricity accrual despite late invoicing, an obligation before service delivery, and no second revenue recognition on collection. For missing evidence, request completion, cutoff, amount and approval support; a draft order alone is insufficient, while confirmed accrued expense must not be deferred solely because an invoice is missing. Check the combined financial-statement impact and give section-specific feedback. Mark NeedsDevelopment when explanations do not support the treatment.'),
 guidance:text('راجع أساس الاستحقاق والتمييز بين المصروف والأصل، وبين الإيراد والالتزام. حلل كل عملية من التسجيل الحالي ثم اجمع أثر القيود على الربح والأصول، وراجع ملاحظات المراجع لكل جزء.','Review accrual accounting, expense versus asset, and revenue versus liability. Start each correction from the actual current posting, aggregate effects on profit and assets, and review section-specific human feedback.'),
 };
}
export const closingCases=[variant('accountant-close-v2-a',12000,900,4000,2500),variant('accountant-close-v2-b',6000,1400,7000,3500)];
