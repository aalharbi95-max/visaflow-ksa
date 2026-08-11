import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const messages = {
  ar: {
    appName: 'سكن', appSubtitle: 'إدارة السكنات', dashboard: 'لوحة التحكم', housing: 'السكنات', rooms: 'الغرف والأسرة', residents: 'المقيمون', allocations: 'التسكين والحركات', smartOccupancy: 'التسكين الذكي والإشغال', maintenance: 'الصيانة', inspections: 'التفتيش والنظافة', assets: 'الأصول والعهد', incidents: 'الحوادث والمخالفات', compliance: 'الامتثال والسلامة HSE', operations: 'الوجبات والمغاسل', welfare: 'رفاهية القاطنين', utilities: 'الكهرباء والمياه', contracts: 'العقود والمصروفات', reports: 'التقارير', settings: 'الإعدادات', testCenter: 'مركز الاختبار', main: 'الرئيسية', occupancyManagement: 'إدارة الإشغال', operationsGroup: 'التشغيل', financeReports: 'المالية والتقارير', system: 'النظام', quickSearch: 'بحث سريع...', newAssignment: 'تسكين جديد', addHousing: 'إضافة سكن', refresh: 'تحديث البيانات', loading: 'جاري تحميل البيانات...', save: 'حفظ', cancel: 'إلغاء', signIn: 'تسجيل الدخول', createAccount: 'إنشاء حساب', email: 'البريد الإلكتروني', password: 'كلمة المرور', fullName: 'الاسم الكامل', companyName: 'اسم الشركة', noAccount: 'ليس لديك حساب؟', haveAccount: 'لديك حساب بالفعل؟', welcome: 'مرحبًا بك', loginSubtitle: 'أدخل بياناتك للوصول إلى برنامج إدارة السكنات.', setupWorkspace: 'تهيئة مساحة العمل', language: 'English', logout: 'تسجيل الخروج', liveData: 'بيانات مباشرة من Supabase', loadError: 'تعذر تحميل بيانات النظام.', saved: 'تم الحفظ بنجاح', testData: 'إنشاء بيانات اختبار', testReady: 'النظام جاهز للاختبار', emptyData: 'لا توجد بيانات بعد', openMaps: 'فتح في Google Maps', legalCapacity: 'السعة النظامية', areaPerWorker: '4 م² لكل عامل', warningOnly: 'تنبيه دون منع', complianceAlerts: 'تنبيهات الامتثال', activeResidents: 'المقيمون حاليًا', availableBeds: 'الأسرة المتاحة', sitesCount: 'إجمالي السكنات', roomsCount: 'إجمالي الغرف', systemAdministrator: 'مدير النظام', statusActive: 'نشط', statusAvailable: 'متاح', statusFull: 'ممتلئ', statusOpen: 'مفتوح', noRecords: 'لا توجد سجلات', action: 'إجراء', details: 'التفاصيل', city: 'المدينة', project: 'المشروع', capacity: 'الطاقة الاستيعابية', occupied: 'المشغول', location: 'الموقع', name: 'الاسم', code: 'الرمز', latitude: 'خط العرض', longitude: 'خط الطول', address: 'العنوان', createWorkspace: 'إنشاء مساحة العمل', accountCreated: 'تم إنشاء الحساب. تحقق من بريدك الإلكتروني ثم سجل الدخول.', signInError: 'تعذر تسجيل الدخول. تحقق من البريد الإلكتروني وكلمة المرور.'
  },
  en: {
    appName: 'Sakan', appSubtitle: 'Housing Management', dashboard: 'Dashboard', housing: 'Housing Sites', rooms: 'Rooms & Beds', residents: 'Residents', allocations: 'Assignments & Movements', smartOccupancy: 'Smart Occupancy', maintenance: 'Maintenance', inspections: 'Inspections & Hygiene', assets: 'Assets', incidents: 'Incidents & Violations', compliance: 'Compliance & HSE', operations: 'Catering & Laundry', welfare: 'Resident Welfare', utilities: 'Electricity & Water', contracts: 'Contracts & Expenses', reports: 'Reports', settings: 'Settings', testCenter: 'Test Center', main: 'Main', occupancyManagement: 'Occupancy Management', operationsGroup: 'Operations', financeReports: 'Finance & Reports', system: 'System', quickSearch: 'Quick search...', newAssignment: 'New Assignment', addHousing: 'Add Housing', refresh: 'Refresh Data', loading: 'Loading data...', save: 'Save', cancel: 'Cancel', signIn: 'Sign In', createAccount: 'Create Account', email: 'Email', password: 'Password', fullName: 'Full Name', companyName: 'Company Name', noAccount: 'Don’t have an account?', haveAccount: 'Already have an account?', welcome: 'Welcome', loginSubtitle: 'Enter your details to access Housing Management.', setupWorkspace: 'Set Up Workspace', language: 'العربية', logout: 'Sign Out', liveData: 'Live data from Supabase', loadError: 'Unable to load system data.', saved: 'Saved successfully', testData: 'Create Test Data', testReady: 'System ready for testing', emptyData: 'No data yet', openMaps: 'Open in Google Maps', legalCapacity: 'Legal Capacity', areaPerWorker: '4 m² per worker', warningOnly: 'Warning without blocking', complianceAlerts: 'Compliance Alerts', activeResidents: 'Active Residents', availableBeds: 'Available Beds', sitesCount: 'Housing Sites', roomsCount: 'Rooms', systemAdministrator: 'System Administrator', statusActive: 'Active', statusAvailable: 'Available', statusFull: 'Full', statusOpen: 'Open', noRecords: 'No records', action: 'Action', details: 'Details', city: 'City', project: 'Project', capacity: 'Capacity', occupied: 'Occupied', location: 'Location', name: 'Name', code: 'Code', latitude: 'Latitude', longitude: 'Longitude', address: 'Address', createWorkspace: 'Create Workspace', accountCreated: 'Account created. Confirm your email, then sign in.', signInError: 'Unable to sign in. Check your email and password.'
  },
}

messages.ar.reconciliation = 'المطابقة والربط الذكي'
messages.en.reconciliation = 'Workforce Reconciliation'
messages.ar.employeeStatus = 'الإجازات والخروج ونهاية الخدمة'
messages.en.employeeStatus = 'Leave, Exit & End of Service'
messages.ar.notifications = 'الإشعارات متعددة القنوات'
messages.en.notifications = 'Multi-Channel Notifications'
messages.ar.costCenters = 'مراكز التكلفة والتخصيص اليومي'
messages.en.costCenters = 'Cost Centers & Daily Allocation'
messages.ar.offlineMode = 'وضع العمل دون إنترنت'
messages.en.offlineMode = 'Offline Work Mode'
messages.ar.inventory = 'المخزون وقطع الغيار'
messages.en.inventory = 'Inventory & Spare Parts'
messages.ar.securityGates = 'الأمن والبوابات'
messages.en.securityGates = 'Security & Gate Control'

const HousingLanguageContext = createContext(null)

export function HousingLanguageProvider({ children }) {
  const [language, setLanguageState] = useState(() => localStorage.getItem('housing-language') === 'en' ? 'en' : 'ar')
  const setLanguage = (next) => {
    const selected = next === 'en' ? 'en' : 'ar'
    localStorage.setItem('housing-language', selected)
    document.documentElement.lang = selected
    document.documentElement.dir = selected === 'ar' ? 'rtl' : 'ltr'
    setLanguageState(selected)
  }
  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
  }, [language])
  const value = useMemo(() => ({
    language,
    dir: language === 'ar' ? 'rtl' : 'ltr',
    locale: language === 'ar' ? 'ar-SA' : 'en-US',
    setLanguage,
    toggleLanguage: () => setLanguage(language === 'ar' ? 'en' : 'ar'),
    t(key, fallback) { return messages[language]?.[key] ?? fallback ?? key },
  }), [language])
  return <HousingLanguageContext.Provider value={value}>{children}</HousingLanguageContext.Provider>
}

export function useHousingLanguage() {
  const value = useContext(HousingLanguageContext)
  if (!value) throw new Error('HousingLanguageProvider is required.')
  return value
}
