import React, { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';

const BUCKET = 'request-shortlist-cvs';
export default function RequestShortlist({ supabase, companyId, request, lines, onClose }) {
  const [rows, setRows] = useState([]);
  const [files, setFiles] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [lineNo, setLineNo] = useState(String(lines[0]?.line_no || 1));
  const cvsInput = useRef(null);
  const listInput = useRef(null);
  const active = useRef(true);
  const running = useRef(false);
  async function load() {
    const { data, error } = await supabase.from('request_candidate_shortlists').select('*')
      .eq('company_id', companyId).eq('request_id', request.id).order('created_at');
    if (!active.current) return;
    if (error) setMessage(`Unable to load shortlist: ${error.message}`);
    else setRows(data || []);
  }
  useEffect(() => { active.current = true; load(); return () => { active.current = false; }; }, [companyId, request.id]);
  function readFiles(event) {
    const next = Array.from(event.target.files || []);
    setFiles(next);
    setMessage(`${next.length} CV file(s) selected. Import the candidate list or check the names below.`);
    setDrafts(next.map(file => ({ candidate_name: file.name.replace(/\.(pdf|docx?|rtf)$/i, '').replace(/[_-]+/g, ' '),
      cv_file_name: file.name, request_line_no: Number(lineNo), email: '', mobile: '', notes: '' })));
  }
  async function readList(event) {
    try {
      const file = event.target.files?.[0]; if (!file) return;
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const data = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: '' });
      const parsed = data.map(row => ({
        candidate_name: String(row['Candidate Name'] || row.Name || '').trim(),
        cv_file_name: String(row['CV File'] || '').trim(),
        request_line_no: Number(row['Line No'] || lineNo),
        email: String(row.Email || '').trim(), mobile: String(row.Mobile || '').trim(),
        notes: String(row.Notes || '').trim(),
      }));
      setDrafts(parsed); setMessage(`${parsed.length} candidate(s) ready for preview. Review names, lines and CV matches before saving.`);
    } catch (error) { setMessage(`Candidate list could not be read: ${error.message}`); }
    finally { if (listInput.current) listInput.current.value = ''; }
  }
  function editDraft(index, field, value) {
    setDrafts(current => current.map((row, i) => i === index ? { ...row, [field]: value } : row));
  }
  async function save() {
    if (running.current || !drafts.length) return;
    const invalid = drafts.find(row => !row.candidate_name.trim() || !lines.some(line => Number(line.line_no) === Number(row.request_line_no))
      || !files.some(file => file.name === row.cv_file_name));
    if (invalid) { setMessage(`Check candidate name, request line and selected CV file: ${invalid.cv_file_name || '(missing file name)'}`); return; }
    running.current = true; setBusy(true); setMessage('Saving shortlist…');
    let added = 0, skipped = 0; const failures = [];
    try {
      const known = await supabase.from('request_candidate_shortlists').select('cv_sha256,cv_storage_path')
        .eq('company_id', companyId);
      if (known.error) throw known.error;
      const stored = new Map((known.data || []).map(row => [row.cv_sha256, row.cv_storage_path]));
      const seen = new Set(rows.map(row => `${row.request_line_no}:${row.cv_sha256}`));
      for (const draft of drafts) {
        if (!active.current) throw new Error('Workspace changed. Stop and reopen the shortlist.');
        try {
          const file = files.find(item => item.name === draft.cv_file_name);
          const extension = file.name.split('.').pop().toLowerCase();
          if (!['pdf', 'doc', 'docx'].includes(extension) || file.size > 20971520) throw new Error('CV must be PDF/Word and no larger than 20 MB.');
          const bytes = await file.arrayBuffer();
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
          const key = `${draft.request_line_no}:${hash}`;
          if (seen.has(key)) { skipped++; continue; }
          let path = stored.get(hash) || `${companyId}/${hash}.${extension}`;
          if (!stored.has(hash)) {
            const mime = extension === 'pdf' ? 'application/pdf' : extension === 'doc' ? 'application/msword' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            const upload = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: mime });
            if (upload.error && !/already exists|duplicate/i.test(upload.error.message)) throw upload.error;
            stored.set(hash, path);
          }
          if (!active.current) throw new Error('Workspace changed. Reopen the shortlist.');
          const result = await supabase.from('request_candidate_shortlists').insert({
            company_id: companyId, request_id: request.id, request_line_no: Number(draft.request_line_no),
            profession: lines.find(line => Number(line.line_no) === Number(draft.request_line_no)).profession,
            candidate_name: draft.candidate_name.trim(), email: draft.email.trim(), mobile: draft.mobile.trim(),
            notes: draft.notes, cv_file_name: file.name, cv_sha256: hash, cv_storage_path: path,
          });
          if (result.error) { if (result.error.code === '23505') { skipped++; seen.add(key); continue; } throw result.error; }
          added++; seen.add(key);
          if (active.current) setMessage(`Saving shortlist: ${added} added, ${skipped} duplicates skipped…`);
        } catch (error) { failures.push(`${draft.candidate_name}: ${error.message}`); }
      }
      await load();
      if (active.current) {
        setMessage(`Saved: ${added} | Duplicates skipped: ${skipped} | Failed: ${failures.length}${failures.length ? ` — ${failures.join('; ')}` : ''}`);
        if (!failures.length) { setDrafts([]); setFiles([]); if (cvsInput.current) cvsInput.current.value = ''; }
      }
    } catch (error) { if (active.current) setMessage(error.message); }
    finally { running.current = false; if (active.current) setBusy(false); }
  }
  async function openCv(row) {
    const result = await supabase.storage.from(BUCKET).createSignedUrl(row.cv_storage_path, 300);
    if (result.error) return setMessage(`CV unavailable: ${result.error.message}`);
    window.open(result.data.signedUrl, '_blank', 'noopener,noreferrer');
  }
  const visible = rows.filter(row => Number(row.request_line_no) === Number(lineNo));
  return <section className="table-card" style={{ margin: '18px 0', border: '2px solid #2563eb' }}>
    <div className="actions-line" style={{ justifyContent: 'space-between' }}>
      <h2>Candidate Shortlist / قائمة الفرز — {request.request_no}</h2>
      <button disabled={busy} onClick={onClose}>Close Shortlist</button>
    </div>
    <p>{request.project_name} — Applicants for HR review. This list accepts multiple candidates before request approval. It does not change vacancies, approve offers or create operational candidate assignments.</p>
    <label>Request line / الوظيفة <select value={lineNo} onChange={event => setLineNo(event.target.value)} disabled={busy}>
      {lines.map(line => <option key={line.line_no} value={line.line_no}>{line.line_no}. {line.profession} — {rows.filter(row => Number(row.request_line_no) === Number(line.line_no)).length} candidate(s)</option>)}
    </select></label>
    <div className="actions-line" style={{ marginTop: 12 }}>
      <button disabled={busy} onClick={() => cvsInput.current?.click()}>Choose CV Files</button>
      <button disabled={busy || !files.length} onClick={() => listInput.current?.click()}>Import Candidate List</button>
      <button disabled={busy} onClick={load}>Refresh Shortlist</button>
      <input ref={cvsInput} type="file" multiple accept=".pdf,.doc,.docx" style={{ display: 'none' }} onChange={readFiles} />
      <input ref={listInput} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={readList} />
    </div>
    <p>Candidate list columns: Candidate Name, CV File, Line No, Email, Mobile, Notes. CV File must match a selected file name. Identity documents and hiring approval are not required for this review list.</p>
    {message && <p role="status">{message}</p>}
    {!!drafts.length && <>
      <h3>Preview — {drafts.length} candidate(s), {files.length} CV file(s)</h3>
      <table><thead><tr><th>Name</th><th>Line</th><th>CV File</th><th>Email</th><th>Review notes</th></tr></thead><tbody>
        {drafts.map((row, index) => <tr key={index}>
          <td><input aria-label={`Candidate name ${index + 1}`} value={row.candidate_name} onChange={event => editDraft(index, 'candidate_name', event.target.value)} /></td>
          <td>{row.request_line_no}</td><td>{row.cv_file_name}{!files.some(file => file.name === row.cv_file_name) && <strong> — Select this CV file</strong>}</td>
          <td>{row.email}</td><td>{row.notes}</td>
        </tr>)}
      </tbody></table>
      <button className="save-btn" disabled={busy} onClick={save}>{busy ? 'Saving Shortlist…' : 'Save Shortlist'}</button>
    </>}
    <h3>Saved shortlist — {visible.length} candidate(s) for this line</h3>
    <table><thead><tr><th>Name</th><th>Email / Mobile</th><th>Status</th><th>Notes</th><th>CV</th></tr></thead><tbody>
      {visible.map(row => <tr key={row.id}><td>{row.candidate_name}</td><td>{row.email}<br />{row.mobile}</td><td>{row.review_status}</td><td>{row.notes}</td><td><button onClick={() => openCv(row)}>View CV</button></td></tr>)}
    </tbody></table>
  </section>;
}
