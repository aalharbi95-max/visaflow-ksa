import { useCallback, useEffect, useRef, useState } from 'react';
import { workspaceSupabase as supabase } from './supabase';
import './salesCommandCenter.css';

export default function SalesCommandCenterLazyPage({ companyId, currentRole }) {
  const [leads, setLeads] = useState([]), [approvals, setApprovals] = useState([]), [runs, setRuns] = useState([]);
  const [brief, setBrief] = useState(null), [selected, setSelected] = useState(''), [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [form, setForm] = useState({ company_name: '', industry: '', contact_name: '', contact_email: '', notes: '' });
  const generation = useRef(0);
  const canWork = ['Admin', 'Company Admin', 'Recruitment Manager', 'Recruitment Officer'].includes(currentRole);
  const canApprove = ['Admin', 'Company Admin', 'CEO', 'Recruitment Manager'].includes(currentRole);
  const canPrice = ['Admin', 'Company Admin', 'CEO'].includes(currentRole);
  const load = useCallback(async () => {
    const requestGeneration = ++generation.current;
    if (!companyId) return;
    const values = await Promise.all([
      supabase.from('sales_leads').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }).limit(200),
      supabase.from('sales_agent_approvals').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(100),
      supabase.from('sales_agent_runs').select('id,action,status,error_message,created_at').eq('company_id', companyId).order('created_at', { ascending: false }).limit(25),
    ]);
    if (requestGeneration !== generation.current) return;
    const failure = values.find(value => value.error);
    if (failure) throw new Error(failure.error.message);
    setLeads(values[0].data); setApprovals(values[1].data); setRuns(values[2].data);
  }, [companyId]);
  useEffect(() => {
    setLeads([]); setApprovals([]); setRuns([]); setBrief(null); setSelected(''); setReply(''); setError(''); setNotice('');
    load().catch(e => setError(e.message));
    return () => { generation.current += 1; };
  }, [load]);
  const perform = async operation => {
    setBusy(true); setError(''); setNotice('');
    try { await operation(); await load(); } catch (e) { setError(e.message || 'Operation failed'); } finally { setBusy(false); }
  };
  const run = action => perform(async () => {
    const { data, error: failure } = await supabase.functions.invoke('visaflow-sales-agent', { body: { action, company_id: companyId, lead_id: selected, reply_text: reply } });
    if (failure || !data?.ok) {
      let code = data?.error;
      if (!code && failure?.context?.json) { try { code = (await failure.context.json()).error; } catch { /* Use the transport message. */ } }
      throw new Error(code || failure?.message || 'Agent request failed');
    }
    if (action === 'daily_brief') setBrief(data.result);
    else { setNotice(action === 'draft_outreach' ? 'Draft saved · Pending approval. No email sent.' : 'Completed. Review the lead and audit history.'); if (action === 'classify_reply') setReply(''); }
  });
  const lead = leads.find(item => item.id === selected);
  if (!companyId) return <div className="table-card">Open an authenticated company workspace to use Faisal Sales Command Center.</div>;
  return <div className="sales-command-center">
    <div className="table-card"><div className="section-title-row"><div><h2>Faisal · Sales Command Center</h2><p>فيصل — مساعد المبيعات · Review first, every time</p></div><button disabled={busy} onClick={() => perform(load)}>Refresh</button></div>
      <p className="sales-safety">Draft-only MVP · All messages require approval. Approving records a decision; email delivery remains disabled.</p>
      {error && <p role="alert" className="sales-error">{error}</p>}{notice && <p role="status">{notice}</p>}
      <button disabled={busy} onClick={() => run('daily_brief')}>Generate Daily Brief</button>
      {brief && <><div className="stats-grid">{[['Active leads', brief.total_active_leads], ['Grade A · contactable', brief.grade_a_leads], ['Pending approvals', brief.pending_approvals], ['Replies today · Riyadh', brief.inbound_replies_today]].map(([label, value]) => <div className="stat-card" key={label}><h3>{label}</h3><strong>{value}</strong></div>)}</div><h3>Follow-ups due</h3>{brief.follow_ups_due.length ? <ul>{brief.follow_ups_due.map(item => <li key={item.id}>{item.company_name} · {new Date(item.next_follow_up_at).toLocaleString()}</li>)}</ul> : <p>No follow-ups due.</p>}</>}
    </div>
    {canWork && <form className="table-card" onSubmit={event => { event.preventDefault(); perform(async () => {
      const { error: failure } = await supabase.from('sales_leads').insert({ ...form, company_id: companyId });
      if (failure) throw failure; setForm({ company_name: '', industry: '', contact_name: '', contact_email: '', notes: '' }); setNotice('Lead added.');
    }); }}><h3>Add a lead</h3><div className="sales-fields">{Object.keys(form).map(key => <label key={key}>{key.replaceAll('_', ' ')}<input required={key === 'company_name'} type={key === 'contact_email' ? 'email' : 'text'} maxLength={key === 'notes' ? 6000 : 300} value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })} /></label>)}</div><button disabled={busy} type="submit">Add Lead</button></form>}
    <div className="table-card"><h3>Pipeline <small>Latest 200 leads</small></h3><div className="sales-table"><table><thead><tr><th>Company</th><th>Contact</th><th>Score / Grade</th><th>Stage</th><th>Contact policy</th></tr></thead><tbody>{leads.map(item => <tr key={item.id}><td><button aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); setReply(''); }}>{item.company_name}</button></td><td>{item.contact_email || 'No email'}</td><td>{item.lead_score} / {item.lead_grade}</td><td>{item.stage}</td><td>{item.do_not_contact ? 'Do Not Contact' : item.status}</td></tr>)}</tbody></table></div>{!leads.length && <p>No leads yet.</p>}</div>
    {lead && <div className="table-card"><h3>{lead.company_name}</h3><p>{lead.qualification_summary || 'Not scored yet.'}</p>{canWork && <><div className="actions"><button disabled={busy} onClick={() => run('qualify_lead')}>Score Lead</button><button disabled={busy || lead.do_not_contact || lead.status !== 'active'} onClick={() => run('draft_outreach')}>Draft Outreach</button><button disabled={busy || lead.do_not_contact} onClick={() => perform(async () => {
      const { error: failure } = await supabase.from('sales_leads').update({ do_not_contact: true }).eq('company_id', companyId).eq('id', lead.id); if (failure) throw failure;
    })}>Mark Do Not Contact</button></div><label>Received reply<textarea maxLength={12000} value={reply} onChange={event => setReply(event.target.value)} placeholder="Paste the prospect’s reply, including UNSUBSCRIBE requests" /></label><button disabled={busy || !reply.trim()} onClick={() => run('classify_reply')}>Classify Reply</button></>}</div>}
    <div className="table-card"><h3>Approval Queue <small>Latest 100 decisions and requests</small></h3>{!approvals.length && <p>No approvals yet.</p>}{approvals.map(item => <article className="sales-approval" key={item.id}><h4>{item.approval_type} · {item.status === 'pending' ? 'Pending approval' : item.status}</h4><p>{item.payload.to || leads.find(row => row.id === item.lead_id)?.company_name}</p><strong>{item.payload.subject}</strong><pre>{item.payload.body || item.payload.summary || item.payload.classification}</pre>{item.decided_by && <p>Decision by {item.decided_by} · {item.reason || 'No note'}</p>}{item.status === 'pending' && canApprove && (['SEND_OUTREACH', 'SEND_FOLLOW_UP'].includes(item.approval_type) || canPrice) && <div className="actions">{['approved', 'rejected'].map(decision => <button key={decision} disabled={busy} onClick={() => perform(async () => {
      const { error: failure } = await supabase.rpc('sales_decide_approval', { p_approval_id: item.id, p_decision: decision, p_reason: 'Reviewed in Sales Command Center' }); if (failure) throw failure; setNotice('Decision recorded. Email delivery is disabled.');
    })}>{decision === 'approved' ? 'Approve · record only' : 'Reject'}</button>)}</div>}</article>)}</div>
    <div className="table-card"><h3>Agent audit · Latest 25 runs</h3>{runs.map(item => <p key={item.id}>{new Date(item.created_at).toLocaleString()} · {item.action} · {item.status}{item.error_message ? ` · ${item.error_message}` : ''}</p>)}</div>
  </div>;
}
