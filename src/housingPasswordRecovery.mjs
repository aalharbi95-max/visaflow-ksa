export function housingRecoveryRedirect(origin, owner = false) {
  const url = new URL('/housing/reset-password', origin)
  if (owner) url.searchParams.set('owner', '1')
  return url.href
}

export function validateHousingPassword(password, confirmation) {
  if (password.length < 8) return 'استخدم كلمة مرور من 8 أحرف على الأقل.'
  if (password !== confirmation) return 'كلمتا المرور غير متطابقتين.'
  return ''
}

// A regular session or a URL flag is not evidence of a verified recovery link.
export function housingRecoveryUser(event, session) {
  return event === 'PASSWORD_RECOVERY' && session?.user?.id ? session.user.id : null
}

export function housingRecoveryError(error) {
  if (error?.status === 429 || /rate.limit|too many/i.test(error?.message || '')) return 'تم إرسال طلب مؤخرًا. انتظر دقيقة ثم حاول مرة أخرى.'
  if (error?.code === 'same_password') return 'اختر كلمة مرور مختلفة عن كلمة المرور السابقة.'
  if (error?.code === 'weak_password') return 'كلمة المرور ضعيفة. استخدم كلمة أطول تجمع حروفًا وأرقامًا ورموزًا.'
  return 'تعذر إكمال الطلب. تحقق من الاتصال وحاول مرة أخرى أو اطلب رابط استعادة جديدًا.'
}
