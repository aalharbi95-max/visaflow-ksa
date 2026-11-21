import { useEffect, useState } from 'react';

export default function OwnerGuestCvStats({ client }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let running = false;
    async function refresh() {
      if (running) return;
      running = true;
      if (active) setBusy(true);
      try {
        const { data, error: failure } = await client.rpc('get_owner_guest_cv_stats');
        if (failure || !data || !['total', 'today', 'last_7_days'].every(key => Number.isFinite(Number(data[key])))) throw Error('Unavailable');
        if (active) { setStats(data); setError(false); }
      } catch { if (active) setError(true); }
      finally { running = false; if (active) setBusy(false); }
    }
    refresh();
    const timer = setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [client, revision]);
  return <section className="table-card" aria-label="Guest CV upload counter" style={{ marginBottom: 20 }}>
    <div className="section-title-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
      <div><h2>السير المضافة بدون تسجيل · Guest CV uploads</h2><p className="muted">Successful homepage uploads · عمليات الرفع الناجحة من الصفحة الرئيسية</p></div>
      <button type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}>{busy ? 'جارٍ التحديث… · Updating…' : 'تحديث · Refresh'}</button>
    </div>
    <div className="stats-grid" aria-live="polite" aria-busy={busy}>
      {[['total', 'الإجمالي · Total'], ['today', 'اليوم · Today'], ['last_7_days', 'آخر ٧ أيام · Last 7 days']].map(([key, label]) =>
        <div className="stat-card" key={key}><h3>{label}</h3><strong>{stats ? Number(stats[key]).toLocaleString('en-US') : '—'}</strong></div>)}
    </div>
    {error && <p role="alert">تعذر تحديث العدد. الأرقام السابقة، إن ظهرت، قديمة. · Could not refresh counts; previous values may be outdated.</p>}
    <p className="muted">تحديث تلقائي كل دقيقة · Auto-refresh every minute. الأيام بتوقيت الرياض · Days use Riyadh time.</p>
  </section>;
}
