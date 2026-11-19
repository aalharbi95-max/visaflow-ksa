// Keep payroll observations separate from regulatory wage evidence.
export function normalizeSalary(raw) {
  if (raw == null || (typeof raw === 'string' && !raw.trim())) return { raw: raw ?? null, value: null, status: 'MISSING' };
  if (typeof raw !== 'number' && typeof raw !== 'string') return { raw, value: null, status: 'INVALID' };
  let text = String(raw).trim().replace(/[٠-٩]/g, d => String(d.charCodeAt(0)-1632)).replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-1776));
  text = text.replace(/^(SAR|ر\.س\.?|ريال سعودي|ريال)\s*/i,'').replace(/\s*(SAR|ر\.س\.?|ريال سعودي|ريال)$/i,'').trim().replace(/٫/g,'.').replace(/٬/g,',');
  // Reject ambiguous grouping, mixed units, negatives and exponential notation.
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) return {raw,value:null,status:'INVALID'};
  const value=Number(text.replace(/,/g,''));
  return {raw,value:Number.isFinite(value)?value:null,status:Number.isFinite(value)?'VALID':'INVALID'};
}
const aliases={
  monthly:['salary','monthly_salary','Monthly Salary','Salary','الراتب','الراتب الشهري'],
  basic:['basic_salary','base_salary','Basic Salary','الراتب الأساسي'],
  allowances:['allowances','Allowances','البدلات'],
  total:['total_salary','Total Salary','إجمالي الراتب'],
  gosi:['gosi_salary','GOSI Salary','أجر الاشتراك في التأمينات'],
};
export function salaryEvidence(employee) {
  employee={...(employee.salary_source_fields||{}),...employee};
  const fields=Object.fromEntries(Object.entries(aliases).map(([basis,names])=>{
    const observations=names.filter(n=>Object.hasOwn(employee,n)).map(field=>({field,...normalizeSalary(employee[field])}));
    const present=observations.filter(o=>o.status!=='MISSING');
    const conflict=new Set(present.filter(o=>o.status==='VALID').map(o=>o.value)).size>1;
    const selected=present[0]||observations[0]||normalizeSalary(null);
    return [basis,{...selected,observations,status:conflict?'CONFLICT':present.some(o=>o.status==='INVALID')?'INVALID':selected.status,value:conflict||present.some(o=>o.status==='INVALID')?null:selected.value}];
  }));
  const conflicts=Object.entries(fields).filter(([,v])=>v.status==='CONFLICT').map(([k])=>k);
  if (['basic','allowances','total'].every(k=>fields[k].status==='VALID') && Math.abs(fields.basic.value+fields.allowances.value-fields.total.value)>.01) conflicts.push('basic + allowances != total');
  return {fields,conflicts,hasRecordedSalary:Object.values(fields).some(v=>v.observations.some(o=>o.status==='VALID'))};
}
export function importedMonthlySalary(row) {
  const evidence=salaryEvidence(row), result=evidence.fields.monthly;
  if (['INVALID','CONFLICT'].includes(result.status)) throw new Error('Monthly Salary is invalid or conflicts with another salary field');
  return result.value;
}
export function originalSalaryFields(row) {
  return Object.fromEntries([...new Set(Object.values(aliases).flat())].filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]]));
}
