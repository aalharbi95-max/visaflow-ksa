import { useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { getViteHousingSupabaseConfig } from './housingSupabaseConfig.mjs'
import { housingRecoveryError, housingRecoveryRedirect, housingRecoveryUser, validateHousingPassword } from './housingPasswordRecovery.mjs'
import './housingPasswordRecovery.css'

export default function HousingPasswordRecovery() {
  const reset = window.location.pathname === '/housing/reset-password'
  const owner = new URLSearchParams(window.location.search).get('owner') === '1'
  const loginPath = owner ? '/housing-owner' : '/housing'
  const [hasRecoveryCallback] = useState(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1))
    return hash.get('type') === 'recovery' && Boolean(hash.get('access_token') && hash.get('refresh_token'))
  })
  // Isolate recovery tokens from the normal workspace session and localStorage.
  const [client] = useState(() => {
    const { url, publishableKey } = getViteHousingSupabaseConfig()
    return createClient(url, publishableKey, { auth: { storageKey: 'housing-password-recovery', persistSession: false, autoRefreshToken: false, detectSessionInUrl: reset, flowType: 'implicit' } })
  })
  const [phase, setPhase] = useState(reset ? (hasRecoveryCallback ? 'checking' : 'invalid') : 'request')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const proof = useRef(null)
  const saving = useRef(false)

  useEffect(() => {
    if (!reset || !hasRecoveryCallback) return
    let alive = true
    const timer = window.setTimeout(() => { if (alive && !proof.current) setPhase('invalid') }, 10000)
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (!alive) return
      const userId = housingRecoveryUser(event, session)
      if (userId) {
        proof.current = userId
        window.clearTimeout(timer)
        setPhase('reset')
        // Remove tokens and errors from the address bar after verification.
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
      } else if (event === 'SIGNED_OUT') {
        proof.current = null
        if (!saving.current) setPhase('invalid')
      }
    })
    client.auth.getSession().then(({ error: sessionError }) => {
      if (alive && sessionError && !proof.current) { window.clearTimeout(timer); setPhase('invalid') }
    }).catch(() => { if (alive) setPhase('invalid') })
    return () => { alive = false; window.clearTimeout(timer); data.subscription.unsubscribe() }
  }, [client, reset, hasRecoveryCallback])

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    setError(''); setMessage('')
    if (phase === 'reset') {
      const validation = validateHousingPassword(password, confirmation)
      if (validation) return setError(validation)
      if (!proof.current) return setPhase('invalid')
      setBusy(true); saving.current = true
      try {
        const { data, error: userError } = await client.auth.getUser()
        if (userError || data.user?.id !== proof.current) { proof.current = null; saving.current = false; setPhase('invalid'); return }
        const { error: updateError } = await client.auth.updateUser({ password })
        if (updateError) throw updateError
      } catch (cause) {
        setError(housingRecoveryError(cause)); saving.current = false; setBusy(false); return
      } finally {
        setBusy(false)
      }
      if (!proof.current) { saving.current = false; return }
      proof.current = null; setPassword(''); setConfirmation(''); setPhase('done')
      // Password update succeeded; cleanup failure must never imply it failed.
      try { await client.auth.signOut() } catch { /* recovery client is memory-only */ }
      saving.current = false
      return
    }
    setBusy(true)
    try {
      const { error: requestError } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: housingRecoveryRedirect(window.location.origin, owner) })
      if (requestError) throw requestError
      setMessage('إذا كان البريد مرتبطًا بحساب، سيصلك رابط تعيين كلمة مرور جديدة. راجع الوارد والبريد غير المرغوب فيه.')
    } catch (cause) { setError(housingRecoveryError(cause)) }
    finally { setBusy(false) }
  }

  return <main className="housing-recovery" dir="rtl"><section aria-labelledby="recovery-title">
    <div className="housing-recovery-brand">سكن</div>
    <h1 id="recovery-title">{phase === 'done' ? 'تم تغيير كلمة المرور' : reset ? 'تعيين كلمة مرور جديدة' : 'نسيت كلمة المرور؟'}</h1>
    {phase === 'checking' ? <p role="status">جاري التحقق من رابط الاستعادة...</p> : phase === 'invalid' ? <>
      <p role="alert">رابط الاستعادة غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا وافتح أحدث رسالة وصلتك.</p>
      <a className="housing-recovery-primary" href={`/housing/forgot-password${owner ? '?owner=1' : ''}`}>طلب رابط استعادة جديد</a>
    </> : phase === 'done' ? <p role="status">يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.</p> : <form onSubmit={submit}>
      {phase === 'request' ? <><p>أدخل بريد حسابك وسنرسل لك رابطًا لتعيين كلمة مرور جديدة.</p><label>البريد الإلكتروني<input type="email" autoComplete="email" required dir="ltr" value={email} onChange={e => setEmail(e.target.value)} /></label></> : <>
        <p>اختر كلمة مرور من 8 أحرف على الأقل وأعد كتابتها للتأكيد.</p>
        <label>كلمة المرور الجديدة<input type={showPassword ? 'text' : 'password'} required minLength={8} autoComplete="new-password" dir="ltr" value={password} onChange={e => setPassword(e.target.value)} /></label>
        <label>تأكيد كلمة المرور الجديدة<input type={showPassword ? 'text' : 'password'} required minLength={8} autoComplete="new-password" dir="ltr" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
        <label className="housing-recovery-show"><input type="checkbox" checked={showPassword} onChange={e => setShowPassword(e.target.checked)} />إظهار كلمة المرور</label>
      </>}
      {error && <p className="housing-recovery-error" role="alert">{error}</p>}
      {message && <p className="housing-recovery-message" role="status">{message}</p>}
      <button className="housing-recovery-primary" disabled={busy}>{busy ? 'جاري التنفيذ...' : phase === 'reset' ? 'حفظ كلمة المرور الجديدة' : 'إرسال رابط الاستعادة'}</button>
    </form>}
    <a className="housing-recovery-back" href={loginPath}>العودة إلى تسجيل الدخول</a>
  </section></main>
}
