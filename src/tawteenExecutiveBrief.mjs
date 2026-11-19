const rowKey = (row = {}) => String(row.decision_number || row.rule_code || row.id || "").trim();

function familyLabel(row = {}) {
  const domain = String(row.domain || "").trim().toLocaleLowerCase();
  if (String(row.decision_number || "") === "68098" || /relaxation|personal care/.test(domain)) return "مراكز الاسترخاء والعناية الشخصية";
  if (String(row.decision_number || "") === "103108" || domain === "accounting") return "المهن المحاسبية";
  if (String(row.decision_number || "") === "77050" || domain === "procurement") return "المشتريات";
  const text = `${row.domain || ""} ${row.scope_description || ""} ${(row.professions || []).map((item) => `${item.name || ""} ${item.code || ""}`).join(" ")}`.toLocaleLowerCase();
  const families = [];
  if (/محاسب|محاسبة|مراجع مالي|حسابات|مالية|account|finance/.test(text)) families.push("المالية والمحاسبة");
  if (/موارد بشرية|توظيف|علاقات الأفراد|مواهب|hr professional|human resource/.test(text)) families.push("الموارد البشرية");
  if (/مشتريات|توريد|مناقص|procurement|purchas/.test(text)) families.push("المشتريات والتوريد");
  if (/إدارة مشاريع|مدير مشروع|project management/.test(text)) families.push("إدارة المشاريع");
  if (/هندس|فني|صيانة|engineering|technician/.test(text)) families.push("الهندسة والصيانة");
  return families.slice(0, 2).join("، ") || String(row.domain || row.scope_description || "مهن مطابقة للموظفين").slice(0, 72);
}

function shortStatus(row = {}) {
  if (row.applicability?.state==='not_applicable') return 'لا ينطبق على المنشأة';
  if (row.calculationStatus==='NOT_DETERMINED' || row.eligibilityUnconfirmed) return 'أهلية غير مؤكدة — أكمل البيانات';
  if (row.scopeNeedsReview) return "يتطلب تأكيد النشاط والنطاق";
  if (row.applicabilityUnconfirmed) return "يتطلب مراجعة تصنيف المسمى";
  if (row.matchedCount < Number(row.threshold || 1)) return "أقل من حد التطبيق";
  if (Number(row.shortage || 0) > 0) return row.status === "upcoming" ? "فجوة عند السريان" : "فجوة حالية";
  if (row.requiredSaudiCount != null && Number(row.eligibleSaudiCount || 0) <= Number(row.requiredSaudiCount)) return "على الحد دون هامش";
  return "مغطى مبدئيًا";
}

export function buildTawteenExecutiveBrief(report = {}) {
  const current = (report.current || []).filter((row) => Number(row.matchedCount || 0) > 0);
  const upcoming = (report.upcoming || []).filter((row) => Number(row.matchedCount || 0) > 0);
  const historical = (report.historical || []).filter((row) => Number(row.matchedCount || 0) > 0);
  const relevantRows = [...current, ...upcoming];
  const byPriority = (rows) => [...rows].sort((a, b) => Number(b.shortage || 0) - Number(a.shortage || 0) || String(a.effective_from || "").localeCompare(String(b.effective_from || "")));
  const currentGaps = byPriority(current.filter((row) => !row.scopeNeedsReview && !row.applicabilityUnconfirmed && Number(row.shortage || 0) > 0));
  const upcomingGaps = [...upcoming.filter((row) => !row.scopeNeedsReview && !row.applicabilityUnconfirmed && Number(row.shortage || 0) > 0)]
    .sort((a, b) => String(a.effective_from || "").localeCompare(String(b.effective_from || "")));
  const needsReview = relevantRows.filter((row) => row.scopeNeedsReview || row.applicabilityUnconfirmed || row.eligibilityUnconfirmed);
  const salaryCases = relevantRows.filter((row) => (Number(row.saudiBelowSalaryCount || 0) > 0 || Number(row.saudiMissingSalaryCount || 0) > 0));
  const impactedKeys = new Set(relevantRows.map(rowKey).filter(Boolean));
  const families = [...new Set(relevantRows.map(familyLabel))];
  return {
    activeEmployeeCount: Number(report.activeEmployeeCount || 0),
    unmatchedEmployeeCount: Number(report.unmatchedEmployeeCount || 0),
    relevantRows,
    notApplicable: report.notApplicable || [],
    current,
    upcoming,
    historical,
    currentGaps,
    upcomingGaps,
    needsReview,
    salaryCases,
    pendingCurrentCount:current.filter(r=>r.shortage==null).length,
    pendingUpcomingCount:upcoming.filter(r=>r.shortage==null).length,
    impactedDecisionCount: impactedKeys.size,
    currentGapCount: currentGaps.length,
    upcomingGapCount: upcomingGaps.length,
    families,
    statusFor: shortStatus,
    categoryFor: familyLabel,
  };
}
