// Release-owned task versions. Answer keys are server-side seed data; never import into src.
const field = (key, ar, en, weight, expected, options) => ({key, label:{ar,en}, weight, expected, type:options?'select':'number', ...(options?{options}: {})});
const option = (value, ar, en) => ({value,ar,en});
export const accountantTasks = [
  {
    code:'invoice-review-v1', version:1, skill:'invoice_review', title:{ar:'مراجعة الفواتير',en:'Invoice review'}, minutes:15,
    introduction:{ar:'راجع السجل الافتراضي أدناه. المبالغ بالريال ولا تتضمن ضرائب. المورد ورقم الفاتورة يحددان الفاتورة؛ تاريخ التسجيل وحده لا يثبت أنها فاتورة جديدة. المبلغ الأصلي مستند إلى الفاتورة المفترضة.',en:'Review this fictional register. Amounts are in SAR with no taxes. Supplier and invoice number identify an invoice; a posting date alone does not establish a new invoice. Source amounts come from the fictional source invoices.'},
    columns:{ar:['السطر','المورد','الفاتورة','المبلغ الأصلي','المبلغ المسجل'],en:['Row','Supplier','Invoice','Source amount','Posted amount']},
    rows:[['D1','Alpha','A101',1200,1200],['D2','Beta','B102',800,800],['D3','Beta','B102',800,800],['D4','Gamma','G103',650,560],['D5','Delta','D104',450,450]],
    fields:[
      field('duplicate','أي سطر يمثل التكرار الثاني؟','Which row is the duplicate occurrence?',25,'D3',['D1','D2','D3','D4','D5'].map(x=>option(x,x,x))),
      field('incorrect','أي سطر يحتوي مبلغًا مسجلًا مخالفًا للأصل؟','Which row has a posted amount different from its source?',25,'D4',['D1','D2','D3','D4','D5'].map(x=>option(x,x,x))),
      field('correct_amount','المبلغ الصحيح للسطر المخالف','Correct amount for the incorrect row',25,650),
      field('correct_total','إجمالي السجل بعد استبعاد التكرار وتصحيح المبلغ','Register total after excluding the duplicate and correcting the amount',25,3100),
    ],
    rationale:{ar:'اشرح كيف تتحقق من التكرار وكيف توثق التصحيح وتحصل على الموافقة دون حذف أثر العملية الأصلية.',en:'Explain how you verify the duplicate, document the correction and obtain approval while preserving the original audit trail.'},
    reviewer:{ar:'تحقق من الرجوع إلى المصدر ورقم الفاتورة والمورد، والحصول على موافقة التصحيح، والحفاظ على أثر المراجعة. لا تقبل حذف السجلات لإخفاء الخطأ.',en:'Look for source verification, supplier/invoice identity, correction approval and retained audit trail. Do not accept deletion to conceal the error.'},
    guidance:{ar:'راجع تحديد الفاتورة الفريدة، وطابق مبلغ السجل مع المصدر، ثم اجمع المبالغ مرة واحدة لكل فاتورة. وثّق أي تصحيح قبل اعتماده.',en:'Review unique invoice identification, compare posted amounts with sources and sum each invoice once. Document corrections before approval.'},
  },
  {
    code:'bank-reconciliation-v1', version:1, skill:'bank_reconciliation', title:{ar:'التسوية البنكية',en:'Bank reconciliation'}, minutes:20,
    introduction:{ar:'في نهاية الشهر: رصيد كشف البنك 10,850 ريال، ورصيد البنك في دفاتر المنشأة 10,000 ريال. لا توجد فروق أخرى غير الموضحة أدناه. احسب الرصيدين المعدلين واختر القيود المطلوبة في دفاتر المنشأة.',en:'At month end, the bank statement balance is SAR 10,850 and the ledger bank balance is SAR 10,000. There are no other differences beyond those below. Calculate adjusted balances and select the required ledger entries.'},
    columns:{ar:['البند','المبلغ','التفصيل'],en:['Item','Amount','Details']},
    rows:[
      [{ar:'إيداع بالطريق',en:'Deposit in transit'},1200,{ar:'مسجل في الدفاتر ولم يظهر بكشف البنك',en:'In ledger, absent from bank statement'}],
      [{ar:'شيك قائم',en:'Outstanding cheque'},800,{ar:'مسجل في الدفاتر ولم يصرفه المستفيد',en:'In ledger, not yet cleared'}],
      [{ar:'رسوم بنكية',en:'Bank fee'},50,{ar:'في كشف البنك فقط',en:'Bank statement only'}],
      [{ar:'إيراد فوائد',en:'Interest income'},100,{ar:'في كشف البنك فقط',en:'Bank statement only'}],
      [{ar:'تحصيل مديونية عميل',en:'Customer receivable collection'},1200,{ar:'في كشف البنك فقط؛ مديونية مثبتة سابقًا',en:'Bank statement only; receivable previously recorded'}],
    ],
    fields:[
      field('adjusted_bank','رصيد كشف البنك المعدل','Adjusted statement balance',25,11250),
      field('adjusted_books','رصيد الدفاتر المعدل','Adjusted ledger balance',25,11250),
      field('fee_entry','قيد الرسوم البنكية','Bank fee entry',15,'fee',[
        option('fee','مدين مصروف رسوم / دائن البنك — 50','Debit fee expense / credit bank — 50'),option('reverse','مدين البنك / دائن مصروف رسوم — 50','Debit bank / credit fee expense — 50'),option('none','لا قيد','No entry')]),
      field('interest_entry','قيد إيراد الفوائد','Interest income entry',15,'interest',[
        option('none','لا قيد','No entry'),option('reverse','مدين إيراد فوائد / دائن البنك — 100','Debit interest income / credit bank — 100'),option('interest','مدين البنك / دائن إيراد فوائد — 100','Debit bank / credit interest income — 100')]),
      field('collection_entry','قيد تحصيل مديونية العميل','Receivable collection entry',20,'receivable',[
        option('revenue','مدين البنك / دائن إيراد مبيعات — 1,200','Debit bank / credit sales revenue — 1,200'),option('receivable','مدين البنك / دائن العملاء — 1,200','Debit bank / credit receivables — 1,200'),option('none','لا قيد','No entry')]),
    ],
    rationale:{ar:'وضح طريقة التسوية، ولماذا لا تعيد تسجيل الإيداع بالطريق والشيك القائم في الدفاتر. ما المستندات التي تراجعها قبل اعتماد القيود؟',en:'Explain your reconciliation and why the deposit in transit and outstanding cheque are not posted again. Which evidence would you review before approving entries?'},
    reviewer:{ar:'راجع الفصل بين بنود التوقيت وقيود الدفاتر، وعدم تسجيل التحصيل إيرادًا مرة ثانية، ومطابقة الرصيدين مع المستندات والاعتماد.',en:'Check timing differences versus ledger entries, no double counting of revenue, and evidence-supported reconciliation and approval.'},
    guidance:{ar:'افصل فروق التوقيت عن البنود التي لم تسجلها المنشأة. عدّل كل رصيد من جانبه، ثم طابق الرصيدين وراجع أطراف القيود.',en:'Separate timing differences from unrecorded ledger items. Adjust each balance on its own side, reconcile and check debit/credit accounts.'},
  },
];
