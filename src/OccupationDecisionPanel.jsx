import { OPTION_LABELS, numberText, gapText } from './occupationReportPresentation.mjs';
export default function OccupationDecisionPanel({report}) {
  const rows=[...report.current,...report.upcoming].filter(r=>r.matchedCount);
  return <section dir="rtl" aria-label="قرارات مطلوبة من الإدارة">
    <h3>قرارات مطلوبة من الإدارة — Management Action Plan</h3>
    <p>الفجوة عند ثبات العدد ليست عدد التوظيف الإضافي. الخيارات مستقلة ولا تُجمع. التعيينات المفترضة مؤهلة بالكامل؛ لا تُعد أي خطة قرارًا بإنهاء خدمة أفراد.</p>
    {rows.map(r=><details key={r.rule_code} open={rows.length<=4}><summary>{r.domain||r.rule_code} · {numberText(r.localization_rate*100)}% · {r.effective_from}</summary>
      <p>إجمالي {r.matchedCount}؛ سعوديون {r.saudiCount}؛ غير سعوديين {r.nonSaudiCount}؛ رواتب مسجلة {r.recordedSalarySaudiCount}؛ مؤهلون للأجر {r.salaryQualifiedSaudiCount}؛ مؤهلون بالكامل {r.eligibleSaudiCount}؛ أهلية غير مؤكدة {r.unknownEligibilityCount}؛ الفجوة {gapText(r)}.</p>
      <p>المطلوب بالتقريب التنظيمي: {numberText(r.regulatoryRequired)}. الخطط تستهدف النسبة الفعلية كاملة دون نقص.</p>
      {(r.managementActions||[]).map((a,i)=><p key={'action'+i}>{a.priority}؛ {a.owner}؛ {a.affectedCount} موظف: {a.issue}. {a.action}</p>)}
      {r.applicability.reasons.map((reason,i)=><p key={i}>{reason}</p>)}
      {r.eligibilityUnconfirmed&&<p role="status">الامتثال غير مؤكد؛ أكمل الأجر المسجل والمؤهل والاعتماد قبل اعتماد النتيجة.</p>}
      <div className="ce-table"><table><thead><tr><th>الخيار</th><th>إضافي / إحلال / تخفيض / تصحيح</th><th>سعوديون / غير سعوديين بعد التنفيذ</th><th>المؤهلون / الإجمالي</th><th>النسبة المتوقعة</th><th>صافي الرواتب شهري / سنوي</th></tr></thead><tbody>{r.options.filter(o=>o.achieved).map(o=><tr key={o.kind}><td>{OPTION_LABELS[o.kind]}</td><td>{o.hires} / {o.replacements} / {o.reductions} / {o.corrections}</td><td>{o.projectedSaudi} / {o.projectedExpatriates}</td><td>{o.projectedEligible} / {o.projectedTotal}</td><td>{numberText(o.projectedRate)}%</td><td>{numberText(o.monthly)} / {numberText(o.annual)} ر.س</td></tr>)}</tbody></table></div>
      <p>التكلفة صافي تغير الرواتب فقط؛ وفر التخفيض مقدّر بمتوسط أجور غير السعوديين عند اكتمالها، دون تكاليف الخروج أو المزايا. الخيارات التي تغير حد انطباق القرار لا تعتمد تلقائيًا.</p>
      {r.options.filter(o=>!o.achieved).map(o=><p key={o.kind}>{OPTION_LABELS[o.kind]}: {o.reason}</p>)}
      <details><summary>مراجعة أهلية السعوديين</summary>{r.eligibility.filter(e=>e.state!=='eligible').map((e,i)=><p key={i}>{e.employee.name||e.employee.employee_name||'موظف'}: {[...e.missing,...e.reasons].join('، ')}</p>)}</details>
    </details>)}
    <h3>القرارات غير المنطبقة على المنشأة — Not Applicable Decisions</h3>
    {(report.notApplicable||[]).map(r=><details key={r.rule_code}><summary>{r.domain||r.rule_code} · {numberText(r.localization_rate*100)}% · {r.effective_from}</summary><p>{r.professions.map(p=>p.name||p.code).join('، ')}</p><p>{r.scope_description}</p>{(r.managementActions||[]).map((a,i)=><p key={'action'+i}>{a.priority}؛ {a.owner}؛ {a.affectedCount} موظف: {a.issue}. {a.action}</p>)}
      {r.applicability.reasons.map((x,i)=><p key={i}>{x}</p>)}{r.applicableAlternatives.map(a=><p key={a.rule_code}>القرار المنطبق: {a.rule_code} · {numberText(a.rate*100)}% من {a.effective_from}</p>)}<p>المرجع الرسمي: {/^https:\/\//.test(r.source_url||'')?<a href={r.source_url} target="_blank" rel="noreferrer">الدليل التنظيمي</a>:'غير متحقق'}</p></details>)}
  </section>;
}
