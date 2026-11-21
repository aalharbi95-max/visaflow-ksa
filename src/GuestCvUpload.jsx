import { useRef, useState } from 'react';
import { getViteSupabaseConfig } from './supabaseConfig.mjs';
import './guestCvUpload.css';

export default function GuestCvUpload({ language }) {
  const ar = language === 'AR';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');
  const requestId = useRef(null);
  const text = (arabic, english) => ar ? arabic : english;
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const file = data.get('cv');
    setError('');
    if (!file?.size || file.size > 10 * 1024 * 1024 || !/\.(pdf|docx)$/i.test(file.name)) {
      setError(text('اختر ملف PDF أو DOCX بحجم لا يتجاوز 10 ميجابايت.', 'Choose a PDF or DOCX file up to 10 MB.'));
      return;
    }
    requestId.current ||= crypto.randomUUID();
    data.set('request_id', requestId.current);
    setBusy(true);
    try {
      const { url, publishableKey } = getViteSupabaseConfig();
      const response = await fetch(`${url}/functions/v1/visaflow-guest-cv`, {
        method: 'POST', headers: { apikey: publishableKey }, body: data,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.reference) {
        if (response.status === 429) throw new Error(text('وصلت إلى حد المحاولات. حاول مرة أخرى بعد ساعة.', 'Too many attempts. Please try again in an hour.'));
        throw new Error(text('تعذر إرسال السيرة. لم يتم تأكيد نشرها؛ حاول مرة أخرى.', 'We could not confirm publication. Please retry.'));
      }
      setReceipt(result.reference);
    } catch (failure) {
      setError(failure.message || text('تعذر الاتصال. حاول مرة أخرى.', 'Connection failed. Please retry.'));
    } finally { setBusy(false); }
  }
  return <section id="upload-cv" className="vf-public-section vf-guest-cv">
    <div className="vf-public-container">
      <div className="vf-public-section-heading">
        <span className="vf-public-kicker">{text('بدون تسجيل', 'No account needed')}</span>
        <h2>{text('ارفع سيرتك الذاتية', 'Upload your CV')}</h2>
        <p>{text('أدخل بياناتك وارفع سيرتك لتظهر للشركات المشتركة في سوق المواهب.', 'Add your details and CV to appear to subscribed companies in Talent Market.')}</p>
      </div>
      {receipt ? <div role="status" className="vf-guest-success">
        <h3>{text('تم نشر ملفك في سوق المواهب', 'Your profile is now in Talent Market')}</h3>
        <p>{text('رقم المتابعة:', 'Your reference:')} <strong dir="ltr">{receipt}</strong></p>
        <p>{text('احتفظ بالرقم لطلب تعديل بياناتك أو حذفها عبر دعم المنصة.', 'Keep this reference to request corrections or removal through platform support.')}</p>
      </div> : <form className="vf-guest-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          <div className="vf-guest-grid">
            <label>{text('الاسم الكامل', 'Full name')}<input name="full_name" required minLength={2} maxLength={160} autoComplete="name" /></label>
            <label>{text('البريد الإلكتروني', 'Email')}<input name="email" type="email" required maxLength={254} autoComplete="email" dir="ltr" /></label>
            <label>{text('رقم الجوال', 'Phone')}<input name="phone" type="tel" required maxLength={30} autoComplete="tel" dir="ltr" /></label>
            <label>{text('المهنة / التخصص', 'Profession / specialty')}<input name="profession" required maxLength={160} /></label>
            <label>{text('المدينة والدولة', 'City and country')}<input name="location" required maxLength={160} /></label>
            <label>{text('سنوات الخبرة', 'Years of experience')}<input name="years_experience" type="number" min="0" max="60" step="1" required /></label>
          </div>
          <label>{text('السيرة الذاتية — PDF أو DOCX، حتى 10 ميجابايت', 'CV — PDF or DOCX, up to 10 MB')}<input name="cv" type="file" accept=".pdf,.docx" required /></label>
          <label className="vf-guest-honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
          <label className="vf-guest-consent"><input name="consent" type="checkbox" value="yes" required /><span>{text('هذه سيرتي الذاتية وأوافق على نشر بياناتي وملف السيرة، بما فيه معلومات التواصل، للشركات المشتركة في سوق المواهب لأغراض التوظيف. يمكنني طلب الحذف عبر دعم المنصة.', 'This is my CV. I agree to share my profile, CV and contact details with subscribed Talent Market companies for recruitment. I can request removal through platform support.')}</span></label>
          <button type="submit" className="vf-public-primary">{busy ? text('جارٍ رفع السيرة…', 'Uploading…') : text('ارفع وانشر في سوق المواهب', 'Upload and publish to Talent Market')}</button>
        </fieldset>
        {error && <p role="alert" className="vf-guest-error">{error}</p>}
      </form>}
    </div>
  </section>;
}
