const params = new URLSearchParams(location.hash.slice(1));
const token = params.get('token'), project = params.get('project');
const button = document.getElementById('confirm'), message = document.getElementById('message');
// Read the token only from the fragment; it is never sent to frontend access logs.
history.replaceState(null, '', location.pathname);
if (!/^[a-f0-9]{64}$/.test(token || '') || !['zeocbftriydodzfgixjv', 'iijhdilfzndqlguefipn'].includes(project)) {
  message.textContent = 'الرابط غير صالح. استخدم رابط إلغاء الاشتراك الموجود في الرسالة.';
} else {
  button.disabled = false;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const response = await fetch(`https://${project}.supabase.co/functions/v1/visaflow-sales-unsubscribe?token=${token}`, { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error('unsubscribe_failed');
      message.textContent = 'تم إيقاف الرسائل. لن تُدرجوا في رسائل فيصل المستقبلية.';
      button.hidden = true;
    } catch {
      message.textContent = 'تعذر إيقاف الرسائل الآن. يرجى المحاولة مرة أخرى.';
      button.disabled = false;
    }
  });
}
