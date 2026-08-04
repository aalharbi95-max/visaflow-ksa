const guideSteps = [
  {
    number: "01",
    title: "Create and approve the request | إنشاء الطلب واعتماده",
    body: "Create the manpower request, add each profession/nationality/gender combination as a separate line, save it, then complete Recruitment Approval.",
    tip: "Important: type in Profession or Nationality, then click the matching suggestion. Typing alone does not select the value.",
    image: "/user-guide/01-company-requests.png",
  },
  {
    number: "02",
    title: "Notify the agency | إشعار الوكالة",
    body: "Open Notify Agencies, confirm the required request lines, select the matching active agency, and send the sourcing notification.",
    tip: "Check the Notification Center and email log after sending. The screen should show sent, failed, or skipped—not only a generic success message.",
    image: "/user-guide/02-notify-agency.png",
  },
  {
    number: "03",
    title: "Create visa inventory | إنشاء مخزون التأشيرات",
    body: "Add a visa batch and create lines that match the approved request exactly by profession, nationality, gender, and quantity.",
    tip: "A request cannot be allocated when its line and the visa line do not match.",
    image: "/user-guide/04-visa-inventory.png",
  },
  {
    number: "04",
    title: "Allocate visas | تخصيص التأشيرات",
    body: "Select the approved request, choose the available matching visa line, enter the quantity, and confirm the allocation.",
    tip: "Verify the Current Allocations table before continuing.",
    image: "/user-guide/05-visa-allocation.png",
  },
  {
    number: "05",
    title: "Create authorization | إنشاء التفويض",
    body: "Create an authorization from the saved allocation, select the office/agency, enter the authorization number and authorized quantity, then save.",
    tip: "The authorization quantity must not exceed the allocated quantity.",
    image: "/user-guide/06-authorization.png",
  },
  {
    number: "06",
    title: "Submit candidates | إضافة المرشحين",
    body: "Add the candidate against the exact request, complete identity and contact details, select the agency, and move the status through submission and interview.",
    tip: "Use a unique passport or Civil ID. Refresh the candidate list and confirm the saved row before moving to Interviews.",
    image: "/user-guide/07-candidate-submission.png",
  },
  {
    number: "07",
    title: "Interview to joining | من المقابلة إلى المباشرة",
    body: "Schedule the interview, record the decision, complete medical and visa stamping, issue the ticket, confirm arrival, validate onboarding, then convert the joined candidate to an employee.",
    tip: "At every stage, confirm the current status, responsible team, next action, and operation result.",
    image: "/user-guide/03-add-candidate.png",
  },
];

const agencySteps = [
  {
    number: "01",
    title: "Review assigned authorization | مراجعة التفويض",
    body: "Open the assigned authorization, review the request line and quantity, then acknowledge it before accepting or rejecting the assignment.",
    tip: "Acknowledge confirms receipt only. Accept or Reject is the formal agency decision that starts or closes the SLA.",
    image: "/user-guide/08-agency-portal.png",
  },
  {
    number: "02",
    title: "Submit and update candidates | رفع وتحديث المرشحين",
    body: "Use Office Portal to add candidates individually or upload the Excel template. Assigned candidates must match the request profession, nationality, and gender exactly.",
    tip: "Leave Request No blank only for the Agency Talent Pool. The company controls final interview, arrival validation, joining, and employee conversion.",
    image: "/user-guide/03-add-candidate.png",
  },
  {
    number: "03",
    title: "Follow notifications and SLA | متابعة التنبيهات والمهلة",
    body: "Use Notifications to respond to sourcing alerts, follow company decisions, and confirm that every update belongs to the currently displayed client workspace.",
    tip: "The agency workspace must never expose company administration, other agencies, or another client without an authorized workspace switch.",
    image: "/user-guide/02-notify-agency.png",
  },
];

const lifecycle = [
  "Request",
  "Recruitment Approval",
  "Agency Sourcing",
  "Visa Allocation",
  "Authorization",
  "Candidate",
  "Interview",
  "Medical & Visa",
  "Mobilization",
  "Onboarding",
  "Employee",
  "Demobilization",
  "Redeployment",
];

export default function UserGuide({ currentRole }) {
  const isAgency = currentRole === "Agency";
  const visibleSteps = isAgency ? agencySteps : guideSteps;
  const visibleLifecycle = isAgency
    ? ["Authorization", "Acknowledge", "Accept / Reject", "Candidate Submission", "Agency Updates", "Company Decision"]
    : lifecycle;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <section className="table-card" style={{ background: "linear-gradient(135deg, #0b2149, #155eef)", color: "#fff", overflow: "hidden" }}>
        <div style={{ maxWidth: 900 }}>
          <span style={{ display: "inline-flex", padding: "6px 10px", borderRadius: 999, background: "rgba(255,255,255,.14)", fontWeight: 800, fontSize: 12 }}>VisaFlow KSA · {currentRole || "User"}</span>
          <h2 style={{ marginBottom: 8, fontSize: 30 }}>Operational User Guide | دليل الاستخدام التشغيلي</h2>
          <p style={{ margin: 0, lineHeight: 1.8, color: "rgba(255,255,255,.86)" }}>
            Follow the process in order. Do not move to the next stage until the current record is visible in its list and the result is clearly confirmed.
            <br />اتبع الدورة بالترتيب، ولا تنتقل للمرحلة التالية حتى يظهر السجل في القائمة وتتأكد نتيجة العملية بوضوح.
          </p>
        </div>
      </section>

      <section className="table-card">
        <h2>End-to-end lifecycle | دورة العمل الكاملة</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {visibleLifecycle.map((item, index) => (
            <span key={item} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 999, background: index === visibleLifecycle.length - 1 ? "#dcfce7" : "#eff6ff", color: "#153e75", fontWeight: 800 }}>
              {index + 1}. {item}
            </span>
          ))}
        </div>
      </section>

      {visibleSteps.map((step) => (
        <section key={step.number} className="table-card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 0.85fr) minmax(360px, 1.4fr)", gap: 0 }}>
            <div style={{ padding: 24 }}>
              <div style={{ width: 44, height: 44, borderRadius: 14, display: "grid", placeItems: "center", background: "#eaf2ff", color: "#155eef", fontWeight: 900 }}>{step.number}</div>
              <h2 style={{ marginBottom: 8 }}>{step.title}</h2>
              <p style={{ color: "#475569", lineHeight: 1.75 }}>{step.body}</p>
              <div style={{ padding: 12, borderRadius: 12, background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", lineHeight: 1.6 }}>
                <strong>Check | تحقق:</strong> {step.tip}
              </div>
            </div>
            <div style={{ background: "#f8fafc", borderLeft: "1px solid #e2e8f0", padding: 14 }}>
              <img src={step.image} alt={step.title} loading="lazy" style={{ display: "block", width: "100%", borderRadius: 12, border: "1px solid #dbe3ef", boxShadow: "0 10px 30px rgba(15,23,42,.10)" }} />
            </div>
          </div>
        </section>
      ))}

      <section className="table-card" style={{ border: "1px solid #bfdbfe", background: "#f8fbff" }}>
        <h2>Before closing any task | قبل إغلاق أي عملية</h2>
        <p style={{ marginBottom: 0, lineHeight: 1.8 }}>
          Confirm four things: <strong>current stage</strong>, <strong>responsible person/team</strong>, <strong>what the next button will do</strong>, and <strong>whether the result fully succeeded or partially failed</strong>.
          <br />تأكد دائمًا من: المرحلة الحالية، المسؤول عنها، نتيجة الزر قبل الضغط، وهل نجحت العملية بالكامل أم جزئيًا.
        </p>
      </section>
    </div>
  );
}
