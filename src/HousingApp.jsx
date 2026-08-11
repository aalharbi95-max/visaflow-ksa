import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  BarChart3,
  BedDouble,
  Bell,
  Building2,
  CalendarDays,
  CheckCircle2,
  CloudOff,
  ChevronLeft,
  ClipboardCheck,
  Clock3,
  Droplets,
  FileText,
  Filter,
  Home,
  LayoutDashboard,
  Landmark,
  Languages,
  LoaderCircle,
  LogOut,
  MapPin,
  Menu,
  MoreHorizontal,
  Package,
  Plus,
  Search,
  RefreshCw,
  Settings,
  ShieldCheck,
  UserPlus,
  Users,
  Wallet,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import "./housing.css";
import { hasViteHousingSupabaseConfig } from "./housingSupabaseConfig.mjs";
import { getHousingSupabaseClient } from "./housingSupabase.js";
import HousingAccess from "./HousingAccess";
import {
  AssetsPage,
  ContractsPage,
  IncidentsPage,
  InspectionsPage,
  MaintenancePage,
  ReportsPage,
} from "./HousingModules";
import { HousingSettingsPage } from "./HousingSettingsPage.jsx";
import {
  CateringLaundryPage,
  ComplianceDashboard,
  SmartOccupancyPage,
  WelfarePage,
} from "./HousingAdvancedModules";
import { googleMapsUrl } from "./housingCompliance.mjs";
import { HousingLanguageProvider, useHousingLanguage } from "./housingI18n.jsx";
import { useHousingWorkspaceData } from "./useHousingWorkspaceData.js";
import HousingTestCenter from "./HousingTestCenter.jsx";
import HousingReconciliationPage from "./HousingReconciliationPage.jsx";
import HousingEmployeeStatusPage from "./HousingEmployeeStatusPage.jsx";
import HousingNotificationsPage from "./HousingNotificationsPage.jsx";
import HousingCostCentersPage from "./HousingCostCentersPage.jsx";
import HousingOfflinePage from "./HousingOfflinePage.jsx";
import { LiveAddHousingModal, LiveAllocations, LiveDashboard, LiveDataTable, LiveHousingList, LiveUtilities } from "./HousingLiveViews.jsx";

const navGroups = [
  {
    labelKey: "main",
    items: [{ id: "dashboard", labelKey: "dashboard", icon: LayoutDashboard }],
  },
  {
    labelKey: "occupancyManagement",
    items: [
      { id: "housing", labelKey: "housing", icon: Building2 },
      { id: "rooms", labelKey: "rooms", icon: BedDouble },
      { id: "residents", labelKey: "residents", icon: Users },
      { id: "allocations", labelKey: "allocations", icon: ArrowRightLeft },
      { id: "reconciliation", labelKey: "reconciliation", icon: FileText },
      { id: "employee-status", labelKey: "employeeStatus", icon: CalendarDays },
      { id: "smart-occupancy", labelKey: "smartOccupancy", icon: BedDouble },
    ],
  },
  {
    labelKey: "operationsGroup",
    items: [
      { id: "maintenance", labelKey: "maintenance", icon: Wrench },
      { id: "inspections", labelKey: "inspections", icon: ClipboardCheck },
      { id: "assets", labelKey: "assets", icon: Package },
      { id: "incidents", labelKey: "incidents", icon: ShieldCheck },
      { id: "compliance", labelKey: "compliance", icon: ShieldCheck },
      { id: "operations", labelKey: "operations", icon: Clock3 },
      { id: "welfare", labelKey: "welfare", icon: Users },
      { id: "utilities", labelKey: "utilities", icon: Zap },
    ],
  },
  {
    labelKey: "financeReports",
    items: [
      { id: "contracts", labelKey: "contracts", icon: Wallet },
      { id: "cost-centers", labelKey: "costCenters", icon: Landmark },
      { id: "reports", labelKey: "reports", icon: BarChart3 },
    ],
  },
  { labelKey: "system", items: [{ id: "notifications", labelKey: "notifications", icon: Bell }, { id: "offline", labelKey: "offlineMode", icon: CloudOff }, { id: "test-center", labelKey: "testCenter", icon: CheckCircle2 }, { id: "settings", labelKey: "settings", icon: Settings }] },
];

const ROLE_PAGE_ACCESS = {
  Admin: null,
  "Housing Manager": ["dashboard","housing","rooms","residents","allocations","reconciliation","employee-status","smart-occupancy","maintenance","inspections","assets","incidents","compliance","operations","welfare","utilities","contracts","cost-centers","reports","notifications","offline","settings","test-center"],
  "Housing Supervisor": ["dashboard","housing","rooms","residents","allocations","reconciliation","employee-status","smart-occupancy","maintenance","inspections","assets","incidents","compliance","operations","welfare","reports","notifications","offline","settings","test-center"],
  Maintenance: ["dashboard","housing","rooms","maintenance","assets","reports","notifications","offline","settings"],
  Finance: ["dashboard","housing","utilities","contracts","cost-centers","reports","notifications","settings"],
  Viewer: ["dashboard","housing","rooms","residents","reconciliation","employee-status","smart-occupancy","maintenance","inspections","assets","incidents","compliance","operations","welfare","utilities","contracts","cost-centers","reports","notifications","settings"],
};

const pageMeta = {
  dashboard: ["لوحة التحكم", "نظرة شاملة على السكنات والإشغال والتشغيل"],
  housing: ["إدارة السكنات", "متابعة المواقع والمباني والطاقة الاستيعابية"],
  rooms: ["الغرف والأسرة", "إدارة جاهزية الغرف وحالة كل سرير"],
  residents: ["المقيمون", "بيانات الموظفين ومواقع سكنهم الحالية"],
  allocations: ["التسكين والحركات", "تسكين ونقل وإخلاء الموظفين بسجل موحد"],
  "smart-occupancy": ["التسكين الذكي والإشغال اللحظي", "مطابقة المشروع والوردية واللغة مع السعة القانونية للغرفة"],
  maintenance: ["طلبات الصيانة", "متابعة الأعطال والأولويات وأوقات الإنجاز"],
  inspections: ["التفتيش والنظافة", "الجولات الدورية والملاحظات والإجراءات التصحيحية"],
  assets: ["الأصول والعهد", "جرد الأثاث والأجهزة وحالتها"],
  incidents: ["الحوادث والمخالفات", "توثيق الحوادث والمخالفات والإجراءات المتخذة"],
  compliance: ["لوحة الامتثال والسلامة", "التراخيص، اشتراطات الطاقة القانونية وفحوصات HSE الأسبوعية"],
  operations: ["تشغيل الوجبات والمغاسل", "جدولة الدفعات حسب الطاقة التشغيلية لمنع الازدحام"],
  welfare: ["رفاهية وسلوكيات القاطنين", "الجزاءات والمخالفات واستبيانات الرضا متعددة اللغات"],
  utilities: ["الكهرباء والمياه", "الفواتير والاستهلاك والتنبيهات لكل سكن"],
  contracts: ["العقود والمصروفات", "الإيجارات والتكاليف ومواعيد الاستحقاق"],
  reports: ["التقارير", "تقارير تشغيلية ومالية قابلة للتصدير"],
  settings: ["الإعدادات", "المستخدمون والصلاحيات والبيانات الأساسية"],
  "test-center": ["مركز الاختبار الكامل", "إنشاء بيانات اختبار وتشغيل سيناريو التسكين والتنبيهات على قاعدة البيانات الفعلية"],
};

pageMeta.reconciliation = ["المطابقة والربط الذكي", "مطابقة قوائم الموارد البشرية والبصمة مع المقيمين واكتشاف التسكين الوهمي"];
pageMeta["employee-status"] = ["الإجازات والخروج ونهاية الخدمة", "تنبيهات حالة العامل وقرارات الإخلاء وإتاحة الأسرة بعد اعتماد المشرف"];
pageMeta.notifications = ["الإشعارات متعددة القنوات", "تنبيهات داخل المنصة والبريد وSMS وWhatsApp مع سجل إرسال كامل"];
pageMeta["cost-centers"] = ["مراكز التكلفة والتخصيص اليومي", "توزيع تكلفة السكن على العامل والمشروع ومركز التكلفة حسب أيام الإقامة الفعلية"];
pageMeta.offline = ["وضع العمل دون إنترنت", "حفظ العمليات الميدانية محلياً ومزامنتها تلقائياً عند عودة الاتصال"];

const pageMetaEn = {
  dashboard: ["Dashboard", "A complete view of housing, occupancy and operations"],
  housing: ["Housing Sites", "Manage locations, coordinates and capacity"],
  rooms: ["Rooms & Beds", "Room readiness, area and bed availability"],
  residents: ["Residents", "Active residents and their current accommodation"],
  allocations: ["Assignments & Movements", "Check-in, transfer and check-out history"],
  "smart-occupancy": ["Smart Occupancy", "Match project, shift and language with legal room capacity"],
  maintenance: ["Maintenance", "Requests, priorities and completion tracking"],
  inspections: ["Inspections & Hygiene", "Routine checks, findings and corrective actions"],
  assets: ["Assets", "Furniture and equipment inventory"],
  incidents: ["Incidents & Violations", "Incidents, penalties and worker-linked actions"],
  compliance: ["Compliance & HSE", "Licenses, 4 m² alerts and weekly HSE checks"],
  operations: ["Catering & Laundry", "Capacity-based operational scheduling"],
  welfare: ["Resident Welfare", "Violations and multilingual satisfaction surveys"],
  utilities: ["Electricity & Water", "Bills, consumption and account alerts"],
  contracts: ["Contracts & Expenses", "Leases, costs and due dates"],
  reports: ["Reports", "Exportable operational and financial reporting"],
  settings: ["Settings", "Users, roles and master data"],
  "test-center": ["Full Test Center", "Create safe test data and run live database workflows"],
};

pageMetaEn.reconciliation = ["Workforce Reconciliation", "Match HR and biometric lists with residents and detect ghost occupancy"];
pageMetaEn["employee-status"] = ["Leave, Exit & End of Service", "Employee status alerts and supervisor-approved checkout decisions"];
pageMetaEn.notifications = ["Multi-Channel Notifications", "In-app, email, SMS and WhatsApp alerts with a complete delivery log"];
pageMetaEn["cost-centers"] = ["Cost Centers & Daily Allocation", "Allocate housing cost to workers, projects and cost centers by actual occupied days"];
pageMetaEn.offline = ["Offline Work Mode", "Store field work locally and sync automatically when connectivity returns"];

const housings = [
  { id: "H-001", name: "سكن النخيل", city: "الرياض", project: "مشروع المترو", manager: "أحمد الغامدي", capacity: 240, occupied: 218, status: "نشط", color: "teal", latitude: 24.7136, longitude: 46.6753 },
  { id: "H-002", name: "سكن الروضة", city: "جدة", project: "مشروع الواجهة", manager: "خالد العتيبي", capacity: 180, occupied: 172, status: "شبه ممتلئ", color: "amber", latitude: 21.5433, longitude: 39.1728 },
  { id: "H-003", name: "سكن الواحة", city: "الدمام", project: "مشروع الميناء", manager: "محمد الشهري", capacity: 320, occupied: 246, status: "نشط", color: "blue", latitude: 26.4207, longitude: 50.0888 },
  { id: "H-004", name: "سكن اليرموك", city: "الرياض", project: "مشروع المطار", manager: "عمر الحربي", capacity: 150, occupied: 150, status: "ممتلئ", color: "rose", latitude: 24.7743, longitude: 46.7386 },
];

const residents = [
  { id: "EMP-10482", name: "عبدالله محمد", initials: "عم", nationality: "السعودية", job: "مشرف موقع", project: "مشروع المترو", housing: "سكن النخيل", room: "A-204", bed: "03", joined: "12 يوليو 2026", status: "مسكن" },
  { id: "EMP-10479", name: "Ravi Kumar", initials: "RK", nationality: "الهند", job: "فني كهرباء", project: "مشروع المترو", housing: "سكن النخيل", room: "B-112", bed: "02", joined: "10 يوليو 2026", status: "مسكن" },
  { id: "EMP-10471", name: "محمد إسماعيل", initials: "مإ", nationality: "مصر", job: "فني تكييف", project: "مشروع الواجهة", housing: "سكن الروضة", room: "C-306", bed: "01", joined: "08 يوليو 2026", status: "مسكن" },
  { id: "EMP-10466", name: "Arjun Singh", initials: "AS", nationality: "الهند", job: "عامل", project: "مشروع الميناء", housing: "—", room: "—", bed: "—", joined: "06 يوليو 2026", status: "بانتظار التسكين" },
  { id: "EMP-10458", name: "ناصر القحطاني", initials: "نق", nationality: "السعودية", job: "مسؤول سلامة", project: "مشروع المطار", housing: "سكن اليرموك", room: "A-105", bed: "01", joined: "03 يوليو 2026", status: "مسكن" },
];

const rooms = [
  { number: "A-204", housing: "سكن النخيل", floor: "الطابق الثاني", type: "رباعية", capacity: 4, occupied: 3, state: "متاحة" },
  { number: "B-112", housing: "سكن النخيل", floor: "الطابق الأول", type: "سداسية", capacity: 6, occupied: 6, state: "ممتلئة" },
  { number: "C-306", housing: "سكن الروضة", floor: "الطابق الثالث", type: "رباعية", capacity: 4, occupied: 4, state: "ممتلئة" },
  { number: "A-108", housing: "سكن الواحة", floor: "الطابق الأول", type: "رباعية", capacity: 4, occupied: 2, state: "متاحة" },
  { number: "D-220", housing: "سكن الواحة", floor: "الطابق الثاني", type: "سداسية", capacity: 6, occupied: 0, state: "صيانة" },
];

const activities = [
  { icon: UserPlus, tone: "green", title: "تم تسكين 12 موظفًا", detail: "سكن النخيل · المبنى A", time: "منذ 18 دقيقة" },
  { icon: ArrowRightLeft, tone: "blue", title: "نقل موظف إلى غرفة جديدة", detail: "من B-108 إلى B-112", time: "منذ ساعة" },
  { icon: Wrench, tone: "amber", title: "تم فتح بلاغ صيانة", detail: "سكن الواحة · الغرفة D-220", time: "منذ ساعتين" },
  { icon: CheckCircle2, tone: "green", title: "اكتملت جولة التفتيش", detail: "سكن الروضة · التقييم 92%", time: "منذ 4 ساعات" },
];

function MetricCard({ icon: Icon, label, value, detail, tone, progress }) {
  return (
    <article className="housing-metric-card">
      <div className={`housing-icon-box ${tone}`}><Icon size={21} /></div>
      <div className="housing-metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      {typeof progress === "number" && (
        <div className="housing-mini-progress"><i style={{ width: `${progress}%` }} /></div>
      )}
    </article>
  );
}

function Status({ children, tone = "green" }) {
  return <span className={`housing-status ${tone}`}><i />{children}</span>;
}

function Dashboard({ goTo }) {
  return (
    <>
      <section className="housing-metrics-grid">
        <MetricCard icon={Building2} label="إجمالي السكنات" value="12" detail="10 نشطة · 2 تحت التجهيز" tone="blue" />
        <MetricCard icon={BedDouble} label="الطاقة الاستيعابية" value="2,480" detail="2,126 سريرًا مشغولًا" tone="purple" progress={86} />
        <MetricCard icon={Users} label="المقيمون حاليًا" value="2,126" detail="+38 خلال هذا الشهر" tone="green" />
        <MetricCard icon={AlertTriangle} label="تحتاج إلى إجراء" value="17" detail="8 صيانة · 6 عقود · 3 تفتيش" tone="amber" />
      </section>

      <section className="housing-dashboard-grid">
        <article className="housing-panel housing-occupancy-panel">
          <div className="housing-panel-head">
            <div><h2>الإشغال حسب السكن</h2><p>نسبة الأسرة المشغولة من إجمالي الطاقة</p></div>
            <button className="housing-text-button" onClick={() => goTo("housing")}>عرض الكل <ChevronLeft size={16} /></button>
          </div>
          <div className="housing-occupancy-list">
            {housings.map((item) => {
              const percentage = Math.round((item.occupied / item.capacity) * 100);
              return (
                <div className="housing-occupancy-row" key={item.id}>
                  <div className={`housing-building-avatar ${item.color}`}><Building2 size={19} /></div>
                  <div className="housing-occupancy-info">
                    <div><strong>{item.name}</strong><span>{item.city} · {item.project}</span></div>
                    <div className="housing-progress"><i className={percentage >= 95 ? "danger" : percentage >= 90 ? "warning" : ""} style={{ width: `${percentage}%` }} /></div>
                  </div>
                  <div className="housing-occupancy-value"><strong>{percentage}%</strong><span>{item.occupied}/{item.capacity}</span></div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="housing-panel housing-activity-panel">
          <div className="housing-panel-head"><div><h2>آخر الحركات</h2><p>آخر التحديثات المسجلة في النظام</p></div></div>
          <div className="housing-activity-list">
            {activities.map(({ icon: Icon, tone, title, detail, time }) => (
              <div className="housing-activity" key={title}>
                <div className={`housing-activity-icon ${tone}`}><Icon size={17} /></div>
                <div><strong>{title}</strong><span>{detail}</span></div>
                <time>{time}</time>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="housing-bottom-grid">
        <article className="housing-panel">
          <div className="housing-panel-head"><div><h2>مؤشرات التشغيل</h2><p>ملخص أداء الشهر الحالي</p></div></div>
          <div className="housing-kpi-row">
            <div><span>متوسط الإشغال</span><strong>85.7%</strong><em>+3.2%</em></div>
            <div><span>جاهزية الغرف</span><strong>96.4%</strong><em>+1.8%</em></div>
            <div><span>إغلاق الصيانة</span><strong>91%</strong><em className="down">-2.1%</em></div>
            <div><span>تقييم النظافة</span><strong>94%</strong><em>+4.5%</em></div>
          </div>
        </article>
        <article className="housing-panel housing-alert-card">
          <div className="housing-panel-head"><div><h2>تنبيهات قريبة</h2><p>تحتاج إلى متابعة خلال 30 يومًا</p></div></div>
          <div className="housing-alert-row"><CalendarDays size={18} /><span><strong>3 عقود إيجار</strong> تنتهي قريبًا</span><b>عرض</b></div>
          <div className="housing-alert-row"><Zap size={18} /><span><strong>فاتورتان</strong> تجاوزتا موعد السداد</span><b>عرض</b></div>
        </article>
      </section>
    </>
  );
}

function HousingList({ onAdd }) {
  const [query, setQuery] = useState("");
  const filtered = housings.filter((item) => `${item.name} ${item.city} ${item.project}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <section className="housing-panel housing-list-panel">
      <div className="housing-toolbar">
        <div className="housing-search housing-search-wide"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث باسم السكن أو المدينة أو المشروع" /></div>
        <button className="housing-secondary-button"><Filter size={17} /> تصفية</button>
        <button className="housing-primary-button" onClick={onAdd}><Plus size={18} /> إضافة سكن</button>
      </div>
      <div className="housing-cards-grid">
        {filtered.map((item) => {
          const percentage = Math.round(item.occupied / item.capacity * 100);
          return (
            <article className="housing-property-card" key={item.id}>
              <div className={`housing-property-cover ${item.color}`}>
                <Building2 size={31} />
                <Status tone={percentage === 100 ? "red" : percentage >= 90 ? "amber" : "green"}>{item.status}</Status>
                <button aria-label="المزيد"><MoreHorizontal size={20} /></button>
              </div>
              <div className="housing-property-body">
                <div className="housing-property-title"><div><h3>{item.name}</h3><span>{item.id}</span></div><strong>{percentage}%<small> إشغال</small></strong></div>
                <p><MapPin size={15} /> {item.city} · {item.project}</p>
                <a className="housing-map-link" href={googleMapsUrl(item.latitude, item.longitude)} target="_blank" rel="noreferrer"><MapPin size={15} /> فتح الإحداثيات في Google Maps</a>
                <div className="housing-progress"><i className={percentage >= 95 ? "danger" : percentage >= 90 ? "warning" : ""} style={{ width: `${percentage}%` }} /></div>
                <div className="housing-property-stats"><span><BedDouble size={16} /><b>{item.occupied}</b> مشغول</span><span><Home size={16} /><b>{item.capacity - item.occupied}</b> متاح</span></div>
                <footer><span>المشرف: <b>{item.manager}</b></span><button>عرض التفاصيل <ChevronLeft size={15} /></button></footer>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function DataTable({ type }) {
  const isRooms = type === "rooms";
  const [query, setQuery] = useState("");
  const rows = isRooms ? rooms : residents;
  const filtered = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query.toLowerCase()));
  return (
    <section className="housing-panel housing-table-panel">
      <div className="housing-toolbar">
        <div className="housing-search housing-search-wide"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={isRooms ? "ابحث برقم الغرفة أو السكن" : "ابحث بالاسم أو الرقم الوظيفي"} /></div>
        <button className="housing-secondary-button"><Filter size={17} /> تصفية</button>
        <button className="housing-primary-button"><Plus size={18} /> {isRooms ? "إضافة غرفة" : "إضافة مقيم"}</button>
      </div>
      <div className="housing-table-wrap">
        <table>
          <thead><tr>{isRooms ? <><th>الغرفة</th><th>السكن</th><th>الطابق</th><th>النوع</th><th>الإشغال</th><th>الحالة</th><th /></> : <><th>المقيم</th><th>المهنة والمشروع</th><th>السكن الحالي</th><th>الغرفة / السرير</th><th>تاريخ التسكين</th><th>الحالة</th><th /></>}</tr></thead>
          <tbody>
            {filtered.map((row) => isRooms ? (
              <tr key={row.number}><td><strong>{row.number}</strong></td><td>{row.housing}</td><td>{row.floor}</td><td>{row.type}</td><td><div className="housing-bed-count"><b>{row.occupied}/{row.capacity}</b><div className="housing-progress"><i style={{ width: `${row.occupied / row.capacity * 100}%` }} /></div></div></td><td><Status tone={row.state === "صيانة" ? "red" : row.state === "ممتلئة" ? "amber" : "green"}>{row.state}</Status></td><td><button className="housing-icon-button"><MoreHorizontal size={18} /></button></td></tr>
            ) : (
              <tr key={row.id}><td><div className="housing-person"><span>{row.initials}</span><div><strong>{row.name}</strong><small>{row.id} · {row.nationality}</small></div></div></td><td><strong>{row.job}</strong><small className="housing-table-sub">{row.project}</small></td><td>{row.housing}</td><td><strong>{row.room}</strong><small className="housing-table-sub">سرير {row.bed}</small></td><td>{row.joined}</td><td><Status tone={row.status === "مسكن" ? "green" : "amber"}>{row.status}</Status></td><td><button className="housing-icon-button"><MoreHorizontal size={18} /></button></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="housing-pagination"><span>عرض {filtered.length} من {rows.length} سجلات</span><div><button disabled>السابق</button><button className="active">1</button><button>التالي</button></div></div>
    </section>
  );
}

function Allocations() {
  return (
    <>
      <section className="housing-action-grid">
        <button><span className="green"><UserPlus size={23} /></span><div><strong>تسكين جديد</strong><small>تعيين موظف إلى سرير متاح</small></div><ChevronLeft size={20} /></button>
        <button><span className="blue"><ArrowRightLeft size={23} /></span><div><strong>نقل موظف</strong><small>نقل بين الغرف أو السكنات</small></div><ChevronLeft size={20} /></button>
        <button><span className="amber"><Home size={23} /></span><div><strong>إخلاء سكن</strong><small>إنهاء التسكين وإخلاء السرير</small></div><ChevronLeft size={20} /></button>
      </section>
      <section className="housing-panel housing-table-panel">
        <div className="housing-panel-head"><div><h2>سجل الحركات الأخير</h2><p>جميع عمليات التسكين والنقل والإخلاء</p></div><button className="housing-secondary-button"><Filter size={17} /> تصفية</button></div>
        <div className="housing-table-wrap"><table><thead><tr><th>رقم الحركة</th><th>الموظف</th><th>نوع الحركة</th><th>من</th><th>إلى</th><th>التاريخ</th><th>نفذت بواسطة</th></tr></thead><tbody>
          <tr><td><strong>MV-2841</strong></td><td>عبدالله محمد</td><td><Status>تسكين</Status></td><td>—</td><td>النخيل / A-204 / 03</td><td>12 يوليو 2026</td><td>أحمد الغامدي</td></tr>
          <tr><td><strong>MV-2840</strong></td><td>Ravi Kumar</td><td><Status tone="blue">نقل</Status></td><td>النخيل / B-108</td><td>النخيل / B-112</td><td>10 يوليو 2026</td><td>أحمد الغامدي</td></tr>
          <tr><td><strong>MV-2839</strong></td><td>Ali Hassan</td><td><Status tone="amber">إخلاء</Status></td><td>الروضة / C-214</td><td>—</td><td>09 يوليو 2026</td><td>خالد العتيبي</td></tr>
        </tbody></table></div>
      </section>
    </>
  );
}

function UtilityPage() {
  return (
    <>
      <section className="housing-metrics-grid housing-utility-metrics">
        <MetricCard icon={Zap} label="كهرباء هذا الشهر" value="86,420 ر.س" detail="+7.2% عن الشهر السابق" tone="amber" />
        <MetricCard icon={Droplets} label="مياه هذا الشهر" value="28,730 ر.س" detail="-2.4% عن الشهر السابق" tone="blue" />
        <MetricCard icon={Clock3} label="فواتير مستحقة" value="6" detail="بقيمة 41,280 ر.س" tone="purple" />
        <MetricCard icon={AlertTriangle} label="استهلاك غير معتاد" value="3" detail="تحتاج إلى مراجعة" tone="red" />
      </section>
      <section className="housing-panel housing-table-panel">
        <div className="housing-panel-head"><div><h2>حسابات الخدمات</h2><p>آخر تحديث: اليوم، 09:42 صباحًا</p></div><div className="housing-head-actions"><button className="housing-secondary-button"><FileText size={17} /> استيراد فاتورة</button><button className="housing-primary-button"><Plus size={18} /> إضافة عداد</button></div></div>
        <div className="housing-table-wrap"><table><thead><tr><th>السكن</th><th>الخدمة</th><th>رقم الحساب</th><th>الاستهلاك</th><th>المبلغ</th><th>الاستحقاق</th><th>الحالة</th></tr></thead><tbody>
          <tr><td><strong>سكن النخيل</strong></td><td><span className="housing-service amber"><Zap size={15} /> كهرباء</span></td><td>1009••••384</td><td>42,180 ك.و.س</td><td><strong>24,860 ر.س</strong></td><td>18 أغسطس 2026</td><td><Status tone="amber">مستحقة</Status></td></tr>
          <tr><td><strong>سكن النخيل</strong></td><td><span className="housing-service blue"><Droplets size={15} /> مياه</span></td><td>3012••••147</td><td>1,840 م³</td><td><strong>8,420 ر.س</strong></td><td>21 أغسطس 2026</td><td><Status>مسددة</Status></td></tr>
          <tr><td><strong>سكن الروضة</strong></td><td><span className="housing-service amber"><Zap size={15} /> كهرباء</span></td><td>1007••••926</td><td>36,920 ك.و.س</td><td><strong>21,310 ر.س</strong></td><td>07 أغسطس 2026</td><td><Status tone="red">متأخرة</Status></td></tr>
        </tbody></table></div>
      </section>
    </>
  );
}

function Placeholder({ page }) {
  const [title, description] = pageMeta[page];
  const Icon = navGroups.flatMap((group) => group.items).find((item) => item.id === page)?.icon || FileText;
  return <section className="housing-panel housing-empty"><span><Icon size={32} /></span><h2>{title}</h2><p>{description}</p><button className="housing-primary-button"><Plus size={18} /> إضافة أول سجل</button></section>;
}

function AddHousingModal({ onClose, onSave }) {
  return (
    <div className="housing-modal-backdrop" onMouseDown={onClose}>
      <div className="housing-modal" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><h2>إضافة سكن جديد</h2><p>أدخل البيانات الأساسية، ويمكن إكمال المباني والغرف لاحقًا.</p></div><button onClick={onClose}><X size={20} /></button></header>
        <form onSubmit={(e) => { e.preventDefault(); onSave(); }}>
          <div className="housing-form-grid">
            <label><span>اسم السكن</span><input required placeholder="مثال: سكن النخيل" /></label>
            <label><span>المدينة</span><select required defaultValue=""><option value="" disabled>اختر المدينة</option><option>الرياض</option><option>جدة</option><option>الدمام</option></select></label>
            <label><span>المشروع</span><input required placeholder="اسم المشروع" /></label>
            <label><span>مسؤول السكن</span><input required placeholder="اسم المسؤول" /></label>
            <label><span>نوع السكن</span><select><option>سكن عمال</option><option>سكن موظفين</option><option>سكن إداريين</option><option>سكن عائلات</option></select></label>
            <label><span>الطاقة الاستيعابية</span><input type="number" min="1" placeholder="0" /></label>
            <label className="full"><span>العنوان</span><textarea rows="3" placeholder="الحي، الشارع، رقم المبنى" /></label>
            <label><span>خط العرض Latitude</span><input type="number" step="any" min="-90" max="90" placeholder="24.7136" /></label>
            <label><span>خط الطول Longitude</span><input type="number" step="any" min="-180" max="180" placeholder="46.6753" /></label>
          </div>
          <footer><button type="button" className="housing-secondary-button" onClick={onClose}>إلغاء</button><button className="housing-primary-button">حفظ السكن</button></footer>
        </form>
      </div>
    </div>
  );
}

function HousingWorkspace({ backendContext }) {
  const { language, dir, locale, t, toggleLanguage } = useHousingLanguage();
  const [page, setPage] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState("");
  const housingBackendConfigured = hasViteHousingSupabaseConfig();
  const client = useMemo(() => housingBackendConfigured ? getHousingSupabaseClient() : null, [housingBackendConfigured]);
  const live = useHousingWorkspaceData(client, backendContext?.company?.id);
  const [title, description] = (language === "en" ? pageMetaEn : pageMeta)[page] || [t("appName"), t("appSubtitle")];
  const today = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date()), [locale]);
  const profileName = backendContext?.profile?.full_name || t("systemAdministrator");
  const currentRole = backendContext?.profile?.role || "Admin";
  const allowedPages = useMemo(() => ROLE_PAGE_ACCESS[currentRole] ? new Set(ROLE_PAGE_ACCESS[currentRole]) : null, [currentRole]);
  const initials = profileName.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase();

  const goTo = (id) => { setPage(id); setSidebarOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const notify = (message) => { setToast(message); window.setTimeout(() => setToast(""), 3200); };
  const saveHousing = async (input) => {
    try { await live.createSite(input); setModalOpen(false); notify(t("saved")); } catch { /* shown by shared error */ }
  };
  const saveRecord = async (table, input) => {
    try { const result = await live.createRecord(table, input); notify(result?.offlineQueued ? (language === "ar" ? "تم الحفظ على الجهاز وسيتم الرفع تلقائياً" : "Saved on device and will sync automatically") : t("saved")); return result; } catch (error) { throw error; }
  };
  const signOut = async () => { await client?.auth.signOut(); };
  const badgeFor = (id) => {
    if (id === "compliance") return live.data.alerts.filter((item) => item.status === "Open").length || null;
    if (id === "employee-status") return live.data.employeeStatusEvents.filter((item) => item.status === "Open").length || null;
    if (id === "notifications") return live.data.notificationEvents.filter((item) => item.status === "Unread").length || null;
    return null;
  };

  return <div className="housing-app" dir={dir} data-language={language}>
    {sidebarOpen && <button className="housing-overlay" aria-label="close" onClick={() => setSidebarOpen(false)} />}
    <aside className={`housing-sidebar ${sidebarOpen ? "open" : ""}`}>
      <div className="housing-brand"><span><Building2 size={25} /></span><div><strong>{t("appName")}</strong><small>{t("appSubtitle")}</small></div><button className="housing-sidebar-close" onClick={() => setSidebarOpen(false)}><X size={20} /></button></div>
      <nav>{navGroups.map((group) => { const items=group.items.filter(({id})=>!allowedPages||allowedPages.has(id)); return items.length?<div className="housing-nav-group" key={group.labelKey}><p>{t(group.labelKey)}</p>{items.map(({ id, labelKey, icon: Icon }) => { const badge = badgeFor(id); return <button key={id} className={page === id ? "active" : ""} onClick={() => goTo(id)}><Icon size={19} /><span>{t(labelKey)}</span>{badge ? <b>{badge}</b> : null}</button> })}</div>:null})}</nav>
      <div className="housing-sidebar-footer"><div className="housing-profile-avatar">{initials}</div><div><strong>{profileName}</strong><span>{backendContext?.profile?.role || t("systemAdministrator")}</span></div><button onClick={signOut} title={t("logout")}><LogOut size={18} /></button></div>
    </aside>

    <main className="housing-main"><header className="housing-topbar"><button className="housing-menu-button" onClick={() => setSidebarOpen(true)}><Menu size={22} /></button><div className="housing-search"><Search size={18} /><input placeholder={t("quickSearch")} /></div><div className="housing-topbar-end"><button className={`housing-offline-status ${live.offline.online ? "online" : "offline"}`} onClick={() => goTo("offline")} title={language === "ar" ? "حالة المزامنة" : "Sync status"}><CloudOff size={16} /><span>{live.offline.online ? (live.offline.summary.pending ? live.offline.summary.pending : "✓") : (language === "ar" ? "دون اتصال" : "Offline")}</span></button><button className="housing-language-button" onClick={toggleLanguage}><Languages size={17} />{t("language")}</button><button className="housing-refresh-button" onClick={live.refresh} disabled={live.loading}><RefreshCw size={17} className={live.loading ? "housing-spin" : ""} /></button><div className="housing-date"><CalendarDays size={17} /><span>{today}</span></div><button className="housing-notification" onClick={() => goTo("notifications")}><Bell size={20} />{live.data.notificationEvents.some((item) => item.status === "Unread") && <i />}</button><div className="housing-top-profile"><span>{initials}</span><div><strong>{profileName}</strong><small>{backendContext?.profile?.role || t("systemAdministrator")}</small></div></div></div></header>

      <div className="housing-content"><div className="housing-page-title"><div><p><Home size={15} /> {t("main")} <ChevronLeft size={14} /> {title}</p><h1>{title}</h1><span>{description}</span></div>{page === "dashboard" && (!allowedPages||allowedPages.has("test-center")) && <button className="housing-primary-button" onClick={() => goTo("test-center")}><UserPlus size={18} />{t("newAssignment")}</button>}</div>
        {live.loading && <div className="housing-live-banner"><LoaderCircle className="housing-spin" size={18} />{t("loading")}</div>}
        {live.error && <div className="housing-access-message error"><AlertTriangle size={17} />{live.error}<button onClick={live.refresh}>{t("refresh")}</button></div>}
        {!housingBackendConfigured && <div className="housing-demo-banner"><ShieldCheck size={17} /><span>{language === "ar" ? "إعدادات Supabase غير متاحة." : "Supabase configuration is unavailable."}</span></div>}

        {page === "dashboard" && <LiveDashboard data={live.data} goTo={goTo} />}
        {page === "housing" && <LiveHousingList data={live.data} onAdd={() => setModalOpen(true)} />}
        {page === "rooms" && <LiveDataTable type="rooms" data={live.data} />}
        {page === "residents" && <LiveDataTable type="residents" data={live.data} />}
        {page === "allocations" && <LiveAllocations data={live.data} goTo={goTo} />}
        {page === "reconciliation" && <HousingReconciliationPage client={client} companyId={backendContext?.company?.id} data={live.data} canManage={["Admin","Housing Manager","Housing Supervisor"].includes(currentRole)} />}
        {page === "employee-status" && <HousingEmployeeStatusPage client={client} data={live.data} canManage={["Admin","Housing Manager","Housing Supervisor"].includes(currentRole)} />}
        {page === "notifications" && <HousingNotificationsPage client={client} companyId={backendContext?.company?.id} data={live.data} canManage={["Admin","Housing Manager"].includes(currentRole)} onRefresh={live.refresh} />}
        {page === "offline" && <HousingOfflinePage offline={live.offline} />}
        {page === "test-center" && <HousingTestCenter data={live.data} loading={live.loading} saving={live.saving} error={live.error} onSeed={live.seedTestData} onAssign={live.assignEmployee} onRefresh={live.refresh} onAcknowledge={live.acknowledgeAlert} />}
        {page === "smart-occupancy" && <SmartOccupancyPage data={live.data} />}
        {page === "utilities" && <LiveUtilities data={live.data} onCreate={saveRecord} saving={live.saving} />}
        {page === "compliance" && <ComplianceDashboard data={live.data} onAcknowledge={live.acknowledgeAlert} onUploadAttachment={live.uploadHseAttachment} />}
        {page === "operations" && <CateringLaundryPage data={live.data} />}
        {page === "welfare" && <WelfarePage data={live.data} />}
        {page === "maintenance" && <MaintenancePage data={live.data} onCreate={saveRecord} saving={live.saving} />}
        {page === "inspections" && <InspectionsPage data={live.data} onCreate={saveRecord} onUpdate={live.updateInspection} saving={live.saving} />}
        {page === "assets" && <AssetsPage data={live.data} onCreate={saveRecord} saving={live.saving} />}
        {page === "incidents" && <IncidentsPage data={live.data} onCreate={saveRecord} saving={live.saving} />}
        {page === "contracts" && <ContractsPage data={live.data} onCreate={saveRecord} saving={live.saving} />}
        {page === "cost-centers" && <HousingCostCentersPage client={client} companyId={backendContext?.company?.id} data={live.data} canManage={["Admin","Housing Manager","Finance"].includes(currentRole)} onRefresh={live.refresh} />}
        {page === "reports" && <ReportsPage data={live.data} />}
        {page === "settings" && <HousingSettingsPage client={client} sites={live.data.sites} currentProfile={backendContext?.profile} />}
      </div>
    </main>
    {modalOpen && <LiveAddHousingModal onClose={() => setModalOpen(false)} onSave={saveHousing} saving={live.saving} />}
    {toast && <div className="housing-toast"><CheckCircle2 size={19} />{toast}</div>}
  </div>;
}

function HousingBackendGate() {
  const { dir, t } = useHousingLanguage();
  const [state, setState] = useState({ status: 'loading', error: '', message: '' });
  const client = useMemo(() => getHousingSupabaseClient(), []);
  const inviteToken = useMemo(() => new URLSearchParams(window.location.search).get('invite'), []);

  const loadContext = async () => {
    setState((current) => ({ ...current, status: 'loading', error: '' }));
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) return setState({ status: 'login', error: sessionError.message, message: '' });
    if (!sessionData?.session) return setState({ status: 'login', error: '', message: '' });
    let { data, error } = await client.rpc('get_housing_context');
    if ((!data?.profile || !data?.company) && inviteToken) {
      const accepted = await client.rpc('housing_accept_user_invitation', { p_token: inviteToken });
      if (accepted.error) return setState({ status: 'setup', error: accepted.error.message, message: '' });
      window.history.replaceState({}, '', '/housing');
      ({ data, error } = await client.rpc('get_housing_context'));
    }
    if (error || !data?.profile || !data?.company) return setState({ status: 'setup', error: '', message: '' });
    setState({ status: 'ready', context: data, error: '', message: '' });
  };

  useEffect(() => {
    loadContext();
    const { data: listener } = client.auth.onAuthStateChange(() => window.setTimeout(loadContext, 0));
    return () => listener?.subscription?.unsubscribe();
  }, [client]);

  const login = async ({ email, password }) => {
    setState({ status: 'login', error: '', message: '', busy: true });
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) setState({ status: 'login', error: t('signInError'), message: '' });
  };

  const register = async ({ email, password, fullName, companyName }) => {
    setState({ status: 'login', error: '', message: '', busy: true });
    const { data, error } = await client.auth.signUp({ email, password, options: { data: { full_name: fullName, company_name: companyName } } });
    if (error) return setState({ status: 'login', error: error.message, message: '' });
    if (!data?.session) return setState({ status: 'login', error: '', message: t('accountCreated') });
    const setup = inviteToken
      ? await client.rpc('housing_accept_user_invitation', { p_token: inviteToken })
      : await client.rpc('housing_create_workspace', { p_company_name: companyName, p_full_name: fullName });
    if (setup.error) return setState({ status: 'setup', error: setup.error.message, message: '' });
    await loadContext();
  };

  const setupWorkspace = async ({ fullName, companyName }) => {
    setState({ status: 'setup', error: '', message: '', busy: true });
    const { error } = await client.rpc('housing_create_workspace', { p_company_name: companyName, p_full_name: fullName });
    if (error) return setState({ status: 'setup', error: error.message, message: '' });
    await loadContext();
  };

  if (state.status === 'loading') return <div className="housing-app-loading" dir={dir}><LoaderCircle className="housing-spin" size={28} /><span>{t('loading')}</span></div>;
  if (state.status === 'login') return <HousingAccess busy={state.busy} error={state.error} message={state.message} onLogin={login} onRegister={register} />;
  if (state.status === 'setup') return <HousingAccess mode="setup" busy={state.busy} error={state.error} onSetup={setupWorkspace} />;
  return <HousingWorkspace backendContext={state.context} />;
}

export default function HousingApp() {
  return <HousingLanguageProvider>{hasViteHousingSupabaseConfig() ? <HousingBackendGate /> : <HousingWorkspace />}</HousingLanguageProvider>;
}
