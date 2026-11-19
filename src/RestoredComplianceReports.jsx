import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { loadComplianceReportData, buildComplianceSnapshot } from './complianceReportData.mjs';
import { localizedReportHtml, localizedAuditSheets } from './tawteenReportLocale.mjs';
import { writeTawteenPptx } from './tawteenMultilingualPptx.mjs';
import { BAND_NAMES } from './compliancePlanning.mjs';
import OccupationDecisionPanel from './OccupationDecisionPanel.jsx';
import './complianceExecutive.css';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const display = v => v == null ? 'غير محسوم / Unconfirmed' : String(v);
function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function workforceRows(snapshot) {
  const { people, saudiCount, simulation: s, activity } = snapshot;
  return [
    ['الموظفون النشطون / Active employees', people.length],
    ['السعوديون / Saudi employees', saudiCount],
    ['غير السعوديين / Non-Saudi employees', people.length - saudiCount],
    ['النسبة العددية / Headcount percentage', people.length ? `${(saudiCount / people.length * 100).toFixed(2)}%` : null],
    ['نشاط نطاقات / Nitaqat activity', activity?.name],
    ['حالة التقدير / Calculation status', s.status],
    ['الوحدات السعودية الموزونة / Weighted Saudi units', s.weightedSaudis],
    ['النسبة الموزونة / Weighted percentage', s.rate == null ? null : `${s.rate.toFixed(2)}%`],
    ['النطاق الحالي / Current band', s.bandIndex == null ? null : s.bandIndex < 0 ? 'الأحمر / Red' : BAND_NAMES[s.bandIndex]],
    ['النطاق المستهدف / Target band', BAND_NAMES[s.targetIndex]],
    ['التوظيف الإضافي / Additional hires', s.hires],
    ['تكلفة الرواتب الشهرية / Monthly salary cost', s.monthly],
    ['تكلفة الرواتب السنوية / Annual salary cost', s.annual],
  ];
}
const disclaimer = 'تقديرات تخطيطية داخلية، وليست نتيجة رسمية من قوى. النطاقات تستخدم منحنيات 2026 ونموذجًا لحظيًا؛ التكاليف رواتب فقط. / Internal planning estimates, not official Qiwa results. 2026 curves and instantaneous workforce model; salary costs only.';
function workforceHtml(snapshot) {
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>Saudi Workforce & Nitaqat</title><style>body{font:16px Arial;margin:32px;color:#123}td,th{padding:12px;border:1px solid #ccc}table{border-collapse:collapse;width:100%}</style><h1>تقرير السعودة ونطاقات / Saudi Workforce & Nitaqat</h1><p>${esc(snapshot.asOf)} · ${esc(snapshot.scope)}</p><p>${esc(disclaimer)}</p><p>${esc(snapshot.reviewReason)}</p><table>${workforceRows(snapshot).map(([k,v]) => `<tr><th>${esc(k)}</th><td>${esc(display(v))}</td></tr>`).join('')}</table></html>`;
}
async function workforcePptx(snapshot, filename) {
  const { default: Pptx } = await import('pptxgenjs');
  const pptx = new Pptx(); pptx.layout = 'LAYOUT_WIDE'; pptx.author = 'VisaFlow KSA';
  pptx.title = 'Saudi Workforce & Nitaqat';
  const rows = workforceRows(snapshot);
  for (let offset = 0; offset < rows.length; offset += 5) {
    const slide = pptx.addSlide(); slide.background = { color: 'F8FAFC' };
    slide.addText('السعودة ونطاقات / Saudi Workforce & Nitaqat', { x: .6, y: .4, w: 12, h: .6, fontSize: 24, fontFace: 'Arial', bold: true, color: '0F172A', align: 'right' });
    slide.addText(`${snapshot.asOf} · ${snapshot.scope}`, { x: .7, y: 1.1, w: 12, h: .35, fontSize: 12 });
    slide.addTable(rows.slice(offset, offset + 5).map(([k,v]) => [k, display(v)]), { x: .7, y: 1.7, w: 11.9, rowH: .68, fontSize: 13, fontFace: 'Arial', border: { pt: 1, color: 'CBD5E1' }, color: '0F172A', margin: .12 });
    slide.addText(`${snapshot.reviewReason}\n${disclaimer}`, { x: .7, y: 5.65, w: 11.9, h: 1.1, fontSize: 11, fontFace: 'Arial', align: 'right', breakLine: false });
  }
  await pptx.writeFile({ fileName: filename });
}

export default forwardRef(function RestoredComplianceReports({ client, companyId, templateId, occupationCatalog = [], currentRole }, ref) {
  const [state, setState] = useState({ companyId: null, data: null, error: '', loading: true });
  const [language, setLanguage] = useState('Arabic');
  const [mode, setMode] = useState('executive');
  const [format, setFormat] = useState('PowerPoint');
  const [project, setProject] = useState('');
  const [hireSalary, setHireSalary] = useState('4000');
  const [busy, setBusy] = useState(false);
  const [exportError, setExportError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setState({ companyId, data: null, error: '', loading: true }); setProject('');
    loadComplianceReportData(client, companyId).then(data => {
      data.entityScopeComplete = data.entityScopeComplete && ["Admin", "CEO", "Operations Manager", "Recruitment Manager"].includes(currentRole);
      if (!cancelled) setState({ companyId, data, error: '', loading: false });
    }).catch(error => { if (!cancelled) setState({ companyId, data: null, error: error.message, loading: false }); });
    return () => { cancelled = true; };
  }, [client, companyId, currentRole]);
  const snapshot = useMemo(() => state.data && state.companyId === companyId ? buildComplianceSnapshot({ ...state.data, occupationCatalog }, { project, hireSalary: hireSalary === '' ? null : Number(hireSalary) }) : null, [state, companyId, occupationCatalog, project, hireSalary]);
  const tawteen = templateId === 'tawteen_localization';
  const html = snapshot ? tawteen ? localizedReportHtml(snapshot.report, { language, mode, asOf: snapshot.asOf }) : workforceHtml(snapshot) : '';
  async function exportReport() {
    if (!snapshot || busy) return;
    // Open the print window synchronously so the browser does not block it after imports.
    const printWindow = format === 'PDF' ? window.open('', '_blank') : null;
    setBusy(true); setExportError('');
    const name = tawteen ? 'Tawteen_Occupation_Localization_Report' : 'Saudi_Workforce_Nitaqat_Report';
    try {
      if (format === 'PowerPoint') {
        if (tawteen) await writeTawteenPptx(`${name}.pptx`, { language, report_mode: mode, generated_date: snapshot.asOf, tawteen_localization: snapshot.report }, { loadPptxgen: () => import('pptxgenjs') });
        else await workforcePptx(snapshot, `${name}.pptx`);
      } else if (format === 'Excel') {
        const XLSX = await import('xlsx'); const book = XLSX.utils.book_new();
        if (tawteen) {
          for (const { name: sheet, rows } of localizedAuditSheets(snapshot.report, language)) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), sheet.slice(0,31));
        } else XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Metric', 'Value'], ...workforceRows(snapshot).map(([k,v]) => [k, display(v)]), ['Scope', snapshot.scope], ['As of', snapshot.asOf], ['Notes', `${snapshot.reviewReason} ${disclaimer}`]]), 'Nitaqat');
        XLSX.writeFile(book, `${name}.xlsx`);
      } else if (format === 'PDF') {
        if (!printWindow) throw new Error('اسمح بالنافذة المنبثقة للطباعة وحفظ PDF.');
        printWindow.document.write(html); printWindow.document.close(); printWindow.focus(); printWindow.print();
      } else download(html, `${name}.${format === 'Word' ? 'doc' : 'html'}`, format === 'Word' ? 'application/msword;charset=utf-8' : 'text/html;charset=utf-8');
    } catch (error) { printWindow?.close(); setExportError(error.message); }
    finally { setBusy(false); }
  }
  useImperativeHandle(ref, () => ({ exportReport }));
  if (state.loading || state.companyId !== companyId) return <p role="status">جارٍ تحميل بيانات التوطين ونطاقات…</p>;
  if (state.error) return <p role="alert">تعذر تجهيز التقرير: {state.error}</p>;
  return <section className="compliance-executive" dir="rtl">
    <h2>{tawteen ? 'تقرير توطين المهن والقرارات' : 'تقرير السعودة ونطاقات'}</h2>
    <p>{disclaimer}</p>
    <div className="ce-controls">
      {tawteen && <label>اللغة<select value={language} onChange={e => setLanguage(e.target.value)}>{['Arabic','English','Bilingual'].map(v => <option key={v}>{v}</option>)}</select></label>}
      {!tawteen && <p>التقرير بالعربية والإنجليزية / Bilingual report</p>}
      {tawteen && <label>التفاصيل<select value={mode} onChange={e => setMode(e.target.value)}><option value="executive">تنفيذي</option><option value="detailed">تفصيلي</option></select></label>}
      <label>المشروع<select value={project} onChange={e => setProject(e.target.value)}><option value="">كل بيانات الشركة المصرح بها</option>{[...new Set(state.data.employees.map(e => e.project_name).filter(Boolean))].sort().map(v => <option key={v}>{v}</option>)}</select></label>
      {!tawteen && <label>راتب التوظيف السعودي المفترض<input type="number" min="0" value={hireSalary} onChange={e => setHireSalary(e.target.value)} /></label>}
      <label>الصيغة<select value={format} onChange={e => setFormat(e.target.value)}>{['PowerPoint','Excel','Word','PDF','HTML'].map(v => <option key={v}>{v}</option>)}</select></label>
      <button type="button" disabled={!snapshot || busy} onClick={exportReport}>{busy ? 'جارٍ التصدير…' : `تصدير ${format}`}</button>
    </div>
    {exportError && <p role="alert">{exportError}</p>}
    <p>تاريخ التقرير: {snapshot?.asOf} · النطاق: {project || 'بيانات الشركة المصرح بها'}. المقتطف لا يثبت امتثال الكيان.</p>
    {!tawteen && <p>{snapshot?.reviewReason}</p>}
    <iframe title="معاينة التقرير" sandbox="" srcDoc={html} style={{ width: '100%', height: 650, border: '1px solid #cbd5e1', background: 'white' }} />
    {tawteen && snapshot && <OccupationDecisionPanel report={snapshot.report} />}
  </section>;
});
