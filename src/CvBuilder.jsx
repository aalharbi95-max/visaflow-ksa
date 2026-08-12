import { useEffect, useMemo, useState } from "react";
import {
  CV_BUILDER_STORAGE_KEY,
  addCvItem,
  calculateCvCompletion,
  createEmptyCvDraft,
  escapeHtml,
  normalizeCvDraft,
  removeCvItem,
  splitList,
  updateCvItem,
  validateCvDraft,
} from "./cvBuilder.mjs";
import "./cvBuilder.css";

const COPY = {
  AR: {
    dir: "rtl",
    title: "أنشئ سيرتك الذاتية باحتراف",
    subtitle: "مجاني، متوافق مع ATS، ويحفظ تلقائيًا على جهازك.",
    back: "العودة إلى VisaFlow",
    language: "English",
    saved: "تم الحفظ تلقائيًا",
    completion: "اكتمال السيرة",
    personal: "المعلومات الشخصية",
    summary: "الملخص المهني",
    experiences: "الخبرات المهنية",
    education: "التعليم",
    courses: "الدورات والشهادات",
    projects: "المشاريع",
    skills: "المهارات",
    languages: "اللغات",
    addExperience: "+ إضافة خبرة",
    addEducation: "+ إضافة مؤهل",
    addCourse: "+ إضافة دورة أو شهادة",
    addProject: "+ إضافة مشروع",
    remove: "حذف",
    preview: "معاينة السيرة",
    printPdf: "تنزيل PDF / طباعة",
    downloadWord: "تنزيل Word",
    publish: "نشر ملفي للشركات",
    publishNote: "سيطلب منك تسجيل الدخول والموافقة قبل ظهور الملف للشركات.",
    reset: "مسح النموذج",
    resetConfirm: "هل تريد مسح جميع بيانات السيرة؟",
    requiredMessage: "أكمل الاسم، المسمى، البريد، الجوال والملخص قبل النشر.",
    now: "حتى الآن",
    typeHere: "اكتب هنا",
  },
  EN: {
    dir: "ltr",
    title: "Build a Professional Resume",
    subtitle: "Free, ATS-friendly, and automatically saved on your device.",
    back: "Back to VisaFlow",
    language: "العربية",
    saved: "Saved automatically",
    completion: "Resume completion",
    personal: "Personal Details",
    summary: "Professional Summary",
    experiences: "Professional Experience",
    education: "Education",
    courses: "Courses & Certifications",
    projects: "Projects",
    skills: "Skills",
    languages: "Languages",
    addExperience: "+ Add Experience",
    addEducation: "+ Add Education",
    addCourse: "+ Add Course or Certification",
    addProject: "+ Add Project",
    remove: "Remove",
    preview: "Resume Preview",
    printPdf: "Download PDF / Print",
    downloadWord: "Download Word",
    publish: "Publish My Profile to Employers",
    publishNote: "You will sign in and explicitly consent before employers can see your profile.",
    reset: "Clear Form",
    resetConfirm: "Clear all resume information?",
    requiredMessage: "Complete name, target title, email, phone, and summary before publishing.",
    now: "Present",
    typeHere: "Type here",
  },
};

function loadDraft() {
  try {
    return normalizeCvDraft(JSON.parse(localStorage.getItem(CV_BUILDER_STORAGE_KEY) || "null"));
  } catch {
    return createEmptyCvDraft();
  }
}

function Field({ label, value, onChange, type = "text", placeholder = "", textarea = false, ...props }) {
  return (
    <label className={`cvb-field ${textarea ? "wide" : ""}`}>
      <span>{label}</span>
      {textarea
        ? <textarea rows={props.rows || 4} value={value || ""} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
        : <input type={type} value={value || ""} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} {...props} />}
    </label>
  );
}

function Section({ title, action, children }) {
  return (
    <section className="cvb-form-section">
      <div className="cvb-section-heading"><h2>{title}</h2>{action}</div>
      {children}
    </section>
  );
}

function ResumePreview({ draft, copy }) {
  const skills = splitList(draft.skills);
  const languages = splitList(draft.languages);
  const activeExperiences = draft.experiences.filter((item) => item.jobTitle || item.company || item.description || item.achievements);
  const activeEducation = draft.education.filter((item) => item.degree || item.major || item.institution);
  const activeCourses = draft.courses.filter((item) => item.name || item.issuer);
  const activeProjects = draft.projects.filter((item) => item.name || item.description || item.outcome);
  const contact = [draft.personal.email, draft.personal.phone, [draft.personal.city, draft.personal.country].filter(Boolean).join(", "), draft.personal.linkedin, draft.personal.portfolio].filter(Boolean);

  return (
    <article className={`cvb-paper template-${draft.template}`} id="cv-resume-print-area">
      <header className="cvb-resume-header">
        <h1>{draft.personal.fullName || (draft.language === "AR" ? "اسمك الكامل" : "Your Full Name")}</h1>
        <h2>{draft.personal.targetTitle || (draft.language === "AR" ? "المسمى المهني" : "Target Job Title")}</h2>
        <div className="cvb-contact-line">{contact.map((item) => <span key={item}>{item}</span>)}</div>
      </header>

      {draft.summary && <div className="cvb-resume-section"><h3>{copy.summary}</h3><p>{draft.summary}</p></div>}
      {activeExperiences.length > 0 && <div className="cvb-resume-section"><h3>{copy.experiences}</h3>{activeExperiences.map((item) => (
        <div className="cvb-resume-entry" key={item.id}>
          <div className="cvb-entry-title"><strong>{item.jobTitle || "—"}</strong><span>{[item.startDate, item.current ? copy.now : item.endDate].filter(Boolean).join(" – ")}</span></div>
          <div className="cvb-entry-meta">{[item.company, item.location].filter(Boolean).join(" · ")}</div>
          {item.description && <p>{item.description}</p>}
          {splitList(item.achievements).length > 0 && <ul>{splitList(item.achievements).map((entry) => <li key={entry}>{entry}</li>)}</ul>}
        </div>
      ))}</div>}
      {activeEducation.length > 0 && <div className="cvb-resume-section"><h3>{copy.education}</h3>{activeEducation.map((item) => (
        <div className="cvb-resume-entry compact" key={item.id}><div className="cvb-entry-title"><strong>{[item.degree, item.major].filter(Boolean).join(" — ")}</strong><span>{item.graduationYear}</span></div><div className="cvb-entry-meta">{[item.institution, item.location].filter(Boolean).join(" · ")}</div></div>
      ))}</div>}
      {activeCourses.length > 0 && <div className="cvb-resume-section"><h3>{copy.courses}</h3><div className="cvb-inline-list">{activeCourses.map((item) => <span key={item.id}><strong>{item.name}</strong>{[item.issuer, item.issueDate].filter(Boolean).length ? ` — ${[item.issuer, item.issueDate].filter(Boolean).join(", ")}` : ""}</span>)}</div></div>}
      {activeProjects.length > 0 && <div className="cvb-resume-section"><h3>{copy.projects}</h3>{activeProjects.map((item) => <div className="cvb-resume-entry compact" key={item.id}><div className="cvb-entry-title"><strong>{item.name}</strong><span>{item.role}</span></div>{item.description && <p>{item.description}</p>}{item.outcome && <p><strong>{item.outcome}</strong></p>}</div>)}</div>}
      {skills.length > 0 && <div className="cvb-resume-section"><h3>{copy.skills}</h3><div className="cvb-tags">{skills.map((item) => <span key={item}>{item}</span>)}</div></div>}
      {languages.length > 0 && <div className="cvb-resume-section"><h3>{copy.languages}</h3><p>{languages.join(" · ")}</p></div>}
    </article>
  );
}

function buildWordHtml(draft, copy) {
  const experience = draft.experiences.filter((item) => item.jobTitle || item.company).map((item) => `
    <section><h3>${escapeHtml(item.jobTitle)} <small>${escapeHtml([item.startDate, item.current ? copy.now : item.endDate].filter(Boolean).join(" - "))}</small></h3>
    <div class="meta">${escapeHtml([item.company, item.location].filter(Boolean).join(" | "))}</div>
    <p>${escapeHtml(item.description)}</p><ul>${splitList(item.achievements).map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul></section>`).join("");
  const education = draft.education.filter((item) => item.degree || item.institution).map((item) => `<p><strong>${escapeHtml([item.degree, item.major].filter(Boolean).join(" - "))}</strong> | ${escapeHtml([item.institution, item.location, item.graduationYear].filter(Boolean).join(", "))}</p>`).join("");
  const courses = draft.courses.filter((item) => item.name || item.issuer).map((item) => `<li><strong>${escapeHtml(item.name)}</strong>${item.issuer ? ` - ${escapeHtml(item.issuer)}` : ""}${item.issueDate ? ` (${escapeHtml(item.issueDate)})` : ""}</li>`).join("");
  const projects = draft.projects.filter((item) => item.name || item.description).map((item) => `<section><h3>${escapeHtml(item.name)} <small>${escapeHtml(item.role)}</small></h3><p>${escapeHtml(item.description)}</p><p><strong>${escapeHtml(item.outcome)}</strong></p></section>`).join("");
  const contact = [draft.personal.email, draft.personal.phone, [draft.personal.city, draft.personal.country].filter(Boolean).join(", "), draft.personal.linkedin, draft.personal.portfolio].filter(Boolean).join(" | ");
  return `<!doctype html><html dir="${copy.dir}"><head><meta charset="utf-8"><style>@page{size:A4;margin:16mm}body{font-family:Arial,sans-serif;color:#172033;line-height:1.42}h1{font-size:28px;color:#0b2545;margin:0}h2{font-size:15px;color:#176b87;margin:4px 0}h3{font-size:13px;color:#0b2545;margin:10px 0 2px}h4{font-size:13px;color:#176b87;border-bottom:2px solid #16a6a1;padding-bottom:3px;margin:18px 0 7px}.contact,.meta,small{font-size:10px;color:#607386}p,li{font-size:10.5px;margin:3px 0}section{page-break-inside:avoid}.tags{font-size:10.5px}</style></head><body><h1>${escapeHtml(draft.personal.fullName)}</h1><h2>${escapeHtml(draft.personal.targetTitle)}</h2><div class="contact">${escapeHtml(contact)}</div>${draft.summary ? `<h4>${escapeHtml(copy.summary)}</h4><p>${escapeHtml(draft.summary)}</p>` : ""}${experience ? `<h4>${escapeHtml(copy.experiences)}</h4>${experience}` : ""}${education ? `<h4>${escapeHtml(copy.education)}</h4>${education}` : ""}${courses ? `<h4>${escapeHtml(copy.courses)}</h4><ul>${courses}</ul>` : ""}${projects ? `<h4>${escapeHtml(copy.projects)}</h4>${projects}` : ""}${draft.skills ? `<h4>${escapeHtml(copy.skills)}</h4><p class="tags">${splitList(draft.skills).map(escapeHtml).join(" | ")}</p>` : ""}${draft.languages ? `<h4>${escapeHtml(copy.languages)}</h4><p>${splitList(draft.languages).map(escapeHtml).join(" | ")}</p>` : ""}</body></html>`;
}

export default function CvBuilder({ onBack, onPublish }) {
  const [draft, setDraft] = useState(loadDraft);
  const [message, setMessage] = useState("");
  const copy = COPY[draft.language] || COPY.AR;
  const completion = useMemo(() => calculateCvCompletion(draft), [draft]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.setItem(CV_BUILDER_STORAGE_KEY, JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [draft]);

  const updatePersonal = (field, value) => setDraft((current) => ({ ...current, personal: { ...current.personal, [field]: value } }));
  const updateItem = (section, id, field, value) => setDraft((current) => updateCvItem(current, section, id, field, value));
  const addItem = (section) => setDraft((current) => addCvItem(current, section));
  const removeItem = (section, id) => setDraft((current) => removeCvItem(current, section, id));

  function downloadWord() {
    const html = buildWordHtml(draft, copy);
    const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${String(draft.personal.fullName || "VisaFlow-Resume").replace(/[^\p{L}\p{N}_-]+/gu, "_")}.doc`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function publishProfile() {
    const validation = validateCvDraft(draft);
    if (!validation.ok) {
      setMessage(copy.requiredMessage);
      document.querySelector(".cvb-form-panel")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    localStorage.setItem(CV_BUILDER_STORAGE_KEY, JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }));
    onPublish?.(draft);
  }

  function resetDraft() {
    if (!window.confirm(copy.resetConfirm)) return;
    const next = createEmptyCvDraft();
    next.language = draft.language;
    setDraft(next);
    setMessage("");
    localStorage.removeItem(CV_BUILDER_STORAGE_KEY);
  }

  const inputLabels = draft.language === "AR" ? {
    name: "الاسم الكامل *", title: "المسمى المهني المستهدف *", email: "البريد الإلكتروني *", phone: "رقم الجوال *", city: "المدينة", country: "الدولة", linkedin: "LinkedIn", portfolio: "ملف الأعمال Portfolio",
    summary: "اكتب 4-5 أسطر عن تخصصك وخبرتك وأبرز نقاط قوتك *", jobTitle: "المسمى الوظيفي", company: "الشركة", location: "المدينة", start: "تاريخ البداية", end: "تاريخ النهاية", current: "أعمل هنا حاليًا", duties: "المهام الرئيسية", achievements: "الإنجازات - افصل كل إنجاز بسطر",
    degree: "الدرجة العلمية", major: "التخصص", institution: "الجامعة أو المعهد", graduation: "سنة التخرج", course: "اسم الدورة أو الشهادة", issuer: "الجهة المانحة", issueDate: "تاريخ الإصدار", credential: "رقم الاعتماد - اختياري",
    project: "اسم المشروع", role: "دورك", projectDescription: "وصف مختصر", outcome: "النتيجة أو الإنجاز", url: "رابط المشروع", skills: "افصل المهارات بفاصلة أو سطر جديد", languages: "مثال: العربية - لغة أم، الإنجليزية - متقدم",
  } : {
    name: "Full Name *", title: "Target Job Title *", email: "Email *", phone: "Mobile Number *", city: "City", country: "Country", linkedin: "LinkedIn", portfolio: "Portfolio URL",
    summary: "Write 4-5 lines about your specialization, experience, and strengths *", jobTitle: "Job Title", company: "Company", location: "Location", start: "Start Date", end: "End Date", current: "I currently work here", duties: "Core Responsibilities", achievements: "Achievements - one per line",
    degree: "Degree", major: "Major", institution: "Institution", graduation: "Graduation Year", course: "Course or Certification", issuer: "Issuer", issueDate: "Issue Date", credential: "Credential ID - optional",
    project: "Project Name", role: "Your Role", projectDescription: "Short Description", outcome: "Outcome or Achievement", url: "Project URL", skills: "Separate skills with commas or new lines", languages: "Example: Arabic - Native, English - Advanced",
  };

  return (
    <main className="cvb-app" dir={copy.dir} lang={draft.language === "AR" ? "ar" : "en"}>
      <header className="cvb-topbar">
        <button type="button" className="cvb-brand" onClick={onBack}><img src="/visaflow-logo-transparent.png" alt="" /><span><strong>VisaFlow</strong><small>CV Builder</small></span></button>
        <div className="cvb-top-actions"><button type="button" onClick={onBack}>{copy.back}</button><button type="button" onClick={() => setDraft((current) => ({ ...current, language: current.language === "AR" ? "EN" : "AR" }))}>{copy.language}</button></div>
      </header>

      <section className="cvb-hero">
        <div><span className="cvb-eyebrow">VisaFlow Career Studio</span><h1>{copy.title}</h1><p>{copy.subtitle}</p></div>
        <div className="cvb-progress-card"><div><span>{copy.completion}</span><strong>{completion}%</strong></div><div className="cvb-progress"><i style={{ width: `${completion}%` }} /></div><small>{copy.saved}</small></div>
      </section>

      <div className="cvb-workspace">
        <div className="cvb-form-panel">
          {message && <div className="cvb-message" role="alert">{message}</div>}
          <Section title={copy.personal}><div className="cvb-grid"><Field label={inputLabels.name} value={draft.personal.fullName} onChange={(value) => updatePersonal("fullName", value)} /><Field label={inputLabels.title} value={draft.personal.targetTitle} onChange={(value) => updatePersonal("targetTitle", value)} /><Field label={inputLabels.email} type="email" value={draft.personal.email} onChange={(value) => updatePersonal("email", value)} /><Field label={inputLabels.phone} value={draft.personal.phone} onChange={(value) => updatePersonal("phone", value)} /><Field label={inputLabels.city} value={draft.personal.city} onChange={(value) => updatePersonal("city", value)} /><Field label={inputLabels.country} value={draft.personal.country} onChange={(value) => updatePersonal("country", value)} /><Field label={inputLabels.linkedin} type="url" value={draft.personal.linkedin} onChange={(value) => updatePersonal("linkedin", value)} /><Field label={inputLabels.portfolio} type="url" value={draft.personal.portfolio} onChange={(value) => updatePersonal("portfolio", value)} /></div></Section>
          <Section title={copy.summary}><Field label={inputLabels.summary} textarea rows={5} value={draft.summary} onChange={(value) => setDraft((current) => ({ ...current, summary: value }))} /></Section>

          <Section title={copy.experiences} action={<button type="button" className="cvb-add" onClick={() => addItem("experiences")}>{copy.addExperience}</button>}>
            <div className="cvb-repeat-list">{draft.experiences.map((item, index) => <div className="cvb-repeat-card" key={item.id}><div className="cvb-repeat-title"><strong>{copy.experiences} #{index + 1}</strong><button type="button" onClick={() => removeItem("experiences", item.id)}>{copy.remove}</button></div><div className="cvb-grid"><Field label={inputLabels.jobTitle} value={item.jobTitle} onChange={(value) => updateItem("experiences", item.id, "jobTitle", value)} /><Field label={inputLabels.company} value={item.company} onChange={(value) => updateItem("experiences", item.id, "company", value)} /><Field label={inputLabels.location} value={item.location} onChange={(value) => updateItem("experiences", item.id, "location", value)} /><Field label={inputLabels.start} type="month" value={item.startDate} onChange={(value) => updateItem("experiences", item.id, "startDate", value)} /><Field label={inputLabels.end} type="month" value={item.endDate} disabled={item.current} onChange={(value) => updateItem("experiences", item.id, "endDate", value)} /><label className="cvb-check"><input type="checkbox" checked={item.current} onChange={(event) => updateItem("experiences", item.id, "current", event.target.checked)} /><span>{inputLabels.current}</span></label><Field label={inputLabels.duties} textarea value={item.description} onChange={(value) => updateItem("experiences", item.id, "description", value)} /><Field label={inputLabels.achievements} textarea value={item.achievements} onChange={(value) => updateItem("experiences", item.id, "achievements", value)} /></div></div>)}</div>
          </Section>

          <Section title={copy.education} action={<button type="button" className="cvb-add" onClick={() => addItem("education")}>{copy.addEducation}</button>}><div className="cvb-repeat-list">{draft.education.map((item, index) => <div className="cvb-repeat-card" key={item.id}><div className="cvb-repeat-title"><strong>{copy.education} #{index + 1}</strong><button type="button" onClick={() => removeItem("education", item.id)}>{copy.remove}</button></div><div className="cvb-grid"><Field label={inputLabels.degree} value={item.degree} onChange={(value) => updateItem("education", item.id, "degree", value)} /><Field label={inputLabels.major} value={item.major} onChange={(value) => updateItem("education", item.id, "major", value)} /><Field label={inputLabels.institution} value={item.institution} onChange={(value) => updateItem("education", item.id, "institution", value)} /><Field label={inputLabels.location} value={item.location} onChange={(value) => updateItem("education", item.id, "location", value)} /><Field label={inputLabels.graduation} value={item.graduationYear} onChange={(value) => updateItem("education", item.id, "graduationYear", value)} /></div></div>)}</div></Section>

          <Section title={copy.courses} action={<button type="button" className="cvb-add" onClick={() => addItem("courses")}>{copy.addCourse}</button>}><div className="cvb-repeat-list">{draft.courses.map((item, index) => <div className="cvb-repeat-card" key={item.id}><div className="cvb-repeat-title"><strong>{copy.courses} #{index + 1}</strong><button type="button" onClick={() => removeItem("courses", item.id)}>{copy.remove}</button></div><div className="cvb-grid"><Field label={inputLabels.course} value={item.name} onChange={(value) => updateItem("courses", item.id, "name", value)} /><Field label={inputLabels.issuer} value={item.issuer} onChange={(value) => updateItem("courses", item.id, "issuer", value)} /><Field label={inputLabels.issueDate} type="month" value={item.issueDate} onChange={(value) => updateItem("courses", item.id, "issueDate", value)} /><Field label={inputLabels.credential} value={item.credentialId} onChange={(value) => updateItem("courses", item.id, "credentialId", value)} /></div></div>)}</div></Section>

          <Section title={copy.projects} action={<button type="button" className="cvb-add" onClick={() => addItem("projects")}>{copy.addProject}</button>}><div className="cvb-repeat-list">{draft.projects.map((item, index) => <div className="cvb-repeat-card" key={item.id}><div className="cvb-repeat-title"><strong>{copy.projects} #{index + 1}</strong><button type="button" onClick={() => removeItem("projects", item.id)}>{copy.remove}</button></div><div className="cvb-grid"><Field label={inputLabels.project} value={item.name} onChange={(value) => updateItem("projects", item.id, "name", value)} /><Field label={inputLabels.role} value={item.role} onChange={(value) => updateItem("projects", item.id, "role", value)} /><Field label={inputLabels.projectDescription} textarea value={item.description} onChange={(value) => updateItem("projects", item.id, "description", value)} /><Field label={inputLabels.outcome} textarea value={item.outcome} onChange={(value) => updateItem("projects", item.id, "outcome", value)} /><Field label={inputLabels.url} type="url" value={item.url} onChange={(value) => updateItem("projects", item.id, "url", value)} /></div></div>)}</div></Section>
          <Section title={copy.skills}><Field label={inputLabels.skills} textarea rows={4} value={draft.skills} onChange={(value) => setDraft((current) => ({ ...current, skills: value }))} /></Section>
          <Section title={copy.languages}><Field label={inputLabels.languages} textarea rows={3} value={draft.languages} onChange={(value) => setDraft((current) => ({ ...current, languages: value }))} /></Section>
          <div className="cvb-danger-zone"><button type="button" onClick={resetDraft}>{copy.reset}</button></div>
        </div>

        <aside className="cvb-preview-panel"><div className="cvb-preview-toolbar"><h2>{copy.preview}</h2><select value={draft.template} onChange={(event) => setDraft((current) => ({ ...current, template: event.target.value }))}><option value="classic">Classic ATS</option><option value="modern">Modern Teal</option></select></div><ResumePreview draft={draft} copy={copy} /><div className="cvb-download-actions"><button type="button" onClick={() => window.print()}>{copy.printPdf}</button><button type="button" onClick={downloadWord}>{copy.downloadWord}</button><button type="button" className="primary" onClick={publishProfile}>{copy.publish}</button><small>{copy.publishNote}</small></div></aside>
      </div>
    </main>
  );
}
