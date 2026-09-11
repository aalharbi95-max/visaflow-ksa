import { useState } from 'react'
import { Building2, Eye, EyeOff, Languages, LoaderCircle, LockKeyhole, Mail } from 'lucide-react'
import { useHousingLanguage } from './housingI18n.jsx'

export default function HousingAccess({ mode = 'login', busy, error, message, onLogin, onRegister, onRequest, onSetup, allowRegistration = false }) {
  const { language, dir, t, toggleLanguage } = useHousingLanguage()
  const [formMode, setFormMode] = useState(mode)
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState({ fullName: '', companyName: '', email: '', password: '', phone: '', plan: 'Standard', expectedUsers: 5, expectedSites: 1, notes: '' })
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const isSetup = formMode === 'setup'
  const isRegister = formMode === 'register'
  const isRequest = formMode === 'request'
  const enrollmentMode = allowRegistration ? 'register' : 'request'

  const submit = (event) => {
    event.preventDefault()
    if (isSetup) return onSetup?.({ fullName: form.fullName, companyName: form.companyName })
    if (isRegister) return onRegister?.(form)
    if (isRequest) return onRequest?.(form)
    return onLogin?.({ email: form.email, password: form.password })
  }

  return <main className="housing-access" dir={dir}>
    <button type="button" className="housing-language-floating" onClick={toggleLanguage}><Languages size={17} />{t('language')}</button>
    <section className="housing-access-visual">
      <div className="housing-access-brand"><span><Building2 size={27} /></span><div><strong>{t('appName')}</strong><small>{t('appSubtitle')}</small></div></div>
      <div className="housing-access-copy"><p>{language === 'ar' ? 'منصة تشغيلية موحّدة' : 'A unified operations platform'}</p><h1>{language === 'ar' ? <>إدارة السكنات<br />بوضوح وكفاءة.</> : <>Housing operations,<br />clear and efficient.</>}</h1><span>{language === 'ar' ? 'الإشغال، المقيمون، السلامة، العقود والفواتير في مكان واحد.' : 'Occupancy, residents, safety, contracts and bills in one place.'}</span></div>
      <div className="housing-access-stat"><strong>{language === 'ar' ? 'آمن ومستقل' : 'Secure and isolated'}</strong><span>{language === 'ar' ? 'بيانات السكنات معزولة بالكامل عن الأنظمة الأخرى.' : 'Housing data is fully isolated from other systems.'}</span></div>
    </section>
    <section className="housing-access-form-shell"><form className="housing-access-form" onSubmit={submit}>
      <div className="housing-access-mobile-brand"><Building2 size={24} /><strong>{t('appName')}</strong></div>
      <p className="housing-access-eyebrow">{t('welcome')}</p>
      <h2>{isSetup ? t('setupWorkspace') : isRegister ? t('createAccount') : isRequest ? (language === 'ar' ? 'طلب اشتراك جديد' : 'Request a Subscription') : t('signIn')}</h2>
      <span className="housing-access-subtitle">{isRequest ? (language === 'ar' ? 'أرسل طلب الشركة، وسيصلك رابط إنشاء الحساب بعد اعتماد مالك المنصة.' : 'Submit your company request. Account setup is available only after owner approval.') : isSetup ? (language === 'ar' ? 'أدخل بيانات الشركة لإكمال إعداد النظام.' : 'Enter company details to complete setup.') : t('loginSubtitle')}</span>
      {(isRegister || isRequest || isSetup) && <label><span>{t('fullName')}</span><div><input required value={form.fullName} onChange={update('fullName')} placeholder={t('fullName')} /></div></label>}
      {(isRegister || isRequest || isSetup) && <label><span>{t('companyName')}</span><div><Building2 size={17} /><input required value={form.companyName} onChange={update('companyName')} placeholder={t('companyName')} /></div></label>}
      {!isSetup && <label><span>{t('email')}</span><div><Mail size={17} /><input required type="email" value={form.email} onChange={update('email')} placeholder="name@company.com" /></div></label>}
      {(isRegister || (!isRequest && !isSetup)) && <label><span>{t('password')}</span><div><LockKeyhole size={17} /><input required minLength="8" type={showPassword ? 'text' : 'password'} value={form.password} onChange={update('password')} placeholder="••••••••" /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>}
      {isRequest && <>
        <label><span>{language === 'ar' ? 'رقم الجوال' : 'Mobile Number'}</span><div><input value={form.phone} onChange={update('phone')} placeholder="05xxxxxxxx" /></div></label>
        <label><span>{language === 'ar' ? 'الخطة المطلوبة' : 'Requested Plan'}</span><div><select value={form.plan} onChange={update('plan')}><option>Starter</option><option>Standard</option><option>Enterprise</option></select></div></label>
        <div className="housing-access-request-grid"><label><span>{language === 'ar' ? 'عدد المستخدمين المتوقع' : 'Expected Users'}</span><div><input type="number" min="1" value={form.expectedUsers} onChange={update('expectedUsers')} /></div></label><label><span>{language === 'ar' ? 'عدد السكنات المتوقع' : 'Expected Sites'}</span><div><input type="number" min="1" value={form.expectedSites} onChange={update('expectedSites')} /></div></label></div>
        <label><span>{language === 'ar' ? 'ملاحظات' : 'Notes'}</span><div><textarea rows="3" value={form.notes} onChange={update('notes')} /></div></label>
      </>}
      {error && <div className="housing-access-message error">{error}</div>}{message && <div className="housing-access-message">{message}</div>}
      <button className="housing-access-submit" disabled={busy}>{busy ? <LoaderCircle className="housing-spin" size={18} /> : null}{isSetup ? t('createWorkspace') : isRegister ? t('createAccount') : isRequest ? (language === 'ar' ? 'إرسال الطلب للمالك' : 'Send Request to Owner') : t('signIn')}</button>
      {!isSetup && <p className="housing-access-switch">{(isRegister || isRequest) ? t('haveAccount') : t('noAccount')}<button type="button" onClick={() => setFormMode((isRegister || isRequest) ? 'login' : enrollmentMode)}>{(isRegister || isRequest) ? t('signIn') : allowRegistration ? t('createAccount') : (language === 'ar' ? 'طلب اشتراك' : 'Request Subscription')}</button></p>}
      {!isSetup && <a className="housing-owner-link" href="/housing-owner">{language === 'ar' ? 'دخول مركز إدارة سكن' : 'Sakan Management Center Login'}</a>}
    </form></section>
  </main>
}
