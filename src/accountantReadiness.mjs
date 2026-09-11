export function readinessText(value, language = 'AR') {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  return value[language === 'EN' ? 'en' : 'ar'] || value.en || value.ar || '';
}

export function validateReadinessAnswers(task, answers, submit = false) {
  for (const field of task.definition.fields) {
    const value = answers[field.key];
    if (value == null || value === '') {
      if (submit) return 'required';
      continue;
    }
    if (field.type === 'number' && !/^[0-9]{1,9}(\.[0-9]{1,2})?$/.test(String(value))) return 'amount';
    if (field.type === 'select' && !field.options.some(o => o.value === value)) return 'required';
  }
  if ((answers.rationale || '').length > 2000) return 'explanation';
  if (submit && (answers.rationale || '').trim().length < 30) return 'explanation';
  return null;
}

export function readinessState(task) {
  const a = task.attempt;
  if (!a) return 'NotStarted';
  if (a.status !== 'Submitted') return 'Draft';
  if (a.review_status === 'Pending') return 'Pending';
  if (a.review_status === 'NeedsDevelopment' || a.objective_score < task.definition.threshold) return 'NeedsDevelopment';
  return 'Confirmed';
}

export function normalizeReadinessAmount(value) {
  return value.replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776)).replace(/٫/g, '.');
}
