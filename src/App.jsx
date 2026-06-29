import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import pptxgen from "pptxgenjs";
import { supabase } from "./supabase";
import "./style.css";


const PAGES = [
  "Executive Dashboard",
  "AI Commander",
  "AI Agent",
  "AI Report Studio",
  "Dashboard",
  "Requests",
  "Saudi Hiring",
  "Authorization",
  "Cancellation Register",
  "Visa Inventory",
  "Visa Allocation",
  "Candidates",
  "Interviews",
  "Mobilization",
  "Employees",
  "Demobilization",
  "Workforce Marketplace",
  "Rejected Candidates",
  "Agencies",
  "Agency Agreements",
  "Agency Ranking",
  "Agency Performance",
  "Penalty Register",
  "Recruitment Performance",
  "Company Management",
  "Email Settings",
  "Users Management",
  "Permissions",
  "Master Data",
  "Office Portal",
  "Notifications",
  "Reports",
 "Platform Dashboard",
"Platform Intelligence",
"Companies Management",
"Platform Users",
"Subscription Invoices",
  "Company Requests Report",
  "Backup Center",
  "Central Support",
];

const SIDEBAR_GROUPS = [
  {
    title: "Command Center",
    icon: "🏠",
    pages: ["Platform Intelligence", "Executive Dashboard", "AI Commander", "AI Agent", "AI Report Studio", "Dashboard"],
  },
  {
    title: "Recruitment",
    icon: "📋",
    pages: ["Requests", "Saudi Hiring", "Candidates", "Interviews", "Rejected Candidates"],
  },
  {
    title: "Visa & Authorization",
    icon: "🛂",
    pages: ["Visa Inventory", "Visa Allocation", "Authorization", "Cancellation Register"],
  },
  {
    title: "Mobilization & Workforce",
    icon: "👷",
    pages: ["Mobilization", "Employees", "Demobilization", "Workforce Marketplace"],
  },
  {
    title: "Agencies",
    icon: "🏢",
    pages: ["Office Portal", "Agencies", "Agency Agreements", "Agency Ranking", "Agency Performance", "Penalty Register"],
  },
  {
    title: "Performance & Reports",
    icon: "📊",
    pages: ["Recruitment Performance", "Reports"],
  },
  {
    title: "Platform Administration",
    icon: "👑",
    pages: [
  "Platform Dashboard",
  "Companies Management",
  "Platform Users",
  "Subscription Invoices",
  "Company Requests Report",
  "Backup Center",
  "Central Support",
],
  },
  {
    title: "Administration",
    icon: "⚙️",
    pages: ["Notifications", "Company Management", "Email Settings", "Users Management", "Permissions", "Master Data"],
  },
];

function buildSidebarGroups(visiblePages = []) {
  const pageSet = new Set(visiblePages.filter((page) => page && page !== "RequestDetails"));
  const usedPages = new Set();

  const groups = SIDEBAR_GROUPS.map((group) => {
    const pages = group.pages.filter((page) => pageSet.has(page));
    pages.forEach((page) => usedPages.add(page));
    return { ...group, pages };
  }).filter((group) => group.pages.length > 0);

  const otherPages = Array.from(pageSet).filter((page) => !usedPages.has(page));
  if (otherPages.length > 0) {
    groups.push({
      title: "Other",
      icon: "⋯",
      pages: otherPages,
    });
  }

  return groups;
}

const ROLE_OPTIONS = [
 "Platform Owner",
"Platform Accounts User",
"Platform Support User",
"Admin",
  "CEO",
  "Operations Manager",
  "Project Manager",
  "Recruitment Manager",
  "Recruitment Officer",
  "Visa Team",
  "Agency",
  "Viewer",
];

// Client-facing roles only. Platform Owner remains a hidden system role for SaaS owner login.
const CLIENT_ROLE_OPTIONS = ROLE_OPTIONS.filter((role) => role !== "Platform Owner");

const RECRUITMENT_PERFORMANCE_ROLES = [
  "Recruitment Manager",
  "Recruitment Officer",
];

function isRecruitmentPerformanceRole(role) {
  return RECRUITMENT_PERFORMANCE_ROLES.includes(role);
}

function getRolePerformanceCategory(role) {
  return isRecruitmentPerformanceRole(role) ? "Recruitment" : "Not Included";
}

function isRecruitmentPerformanceUser(user) {
  return (
    user &&
    String(user.status || "Active").trim().toLowerCase() === "active" &&
    isRecruitmentPerformanceRole(user.role)
  );
}

const ACTION_PERMISSIONS = {
  "Platform Owner": [
    "view",
    "create",
    "edit",
    "delete",
    "export",
    "managePlatform",
  ],

  // Company Admin: tenant-level administrator for one client company only.
  // Can manage users, permissions, master data and all operational modules inside his company.
  Admin: [
    "view",
    "create",
    "edit",
    "delete",
    "approve",
    "export",
    "manageUsers",
    "managePermissions",
    "manageMasterData",
    "manageCompany",
  ],

  CEO: ["view", "export"],

  "Operations Manager": [
    "view",
    "createRequest",
    "editOwnRequest",
    "manageMobilization",
    "manageEmployees",
    "manageDemobilization",
    "export",
  ],

  "Project Manager": [
    "view",
    "createRequest",
    "editOwnRequest",
    "export",
  ],

  "Recruitment Manager": [
    "view",
    "create",
    "edit",
    "approve",
    "export",
    "approveAgencies",
    "viewPerformance",
  ],

  "Recruitment Officer": ["view", "create", "edit"],

  "Visa Team": ["view", "createVisa", "editVisa", "deleteVisa", "export"],

  Agency: ["view", "createCandidate", "editCandidate"],

  Viewer: ["view", "export"],
};

const ROLE_DESCRIPTIONS = {
  "Platform Owner": "SaaS platform owner. Manages platform clients, subscriptions, invoices, backups and central support across all companies.",
  Admin: "Company administrator. Manages company users, permissions, master data, company settings and all operational modules for his company only.",
  CEO: "Executive visibility. Can view dashboards and reports and export management summaries without modifying operational records.",
  "Operations Manager": "Operations leader. Follows manpower requests, mobilization, employees, demobilization and operational reports. Views recruitment and agency performance.",
  "Project Manager": "Project-level manager. Follows project manpower requests, mobilization, employees and reports for operational follow-up.",
  "Recruitment Manager": "Recruitment leader. Manages recruitment requests, approvals, candidates, interviews, recruiter performance, agency performance and agency approvals.",
  "Recruitment Officer": "Recruiter. Handles daily recruitment operations: requests, candidates, interviews and candidate follow-up.",
  "Visa Team": "Visa coordinator. Manages visa inventory, allocation, authorizations and cancellation register.",
  Agency: "External office user. Uses Office Portal only for candidate updates and mobilization tracking.",
  Viewer: "Read-only user for dashboards, notifications and reports.",
};

const VISA_STATUSES = ["Pending", "Authorized", "Under Process", "Stamped", "Arrived", "Joined", "Cancelled"];
const REQUEST_STATUSES = ["Open", "Under Recruitment", "Interview Stage", "Visa Process", "Closed", "Cancelled"];
const APPROVAL_STATUSES = ["Draft", "Pending Recruitment Approval", "Approved by Recruitment", "Rejected by Recruitment"];
const PRIORITIES = ["Urgent", "High", "Medium", "Low", "Normal"];
const GENDERS = ["Male", "Female"];
const COUNTRIES = [
  "Saudi Arabia",
  "Bangladesh",
  "India",
  "Pakistan",
  "Nepal",
  "Philippines",
  "Uganda",
  "Egypt",
];

const PROFESSIONS = [
  "Cleaner",
  "Housekeeping Worker",
  "Tea Boy",
  "Waiter",
  "Driver",
  "Electrician",
  "Plumber",
  "HVAC Technician",
];

const CANDIDATE_STATUSES = [
  "New",
  "Sourced",
  "Candidate Submitted",
  "Interview Scheduled",
  "Interview Passed",
  "Interview Failed",
  "Selected",
  "Rejected",
  "Medical Scheduled",
  "Medical Passed",
  "Medical Failed",
  "Training",
  "Training Completed",
  "Embassy Submitted",
  "Embassy Delayed",
  "Visa Stamped",
  "Ticket Booked",
  "Departure",
  "Arrived KSA",
  "Arrived",
  "Joined",
  "KSA Medical Failed",
  "Refused to Work",
  "Absconded",
  "Cancelled",
];
const OFFICE_STATUSES = [
  "Medical Scheduled",
  "Medical Passed",
  "Medical Failed",
  "Training",
  "Training Completed",
  "Embassy Submitted",
  "Embassy Delayed",
  "Visa Stamped",
  "Ticket Booked",
  "Departure",
  "Arrived KSA",
  "Arrived",
  "Joined",
  "KSA Medical Failed",
  "Refused to Work",
  "Absconded",
  "Cancelled",
];
const INTERVIEW_STATUSES = ["Passed", "Rejected", "Waiting", "Re-Interview"];
const MEDICAL_STATUSES = ["Pending", "Fit", "Unfit", "Re-Medical"];
const MOBILIZATION_VISA_STATUSES = ["Pending", "Stamped", "Ready"];
const MOBILIZATION_STATUSES = ["New", "Medical", "Visa Ready", "Ticket Issued", "Arrived KSA", "Joined", "Cancelled"];
const DEMOBILIZATION_STATUSES = ["Available", "Suggested", "Reassigned", "Exit", "Hold", "Cancelled"];
const EMPLOYEE_STATUSES = ["Active", "On Leave", "Transferred", "Demobilized", "Final Exit"];
const DEMOBILIZATION_REASONS = ["Project End", "Contract End", "Replacement", "Performance", "Client Request", "Cost Optimization", "Other"];
const RECRUITMENT_TYPES = ["Foreign", "Saudi"];
const SAUDI_SOURCES = ["Jadarat", "LinkedIn", "Referral", "Career Fair", "Direct Application", "Other"];
const OFFER_STATUSES = ["Pending", "Sent", "Accepted", "Rejected", "Joined"];

const emptyRequest = {
  recruitment_type: "Foreign",
  request_type: "",
  project_name: "",
  department: "",
  profession: "",
  quantity: "",
  nationality: "",
  visa_no: "",
  gender: "",
  salary: "",
  priority: "Normal",
  status: "Open",
  requested_by: "",
  project_start: "",
  interview_required: "Required",
  interview_type: "Online",
  notes: "",
};

const emptyRequestLine = {
  profession: "",
  nationality: "",
  gender: "",
  quantity: "",
  salary: "",
  interview_required: "Required",
  interview_type: "Online",
  notes: "",
};

const emptyVisa = {
  request_no: "",
  visa_no: "",
  moi_no: "",
  project: "",
  profession: "",
  nationality: "",
  gender: "",
  quantity: "",
  authorized: "",
  allocated_qty: "",
  remaining_qty: "",
  authorization_no: "",
  issue_date: "",
  expiry_date: "",
  status: "Pending",
  notes: "",
};

const emptyVisaLine = {
  profession: "",
  nationality: "",
  gender: "",
  quantity: "",
  notes: "",
};

const emptyAgency = {
  name: "",
  country: "",
  contact_person: "",
  email: "",
  phone: "",
  status: "Active",
};

const emptyCandidate = {
  candidate_name: "",
  request_line_id: "",
  profession: "",
  nationality: "",
  gender: "",
  agency: "",
  project: "",
  request_no: "",
  passport_no: "",
  mobile: "",
  status: "New",
  medical_status: "Pending",
medical_date: "",
ticket_no: "",
flight_date: "",
arrival_date: "",
  visa_fees: "",
  agency_commission: "",
  ticket_cost: "",
  medical_ksa_cost: "",
  contract_status: "Pending",
  contract_url: "",
  source: "",
  offer_status: "Pending",
  joining_date: "",
  notes: "",
};


const emptyCandidateTechnicalProfile = {
  qualification: "",
  major: "",
  specialization: "",
  institution_id: "",
  institution_name: "",
  institution_country: "",
  institution_type: "",
  graduation_year: "",
  years_experience: "",
  last_job_title: "",
  last_employer: "",
  last_project_type: "",
  project_experience: "",
  technical_skills: "",
  tools_and_equipment: "",
  software_skills: "",
  certifications: "",
  licenses: "",
  english_level: "Not Specified",
  arabic_level: "Not Specified",
  gulf_experience: false,
  saudi_experience: false,
  final_company_decision: "Pending Company Review",
  decision_notes: "",
};

const CANDIDATE_INTELLIGENCE_LEVELS = ["None", "Basic", "Technical", "Professional", "Advanced"];
const COMPANY_DECISION_OPTIONS = ["Pending Company Review", "Shortlisted", "Interview", "Rejected", "On Hold", "Accepted"];
const LANGUAGE_LEVEL_OPTIONS = ["Not Specified", "Basic", "Intermediate", "Good", "Very Good", "Excellent", "Native"];

const CANDIDATE_UPLOAD_HEADERS = [
  "Request No",
  "Candidate Name",
  "Profession",
  "Nationality",
  "Gender",
  "Agency",
  "Passport No",
  "Mobile",
  "Email",
  "Status",
  "Medical Status",
  "Medical Date",
  "Ticket No",
  "Flight Date",
  "Arrival Date",
  "Notes",
  "Qualification",
  "Major",
  "Specialization",
  "Institution Name",
  "Institution Country",
  "Graduation Year",
  "Years Experience",
  "Last Job Title",
  "Last Employer",
  "Last Project Type",
  "Project Experience",
  "Technical Skills",
  "Tools & Equipment",
  "Software Skills",
  "Certifications",
  "Licenses",
  "English Level",
  "Arabic Level",
  "Gulf Experience",
  "Saudi Experience",
];

const CANDIDATE_UPLOAD_REQUIRED_HEADERS = [
  "Request No",
  "Candidate Name",
  "Profession",
  "Nationality",
  "Gender",
  "Passport No",
];

const emptyOfficeBulkUpdate = {
  status: "",
  medical_status: "",
  medical_date: "",
  ticket_no: "",
  flight_date: "",
  arrival_date: "",
  notes: "",
};

const emptyInterview = {
  candidate_name: "",
  profession: "",
  nationality: "",
  agency: "",
  project: "",
  request_no: "",
  interview_date: "",
  interview_type: "",
  interviewers: "",
  score: "",
  notes: "",
  candidate_id: "",
passport_no: "",
mobile: "",
  status: "Waiting",
};

const emptyDemobilization = {
  employee_name: "",
  employee_id: "",
  iqama_no: "",
  profession: "",
  nationality: "",
  gender: "",
  current_project: "",
  demob_date: "",
  reason: "Project End",
  status: "Available",
  suggested_request_no: "",
  suggested_project: "",
  match_score: "",
  ai_recommendation: "",
  invoice_required: "No",
  invoice_amount: "",
  invoice_type: "Redeployment Service",
  redeployment_cost: "500",
  estimated_new_recruitment_cost: "3650",
  estimated_saving: "",
  recruitment_avoided: "Yes",
  notes: "",
};

const emptyEmployee = {
  employee_no: "",
  employee_name: "",
  iqama_no: "",
  nationality: "",
  gender: "",
  profession: "",
  project_name: "",
  department: "",
  joining_date: "",
  contract_end_date: "",
  status: "Active",
  source_candidate_id: "",
  notes: "",
};

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}


function normalizeMatchText(value) {
  return normalize(value)
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function getMatchTokens(value) {
  const stopWords = new Set([
    "and",
    "or",
    "the",
    "of",
    "for",
    "في",
    "من",
    "و",
    "عامل",
    "فني",
  ]);

  return normalizeMatchText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !stopWords.has(token));
}

function isCompatibleText(left, right) {
  const a = normalizeMatchText(left);
  const b = normalizeMatchText(right);

  if (!a || !b) return true;
  if (a === b || a.includes(b) || b.includes(a)) return true;

  const aTokens = getMatchTokens(a);
  const bTokens = getMatchTokens(b);
  if (!aTokens.length || !bTokens.length) return false;

  const shared = aTokens.filter((token) => bTokens.includes(token));
  return shared.length >= 1;
}

function isCompatibleVisaLineForRequestLine(reqLine, visaLine) {
  return (
    isCompatibleText(reqLine.profession, visaLine.profession) &&
    normalize(reqLine.nationality) === normalize(visaLine.nationality) &&
    (!reqLine.gender || !visaLine.gender || normalize(reqLine.gender) === normalize(visaLine.gender))
  );
}

function isSaudiNationality(value) {
  const text = normalize(value || "");
  const compact = text.replace(/[\s\-_()/]+/g, "");

  const arabicCompact = text
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\s\-_()/]+/g, "");

  return (
    [
      "saudi",
      "saudiarabia",
      "ksa",
      "kingdomofsaudiarabia",
    ].includes(compact) ||
    compact.includes("saudi") ||
    [
      "سعودي",
      "سعوديه",
      "السعوديه",
      "المملكهالعربيهالسعوديه",
    ].includes(arabicCompact) ||
    arabicCompact.includes("سعود")
  );
}

function isSaudiRequest(request) {
  return request?.recruitment_type === "Saudi" || isSaudiNationality(request?.nationality);
}

function isSaudiCandidate(candidate, requests = []) {
  const relatedRequest = requests.find((r) => String(r.request_no || "") === String(candidate?.request_no || ""));
  return isSaudiRequest(relatedRequest) || isSaudiNationality(candidate?.nationality);
}


function getRowValue(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") return String(row[key]).trim();
  }
  return "";
}


const REPLACEMENT_STATUSES = ["KSA Medical Failed", "Refused to Work", "Absconded"];

function isReplacementStatus(status) {
  return REPLACEMENT_STATUSES.includes(status);
}

function getCandidateTotalCost(candidate) {
  return (
    Number(candidate?.visa_fees || 0) +
    Number(candidate?.agency_commission || 0) +
    Number(candidate?.ticket_cost || 0) +
    Number(candidate?.medical_ksa_cost || 0)
  );
}

function generateContractUrl(candidate) {
  const ref = candidate?.id || candidate?.passport_no || Date.now();
  return `pending-contract://${ref}`;
}

async function triggerExternalNotification(type, data = {}) {
  const payload = {
    company_id: data.company_id || null,
    user_id: data.user_id || null,
    agency_id: data.agency_id || null,
    type,
    title: data.title || type,
    message: data.message || data.provider_message || data.candidate_name || type,
    priority: data.priority || "Medium",
    status: "Unread",
    related_table: data.related_table || "",
    related_id: data.related_id || "",
    data,
    created_at: new Date().toISOString(),
  };

  try {
    await supabase.from("notification_events").insert([payload]);
  } catch (error) {
    console.warn("notification_events log failed", error?.message || error);
  }

  const webhookUrl = import.meta.env?.VITE_NOTIFICATION_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log("External notification prepared", payload);
    return;
  }

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.warn("External notification failed", error?.message || error);
  }
}


const REPORT_STUDIO_TEMPLATES = [
  { id: "ceo_monthly", icon: "👔", title: "CEO Executive Report", category: "Executive", description: "High-level summary, KPIs, risks and executive actions." },
  { id: "board_presentation", icon: "📊", title: "Executive Board Presentation", category: "Executive", description: "Board-ready presentation structure with highlights and decisions." },
  { id: "weekly_recruitment", icon: "👥", title: "Weekly Recruitment Report", category: "Recruitment", description: "Pipeline, candidate gaps, interviews and recruiter follow-up." },
  { id: "mobilization_status", icon: "✈️", title: "Visa & Mobilization Report", category: "Operations", description: "Visa allocation, authorizations, travel, arrivals and joining." },
  { id: "agency_evaluation", icon: "🏢", title: "Agency Performance Report", category: "Agencies", description: "Agency ranking, SLA risk, submissions and recommendations." },
  { id: "finance_summary", icon: "💰", title: "Budget & Finance Summary", category: "Finance", description: "Cost, budget variance and financial visibility from current records." },
  { id: "project_progress", icon: "📋", title: "Project Progress Report", category: "Operations", description: "Project-level progress, bottlenecks and delivery status." },
  { id: "client_progress", icon: "📣", title: "Client Progress Report", category: "Executive", description: "Clean client-facing bilingual progress summary." },
];

const REPORT_STUDIO_OUTPUTS = ["PowerPoint", "Word", "PDF", "Excel"];
const REPORT_STUDIO_LANGUAGES = ["Arabic", "English", "Bilingual"];
const REPORT_STUDIO_SECTIONS = [
  "Executive Summary",
  "KPI Dashboard",
  "Charts",
  "Tables",
  "AI Insights",
  "Operational Changes",
  "Risks",
  "Recommendations",
  "Action Plan",
  "Appendices",
];

const AGREEMENT_TEMPLATE_TYPES = [
  "Standard Recruitment SLA",
  "High Volume Mobilization SLA",
  "Premium Agency Partnership",
  "Project-Based Recruitment SLA",
];

const AGREEMENT_STATUSES = ["Draft", "Pending Signature", "Active", "Expired", "Terminated", "Rejected"];


const DEFAULT_AI_AGENT_SETTINGS = {
  is_active: true,
  mode: "auto_notify_manager",
  auto_manager_approval: true,
  auto_followup_agencies: false,
  allow_auto_agency_emails: false,
  run_in_background: true,
  client_auto_enabled: false,
  manager_approval_email: "",
  agency_reminder_after_days: 3,
  escalation_after_days: 7,
  daily_brief_enabled: true,
  daily_brief_time: "08:00",
  max_auto_actions_per_run: 5,
  cooldown_minutes: 60,
  max_actions_per_hour: 20,
  max_retry_attempts: 3,
};

const AI_AGENT_MODE_OPTIONS = [
  "off",
  "suggest_only",
  "auto_notify_manager",
  "auto_followup_agencies",
  "full_auto",
];

function normalizeAIAgentSettings(row = {}) {
  return {
    ...DEFAULT_AI_AGENT_SETTINGS,
    ...(row || {}),
    is_active: row?.is_active !== false,
    auto_manager_approval: row?.auto_manager_approval !== false,
    auto_followup_agencies: Boolean(row?.auto_followup_agencies),
    allow_auto_agency_emails: Boolean(row?.allow_auto_agency_emails),
    run_in_background: row?.run_in_background !== false,
    client_auto_enabled: Boolean(row?.client_auto_enabled),
    agency_reminder_after_days: Number(row?.agency_reminder_after_days || DEFAULT_AI_AGENT_SETTINGS.agency_reminder_after_days),
    escalation_after_days: Number(row?.escalation_after_days || DEFAULT_AI_AGENT_SETTINGS.escalation_after_days),
    max_auto_actions_per_run: Number(row?.max_auto_actions_per_run || DEFAULT_AI_AGENT_SETTINGS.max_auto_actions_per_run),
    cooldown_minutes: Number(row?.cooldown_minutes || DEFAULT_AI_AGENT_SETTINGS.cooldown_minutes),
    max_actions_per_hour: Number(row?.max_actions_per_hour || DEFAULT_AI_AGENT_SETTINGS.max_actions_per_hour),
    max_retry_attempts: Number(row?.max_retry_attempts || DEFAULT_AI_AGENT_SETTINGS.max_retry_attempts),
  };
}


function App() {
  const [activePage, setActivePage] = useState("Dashboard");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const [requests, setRequests] = useState([]);
  const [requestLines, setRequestLines] = useState([]);
  const [visaRecords, setVisaRecords] = useState([]);
  const [visaBatchLines, setVisaBatchLines] = useState([]);
  const [visaAuthorizations, setVisaAuthorizations] = useState([]);
  const [visaAllocations, setVisaAllocations] = useState([]);
const [agencies, setAgencies] = useState([]);
const [agencyAgreements, setAgencyAgreements] = useState([]);
const [agencyScores, setAgencyScores] = useState([]);
const [agencyScoreHistory, setAgencyScoreHistory] = useState([]);
const [agencyPenalties, setAgencyPenalties] = useState([]);
const [agreementEditingId, setAgreementEditingId] = useState(null);

const emptyAgreement = {
  agreement_no: "",
  agency_name: "",
  template_type: "Standard Recruitment SLA",
  policy_name: "Standard Recruitment Agency Policy",
  signed_by_company: "",
  signed_by_agency: "",
  company_signature: "",
  agency_signature: "",
  status: "Draft",
  sla_days: 60,
  response_sla_hours: 24,
  update_frequency_days: 7,
  delay_penalty_type: "Fixed Amount Per Delayed Day",
  delay_penalty_amount: "",
  delay_penalty_after_days: "",
  financial_guarantee_required: "No",
  financial_guarantee_amount: "",
  replacement_guarantee_days: 90,
  payment_terms: "Payment after arrival and joining confirmation unless otherwise agreed.",
  cancellation_terms: "The company may suspend allocation or terminate the agreement in case of repeated SLA breach, data manipulation, or non-compliance.",
  effective_date: "",
  expiry_date: "",
  terms: `AGENCY SERVICE LEVEL AGREEMENT / اتفاقية مستوى خدمة مكتب الاستقدام

This agreement defines the recruitment service level, update commitment, company-defined labor SLA delay penalty, replacement guarantee and financial guarantee requirements between the company and the recruitment agency.

تحدد هذه الاتفاقية مستوى الخدمة المطلوب من مكتب الاستقدام، والالتزام بتحديث البيانات، وغرامة تأخير العمالة عن SLA حسب قرار الشركة، وضمان الاستبدال، ومتطلبات الضمان المالي بين الشركة والمكتب.`,
};

const [agreementForm, setAgreementForm] = useState(emptyAgreement);

const [marketplaceRequests, setMarketplaceRequests] = useState([]);
const [marketplaceDeals, setMarketplaceDeals] = useState([]);
const [marketplaceInvoices, setMarketplaceInvoices] = useState([]);
const [marketplaceCollections, setMarketplaceCollections] = useState([]);
const [notifications, setNotifications] = useState([]);
const [emailLogs, setEmailLogs] = useState([]);
const [emailTemplates, setEmailTemplates] = useState([]);
const [notificationFilter, setNotificationFilter] = useState("All");
const [notificationSearch, setNotificationSearch] = useState("");
const [emailTemplateEditingId, setEmailTemplateEditingId] = useState(null);
const emptyEmailTemplate = {
  template_key: "",
  template_name: "",
  category: "Recruitment",
  language: "Bilingual",
  subject: "",
  body: "",
  is_active: true,
};
const [emailTemplateForm, setEmailTemplateForm] = useState(emptyEmailTemplate);
const [notificationOpen, setNotificationOpen] = useState(false);
const [marketplaceRequestEditingId, setMarketplaceRequestEditingId] = useState(null);

const emptyMarketplaceRequest = {
  request_no: "",
  client_name: "",
  profession: "",
  nationality: "",
  gender: "",
  quantity: "",
  duration_months: 12,
  monthly_rate: "",
  status: "Open",
  notes: "",
};

const [marketplaceRequestForm, setMarketplaceRequestForm] = useState(emptyMarketplaceRequest);
const [users, setUsers] = useState([]);
const [companies, setCompanies] = useState([]);
const [companyEditingId, setCompanyEditingId] = useState(null);
const [companyForm, setCompanyForm] = useState({
  name: "",
  domain: "",
  status: "Active",
  subscription_plan: "Trial",
  subscription_status: "Active",
  subscription_start: "",
  subscription_end: "",
  max_users: 5,
  notes: "",
});

const emptyCompanyEmailSettings = {
  mode: "platform",
  provider: "SMTP",
  smtp_host: "",
  smtp_port: "465",
  smtp_secure: "true",
  smtp_username: "",
  smtp_password: "",
  from_name: "",
  from_email: "",
  reply_to: "",
  agreements_email: "",
  notifications_email: "",
  support_email: "",
  test_email: "",
  is_active: true,
};
const [companyEmailSettings, setCompanyEmailSettings] = useState(null);
const [emailSettingsForm, setEmailSettingsForm] = useState(emptyCompanyEmailSettings);
const [emailSettingsLoading, setEmailSettingsLoading] = useState(false);
const [emailSettingsMessage, setEmailSettingsMessage] = useState("");
const [userEditingId, setUserEditingId] = useState(null);
const [userForm, setUserForm] = useState({
  name: "",
  email: "",
  password: "",
  role: "Viewer",
  status: "Active",
  agency_id: "",
  agency_name: "",
});
const [candidates, setCandidates] = useState([]);
const [candidateTechnicalProfiles, setCandidateTechnicalProfiles] = useState([]);
const [educationInstitutions, setEducationInstitutions] = useState([]);
const [candidateTechnicalForm, setCandidateTechnicalForm] = useState(emptyCandidateTechnicalProfile);
const [interviews, setInterviews] = useState([]);
const [mobilizations, setMobilizations] = useState([]);
const [demobilizations, setDemobilizations] = useState([]);
const [employees, setEmployees] = useState([]);
const [employeeEditingId, setEmployeeEditingId] = useState(null);
const [employeeForm, setEmployeeForm] = useState(emptyEmployee);
const [demobilizationEditingId, setDemobilizationEditingId] = useState(null);
const [demobilizationForm, setDemobilizationForm] = useState(emptyDemobilization);
const [demobAiSuggestion, setDemobAiSuggestion] = useState(null);
const [mobilizationEditingId, setMobilizationEditingId] = useState(null);
const [mobilizationForm, setMobilizationForm] = useState({
  candidate_id: "",
  request_no: "",
  candidate_name: "",
  profession: "",
  nationality: "",
  medical_status: "Pending",
  medical_date: "",
  visa_status: "Pending",
  visa_date: "",
  ticket_no: "",
  flight_date: "",
  arrival_date: "",
  joining_date: "",
  mobilization_status: "New",
  remarks: "",
});
const [countries, setCountries] = useState([]);
const [professions, setProfessions] = useState([]);
const [selectedVisa,setSelectedVisa] = useState(null);
const [selectedRequest, setSelectedRequest] = useState(null);
const [showAuthForm,setShowAuthForm] = useState(false);

const [activeReport, setActiveReport] = useState("all");
const [selectedMobilizationRequestNo, setSelectedMobilizationRequestNo] = useState("");
const [currentUser, setCurrentUser] = useState(() => {
  try {
    return JSON.parse(
      localStorage.getItem("visaflow_user") ||
        sessionStorage.getItem("visaflow_user") ||
        "null"
    );
  } catch {
    return null;
  }
});
const [agencyClientAccess, setAgencyClientAccess] = useState([]);
const [agencyWorkspaceLoading, setAgencyWorkspaceLoading] = useState(false);
const [activeAgencyCompanyId, setActiveAgencyCompanyId] = useState(() =>
  sessionStorage.getItem("visaflow_agency_company_id") || ""
);
const [activeAgencyCompanyName, setActiveAgencyCompanyName] = useState(() =>
  sessionStorage.getItem("visaflow_agency_company_name") || ""
);
const DEFAULT_COMPANY_ID = "";
const rawCurrentRole = String(currentUser?.role || "").trim();
const isCurrentAgencyUser = rawCurrentRole.toLowerCase() === "agency";

const isCurrentPlatformUser = [
  "platform owner",
  "platform accounts user",
  "platform support user",
].includes(rawCurrentRole.toLowerCase());

const currentCompanyId = isCurrentPlatformUser
  ? ""
  : isCurrentAgencyUser
    ? (activeAgencyCompanyId || currentUser?.active_company_id || currentUser?.company_id || "")
    : (currentUser?.company_id || "");

function withCompany(payload = {}) {
  if (!currentCompanyId && !isCurrentPlatformUser) {
    throw new Error("Company ID is missing. Action blocked to prevent cross-company data mixing.");
  }

  return {
    ...payload,
    company_id: currentCompanyId,
  };
}

const [loginForm, setLoginForm] = useState({ email: "", password: "" });
const [loginLoading, setLoginLoading] = useState(false);
const [rememberMe, setRememberMe] = useState(true);
const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
const [resetEmail, setResetEmail] = useState("");
const [resetMessage, setResetMessage] = useState("");
const [resetLoading, setResetLoading] = useState(false);
const [loginLanguage, setLoginLanguage] = useState("EN");
const [showLoginPassword, setShowLoginPassword] = useState(false);
const [aiQuestion, setAiQuestion] = useState("اعطني ملخص تنفيذي عن أهم مخاطر التوظيف اليوم");
const [aiAnswer, setAiAnswer] = useState("");
const [aiLoading, setAiLoading] = useState(false);
const [aiLastRun, setAiLastRun] = useState("");
const [aiCommanderMode, setAiCommanderMode] = useState("Executive Brief");
const [aiCommanderLanguage, setAiCommanderLanguage] = useState("Arabic");
const [aiAgentLoading, setAiAgentLoading] = useState(false);
const [aiAgentLastRun, setAiAgentLastRun] = useState("");
const [aiAgentLog, setAiAgentLog] = useState("");
const [aiAgentSettings, setAiAgentSettings] = useState(DEFAULT_AI_AGENT_SETTINGS);
const [aiAgentSettingsSaving, setAiAgentSettingsSaving] = useState(false);
const [aiAgentSettingsMessage, setAiAgentSettingsMessage] = useState("");
const aiAgentAutoRunRef = useRef("");
const [offerModalOpen, setOfferModalOpen] = useState(false);
const [offerCandidate, setOfferCandidate] = useState(null);
const [offerSubject, setOfferSubject] = useState("");
const [offerBody, setOfferBody] = useState("");
const [offerLoading, setOfferLoading] = useState(false);
const [offerMessage, setOfferMessage] = useState("");
const [reportStudioForm, setReportStudioForm] = useState({
  reportName: "CEO Executive Report",
  templateId: "ceo_monthly",
  category: "Executive",
  project: "All",
  dateFrom: "",
  dateTo: "",
  language: "Bilingual",
  outputFormat: "PowerPoint",
  includeSections: [
    "Executive Summary",
    "KPI Dashboard",
    "Tables",
    "AI Insights",
    "Risks",
    "Recommendations",
    "Action Plan",
  ],
  confidential: true,
  companyLogo: true,
  visaFlowLogo: true,
  aiRecommendations: true,
  comparePreviousPeriod: false,
});
const [reportStudioResult, setReportStudioResult] = useState("");
const [reportStudioLastRun, setReportStudioLastRun] = useState("");

const [platformClients, setPlatformClients] = useState([]);
const [subscriptionInvoices, setSubscriptionInvoices] = useState([]);
const [supportTickets, setSupportTickets] = useState([]);
const [systemBackups, setSystemBackups] = useState([]);
const [systemRestoreRequests, setSystemRestoreRequests] = useState([]);
const [systemActivityLogs, setSystemActivityLogs] = useState([]);
const [activityFilters, setActivityFilters] = useState({
  requestNo: "",
  moduleName: "All",
  actionType: "All",
  dateFrom: "",
  dateTo: "",
});
const [companyReportClient, setCompanyReportClient] = useState(null);
const [companyReportRows, setCompanyReportRows] = useState([]);
const [companyReportLoading, setCompanyReportLoading] = useState(false);
const [selectedPlatformClientUsers, setSelectedPlatformClientUsers] = useState(null);
const [platformClientEditingId, setPlatformClientEditingId] = useState(null);
const [subscriptionInvoiceEditingId, setSubscriptionInvoiceEditingId] = useState(null);
const [supportTicketEditingId, setSupportTicketEditingId] = useState(null);

const emptyPlatformClient = {
  company_name: "",
  domain: "",
  subscription_status: "Active",
  users_count: 0,
  start_date: "",
  end_date: "",
  monthly_amount: 0,
  operational_company_id: "",
  admin_name: "",
  admin_email: "",
  admin_password: "",
  admin_role: "Admin",
};

const emptySubscriptionInvoice = {
  client_id: "",
  invoice_no: "",
  amount: 0,
  status: "Unpaid",
  due_date: "",
  paid_at: "",
};

const emptySupportTicket = {
  client_id: "",
  ticket_no: "",
  title: "",
  description: "",
  status: "Open",
  priority: "Medium",
  created_by: "",
};

const [platformClientForm, setPlatformClientForm] = useState(emptyPlatformClient);
const [subscriptionInvoiceForm, setSubscriptionInvoiceForm] = useState(emptySubscriptionInvoice);
const [supportTicketForm, setSupportTicketForm] = useState(emptySupportTicket);

function normalizeUserRole(role) {
  const value = String(role || "Viewer").trim();
  if (value === "Recruitment") return "Recruitment Officer";

  const matchedRole = ROLE_OPTIONS.find(
    (item) => item.toLowerCase() === value.toLowerCase()
  );

  return matchedRole || value || "Viewer";
}

const currentRole = normalizeUserRole(currentUser?.role);

function isPlatformRole(role) {
  return [
    "Platform Owner",
    "Platform Accounts User",
    "Platform Support User",
  ].includes(normalizeUserRole(role));
}

const PLATFORM_PAGES = [
  "Platform Dashboard",
  "Platform Intelligence",
  "Companies Management",
  "Platform Users",
  "Subscription Invoices",
  "Company Requests Report",
  "Backup Center",
  "Central Support",
];

const PLATFORM_ACCOUNT_PAGES = [
  "Platform Dashboard",
  "Platform Intelligence",
  "Companies Management",
  "Platform Users",
  "Subscription Invoices",
  "Company Requests Report",
];

const PLATFORM_SUPPORT_PAGES = [
  "Platform Dashboard",
  "Central Support",
];

const ROLE_PAGES = {
  // SaaS owner only. This role manages the platform, not client operations.
  "Platform Owner": PLATFORM_PAGES,
  "Platform Accounts User": PLATFORM_ACCOUNT_PAGES,

"Platform Support User": PLATFORM_SUPPORT_PAGES,

  // Company Admin: full tenant administration and all company operations, excluding SaaS platform screens.
  Admin: [...PAGES.filter((page) => !PLATFORM_PAGES.includes(page)), "RequestDetails"],

  // CEO: executive visibility and read-only reporting.
  CEO: [
    "Executive Dashboard",
    "AI Commander",
    "AI Agent",
    "AI Report Studio",
    "Dashboard",
    "Recruitment Performance",
    "Agency Ranking",
    "Agency Performance",
    "Penalty Register",
    "Reports",
    "Notifications",
  ],

  // Operations Manager: operational delivery, workforce, mobilization and demobilization.
  "Operations Manager": [
    "Executive Dashboard",
    "AI Commander",
    "AI Agent",
    "AI Report Studio",
    "Dashboard",
    "Requests",
    "RequestDetails",
    "Mobilization",
    "Employees",
    "Demobilization",
    "Workforce Marketplace",
    "Recruitment Performance",
    "Agency Performance",
    "Notifications",
    "Reports",
  ],

  // Project Manager: project-level operational follow-up.
  "Project Manager": [
    "Dashboard",
    "Requests",
    "RequestDetails",
    "Mobilization",
    "Employees",
    "Demobilization",
    "Reports",
    "Notifications",
  ],

  // Recruitment Manager: recruitment control, approvals, recruiter KPI and agency performance.
  "Recruitment Manager": [
    "Executive Dashboard",
    "AI Commander",
    "AI Agent",
    "AI Report Studio",
    "Dashboard",
    "Requests",
    "Saudi Hiring",
    "RequestDetails",
    "Candidates",
    "Interviews",
    "Rejected Candidates",
    "Visa Inventory",
    "Visa Allocation",
    "Authorization",
    "Cancellation Register",
    "Mobilization",
    "Employees",
    "Demobilization",
    "Workforce Marketplace",
    "Agencies",
    "Agency Agreements",
    "Agency Ranking",
    "Agency Performance",
    "Penalty Register",
    "Recruitment Performance",
    "Notifications",
    "Reports",
  ],

  // Recruiter / Recruitment Officer: daily recruitment operation only.
  "Recruitment Officer": [
    "Dashboard",
    "AI Agent",
    "Requests",
    "Saudi Hiring",
    "RequestDetails",
    "Candidates",
    "Interviews",
    "Rejected Candidates",
    "Visa Inventory",
    "Authorization",
    "Mobilization",
    "Notifications",
  ],

  "Visa Team": [
    "Dashboard",
    "Visa Inventory",
    "Visa Allocation",
    "Authorization",
    "Cancellation Register",
    "Notifications",
    "Reports",
  ],

  Agency: [
    "Office Portal",
    "Notifications",
  ],

  Viewer: [
    "Executive Dashboard",
    "Dashboard",
    "Reports",
    "Notifications",
  ],
};

const visiblePages = currentRole === "Platform Owner"
  ? PLATFORM_PAGES
  : (ROLE_PAGES[currentRole] || ROLE_PAGES.Viewer);
const roleActions = ACTION_PERMISSIONS[currentRole] || ACTION_PERMISSIONS.Viewer;
const hasAction = (action) => roleActions.includes(action);

const isPlatformOwner = currentRole === "Platform Owner";
const isPlatformAccountsUser = currentRole === "Platform Accounts User";
const isPlatformSupportUser = currentRole === "Platform Support User";

const canManagePlatform = [
  "Platform Owner",
  "Platform Accounts User",
  "Platform Support User",
].includes(currentRole);

const canManagePlatformAccounts = [
  "Platform Owner",
  "Platform Accounts User",
].includes(currentRole);

const canManagePlatformSupport = [
  "Platform Owner",
  "Platform Support User",
].includes(currentRole);

const canManageUsers =
  currentRole === "Admin" || canManagePlatformAccounts;
const canManagePermissions = currentRole === "Admin";
const canManageAgencies = ["Admin", "Recruitment Manager"].includes(currentRole);
const canManageAgencyAgreements = ["Admin", "Recruitment Manager"].includes(currentRole);
const canApprovePenalties = ["Admin", "Recruitment Manager", "CEO"].includes(currentRole);
const canViewAgenciesOnly = ["CEO", "Operations Manager"].includes(currentRole);

const canCreateRequest = ["Admin", "Operations Manager", "Project Manager", "Recruitment Manager", "Recruitment Officer"].includes(currentRole);
const canEditRequest = ["Admin", "Operations Manager", "Project Manager", "Recruitment Manager", "Recruitment Officer"].includes(currentRole);
const canApproveRequest = ["Admin", "Recruitment Manager"].includes(currentRole);
const canDeleteRequest = currentRole === "Admin";

const canManageVisas = ["Admin", "Visa Team"].includes(currentRole);
const canManageCandidates = ["Admin", "Recruitment Manager", "Recruitment Officer"].includes(currentRole);
const canManageOfficePortal = ["Admin", "Agency"].includes(currentRole);
const canViewCandidateIntelligence = Boolean(currentUser) && currentRole !== "Agency" && !isCurrentPlatformUser;
const canUseCandidateUploadTemplate = canManageCandidates || canManageOfficePortal;
const canViewEmailAdministration = currentRole !== "Agency";
const canManageInterviews = ["Admin", "Recruitment Manager", "Recruitment Officer"].includes(currentRole);
const canManageMobilization = ["Admin", "Recruitment Manager", "Recruitment Officer", "Operations Manager", "Project Manager"].includes(currentRole);
const canManageDemobilization = ["Admin", "Operations Manager", "Project Manager"].includes(currentRole);
const canManageEmployees = ["Admin", "Operations Manager", "Project Manager"].includes(currentRole);
const canManageMarketplace = ["Admin", "Recruitment Manager", "Operations Manager"].includes(currentRole);
const canExport = hasAction("export") || ["Admin", "CEO", "Operations Manager", "Project Manager", "Recruitment Manager", "Visa Team", "Viewer"].includes(currentRole);

const getUniqueAgencyWorkspaces = (rows = []) => {
  const map = new Map();

  rows.forEach((row) => {
    const companyId = row.company_id || row.operational_company_id;
    if (!companyId) return;

    const key = String(companyId);
    if (!map.has(key)) {
      map.set(key, {
        ...row,
        company_id: companyId,
        company_name: row.company_name || row.client_name || row.company || row.name || `Client ${map.size + 1}`,
      });
    }
  });

  return Array.from(map.values()).sort((a, b) =>
    String(a.company_name || "").localeCompare(String(b.company_name || ""))
  );
};

async function loadAgencyClientAccess(user = currentUser, autoSelect = true) {
  const effectiveUser = user || currentUser;

  if (!effectiveUser || normalizeUserRole(effectiveUser.role) !== "Agency") {
    setAgencyClientAccess([]);
    return [];
  }

  if (!effectiveUser.id || !effectiveUser.agency_id) {
    setAgencyClientAccess([]);
    return [];
  }

  setAgencyWorkspaceLoading(true);

  try {
    const { data: accessRows, error: accessError } = await supabase
      .from("agency_company_user_access")
      .select("*")
      .eq("status", "Active")
      .eq("user_id", effectiveUser.id)
      .eq("agency_id", effectiveUser.agency_id)
      .range(0, 500);

    if (accessError) {
      console.warn("agency_company_user_access:", accessError.message);
      setAgencyClientAccess([]);
      return [];
    }

    const companyIds = Array.from(
      new Set((accessRows || []).map((row) => row.company_id).filter(Boolean))
    );

    if (companyIds.length === 0) {
      setAgencyClientAccess([]);
      return [];
    }

    const { data: companyRows, error: companyError } = await supabase
      .from("companies")
      .select("id, name, status, subscription_status")
      .in("id", companyIds)
      .range(0, 500);

    if (companyError) {
      console.warn("companies for agency workspaces:", companyError.message);
      setAgencyClientAccess([]);
      return [];
    }

    const companiesById = new Map((companyRows || []).map((company) => [String(company.id), company]));

    const workspaces = getUniqueAgencyWorkspaces(
      (accessRows || [])
        .map((row) => {
          const company = companiesById.get(String(row.company_id));
          if (!company) return null;

          return {
            ...row,
            company_id: row.company_id,
            company_name: company.name || `Client ${row.company_id}`,
            company_status: company.status || "Active",
            subscription_status: company.subscription_status || "Active",
            agency_name: effectiveUser.agency_name || row.agency_name || "Agency Portal",
          };
        })
        .filter(Boolean)
        .filter((row) => String(row.company_status || "Active").toLowerCase() === "active")
    );

    setAgencyClientAccess(workspaces);

    if (workspaces.length > 0 && autoSelect) {
      const currentId = activeAgencyCompanyId || effectiveUser.active_company_id || "";
      const selected = workspaces.find((item) => String(item.company_id) === String(currentId)) || workspaces[0];
      switchAgencyWorkspace(selected, { silent: true, user: effectiveUser });
    }

    return workspaces;
  } catch (error) {
    console.warn("agency workspace load failed", error?.message || error);
    setAgencyClientAccess([]);
    return [];
  } finally {
    setAgencyWorkspaceLoading(false);
  }
}

function switchAgencyWorkspace(workspace, options = {}) {
  if (!workspace?.company_id) return;

  const companyId = String(workspace.company_id || "");
  const companyName = workspace.company_name || "Client Workspace";

  sessionStorage.setItem("visaflow_agency_company_id", companyId);
  sessionStorage.setItem("visaflow_agency_company_name", companyName);
  setActiveAgencyCompanyId(companyId);
  setActiveAgencyCompanyName(companyName);

  setCurrentUser((prev) => {
    const base = prev || options.user || currentUser || {};
    const updated = {
      ...base,
      active_company_id: companyId,
      active_company_name: companyName,
    };

    const storage = localStorage.getItem("visaflow_user") ? localStorage : sessionStorage;
    storage.setItem("visaflow_user", JSON.stringify(updated));
    return updated;
  });

  if (!options.silent) {
    setSearch("");
    setFilterStatus("All");
    setActivePage("Office Portal");
  }
}

function handleAgencyWorkspaceChange(companyId) {
  const workspace = agencyClientAccess.find((item) => String(item.company_id) === String(companyId));
  if (workspace) switchAgencyWorkspace(workspace);
}

function getActiveAgencyWorkspaceName() {
  return (
    agencyClientAccess.find((item) => String(item.company_id) === String(currentCompanyId))?.company_name ||
    activeAgencyCompanyName ||
    currentUser?.active_company_name ||
    currentUser?.company_name ||
    "Client Workspace"
  );
}

const [authForm,setAuthForm] = useState({

  agency:"",
  authorization_no:"",
  allocated_qty:0
});
const [allocationForm, setAllocationForm] = useState({
  request_no: "",
  visa_no: "",
  visa_batch_line_id: "",
  allocated_qty: 0,
});
const [allocationDraft, setAllocationDraft] = useState({});
const [allocationSearch, setAllocationSearch] = useState("");

async function saveAuthorization(){
  if (!canManageVisas) return alert("You do not have permission to manage authorizations.");
  if (!selectedVisa) {
  alert("Please select visa allocation");
  return;
}
const allocationQty = Number(
  visaAllocations.find((a) => String(a.id) === String(selectedVisa?.id))
    ?.allocated_qty || 0
);

const alreadyAuthorized = visaAuthorizations
  .filter((a) => {
    if (a.status === "Cancelled") return false;

    // New accurate match: same visa allocation line.
    if (a.visa_allocation_id) {
      return String(a.visa_allocation_id) === String(selectedVisa?.id);
    }

    // Backward-compatible fallback for old authorization records.
    return (
      String(a.visa_no) === String(selectedVisa?.visa_no) &&
      String(a.request_no) === String(selectedVisa?.request_no) &&
      (!a.profession || !selectedVisa?.profession || normalize(a.profession) === normalize(selectedVisa.profession)) &&
      (!a.nationality || !selectedVisa?.nationality || normalize(a.nationality) === normalize(selectedVisa.nationality)) &&
      (!a.gender || !selectedVisa?.gender || normalize(a.gender) === normalize(selectedVisa.gender))
    );
  })
  .reduce((sum, a) => sum + Number(a.allocated_qty || 0), 0);

const requestedAuthQty = Number(authForm.allocated_qty || 0);

if (alreadyAuthorized + requestedAuthQty > allocationQty) {
  alert(
    `Cannot authorize more than allocated quantity. Allocated: ${allocationQty}, Already authorized: ${alreadyAuthorized}, Remaining: ${allocationQty - alreadyAuthorized}`
  );
  return;
}
const payload={
  visa_id: visaRecords.find(
  (v) => String(v.visa_no) === String(selectedVisa?.visa_no)
)?.id,

visa_no: selectedVisa?.visa_no,
request_no: selectedVisa?.request_no,
visa_allocation_id: selectedVisa?.id || null,
visa_batch_line_id: selectedVisa?.visa_batch_line_id || null,
profession: selectedVisa?.profession || "",
nationality: selectedVisa?.nationality || "",
gender: selectedVisa?.gender || "",
authorization_no: authForm.authorization_no,
agency: authForm.agency,
office_country: authForm.office_country,
allocated_qty: Number(authForm.allocated_qty || 0),
received_candidates: 0,
interview_passed: 0,
mobilized: 0,
status: "Open"
};
const {error}=await supabase
.from("visa_authorizations")
.insert([withCompany(payload)]);

if(error){
alert(error.message);
return;
}

loadVisaAuthorizations();

setShowAuthForm(false);

setAuthForm({
agency:"",
authorization_no:"",
allocated_qty:0
});

}
async function cancelAuthorization(id) {
  if (!canManageVisas) return alert("You do not have permission to cancel authorizations.");
  const cancellationNo = window.prompt("Enter cancellation authorization number:");

  if (!cancellationNo) {
    alert("Cancellation number is required");
    return;
  }

  const cancellationDate = window.prompt("Enter cancellation date (YYYY-MM-DD):");

  if (!cancellationDate) {
    alert("Cancellation date is required");
    return;
  }

  const { error } = await supabase
    .from("visa_authorizations")
    .update({
      status: "Cancelled",
      cancellation_no: cancellationNo,
      cancelled_at: cancellationDate,
    })
    .eq("id", id);

  if (error) {
    alert(error.message);
    return;
  }

  await loadVisaAuthorizations();
  alert("Authorization cancelled");
}
function openAuthorization(item){
  // Authorization must be linked to a specific visa allocation line, not only visa batch.
  // When coming from Visa Inventory, clear the selection and let the user choose the exact allocation line.
  if (!item?.allocated_qty || !item?.visa_batch_line_id) {
    setSelectedVisa(null);
  } else {
    const line = visaInventoryLines.find((vLine) => String(vLine.id) === String(item.visa_batch_line_id || ""));
    setSelectedVisa({
      id: item.id,
      visa_no: item.visa_no,
      request_no: item.request_no,
      visa_batch_line_id: item.visa_batch_line_id || "",
      profession: line?.profession || item.profession || "-",
      nationality: line?.nationality || item.nationality || "-",
      gender: line?.gender || item.gender || "-",
      allocated_qty: Number(item.allocated_qty || 0),
    });
  }
  setActivePage("Authorization");
}
const getVisaLinesForBatch = (batch) => {
  if (!batch) return [];

  const storedLines = visaBatchLines
    .filter((line) => String(line.visa_batch_id || "") === String(batch.id || ""))
    .sort((a, b) => Number(a.line_no || 0) - Number(b.line_no || 0));

  if (storedLines.length > 0) return storedLines;

  if (batch.profession || batch.nationality || batch.gender || batch.quantity) {
    return [
      {
        id: `${batch.id}-legacy`,
        visa_batch_id: batch.id,
        line_no: 1,
        visa_no: batch.visa_no,
        profession: batch.profession || "",
        nationality: batch.nationality || "",
        gender: batch.gender || "",
        quantity: Number(batch.quantity || 0),
        notes: batch.notes || "",
        legacy: true,
      },
    ];
  }

  return [];
};

const visaInventoryLines = useMemo(() => {
  return visaRecords.flatMap((batch) => {
    const lines = getVisaLinesForBatch(batch);
    return lines.map((line) => ({
      ...line,
      batch_id: batch.id,
      visa_no: batch.visa_no,
      moi_no: batch.moi_no,
      project: batch.project,
      issue_date: batch.issue_date,
      expiry_date: batch.expiry_date,
      status: batch.status,
      batch_notes: batch.notes,
      batch,
    }));
  });
}, [visaRecords, visaBatchLines]);

function getVisaLineAllocatedQty(lineId, visaNo = "") {
  return visaAllocations
    .filter((allocation) => {
      if (lineId && String(allocation.visa_batch_line_id || "") === String(lineId)) return true;
      if (!lineId && visaNo && String(allocation.visa_no || "") === String(visaNo)) return true;
      return false;
    })
    .reduce((sum, allocation) => sum + Number(allocation.allocated_qty || 0), 0);
}

function getVisaLineRemainingQty(line) {
  if (!line) return 0;
  const allocated = line.legacy
    ? getVisaLineAllocatedQty("", line.visa_no)
    : getVisaLineAllocatedQty(line.id, line.visa_no);
  return Number(line.quantity || 0) - allocated;
}

function getVisaBatchTotalQty(batch) {
  return getVisaLinesForBatch(batch).reduce((sum, line) => sum + Number(line.quantity || 0), 0);
}

function getVisaBatchAllocatedQty(batch) {
  return getVisaLinesForBatch(batch).reduce((sum, line) => sum + getVisaLineAllocatedQty(line.id), 0);
}

function getVisaBatchRemainingQty(batch) {
  return getVisaBatchTotalQty(batch) - getVisaBatchAllocatedQty(batch);
}

function getVisaLineLabel(line) {
  if (!line) return "";
  return `${line.visa_no || "Visa"} | ${line.profession || "-"} | ${line.nationality || "-"} | ${line.gender || "-"} | Remaining: ${getVisaLineRemainingQty(line)}`;
}

const getVisaBalanceForRequest = (req) => {
  if (isSaudiNationality(req.nationality)) return 0;

  return visaInventoryLines
    .filter(
      (line) =>
        normalize(line.profession) === normalize(req.profession) &&
        normalize(line.nationality) === normalize(req.nationality) &&
        normalize(line.gender) === normalize(req.gender)
    )
    .reduce((sum, line) => sum + Math.max(getVisaLineRemainingQty(line), 0), 0);
};

const nonSaudiRequests = requests.filter(
  (r) => !isSaudiRequest(r)
);

const requestsWithVisa = nonSaudiRequests.filter(
  (r) => getVisaBalanceForRequest(r) >= Number(r.quantity || 0)
);

const requestsWithoutVisa = nonSaudiRequests.filter(
  (r) => getVisaBalanceForRequest(r) < Number(r.quantity || 0)
);

const extraVisaRequests = visaInventoryLines.filter((line) => {
  if (isSaudiNationality(line.nationality)) return false;

  const matchingRequestQty = requests
    .filter(
      (r) =>
        !isSaudiRequest(r) &&
        normalize(r.profession) === normalize(line.profession) &&
        normalize(r.nationality) === normalize(line.nationality) &&
        normalize(r.gender) === normalize(line.gender)
    )
    .reduce((sum, r) => sum + Number(r.quantity || 0), 0);

  return getVisaLineRemainingQty(line) > matchingRequestQty;
});
  async function deleteAllocation(id) {
  if (!canManageVisas) return alert("You do not have permission to delete allocations.");
  if (!confirm("Delete this allocation?")) return;

  const { error } = await supabase
    .from("visa_allocations")
    .delete()
    .eq("id", id);

  if (error) {
    alert(error.message);
    return;
  }

  await loadVisaAllocations();
}
  async function saveAllocation() {
  if (!canManageVisas) return alert("You do not have permission to manage visa allocations.");
  if (!allocationForm.request_no || !allocationForm.visa_batch_line_id || !allocationForm.allocated_qty) {
    alert("Please select request, visa line, and allocated quantity");
    return;
  }

  const req = requests.find((r) => String(r.request_no) === String(allocationForm.request_no));
  const selectedLine = visaInventoryLines.find((line) => String(line.id) === String(allocationForm.visa_batch_line_id));

  if (!req || !selectedLine) {
    alert("Selected request or visa line was not found");
    return;
  }

  const requestLinesForSelectedRequest = getRequestLinesForRequest(req).filter((line) => !isSaudiNationality(line.nationality));
  const selectedLineMatchesRequest = requestLinesForSelectedRequest.length === 0
    ? (
        isCompatibleText(req.profession, selectedLine.profession) &&
        normalize(req.nationality) === normalize(selectedLine.nationality) &&
        (!req.gender || !selectedLine.gender || normalize(req.gender) === normalize(selectedLine.gender))
      )
    : requestLinesForSelectedRequest.some((reqLine) => isCompatibleVisaLineForRequestLine(reqLine, selectedLine));

  if (!selectedLineMatchesRequest) {
    alert("Selected visa line does not match request profession, nationality, and gender");
    return;
  }

  const currentAllocationQty = allocationEditingId
    ? Number(visaAllocations.find((a) => String(a.id) === String(allocationEditingId))?.allocated_qty || 0)
    : 0;
  const available = getVisaLineRemainingQty(selectedLine) + currentAllocationQty;

  if (Number(allocationForm.allocated_qty) > available) {
    alert(`Only ${available} visas are available for this visa line`);
    return;
  }

  const payload = {
    request_no: allocationForm.request_no,
    visa_no: selectedLine.visa_no,
    visa_batch_line_id: selectedLine.legacy ? null : selectedLine.id,
    allocated_qty: Number(allocationForm.allocated_qty),
  };

  const result = allocationEditingId
    ? await supabase.from("visa_allocations").update(payload).eq("id", allocationEditingId)
    : await supabase.from("visa_allocations").insert([withCompany(payload)]);

  if (result.error) {
    alert(result.error.message);
    return;
  }

  setAllocationEditingId(null);
  setAllocationForm({
    request_no: "",
    visa_no: "",
    visa_batch_line_id: "",
    allocated_qty: 0,
  });

  await loadAll();
  alert(allocationEditingId ? "Allocation updated" : "Allocation saved");
}


function getRequestAllocationSummary(requestNo) {
  const req = requests.find((r) => String(r.request_no || "") === String(requestNo || ""));
  if (!req) {
    return {
      request: null,
      totalRequested: 0,
      totalAllocated: 0,
      remaining: 0,
      lines: [],
    };
  }

  const lines = getRequestLinesForRequest(req).filter((line) => !isSaudiNationality(line.nationality));
  const totalRequested = lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0) || Number(req.quantity || 0);
  const totalAllocated = visaAllocations
    .filter((allocation) => String(allocation.request_no || "") === String(requestNo || ""))
    .reduce((sum, allocation) => sum + Number(allocation.allocated_qty || 0), 0);

  return {
    request: req,
    totalRequested,
    totalAllocated,
    remaining: Math.max(totalRequested - totalAllocated, 0),
    lines,
  };
}

function getAllocationLineCurrentQty(lineId) {
  return Number(allocationDraft[String(lineId)] || 0);
}

function updateAllocationDraft(lineId, value, maxQty) {
  const qty = Math.max(0, Math.min(Number(value || 0), Number(maxQty || 0)));
  setAllocationDraft((prev) => ({
    ...prev,
    [String(lineId)]: qty,
  }));
}

async function saveSelectedAllocations() {
  if (!canManageVisas) return alert("You do not have permission to manage visa allocations.");
  if (!allocationForm.request_no) return alert("Please select request first.");

  const rows = Object.entries(allocationDraft)
    .map(([lineId, qty]) => {
      const line = visaInventoryLines.find((item) => String(item.id) === String(lineId));
      return { line, qty: Number(qty || 0) };
    })
    .filter((row) => row.line && row.qty > 0);

  if (rows.length === 0) return alert("Please enter quantity for at least one visa line.");

  const summary = getRequestAllocationSummary(allocationForm.request_no);
  const totalToAllocate = rows.reduce((sum, row) => sum + row.qty, 0);

  if (totalToAllocate > summary.remaining) {
    return alert(`Cannot allocate more than request remaining quantity. Remaining: ${summary.remaining}`);
  }

  for (const row of rows) {
    const available = getVisaLineRemainingQty(row.line);
    if (row.qty > available) {
      return alert(`Only ${available} visas are available for ${row.line.visa_no}`);
    }

    const lineMatchesRequest = summary.lines.length === 0 || summary.lines.some(
      (reqLine) => isCompatibleVisaLineForRequestLine(reqLine, row.line)
    );
    if (!lineMatchesRequest) {
      return alert(`Visa line ${row.line.visa_no} / ${row.line.profession || "-"} does not match this request.`);
    }
  }

  const payload = rows.map(({ line, qty }) =>
    withCompany({
      request_no: allocationForm.request_no,
      visa_no: line.visa_no,
      visa_batch_line_id: line.legacy ? null : line.id,
      allocated_qty: qty,
    })
  );

  const { error } = await supabase.from("visa_allocations").insert(payload);
  if (error) return alert(error.message);

  setAllocationDraft({});
  setAllocationForm({
    request_no: allocationForm.request_no,
    visa_no: "",
    visa_batch_line_id: "",
    allocated_qty: 0,
  });

  await loadAll();
  alert("Selected visa lines allocated successfully");
}


  const [auditLogs, setAuditLogs] = useState([]);

  const [requestForm, setRequestForm] = useState(emptyRequest);
  const [requestLineForm, setRequestLineForm] = useState(emptyRequestLine);
  const [requestLinesDraft, setRequestLinesDraft] = useState([]);
  const [requestEditingId, setRequestEditingId] = useState(null);
  const [visaForm, setVisaForm] = useState(emptyVisa);
  const [visaLineForm, setVisaLineForm] = useState(emptyVisaLine);
  const [visaLinesDraft, setVisaLinesDraft] = useState([]);
  const [visaEditingId, setVisaEditingId] = useState(null);
  const [agencyForm, setAgencyForm] = useState(emptyAgency);
  const [agencyEditingId, setAgencyEditingId] = useState(null);
  const [candidateForm, setCandidateForm] = useState(emptyCandidate);
  const [candidateEditingId, setCandidateEditingId] = useState(null);
  const [officeSelectedCandidateIds, setOfficeSelectedCandidateIds] = useState([]);
  const [officeBulkForm, setOfficeBulkForm] = useState(emptyOfficeBulkUpdate);
  const [officeBulkLoading, setOfficeBulkLoading] = useState(false);
  const [interviewForm, setInterviewForm] = useState(emptyInterview);
  const [interviewEditingId, setInterviewEditingId] = useState(null);
const [allocationEditingId, setAllocationEditingId] = useState(null);
  const candidateExcelInputRef = useRef(null);
  const requestExcelInputRef = useRef(null);
  const employeeExcelInputRef = useRef(null);
  const [excelRequestNo, setExcelRequestNo] = useState("");

  function updateForm(setter, field, value) {
    setter((prev) => ({ ...prev, [field]: value }));
  }

  function getProfessionLabel(profession = {}) {
    return profession?.name_en ? `${profession.name_ar || ""} - ${profession.name_en}`.trim() : profession?.name_ar || profession?.name_en || "";
  }

  function findProfessionRecord(value) {
    const target = normalizeMatchText(value);
    if (!target) return null;

    return professions.find((profession) => {
      const label = normalizeMatchText(getProfessionLabel(profession));
      const nameAr = normalizeMatchText(profession.name_ar);
      const nameEn = normalizeMatchText(profession.name_en);
      return (
        label === target ||
        nameAr === target ||
        nameEn === target ||
        (nameAr && target.includes(nameAr)) ||
        (nameEn && target.includes(nameEn))
      );
    }) || null;
  }

  function getCandidateProfessionIntelligence(professionValue) {
    const profession = findProfessionRecord(professionValue);
    const level = profession?.candidate_intelligence_level || (profession?.technical_profile_required ? "Technical" : "None");
    const enabled = profession?.technical_profile_required === true && level !== "None";

    return {
      profession,
      enabled,
      level: enabled ? level : "None",
      category: profession?.profession_category || "General",
      profile: profession?.candidate_intelligence_profile || "None",
      notes: profession?.intelligence_notes || "",
    };
  }

  const selectedCandidateIntelligence = getCandidateProfessionIntelligence(candidateForm.profession);

  function getInstitutionById(id) {
    if (!id) return null;
    return educationInstitutions.find((item) => String(item.id || "") === String(id || "")) || null;
  }

  function getLanguageScore(level) {
    const value = String(level || "Not Specified");
    if (value === "Native") return 100;
    if (value === "Excellent") return 95;
    if (value === "Very Good") return 85;
    if (value === "Good") return 75;
    if (value === "Intermediate") return 60;
    if (value === "Basic") return 40;
    return 20;
  }

  function getExperienceScore(years, level) {
    const value = Number(years || 0);

    if (level === "Advanced") {
      if (value >= 8) return 100;
      if (value >= 5) return 85;
      if (value >= 3) return 70;
      if (value >= 1) return 45;
      return 20;
    }

    if (level === "Professional") {
      if (value >= 6) return 95;
      if (value >= 4) return 85;
      if (value >= 2) return 70;
      if (value >= 1) return 50;
      return 25;
    }

    if (level === "Technical") {
      if (value >= 5) return 95;
      if (value >= 3) return 85;
      if (value >= 1) return 65;
      return 30;
    }

    if (level === "Basic") {
      if (value >= 3) return 85;
      if (value >= 1) return 65;
      return 35;
    }

    return 0;
  }

  function buildCandidateTechnicalScores(profileForm = candidateTechnicalForm, intelligence = selectedCandidateIntelligence) {
    if (!intelligence?.enabled) {
      return {
        profile_completed: false,
        missing_fields: [],
        education_score: 0,
        experience_score: 0,
        skills_score: 0,
        certification_score: 0,
        language_score: 0,
        data_completeness_score: 0,
        final_ai_score: 0,
        interview_priority: "Pending Review",
        ai_recommendation: "",
        ai_reasoning: "",
      };
    }

    const level = intelligence.level || "Technical";
    const institution = getInstitutionById(profileForm.institution_id);
    const missingFields = [];

    const requiredFields = level === "Basic"
      ? [
          ["qualification", "Qualification"],
          ["years_experience", "Years Experience"],
          ["last_job_title", "Last Job Title"],
        ]
      : [
          ["qualification", "Qualification"],
          ["major", "Major / Specialization"],
          ["institution_id", "Education Institution"],
          ["years_experience", "Years Experience"],
          ["technical_skills", "Skills"],
        ];

    requiredFields.forEach(([field, label]) => {
      if (!String(profileForm[field] || "").trim()) missingFields.push(label);
    });

    const baseInstitutionScore = institution
      ? Math.round((Number(institution.reputation_score || 40) + Number(institution.technical_strength_score || 40)) / 2)
      : 40;

    const recognition = String(institution?.recognition_status || "Needs Review");
    const educationScore = recognition === "Blacklisted"
      ? 0
      : Math.max(0, Math.min(100, baseInstitutionScore + (recognition === "Verified" ? 8 : recognition === "Recommended" ? 5 : 0)));

    const experienceScore = getExperienceScore(profileForm.years_experience, level);

    const skillsText = [
      profileForm.technical_skills,
      profileForm.tools_and_equipment,
      profileForm.software_skills,
      profileForm.project_experience,
    ].join(" ");
    const skillsParts = skillsText.split(/[,،\n]/).map((item) => item.trim()).filter(Boolean);
    const skillsScore = Math.min(100, 35 + skillsParts.length * 10 + (profileForm.project_experience ? 15 : 0));

    const certParts = String(profileForm.certifications || "").split(/[,،\n]/).map((item) => item.trim()).filter(Boolean);
    const licenseParts = String(profileForm.licenses || "").split(/[,،\n]/).map((item) => item.trim()).filter(Boolean);
    const certificationScore = Math.min(100, certParts.length * 18 + licenseParts.length * 20 + (profileForm.gulf_experience ? 10 : 0) + (profileForm.saudi_experience ? 10 : 0));

    const languageScore = Math.round((getLanguageScore(profileForm.english_level) + getLanguageScore(profileForm.arabic_level)) / 2);
    const dataCompletenessScore = Math.max(0, Math.round(((requiredFields.length - missingFields.length) / requiredFields.length) * 100));

    const finalScore = Math.round((
      experienceScore * 0.30 +
      skillsScore * 0.25 +
      educationScore * 0.15 +
      certificationScore * 0.10 +
      languageScore * 0.10 +
      dataCompletenessScore * 0.10
    ) * 100) / 100;

    const interviewPriority =
      finalScore >= 85 ? "Interview First" :
      finalScore >= 70 ? "Shortlist" :
      finalScore >= 55 ? "Review" :
      "Low Priority";

    const aiRecommendation =
      interviewPriority === "Interview First" ? "Strong profile. Recommended for early interview review." :
      interviewPriority === "Shortlist" ? "Good profile. Recommended for shortlist subject to company review." :
      interviewPriority === "Review" ? "Partial fit. Needs recruiter or technical panel review." :
      "Weak or incomplete profile. Review missing data before deciding.";

    const aiReasoning = [
      `Level: ${level}`,
      `Education: ${educationScore}`,
      `Experience: ${experienceScore}`,
      `Skills: ${skillsScore}`,
      `Certificates: ${certificationScore}`,
      `Language: ${languageScore}`,
      missingFields.length ? `Missing: ${missingFields.join(", ")}` : "Profile data is complete",
      "Recommendation only — final decision belongs to the company.",
    ].join(" | ");

    return {
      profile_completed: missingFields.length === 0,
      missing_fields: missingFields,
      education_score: educationScore,
      experience_score: experienceScore,
      skills_score: skillsScore,
      certification_score: certificationScore,
      language_score: languageScore,
      data_completeness_score: dataCompletenessScore,
      final_ai_score: finalScore,
      interview_priority: interviewPriority,
      ai_recommendation: aiRecommendation,
      ai_reasoning: aiReasoning,
    };
  }

  function getCandidateTechnicalProfile(candidateId) {
    return candidateTechnicalProfiles.find((profile) => String(profile.candidate_id || "") === String(candidateId || "")) || null;
  }

  function getCandidateIntelligenceBadge(candidate) {
    if (!candidate?.technical_profile_required) return "-";
    return candidate.ai_priority || "Pending Review";
  }


  async function loadAll() {
    setLoading(true);
    await Promise.all([
      loadRequests(),
      loadRequestLines(),
      loadVisaRecords(),
      loadVisaBatchLines(),
      loadVisaAuthorizations(),
      loadVisaAllocations(),
      loadAgencies(),
      loadAgencyAgreements(),
      loadAgencyScores(),
      loadAgencyScoreHistory(),
      loadAgencyPenalties(),
       loadCountries(),
  loadProfessions(),
      loadEducationInstitutions(),
      loadCandidates(),
      loadCandidateTechnicalProfiles(),
      loadInterviews(),
      loadUsers(),
      loadCompanies(),
      loadCompanyEmailSettings(),
      loadAIAgentSettings(),
      loadAuditLogs(),
      loadMobilizations(),
      loadEmployees(),
      loadDemobilizations(),
      loadMarketplaceRequests(),
      loadMarketplaceDeals(),
      loadMarketplaceInvoices(),
      loadMarketplaceCollections(),
      loadNotifications(),
      loadEmailLogs(),
      loadEmailTemplates(),
      loadPlatformClients(),
      loadSubscriptionInvoices(),
      loadSupportTickets(),
      loadSystemBackups(),
      loadSystemRestoreRequests(),
      loadSystemActivityLogs(),
    ]);
    setLoading(false);
  }

  async function loadTable(table, setter) {
  const globalTables = ["countries", "professions"];
  const agencyNameFields = {
    candidates: "agency",
    visa_authorizations: "agency",
    agency_agreements: "agency_name",
    agency_scores: "agency_name",
    agency_penalties: "agency_name",
  };
  const agencyBlockedTables = [
    "requests",
    "visa_batches",
    "visa_batch_lines",
    "visa_allocations",
    "users",
    "companies",
    "request_audit_logs",
    "request_lines",
    "employees",
    "demobilizations",
    "marketplace_requests",
    "marketplace_deals",
    "invoices",
    "collections",
  ];

  if (currentRole === "Agency" && !currentCompanyId && !globalTables.includes(table)) {
    setter([]);
    return;
  }

  if (currentRole === "Agency" && agencyBlockedTables.includes(table)) {
    setter([]);
    return;
  }

  if (!currentCompanyId && !globalTables.includes(table)) {
    console.warn(`${table}: blocked because companyId is missing`, {
      currentRole,
      currentUser,
    });
    setter([]);
    return;
  }

  let query = supabase
    .from(table)
    .select("*")
    .range(0, 5000);

  if (currentCompanyId && !globalTables.includes(table)) {
    query = query.eq("company_id", currentCompanyId);
  }

  if (currentRole === "Agency") {
    if (table === "agencies") {
      if (currentUser?.agency_id) query = query.eq("id", currentUser.agency_id);
      else if (currentUser?.agency_name) query = query.eq("name", currentUser.agency_name);
      else { setter([]); return; }
    } else if (agencyNameFields[table]) {
      if (!currentUser?.agency_name) { setter([]); return; }
      query = query.eq(agencyNameFields[table], currentUser.agency_name);
      if (table === "agency_penalties") {
        query = query.neq("status", "Pending Review");
      }
    } else if (table === "agency_score_history") {
      if (!currentUser?.agency_id) { setter([]); return; }
      query = query.eq("agency_id", currentUser.agency_id);
    }
  }

  const { data, error } = await query;

  if (error) {
    alert(`${table}: ${error.message}`);
    return;
  }

  console.log(table, data?.length, data);
  setter(data || []);
}

  const loadRequests = () => loadTable("requests", setRequests);
  const loadRequestLines = () => loadTable("request_lines", setRequestLines);
  const loadVisaRecords = () => loadTable("visa_batches", setVisaRecords);
  const loadVisaBatchLines = () => loadTable("visa_batch_lines", setVisaBatchLines);
  const loadVisaAuthorizations = () => loadTable("visa_authorizations", setVisaAuthorizations);
  const loadVisaAllocations = () => loadTable("visa_allocations", setVisaAllocations);
  async function loadAgencies() {
    if (canManagePlatform) {
      const { data, error } = await supabase
        .from("agencies")
        .select("*")
        .order("name", { ascending: true })
        .range(0, 5000);

      if (error) {
        alert(`agencies: ${error.message}`);
        return;
      }

      setAgencies(data || []);
      return;
    }

    if (currentRole === "Agency") {
      if (!currentUser?.agency_id) {
        setAgencies([]);
        return;
      }

      const { data, error } = await supabase
        .from("agencies")
        .select("*")
        .eq("id", currentUser.agency_id)
        .range(0, 1);

      if (error) {
        alert(`agencies: ${error.message}`);
        return;
      }

      setAgencies(data || []);
      return;
    }

    if (!currentCompanyId) {
      setAgencies([]);
      return;
    }

    const agencyMap = new Map();

    // 1) Agencies already granted to the current company.
    const { data: accessRows, error: accessError } = await supabase
      .from("company_agency_access")
      .select("agency_id, status")
      .eq("company_id", currentCompanyId)
      .eq("status", "Active")
      .range(0, 5000);

    if (accessError) {
      alert(`company_agency_access: ${accessError.message}`);
      return;
    }

    const linkedAgencyIds = Array.from(
      new Set((accessRows || []).map((row) => row.agency_id).filter(Boolean))
    );

    if (linkedAgencyIds.length > 0) {
      const { data: linkedAgencies, error: linkedError } = await supabase
        .from("agencies")
        .select("*")
        .in("id", linkedAgencyIds)
        .range(0, 5000);

      if (linkedError) {
        alert(`agencies linked: ${linkedError.message}`);
        return;
      }

      (linkedAgencies || []).forEach((agency) => {
        if (agency?.id) agencyMap.set(String(agency.id), agency);
      });
    }

    // 2) Global agencies are available to be granted to this company.
    // This keeps the Add User agency dropdown populated after agencies became platform-level records.
    const { data: globalAgencies, error: globalError } = await supabase
      .from("agencies")
      .select("*")
      .is("company_id", null)
      .range(0, 5000);

    if (globalError) {
      alert(`agencies global: ${globalError.message}`);
      return;
    }

    (globalAgencies || [])
      .filter((agency) => String(agency?.status || "Active").toLowerCase() !== "inactive")
      .forEach((agency) => {
        if (agency?.id) agencyMap.set(String(agency.id), agency);
      });

    // 3) Backward compatibility for any old company-owned agency records.
    const { data: companyAgencies, error: companyAgencyError } = await supabase
      .from("agencies")
      .select("*")
      .eq("company_id", currentCompanyId)
      .range(0, 5000);

    if (companyAgencyError) {
      console.warn("company-owned agencies:", companyAgencyError.message);
    }

    (companyAgencies || [])
      .filter((agency) => String(agency?.status || "Active").toLowerCase() !== "inactive")
      .forEach((agency) => {
        if (agency?.id) agencyMap.set(String(agency.id), agency);
      });

    const rows = Array.from(agencyMap.values()).sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""))
    );

    setAgencies(rows);
  }
  const loadAgencyAgreements = () => loadTable("agency_agreements", setAgencyAgreements);
  const loadAgencyScores = () => loadTable("agency_scores", setAgencyScores);
  const loadAgencyScoreHistory = () => loadTable("agency_score_history", setAgencyScoreHistory);
  const loadAgencyPenalties = () => loadTable("agency_penalties", setAgencyPenalties);
  const loadCountries = () => loadTable("countries", setCountries);
  const loadUsers = async () => {
    if (canManagePlatform) {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .order("created_at", { ascending: false })
        .range(0, 5000);

      if (error) {
        alert(`users: ${error.message}`);
        return;
      }

      setUsers(data || []);
      console.log("USERS DATA:", data);
      return;
    }

    if (currentRole === "Agency" || !currentCompanyId) {
      setUsers([]);
      return;
    }

    const { data: companyUsers, error: companyUsersError } = await supabase
      .from("users")
      .select("*")
      .eq("company_id", currentCompanyId)
      .order("created_at", { ascending: false })
      .range(0, 5000);

    if (companyUsersError) {
      alert(`users: ${companyUsersError.message}`);
      return;
    }

    const { data: agencyAccessRows, error: agencyAccessError } = await supabase
      .from("agency_company_user_access")
      .select("user_id")
      .eq("company_id", currentCompanyId)
      .eq("status", "Active")
      .range(0, 5000);

    if (agencyAccessError) {
      console.warn("agency_company_user_access users:", agencyAccessError.message);
      setUsers(companyUsers || []);
      return;
    }

    const agencyUserIds = Array.from(new Set((agencyAccessRows || []).map((row) => row.user_id).filter(Boolean)));
    let agencyUsers = [];

    if (agencyUserIds.length > 0) {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .in("id", agencyUserIds)
        .range(0, 5000);

      if (error) {
        console.warn("agency users:", error.message);
      } else {
        agencyUsers = data || [];
      }
    }

    const merged = new Map();
    [...(companyUsers || []), ...agencyUsers].forEach((user) => {
      if (user?.id) merged.set(String(user.id), user);
    });

    setUsers(Array.from(merged.values()));
  };
  const loadCompanies = async () => {
    if (!currentCompanyId) return setCompanies([]);

    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .eq("id", currentCompanyId)
      .range(0, 10);

    if (error) {
      alert(`companies: ${error.message}`);
      return;
    }

    setCompanies(data || []);
  };

  async function loadCompanyEmailSettings() {
    if (!currentCompanyId || currentRole === "Agency") {
      setCompanyEmailSettings(null);
      setEmailSettingsForm(emptyCompanyEmailSettings);
      return;
    }

    const { data, error } = await supabase
      .from("company_email_settings")
      .select("id, company_id, mode, provider, smtp_host, smtp_port, smtp_secure, smtp_username, from_name, from_email, reply_to, agreements_email, notifications_email, support_email, is_active, is_verified, last_test_at, last_test_status, last_error, updated_at")
      .eq("company_id", currentCompanyId)
      .maybeSingle();

    if (error) {
      console.warn("company_email_settings:", error.message);
      setCompanyEmailSettings(null);
      setEmailSettingsForm(emptyCompanyEmailSettings);
      return;
    }

    setCompanyEmailSettings(data || null);
    setEmailSettingsForm({
      ...emptyCompanyEmailSettings,
      ...(data || {}),
      smtp_password: "",
      smtp_port: data?.smtp_port ? String(data.smtp_port) : "465",
      smtp_secure: data?.smtp_secure === false ? "false" : "true",
      test_email: localStorage.getItem("visaflow_last_test_email") || currentUser?.email || "",
    });
  }

  async function loadAIAgentSettings() {
    if (!currentCompanyId || currentRole === "Agency") {
      setAiAgentSettings(DEFAULT_AI_AGENT_SETTINGS);
      return;
    }

    const { data, error } = await supabase
      .from("ai_agent_settings")
      .select("*")
      .eq("company_id", currentCompanyId)
      .maybeSingle();

    if (error) {
      console.warn("ai_agent_settings:", error.message);
      setAiAgentSettings(DEFAULT_AI_AGENT_SETTINGS);
      return;
    }

    setAiAgentSettings(normalizeAIAgentSettings(data || DEFAULT_AI_AGENT_SETTINGS));
  }

  function updateAIAgentSetting(field, value) {
    setAiAgentSettings((prev) => normalizeAIAgentSettings({ ...prev, [field]: value }));
    setAiAgentSettingsMessage("");
  }

  async function saveAIAgentSettings() {
    if (!currentCompanyId) return alert("Company ID is missing.");

    setAiAgentSettingsSaving(true);
    setAiAgentSettingsMessage("");

    const payload = {
      ...normalizeAIAgentSettings(aiAgentSettings),
      company_id: currentCompanyId,
      updated_by: currentUser?.id || null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("ai_agent_settings")
      .upsert([payload], { onConflict: "company_id" })
      .select("*")
      .maybeSingle();

    setAiAgentSettingsSaving(false);

    if (error) {
      setAiAgentSettingsMessage(`AI Agent settings error: ${error.message}`);
      return alert(error.message);
    }

    setAiAgentSettings(normalizeAIAgentSettings(data || payload));
    setAiAgentSettingsMessage("AI Agent settings saved.");
  }

const loadProfessions = async () => {
  const { data: part1, error: error1 } = await supabase
    .from("professions")
    .select("*")
    .range(0, 999);

  const { data: part2, error: error2 } = await supabase
    .from("professions")
    .select("*")
    .range(1000, 3000);

  if (error1 || error2) {
    alert(`professions: ${error1?.message || error2?.message}`);
    return;
  }

  const allProfessions = [...(part1 || []), ...(part2 || [])];
console.log("professions total", allProfessions.length);
setProfessions(allProfessions);
};
  async function loadEducationInstitutions() {
    let query = supabase
      .from("education_institutions")
      .select("*")
      .eq("is_active", true)
      .order("country", { ascending: true })
      .order("institution_name", { ascending: true })
      .range(0, 5000);

    if (currentCompanyId) {
      query = query.or(`company_id.is.null,company_id.eq.${currentCompanyId}`);
    } else {
      query = query.is("company_id", null);
    }

    const { data, error } = await query;

    if (error) {
      console.warn("education_institutions:", error.message);
      setEducationInstitutions([]);
      return;
    }

    setEducationInstitutions(data || []);
  }

  async function loadCandidateTechnicalProfiles() {
    if (!currentCompanyId || currentRole === "Agency") {
      setCandidateTechnicalProfiles([]);
      return;
    }

    const { data, error } = await supabase
      .from("candidate_technical_profiles")
      .select("*")
      .eq("company_id", currentCompanyId)
      .range(0, 5000);

    if (error) {
      console.warn("candidate_technical_profiles:", error.message);
      setCandidateTechnicalProfiles([]);
      return;
    }

    setCandidateTechnicalProfiles(data || []);
  }

  const loadCandidates = () => loadTable("candidates", setCandidates);
  const loadInterviews = () => loadTable("interviews", setInterviews);
  const loadMobilizations = () => loadTable("mobilizations", setMobilizations);
  const loadEmployees = () => loadTable("employees", setEmployees);
  const loadDemobilizations = () => loadTable("demobilizations", setDemobilizations);
  const loadMarketplaceRequests = () => loadTable("marketplace_requests", setMarketplaceRequests);
  const loadMarketplaceDeals = () => loadTable("marketplace_deals", setMarketplaceDeals);
  const loadMarketplaceInvoices = () => loadTable("invoices", setMarketplaceInvoices);
  const loadMarketplaceCollections = () => loadTable("collections", setMarketplaceCollections);
  const loadAuditLogs = () => loadTable("request_audit_logs", setAuditLogs);

  async function loadPlatformTable(table, setter) {
    if (!canManagePlatform) {
      setter([]);
      return;
    }

    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order("created_at", { ascending: false })
      .range(0, 5000);

    if (error) {
      console.warn(`${table}:`, error.message);
      setter([]);
      return;
    }

    setter(data || []);
  }

  const loadPlatformClients = () => loadPlatformTable("platform_clients", setPlatformClients);
  const loadSubscriptionInvoices = () => loadPlatformTable("subscription_invoices", setSubscriptionInvoices);
  const loadSupportTickets = () => loadPlatformTable("support_tickets", setSupportTickets);
  const loadSystemBackups = () => loadPlatformTable("system_backups", setSystemBackups);
  const loadSystemRestoreRequests = () =>
    isPlatformOwner ? loadPlatformTable("system_restore_requests", setSystemRestoreRequests) : setSystemRestoreRequests([]);

  async function loadSystemActivityLogs() {
    if (!currentUser) {
      setSystemActivityLogs([]);
      return [];
    }

    let query = supabase
      .from("system_activity_logs")
      .select("id, company_id, request_no, module_name, record_id, record_label, action_type, action_title, old_values, new_values, changed_fields, changed_by_name, changed_by_email, changed_by_role, notes, source, created_at")
      .order("created_at", { ascending: false })
      .limit(500);

    if (!canManagePlatform) {
      if (!currentCompanyId) {
        setSystemActivityLogs([]);
        return [];
      }
      query = query.eq("company_id", currentCompanyId);
    }

    const { data, error } = await query;

    if (error) {
      console.warn("system_activity_logs:", error.message);
      setSystemActivityLogs([]);
      return [];
    }

    setSystemActivityLogs(data || []);
    return data || [];
  }

async function loadNotifications() {
  if (!currentCompanyId) {
    console.warn("Notifications blocked: companyId is missing", {
      currentCompanyId,
      currentRole,
      currentUser,
    });
    setNotifications([]);
    return [];
  }

  let query = supabase
    .from("notification_events")
    .select("id, company_id, user_id, agency_id, type, title, message, priority, status, delivery_status, related_table, related_id, read_at, created_at, data")
    .eq("company_id", currentCompanyId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (currentRole === "Agency" && currentUser?.agency_id) {
    query = query.eq("agency_id", currentUser.agency_id);
  }

  const { data, error } = await query;

  console.log("NOTIFICATIONS DEBUG:", {
    currentCompanyId,
    currentRole,
    userCompanyId: currentUser?.company_id,
    activeCompanyId: currentUser?.active_company_id,
    count: data?.length || 0,
    error,
    data,
  });

  if (error) {
    alert(`Notifications error: ${error.message}`);
    setNotifications([]);
    return [];
  }

  let rows = data || [];

  if (currentRole === "Agency") {
    rows = rows.filter((item) => {
      const payload = item.data || {};
      return (
        String(item.agency_id || "") === String(currentUser?.agency_id || "") ||
        normalize(item.agency_name || payload.agency || payload.agency_name) === normalize(currentUser?.agency_name)
      );
    });
  }

  setNotifications(rows);
  return rows;
}
  async function loadEmailLogs() {
    if (!currentCompanyId || currentRole === "Agency") {
      setEmailLogs([]);
      return [];
    }

    try {
      const { data, error } = await supabase
        .from("email_logs")
        .select("*")
        .eq("company_id", currentCompanyId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        console.warn("email_logs:", error.message);
        setEmailLogs([]);
        return;
      }

      setEmailLogs(data || []);
    } catch (error) {
      console.warn("email_logs load failed", error?.message || error);
      setEmailLogs([]);
    }
  }

  async function loadEmailTemplates() {
    if (!currentCompanyId || currentRole === "Agency") {
      setEmailTemplates([]);
      return [];
    }

    try {
      const { data, error } = await supabase
        .from("email_templates")
        .select("*")
        .eq("company_id", currentCompanyId)
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) {
        console.warn("email_templates:", error.message);
        setEmailTemplates([]);
        return;
      }

      setEmailTemplates(data || []);
    } catch (error) {
      console.warn("email_templates load failed", error?.message || error);
      setEmailTemplates([]);
    }
  }

  function getDefaultEmailTemplates() {
    return [
      {
        template_key: "offer_email",
        template_name: "Offer Email",
        category: "Recruitment",
        language: "Bilingual",
        subject: "Job Offer - {{candidate_name}} / عرض وظيفي",
        body: "Dear {{candidate_name}},\n\nWe are pleased to share your job offer for {{profession}} under request {{request_no}}.\n\nعزيزي/عزيزتي {{candidate_name}}،\nيسعدنا إرسال العرض الوظيفي الخاص بوظيفة {{profession}} للطلب رقم {{request_no}}.\n\nBest regards,\nVisaFlow KSA",
        is_active: true,
      },
      {
        template_key: "interview_invitation",
        template_name: "Interview Invitation",
        category: "Recruitment",
        language: "Bilingual",
        subject: "Interview Invitation - {{candidate_name}}",
        body: "Dear {{candidate_name}},\n\nYou are invited for an interview for {{profession}}. Please confirm your availability.\n\nندعوكم لحضور مقابلة لوظيفة {{profession}}، نأمل تأكيد الموعد.\n\nVisaFlow KSA",
        is_active: true,
      },
      {
        template_key: "missing_documents",
        template_name: "Missing Documents Reminder",
        category: "Operations",
        language: "Bilingual",
        subject: "Missing Documents Reminder - {{candidate_name}}",
        body: "Dear {{candidate_name}},\n\nPlease complete the missing documents to continue the recruitment process.\n\nنأمل استكمال المستندات الناقصة لاستكمال إجراءات التوظيف.\n\nVisaFlow KSA",
        is_active: true,
      },
      {
        template_key: "agency_update_reminder",
        template_name: "Agency Update Reminder",
        category: "Agency",
        language: "Bilingual",
        subject: "Candidate Update Required - {{agency_name}}",
        body: "Dear {{agency_name}},\n\nPlease update candidate status for request {{request_no}} in VisaFlow Office Portal.\n\nنأمل تحديث حالة المرشحين للطلب رقم {{request_no}} من خلال بوابة المكتب.\n\nVisaFlow KSA",
        is_active: true,
      },
      {
        template_key: "authorization_delay",
        template_name: "Authorization Delay Alert",
        category: "Visa",
        language: "Bilingual",
        subject: "Authorization Delay Alert - {{authorization_no}}",
        body: "Authorization {{authorization_no}} requires follow-up. Please review agency and candidate progress.\n\nيوجد تأخير في التفويض رقم {{authorization_no}}، نأمل المتابعة والمراجعة.\n\nVisaFlow KSA",
        is_active: true,
      },
      {
        template_key: "arrival_confirmation",
        template_name: "Candidate Arrival Confirmation",
        category: "Mobilization",
        language: "Bilingual",
        subject: "Arrival Confirmation - {{candidate_name}}",
        body: "Candidate {{candidate_name}} has arrived in KSA for request {{request_no}}.\n\nتم تأكيد وصول المرشح {{candidate_name}} إلى المملكة للطلب رقم {{request_no}}.\n\nVisaFlow KSA",
        is_active: true,
      },
      {
        template_key: "subscription_expiry",
        template_name: "Subscription Expiry Reminder",
        category: "Platform",
        language: "Bilingual",
        subject: "VisaFlow Subscription Expiry Reminder",
        body: "Your VisaFlow subscription is approaching expiry. Please renew to avoid service interruption.\n\nاشتراككم في VisaFlow قارب على الانتهاء، نأمل التجديد لتجنب توقف الخدمة.\n\nVisaFlow KSA",
        is_active: true,
      },
      {
        template_key: "support_ticket_reply",
        template_name: "Support Ticket Reply",
        category: "Support",
        language: "Bilingual",
        subject: "Support Ticket Update - {{ticket_no}}",
        body: "Dear Customer,\n\nYour support ticket {{ticket_no}} has been updated.\n\nتم تحديث تذكرة الدعم رقم {{ticket_no}}.\n\nVisaFlow Support",
        is_active: true,
      },
    ];
  }

  async function seedDefaultEmailTemplates() {
    if (!canManageUsers && !canManagePlatform) return alert("You do not have permission to manage email templates.");

    const rows = getDefaultEmailTemplates().map((template) =>
      withCompany({
        ...template,
        updated_at: new Date().toISOString(),
      })
    );

    const { error } = await supabase
      .from("email_templates")
      .upsert(rows, { onConflict: "company_id,template_key" });

    if (error) return alert(error.message);
    await loadEmailTemplates();
    alert("Default email templates are ready.");
  }

  function editEmailTemplate(item) {
    setEmailTemplateEditingId(item.id);
    setEmailTemplateForm({
      template_key: item.template_key || "",
      template_name: item.template_name || "",
      category: item.category || "Recruitment",
      language: item.language || "Bilingual",
      subject: item.subject || "",
      body: item.body || "",
      is_active: item.is_active !== false,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetEmailTemplateForm() {
    setEmailTemplateEditingId(null);
    setEmailTemplateForm(emptyEmailTemplate);
  }

  async function saveEmailTemplate() {
    if (!canManageUsers && !canManagePlatform) return alert("You do not have permission to manage email templates.");
    if (!emailTemplateForm.template_key || !emailTemplateForm.template_name || !emailTemplateForm.subject) {
      return alert("Template key, name and subject are required.");
    }

    const payload = {
      template_key: emailTemplateForm.template_key,
      template_name: emailTemplateForm.template_name,
      category: emailTemplateForm.category || "Recruitment",
      language: emailTemplateForm.language || "Bilingual",
      subject: emailTemplateForm.subject || "",
      body: emailTemplateForm.body || "",
      is_active: emailTemplateForm.is_active !== false,
      updated_at: new Date().toISOString(),
    };

    const result = emailTemplateEditingId
      ? await supabase
          .from("email_templates")
          .update(payload)
          .eq("id", emailTemplateEditingId)
          .eq("company_id", currentCompanyId)
      : await supabase.from("email_templates").insert([withCompany(payload)]);

    if (result.error) return alert(result.error.message);

    resetEmailTemplateForm();
    await loadEmailTemplates();
    alert(emailTemplateEditingId ? "Email template updated" : "Email template saved");
  }

  async function deleteEmailTemplate(id) {
    if (!canManageUsers && !canManagePlatform) return alert("You do not have permission to delete email templates.");
    if (!window.confirm("Delete this email template?")) return;

    const { error } = await supabase
      .from("email_templates")
      .delete()
      .eq("id", id)
      .eq("company_id", currentCompanyId);

    if (error) return alert(error.message);
    await loadEmailTemplates();
  }

  function renderTemplatePreview(text = "") {
    return String(text || "")
      .replaceAll("{{candidate_name}}", "Sample Candidate")
      .replaceAll("{{profession}}", "Cleaner")
      .replaceAll("{{request_no}}", "REQ-2026-0001")
      .replaceAll("{{agency_name}}", "Sample Agency")
      .replaceAll("{{authorization_no}}", "AUTH-0001")
      .replaceAll("{{ticket_no}}", "TKT-0001");
  }

  async function sendEmailTemplateTest(item) {
    const defaultEmail = localStorage.getItem("visaflow_last_test_email") || emailSettingsForm.test_email || currentUser?.email || getCompanyEmailRecipient("notifications");
    const testEmail = String(window.prompt("Enter test recipient email:", defaultEmail || "") || "").trim();

    if (!testEmail) return;

    localStorage.setItem("visaflow_last_test_email", testEmail);
    setEmailSettingsForm((prev) => ({ ...prev, test_email: testEmail }));

    try {
      await dispatchVisaFlowEmail({
        type: "EMAIL_TEMPLATE_TEST",
        to: testEmail,
        subject: renderTemplatePreview(item.subject || "VisaFlow Template Test"),
        text: renderTemplatePreview(item.body || item.subject || "VisaFlow Template Test"),
        html: buildEmailCardHtml(renderTemplatePreview(item.subject || "VisaFlow Template Test"), [renderTemplatePreview(item.body || "VisaFlow Template Test")]),
        payload: {
          template_key: item.template_key,
          template_name: item.template_name,
        },
      });
      await loadEmailLogs();
      alert("Template test email sent.");
    } catch (error) {
      await loadEmailLogs();
      alert(`Template test failed: ${error.message}`);
    }
  }

  async function recordEmailLog(row = {}) {
    try {
      await supabase.from("email_logs").insert([
        withCompany({
          type: row.type || "EMAIL",
          status: row.status || "Pending",
          to_email: Array.isArray(row.to_email) ? row.to_email.join(", ") : row.to_email || "",
          cc_email: row.cc_email || "",
          bcc_email: row.bcc_email || "",
          subject: row.subject || "",
          provider: row.provider || companyEmailSettings?.provider || "VisaFlow Dispatcher",
          message_id: row.message_id || "",
          error_message: row.error_message || "",
          payload: row.payload || {},
          created_at: new Date().toISOString(),
        }),
      ]);
    } catch (error) {
      console.warn("email log insert failed", error?.message || error);
    }
  }

  function getNotificationTitle(item) {
    const payload = item?.data || {};
    return item?.title || payload.title || item?.type || item?.status || "Notification";
  }

  function getNotificationMessage(item) {
    const payload = item?.data || {};
    return (
      item?.message ||
      payload.message ||
      payload.provider_message ||
      payload.recommendation ||
      payload.candidate_name ||
      JSON.stringify(payload || {})
    );
  }

  function getNotificationStatus(item) {
    return String(item?.status || "Unread").toLowerCase() === "read" ? "Read" : "Unread";
  }

  const unreadNotificationsCount = notifications.filter((item) => getNotificationStatus(item) !== "Read").length;

  const notificationTypes = useMemo(() => {
    const types = notifications.map((item) => item.type || item.status || "Notification").filter(Boolean);
    return ["All", ...Array.from(new Set(types))];
  }, [notifications]);

  const filteredNotificationRows = useMemo(() => {
    const keyword = normalize(notificationSearch);
    return notifications.filter((item) => {
      const type = item.type || item.status || "Notification";
      const matchesType = notificationFilter === "All" || type === notificationFilter;
      const searchable = [type, getNotificationTitle(item), getNotificationMessage(item), item.priority, item.status]
        .join(" ")
        .toLowerCase();
      return matchesType && (!keyword || searchable.includes(keyword));
    });
  }, [notifications, notificationFilter, notificationSearch]);

  const emailLogStats = useMemo(() => ({
    sent: emailLogs.filter((item) => String(item.status || "").toLowerCase() === "sent").length,
    failed: emailLogs.filter((item) => String(item.status || "").toLowerCase() === "failed").length,
    skipped: emailLogs.filter((item) => String(item.status || "").toLowerCase() === "skipped").length,
  }), [emailLogs]);

  async function markNotificationRead(id) {
    if (!id) return;
    const { error } = await supabase
      .from("notification_events")
      .update({ status: "Read", read_at: new Date().toISOString() })
      .eq("id", id)
      .eq("company_id", currentCompanyId);

    if (error) return alert(error.message);
    await loadNotifications();
  }

  async function markAllNotificationsRead() {
    let query = supabase
      .from("notification_events")
      .update({ status: "Read", read_at: new Date().toISOString() })
      .eq("company_id", currentCompanyId)
      .neq("status", "Read");

    if (currentRole === "Agency" && currentUser?.agency_id) {
      query = query.eq("agency_id", currentUser.agency_id);
    }

    const { error } = await query;
    if (error) return alert(error.message);
    await loadNotifications();
  }

  async function deleteNotification(id) {
    if (!id) return;
    if (!window.confirm("Delete this notification?")) return;

    const { error } = await supabase
      .from("notification_events")
      .delete()
      .eq("id", id)
      .eq("company_id", currentCompanyId);

    if (error) return alert(error.message);
    await loadNotifications();
  }
useEffect(() => {
  if (!currentUser) return;

  if (currentRole === "Agency") {
    loadAgencyClientAccess(currentUser, true);
    if (!currentCompanyId) return;
  }

  loadAll();
}, [currentUser?.id, currentCompanyId]);

useEffect(() => {
  if (!currentUser || !currentCompanyId || isCurrentAgencyUser) return;
  if (!requests.length || !agencies.length) return;
  if (!isAIAgentEnabled()) return;

  // Production safety: automatic AI Agent execution must not run heavy actions in the browser.
  // The browser shows recommendations only. Background automation is handled by Supabase Edge Functions / Cron.
  if (isAIAgentBackgroundMode() && !aiAgentSettings?.client_auto_enabled) {
    return;
  }

  const signature = [
    currentCompanyId,
    requests.length,
    candidates.length,
    agencies.length,
    agencyScores.length,
    agencyAgreements.length,
    aiAgentSettings.mode,
    aiAgentSettings.auto_manager_approval,
    aiAgentSettings.auto_followup_agencies,
    aiAgentSettings.allow_auto_agency_emails,
    aiAgentSettings.max_auto_actions_per_run,
    aiAgentSettings.cooldown_minutes,
    aiAgentSettings.max_actions_per_hour,
  ].join(":");

  if (aiAgentAutoRunRef.current === signature) return;
  aiAgentAutoRunRef.current = signature;

  const timer = window.setTimeout(() => {
    const limit = getAIAgentMaxAutoActions();
    if (isAIAgentManagerAutoEnabled()) runAIAgentAutoManagerApprovals({ limit });
    if (isAIAgentAgencyFollowUpAutoEnabled()) runAIAgentAutoAgencyFollowUp({ limit });
  }, 1400);

  return () => window.clearTimeout(timer);
}, [
  currentUser?.id,
  currentCompanyId,
  isCurrentAgencyUser,
  requests.length,
  candidates.length,
  agencies.length,
  agencyScores.length,
  agencyAgreements.length,
  aiAgentSettings.mode,
  aiAgentSettings.auto_manager_approval,
  aiAgentSettings.auto_followup_agencies,
  aiAgentSettings.allow_auto_agency_emails,
  aiAgentSettings.max_auto_actions_per_run,
  aiAgentSettings.run_in_background,
  aiAgentSettings.client_auto_enabled,
  aiAgentSettings.cooldown_minutes,
  aiAgentSettings.max_actions_per_hour,
]);

useEffect(() => {
  if (!visiblePages.includes(activePage)) {
    setActivePage(visiblePages[0] || "Dashboard");
  }
}, [currentRole, activePage, visiblePages]);
  
const getVisaAvailableQty = (visaNo) => {
  const matchingLines = visaInventoryLines.filter((line) => String(line.visa_no) === String(visaNo));
  if (matchingLines.length > 0) {
    return matchingLines.reduce((sum, line) => sum + Math.max(getVisaLineRemainingQty(line), 0), 0);
  }

  const visa = visaRecords.find(
    (v) => String(v.visa_no) === String(visaNo)
  );

  const totalQty = Number(visa?.quantity || 0);

  const allocated = visaAllocations
    .filter((a) => String(a.visa_no) === String(visaNo))
    .reduce((sum, a) => sum + Number(a.allocated_qty || 0), 0);

  return totalQty - allocated;
};
  const filteredVisaRecords = useMemo(() => {
    const keyword = search.toLowerCase();
    return visaRecords.filter((item) => {
      const lines = getVisaLinesForBatch(item);
      const lineText = lines
        .map((line) => [line.profession, line.nationality, line.gender, line.quantity].join(" "))
        .join(" ");
      const matchesSearch = [item.visa_no, item.moi_no, item.request_no, item.project, lineText]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
      const matchesStatus = filterStatus === "All" || item.status === filterStatus;
      return matchesSearch && matchesStatus;
    });
  }, [visaRecords, visaBatchLines, visaAllocations, search, filterStatus]);

  const filteredCandidates = useMemo(() => {
  const keyword = search.toLowerCase();

  return candidates.filter((item) => {
    if (search.startsWith("REQ-")) {
      return String(item.request_no || "") === search;
    }

    return [
      item.request_no,
      item.candidate_name,
      item.profession,
      item.nationality,
      item.gender,
      item.agency,
      item.project,
      item.passport_no,
    ]
      .join(" ")
      .toLowerCase()
      .includes(keyword);
  });
}, [candidates, search]);
    
  

  
const saudiHiringRows = useMemo(() => {
  const rows = [];

  requests.forEach((request) => {
    const lines = getRequestLinesForRequest(request);
    const saudiLines = lines.filter((line) => isSaudiNationality(line.nationality));

    if (saudiLines.length > 0) {
      saudiLines.forEach((line) => {
        rows.push({
          id: `${request.id || request.request_no}-${line.id || line.line_no || line.profession}`,
          request,
          line,
          request_no: request.request_no || "",
          project_name: request.project_name || request.project || "-",
          profession: line.profession || request.profession || "-",
          nationality: line.nationality || request.nationality || "Saudi Arabia",
          gender: line.gender || request.gender || "-",
          qty: Number(line.quantity || 0),
          status: request.status || "-",
          approval_status: request.approval_status || "-",
        });
      });
      return;
    }

    if (isSaudiRequest(request)) {
      rows.push({
        id: `${request.id || request.request_no}-header-saudi`,
        request,
        line: null,
        request_no: request.request_no || "",
        project_name: request.project_name || request.project || "-",
        profession: request.profession || "-",
        nationality: request.nationality || "Saudi Arabia",
        gender: request.gender || "-",
        qty: Number(request.quantity || request.qty || 0),
        status: request.status || "-",
        approval_status: request.approval_status || "-",
      });
    }
  });

  return rows;
}, [requests, requestLines]);

function getSaudiHiringRowCandidates(row) {
  const blockedStatuses = ["Rejected", "Interview Failed", "Medical Failed", "Cancelled"];
  return candidates.filter((candidate) => {
    if (String(candidate.request_no || "") !== String(row.request_no || "")) return false;
    if (blockedStatuses.includes(candidate.status)) return false;

    if (row.line?.id && !String(row.line.id).includes("legacy")) {
      return String(candidate.request_line_id || "") === String(row.line.id || "");
    }

    return isSaudiNationality(candidate.nationality) || isSaudiCandidate(candidate, requests);
  });
}

const stats = useMemo(() => {
    const totalQty = visaRecords.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const totalCandidates = candidates.length;

const totalRemaining = requests.reduce((sum, item) => {
  const used = candidates.filter(
    (c) => c.request_no === item.request_no
  ).length;

  return sum + (Number(item.quantity || 0) - used);
}, 0);

const underRecruitmentCount = requests.filter(
  (x) => x.status === "Under Recruitment"
).length;

const visaProcessCount = requests.filter(
  (x) => x.status === "Visa Process"
).length;

const totalMobilizationCost = candidates.reduce((sum, candidate) => sum + getCandidateTotalCost(candidate), 0);

const totalRequestBudget = requests.reduce((sum, request) => {
  const qty = Number(request.quantity || 0);
  const budget = Number(request.salary || request.budget || 0);
  return sum + (budget * qty);
}, 0);

   return {
  totalQty,
  totalCandidates,
  totalRemaining,
  underRecruitmentCount,
  visaProcessCount,
  totalMobilizationCost,
  totalRequestBudget,
  costVariance: totalRequestBudget - totalMobilizationCost,

  approvedRequests: requests.filter((item) => item.approval_status === "Approved by Recruitment").length,
  pendingApprovals: requests.filter((item) => item.approval_status === "Pending Recruitment Approval").length,
  joinedCandidates: candidates.filter((item) => item.status === "Joined").length,
  arrivedMobilizations: mobilizations.filter((item) => item.mobilization_status === "Arrived KSA").length,
  joinedMobilizations: mobilizations.filter((item) => item.mobilization_status === "Joined").length,
  pendingMedicalMobilizations: mobilizations.filter((item) => item.medical_status === "Pending").length,
  ticketsIssuedMobilizations: mobilizations.filter((item) => item.mobilization_status === "Ticket Issued" || item.ticket_no).length,
  passedInterviews: interviews.filter((item) => item.status === "Passed").length,
  activeProjects: new Set(
  visaRecords
    .map((item) => item.project || item.project_name)
    .filter(Boolean)
).size,
  activeAgencies: agencies.filter((item) => item.status !== "Inactive").length,
  pendingVisas: visaRecords.filter((item) => item.status === "Pending").length,
  openRequests: requests.filter((item) => item.status === "Open").length,
  urgentRequests: requests.filter((item) => item.priority === "Urgent").length,
};
  }, [visaRecords, agencies, requests, candidates, interviews, mobilizations]);
  const reports = useMemo(() => {
  const today = new Date();

  const daysBetween = (date) => {
    if (!date) return 0;
    const d = new Date(date);
    return Math.floor((today - d) / (1000 * 60 * 60 * 24));
  };

  const requestHasVisa = (req) =>
  isSaudiRequest(req) ||
  visaRecords.some((v) =>
    v.request_no === req.request_no ||
    (
      (v.project || v.project_name) === (req.project || req.project_name) &&
      v.profession === req.profession &&
      v.nationality === req.nationality
    )
  );

  const visaHasRequest = (visa) =>
    requests.some((r) => r.request_no === visa.request_no);

  const visaHasAuthorization = (visa) =>
    visaAuthorizations.some((a) => a.visa_no === visa.visa_no);

  const authHasCandidates = (auth) =>
    candidates.some(
      (c) =>
        c.visa_no === auth.visa_no ||
        c.authorization_no === auth.authorization_no
    );

  const candidateHasInterview = (candidate) =>
    interviews.some(
      (i) =>
        i.candidate_id === candidate.id ||
        i.passport_no === candidate.passport_no ||
        i.candidate_name === candidate.candidate_name
    );

  return {
    requestsWithoutVisa: requests.filter((r) => !requestHasVisa(r)),

    visasWithoutRequests: visaRecords.filter((v) => !visaHasRequest(v)),

    visasWithoutAuthorization: visaRecords.filter(
      (v) => !visaHasAuthorization(v)
    ),

    authorizationsWithoutCandidates: visaAuthorizations.filter(
      (a) => !authHasCandidates(a)
    ),

    candidatesWithoutInterviews: candidates.filter(
      (c) => !candidateHasInterview(c)
    ),

    lateItems: [
      ...requests
        .filter((r) => daysBetween(r.created_at) > 30 && r.status !== "Completed")
        .map((r) => ({
          type: "Request",
          reference: r.request_no,
          name: r.profession,
          days: daysBetween(r.created_at),
          status: r.status,
        })),

      ...visaAuthorizations
        .filter((a) => daysBetween(a.created_at) > 15 && a.status !== "Completed")
        .map((a) => ({
          type: "Authorization",
          reference: a.authorization_no,
          name: a.agency,
          days: daysBetween(a.created_at),
          status: a.status,
        })),
    ],

    requestLifecycle: requests.map((r) => {
      const relatedVisas = visaRecords.filter(
        (v) => v.request_no === r.request_no
      );


      const relatedAuths = visaAuthorizations.filter((a) =>
        relatedVisas.some((v) => v.visa_no === a.visa_no)
      );

      const relatedCandidates = candidates.filter(
        (c) =>
          c.request_no === r.request_no ||
          relatedVisas.some((v) => v.visa_no === c.visa_no)
      );

      const relatedInterviews = interviews.filter((i) =>
        relatedCandidates.some(
          (c) =>
            i.candidate_id === c.id ||
            i.passport_no === c.passport_no ||
            i.candidate_name === c.candidate_name
        )
      );

      const relatedMobilizations = mobilizations.filter((m) =>
        relatedCandidates.some(
          (c) =>
            String(m.candidate_id) === String(c.id) ||
            m.candidate_name === c.candidate_name ||
            m.request_no === r.request_no
        )
      );

      const completedCandidates = relatedMobilizations.filter((m) =>
        m.mobilization_status === "Joined"
      ).length;

      return {
        request_no: r.request_no,
        profession: r.profession,
        nationality: r.nationality,
        qty: r.quantity,
        completedCandidates,
        visas: relatedVisas.map((v) => v.visa_no).filter(Boolean).join(", "),
        authorizations: relatedAuths.length,
        candidates: relatedCandidates.length,
        interviews: relatedInterviews.length,
        mobilizations: relatedMobilizations.length,
        arrived: relatedMobilizations.filter((m) => m.mobilization_status === "Arrived KSA").length,
        joined: relatedMobilizations.filter((m) => m.mobilization_status === "Joined").length,
        status: r.status,
        approval_status: r.approval_status,
      };
    }),
  };
}, [requests, requestLines, visaRecords, visaAuthorizations, candidates, interviews, mobilizations]);

const activityModules = useMemo(() => {
  const modules = systemActivityLogs.map((item) => item.module_name).filter(Boolean);
  return ["All", ...Array.from(new Set(modules)).sort()];
}, [systemActivityLogs]);

const activityActionTypes = useMemo(() => {
  const actions = systemActivityLogs.map((item) => item.action_type).filter(Boolean);
  return ["All", ...Array.from(new Set(actions)).sort()];
}, [systemActivityLogs]);

const filteredActivityLogs = useMemo(() => {
  const requestNo = normalize(activityFilters.requestNo);
  const moduleName = activityFilters.moduleName || "All";
  const actionType = activityFilters.actionType || "All";
  const fromDate = activityFilters.dateFrom ? new Date(`${activityFilters.dateFrom}T00:00:00`) : null;
  const toDate = activityFilters.dateTo ? new Date(`${activityFilters.dateTo}T23:59:59`) : null;

  return systemActivityLogs.filter((item) => {
    const itemDate = item.created_at ? new Date(item.created_at) : null;
    const matchesRequest = !requestNo || normalize(item.request_no).includes(requestNo) || normalize(item.record_label).includes(requestNo);
    const matchesModule = moduleName === "All" || item.module_name === moduleName;
    const matchesAction = actionType === "All" || item.action_type === actionType;
    const matchesFrom = !fromDate || (itemDate && itemDate >= fromDate);
    const matchesTo = !toDate || (itemDate && itemDate <= toDate);

    return matchesRequest && matchesModule && matchesAction && matchesFrom && matchesTo;
  });
}, [systemActivityLogs, activityFilters]);

const cleanOperationalChanges = useMemo(
  () => filteredActivityLogs.filter((item) => !(item.module_name === "Request Lines" && ["Created", "Deleted"].includes(item.action_type))),
  [filteredActivityLogs]
);

const mobilizationRequestRows = useMemo(() => {
  const countPercent = (value, total) => (total ? Math.min(Math.round((Number(value || 0) / Number(total || 0)) * 100), 100) : 0);

  return requests.map((request) => {
    const requestNo = request.request_no;
    const qty = Number(request.quantity || request.qty || 0);
    const saudiRequest = isSaudiRequest(request);

    const requestCandidates = candidates.filter(
      (candidate) =>
        String(candidate.request_no || "") === String(requestNo || "") &&
        !["Rejected", "Interview Failed", "Medical Failed", "Cancelled"].includes(candidate.status)
    );

    const allRequestCandidates = candidates.filter(
      (candidate) => String(candidate.request_no || "") === String(requestNo || "")
    );

    const requestInterviews = interviews.filter(
      (interview) =>
        String(interview.request_no || "") === String(requestNo || "") ||
        allRequestCandidates.some(
          (candidate) =>
            String(interview.candidate_id || "") === String(candidate.id || "") ||
            String(interview.passport_no || "") === String(candidate.passport_no || "") ||
            normalize(interview.candidate_name) === normalize(candidate.candidate_name)
        )
    );

    const relatedAllocations = visaAllocations.filter(
      (allocation) => String(allocation.request_no || "") === String(requestNo || "")
    );

    const relatedAuths = visaAuthorizations.filter(
      (auth) =>
        String(auth.request_no || "") === String(requestNo || "") ||
        relatedAllocations.some((allocation) => String(allocation.visa_no || "") === String(auth.visa_no || ""))
    );

    const relatedMobilizations = mobilizations.filter(
      (m) =>
        String(m.request_no || "") === String(requestNo || "") ||
        allRequestCandidates.some(
          (candidate) =>
            String(m.candidate_id || "") === String(candidate.id || "") ||
            normalize(m.candidate_name) === normalize(candidate.candidate_name)
        )
    );

    const interviewRequired = request.interview_required || "Required";
    const interviewType = request.interview_type || "Online";

    const interviewPassed =
      interviewRequired === "No Interview"
        ? requestCandidates.length
        : requestInterviews.filter((interview) => interview.status === "Passed").length;

    const medicalDone = requestCandidates.filter(
      (candidate) =>
        ["Passed", "Fit", "Medical Passed"].includes(candidate.medical_status) ||
        candidate.status === "Medical Passed" ||
        Boolean(candidate.medical_date) ||
        relatedMobilizations.some(
          (m) =>
            String(m.candidate_id || "") === String(candidate.id || "") &&
            ["Fit", "Passed"].includes(m.medical_status)
        )
    ).length;

    const visaReady = saudiRequest
      ? qty
      : requestCandidates.filter(
          (candidate) =>
            ["Visa Stamped", "Embassy Submitted", "Embassy Delayed", "Ticket Booked", "Departure", "Arrived KSA", "Arrived", "Joined"].includes(candidate.status) ||
            relatedMobilizations.some(
              (m) =>
                String(m.candidate_id || "") === String(candidate.id || "") &&
                ["Ready", "Stamped"].includes(m.visa_status)
            )
        ).length;

    const contractSigned = requestCandidates.filter(
      (candidate) =>
        candidate.contract_status === "Signed" ||
        candidate.contract_url ||
        ["Ticket Booked", "Departure", "Arrived KSA", "Arrived", "Joined"].includes(candidate.status)
    ).length;

    const ticketIssued = requestCandidates.filter(
      (candidate) =>
        Boolean(candidate.ticket_no) ||
        candidate.status === "Ticket Booked" ||
        relatedMobilizations.some(
          (m) =>
            String(m.candidate_id || "") === String(candidate.id || "") &&
            (m.ticket_no || m.mobilization_status === "Ticket Issued")
        )
    ).length;

    const departed = requestCandidates.filter(
      (candidate) =>
        Boolean(candidate.flight_date) ||
        candidate.status === "Departure" ||
        relatedMobilizations.some((m) => String(m.candidate_id || "") === String(candidate.id || "") && m.flight_date)
    ).length;

    const arrived = requestCandidates.filter(
      (candidate) =>
        Boolean(candidate.arrival_date) ||
        candidate.status === "Arrived KSA" ||
        candidate.status === "Arrived" ||
        relatedMobilizations.some(
          (m) =>
            String(m.candidate_id || "") === String(candidate.id || "") &&
            (m.arrival_date || m.mobilization_status === "Arrived KSA")
        )
    ).length;

    const joined = requestCandidates.filter(
      (candidate) =>
        candidate.status === "Joined" ||
        relatedMobilizations.some(
          (m) => String(m.candidate_id || "") === String(candidate.id || "") && m.mobilization_status === "Joined"
        )
    ).length;

    const allocatedVisaQty = saudiRequest
      ? 0
      : relatedAllocations.reduce((sum, allocation) => sum + Number(allocation.allocated_qty || 0), 0);

    const authorizedQty = saudiRequest
      ? 0
      : relatedAuths
          .filter((auth) => auth.status !== "Cancelled")
          .reduce((sum, auth) => sum + Number(auth.allocated_qty || 0), 0);

    const totalCost = requestCandidates.reduce((sum, candidate) => sum + getCandidateTotalCost(candidate), 0);
    const budget = Number(request.salary || request.budget || 0) * qty;

    const weightedSteps = saudiRequest
      ? [
          countPercent(requestCandidates.length, qty),
          countPercent(interviewPassed, qty),
          countPercent(contractSigned, qty),
          countPercent(joined, qty),
        ]
      : [
          countPercent(requestCandidates.length, qty),
          countPercent(interviewPassed, qty),
          countPercent(medicalDone, qty),
          countPercent(visaReady, qty),
          countPercent(contractSigned, qty),
          countPercent(ticketIssued, qty),
          countPercent(arrived, qty),
          countPercent(joined, qty),
        ];

    const progress = qty ? Math.round(weightedSteps.reduce((sum, value) => sum + value, 0) / weightedSteps.length) : 0;
    const remainingRecruitment = Math.max(qty - requestCandidates.length, 0);

    let stage = "Not Started";
    if (joined >= qty && qty > 0) stage = "Completed";
    else if (saudiRequest && joined > 0) stage = "Joining";
    else if (saudiRequest && contractSigned > 0) stage = "Offer / Contract";
    else if (arrived > 0 || joined > 0) stage = "Arrival / Joining";
    else if (ticketIssued > 0 || departed > 0) stage = "Ticket / Travel";
    else if (contractSigned > 0) stage = "Contract Stage";
    else if (visaReady > 0 && !saudiRequest) stage = "Visa Stage";
    else if (medicalDone > 0) stage = "Medical Stage";
    else if (interviewPassed > 0) stage = interviewRequired === "No Interview" ? "Candidate Pipeline" : "Interview Passed";
    else if (requestCandidates.length > 0) stage = "Candidate Pipeline";

    return {
      request_no: requestNo,
      project_name: request.project_name || request.project || "-",
      profession: request.profession || "-",
      nationality: request.nationality || "-",
      gender: request.gender || "-",
      qty,
      isSaudi: saudiRequest,
      allocatedVisaQty,
      authorizedQty,
      candidates: requestCandidates.length,
      rejectedCandidates: allRequestCandidates.length - requestCandidates.length,
      interviewRequired,
      interviewType,
      interviewPassed,
      medicalDone,
      visaReady,
      contractSigned,
      ticketIssued,
      departed,
      arrived,
      joined,
      remaining: remainingRecruitment,
      remainingJoining: Math.max(qty - joined, 0),
      candidatePercent: countPercent(requestCandidates.length, qty),
      interviewPercent: interviewRequired === "No Interview" ? 100 : countPercent(interviewPassed, qty),
      medicalPercent: countPercent(medicalDone, qty),
      visaPercent: saudiRequest ? 100 : countPercent(visaReady, qty),
      contractPercent: countPercent(contractSigned, qty),
      ticketPercent: countPercent(ticketIssued, qty),
      arrivalPercent: countPercent(arrived, qty),
      joinedPercent: countPercent(joined, qty),
      progress,
      stage,
      totalCost,
      budget,
      costVariance: budget - totalCost,
      status: request.status || "-",
      approval_status: request.approval_status || "-",
    };
  });
}, [requests, requestLines, candidates, interviews, mobilizations, visaAllocations, visaAuthorizations]);

const selectedMobilizationRow =
  mobilizationRequestRows.find((row) => row.request_no === selectedMobilizationRequestNo) ||
  mobilizationRequestRows[0] ||
  null;

const selectedMobilizationCandidates = selectedMobilizationRow
  ? candidates.filter((candidate) => String(candidate.request_no || "") === String(selectedMobilizationRow.request_no || ""))
  : [];

const executiveDashboard = useMemo(() => {
  const excludedCandidateStatuses = [
    "Rejected",
    "Interview Failed",
    "Cancelled",
    "Medical Failed",
    "Medical Fail",
  ];

  const isActiveCandidate = (candidate) =>
    !excludedCandidateStatuses.includes(candidate.status);

  const activeCandidates = candidates.filter(isActiveCandidate);

  const totalRequired = requests.reduce(
    (sum, request) => sum + getRequestTotalQty(request),
    0
  );

  const saudiRequests = requests.filter(isSaudiRequest);
  const foreignRequests = requests.filter((request) => !isSaudiRequest(request));
  const saudiRequired = saudiRequests.reduce((sum, request) => sum + getRequestTotalQty(request), 0);
  const foreignRequired = foreignRequests.reduce((sum, request) => sum + getRequestTotalQty(request), 0);
  const saudiCandidates = activeCandidates.filter((candidate) => isSaudiCandidate(candidate, requests));
  const foreignCandidates = activeCandidates.filter((candidate) => !isSaudiCandidate(candidate, requests));
  const saudiJoined = saudiCandidates.filter((candidate) => candidate.status === "Joined" || candidate.offer_status === "Joined" || candidate.joining_date).length;
  const foreignJoined = foreignCandidates.filter((candidate) => candidate.status === "Joined").length;
  const saudizationRate = activeCandidates.length ? Math.round((saudiCandidates.length / activeCandidates.length) * 100) : 0;

  const completedRequests = requests.filter((request) => {
    const qty = Number(request.quantity || request.qty || 0);
    if (!qty) return false;
    const joinedCount = activeCandidates.filter(
      (candidate) =>
        String(candidate.request_no || "") === String(request.request_no || "") &&
        candidate.status === "Joined"
    ).length;
    return joinedCount >= qty || request.status === "Completed" || request.status === "Closed";
  }).length;

  const totalJoined = activeCandidates.filter((candidate) => candidate.status === "Joined").length;
  const recruitmentProgress = totalRequired
    ? Math.round((activeCandidates.length / totalRequired) * 100)
    : 0;

  const allocatedVisas = visaAllocations.reduce(
    (sum, allocation) => sum + Number(allocation.allocated_qty || 0),
    0
  );

  const totalVisaQty = visaRecords.reduce(
    (sum, visa) => sum + Number(visa.quantity || 0),
    0
  );

  const openAuthorizations = visaAuthorizations.filter(
    (authorization) => authorization.status !== "Cancelled"
  ).length;

  const cancelledAuthorizations = visaAuthorizations.filter(
    (authorization) => authorization.status === "Cancelled"
  ).length;

  const interviewPassedCandidateIds = new Set(
    interviews
      .filter((interview) => interview.status === "Passed")
      .map((interview) => String(interview.candidate_id || interview.passport_no || interview.candidate_name || ""))
      .filter(Boolean)
  );

  const interviewPassed = activeCandidates.filter(
    (candidate) =>
      candidate.status === "Interview Passed" ||
      candidate.status === "Selected" ||
      interviewPassedCandidateIds.has(String(candidate.id || "")) ||
      interviewPassedCandidateIds.has(String(candidate.passport_no || "")) ||
      interviewPassedCandidateIds.has(String(candidate.candidate_name || ""))
  ).length;

  const medicalPassed = activeCandidates.filter(
    (candidate) =>
      ["Passed", "Fit", "Medical Passed"].includes(candidate.medical_status) ||
      ["Medical Passed", "Visa Stamped", "Ticket Booked", "Departure", "Arrived KSA", "Arrived", "Joined"].includes(candidate.status)
  ).length;

  const ticketsIssued = activeCandidates.filter(
    (candidate) => Boolean(candidate.ticket_no) || candidate.status === "Ticket Booked"
  ).length;

  const arrived = activeCandidates.filter(
    (candidate) =>
      Boolean(candidate.arrival_date) ||
      candidate.status === "Arrived KSA" ||
      candidate.status === "Arrived" ||
      candidate.status === "Joined"
  ).length;

  const joined = activeCandidates.filter((candidate) => candidate.status === "Joined").length;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const next30 = new Date(today);
  next30.setDate(next30.getDate() + 30);

  const arrivalsNext30Days = activeCandidates
    .filter((candidate) => {
      if (!candidate.arrival_date) return false;
      const arrivalDate = new Date(candidate.arrival_date);
      return arrivalDate >= today && arrivalDate <= next30;
    })
    .sort((a, b) => new Date(a.arrival_date) - new Date(b.arrival_date))
    .slice(0, 20)
    .map((candidate) => ({
      date: new Date(candidate.arrival_date).toLocaleDateString("en-GB"),
      candidate: candidate.candidate_name || "-",
      project: candidate.project || "-",
      request_no: candidate.request_no || "-",
      status: candidate.status || "-",
    }));

  const projectMap = new Map();

  requests.forEach((request) => {
    const project = request.project_name || request.project || "Unassigned";
    const current = projectMap.get(project) || {
      project,
      required: 0,
      active: 0,
      arrived: 0,
      joined: 0,
      requestNos: new Set(),
    };
    current.required += Number(request.quantity || request.qty || 0);
    if (request.request_no) current.requestNos.add(String(request.request_no));
    projectMap.set(project, current);
  });

  activeCandidates.forEach((candidate) => {
    const byRequest = Array.from(projectMap.values()).find((project) =>
      project.requestNos.has(String(candidate.request_no || ""))
    );
    const projectName = byRequest?.project || candidate.project || "Unassigned";
    const current = projectMap.get(projectName) || {
      project: projectName,
      required: 0,
      active: 0,
      arrived: 0,
      joined: 0,
      requestNos: new Set(),
    };

    current.active += 1;
    if (
      Boolean(candidate.arrival_date) ||
      candidate.status === "Arrived KSA" ||
      candidate.status === "Arrived" ||
      candidate.status === "Joined"
    ) {
      current.arrived += 1;
    }
    if (candidate.status === "Joined") current.joined += 1;
    projectMap.set(projectName, current);
  });

  const topProjects = Array.from(projectMap.values())
    .map((project) => ({
      project: project.project,
      required: project.required,
      active: project.active,
      arrived: project.arrived,
      joined: project.joined,
      progress: project.required ? Math.round((project.active / project.required) * 100) : 0,
      arrivalProgress: project.required ? Math.round((project.arrived / project.required) * 100) : 0,
    }))
    .sort((a, b) => b.required - a.required)
    .slice(0, 8);

  const recruitmentFunnel = [
    { stage: "Required", value: totalRequired },
    { stage: "Active Candidates", value: activeCandidates.length },
    { stage: "Interview Passed", value: interviewPassed },
    { stage: "Medical Passed", value: medicalPassed },
    { stage: "Tickets Issued", value: ticketsIssued },
    { stage: "Arrived KSA", value: arrived },
    { stage: "Joined", value: joined },
  ];

  return {
    totalRequired,
    openRequests: requests.filter((request) => ["Open", "Under Recruitment", "Interview Stage", "Visa Process"].includes(request.status)).length,
    underRecruitment: requests.filter((request) => request.status === "Under Recruitment").length,
    completedRequests,
    recruitmentProgress,
    saudiRequests: saudiRequests.length,
    foreignRequests: foreignRequests.length,
    saudiRequired,
    foreignRequired,
    saudiCandidates: saudiCandidates.length,
    foreignCandidates: foreignCandidates.length,
    saudiJoined,
    foreignJoined,
    saudizationRate,
    totalVisaQty,
    allocatedVisas,
    availableVisas: Math.max(totalVisaQty - allocatedVisas, 0),
    openAuthorizations,
    cancelledAuthorizations,
    activeCandidates: activeCandidates.length,
    interviewPassed,
    medicalPassed,
    ticketsIssued,
    arrived,
    joined,
    requestsWithoutVisa: reports.requestsWithoutVisa.length,
    visasWithoutAuthorization: reports.visasWithoutAuthorization.length,
    candidatesWithoutInterviews: reports.candidatesWithoutInterviews.length,
    lateSlaItems: reports.lateItems.length,
    topProjects,
    arrivalsNext30Days,
    recruitmentFunnel,
  };
}, [requests, requestLines, visaRecords, visaAllocations, visaAuthorizations, candidates, interviews, reports]);

 async function generateRequestNo() {
  const year = new Date().getFullYear();

  const { data, error } = await supabase
    .from("requests")
    .select("request_no")
    .eq("company_id", currentCompanyId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    return `REQ-${year}-0001`;
  }

  const lastRequestNo = data[0].request_no || "";

  const lastNumber = parseInt(
    lastRequestNo.split("-")[2] || "0",
    10
  );

  const nextNumber = String(lastNumber + 1).padStart(4, "0");

  return `REQ-${year}-${nextNumber}`;
}

  async function addAudit(requestId, action, details) {
    if (!requestId) return;
    await supabase.from("request_audit_logs").insert([withCompany({ request_id: requestId, action, details, changed_by: "Recruitment" })]);
    loadAuditLogs();
  }

  function getRequestLinesForRequest(request) {
    if (!request) return [];

    const storedLines = requestLines
      .filter(
        (line) =>
          String(line.request_id || "") === String(request.id || "") ||
          String(line.request_no || "") === String(request.request_no || "")
      )
      .sort((a, b) => Number(a.line_no || 0) - Number(b.line_no || 0));

    if (storedLines.length > 0) return storedLines;

    if (request.profession || request.quantity || request.nationality || request.gender) {
      return [
        {
          id: `${request.id || request.request_no}-legacy`,
          request_id: request.id,
          request_no: request.request_no,
          line_no: 1,
          profession: request.profession || "",
          nationality: request.nationality || "",
          gender: request.gender || "",
          quantity: Number(request.quantity || request.qty || 0),
          salary: request.salary || "",
          interview_required: request.interview_required || "Required",
          interview_type: request.interview_type || "Online",
          notes: request.notes || "",
        },
      ];
    }

    return [];
  }

  function getRequestTotalQty(request) {
    const lines = getRequestLinesForRequest(request);
    const total = lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
    return total || Number(request?.quantity || request?.qty || 0);
  }

  function getRequestLineSummary(request, field) {
    const values = getRequestLinesForRequest(request)
      .map((line) => line[field])
      .filter(Boolean);

    const unique = Array.from(new Set(values));

    if (unique.length === 0) return "-";
    if (unique.length === 1) return unique[0];
    return `Multiple (${unique.length})`;
  }

  function addRequestLineToDraft() {
    if (!requestLineForm.profession || !requestLineForm.quantity) {
      return alert("Please fill Profession and Quantity for the request line.");
    }

    setRequestLinesDraft((prev) => [
      ...prev,
      {
        ...requestLineForm,
        quantity: Number(requestLineForm.quantity || 0),
        salary: requestLineForm.salary || requestForm.salary || "",
        interview_required: requestLineForm.interview_required || "Required",
        interview_type:
          requestLineForm.interview_required === "No Interview"
            ? "N/A"
            : requestLineForm.interview_type || "Online",
      },
    ]);

    setRequestLineForm(emptyRequestLine);
  }

  function removeRequestLineFromDraft(index) {
    setRequestLinesDraft((prev) => prev.filter((_, i) => i !== index));
  }

  function buildRequestLinesToSave() {
    const draftLines = requestLinesDraft.length > 0 ? requestLinesDraft : [];

    if (draftLines.length > 0) {
      return draftLines.map((line) => ({
        profession: line.profession || "",
        nationality: line.nationality || "",
        gender: line.gender || "",
        quantity: Number(line.quantity || 0),
        salary: line.salary || "",
        interview_required: line.interview_required || "Required",
        interview_type: line.interview_required === "No Interview" ? "N/A" : line.interview_type || "Online",
        notes: line.notes || "",
      }));
    }

    if (requestForm.profession && requestForm.quantity) {
      return [
        {
          profession: requestForm.profession || "",
          nationality: requestForm.nationality || "",
          gender: requestForm.gender || "",
          quantity: Number(requestForm.quantity || 0),
          salary: requestForm.salary || "",
          interview_required: requestForm.interview_required || "Required",
          interview_type:
            requestForm.interview_required === "No Interview"
              ? "N/A"
              : requestForm.interview_type || "Online",
          notes: requestForm.notes || "",
        },
      ];
    }

    return [];
  }

  function resetRequestForm() {
    setRequestForm(emptyRequest);
    setRequestLineForm(emptyRequestLine);
    setRequestLinesDraft([]);
    setRequestEditingId(null);
  }

  function editRequest(item) {
    const lines = getRequestLinesForRequest(item);

    setRequestEditingId(item.id);
    setRequestForm({
      recruitment_type: item.recruitment_type || (isSaudiNationality(item.nationality) ? "Saudi" : "Foreign"),
      request_type: item.request_type || "",
      project_name: item.project_name || "",
      department: item.department || "",
      profession: item.profession || lines[0]?.profession || "",
      quantity: item.quantity || lines[0]?.quantity || "",
      nationality: item.nationality || lines[0]?.nationality || "",
      gender: item.gender || lines[0]?.gender || "",
      salary: item.salary || lines[0]?.salary || "",
      priority: item.priority || "Normal",
      status: item.status || "Open",
      requested_by: item.requested_by || "",
      project_start: item.project_start || "",
      interview_required: item.interview_required || lines[0]?.interview_required || "Required",
      interview_type: item.interview_type || lines[0]?.interview_type || "Online",
      notes: item.notes || "",
    });

    setRequestLinesDraft(
      lines.map((line) => ({
        profession: line.profession || "",
        nationality: line.nationality || "",
        gender: line.gender || "",
        quantity: Number(line.quantity || 0),
        salary: line.salary || "",
        interview_required: line.interview_required || "Required",
        interview_type: line.interview_type || "Online",
        notes: line.notes || "",
      }))
    );

    setActivePage("Requests");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveRequest() {
    if (!canCreateRequest && !requestEditingId) return alert("You do not have permission to create requests.");
    if (!canEditRequest && requestEditingId) return alert("You do not have permission to edit requests.");

    const linesToSave = buildRequestLinesToSave();

    if (!requestForm.request_type || linesToSave.length === 0) {
      alert("Please fill Request Type and add at least one request line.");
      return;
    }

    const totalQuantity = linesToSave.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
    const firstLine = linesToSave[0] || {};

    const payload = {
      ...requestForm,
      notes: requestForm.notes || "",
      profession: firstLine.profession || requestForm.profession || "",
      quantity: totalQuantity,
      nationality: firstLine.nationality || requestForm.nationality || "",
      gender: firstLine.gender || requestForm.gender || "",
      salary: firstLine.salary || requestForm.salary || "",
      interview_required: firstLine.interview_required || requestForm.interview_required || "Required",
      interview_type: firstLine.interview_type || requestForm.interview_type || "Online",
      project_start: requestForm.project_start || null,
      request_no: requestEditingId ? undefined : await generateRequestNo(),
      approval_status: requestEditingId ? undefined : "Pending Recruitment Approval",
      request_status: requestEditingId ? undefined : "Draft",
      updated_at: new Date().toISOString(),
    };

    Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

    const result = requestEditingId
      ? await supabase.from("requests").update(payload).eq("id", requestEditingId).select().single()
      : await supabase.from("requests").insert([withCompany(payload)]).select().single();

    if (result.error) return alert(result.error.message);

    const savedRequest = result.data;

    const deleteQuery = supabase
      .from("request_lines")
      .delete()
      .eq("company_id", currentCompanyId);

    const deleteResult = requestEditingId
      ? await deleteQuery.eq("request_id", savedRequest.id)
      : { error: null };

    if (deleteResult.error) return alert(`request_lines delete: ${deleteResult.error.message}`);

    const linePayload = linesToSave.map((line, index) =>
      withCompany({
        request_id: savedRequest.id,
        request_no: savedRequest.request_no,
        line_no: index + 1,
        profession: line.profession || "",
        nationality: line.nationality || "",
        gender: line.gender || "",
        quantity: Number(line.quantity || 0),
        salary: line.salary || null,
        interview_required: line.interview_required || "Required",
        interview_type: line.interview_required === "No Interview" ? "N/A" : line.interview_type || "Online",
        notes: line.notes || "",
      })
    );

    const lineResult = await supabase.from("request_lines").insert(linePayload);
    if (lineResult.error) return alert(`request_lines insert: ${lineResult.error.message}`);

    await addAudit(
      savedRequest.id,
      requestEditingId ? "Updated" : "Created",
      requestEditingId ? "Request header and lines were updated" : "Request header and lines were created"
    );

    alert(requestEditingId ? "Request updated successfully" : `Request saved successfully: ${savedRequest.request_no}`);
    resetRequestForm();
    await loadRequests();
    await loadRequestLines();
  }

  async function approveRequest(item) {
    if (!canApproveRequest) return alert("You do not have permission to approve requests.");
    const { error } = await supabase
      .from("requests")
      .update({ approval_status: "Approved by Recruitment", request_status: "Approved", updated_at: new Date().toISOString() })
      .eq("id", item.id);
    if (error) return alert(error.message);
    await addAudit(item.id, "Approved", "Final approval by Recruitment Department");
    loadRequests();
  }

  async function rejectRequest(item) {
    if (!canApproveRequest) return alert("You do not have permission to reject requests.");
    const reason = window.prompt("Rejection reason:") || "Rejected by Recruitment";
    const { error } = await supabase
      .from("requests")
      .update({
        approval_status: "Rejected by Recruitment",
        request_status: "Rejected",
        notes: `${item.notes || ""}\nRejection: ${reason}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    if (error) return alert(error.message);
    await addAudit(item.id, "Rejected", reason);
    loadRequests();
  }

  async function deleteRequest(id) {
    if (!canDeleteRequest) return alert("You do not have permission to delete requests.");
    if (!window.confirm("Delete this request?")) return;
    const { error } = await supabase.from("requests").delete().eq("id", id);
    if (error) return alert(error.message);
    loadRequests();
  }

  function resetVisaForm() {
    setVisaForm(emptyVisa);
    setVisaLineForm(emptyVisaLine);
    setVisaLinesDraft([]);
    setVisaEditingId(null);
  }

  function addVisaLineToDraft() {
    if (!visaLineForm.profession || !visaLineForm.nationality || !visaLineForm.gender || !visaLineForm.quantity) {
      return alert("Please fill profession, nationality, gender and quantity for the visa line.");
    }

    setVisaLinesDraft((prev) => [
      ...prev,
      {
        ...visaLineForm,
        quantity: Number(visaLineForm.quantity || 0),
      },
    ]);

    setVisaLineForm(emptyVisaLine);
  }

  function removeVisaLineFromDraft(index) {
    setVisaLinesDraft((prev) => prev.filter((_, i) => i !== index));
  }

  function buildVisaLinesToSave() {
    if (visaLinesDraft.length > 0) {
      return visaLinesDraft.map((line) => ({
        profession: line.profession || "",
        nationality: line.nationality || "",
        gender: line.gender || "",
        quantity: Number(line.quantity || 0),
        notes: line.notes || "",
      }));
    }

    if (visaForm.profession && visaForm.nationality && visaForm.gender && visaForm.quantity) {
      return [
        {
          profession: visaForm.profession || "",
          nationality: visaForm.nationality || "",
          gender: visaForm.gender || "",
          quantity: Number(visaForm.quantity || 0),
          notes: visaForm.notes || "",
        },
      ];
    }

    return [];
  }

  function editVisa(item) {
    const lines = getVisaLinesForBatch(item);
    const firstLine = lines[0] || {};

    setVisaEditingId(item.id);
    setVisaForm({
      request_no: item.request_no || "",
      visa_no: item.visa_no || "",
      moi_no: item.moi_no || "",
      project: item.project || "",
      profession: firstLine.profession || item.profession || "",
      nationality: firstLine.nationality || item.nationality || "",
      gender: firstLine.gender || item.gender || "",
      
      
      quantity: getVisaBatchTotalQty(item) || item.quantity || "",
      authorized: item.authorized || "",
      allocated_qty: getVisaBatchAllocatedQty(item) || item.allocated_qty || "",
      remaining_qty: getVisaBatchRemainingQty(item) || item.remaining_qty || "",
      authorization_no: item.authorization_no || "",
      issue_date: item.issue_date || "",
      expiry_date: item.expiry_date || "",
      status: item.status || "Pending",
      notes: item.notes || "",
    });

    setVisaLinesDraft(
      lines.map((line) => ({
        profession: line.profession || "",
        nationality: line.nationality || "",
        gender: line.gender || "",
        quantity: Number(line.quantity || 0),
        notes: line.notes || "",
      }))
    );

    setActivePage("Visa Inventory");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

async function saveVisa() {
  if (!canManageVisas) return alert("You do not have permission to manage visas.");

  if (!visaForm.visa_no) return alert("Visa No is required.");

  const linesToSave = buildVisaLinesToSave();
  if (linesToSave.length === 0) {
    return alert("Please add at least one visa line with profession, nationality, gender and quantity.");
  }

  const totalQuantity = linesToSave.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const firstLine = linesToSave[0] || {};

  const payload = {
    request_no: visaForm.request_no || "",
    visa_no: visaForm.visa_no || "",
    moi_no: visaForm.moi_no || "",
    project: visaForm.project || "",
    profession: firstLine.profession || "",
    nationality: firstLine.nationality || "",
    gender: firstLine.gender || "",
    
    
    quantity: totalQuantity,
    authorized: Number(visaForm.authorized || 0),
    allocated_qty: visaEditingId ? getVisaBatchAllocatedQty(visaRecords.find((v) => String(v.id) === String(visaEditingId))) : 0,
    remaining_qty: totalQuantity,
    authorization_no: visaForm.authorization_no || "",
    issue_date: visaForm.issue_date || null,
    expiry_date: visaForm.expiry_date || null,
    status: visaForm.status || "Pending",
    notes: visaForm.notes || "",
    updated_at: new Date().toISOString(),
  };

  const result = visaEditingId
    ? await supabase.from("visa_batches").update(payload).eq("id", visaEditingId).select().single()
    : await supabase.from("visa_batches").insert([withCompany(payload)]).select().single();

  if (result.error) return alert(result.error.message);

  const savedBatch = result.data;

  if (visaEditingId) {
    const deleteLines = await supabase
      .from("visa_batch_lines")
      .delete()
      .eq("visa_batch_id", savedBatch.id)
      .eq("company_id", currentCompanyId);

    if (deleteLines.error) return alert(`visa_batch_lines delete: ${deleteLines.error.message}`);
  }

  const linePayload = linesToSave.map((line, index) =>
    withCompany({
      visa_batch_id: savedBatch.id,
      visa_no: savedBatch.visa_no,
      line_no: index + 1,
      profession: line.profession || "",
      nationality: line.nationality || "",
      gender: line.gender || "",
      quantity: Number(line.quantity || 0),
      allocated_qty: 0,
      notes: line.notes || "",
    })
  );

  const lineResult = await supabase.from("visa_batch_lines").insert(linePayload);
  if (lineResult.error) return alert(`visa_batch_lines insert: ${lineResult.error.message}`);

  alert(visaEditingId ? "Visa batch updated successfully" : "Visa batch saved successfully");
  resetVisaForm();
  await loadVisaRecords();
  await loadVisaBatchLines();
}

  async function deleteVisa(id) {
    if (!canManageVisas) return alert("You do not have permission to delete visas.");
    if (!window.confirm("Delete this visa record?")) return;

    const { error } = await supabase.from("visa_batches").delete().eq("id", id);

    if (error) {
      alert(error.message);
      return;
    }

    await loadVisaRecords();
  }

  function resetAgencyForm() {
    setAgencyForm(emptyAgency);
    setAgencyEditingId(null);
  }

  function editAgency(item) {
    setAgencyEditingId(item.id);
    setAgencyForm({
      name: item.name || "",
      country: item.country || "",
      contact_person: item.contact_person || "",
      email: item.email || "",
      phone: item.phone || "",
      status: item.status || "Active",
    });
    setActivePage("Agencies");
  }

function editCompany(company) {
  setCompanyEditingId(company.id);
  setCompanyForm({
    name: company.name || "",
    domain: company.domain || "",
    status: company.status || "Active",
    subscription_plan: company.subscription_plan || "Trial",
    subscription_status: company.subscription_status || "Active",
    subscription_start: company.subscription_start || "",
    subscription_end: company.subscription_end || "",
    max_users: company.max_users || 5,
    notes: company.notes || "",
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function getCompanyEmailRecipient(kind = "notifications") {
  const settings = companyEmailSettings || {};
  if (kind === "agreements") return settings.agreements_email || settings.notifications_email || settings.support_email || "agreements@visaflowksa.com";
  if (kind === "support") return settings.support_email || settings.notifications_email || "support@visaflowksa.com";
  return settings.notifications_email || settings.support_email || "notifications@visaflowksa.com";
}

function getAgencyEmailByName(agencyName) {
  const agency = agencies.find((item) => normalize(item.name) === normalize(agencyName));
  return agency?.email || "";
}

function buildEmailCardHtml(title, lines = [], actionText = "") {
  const safeTitle = String(title || "VisaFlow Notification");
  const bodyRows = lines
    .filter((line) => line !== undefined && line !== null && String(line).trim() !== "")
    .map((line) => `<p style="margin:0 0 10px;line-height:1.7;">${String(line).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</p>`)
    .join("");

  return `
  <div style="margin:0;padding:24px;background:#f4f7fb;font-family:Arial,Tahoma,sans-serif;color:#0f172a;">
    <div style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;">
      <div style="background:#061b49;color:#ffffff;padding:22px 26px;">
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.75;">VisaFlow KSA</div>
        <h1 style="margin:8px 0 0;font-size:22px;line-height:1.3;">${safeTitle}</h1>
      </div>
      <div style="padding:24px 26px;font-size:15px;line-height:1.7;">
        ${bodyRows || `<p>${safeTitle}</p>`}
        ${actionText ? `<div style="margin-top:18px;padding:14px 16px;background:#eef6ff;border-radius:12px;border:1px solid #bfdbfe;">${actionText}</div>` : ""}
      </div>
      <div style="padding:14px 26px;background:#f8fafc;color:#64748b;font-size:12px;">This message was generated by VisaFlow KSA.</div>
    </div>
  </div>`;
}

async function dispatchVisaFlowEmail({ type, to, cc, bcc, subject, text, html, replyTo, payload = {} }) {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : String(to || "").split(/[;,]/).map((item) => item.trim()).filter(Boolean);

  if (!recipients.length) {
    await recordEmailLog({
      type,
      status: "Skipped",
      to_email: "",
      cc_email: cc || "",
      bcc_email: bcc || "",
      subject,
      error_message: "Recipient email is missing",
      payload,
    });
    console.warn("Email skipped because recipient is missing", { type, subject, payload });
    return { ok: false, skipped: true, reason: "Recipient email is missing" };
  }

  try {
    const { data, error } = await supabase.functions.invoke("visaflow-email-dispatcher", {
      body: {
        type,
        company_id: currentCompanyId,
        to: recipients,
        cc,
        bcc,
        subject,
        text,
        html,
        replyTo,
        payload: {
          ...payload,
          company_id: currentCompanyId,
          triggered_by: currentUser?.email || currentUser?.name || "VisaFlow User",
          triggered_at: new Date().toISOString(),
        },
      },
    });

    if (error) throw new Error(error.message || "Email dispatcher failed");
    if (data && data.ok === false) throw new Error(data.error || "Email dispatcher failed");

    await recordEmailLog({
      type,
      status: "Sent",
      to_email: recipients.join(", "),
      cc_email: cc || "",
      bcc_email: bcc || "",
      subject,
      provider: data?.provider || companyEmailSettings?.provider || "VisaFlow Dispatcher",
      message_id: data?.messageId || data?.id || "",
      payload,
    });

    return data || { ok: true };
  } catch (error) {
    await recordEmailLog({
      type,
      status: "Failed",
      to_email: recipients.join(", "),
      cc_email: cc || "",
      bcc_email: bcc || "",
      subject,
      error_message: error.message || "Email dispatcher failed",
      payload,
    });
    throw error;
  }
}

async function saveCompanyEmailSettings({ silent = false } = {}) {
  if (!canManageUsers) return alert("You do not have permission to manage email settings.");

  const useCompanyEmail = emailSettingsForm.mode === "company";
  if (useCompanyEmail) {
    if (!emailSettingsForm.smtp_host || !emailSettingsForm.smtp_username || !emailSettingsForm.from_email) {
      return alert("SMTP host, SMTP username and From Email are required when company email is enabled.");
    }
    if (!emailSettingsForm.id && !emailSettingsForm.smtp_password) {
      return alert("SMTP password is required for the first setup.");
    }
  }

  setEmailSettingsLoading(true);
  setEmailSettingsMessage("");

  try {
    const payload = {
      company_id: currentCompanyId,
      mode: emailSettingsForm.mode || "platform",
      provider: emailSettingsForm.provider || "SMTP",
      smtp_host: emailSettingsForm.smtp_host || "",
      smtp_port: Number(emailSettingsForm.smtp_port || 465),
      smtp_secure: emailSettingsForm.smtp_secure === true || emailSettingsForm.smtp_secure === "true",
      smtp_username: emailSettingsForm.smtp_username || "",
      from_name: emailSettingsForm.from_name || companies[0]?.name || "Company Recruitment",
      from_email: emailSettingsForm.from_email || "",
      reply_to: emailSettingsForm.reply_to || emailSettingsForm.support_email || "",
      agreements_email: emailSettingsForm.agreements_email || emailSettingsForm.reply_to || "",
      notifications_email: emailSettingsForm.notifications_email || emailSettingsForm.reply_to || "",
      support_email: emailSettingsForm.support_email || emailSettingsForm.reply_to || "",
      is_active: Boolean(emailSettingsForm.is_active),
      updated_at: new Date().toISOString(),
    };

    if (emailSettingsForm.smtp_password) {
      payload.smtp_password = emailSettingsForm.smtp_password;
      payload.is_verified = false;
      payload.last_test_status = "Password Updated - Test Required";
    }

    const result = emailSettingsForm.id
      ? await supabase
          .from("company_email_settings")
          .update(payload)
          .eq("id", emailSettingsForm.id)
          .eq("company_id", currentCompanyId)
          .select()
          .single()
      : await supabase
          .from("company_email_settings")
          .insert([{ ...payload, created_at: new Date().toISOString() }])
          .select()
          .single();

    if (result.error) throw result.error;

    setCompanyEmailSettings(result.data || null);
    setEmailSettingsForm((prev) => ({
      ...prev,
      ...(result.data || {}),
      smtp_password: "",
      smtp_port: result.data?.smtp_port ? String(result.data.smtp_port) : prev.smtp_port,
      smtp_secure: result.data?.smtp_secure === false ? "false" : "true",
      test_email: prev.test_email,
    }));

    if (!silent) setEmailSettingsMessage("Email settings saved successfully.");
    await loadCompanyEmailSettings();
    return result.data;
  } catch (error) {
    if (!silent) setEmailSettingsMessage(`Email settings save failed: ${error.message}`);
    throw error;
  } finally {
    setEmailSettingsLoading(false);
  }
}

async function testCompanyEmailSettings() {
  if (!canManageUsers) return alert("You do not have permission to test email settings.");
  const testEmail = String(emailSettingsForm.test_email || localStorage.getItem("visaflow_last_test_email") || currentUser?.email || "").trim();
  if (!testEmail) return alert("Please enter a test recipient email.");

  localStorage.setItem("visaflow_last_test_email", testEmail);

  setEmailSettingsLoading(true);
  setEmailSettingsMessage("Saving settings and sending test email...");

  try {
    await saveCompanyEmailSettings({ silent: true });
    const subject = "VisaFlow Email Settings Test";
    const text = `This is a test email from VisaFlow for company ${companies[0]?.name || currentCompanyId}. If you received this message, your company email settings are working.`;
    const response = await dispatchVisaFlowEmail({
      type: "COMPANY_EMAIL_TEST",
      to: testEmail,
      subject,
      text,
      html: buildEmailCardHtml(subject, [text], "This test verifies company SMTP settings."),
      payload: { test_email: testEmail },
    });

    await supabase
      .from("company_email_settings")
      .update({
        is_verified: true,
        last_test_at: new Date().toISOString(),
        last_test_status: "Success",
        last_error: "",
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", currentCompanyId);

    await loadCompanyEmailSettings();
    setEmailSettingsMessage(`Test email sent successfully${response?.messageId ? ` (${response.messageId})` : ""}.`);
  } catch (error) {
    await supabase
      .from("company_email_settings")
      .update({
        is_verified: false,
        last_test_at: new Date().toISOString(),
        last_test_status: "Failed",
        last_error: error.message || "Test failed",
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", currentCompanyId);
    await loadCompanyEmailSettings();
    setEmailSettingsMessage(`Test email failed: ${error.message}`);
  } finally {
    setEmailSettingsLoading(false);
  }
}

async function saveCompany() {
  if (!canManageUsers) return alert("You do not have permission to manage company settings.");
  if (!companyEditingId) return alert("Please select a company to update.");
  if (!companyForm.name) return alert("Company name is required.");

  const payload = {
    name: companyForm.name,
    domain: companyForm.domain || "",
    status: companyForm.status || "Active",
    subscription_plan: companyForm.subscription_plan || "Trial",
    subscription_status: companyForm.subscription_status || "Active",
    subscription_start: companyForm.subscription_start || null,
    subscription_end: companyForm.subscription_end || null,
    max_users: Number(companyForm.max_users || 5),
    notes: companyForm.notes || "",
  };

  const { error } = await supabase
    .from("companies")
    .update(payload)
    .eq("id", companyEditingId)
    .eq("id", currentCompanyId);

  if (error) return alert(error.message);

  setCompanyEditingId(null);
  setCompanyForm({
    name: "",
    domain: "",
    status: "Active",
    subscription_plan: "Trial",
    subscription_status: "Active",
    subscription_start: "",
    subscription_end: "",
    max_users: 5,
    notes: "",
  });
  await loadCompanies();
  alert("Company settings updated successfully");
}

function cancelCompanyEdit() {
  setCompanyEditingId(null);
  setCompanyForm({
    name: "",
    domain: "",
    status: "Active",
    subscription_plan: "Trial",
    subscription_status: "Active",
    subscription_start: "",
    subscription_end: "",
    max_users: 5,
    notes: "",
  });
}
async function saveUser() {
  if (!canManageUsers) return alert("You do not have permission to manage users.");
  if (!userForm.name) return alert("User name is required.");
  if (!userForm.email) return alert("Email is required.");

  const savingPlatformUser =
    canManagePlatformAccounts && activePage === "Platform Users";

  const effectiveRole = savingPlatformUser
    ? (isPlatformRole(userForm.role) ? userForm.role : "Platform Accounts User")
    : (userForm.role || "Viewer");

  const cleanEmail = userForm.email.trim().toLowerCase();
  const selectedAgency = effectiveRole === "Agency"
    ? agencies.find((agency) => String(agency.id || "") === String(userForm.agency_id || "")) ||
      agencies.find((agency) => normalize(agency.name) === normalize(userForm.agency_name))
    : null;

  if (effectiveRole === "Agency" && !selectedAgency?.id) {
    return alert("Please select the agency for this Agency user.");
  }

  if (!savingPlatformUser && !isPlatformRole(effectiveRole) && effectiveRole !== "Agency" && !currentCompanyId) {
    return alert("Company ID is missing. User save was blocked to prevent cross-company data mixing.");
  }

  const { data: existingUser, error: findUserError } = await supabase
    .from("users")
    .select("*")
    .eq("email", cleanEmail)
    .maybeSingle();

  if (findUserError) return alert(findUserError.message);

  if (existingUser && String(existingUser.id) !== String(userEditingId || "")) {
    if (effectiveRole !== "Agency") {
      return alert("Email already exists in the platform.");
    }

    if (normalizeUserRole(existingUser.role) !== "Agency") {
      return alert("This email is already used by an internal company/platform user and cannot be linked as an agency user.");
    }

    if (existingUser.agency_id && String(existingUser.agency_id) !== String(selectedAgency.id)) {
      return alert("This email is already linked to another agency and cannot be linked to the selected agency.");
    }
  }

  if (!existingUser && !userEditingId && !userForm.password) {
    return alert("Password is required for new users.");
  }

  if (effectiveRole === "Agency") {
    let agencyUserId = userEditingId || existingUser?.id || null;

    const agencyPayload = {
      name: userForm.name,
      email: cleanEmail,
      role: "Agency",
      status: userForm.status || "Active",
      company_id: null,
      agency_id: selectedAgency.id,
      agency_name: selectedAgency.name || userForm.agency_name || "",
    };

    if (userForm.password) agencyPayload.password = userForm.password.trim();

    if (agencyUserId) {
      const { error: updateError } = await supabase
        .from("users")
        .update(agencyPayload)
        .eq("id", agencyUserId);

      if (updateError) return alert(updateError.message);
    } else {
      const { data: createdUser, error: createError } = await supabase
        .from("users")
        .insert([{ ...agencyPayload, password: userForm.password.trim() }])
        .select("*")
        .single();

      if (createError) return alert(createError.message);
      agencyUserId = createdUser.id;
    }

    const { error: memberError } = await supabase
      .from("agency_members")
      .upsert(
        [{ agency_id: selectedAgency.id, user_id: agencyUserId, role: "Agency User", status: userForm.status || "Active" }],
        { onConflict: "agency_id,user_id" }
      );

    if (memberError) return alert(memberError.message);

    const { error: companyAccessError } = await supabase
      .from("company_agency_access")
      .upsert(
        [{
          company_id: currentCompanyId,
          agency_id: selectedAgency.id,
          status: "Active",
          can_view_requests: true,
          can_upload_candidates: true,
          can_update_candidates: true,
          can_view_interviews: true,
        }],
        { onConflict: "company_id,agency_id" }
      );

    if (companyAccessError) return alert(companyAccessError.message);

    const { error: userAccessError } = await supabase
      .from("agency_company_user_access")
      .upsert(
        [{
          company_id: currentCompanyId,
          agency_id: selectedAgency.id,
          user_id: agencyUserId,
          role: "Agency User",
          status: userForm.status || "Active",
          can_view_requests: true,
          can_upload_candidates: true,
          can_update_candidates: true,
          can_view_interviews: true,
        }],
        { onConflict: "company_id,agency_id,user_id" }
      );

    if (userAccessError) return alert(userAccessError.message);

    setUserForm({
      name: "",
      email: "",
      password: "",
      role: savingPlatformUser ? "Platform Accounts User" : "Viewer",
      status: "Active",
      agency_id: "",
      agency_name: "",
    });

    setUserEditingId(null);
    await loadUsers();
    await loadAgencies();
    alert("Agency user access has been saved for this company.");
    return;
  }

  const payload = {
    name: userForm.name,
    email: cleanEmail,
    role: effectiveRole,
    status: userForm.status || "Active",
    agency_id: null,
    agency_name: "",
  };

  if (userForm.password) payload.password = userForm.password.trim();

  const isInternalPlatformUser = isPlatformRole(payload.role);
  const userPayload = isInternalPlatformUser
    ? { ...payload, company_id: null }
    : withCompany(payload);

  const result = userEditingId
    ? await supabase.from("users").update(userPayload).eq("id", userEditingId)
    : await supabase.from("users").insert([userPayload]);

  if (result.error) return alert(result.error.message);

  setUserForm({
    name: "",
    email: "",
    password: "",
    role: savingPlatformUser ? "Platform Accounts User" : "Viewer",
    status: "Active",
    agency_id: "",
    agency_name: "",
  });

  setUserEditingId(null);
  await loadUsers();
}

async function findExistingAgencyByName(name) {
  const normalizedName = normalize(name);
  if (!normalizedName) return null;

  const { data, error } = await supabase
    .from("agencies")
    .select("*")
    .range(0, 5000);

  if (error) throw error;

  return (data || []).find((agency) => normalize(agency.name) === normalizedName) || null;
}

async function saveAgency() {
  if (!canManageAgencies) return alert("You do not have permission to manage agencies.");
  if (!agencyForm.name) return alert("Agency name is required.");
  if (!currentCompanyId && !canManagePlatform) return alert("Company ID is missing.");

  const cleanName = String(agencyForm.name || "").trim();
  const payload = {
    name: cleanName,
    country: agencyForm.country || "",
    contact_person: agencyForm.contact_person || "",
    email: agencyForm.email || "",
    phone: agencyForm.phone || "",
    status: agencyForm.status || "Active",
    company_id: null,
    updated_at: new Date().toISOString(),
  };

  let agencyId = agencyEditingId || null;
  let linkedExistingAgency = false;

  try {
    if (agencyEditingId) {
      const { error } = await supabase
        .from("agencies")
        .update(payload)
        .eq("id", agencyEditingId);

      if (error) return alert(error.message);
    } else {
      const existingAgency = await findExistingAgencyByName(cleanName);

      if (existingAgency) {
        agencyId = existingAgency.id;
        linkedExistingAgency = true;
      } else {
        const { data, error } = await supabase
          .from("agencies")
          .insert([payload])
          .select("*")
          .single();

        if (error) return alert(error.message);
        agencyId = data.id;
      }
    }

    if (currentCompanyId && agencyId) {
      const { error: accessError } = await supabase
        .from("company_agency_access")
        .upsert(
          [{
            company_id: currentCompanyId,
            agency_id: agencyId,
            status: "Active",
            can_view_requests: true,
            can_upload_candidates: true,
            can_update_candidates: true,
            can_view_interviews: true,
          }],
          { onConflict: "company_id,agency_id" }
        );

      if (accessError) return alert(accessError.message);
    }
  } catch (error) {
    return alert(error.message || "Agency save failed.");
  }

  resetAgencyForm();
  await loadAgencies();
  alert(linkedExistingAgency ? "Existing agency has been linked to this company." : agencyEditingId ? "Agency updated successfully." : "Agency saved and linked to this company.");
}
  function editUser(user) {
  setUserForm({
    name: user.name || "",
    email: user.email || "",
    password: user.password || "",
    role: user.role || "Viewer",
    status: user.status || "Active",
    agency_id: user.agency_id || "",
    agency_name: user.agency_name || "",
  });

  setUserEditingId(user.id);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteUser(id) {
  if (!canManageUsers) return alert("You do not have permission to delete users.");
  if (!window.confirm("Delete this user?")) return;

  const { error } = await supabase
    .from("users")
    .delete()
    .eq("id", id);

  if (error) return alert(error.message);

  loadUsers();
}

  async function deleteAgency(id) {
    if (!canManageAgencies) return alert("You do not have permission to manage agencies.");

    if (canManagePlatform) {
      if (!window.confirm("Delete this agency from the whole platform? This may affect all linked companies.")) return;
      const { error } = await supabase.from("agencies").delete().eq("id", id);
      if (error) return alert(error.message);
      await loadAgencies();
      return;
    }

    if (!currentCompanyId) return alert("Company ID is missing.");
    if (!window.confirm("Remove this agency access from this company? The agency itself will remain available for other companies.")) return;

    const { error: userAccessError } = await supabase
      .from("agency_company_user_access")
      .delete()
      .eq("company_id", currentCompanyId)
      .eq("agency_id", id);

    if (userAccessError) return alert(userAccessError.message);

    const { error: companyAccessError } = await supabase
      .from("company_agency_access")
      .delete()
      .eq("company_id", currentCompanyId)
      .eq("agency_id", id);

    if (companyAccessError) return alert(companyAccessError.message);

    await loadAgencies();
    await loadUsers();
    alert("Agency access has been removed from this company.");
  }

function getAgreementTemplateDefaults(templateType) {
  const type = templateType || "Standard Recruitment SLA";

  // Templates are operational presets only.
  // The company remains the decision maker for financial penalty value, grace period and financial guarantee.
  if (type === "High Volume Mobilization SLA") {
    return {
      sla_days: 45,
      response_sla_hours: 12,
      update_frequency_days: 3,
      replacement_guarantee_days: 120,
      payment_terms: "Payment may be linked to arrival, joining confirmation and accepted replacement guarantee terms.",
    };
  }

  if (type === "Premium Agency Partnership") {
    return {
      sla_days: 30,
      response_sla_hours: 8,
      update_frequency_days: 2,
      replacement_guarantee_days: 180,
      payment_terms: "Priority payment cycle applies after verified arrival, joining and complete documentation.",
    };
  }

  if (type === "Project-Based Recruitment SLA") {
    return {
      sla_days: 60,
      response_sla_hours: 24,
      update_frequency_days: 7,
      replacement_guarantee_days: 90,
      payment_terms: "Payment is linked to project mobilization milestones and joining confirmation.",
    };
  }

  return {
    sla_days: 60,
    response_sla_hours: 24,
    update_frequency_days: 7,
    replacement_guarantee_days: 90,
    payment_terms: "Payment after arrival and joining confirmation unless otherwise agreed.",
  };
}

function buildAgreementTermsFromPolicy(source = agreementForm) {
  const guaranteeText = source.financial_guarantee_required === "Yes"
    ? `Financial guarantee required: ${Number(source.financial_guarantee_amount || 0).toLocaleString()} SAR.`
    : source.financial_guarantee_required === "Optional"
      ? "Financial guarantee is optional and may be requested based on project risk."
      : "No financial guarantee is required unless separately agreed.";

  return `AGENCY SERVICE LEVEL AGREEMENT / اتفاقية مستوى خدمة مكتب الاستقدام

Agreement Operational Template / قالب التشغيل: ${source.template_type || "Standard Recruitment SLA"}
Policy Name / اسم السياسة: ${source.policy_name || "Recruitment Agency Policy"}
Agency / المكتب: ${source.agency_name || "-"}

1. Scope of Service / نطاق الخدمة
The recruitment agency shall source, submit, update and mobilize candidates through VisaFlow KSA according to the company requirements, request lines, profession, nationality, gender and approved quantities.
يلتزم مكتب الاستقدام بتوفير المرشحين وتحديث بياناتهم ومتابعة إجراءاتهم عبر منصة VisaFlow KSA حسب طلبات الشركة والمهن والجنسيات والكميات المعتمدة.

2. SLA Duration / مدة إنجاز الطلب
The standard recruitment cycle must be completed within ${source.sla_days || 60} calendar day(s) from the assignment date unless a different written approval is issued.
مدة الإنجاز المعتمدة هي ${source.sla_days || 60} يوم من تاريخ إسناد الطلب ما لم يصدر اعتماد مختلف من الشركة.

3. Performance KPI Rules / قواعد تقييم أداء المكتب
The agency must respond within ${source.response_sla_hours || 24} hour(s) and update candidate/case records at least every ${source.update_frequency_days || 7} day(s). These rules affect agency KPI, ranking, allocation decisions and performance reports only. They do not create financial penalties by themselves.
يلتزم المكتب بالرد خلال ${source.response_sla_hours || 24} ساعة وتحديث بيانات المرشحين أو المعاملات كل ${source.update_frequency_days || 7} يوم كحد أقصى. هذه القواعد تؤثر على تقييم المكتب وترتيبه وقرارات إسناد الطلبات والتقارير فقط، ولا تتحول وحدها إلى غرامة مالية.

4. Company-Defined Labor SLA Delay Penalty / غرامة تأخير العمالة حسب قرار الشركة
Financial penalties apply only when labor/candidates exceed the agreed SLA duration. The company defines the penalty type, penalty value and grace period in this agreement. Penalty type: ${source.delay_penalty_type || "Fixed Amount Per Delayed Day"}. Penalty value: ${source.delay_penalty_amount === "" || source.delay_penalty_amount === null || source.delay_penalty_amount === undefined ? "Not specified" : `${Number(source.delay_penalty_amount || 0).toLocaleString()} SAR per chargeable delayed day`}. Grace period before penalty: ${source.delay_penalty_after_days === "" || source.delay_penalty_after_days === null || source.delay_penalty_after_days === undefined ? "Not specified" : `${source.delay_penalty_after_days} day(s)`}. All penalties remain subject to company review and final approval.
تطبق الغرامات المالية فقط عند تأخر العمالة أو المرشحين عن مدة SLA المتفق عليها. الشركة هي صاحبة القرار في تحديد نوع الغرامة وقيمتها وفترة السماح داخل هذه الاتفاقية. نوع الغرامة: ${source.delay_penalty_type || "Fixed Amount Per Delayed Day"}. قيمة الغرامة: ${source.delay_penalty_amount === "" || source.delay_penalty_amount === null || source.delay_penalty_amount === undefined ? "غير محددة" : `${Number(source.delay_penalty_amount || 0).toLocaleString()} ريال عن كل يوم تأخير قابل للغرامة`}. فترة السماح قبل الغرامة: ${source.delay_penalty_after_days === "" || source.delay_penalty_after_days === null || source.delay_penalty_after_days === undefined ? "غير محددة" : `${source.delay_penalty_after_days} يوم`}. وتبقى جميع الغرامات خاضعة لمراجعة الشركة واعتمادها النهائي.

5. Financial Guarantee / الضمان المالي
${guaranteeText}

6. Replacement Guarantee / ضمان الاستبدال
The agency shall support replacement cases within ${source.replacement_guarantee_days || 90} day(s) for failed, refused, absconded or non-compliant candidates according to the agreed terms.
يلتزم المكتب بدعم حالات الاستبدال خلال ${source.replacement_guarantee_days || 90} يوم للمرشحين غير المجتازين أو الرافضين للعمل أو المنقطعين أو غير المتوافقين حسب الشروط المتفق عليها.

7. Payment Terms / شروط الدفع
${source.payment_terms || "Payment after arrival and joining confirmation unless otherwise agreed."}

8. Cancellation / الإلغاء
${source.cancellation_terms || "The company may suspend allocation or terminate the agreement in case of repeated SLA breach, data manipulation, or non-compliance."}

9. Electronic Acceptance / القبول الإلكتروني
Agency approval through VisaFlow KSA is considered an electronic acceptance and operational signature for this agreement.
تعتبر موافقة المكتب عبر منصة VisaFlow KSA قبولاً إلكترونياً وتوقيعاً تشغيلياً على هذه الاتفاقية.`;
}

function applyAgreementTemplate(templateType) {
  const defaults = getAgreementTemplateDefaults(templateType);
  setAgreementForm((prev) => {
    const next = {
      ...prev,
      template_type: templateType,
      ...defaults,
    };
    return {
      ...next,
      terms: buildAgreementTermsFromPolicy(next),
    };
  });
}

function refreshAgreementTerms() {
  setAgreementForm((prev) => ({
    ...prev,
    terms: buildAgreementTermsFromPolicy(prev),
  }));
}

function generateAgreementNo() {
  const year = new Date().getFullYear();
  const prefix = `AGR-${year}-`;
  const maxNumber = agencyAgreements.reduce((max, item) => {
    const agreementNo = String(item.agreement_no || "");
    if (!agreementNo.startsWith(prefix)) return max;
    const numberPart = Number(agreementNo.replace(prefix, ""));
    return Number.isFinite(numberPart) ? Math.max(max, numberPart) : max;
  }, 0);
  const nextNumber = String(maxNumber + 1).padStart(4, "0");
  return `${prefix}${nextNumber}`;
}

function resetAgreementForm() {
  setAgreementForm(emptyAgreement);
  setAgreementEditingId(null);
}

function editAgreement(item) {
  setAgreementEditingId(item.id);
  setAgreementForm({
    agreement_no: item.agreement_no || "",
    agency_name: item.agency_name || "",
    template_type: item.template_type || "Standard Recruitment SLA",
    policy_name: item.policy_name || "Standard Recruitment Agency Policy",
    signed_by_company: item.signed_by_company || "",
    signed_by_agency: item.signed_by_agency || "",
    company_signature: item.company_signature || "",
    agency_signature: item.agency_signature || "",
    status: item.status || "Draft",
    sla_days: item.sla_days || 60,
    response_sla_hours: item.response_sla_hours || 24,
    update_frequency_days: item.update_frequency_days || 7,
    delay_penalty_type: item.delay_penalty_type || "Fixed Amount Per Delayed Day",
    delay_penalty_amount: item.delay_penalty_amount || 0,
    delay_penalty_after_days: item.delay_penalty_after_days || 7,
    financial_guarantee_required: item.financial_guarantee_required || "No",
    financial_guarantee_amount: item.financial_guarantee_amount || "",
    replacement_guarantee_days: item.replacement_guarantee_days || 90,
    payment_terms: item.payment_terms || emptyAgreement.payment_terms,
    cancellation_terms: item.cancellation_terms || emptyAgreement.cancellation_terms,
    effective_date: item.effective_date || "",
    expiry_date: item.expiry_date || "",
    terms: item.terms || emptyAgreement.terms,
  });
  setActivePage("Agency Agreements");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function sendAgreementSentEmail(agreement) {
  const toEmail = getAgencyEmailByName(agreement?.agency_name);
  if (!toEmail) return { ok: false, skipped: true, reason: "Agency email is missing" };
  const subject = `VisaFlow Agreement Requires Acceptance - ${agreement?.agreement_no || "Agreement"}`;
  const text = `Dear ${agreement?.agency_name || "Agency"},

A recruitment agency agreement has been sent to your Office Portal for review and electronic acceptance.

Agreement No: ${agreement?.agreement_no || "-"}
SLA Days: ${agreement?.sla_days || "-"}

Please login to VisaFlow Office Portal to review and accept the agreement.

VisaFlow KSA`;
  return dispatchVisaFlowEmail({
    type: "AGENCY_AGREEMENT_SENT",
    to: toEmail,
    replyTo: getCompanyEmailRecipient("agreements"),
    subject,
    text,
    html: buildEmailCardHtml(subject, [
      `Dear ${agreement?.agency_name || "Agency"},`,
      "A recruitment agency agreement has been sent to your Office Portal for review and electronic acceptance.",
      `Agreement No: ${agreement?.agreement_no || "-"}`,
      `SLA Days: ${agreement?.sla_days || "-"}`,
      "Please login to VisaFlow Office Portal to review and accept the agreement.",
    ]),
    payload: { agreement_no: agreement?.agreement_no, agency_name: agreement?.agency_name },
  });
}

async function sendAgreementAcceptedEmail(agreement, signer = "Agency User") {
  const subject = `Agency Agreement Accepted - ${agreement?.agreement_no || "Agreement"}`;
  const text = `${agreement?.agency_name || "Agency"} accepted agreement ${agreement?.agreement_no || "-"} electronically. Accepted by: ${signer}.`;
  return dispatchVisaFlowEmail({
    type: "AGENCY_AGREEMENT_ACCEPTED",
    to: getCompanyEmailRecipient("agreements"),
    subject,
    text,
    html: buildEmailCardHtml(subject, [
      `${agreement?.agency_name || "Agency"} accepted the agreement electronically.`,
      `Agreement No: ${agreement?.agreement_no || "-"}`,
      `Accepted by: ${signer}`,
    ]),
    payload: { agreement_no: agreement?.agreement_no, agency_name: agreement?.agency_name, signer },
  });
}

async function sendPenaltyNoticeEmail(penalty) {
  const toEmail = getAgencyEmailByName(penalty?.agency_name);
  if (!toEmail) return { ok: false, skipped: true, reason: "Agency email is missing" };
  const amount = Number(penalty?.approved_amount ?? penalty?.calculated_amount ?? 0).toLocaleString();
  const subject = `VisaFlow Penalty Notice - ${penalty?.penalty_no || "Penalty"}`;
  const text = `Dear ${penalty?.agency_name || "Agency"},

A labor SLA delay penalty has been issued for your review and justification.

Penalty No: ${penalty?.penalty_no || "-"}
Candidate: ${penalty?.candidate_name || "-"}
Request No: ${penalty?.request_no || "-"}
Amount: ${amount} SAR

Please login to Office Portal and submit justification if applicable.`;
  return dispatchVisaFlowEmail({
    type: "AGENCY_PENALTY_SENT",
    to: toEmail,
    replyTo: getCompanyEmailRecipient("notifications"),
    subject,
    text,
    html: buildEmailCardHtml(subject, [
      `Dear ${penalty?.agency_name || "Agency"},`,
      "A labor SLA delay penalty has been issued for your review and justification.",
      `Penalty No: ${penalty?.penalty_no || "-"}`,
      `Candidate: ${penalty?.candidate_name || "-"}`,
      `Request No: ${penalty?.request_no || "-"}`,
      `Amount: ${amount} SAR`,
      "Please login to Office Portal and submit justification if applicable.",
    ]),
    payload: { penalty_no: penalty?.penalty_no, agency_name: penalty?.agency_name, amount },
  });
}

async function sendPenaltyJustificationEmail(penalty, justification) {
  const subject = `Penalty Justification Submitted - ${penalty?.penalty_no || "Penalty"}`;
  const text = `${penalty?.agency_name || "Agency"} submitted justification for penalty ${penalty?.penalty_no || "-"}.

Justification:
${justification}`;
  return dispatchVisaFlowEmail({
    type: "AGENCY_PENALTY_JUSTIFICATION_SUBMITTED",
    to: getCompanyEmailRecipient("notifications"),
    subject,
    text,
    html: buildEmailCardHtml(subject, [
      `${penalty?.agency_name || "Agency"} submitted a justification for review.`,
      `Penalty No: ${penalty?.penalty_no || "-"}`,
      `Candidate: ${penalty?.candidate_name || "-"}`,
      `Justification: ${justification}`,
    ]),
    payload: { penalty_no: penalty?.penalty_no, agency_name: penalty?.agency_name },
  });
}

async function sendPenaltyDecisionEmail(penalty, decision, amount, note = "") {
  const toEmail = getAgencyEmailByName(penalty?.agency_name);
  if (!toEmail) return { ok: false, skipped: true, reason: "Agency email is missing" };
  const subject = `Penalty Decision - ${penalty?.penalty_no || "Penalty"} - ${decision}`;
  const text = `Dear ${penalty?.agency_name || "Agency"},

The company has issued a final decision for penalty ${penalty?.penalty_no || "-"}.

Decision: ${decision}
Final Amount: ${Number(amount || 0).toLocaleString()} SAR
Notes: ${note || "-"}`;
  return dispatchVisaFlowEmail({
    type: "AGENCY_PENALTY_DECISION",
    to: toEmail,
    replyTo: getCompanyEmailRecipient("notifications"),
    subject,
    text,
    html: buildEmailCardHtml(subject, [
      `Dear ${penalty?.agency_name || "Agency"},`,
      `The company has issued a final decision for penalty ${penalty?.penalty_no || "-"}.`,
      `Decision: ${decision}`,
      `Final Amount: ${Number(amount || 0).toLocaleString()} SAR`,
      `Notes: ${note || "-"}`,
    ]),
    payload: { penalty_no: penalty?.penalty_no, decision, amount },
  });
}

async function saveAgreement(statusOverride = "") {
  if (!canManageAgencyAgreements) return alert("You do not have permission to manage agency agreements.");
  if (!agreementForm.agency_name) return alert("Agency name is required.");

  const nextStatus = statusOverride || agreementForm.status || "Draft";
  const now = new Date().toISOString();
  const terms = agreementForm.terms || buildAgreementTermsFromPolicy(agreementForm);

  const payload = {
    ...agreementForm,
    agreement_no: agreementForm.agreement_no || generateAgreementNo(),
    status: nextStatus,
    sla_days: Number(agreementForm.sla_days || 60),
    response_sla_hours: Number(agreementForm.response_sla_hours || 24),
    update_frequency_days: Number(agreementForm.update_frequency_days || 7),
    delay_penalty_amount: Number(agreementForm.delay_penalty_amount || 0),
    delay_penalty_after_days: Number(agreementForm.delay_penalty_after_days || 7),
    financial_guarantee_amount: agreementForm.financial_guarantee_amount === "" ? null : Number(agreementForm.financial_guarantee_amount || 0),
    replacement_guarantee_days: Number(agreementForm.replacement_guarantee_days || 90),
    company_signature: agreementForm.company_signature || (nextStatus === "Pending Signature" ? `Sent electronically by ${currentUser?.name || "Company User"}` : ""),
    signed_by_company: agreementForm.signed_by_company || currentUser?.name || "",
    sent_to_agency_at: nextStatus === "Pending Signature" ? now : agreementForm.sent_to_agency_at || null,
    effective_date: agreementForm.effective_date || null,
    expiry_date: agreementForm.expiry_date || null,
    terms,
    updated_at: now,
  };

  const result = agreementEditingId
    ? await supabase
        .from("agency_agreements")
        .update(payload)
        .eq("id", agreementEditingId)
        .eq("company_id", currentCompanyId)
    : await supabase.from("agency_agreements").insert([withCompany(payload)]);

  if (result.error) return alert(result.error.message);

  if (nextStatus === "Pending Signature") {
    await triggerExternalNotification("AGENCY_AGREEMENT_SENT", {
      company_id: currentCompanyId,
      title: "Agency Agreement Sent",
      message: `${payload.agreement_no} sent to ${payload.agency_name} for electronic acceptance.`,
      priority: "Medium",
      related_table: "agency_agreements",
      related_id: String(agreementEditingId || ""),
      agency_name: payload.agency_name,
    });

    try {
      await sendAgreementSentEmail(payload);
    } catch (emailError) {
      console.warn("Agreement email failed", emailError?.message || emailError);
    }
  }

  alert(nextStatus === "Pending Signature" ? "Agreement sent to agency portal" : agreementEditingId ? "Agreement updated successfully" : "Agreement saved successfully");
  resetAgreementForm();
  await loadAgencyAgreements();
}

async function sendExistingAgreementToAgency(item) {
  if (!canManageAgencyAgreements) return alert("You do not have permission to send agency agreements.");
  if (!item?.id) return;

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("agency_agreements")
    .update({
      status: "Pending Signature",
      company_signature: item.company_signature || `Sent electronically by ${currentUser?.name || "Company User"}`,
      signed_by_company: item.signed_by_company || currentUser?.name || "",
      sent_to_agency_at: now,
      terms: item.terms || buildAgreementTermsFromPolicy(item),
      updated_at: now,
    })
    .eq("id", item.id)
    .eq("company_id", currentCompanyId);

  if (error) return alert(error.message);
  try {
    await sendAgreementSentEmail({
      ...item,
      status: "Pending Signature",
      sent_to_agency_at: now,
      terms: item.terms || buildAgreementTermsFromPolicy(item),
    });
  } catch (emailError) {
    console.warn("Agreement email failed", emailError?.message || emailError);
  }
  await loadAgencyAgreements();
  alert("Agreement sent to agency portal");
}

async function acceptAgreementByAgency(item) {
  if (currentRole !== "Agency") return alert("Only agency users can accept agreements from Office Portal.");
  if (!window.confirm("Accept this agreement electronically?")) return;

  const now = new Date().toISOString();
  const agencySigner = currentUser?.name || currentUser?.email || "Agency User";

  const { error } = await supabase
    .from("agency_agreements")
    .update({
      status: "Active",
      signed_by_agency: item.signed_by_agency || agencySigner,
      agency_signature: `Accepted electronically by ${agencySigner} (${currentUser?.email || ""})`,
      agency_accepted_by: agencySigner,
      agency_accepted_email: currentUser?.email || "",
      agency_accepted_at: now,
      updated_at: now,
    })
    .eq("id", item.id)
    .eq("company_id", currentCompanyId);

  if (error) return alert(error.message);

  await triggerExternalNotification("AGENCY_AGREEMENT_ACCEPTED", {
    company_id: currentCompanyId,
    title: "Agency Agreement Accepted",
    message: `${item.agreement_no || "Agreement"} accepted electronically by ${agencySigner}.`,
    priority: "Medium",
    related_table: "agency_agreements",
    related_id: String(item.id || ""),
    agency_name: item.agency_name,
  });

  try {
    await sendAgreementAcceptedEmail(item, agencySigner);
  } catch (emailError) {
    console.warn("Agreement acceptance email failed", emailError?.message || emailError);
  }

  await loadAgencyAgreements();
  alert("Agreement accepted and activated successfully");
}

async function deleteAgreement(id) {
  if (!canManageAgencyAgreements) return alert("You do not have permission to delete agreements.");
  if (!window.confirm("Delete this agreement?")) return;

  const { error } = await supabase
    .from("agency_agreements")
    .delete()
    .eq("id", id)
    .eq("company_id", currentCompanyId);

  if (error) return alert(error.message);
  await loadAgencyAgreements();
}

  function resetCandidateForm() {
    setCandidateForm(emptyCandidate);
    setCandidateTechnicalForm(emptyCandidateTechnicalProfile);
    setCandidateEditingId(null);
  }

  function getOfficeVisibleCandidates() {
    return candidates.filter((item) => item.status !== "Rejected" && item.status !== "Interview Failed");
  }

  function toggleOfficeCandidateSelection(candidateId) {
    const id = String(candidateId || "");
    if (!id) return;
    setOfficeSelectedCandidateIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  function toggleAllOfficeCandidates() {
    const visibleIds = getOfficeVisibleCandidates().map((item) => String(item.id));
    if (visibleIds.length === 0) return;
    const allSelected = visibleIds.every((id) => officeSelectedCandidateIds.includes(id));
    setOfficeSelectedCandidateIds(allSelected ? [] : visibleIds);
  }

  function resetOfficeBulkForm() {
    setOfficeBulkForm(emptyOfficeBulkUpdate);
  }

  async function bulkUpdateOfficeCandidates() {
    if (!canManageOfficePortal) return alert("You do not have permission to update office candidates.");

    const selectedIds = officeSelectedCandidateIds.map((id) => String(id));
    const selectedCandidates = candidates.filter((item) => selectedIds.includes(String(item.id)));
    if (selectedCandidates.length === 0) return alert("Please select at least one candidate.");

    const hasChanges = [
      officeBulkForm.status,
      officeBulkForm.medical_status,
      officeBulkForm.medical_date,
      officeBulkForm.ticket_no,
      officeBulkForm.flight_date,
      officeBulkForm.arrival_date,
      officeBulkForm.notes,
    ].some((value) => String(value || "").trim());

    if (!hasChanges) return alert("Please enter at least one bulk update field.");

    if (!window.confirm(`Apply this update to ${selectedCandidates.length} selected candidates?`)) return;

    setOfficeBulkLoading(true);
    const now = new Date().toISOString();
    const bulkNote = String(officeBulkForm.notes || "").trim();
    const noteStamp = new Date().toLocaleDateString("en-GB");

    try {
      for (const item of selectedCandidates) {
        let history = [];
        try {
          history = item.status_history ? JSON.parse(item.status_history) : [];
        } catch {
          history = [];
        }

        const nextTicketNo = officeBulkForm.ticket_no || item.ticket_no || "";
        const nextFlightDate = officeBulkForm.flight_date || item.flight_date || null;
        const nextArrivalDate = officeBulkForm.arrival_date || item.arrival_date || null;

        let nextMedicalStatus = officeBulkForm.medical_status || item.medical_status || "Pending";
        let nextStatus = officeBulkForm.status || item.status || "New";

        if (!officeBulkForm.status) {
          if (nextArrivalDate) {
            nextStatus = "Arrived KSA";
          } else if (nextFlightDate) {
            nextStatus = "Departure";
          } else if (nextTicketNo) {
            nextStatus = "Ticket Booked";
          } else if (nextMedicalStatus === "Passed") {
            nextStatus = "Medical Passed";
          } else if (nextMedicalStatus === "Failed") {
            nextStatus = "Medical Failed";
          }
        }

        if (nextStatus === "Medical Passed") nextMedicalStatus = "Passed";
        if (nextStatus === "Medical Failed") nextMedicalStatus = "Failed";

        if (String(item.status || "") !== String(nextStatus || "")) {
          history.push({
            stage: nextStatus || "New",
            date: now,
            bulk_update: true,
          });
        }

        const currentNotes = String(item.notes || "").trim();
        const nextNotes = bulkNote
          ? [currentNotes, `[${noteStamp}] ${bulkNote}`].filter(Boolean).join("\n")
          : currentNotes;

        const payload = {
          status: nextStatus,
          medical_status: nextMedicalStatus,
          medical_date: officeBulkForm.medical_date || item.medical_date || null,
          ticket_no: nextTicketNo,
          flight_date: nextFlightDate,
          arrival_date: nextArrivalDate,
          notes: nextNotes,
          status_history: JSON.stringify(history),
          updated_at: now,
        };

        const { error } = await supabase
          .from("candidates")
          .update(payload)
          .eq("id", item.id)
          .eq("company_id", currentCompanyId);

        if (error) throw error;
      }

      await supabase.from("notification_events").insert([withCompany({
        user_id: null,
        agency_id: currentRole === "Agency" ? currentUser?.agency_id || null : null,
        type: "OFFICE_BULK_CANDIDATE_UPDATE",
        title: "Office Bulk Candidate Update",
        message: `${selectedCandidates.length} candidates updated in Office Portal`,
        priority: "Medium",
        status: "Unread",
        related_table: "candidates",
        related_id: selectedIds.join(","),
        data: {
          selected_count: selectedCandidates.length,
          status: officeBulkForm.status || "",
          medical_status: officeBulkForm.medical_status || "",
        },
      })]);

      const touchedRequestNos = [...new Set(selectedCandidates.map((item) => item.request_no).filter(Boolean))];
      for (const requestNo of touchedRequestNos) {
        const requestRow = requests.find((request) => String(request.request_no || "") === String(requestNo || ""));
        const isSaudiFlow = isSaudiRequest(requestRow);
        const completedStatuses = isSaudiFlow ? ["Joined"] : ["Arrived KSA", "Joined"];
        const { count } = await supabase
          .from("candidates")
          .select("*", { count: "exact", head: true })
          .eq("request_no", requestNo)
          .eq("company_id", currentCompanyId)
          .in("status", completedStatuses);

        const requiredQty = Number(requestRow?.quantity || 0);
        if (requiredQty > 0) {
          await supabase
            .from("requests")
            .update({
              status: Number(count || 0) >= requiredQty ? "Completed" : "Under Recruitment",
              updated_at: now,
            })
            .eq("request_no", requestNo)
            .eq("company_id", currentCompanyId);
        }
      }

      setOfficeSelectedCandidateIds([]);
      resetOfficeBulkForm();
      await loadAll();
      alert(`Bulk update completed for ${selectedCandidates.length} candidates.`);
    } catch (error) {
      alert(error.message || "Bulk update failed.");
    } finally {
      setOfficeBulkLoading(false);
    }
  }

  function editCandidate(item) {
    setCandidateEditingId(item.id);
    setCandidateForm({
      candidate_name: item.candidate_name || "",
      request_line_id: item.request_line_id || "",
      profession: item.profession || "",
      nationality: item.nationality || "",
      gender: item.gender || "",
      agency: item.agency || "",
      project: item.project || "",
      request_no: item.request_no || "",
      passport_no: item.passport_no || "",
      mobile: item.mobile || "",
      email: item.email || "",
      medical_status: item.medical_status || "Pending",
medical_date: item.medical_date || "",
ticket_no: item.ticket_no || "",
flight_date: item.flight_date || "",
arrival_date: item.arrival_date || "",
      visa_fees: item.visa_fees || "",
      agency_commission: item.agency_commission || "",
      ticket_cost: item.ticket_cost || "",
      medical_ksa_cost: item.medical_ksa_cost || "",
      contract_status: item.contract_status || "Pending",
      contract_url: item.contract_url || "",
      source: item.source || "",
      offer_status: item.offer_status || "Pending",
      joining_date: item.joining_date || "",
      status: item.status || "New",
      notes: item.notes || "",
    });

    const technicalProfile = getCandidateTechnicalProfile(item.id);
    setCandidateTechnicalForm({
      ...emptyCandidateTechnicalProfile,
      ...(technicalProfile || {}),
      graduation_year: technicalProfile?.graduation_year || "",
      years_experience: technicalProfile?.years_experience || "",
      institution_id: technicalProfile?.institution_id || "",
      gulf_experience: Boolean(technicalProfile?.gulf_experience),
      saudi_experience: Boolean(technicalProfile?.saudi_experience),
      final_company_decision: technicalProfile?.final_company_decision || item.final_company_decision || "Pending Company Review",
      decision_notes: technicalProfile?.decision_notes || "",
    });
   if (activePage !== "Office Portal") {
    setActivePage("Candidates");
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}
  async function saveCandidate() {
    if (!canManageCandidates && !canManageOfficePortal) return alert("You do not have permission to manage candidates.");
    const { data: requestData } = await supabase
  .from("requests")
  .select("approval_status, quantity, remaining_qty, recruitment_type, nationality")
  .eq("request_no", candidateForm.request_no)
  .eq("company_id", currentCompanyId)
  .single();

if (
  requestData &&
  requestData.approval_status !== "Approved by Recruitment" &&
  requestData.approval_status !== "Approved"
) {
  return alert("Candidates cannot be added until the request is approved.");
}

    let matchedCandidateLine = null;
    if (candidateForm.request_no) {
      const relatedRequest = requests.find((request) => String(request.request_no || "") === String(candidateForm.request_no || ""));
      const candidateRequestLines = relatedRequest ? getRequestLinesForRequest(relatedRequest) : [];

      if (candidateRequestLines.length === 1) {
        matchedCandidateLine = candidateRequestLines[0];
      } else if (candidateRequestLines.length > 1) {
        matchedCandidateLine = candidateRequestLines.find((line) => {
          if (candidateForm.request_line_id && String(candidateForm.request_line_id) === String(line.id)) return true;
          return (
            isCompatibleText(candidateForm.profession, line.profession) &&
            normalize(candidateForm.nationality) === normalize(line.nationality) &&
            (!candidateForm.gender || !line.gender || normalize(candidateForm.gender) === normalize(line.gender))
          );
        });

        if (!matchedCandidateLine) {
          return alert("Please select or enter a candidate profession, nationality, and gender matching one request line exactly.");
        }
      }
    }

    if (!candidateForm.candidate_name) return alert("Candidate name is required.");
    const oldCandidate = candidateEditingId
  ? candidates.find((c) => String(c.id) === String(candidateEditingId))
  : null;

let statusHistory = [];

try {
  statusHistory = oldCandidate?.status_history
    ? JSON.parse(oldCandidate.status_history)
    : [];
} catch {
  statusHistory = [];
}

if (!oldCandidate || oldCandidate.status !== candidateForm.status) {
  statusHistory.push({
    stage: candidateForm.status || "New",
    date: new Date().toISOString(),
  });
}
let autoStatus = candidateForm.status;
const selectedCandidateRequest = requests.find((r) => String(r.request_no || "") === String(candidateForm.request_no || ""));
const saudiCandidateFlow = isSaudiRequest(selectedCandidateRequest) || isSaudiNationality(candidateForm.nationality);

if (saudiCandidateFlow && candidateForm.joining_date) {
  autoStatus = "Joined";
} else if (candidateForm.arrival_date) {
  autoStatus = "Arrived KSA";
} else if (candidateForm.flight_date) {
  autoStatus = "Departure";
} else if (candidateForm.ticket_no) {
  autoStatus = "Ticket Booked";
} else if (candidateForm.medical_status === "Passed") {
  autoStatus = "Medical Passed";
}
const shouldGenerateContract = ["Selected", "Interview Passed"].includes(autoStatus);

const effectiveCandidateProfession = matchedCandidateLine?.profession || candidateForm.profession || "";
const professionIntelligence = getCandidateProfessionIntelligence(effectiveCandidateProfession);
const candidateScoreResult = buildCandidateTechnicalScores(candidateTechnicalForm, professionIntelligence);

const payload = {
  ...candidateForm,
  request_line_id: matchedCandidateLine?.id || candidateForm.request_line_id || null,
  profession: matchedCandidateLine?.profession || candidateForm.profession || "",
  nationality: matchedCandidateLine?.nationality || candidateForm.nationality || "",
  gender: matchedCandidateLine?.gender || candidateForm.gender || "",
  agency: currentRole === "Agency" ? (currentUser?.agency_name || candidateForm.agency || "") : candidateForm.agency,
  notes: candidateForm.notes || "",
  status: autoStatus,
  email: candidateForm.email || "",
medical_status: saudiCandidateFlow
  ? (candidateForm.medical_status || "Pending")
  : (candidateForm.arrival_date || candidateForm.flight_date || candidateForm.ticket_no
    ? "Passed"
    : candidateForm.medical_status || "Pending"),
medical_date: candidateForm.medical_date || null,
ticket_no: saudiCandidateFlow ? "" : candidateForm.ticket_no || "",
flight_date: saudiCandidateFlow ? null : candidateForm.flight_date || null,
arrival_date: saudiCandidateFlow ? null : candidateForm.arrival_date || null,
  visa_fees: saudiCandidateFlow ? 0 : Number(candidateForm.visa_fees || 0),
  agency_commission: saudiCandidateFlow ? 0 : Number(candidateForm.agency_commission || 0),
  ticket_cost: saudiCandidateFlow ? 0 : Number(candidateForm.ticket_cost || 0),
  medical_ksa_cost: Number(candidateForm.medical_ksa_cost || 0),
  source: candidateForm.source || "",
  offer_status: candidateForm.offer_status || "Pending",
  joining_date: candidateForm.joining_date || null,
  contract_status: shouldGenerateContract ? (candidateForm.contract_status || "Sent") : (candidateForm.contract_status || "Pending"),
  contract_url: shouldGenerateContract ? (candidateForm.contract_url || generateContractUrl(candidateForm)) : (candidateForm.contract_url || ""),
  status_history: JSON.stringify(statusHistory),
  technical_profile_required: professionIntelligence.enabled,
  technical_profile_completed: professionIntelligence.enabled ? candidateScoreResult.profile_completed : false,
  ai_score: professionIntelligence.enabled ? candidateScoreResult.final_ai_score : 0,
  ai_priority: professionIntelligence.enabled ? candidateScoreResult.interview_priority : "Pending Review",
  ai_recommendation: professionIntelligence.enabled ? candidateScoreResult.ai_recommendation : "",
  ai_reasoning: professionIntelligence.enabled ? candidateScoreResult.ai_reasoning : "",
  final_company_decision: professionIntelligence.enabled
    ? (candidateTechnicalForm.final_company_decision || "Pending Company Review")
    : "Pending Company Review",
  updated_at: new Date().toISOString(),
};
    const result = candidateEditingId
      ? await supabase
          .from("candidates")
          .update(payload)
          .eq("id", candidateEditingId)
          .eq("company_id", currentCompanyId)
          .select("id")
          .single()
      : await supabase
          .from("candidates")
          .insert([withCompany(payload)])
          .select("id")
          .single();

    if (result.error) return alert(result.error.message);

    const savedCandidateId = candidateEditingId || result.data?.id;

    if (savedCandidateId) {
      if (professionIntelligence.enabled) {
        const selectedInstitution = getInstitutionById(candidateTechnicalForm.institution_id);
        const requestLineId = matchedCandidateLine?.id && Number.isFinite(Number(matchedCandidateLine.id))
          ? Number(matchedCandidateLine.id)
          : null;

        const technicalPayload = withCompany({
          candidate_id: savedCandidateId,
          request_no: candidateForm.request_no || "",
          request_line_id: requestLineId,
          qualification: candidateTechnicalForm.qualification || "",
          major: candidateTechnicalForm.major || "",
          specialization: candidateTechnicalForm.specialization || "",
          institution_id: candidateTechnicalForm.institution_id || null,
          institution_name: selectedInstitution?.institution_name || candidateTechnicalForm.institution_name || "",
          institution_country: selectedInstitution?.country || candidateTechnicalForm.institution_country || "",
          institution_type: selectedInstitution?.institution_type || candidateTechnicalForm.institution_type || "",
          graduation_year: candidateTechnicalForm.graduation_year ? Number(candidateTechnicalForm.graduation_year) : null,
          years_experience: Number(candidateTechnicalForm.years_experience || 0),
          last_job_title: candidateTechnicalForm.last_job_title || "",
          last_employer: candidateTechnicalForm.last_employer || "",
          last_project_type: candidateTechnicalForm.last_project_type || "",
          project_experience: candidateTechnicalForm.project_experience || "",
          technical_skills: candidateTechnicalForm.technical_skills || "",
          tools_and_equipment: candidateTechnicalForm.tools_and_equipment || "",
          software_skills: candidateTechnicalForm.software_skills || "",
          certifications: candidateTechnicalForm.certifications || "",
          licenses: candidateTechnicalForm.licenses || "",
          english_level: candidateTechnicalForm.english_level || "Not Specified",
          arabic_level: candidateTechnicalForm.arabic_level || "Not Specified",
          gulf_experience: Boolean(candidateTechnicalForm.gulf_experience),
          saudi_experience: Boolean(candidateTechnicalForm.saudi_experience),
          profile_completed: candidateScoreResult.profile_completed,
          missing_fields: candidateScoreResult.missing_fields,
          education_score: candidateScoreResult.education_score,
          experience_score: candidateScoreResult.experience_score,
          skills_score: candidateScoreResult.skills_score,
          certification_score: candidateScoreResult.certification_score,
          language_score: candidateScoreResult.language_score,
          data_completeness_score: candidateScoreResult.data_completeness_score,
          final_ai_score: candidateScoreResult.final_ai_score,
          interview_priority: candidateScoreResult.interview_priority,
          ai_recommendation: candidateScoreResult.ai_recommendation,
          ai_reasoning: candidateScoreResult.ai_reasoning,
          final_company_decision: candidateTechnicalForm.final_company_decision || "Pending Company Review",
          decision_by: candidateTechnicalForm.final_company_decision && candidateTechnicalForm.final_company_decision !== "Pending Company Review"
            ? currentUser?.name || currentUser?.email || ""
            : null,
          decision_at: candidateTechnicalForm.final_company_decision && candidateTechnicalForm.final_company_decision !== "Pending Company Review"
            ? new Date().toISOString()
            : null,
          decision_notes: candidateTechnicalForm.decision_notes || "",
          updated_at: new Date().toISOString(),
        });

        const profileResult = await supabase
          .from("candidate_technical_profiles")
          .upsert([technicalPayload], { onConflict: "candidate_id" });

        if (profileResult.error) return alert(`Candidate Intelligence: ${profileResult.error.message}`);
      } else if (candidateEditingId) {
        await supabase
          .from("candidate_technical_profiles")
          .delete()
          .eq("candidate_id", savedCandidateId)
          .eq("company_id", currentCompanyId);
      }
    }

    await supabase.from("notification_events").insert([withCompany({
      user_id: null,
      agency_id: currentRole === "Agency" ? currentUser?.agency_id || null : null,
      type: candidateEditingId ? "CANDIDATE_UPDATED" : "CANDIDATE_CREATED",
      title: candidateEditingId ? "Candidate Updated" : "New Candidate Added",
      message: `${candidateForm.candidate_name || "Candidate"} / ${candidateForm.request_no || "No Request"} / ${autoStatus}`,
      priority: "Medium",
      status: "Unread",
      related_table: "candidates",
      related_id: String(savedCandidateId || ""),
      data: {
        candidate_name: candidateForm.candidate_name,
        request_no: candidateForm.request_no,
        agency: currentRole === "Agency" ? currentUser?.agency_name : candidateForm.agency,
        status: autoStatus,
      },
    })]);

const { count: completedCandidateCount } = await supabase
  .from("candidates")
  .select("*", { count: "exact", head: true })
  .eq("request_no", candidateForm.request_no)
  .eq("status", saudiCandidateFlow ? "Joined" : "Arrived KSA")
  .eq("company_id", currentCompanyId);

const requestRemaining =
  Number(requestData?.quantity || 0) - Number(completedCandidateCount || 0);

if (requestRemaining <= 0 && !isReplacementStatus(autoStatus)) {
  await supabase
    .from("requests")
    .update({
      status: "Completed",
      updated_at: new Date().toISOString(),
    })
    .eq("request_no", candidateForm.request_no)
    .eq("company_id", currentCompanyId);
} else {
  await supabase
    .from("requests")
    .update({
      status: "Under Recruitment",
      updated_at: new Date().toISOString(),
    })
    .eq("request_no", candidateForm.request_no)
    .eq("company_id", currentCompanyId);
}


   

  await loadRequests();

    alert(candidateEditingId ? "Candidate updated successfully" : "Candidate saved successfully");
    resetCandidateForm();
    loadCandidates();
    loadCandidateTechnicalProfiles();
  }

  async function deleteCandidate(id) {
    if (!canManageCandidates) return alert("You do not have permission to delete candidates.");
    if (!window.confirm("Delete this candidate?")) return;
    const { error } = await supabase.from("candidates").delete().eq("id", id);
    if (error) return alert(error.message);
    loadCandidates();
    loadCandidateTechnicalProfiles();
    loadRequests();
  }

  function getCandidateTemplateSampleRows() {
    return [
      CANDIDATE_UPLOAD_HEADERS.reduce((acc, header) => ({ ...acc, [header]: "" }), {}),
    ];
  }

  function getCandidateTemplateInstructions() {
    return [
      {
        "Field": "Request No",
        "Required": currentRole === "Agency" ? "No" : "Yes",
        "Notes": currentRole === "Agency"
          ? "Office Portal upload can work without Request No. Candidates will be saved in Agency Talent Pool if no assigned request is selected."
          : "Use the exact request number assigned by the company, for example REQ-2026-0001.",
      },
      {
        "Field": "Candidate Name",
        "Required": "Yes",
        "Notes": "Enter the candidate full name as shown in passport or official document.",
      },
      {
        "Field": "Profession / Nationality / Gender",
        "Required": "Yes",
        "Notes": "Must match the company request line. This prevents uploading candidates to the wrong requirement.",
      },
      {
        "Field": "Passport No",
        "Required": "Recommended",
        "Notes": "Used to prevent duplicate candidates.",
      },
      {
        "Field": "Candidate Intelligence Fields",
        "Required": "For technical/professional roles only",
        "Notes": "Fill qualification, institution, experience, skills and certificates. AI score is calculated by the company side only and is not shown to the agency.",
      },
      {
        "Field": "AI Score / Recommendation",
        "Required": "No",
        "Notes": "Do not add AI score or final decision in this template. These are company-only outputs inside VisaFlow.",
      },
    ];
  }

  function downloadCandidateUploadTemplate() {
    const workbook = XLSX.utils.book_new();

    const instructionsSheet = XLSX.utils.json_to_sheet(getCandidateTemplateInstructions());
    instructionsSheet["!cols"] = [
      { wch: 30 },
      { wch: 18 },
      { wch: 95 },
    ];
    XLSX.utils.book_append_sheet(workbook, instructionsSheet, "Instructions");

    const uploadSheet = XLSX.utils.json_to_sheet(getCandidateTemplateSampleRows(), { header: CANDIDATE_UPLOAD_HEADERS });
    uploadSheet["!cols"] = CANDIDATE_UPLOAD_HEADERS.map((header) => ({
      wch: Math.max(16, Math.min(32, header.length + 6)),
    }));
    XLSX.utils.book_append_sheet(workbook, uploadSheet, "Candidates Upload");

    const dropdownRows = [];
    const maxRows = Math.max(
      REQUEST_STATUSES.length,
      CANDIDATE_STATUSES.length,
      MEDICAL_STATUSES.length,
      GENDERS.length,
      LANGUAGE_LEVEL_OPTIONS.length,
      countries.length,
      professions.length,
      agencies.length,
      requests.length,
      1
    );

    for (let index = 0; index < maxRows; index += 1) {
      dropdownRows.push({
        "Approved Request No": requests.filter((request) => ["Approved by Recruitment", "Approved"].includes(request.approval_status)).map((request) => request.request_no).filter(Boolean)[index] || "",
        "Profession": professions.map((profession) => getProfessionLabel(profession)).filter(Boolean)[index] || "",
        "Nationality": countries.map((country) => country.nationality || country.name).filter(Boolean)[index] || "",
        "Gender": GENDERS[index] || "",
        "Candidate Status": CANDIDATE_STATUSES[index] || "",
        "Medical Status": ["Pending", "Passed", "Failed", "Fit", "Unfit", "Re-Medical"][index] || "",
        "English / Arabic Level": LANGUAGE_LEVEL_OPTIONS[index] || "",
        "Yes / No": ["Yes", "No"][index] || "",
        "Agency": agencies.map((agency) => agency.name).filter(Boolean)[index] || "",
      });
    }

    const listsSheet = XLSX.utils.json_to_sheet(dropdownRows);
    listsSheet["!cols"] = [
      { wch: 24 },
      { wch: 34 },
      { wch: 26 },
      { wch: 12 },
      { wch: 24 },
      { wch: 20 },
      { wch: 22 },
      { wch: 12 },
      { wch: 28 },
    ];
    XLSX.utils.book_append_sheet(workbook, listsSheet, "Dropdown Lists");

    XLSX.writeFile(workbook, "VisaFlow_Candidate_Upload_Template.xlsx");
  }

  function findInstitutionByNameAndCountry(institutionName, institutionCountry = "") {
    const name = normalizeMatchText(institutionName);
    const country = normalizeMatchText(institutionCountry);
    if (!name) return null;

    return educationInstitutions.find((institution) => {
      const institutionNameMatch = normalizeMatchText(institution.institution_name);
      const institutionCountryMatch = normalizeMatchText(institution.country);
      const nameMatches = institutionNameMatch === name || institutionNameMatch.includes(name) || name.includes(institutionNameMatch);
      const countryMatches = !country || !institutionCountryMatch || institutionCountryMatch === country || institutionCountryMatch.includes(country) || country.includes(institutionCountryMatch);
      return nameMatches && countryMatches;
    }) || null;
  }

  function parseExcelBooleanValue(value) {
    const text = normalizeMatchText(value);
    return ["yes", "y", "true", "1", "نعم", "اي", "ايوه"].includes(text);
  }

  function buildCandidateTechnicalFormFromExcel(row) {
    const institutionName = getRowValue(row, ["Institution Name", "University", "College", "Institute", "اسم الجامعة", "اسم المعهد", "الجامعة", "المعهد"]);
    const institutionCountry = getRowValue(row, ["Institution Country", "Education Country", "Country of Institution", "دولة الجامعة", "دولة المعهد"]);
    const institution = findInstitutionByNameAndCountry(institutionName, institutionCountry);

    return {
      ...emptyCandidateTechnicalProfile,
      qualification: getRowValue(row, ["Qualification", "Degree", "Education", "المؤهل"]),
      major: getRowValue(row, ["Major", "Specialization", "تخصص", "التخصص"]),
      specialization: getRowValue(row, ["Specialization", "Specialization Details", "تفاصيل التخصص"]),
      institution_id: institution?.id || "",
      institution_name: institution?.institution_name || institutionName,
      institution_country: institution?.country || institutionCountry,
      institution_type: institution?.institution_type || getRowValue(row, ["Institution Type", "نوع المنشأة"]),
      graduation_year: getRowValue(row, ["Graduation Year", "Year", "سنة التخرج"]),
      years_experience: getRowValue(row, ["Years Experience", "Experience Years", "سنوات الخبرة"]),
      last_job_title: getRowValue(row, ["Last Job Title", "Job Title", "آخر مسمى وظيفي"]),
      last_employer: getRowValue(row, ["Last Employer", "Previous Employer", "آخر جهة عمل"]),
      last_project_type: getRowValue(row, ["Last Project Type", "Project Type", "نوع آخر مشروع"]),
      project_experience: getRowValue(row, ["Project Experience", "Major Projects", "خبرة المشاريع"]),
      technical_skills: getRowValue(row, ["Technical Skills", "Skills", "المهارات الفنية"]),
      tools_and_equipment: getRowValue(row, ["Tools & Equipment", "Equipment Experience", "الأدوات والمعدات"]),
      software_skills: getRowValue(row, ["Software Skills", "Software Tools", "البرامج"]),
      certifications: getRowValue(row, ["Certifications", "Certificates", "الشهادات"]),
      licenses: getRowValue(row, ["Licenses", "License Name", "الرخص"]),
      english_level: getRowValue(row, ["English Level", "مستوى الإنجليزية"]) || "Not Specified",
      arabic_level: getRowValue(row, ["Arabic Level", "مستوى العربية"]) || "Not Specified",
      gulf_experience: parseExcelBooleanValue(getRowValue(row, ["Gulf Experience", "GCC Experience", "خبرة خليجية"])),
      saudi_experience: parseExcelBooleanValue(getRowValue(row, ["Saudi Experience", "KSA Experience", "خبرة سعودية"])),
      final_company_decision: "Pending Company Review",
      decision_notes: "",
    };
  }

  function hasCandidateTechnicalExcelData(profileForm) {
    return [
      profileForm.qualification,
      profileForm.major,
      profileForm.specialization,
      profileForm.institution_name,
      profileForm.institution_country,
      profileForm.graduation_year,
      profileForm.years_experience,
      profileForm.last_job_title,
      profileForm.last_employer,
      profileForm.last_project_type,
      profileForm.project_experience,
      profileForm.technical_skills,
      profileForm.tools_and_equipment,
      profileForm.software_skills,
      profileForm.certifications,
      profileForm.licenses,
    ].some((value) => String(value || "").trim()) || Boolean(profileForm.gulf_experience) || Boolean(profileForm.saudi_experience);
  }

  function buildCandidateTechnicalProfilePayload(candidate, technicalMeta) {
    if (!candidate?.id || !technicalMeta?.intelligence?.enabled) return null;

    const profileForm = technicalMeta.profileForm || emptyCandidateTechnicalProfile;
    const scores = technicalMeta.scores || buildCandidateTechnicalScores(profileForm, technicalMeta.intelligence);
    const selectedInstitution = getInstitutionById(profileForm.institution_id);

    return withCompany({
      candidate_id: candidate.id,
      profession: candidate.profession || technicalMeta.profession || "",
      profile_level: technicalMeta.intelligence.level || "Technical",
      profile_type: technicalMeta.intelligence.profile || "Technical Profile",
      qualification: profileForm.qualification || "",
      major: profileForm.major || "",
      specialization: profileForm.specialization || "",
      institution_id: profileForm.institution_id || null,
      institution_name: selectedInstitution?.institution_name || profileForm.institution_name || "",
      institution_country: selectedInstitution?.country || profileForm.institution_country || "",
      institution_type: selectedInstitution?.institution_type || profileForm.institution_type || "",
      graduation_year: profileForm.graduation_year ? Number(profileForm.graduation_year) : null,
      years_experience: Number(profileForm.years_experience || 0),
      last_job_title: profileForm.last_job_title || "",
      last_employer: profileForm.last_employer || "",
      last_project_type: profileForm.last_project_type || "",
      project_experience: profileForm.project_experience || "",
      technical_skills: profileForm.technical_skills || "",
      tools_and_equipment: profileForm.tools_and_equipment || "",
      software_skills: profileForm.software_skills || "",
      certifications: profileForm.certifications || "",
      licenses: profileForm.licenses || "",
      english_level: profileForm.english_level || "Not Specified",
      arabic_level: profileForm.arabic_level || "Not Specified",
      gulf_experience: Boolean(profileForm.gulf_experience),
      saudi_experience: Boolean(profileForm.saudi_experience),
      education_score: scores.education_score,
      experience_score: scores.experience_score,
      skills_score: scores.skills_score,
      certification_score: scores.certification_score,
      language_score: scores.language_score,
      data_completeness_score: scores.data_completeness_score,
      final_ai_score: scores.final_ai_score,
      interview_priority: scores.interview_priority,
      ai_recommendation: scores.ai_recommendation,
      ai_reasoning: scores.ai_reasoning,
      profile_completed: scores.profile_completed,
      missing_fields: scores.missing_fields.join(", "),
      final_company_decision: "Pending Company Review",
      decision_by: null,
      decision_at: null,
      decision_notes: "",
      updated_at: new Date().toISOString(),
    });
  }

  async function inferCandidateUploadRequestNo(rows = []) {
    const explicitCandidateRequestNo = String(candidateForm.request_no || "").trim();
    if (explicitCandidateRequestNo) return explicitCandidateRequestNo;

    const usefulRows = (rows || [])
      .filter((row) => getRowValue(row, ["Name", "Candidate Name", "candidate_name", "اسم المرشح"]))
      .slice(0, 30);

    if (!usefulRows.length) return "";

    const agencyName = currentRole === "Agency"
      ? (currentUser?.agency_name || candidateForm.agency || "")
      : (candidateForm.agency || currentUser?.agency_name || "");

    const requestNosFromAuthorizations = new Set();

    usefulRows.forEach((row) => {
      const rowProfession = getRowValue(row, ["Profession", "Job", "Position", "profession", "المهنة"]);
      const rowNationality = getRowValue(row, ["Nationality", "nationality", "الجنسية"]);
      const rowGender = getRowValue(row, ["Gender", "gender", "الجنس"]);

      const matches = visaAuthorizations.filter((auth) => {
        if (!auth?.request_no || auth.status === "Cancelled") return false;
        if (agencyName && auth.agency && normalize(auth.agency) !== normalize(agencyName)) return false;
        return (
          isCompatibleText(rowProfession, auth.profession) &&
          (!rowNationality || !auth.nationality || normalize(rowNationality) === normalize(auth.nationality)) &&
          (!rowGender || !auth.gender || normalize(rowGender) === normalize(auth.gender))
        );
      });

      matches.forEach((auth) => requestNosFromAuthorizations.add(String(auth.request_no || "")));
    });

    const cleanAuthRequestNos = Array.from(requestNosFromAuthorizations).filter(Boolean);
    if (cleanAuthRequestNos.length === 1) return cleanAuthRequestNos[0];

    try {
      const { data: approvedRequests, error: requestLookupError } = await supabase
        .from("requests")
        .select("id, request_no, approval_status, status, profession, nationality, gender")
        .eq("company_id", currentCompanyId)
        .in("approval_status", ["Approved by Recruitment", "Approved"])
        .range(0, 5000);

      if (requestLookupError) {
        console.warn("candidate upload request lookup failed", requestLookupError.message);
        return "";
      }

      const approvedRequestNos = new Set((approvedRequests || []).map((item) => String(item.request_no || "")).filter(Boolean));
      if (!approvedRequestNos.size) return "";

      const { data: requestLineRows, error: lineLookupError } = await supabase
        .from("request_lines")
        .select("id, request_no, profession, nationality, gender, quantity")
        .eq("company_id", currentCompanyId)
        .in("request_no", Array.from(approvedRequestNos))
        .range(0, 5000);

      if (lineLookupError) {
        console.warn("candidate upload request line lookup failed", lineLookupError.message);
        return "";
      }

      const candidateRequestNos = new Set();
      const fallbackLines = (requestLineRows && requestLineRows.length > 0)
        ? requestLineRows
        : (approvedRequests || []).map((request) => ({
            request_no: request.request_no,
            profession: request.profession,
            nationality: request.nationality,
            gender: request.gender,
          }));

      usefulRows.forEach((row) => {
        const rowProfession = getRowValue(row, ["Profession", "Job", "Position", "profession", "المهنة"]);
        const rowNationality = getRowValue(row, ["Nationality", "nationality", "الجنسية"]);
        const rowGender = getRowValue(row, ["Gender", "gender", "الجنس"]);

        const matches = fallbackLines.filter((line) =>
          approvedRequestNos.has(String(line.request_no || "")) &&
          isCompatibleText(rowProfession, line.profession) &&
          (!rowNationality || !line.nationality || normalize(rowNationality) === normalize(line.nationality)) &&
          (!rowGender || !line.gender || normalize(rowGender) === normalize(line.gender))
        );

        matches.forEach((line) => candidateRequestNos.add(String(line.request_no || "")));
      });

      const cleanRequestNos = Array.from(candidateRequestNos).filter(Boolean);
      if (cleanRequestNos.length === 1) return cleanRequestNos[0];
    } catch (error) {
      console.warn("candidate upload auto request inference failed", error?.message || error);
    }

    return "";
  }

  function startExcelUploadFromRequest(item) {
    setExcelRequestNo(item.request_no || "");
    setTimeout(() => requestExcelInputRef.current?.click(), 0);
  }

  function startExcelUploadFromCandidates() {
    setExcelRequestNo("");
    setTimeout(() => candidateExcelInputRef.current?.click(), 0);
  }

  async function handleAgencyTalentPoolExcelUpload(rows = []) {
    if (currentRole !== "Agency") {
      return alert("Please select Request No before uploading candidate Excel.");
    }

    if (!currentCompanyId) {
      return alert("Company workspace is missing. Please select the client workspace first.");
    }

    const agencyName = currentUser?.agency_name || candidateForm.agency || "";
    if (!agencyName) {
      return alert("Agency name is missing from the current user.");
    }

    const payloads = [];
    const candidateTechnicalImportMeta = [];
    const errors = [];
    const filePassports = new Set();

    for (const [index, row] of rows.entries()) {
      const rowNo = index + 2;
      const candidateName = getRowValue(row, ["Name", "Candidate Name", "candidate_name", "اسم المرشح"]);

      if (!candidateName) {
        errors.push(`Row ${rowNo}: Candidate name is missing`);
        continue;
      }

      const rowProfession = getRowValue(row, ["Profession", "Job", "Position", "profession", "المهنة"]);
      const rowNationality = getRowValue(row, ["Nationality", "nationality", "الجنسية"]) || "India";
      const rowGender = getRowValue(row, ["Gender", "gender", "الجنس"]);

      if (!rowProfession) {
        errors.push(`Row ${rowNo} / ${candidateName}: Profession is missing.`);
        continue;
      }

      const passportNo = getRowValue(row, ["Passport No", "Passport", "PassportNo", "passport_no", "رقم الجواز"]);

      if (passportNo) {
        if (filePassports.has(passportNo)) {
          errors.push(`Row ${rowNo} / ${candidateName}: Duplicate passport inside file (${passportNo}).`);
          continue;
        }

        const { data: duplicatePassport, error: duplicateError } = await supabase
          .from("candidates")
          .select("id")
          .eq("passport_no", passportNo)
          .eq("company_id", currentCompanyId)
          .limit(1);

        if (duplicateError) {
          errors.push(`${candidateName}: Passport check failed (${duplicateError.message}).`);
          continue;
        }

        if (duplicatePassport && duplicatePassport.length > 0) {
          errors.push(`${candidateName}: Passport already exists (${passportNo}).`);
          continue;
        }

        filePassports.add(passportNo);
      }

      const ticketNo = getRowValue(row, ["Ticket No", "Ticket", "ticket_no"]);
      const flightDate = parseExcelDateValue(row["Flight Date"] || row["flight_date"] || row["تاريخ الرحلة"]);
      const arrivalDate = parseExcelDateValue(row["Arrival Date"] || row["arrival_date"] || row["تاريخ الوصول"]);
      const medicalDate = parseExcelDateValue(row["Medical Date"] || row["medical_date"] || row["تاريخ الفحص"]);
      const rawMedicalStatus = getRowValue(row, ["Medical Status", "medical_status", "حالة الفحص"]);
      const contractStatus = getRowValue(row, ["Contract Status", "contract_status", "حالة العقد"]) || "Pending";
      const rawStatus = getRowValue(row, ["Status", "status", "الحالة"]) || "Candidate Submitted";

      let autoStatus = rawStatus;
      if (arrivalDate) autoStatus = "Arrived KSA";
      else if (flightDate) autoStatus = "Departure";
      else if (ticketNo) autoStatus = "Ticket Booked";
      else if (rawMedicalStatus === "Passed" || rawMedicalStatus === "Fit") autoStatus = "Medical Passed";

      const technicalFormFromExcel = buildCandidateTechnicalFormFromExcel(row);
      const professionIntelligence = getCandidateProfessionIntelligence(rowProfession);
      const hasTechnicalData = hasCandidateTechnicalExcelData(technicalFormFromExcel);
      const shouldCreateTechnicalProfile = Boolean(professionIntelligence.enabled && hasTechnicalData);
      const technicalScores = shouldCreateTechnicalProfile
        ? buildCandidateTechnicalScores(technicalFormFromExcel, professionIntelligence)
        : null;

      payloads.push(
        withCompany({
          candidate_name: candidateName,
          request_line_id: null,
          profession: rowProfession,
          nationality: rowNationality,
          gender: rowGender,
          project: getRowValue(row, ["Project", "Project Name", "project", "المشروع"]) || "Agency Talent Pool",
          request_no: "",
          agency: agencyName,
          passport_no: passportNo,
          mobile: getRowValue(row, ["Mobile", "Phone", "mobile", "الجوال"]),
          email: getRowValue(row, ["Email", "email", "البريد"]),
          notes: getRowValue(row, ["Notes", "Note", "ملاحظات"]),
          status: autoStatus,
          medical_status: rawMedicalStatus || "Pending",
          medical_date: medicalDate,
          ticket_no: ticketNo,
          flight_date: flightDate,
          arrival_date: arrivalDate,
          contract_status: contractStatus,
          technical_profile_required: Boolean(professionIntelligence.enabled),
          technical_profile_completed: technicalScores?.profile_completed || false,
          ai_score: technicalScores?.final_ai_score || 0,
          ai_priority: technicalScores?.interview_priority || (professionIntelligence.enabled ? "Pending Review" : ""),
          ai_recommendation: technicalScores?.ai_recommendation || "",
          ai_reasoning: technicalScores?.ai_reasoning || "",
          final_company_decision: professionIntelligence.enabled ? "Pending Company Review" : "",
          updated_at: new Date().toISOString(),
        })
      );

      candidateTechnicalImportMeta.push(
        shouldCreateTechnicalProfile
          ? {
              profession: rowProfession || "",
              intelligence: professionIntelligence,
              profileForm: technicalFormFromExcel,
              scores: technicalScores,
            }
          : null
      );
    }

    if (!payloads.length) {
      return alert(
        "No candidates uploaded.\n\n" +
          (errors.length ? "Reasons:\n" + errors.slice(0, 15).join("\n") : "")
      );
    }

    const { data: insertedCandidates, error: insertError } = await supabase
      .from("candidates")
      .insert(payloads)
      .select("id, candidate_name, passport_no, profession, request_no");

    if (insertError) return alert(insertError.message);

    const technicalProfilePayloads = (insertedCandidates || [])
      .map((candidate, index) => buildCandidateTechnicalProfilePayload(candidate, candidateTechnicalImportMeta[index]))
      .filter(Boolean);

    if (technicalProfilePayloads.length > 0) {
      const { error: profileImportError } = await supabase
        .from("candidate_technical_profiles")
        .insert(technicalProfilePayloads);

      if (profileImportError) {
        console.warn("candidate_technical_profiles import failed", profileImportError.message);
        alert(`Candidates uploaded, but Candidate Intelligence profiles failed: ${profileImportError.message}`);
      }
    }

    await supabase.from("notification_events").insert([withCompany({
      user_id: null,
      agency_id: currentUser?.agency_id || null,
      type: "AGENCY_TALENT_POOL_UPLOAD",
      title: "Agency Talent Pool Upload",
      message: `${payloads.length} candidate(s) uploaded by ${agencyName} without request assignment.`,
      priority: "Medium",
      status: "Unread",
      related_table: "candidates",
      related_id: "",
      data: {
        agency: agencyName,
        upload_mode: "Agency Talent Pool",
        uploaded_count: payloads.length,
        intelligence_profiles: technicalProfilePayloads.length,
      },
    })]);

    await loadCandidates();
    await loadCandidateTechnicalProfiles();
    setActivePage("Office Portal");

    alert(
      `Uploaded to Agency Talent Pool: ${payloads.length} candidate(s)\n` +
        `Candidate Intelligence profiles: ${technicalProfilePayloads.length}\n` +
        `Skipped / Errors: ${errors.length}` +
        (errors.length ? `\n\nFirst errors:\n${errors.slice(0, 10).join("\n")}` : "")
    );
  }

  async function handleExcelUpload(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { cellDates: true });
    const uploadSheetName = workbook.SheetNames.find((name) => normalize(name) === "candidates upload") || workbook.SheetNames[0];
    const sheet = workbook.Sheets[uploadSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (!rows.length) return alert("Excel file is empty.");

    const requestNoFromExcel = getRowValue(rows[0], ["Request No", "RequestNo", "request_no", "رقم الطلب"]);
    let requestNo = excelRequestNo || requestNoFromExcel || candidateForm.request_no || "";

    if (!requestNo) {
      requestNo = await inferCandidateUploadRequestNo(rows);
    }

    if (!requestNo && currentRole === "Agency") {
      return await handleAgencyTalentPoolExcelUpload(rows);
    }

    if (!requestNo) {
      return alert("Please select Request No once before uploading, or upload from an assigned request/authorization card.");
    }

    const { data: requestData, error: requestError } = await supabase
      .from("requests")
      .select("id, request_no, quantity, project_name, project, approval_status, recruitment_type, profession, nationality, gender")
      .eq("request_no", requestNo)
      .eq("company_id", currentCompanyId)
      .single();

    if (requestError || !requestData) return alert("Request not found.");

    if (
      requestData.approval_status !== "Approved by Recruitment" &&
      requestData.approval_status !== "Approved"
    ) {
      return alert("Candidates cannot be uploaded until the request is approved.");
    }

    const { data: dbRequestLines, error: lineError } = await supabase
      .from("request_lines")
      .select("id, request_id, request_no, line_no, profession, nationality, gender, quantity")
      .eq("request_no", requestNo)
      .eq("company_id", currentCompanyId)
      .order("line_no", { ascending: true });

    if (lineError) return alert(`request_lines: ${lineError.message}`);

    const requestLinesForImport =
      dbRequestLines && dbRequestLines.length > 0
        ? dbRequestLines
        : getRequestLinesForRequest(requestData);

    if (!requestLinesForImport.length) {
      return alert("No request lines found for this request. Please create request lines first.");
    }

    const { data: existingCandidates, error: existingError } = await supabase
      .from("candidates")
      .select("id, request_line_id, request_no, profession, nationality, gender, passport_no, status")
      .eq("request_no", requestNo)
      .eq("company_id", currentCompanyId)
      .range(0, 5000);

    if (existingError) return alert(existingError.message);

    const blockedStatuses = ["Rejected", "Interview Failed", "Medical Failed", "Medical Fail", "Cancelled"];
    const existingActiveCandidates = (existingCandidates || []).filter(
      (candidate) => !blockedStatuses.includes(candidate.status)
    );

    const getLineUsedQty = (line) =>
      existingActiveCandidates.filter((candidate) => {
        if (candidate.request_line_id) {
          return String(candidate.request_line_id) === String(line.id);
        }
        return candidateMatchesRequestLine(candidate, line);
      }).length;

    const importLineUsage = {};
    const payloads = [];
    const candidateTechnicalImportMeta = [];
    const errors = [];
    const filePassports = new Set();

    for (const [index, row] of rows.entries()) {
      const rowNo = index + 2;
      const candidateName = getRowValue(row, ["Name", "Candidate Name", "candidate_name", "اسم المرشح"]);

      if (!candidateName) {
        errors.push(`Row ${rowNo}: Candidate name is missing`);
        continue;
      }

      const rowRequestNo = getRowValue(row, ["Request No", "RequestNo", "request_no", "رقم الطلب"]) || requestNo;
      if (String(rowRequestNo) !== String(requestNo)) {
        errors.push(`Row ${rowNo} / ${candidateName}: Request No does not match selected request (${requestNo}).`);
        continue;
      }

      const requestLineIdFromExcel = getRowValue(row, ["Request Line ID", "request_line_id", "Line ID", "line_id"]);
      const rowProfession = getRowValue(row, ["Profession", "Job", "Position", "profession", "المهنة"]);
      const rowNationality = getRowValue(row, ["Nationality", "nationality", "الجنسية"]);
      const rowGender = getRowValue(row, ["Gender", "gender", "الجنس"]);

      let matchedLine = null;

      if (requestLineIdFromExcel) {
        matchedLine = requestLinesForImport.find(
          (line) => String(line.id || "") === String(requestLineIdFromExcel)
        );
      } else if (requestLinesForImport.length === 1 && !rowProfession && !rowNationality && !rowGender) {
        matchedLine = requestLinesForImport[0];
      } else {
        matchedLine = requestLinesForImport.find(
          (line) =>
            isCompatibleText(rowProfession, line.profession) &&
            normalize(rowNationality) === normalize(line.nationality) &&
            (!rowGender || !line.gender || normalize(rowGender) === normalize(line.gender))
        );
      }

      if (!matchedLine) {
        errors.push(
          `Row ${rowNo} / ${candidateName}: No matching request line. Use exact Profession + Nationality + Gender or Request Line ID.`
        );
        continue;
      }

      const lineKey = String(matchedLine.id || `${matchedLine.line_no}-${matchedLine.profession}`);
      const usedInDb = getLineUsedQty(matchedLine);
      const usedInFile = Number(importLineUsage[lineKey] || 0);
      const lineQty = Number(matchedLine.quantity || 0);

      if (usedInDb + usedInFile + 1 > lineQty) {
        errors.push(
          `Row ${rowNo} / ${candidateName}: Request line capacity exceeded for ${matchedLine.profession}. Required: ${lineQty}, Existing: ${usedInDb}, In this file: ${usedInFile}.`
        );
        continue;
      }

      const passportNo = getRowValue(row, ["Passport No", "Passport", "PassportNo", "passport_no", "رقم الجواز"]);

      if (passportNo) {
        if (filePassports.has(passportNo)) {
          errors.push(`Row ${rowNo} / ${candidateName}: Duplicate passport inside file (${passportNo}).`);
          continue;
        }

        const existingPassport = (existingCandidates || []).find(
          (candidate) => normalize(candidate.passport_no) === normalize(passportNo)
        );

        if (existingPassport) {
          errors.push(`${candidateName}: Passport already exists (${passportNo}).`);
          continue;
        }

        const { data: duplicatePassport, error: duplicateError } = await supabase
          .from("candidates")
          .select("id")
          .eq("passport_no", passportNo)
          .eq("company_id", currentCompanyId)
          .limit(1);

        if (duplicateError) {
          errors.push(`${candidateName}: Passport check failed (${duplicateError.message}).`);
          continue;
        }

        if (duplicatePassport && duplicatePassport.length > 0) {
          errors.push(`${candidateName}: Passport already exists (${passportNo}).`);
          continue;
        }

        filePassports.add(passportNo);
      }

      const ticketNo = getRowValue(row, ["Ticket No", "Ticket", "ticket_no"]);
      const flightDate = parseExcelDateValue(row["Flight Date"] || row["flight_date"] || row["تاريخ الرحلة"]);
      const arrivalDate = parseExcelDateValue(row["Arrival Date"] || row["arrival_date"] || row["تاريخ الوصول"]);
      const medicalDate = parseExcelDateValue(row["Medical Date"] || row["medical_date"] || row["تاريخ الفحص"]);
      const rawMedicalStatus = getRowValue(row, ["Medical Status", "medical_status", "حالة الفحص"]);
      const contractStatus = getRowValue(row, ["Contract Status", "contract_status", "حالة العقد"]) || "Pending";
      const rawStatus = getRowValue(row, ["Status", "status", "الحالة"]) || "New";

      let autoStatus = rawStatus;
      if (arrivalDate) autoStatus = "Arrived KSA";
      else if (flightDate) autoStatus = "Departure";
      else if (ticketNo) autoStatus = "Ticket Booked";
      else if (rawMedicalStatus === "Passed" || rawMedicalStatus === "Fit") autoStatus = "Medical Passed";

      importLineUsage[lineKey] = usedInFile + 1;

      const technicalFormFromExcel = buildCandidateTechnicalFormFromExcel(row);
      const professionIntelligence = getCandidateProfessionIntelligence(matchedLine.profession || rowProfession);
      const hasTechnicalData = hasCandidateTechnicalExcelData(technicalFormFromExcel);
      const shouldCreateTechnicalProfile = Boolean(professionIntelligence.enabled && hasTechnicalData);
      const technicalScores = shouldCreateTechnicalProfile
        ? buildCandidateTechnicalScores(technicalFormFromExcel, professionIntelligence)
        : null;

      payloads.push(
        withCompany({
          candidate_name: candidateName,
          request_line_id: matchedLine.id || null,
          profession: matchedLine.profession || "",
          nationality: matchedLine.nationality || "",
          gender: matchedLine.gender || "",
          project: requestData.project_name || requestData.project || "",
          request_no: requestData.request_no || requestNo,
          agency: currentRole === "Agency" ? (currentUser?.agency_name || "") : getRowValue(row, ["Agency", "Office", "Agency Name", "المكتب"]),
          passport_no: passportNo,
          mobile: getRowValue(row, ["Mobile", "Phone", "mobile", "الجوال"]),
          email: getRowValue(row, ["Email", "email", "البريد"]),
          notes: getRowValue(row, ["Notes", "Note", "ملاحظات"]),
          status: autoStatus,
          medical_status: rawMedicalStatus || "Pending",
          medical_date: medicalDate,
          ticket_no: ticketNo,
          flight_date: flightDate,
          arrival_date: arrivalDate,
          contract_status: contractStatus,
          technical_profile_required: Boolean(professionIntelligence.enabled),
          technical_profile_completed: technicalScores?.profile_completed || false,
          ai_score: technicalScores?.final_ai_score || 0,
          ai_priority: technicalScores?.interview_priority || (professionIntelligence.enabled ? "Pending Review" : ""),
          ai_recommendation: technicalScores?.ai_recommendation || "",
          ai_reasoning: technicalScores?.ai_reasoning || "",
          final_company_decision: professionIntelligence.enabled ? "Pending Company Review" : "",
          updated_at: new Date().toISOString(),
        })
      );

      candidateTechnicalImportMeta.push(
        shouldCreateTechnicalProfile
          ? {
              profession: matchedLine.profession || rowProfession || "",
              intelligence: professionIntelligence,
              profileForm: technicalFormFromExcel,
              scores: technicalScores,
            }
          : null
      );
    }

    if (!payloads.length) {
      return alert(
        "No candidates uploaded.\n\n" +
          (errors.length ? "Reasons:\n" + errors.slice(0, 15).join("\n") : "")
      );
    }

    const { data: insertedCandidates, error: insertError } = await supabase
      .from("candidates")
      .insert(payloads)
      .select("id, candidate_name, passport_no, profession, request_no");
    if (insertError) return alert(insertError.message);

    const technicalProfilePayloads = (insertedCandidates || [])
      .map((candidate, index) => buildCandidateTechnicalProfilePayload(candidate, candidateTechnicalImportMeta[index]))
      .filter(Boolean);

    if (technicalProfilePayloads.length > 0) {
      const { error: profileImportError } = await supabase
        .from("candidate_technical_profiles")
        .insert(technicalProfilePayloads);

      if (profileImportError) {
        console.warn("candidate_technical_profiles import failed", profileImportError.message);
        alert(`Candidates uploaded, but Candidate Intelligence profiles failed: ${profileImportError.message}`);
      }
    }

    const totalActiveAfterUpload = existingActiveCandidates.length + payloads.filter(
      (candidate) => !blockedStatuses.includes(candidate.status)
    ).length;

    const newRemaining = Math.max(0, Number(requestData.quantity || 0) - totalActiveAfterUpload);

    await supabase
      .from("requests")
      .update({
        remaining: newRemaining,
        remaining_qty: newRemaining,
        status: newRemaining === 0 ? "Visa Process" : "Under Recruitment",
        updated_at: new Date().toISOString(),
      })
      .eq("request_no", requestNo)
      .eq("company_id", currentCompanyId);

    await loadCandidates();
    await loadCandidateTechnicalProfiles();
    await loadRequests();
    setActivePage(currentRole === "Agency" ? "Office Portal" : "Candidates");

    alert(
      `Uploaded: ${payloads.length} candidate(s)
` +
        `Candidate Intelligence profiles: ${technicalProfilePayloads.length}
` +
        `Skipped / Errors: ${errors.length}` +
        (errors.length ? `

First errors:
${errors.slice(0, 10).join("\n")}` : "")
    );
  } catch (error) {
    alert(`Excel upload failed: ${error.message}`);
  }
}
  function resetInterviewForm() {
    setInterviewForm(emptyInterview);
    setInterviewEditingId(null);
  }

  function editInterview(item) {
    setInterviewEditingId(item.id);
    setInterviewForm({
      candidate_name: item.candidate_name || "",
      profession: item.profession || "",
      nationality: item.nationality || "",
      agency: item.agency || "",
      project: item.project || "",
      interview_date: item.interview_date || "",
      interview_type: item.interview_type || "",
      interviewers: item.interviewers || "",
      score: item.score || "",
      notes: item.notes || "",
      status: item.status || "Waiting",
    });
    setActivePage("Interviews");
  }

 async function saveInterview() {
  if (!canManageInterviews) return alert("You do not have permission to manage interviews.");
  if (!interviewForm.candidate_id) {
    return alert("Candidate is required.");
  }

  const interviewPayload = {
    ...interviewForm,
    notes: interviewForm.notes || "",
    interview_date: interviewForm.interview_date || null,
    updated_at: new Date().toISOString(),
  };

  const result = interviewEditingId
    ? await supabase.from("interviews").update(interviewPayload).eq("id", interviewEditingId)
    : await supabase.from("interviews").insert([withCompany(interviewPayload)]);

  if (result.error) return alert(result.error.message);

  let candidateStatus = "Interview Scheduled";

  if (interviewForm.status === "Passed") {
    candidateStatus = "Interview Passed";
  } else if (interviewForm.status === "Rejected") {
    candidateStatus = "Interview Failed";
  } else if (interviewForm.status === "Re-Interview") {
    candidateStatus = "Re-Interview";
  }

  await supabase
    .from("candidates")
    .update({
      status: candidateStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", interviewForm.candidate_id);

  loadInterviews();
  loadCandidates();
  resetInterviewForm();
}

  async function deleteInterview(id) {
    if (!canManageInterviews) return alert("You do not have permission to delete interviews.");
    if (!window.confirm("Delete this interview?")) return;
    const { error } = await supabase.from("interviews").delete().eq("id", id);
    if (error) return alert(error.message);
    loadInterviews();
  }



async function generateEmployeeNo() {
  const year = new Date().getFullYear();

  const { data, error } = await supabase
    .from("employees")
    .select("employee_no")
    .eq("company_id", currentCompanyId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    return `EMP-${year}-000001`;
  }

  const lastEmployeeNo = data[0].employee_no || "";
  const lastNumber = parseInt(lastEmployeeNo.split("-")[2] || "0", 10);
  const nextNumber = String(lastNumber + 1).padStart(6, "0");
  return `EMP-${year}-${nextNumber}`;
}

function getMaxEmployeeSequence() {
  const year = new Date().getFullYear();
  return employees.reduce((max, employee) => {
    const employeeNo = String(employee.employee_no || "");
    const parts = employeeNo.split("-");
    if (parts[0] !== "EMP" || parts[1] !== String(year)) return max;
    const number = parseInt(parts[2] || "0", 10);
    return Number.isFinite(number) ? Math.max(max, number) : max;
  }, 0);
}

function buildEmployeeNo(sequence) {
  const year = new Date().getFullYear();
  return `EMP-${year}-${String(sequence).padStart(6, "0")}`;
}

function parseExcelDateValue(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    if (date) {
      const yyyy = String(date.y).padStart(4, "0");
      const mm = String(date.m).padStart(2, "0");
      const dd = String(date.d).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
  }
  const text = String(value || "").trim();
  if (!text) return null;
  const normalized = text.replace(/[/.]/g, "-");
  const parts = normalized.split("-");
  if (parts.length === 3) {
    if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
    return `${parts[2].padStart(4, "0")}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
  }
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return null;
}

function downloadEmployeesTemplate() {
  const templateRows = [
    {
      "Employee No": "",
      "Employee Name": "Ahmed Ali",
      "Iqama No": "1234567890",
      "Nationality": "India",
      "Gender": "Male",
      "Profession": "Electrician",
      "Project": "MODON",
      "Department": "Operation",
      "Joining Date": "2026-07-01",
      "Contract End Date": "2027-07-01",
      "Status": "Active",
      "Notes": "Sample row - delete before upload"
    }
  ];

  const worksheet = XLSX.utils.json_to_sheet(templateRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Employees Template");
  XLSX.writeFile(workbook, "VisaFlow_Employees_Template.xlsx");
}

function startEmployeesExcelUpload() {
  setTimeout(() => employeeExcelInputRef.current?.click(), 0);
}

async function handleEmployeesExcelUpload(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!canManageEmployees) return alert("You do not have permission to import employees.");

  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (!rows.length) return alert("Employee file is empty.");

    const existingIqamas = new Set(
      employees
        .map((employee) => String(employee.iqama_no || "").trim())
        .filter(Boolean)
    );

    const fileIqamas = new Set();
    let nextSequence = getMaxEmployeeSequence() + 1;
    const payloads = [];
    const errors = [];

    rows.forEach((row, index) => {
      const rowNo = index + 2;
      const employeeName = getRowValue(row, ["Employee Name", "Name", "employee_name", "اسم الموظف"]);
      const iqamaNo = getRowValue(row, ["Iqama No", "Iqama", "ID", "Employee ID", "iqama_no", "رقم الاقامة", "رقم الإقامة"]);
      const profession = getRowValue(row, ["Profession", "Job", "Position", "profession", "المهنة"]);

      if (!employeeName) {
        errors.push(`Row ${rowNo}: Employee Name is required`);
        return;
      }

      if (!profession) {
        errors.push(`Row ${rowNo}: Profession is required`);
        return;
      }

      if (iqamaNo && existingIqamas.has(iqamaNo)) {
        errors.push(`Row ${rowNo}: Iqama already exists (${iqamaNo})`);
        return;
      }

      if (iqamaNo && fileIqamas.has(iqamaNo)) {
        errors.push(`Row ${rowNo}: Duplicate Iqama inside file (${iqamaNo})`);
        return;
      }

      if (iqamaNo) fileIqamas.add(iqamaNo);

      const employeeNoFromFile = getRowValue(row, ["Employee No", "EmployeeNo", "employee_no", "رقم الموظف"]);
      const employeeNo = employeeNoFromFile || buildEmployeeNo(nextSequence++);

      payloads.push(withCompany({
        employee_no: employeeNo,
        employee_name: employeeName,
        iqama_no: iqamaNo,
        nationality: getRowValue(row, ["Nationality", "nationality", "الجنسية"]),
        gender: getRowValue(row, ["Gender", "gender", "الجنس"]),
        profession,
        project_name: getRowValue(row, ["Project", "Project Name", "project_name", "المشروع"]),
        department: getRowValue(row, ["Department", "department", "القسم"]),
        joining_date: parseExcelDateValue(row["Joining Date"] || row["joining_date"] || row["تاريخ المباشرة"]),
        contract_end_date: parseExcelDateValue(row["Contract End Date"] || row["contract_end_date"] || row["تاريخ نهاية العقد"]),
        status: getRowValue(row, ["Status", "status", "الحالة"]) || "Active",
        notes: getRowValue(row, ["Notes", "notes", "ملاحظات"]),
        updated_at: new Date().toISOString(),
      }));
    });

    if (!payloads.length) {
      return alert(`No employees imported.\n\n${errors.slice(0, 10).join("\n")}`);
    }

    const { error } = await supabase.from("employees").insert(payloads);
    if (error) return alert(error.message);

    await loadEmployees();
    alert(
      `Imported: ${payloads.length} employee(s)\n` +
      `Skipped / Errors: ${errors.length}` +
      (errors.length ? `\n\nFirst errors:\n${errors.slice(0, 10).join("\n")}` : "")
    );
  } catch (error) {
    alert(`Employee import failed: ${error.message}`);
  }
}

function resetEmployeeForm() {
  setEmployeeForm(emptyEmployee);
  setEmployeeEditingId(null);
}

function editEmployee(item) {
  setEmployeeEditingId(item.id);
  setEmployeeForm({
    employee_no: item.employee_no || "",
    employee_name: item.employee_name || "",
    iqama_no: item.iqama_no || "",
    nationality: item.nationality || "",
    gender: item.gender || "",
    profession: item.profession || "",
    project_name: item.project_name || "",
    department: item.department || "",
    joining_date: item.joining_date || "",
    contract_end_date: item.contract_end_date || "",
    status: item.status || "Active",
    source_candidate_id: item.source_candidate_id || "",
    notes: item.notes || "",
  });
  setActivePage("Employees");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function saveEmployee() {
  if (!canManageEmployees) return alert("You do not have permission to manage employees.");
  if (!employeeForm.employee_name || !employeeForm.profession) {
    return alert("Employee name and profession are required.");
  }

  const payload = {
    employee_no: employeeEditingId ? employeeForm.employee_no : await generateEmployeeNo(),
    employee_name: employeeForm.employee_name,
    iqama_no: employeeForm.iqama_no || "",
    nationality: employeeForm.nationality || "",
    gender: employeeForm.gender || "",
    profession: employeeForm.profession || "",
    project_name: employeeForm.project_name || "",
    department: employeeForm.department || "",
    joining_date: employeeForm.joining_date || null,
    contract_end_date: employeeForm.contract_end_date || null,
    status: employeeForm.status || "Active",
    source_candidate_id: employeeForm.source_candidate_id ? Number(employeeForm.source_candidate_id) : null,
    notes: employeeForm.notes || "",
    updated_at: new Date().toISOString(),
  };

  const result = employeeEditingId
    ? await supabase
        .from("employees")
        .update(payload)
        .eq("id", employeeEditingId)
        .eq("company_id", currentCompanyId)
    : await supabase.from("employees").insert([withCompany(payload)]);

  if (result.error) return alert(result.error.message);

  alert(employeeEditingId ? "Employee updated successfully" : `Employee created successfully: ${payload.employee_no}`);
  resetEmployeeForm();
  await loadEmployees();
}

async function deleteEmployee(id) {
  if (!canManageEmployees) return alert("You do not have permission to delete employees.");
  if (!window.confirm("Delete this employee record?")) return;

  const { error } = await supabase
    .from("employees")
    .delete()
    .eq("id", id)
    .eq("company_id", currentCompanyId);

  if (error) return alert(error.message);
  await loadEmployees();
}

function createDemobilizationFromEmployee(employee) {
  if (!canManageDemobilization) return alert("You do not have permission to manage demobilization.");
  setDemobilizationEditingId(null);
  setDemobAiSuggestion(null);
  setDemobilizationForm({
    ...emptyDemobilization,
    employee_name: employee.employee_name || "",
    employee_id: employee.employee_no || "",
    iqama_no: employee.iqama_no || "",
    profession: employee.profession || "",
    nationality: employee.nationality || "",
    gender: employee.gender || "",
    current_project: employee.project_name || "",
    demob_date: new Date().toISOString().slice(0, 10),
    reason: "Project End",
    status: "Available",
  });
  setActivePage("Demobilization");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function convertCandidateToEmployee(candidate) {
  if (!canManageEmployees) return alert("You do not have permission to create employees.");
  if (!candidate) return alert("Candidate not found.");

  const existing = employees.find(
    (employee) => String(employee.source_candidate_id || "") === String(candidate.id || "")
  );

  if (existing) {
    return alert(`This candidate is already converted to employee: ${existing.employee_no}`);
  }

  const employeeNo = await generateEmployeeNo();
  const payload = {
    employee_no: employeeNo,
    employee_name: candidate.candidate_name || "",
    iqama_no: "",
    nationality: candidate.nationality || "",
    gender: candidate.gender || "",
    profession: candidate.profession || "",
    project_name: candidate.project || "",
    department: "",
    joining_date: candidate.joining_date || candidate.arrival_date || new Date().toISOString().slice(0, 10),
    contract_end_date: null,
    status: "Active",
    source_candidate_id: Number(candidate.id || 0) || null,
    notes: `Converted from candidate ${candidate.candidate_name || ""} / Request ${candidate.request_no || "-"}`,
    updated_at: new Date().toISOString(),
  };

  const result = await supabase.from("employees").insert([withCompany(payload)]);
  if (result.error) return alert(result.error.message);

  await supabase
    .from("candidates")
    .update({ status: "Joined", updated_at: new Date().toISOString() })
    .eq("id", candidate.id)
    .eq("company_id", currentCompanyId);

  alert(`Candidate converted to employee: ${employeeNo}`);
  await loadEmployees();
  await loadCandidates();
  setActivePage("Employees");
}

const employeeIntelligence = useMemo(() => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const next60 = new Date(today);
  next60.setDate(next60.getDate() + 60);

  const activeEmployees = employees.filter((employee) => employee.status === "Active");
  const expiringSoon = activeEmployees.filter((employee) => {
    if (!employee.contract_end_date) return false;
    const endDate = new Date(employee.contract_end_date);
    return endDate >= today && endDate <= next60;
  });

  const openRequests = requests.filter((request) =>
    ["Open", "Under Recruitment", "Interview Stage", "Visa Process"].includes(request.status || "Open")
  );

  let redeploymentMatches = 0;
  expiringSoon.forEach((employee) => {
    const hasMatch = openRequests.some(
      (request) =>
        normalize(request.profession) === normalize(employee.profession) &&
        (!request.nationality || !employee.nationality || normalize(request.nationality) === normalize(employee.nationality)) &&
        (!request.gender || !employee.gender || normalize(request.gender) === normalize(employee.gender))
    );
    if (hasMatch) redeploymentMatches += 1;
  });

  const potentialSaving = redeploymentMatches * 3150;

  const projectRisk = Object.values(
    expiringSoon.reduce((acc, employee) => {
      const key = employee.project_name || "Unassigned";
      if (!acc[key]) acc[key] = { project: key, count: 0, professions: new Set() };
      acc[key].count += 1;
      if (employee.profession) acc[key].professions.add(employee.profession);
      return acc;
    }, {})
  )
    .map((item) => ({ ...item, professions: Array.from(item.professions).join(", ") }))
    .sort((a, b) => b.count - a.count)[0] || null;

  return {
    totalEmployees: employees.length,
    activeEmployees: activeEmployees.length,
    expiringSoon: expiringSoon.length,
    redeploymentMatches,
    potentialSaving,
    projectRisk,
  };
}, [employees, requests]);

function estimateRedeploymentCost(source = demobilizationForm, suggestion = null) {
  const isSaudi = isSaudiNationality(source.nationality);
  const defaultNewRecruitmentCost = isSaudi ? 1200 : 3650;
  const redeploymentCost = Number(source.redeployment_cost || 500);
  const manualNewCost = Number(source.estimated_new_recruitment_cost || 0);
  const newRecruitmentCost = manualNewCost > 0 ? manualNewCost : defaultNewRecruitmentCost;
  const estimatedSaving = Math.max(newRecruitmentCost - redeploymentCost, 0);

  return {
    newRecruitmentCost,
    redeploymentCost,
    estimatedSaving,
    recruitmentAvoided: suggestion?.score >= 60 ? "Yes" : source.recruitment_avoided || "Yes",
  };
}

const demobilizationIntelligence = useMemo(() => {
  const availableEmployees = demobilizations.filter((item) => item.status === "Available").length;
  const suggestedEmployees = demobilizations.filter((item) => item.status === "Suggested").length;
  const reassignedEmployees = demobilizations.filter((item) => item.status === "Reassigned").length;
  const invoicesRequired = demobilizations.filter((item) => item.invoice_required === "Yes").length;
  const recruitmentAvoided = demobilizations.filter((item) => item.recruitment_avoided === "Yes" || item.status === "Reassigned" || Number(item.match_score || 0) >= 60).length;
  const potentialSaving = demobilizations.reduce((sum, item) => {
    const storedSaving = Number(item.estimated_saving || 0);
    if (storedSaving > 0) return sum + storedSaving;
    const newCost = Number(item.estimated_new_recruitment_cost || (isSaudiNationality(item.nationality) ? 1200 : 3650));
    const redeployCost = Number(item.redeployment_cost || 500);
    return sum + Math.max(newCost - redeployCost, 0);
  }, 0);

  const openRecruitmentGaps = requests
    .filter((request) => ["Open", "Under Recruitment", "Interview Stage", "Visa Process"].includes(request.status || "Open"))
    .map((request) => {
      const requiredQty = Number(request.quantity || request.qty || 0);
      const activeCount = candidates.filter(
        (candidate) =>
          String(candidate.request_no || "") === String(request.request_no || "") &&
          !["Rejected", "Interview Failed", "Medical Failed", "Cancelled", "Joined"].includes(candidate.status)
      ).length;
      const remaining = Math.max(requiredQty - activeCount, 0);
      const daysOpen = request.created_at ? Math.floor((new Date() - new Date(request.created_at)) / (1000 * 60 * 60 * 24)) : 0;
      return { ...request, requiredQty, activeCount, remaining, daysOpen };
    })
    .filter((request) => request.remaining > 0)
    .sort((a, b) => b.daysOpen - a.daysOpen);

  const smartAlerts = [];
  const availableWithProfession = demobilizations.filter((item) => item.status === "Available" && item.profession);
  openRecruitmentGaps.slice(0, 6).forEach((request) => {
    const matches = availableWithProfession.filter((employee) =>
      normalize(employee.profession) === normalize(request.profession) &&
      (!request.nationality || !employee.nationality || normalize(employee.nationality) === normalize(request.nationality)) &&
      (!request.gender || !employee.gender || normalize(employee.gender) === normalize(request.gender))
    );
    if (matches.length > 0) {
      const suggestedQty = Math.min(matches.length, request.remaining);
      smartAlerts.push({
        request_no: request.request_no,
        project: request.project_name || request.project || "-",
        profession: request.profession || "-",
        remaining: request.remaining,
        available_matches: matches.length,
        suggested_qty: suggestedQty,
        days_open: request.daysOpen,
        estimated_saving: suggestedQty * 3150,
        message: `${suggestedQty} available employee(s) can support ${request.request_no} before external recruitment.`,
      });
    }
  });

  return {
    availableEmployees,
    suggestedEmployees,
    reassignedEmployees,
    invoicesRequired,
    recruitmentAvoided,
    potentialSaving,
    openRecruitmentGaps,
    smartAlerts,
  };
}, [demobilizations, requests, candidates]);

function resetDemobilizationForm() {
  setDemobilizationForm(emptyDemobilization);
  setDemobilizationEditingId(null);
  setDemobAiSuggestion(null);
}

function calculateDemobSuggestions(source = demobilizationForm) {
  const openStatuses = ["Open", "Under Recruitment", "Interview Stage", "Visa Process"];
  const blockedCandidateStatuses = ["Rejected", "Interview Failed", "Medical Failed", "Cancelled", "Joined"];

  return requests
    .filter((request) => openStatuses.includes(request.status || "Open"))
    .map((request) => {
      const requiredQty = Number(request.quantity || request.qty || 0);
      const activeCount = candidates.filter(
        (candidate) =>
          String(candidate.request_no || "") === String(request.request_no || "") &&
          !blockedCandidateStatuses.includes(candidate.status)
      ).length;
      const remaining = Math.max(requiredQty - activeCount, 0);
      if (remaining <= 0) return null;

      const professionMatch = normalize(request.profession) === normalize(source.profession);
      const nationalityMatch = normalize(request.nationality) === normalize(source.nationality);
      const genderMatch = !request.gender || !source.gender || normalize(request.gender) === normalize(source.gender);
      const projectDifferent = normalize(request.project_name || request.project) !== normalize(source.current_project);
      const daysOpen = request.created_at ? Math.floor((new Date() - new Date(request.created_at)) / (1000 * 60 * 60 * 24)) : 0;
      const delayedRequest = daysOpen >= 15 || ["Under Recruitment", "Interview Stage", "Visa Process"].includes(request.status);
      const highPriority = ["Urgent", "High"].includes(request.priority);

      let score = 0;
      if (professionMatch) score += 40;
      if (nationalityMatch) score += 20;
      if (genderMatch) score += 10;
      if (delayedRequest) score += 15;
      if (highPriority) score += 15;
      if (projectDifferent) score += 5;
      if (remaining > 0) score += 5;
      score = Math.min(score, 100);

      const cost = estimateRedeploymentCost(source, { score });

      let reason = [];
      if (professionMatch) reason.push("same profession");
      if (nationalityMatch) reason.push("same nationality");
      if (genderMatch) reason.push("gender compatible");
      if (remaining > 0) reason.push(`${remaining} open position(s)`);
      if (delayedRequest) reason.push(`recruitment delayed / active for ${daysOpen} day(s)`);
      if (highPriority) reason.push(`${request.priority} priority`);

      return {
        request_no: request.request_no,
        project: request.project_name || request.project || "-",
        profession: request.profession || "-",
        nationality: request.nationality || "-",
        gender: request.gender || "-",
        priority: request.priority || "Normal",
        required: requiredQty,
        active_candidates: activeCount,
        remaining,
        days_open: daysOpen,
        score,
        new_recruitment_cost: cost.newRecruitmentCost,
        redeployment_cost: cost.redeploymentCost,
        estimated_saving: cost.estimatedSaving,
        recommendation:
          score >= 85
            ? "Strong redeployment match. Reassign immediately before external sourcing."
            : score >= 70
            ? "Good match. Review with Operations and Recruitment today."
            : score >= 55
            ? "Possible match. Needs project approval due to partial mismatch."
            : "Low match. Keep as backup or hold employee until better request appears.",
        reason: reason.join(", ") || "limited matching data",
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

function runDemobAI() {
  if (!demobilizationForm.employee_name && !demobilizationForm.profession) {
    return alert("Please enter employee name and profession first.");
  }

  const suggestions = calculateDemobSuggestions();
  const best = suggestions[0] || null;

  if (!best) {
    setDemobAiSuggestion({
      summary: "No suitable open request found.",
      suggestions: [],
    });
    setDemobilizationForm((prev) => ({
      ...prev,
      status: "Available",
      suggested_request_no: "",
      suggested_project: "",
      match_score: "0",
      ai_recommendation: "No suitable request found. Keep employee available or proceed with exit/hold decision.",
    }));
    return;
  }

  const recommendationText = `Best match: ${best.request_no} / ${best.project}. Match score ${best.score}%. Reason: ${best.reason}. Recommendation: ${best.recommendation}`;

  setDemobAiSuggestion({
    summary: recommendationText,
    suggestions: suggestions.slice(0, 3),
  });

  setDemobilizationForm((prev) => ({
    ...prev,
    status: "Suggested",
    suggested_request_no: best.request_no,
    suggested_project: best.project,
    match_score: String(best.score),
    ai_recommendation: recommendationText,
    invoice_required: best.estimated_saving > 0 ? "Yes" : prev.invoice_required || "No",
    invoice_type: prev.invoice_type || "Redeployment Service",
    invoice_amount: prev.invoice_amount || String(best.redeployment_cost),
    redeployment_cost: String(best.redeployment_cost),
    estimated_new_recruitment_cost: String(best.new_recruitment_cost),
    estimated_saving: String(best.estimated_saving),
    recruitment_avoided: best.score >= 60 ? "Yes" : "No",
  }));
}

function applyDemobSuggestion(item) {
  if (!item) return;
  const recommendationText = `Selected match: ${item.request_no} / ${item.project}. Match score ${item.score}%. Estimated saving ${Number(item.estimated_saving || 0).toLocaleString()} SAR. Reason: ${item.reason}. Recommendation: ${item.recommendation}`;
  setDemobilizationForm((prev) => ({
    ...prev,
    status: "Suggested",
    suggested_request_no: item.request_no,
    suggested_project: item.project,
    match_score: String(item.score),
    ai_recommendation: recommendationText,
    invoice_required: item.estimated_saving > 0 ? "Yes" : prev.invoice_required || "No",
    invoice_type: prev.invoice_type || "Redeployment Service",
    invoice_amount: prev.invoice_amount || String(item.redeployment_cost),
    redeployment_cost: String(item.redeployment_cost),
    estimated_new_recruitment_cost: String(item.new_recruitment_cost),
    estimated_saving: String(item.estimated_saving),
    recruitment_avoided: item.score >= 60 ? "Yes" : "No",
  }));
}


function editDemobilization(item) {
  setDemobilizationEditingId(item.id);
  setDemobilizationForm({
    employee_name: item.employee_name || "",
    employee_id: item.employee_id || "",
    iqama_no: item.iqama_no || "",
    profession: item.profession || "",
    nationality: item.nationality || "",
    gender: item.gender || "",
    current_project: item.current_project || "",
    demob_date: item.demob_date || "",
    reason: item.reason || "Project End",
    status: item.status || "Available",
    suggested_request_no: item.suggested_request_no || "",
    suggested_project: item.suggested_project || "",
    match_score: item.match_score || "",
    ai_recommendation: item.ai_recommendation || "",
    invoice_required: item.invoice_required || "No",
    invoice_amount: item.invoice_amount || "",
    invoice_type: item.invoice_type || "Redeployment Service",
    redeployment_cost: item.redeployment_cost || "500",
    estimated_new_recruitment_cost: item.estimated_new_recruitment_cost || "3650",
    estimated_saving: item.estimated_saving || "",
    recruitment_avoided: item.recruitment_avoided || "Yes",
    notes: item.notes || "",
  });
  setActivePage("Demobilization");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function saveDemobilization() {
  if (!canManageDemobilization) return alert("You do not have permission to manage demobilization.");
  if (!demobilizationForm.employee_name || !demobilizationForm.profession) {
    return alert("Employee name and profession are required.");
  }

  const payload = {
    ...demobilizationForm,
    notes: demobilizationForm.notes || "",
    ai_recommendation: demobilizationForm.ai_recommendation || "",
    demob_date: demobilizationForm.demob_date || null,
    match_score: Number(demobilizationForm.match_score || 0),
    invoice_amount: Number(demobilizationForm.invoice_amount || 0),
    redeployment_cost: Number(demobilizationForm.redeployment_cost || 0),
    estimated_new_recruitment_cost: Number(demobilizationForm.estimated_new_recruitment_cost || 0),
    estimated_saving: Number(demobilizationForm.estimated_saving || 0),
    updated_at: new Date().toISOString(),
  };

  const result = demobilizationEditingId
    ? await supabase
        .from("demobilizations")
        .update(payload)
        .eq("id", demobilizationEditingId)
        .eq("company_id", currentCompanyId)
    : await supabase.from("demobilizations").insert([withCompany(payload)]);

  if (result.error) return alert(result.error.message);

  alert(demobilizationEditingId ? "Demobilization updated successfully" : "Demobilization saved successfully");
  resetDemobilizationForm();
  await loadDemobilizations();
}

async function deleteDemobilization(id) {
  if (!canManageDemobilization) return alert("You do not have permission to delete demobilization records.");
  if (!window.confirm("Delete this demobilization record?")) return;

  const { error } = await supabase
    .from("demobilizations")
    .delete()
    .eq("id", id)
    .eq("company_id", currentCompanyId);

  if (error) return alert(error.message);
  await loadDemobilizations();
}

function resetMobilizationForm() {
  setMobilizationForm({
    candidate_id: "",
    request_no: "",
    candidate_name: "",
    profession: "",
    nationality: "",
    medical_status: "Pending",
    medical_date: "",
    visa_status: "Pending",
    visa_date: "",
    ticket_no: "",
    flight_date: "",
    arrival_date: "",
    joining_date: "",
    mobilization_status: "New",
    remarks: "",
  });
  setMobilizationEditingId(null);
}

function selectCandidateForMobilization(candidateId) {
  const selectedCandidateId = String(candidateId || "").split(" - ")[0];
  const candidate = candidates.find((c) => String(c.id) === selectedCandidateId);

  if (!candidate) {
    setMobilizationForm((prev) => ({
      ...prev,
      candidate_id: "",
      request_no: "",
      candidate_name: "",
      profession: "",
      nationality: "",
    }));
    return;
  }

  const existing = mobilizations.find(
    (m) => String(m.candidate_id) === String(candidate.id)
  );

  if (existing && !mobilizationEditingId) {
    setMobilizationEditingId(existing.id);
    setMobilizationForm({
      candidate_id: existing.candidate_id || candidate.id,
      request_no: existing.request_no || candidate.request_no || "",
      candidate_name: existing.candidate_name || candidate.candidate_name || "",
      profession: existing.profession || candidate.profession || "",
      nationality: existing.nationality || candidate.nationality || "",
      medical_status: existing.medical_status || "Pending",
      medical_date: existing.medical_date || "",
      visa_status: existing.visa_status || "Pending",
      visa_date: existing.visa_date || "",
      ticket_no: existing.ticket_no || "",
      flight_date: existing.flight_date || "",
      arrival_date: existing.arrival_date || "",
      joining_date: existing.joining_date || "",
      mobilization_status: existing.mobilization_status || "New",
      remarks: existing.remarks || "",
    });
    return;
  }

  setMobilizationForm((prev) => ({
    ...prev,
    candidate_id: candidate.id,
    request_no: candidate.request_no || "",
    candidate_name: candidate.candidate_name || "",
    profession: candidate.profession || "",
    nationality: candidate.nationality || "",
    medical_status: candidate.medical_status || prev.medical_status || "Pending",
    medical_date: candidate.medical_date || prev.medical_date || "",
    ticket_no: candidate.ticket_no || prev.ticket_no || "",
    flight_date: candidate.flight_date || prev.flight_date || "",
    arrival_date: candidate.arrival_date || prev.arrival_date || "",
  }));
}

function openMobilizationFromCandidate(candidate) {
  selectCandidateForMobilization(candidate.id);
  setActivePage("Mobilization");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function editMobilization(item) {
  setMobilizationEditingId(item.id);
  setMobilizationForm({
    candidate_id: item.candidate_id || "",
    request_no: item.request_no || "",
    candidate_name: item.candidate_name || "",
    profession: item.profession || "",
    nationality: item.nationality || "",
    medical_status: item.medical_status || "Pending",
    medical_date: item.medical_date || "",
    visa_status: item.visa_status || "Pending",
    visa_date: item.visa_date || "",
    ticket_no: item.ticket_no || "",
    flight_date: item.flight_date || "",
    arrival_date: item.arrival_date || "",
    joining_date: item.joining_date || "",
    mobilization_status: item.mobilization_status || "New",
    remarks: item.remarks || "",
  });
  setActivePage("Mobilization");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function saveMobilization() {
  if (!canManageMobilization) return alert("You do not have permission to manage mobilization.");
  if (!mobilizationForm.candidate_id) return alert("Candidate is required.");

  const candidate = candidates.find(
    (c) => String(c.id) === String(mobilizationForm.candidate_id)
  );

  const existing = mobilizations.find(
    (m) => String(m.candidate_id) === String(mobilizationForm.candidate_id) &&
      String(m.id) !== String(mobilizationEditingId || "")
  );

  if (existing) {
    return alert("This candidate already has a mobilization record. Use Edit instead.");
  }

  const payload = {
    candidate_id: Number(mobilizationForm.candidate_id),
    request_no: candidate?.request_no || mobilizationForm.request_no || "",
    candidate_name: candidate?.candidate_name || mobilizationForm.candidate_name || "",
    profession: candidate?.profession || mobilizationForm.profession || "",
    nationality: candidate?.nationality || mobilizationForm.nationality || "",
    medical_status: mobilizationForm.medical_status || "Pending",
    medical_date: mobilizationForm.medical_date || null,
    visa_status: mobilizationForm.visa_status || "Pending",
    visa_date: mobilizationForm.visa_date || null,
    ticket_no: mobilizationForm.ticket_no || "",
    flight_date: mobilizationForm.flight_date || null,
    arrival_date: mobilizationForm.arrival_date || null,
    joining_date: mobilizationForm.joining_date || null,
    mobilization_status: mobilizationForm.mobilization_status || "New",
    remarks: mobilizationForm.remarks || "",
    updated_at: new Date().toISOString(),
  };

  const result = mobilizationEditingId
    ? await supabase.from("mobilizations").update(payload).eq("id", mobilizationEditingId)
    : await supabase.from("mobilizations").insert([withCompany(payload)]);

  if (result.error) return alert(result.error.message);

  let candidateStatus = candidate?.status || "New";
  if (payload.mobilization_status === "Joined") candidateStatus = "Joined";
  else if (payload.mobilization_status === "Arrived KSA") candidateStatus = "Arrived KSA";
  else if (payload.mobilization_status === "Ticket Issued") candidateStatus = "Ticket Booked";
  else if (payload.mobilization_status === "Visa Ready") candidateStatus = "Visa Stamped";
  else if (payload.medical_status === "Fit") candidateStatus = "Medical Passed";
  else if (payload.medical_status === "Unfit") candidateStatus = "Medical Failed";

  await supabase
    .from("candidates")
    .update({
      status: candidateStatus,
      medical_status: payload.medical_status === "Fit" ? "Passed" : payload.medical_status === "Unfit" ? "Failed" : "Pending",
      medical_date: payload.medical_date,
      ticket_no: payload.ticket_no,
      flight_date: payload.flight_date,
      arrival_date: payload.arrival_date,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payload.candidate_id);

  alert(mobilizationEditingId ? "Mobilization updated successfully" : "Mobilization saved successfully");
  resetMobilizationForm();
  await loadMobilizations();
  await loadCandidates();
  await loadRequests();
}

async function deleteMobilization(id) {
  if (!canManageMobilization) return alert("You do not have permission to delete mobilization.");
  if (!window.confirm("Delete this mobilization record?")) return;

  const { error } = await supabase.from("mobilizations").delete().eq("id", id);
  if (error) return alert(error.message);
  loadMobilizations();
}

async function createVisaFromRequest(item) {
  if (!canManageVisas) return alert("You do not have permission to allocate visas.");
  if (isSaudiRequest(item)) {
    return alert("Saudi request does not require visa.");
  }

  const lines = getRequestLinesForRequest(item).filter((line) => !isSaudiNationality(line.nationality));
  const firstLine = lines[0] || item;
  const neededQty = Number(firstLine.quantity || item.quantity || 0);

  const matchedLine = visaInventoryLines.find(
    (line) =>
      !isSaudiNationality(line.nationality) &&
      normalize(line.profession) === normalize(firstLine.profession || item.profession) &&
      normalize(line.nationality) === normalize(firstLine.nationality || item.nationality) &&
      (!firstLine.gender || !line.gender || normalize(line.gender) === normalize(firstLine.gender)) &&
      getVisaLineRemainingQty(line) >= neededQty
  );

  if (!matchedLine) {
    return alert("No available visa line matching this request.");
  }

  const { error } = await supabase
    .from("visa_allocations")
    .insert([withCompany({
      request_no: item.request_no,
      visa_no: matchedLine.visa_no,
      visa_batch_line_id: matchedLine.legacy ? null : matchedLine.id,
      allocated_qty: neededQty,
    })]);

  if (error) return alert(error.message);

  await supabase
    .from("requests")
    .update({
      status: "Visa Process",
      visa_no: matchedLine.visa_no,
      allocated_visa_qty: neededQty,
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id);

  alert(`Visa allocated successfully. Remaining visa line balance: ${getVisaLineRemainingQty(matchedLine) - neededQty}`);

  loadAll();
  setActivePage("Visa Allocation");
}
  function createCandidateFromRequest(item, selectedLine = null) {
  if (!canManageCandidates) return alert("You do not have permission to add candidates.");
  resetCandidateForm();

  const lines = getRequestLinesForRequest(item);
  const firstLine =
    selectedLine ||
    lines.find((line) => isSaudiNationality(line.nationality)) ||
    lines[0] ||
    item;

  const isSaudiLine = isSaudiNationality(firstLine.nationality) || isSaudiRequest(item);

  setCandidateForm({
    ...emptyCandidate,
    request_line_id: firstLine.id && !String(firstLine.id).includes("legacy") ? firstLine.id : "",
    profession: firstLine.profession || item.profession || "",
    nationality: firstLine.nationality || item.nationality || "",
    gender: firstLine.gender || item.gender || "",
    project: item.project_name || item.project || "",
    request_no: item.request_no || "",
    source: isSaudiLine ? "Jadarat" : "",
    offer_status: "Pending",
    ticket_no: isSaudiLine ? "" : emptyCandidate.ticket_no,
    flight_date: isSaudiLine ? "" : emptyCandidate.flight_date,
    arrival_date: isSaudiLine ? "" : emptyCandidate.arrival_date,
    visa_fees: isSaudiLine ? 0 : emptyCandidate.visa_fees,
    agency_commission: isSaudiLine ? 0 : emptyCandidate.agency_commission,
    ticket_cost: isSaudiLine ? 0 : emptyCandidate.ticket_cost,
  });

  setActivePage("Candidates");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function openRequestDetails(item) {
  setSelectedRequest(item);
  setActivePage("RequestDetails");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function handleForgotPasswordSubmit() {
  const email = resetEmail.trim().toLowerCase();

  if (!email) {
    setResetMessage("Please enter your email address.");
    return;
  }

  setResetLoading(true);
  setResetMessage("");

  try {
    const { data } = await supabase
      .from("users")
      .select("id, name, email, status")
      .eq("email", email)
      .maybeSingle();

    if (!data) {
      setResetMessage("If this email exists, the system administrator will be notified.");
    } else if (data.status !== "Active") {
      setResetMessage("This account is inactive. Please contact the system administrator.");
    } else {
      await triggerExternalNotification("PASSWORD_RESET_REQUEST", {
        user_id: data.id,
        name: data.name,
        email: data.email,
        source: "Login Page",
      });

      setResetMessage("Password reset request sent. Please contact the system administrator.");
    }
  } catch (error) {
    setResetMessage(error?.message || "Unable to submit password reset request.");
  } finally {
    setResetLoading(false);
  }
}

async function handleLogin() {
  const email = loginForm.email.trim().toLowerCase();
  const password = loginForm.password.trim();

  if (!email || !password) {
    alert("Please enter email and password");
    return;
  }

  setLoginLoading(true);

  try {
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id, name, email, role, agency_id, agency_name, status, company_id")
      .eq("email", email)
      .eq("password", password)
      .maybeSingle();

    if (userError || !userData) {
      alert("Invalid email or password");
      return;
    }

    const userStatus = String(userData.status || "").trim().toLowerCase();
    if (userStatus !== "active") {
      alert("This user is not active");
      return;
    }

    let companyData = null;

    if (userData.company_id) {
      const { data: company, error: companyError } = await supabase
        .from("companies")
        .select("id, name, status, subscription_status, subscription_end")
        .eq("id", userData.company_id)
        .maybeSingle();

      if (companyError) {
        console.warn("Company check failed:", companyError.message);
      }

      companyData = company;

      const companyStatus = String(companyData?.status || "").trim().toLowerCase();
      const subscriptionStatus = String(companyData?.subscription_status || "").trim().toLowerCase();

      console.log("Company Check:", {
        userCompanyId: userData.company_id,
        companyData,
        companyStatus,
        subscriptionStatus,
      });

      // Important:
      // If companyData is null, the frontend likely cannot read the companies table
      // because of RLS / policy settings. Do not block login in this case.
      // The user's company_id will still isolate all operational data through currentCompanyId.
      if (companyData) {
        if (companyStatus !== "active" || subscriptionStatus !== "active") {
          alert("Company subscription is not active. Please contact the system administrator.");
          return;
        }

        if (companyData.subscription_end) {
          const endDate = new Date(companyData.subscription_end);
          endDate.setHours(23, 59, 59, 999);
          if (endDate < new Date()) {
            alert("Company subscription has expired. Please contact the system administrator.");
            return;
          }
        }
      }
    }

    const loggedUser = {
      ...userData,
      role: normalizeUserRole(userData.role),
      company_name: companyData?.name || userData.company_name || "",
      subscription_status: companyData?.subscription_status || "",
    };

    if (loggedUser.role === "Agency") {
      const workspaces = await loadAgencyClientAccess(loggedUser, false);
      const storedCompanyId = sessionStorage.getItem("visaflow_agency_company_id") || "";
      const selectedWorkspace =
        workspaces.find((item) => String(item.company_id) === String(storedCompanyId)) ||
        workspaces.find((item) => String(item.company_id) === String(loggedUser.company_id || "")) ||
        workspaces[0] ||
        null;

      if (selectedWorkspace) {
        loggedUser.active_company_id = selectedWorkspace.company_id;
        loggedUser.active_company_name = selectedWorkspace.company_name || "Client Workspace";
        sessionStorage.setItem("visaflow_agency_company_id", String(selectedWorkspace.company_id));
        sessionStorage.setItem("visaflow_agency_company_name", loggedUser.active_company_name);
        setActiveAgencyCompanyId(String(selectedWorkspace.company_id));
        setActiveAgencyCompanyName(loggedUser.active_company_name);
      } else if (!loggedUser.company_id) {
        alert("No active client workspace is assigned to this agency user. Please contact the platform administrator.");
        return;
      }
    }

    const storage = rememberMe ? localStorage : sessionStorage;
    localStorage.removeItem("visaflow_user");
    sessionStorage.removeItem("visaflow_user");
    storage.setItem("visaflow_user", JSON.stringify(loggedUser));
    setCurrentUser(loggedUser);
    setActivePage((ROLE_PAGES[loggedUser.role] || ROLE_PAGES.Viewer)[0]);
  } finally {
    setLoginLoading(false);
  }
}

function handleLogout() {
  localStorage.removeItem("visaflow_user");
  sessionStorage.removeItem("visaflow_user");
  sessionStorage.removeItem("visaflow_agency_company_id");
  sessionStorage.removeItem("visaflow_agency_company_name");
  setAgencyClientAccess([]);
  setActiveAgencyCompanyId("");
  setActiveAgencyCompanyName("");
  setCurrentUser(null);
  setLoginForm({ email: "", password: "" });
  setActivePage("Dashboard");
}

function exportRowsToExcel(rows, fileName, sheetName = "Data") {
  if (!rows || rows.length === 0) {
    alert("No data to export");
    return;
  }

  const cleanRows = rows.map((row) => {
    const clean = {};
    Object.entries(row).forEach(([key, value]) => {
      if (typeof value !== "object") clean[key] = value ?? "";
    });
    return clean;
  });

  const worksheet = XLSX.utils.json_to_sheet(cleanRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
}

function executiveAlertClass(value) {
  const number = Number(value || 0);
  if (number === 0) return "passed";
  if (number <= 5) return "warning";
  return "danger";
}


function buildAgencyScorecard() {
  const agencyNames = Array.from(
    new Set([
      ...agencies.map((agency) => agency.name).filter(Boolean),
      ...candidates.map((candidate) => candidate.agency).filter(Boolean),
      ...visaAuthorizations.map((authorization) => authorization.agency).filter(Boolean),
    ])
  );

  return agencyNames
    .map((agencyName) => {
      const agencyCandidates = candidates.filter((candidate) => normalize(candidate.agency) === normalize(agencyName));
      const agencyInterviews = interviews.filter((interview) => normalize(interview.agency) === normalize(agencyName));
      const agencyAuthorizations = visaAuthorizations.filter((authorization) => normalize(authorization.agency) === normalize(agencyName));
      const activeAuthorizations = agencyAuthorizations.filter((authorization) => authorization.status !== "Cancelled");
      const passedInterviews = agencyInterviews.filter((interview) => interview.status === "Passed").length;
      const rejectedInterviews = agencyInterviews.filter((interview) => ["Rejected", "Interview Failed"].includes(interview.status)).length;
      const joinedCandidates = agencyCandidates.filter((candidate) => candidate.status === "Joined").length;
      const arrivedCandidates = agencyCandidates.filter((candidate) => ["Arrived KSA", "Arrived", "Joined"].includes(candidate.status)).length;
      const failedCandidates = agencyCandidates.filter((candidate) =>
        ["Rejected", "Interview Failed", "Medical Failed", "Cancelled", "KSA Medical Failed", "Refused to Work", "Absconded"].includes(candidate.status)
      ).length;
      const authorizedQty = activeAuthorizations.reduce((sum, authorization) => sum + Number(authorization.allocated_qty || 0), 0);
      const submissionRate = authorizedQty ? Math.round((agencyCandidates.length / authorizedQty) * 100) : agencyCandidates.length ? 100 : 0;
      const successRate = agencyCandidates.length ? Math.round(((joinedCandidates + arrivedCandidates) / agencyCandidates.length) * 100) : 0;
      const failRate = agencyCandidates.length ? Math.round((failedCandidates / agencyCandidates.length) * 100) : 0;
      const interviewPassRate = agencyInterviews.length ? Math.round((passedInterviews / agencyInterviews.length) * 100) : 0;

      const score = Math.max(
        0,
        Math.min(
          100,
          Math.round(
            successRate * 0.35 +
              interviewPassRate * 0.25 +
              Math.min(submissionRate, 100) * 0.25 -
              failRate * 0.15 +
              Math.min(agencyCandidates.length, 20)
          )
        )
      );

      let risk = "Low";
      if (score < 45 || failRate >= 35) risk = "High";
      else if (score < 70 || submissionRate < 50) risk = "Medium";

      return {
        agency: agencyName,
        candidates: agencyCandidates.length,
        authorizedQty,
        submittedPercent: submissionRate,
        passedInterviews,
        rejectedInterviews,
        arrived: arrivedCandidates,
        joined: joinedCandidates,
        failed: failedCandidates,
        successRate,
        failRate,
        score,
        risk,
      };
    })
    .sort((a, b) => b.score - a.score);
}


function getAgencyRank(totalScore) {
  const score = Number(totalScore || 0);
  if (score >= 95) return "Platinum";
  if (score >= 85) return "Gold";
  if (score >= 70) return "Silver";
  return "Under Review";
}



function getActiveAgencyAgreement(agencyName) {
  const now = new Date();
  return [...agencyAgreements]
    .filter((agreement) => {
      const status = String(agreement.status || "").trim().toLowerCase();
      const nameMatches = normalize(agreement.agency_name) === normalize(agencyName);
      if (!nameMatches || status !== "active") return false;

      const effectiveOk = !agreement.effective_date || new Date(agreement.effective_date) <= now;
      const expiryOk = !agreement.expiry_date || new Date(agreement.expiry_date) >= now;
      return effectiveOk && expiryOk;
    })
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))[0] || null;
}

function getAgencyAgreementPolicy(agencyName) {
  const activeAgreement = getActiveAgencyAgreement(agencyName);
  return {
    agreement: activeAgreement,
    agreement_no: activeAgreement?.agreement_no || "Default Policy",
    has_active_agreement: Boolean(activeAgreement),
    sla_days: Number(activeAgreement?.sla_days || 60),
    response_sla_hours: Number(activeAgreement?.response_sla_hours || 24),
    update_frequency_days: Number(activeAgreement?.update_frequency_days || 7),
    delay_penalty_type: activeAgreement?.delay_penalty_type || "Fixed Amount Per Delayed Day",
    delay_penalty_amount: Number(activeAgreement?.delay_penalty_amount || 0),
    delay_penalty_after_days: Number(activeAgreement?.delay_penalty_after_days || 7),
    financial_guarantee_required: activeAgreement?.financial_guarantee_required || "No",
    financial_guarantee_amount: Number(activeAgreement?.financial_guarantee_amount || 0),
    replacement_guarantee_days: Number(activeAgreement?.replacement_guarantee_days || 90),
  };
}

function getCandidateCycleDays(candidate) {
  if (!candidate) return 0;
  const request = requests.find((item) => String(item.request_no || "") === String(candidate.request_no || ""));
  const start = request?.created_at || candidate.created_at;
  const end = candidate.joining_date || candidate.arrival_date || candidate.updated_at || new Date().toISOString();
  if (!start || !end) return 0;
  const days = Math.floor((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24));
  return Number.isFinite(days) ? Math.max(days, 0) : 0;
}

function getCandidateSlaDelay(candidate, agencyName = candidate?.agency) {
  const policy = getAgencyAgreementPolicy(agencyName);
  const cycleDays = getCandidateCycleDays(candidate);
  const delayDays = Math.max(cycleDays - Number(policy.sla_days || 60), 0);
  const penaltyDays = Math.max(delayDays - Number(policy.delay_penalty_after_days || 0), 0);
  const fixedPenalty = String(policy.delay_penalty_type || "").toLowerCase().includes("fixed")
    ? penaltyDays * Number(policy.delay_penalty_amount || 0)
    : 0;

  return {
    cycleDays,
    delayDays,
    penaltyDays,
    penaltyExposure: fixedPenalty,
    policy,
    isDelayed: delayDays > 0,
  };
}


function generatePenaltyNo(indexOffset = 0) {
  const year = new Date().getFullYear();
  const prefix = `PEN-${year}-`;
  const maxNumber = agencyPenalties.reduce((max, item) => {
    const penaltyNo = String(item.penalty_no || "");
    if (!penaltyNo.startsWith(prefix)) return max;
    const numberPart = Number(penaltyNo.replace(prefix, ""));
    return Number.isFinite(numberPart) ? Math.max(max, numberPart) : max;
  }, 0);
  return `${prefix}${String(maxNumber + 1 + indexOffset).padStart(4, "0")}`;
}

function calculatePenaltyRegisterRows() {
  return candidates
    .map((candidate) => {
      const agencyName = candidate.agency || "Unassigned Agency";
      const sla = getCandidateSlaDelay(candidate, agencyName);
      const policy = sla.policy || getAgencyAgreementPolicy(agencyName);
      const agreement = policy.agreement || null;
      const calculatedAmount = Number(sla.penaltyExposure || 0);
      if (!sla.isDelayed || calculatedAmount <= 0) return null;

      const request = requests.find((item) => String(item.request_no || "") === String(candidate.request_no || ""));
      const agency = agencies.find((item) => normalize(item.name) === normalize(agencyName));

      return {
        company_id: currentCompanyId,
        penalty_no: "",
        agreement_id: agreement?.id || null,
        agreement_no: policy.agreement_no || "Default Policy",
        agency_id: agency?.id || null,
        agency_name: agencyName,
        candidate_id: String(candidate.id || ""),
        candidate_name: candidate.candidate_name || "-",
        request_no: candidate.request_no || "-",
        profession: candidate.profession || request?.profession || "-",
        project: candidate.project || request?.project_name || request?.project || "-",
        status: "Pending Review",
        sla_days: Number(policy.sla_days || 60),
        actual_days: Number(sla.cycleDays || 0),
        delay_days: Number(sla.delayDays || 0),
        grace_days: Number(policy.delay_penalty_after_days || 0),
        penalty_days: Number(sla.penaltyDays || 0),
        penalty_type: policy.delay_penalty_type || "Fixed Amount Per Delayed Day",
        penalty_rate: Number(policy.delay_penalty_amount || 0),
        calculated_amount: calculatedAmount,
        approved_amount: null,
        decision_notes: "",
        agency_justification: "",
        source: "live",
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.calculated_amount || 0) - Number(a.calculated_amount || 0));
}

function getPenaltyRegisterDisplayRows() {
  const savedRows = (agencyPenalties || []).map((item) => ({ ...item, source: "saved" }));
  const savedKeys = new Set(savedRows.map((item) => `${String(item.candidate_id || "")}-${String(item.agreement_no || "")}`));
  const liveRows = calculatePenaltyRegisterRows()
    .filter((item) => !savedKeys.has(`${String(item.candidate_id || "")}-${String(item.agreement_no || "")}`))
    .map((item) => ({ ...item, status: "Calculated - Not Saved", source: "live" }));
  return [...savedRows, ...liveRows].sort((a, b) => {
    const statusWeight = { "Justification Submitted": 0, "Pending Review": 1, "Calculated - Not Saved": 2, "Sent to Agency": 3, Approved: 4, Reduced: 5, Waived: 6 };
    return (statusWeight[a.status] ?? 9) - (statusWeight[b.status] ?? 9) || Number(b.calculated_amount || 0) - Number(a.calculated_amount || 0);
  });
}

async function generatePenaltyRegister() {
  if (!canApprovePenalties) return alert("You do not have permission to generate penalty records.");
  const liveRows = calculatePenaltyRegisterRows();
  if (!liveRows.length) return alert("No calculated penalties found based on the active agreements.");

  let inserted = 0;
  let updated = 0;
  for (const [index, row] of liveRows.entries()) {
    const existing = agencyPenalties.find((item) =>
      String(item.candidate_id || "") === String(row.candidate_id || "") &&
      String(item.agreement_no || "") === String(row.agreement_no || "")
    );

    const payload = {
      ...row,
      penalty_no: existing?.penalty_no || generatePenaltyNo(index),
      candidate_id: String(row.candidate_id || ""),
      status: existing?.status || "Pending Review",
      approved_amount: existing?.approved_amount ?? null,
      decision_notes: existing?.decision_notes || "",
      updated_at: new Date().toISOString(),
    };
    delete payload.source;

    if (existing?.id) {
      if (["Approved", "Reduced", "Waived"].includes(existing.status)) continue;
      const { error } = await supabase
        .from("agency_penalties")
        .update(payload)
        .eq("id", existing.id)
        .eq("company_id", currentCompanyId);
      if (error) return alert(error.message);
      updated += 1;
    } else {
      const { error } = await supabase.from("agency_penalties").insert([withCompany({ ...payload, created_at: new Date().toISOString() })]);
      if (error) return alert(error.message);
      inserted += 1;
    }
  }

  await loadAgencyPenalties();
  alert(`Penalty register updated. Inserted: ${inserted}, Updated: ${updated}`);
}

async function sendPenaltyToAgency(item, amountOverride = null, noteOverride = "") {
  if (!canApprovePenalties) return alert("You do not have permission to send penalties to agency.");
  if (!item?.id) return alert("Please generate the penalty register first.");
  const amount = amountOverride === null ? Number(item.approved_amount ?? item.calculated_amount ?? 0) : Number(amountOverride || 0);
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("agency_penalties")
    .update({
      status: "Sent to Agency",
      approved_amount: amount,
      decision_notes: noteOverride || item.decision_notes || "Penalty issued to agency for justification window.",
      decision_by: currentUser?.name || currentUser?.email || "Company User",
      decision_role: currentRole,
      decision_at: now,
      sent_to_agency_at: now,
      updated_at: now,
    })
    .eq("id", item.id)
    .eq("company_id", currentCompanyId);
  if (error) return alert(error.message);
  try {
    await sendPenaltyNoticeEmail({
      ...item,
      status: "Sent to Agency",
      approved_amount: amount,
      decision_notes: noteOverride || item.decision_notes || "Penalty issued to agency for justification window.",
    });
  } catch (emailError) {
    console.warn("Penalty notice email failed", emailError?.message || emailError);
  }
  await loadAgencyPenalties();
}

async function reduceAndSendPenalty(item) {
  const currentAmount = Number(item.approved_amount ?? item.calculated_amount ?? 0);
  const newAmountText = window.prompt("Enter reduced penalty amount SAR", String(currentAmount));
  if (newAmountText === null) return;
  const newAmount = Number(newAmountText);
  if (!Number.isFinite(newAmount) || newAmount < 0) return alert("Invalid amount.");
  const note = window.prompt("Reason for reduction", item.decision_notes || "") || "Reduced by management before sending to agency.";
  await sendPenaltyToAgency(item, newAmount, note);
}

async function waivePenalty(item, defaultNote = "") {
  if (!canApprovePenalties) return alert("You do not have permission to waive penalties.");
  if (!item?.id) return alert("Please generate the penalty register first.");
  const note = window.prompt("Reason for waiving this penalty", defaultNote || item.decision_notes || "") || defaultNote || "Waived by management.";
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("agency_penalties")
    .update({
      status: "Waived",
      approved_amount: 0,
      decision_notes: note,
      final_decision: "Waived",
      final_decision_by: currentUser?.name || currentUser?.email || "Company User",
      final_decision_role: currentRole,
      final_decision_at: now,
      updated_at: now,
    })
    .eq("id", item.id)
    .eq("company_id", currentCompanyId);
  if (error) return alert(error.message);
  try {
    await sendPenaltyDecisionEmail(item, "Waived", 0, note);
  } catch (emailError) {
    console.warn("Penalty decision email failed", emailError?.message || emailError);
  }
  await loadAgencyPenalties();
}

async function submitPenaltyJustification(item) {
  if (currentRole !== "Agency") return alert("Only agency users can submit justifications.");
  if (!item?.id) return;
  const justification = window.prompt("Write the agency justification / اكتب مبررات المكتب", item.agency_justification || "");
  if (!justification) return;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("agency_penalties")
    .update({
      status: "Justification Submitted",
      agency_justification: justification,
      agency_justification_by: currentUser?.name || currentUser?.email || "Agency User",
      agency_justification_email: currentUser?.email || "",
      agency_justification_at: now,
      updated_at: now,
    })
    .eq("id", item.id);
  if (error) return alert(error.message);
  try {
    await sendPenaltyJustificationEmail(item, justification);
  } catch (emailError) {
    console.warn("Penalty justification email failed", emailError?.message || emailError);
  }
  await loadAgencyPenalties();
  alert("Justification submitted to company for review.");
}

async function approveFinalPenalty(item, defaultNote = "") {
  if (!canApprovePenalties) return alert("You do not have permission to approve penalties.");
  if (!item?.id) return alert("Please generate the penalty register first.");
  const note = window.prompt("Final approval / rejection note", defaultNote || item.decision_notes || "") || defaultNote || "Penalty approved by management.";
  const now = new Date().toISOString();
  const finalAmount = Number(item.approved_amount ?? item.calculated_amount ?? 0);
  const { error } = await supabase
    .from("agency_penalties")
    .update({
      status: "Approved",
      approved_amount: finalAmount,
      decision_notes: note,
      final_decision: "Approved",
      final_decision_by: currentUser?.name || currentUser?.email || "Company User",
      final_decision_role: currentRole,
      final_decision_at: now,
      updated_at: now,
    })
    .eq("id", item.id)
    .eq("company_id", currentCompanyId);
  if (error) return alert(error.message);
  try {
    await sendPenaltyDecisionEmail(item, "Approved", finalAmount, note);
  } catch (emailError) {
    console.warn("Penalty approval email failed", emailError?.message || emailError);
  }
  await loadAgencyPenalties();
}

async function reduceFinalPenalty(item) {
  if (!canApprovePenalties) return alert("You do not have permission to reduce penalties.");
  if (!item?.id) return alert("Please generate the penalty register first.");
  const currentAmount = Number(item.approved_amount ?? item.calculated_amount ?? 0);
  const newAmountText = window.prompt("Enter final reduced penalty amount SAR", String(currentAmount));
  if (newAmountText === null) return;
  const newAmount = Number(newAmountText);
  if (!Number.isFinite(newAmount) || newAmount < 0) return alert("Invalid amount.");
  const note = window.prompt("Reason for final reduction", item.decision_notes || "") || "Reduced by management after review.";
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("agency_penalties")
    .update({
      status: "Reduced",
      approved_amount: newAmount,
      decision_notes: note,
      final_decision: "Reduced",
      final_decision_by: currentUser?.name || currentUser?.email || "Company User",
      final_decision_role: currentRole,
      final_decision_at: now,
      updated_at: now,
    })
    .eq("id", item.id)
    .eq("company_id", currentCompanyId);
  if (error) return alert(error.message);
  try {
    await sendPenaltyDecisionEmail(item, "Reduced", newAmount, note);
  } catch (emailError) {
    console.warn("Penalty reduction email failed", emailError?.message || emailError);
  }
  await loadAgencyPenalties();
}

async function deletePenaltyRecord(item) {
  if (!canApprovePenalties) return alert("You do not have permission to delete penalty records.");
  if (!item?.id || !window.confirm("Delete this penalty record?")) return;
  const { error } = await supabase
    .from("agency_penalties")
    .delete()
    .eq("id", item.id)
    .eq("company_id", currentCompanyId);
  if (error) return alert(error.message);
  await loadAgencyPenalties();
}

function getCandidateSlaStagnation(candidate) {
  const policy = getAgencyAgreementPolicy(candidate?.agency || "");
  const updateFrequencyDays = Number(policy.update_frequency_days || 7);
  const finalStatuses = [
    "Joined",
    "Rejected",
    "Interview Failed",
    "Medical Failed",
    "Cancelled",
    "KSA Medical Failed",
    "Refused to Work",
    "Absconded",
  ];

  const trackedStatuses = [
    "Candidate Submitted",
    "Interview Scheduled",
    "Interview Passed",
    "Selected",
    "Medical Scheduled",
    "Medical Passed",
    "Embassy Submitted",
    "Embassy Delayed",
    "Visa Stamped",
    "Ticket Booked",
    "Departure",
    "Arrived KSA",
    "Arrived",
  ];

  const status = candidate?.status || "New";
  const lastUpdate = candidate?.updated_at || candidate?.medical_date || candidate?.flight_date || candidate?.arrival_date || candidate?.created_at;

  if (!lastUpdate || finalStatuses.includes(status)) {
    return { days: 0, isStale: false, risk: "Low", lastUpdate: lastUpdate || "", stage: status, update_frequency_days: updateFrequencyDays, agreement_no: policy.agreement_no };
  }

  const days = Math.floor((new Date() - new Date(lastUpdate)) / (1000 * 60 * 60 * 24));
  const isTracked = trackedStatuses.includes(status) || Boolean(candidate?.agency);
  const isStale = isTracked && days > updateFrequencyDays;
  const risk = days >= updateFrequencyDays * 2 ? "High" : days > updateFrequencyDays ? "Medium" : "Low";

  return {
    days: Number.isFinite(days) ? days : 0,
    isStale,
    risk,
    lastUpdate,
    stage: status,
    update_frequency_days: updateFrequencyDays,
    agreement_no: policy.agreement_no,
  };
}
function getAgencySlaEscalationAlerts() {
  return candidates
    .map((candidate) => {
      const stagnation = getCandidateSlaStagnation(candidate);
      if (!stagnation.isStale) return null;

      const request = requests.find((item) => String(item.request_no || "") === String(candidate.request_no || ""));
      const agencyName = candidate.agency || "Unassigned Agency";

      return {
        candidate_id: candidate.id,
        candidate_name: candidate.candidate_name || "-",
        agency: agencyName,
        request_no: candidate.request_no || "-",
        project: candidate.project || request?.project_name || request?.project || "-",
        profession: candidate.profession || request?.profession || "-",
        status: stagnation.stage,
        days_without_update: stagnation.days,
        last_update: stagnation.lastUpdate,
        risk: stagnation.risk,
        agreement_no: stagnation.agreement_no,
        update_frequency_days: stagnation.update_frequency_days,
        kpi_deduction: Math.min(Math.max(stagnation.days - Number(stagnation.update_frequency_days || 7), 1) * 2, 15),
        recommendation:
          stagnation.risk === "High"
            ? `Escalate immediately. This exceeds the agreement update frequency (${stagnation.update_frequency_days} day(s)). Hold new allocation until update is received.`
            : `Send follow-up to agency. Agreement requires update every ${stagnation.update_frequency_days} day(s).`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.days_without_update || 0) - Number(a.days_without_update || 0));
}

async function generateSlaEscalationNotifications() {
  const alerts = getAgencySlaEscalationAlerts();
  if (!alerts.length) return alert("No update compliance alerts. All agency updates are within the configured update frequency rule.");

  const payload = alerts.slice(0, 50).map((item) => {
    const agency = agencies.find((a) => normalize(a.name) === normalize(item.agency));
    return {
      company_id: currentCompanyId,
      agency_id: agency?.id || null,
      type: "UPDATE_COMPLIANCE_ALERT",
      title: "Update Compliance Alert",
      message: `${item.candidate_name} has no update for ${item.days_without_update} day(s).`,
      priority: item.risk === "High" ? "High" : "Medium",
      status: "Unread",
      related_table: "candidates",
      related_id: String(item.candidate_id || ""),
      data: {
        source: "Agency Performance Engine",
        ...item,
      },
      created_at: new Date().toISOString(),
    };
  });

  const { error } = await supabase.from("notification_events").insert(payload);
  if (error) return alert(error.message);

  alert(`Update compliance alerts generated: ${payload.length}`);
}

function calculateAgencyPerformanceRows() {
  const agencyNames = Array.from(
    new Set([
      ...agencies.map((agency) => agency.name).filter(Boolean),
      ...candidates.map((candidate) => candidate.agency).filter(Boolean),
      ...visaAuthorizations.map((authorization) => authorization.agency).filter(Boolean),
    ])
  );

  const today = new Date();

  return agencyNames
    .map((agencyName) => {
      const agency = agencies.find((item) => normalize(item.name) === normalize(agencyName));
      const agreementPolicy = getAgencyAgreementPolicy(agencyName);
      const activeAgreement = agreementPolicy.agreement;
      const agencyCandidates = candidates.filter((candidate) => normalize(candidate.agency) === normalize(agencyName));
      const agencyInterviews = interviews.filter((interview) => normalize(interview.agency) === normalize(agencyName));
      const agencyAuthorizations = visaAuthorizations.filter((authorization) => normalize(authorization.agency) === normalize(agencyName));
      const activeAuthorizations = agencyAuthorizations.filter((authorization) => authorization.status !== "Cancelled");
      const signedAgreement = Boolean(activeAgreement);

      const totalInterviewed = agencyInterviews.length;
      const passedInterviews = agencyInterviews.filter((interview) => interview.status === "Passed").length;
      const rejectedInterviews = agencyInterviews.filter((interview) => ["Rejected", "Interview Failed"].includes(interview.status)).length;
      const arrived = agencyCandidates.filter((candidate) => ["Arrived KSA", "Arrived", "Joined"].includes(candidate.status)).length;
      const joined = agencyCandidates.filter((candidate) => candidate.status === "Joined").length;
      const failed = agencyCandidates.filter((candidate) => ["Rejected", "Interview Failed", "Medical Failed", "Cancelled", "KSA Medical Failed", "Refused to Work", "Absconded"].includes(candidate.status)).length;

      const authorizedQty = activeAuthorizations.reduce((sum, authorization) => sum + Number(authorization.allocated_qty || 0), 0);
      const submitted = agencyCandidates.length;
      const submittedPercent = authorizedQty ? Math.min(Math.round((submitted / authorizedQty) * 100), 100) : submitted ? 100 : 0;

      const qualityScore = totalInterviewed ? Math.round((passedInterviews / totalInterviewed) * 100) : submitted ? 70 : 0;
      const mobilizationScore = passedInterviews ? Math.round((joined / passedInterviews) * 100) : arrived ? 70 : 0;
      const rejectionScore = submitted ? Math.max(0, 100 - Math.round((failed / submitted) * 100)) : 0;
      const responseScore = submittedPercent;

      const staleCandidates = agencyCandidates.filter((candidate) => getCandidateSlaStagnation(candidate).isStale);
      const staleUpdateDeduction = Math.min(staleCandidates.length * 5, 30);

      const recentUpdates = agencyCandidates.filter((candidate) => {
        const updated = candidate.updated_at || candidate.created_at;
        if (!updated) return false;
        const days = Math.floor((today - new Date(updated)) / (1000 * 60 * 60 * 24));
        return days <= Number(agreementPolicy.update_frequency_days || 7);
      }).length;
      const rawUpdateScore = submitted ? Math.round((recentUpdates / submitted) * 100) : 0;
      const updateScore = Math.max(0, rawUpdateScore - staleUpdateDeduction);

      const candidateSlaRows = agencyCandidates.map((candidate) => getCandidateSlaDelay(candidate, agencyName));
      const delayedRows = candidateSlaRows.filter((row) => row.isDelayed);
      const delayedCandidates = delayedRows.length;
      const averageDelayDays = delayedRows.length
        ? Math.round((delayedRows.reduce((sum, row) => sum + Number(row.delayDays || 0), 0) / delayedRows.length) * 10) / 10
        : 0;
      const penaltyExposure = delayedRows.reduce((sum, row) => sum + Number(row.penaltyExposure || 0), 0);

      const baseSlaScore = agencyCandidates.length
        ? Math.round(((agencyCandidates.length - delayedCandidates) / agencyCandidates.length) * 100)
        : 0;
      const slaDelayPenalty = Math.min(delayedCandidates * 5, 35);
      const slaScore = Math.max(0, baseSlaScore - slaDelayPenalty);

      const agreementScore = signedAgreement ? 100 : 0;

      const totalScore = Math.round(
        slaScore * 0.30 +
        responseScore * 0.10 +
        qualityScore * 0.20 +
        rejectionScore * 0.10 +
        mobilizationScore * 0.15 +
        updateScore * 0.10 +
        agreementScore * 0.05
      );

      const rank = getAgencyRank(totalScore);
      let recommendation = "Keep monitoring and maintain current allocation level.";
      if (!signedAgreement) recommendation = "No active agreement found. Use default SLA 60 days until the agreement is activated.";
      else if (delayedCandidates > 0 && penaltyExposure > 0) recommendation = `${delayedCandidates} candidate(s) exceeded the agreed SLA (${agreementPolicy.sla_days} day(s)). Potential labor SLA delay penalty exposure: ${Number(penaltyExposure || 0).toLocaleString()} SAR.`;
      else if (staleCandidates.length > 0) recommendation = `${staleCandidates.length} candidate update compliance issue(s). Agreement requires update every ${agreementPolicy.update_frequency_days} day(s). Escalate before new allocation.`;
      else if (rank === "Platinum") recommendation = "Preferred agency. Increase allocations for matching professions and countries.";
      else if (rank === "Gold") recommendation = "Strong agency. Continue allocations with normal follow-up.";
      else if (rank === "Silver") recommendation = "Acceptable agency. Follow up on weak indicators before increasing volume.";
      else recommendation = "Under review. Hold new allocations until performance improves.";

      return {
        agency_id: agency?.id || null,
        agency_name: agencyName,
        agreement_no: agreementPolicy.agreement_no,
        has_active_agreement: signedAgreement,
        agreement_sla_days: agreementPolicy.sla_days,
        update_frequency_days: agreementPolicy.update_frequency_days,
        delay_penalty_type: agreementPolicy.delay_penalty_type,
        delay_penalty_amount: agreementPolicy.delay_penalty_amount,
        delay_penalty_after_days: agreementPolicy.delay_penalty_after_days,
        financial_guarantee_required: agreementPolicy.financial_guarantee_required,
        financial_guarantee_amount: agreementPolicy.financial_guarantee_amount,
        authorizedQty,
        submittedPercent,
        candidates: submitted,
        passedInterviews,
        rejectedInterviews,
        arrived,
        joined,
        failed,
        delayed_candidates: delayedCandidates,
        average_delay_days: averageDelayDays,
        penalty_exposure: penaltyExposure,
        stale_candidates: staleCandidates.length,
        stale_penalty: staleUpdateDeduction,
        sla_score: slaScore,
        response_score: responseScore,
        quality_score: qualityScore,
        rejection_score: rejectionScore,
        mobilization_score: mobilizationScore,
        update_score: updateScore,
        agreement_score: agreementScore,
        total_score: totalScore,
        rank,
        recommendation,
      };
    })
    .sort((a, b) => Number(b.total_score || 0) - Number(a.total_score || 0));
}
async function saveAgencyPerformanceSnapshot() {
  if (!canManageAgencyAgreements) return alert("You do not have permission to calculate agency performance.");

  const rows = calculateAgencyPerformanceRows().filter((row) => row.agency_id);
  if (!rows.length) return alert("No agency performance data to save.");

  const historyPayload = rows.map((row) => ({
    company_id: currentCompanyId,
    agency_id: row.agency_id,
    sla_score: row.sla_score,
    quality_score: row.quality_score,
    response_score: row.response_score,
    mobilization_score: row.mobilization_score,
    update_score: row.update_score,
    agreement_score: row.agreement_score,
    agreement_sla_days: row.agreement_sla_days,
    update_frequency_days: row.update_frequency_days,
    delayed_candidates: row.delayed_candidates,
    average_delay_days: row.average_delay_days,
    penalty_exposure: row.penalty_exposure,
    agreement_no: row.agreement_no,
    total_score: row.total_score,
    rank: row.rank,
  }));

  const { error: historyError } = await supabase.from("agency_score_history").insert(historyPayload);
  if (historyError) return alert(historyError.message);

  for (const row of rows) {
    const existing = agencyScores.find((score) => normalize(score.agency_name) === normalize(row.agency_name));
    const payload = {
      company_id: currentCompanyId,
      agency_name: row.agency_name,
      sla_score: row.sla_score,
      update_score: row.update_score,
      quality_score: row.quality_score,
      arrival_score: row.mobilization_score,
      agreement_sla_days: row.agreement_sla_days,
      update_frequency_days: row.update_frequency_days,
      delayed_candidates: row.delayed_candidates,
      average_delay_days: row.average_delay_days,
      penalty_exposure: row.penalty_exposure,
      agreement_no: row.agreement_no,
      total_score: row.total_score,
      updated_at: new Date().toISOString(),
    };

    if (existing?.id) {
      await supabase.from("agency_scores").update(payload).eq("id", existing.id).eq("company_id", currentCompanyId);
    } else {
      await supabase.from("agency_scores").insert([payload]);
    }
  }

  await loadAgencyScores();
  await loadAgencyScoreHistory();
  alert(`Agency performance calculated and saved for ${rows.length} agency/agencies.`);
}

function candidateMatchesRequestLine(candidate, line) {
  if (!candidate || !line) return false;

  // Primary accurate link: candidate belongs to the exact request line.
  if (candidate.request_line_id && line.id) {
    return String(candidate.request_line_id) === String(line.id);
  }

  // Backward-compatible fallback for old records before request_line_id existed.
  return (
    isCompatibleText(candidate.profession, line.profession) &&
    normalize(candidate.nationality) === normalize(line.nationality) &&
    (!line.gender || !candidate.gender || normalize(candidate.gender) === normalize(line.gender))
  );
}

function authorizationMatchesRequestLine(authorization, line, relatedAllocations = []) {
  if (!authorization || !line) return false;

  if (
    authorization.visa_allocation_id &&
    relatedAllocations.some((allocation) => String(allocation.id || "") === String(authorization.visa_allocation_id || ""))
  ) {
    return true;
  }

  if (
    authorization.visa_batch_line_id &&
    relatedAllocations.some((allocation) => String(allocation.visa_batch_line_id || "") === String(authorization.visa_batch_line_id || ""))
  ) {
    return true;
  }

  return (
    isCompatibleText(authorization.profession, line.profession) &&
    normalize(authorization.nationality) === normalize(line.nationality) &&
    (!line.gender || !authorization.gender || normalize(authorization.gender) === normalize(line.gender))
  );
}

function buildOperationalRequestLineRows() {
  const countPercent = (value, total) =>
    total ? Math.min(Math.round((Number(value || 0) / Number(total || 0)) * 100), 100) : 0;

  const blockedCandidateStatuses = [
    "Rejected",
    "Interview Failed",
    "Medical Failed",
    "Medical Fail",
    "Cancelled",
  ];

  return requests.flatMap((request) => {
    const requestNo = request.request_no || "-";
    const lines = getRequestLinesForRequest(request);
    const saudiRequest = isSaudiRequest(request);

    return lines.map((line, index) => {
      const requestedQty = Number(line.quantity || 0);
      const lineKey = `${requestNo}-L${line.line_no || index + 1}`;
      const isSaudiLine = saudiRequest || isSaudiNationality(line.nationality);

      const matchingVisaLines = isSaudiLine
        ? []
        : visaInventoryLines.filter((visaLine) => isCompatibleVisaLineForRequestLine(line, visaLine));

      const availableVisaQty = matchingVisaLines.reduce(
        (sum, visaLine) => sum + Math.max(getVisaLineRemainingQty(visaLine), 0),
        0
      );

      const relatedAllocations = visaAllocations.filter((allocation) => {
        if (String(allocation.request_no || "") !== String(requestNo || "")) return false;
        const allocationVisaLine = visaInventoryLines.find(
          (visaLine) => String(visaLine.id || "") === String(allocation.visa_batch_line_id || "")
        );

        if (allocationVisaLine) return isCompatibleVisaLineForRequestLine(line, allocationVisaLine);

        return matchingVisaLines.some((visaLine) => String(visaLine.visa_no || "") === String(allocation.visa_no || ""));
      });

      const allocatedVisaQty = isSaudiLine
        ? 0
        : relatedAllocations.reduce((sum, allocation) => sum + Number(allocation.allocated_qty || 0), 0);

      const relatedAuthorizations = isSaudiLine
        ? []
        : visaAuthorizations.filter(
            (authorization) =>
              authorization.status !== "Cancelled" &&
              String(authorization.request_no || "") === String(requestNo || "") &&
              authorizationMatchesRequestLine(authorization, line, relatedAllocations)
          );

      const authorizedQty = relatedAuthorizations.reduce(
        (sum, authorization) => sum + Number(authorization.allocated_qty || 0),
        0
      );

      const allLineCandidates = candidates.filter(
        (candidate) =>
          String(candidate.request_no || "") === String(requestNo || "") &&
          candidateMatchesRequestLine(candidate, line)
      );

      const activeLineCandidates = allLineCandidates.filter(
        (candidate) => !blockedCandidateStatuses.includes(candidate.status)
      );

      const relatedInterviews = interviews.filter((interview) =>
        allLineCandidates.some(
          (candidate) =>
            String(interview.candidate_id || "") === String(candidate.id || "") ||
            String(interview.passport_no || "") === String(candidate.passport_no || "") ||
            normalize(interview.candidate_name) === normalize(candidate.candidate_name)
        )
      );

      const interviewRequired = line.interview_required || request.interview_required || "Required";
      const interviewType = line.interview_type || request.interview_type || "Online";

      const interviewPassed =
        interviewRequired === "No Interview"
          ? activeLineCandidates.length
          : relatedInterviews.filter((interview) => interview.status === "Passed").length;

      const medicalDone = activeLineCandidates.filter(
        (candidate) =>
          ["Passed", "Fit", "Medical Passed"].includes(candidate.medical_status) ||
          ["Medical Passed", "Visa Stamped", "Ticket Booked", "Departure", "Arrived KSA", "Arrived", "Joined"].includes(candidate.status) ||
          Boolean(candidate.medical_date)
      ).length;

      const visaReady = isSaudiLine
        ? requestedQty
        : activeLineCandidates.filter((candidate) =>
            ["Visa Stamped", "Embassy Submitted", "Embassy Delayed", "Ticket Booked", "Departure", "Arrived KSA", "Arrived", "Joined"].includes(candidate.status)
          ).length;

      const ticketIssued = activeLineCandidates.filter(
        (candidate) => Boolean(candidate.ticket_no) || candidate.status === "Ticket Booked"
      ).length;

      const arrived = activeLineCandidates.filter(
        (candidate) =>
          Boolean(candidate.arrival_date) ||
          candidate.status === "Arrived KSA" ||
          candidate.status === "Arrived" ||
          candidate.status === "Joined"
      ).length;

      const joined = activeLineCandidates.filter(
        (candidate) => candidate.status === "Joined" || candidate.joining_date
      ).length;

      const candidatesCount = activeLineCandidates.length;
      // Counted coverage is capped by the requested quantity for this exact request line.
      // Extra matching submissions remain visible as backup candidates but must not inflate progress above demand.
      const coveredCandidates = Math.min(candidatesCount, requestedQty);
      const extraCandidates = Math.max(candidatesCount - requestedQty, 0);
      const rejectedCandidates = allLineCandidates.length - activeLineCandidates.length;
      const candidateGap = Math.max(requestedQty - coveredCandidates, 0);
      const visaGap = isSaudiLine ? 0 : Math.max(requestedQty - allocatedVisaQty, 0);
      const authorizationGap = isSaudiLine ? 0 : Math.max(allocatedVisaQty - authorizedQty, 0);
      const joiningGap = Math.max(requestedQty - joined, 0);

      const progressSteps = isSaudiLine
        ? [
            countPercent(candidatesCount, requestedQty),
            interviewRequired === "No Interview" ? 100 : countPercent(interviewPassed, requestedQty),
            countPercent(joined, requestedQty),
          ]
        : [
            countPercent(allocatedVisaQty, requestedQty),
            countPercent(authorizedQty, requestedQty),
            countPercent(candidatesCount, requestedQty),
            interviewRequired === "No Interview" ? 100 : countPercent(interviewPassed, requestedQty),
            countPercent(medicalDone, requestedQty),
            countPercent(visaReady, requestedQty),
            countPercent(ticketIssued, requestedQty),
            countPercent(arrived, requestedQty),
            countPercent(joined, requestedQty),
          ];

      const progress = requestedQty
        ? Math.round(progressSteps.reduce((sum, value) => sum + value, 0) / progressSteps.length)
        : 0;

      let bottleneck = "Monitoring";
      if (!isSaudiLine && visaGap > 0) bottleneck = "Visa Allocation";
      else if (!isSaudiLine && authorizationGap > 0) bottleneck = "Authorization";
      else if (candidateGap > 0) bottleneck = "Sourcing / Agency Submission";
      else if (interviewRequired !== "No Interview" && interviewPassed < requestedQty) bottleneck = "Interview";
      else if (!isSaudiLine && medicalDone < requestedQty) bottleneck = "Medical";
      else if (!isSaudiLine && visaReady < requestedQty) bottleneck = "Embassy / Visa Stamping";
      else if (!isSaudiLine && ticketIssued < requestedQty) bottleneck = "Ticketing";
      else if (joiningGap > 0) bottleneck = "Arrival / Joining";
      else bottleneck = "Completed";

      const riskPoints =
        (progress < 30 ? 35 : progress < 60 ? 20 : 0) +
        (visaGap > 0 ? 20 : 0) +
        (authorizationGap > 0 ? 15 : 0) +
        (candidateGap > 0 ? 15 : 0) +
        (joiningGap > 0 ? 10 : 0) +
        (request.status === "Cancelled" ? 30 : 0);

      const riskScore = Math.min(100, riskPoints);
      const riskLevel = riskScore >= 60 ? "High" : riskScore >= 30 ? "Medium" : "Low";

      let recommendation = "Keep monitoring until joining is completed.";
      if (bottleneck === "Visa Allocation") recommendation = "Allocate matching visa line for this exact profession / nationality / gender.";
      else if (bottleneck === "Authorization") recommendation = "Issue authorization for the allocated visa line and assign the responsible agency.";
      else if (bottleneck === "Sourcing / Agency Submission") recommendation = "Push the assigned agency to submit candidates against this line only.";
      else if (bottleneck === "Interview") recommendation = "Schedule or complete interviews for this request line.";
      else if (bottleneck === "Medical") recommendation = "Accelerate medical stage for passed candidates.";
      else if (bottleneck === "Embassy / Visa Stamping") recommendation = "Follow embassy / visa stamping stage for ready candidates.";
      else if (bottleneck === "Ticketing") recommendation = "Finalize ticketing for ready candidates.";
      else if (bottleneck === "Arrival / Joining") recommendation = "Follow arrival, onboarding and joining confirmation.";
      else if (bottleneck === "Completed") recommendation = "Line completed. No immediate action required.";

      const agenciesForLine = Array.from(
        new Set([
          ...relatedAuthorizations.map((authorization) => authorization.agency).filter(Boolean),
          ...activeLineCandidates.map((candidate) => candidate.agency).filter(Boolean),
        ])
      );

      return {
        line_key: lineKey,
        request_no: requestNo,
        request_id: request.id || null,
        request_line_id: line.id || null,
        line_no: line.line_no || index + 1,
        project: request.project_name || request.project || "-",
        profession: line.profession || "-",
        nationality: line.nationality || "-",
        gender: line.gender || "-",
        requested_qty: requestedQty,
        isSaudi: isSaudiLine,
        matching_available_visa_qty: availableVisaQty,
        allocatedVisaQty,
        authorizedQty,
        candidates: candidatesCount,
        coveredCandidates,
        extraCandidates,
        rejectedCandidates,
        interviewRequired,
        interviewType,
        interviewPassed,
        medicalDone,
        visaReady,
        ticketIssued,
        arrived,
        joined,
        visaGap,
        authorizationGap,
        candidateGap,
        joiningGap,
        progress,
        bottleneck,
        riskScore,
        riskLevel,
        agencies: agenciesForLine.join(", ") || "-",
        status: request.status || "-",
        approval_status: request.approval_status || "-",
        recommendation,
      };
    });
  });
}

function buildRequestHealthRows() {
  return buildOperationalRequestLineRows().sort((a, b) => b.riskScore - a.riskScore);
}


function buildRecruitmentForecast() {
  const openLines = buildRequestHealthRows().filter((row) => !["Completed", "Closed", "Cancelled"].includes(row.status));
  const totalRemainingRecruitment = openLines.reduce((sum, row) => sum + Number(row.candidateGap || 0), 0);
  const totalRemainingJoining = openLines.reduce((sum, row) => sum + Number(row.joiningGap || 0), 0);
  const arrivingNext30 = executiveDashboard.arrivalsNext30Days.length;
  const avgProgress = openLines.length
    ? Math.round(openLines.reduce((sum, row) => sum + Number(row.progress || 0), 0) / openLines.length)
    : 0;
  const highRiskRequests = openLines.filter((row) => row.riskLevel === "High").length;

  let forecastMessage = "Pipeline is stable if current request-line pace continues.";
  if (highRiskRequests > 0) forecastMessage = "High-risk request lines may affect project mobilization unless escalated.";
  else if (totalRemainingRecruitment > 0) forecastMessage = "Recruitment still requires active sourcing by request line.";
  else if (totalRemainingJoining > 0) forecastMessage = "Main focus should shift from recruitment to joining and site onboarding.";

  return {
    open_request_lines: openLines.length,
    totalRemainingRecruitment,
    totalRemainingJoining,
    arrivingNext30,
    avgProgress,
    highRiskRequests,
    forecastMessage,
  };
}


function getActivityChangedFields(item) {
  const value = item?.changed_fields;
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function getActivityFieldLabel(field) {
  const labels = {
    request_no: "Request No",
    request_type: "Request Type",
    project_name: "Project",
    profession: "Profession",
    nationality: "Nationality",
    gender: "Gender",
    quantity: "Quantity",
    salary: "Salary",
    status: "Status",
    approval_status: "Approval Status",
    request_status: "Request Status",
    priority: "Priority",
    agency: "Agency",
    authorization_no: "Authorization No",
    allocated_qty: "Allocated Qty",
    candidate_name: "Candidate",
    passport_no: "Passport No",
    medical_status: "Medical Status",
    ticket_no: "Ticket No",
    flight_date: "Flight Date",
    arrival_date: "Arrival Date",
    joining_date: "Joining Date",
    notes: "Notes",
  };

  return labels[field] || String(field || "").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatActivityValue(value) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  const text = String(value);
  return text.trim() === "" ? "-" : text;
}

function formatActivityDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-GB");
}

function formatActivitySummary(item) {
  const moduleName = item?.module_name || "Activity";
  const label = item?.record_label || item?.request_no || item?.record_id || "-";
  const action = item?.action_type || "-";
  const changes = getActivityChangedFields(item);

  if (action === "Updated" && changes.length > 0) {
    const visibleChanges = changes
      .filter((change) => change?.field && !["updated_at"].includes(change.field))
      .slice(0, 3)
      .map((change) => `${getActivityFieldLabel(change.field)} changed from ${formatActivityValue(change.old)} to ${formatActivityValue(change.new)}`);

    if (visibleChanges.length > 0) {
      return `${moduleName}: ${label} — ${visibleChanges.join(" | ")}`;
    }
  }

  if (action === "Created") return `${moduleName}: ${label} was created.`;
  if (action === "Deleted") return `${moduleName}: ${label} was deleted.`;

  return `${moduleName}: ${label} — ${action}`;
}

function formatActivityChangedFieldsText(item) {
  const changes = getActivityChangedFields(item);
  if (!changes.length) return "-";
  return changes
    .filter((change) => change?.field && !["updated_at"].includes(change.field))
    .map((change) => `${getActivityFieldLabel(change.field)}: ${formatActivityValue(change.old)} → ${formatActivityValue(change.new)}`)
    .join(" | ") || "-";
}

function getReportStudioRecentActivityLogs(requestHealthRows = []) {
  const selectedProject = String(reportStudioForm.project || "All");
  const requestNos = new Set(
    requestHealthRows
      .filter((row) => selectedProject === "All" || String(row.project || "") === selectedProject)
      .map((row) => String(row.request_no || ""))
      .filter(Boolean)
  );

  return systemActivityLogs
    .filter((item) => {
      if (selectedProject === "All") return true;
      if (!item.request_no) return false;
      return requestNos.has(String(item.request_no || ""));
    })
    .slice(0, 12)
    .map((item) => ({
      date: formatActivityDate(item.created_at),
      module: item.module_name || "-",
      action: item.action_type || "-",
      reference: item.record_label || item.request_no || "-",
      request_no: item.request_no || "-",
      summary: formatActivitySummary(item),
      changes: formatActivityChangedFieldsText(item),
      changed_by: item.changed_by_name || "-",
    }));
}


function buildOperationalLineBriefText() {
  const lines = buildOperationalRequestLineRows();
  const totals = lines.reduce((acc, line) => {
    acc.required += Number(line.requested_qty || 0);
    acc.allocated += Number(line.allocatedVisaQty || 0);
    acc.authorized += Number(line.authorizedQty || 0);
    acc.candidates += Number(line.candidates || 0);
    acc.joined += Number(line.joined || 0);
    acc.visaGap += Number(line.visaGap || 0);
    acc.authorizationGap += Number(line.authorizationGap || 0);
    acc.candidateGap += Number(line.candidateGap || 0);
    acc.joiningGap += Number(line.joiningGap || 0);
    return acc;
  }, { required: 0, allocated: 0, authorized: 0, candidates: 0, joined: 0, visaGap: 0, authorizationGap: 0, candidateGap: 0, joiningGap: 0 });

  const grouped = lines.reduce((acc, line) => {
    const key = line.request_no || "-";
    if (!acc[key]) acc[key] = [];
    acc[key].push(line);
    return acc;
  }, {});

  const sections = Object.entries(grouped).map(([requestNo, requestLines]) => {
    const requestTitle = `Request ${requestNo}`;
    const lineRows = requestLines
      .sort((a, b) => Number(a.line_no || 0) - Number(b.line_no || 0))
      .map((line) =>
        [
          `Line ${line.line_no}`,
          `Project: ${line.project}`,
          `Profession: ${line.profession}`,
          `Nationality: ${line.nationality}`,
          `Gender: ${line.gender}`,
          `Required: ${line.requested_qty}`,
          `Allocated Visas: ${line.allocatedVisaQty}`,
          `Authorized: ${line.authorizedQty}`,
          `Candidates: ${line.candidates}`,
          `Interview Passed: ${line.interviewPassed}`,
          `Medical: ${line.medicalDone}`,
          `Visa Ready: ${line.visaReady}`,
          `Ticketed: ${line.ticketIssued}`,
          `Arrived: ${line.arrived}`,
          `Joined: ${line.joined}`,
          `Candidate Gap: ${line.candidateGap}`,
          `Visa Gap: ${line.visaGap}`,
          `Authorization Gap: ${line.authorizationGap}`,
          `Joining Gap: ${line.joiningGap}`,
          `Progress: ${line.progress}%`,
          `Risk: ${line.riskLevel}`,
          `Bottleneck: ${line.bottleneck}`,
          `Agencies: ${line.agencies}`,
        ].join(" | ")
      )
      .join("\n");

    return `${requestTitle}\n${lineRows}`;
  });

  return [
    "AUTHORITATIVE VisaFlow Request-Line Brief",
    "IMPORTANT: This brief is already calculated by VisaFlow Intelligence Engine. Do not recalculate, regroup, or use request headers.",
    `Totals from request lines only: Required ${totals.required}, Allocated Visas ${totals.allocated}, Authorized ${totals.authorized}, Candidates ${totals.candidates}, Joined ${totals.joined}, Visa Gap ${totals.visaGap}, Authorization Gap ${totals.authorizationGap}, Candidate Gap ${totals.candidateGap}, Joining Gap ${totals.joiningGap}`,
    "",
    ...sections,
  ].join("\n");
}

function buildAICommanderSnapshot() {
  const agencyScorecard = buildAgencyScorecard();
  const operationalLines = buildOperationalRequestLineRows();
  const requestHealth = [...operationalLines].sort((a, b) => b.riskScore - a.riskScore);
  const forecast = buildRecruitmentForecast();

  const totalsFromLines = operationalLines.reduce((acc, line) => {
    acc.total_required += Number(line.requested_qty || 0);
    acc.allocated_visas += Number(line.allocatedVisaQty || 0);
    acc.authorized_qty += Number(line.authorizedQty || 0);
    acc.candidates += Number(line.candidates || 0);
    acc.covered_candidates += Math.min(Number(line.candidates || 0), Number(line.requested_qty || 0));
    acc.extra_candidates += Math.max(Number(line.candidates || 0) - Number(line.requested_qty || 0), 0);
    acc.interview_passed += Number(line.interviewPassed || 0);
    acc.medical_done += Number(line.medicalDone || 0);
    acc.visa_ready += Number(line.visaReady || 0);
    acc.ticket_issued += Number(line.ticketIssued || 0);
    acc.arrived += Number(line.arrived || 0);
    acc.joined += Number(line.joined || 0);
    acc.candidate_gap += Number(line.candidateGap || 0);
    acc.joining_gap += Number(line.joiningGap || 0);
    if (!line.isSaudi) {
      acc.visa_gap += Number(line.visaGap || 0);
      acc.authorization_gap += Number(line.authorizationGap || 0);
    }
    if (line.riskLevel === "High") acc.high_risk_lines += 1;
    return acc;
  }, {
    total_required: 0,
    allocated_visas: 0,
    authorized_qty: 0,
    candidates: 0,
    covered_candidates: 0,
    extra_candidates: 0,
    interview_passed: 0,
    medical_done: 0,
    visa_ready: 0,
    ticket_issued: 0,
    arrived: 0,
    joined: 0,
    visa_gap: 0,
    authorization_gap: 0,
    candidate_gap: 0,
    joining_gap: 0,
    high_risk_lines: 0,
  });

  totalsFromLines.progress_percent = totalsFromLines.total_required
    ? Math.min(Math.round((totalsFromLines.covered_candidates / totalsFromLines.total_required) * 100), 100)
    : 0;

  const visaShortage = operationalLines
    .filter((line) => !line.isSaudi && line.visaGap > 0)
    .map((line) => ({
      line_key: line.line_key,
      request_no: line.request_no,
      line_no: line.line_no,
      project: line.project,
      profession: line.profession,
      nationality: line.nationality,
      gender: line.gender,
      required: line.requested_qty,
      allocated: line.allocatedVisaQty,
      shortage: line.visaGap,
      bottleneck: line.bottleneck,
    }));

  const authorizationGaps = operationalLines
    .filter((line) => !line.isSaudi && line.authorizationGap > 0)
    .map((line) => ({
      line_key: line.line_key,
      request_no: line.request_no,
      line_no: line.line_no,
      profession: line.profession,
      nationality: line.nationality,
      gender: line.gender,
      allocated: line.allocatedVisaQty,
      authorized: line.authorizedQty,
      gap: line.authorizationGap,
      agencies: line.agencies,
    }));

  const candidateGaps = operationalLines
    .filter((line) => line.candidateGap > 0)
    .map((line) => ({
      line_key: line.line_key,
      request_no: line.request_no,
      line_no: line.line_no,
      profession: line.profession,
      nationality: line.nationality,
      gender: line.gender,
      required: line.requested_qty,
      candidates: line.candidates,
      gap: line.candidateGap,
      agencies: line.agencies,
    }));

  return {
    generated_at: new Date().toISOString(),
    company_system: "VisaFlow KSA",
    ai_data_contract: {
      version: "request-line-operational-model-v2-strict",
      mandatory: "Use ONLY operational_request_lines and line_totals for request quantities, professions, nationalities, progress, gaps and risks.",
      forbidden_1: "Do NOT use request header fields or top project summaries to describe a request line.",
      forbidden_2: "Do NOT combine all quantities under the first profession.",
      forbidden_3: "Do NOT state that REQ-2026-0003 is 60 plumbers if operational_request_lines show multiple lines.",
      rule_1: "Each operational_request_line is a separate demand: profession + nationality + gender + requested_qty.",
      rule_2: "Visa allocation, authorization, candidates, interviews and mobilization must be interpreted per operational_request_line.",
      rule_3: "When reporting one request, list every line separately before any summary.",
    },
    line_totals: totalsFromLines,
    operational_request_lines: operationalLines,
    critical_alerts_by_line: {
      visa_shortage_by_request_line: visaShortage,
      authorization_gap_by_request_line: authorizationGaps,
      candidate_gap_by_request_line: candidateGaps,
    },
    request_health_by_line: requestHealth.slice(0, 20),
    agency_scorecard: agencyScorecard.slice(0, 12),
    forecast,
  };
}


function getLocalAICommanderBrief() {
  const agencyScorecard = buildAgencyScorecard();
  const requestHealth = buildRequestHealthRows();
  const forecast = buildRecruitmentForecast();
  const delayed = reports.lateItems.length;
  const lineVisaShortage = requestHealth.filter((row) => !row.isSaudi && row.visaGap > 0).length;
  const lineAuthorizationGaps = requestHealth.filter((row) => !row.isSaudi && row.authorizationGap > 0).length;
  const lineCandidateGaps = requestHealth.filter((row) => row.candidateGap > 0).length;
  const noCandidates = reports.authorizationsWithoutCandidates.length;
  const highRiskLines = requestHealth.filter((row) => row.riskLevel === "High").length;
  const topAgency = agencyScorecard[0];
  const weakestAgency = agencyScorecard[agencyScorecard.length - 1];
  const topLine = requestHealth[0];

  return [
    `VisaFlow AI Commander - Executive Brief`,
    ``,
    `Overall risk: ${delayed + lineVisaShortage + lineAuthorizationGaps + lineCandidateGaps + highRiskLines} request-line item(s) require management attention.`,
    `- Open requests: ${executiveDashboard.openRequests}`,
    `- Recruitment progress: ${executiveDashboard.recruitmentProgress}%`,
    `- Delayed SLA items: ${delayed}`,
    `- Request lines with visa allocation gap: ${lineVisaShortage}`,
    `- Request lines with authorization gap: ${lineAuthorizationGaps}`,
    `- Request lines with candidate gap: ${lineCandidateGaps}`,
    `- Authorizations without candidates: ${noCandidates}`,
    `- High-risk request lines: ${highRiskLines}`,
    `- Saudization rate: ${executiveDashboard.saudizationRate}%`,
    topLine ? `- Highest risk line: ${topLine.request_no} / Line ${topLine.line_no} / ${topLine.profession} / Required ${topLine.requested_qty} / Progress ${topLine.progress}% / Bottleneck: ${topLine.bottleneck}` : ``,
    ``,
    `Forecast: ${forecast.forecastMessage}`,
    `- Remaining recruitment gap: ${forecast.totalRemainingRecruitment}`,
    `- Remaining joining gap: ${forecast.totalRemainingJoining}`,
    `- Expected arrivals next 30 days: ${forecast.arrivingNext30}`,
    ``,
    `Agency performance:`,
    topAgency ? `- Best current agency: ${topAgency.agency} / Score ${topAgency.score}` : `- No agency data available yet.`,
    weakestAgency && weakestAgency !== topAgency ? `- Agency requiring follow-up: ${weakestAgency.agency} / Score ${weakestAgency.score}` : ``,
    ``,
    `Recommended actions:`,
    `1. Review high-risk request lines, not only request headers.`,
    `2. Resolve visa allocation gaps per profession / nationality / gender line.`,
    `3. Issue authorizations against the exact allocated line and agency.`,
    `4. Push agencies by request line where candidates are below required quantity.`,
    `5. Move ready candidates from medical/visa stages to ticketing and arrival.`,
  ].filter(Boolean).join("\n");
}


function buildLockedVIEReport(question = "") {
  const operationalLines = buildOperationalRequestLineRows();
  const activeLines = operationalLines.filter((line) => !["Cancelled"].includes(line.status));
  const totals = activeLines.reduce((acc, line) => {
    acc.required += Number(line.requested_qty || 0);
    acc.allocated += Number(line.allocatedVisaQty || 0);
    acc.authorized += Number(line.authorizedQty || 0);
    acc.candidates += Number(line.candidates || 0);
    acc.interviewPassed += Number(line.interviewPassed || 0);
    acc.medicalDone += Number(line.medicalDone || 0);
    acc.arrived += Number(line.arrived || 0);
    acc.joined += Number(line.joined || 0);
    acc.candidateGap += Number(line.candidateGap || 0);
    acc.visaGap += Number(line.visaGap || 0);
    acc.authorizationGap += Number(line.authorizationGap || 0);
    acc.joiningGap += Number(line.joiningGap || 0);
    if (line.riskLevel === "High") acc.highRisk += 1;
    return acc;
  }, {
    required: 0,
    allocated: 0,
    authorized: 0,
    candidates: 0,
    interviewPassed: 0,
    medicalDone: 0,
    arrived: 0,
    joined: 0,
    candidateGap: 0,
    visaGap: 0,
    authorizationGap: 0,
    joiningGap: 0,
    highRisk: 0,
  });

  const requestGroups = activeLines.reduce((map, line) => {
    const key = line.request_no || "-";
    if (!map[key]) {
      map[key] = {
        request_no: key,
        project: line.project || "-",
        lines: [],
      };
    }
    map[key].lines.push(line);
    return map;
  }, {});

  const requestSections = Object.values(requestGroups).map((request) => {
    const lineRows = request.lines
      .sort((a, b) => Number(a.line_no || 0) - Number(b.line_no || 0))
      .map((line) =>
        `Line ${line.line_no}: ${line.profession} | ${line.nationality} | ${line.gender} | Required ${line.requested_qty} | Allocated ${line.allocatedVisaQty} | Authorized ${line.authorizedQty} | Candidates ${line.candidates} | Interview Passed ${line.interviewPassed} | Medical ${line.medicalDone} | Arrived ${line.arrived} | Joined ${line.joined} | Bottleneck: ${line.bottleneck} | Risk: ${line.riskLevel}`
      )
      .join("\n");

    return `Request: ${request.request_no}\nProject: ${request.project}\n${lineRows}`;
  }).join("\n\n");

  const highRiskLines = activeLines
    .filter((line) => line.riskLevel === "High")
    .sort((a, b) => Number(b.riskScore || 0) - Number(a.riskScore || 0))
    .slice(0, 10);

  const riskRows = highRiskLines.length
    ? highRiskLines.map((line) => `- ${line.request_no} / Line ${line.line_no} / ${line.profession}: ${line.bottleneck}. ${line.recommendation}`).join("\n")
    : "- No high-risk request lines detected.";

  const agencyRows = buildAgencyScorecard().slice(0, 8).map((agency) =>
    `- ${agency.agency}: Candidates ${agency.candidates}, Authorized ${agency.authorizedQty}, Success ${agency.successRate}%, Risk ${agency.risk}, Score ${agency.score}`
  ).join("\n") || "- No agency data available.";

  const progress = totals.required ? Math.round((totals.candidates / totals.required) * 100) : 0;
  const joinedProgress = totals.required ? Math.round((totals.joined / totals.required) * 100) : 0;

  return [
    "🔒 VisaFlow Locked Request-Line Report",
    "",
    "This report is generated by VisaFlow VIE from request_lines only. Request header profession/quantity is ignored.",
    question ? `Question: ${question}` : "",
    "",
    "Executive Totals",
    `- Total required: ${totals.required}`,
    `- Active candidates: ${totals.candidates} (${progress}%)`,
    `- Allocated visas: ${totals.allocated}`,
    `- Authorized quantity: ${totals.authorized}`,
    `- Interview passed: ${totals.interviewPassed}`,
    `- Medical done: ${totals.medicalDone}`,
    `- Arrived: ${totals.arrived}`,
    `- Joined: ${totals.joined} (${joinedProgress}%)`,
    `- Visa allocation gap: ${totals.visaGap}`,
    `- Authorization gap: ${totals.authorizationGap}`,
    `- Candidate gap: ${totals.candidateGap}`,
    `- Joining gap: ${totals.joiningGap}`,
    `- High-risk lines: ${totals.highRisk}`,
    "",
    "Request Line Breakdown",
    requestSections || "No request lines available.",
    "",
    "Critical Risks by Line",
    riskRows,
    "",
    "Agency Follow-up",
    agencyRows,
    "",
    "Recommended Actions",
    "1. Do not evaluate any request as one profession when it has multiple request lines.",
    "2. Follow each line separately by profession, nationality, gender, quantity, authorization, candidate pipeline, and joining.",
    "3. Use the bottleneck shown for each line as the next operational action.",
  ].filter(Boolean).join("\n");
}


function buildAICommanderDecisionContext() {
  const requestHealth = buildRequestHealthRows();
  const agencyScorecard = buildAgencyScorecard();
  const forecast = buildRecruitmentForecast();
  const highRiskLines = requestHealth
    .filter((row) => row.riskLevel === "High")
    .sort((a, b) => Number(b.riskScore || 0) - Number(a.riskScore || 0));
  const visaGapLines = requestHealth.filter((row) => !row.isSaudi && Number(row.visaGap || 0) > 0);
  const authorizationGapLines = requestHealth.filter((row) => !row.isSaudi && Number(row.authorizationGap || 0) > 0);
  const candidateGapLines = requestHealth.filter((row) => Number(row.candidateGap || 0) > 0);
  const agencyRiskRows = agencyScorecard.filter((row) => row.risk !== "Low");
  const riskScore =
    reports.lateItems.length +
    visaGapLines.length +
    authorizationGapLines.length +
    highRiskLines.length +
    agencyRiskRows.length;

  return {
    requestHealth,
    agencyScorecard,
    forecast,
    highRiskLines,
    visaGapLines,
    authorizationGapLines,
    candidateGapLines,
    agencyRiskRows,
    riskScore,
  };
}

function buildLocalAICommanderAnswer(question = "", mode = aiCommanderMode, language = aiCommanderLanguage) {
  const context = buildAICommanderDecisionContext();
  const topRiskLines = context.highRiskLines.slice(0, 5);
  const topAgencies = context.agencyScorecard.slice(0, 4);
  const weakAgencies = [...context.agencyScorecard].filter((agency) => agency.risk !== "Low").slice(-4).reverse();
  const isArabic = language !== "English";
  const sourceNote = isArabic
    ? "مصدر الأرقام: محرك VisaFlow VIE حسب request_lines، وليس من ملخص الطلب العام."
    : "Source: VisaFlow VIE request-line engine, not request header summaries.";

  if (!isArabic) {
    return [
      `VisaFlow AI Commander - ${mode}`,
      sourceNote,
      "",
      "Executive Summary",
      `- AI Risk Score: ${context.riskScore}`,
      `- Open Requests: ${executiveDashboard.openRequests}`,
      `- Recruitment Progress: ${executiveDashboard.recruitmentProgress}%`,
      `- Remaining Recruitment Gap: ${context.forecast.totalRemainingRecruitment}`,
      `- Remaining Joining Gap: ${context.forecast.totalRemainingJoining}`,
      `- Expected Arrivals Next 30 Days: ${context.forecast.arrivingNext30}`,
      "",
      "Top Risks",
      ...(topRiskLines.length ? topRiskLines.map((line, index) => `${index + 1}. ${line.request_no} / Line ${line.line_no} / ${line.profession}: ${line.bottleneck}. Action: ${line.recommendation}`) : ["No high-risk request lines detected."]),
      "",
      "Agency View",
      ...(topAgencies.length ? topAgencies.map((agency) => `- ${agency.agency}: Score ${agency.score}, Success ${agency.successRate}%, Risk ${agency.risk}`) : ["No agency performance data yet."]),
      "",
      "Recommended Decisions",
      "1. Resolve request lines with visa and authorization gaps before adding more candidates.",
      "2. Push agencies on candidate gaps by request line, profession, nationality, and gender.",
      "3. Convert ready candidates from medical/visa stages into ticketing and arrival.",
      "4. Review weak agencies before allocating new demand.",
    ].join("\n");
  }

  const forecastLine = context.forecast?.forecastMessage || "لا توجد توقعات كافية حاليًا.";
  const riskLabel = context.riskScore >= 10 ? "مرتفع" : context.riskScore >= 4 ? "متوسط" : "منخفض";

  const modeIntro = {
    "Executive Brief": "ملخص تنفيذي مختصر يركز على القرار الإداري.",
    "Risk Analysis": "تحليل مخاطر يوضح أين تتعطل الطلبات ولماذا.",
    "Agency Follow-up": "توجيهات متابعة للمكاتب بناءً على الأداء والفجوات.",
    "Forecast": "توقعات للفجوات والوصول خلال الفترة القادمة.",
    "CEO Decision Memo": "مذكرة قرار جاهزة للرئيس التنفيذي أو مدير التوظيف.",
  }[mode] || "تحليل تشغيلي مباشر.";

  return [
    `🧠 VisaFlow AI Commander - ${mode}`,
    sourceNote,
    question ? `سؤال المستخدم: ${question}` : "",
    "",
    "📌 الملخص التنفيذي",
    `- ${modeIntro}`,
    `- مستوى المخاطر الحالي: ${riskLabel} / AI Risk Score: ${context.riskScore}`,
    `- الطلبات المفتوحة: ${executiveDashboard.openRequests}`,
    `- تقدم التوظيف: ${executiveDashboard.recruitmentProgress}%` ,
    `- فجوة التوظيف المتبقية: ${context.forecast.totalRemainingRecruitment}`,
    `- فجوة المباشرة المتبقية: ${context.forecast.totalRemainingJoining}`,
    `- المتوقع وصولهم خلال 30 يوم: ${context.forecast.arrivingNext30}`,
    "",
    "📊 مؤشرات القرار",
    `- بنود طلبات عالية المخاطر: ${context.highRiskLines.length}`,
    `- بنود فيها نقص تأشيرات: ${context.visaGapLines.length}`,
    `- بنود فيها فجوة تفويض: ${context.authorizationGapLines.length}`,
    `- بنود فيها نقص مرشحين: ${context.candidateGapLines.length}`,
    `- مكاتب تحتاج متابعة: ${context.agencyRiskRows.length}`,
    "",
    "🚨 أعلى المخاطر حسب البند التشغيلي",
    ...(topRiskLines.length
      ? topRiskLines.map((line, index) => `${index + 1}. ${line.request_no} / Line ${line.line_no} / ${line.profession} / ${line.nationality}: ${line.bottleneck}. الإجراء المقترح: ${line.recommendation}`)
      : ["لا توجد بنود عالية المخاطر حاليًا."]),
    "",
    "🏢 أداء المكاتب",
    ...(topAgencies.length
      ? topAgencies.map((agency) => `- ${agency.agency}: التقييم ${agency.score} / النجاح ${agency.successRate}% / المخاطر ${agency.risk}`)
      : ["لا توجد بيانات كافية لتقييم المكاتب حاليًا."]),
    weakAgencies.length ? `- مكاتب تحتاج تدخل: ${weakAgencies.map((agency) => agency.agency).join(", ")}` : "",
    "",
    "🔮 التوقع",
    `- ${forecastLine}`,
    "",
    "✅ قرارات مقترحة",
    "1. معالجة بنود الطلب ذات نقص التأشيرات أو التفويض قبل زيادة الترشيحات.",
    "2. متابعة كل مكتب حسب البند: المهنة + الجنسية + الجنس + الكمية، وليس حسب رقم الطلب فقط.",
    "3. نقل المرشحين الجاهزين من مراحل الفحص/التأشيرة إلى التذاكر والوصول بسرعة.",
    "4. عدم تخصيص كميات جديدة للمكاتب ذات المخاطر العالية قبل تحديث المعاملات المتأخرة.",
    "5. عرض هذا الملخص في تقرير الإدارة أو AI Report Studio عند الحاجة.",
  ].filter(Boolean).join("\n");
}

function buildAICommanderWelcomeAnswer(question = "", mode = aiCommanderMode, language = aiCommanderLanguage) {
  const isArabic = language !== "English";
  const context = buildAICommanderDecisionContext();
  const riskLabel = context.riskScore >= 10 ? (isArabic ? "مرتفع" : "High") : context.riskScore >= 4 ? (isArabic ? "متوسط" : "Medium") : (isArabic ? "منخفض" : "Low");

  if (!isArabic) {
    return [
      "🧠 VisaFlow AI Commander",
      "I am ready as your recruitment operations commander, not a general chatbot.",
      "",
      "📌 Executive Quick Snapshot",
      `- Current risk level: ${riskLabel} / AI Risk Score: ${context.riskScore}`,
      `- Open requests: ${executiveDashboard.openRequests}`,
      `- Recruitment progress: ${executiveDashboard.recruitmentProgress}%`,
      `- High-risk request lines: ${context.highRiskLines.length}`,
      `- Agency follow-up cases: ${context.agencyRiskRows.length}`,
      `- Expected arrivals next 30 days: ${context.forecast.arrivingNext30}`,
      "",
      "✅ What I can do",
      "1. Give you a CEO executive brief.",
      "2. Identify the highest-risk request lines and exact bottlenecks.",
      "3. Rank agencies and recommend follow-up actions.",
      "4. Forecast recruitment, arrival, and joining gaps for the next 30 days.",
      "",
      "Ask me for: top risks, agency performance, visa gaps, authorization gaps, or a CEO memo.",
    ].join("\n");
  }

  return [
    "🧠 VisaFlow AI Commander",
    "مرحبًا يا أبو إبراهيم، أنا جاهز كمدير عمليات ذكي داخل VisaFlow، مو كشات عام.",
    "",
    "📌 لقطة تنفيذية سريعة",
    `- مستوى المخاطر الحالي: ${riskLabel} / AI Risk Score: ${context.riskScore}`,
    `- الطلبات المفتوحة: ${executiveDashboard.openRequests}`,
    `- تقدم التوظيف: ${executiveDashboard.recruitmentProgress}%`,
    `- بنود الطلبات عالية المخاطر: ${context.highRiskLines.length}`,
    `- حالات متابعة المكاتب: ${context.agencyRiskRows.length}`,
    `- المتوقع وصولهم خلال 30 يوم: ${context.forecast.arrivingNext30}`,
    "",
    "✅ أقدر أساعدك في",
    "1. ملخص تنفيذي للرئيس التنفيذي.",
    "2. تحديد أعلى بنود الطلب خطورة ومكان التعطل.",
    "3. ترتيب المكاتب حسب الأداء وتحديد من يحتاج متابعة.",
    "4. توقع فجوات التوظيف والوصول والمباشرة خلال 30 يوم.",
    "",
    "اسألني مثلًا: ما أعلى المخاطر؟ من أضعف مكتب؟ ما فجوة التأشيرات؟ أو اعطني مذكرة CEO.",
  ].join("\n");
}

function parseAICommanderSections(answer = "") {
  const lines = String(answer || "").split("\n");
  const sections = [];
  let current = { title: "Executive Note", lines: [] };

  const isHeading = (text) => {
    if (!text) return false;
    if (/^[🧠📌📊🚨🏢🔮✅⚠️]/.test(text)) return true;
    return [
      "Executive Summary",
      "Decision KPIs",
      "Top Risks",
      "Agency Follow-up",
      "Agency View",
      "Forecast",
      "Recommended Decisions",
      "Recommended Actions",
      "CEO Decision Memo",
    ].some((heading) => text.toLowerCase().startsWith(heading.toLowerCase()));
  };

  lines.forEach((raw) => {
    const text = raw.trim();
    if (!text) return;
    if (isHeading(text)) {
      if (current.lines.length || current.title !== "Executive Note") sections.push(current);
      current = { title: text, lines: [] };
    } else {
      current.lines.push(text);
    }
  });

  if (current.lines.length || current.title !== "Executive Note") sections.push(current);
  return sections;
}

function getAICommanderSectionStyle(title = "") {
  const text = String(title || "").toLowerCase();
  if (text.includes("risk") || text.includes("مخاطر") || title.includes("🚨")) return { bg: "#fff1f2", border: "#fecdd3", color: "#9f1239", tag: "Risk" };
  if (text.includes("agency") || text.includes("مكاتب") || text.includes("المكاتب") || title.includes("🏢")) return { bg: "#eff6ff", border: "#bfdbfe", color: "#1d4ed8", tag: "Agencies" };
  if (text.includes("forecast") || text.includes("توقع") || title.includes("🔮")) return { bg: "#f0fdf4", border: "#bbf7d0", color: "#15803d", tag: "Forecast" };
  if (text.includes("decision") || text.includes("action") || text.includes("قرارات") || text.includes("إجراءات") || title.includes("✅")) return { bg: "#ecfeff", border: "#a5f3fc", color: "#0e7490", tag: "Decision" };
  return { bg: "#eef2ff", border: "#c7d2fe", color: "#3730a3", tag: "Executive" };
}

function renderAICommanderAnswer() {
  const context = buildAICommanderDecisionContext();
  const kpis = [
    { label: aiCommanderLanguage === "English" ? "AI Risk Score" : "درجة المخاطر", value: context.riskScore, className: executiveAlertClass(context.riskScore) },
    { label: aiCommanderLanguage === "English" ? "High Risk Lines" : "بنود عالية المخاطر", value: context.highRiskLines.length, className: executiveAlertClass(context.highRiskLines.length) },
    { label: aiCommanderLanguage === "English" ? "Agency Follow-ups" : "متابعة المكاتب", value: context.agencyRiskRows.length, className: executiveAlertClass(context.agencyRiskRows.length) },
    { label: aiCommanderLanguage === "English" ? "Arrivals 30D" : "وصول 30 يوم", value: context.forecast.arrivingNext30, className: "passed" },
  ];

  if (!aiAnswer) {
    return (
      <div style={{ display: "grid", gap: "14px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "10px" }}>
          {kpis.map((kpi) => (
            <div key={kpi.label} className={`stat-card ${kpi.className || ""}`} style={{ minHeight: "86px" }}>
              <h3>{kpi.label}</h3>
              <strong>{kpi.value}</strong>
            </div>
          ))}
        </div>
        <div style={{ textAlign: "center", padding: "34px 18px", color: "#64748b", border: "1px dashed #cbd5e1", borderRadius: "18px", background: "white" }}>
          <div style={{ fontSize: "44px", marginBottom: "10px" }}>🧠</div>
          <h3 style={{ margin: "0 0 8px", color: "#0f172a" }}>جاهز للتحليل التنفيذي</h3>
          <p style={{ margin: 0, lineHeight: 1.7 }}>
            اكتب سؤالك أو استخدم أحد الأوامر الجاهزة. حتى التحية العادية ستحصل على لقطة تنفيذية سريعة من بيانات VisaFlow.
          </p>
        </div>
      </div>
    );
  }

  const sections = parseAICommanderSections(aiAnswer);

  return (
    <div style={{ display: "grid", gap: "14px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "10px" }}>
        {kpis.map((kpi) => (
          <div key={kpi.label} className={`stat-card ${kpi.className || ""}`} style={{ minHeight: "86px" }}>
            <h3>{kpi.label}</h3>
            <strong>{kpi.value}</strong>
          </div>
        ))}
      </div>

      {sections.map((section, index) => {
        const style = getAICommanderSectionStyle(section.title);
        return (
          <div key={`${section.title}-${index}`} style={{ borderRadius: "18px", border: `1px solid ${style.border}`, background: "white", overflow: "hidden", boxShadow: "0 10px 24px rgba(15,23,42,0.04)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center", padding: "13px 15px", background: style.bg, color: style.color }}>
              <b style={{ fontSize: "15px" }}>{section.title}</b>
              <span className="badge active" style={{ background: "rgba(255,255,255,0.70)", color: style.color, border: `1px solid ${style.border}` }}>{style.tag}</span>
            </div>
            <div style={{ display: "grid", gap: "8px", padding: "13px 15px" }}>
              {section.lines.length === 0 ? (
                <div style={{ color: "#64748b" }}>—</div>
              ) : (
                section.lines.map((line, lineIndex) => {
                  const isBullet = line.startsWith("-") || /^\d+\./.test(line);
                  const isWarning = /high|مرتفع|خطر|متأخر|gap|فجوة|warning|تعذر|⚠️/i.test(line);
                  return (
                    <div
                      key={`${line}-${lineIndex}`}
                      style={{
                        padding: isBullet ? "10px 12px" : "8px 2px",
                        borderRadius: "12px",
                        background: isBullet ? (isWarning ? "#fff7ed" : "#f8fafc") : "transparent",
                        border: isBullet ? `1px solid ${isWarning ? "#fed7aa" : "#e2e8f0"}` : "none",
                        color: "#0f172a",
                        lineHeight: 1.75,
                      }}
                    >
                      {line}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function getAICommanderIntent(question = "") {
  const q = String(question || "").trim().toLowerCase();

  const operationalKeywords = [
    "req-",
    "report",
    "dashboard",
    "analyze",
    "analysis",
    "status",
    "risk",
    "risks",
    "forecast",
    "request",
    "requests",
    "visa",
    "candidate",
    "candidates",
    "agency",
    "agencies",
    "authorization",
    "mobilization",
    "joining",
    "arrival",
    "sla",
    "performance",
    "penalty",
    "penalties",
    "kpi",
    "تقرير",
    "حلل",
    "تحليل",
    "حالة",
    "وضع",
    "مخاطر",
    "خطر",
    "توقع",
    "توقعات",
    "طلب",
    "طلبات",
    "تأشيرة",
    "تأشيرات",
    "تفويض",
    "تفويضات",
    "مرشح",
    "مرشحين",
    "مكتب",
    "مكاتب",
    "وكالة",
    "وكالات",
    "انضمام",
    "وصول",
    "تعبئة",
    "اداء",
    "أداء",
    "غرامة",
    "غرامات",
  ];

  const greetings = [
    "كيف الحال",
    "كيفك",
    "شلونك",
    "السلام عليكم",
    "هلا",
    "مرحبا",
    "مرحباً",
    "اهلا",
    "أهلا",
    "hi",
    "hello",
  ];

  const writingKeywords = [
    "وصف وظيفي",
    "job description",
    "اكتب",
    "صياغة",
    "ترجم",
    "translate",
    "email",
    "ايميل",
    "رسالة",
    "خطاب",
  ];

  if (!q) return "welcome";
  if (greetings.some((keyword) => q.includes(keyword))) return "welcome";
  if (operationalKeywords.some((keyword) => q.includes(keyword))) return "operational";
  if (writingKeywords.some((keyword) => q.includes(keyword)) && !q.includes("req-")) return "writing";
  return "welcome";
}

async function callVisaFlowAIEdge(payload = {}) {
  const { data, error } = await supabase.functions.invoke("visaflow-ai-commander", {
    body: payload,
  });

  if (error) throw new Error(error.message || "AI Edge Function failed");
  if (!data?.ok) throw new Error(data?.error || "AI returned no answer");
  return data?.text || "";
}

async function runAICommander(question = aiQuestion) {
  const finalQuestion = String(question || "").trim();
  setAiLoading(true);
  setAiAnswer("");

  const intent = getAICommanderIntent(finalQuestion);

  try {
    if (intent === "welcome") {
      setAiAnswer(buildAICommanderWelcomeAnswer(finalQuestion, aiCommanderMode, aiCommanderLanguage));
      setAiLastRun(new Date().toLocaleString());
      return;
    }

    if (intent === "writing") {
      const aiText = await callVisaFlowAIEdge({
        action: "chat",
        question: finalQuestion,
        language: aiCommanderLanguage,
        mode: aiCommanderMode,
        intent,
      });

      setAiAnswer(aiText || buildAICommanderWelcomeAnswer(finalQuestion, aiCommanderMode, aiCommanderLanguage));
      setAiLastRun(new Date().toLocaleString());
      return;
    }

    const lockedReport = buildLockedVIEReport(finalQuestion);
    const snapshot = buildAICommanderSnapshot();
    const localDecisionContext = buildLocalAICommanderAnswer(finalQuestion, aiCommanderMode, aiCommanderLanguage);

    const aiText = await callVisaFlowAIEdge({
      action: "commander",
      question: finalQuestion || "اعطني لقطة تنفيذية سريعة عن حالة VisaFlow الحالية.",
      mode: aiCommanderMode,
      language: aiCommanderLanguage,
      intent,
      lockedReport,
      snapshot,
      localDecisionContext,
    });

    setAiAnswer(aiText || localDecisionContext);
    setAiLastRun(new Date().toLocaleString());
  } catch (error) {
    if (intent === "operational") {
      setAiAnswer(
        buildLocalAICommanderAnswer(finalQuestion, aiCommanderMode, aiCommanderLanguage) +
          `\n\n⚠️ ملاحظة تقنية: تعذر الاتصال بخدمة الذكاء الاصطناعي الخارجية عبر Supabase Edge Function (${error.message}). تم عرض تحليل VisaFlow المحلي بدلًا من ذلك.`
      );
    } else if (intent === "writing") {
      setAiAnswer(
        aiCommanderLanguage === "English"
          ? `AI writing request failed through Edge Function: ${error.message}`
          : `تعذر تنفيذ طلب الكتابة عبر Edge Function: ${error.message}`
      );
    } else {
      setAiAnswer(buildAICommanderWelcomeAnswer(finalQuestion, aiCommanderMode, aiCommanderLanguage));
    }
  } finally {
    setAiLoading(false);
  }
}

function getAIAgentSettingsModeLabel(mode = aiAgentSettings.mode) {
  const labels = {
    off: "Off",
    suggest_only: "Suggest Only",
    auto_notify_manager: "Auto Notify Manager",
    auto_followup_agencies: "Auto Follow-up Agencies",
    full_auto: "Full Auto",
  };
  return labels[mode] || mode || "Auto Notify Manager";
}

function getAIAgentMaxAutoActions() {
  const value = Number(aiAgentSettings?.max_auto_actions_per_run || DEFAULT_AI_AGENT_SETTINGS.max_auto_actions_per_run);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_AI_AGENT_SETTINGS.max_auto_actions_per_run;
  return Math.min(Math.max(Math.round(value), 1), 20);
}

function getAIAgentCooldownMinutes() {
  const value = Number(aiAgentSettings?.cooldown_minutes || DEFAULT_AI_AGENT_SETTINGS.cooldown_minutes);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_AI_AGENT_SETTINGS.cooldown_minutes;
  return Math.min(Math.max(Math.round(value), 5), 1440);
}

function getAIAgentMaxActionsPerHour() {
  const value = Number(aiAgentSettings?.max_actions_per_hour || DEFAULT_AI_AGENT_SETTINGS.max_actions_per_hour);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_AI_AGENT_SETTINGS.max_actions_per_hour;
  return Math.min(Math.max(Math.round(value), 1), 200);
}

function getAIAgentMaxRetryAttempts() {
  const value = Number(aiAgentSettings?.max_retry_attempts || DEFAULT_AI_AGENT_SETTINGS.max_retry_attempts);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_AI_AGENT_SETTINGS.max_retry_attempts;
  return Math.min(Math.max(Math.round(value), 1), 10);
}

function isAIAgentBackgroundMode() {
  return aiAgentSettings?.run_in_background !== false;
}

function isAIAgentEnabled() {
  return aiAgentSettings?.is_active !== false && String(aiAgentSettings?.mode || "auto_notify_manager") !== "off";
}

function isAIAgentManagerAutoEnabled() {
  const mode = String(aiAgentSettings?.mode || "auto_notify_manager");
  return isAIAgentEnabled() && aiAgentSettings?.auto_manager_approval !== false && ["auto_notify_manager", "auto_followup_agencies", "full_auto"].includes(mode);
}

function isAIAgentAgencyFollowUpAutoEnabled() {
  const mode = String(aiAgentSettings?.mode || "auto_notify_manager");
  return isAIAgentEnabled() && Boolean(aiAgentSettings?.auto_followup_agencies) && ["auto_followup_agencies", "full_auto"].includes(mode);
}

function shouldAIAgentSendAgencyEmails() {
  return Boolean(aiAgentSettings?.allow_auto_agency_emails);
}

function getAIAgentManagerEmailOverride() {
  return String(aiAgentSettings?.manager_approval_email || "").trim();
}

async function writeAIAgentAuditLog({
  actionType,
  actionKey,
  status = "completed",
  severity = "info",
  title = "AI Agent action",
  targetTable = "",
  targetId = "",
  agencyId = null,
  agencyName = "",
  requestNo = "",
  details = {},
  errorMessage = "",
} = {}) {
  if (!currentCompanyId) return;

  try {
    await supabase.from("ai_agent_audit_logs").insert([{
      company_id: currentCompanyId,
      action_type: actionType || "AI_AGENT_ACTION",
      action_key: actionKey || `${actionType || "AI_AGENT_ACTION"}:${Date.now()}`,
      status,
      severity,
      actor: "AI_AGENT",
      target_table: targetTable || null,
      target_id: targetId ? String(targetId) : null,
      agency_id: agencyId || null,
      agency_name: agencyName || null,
      request_no: requestNo || null,
      title,
      details,
      error_message: errorMessage || null,
      created_by: currentUser?.id || null,
    }]);
  } catch (error) {
    console.warn("AI Agent audit log failed", error?.message || error);
  }
}

async function acquireAIAgentActionLock({
  actionType,
  actionKey,
  relatedTable = "",
  relatedId = "",
  agencyId = null,
  title = "AI Agent action lock",
  details = {},
} = {}) {
  if (!currentCompanyId || !actionKey) return { ok: false, skipped: true, reason: "Missing AI Agent lock key" };

  try {
    const { data, error } = await supabase.rpc("ai_agent_try_acquire_lock", {
      p_company_id: currentCompanyId,
      p_action_key: actionKey,
      p_action_type: actionType || "AI_AGENT_ACTION",
      p_related_table: relatedTable || null,
      p_related_id: relatedId ? String(relatedId) : null,
      p_agency_id: agencyId || null,
      p_cooldown_minutes: getAIAgentCooldownMinutes(),
    });

    if (error) throw error;
    if (!data) {
      await writeAIAgentAuditLog({
        actionType,
        actionKey,
        status: "skipped",
        severity: "warning",
        title: `${title} skipped by cooldown / duplicate lock`,
        targetTable: relatedTable,
        targetId: relatedId,
        agencyId,
        details: { reason: "cooldown_or_duplicate", cooldown_minutes: getAIAgentCooldownMinutes(), ...details },
      });
      return { ok: false, skipped: true, reason: "Cooldown / duplicate lock active" };
    }

    await writeAIAgentAuditLog({
      actionType,
      actionKey,
      status: "lock_acquired",
      severity: "info",
      title,
      targetTable: relatedTable,
      targetId: relatedId,
      agencyId,
      details: { cooldown_minutes: getAIAgentCooldownMinutes(), ...details },
    });

    return { ok: true, skipped: false };
  } catch (error) {
    await writeAIAgentAuditLog({
      actionType,
      actionKey,
      status: "failed",
      severity: "error",
      title: `${title} failed before execution`,
      targetTable: relatedTable,
      targetId: relatedId,
      agencyId,
      details,
      errorMessage: error?.message || String(error),
    });
    console.warn("AI Agent lock failed", error?.message || error);
    return { ok: false, skipped: true, reason: error?.message || "Lock failed" };
  }
}

async function enqueueAIAgentBackgroundJob(jobType, payload = {}) {
  if (!currentCompanyId) return alert("Company ID is missing.");

  const hourBucket = new Date().toISOString().slice(0, 13);
  const jobKey = `${jobType}:${currentCompanyId}:${hourBucket}`;
  const jobPayload = {
    requested_from: "VisaFlow UI",
    settings_snapshot: normalizeAIAgentSettings(aiAgentSettings),
    max_actions_per_run: getAIAgentMaxAutoActions(),
    cooldown_minutes: getAIAgentCooldownMinutes(),
    max_actions_per_hour: getAIAgentMaxActionsPerHour(),
    ...payload,
  };

  const { error } = await supabase.from("ai_agent_jobs").insert([{
    company_id: currentCompanyId,
    job_type: jobType,
    job_key: jobKey,
    status: "queued",
    priority: jobType.includes("agency") ? 70 : 60,
    payload: jobPayload,
    requested_by: currentUser?.id || null,
    max_attempts: getAIAgentMaxRetryAttempts(),
    scheduled_for: new Date().toISOString(),
  }]);

  if (error) {
    if (String(error.code || "") === "23505" || String(error.message || "").toLowerCase().includes("duplicate")) {
      setAiAgentLog("AI Agent background job is already queued for this hour. Duplicate job skipped.");
      await writeAIAgentAuditLog({
        actionType: "AI_AGENT_BACKGROUND_JOB",
        actionKey: jobKey,
        status: "skipped",
        severity: "warning",
        title: "Duplicate background job skipped",
        details: jobPayload,
      });
      return;
    }
    setAiAgentLog(`AI Agent background job failed: ${error.message}`);
    return alert(error.message);
  }

  setAiAgentLog(`AI Agent background job queued: ${jobType}. The Supabase Worker/Cron will process it safely outside the browser.`);
  setAiAgentLastRun(new Date().toLocaleString());
  await writeAIAgentAuditLog({
    actionType: "AI_AGENT_BACKGROUND_JOB",
    actionKey: jobKey,
    status: "queued",
    severity: "info",
    title: `Background job queued: ${jobType}`,
    details: jobPayload,
  });
}

function getAIAgentFollowUpDedupeKey(task = {}) {
  return [
    task.type || "followup",
    task.agency_id || task.agency || "agency",
    task.related_table || "table",
    task.related_id || task.reference || "reference",
  ].join("|");
}

function getAIAgentAgencyTasks() {
  const today = new Date();

  const agencyContactMap = agencies.reduce((map, agency) => {
    map[normalize(agency.name)] = agency;
    return map;
  }, {});

  const agencyContact = (agencyName) => agencyContactMap[normalize(agencyName)] || {};

  const staleCandidateTasks = getAgencySlaEscalationAlerts().map((item) => {
    const agency = agencyContact(item.agency);
    return {
      type: "Candidate Update Follow-up",
      priority: item.risk === "High" ? "High" : "Medium",
      agency: item.agency || "Unassigned Agency",
      agency_id: agency.id || null,
      agency_email: agency.email || "",
      reference: item.candidate_name,
      request_no: item.request_no,
      related_table: "candidates",
      related_id: String(item.candidate_id || ""),
      title: `Candidate update required: ${item.candidate_name}`,
      reason: `${item.candidate_name} has no update for ${item.days_without_update} day(s). Current status: ${item.status}.`,
      action_required: "Update candidate status, latest stage, expected next date, and blockers within 24 hours.",
    };
  });

  const authorizationTasks = reports.authorizationsWithoutCandidates.map((auth) => {
    const agency = agencyContact(auth.agency);
    const daysOpen = auth.created_at
      ? Math.floor((today - new Date(auth.created_at)) / (1000 * 60 * 60 * 24))
      : 0;

    return {
      type: "Authorization Follow-up",
      priority: daysOpen >= 7 ? "High" : "Medium",
      agency: auth.agency || "Unassigned Agency",
      agency_id: agency.id || null,
      agency_email: agency.email || "",
      reference: auth.authorization_no || auth.visa_no || "Authorization",
      request_no: auth.request_no || "-",
      related_table: "visa_authorizations",
      related_id: String(auth.id || ""),
      title: `No candidates submitted for authorization ${auth.authorization_no || auth.visa_no || ""}`,
      reason: `Authorization ${auth.authorization_no || "-"} / Visa ${auth.visa_no || "-"} has allocated quantity ${auth.allocated_qty || 0} but no submitted candidates yet.`,
      action_required: "Submit candidates or provide a clear sourcing recovery plan today.",
    };
  });

  const agencyRiskTasks = buildAgencyScorecard()
    .filter((row) => row.risk !== "Low")
    .map((row) => {
      const agency = agencyContact(row.agency);
      return {
        type: "Agency Performance Follow-up",
        priority: row.risk === "High" ? "High" : "Medium",
        agency: row.agency || "Unassigned Agency",
        agency_id: agency.id || null,
        agency_email: agency.email || "",
        reference: `Agency score ${row.score}`,
        request_no: "-",
        related_table: "agencies",
        related_id: String(agency.id || ""),
        title: `Agency performance follow-up: ${row.agency}`,
        reason: `Agency risk level is ${row.risk}. Score: ${row.score}. Success rate: ${row.successRate}%. Fail rate: ${row.failRate}%.`,
        action_required: "Confirm corrective action plan, pending candidates, and expected delivery dates.",
      };
    });

  const uniqueMap = new Map();
  [...staleCandidateTasks, ...authorizationTasks, ...agencyRiskTasks].forEach((task) => {
    const key = `${task.type}-${task.agency}-${task.reference}-${task.related_id}`;
    if (!uniqueMap.has(key)) uniqueMap.set(key, task);
  });

  return Array.from(uniqueMap.values()).sort((a, b) => {
    const priorityWeight = { High: 2, Medium: 1, Low: 0 };
    return (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0);
  });
}

function buildAIAgentAgencyEmail(task) {
  const subject = `[VisaFlow Follow-up] ${task.title}`;
  const body = `Dear ${task.agency} Team,

VisaFlow AI Agent detected an item requiring your immediate update.

Follow-up Type: ${task.type}
Priority: ${task.priority}
Reference: ${task.reference || "-"}
Request No: ${task.request_no || "-"}

Reason:
${task.reason}

Required Action:
${task.action_required}

Please update the candidate / authorization record in the Office Portal or reply with the latest status, expected completion date, and any blockers.

Best regards,
VisaFlow AI Agent
Recruitment Follow-up Assistant`;

  return { subject, body };
}

function getAIAgentAgencyFitScore(request, agencyRow) {
  const agencyName = agencyRow.agency || agencyRow.name || "";
  const requestProfession = request?.profession || getRequestLineSummary(request, "profession") || "";
  const requestNationality = request?.nationality || getRequestLineSummary(request, "nationality") || "";
  const requestQty = Number(request?.quantity || request?.qty || 0);
  const scorecard = buildAgencyScorecard().find((row) => normalize(row.agency) === normalize(agencyName)) || {};
  const policy = getAgencyAgreementPolicy(agencyName);
  const agencyCandidates = candidates.filter((candidate) => normalize(candidate.agency) === normalize(agencyName));
  const professionExperience = agencyCandidates.filter((candidate) => isCompatibleText(candidate.profession, requestProfession)).length;
  const nationalityExperience = agencyCandidates.filter((candidate) => normalize(candidate.nationality) === normalize(requestNationality)).length;
  const activeAuthorizations = visaAuthorizations.filter((authorization) => normalize(authorization.agency) === normalize(agencyName) && authorization.status !== "Cancelled");
  const openLoad = activeAuthorizations.reduce((sum, authorization) => sum + Number(authorization.allocated_qty || 0), 0);

  let score = 40;
  score += Math.min(Number(scorecard.score || 0) * 0.30, 30);
  if (policy.has_active_agreement) score += 12;
  if (professionExperience > 0) score += Math.min(10, professionExperience * 2);
  if (nationalityExperience > 0) score += Math.min(10, nationalityExperience * 2);
  if (scorecard.risk === "Low") score += 8;
  if (scorecard.risk === "High") score -= 18;
  if (openLoad > 0 && requestQty > 0) score -= Math.min(12, Math.round(openLoad / Math.max(requestQty, 1)));
  if (String(agencyRow.status || "Active") === "Inactive") score -= 30;

  score = Math.max(0, Math.min(100, Math.round(score)));

  const reasons = [];
  if (policy.has_active_agreement) reasons.push(`Active SLA agreement ${policy.agreement_no}`);
  else reasons.push("No active SLA agreement found");
  if (professionExperience > 0) reasons.push(`Handled ${professionExperience} similar profession candidate(s)`);
  if (nationalityExperience > 0) reasons.push(`Handled ${nationalityExperience} candidate(s) from ${requestNationality || "same nationality"}`);
  if (scorecard.score) reasons.push(`Agency score ${scorecard.score} / Risk ${scorecard.risk}`);
  if (openLoad > 0) reasons.push(`Current open authorization load ${openLoad}`);

  return {
    score,
    reasons,
    scorecard,
    policy,
    professionExperience,
    nationalityExperience,
    openLoad,
  };
}

function getAIAgentRequestAssignmentRecommendations() {
  const openStatuses = ["Open", "Under Recruitment", "Interview Stage", "Visa Process"];
  const activeAgencies = agencies.filter((agency) => String(agency.status || "Active") !== "Inactive");

  return requests
    .filter((request) => openStatuses.includes(request.status || "Open"))
    .map((request) => {
      const relatedCandidates = candidates.filter((candidate) => String(candidate.request_no || "") === String(request.request_no || "") && !["Rejected", "Interview Failed", "Medical Failed", "Cancelled", "Joined"].includes(candidate.status));
      const requiredQty = getRequestTotalQty(request);
      const remaining = Math.max(requiredQty - relatedCandidates.length, 0);
      if (remaining <= 0) return null;

      const rankedAgencies = activeAgencies
        .map((agency) => {
          const fit = getAIAgentAgencyFitScore(request, { ...agency, agency: agency.name });
          return {
            ...agency,
            agency: agency.name,
            fitScore: fit.score,
            fitReasons: fit.reasons,
            risk: fit.scorecard.risk || "New",
            agencyScore: fit.scorecard.score || 0,
            hasAgreement: fit.policy.has_active_agreement,
            agreementNo: fit.policy.agreement_no,
            openLoad: fit.openLoad,
          };
        })
        .sort((a, b) => Number(b.fitScore || 0) - Number(a.fitScore || 0));

      const bestAgency = rankedAgencies[0] || null;
      const createdAt = request.created_at ? new Date(request.created_at) : null;
      const daysOpen = createdAt ? Math.max(0, Math.floor((new Date() - createdAt) / (1000 * 60 * 60 * 24))) : 0;
      const priority = request.priority || (daysOpen >= 15 ? "High" : "Medium");

      return {
        request,
        request_no: request.request_no || "-",
        project: request.project_name || request.project || "-",
        profession: request.profession || getRequestLineSummary(request, "profession") || "-",
        nationality: request.nationality || getRequestLineSummary(request, "nationality") || "-",
        gender: request.gender || getRequestLineSummary(request, "gender") || "-",
        requiredQty,
        currentCandidates: relatedCandidates.length,
        remaining,
        daysOpen,
        priority,
        bestAgency,
        rankedAgencies: rankedAgencies.slice(0, 3),
        recommendation: bestAgency
          ? `Assign ${request.request_no || "request"} to ${bestAgency.agency}. Fit score ${bestAgency.fitScore}%. Ask for first batch within 72 hours.`
          : "No active agency found. Add agency or activate agreement first.",
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.remaining || 0) - Number(a.remaining || 0));
}

function buildAIAgentManagerBrief() {
  const assignmentRecommendations = getAIAgentRequestAssignmentRecommendations();
  const followUpTasks = getAIAgentAgencyTasks();
  const highPriorityFollowUps = followUpTasks.filter((task) => task.priority === "High");
  const staleAlerts = getAgencySlaEscalationAlerts();
  const riskyAgencies = buildAgencyScorecard().filter((row) => row.risk !== "Low");

  return {
    assignmentRecommendations,
    followUpTasks,
    highPriorityFollowUps,
    staleAlerts,
    riskyAgencies,
    summary: [
      `${assignmentRecommendations.length} request(s) need agency assignment recommendation.`,
      `${followUpTasks.length} agency follow-up task(s) are open.`,
      `${highPriorityFollowUps.length} high-priority follow-up(s) require manager attention.`,
      `${staleAlerts.length} candidate update compliance alert(s).`,
      `${riskyAgencies.length} agency risk item(s).`,
    ].join("\n"),
  };
}

async function createAIAgentManagerBriefNotification() {
  const brief = buildAIAgentManagerBrief();
  const title = "AI Agent Daily Recruitment Brief";
  const message = `VisaFlow AI Agent daily brief:\n\n${brief.summary}\n\nTop recommendation: ${brief.assignmentRecommendations[0]?.recommendation || "No assignment recommendation currently."}`;

  await triggerExternalNotification("AI_AGENT_DAILY_BRIEF", {
    company_id: currentCompanyId,
    user_id: currentUser?.id || null,
    title,
    message,
    priority: brief.highPriorityFollowUps.length ? "High" : "Medium",
    related_table: "requests",
    related_id: brief.assignmentRecommendations[0]?.request_no || "",
    source: "AI Agent",
    delivery_channel: "Manager Notification",
    brief,
  });

  await loadNotifications();
  alert("AI Agent daily brief created for Recruitment Manager.");
}

function getRecruitmentManagerEmails() {
  const configuredManagerEmail = getAIAgentManagerEmailOverride();
  if (configuredManagerEmail) return configuredManagerEmail;

  const roleMatches = ["recruitment manager", "recruitment_manager", "manager recruitment", "مدير التوظيف"];
  const managerEmails = (users || [])
    .filter((user) => String(user?.company_id || currentCompanyId) === String(currentCompanyId))
    .filter((user) => user?.is_active !== false)
    .filter((user) => {
      const role = normalize(user?.role || user?.position || user?.job_title || "");
      return roleMatches.some((item) => role.includes(normalize(item)));
    })
    .map((user) => user.email || user.user_email || user.work_email)
    .filter(Boolean);

  const uniqueEmails = Array.from(new Set(managerEmails.map((email) => String(email).trim()).filter(Boolean)));
  return uniqueEmails.join(", ") || getCompanyEmailRecipient("notifications");
}

function buildAIAgentAssignmentApprovalContent(item) {
  const title = `Manager Approval Required - ${item.request_no}`;
  const reason = item.bestAgency?.fitReasons?.length ? item.bestAgency.fitReasons.join("; ") : "Best current fit based on agency performance and available request data.";
  const message = `AI Agent recommends assigning ${item.request_no} to ${item.bestAgency.agency}.

Reason: ${reason}

Suggested action: approve and notify agency to submit first candidate batch within 72 hours.`;
  const subject = `[VisaFlow AI Agent] Approval Required - ${item.request_no}`;
  const emailLines = [
    `AI Recruitment Agent detected a request that needs agency assignment approval.`,
    `Request No: ${item.request_no}`,
    `Project: ${item.project || "-"}`,
    `Profession: ${item.profession || "-"}`,
    `Nationality: ${item.nationality || "-"}`,
    `Gender: ${item.gender || "-"}`,
    `Required Quantity: ${item.requiredQty || 0}`,
    `Remaining Quantity: ${item.remaining || 0}`,
    `Recommended Agency: ${item.bestAgency.agency}`,
    `Fit Score: ${item.bestAgency.fitScore || 0}%`,
    `Reason: ${reason}`,
    `Suggested Action: Approve assignment and request first candidate batch within 72 hours.`,
  ];

  return { title, message, subject, emailLines };
}

async function hasAIAgentAssignmentApproval(item) {
  if (!currentCompanyId || !item?.request_no) return false;

  const { data, error } = await supabase
    .from("notification_events")
    .select("id")
    .eq("company_id", currentCompanyId)
    .eq("type", "AI_AGENT_ASSIGNMENT_APPROVAL")
    .eq("related_id", item.request_no)
    .limit(1);

  if (error) {
    console.warn("AI Agent duplicate check failed", error.message);
    return false;
  }

  return (data || []).length > 0;
}

async function prepareAIAgentAssignmentApproval(item, options = {}) {
  const { silent = false, preventDuplicate = false, auto = false } = options;

  if (!item?.bestAgency) {
    if (!silent) alert("No recommended agency found for this request.");
    return { ok: false, reason: "No recommended agency" };
  }

  if (preventDuplicate && await hasAIAgentAssignmentApproval(item)) {
    await writeAIAgentAuditLog({
      actionType: auto ? "AI_AGENT_AUTO_MANAGER_APPROVAL" : "AI_AGENT_MANAGER_APPROVAL",
      actionKey: `manager_approval:${item.request_no}:${item.bestAgency.id || item.bestAgency.agency}`,
      status: "skipped",
      severity: "warning",
      title: "Manager approval duplicate skipped",
      targetTable: "requests",
      targetId: item.request_no,
      agencyId: item.bestAgency.id || null,
      agencyName: item.bestAgency.agency,
      requestNo: item.request_no,
      details: { reason: "notification_exists" },
    });
    return { ok: true, skipped: true, reason: "Already prepared" };
  }

  const actionType = auto ? "AI_AGENT_AUTO_MANAGER_APPROVAL" : "AI_AGENT_MANAGER_APPROVAL";
  const actionKey = `manager_approval:${item.request_no}:${item.bestAgency.id || item.bestAgency.agency}`;
  const lock = await acquireAIAgentActionLock({
    actionType,
    actionKey,
    relatedTable: "requests",
    relatedId: item.request_no,
    agencyId: item.bestAgency.id || null,
    title: `Manager approval prepared for ${item.request_no}`,
    details: { recommended_agency: item.bestAgency.agency, fit_score: item.bestAgency.fitScore || 0, auto },
  });

  if (!lock.ok) return { ok: true, skipped: true, reason: lock.reason || "Duplicate lock" };

  const content = buildAIAgentAssignmentApprovalContent(item);
  const managerEmail = getRecruitmentManagerEmails();

  await triggerExternalNotification("AI_AGENT_ASSIGNMENT_APPROVAL", {
    company_id: currentCompanyId,
    user_id: currentUser?.id || null,
    agency_id: item.bestAgency.id || null,
    agency_name: item.bestAgency.agency,
    agency_email: item.bestAgency.email || "",
    manager_email: managerEmail,
    title: content.title,
    message: content.message,
    subject: content.subject,
    priority: item.priority || "Medium",
    related_table: "requests",
    related_id: item.request_no,
    source: auto ? "AI Agent Auto Mode / Request Assignment" : "AI Agent / Request Assignment Recommendations",
    delivery_channel: "Manager Approval Inbox + Email",
    recommendation: item,
    auto_generated: auto,
  });

  try {
    await dispatchVisaFlowEmail({
      type: actionType,
      to: managerEmail,
      subject: content.subject,
      text: content.emailLines.join("\n"),
      html: buildEmailCardHtml(content.subject, content.emailLines, "This approval was prepared automatically by VisaFlow AI Recruitment Agent."),
      payload: {
        request_no: item.request_no,
        recommended_agency: item.bestAgency.agency,
        fit_score: item.bestAgency.fitScore || 0,
        auto_generated: auto,
      },
    });
  } catch (error) {
    console.warn("AI Agent manager email failed", error?.message || error);
  }

  await writeAIAgentAuditLog({
    actionType,
    actionKey,
    status: "completed",
    severity: "info",
    title: `Manager approval notification prepared for ${item.request_no}`,
    targetTable: "requests",
    targetId: item.request_no,
    agencyId: item.bestAgency.id || null,
    agencyName: item.bestAgency.agency,
    requestNo: item.request_no,
    details: { recommended_agency: item.bestAgency.agency, fit_score: item.bestAgency.fitScore || 0, auto },
  });

  if (!silent) {
    await loadNotifications();
    await loadEmailLogs();
    alert(auto ? "AI Agent sent approval notification to Recruitment Manager automatically." : "Manager approval notification sent.");
  }

  return { ok: true, skipped: false };
}

async function createAIAgentAssignmentApproval(item) {
  await prepareAIAgentAssignmentApproval(item, { silent: false, preventDuplicate: false, auto: false });
}

async function notifyAgencyFromAIAgentRecommendation(item) {
  if (!item?.bestAgency) return alert("No recommended agency found for this request.");

  const agencyEmail = item.bestAgency.email || "";
  const subject = `[VisaFlow Assignment] ${item.request_no} - ${item.profession}`;
  const body = `Dear ${item.bestAgency.agency} Team,\n\nVisaFlow AI Recruitment Agent has prepared a new request assignment for your review.\n\nRequest No: ${item.request_no}\nProject: ${item.project}\nProfession: ${item.profession}\nNationality: ${item.nationality}\nGender: ${item.gender}\nRequired Quantity: ${item.requiredQty}\nRemaining Quantity: ${item.remaining}\nPriority: ${item.priority}\n\nRequired Action:\nPlease confirm availability and submit the first candidate batch within 72 hours through the Office Portal.\n\nBest regards,\nVisaFlow AI Recruitment Agent`;

  await triggerExternalNotification("AI_AGENT_AGENCY_ASSIGNMENT", {
    company_id: currentCompanyId,
    agency_id: item.bestAgency.id || null,
    agency_name: item.bestAgency.agency,
    agency_email: agencyEmail,
    title: `Agency Assignment Prepared - ${item.request_no}`,
    message: body,
    subject,
    priority: item.priority || "Medium",
    related_table: "requests",
    related_id: item.request_no,
    source: "AI Agent / Agency Assignment",
    delivery_channel: "Notification + Email Automation",
    recommendation: item,
  });

  await loadNotifications();
  alert("Agency assignment notification prepared.");
}

async function runAIAgentAutoManagerApprovals({ limit = getAIAgentMaxAutoActions() } = {}) {
  if (!currentCompanyId || isCurrentAgencyUser) return;
  if (!isAIAgentManagerAutoEnabled()) return;
  if (!canManageAgencyAgreements && !canManageCandidates && !canManageUsers && !canManagePlatform) return;
  if (!requests.length || !agencies.length) return;

  const recommendations = getAIAgentRequestAssignmentRecommendations()
    .filter((item) => item?.bestAgency)
    .slice(0, limit);

  if (!recommendations.length) return;

  setAiAgentLoading(true);
  try {
    let created = 0;
    let skipped = 0;

    for (const item of recommendations) {
      const result = await prepareAIAgentAssignmentApproval(item, {
        silent: true,
        preventDuplicate: true,
        auto: true,
      });

      if (result?.skipped) skipped += 1;
      else if (result?.ok) created += 1;
    }

    if (created > 0) {
      const summary = `AI Agent Auto Mode sent ${created} manager approval notification(s). ${skipped ? `${skipped} duplicate item(s) skipped.` : ""}`;
      setAiAgentLog(summary);
      setAiAgentLastRun(new Date().toLocaleString());
      await loadNotifications();
      await loadEmailLogs();
    }
  } catch (error) {
    console.warn("AI Agent Auto Mode failed", error?.message || error);
    setAiAgentLog(`AI Agent Auto Mode failed: ${error.message}`);
  } finally {
    setAiAgentLoading(false);
  }
}

async function hasAIAgentFollowUpToday(task, type = "AI_AGENT_AUTO_AGENCY_FOLLOWUP") {
  if (!currentCompanyId || !task) return false;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  let query = supabase
    .from("notification_events")
    .select("id")
    .eq("company_id", currentCompanyId)
    .eq("type", type)
    .eq("related_table", task.related_table || "")
    .eq("related_id", task.related_id || "")
    .gte("created_at", startOfDay.toISOString())
    .limit(1);

  if (task.agency_id) query = query.eq("agency_id", task.agency_id);

  const { data, error } = await query;
  if (error) {
    console.warn("AI Agent follow-up duplicate check failed", error.message);
    return false;
  }

  return (data || []).length > 0;
}

async function sendAIAgentAgencyFollowUpTask(task, options = {}) {
  const { auto = false, sendEmail = false } = options;
  const email = buildAIAgentAgencyEmail(task);
  const type = auto ? "AI_AGENT_AUTO_AGENCY_FOLLOWUP" : "AI_AGENT_AGENCY_FOLLOWUP";
  const actionKey = getAIAgentFollowUpDedupeKey(task);

  const lock = await acquireAIAgentActionLock({
    actionType: type,
    actionKey,
    relatedTable: task.related_table || "",
    relatedId: task.related_id || "",
    agencyId: task.agency_id || null,
    title: task.title || "Agency follow-up",
    details: { agency: task.agency, request_no: task.request_no, priority: task.priority, sendEmail, auto },
  });

  if (!lock.ok) return { ok: true, skipped: true, reason: lock.reason || "Duplicate lock" };

  await triggerExternalNotification(type, {
    company_id: currentCompanyId,
    agency_id: task.agency_id || null,
    agency_name: task.agency,
    agency_email: task.agency_email || "",
    title: task.title,
    message: email.body,
    subject: email.subject,
    priority: task.priority,
    related_table: task.related_table,
    related_id: task.related_id,
    source: auto ? "AI Agent Auto Follow-up" : "AI Commander / AI Agent",
    delivery_channel: sendEmail ? "Notification + Email" : "Notification Only",
    auto_generated: auto,
    dedupe_key: getAIAgentFollowUpDedupeKey(task),
    task,
  });

  if (sendEmail && task.agency_email) {
    await dispatchVisaFlowEmail({
      type,
      to: task.agency_email,
      subject: email.subject,
      text: email.body,
      html: buildEmailCardHtml(email.subject, email.body.split("\n"), "This follow-up was generated by VisaFlow AI Recruitment Agent."),
      payload: {
        agency: task.agency,
        request_no: task.request_no,
        reference: task.reference,
        priority: task.priority,
        auto_generated: auto,
        dedupe_key: actionKey,
      },
    });
  }

  await writeAIAgentAuditLog({
    actionType: type,
    actionKey,
    status: "completed",
    severity: task.priority === "High" ? "warning" : "info",
    title: task.title,
    targetTable: task.related_table,
    targetId: task.related_id,
    agencyId: task.agency_id || null,
    agencyName: task.agency,
    requestNo: task.request_no,
    details: { task, sendEmail, auto },
  });

  return { ok: true, skipped: false, emailSkipped: Boolean(sendEmail && !task.agency_email) };
}

async function processAIAgentAgencyFollowUps(options = {}) {
  const { auto = false, limit = 50, silent = false, sendEmail = false } = options;

  if (!canManageAgencyAgreements && !canManageCandidates && !canManageVisas && !canManageUsers && !canManagePlatform) {
    if (!silent) alert("You do not have permission to run AI Agent follow-up.");
    return { ok: false, created: 0, skipped: 0, reason: "Permission denied" };
  }

  if (auto && !isAIAgentAgencyFollowUpAutoEnabled()) {
    return { ok: true, created: 0, skipped: 0, reason: "Auto follow-up is disabled" };
  }

  const tasks = getAIAgentAgencyTasks();
  if (!tasks.length) {
    if (!silent) {
      setAiAgentLog("No agency follow-up tasks found. All agencies are within current follow-up rules.");
      setAiAgentLastRun(new Date().toLocaleString());
      alert("No agency follow-up tasks found.");
    }
    return { ok: true, created: 0, skipped: 0, reason: "No tasks" };
  }

  setAiAgentLoading(true);
  if (!silent) setAiAgentLog("");

  try {
    const selectedTasks = tasks.slice(0, limit);
    let created = 0;
    let skipped = 0;
    let emailSkipped = 0;

    for (const task of selectedTasks) {
      if (auto && await hasAIAgentFollowUpToday(task, "AI_AGENT_AUTO_AGENCY_FOLLOWUP")) {
        skipped += 1;
        continue;
      }

      const result = await sendAIAgentAgencyFollowUpTask(task, { auto, sendEmail });
      if (result?.skipped) {
        skipped += 1;
        continue;
      }
      created += 1;
      if (result?.emailSkipped) emailSkipped += 1;
    }

    const summary = `${auto ? "AI Agent Auto Follow-up" : "AI Agent Manual Follow-up"} completed for ${created} item(s). ${skipped ? `${skipped} duplicate item(s) skipped for today.` : ""}${sendEmail ? ` ${emailSkipped ? `${emailSkipped} item(s) had no agency email.` : "Emails enabled."}` : " Notifications only."}\n\n` +
      selectedTasks.slice(0, 10).map((task, index) => `${index + 1}. [${task.priority}] ${task.agency} - ${task.title}`).join("\n") +
      (selectedTasks.length > 10 ? `\n...and ${selectedTasks.length - 10} more.` : "");

    setAiAgentLog(summary);
    setAiAgentLastRun(new Date().toLocaleString());
    await loadNotifications();
    if (sendEmail) await loadEmailLogs();

    if (!silent) alert(`AI Agent follow-up created: ${created} item(s).`);
    return { ok: true, created, skipped };
  } catch (error) {
    setAiAgentLog(`AI Agent failed: ${error.message}`);
    if (!silent) alert(error.message);
    return { ok: false, created: 0, skipped: 0, reason: error.message };
  } finally {
    setAiAgentLoading(false);
  }
}

async function runAIAgentAutoAgencyFollowUp({ limit = getAIAgentMaxAutoActions() } = {}) {
  return processAIAgentAgencyFollowUps({
    auto: true,
    limit,
    silent: true,
    sendEmail: shouldAIAgentSendAgencyEmails(),
  });
}

async function runAIAgentAgencyFollowUp() {
  return processAIAgentAgencyFollowUps({
    auto: false,
    limit: 50,
    silent: false,
    sendEmail: shouldAIAgentSendAgencyEmails(),
  });
}

function getCandidateRequest(candidate) {
  return requests.find((request) => String(request.request_no || "") === String(candidate?.request_no || ""));
}

function getCandidateOfferData(candidate) {
  const req = getCandidateRequest(candidate) || {};
  const salary = candidate?.salary || req.salary || req.budget || "To be confirmed";
  const project = candidate?.project || req.project_name || req.project || "Company Project";
  const joiningDate = candidate?.joining_date || "To be confirmed";
  const isSaudiFlow = isSaudiCandidate(candidate, requests);

  return {
    candidateName: candidate?.candidate_name || "Candidate",
    candidateEmail: candidate?.email || "",
    profession: candidate?.profession || req.profession || "Position",
    nationality: candidate?.nationality || req.nationality || "-",
    project,
    salary,
    joiningDate,
    requestNo: candidate?.request_no || req.request_no || "-",
    recruitmentType: isSaudiFlow ? "Saudi Hiring" : "Foreign Recruitment",
    companyName: "VisaFlow KSA Client",
  };
}

function buildOfferSubject(candidate) {
  const data = getCandidateOfferData(candidate);
  return `Job Offer - ${data.profession} - ${data.candidateName}`;
}

function buildOfferBody(candidate) {
  const data = getCandidateOfferData(candidate);
  return `Dear ${data.candidateName},

We are pleased to inform you that you have successfully passed the interview for the position of ${data.profession}.

We are delighted to extend this job offer to you based on the following initial details:

Position: ${data.profession}
Project / Department: ${data.project}
Recruitment Type: ${data.recruitmentType}
Monthly Salary / Package: ${data.salary} SAR
Expected Joining Date: ${data.joiningDate}
Reference Request No: ${data.requestNo}

Please reply to this email confirming your acceptance of the offer. Once your acceptance is received, the recruitment team will proceed with the next steps.

Best regards,
Recruitment Department
${data.companyName}`;
}

async function generateOfferWithAI(candidate) {
  const data = getCandidateOfferData(candidate);

  try {
    const aiDraft = await callVisaFlowAIEdge({
      action: "offer",
      offerData: data,
      language: "English",
    });

    return aiDraft || buildOfferBody(candidate);
  } catch (error) {
    console.warn("AI offer generation failed", error?.message || error);
    return buildOfferBody(candidate);
  }
}

async function openOfferEmail(candidate) {
  if (!candidate) return alert("Candidate not found.");

  setOfferCandidate(candidate);
  setOfferSubject(buildOfferSubject(candidate));
  setOfferBody(buildOfferBody(candidate));
  setOfferMessage("");
  setOfferModalOpen(true);

  setOfferLoading(true);
  try {
    const aiDraft = await generateOfferWithAI(candidate);
    setOfferBody(aiDraft);
  } finally {
    setOfferLoading(false);
  }
}

async function sendOfferEmail() {
  if (!offerCandidate) return alert("Candidate is required.");
  if (!offerCandidate.email) return alert("Candidate email is missing. Please add candidate email first.");
  if (!offerSubject || !offerBody) return alert("Offer subject and body are required.");

  setOfferLoading(true);
  setOfferMessage("");

  const payload = {
    type: "JOB_OFFER_EMAIL",
    to: offerCandidate.email,
    subject: offerSubject,
    body: offerBody,
    candidate_id: offerCandidate.id,
    candidate_name: offerCandidate.candidate_name,
    request_no: offerCandidate.request_no,
    profession: offerCandidate.profession,
    created_by: currentUser?.email || currentUser?.name || "VisaFlow User",
    created_at: new Date().toISOString(),
  };

  try {
    const emailResult = await dispatchVisaFlowEmail({
      type: "JOB_OFFER_EMAIL",
      to: offerCandidate.email,
      subject: offerSubject,
      text: offerBody,
      html: buildEmailCardHtml(offerSubject, offerBody.split("\n").filter(Boolean)),
      replyTo: getCompanyEmailRecipient("support"),
      payload,
    });

    const deliveryStatus = "SENT";
    const providerMessage = `Offer email sent successfully${emailResult?.messageId ? ` (${emailResult.messageId})` : ""}.`;

    await triggerExternalNotification("JOB_OFFER_EMAIL", {
      ...payload,
      delivery_status: deliveryStatus,
      provider_message: providerMessage,
    });

    await supabase
      .from("candidates")
      .update({
        offer_status: "Sent",
        contract_status: "Sent",
        status: offerCandidate.status === "Interview Passed" ? "Selected" : offerCandidate.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", offerCandidate.id);

    await loadCandidates();
    setOfferMessage(providerMessage);
  } catch (error) {
    setOfferMessage(`Failed to send offer email: ${error.message}`);
  } finally {
    setOfferLoading(false);
  }
}


function generateMarketplaceNo(prefix, rows, field, digits = 4) {
  const year = new Date().getFullYear();
  const maxNumber = (rows || []).reduce((max, item) => {
    const value = String(item?.[field] || "");
    const parts = value.split("-");
    if (parts[0] !== prefix || parts[1] !== String(year)) return max;
    const n = parseInt(parts[2] || "0", 10);
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);
  return `${prefix}-${year}-${String(maxNumber + 1).padStart(digits, "0")}`;
}

function resetMarketplaceRequestForm() {
  setMarketplaceRequestForm(emptyMarketplaceRequest);
  setMarketplaceRequestEditingId(null);
}

function editMarketplaceRequest(item) {
  setMarketplaceRequestEditingId(item.id);
  setMarketplaceRequestForm({
    request_no: item.request_no || "",
    client_name: item.client_name || "",
    profession: item.profession || "",
    nationality: item.nationality || "",
    gender: item.gender || "",
    quantity: item.quantity || "",
    duration_months: item.duration_months || 12,
    monthly_rate: item.monthly_rate || "",
    status: item.status || "Open",
    notes: item.notes || "",
  });
  setActivePage("Workforce Marketplace");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function saveMarketplaceRequest() {
  if (!canManageMarketplace) return alert("You do not have permission to manage marketplace requests.");
  if (!marketplaceRequestForm.client_name || !marketplaceRequestForm.profession || !marketplaceRequestForm.quantity) {
    return alert("Client, profession and quantity are required.");
  }

  const payload = {
    ...marketplaceRequestForm,
    notes: marketplaceRequestForm.notes || "",
    request_no: marketplaceRequestEditingId
      ? marketplaceRequestForm.request_no
      : (marketplaceRequestForm.request_no || generateMarketplaceNo("WR", marketplaceRequests, "request_no", 4)),
    quantity: Number(marketplaceRequestForm.quantity || 0),
    duration_months: Number(marketplaceRequestForm.duration_months || 1),
    monthly_rate: Number(marketplaceRequestForm.monthly_rate || 0),
    updated_at: new Date().toISOString(),
  };

  const result = marketplaceRequestEditingId
    ? await supabase
        .from("marketplace_requests")
        .update(payload)
        .eq("id", marketplaceRequestEditingId)
        .eq("company_id", currentCompanyId)
    : await supabase.from("marketplace_requests").insert([withCompany(payload)]);

  if (result.error) return alert(result.error.message);
  alert(marketplaceRequestEditingId ? "Marketplace request updated" : `Marketplace request saved: ${payload.request_no}`);
  resetMarketplaceRequestForm();
  await loadMarketplaceRequests();
}

async function deleteMarketplaceRequest(id) {
  if (!canManageMarketplace) return alert("You do not have permission to delete marketplace requests.");
  if (!window.confirm("Delete this marketplace request?")) return;
  const { error } = await supabase
    .from("marketplace_requests")
    .delete()
    .eq("id", id)
    .eq("company_id", currentCompanyId);
  if (error) return alert(error.message);
  await loadMarketplaceRequests();
}

function getMarketplaceMatches(item) {
  const availableDemob = demobilizations
    .filter((employee) => ["Available", "Suggested"].includes(employee.status || "Available"))
    .filter((employee) =>
      normalize(employee.profession) === normalize(item.profession) &&
      (!item.nationality || !employee.nationality || normalize(item.nationality) === normalize(employee.nationality)) &&
      (!item.gender || !employee.gender || normalize(item.gender) === normalize(employee.gender))
    );

  const availableEmployees = employees
    .filter((employee) => ["Active", "Demobilized"].includes(employee.status || "Active"))
    .filter((employee) =>
      normalize(employee.profession) === normalize(item.profession) &&
      (!item.nationality || !employee.nationality || normalize(item.nationality) === normalize(employee.nationality)) &&
      (!item.gender || !employee.gender || normalize(item.gender) === normalize(employee.gender))
    );

  return { demobilized: availableDemob, employees: availableEmployees, total: availableDemob.length + availableEmployees.length };
}

async function createMarketplaceDeal(item) {
  if (!canManageMarketplace) return alert("You do not have permission to create marketplace deals.");
  const matches = getMarketplaceMatches(item);
  if (matches.total <= 0 && !window.confirm("No matching available workforce found. Create deal anyway?")) return;

  const qty = Math.min(Number(item.quantity || 0), Math.max(matches.total, Number(item.quantity || 0)));
  const monthlyRate = Number(item.monthly_rate || 0);
  const durationMonths = Number(item.duration_months || 1);
  const totalValue = qty * monthlyRate * durationMonths;

  const payload = {
    deal_no: generateMarketplaceNo("DEAL", marketplaceDeals, "deal_no", 4),
    marketplace_request_id: item.id,
    client_name: item.client_name || "",
    service_type: "Manpower Supply",
    profession: item.profession || "",
    quantity: qty,
    duration_months: durationMonths,
    monthly_rate: monthlyRate,
    total_value: totalValue,
    status: "Draft",
    notes: [
      `Created from ${item.request_no || "marketplace request"}. AI matched ${matches.total} available employee(s).`,
      item.notes ? `Client request notes: ${item.notes}` : "",
    ].filter(Boolean).join("\n"),
    updated_at: new Date().toISOString(),
  };

  const result = await supabase.from("marketplace_deals").insert([withCompany(payload)]);
  if (result.error) return alert(result.error.message);

  await supabase
    .from("marketplace_requests")
    .update({ status: "Converted", updated_at: new Date().toISOString() })
    .eq("id", item.id)
    .eq("company_id", currentCompanyId);

  alert(`Deal created: ${payload.deal_no}`);
  await loadMarketplaceRequests();
  await loadMarketplaceDeals();
}

async function generateInvoiceFromDeal(deal) {
  if (!canManageMarketplace) return alert("You do not have permission to generate invoices.");
  const subtotal = Number(deal.total_value || 0);
  const vat = Math.round(subtotal * 0.15 * 100) / 100;
  const total = subtotal + vat;
  const invoiceNo = generateMarketplaceNo("INV", marketplaceInvoices, "invoice_no", 6);

  const invoicePayload = {
    invoice_no: invoiceNo,
    deal_id: deal.id,
    client_name: deal.client_name || "",
    invoice_date: new Date().toISOString().slice(0, 10),
    due_date: null,
    service_type: deal.service_type || "Manpower Supply",
    subtotal,
    vat_amount: vat,
    total_amount: total,
    paid_amount: 0,
    balance_amount: total,
    status: "Draft",
    notes: [
      `Generated from deal ${deal.deal_no || "-"}`,
      deal.notes ? `Deal notes: ${deal.notes}` : "",
    ].filter(Boolean).join("\n"),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("invoices")
    .insert([withCompany(invoicePayload)])
    .select()
    .single();

  if (error) return alert(error.message);

  await supabase.from("invoice_items").insert([withCompany({
    invoice_id: data.id,
    description: `${deal.service_type || "Manpower Supply"} - ${deal.profession || "Workforce"}`,
    quantity: Number(deal.quantity || 1),
    unit_price: Number(deal.monthly_rate || 0) * Number(deal.duration_months || 1),
    total: subtotal,
  })]);

  await supabase
    .from("marketplace_deals")
    .update({ status: "Invoiced", updated_at: new Date().toISOString() })
    .eq("id", deal.id)
    .eq("company_id", currentCompanyId);

  alert(`Invoice generated: ${invoiceNo}`);
  await loadMarketplaceDeals();
  await loadMarketplaceInvoices();
}

async function recordMarketplaceCollection(invoice) {
  if (!canManageMarketplace) return alert("You do not have permission to record collections.");
  const amountText = window.prompt("Enter collection amount:", String(invoice.balance_amount || invoice.total_amount || 0));
  if (!amountText) return;
  const amount = Number(amountText || 0);
  if (!amount || amount <= 0) return alert("Collection amount must be greater than zero.");
  const collectionNotes = window.prompt("Collection notes / reference:", "") || "";

  const newPaid = Number(invoice.paid_amount || 0) + amount;
  const total = Number(invoice.total_amount || 0);
  const balance = Math.max(total - newPaid, 0);
  const status = balance <= 0 ? "Paid" : "Partially Paid";

  const { error } = await supabase.from("collections").insert([withCompany({
    invoice_id: invoice.id,
    invoice_no: invoice.invoice_no,
    client_name: invoice.client_name,
    collection_date: new Date().toISOString().slice(0, 10),
    amount,
    payment_method: "Manual Entry",
    reference_no: "",
    status: "Received",
    notes: collectionNotes || "Marketplace collection entry",
  })]);
  if (error) return alert(error.message);

  const updateResult = await supabase
    .from("invoices")
    .update({ paid_amount: newPaid, balance_amount: balance, status, updated_at: new Date().toISOString() })
    .eq("id", invoice.id)
    .eq("company_id", currentCompanyId);
  if (updateResult.error) return alert(updateResult.error.message);

  alert("Collection recorded successfully");
  await loadMarketplaceInvoices();
  await loadMarketplaceCollections();
}

const marketplaceIntelligence = useMemo(() => {
  const availableDemob = demobilizations.filter((item) => ["Available", "Suggested"].includes(item.status || "Available"));
  const openClientRequests = marketplaceRequests.filter((item) => ["Open", "Under Review"].includes(item.status || "Open"));
  const potentialMatches = openClientRequests.reduce((sum, request) => sum + Math.min(Number(request.quantity || 0), getMarketplaceMatches(request).total), 0);
  const potentialRevenue = openClientRequests.reduce((sum, request) => {
    const matchQty = Math.min(Number(request.quantity || 0), getMarketplaceMatches(request).total);
    return sum + matchQty * Number(request.monthly_rate || 0) * Number(request.duration_months || 1);
  }, 0);
  const outstanding = marketplaceInvoices.reduce((sum, invoice) => sum + Number(invoice.balance_amount || invoice.total_amount || 0), 0);
  const collected = marketplaceCollections.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return {
    availableWorkforce: availableDemob.length,
    openClientRequests: openClientRequests.length,
    potentialMatches,
    potentialRevenue,
    activeDeals: marketplaceDeals.filter((deal) => deal.status !== "Cancelled").length,
    outstanding,
    collected,
  };
}, [demobilizations, marketplaceRequests, marketplaceDeals, marketplaceInvoices, marketplaceCollections]);


function getRecruiterName(item) {
  return (
    item?.recruiter ||
    item?.recruitment_officer ||
    item?.assigned_recruiter ||
    item?.assigned_to ||
    item?.created_by ||
    ""
  );
}

function itemBelongsToRecruiter(item, user) {
  const owner = getRecruiterName(item);
  if (!owner || !user) return false;

  const ownerText = normalize(owner);
  const aliases = [user.id, user.name, user.email]
    .map((value) => normalize(value))
    .filter(Boolean);

  return aliases.includes(ownerText);
}

function getRecruitmentGrade(score) {
  const value = Number(score || 0);
  if (value >= 90) return "A+";
  if (value >= 80) return "A";
  if (value >= 70) return "B";
  if (value >= 60) return "C";
  return "Needs Improvement";
}

function calculateRecruitmentPerformanceRows() {
  const excludedStatuses = ["Rejected", "Interview Failed", "Medical Failed", "Cancelled"];
  const joinedStatuses = ["Joined"];
  const arrivedStatuses = ["Arrived KSA", "Arrived", "Joined"];

  const performanceUsers = users.filter(isRecruitmentPerformanceUser);

  return performanceUsers.map((user) => {
    const name = user.name || user.email || "Recruitment User";

    const recruiterRequests = requests.filter((item) => itemBelongsToRecruiter(item, user));
    const requestNos = new Set(recruiterRequests.map((request) => String(request.request_no || "")).filter(Boolean));

    const recruiterCandidates = candidates.filter((candidate) =>
      itemBelongsToRecruiter(candidate, user) || requestNos.has(String(candidate.request_no || ""))
    );

    const candidateIds = new Set(recruiterCandidates.map((candidate) => String(candidate.id || "")).filter(Boolean));
    const candidatePassports = new Set(recruiterCandidates.map((candidate) => String(candidate.passport_no || "")).filter(Boolean));
    const candidateNames = new Set(recruiterCandidates.map((candidate) => normalize(candidate.candidate_name)).filter(Boolean));

    const recruiterInterviews = interviews.filter((interview) =>
      itemBelongsToRecruiter(interview, user) ||
      requestNos.has(String(interview.request_no || "")) ||
      candidateIds.has(String(interview.candidate_id || "")) ||
      candidatePassports.has(String(interview.passport_no || "")) ||
      candidateNames.has(normalize(interview.candidate_name))
    );

    const activeCandidates = recruiterCandidates.filter((candidate) => !excludedStatuses.includes(candidate.status));
    const passedInterviews = recruiterInterviews.filter((interview) => interview.status === "Passed").length;
    const rejectedInterviews = recruiterInterviews.filter((interview) => ["Rejected", "Interview Failed"].includes(interview.status)).length;
    const arrived = activeCandidates.filter((candidate) => arrivedStatuses.includes(candidate.status)).length;
    const joined = activeCandidates.filter((candidate) => joinedStatuses.includes(candidate.status)).length;
    const rejectedCandidates = recruiterCandidates.filter((candidate) => excludedStatuses.includes(candidate.status)).length;

    const closedRequests = recruiterRequests.filter((request) => {
      const qty = Number(request.quantity || request.qty || 0);
      const joinedCount = candidates.filter(
        (candidate) => String(candidate.request_no || "") === String(request.request_no || "") && candidate.status === "Joined"
      ).length;
      return request.status === "Closed" || request.status === "Completed" || (qty > 0 && joinedCount >= qty);
    }).length;

    const today = new Date();
    const withinSla = recruiterRequests.filter((request) => {
      const start = request.created_at;
      if (!start) return false;
      const requestCandidates = candidates.filter((candidate) => String(candidate.request_no || "") === String(request.request_no || ""));
      const latestCompletion = requestCandidates
        .map((candidate) => candidate.joining_date || candidate.arrival_date || candidate.updated_at || candidate.created_at)
        .filter(Boolean)
        .sort((a, b) => new Date(b) - new Date(a))[0];
      const end = latestCompletion || request.updated_at || today;
      const days = Math.floor((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24));
      return days <= 60;
    }).length;

    const totalRequests = recruiterRequests.length;
    const totalCandidates = recruiterCandidates.length;
    const totalInterviews = recruiterInterviews.length;

    const closureRate = totalRequests ? Math.round((closedRequests / totalRequests) * 100) : 0;
    const interviewPassRate = totalInterviews ? Math.round((passedInterviews / totalInterviews) * 100) : 0;
    const mobilizationRate = passedInterviews ? Math.round((joined / passedInterviews) * 100) : arrived ? 70 : 0;
    const rejectionPenalty = totalCandidates ? Math.round((rejectedCandidates / totalCandidates) * 100) : 0;
    const slaScore = totalRequests ? Math.round((withinSla / totalRequests) * 100) : 0;
    const productivityScore = Math.min(100, totalCandidates * 2 + totalRequests * 5 + joined * 4);

    const totalScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          closureRate * 0.25 +
          interviewPassRate * 0.20 +
          mobilizationRate * 0.20 +
          slaScore * 0.20 +
          productivityScore * 0.15 -
          rejectionPenalty * 0.20
        )
      )
    );

    let aiInsight = "Performance is stable. Continue monitoring open requests and candidate progress.";
    if (totalRequests === 0 && totalCandidates === 0 && totalInterviews === 0) {
      aiInsight = "User is included by recruitment role, but no assigned recruitment activity is linked yet.";
    } else if (totalScore >= 90) aiInsight = "Top performer. Consider assigning high-priority and strategic recruitment requests.";
    else if (totalScore >= 80) aiInsight = "Strong performance. Maintain workload and focus on faster mobilization closure.";
    else if (totalScore >= 70) aiInsight = "Good performance, but there is room to improve SLA and candidate quality.";
    else if (rejectionPenalty >= 30) aiInsight = "High rejection impact. Review sourcing quality and screening criteria.";
    else if (slaScore < 60 && totalRequests > 0) aiInsight = "SLA risk detected. Prioritize delayed requests and weekly follow-up.";
    else aiInsight = "Needs improvement. Reduce open gaps and review workload, sourcing method, and agency follow-up.";

    return {
      recruiter: name,
      role: user.role || "-",
      performance_category: "Recruitment",
      requests: totalRequests,
      closed_requests: closedRequests,
      candidates: totalCandidates,
      interviews: totalInterviews,
      passed_interviews: passedInterviews,
      rejected_interviews: rejectedInterviews,
      arrived,
      joined,
      rejected_candidates: rejectedCandidates,
      closure_rate: closureRate,
      interview_pass_rate: interviewPassRate,
      mobilization_rate: mobilizationRate,
      sla_score: slaScore,
      productivity_score: productivityScore,
      rejection_penalty: rejectionPenalty,
      total_score: totalScore,
      grade: getRecruitmentGrade(totalScore),
      ai_insight: aiInsight,
    };
  }).sort((a, b) => Number(b.total_score || 0) - Number(a.total_score || 0));
}

function getRecruitmentPerformanceSummary() {
  const rows = calculateRecruitmentPerformanceRows();
  const totalRequests = rows.reduce((sum, row) => sum + Number(row.requests || 0), 0);
  const closedRequests = rows.reduce((sum, row) => sum + Number(row.closed_requests || 0), 0);
  const totalCandidates = rows.reduce((sum, row) => sum + Number(row.candidates || 0), 0);
  const totalJoined = rows.reduce((sum, row) => sum + Number(row.joined || 0), 0);
  const avgScore = rows.length ? Math.round(rows.reduce((sum, row) => sum + Number(row.total_score || 0), 0) / rows.length) : 0;
  const topPerformer = rows[0] || null;
  const needsSupport = rows.filter((row) => Number(row.total_score || 0) < 70).length;

  return {
    rows,
    totalRequests,
    closedRequests,
    totalCandidates,
    totalJoined,
    avgScore,
    topPerformer,
    needsSupport,
  };
}


function generatePlatformNo(prefix, rows, field, digits = 5) {
  const year = new Date().getFullYear();
  const maxNumber = (rows || []).reduce((max, item) => {
    const value = String(item?.[field] || "");
    const parts = value.split("-");
    if (parts[0] !== prefix || parts[1] !== String(year)) return max;
    const number = parseInt(parts[2] || "0", 10);
    return Number.isFinite(number) ? Math.max(max, number) : max;
  }, 0);
  return `${prefix}-${year}-${String(maxNumber + 1).padStart(digits, "0")}`;
}

function getUsersForPlatformClient(client) {
  const operationalCompanyId = client?.operational_company_id || client?.company_id || "";
  if (!operationalCompanyId) return [];

  return users.filter((user) => String(user.company_id || "") === String(operationalCompanyId));
}

function getPrimaryAdminForPlatformClient(client) {
  const companyUsers = getUsersForPlatformClient(client);
  if (!companyUsers.length) return null;

  return (
    companyUsers.find((user) => String(user.role || "").toLowerCase() === "admin") ||
    companyUsers.find((user) => ["super admin", "ceo"].includes(String(user.role || "").toLowerCase())) ||
    companyUsers[0]
  );
}

function openPlatformClientUsers(client) {
  setSelectedPlatformClientUsers(client);
  setActivePage("Companies Management");
  setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }), 100);
}

function getPlatformClientName(clientId) {
  return platformClients.find((client) => String(client.id) === String(clientId))?.company_name || "-";
}

function getPlatformClient(clientId) {
  return platformClients.find((client) => String(client.id) === String(clientId)) || null;
}

function getPlatformClientByCompanyId(companyId) {
  const targetCompanyId = String(companyId || "");
  if (!targetCompanyId) return null;

  return platformClients.find((client) =>
    String(client.operational_company_id || client.company_id || "") === targetCompanyId
  ) || null;
}

function getBackupCompanyId(backup) {
  if (!backup) return "";
  if (String(backup.backup_type || "").toLowerCase().includes("full")) return "";

  return (
    backup.company_id ||
    getPlatformClient(backup.client_id)?.operational_company_id ||
    getPlatformClient(backup.client_id)?.company_id ||
    ""
  );
}

function getBackupCompanyName(backup) {
  if (!backup) return "-";
  if (String(backup.backup_type || "").toLowerCase().includes("full")) return "Full System";

  const client =
    getPlatformClient(backup.client_id) ||
    getPlatformClientByCompanyId(backup.company_id);

  return client?.company_name || backup.company_name || backup.company_id || "-";
}

function getRestoreCompanyName(restoreRequest) {
  const client = getPlatformClientByCompanyId(restoreRequest?.company_id);
  return client?.company_name || restoreRequest?.company_id || "-";
}

function calculateRequestMeetingReportRows(requestRows = [], candidateRows = [], mobilizationRows = []) {
  return (requestRows || []).map((request) => {
    const requestNo = String(request.request_no || "");
    const qty = Number(request.quantity || request.qty || 0);

    const relatedCandidates = (candidateRows || []).filter(
      (candidate) => String(candidate.request_no || "") === requestNo
    );

    const activeCandidates = relatedCandidates.filter(
      (candidate) => !["Rejected", "Interview Failed", "Medical Failed", "Cancelled"].includes(candidate.status)
    );

    const relatedMobilizations = (mobilizationRows || []).filter(
      (mobilization) =>
        String(mobilization.request_no || "") === requestNo ||
        relatedCandidates.some(
          (candidate) =>
            String(mobilization.candidate_id || "") === String(candidate.id || "") ||
            normalize(mobilization.candidate_name) === normalize(candidate.candidate_name)
        )
    );

    const arrived = activeCandidates.filter((candidate) =>
      ["Arrived KSA", "Arrived", "Joined"].includes(candidate.status) ||
      relatedMobilizations.some(
        (m) =>
          String(m.candidate_id || "") === String(candidate.id || "") &&
          ["Arrived KSA", "Joined"].includes(m.mobilization_status)
      )
    ).length;

    const joined = activeCandidates.filter((candidate) =>
      candidate.status === "Joined" ||
      relatedMobilizations.some(
        (m) =>
          String(m.candidate_id || "") === String(candidate.id || "") &&
          m.mobilization_status === "Joined"
      )
    ).length;

    const progress = qty ? Math.min(Math.round((joined / qty) * 100), 100) : 0;
    const daysOpen = request.created_at
      ? Math.floor((new Date() - new Date(request.created_at)) / (1000 * 60 * 60 * 24))
      : 0;

    let risk = "Low";
    if (["Cancelled", "Rejected"].includes(request.status)) risk = "High";
    else if (daysOpen > 30 && progress < 50) risk = "High";
    else if (daysOpen > 15 && progress < 70) risk = "Medium";

    return {
      request_no: request.request_no || "-",
      project: request.project_name || request.project || "-",
      profession: request.profession || "-",
      nationality: request.nationality || "-",
      gender: request.gender || "-",
      qty,
      candidates: activeCandidates.length,
      arrived,
      joined,
      remaining: Math.max(qty - joined, 0),
      progress,
      status: request.status || "Open",
      approval_status: request.approval_status || "-",
      days_open: daysOpen,
      risk,
    };
  }).sort((a, b) => Number(b.days_open || 0) - Number(a.days_open || 0));
}

function getCompanyReportSummary(rows = []) {
  const totalRequests = rows.length;
  const totalQty = rows.reduce((sum, row) => sum + Number(row.qty || 0), 0);
  const totalCandidates = rows.reduce((sum, row) => sum + Number(row.candidates || 0), 0);
  const totalArrived = rows.reduce((sum, row) => sum + Number(row.arrived || 0), 0);
  const totalJoined = rows.reduce((sum, row) => sum + Number(row.joined || 0), 0);
  const openRequests = rows.filter((row) => !["Closed", "Completed", "Cancelled"].includes(row.status)).length;
  const completedRequests = rows.filter((row) => row.progress >= 100 || ["Closed", "Completed"].includes(row.status)).length;
  const highRisk = rows.filter((row) => row.risk === "High").length;
  const mediumRisk = rows.filter((row) => row.risk === "Medium").length;
  const completion = totalQty ? Math.round((totalJoined / totalQty) * 100) : 0;

  return {
    totalRequests,
    openRequests,
    completedRequests,
    totalQty,
    totalCandidates,
    totalArrived,
    totalJoined,
    completion,
    highRisk,
    mediumRisk,
  };
}

async function resolveOperationalCompanyId(client) {
  if (!client) return null;
  if (client.operational_company_id) return client.operational_company_id;
  if (client.company_id) return client.company_id;

  const { data } = await supabase
    .from("companies")
    .select("id, name")
    .ilike("name", client.company_name || "")
    .maybeSingle();

  return data?.id || null;
}

async function openCompanyRequestsReport(client) {
  if (!canManagePlatform) return alert("You do not have permission to view company reports.");
  if (!client) return alert("Company is required.");

  setCompanyReportLoading(true);
  setCompanyReportClient(client);
  setCompanyReportRows([]);

  try {
    const operationalCompanyId = await resolveOperationalCompanyId(client);

    if (!operationalCompanyId) {
      setActivePage("Company Requests Report");
      return alert("This platform client is not linked to an operational company. Add Operational Company ID in Companies Management first.");
    }

    const [requestsResult, candidatesResult, mobilizationsResult] = await Promise.all([
      supabase.from("requests").select("*").eq("company_id", operationalCompanyId).range(0, 5000),
      supabase.from("candidates").select("*").eq("company_id", operationalCompanyId).range(0, 5000),
      supabase.from("mobilizations").select("*").eq("company_id", operationalCompanyId).range(0, 5000),
    ]);

    if (requestsResult.error) throw requestsResult.error;
    if (candidatesResult.error) throw candidatesResult.error;
    if (mobilizationsResult.error) throw mobilizationsResult.error;

    const rows = calculateRequestMeetingReportRows(
      requestsResult.data || [],
      candidatesResult.data || [],
      mobilizationsResult.data || []
    );

    setCompanyReportRows(rows);
    setActivePage("Company Requests Report");
  } catch (error) {
    alert(error.message || "Unable to load company requests report.");
  } finally {
    setCompanyReportLoading(false);
  }
}

function printCompanyRequestsReport() {
  const client = companyReportClient;
  const rows = companyReportRows || [];
  const summary = getCompanyReportSummary(rows);
  const reportDate = new Date().toLocaleDateString("en-GB");

  const rowsHtml = rows.map((row) => `
    <tr>
      <td>${row.request_no}</td>
      <td>${row.project}</td>
      <td>${row.profession}</td>
      <td>${row.nationality}</td>
      <td>${row.qty}</td>
      <td>${row.candidates}</td>
      <td>${row.arrived}</td>
      <td>${row.joined}</td>
      <td>${row.progress}%</td>
      <td>${row.status}</td>
      <td>${row.risk}</td>
    </tr>
  `).join("");

  const printWindow = window.open("", "_blank", "width=1200,height=800");

  if (!printWindow) {
    alert("Popup blocked. Please allow popups and try again.");
    return;
  }

  printWindow.document.write(`
    <html>
      <head>
        <title>${client?.company_name || "Company"} - Requests Meeting Report</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 32px; color: #0f172a; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0f172a; padding-bottom: 18px; }
          .brand { font-size: 26px; font-weight: bold; color: #071b4d; }
          .muted { color: #64748b; font-size: 12px; }
          h1 { margin: 24px 0 8px; font-size: 28px; }
          .summary { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin: 24px 0; }
          .card { border: 1px solid #d0d5dd; border-radius: 12px; padding: 14px; }
          .label { color: #64748b; font-size: 12px; }
          .value { font-size: 22px; font-weight: bold; margin-top: 6px; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12px; }
          th { background: #071b4d; color: white; padding: 9px; text-align: left; }
          td { border-bottom: 1px solid #e5e7eb; padding: 8px; }
          .footer { margin-top: 28px; color: #64748b; font-size: 11px; text-align: center; }
          button { padding: 8px 14px; border: 0; border-radius: 8px; background: #071b4d; color: white; cursor: pointer; }
          @media print { button { display: none; } body { padding: 20px; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="brand">VisaFlow KSA</div>
            <div class="muted">Requests Meeting Report</div>
          </div>
          <button onclick="window.print()">Print</button>
        </div>

        <h1>${client?.company_name || "Company"}</h1>
        <div class="muted">Report Date: ${reportDate} | Domain: ${client?.domain || "-"}</div>

        <div class="summary">
          <div class="card"><div class="label">Total Requests</div><div class="value">${summary.totalRequests}</div></div>
          <div class="card"><div class="label">Required Qty</div><div class="value">${summary.totalQty}</div></div>
          <div class="card"><div class="label">Candidates</div><div class="value">${summary.totalCandidates}</div></div>
          <div class="card"><div class="label">Joined</div><div class="value">${summary.totalJoined}</div></div>
          <div class="card"><div class="label">Completion</div><div class="value">${summary.completion}%</div></div>
          <div class="card"><div class="label">Open Requests</div><div class="value">${summary.openRequests}</div></div>
          <div class="card"><div class="label">Completed</div><div class="value">${summary.completedRequests}</div></div>
          <div class="card"><div class="label">Arrived</div><div class="value">${summary.totalArrived}</div></div>
          <div class="card"><div class="label">High Risk</div><div class="value">${summary.highRisk}</div></div>
          <div class="card"><div class="label">Medium Risk</div><div class="value">${summary.mediumRisk}</div></div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Request No</th><th>Project</th><th>Profession</th><th>Nationality</th><th>Qty</th><th>Candidates</th><th>Arrived</th><th>Joined</th><th>Progress</th><th>Status</th><th>Risk</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || `<tr><td colspan="11">No requests found</td></tr>`}</tbody>
        </table>

        <div class="footer">Generated by VisaFlow KSA Platform Administration</div>
      </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();
}

function printSubscriptionInvoice(invoice) {
  const client = getPlatformClient(invoice.client_id);
  const amount = Number(invoice.amount || 0);
  const vat = Math.round(amount * 0.15 * 100) / 100;
  const total = amount + vat;
  const printWindow = window.open("", "_blank", "width=900,height=700");

  if (!printWindow) {
    alert("Popup blocked. Please allow popups and try again.");
    return;
  }

  printWindow.document.write(`
    <html>
      <head>
        <title>${invoice.invoice_no || "Subscription Invoice"}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; color: #071b4d; }
          .header { display: flex; justify-content: space-between; border-bottom: 3px solid #071b4d; padding-bottom: 20px; }
          .logo { font-size: 28px; font-weight: bold; }
          .muted { color: #667085; font-size: 13px; }
          .title { margin-top: 35px; font-size: 30px; font-weight: bold; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 25px; margin-top: 25px; }
          .box { border: 1px solid #d0d5dd; border-radius: 12px; padding: 18px; }
          table { width: 100%; border-collapse: collapse; margin-top: 35px; }
          th { background: #071b4d; color: white; text-align: left; padding: 12px; }
          td { border-bottom: 1px solid #e5e7eb; padding: 12px; }
          .total { font-size: 20px; font-weight: bold; }
          .footer { margin-top: 50px; font-size: 12px; color: #667085; text-align: center; }
          button { padding: 8px 14px; border: 0; border-radius: 8px; background: #071b4d; color: white; cursor: pointer; }
          @media print { button { display: none; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="logo">VisaFlow KSA</div>
            <div class="muted">Recruitment & Visa Operations SaaS</div>
          </div>
          <button onclick="window.print()">Print</button>
        </div>

        <div class="title">Subscription Invoice</div>

        <div class="grid">
          <div class="box">
            <strong>Bill To</strong><br/><br/>
            ${client?.company_name || "-"}<br/>
            <span class="muted">${client?.domain || ""}</span>
          </div>

          <div class="box">
            <strong>Invoice Details</strong><br/><br/>
            Invoice No: ${invoice.invoice_no || "-"}<br/>
            Due Date: ${invoice.due_date || "-"}<br/>
            Status: ${invoice.status || "Unpaid"}
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>VisaFlow KSA Monthly Subscription</td>
              <td>${amount.toLocaleString()} SAR</td>
            </tr>
            <tr>
              <td>VAT 15%</td>
              <td>${vat.toLocaleString()} SAR</td>
            </tr>
            <tr>
              <td class="total">Total</td>
              <td class="total">${total.toLocaleString()} SAR</td>
            </tr>
          </tbody>
        </table>

        <div class="footer">This invoice was generated by VisaFlow KSA Platform Administration.</div>
      </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();
}

function getClientDaysRemaining(client) {
  if (!client?.end_date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(client.end_date);
  endDate.setHours(0, 0, 0, 0);
  return Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
}

function getClientRenewalStatus(client) {
  const status = String(client?.subscription_status || "Active");
  const days = getClientDaysRemaining(client);

  if (["Suspended", "Cancelled", "Expired"].includes(status)) return status;
  if (days !== null && days < 0) return "Expired";
  if (days !== null && days <= 30) return "Renewal Soon";
  return status;
}

const platformDashboard = useMemo(() => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const next30 = new Date(today);
  next30.setDate(next30.getDate() + 30);

  const activeClients = platformClients.filter((client) =>
    String(client.subscription_status || "").toLowerCase() === "active"
  );

  const trialClients = platformClients.filter((client) =>
    String(client.subscription_status || "").toLowerCase() === "trial"
  );

  const suspendedClients = platformClients.filter((client) =>
    ["suspended", "cancelled", "expired"].includes(String(client.subscription_status || "").toLowerCase())
  );

  const expiringThisMonth = platformClients.filter((client) => {
    if (!client.end_date) return false;
    const endDate = new Date(client.end_date);
    return endDate >= today && endDate <= next30;
  });

  const monthlyRevenue = activeClients.reduce(
    (sum, client) => sum + Number(client.monthly_amount || 0),
    0
  );

  const unpaidInvoices = subscriptionInvoices.filter((invoice) =>
    String(invoice.status || "").toLowerCase() !== "paid"
  );

  const unpaidAmount = unpaidInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);

  const overdueInvoices = unpaidInvoices.filter((invoice) => {
    if (!invoice.due_date) return false;
    return new Date(invoice.due_date) < today;
  });

  const openTickets = supportTickets.filter((ticket) =>
    ["open", "in progress"].includes(String(ticket.status || "").toLowerCase())
  );

  const latestBackups = [...systemBackups]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 5);

  return {
    totalClients: platformClients.length,
    activeClients: activeClients.length,
    trialClients: trialClients.length,
    suspendedClients: suspendedClients.length,
    expiringThisMonth: expiringThisMonth.length,
    monthlyRevenue,
    annualRevenue: monthlyRevenue * 12,
    unpaidInvoices: unpaidInvoices.length,
    unpaidAmount,
    overdueInvoices: overdueInvoices.length,
    openTickets: openTickets.length,
    latestBackups,
  };
}, [platformClients, subscriptionInvoices, supportTickets, systemBackups]);

function resetPlatformClientForm() {
  setPlatformClientForm(emptyPlatformClient);
  setPlatformClientEditingId(null);
}

function editPlatformClient(item) {
  if (!canManagePlatform) return alert("You do not have permission to manage the platform.");
  setPlatformClientEditingId(item.id);
  setPlatformClientForm({
    company_name: item.company_name || "",
    domain: item.domain || "",
    subscription_status: item.subscription_status || "Active",
    users_count: item.users_count || 0,
    start_date: item.start_date || "",
    end_date: item.end_date || "",
    monthly_amount: item.monthly_amount || 0,
    operational_company_id: item.operational_company_id || "",
    admin_name: "",
    admin_email: "",
    admin_password: "",
    admin_role: "Admin",
  });
  setActivePage("Companies Management");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function savePlatformClient() {
  if (!canManagePlatform) return alert("You do not have permission to manage the platform.");
  if (!platformClientForm.company_name) return alert("Company name is required.");

  const adminName = String(platformClientForm.admin_name || "").trim();
  const adminEmail = String(platformClientForm.admin_email || "").trim().toLowerCase();
  const adminPassword = String(platformClientForm.admin_password || "").trim();
  const adminRole = platformClientForm.admin_role || "Admin";

  if (!platformClientEditingId && (adminName || adminEmail || adminPassword)) {
    if (!adminName) return alert("Primary Admin Name is required.");
    if (!adminEmail) return alert("Primary Admin Email is required.");
    if (!adminPassword) return alert("Temporary Password is required.");
  }

  let operationalCompanyId = platformClientForm.operational_company_id || null;

  if (!operationalCompanyId && !platformClientEditingId && adminEmail) {
    const { data: existingCompany, error: companyLookupError } = await supabase
      .from("companies")
      .select("id, name")
      .eq("name", platformClientForm.company_name)
      .maybeSingle();

    if (companyLookupError) return alert(companyLookupError.message);

    if (existingCompany?.id) {
      operationalCompanyId = existingCompany.id;
    } else {
      const { data: createdCompany, error: companyCreateError } = await supabase
        .from("companies")
        .insert([{
          name: platformClientForm.company_name,
          domain: platformClientForm.domain || "",
          status: "Active",
          subscription_plan: "SaaS",
          subscription_status: platformClientForm.subscription_status || "Active",
          subscription_start: platformClientForm.start_date || null,
          subscription_end: platformClientForm.end_date || null,
          max_users: Number(platformClientForm.users_count || 0) || 5,
          notes: "Created from Platform Owner / Companies Management",
        }])
        .select()
        .single();

      if (companyCreateError) return alert(companyCreateError.message);
      operationalCompanyId = createdCompany.id;
    }
  }

  const payload = {
    company_name: platformClientForm.company_name,
    domain: platformClientForm.domain || "",
    subscription_status: platformClientForm.subscription_status || "Active",
    users_count: Number(platformClientForm.users_count || 0),
    start_date: platformClientForm.start_date || null,
    end_date: platformClientForm.end_date || null,
    monthly_amount: Number(platformClientForm.monthly_amount || 0),
    operational_company_id: operationalCompanyId,
  };

  const result = platformClientEditingId
    ? await supabase.from("platform_clients").update(payload).eq("id", platformClientEditingId)
    : await supabase.from("platform_clients").insert([payload]);

  if (result.error) return alert(result.error.message);

  if (!platformClientEditingId && adminEmail) {
    if (!operationalCompanyId) {
      return alert("Company saved, but Primary Admin was not created because Operational Company ID is missing.");
    }

    const { data: existingUser, error: existingUserError } = await supabase
      .from("users")
      .select("id")
      .eq("email", adminEmail)
      .maybeSingle();

    if (existingUserError) return alert(existingUserError.message);
    if (existingUser) return alert("Company saved, but admin email already exists in users.");

    const { error: userError } = await supabase.from("users").insert([{
      name: adminName,
      email: adminEmail,
      password: adminPassword,
      role: adminRole,
      status: "Active",
      company_id: operationalCompanyId,
    }]);

    if (userError) return alert(userError.message);
  }

  resetPlatformClientForm();
  await loadPlatformClients();
  await loadUsers();
  alert(platformClientEditingId ? "Company updated successfully" : "Company and primary admin saved successfully");
}
async function extendPlatformClient(client, months = 1) {
  if (!canManagePlatform) return alert("You do not have permission to manage the platform.");
  if (!client?.id) return alert("Company is required.");

  const baseDate = client.end_date ? new Date(client.end_date) : new Date();
  if (baseDate < new Date()) baseDate.setTime(new Date().getTime());

  baseDate.setMonth(baseDate.getMonth() + months);
  const newEndDate = baseDate.toISOString().slice(0, 10);

  const { error } = await supabase
    .from("platform_clients")
    .update({
      end_date: newEndDate,
      subscription_status: "Active",
    })
    .eq("id", client.id);

  if (error) return alert(error.message);

  await loadPlatformClients();
  alert(`Subscription extended until ${newEndDate}`);
}
async function deletePlatformClient(id) {
  if (!canManagePlatform) return alert("You do not have permission to manage the platform.");
  if (!window.confirm("Delete this platform client?")) return;

  const { error } = await supabase.from("platform_clients").delete().eq("id", id);
  if (error) return alert(error.message);
  await loadPlatformClients();
}

async function extendPlatformClient(client, days = 30) {
  if (!canManagePlatform) return alert("You do not have permission to manage the platform.");
  if (!client?.id) return alert("Company is required.");

  const baseDate = client.end_date && new Date(client.end_date) > new Date()
    ? new Date(client.end_date)
    : new Date();

  baseDate.setDate(baseDate.getDate() + Number(days || 30));
  const newEndDate = baseDate.toISOString().slice(0, 10);

  const { error } = await supabase
    .from("platform_clients")
    .update({
      end_date: newEndDate,
      subscription_status: "Active",
    })
    .eq("id", client.id);

  if (error) return alert(error.message);

  await loadPlatformClients();
  alert(`Subscription extended until ${newEndDate}`);
}


function resetSubscriptionInvoiceForm() {
  setSubscriptionInvoiceForm(emptySubscriptionInvoice);
  setSubscriptionInvoiceEditingId(null);
}

function editSubscriptionInvoice(item) {
  if (!canManagePlatform) return alert("You do not have permission to manage subscriptions.");
  setSubscriptionInvoiceEditingId(item.id);
  setSubscriptionInvoiceForm({
    client_id: item.client_id || "",
    invoice_no: item.invoice_no || "",
    amount: item.amount || 0,
    status: item.status || "Unpaid",
    due_date: item.due_date || "",
    paid_at: item.paid_at || "",
  });
  setActivePage("Subscription Invoices");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function saveSubscriptionInvoice() {
  if (!canManagePlatform) return alert("You do not have permission to manage subscriptions.");
  if (!subscriptionInvoiceForm.client_id) return alert("Company is required.");
  if (!subscriptionInvoiceForm.amount) return alert("Invoice amount is required.");

  const { data: validClient, error: clientError } = await supabase
    .from("platform_clients")
    .select("id")
    .eq("id", subscriptionInvoiceForm.client_id)
    .maybeSingle();

  if (clientError) return alert(clientError.message);
  if (!validClient?.id) {
    await loadPlatformClients();
    return alert("Selected company was not found in platform_clients. Please refresh and select the company again.");
  }

  const payload = {
    client_id: validClient.id,
    invoice_no: subscriptionInvoiceForm.invoice_no || generatePlatformNo("SUB", subscriptionInvoices, "invoice_no", 5),
    amount: Number(subscriptionInvoiceForm.amount || 0),
    status: subscriptionInvoiceForm.status || "Unpaid",
    due_date: subscriptionInvoiceForm.due_date || null,
    paid_at: subscriptionInvoiceForm.status === "Paid" ? (subscriptionInvoiceForm.paid_at || new Date().toISOString().slice(0, 10)) : null,
  };

  const result = subscriptionInvoiceEditingId
    ? await supabase.from("subscription_invoices").update(payload).eq("id", subscriptionInvoiceEditingId)
    : await supabase.from("subscription_invoices").insert([payload]);

  if (result.error) return alert(result.error.message);

  resetSubscriptionInvoiceForm();
  await loadSubscriptionInvoices();
  alert(subscriptionInvoiceEditingId ? "Invoice updated successfully" : `Invoice saved: ${payload.invoice_no}`);
}

async function createSubscriptionInvoiceForClient(client) {
  if (!canManagePlatform) return alert("You do not have permission to generate subscription invoices.");
  if (!client?.id && !client?.company_name) return alert("Company is required.");

  // Safety check: the invoice must use an ID that really exists in platform_clients.
  // This prevents old browser state from sending a deleted/stale client_id.
  let validClient = null;

  if (client?.id) {
    const { data, error } = await supabase
      .from("platform_clients")
      .select("id, company_name, monthly_amount")
      .eq("id", client.id)
      .maybeSingle();

    if (!error && data) validClient = data;
  }

  if (!validClient && client?.company_name) {
    const { data, error } = await supabase
      .from("platform_clients")
      .select("id, company_name, monthly_amount")
      .eq("company_name", client.company_name)
      .maybeSingle();

    if (!error && data) validClient = data;
  }

  if (!validClient?.id) {
    await loadPlatformClients();
    return alert("Company record was not found in platform_clients. Please refresh the page and try again.");
  }

  const amount = Number(validClient.monthly_amount || client.monthly_amount || 0);
  if (!amount) return alert("Monthly amount is required before generating an invoice.");

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 7);

  const invoiceNo = generatePlatformNo("SUB", subscriptionInvoices, "invoice_no", 5);

  const { error } = await supabase.from("subscription_invoices").insert([{
    client_id: validClient.id,
    invoice_no: invoiceNo,
    amount,
    status: "Unpaid",
    due_date: dueDate.toISOString().slice(0, 10),
    paid_at: null,
  }]);

  if (error) return alert(error.message);

  await loadSubscriptionInvoices();
  setActivePage("Subscription Invoices");
  alert(`Invoice generated: ${invoiceNo}`);
}

async function deleteSubscriptionInvoice(id) {
  if (!canManagePlatform) return alert("You do not have permission to manage subscriptions.");
  if (!window.confirm("Delete this invoice?")) return;
  const { error } = await supabase.from("subscription_invoices").delete().eq("id", id);
  if (error) return alert(error.message);
  await loadSubscriptionInvoices();
}

function resetSupportTicketForm() {
  setSupportTicketForm(emptySupportTicket);
  setSupportTicketEditingId(null);
}

function editSupportTicket(item) {
  if (!canManagePlatform) return alert("You do not have permission to manage support tickets.");
  setSupportTicketEditingId(item.id);
  setSupportTicketForm({
    client_id: item.client_id || "",
    ticket_no: item.ticket_no || "",
    title: item.title || "",
    description: item.description || "",
    status: item.status || "Open",
    priority: item.priority || "Medium",
    created_by: item.created_by || "",
  });
  setActivePage("Central Support");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function saveSupportTicket() {
  if (!canManagePlatform) return alert("You do not have permission to manage support tickets.");
  if (!supportTicketForm.title) return alert("Ticket title is required.");

  const isResolved = supportTicketForm.status === "Resolved";
  const payload = {
    client_id: supportTicketForm.client_id || null,
    ticket_no: supportTicketForm.ticket_no || generatePlatformNo("TCK", supportTickets, "ticket_no", 5),
    title: supportTicketForm.title,
    description: supportTicketForm.description || "",
    status: supportTicketForm.status || "Open",
    priority: supportTicketForm.priority || "Medium",
    created_by: supportTicketForm.created_by || currentUser?.name || currentUser?.email || "Platform",
    resolved_at: isResolved ? new Date().toISOString() : null,
  };

  const result = supportTicketEditingId
    ? await supabase.from("support_tickets").update(payload).eq("id", supportTicketEditingId)
    : await supabase.from("support_tickets").insert([payload]);

  if (result.error) return alert(result.error.message);

  resetSupportTicketForm();
  await loadSupportTickets();
  alert(supportTicketEditingId ? "Ticket updated successfully" : `Ticket saved: ${payload.ticket_no}`);
}

async function deleteSupportTicket(id) {
  if (!canManagePlatform) return alert("You do not have permission to manage support tickets.");
  if (!window.confirm("Delete this ticket?")) return;
  const { error } = await supabase.from("support_tickets").delete().eq("id", id);
  if (error) return alert(error.message);
  await loadSupportTickets();
}

async function createSystemBackup(clientId = null) {
  if (!isPlatformOwner) {
    return alert("Only Platform Owner can create backups.");
  }

  const selectedClient = clientId
    ? platformClients.find((client) => String(client.id) === String(clientId))
    : null;

  const now = new Date();
  const stamp = now
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-");

  const backupType = selectedClient ? "Company" : "Full System";
  const companyName = selectedClient?.company_name || "Full System";
  const safeCompanyName = normalizeMatchText(companyName).replaceAll(" ", "_") || "company";

  const payload = {
    client_id: selectedClient?.id || null,
    company_id: selectedClient?.operational_company_id || selectedClient?.company_id || null,
    backup_type: backupType,
    status: "Pending",
    file_url: "",
    file_name: selectedClient
      ? `visaflow_company_backup_${safeCompanyName}_${stamp}.json`
      : `visaflow_full_system_backup_${stamp}.json`,
    file_size: "Pending",
    tables_count: 0,
    records_count: 0,
    storage_bucket: "visaflow-backups",
    storage_path: "",
    signed_url: "",
    signed_url_expires_at: null,
    requested_by_user_id: currentUser?.id || null,
    created_by: currentUser?.name || currentUser?.email || "Platform Owner",
    notes: selectedClient
      ? `Backup request created for ${companyName}. Waiting for secure backend backup processor.`
      : "Full system backup request created. Waiting for secure backend backup processor.",
    metadata: {
      requested_from: "Platform Owner Backup Center",
      company_name: selectedClient?.company_name || "",
    },
    created_at: now.toISOString(),
    completed_at: null,
  };

  const { error } = await supabase.from("system_backups").insert([payload]);

  if (error) {
    return alert(error.message);
  }

  await loadSystemBackups();
  alert("Backup request created successfully. Status: Pending");
}

async function runBackupWorker() {
  if (!isPlatformOwner) {
    return alert("Only Platform Owner can run the backup worker.");
  }

  const { data, error } = await supabase.functions.invoke("visaflowbackupworker", {
    body: {},
  });

  if (error) return alert(error.message);
  if (data?.ok === false) return alert(data.error || "Backup worker failed.");

  await loadSystemBackups();
  alert(data?.processed ? "Backup worker processed one request." : "No pending backup requests.");
}

async function runRestoreWorker() {
  if (!isPlatformOwner) {
    return alert("Only Platform Owner can run the restore worker.");
  }

  const { data, error } = await supabase.functions.invoke("visaflowrestoreworker", {
    body: {},
  });

  if (error) return alert(error.message);
  if (data?.ok === false) return alert(data.error || "Restore worker failed.");

  await loadSystemBackups();
  await loadSystemRestoreRequests();

  if (data?.processed) {
    alert(`Restore worker completed. Restored records: ${data?.restored_records_count || 0}`);
  } else {
    alert("No pending restore requests.");
  }
}

async function requestLatestCompanyRestore(clientId = "") {
  if (!isPlatformOwner) {
    return alert("Only Platform Owner can request restore.");
  }

  const selectedClient = platformClients.find((client) => String(client.id) === String(clientId));
  if (!selectedClient) return alert("Please select the client company.");

  const companyId = selectedClient.operational_company_id || selectedClient.company_id || "";
  if (!companyId) {
    return alert("This client is not linked to an operational company_id.");
  }

  const latestCompletedBackup = [...systemBackups]
    .filter((backup) => {
      const isCompleted = normalize(backup.status) === "completed";
      const isFullSystem = String(backup.backup_type || "").toLowerCase().includes("full");
      const sameCompany = String(getBackupCompanyId(backup) || "") === String(companyId);
      const hasFile = Boolean(backup.storage_path || backup.file_url || backup.signed_url);
      return isCompleted && !isFullSystem && sameCompany && hasFile;
    })
    .sort((a, b) =>
      new Date(b.completed_at || b.created_at || 0) - new Date(a.completed_at || a.created_at || 0)
    )[0];

  if (!latestCompletedBackup) {
    return alert("No completed company backup found for this client.");
  }

  const reason = window.prompt(
    `Restore reason for ${selectedClient.company_name}:`,
    "Client requested recovery of accidentally deleted data"
  );

  if (reason === null) return;

  const confirmed = window.confirm(
    `Create SAFE restore request for ${selectedClient.company_name}?\n\n` +
    `Backup file: ${latestCompletedBackup.file_name || latestCompletedBackup.storage_path || latestCompletedBackup.id}\n\n` +
    "Safe Restore will restore missing records only after the secure restore worker is run."
  );

  if (!confirmed) return;

  const now = new Date();
  const stamp = now
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-");

  const safeCompanyName = normalizeMatchText(selectedClient.company_name).replaceAll(" ", "_") || "company";

  const { data: preRestoreBackup, error: preBackupError } = await supabase
    .from("system_backups")
    .insert([{
      client_id: selectedClient.id,
      company_id: companyId,
      backup_type: "Pre-Restore Company",
      status: "Pending",
      file_url: "",
      file_name: `visaflow_pre_restore_${safeCompanyName}_${stamp}.json`,
      file_size: "Pending",
      tables_count: 0,
      records_count: 0,
      storage_bucket: "visaflow-backups",
      storage_path: "",
      signed_url: "",
      signed_url_expires_at: null,
      requested_by_user_id: currentUser?.id || null,
      created_by: currentUser?.name || currentUser?.email || "Platform Owner",
      notes: `Automatic safety backup before restore request for ${selectedClient.company_name}.`,
      metadata: {
        requested_from: "Restore Request",
        restore_source_backup_id: latestCompletedBackup.id,
        company_name: selectedClient.company_name,
      },
      created_at: now.toISOString(),
      completed_at: null,
    }])
    .select("id")
    .single();

  if (preBackupError) return alert(preBackupError.message);

  const { error } = await supabase
    .from("system_restore_requests")
    .insert([{
      company_id: companyId,
      backup_id: latestCompletedBackup.id,
      restore_scope: "Company",
      restore_mode: "Safe Missing Records",
      status: "Pending",
      reason: reason || "Client requested restore from latest completed backup.",
      client_request_reference: "",
      requested_by_user_id: currentUser?.id || null,
      requested_by_name: currentUser?.name || currentUser?.email || "Platform Owner",
      pre_restore_backup_id: preRestoreBackup?.id || null,
      metadata: {
        company_name: selectedClient.company_name,
        source_backup_file: latestCompletedBackup.file_name || "",
        source_storage_path: latestCompletedBackup.storage_path || "",
        requested_from: "Platform Owner Backup Center",
      },
      created_at: now.toISOString(),
    }]);

  if (error) return alert(error.message);

  await loadSystemBackups();
  await loadSystemRestoreRequests();
  alert("Restore request created. A pre-restore backup request was also created for safety.");
}

async function cancelRestoreRequest(id) {
  if (!isPlatformOwner) return alert("Only Platform Owner can cancel restore requests.");
  if (!window.confirm("Cancel this pending restore request?")) return;

  const { error } = await supabase
    .from("system_restore_requests")
    .update({ status: "Cancelled" })
    .eq("id", id)
    .eq("status", "Pending");

  if (error) return alert(error.message);
  await loadSystemRestoreRequests();
}

async function deleteSystemBackup(id) {
  if (!isPlatformOwner) return alert("Only Platform Owner can delete backup records.");
  if (!window.confirm("Delete this backup record?")) return;
  const { error } = await supabase.from("system_backups").delete().eq("id", id);
  if (error) return alert(error.message);
  await loadSystemBackups();
}


function updateReportStudioForm(field, value) {
  setReportStudioForm((prev) => ({ ...prev, [field]: value }));
}

function toggleReportStudioSection(section) {
  setReportStudioForm((prev) => {
    const current = prev.includeSections || [];
    return {
      ...prev,
      includeSections: current.includes(section)
        ? current.filter((item) => item !== section)
        : [...current, section],
    };
  });
}

function selectReportStudioTemplate(template) {
  setReportStudioForm((prev) => ({
    ...prev,
    templateId: template.id,
    reportName: template.title,
    category: template.category,
  }));
}

function getReportStudioProjectOptions() {
  return Array.from(new Set([
    "All",
    ...requests.map((item) => item.project_name || item.project).filter(Boolean),
    ...candidates.map((item) => item.project).filter(Boolean),
    ...mobilizationRequestRows.map((item) => item.project_name).filter(Boolean),
  ]));
}

function filterReportStudioRowsByProject(rows, fieldCandidates = ["project", "project_name"]) {
  if (!reportStudioForm.project || reportStudioForm.project === "All") return rows;
  return rows.filter((row) =>
    fieldCandidates.some((field) => normalize(row[field]) === normalize(reportStudioForm.project))
  );
}


function isReportArabic(language = reportStudioForm.language) {
  return language === "Arabic";
}

function isReportBilingual(language = reportStudioForm.language) {
  return language === "Bilingual";
}

const REPORT_AR_LABELS = {
  "CEO Executive Report": "تقرير تنفيذي للرئيس التنفيذي",
  "Executive Board Presentation": "عرض تنفيذي لمجلس الإدارة",
  "Weekly Recruitment Report": "تقرير التوظيف الأسبوعي",
  "Visa & Mobilization Report": "تقرير التأشيرات والحشد",
  "Agency Performance Report": "تقرير أداء المكاتب",
  "Budget & Finance Summary": "ملخص الميزانية والتكاليف",
  "Project Progress Report": "تقرير تقدم المشروع",
  "Client Progress Report": "تقرير تقدم العميل",
  "Executive": "تنفيذي",
  "Recruitment": "التوظيف",
  "Operations": "العمليات",
  "Agencies": "المكاتب",
  "Finance": "المالية",
  "All": "الكل",
  "Required Manpower": "القوى العاملة المطلوبة",
  "Active Candidates": "المرشحون المحتسبون",
  "Matched Linked Candidates": "المرشحون المطابقون والمرتبطون",
  "Covered Candidates": "المرشحون المحتسبون",
  "Submitted Candidates": "إجمالي المرشحين المطابقين",
  "Extra / Backup Candidates": "مرشحون احتياط / زائدون",
  "Joined": "المباشرون",
  "Recruitment Progress": "نسبة تقدم التوظيف",
  "Visa Gap": "فجوة التأشيرات",
  "Authorization Gap": "فجوة التفويض",
  "High Risk Lines": "بنود عالية المخاطر",
  "Saudization Rate": "نسبة السعودة",
  "Estimated Cost": "التكلفة التقديرية",
  "Budget Variance": "فرق الميزانية",
  "Required": "المطلوب",
  "Interview Passed": "اجتازوا المقابلة",
  "Medical Passed": "اجتازوا الفحص الطبي",
  "Tickets Issued": "تم إصدار التذاكر",
  "Arrived KSA": "وصلوا المملكة",
  "Low": "منخفض",
  "Medium": "متوسط",
  "High": "مرتفع",
  "High Risk": "مخاطر عالية",
  "Medium Risk": "مخاطر متوسطة",
  "Safe Lines": "بنود آمنة",
  "Candidate Gap": "فجوة المرشحين",
  "Joining Gap": "فجوة المباشرة",
  "Sourcing / Agency Submission": "التوريد / ترشيحات المكتب",
  "Visa Allocation": "تخصيص التأشيرات",
  "Authorization": "التفويض",
  "Interview": "المقابلات",
  "Medical": "الفحص الطبي",
  "Embassy / Visa Stamping": "السفارة / التختيم",
  "Ticketing": "إصدار التذاكر",
  "Arrival / Joining": "الوصول / المباشرة",
  "Completed": "مكتمل",
  "Monitoring": "متابعة",
  "KPI Dashboard": "لوحة المؤشرات",
  "Charts & Performance": "الرسوم البيانية والأداء",
  "Recruitment Funnel": "قمع التوظيف",
  "Risk & Gaps": "المخاطر والفجوات",
  "Agency Insights": "تحليل أداء المكاتب",
  "Recommended Actions": "الإجراءات المقترحة",
  "AI Forecast": "توقعات الذكاء الاصطناعي",
  "Executive Summary": "الملخص التنفيذي",
  "Top Request-Line Risks": "أعلى مخاطر بنود الطلبات",
  "Agency Score": "تقييم المكتب",
  "Candidates": "المرشحون",
  "Score": "النقاط",
  "Risk": "المخاطر",
  "Confidential": "سري",
  "Executive Copy": "نسخة تنفيذية",
  "Generated": "تاريخ التوليد",
  "Main action": "الإجراء الرئيسي",
  "No agency data available yet.": "لا توجد بيانات مكاتب متاحة حتى الآن.",
  "No high-risk request lines detected.": "لا توجد بنود عالية المخاطر حاليًا.",
  "Demand volume": "حجم الطلب",
  "Submitted / active": "المقدمون / النشطون",
  "Confirmed joining": "مباشرة مؤكدة",
  "Candidate coverage": "تغطية المرشحين",
  "Allocation shortage": "نقص التخصيص",
  "Authorization shortage": "نقص التفويض",
  "Agreement SLA": "مدة SLA حسب الاتفاقية",
  "SLA Compliance": "الالتزام بالـ SLA",
  "Delayed Candidates": "مرشحون متأخرون",
  "SLA Penalty Exposure": "غرامة تأخير SLA المحتملة",
  "Update Frequency": "دورية تحديث المعاملة",
};

function localizeReportText(textValue, language = reportStudioForm.language) {
  const value = String(textValue || "");
  const ar = REPORT_AR_LABELS[value] || value;
  if (isReportArabic(language)) return ar;
  if (isReportBilingual(language) && ar !== value) return `${ar} | ${value}`;
  return value;
}

function reportPhrase(en, ar, language = reportStudioForm.language) {
  if (isReportArabic(language)) return ar;
  if (isReportBilingual(language)) return `${ar}\n${en}`;
  return en;
}

function getReportFont(language = reportStudioForm.language) {
  return isReportArabic(language) ? "Arial" : "Aptos";
}

function getReportHeadFont(language = reportStudioForm.language) {
  return isReportArabic(language) ? "Arial" : "Aptos Display";
}

function getReportTextAlign(language = reportStudioForm.language) {
  return isReportArabic(language) ? "right" : "left";
}

function getLocalizedReportName(data, language = reportStudioForm.language) {
  return localizeReportText(data.report_name || data.template || "VisaFlow AI Report", language);
}

function getLocalizedCategory(value, language = reportStudioForm.language) {
  return localizeReportText(value || "Executive", language);
}

function getLocalizedProject(value, language = reportStudioForm.language) {
  return localizeReportText(value || "All", language);
}

function buildAIReportStudioDataset() {
  const requestHealth = filterReportStudioRowsByProject(buildRequestHealthRows(), ["project"]);
  const mobilizationRows = filterReportStudioRowsByProject(mobilizationRequestRows, ["project_name"]);
  const agencyRows = calculateAgencyPerformanceRows().map((row) => ({
    ...row,
    agency: row.agency_name,
    score: row.total_score,
    risk: row.rank === "Under Review" ? "High" : row.rank === "Silver" ? "Medium" : "Low",
    failRate: row.candidates ? Math.round((Number(row.failed || 0) / Number(row.candidates || 1)) * 100) : 0,
  }));
  const forecast = buildRecruitmentForecast();
  const recentOperationalChanges = getReportStudioRecentActivityLogs(requestHealth);

  const totalRequired = requestHealth.reduce((sum, row) => sum + Number(row.requested_qty || 0), 0);
  const totalSubmittedCandidates = requestHealth.reduce((sum, row) => sum + Number(row.candidates || 0), 0);
  const totalCoveredCandidates = requestHealth.reduce(
    (sum, row) => sum + Math.min(Number(row.candidates || 0), Number(row.requested_qty || 0)),
    0
  );
  const totalExtraCandidates = requestHealth.reduce(
    (sum, row) => sum + Math.max(Number(row.candidates || 0) - Number(row.requested_qty || 0), 0),
    0
  );
  const totalJoined = requestHealth.reduce((sum, row) => sum + Math.min(Number(row.joined || 0), Number(row.requested_qty || 0)), 0);
  const totalVisaGap = requestHealth.reduce((sum, row) => sum + Number(row.visaGap || 0), 0);
  const totalAuthorizationGap = requestHealth.reduce((sum, row) => sum + Number(row.authorizationGap || 0), 0);
  const highRiskLines = requestHealth.filter((row) => row.riskLevel === "High").length;
  const totalCost = mobilizationRows.reduce((sum, row) => sum + Number(row.totalCost || 0), 0);
  const totalBudget = mobilizationRows.reduce((sum, row) => sum + Number(row.budget || 0), 0);
  const recruitmentProgress = totalRequired
    ? Math.min(Math.round((totalCoveredCandidates / totalRequired) * 100), 100)
    : 0;

  return {
    generated_at: new Date().toLocaleString(),
    report_name: reportStudioForm.reportName,
    template: REPORT_STUDIO_TEMPLATES.find((item) => item.id === reportStudioForm.templateId)?.title || reportStudioForm.reportName,
    category: reportStudioForm.category,
    project: reportStudioForm.project || "All",
    language: reportStudioForm.language,
    output_format: reportStudioForm.outputFormat,
    totals: {
      required: totalRequired,
      covered_candidates: totalCoveredCandidates,
      submitted_candidates: totalSubmittedCandidates,
      extra_candidates: totalExtraCandidates,
      joined: totalJoined,
      recruitment_progress: recruitmentProgress,
    },
    kpis: [
      { metric: "Required Manpower", value: totalRequired },
      { metric: "Active Candidates", value: totalCoveredCandidates },
      { metric: "Submitted Candidates", value: totalSubmittedCandidates },
      { metric: "Extra / Backup Candidates", value: totalExtraCandidates },
      { metric: "Joined", value: totalJoined },
      { metric: "Recruitment Progress", value: `${recruitmentProgress}%` },
      { metric: "Visa Gap", value: totalVisaGap },
      { metric: "Authorization Gap", value: totalAuthorizationGap },
      { metric: "High Risk Lines", value: highRiskLines },
      { metric: "Saudization Rate", value: `${executiveDashboard.saudizationRate}%` },
      { metric: "Estimated Cost", value: `${Number(totalCost || stats.totalMobilizationCost || 0).toLocaleString()} SAR` },
      { metric: "Budget Variance", value: `${Number((totalBudget || stats.totalRequestBudget || 0) - (totalCost || stats.totalMobilizationCost || 0)).toLocaleString()} SAR` },
      { metric: "SLA Compliance", value: `${agencyRows.length ? Math.round(agencyRows.reduce((sum, item) => sum + Number(item.sla_score || 0), 0) / agencyRows.length) : 0}%` },
      { metric: "Delayed Candidates", value: agencyRows.reduce((sum, item) => sum + Number(item.delayed_candidates || 0), 0) },
      { metric: "SLA Penalty Exposure", value: `${Number(agencyRows.reduce((sum, item) => sum + Number(item.penalty_exposure || 0), 0)).toLocaleString()} SAR` },
      { metric: "Recent Operational Changes", value: recentOperationalChanges.length },
    ],
    recent_operational_changes: recentOperationalChanges,
    request_health: requestHealth,
    mobilization: mobilizationRows,
    agencies: agencyRows,
    forecast,
  };
}

function buildAIReportStudioNarrative() {
  const data = buildAIReportStudioDataset();
  const language = data.language;
  const topRisks = data.request_health.filter((row) => row.riskLevel === "High").slice(0, 5);
  const topAgencies = data.agencies.slice(0, 5);
  const weakAgencies = data.agencies.filter((agency) => agency.risk !== "Low").slice(0, 5);
  const reportName = getLocalizedReportName(data, language);

  if (isReportArabic(language)) {
    return [
      `${reportName}`,
      `تاريخ التوليد: ${data.generated_at}`,
      `النطاق: ${getLocalizedProject(data.project, language)} | اللغة: العربية | المخرج: ${data.output_format}`,
      `درجة السرية: ${reportStudioForm.confidential ? "سري" : "غير سري"}`,
      "",
      "الملخص التنفيذي",
      `حلل VisaFlow بيانات التوظيف والتأشيرات والتفويض والمرشحين والحشد والمكاتب. نسبة تقدم التوظيف الحالية ${data.totals?.recruitment_progress || 0}%، مع وجود ${data.forecast.totalRemainingRecruitment} فجوة توظيف متبقية و ${data.forecast.totalRemainingJoining} فجوة مباشرة متبقية.`,
      data.forecast.highRiskRequests > 0
        ? "توجد بنود طلبات عالية المخاطر قد تؤثر على الحشد إذا لم يتم التصعيد والمتابعة."
        : "المسار العام مستقر مع الحاجة إلى متابعة دورية للمؤشرات التشغيلية.",
      "",
      "لوحة المؤشرات",
      ...data.kpis.map((item) => `- ${localizeReportText(item.metric, language)}: ${item.value}`),
      "",
      "آخر التغييرات التشغيلية",
      ...(data.recent_operational_changes?.length
        ? data.recent_operational_changes.slice(0, 8).map((item) => `- ${item.date} | ${item.module} | ${item.request_no}: ${item.summary}`)
        : ["- لا توجد تغييرات تشغيلية مسجلة ضمن نطاق التقرير."]),
      "",
      "أعلى المخاطر",
      ...(topRisks.length
        ? topRisks.map((row) => `- ${row.request_no} / البند ${row.line_no} / ${row.profession}: ${localizeReportText(row.bottleneck, language)}، التقدم ${row.progress}%، درجة المخاطر ${row.riskScore}.`)
        : ["- لا توجد بنود عالية المخاطر حاليًا."]),
      "",
      "تحليل أداء المكاتب",
      ...(topAgencies.length
        ? topAgencies.map((agency) => `- ${agency.agency}: النقاط ${agency.score}، SLA ${agency.agreement_sla_days || 60} يوم، المتأخرون ${agency.delayed_candidates || 0}، الغرامة المحتملة ${Number(agency.penalty_exposure || 0).toLocaleString()} ريال.`)
        : ["- لا توجد بيانات مكاتب متاحة حتى الآن."]),
      "",
      "المكاتب التي تحتاج متابعة",
      ...(weakAgencies.length
        ? weakAgencies.map((agency) => `- ${agency.agency}: مستوى المخاطر ${localizeReportText(agency.risk, language)}، نسبة التعثر ${agency.failRate}%، النقاط ${agency.score}.`)
        : ["- لا توجد مخاطر متابعة واضحة على المكاتب حاليًا."]),
      "",
      "الإجراءات المقترحة",
      "1. مراجعة بنود الطلبات عالية المخاطر حسب المهنة والجنسية والجنس.",
      "2. إغلاق فجوات التأشيرات والتفويض قبل زيادة حجم التوريد من المكاتب.",
      "3. متابعة المكاتب ذات الأداء الضعيف أو التحديثات المتأخرة للمرشحين.",
      "4. نقل المرشحين المجتازين طبيًا والجاهزين للتأشيرة إلى مرحلة التذاكر والوصول.",
      "5. استخدام هذا التقرير في الاجتماع التنفيذي الأسبوعي وتحديد مالك لكل عائق.",
    ].join("\n");
  }

  if (isReportBilingual(language)) {
    return [
      `${reportName}`,
      `تاريخ التوليد / Generated: ${data.generated_at}`,
      `النطاق / Scope: ${getLocalizedProject(data.project, language)} | Language: Bilingual | Output: ${data.output_format}`,
      `Confidential / سري: ${reportStudioForm.confidential ? "Yes / نعم" : "No / لا"}`,
      "",
      "الملخص التنفيذي / Executive Summary",
      `حلل VisaFlow بيانات التوظيف والتأشيرات والتفويض والحشد. Current recruitment progress is ${data.totals?.recruitment_progress || 0}%, with ${data.forecast.totalRemainingRecruitment} recruitment gap(s) and ${data.forecast.totalRemainingJoining} joining gap(s).`,
      data.forecast.forecastMessage,
      "",
      "لوحة المؤشرات / KPI Dashboard",
      ...data.kpis.map((item) => `- ${localizeReportText(item.metric, language)}: ${item.value}`),
      "",
      "آخر التغييرات التشغيلية / Recent Operational Changes",
      ...(data.recent_operational_changes?.length
        ? data.recent_operational_changes.slice(0, 8).map((item) => `- ${item.date} | ${item.module} | ${item.request_no}: ${item.summary}`)
        : ["- لا توجد تغييرات تشغيلية ضمن النطاق / No operational changes in scope."]),
      "",
      "أعلى المخاطر / Top Risks",
      ...(topRisks.length ? topRisks.map((row) => `- ${row.request_no} / Line ${row.line_no} / ${row.profession}: ${localizeReportText(row.bottleneck, language)}, progress ${row.progress}%, risk ${row.riskScore}.`) : ["- لا توجد بنود عالية المخاطر حاليًا / No high-risk request lines detected."]),
      "",
      "الإجراءات المقترحة / Recommended Actions",
      "1. مراجعة بنود الطلبات عالية المخاطر / Review high-risk request lines.",
      "2. إغلاق فجوات التأشيرات والتفويض / Close visa and authorization gaps.",
      "3. متابعة المكاتب ذات الأداء الضعيف / Push weak or delayed agencies.",
      "4. تسريع التذاكر والوصول / Move ready candidates to ticketing and arrival.",
      "5. تحديد مالك لكل عائق / Assign an owner for each bottleneck.",
    ].join("\n");
  }

  return [
    `${data.report_name}`,
    `Generated: ${data.generated_at}`,
    `Scope: ${data.project} | Language: ${data.language} | Output: ${data.output_format}`,
    `Confidential: ${reportStudioForm.confidential ? "Yes" : "No"}`,
    "",
    "Executive Summary",
    `VisaFlow analyzed live recruitment, visa, authorization, candidate, mobilization and agency data. Current recruitment progress is ${data.totals?.recruitment_progress || 0}%, with ${data.forecast.totalRemainingRecruitment} remaining recruitment gap(s) and ${data.forecast.totalRemainingJoining} remaining joining gap(s).`,
    data.forecast.forecastMessage,
    "",
    "KPI Dashboard",
    ...data.kpis.map((item) => `- ${item.metric}: ${item.value}`),
    "",
    "Recent Operational Changes",
    ...(data.recent_operational_changes?.length
      ? data.recent_operational_changes.slice(0, 8).map((item) => `- ${item.date} | ${item.module} | ${item.request_no}: ${item.summary}`)
      : ["- No operational changes in scope."]),
    "",
    "Top Risks",
    ...(topRisks.length ? topRisks.map((row) => `- ${row.request_no} / Line ${row.line_no} / ${row.profession}: ${row.bottleneck}, progress ${row.progress}%, risk ${row.riskScore}.`) : ["- No high-risk request lines detected."]),
    "",
    "Agency Insights",
    ...(topAgencies.length ? topAgencies.map((agency) => `- ${agency.agency}: Score ${agency.score}, Agreement SLA ${agency.agreement_sla_days || 60} days, Delayed ${agency.delayed_candidates || 0}, Labor SLA penalty exposure ${Number(agency.penalty_exposure || 0).toLocaleString()} SAR.`) : ["- No agency data available yet."]),
    "",
    "Agencies Requiring Follow-up",
    ...(weakAgencies.length ? weakAgencies.map((agency) => `- ${agency.agency}: risk ${agency.risk}, fail rate ${agency.failRate}%, score ${agency.score}.`) : ["- No agency follow-up risk detected."]),
    "",
    "Recommended Actions",
    "1. Review high-risk request lines by profession, nationality and gender.",
    "2. Close visa allocation and authorization gaps before escalating sourcing volume.",
    "3. Push agencies with stale candidate updates or weak submission performance.",
    "4. Move medically passed and visa-ready candidates to ticketing and arrival.",
    "5. Use this report in the weekly executive meeting and assign owners for each bottleneck.",
  ].join("\n");
}
function previewAIReportStudio() {
  const narrative = buildAIReportStudioNarrative();
  setReportStudioResult(narrative);
  setReportStudioLastRun(new Date().toLocaleString());
}

function downloadReportStudioFile(fileName, content, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function buildReportStudioHtmlDocument(mode = "document") {
  const data = buildAIReportStudioDataset();
  const narrative = buildAIReportStudioNarrative();
  const language = data.language;
  const isArabic = isReportArabic(language);
  const title = getLocalizedReportName(data, language) || "VisaFlow AI Report";
  const rows = data.kpis.map((item) => `<tr><td>${localizeReportText(item.metric, language)}</td><td><b>${item.value}</b></td></tr>`).join("");
  const activityRows = (data.recent_operational_changes || [])
    .map((item) => `<tr><td>${item.date}</td><td>${item.module}</td><td>${item.request_no}</td><td>${item.summary}</td></tr>`)
    .join("");
  const slideMode = mode === "presentation";

  return `<!doctype html>
<html dir="${isArabic ? "rtl" : "ltr"}" lang="${isArabic ? "ar" : "en"}">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
body{font-family:Arial,Tahoma,sans-serif;margin:0;background:#f8fafc;color:#0f172a;line-height:1.6}.page{max-width:${slideMode ? "1100px" : "900px"};margin:30px auto;background:white;border-radius:22px;padding:36px;box-shadow:0 20px 70px rgba(15,23,42,.12)}.cover{background:linear-gradient(135deg,#020617,#0f766e);color:white;border-radius:24px;padding:42px;margin-bottom:24px}.badge{display:inline-block;padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.14);margin-bottom:14px}h1{margin:0;font-size:${slideMode ? "44px" : "34px"}}h2{margin-top:28px;color:#0f766e}table{width:100%;border-collapse:collapse;margin:18px 0}td,th{border:1px solid #e2e8f0;padding:10px;text-align:left}pre{white-space:pre-wrap;font-family:Arial,Tahoma,sans-serif;background:#f8fafc;border:1px solid #e2e8f0;border-radius:18px;padding:20px}.footer{margin-top:28px;color:#64748b;font-size:12px}@media print{body{background:white}.page{box-shadow:none;margin:0;border-radius:0}.cover{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<div class="page">
  <div class="cover">
    <div class="badge">VisaFlow KSA · AI Report Studio</div>
    <h1>${title}</h1>
    <p>${getLocalizedCategory(data.category, language)} · ${getLocalizedProject(data.project, language)} · ${data.language}</p>
  </div>
  <h2>${localizeReportText("KPI Dashboard", language)}</h2>
  <table>${rows}</table>
  <h2>${isArabic ? "آخر التغييرات التشغيلية" : "Recent Operational Changes"}</h2>
  <table>
    <thead><tr><th>${isArabic ? "التاريخ" : "Date"}</th><th>${isArabic ? "الموديول" : "Module"}</th><th>${isArabic ? "الطلب" : "Request"}</th><th>${isArabic ? "الملخص" : "Summary"}</th></tr></thead>
    <tbody>${activityRows || `<tr><td colspan="4">${isArabic ? "لا توجد تغييرات ضمن النطاق" : "No operational changes in scope"}</td></tr>`}</tbody>
  </table>
  <h2>${isArabic ? "التقرير التنفيذي الذكي" : "AI Executive Report"}</h2>
  <pre>${narrative.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
  <div class="footer">Generated by VisaFlow KSA AI Report Studio on ${data.generated_at}. ${reportStudioForm.confidential ? "Confidential" : ""}</div>
</div>
</body>
</html>`;
}

function sanitizeReportFileName(value) {
  return String(value || "VisaFlow_AI_Report")
    .replace(/[^a-z0-9-_\u0600-\u06FF]+/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "") || "VisaFlow_AI_Report";
}

function getReportKpiValue(data, metricName, fallback = "-") {
  return data.kpis.find((item) => item.metric === metricName)?.value ?? fallback;
}

function getReportNumber(value) {
  const number = Number(String(value ?? "0").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function trimSlideText(value, maxLength = 90) {
  const text = String(value || "-");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function addReportSlideTitle(slide, title, subtitle = "", language = reportStudioForm.language) {
  const isArabic = isReportArabic(language);
  slide.addText(title, {
    x: isArabic ? 4.8 : 0.45,
    y: 0.32,
    w: 7.9,
    h: 0.36,
    fontFace: getReportHeadFont(language),
    fontSize: 22,
    bold: true,
    color: "0F172A",
    align: getReportTextAlign(language),
    rtl: isArabic,
    margin: 0,
    fit: "shrink",
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: isArabic ? 2.95 : 0.48,
      y: 0.73,
      w: 9.7,
      h: 0.22,
      fontFace: getReportFont(language),
      fontSize: 8.5,
      color: "64748B",
      align: getReportTextAlign(language),
      rtl: isArabic,
      margin: 0,
      fit: "shrink",
    });
  }
  slide.addShape("line", {
    x: 0.45,
    y: 1.02,
    w: 12.4,
    h: 0,
    line: { color: "E2E8F0", width: 1 },
  });
}

function addReportFooter(slide, data, pageNo) {
  slide.addShape("line", {
    x: 0.48,
    y: 7.12,
    w: 12.3,
    h: 0,
    line: { color: "E2E8F0", width: 0.8 },
  });
  slide.addText("VisaFlow KSA · AI Report Studio", {
    x: 0.52,
    y: 7.22,
    w: 3.6,
    h: 0.18,
    fontFace: "Aptos",
    fontSize: 7.5,
    color: "64748B",
    margin: 0,
  });
  slide.addText(`${reportStudioForm.confidential ? "Confidential · " : ""}${data.generated_at}`, {
    x: 4.4,
    y: 7.22,
    w: 4.6,
    h: 0.18,
    fontFace: "Aptos",
    fontSize: 7.5,
    color: "94A3B8",
    align: "center",
    margin: 0,
  });
  slide.addText(String(pageNo), {
    x: 12.15,
    y: 7.22,
    w: 0.6,
    h: 0.18,
    fontFace: "Aptos",
    fontSize: 7.5,
    color: "64748B",
    align: "right",
    margin: 0,
  });
}

function addReportMetricCard(slide, x, y, w, h, label, value, accent = "2563EB", note = "") {
  slide.addShape("roundRect", {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    fill: { color: "FFFFFF", transparency: 0 },
    line: { color: "E2E8F0", transparency: 0 },
    shadow: { type: "outer", color: "94A3B8", opacity: 0.12, blur: 1, angle: 45, distance: 1 },
  });
  slide.addShape("rect", {
    x,
    y,
    w: 0.08,
    h,
    fill: { color: accent },
    line: { color: accent },
  });
  slide.addText(label.toUpperCase(), {
    x: x + 0.18,
    y: y + 0.13,
    w: w - 0.3,
    h: 0.18,
    fontFace: "Aptos",
    fontSize: 6.8,
    bold: true,
    charSpace: 1.1,
    color: "64748B",
    margin: 0,
    breakLine: false,
    fit: "shrink",
  });
  slide.addText(String(value), {
    x: x + 0.18,
    y: y + 0.42,
    w: w - 0.3,
    h: 0.36,
    fontFace: "Aptos Display",
    fontSize: 18,
    bold: true,
    color: "0F172A",
    margin: 0,
    breakLine: false,
    fit: "shrink",
  });
  if (note) {
    slide.addText(note, {
      x: x + 0.18,
      y: y + h - 0.27,
      w: w - 0.3,
      h: 0.18,
      fontFace: "Aptos",
      fontSize: 6.8,
      color: "94A3B8",
      margin: 0,
      breakLine: false,
      fit: "shrink",
    });
  }
}

function addReportProgressBar(slide, x, y, w, h, value, maxValue, color = "2563EB", label = "") {
  const pct = maxValue ? Math.max(0.03, Math.min(Number(value || 0) / Number(maxValue || 1), 1)) : 0.03;
  slide.addShape("roundRect", {
    x,
    y,
    w,
    h,
    rectRadius: 0.05,
    fill: { color: "E2E8F0" },
    line: { color: "E2E8F0" },
  });
  slide.addShape("roundRect", {
    x,
    y,
    w: w * pct,
    h,
    rectRadius: 0.05,
    fill: { color },
    line: { color },
  });
  if (label) {
    slide.addText(label, {
      x,
      y: y - 0.18,
      w,
      h: 0.13,
      fontFace: "Aptos",
      fontSize: 6.5,
      color: "475569",
      margin: 0,
      fit: "shrink",
    });
  }
}

function escapeSvgText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function svgToDataUri(svg) {
  const encoded = typeof window !== "undefined" && window.btoa
    ? window.btoa(unescape(encodeURIComponent(svg)))
    : btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${encoded}`;
}

function addSvgChart(slide, svg, x, y, w, h) {
  slide.addImage({ data: svgToDataUri(svg), x, y, w, h });
}

function buildDonutSvg({ title, value, subtitle, color = "#2563eb", language = "English" }) {
  const pct = Math.max(0, Math.min(Number(value || 0), 100));
  const dash = `${pct} ${100 - pct}`;
  const dir = isReportArabic(language) ? "rtl" : "ltr";
  const font = isReportArabic(language) ? "Arial" : "Aptos, Arial";
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="460" height="320" viewBox="0 0 460 320" direction="${dir}">
    <defs>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#0f172a" flood-opacity="0.12"/></filter>
    </defs>
    <rect x="8" y="8" width="444" height="304" rx="28" fill="#ffffff" filter="url(#shadow)"/>
    <text x="230" y="48" text-anchor="middle" font-family="${font}" font-size="22" font-weight="700" fill="#0f172a">${escapeSvgText(title)}</text>
    <circle cx="230" cy="158" r="76" fill="none" stroke="#e2e8f0" stroke-width="24"/>
    <circle cx="230" cy="158" r="76" fill="none" stroke="${color}" stroke-width="24" stroke-linecap="round" pathLength="100" stroke-dasharray="${dash}" transform="rotate(-90 230 158)"/>
    <text x="230" y="150" text-anchor="middle" font-family="${font}" font-size="34" font-weight="800" fill="#0f172a">${Math.round(pct)}%</text>
    <text x="230" y="181" text-anchor="middle" font-family="${font}" font-size="15" fill="#64748b">${escapeSvgText(subtitle || "")}</text>
    <rect x="154" y="250" width="152" height="10" rx="5" fill="#e2e8f0"/>
    <rect x="154" y="250" width="${Math.max(8, 152 * pct / 100)}" height="10" rx="5" fill="${color}"/>
  </svg>`;
}

function buildHorizontalBarChartSvg({ title, rows = [], color = "#2563eb", language = "English", suffix = "" }) {
  const dir = isReportArabic(language) ? "rtl" : "ltr";
  const font = isReportArabic(language) ? "Arial" : "Aptos, Arial";
  const safeRows = rows.slice(0, 7);
  const max = Math.max(...safeRows.map((item) => Number(item.value || 0)), 1);
  const rowSvg = safeRows.map((item, index) => {
    const y = 78 + index * 42;
    const value = Number(item.value || 0);
    const pct = Math.max(0.02, Math.min(value / max, 1));
    const barW = 300 * pct;
    const labelX = isReportArabic(language) ? 414 : 46;
    const valueX = isReportArabic(language) ? 46 : 414;
    const anchorLabel = isReportArabic(language) ? "end" : "start";
    const anchorValue = isReportArabic(language) ? "start" : "end";
    return `
      <text x="${labelX}" y="${y}" text-anchor="${anchorLabel}" font-family="${font}" font-size="14" font-weight="700" fill="#334155">${escapeSvgText(item.label)}</text>
      <text x="${valueX}" y="${y}" text-anchor="${anchorValue}" font-family="${font}" font-size="13" font-weight="800" fill="${item.color || color}">${escapeSvgText(`${value}${suffix}`)}</text>
      <rect x="46" y="${y + 12}" width="368" height="12" rx="6" fill="#e2e8f0"/>
      <rect x="46" y="${y + 12}" width="${Math.max(8, barW + 68)}" height="12" rx="6" fill="${item.color || color}"/>
    `;
  }).join("");
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="460" height="390" viewBox="0 0 460 390" direction="${dir}">
    <defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#0f172a" flood-opacity="0.10"/></filter></defs>
    <rect x="8" y="8" width="444" height="374" rx="28" fill="#ffffff" filter="url(#shadow)"/>
    <text x="230" y="45" text-anchor="middle" font-family="${font}" font-size="22" font-weight="800" fill="#0f172a">${escapeSvgText(title)}</text>
    ${rowSvg}
  </svg>`;
}

function buildRiskDistributionSvg({ high, medium, low, language = "English" }) {
  const total = Math.max(Number(high || 0) + Number(medium || 0) + Number(low || 0), 1);
  const highPct = Math.round((Number(high || 0) / total) * 100);
  const mediumPct = Math.round((Number(medium || 0) / total) * 100);
  const lowPct = Math.max(0, 100 - highPct - mediumPct);
  return buildHorizontalBarChartSvg({
    title: localizeReportText("Risk & Gaps", language),
    language,
    suffix: "%",
    rows: [
      { label: localizeReportText("High Risk", language), value: highPct, color: "#e11d48" },
      { label: localizeReportText("Medium Risk", language), value: mediumPct, color: "#f59e0b" },
      { label: localizeReportText("Safe Lines", language), value: lowPct, color: "#22c55e" },
    ],
  });
}

async function buildReportStudioPptx(fileName) {
  const data = buildAIReportStudioDataset();
  const language = data.language;
  const isArabic = isReportArabic(language);
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "VisaFlow KSA";
  pptx.company = "VisaFlow KSA";
  pptx.subject = data.template || data.report_name || "AI Report Studio";
  pptx.title = getLocalizedReportName(data, language) || "VisaFlow AI Report";
  pptx.lang = isArabic ? "ar-SA" : "en-US";
  pptx.theme = {
    headFontFace: getReportHeadFont(language),
    bodyFontFace: getReportFont(language),
    lang: isArabic ? "ar-SA" : "en-US",
  };

  const required = getReportNumber(getReportKpiValue(data, "Required Manpower", 0));
  const candidatesTotal = getReportNumber(getReportKpiValue(data, "Active Candidates", 0));
  const submittedCandidatesTotal = getReportNumber(getReportKpiValue(data, "Submitted Candidates", candidatesTotal));
  const extraCandidatesTotal = getReportNumber(getReportKpiValue(data, "Extra / Backup Candidates", 0));
  const joinedTotal = getReportNumber(getReportKpiValue(data, "Joined", 0));
  const recruitmentProgress = getReportNumber(getReportKpiValue(data, "Recruitment Progress", data.totals?.recruitment_progress || 0));
  const candidateCoverage = required ? Math.min(Math.round((candidatesTotal / required) * 100), 100) : recruitmentProgress;
  const joiningProgress = required ? Math.min(Math.round((joinedTotal / required) * 100), 100) : 0;
  const saudizationRate = getReportNumber(getReportKpiValue(data, "Saudization Rate", executiveDashboard.saudizationRate));
  const highRiskCount = data.request_health.filter((row) => row.riskLevel === "High").length;
  const mediumRiskCount = data.request_health.filter((row) => row.riskLevel === "Medium").length;
  const safeRiskCount = Math.max(data.request_health.length - highRiskCount - mediumRiskCount, 0);
  const topRisks = data.request_health.filter((row) => row.riskLevel === "High").slice(0, 5);
  const riskRows = (topRisks.length ? topRisks : data.request_health.slice(0, 5));
  const topAgencies = data.agencies.slice(0, 7);
  const funnelRows = [
    { stage: "Required", value: required },
    { stage: "Covered Candidates", value: candidatesTotal },
    { stage: "Submitted Candidates", value: submittedCandidatesTotal },
    { stage: "Joined", value: joinedTotal },
  ].filter((item) => item.value !== undefined);
  const colors = ["2563EB", "14B8A6", "F97316", "A855F7", "06B6D4", "22C55E", "E11D48"];
  const reportName = getLocalizedReportName(data, language);
  const scopeText = isArabic
    ? `${getLocalizedCategory(data.category, language)} · ${getLocalizedProject(data.project, language)} · العربية`
    : `${getLocalizedCategory(data.category, language)} · ${getLocalizedProject(data.project, language)} · ${data.language}`;

  let slide = pptx.addSlide();
  slide.background = { color: "020617" };
  slide.addShape("rect", { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: "020617" }, line: { color: "020617" } });
  slide.addShape("rect", { x: 7.9, y: 0, w: 5.5, h: 7.5, fill: { color: "0F766E", transparency: 10 }, line: { color: "0F766E", transparency: 100 } });
  slide.addShape("rect", { x: 10.4, y: 0, w: 3, h: 7.5, fill: { color: "7C3AED", transparency: 18 }, line: { color: "7C3AED", transparency: 100 } });
  slide.addText("VisaFlow KSA · AI Report Studio", {
    x: isArabic ? 7.2 : 0.7,
    y: 0.62,
    w: 4.7,
    h: 0.25,
    fontFace: getReportFont(language),
    fontSize: 11,
    bold: true,
    color: "67E8F9",
    align: getReportTextAlign(language),
    rtl: isArabic,
    margin: 0,
  });
  slide.addText(reportName, {
    x: isArabic ? 4.35 : 0.68,
    y: 1.48,
    w: 7.6,
    h: 1.0,
    fontFace: getReportHeadFont(language),
    fontSize: isArabic ? 30 : 38,
    bold: true,
    color: "FFFFFF",
    align: getReportTextAlign(language),
    rtl: isArabic,
    margin: 0,
    fit: "shrink",
  });
  slide.addText(scopeText, {
    x: isArabic ? 5.15 : 0.72,
    y: 2.56,
    w: 6.8,
    h: 0.28,
    fontFace: getReportFont(language),
    fontSize: 13,
    color: "CBD5E1",
    align: getReportTextAlign(language),
    rtl: isArabic,
    margin: 0,
  });
  slide.addShape("roundRect", { x: isArabic ? 9.9 : 0.72, y: 3.25, w: 2.05, h: 0.38, rectRadius: 0.07, fill: { color: "FFFFFF", transparency: 86 }, line: { color: "FFFFFF", transparency: 82 } });
  slide.addText(reportStudioForm.confidential ? localizeReportText("Confidential", language).toUpperCase() : localizeReportText("Executive Copy", language).toUpperCase(), {
    x: isArabic ? 10.08 : 0.88,
    y: 3.35,
    w: 1.7,
    h: 0.14,
    fontFace: getReportFont(language),
    fontSize: 7.5,
    bold: true,
    color: "FFFFFF",
    align: "center",
    rtl: isArabic,
    margin: 0,
  });
  const progressSubtitle = extraCandidatesTotal > 0
    ? (isArabic
        ? `${candidatesTotal} محتسب من أصل ${required} مطلوب + ${extraCandidatesTotal} احتياط`
        : `${candidatesTotal} covered of ${required} required + ${extraCandidatesTotal} backup`)
    : (isArabic ? `${candidatesTotal} محتسب من أصل ${required} مطلوب` : `${candidatesTotal} covered of ${required} required`);
  addReportMetricCard(slide, 8.2, 1.05, 3.75, 1.05, localizeReportText("Recruitment Progress", language), `${recruitmentProgress}%`, "22C55E", progressSubtitle);
  addReportMetricCard(slide, 8.2, 2.35, 1.75, 1.05, localizeReportText("Visa Gap", language), getReportKpiValue(data, "Visa Gap"), "2563EB");
  addReportMetricCard(slide, 10.2, 2.35, 1.75, 1.05, localizeReportText("High Risk", language), getReportKpiValue(data, "High Risk Lines"), "E11D48");
  addReportMetricCard(slide, 8.2, 3.65, 1.75, 1.05, localizeReportText("Joined", language), joinedTotal, "14B8A6");
  addReportMetricCard(slide, 10.2, 3.65, 1.75, 1.05, localizeReportText("Budget Variance", language), getReportKpiValue(data, "Budget Variance"), "F97316");
  slide.addText(`${localizeReportText("Generated", language)} ${data.generated_at}`, { x: isArabic ? 6.1 : 0.74, y: 6.87, w: 5.85, h: 0.2, fontFace: getReportFont(language), fontSize: 8, color: "94A3B8", align: getReportTextAlign(language), rtl: isArabic, margin: 0 });

  slide = pptx.addSlide();
  slide.background = { color: "F8FAFC" };
  addReportSlideTitle(slide, localizeReportText("KPI Dashboard", language), reportPhrase("Live recruitment, visa, authorization and mobilization indicators.", "مؤشرات مباشرة للتوظيف والتأشيرات والتفويض والحشد.", language), language);
  const kpiCards = [
    ["Required Manpower", getReportKpiValue(data, "Required Manpower"), "2563EB", "Demand volume"],
    ["Active Candidates", getReportKpiValue(data, "Active Candidates"), "14B8A6", "Candidate coverage"],
    ["Joined", getReportKpiValue(data, "Joined"), "22C55E", "Confirmed joining"],
    ["Recruitment Progress", getReportKpiValue(data, "Recruitment Progress"), "A855F7", "Candidate coverage"],
    ["Visa Gap", getReportKpiValue(data, "Visa Gap"), "F97316", "Allocation shortage"],
    ["Authorization Gap", getReportKpiValue(data, "Authorization Gap"), "E11D48", "Authorization shortage"],
  ];
  kpiCards.forEach((card, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    addReportMetricCard(slide, 0.65 + col * 4.12, 1.35 + row * 1.25, 3.75, 0.95, localizeReportText(card[0], language), card[1], card[2], localizeReportText(card[3], language));
  });
  slide.addText(localizeReportText("Executive Summary", language), { x: isArabic ? 3.65 : 0.7, y: 4.1, w: 2.8, h: 0.25, fontFace: getReportHeadFont(language), fontSize: 16, bold: true, color: "0F172A", align: getReportTextAlign(language), rtl: isArabic, margin: 0 });
  slide.addText(isArabic
    ? `حلل VisaFlow بيانات التوظيف والتأشيرات والتفويض والمرشحين والحشد والمكاتب. نسبة تقدم التوظيف الحالية ${recruitmentProgress}%، مع وجود ${data.forecast.totalRemainingRecruitment} فجوة توظيف و ${data.forecast.totalRemainingJoining} فجوة مباشرة.`
    : `VisaFlow analyzed live recruitment, visa, authorization, candidate, mobilization and agency data. Current recruitment progress is ${recruitmentProgress}%, with ${data.forecast.totalRemainingRecruitment} remaining recruitment gap(s) and ${data.forecast.totalRemainingJoining} remaining joining gap(s).`, {
    x: 0.7,
    y: 4.48,
    w: 5.75,
    h: 1.15,
    fontFace: getReportFont(language),
    fontSize: isArabic ? 11 : 12,
    color: "334155",
    align: getReportTextAlign(language),
    rtl: isArabic,
    fit: "shrink",
    valign: "mid",
    margin: 0.05,
  });
  slide.addShape("roundRect", { x: 7.0, y: 4.05, w: 5.45, h: 1.45, rectRadius: 0.08, fill: { color: "ECFEFF" }, line: { color: "A5F3FC" } });
  slide.addText(localizeReportText("AI Forecast", language), { x: isArabic ? 9.9 : 7.25, y: 4.25, w: 2.2, h: 0.25, fontFace: getReportHeadFont(language), fontSize: 14, bold: true, color: "0E7490", align: getReportTextAlign(language), rtl: isArabic, margin: 0 });
  slide.addText(isArabic && data.forecast.highRiskRequests > 0 ? "بنود عالية المخاطر قد تؤثر على الحشد ما لم يتم التصعيد والمتابعة." : data.forecast.forecastMessage || "Pipeline is stable if current pace continues.", { x: 7.25, y: 4.62, w: 4.85, h: 0.55, fontFace: getReportFont(language), fontSize: 11, color: "155E75", align: getReportTextAlign(language), rtl: isArabic, fit: "shrink", margin: 0.03 });
  addReportFooter(slide, data, 2);

  slide = pptx.addSlide();
  slide.background = { color: "F8FAFC" };
  addReportSlideTitle(slide, localizeReportText("Charts & Performance", language), reportPhrase("Visual performance charts generated from live VisaFlow data.", "رسوم بيانية للأداء مبنية على بيانات VisaFlow المباشرة.", language), language);
  addSvgChart(slide, buildDonutSvg({ title: localizeReportText("Recruitment Progress", language), value: recruitmentProgress, subtitle: isArabic ? "تغطية التوظيف" : "Recruitment coverage", color: "#2563eb", language }), 0.6, 1.25, 3.45, 2.4);
  addSvgChart(slide, buildDonutSvg({ title: localizeReportText("Joined", language), value: joiningProgress, subtitle: isArabic ? "نسبة المباشرة" : "Joining progress", color: "#14b8a6", language }), 4.95, 1.25, 3.45, 2.4);
  addSvgChart(slide, buildDonutSvg({ title: localizeReportText("Saudization Rate", language), value: saudizationRate, subtitle: isArabic ? "نسبة السعودة" : "Saudization", color: "#a855f7", language }), 9.25, 1.25, 3.45, 2.4);
  addSvgChart(slide, buildRiskDistributionSvg({ high: highRiskCount, medium: mediumRiskCount, low: safeRiskCount, language }), 0.6, 4.0, 5.4, 2.8);
  addSvgChart(slide, buildHorizontalBarChartSvg({
    title: localizeReportText("Agency Insights", language),
    language,
    rows: topAgencies.slice(0, 5).map((agency) => ({ label: agency.agency, value: agency.score || 0, color: agency.risk === "High" ? "#e11d48" : agency.risk === "Medium" ? "#f59e0b" : "#22c55e" })),
  }), 7.05, 4.0, 5.4, 2.8);
  addReportFooter(slide, data, 3);

  slide = pptx.addSlide();
  slide.background = { color: "F8FAFC" };
  addReportSlideTitle(slide, localizeReportText("Recruitment Funnel", language), reportPhrase("From required manpower to joined employees with percentage bars.", "من العدد المطلوب إلى المباشرة مع نسب الأداء.", language), language);
  const maxFunnel = Math.max(...funnelRows.map((item) => Number(item.value || 0)), required, 1);
  const funnelSvgRows = funnelRows.map((item, index) => ({
    label: localizeReportText(item.stage, language),
    value: Number(item.value || 0),
    color: `#${colors[index % colors.length]}`,
  }));
  addSvgChart(slide, buildHorizontalBarChartSvg({ title: localizeReportText("Recruitment Funnel", language), rows: funnelSvgRows, language }), 0.75, 1.24, 5.9, 4.95);
  const percentRows = funnelRows.map((item, index) => ({
    label: localizeReportText(item.stage, language),
    value: required ? Math.round((Number(item.value || 0) / required) * 100) : 0,
    color: `#${colors[index % colors.length]}`,
  }));
  addSvgChart(slide, buildHorizontalBarChartSvg({ title: isArabic ? "نسب مراحل التوظيف" : "Stage Percentages", rows: percentRows, language, suffix: "%" }), 6.8, 1.24, 5.9, 4.95);
  slide.addShape("roundRect", { x: 0.75, y: 6.52, w: 11.9, h: 0.42, rectRadius: 0.06, fill: { color: "EEF2FF" }, line: { color: "C7D2FE" } });
  slide.addText(`${localizeReportText("Main action", language)}: ${isArabic && data.forecast.highRiskRequests > 0 ? "تصعيد البنود عالية المخاطر وتحديد مسؤول لكل عائق." : data.forecast.forecastMessage}`, { x: 0.95, y: 6.64, w: 11.45, h: 0.14, fontFace: getReportFont(language), fontSize: 8.5, color: "3730A3", align: getReportTextAlign(language), rtl: isArabic, margin: 0, fit: "shrink" });
  addReportFooter(slide, data, 4);

  slide = pptx.addSlide();
  slide.background = { color: "F8FAFC" };
  addReportSlideTitle(slide, localizeReportText("Risk & Gaps", language), reportPhrase("High-risk request lines and operational bottlenecks.", "بنود الطلبات عالية المخاطر والعوائق التشغيلية.", language), language);
  addReportMetricCard(slide, 0.72, 1.28, 2.65, 0.92, localizeReportText("High Risk Lines", language), getReportKpiValue(data, "High Risk Lines"), "E11D48");
  addReportMetricCard(slide, 3.62, 1.28, 2.65, 0.92, localizeReportText("Visa Gap", language), getReportKpiValue(data, "Visa Gap"), "F97316");
  addReportMetricCard(slide, 6.52, 1.28, 2.65, 0.92, localizeReportText("Authorization Gap", language), getReportKpiValue(data, "Authorization Gap"), "A855F7");
  addReportMetricCard(slide, 9.42, 1.28, 2.65, 0.92, localizeReportText("Joining Gap", language), data.forecast.totalRemainingJoining, "06B6D4");
  slide.addText(localizeReportText("Top Request-Line Risks", language), { x: isArabic ? 7.95 : 0.72, y: 2.62, w: 4, h: 0.24, fontFace: getReportHeadFont(language), fontSize: 15, bold: true, color: "0F172A", align: getReportTextAlign(language), rtl: isArabic, margin: 0 });
  riskRows.slice(0, 5).forEach((row, index) => {
    const y = 3.04 + index * 0.58;
    const accent = row.riskLevel === "High" ? "E11D48" : row.riskLevel === "Medium" ? "F59E0B" : "22C55E";
    slide.addShape("roundRect", { x: 0.72, y, w: 11.65, h: 0.42, rectRadius: 0.05, fill: { color: "FFFFFF" }, line: { color: "E2E8F0" } });
    slide.addShape("rect", { x: isArabic ? 12.29 : 0.72, y, w: 0.08, h: 0.42, fill: { color: accent }, line: { color: accent } });
    slide.addText(`${row.request_no} · ${isArabic ? "البند" : "Line"} ${row.line_no} · ${trimSlideText(row.profession, 48)}`, { x: isArabic ? 6.55 : 0.9, y: y + 0.11, w: 5.4, h: 0.15, fontFace: getReportFont(language), fontSize: 7.8, bold: true, color: "0F172A", align: getReportTextAlign(language), rtl: isArabic, margin: 0, fit: "shrink" });
    slide.addText(trimSlideText(localizeReportText(row.bottleneck, language), 32), { x: isArabic ? 3.58 : 6.4, y: y + 0.11, w: 2.35, h: 0.15, fontFace: getReportFont(language), fontSize: 7.6, color: "475569", align: getReportTextAlign(language), rtl: isArabic, margin: 0, fit: "shrink" });
    addReportProgressBar(slide, 1.85, y + 0.14, 2.2, 0.1, row.progress || 0, 100, accent);
    slide.addText(`${row.progress || 0}% / ${row.riskScore || 0}`, { x: 0.95, y: y + 0.1, w: 0.95, h: 0.15, fontFace: getReportFont(language), fontSize: 7.5, color: accent, bold: true, align: "right", margin: 0 });
  });
  addReportFooter(slide, data, 5);

  slide = pptx.addSlide();
  slide.background = { color: "F8FAFC" };
  addReportSlideTitle(slide, localizeReportText("Agency Insights", language), reportPhrase("Agency scores, candidate submissions and joining performance.", "نقاط المكاتب والترشيحات ونسبة المباشرة.", language), language);
  if (topAgencies.length) {
    addSvgChart(slide, buildHorizontalBarChartSvg({
      title: isArabic ? "ترتيب أداء المكاتب" : "Agency Performance Ranking",
      language,
      rows: topAgencies.map((agency) => ({ label: agency.agency, value: agency.score || 0, color: agency.risk === "High" ? "#e11d48" : agency.risk === "Medium" ? "#f59e0b" : "#22c55e" })),
    }), 0.72, 1.2, 5.95, 5.25);
    topAgencies.slice(0, 6).forEach((agency, index) => {
      const y = 1.34 + index * 0.78;
      const accent = agency.risk === "High" ? "E11D48" : agency.risk === "Medium" ? "F59E0B" : "22C55E";
      slide.addShape("roundRect", { x: 7.0, y, w: 5.4, h: 0.55, rectRadius: 0.06, fill: { color: "FFFFFF" }, line: { color: "E2E8F0" } });
      slide.addText(trimSlideText(agency.agency, 30), { x: isArabic ? 9.1 : 7.22, y: y + 0.11, w: 2.7, h: 0.16, fontFace: getReportFont(language), fontSize: 9, bold: true, color: "0F172A", align: getReportTextAlign(language), rtl: isArabic, margin: 0, fit: "shrink" });
      addReportProgressBar(slide, 7.32, y + 0.34, 3.2, 0.11, agency.score || 0, 100, accent);
      slide.addText(`${localizeReportText("Score", language)} ${agency.score || 0} · ${localizeReportText(agency.risk || "Low", language)}`, { x: 10.62, y: y + 0.28, w: 1.45, h: 0.16, fontFace: getReportFont(language), fontSize: 7.5, bold: true, color: accent, align: "right", margin: 0, fit: "shrink" });
    });
  } else {
    slide.addText(localizeReportText("No agency data available yet.", language), { x: isArabic ? 6.3 : 0.72, y: 1.7, w: 6, h: 0.3, fontFace: getReportFont(language), fontSize: 15, color: "64748B", align: getReportTextAlign(language), rtl: isArabic, margin: 0 });
  }
  slide.addShape("roundRect", { x: 0.72, y: 6.55, w: 11.6, h: 0.34, rectRadius: 0.06, fill: { color: "FFF7ED" }, line: { color: "FED7AA" } });
  slide.addText(isArabic ? "التوصية: متابعة المكاتب ذات التحديثات المتأخرة أو الأداء الضعيف قبل زيادة التخصيصات الجديدة." : "Recommendation: push agencies with stale candidate updates or weak submission performance before increasing new allocations.", { x: 0.94, y: 6.65, w: 11.05, h: 0.12, fontFace: getReportFont(language), fontSize: 8.2, color: "9A3412", align: getReportTextAlign(language), rtl: isArabic, margin: 0, fit: "shrink" });
  addReportFooter(slide, data, 6);

  slide = pptx.addSlide();
  slide.background = { color: "F8FAFC" };
  addReportSlideTitle(slide, localizeReportText("Recent Operational Changes", language), reportPhrase("Latest request and process changes captured from the audit log.", "آخر التغييرات على الطلبات والإجراءات من سجل الحركة التشغيلية.", language), language);
  const recentChanges = data.recent_operational_changes || [];
  if (recentChanges.length) {
    recentChanges.slice(0, 8).forEach((item, index) => {
      const y = 1.25 + index * 0.62;
      slide.addShape("roundRect", { x: 0.72, y, w: 11.65, h: 0.48, rectRadius: 0.05, fill: { color: "FFFFFF" }, line: { color: "E2E8F0" } });
      slide.addShape("rect", { x: isArabic ? 12.29 : 0.72, y, w: 0.08, h: 0.48, fill: { color: "2563EB" }, line: { color: "2563EB" } });
      slide.addText(`${item.date} · ${item.module} · ${item.request_no}`, { x: isArabic ? 7.55 : 0.92, y: y + 0.08, w: 4.4, h: 0.14, fontFace: getReportFont(language), fontSize: 7.5, bold: true, color: "334155", align: getReportTextAlign(language), rtl: isArabic, margin: 0, fit: "shrink" });
      slide.addText(trimSlideText(item.summary, 125), { x: 0.92, y: y + 0.27, w: 10.85, h: 0.14, fontFace: getReportFont(language), fontSize: 7.2, color: "0F172A", align: getReportTextAlign(language), rtl: isArabic, margin: 0, fit: "shrink" });
    });
  } else {
    slide.addText(localizeReportText("No operational changes in scope.", language), { x: isArabic ? 6.3 : 0.72, y: 1.7, w: 6, h: 0.3, fontFace: getReportFont(language), fontSize: 15, color: "64748B", align: getReportTextAlign(language), rtl: isArabic, margin: 0 });
  }
  addReportFooter(slide, data, 7);

  slide = pptx.addSlide();
  slide.background = { color: "F8FAFC" };
  addReportSlideTitle(slide, localizeReportText("Recommended Actions", language), reportPhrase("Suggested executive decisions for the weekly meeting.", "قرارات تنفيذية مقترحة للاجتماع الأسبوعي.", language), language);
  const actions = isArabic
    ? [
        "مراجعة بنود الطلبات عالية المخاطر حسب المهنة والجنسية والجنس.",
        "إغلاق فجوات التأشيرات والتفويض قبل زيادة حجم التوريد.",
        "متابعة المكاتب ذات التحديثات المتأخرة أو الأداء الضعيف.",
        "تسريع المرشحين الجاهزين إلى مرحلة التذاكر والوصول.",
        "تحديد مالك مسؤول لكل عائق ومراجعته أسبوعيًا.",
      ]
    : [
        "Review high-risk request lines by profession, nationality and gender.",
        "Close visa allocation and authorization gaps before escalating sourcing volume.",
        "Push agencies with stale candidate updates or weak submission performance.",
        "Move medically passed and visa-ready candidates to ticketing and arrival.",
        "Assign one accountable owner for each bottleneck and review progress weekly.",
      ];
  actions.forEach((action, index) => {
    const y = 1.45 + index * 0.86;
    slide.addShape("ellipse", { x: isArabic ? 11.75 : 0.78, y, w: 0.42, h: 0.42, fill: { color: colors[index % colors.length] }, line: { color: colors[index % colors.length] } });
    slide.addText(String(index + 1), { x: isArabic ? 11.87 : 0.9, y: y + 0.12, w: 0.18, h: 0.12, fontFace: getReportFont(language), fontSize: 8, bold: true, color: "FFFFFF", align: "center", margin: 0 });
    slide.addText(action, { x: isArabic ? 1.45 : 1.45, y: y + 0.08, w: 10.2, h: 0.26, fontFace: getReportFont(language), fontSize: 13, color: "0F172A", align: getReportTextAlign(language), rtl: isArabic, margin: 0, fit: "shrink" });
  });
  slide.addShape("roundRect", { x: 0.78, y: 6.25, w: 11.5, h: 0.52, rectRadius: 0.08, fill: { color: "ECFDF5" }, line: { color: "A7F3D0" } });
  slide.addText(isArabic ? "تم توليد هذا العرض مباشرة كملف PowerPoint حقيقي بصيغة .pptx من بيانات VisaFlow المباشرة." : "This presentation was generated directly as a PowerPoint .pptx file from VisaFlow live data.", { x: 1.0, y: 6.42, w: 11.0, h: 0.14, fontFace: getReportFont(language), fontSize: 8.5, color: "047857", align: getReportTextAlign(language), rtl: isArabic, margin: 0, fit: "shrink" });
  addReportFooter(slide, data, 8);

  await pptx.writeFile({ fileName });
}

async function exportAIReportStudio() {
  const data = buildAIReportStudioDataset();
  const safeName = sanitizeReportFileName(reportStudioForm.reportName || "VisaFlow_AI_Report");
  const format = reportStudioForm.outputFormat;
  setReportStudioResult(buildAIReportStudioNarrative());
  setReportStudioLastRun(new Date().toLocaleString());

  if (format === "Excel") {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.kpis), "KPIs");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.request_health.slice(0, 200)), "Request Lines");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.agencies.slice(0, 200)), "Agencies");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.mobilization.slice(0, 200)), "Mobilization");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet((data.recent_operational_changes || []).slice(0, 200)), "Activity Log");
    XLSX.writeFile(workbook, `${safeName}.xlsx`);
    return;
  }

  if (format === "Word") {
    return downloadReportStudioFile(`${safeName}.doc`, buildReportStudioHtmlDocument("document"), "application/msword;charset=utf-8");
  }

  if (format === "PowerPoint") {
    try {
      await buildReportStudioPptx(`${safeName}.pptx`);
    } catch (error) {
      console.error("PowerPoint export failed", error);
      alert(`PowerPoint export failed: ${error?.message || error}`);
    }
    return;
  }

  if (format === "PDF") {
    downloadReportStudioFile(`${safeName}_print_to_pdf.html`, buildReportStudioHtmlDocument("document"), "text/html;charset=utf-8");
    alert("PDF-ready file generated. Open it in the browser and choose Print > Save as PDF.");
    return;
  }

  return downloadReportStudioFile(`${safeName}.txt`, buildAIReportStudioNarrative());
}

const VIZ_COLORS = ["#2563eb", "#14b8a6", "#f97316", "#a855f7", "#06b6d4", "#22c55e", "#e11d48", "#f59e0b"];

function formatCompactNumber(value, suffix = "") {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return `0${suffix}`;
  if (Math.abs(number) >= 1000000) return `${(number / 1000000).toFixed(1)}M${suffix}`;
  if (Math.abs(number) >= 1000) return `${(number / 1000).toFixed(1)}K${suffix}`;
  return `${number.toLocaleString()}${suffix}`;
}

function getPercentValue(value, total) {
  const safeValue = Number(value || 0);
  const safeTotal = Number(total || 0);
  if (!safeTotal) return 0;
  return Math.max(0, Math.min(Math.round((safeValue / safeTotal) * 100), 100));
}

function VisualKpi({ icon, title, value, subtitle, color = "#2563eb", progress = null }) {
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: "24px",
        padding: "20px",
        background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.94))",
        border: "1px solid rgba(226,232,240,0.95)",
        boxShadow: "0 18px 45px rgba(15,23,42,0.08)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "-60px auto auto -50px",
          width: "140px",
          height: "140px",
          borderRadius: "999px",
          background: color,
          opacity: 0.12,
          filter: "blur(3px)",
        }}
      />
      <div style={{ position: "relative", display: "flex", justifyContent: "space-between", gap: "14px", alignItems: "flex-start" }}>
        <div>
          <div style={{ color: "#64748b", fontSize: "12px", fontWeight: 900, textTransform: "uppercase", letterSpacing: ".08em" }}>{title}</div>
          <div style={{ color: "#0f172a", fontSize: "30px", fontWeight: 950, letterSpacing: "-0.04em", marginTop: "8px" }}>{value}</div>
          {subtitle && <div style={{ color: "#64748b", fontSize: "13px", marginTop: "6px", lineHeight: 1.5 }}>{subtitle}</div>}
        </div>
        <div
          style={{
            width: "46px",
            height: "46px",
            borderRadius: "16px",
            display: "grid",
            placeItems: "center",
            color: "white",
            fontSize: "21px",
            background: `linear-gradient(135deg, ${color}, #0f172a)`,
            boxShadow: `0 14px 28px ${color}35`,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
      </div>
      {progress !== null && (
        <div style={{ marginTop: "16px" }}>
          <div style={{ height: "8px", borderRadius: "999px", background: "#e2e8f0", overflow: "hidden" }}>
            <div style={{ width: `${Math.max(0, Math.min(Number(progress || 0), 100))}%`, height: "100%", borderRadius: "999px", background: `linear-gradient(90deg, ${color}, #38bdf8)` }} />
          </div>
        </div>
      )}
    </div>
  );
}

function MiniBarChart({ rows = [], valueSuffix = "", maxItems = 8 }) {
  const cleanRows = rows.slice(0, maxItems).filter(Boolean);
  const maxValue = Math.max(...cleanRows.map((row) => Number(row.value || 0)), 1);

  return (
    <div style={{ display: "grid", gap: "13px" }}>
      {cleanRows.length === 0 ? (
        <div style={{ padding: "20px", borderRadius: "18px", background: "#f8fafc", color: "#64748b", textAlign: "center" }}>No data available</div>
      ) : (
        cleanRows.map((row, index) => {
          const color = row.color || VIZ_COLORS[index % VIZ_COLORS.length];
          const percent = Math.max(6, Math.round((Number(row.value || 0) / maxValue) * 100));
          return (
            <div key={`${row.label}-${index}`}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", marginBottom: "7px", color: "#334155", fontSize: "13px", fontWeight: 800 }}>
                <span>{row.label}</span>
                <span style={{ color }}>{formatCompactNumber(row.value, valueSuffix)}</span>
              </div>
              <div style={{ height: "12px", borderRadius: "999px", background: "#eef2ff", overflow: "hidden" }}>
                <div style={{ width: `${percent}%`, height: "100%", borderRadius: "999px", background: `linear-gradient(90deg, ${color}, #67e8f9)` }} />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function DonutMetric({ title, value, total, label, color = "#2563eb", icon = "●" }) {
  const percent = total === 100 ? Math.max(0, Math.min(Number(value || 0), 100)) : getPercentValue(value, total);
  return (
    <div
      style={{
        borderRadius: "24px",
        padding: "22px",
        background: "white",
        border: "1px solid #e2e8f0",
        boxShadow: "0 18px 45px rgba(15,23,42,0.07)",
        display: "grid",
        gridTemplateColumns: "112px 1fr",
        gap: "18px",
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: "112px",
          height: "112px",
          borderRadius: "999px",
          background: `conic-gradient(${color} ${percent * 3.6}deg, #e2e8f0 0deg)`,
          display: "grid",
          placeItems: "center",
        }}
      >
        <div style={{ width: "78px", height: "78px", borderRadius: "999px", background: "white", display: "grid", placeItems: "center", textAlign: "center", boxShadow: "inset 0 0 0 1px #e2e8f0" }}>
          <strong style={{ color: "#0f172a", fontSize: "22px" }}>{percent}%</strong>
        </div>
      </div>
      <div>
        <div style={{ fontSize: "26px" }}>{icon}</div>
        <h3 style={{ margin: "6px 0 6px", color: "#0f172a" }}>{title}</h3>
        <p style={{ margin: 0, color: "#64748b", lineHeight: 1.6 }}>{label || `${formatCompactNumber(value)} of ${formatCompactNumber(total)}`}</p>
      </div>
    </div>
  );
}

function VisualPanel({ title, subtitle, children, accent = "#2563eb" }) {
  return (
    <section
      style={{
        borderRadius: "28px",
        padding: "24px",
        background: "rgba(255,255,255,0.96)",
        border: "1px solid #e2e8f0",
        boxShadow: "0 22px 65px rgba(15,23,42,0.08)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "flex-start", marginBottom: "18px" }}>
        <div>
          <h2 style={{ margin: 0, color: "#0f172a", fontSize: "20px" }}>{title}</h2>
          {subtitle && <p style={{ margin: "7px 0 0", color: "#64748b", lineHeight: 1.6 }}>{subtitle}</p>}
        </div>
        <span style={{ width: "44px", height: "8px", borderRadius: "999px", background: `linear-gradient(90deg, ${accent}, #67e8f9)` }} />
      </div>
      {children}
    </section>
  );
}

function FeaturePill({ icon, title, text, color = "#2563eb" }) {
  return (
    <div style={{ borderRadius: "22px", padding: "18px", background: "#f8fafc", border: "1px solid #e2e8f0" }}>
      <div style={{ width: "42px", height: "42px", borderRadius: "15px", display: "grid", placeItems: "center", color: "white", background: `linear-gradient(135deg, ${color}, #0f172a)`, marginBottom: "12px" }}>{icon}</div>
      <h3 style={{ margin: "0 0 7px", color: "#0f172a" }}>{title}</h3>
      <p style={{ margin: 0, color: "#64748b", lineHeight: 1.6 }}>{text}</p>
    </div>
  );
}

function getPlatformIntelligenceModel() {
  const clients = (platformClients && platformClients.length ? platformClients : companies) || [];
  const statusIsActive = (item) => ["active", "trial"].includes(normalize(item.subscription_status || item.status || "Active"));
  const activeClients = clients.filter(statusIsActive);
  const monthlyRevenue = clients.reduce((sum, client) => sum + Number(client.monthly_amount || client.mrr || 0), 0);
  const platformUserCount = users.filter((user) => isPlatformRole(user.role)).length;
  const clientUserCount = users.filter((user) => !isPlatformRole(user.role)).length;
  const openTickets = supportTickets.filter((ticket) => !["resolved", "closed", "done"].includes(normalize(ticket.status || "Open")));
  const highPriorityTickets = openTickets.filter((ticket) => ["high", "urgent", "critical"].includes(normalize(ticket.priority || "")));
  const today = new Date();

  const paidInvoices = subscriptionInvoices.filter((invoice) => normalize(invoice.status) === "paid");
  const overdueInvoices = subscriptionInvoices.filter((invoice) => {
    const status = normalize(invoice.status || "Unpaid");
    if (status === "overdue") return true;
    if (["paid", "cancelled", "void"].includes(status)) return false;
    if (!invoice.due_date) return false;
    return new Date(invoice.due_date) < today;
  });
  const unpaidInvoices = subscriptionInvoices.filter((invoice) => ["unpaid", "pending"].includes(normalize(invoice.status || "Unpaid")));
  const invoiceAmount = subscriptionInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
  const collectedAmount = paidInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);

  const successfulBackups = systemBackups.filter((backup) => ["success", "completed", "done"].includes(normalize(backup.status || "Completed")));
  const backupHealth = systemBackups.length ? Math.round((successfulBackups.length / systemBackups.length) * 100) : 100;

  const planRows = Object.values(
    clients.reduce((acc, client) => {
      const plan = client.subscription_plan || client.plan || "Standard";
      if (!acc[plan]) acc[plan] = { label: plan, value: 0 };
      acc[plan].value += 1;
      return acc;
    }, {})
  );

  const topClients = [...clients]
    .sort((a, b) => Number(b.monthly_amount || b.users_count || 0) - Number(a.monthly_amount || a.users_count || 0))
    .slice(0, 7)
    .map((client, index) => ({
      label: client.company_name || client.name || `Company ${index + 1}`,
      value: Number(client.monthly_amount || client.users_count || 0),
      color: VIZ_COLORS[index % VIZ_COLORS.length],
    }));

  const supportRows = [
    { label: "Open Tickets", value: openTickets.length, color: "#f97316" },
    { label: "High Priority", value: highPriorityTickets.length, color: "#e11d48" },
    { label: "Resolved", value: supportTickets.filter((ticket) => ["resolved", "closed", "done"].includes(normalize(ticket.status))).length, color: "#22c55e" },
  ];

  const invoiceRows = [
    { label: "Paid", value: paidInvoices.length, color: "#22c55e" },
    { label: "Unpaid", value: unpaidInvoices.length, color: "#f59e0b" },
    { label: "Overdue", value: overdueInvoices.length, color: "#e11d48" },
  ];

  return {
    clients,
    totalClients: clients.length,
    activeClients: activeClients.length,
    monthlyRevenue,
    platformUserCount,
    clientUserCount,
    openTickets: openTickets.length,
    highPriorityTickets: highPriorityTickets.length,
    paidInvoices: paidInvoices.length,
    overdueInvoices: overdueInvoices.length,
    invoiceAmount,
    collectedAmount,
    backupHealth,
    planRows,
    topClients,
    supportRows,
    invoiceRows,
  };
}

function getReportStudioVisualModel() {
  const data = buildAIReportStudioDataset();
  const requestHealth = data.request_health || [];
  const totalRequired = data.totals?.required ?? requestHealth.reduce((sum, row) => sum + Number(row.requested_qty || 0), 0);
  const totalCandidates = data.totals?.covered_candidates ?? requestHealth.reduce((sum, row) => sum + Math.min(Number(row.candidates || 0), Number(row.requested_qty || 0)), 0);
  const totalJoined = data.totals?.joined ?? requestHealth.reduce((sum, row) => sum + Math.min(Number(row.joined || 0), Number(row.requested_qty || 0)), 0);
  const totalSubmittedCandidates = data.totals?.submitted_candidates ?? requestHealth.reduce((sum, row) => sum + Number(row.candidates || 0), 0);
  const totalInterviewPassed = requestHealth.reduce((sum, row) => sum + Math.min(Number(row.interviewPassed || 0), Number(row.requested_qty || 0)), 0);
  const totalMedicalPassed = requestHealth.reduce((sum, row) => sum + Math.min(Number(row.medicalDone || 0), Number(row.requested_qty || 0)), 0);
  const totalTicketsIssued = requestHealth.reduce((sum, row) => sum + Math.min(Number(row.ticketIssued || 0), Number(row.requested_qty || 0)), 0);
  const totalArrived = requestHealth.reduce((sum, row) => sum + Math.min(Number(row.arrived || 0), Number(row.requested_qty || 0)), 0);
  const visaGap = requestHealth.reduce((sum, row) => sum + Number(row.visaGap || 0), 0);
  const authorizationGap = requestHealth.reduce((sum, row) => sum + Number(row.authorizationGap || 0), 0);
  const highRiskLines = requestHealth.filter((row) => row.riskLevel === "High").length;
  const mediumRiskLines = requestHealth.filter((row) => row.riskLevel === "Medium").length;
  const safeLines = Math.max(requestHealth.length - highRiskLines - mediumRiskLines, 0);

  const funnelRows = [
    { label: "Required", value: totalRequired, color: "#2563eb" },
    { label: "Covered Candidates", value: totalCandidates, color: "#14b8a6" },
    { label: "Submitted Candidates", value: totalSubmittedCandidates, color: "#0ea5e9" },
    { label: "Interview Passed", value: totalInterviewPassed, color: "#a855f7" },
    { label: "Medical Passed", value: totalMedicalPassed, color: "#06b6d4" },
    { label: "Tickets Issued", value: totalTicketsIssued, color: "#f97316" },
    { label: "Arrived", value: totalArrived, color: "#22c55e" },
    { label: "Joined", value: totalJoined, color: "#0f766e" },
  ];

  const riskRows = [
    { label: "Safe Lines", value: safeLines, color: "#22c55e" },
    { label: "Medium Risk", value: mediumRiskLines, color: "#f59e0b" },
    { label: "High Risk", value: highRiskLines, color: "#e11d48" },
    { label: "Visa Gap", value: visaGap, color: "#8b5cf6" },
    { label: "Authorization Gap", value: authorizationGap, color: "#f97316" },
  ];

  const categoryRows = Object.values(
    REPORT_STUDIO_TEMPLATES.reduce((acc, template) => {
      if (!acc[template.category]) acc[template.category] = { label: template.category, value: 0 };
      acc[template.category].value += 1;
      return acc;
    }, {})
  ).map((row, index) => ({ ...row, color: VIZ_COLORS[index % VIZ_COLORS.length] }));

  return {
    data,
    totalRequired,
    totalCandidates,
    totalJoined,
    progress: getPercentValue(totalCandidates, totalRequired),
    joiningProgress: getPercentValue(totalJoined, totalRequired),
    visaGap,
    authorizationGap,
    highRiskLines,
    funnelRows,
    riskRows,
    categoryRows,
  };
}


function exportCurrentPage() {
  if (!canExport) return alert("You do not have permission to export data.");
  if (activePage === "Requests") return exportRowsToExcel(requests, "VisaFlow_Requests", "Requests");
  if (activePage === "Candidates") return exportRowsToExcel(filteredCandidates, "VisaFlow_Candidates", "Candidates");
  if (activePage === "Visa Inventory") return exportRowsToExcel(filteredVisaRecords, "VisaFlow_Visa_Inventory", "Visas");
  if (activePage === "Authorization") return exportRowsToExcel(visaAuthorizations, "VisaFlow_Authorizations", "Authorizations");
  if (activePage === "Visa Allocation") return exportRowsToExcel(visaAllocations, "VisaFlow_Visa_Allocations", "Allocations");
  if (activePage === "Agencies") return exportRowsToExcel(agencies, "VisaFlow_Agencies", "Agencies");
  if (activePage === "Agency Agreements") return exportRowsToExcel(agencyAgreements, "VisaFlow_Agency_Agreements", "Agreements");
  if (activePage === "Penalty Register") return exportRowsToExcel(getPenaltyRegisterDisplayRows(), "VisaFlow_Penalty_Register", "Penalties");
  if (activePage === "Agency Ranking") return exportRowsToExcel(agencyScores, "VisaFlow_Agency_Ranking", "Agency Scores");
  if (activePage === "Agency Performance") return exportRowsToExcel(calculateAgencyPerformanceRows(), "VisaFlow_Agency_Performance", "Agency Performance");
  if (activePage === "Recruitment Performance") return exportRowsToExcel(calculateRecruitmentPerformanceRows(), "VisaFlow_Recruitment_Performance", "Recruitment Performance");
  if (activePage === "Company Management") return exportRowsToExcel(companies, "VisaFlow_Company_Management", "Companies");
  if (activePage === "Users Management") return exportRowsToExcel(users, "VisaFlow_Users_Management", "Users");
  if (activePage === "Permissions") return exportRowsToExcel(CLIENT_ROLE_OPTIONS.map((role) => ({ role, performance_category: getRolePerformanceCategory(role), included_in_recruitment_performance: isRecruitmentPerformanceRole(role) ? "Yes" : "No", description: ROLE_DESCRIPTIONS[role], pages: (ROLE_PAGES[role] || []).join(", "), actions: (ACTION_PERMISSIONS[role] || []).join(", ") })), "VisaFlow_Permissions", "Permissions");
  if (activePage === "Interviews") return exportRowsToExcel(interviews, "VisaFlow_Interviews", "Interviews");
  if (activePage === "Mobilization") return exportRowsToExcel(mobilizationRequestRows, "VisaFlow_Mobilization_Overview", "Mobilization");
  if (activePage === "Employees") return exportRowsToExcel(employees, "VisaFlow_Employees", "Employees");
  if (activePage === "Demobilization") return exportRowsToExcel(demobilizations, "VisaFlow_Demobilization", "Demobilization");
  if (activePage === "Workforce Marketplace") return exportRowsToExcel(marketplaceDeals, "VisaFlow_Workforce_Marketplace", "Marketplace Deals");
  if (activePage === "Notifications") return exportRowsToExcel(notifications, "VisaFlow_Notifications", "Notifications");
  if (activePage === "Reports") {
    if (activeReport === "activityLog") {
      return exportRowsToExcel(
        filteredActivityLogs.map((item) => ({
          created_at: item.created_at,
          module_name: item.module_name,
          action_type: item.action_type,
          request_no: item.request_no,
          record_label: item.record_label,
          changed_by: item.changed_by_name,
          summary: formatActivitySummary(item),
          changed_fields: formatActivityChangedFieldsText(item),
          source: item.source,
        })),
        "VisaFlow_Operational_Activity_Log",
        "Activity Log"
      );
    }
    return exportRowsToExcel(reports.requestLifecycle, "VisaFlow_Recruitment_Pipeline", "Pipeline");
  }
  if (activePage === "AI Report Studio") return exportAIReportStudio();
  if (activePage === "Platform Dashboard") return exportRowsToExcel(platformClients, "VisaFlow_Platform_Clients", "Platform Clients");
  if (activePage === "Companies Management") return exportRowsToExcel(platformClients, "VisaFlow_Platform_Companies", "Companies");
  if (activePage === "Subscription Invoices") return exportRowsToExcel(subscriptionInvoices, "VisaFlow_Subscription_Invoices", "Invoices");
  if (activePage === "Backup Center") return exportRowsToExcel(systemBackups, "VisaFlow_System_Backups", "Backups");
  if (activePage === "Central Support") return exportRowsToExcel(supportTickets, "VisaFlow_Central_Support", "Support Tickets");
  return alert("Export is available for lists and reports pages");
}

if (!currentUser) {
  return (
    <main className="vf-login-shell">
      <section className="vf-login-left">
        <div className="vf-orb vf-orb-a" />
        <div className="vf-orb vf-orb-b" />
        <div className="vf-grid-layer" />

        <div className="vf-left-content">
          <header className="vf-brand-row">
            <div className="vf-symbol vf-symbol-large" aria-hidden="true">
              <span className="vf-globe" />
              <span className="vf-plane">✈</span>
              <span className="vf-vmark">V</span>
            </div>

            <div>
              <div className="vf-brand-title">
                VISA <span>FLOW</span>
              </div>
              <div className="vf-brand-subtitle">MANPOWER. MOBILIZED. MANAGED.</div>
            </div>
          </header>

          <div className="vf-platform-badge">
            <span>🛡</span>
            End-to-End Recruitment & Visa Management Platform
          </div>

          <section className="vf-hero-copy">
            <h1>
              Recruit. Mobilize.
              <br />
              Manage. <strong>Succeed.</strong>
            </h1>
            <p>
              A unified platform to manage recruitment requests, visas, candidates,
              interviews, mobilization, Saudi hiring, and workforce operations —
              all in one secure place.
            </p>
          </section>

          <section className="vf-feature-cards" aria-label="VisaFlow features">
            <article>
              <div className="vf-feature-icon">👥</div>
              <h3>Smart Recruitment</h3>
              <p>AI ranking, candidate matching & tracking</p>
            </article>

            <article>
              <div className="vf-feature-icon">🛂</div>
              <h3>Visa & Authorization</h3>
              <p>Inventory, allocation & authorization control</p>
            </article>

            <article>
              <div className="vf-feature-icon">✈️</div>
              <h3>Mobilization</h3>
              <p>Travel, arrival & joining management</p>
            </article>

            <article>
              <div className="vf-feature-icon">📊</div>
              <h3>Executive Insights</h3>
              <p>Dashboards, reports & performance visibility</p>
            </article>
          </section>

          <section className="vf-compliance-strip">
            <div>
              <span>رؤية</span>
              <strong>2030</strong>
            </div>
            <div>
              <span>QIWA</span>
              <strong>قوى</strong>
            </div>
            <div>
              <span>MUSANED</span>
              <strong>مساند</strong>
            </div>
            <div>
              <span>JADARAT</span>
              <strong>جدارات</strong>
            </div>
          </section>
        </div>
      </section>

      <section className="vf-login-right">
        <div className="vf-language-switch" aria-label="Language switch">
          <button
            type="button"
            className={loginLanguage === "EN" ? "active" : ""}
            onClick={() => setLoginLanguage("EN")}
          >
            EN
          </button>
          <button
            type="button"
            className={loginLanguage === "AR" ? "active" : ""}
            onClick={() => setLoginLanguage("AR")}
          >
            العربية
          </button>
        </div>

        <div className="vf-login-card">
          <div className="vf-login-logo">
            <div className="vf-symbol vf-symbol-small" aria-hidden="true">
              <span className="vf-globe" />
              <span className="vf-plane">✈</span>
              <span className="vf-vmark">V</span>
            </div>
          </div>

          <h2>Welcome Back!</h2>
          <p className="vf-login-subtitle">Sign in to access your VisaFlow dashboard</p>

          <div className="vf-form-group">
            <label>Email Address</label>
            <div className="vf-input-box">
              <span className="vf-input-icon">✉</span>
              <input
                type="email"
                placeholder="Enter your email"
                value={loginForm.email}
                onChange={(e) => setLoginForm((prev) => ({ ...prev, email: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                autoComplete="email"
              />
            </div>
          </div>

          <div className="vf-form-group">
            <label>Password</label>
            <div className="vf-input-box">
              <span className="vf-input-icon">🔒</span>
              <input
                type={showLoginPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={loginForm.password}
                onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="vf-password-toggle"
                onClick={() => setShowLoginPassword((prev) => !prev)}
                aria-label={showLoginPassword ? "Hide password" : "Show password"}
              >
                {showLoginPassword ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          <div className="vf-login-options">
            <label className="vf-remember">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <span>Remember Me</span>
            </label>

            <button
              type="button"
              className="vf-forgot-link"
              onClick={() => {
                setResetEmail(loginForm.email || "");
                setResetMessage("");
                setForgotPasswordOpen(true);
              }}
            >
              Forgot Password?
            </button>
          </div>

          <button
            type="button"
            className="vf-primary-login"
            onClick={handleLogin}
            disabled={loginLoading}
          >
            {loginLoading ? "Signing in..." : "🔐 Sign In"}
          </button>

          <div className="vf-divider">
            <span />
            <em>or</em>
            <span />
          </div>

          <button
            type="button"
            className="vf-microsoft-login"
            onClick={() => alert("Microsoft SSO can be connected after domain setup.")}
          >
            <span className="vf-ms-mark">
              <i />
              <i />
              <i />
              <i />
            </span>
            Sign in with Microsoft
          </button>

          <p className="vf-secure-note">🛡 Your data is secure and encrypted</p>
        </div>

        <div className="vf-login-footer">
          VisaFlow KSA · Enterprise Edition · Version 1.0.0
        </div>

        {forgotPasswordOpen && (
          <div className="vf-reset-overlay">
            <div className="vf-reset-modal">
              <h3>Forgot Password</h3>
              <p>Enter your email and the system administrator will be notified.</p>

              <input
                type="email"
                placeholder="Enter your email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
              />

              {resetMessage && <div className="vf-reset-message">{resetMessage}</div>}

              <div className="vf-reset-actions">
                <button
                  type="button"
                  onClick={handleForgotPasswordSubmit}
                  disabled={resetLoading}
                >
                  {resetLoading ? "Sending..." : "Send Request"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setForgotPasswordOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

  if (currentRole === "Agency" && !currentCompanyId) {
    return (
      <main className="vf-login-shell">
        <section className="vf-login-right" style={{ width: "100%" }}>
          <div className="vf-login-card" style={{ maxWidth: "680px" }}>
            <div className="vf-login-logo">
              <div className="vf-symbol vf-symbol-small" aria-hidden="true">
                <span className="vf-globe" />
                <span className="vf-plane">✈</span>
                <span className="vf-vmark">V</span>
              </div>
            </div>
            <h2>Choose Client Workspace</h2>
            <p className="vf-login-subtitle">Select the company workspace you want to manage for {currentUser?.agency_name || "your agency"}.</p>

            {agencyWorkspaceLoading ? (
              <div className="vf-reset-message">Loading client workspaces...</div>
            ) : agencyClientAccess.length === 0 ? (
              <div className="vf-reset-message">No active client workspace is assigned to this agency user.</div>
            ) : (
              <div className="dashboard-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                {agencyClientAccess.map((workspace) => (
                  <button
                    key={workspace.id || workspace.company_id}
                    type="button"
                    className="stat-card"
                    style={{ textAlign: "left", cursor: "pointer" }}
                    onClick={() => switchAgencyWorkspace(workspace)}
                  >
                    <h3>{workspace.company_name || "Client Workspace"}</h3>
                    <strong>{workspace.role || "Coordinator"}</strong>
                    <p>{workspace.agency_name || currentUser?.agency_name || "Agency Portal"}</p>
                  </button>
                ))}
              </div>
            )}

            <button type="button" className="light-btn" onClick={handleLogout} style={{ marginTop: "18px" }}>
              Logout
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="layout">
      <input ref={candidateExcelInputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleExcelUpload} />
      <input ref={requestExcelInputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleExcelUpload} />
      <input ref={employeeExcelInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={handleEmployeesExcelUpload} />

      <aside className="sidebar" style={{ maxHeight: "100vh", overflowY: "auto", overflowX: "hidden" }}>
        <div className="logo">
          <div className="logo-icon">VF</div>
          <div>
            <h2>VisaFlow KSA</h2>
            <p>Recruitment & Visa Operations</p>
          </div>
        </div>
        <div className="user-box">
          <strong>{currentUser.name}</strong>
          <span>{currentUser.role}</span>
          {currentRole === "Agency" && (
            <span style={{ marginTop: "6px", color: "#bfdbfe", fontSize: "12px" }}>
              Client: {getActiveAgencyWorkspaceName()}
            </span>
          )}
        </div>
        {currentRole === "Agency" && agencyClientAccess.length > 1 && (
          <div style={{ padding: "0 12px 10px" }}>
            <label style={{ display: "block", color: "rgba(255,255,255,0.7)", fontSize: "11px", fontWeight: 900, marginBottom: "6px" }}>
              SWITCH CLIENT
            </label>
            <select
              value={currentCompanyId}
              onChange={(e) => handleAgencyWorkspaceChange(e.target.value)}
              style={{ width: "100%", borderRadius: "12px", padding: "8px", border: "1px solid rgba(255,255,255,0.18)", background: "#0f2a5c", color: "#fff", fontWeight: 800 }}
            >
              {agencyClientAccess.map((workspace) => (
                <option key={workspace.id || workspace.company_id} value={workspace.company_id}>
                  {workspace.company_name || "Client Workspace"}
                </option>
              ))}
            </select>
          </div>
        )}
        <button
  className="save-btn"
  style={{ marginTop: "10px", width: "100%" }}
  onClick={handleLogout}
>
  Logout
</button>
        <nav style={{ paddingBottom: "28px" }}>
          {buildSidebarGroups(visiblePages).map((group) => (
            <div key={group.title} style={{ marginTop: "14px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 12px",
                  margin: "0 4px 6px",
                  color: "rgba(255,255,255,0.64)",
                  fontSize: "12px",
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                <span>{group.icon}</span>
                <span>{group.title}</span>
              </div>

              {group.pages.map((page) => (
                <button
                  key={page}
                  className={activePage === page ? "active" : ""}
                  onClick={() => setActivePage(page)}
                  style={{ paddingLeft: "24px" }}
                >
                  {page}
                  {page === "Notifications" && unreadNotificationsCount > 0 && (
                    <span
                      style={{
                        float: "right",
                        minWidth: "22px",
                        height: "22px",
                        padding: "0 7px",
                        borderRadius: "999px",
                        background: "#ef4444",
                        color: "#fff",
                        fontSize: "12px",
                        fontWeight: 900,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {unreadNotificationsCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <main className="content">
        <div className="topbar sticky">
          <div>
            <h1>{activePage}</h1>
            {activePage === "Executive Dashboard" ? (
              <p>Last Updated: {new Date().toLocaleString()}</p>
            ) : (
              <p>{loading ? "Loading data..." : "Saudi company recruitment, visa authorization and manpower tracking system."}</p>
            )}
          </div>
          {activePage !== "Executive Dashboard" && (
            <div className="actions-line">
              {currentRole === "Agency" && (
                <span className="badge passed" title="Current client workspace">
                  🏢 {getActiveAgencyWorkspaceName()}
                </span>
              )}
              {["Candidates", "Office Portal"].includes(activePage) && canUseCandidateUploadTemplate && <button className="new-btn" onClick={downloadCandidateUploadTemplate}>Download Candidate Template</button>}
              {["Candidates", "Office Portal"].includes(activePage) && canUseCandidateUploadTemplate && <button className="new-btn" onClick={startExcelUploadFromCandidates}>Upload Candidate Excel</button>}
              {activePage === "Employees" && canManageEmployees && <button className="new-btn" onClick={downloadEmployeesTemplate}>Download Template</button>}
              {activePage === "Employees" && canManageEmployees && <button className="new-btn" onClick={startEmployeesExcelUpload}>Import Employees</button>}
              <button className="new-btn" onClick={() => setActivePage("Notifications")}>🔔 {unreadNotificationsCount}</button>
              {canExport && <button className="new-btn" onClick={exportCurrentPage}>Export Excel</button>}
              <button className="new-btn" onClick={loadAll}>Refresh</button>
              <button className="light-btn" onClick={handleLogout}>Logout</button>
            </div>
          )}
        </div>

        {activePage === "Notifications" && (
          <>
            <div className="dashboard-grid">
              <Stat title="Total Notifications" value={notifications.length} />
              <Stat title="Unread" value={unreadNotificationsCount} className={unreadNotificationsCount ? "warning" : "passed"} />
              {canViewEmailAdministration && <Stat title="Emails Sent" value={emailLogStats.sent} className="passed" />}
              {canViewEmailAdministration && <Stat title="Email Failures" value={emailLogStats.failed} className={emailLogStats.failed ? "danger" : "passed"} />}
              {canViewEmailAdministration && <Stat title="Active Templates" value={emailTemplates.filter((item) => item.is_active !== false).length} />}
              {canViewEmailAdministration && <Stat title="Skipped Emails" value={emailLogStats.skipped} className={emailLogStats.skipped ? "warning" : "passed"} />}
            </div>

            <TableCard title="Notification Center">
              <div className="actions-line" style={{ marginBottom: "14px" }}>
                <button className="new-btn" onClick={async () => {
                  const rows = await loadNotifications();
                  if (canViewEmailAdministration) {
                    await loadEmailLogs();
                    await loadEmailTemplates();
                  }
                  alert(`Notification Center refreshed. Notifications loaded: ${rows?.length || 0}`);
                }}>Refresh Center</button>
                <button className="new-btn" onClick={markAllNotificationsRead}>Mark All as Read</button>
                {canViewEmailAdministration && <button className="light-btn" onClick={() => setActivePage("Email Settings")}>Open Email Settings</button>}
              </div>

              <div className="form-grid" style={{ marginBottom: "14px" }}>
                <Input placeholder="Search notifications" value={notificationSearch} onChange={setNotificationSearch} />
                <Select placeholder="Notification Type" value={notificationFilter} options={notificationTypes} onChange={setNotificationFilter} />
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Priority</th>
                      <th>Type</th>
                      <th>Title</th>
                      <th>Message</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredNotificationRows.length === 0 ? (
                      <tr>
                        <td colSpan="7" style={{ textAlign: "center", color: "#64748b", padding: "24px" }}>
                          No notifications found.
                        </td>
                      </tr>
                    ) : (
                      filteredNotificationRows.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <span className={getNotificationStatus(item) === "Read" ? "badge passed" : "badge warning"}>
                              {getNotificationStatus(item)}
                            </span>
                          </td>
                          <td>{item.priority || item.data?.priority || "Medium"}</td>
                          <td>{item.type || item.status || "Notification"}</td>
                          <td>{getNotificationTitle(item)}</td>
                          <td style={{ maxWidth: "520px", whiteSpace: "normal" }}>{getNotificationMessage(item)}</td>
                          <td>{item.created_at ? new Date(item.created_at).toLocaleString() : "-"}</td>
                          <td>
                            <div className="row-actions">
                              {getNotificationStatus(item) !== "Read" && (
                                <button className="light-btn" onClick={() => markNotificationRead(item.id)}>Read</button>
                              )}
                              <button className="danger-btn" onClick={() => deleteNotification(item.id)}>Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </TableCard>

            {canViewEmailAdministration && <TableCard title="Email Logs">
              <div className="actions-line" style={{ marginBottom: "14px" }}>
                <button className="light-btn" onClick={loadEmailLogs}>Reload Email Logs</button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Type</th>
                      <th>To</th>
                      <th>Subject</th>
                      <th>Provider</th>
                      <th>Message ID</th>
                      <th>Error</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emailLogs.length === 0 ? (
                      <tr><td colSpan="8" style={{ textAlign: "center", color: "#64748b", padding: "24px" }}>No email logs found yet.</td></tr>
                    ) : emailLogs.map((item) => (
                      <tr key={item.id}>
                        <td><Badge value={item.status || "-"} /></td>
                        <td>{item.type || "-"}</td>
                        <td>{item.to_email || item.to || "-"}</td>
                        <td>{item.subject || "-"}</td>
                        <td>{item.provider || "-"}</td>
                        <td>{item.message_id || "-"}</td>
                        <td style={{ maxWidth: "320px", whiteSpace: "normal" }}>{item.error_message || "-"}</td>
                        <td>{item.created_at ? new Date(item.created_at).toLocaleString() : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TableCard>}

            {canViewEmailAdministration && <FormCard title={emailTemplateEditingId ? "Edit Email Template" : "Email Templates"}>
              <div className="actions-line" style={{ marginBottom: "14px" }}>
                <button className="new-btn" onClick={seedDefaultEmailTemplates}>Seed Default Templates</button>
                <button className="light-btn" onClick={resetEmailTemplateForm}>New Template</button>
              </div>

              <div className="form-grid">
                <Input placeholder="Template Key" value={emailTemplateForm.template_key} onChange={(v) => setEmailTemplateForm((p) => ({ ...p, template_key: v }))} />
                <Input placeholder="Template Name" value={emailTemplateForm.template_name} onChange={(v) => setEmailTemplateForm((p) => ({ ...p, template_name: v }))} />
                <Select placeholder="Category" value={emailTemplateForm.category} options={["Recruitment", "Operations", "Agency", "Visa", "Mobilization", "Platform", "Support"]} onChange={(v) => setEmailTemplateForm((p) => ({ ...p, category: v }))} />
                <Select placeholder="Language" value={emailTemplateForm.language} options={["Arabic", "English", "Bilingual"]} onChange={(v) => setEmailTemplateForm((p) => ({ ...p, language: v }))} />
                <Input placeholder="Subject" value={emailTemplateForm.subject} onChange={(v) => setEmailTemplateForm((p) => ({ ...p, subject: v }))} />
              </div>

              <textarea
                className="text-area"
                style={{ width: "100%", minHeight: "140px", marginTop: "12px" }}
                placeholder="Template body. You can use {{candidate_name}}, {{profession}}, {{request_no}}, {{agency_name}}, {{authorization_no}}, {{ticket_no}}"
                value={emailTemplateForm.body}
                onChange={(e) => setEmailTemplateForm((p) => ({ ...p, body: e.target.value }))}
              />

              <label className="check-row">
                <input
                  type="checkbox"
                  checked={emailTemplateForm.is_active !== false}
                  onChange={(e) => setEmailTemplateForm((p) => ({ ...p, is_active: e.target.checked }))}
                />
                Active template
              </label>

              <div className="actions-line">
                <button className="save-btn" onClick={saveEmailTemplate}>{emailTemplateEditingId ? "Update Template" : "Save Template"}</button>
                {emailTemplateEditingId && <button className="light-btn" onClick={resetEmailTemplateForm}>Cancel</button>}
              </div>
            </FormCard>}

            {canViewEmailAdministration && <TableCard title="Saved Email Templates">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Key</th>
                      <th>Name</th>
                      <th>Category</th>
                      <th>Language</th>
                      <th>Subject</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emailTemplates.length === 0 ? (
                      <tr><td colSpan="7" style={{ textAlign: "center", color: "#64748b", padding: "24px" }}>No templates found. Click Seed Default Templates.</td></tr>
                    ) : emailTemplates.map((item) => (
                      <tr key={item.id}>
                        <td><Badge value={item.is_active === false ? "Inactive" : "Active"} /></td>
                        <td>{item.template_key}</td>
                        <td>{item.template_name}</td>
                        <td>{item.category}</td>
                        <td>{item.language}</td>
                        <td>{item.subject}</td>
                        <td>
                          <div className="row-actions">
                            <button className="light-btn" onClick={() => editEmailTemplate(item)}>Edit</button>
                            <button className="light-btn" onClick={() => sendEmailTemplateTest(item)}>Test</button>
                            <button className="danger-btn" onClick={() => deleteEmailTemplate(item.id)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TableCard>}
          </>
        )}

        {activePage === "Executive Dashboard" && (
          <>
            <div
              style={{
                borderRadius: "32px",
                padding: "30px",
                marginBottom: "22px",
                background:
                  "radial-gradient(circle at 86% 18%, rgba(20,184,166,0.30), transparent 22%), linear-gradient(135deg, #020617 0%, #0f2f68 55%, #0f766e 100%)",
                color: "#fff",
                boxShadow: "0 26px 80px rgba(15,23,42,0.20)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div style={{ position: "absolute", right: "-80px", top: "-90px", width: "280px", height: "280px", borderRadius: "999px", background: "rgba(255,255,255,0.10)" }} />
              <div style={{ position: "absolute", right: "35px", bottom: "22px", fontSize: "130px", opacity: 0.12, lineHeight: 1 }}>📊</div>
              <div style={{ position: "relative", zIndex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "18px", alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "9px 14px", borderRadius: "999px", background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.18)", marginBottom: "16px" }}>
                      <span>⚡</span>
                      <b>Executive Command View</b>
                    </div>
                    <h2 style={{ margin: "0 0 10px", fontSize: "38px", lineHeight: 1.08, letterSpacing: "-0.04em" }}>
                      Recruitment, visas, Saudization and mobilization in one decision screen.
                    </h2>
                    <p style={{ margin: 0, maxWidth: "780px", lineHeight: 1.8, opacity: 0.92, fontSize: "16px" }}>
                      This dashboard summarizes live operational health, highlights risk items, and shows where management action is required before project mobilization is affected.
                    </p>
                  </div>

                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button className="new-btn" onClick={loadAll}>Refresh</button>
                    {canExport && <button className="light-btn" onClick={() => exportRowsToExcel(executiveDashboard.recruitmentFunnel, "VisaFlow_Executive_Dashboard", "Executive Dashboard")}>Export Summary</button>}
                    <button className="light-btn" onClick={handleLogout}>Logout</button>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "14px", marginTop: "26px" }}>
                  {[
                    ["Overall Progress", `${executiveDashboard.recruitmentProgress}%`, "of total required manpower covered"],
                    ["Open Requests", executiveDashboard.openRequests, `${executiveDashboard.totalRequired} total required`],
                    ["Active Candidates", executiveDashboard.activeCandidates, `${executiveDashboard.joined} joined`],
                    ["Critical Alerts", executiveDashboard.requestsWithoutVisa + executiveDashboard.visasWithoutAuthorization + executiveDashboard.candidatesWithoutInterviews + executiveDashboard.lateSlaItems, "items need attention"],
                  ].map(([label, value, note]) => (
                    <div key={label} style={{ padding: "18px", borderRadius: "22px", background: "rgba(255,255,255,0.13)", border: "1px solid rgba(255,255,255,0.18)", backdropFilter: "blur(10px)" }}>
                      <div style={{ fontSize: "13px", opacity: 0.80, marginBottom: "8px" }}>{label}</div>
                      <div style={{ fontSize: "34px", fontWeight: 900, letterSpacing: "-0.05em" }}>{value}</div>
                      <div style={{ fontSize: "12px", opacity: 0.78, marginTop: "6px" }}>{note}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="dashboard-grid" style={{ marginBottom: "18px" }}>
              <Stat title="Total Required Manpower" value={executiveDashboard.totalRequired} />
              <Stat title="Completed Requests" value={executiveDashboard.completedRequests} className="passed" />
              <Stat title="Under Recruitment" value={executiveDashboard.underRecruitment} className="warning" />
              <Stat title="Joined Project" value={executiveDashboard.joined} className="passed" />
              <Stat title="Available Visas" value={executiveDashboard.availableVisas} className="passed" />
              <Stat title="Open Authorizations" value={executiveDashboard.openAuthorizations} className="passed" />
            </div>

            <div className="grid">
              <TableCard title="Operational Health">
                <div style={{ display: "grid", gap: "14px" }}>
                  {[
                    ["Recruitment Progress", executiveDashboard.recruitmentProgress, `${executiveDashboard.activeCandidates} active candidate(s) from ${executiveDashboard.totalRequired} required`],
                    ["Saudization Rate", executiveDashboard.saudizationRate, `${executiveDashboard.saudiCandidates} Saudi candidate(s) / ${executiveDashboard.saudiRequired} required`],
                    ["Mobilization Arrival", executiveDashboard.totalRequired ? Math.round((executiveDashboard.arrived / executiveDashboard.totalRequired) * 100) : 0, `${executiveDashboard.arrived} arrived KSA`],
                    ["Joining Completion", executiveDashboard.totalRequired ? Math.round((executiveDashboard.joined / executiveDashboard.totalRequired) * 100) : 0, `${executiveDashboard.joined} joined project`],
                  ].map(([label, percent, note]) => (
                    <div key={label}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "14px", marginBottom: "7px" }}>
                        <b>{label}</b>
                        <b>{percent}%</b>
                      </div>
                      <div style={{ height: "10px", borderRadius: "999px", background: "#e5e7eb", overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(Number(percent || 0), 100)}%`, height: "100%", borderRadius: "999px", background: Number(percent || 0) >= 80 ? "#16a34a" : Number(percent || 0) >= 50 ? "#f59e0b" : "#ef4444" }} />
                      </div>
                      <div style={{ color: "#64748b", fontSize: "12px", marginTop: "5px" }}>{note}</div>
                    </div>
                  ))}
                </div>
              </TableCard>

              <TableCard title="Critical Alerts">
                <div style={{ display: "grid", gap: "10px" }}>
                  {[
                    ["Requests Without Visa", executiveDashboard.requestsWithoutVisa, "Foreign requests need matching visa balance"],
                    ["Visas Without Authorization", executiveDashboard.visasWithoutAuthorization, "Visa batches not yet authorized"],
                    ["Candidates Without Interview", executiveDashboard.candidatesWithoutInterviews, "Candidates need interview action"],
                    ["Late SLA Items", executiveDashboard.lateSlaItems, "Delayed requests or authorizations"],
                  ].map(([label, value, note]) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px", padding: "13px 14px", borderRadius: "18px", background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                      <div>
                        <b>{label}</b>
                        <div style={{ color: "#64748b", fontSize: "12px", marginTop: "3px" }}>{note}</div>
                      </div>
                      <span className={`badge ${executiveAlertClass(value)}`} style={{ fontSize: "15px", padding: "8px 12px" }}>{value}</span>
                    </div>
                  ))}
                </div>
              </TableCard>
            </div>

            <TableCard title="Recruitment Funnel">
              <div style={{ display: "grid", gap: "12px" }}>
                {executiveDashboard.recruitmentFunnel.map((item) => {
                  const max = executiveDashboard.recruitmentFunnel[0]?.value || 1;
                  const percent = max ? Math.round((item.value / max) * 100) : 0;
                  return (
                    <div key={item.stage} style={{ display: "grid", gridTemplateColumns: "190px 70px 1fr", gap: "14px", alignItems: "center" }}>
                      <b>{item.stage}</b>
                      <span>{item.value}</span>
                      <div style={{ height: "12px", borderRadius: "999px", background: "#e5e7eb", overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(percent, 100)}%`, height: "100%", borderRadius: "999px", background: percent >= 80 ? "#16a34a" : percent >= 50 ? "#f59e0b" : "#2563eb" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </TableCard>

            <div className="grid">
              <TableCard title="Top Projects Progress">
                <table>
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Required</th>
                      <th>Active</th>
                      <th>Arrived</th>
                      <th>Joined</th>
                      <th>Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {executiveDashboard.topProjects.length === 0 ? (
                      <tr><td colSpan="6">No project data</td></tr>
                    ) : (
                      executiveDashboard.topProjects.map((project) => (
                        <tr key={project.project}>
                          <td><b>{project.project}</b></td>
                          <td>{project.required}</td>
                          <td>{project.active}</td>
                          <td>{project.arrived}</td>
                          <td>{project.joined}</td>
                          <td>
                            <b>{project.progress}%</b>
                            <div style={{ marginTop: "6px", background: "#e5e7eb", borderRadius: "999px", overflow: "hidden", height: "8px" }}>
                              <div style={{ width: `${Math.min(project.progress, 100)}%`, height: "100%", background: project.progress >= 80 ? "#16a34a" : project.progress >= 50 ? "#f59e0b" : "#ef4444" }} />
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </TableCard>

              <TableCard title="Arrivals Next 30 Days">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Candidate</th>
                      <th>Project</th>
                      <th>Request No</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {executiveDashboard.arrivalsNext30Days.length === 0 ? (
                      <tr><td colSpan="5">No planned arrivals in the next 30 days</td></tr>
                    ) : (
                      executiveDashboard.arrivalsNext30Days.map((item, index) => (
                        <tr key={`${item.request_no}-${item.candidate}-${index}`}>
                          <td>{item.date}</td>
                          <td><b>{item.candidate}</b></td>
                          <td>{item.project}</td>
                          <td>{item.request_no}</td>
                          <td><Badge value={item.status} /></td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </TableCard>
            </div>
          </>
        )}

        {activePage === "AI Agent" && (
          <>
            <TableCard title="🤖 AI Recruitment Agent - Agency Follow-up Employee">
              <div style={{ display: "grid", gridTemplateColumns: "1.15fr 0.85fr", gap: "18px", alignItems: "stretch" }}>
                <div style={{ borderRadius: "28px", padding: "30px", background: "linear-gradient(135deg, #020617 0%, #0f2f68 50%, #0f766e 100%)", color: "white", position: "relative", overflow: "hidden", minHeight: "260px" }}>
                  <div style={{ position: "absolute", right: "-80px", top: "-80px", width: "260px", height: "260px", borderRadius: "999px", background: "rgba(255,255,255,0.10)" }} />
                  <div style={{ position: "absolute", right: "28px", bottom: "18px", opacity: 0.14, fontSize: "138px", lineHeight: 1 }}>👨‍💼</div>
                  <div style={{ position: "relative", zIndex: 1 }}>
                    <p style={{ margin: "0 0 8px", opacity: 0.78, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", fontSize: "12px" }}>AI Agent Employee</p>
                    <h1 style={{ margin: 0, fontSize: "34px", letterSpacing: "-0.04em" }}>AI Recruitment Agent</h1>
                    <p style={{ margin: "14px 0 0", maxWidth: "760px", lineHeight: 1.8, opacity: 0.92 }}>
                      موظف ذكي داخل VisaFlow يعمل كـ Recruitment Operations Employee: يقترح المكتب المناسب بعد الطلب، يجهز موافقة مدير التوظيف، يتابع المكاتب، يرسل الإشعارات، ويصعد الحالات المتأخرة.
                    </p>
                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "22px" }}>
                      <button className="save-btn" onClick={createAIAgentManagerBriefNotification}>Create Manager Daily Brief</button>
                      <button className="new-btn" onClick={runAIAgentAgencyFollowUp} disabled={aiAgentLoading}>
                        {aiAgentLoading ? "AI Agent Working..." : "Run Manual Follow-up"}
                      </button>
                      <button className="new-btn" onClick={() => setActivePage("Notifications")}>Open Notification Center</button>
                    </div>
                  </div>
                </div>

                <div style={{ display: "grid", gap: "12px" }}>
                  <Stat title="Assignment Recommendations" value={getAIAgentRequestAssignmentRecommendations().length} className={getAIAgentRequestAssignmentRecommendations().length ? "warning" : "passed"} />
                  <Stat title="Open Follow-ups" value={getAIAgentAgencyTasks().length} className={getAIAgentAgencyTasks().length ? "warning" : "passed"} />
                  <Stat title="High Priority" value={getAIAgentAgencyTasks().filter((task) => task.priority === "High").length} className={executiveAlertClass(getAIAgentAgencyTasks().filter((task) => task.priority === "High").length)} />
                  <Stat title="Risk Agencies" value={buildAgencyScorecard().filter((row) => row.risk !== "Low").length} className={executiveAlertClass(buildAgencyScorecard().filter((row) => row.risk !== "Low").length)} />
                </div>
              </div>
            </TableCard>

            <div className="dashboard-grid">
              <Stat title="SLA Candidate Delays" value={getAgencySlaEscalationAlerts().length} className={executiveAlertClass(getAgencySlaEscalationAlerts().length)} />
              <Stat title="Auths Without Candidates" value={reports.authorizationsWithoutCandidates.length} className={executiveAlertClass(reports.authorizationsWithoutCandidates.length)} />
              <Stat title="Emails / Notifications" value={notifications.filter((item) => String(item.type || "").startsWith("AI_AGENT")).length} className="passed" />
              <Stat title="Active Agencies" value={agencies.filter((agency) => String(agency.status || "Active") !== "Inactive").length} className="passed" />
            </div>

            <TableCard title="⚙️ AI Agent Settings + Auto Follow-up Agencies">
              <div style={{ padding: "16px", borderRadius: "18px", background: "#f8fafc", border: "1px solid #e2e8f0", marginBottom: "14px", lineHeight: 1.7 }}>
                <b>Production Guardrails:</b> التشغيل التلقائي الحقيقي يتم عبر Supabase Edge Functions / Cron وليس من المتصفح. الواجهة تعرض التوصيات وتسمح بإنشاء Job آمن فقط، مع Cooldown وRate Limit وسجل حوكمة لكل حركة.
              </div>

              <div className="dashboard-grid" style={{ marginBottom: "14px" }}>
                <Stat title="Agent Mode" value={getAIAgentSettingsModeLabel()} className={isAIAgentEnabled() ? "passed" : "warning"} />
                <Stat title="Manager Auto" value={isAIAgentManagerAutoEnabled() ? "On" : "Off"} className={isAIAgentManagerAutoEnabled() ? "passed" : "warning"} />
                <Stat title="Agency Auto Follow-up" value={isAIAgentAgencyFollowUpAutoEnabled() ? "On" : "Off"} className={isAIAgentAgencyFollowUpAutoEnabled() ? "passed" : "warning"} />
                <Stat title="Runtime" value={isAIAgentBackgroundMode() ? "Background Worker" : "Browser Demo"} className={isAIAgentBackgroundMode() ? "passed" : "warning"} />
                <Stat title="Agency Emails" value={shouldAIAgentSendAgencyEmails() ? "Enabled" : "Notifications Only"} className={shouldAIAgentSendAgencyEmails() ? "passed" : "warning"} />
              </div>

              <div className="form-grid">
                <Select
                  placeholder="AI Agent Mode"
                  value={aiAgentSettings.mode || "auto_notify_manager"}
                  options={AI_AGENT_MODE_OPTIONS}
                  onChange={(v) => updateAIAgentSetting("mode", v)}
                />
                <Input placeholder="Manager Approval Email Override" value={aiAgentSettings.manager_approval_email || ""} onChange={(v) => updateAIAgentSetting("manager_approval_email", v)} />
                <Input type="number" placeholder="Agency Reminder After Days" value={String(aiAgentSettings.agency_reminder_after_days || 3)} onChange={(v) => updateAIAgentSetting("agency_reminder_after_days", v)} />
                <Input type="number" placeholder="Escalation After Days" value={String(aiAgentSettings.escalation_after_days || 7)} onChange={(v) => updateAIAgentSetting("escalation_after_days", v)} />
                <Input type="number" placeholder="Max Auto Actions Per Run" value={String(aiAgentSettings.max_auto_actions_per_run || 5)} onChange={(v) => updateAIAgentSetting("max_auto_actions_per_run", v)} />
                <Input type="number" placeholder="Cooldown Minutes" value={String(aiAgentSettings.cooldown_minutes || 60)} onChange={(v) => updateAIAgentSetting("cooldown_minutes", v)} />
                <Input type="number" placeholder="Max Actions Per Hour" value={String(aiAgentSettings.max_actions_per_hour || 20)} onChange={(v) => updateAIAgentSetting("max_actions_per_hour", v)} />
                <Input type="number" placeholder="Max Retry Attempts" value={String(aiAgentSettings.max_retry_attempts || 3)} onChange={(v) => updateAIAgentSetting("max_retry_attempts", v)} />
                <Input placeholder="Daily Brief Time" value={aiAgentSettings.daily_brief_time || "08:00"} onChange={(v) => updateAIAgentSetting("daily_brief_time", v)} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "10px", marginTop: "14px" }}>
                <label className="check-row"><input type="checkbox" checked={aiAgentSettings.is_active !== false} onChange={(e) => updateAIAgentSetting("is_active", e.target.checked)} /> Enable AI Agent</label>
                <label className="check-row"><input type="checkbox" checked={aiAgentSettings.auto_manager_approval !== false} onChange={(e) => updateAIAgentSetting("auto_manager_approval", e.target.checked)} /> Auto notify Recruitment Manager</label>
                <label className="check-row"><input type="checkbox" checked={Boolean(aiAgentSettings.auto_followup_agencies)} onChange={(e) => updateAIAgentSetting("auto_followup_agencies", e.target.checked)} /> Auto follow-up agencies</label>
                <label className="check-row"><input type="checkbox" checked={Boolean(aiAgentSettings.allow_auto_agency_emails)} onChange={(e) => updateAIAgentSetting("allow_auto_agency_emails", e.target.checked)} /> Send real emails to agencies</label>
                <label className="check-row"><input type="checkbox" checked={aiAgentSettings.run_in_background !== false} onChange={(e) => updateAIAgentSetting("run_in_background", e.target.checked)} /> Run automation in background worker</label>
                <label className="check-row"><input type="checkbox" checked={Boolean(aiAgentSettings.client_auto_enabled)} onChange={(e) => updateAIAgentSetting("client_auto_enabled", e.target.checked)} /> Allow browser demo auto-run</label>
                <label className="check-row"><input type="checkbox" checked={aiAgentSettings.daily_brief_enabled !== false} onChange={(e) => updateAIAgentSetting("daily_brief_enabled", e.target.checked)} /> Daily brief enabled</label>
              </div>

              {aiAgentSettingsMessage && <p className="muted-text">{aiAgentSettingsMessage}</p>}
              {aiAgentLog && (
                <div style={{ marginTop: "14px", padding: "14px 16px", borderRadius: "16px", background: "#f8fafc", border: "1px solid #e2e8f0", whiteSpace: "pre-wrap", color: "#334155", fontWeight: 700 }}>
                  {aiAgentLog}
                </div>
              )}

              <div className="actions-line" style={{ marginTop: "14px" }}>
                <button className="save-btn" onClick={saveAIAgentSettings} disabled={aiAgentSettingsSaving}>
                  {aiAgentSettingsSaving ? "Saving..." : "Save AI Agent Settings"}
                </button>
                <button className="new-btn" onClick={() => isAIAgentBackgroundMode() ? enqueueAIAgentBackgroundJob("manager_auto_run") : runAIAgentAutoManagerApprovals({ limit: getAIAgentMaxAutoActions() })} disabled={aiAgentLoading || !isAIAgentManagerAutoEnabled()}>
                  {isAIAgentBackgroundMode() ? "Queue Manager Job" : "Run Manager Auto Now"}
                </button>
                <button className="new-btn" onClick={() => isAIAgentBackgroundMode() ? enqueueAIAgentBackgroundJob("agency_auto_followup") : runAIAgentAutoAgencyFollowUp({ limit: getAIAgentMaxAutoActions() })} disabled={aiAgentLoading || !isAIAgentAgencyFollowUpAutoEnabled()}>
                  {isAIAgentBackgroundMode() ? "Queue Agency Job" : "Run Agency Auto Follow-up Now"}
                </button>
                <button className="light-btn" onClick={loadAIAgentSettings}>Reload Settings</button>
              </div>
            </TableCard>

            <TableCard title="🧭 Request Assignment Recommendations">
              <div style={{ padding: "16px", borderRadius: "18px", background: "#f8fafc", border: "1px solid #e2e8f0", marginBottom: "14px", lineHeight: 1.7 }}>
                <b>How it works:</b> بعد إنشاء الطلب، الموظف الذكي يقارن الطلب مع أداء المكاتب والاتفاقيات والتحديثات السابقة ثم يقترح أفضل مكتب. المدير يعتمد القرار قبل إرسال الطلب للمكتب.
              </div>
              <div className="mini-table-scroll" style={{ maxHeight: "420px", overflow: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Request</th>
                      <th>Need</th>
                      <th>Recommended Agency</th>
                      <th>Reason</th>
                      <th>Manager Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getAIAgentRequestAssignmentRecommendations().length === 0 ? (
                      <tr><td colSpan="5" style={{ textAlign: "center", color: "#64748b", padding: "24px" }}>No open requests need agency assignment right now.</td></tr>
                    ) : (
                      getAIAgentRequestAssignmentRecommendations().slice(0, 12).map((item) => (
                        <tr key={`ai-agent-rec-${item.request_no}`}>
                          <td><b>{item.request_no}</b><br /><small>{item.project}</small><br /><Badge value={item.priority} /></td>
                          <td>{item.profession}<br /><small>{item.nationality} / {item.gender}</small><br /><b>Remaining: {item.remaining}</b></td>
                          <td>
                            {item.bestAgency ? (
                              <>
                                <b>{item.bestAgency.agency}</b><br />
                                <small>Fit Score: {item.bestAgency.fitScore}%</small><br />
                                <Badge value={item.bestAgency.hasAgreement ? "Active Agreement" : "No Agreement"} />
                              </>
                            ) : "No agency"}
                          </td>
                          <td>
                            {item.bestAgency?.fitReasons?.slice(0, 3).map((reason, index) => (
                              <div key={`${item.request_no}-reason-${index}`}>• {reason}</div>
                            ))}
                          </td>
                          <td>
                            <div style={{ display: "grid", gap: "8px" }}>
                              <button className="new-btn" onClick={() => createAIAgentAssignmentApproval(item)}>Manual Resend to Manager</button>
                              <button className="save-btn" onClick={() => notifyAgencyFromAIAgentRecommendation(item)}>Approve & Notify Agency</button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </TableCard>

            <TableCard title="📬 Agency Follow-up Queue">
              <div className="mini-table-scroll" style={{ maxHeight: "420px", overflow: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Priority</th>
                      <th>Agency</th>
                      <th>Follow-up Type</th>
                      <th>Reference</th>
                      <th>Required Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getAIAgentAgencyTasks().length === 0 ? (
                      <tr><td colSpan="5" style={{ textAlign: "center", color: "#64748b", padding: "24px" }}>No AI Agent follow-up tasks. Agencies are within current follow-up rules.</td></tr>
                    ) : (
                      getAIAgentAgencyTasks().slice(0, 20).map((task, index) => (
                        <tr key={`${task.type}-${task.agency}-${task.reference}-${index}`}>
                          <td><Badge value={task.priority} /></td>
                          <td><b>{task.agency}</b><br /><small>{task.agency_email || "No email saved"}</small></td>
                          <td>{task.type}</td>
                          <td>{task.reference}<br /><small>{task.request_no}</small></td>
                          <td>{task.action_required}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {aiAgentLog && (
                <div style={{ marginTop: "14px", padding: "18px", borderRadius: "18px", background: "#ecfeff", border: "1px solid #a5f3fc", whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
                  {aiAgentLog}
                </div>
              )}
              {aiAgentLastRun && <p style={{ color: "#64748b", marginTop: "10px" }}>Last AI Agent run: {aiAgentLastRun}</p>}
            </TableCard>

            <div className="two-col">
              <TableCard title="✅ Manager Approval Inbox">
                <table>
                  <thead>
                    <tr><th>Item</th><th>Count</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Request assignment recommendations waiting for manager review</td>
                      <td>{getAIAgentRequestAssignmentRecommendations().length}</td>
                      <td><button className="new-btn" onClick={createAIAgentManagerBriefNotification}>Create Brief</button></td>
                    </tr>
                    <tr>
                      <td>High-priority agency follow-ups requiring escalation</td>
                      <td>{getAIAgentAgencyTasks().filter((task) => task.priority === "High").length}</td>
                      <td><button className="new-btn" onClick={runAIAgentAgencyFollowUp}>Prepare Follow-ups</button></td>
                    </tr>
                    <tr>
                      <td>Agency performance risk items</td>
                      <td>{buildAgencyScorecard().filter((row) => row.risk !== "Low").length}</td>
                      <td><button className="new-btn" onClick={() => setActivePage("Agency Performance")}>Open Performance</button></td>
                    </tr>
                  </tbody>
                </table>
              </TableCard>

              <TableCard title="📌 AI Daily Brief">
                <div style={{ padding: "18px", borderRadius: "18px", background: "#f8fafc", border: "1px solid #e2e8f0", whiteSpace: "pre-wrap", lineHeight: 1.8 }}>
                  {buildAIAgentManagerBrief().summary}
                  {getAIAgentRequestAssignmentRecommendations()[0]?.recommendation ? `\n\nTop recommendation:\n${getAIAgentRequestAssignmentRecommendations()[0].recommendation}` : ""}
                </div>
              </TableCard>
            </div>
          </>
        )}

        {activePage === "AI Commander" && (
          <>
            <TableCard title="🧠 VisaFlow AI Commander V2 - Executive Intelligence Center">
              <div style={{ display: "grid", gridTemplateColumns: "1.15fr 0.85fr", gap: "18px", alignItems: "stretch" }}>
                <div
                  style={{
                    borderRadius: "28px",
                    padding: "30px",
                    background: "radial-gradient(circle at 84% 16%, rgba(34,197,94,0.26), transparent 20%), linear-gradient(135deg, #020617 0%, #0f2f68 52%, #0f766e 100%)",
                    color: "white",
                    minHeight: "315px",
                    position: "relative",
                    overflow: "hidden",
                    boxShadow: "0 24px 70px rgba(15,23,42,0.18)",
                  }}
                >
                  <div style={{ position: "absolute", right: "-90px", top: "-90px", width: "280px", height: "280px", borderRadius: "999px", background: "rgba(255,255,255,0.10)" }} />
                  <div style={{ position: "absolute", right: "34px", bottom: "24px", opacity: 0.14, fontSize: "150px", lineHeight: 1 }}>🤖</div>
                  <div style={{ position: "relative", zIndex: 1 }}>
                    <div style={{ display: "inline-flex", gap: "8px", alignItems: "center", padding: "9px 14px", borderRadius: "999px", background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.18)", marginBottom: "18px" }}>
                      <span>⚡</span>
                      <b>CEO-Level Recruitment, Visa & Mobilization Intelligence</b>
                    </div>
                    <h2 style={{ margin: "0 0 12px", fontSize: "38px", letterSpacing: "-0.05em", lineHeight: 1.08 }}>
                      From tracking data to operational decisions.
                    </h2>
                    <p style={{ maxWidth: "760px", opacity: 0.91, lineHeight: 1.8, fontSize: "16px" }}>
                      AI Commander analyzes live requests, visas, authorizations, candidates, agencies, Saudization, and mobilization stages to detect risks, forecast gaps, and recommend management actions.
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "10px", marginTop: "24px" }}>
                      {[
                        ["SLA Risk", reports.lateItems.length],
                        ["Line Visa Gaps", buildRequestHealthRows().filter((x) => !x.isSaudi && x.visaGap > 0).length],
                        ["Agency Risk", buildAgencyScorecard().filter((x) => x.risk !== "Low").length],
                        ["High-Risk Requests", buildRequestHealthRows().filter((x) => x.riskLevel === "High").length],
                        ["Arrivals 30D", executiveDashboard.arrivalsNext30Days.length],
                      ].map(([label, value]) => (
                        <div key={label} style={{ padding: "14px", borderRadius: "18px", background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.18)" }}>
                          <div style={{ fontSize: "28px", fontWeight: 950 }}>{value}</div>
                          <div style={{ fontSize: "12px", opacity: 0.82, marginTop: "4px" }}>{label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ display: "grid", gap: "12px" }}>
                  <Stat
                    title="AI Risk Score"
                    value={
                      reports.lateItems.length +
                      buildRequestHealthRows().filter((row) => !row.isSaudi && row.visaGap > 0).length +
                      buildRequestHealthRows().filter((row) => !row.isSaudi && row.authorizationGap > 0).length +
                      buildRequestHealthRows().filter((row) => row.riskLevel === "High").length
                    }
                    className={executiveAlertClass(
                      reports.lateItems.length +
                      buildRequestHealthRows().filter((row) => !row.isSaudi && row.visaGap > 0).length +
                      buildRequestHealthRows().filter((row) => !row.isSaudi && row.authorizationGap > 0).length +
                      buildRequestHealthRows().filter((row) => row.riskLevel === "High").length
                    )}
                  />
                  <Stat title="Avg Open Request Progress" value={`${buildRecruitmentForecast().avgProgress}%`} className={buildRecruitmentForecast().avgProgress >= 70 ? "passed" : "warning"} />
                  <Stat title="Remaining Recruitment Gap" value={buildRecruitmentForecast().totalRemainingRecruitment} className={buildRecruitmentForecast().totalRemainingRecruitment > 0 ? "warning" : "passed"} />
                  <Stat title="Remaining Joining Gap" value={buildRecruitmentForecast().totalRemainingJoining} className={buildRecruitmentForecast().totalRemainingJoining > 0 ? "warning" : "passed"} />
                </div>
              </div>
            </TableCard>

            <div className="dashboard-grid">
              <Stat title="Open Requests" value={executiveDashboard.openRequests} className="warning" />
              <Stat title="Active Candidates" value={executiveDashboard.activeCandidates} className="passed" />
              <Stat title="Recruitment Progress" value={`${executiveDashboard.recruitmentProgress}%`} className={executiveDashboard.recruitmentProgress >= 80 ? "passed" : executiveDashboard.recruitmentProgress >= 50 ? "warning" : "danger"} />
              <Stat title="Available Visas" value={executiveDashboard.availableVisas} className="passed" />
              <Stat title="Open Authorizations" value={executiveDashboard.openAuthorizations} className="passed" />
              <Stat title="Saudization Rate" value={`${executiveDashboard.saudizationRate}%`} className={executiveDashboard.saudizationRate >= 30 ? "passed" : "warning"} />
            </div>

            <TableCard title="🚦 Executive Alerts & Forecast">
              <div className="dashboard-grid">
                <Stat title="Delayed SLA Items" value={reports.lateItems.length} className={executiveAlertClass(reports.lateItems.length)} />
                <Stat title="Requests Without Visa" value={requestsWithoutVisa.length} className={executiveAlertClass(requestsWithoutVisa.length)} />
                <Stat title="Authorizations Without Candidates" value={reports.authorizationsWithoutCandidates.length} className={executiveAlertClass(reports.authorizationsWithoutCandidates.length)} />
                <Stat title="Candidates Without Interviews" value={reports.candidatesWithoutInterviews.length} className={executiveAlertClass(reports.candidatesWithoutInterviews.length)} />
                <Stat title="High-Risk Requests" value={buildRequestHealthRows().filter((row) => row.riskLevel === "High").length} className={executiveAlertClass(buildRequestHealthRows().filter((row) => row.riskLevel === "High").length)} />
                <Stat title="Arrivals Next 30 Days" value={executiveDashboard.arrivalsNext30Days.length} className="passed" />
              </div>
              <div style={{ marginTop: "14px", padding: "18px", borderRadius: "18px", background: "#f8fafc", border: "1px solid #e2e8f0", lineHeight: 1.7 }}>
                <b>AI Forecast:</b> {buildRecruitmentForecast().forecastMessage}
              </div>
            </TableCard>

            <TableCard title="🤖 AI Agent - Agency Follow-up Employee">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "12px", marginBottom: "16px" }}>
                <Stat title="Open Follow-ups" value={getAIAgentAgencyTasks().length} className={getAIAgentAgencyTasks().length ? "warning" : "passed"} />
                <Stat title="SLA Candidate Delays" value={getAgencySlaEscalationAlerts().length} className={executiveAlertClass(getAgencySlaEscalationAlerts().length)} />
                <Stat title="Auths Without Candidates" value={reports.authorizationsWithoutCandidates.length} className={executiveAlertClass(reports.authorizationsWithoutCandidates.length)} />
                <Stat title="Agency Risk" value={buildAgencyScorecard().filter((x) => x.risk !== "Low").length} className={executiveAlertClass(buildAgencyScorecard().filter((x) => x.risk !== "Low").length)} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "14px", alignItems: "center", marginBottom: "16px" }}>
                <div style={{ padding: "18px", borderRadius: "18px", background: "#f8fafc", border: "1px solid #e2e8f0", lineHeight: 1.7 }}>
                  <b>AI Agent Role:</b> يعمل كموظف متابعة آلي للمكاتب: يكتشف التأخير، يجهز رسالة المتابعة، يسجلها في Notifications، ويرسلها للـ webhook / email automation إذا كان مربوط.
                </div>
                <button className="save-btn" onClick={runAIAgentAgencyFollowUp} disabled={aiAgentLoading}>
                  {aiAgentLoading ? "AI Agent Working..." : "Run AI Agent Follow-up"}
                </button>
              </div>

              <div className="mini-table-scroll" style={{ maxHeight: "320px", overflow: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Priority</th>
                      <th>Agency</th>
                      <th>Type</th>
                      <th>Reference</th>
                      <th>Required Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getAIAgentAgencyTasks().length === 0 ? (
                      <tr><td colSpan="5">No AI Agent follow-up tasks. Agencies are within current follow-up rules.</td></tr>
                    ) : (
                      getAIAgentAgencyTasks().slice(0, 12).map((task, index) => (
                        <tr key={`${task.type}-${task.agency}-${task.reference}-${index}`}>
                          <td><Badge value={task.priority} /></td>
                          <td><b>{task.agency}</b><br /><small>{task.agency_email || "No email saved"}</small></td>
                          <td>{task.type}</td>
                          <td>{task.reference}<br /><small>{task.request_no}</small></td>
                          <td>{task.action_required}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {aiAgentLog && (
                <div style={{ marginTop: "14px", padding: "18px", borderRadius: "18px", background: "#ecfeff", border: "1px solid #a5f3fc", whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
                  {aiAgentLog}
                </div>
              )}
              {aiAgentLastRun && <p style={{ color: "#64748b", marginTop: "10px" }}>Last AI Agent run: {aiAgentLastRun}</p>}
            </TableCard>

            <TableCard title="🧠 AI Commander Console - Executive Command Center">
              <div style={{ display: "grid", gridTemplateColumns: "0.95fr 1.05fr", gap: "18px", alignItems: "stretch" }}>
                <div style={{ display: "grid", gap: "14px" }}>
                  <div style={{ padding: "18px", borderRadius: "22px", background: "linear-gradient(135deg, #0f172a, #1e3a8a)", color: "white", boxShadow: "0 18px 45px rgba(15,23,42,0.16)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start" }}>
                      <div>
                        <p style={{ margin: "0 0 6px", opacity: 0.78, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", fontSize: "11px" }}>Live Executive Assistant</p>
                        <h3 style={{ margin: 0, fontSize: "24px", letterSpacing: "-0.03em" }}>اسأل النظام كأنك تسأل مدير عمليات ذكي</h3>
                      </div>
                      <div style={{ padding: "10px 12px", borderRadius: "16px", background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.16)", fontWeight: 900 }}>
                        {aiLoading ? "Analyzing" : "Ready"}
                      </div>
                    </div>
                    <p style={{ margin: "14px 0 0", lineHeight: 1.7, opacity: 0.9 }}>
                      يعطيك ملخص تنفيذي، مخاطر، قرارات مقترحة، متابعة مكاتب، وتوقعات مبنية على بيانات VisaFlow الحية بدون خلط بين بنود الطلب.
                    </p>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <label style={{ display: "grid", gap: "6px", fontWeight: 800, color: "#334155" }}>
                      Analysis Mode
                      <select value={aiCommanderMode} onChange={(e) => setAiCommanderMode(e.target.value)}>
                        <option>Executive Brief</option>
                        <option>Risk Analysis</option>
                        <option>Agency Follow-up</option>
                        <option>Forecast</option>
                        <option>CEO Decision Memo</option>
                      </select>
                    </label>
                    <label style={{ display: "grid", gap: "6px", fontWeight: 800, color: "#334155" }}>
                      Language
                      <select value={aiCommanderLanguage} onChange={(e) => setAiCommanderLanguage(e.target.value)}>
                        <option>Arabic</option>
                        <option>English</option>
                      </select>
                    </label>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "10px" }}>
                    <textarea
                      value={aiQuestion}
                      onChange={(e) => setAiQuestion(e.target.value)}
                      placeholder="مثال: مرحبا، أو اعطني ملخص تنفيذي، أو ما أعلى المخاطر التشغيلية؟"
                      rows={4}
                      style={{ borderRadius: "16px", border: "1px solid #cbd5e1", padding: "14px", fontSize: "15px", resize: "vertical", lineHeight: 1.6 }}
                    />
                    <div style={{ display: "grid", gap: "8px", alignContent: "start" }}>
                      <button className="save-btn" onClick={() => runAICommander()} disabled={aiLoading} style={{ minWidth: "150px" }}>
                        {aiLoading ? "Analyzing..." : "Run Commander"}
                      </button>
                      <button className="light-btn" onClick={() => setAiAnswer(buildLocalAICommanderAnswer(aiQuestion, aiCommanderMode, aiCommanderLanguage))} disabled={aiLoading}>
                        Local Brief
                      </button>
                      <button className="light-btn" onClick={() => navigator.clipboard?.writeText(aiAnswer || "")} disabled={!aiAnswer}>
                        Copy
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px" }}>
                    {[
                      ["📌", "ملخص CEO", "اعطني ملخص تنفيذي للرئيس التنفيذي عن وضع التوظيف والمخاطر والقرارات المطلوبة."],
                      ["🚨", "أعلى المخاطر", "ما هي أعلى 5 مخاطر تشغيلية حسب request lines؟ وما الإجراء المطلوب لكل خطر؟"],
                      ["🏢", "متابعة المكاتب", "رتب المكاتب حسب الأداء وحدد من يحتاج متابعة عاجلة وما سبب الضعف."],
                      ["🔮", "توقعات 30 يوم", "توقع فجوة التوظيف والوصول خلال 30 يوم واعطني قرارات مقترحة."],
                    ].map(([icon, title, prompt]) => (
                      <button
                        key={title}
                        className="light-btn"
                        style={{ textAlign: "left", padding: "14px", borderRadius: "16px", height: "auto", display: "grid", gap: "6px" }}
                        onClick={() => {
                          setAiQuestion(prompt);
                          runAICommander(prompt);
                        }}
                      >
                        <b>{icon} {title}</b>
                        <small style={{ color: "#64748b", lineHeight: 1.5 }}>{prompt}</small>
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ borderRadius: "22px", border: "1px solid #e2e8f0", background: "#f8fafc", overflow: "hidden", minHeight: "520px", display: "grid", gridTemplateRows: "auto 1fr auto" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", padding: "16px 18px", background: "white", borderBottom: "1px solid #e2e8f0" }}>
                    <div>
                      <b style={{ color: "#0f172a" }}>Commander Response</b>
                      <div style={{ color: "#64748b", fontSize: "12px", marginTop: "4px" }}>Structured executive cards powered by VIE + Edge Function</div>
                    </div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <span className="badge passed">VIE Lines</span>
                      <span className="badge warning">Live KPI</span>
                      <span className="badge active">{aiCommanderMode}</span>
                    </div>
                  </div>
                  <div style={{ padding: "18px", overflow: "auto", maxHeight: "620px" }}>
                    {renderAICommanderAnswer()}
                  </div>
                  <div style={{ padding: "12px 18px", background: "white", borderTop: "1px solid #e2e8f0", color: "#64748b", fontSize: "12px" }}>
                    {aiLastRun ? `Last AI run: ${aiLastRun}` : "No run yet"}
                  </div>
                </div>
              </div>
            </TableCard>

            <div className="grid">
              <TableCard title="🔥 Request Line Health Analyzer (VIE)">
                <table>
                  <thead>
                    <tr>
                      <th>Request</th>
                      <th>Line</th>
                      <th>Project</th>
                      <th>Profession</th>
                      <th>Nationality</th>
                      <th>Qty</th>
                      <th>Candidates</th>
                      <th>Medical</th>
                      <th>Arrived</th>
                      <th>Joined</th>
                      <th>Progress</th>
                      <th>Bottleneck</th>
                      <th>Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buildRequestHealthRows().slice(0, 12).length === 0 ? (
                      <tr><td colSpan="13">No request line health data</td></tr>
                    ) : (
                      buildRequestHealthRows().slice(0, 12).map((row) => (
                        <tr key={row.line_key}>
                          <td>
                            <button className="link-btn" onClick={() => {
                              const req = requests.find((request) => request.request_no === row.request_no);
                              if (req) openRequestDetails(req);
                            }}>
                              {row.request_no}
                            </button>
                          </td>
                          <td>{row.line_no}</td>
                          <td>{row.project}</td>
                          <td>{row.profession}</td>
                          <td>{row.nationality}</td>
                          <td>{row.requested_qty}</td>
                          <td>{row.candidates}</td>
                          <td>{row.medicalDone}</td>
                          <td>{row.arrived}</td>
                          <td>{row.joined}</td>
                          <td>
                            <b>{row.progress}%</b>
                            <div style={{ marginTop: "6px", background: "#e5e7eb", borderRadius: "999px", overflow: "hidden", height: "8px" }}>
                              <div
                                style={{
                                  width: `${Math.min(row.progress, 100)}%`,
                                  height: "100%",
                                  background: row.progress >= 70 ? "#16a34a" : row.progress >= 40 ? "#f59e0b" : "#dc2626",
                                }}
                              />
                            </div>
                          </td>
                          <td>{row.bottleneck}</td>
                          <td><Badge value={`${row.riskLevel} (${row.riskScore})`} /></td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </TableCard>

              <TableCard title="🏢 Agency Scorecard">
                <table>
                  <thead>
                    <tr>
                      <th>Agency</th>
                      <th>Auth Qty</th>
                      <th>Candidates</th>
                      <th>Arrived</th>
                      <th>Joined</th>
                      <th>Fail %</th>
                      <th>Score</th>
                      <th>Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buildAgencyScorecard().slice(0, 10).length === 0 ? (
                      <tr><td colSpan="8">No agency performance data</td></tr>
                    ) : (
                      buildAgencyScorecard().slice(0, 10).map((agency) => (
                        <tr key={agency.agency}>
                          <td>{agency.agency}</td>
                          <td>{agency.authorizedQty}</td>
                          <td>{agency.candidates}</td>
                          <td>{agency.arrived}</td>
                          <td>{agency.joined}</td>
                          <td>{agency.failRate}%</td>
                          <td><b>{agency.score}</b></td>
                          <td><Badge value={agency.risk} /></td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </TableCard>
            </div>

            <div className="grid">
              <TableCard title="🛂 Visa Allocation Gaps by Request Line">
                <table>
                  <thead>
                    <tr>
                      <th>Request</th>
                      <th>Line</th>
                      <th>Profession</th>
                      <th>Nationality</th>
                      <th>Required</th>
                      <th>Allocated</th>
                      <th>Available Balance</th>
                      <th>Visa Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buildRequestHealthRows().filter((line) => !line.isSaudi && line.visaGap > 0).length === 0 ? (
                      <tr><td colSpan="8">No visa allocation gaps detected by request line</td></tr>
                    ) : (
                      buildRequestHealthRows().filter((line) => !line.isSaudi && line.visaGap > 0).slice(0, 8).map((line) => (
                        <tr key={line.line_key}>
                          <td>{line.request_no}</td>
                          <td>{line.line_no}</td>
                          <td>{line.profession}</td>
                          <td>{line.nationality}</td>
                          <td>{line.requested_qty}</td>
                          <td>{line.allocatedVisaQty}</td>
                          <td>{line.matching_available_visa_qty}</td>
                          <td><Badge value={line.visaGap} /></td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </TableCard>

              <TableCard title="📅 Arrivals & Joining Outlook">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Candidate</th>
                      <th>Project</th>
                      <th>Request No</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {executiveDashboard.arrivalsNext30Days.length === 0 ? (
                      <tr><td colSpan="5">No planned arrivals in the next 30 days</td></tr>
                    ) : (
                      executiveDashboard.arrivalsNext30Days.slice(0, 10).map((item, index) => (
                        <tr key={`${item.request_no}-${item.candidate}-${index}`}>
                          <td>{item.date}</td>
                          <td>{item.candidate}</td>
                          <td>{item.project}</td>
                          <td>{item.request_no}</td>
                          <td><Badge value={item.status} /></td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </TableCard>
            </div>
          </>
        )}


        {activePage === "Platform Intelligence" && (() => {
          const pi = getPlatformIntelligenceModel();
          return (
            <>
              <section
                style={{
                  position: "relative",
                  overflow: "hidden",
                  borderRadius: "34px",
                  padding: "34px",
                  background: "radial-gradient(circle at top left, rgba(20,184,166,0.35), transparent 32%), radial-gradient(circle at bottom right, rgba(168,85,247,0.30), transparent 34%), linear-gradient(135deg, #020617 0%, #172554 48%, #0f766e 100%)",
                  color: "white",
                  boxShadow: "0 30px 90px rgba(15,23,42,0.28)",
                  marginBottom: "22px",
                }}
              >
                <div style={{ position: "absolute", right: "28px", bottom: "-24px", fontSize: "180px", opacity: 0.12 }}>🛰️</div>
                <div style={{ position: "relative", zIndex: 1, display: "grid", gridTemplateColumns: "1.15fr 0.85fr", gap: "28px", alignItems: "center" }}>
                  <div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "9px", padding: "10px 15px", borderRadius: "999px", background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.18)", marginBottom: "18px" }}>
                      <span>👑</span>
                      <strong>VisaFlow SaaS Control Center</strong>
                    </div>
                    <h1 style={{ margin: "0 0 14px", fontSize: "44px", lineHeight: 1.05, letterSpacing: "-0.06em" }}>
                      Platform Intelligence
                    </h1>
                    <p style={{ maxWidth: "760px", margin: 0, opacity: 0.92, lineHeight: 1.8, fontSize: "16px" }}>
                      شاشة تنفيذية لمالك المنصة تعرض صحة الاشتراكات، الإيرادات، الدعم، النسخ الاحتياطية، واستخدام الشركات بشكل بصري جذاب يليق بعرض VisaFlow كمنتج SaaS عالمي.
                    </p>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div style={{ borderRadius: "24px", padding: "18px", background: "rgba(255,255,255,0.13)", border: "1px solid rgba(255,255,255,0.20)", backdropFilter: "blur(14px)" }}>
                      <div style={{ opacity: 0.75, fontSize: "12px", fontWeight: 900, textTransform: "uppercase" }}>Monthly Revenue</div>
                      <strong style={{ display: "block", fontSize: "30px", marginTop: "8px" }}>{formatCompactNumber(pi.monthlyRevenue, " SAR")}</strong>
                    </div>
                    <div style={{ borderRadius: "24px", padding: "18px", background: "rgba(255,255,255,0.13)", border: "1px solid rgba(255,255,255,0.20)", backdropFilter: "blur(14px)" }}>
                      <div style={{ opacity: 0.75, fontSize: "12px", fontWeight: 900, textTransform: "uppercase" }}>Backup Health</div>
                      <strong style={{ display: "block", fontSize: "30px", marginTop: "8px" }}>{pi.backupHealth}%</strong>
                    </div>
                    <div style={{ gridColumn: "1 / -1", borderRadius: "24px", padding: "18px", background: "rgba(255,255,255,0.13)", border: "1px solid rgba(255,255,255,0.20)", backdropFilter: "blur(14px)" }}>
                      <MiniBarChart rows={[
                        { label: "Active Companies", value: pi.activeClients, color: "#22c55e" },
                        { label: "Open Support", value: pi.openTickets, color: "#f97316" },
                        { label: "Overdue Invoices", value: pi.overdueInvoices, color: "#e11d48" },
                      ]} />
                    </div>
                  </div>
                </div>
              </section>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", marginBottom: "20px" }}>
                <VisualKpi icon="🏢" title="Total Companies" value={pi.totalClients} subtitle={`${pi.activeClients} active subscription(s)`} color="#2563eb" progress={getPercentValue(pi.activeClients, pi.totalClients || 1)} />
                <VisualKpi icon="💰" title="MRR" value={formatCompactNumber(pi.monthlyRevenue, " SAR")} subtitle={`${formatCompactNumber(pi.collectedAmount, " SAR")} collected invoices`} color="#14b8a6" progress={getPercentValue(pi.collectedAmount, pi.invoiceAmount || 1)} />
                <VisualKpi icon="🎫" title="Support Load" value={pi.openTickets} subtitle={`${pi.highPriorityTickets} high priority ticket(s)`} color="#f97316" progress={Math.min(pi.openTickets * 10, 100)} />
                <VisualKpi icon="💾" title="System Backups" value={`${pi.backupHealth}%`} subtitle={`${systemBackups.length} backup record(s)`} color="#a855f7" progress={pi.backupHealth} />
                <VisualKpi icon="👥" title="Platform Users" value={pi.platformUserCount} subtitle={`${pi.clientUserCount} client user(s)`} color="#06b6d4" progress={Math.min(pi.platformUserCount * 20, 100)} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(320px, 0.9fr)", gap: "18px", marginBottom: "18px" }}>
                <VisualPanel title="🏆 Top Companies by Value / Usage" subtitle="يعطي انطباعًا إداريًا قويًا عن الشركات الأكثر استخدامًا أو الأعلى قيمة." accent="#2563eb">
                  <MiniBarChart rows={pi.topClients.length ? pi.topClients : [{ label: "No companies yet", value: 0, color: "#94a3b8" }]} valueSuffix={pi.monthlyRevenue ? " SAR" : ""} />
                </VisualPanel>

                <div style={{ display: "grid", gap: "18px" }}>
                  <DonutMetric title="Subscription Health" value={pi.activeClients} total={pi.totalClients || 1} icon="✅" color="#22c55e" label={`${pi.activeClients} active of ${pi.totalClients || 0} company account(s)`} />
                  <DonutMetric title="Invoice Collection" value={pi.collectedAmount} total={pi.invoiceAmount || 1} icon="💳" color="#14b8a6" label={`${formatCompactNumber(pi.collectedAmount, " SAR")} collected from ${formatCompactNumber(pi.invoiceAmount, " SAR")}`} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(310px, 1fr))", gap: "18px", marginBottom: "18px" }}>
                <VisualPanel title="📦 Plans Mix" subtitle="توزيع الباقات يعطي وضوحًا لتوجه المبيعات." accent="#a855f7">
                  <MiniBarChart rows={pi.planRows.length ? pi.planRows : [{ label: "Standard", value: pi.totalClients, color: "#a855f7" }]} />
                </VisualPanel>

                <VisualPanel title="🧾 Invoice Pulse" subtitle="حالة الفواتير بشكل سريع وواضح." accent="#f97316">
                  <MiniBarChart rows={pi.invoiceRows} />
                </VisualPanel>

                <VisualPanel title="🎧 Support Pulse" subtitle="مؤشر الدعم المركزي والتنبيهات." accent="#e11d48">
                  <MiniBarChart rows={pi.supportRows} />
                </VisualPanel>
              </div>

              <div className="grid">
                <TableCard title="🏢 Company Subscription Health">
                  <table>
                    <thead>
                      <tr>
                        <th>Company</th>
                        <th>Status</th>
                        <th>Users</th>
                        <th>End Date</th>
                        <th>MRR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(platformClients || []).length === 0 ? (
                        <tr><td colSpan="5">No platform clients found</td></tr>
                      ) : (
                        platformClients.slice(0, 10).map((client) => (
                          <tr key={client.id || client.company_name}>
                            <td>{client.company_name || client.name || "-"}</td>
                            <td><Badge value={client.subscription_status || client.status || "Active"} /></td>
                            <td>{client.users_count || 0}</td>
                            <td>{client.end_date || client.subscription_end || "-"}</td>
                            <td>{Number(client.monthly_amount || 0).toLocaleString()} SAR</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </TableCard>

                <TableCard title="🎫 Central Support & Platform Alerts">
                  <table>
                    <thead>
                      <tr>
                        <th>Ticket</th>
                        <th>Client</th>
                        <th>Priority</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(supportTickets || []).length === 0 ? (
                        <tr><td colSpan="4">No support tickets</td></tr>
                      ) : (
                        supportTickets.slice(0, 10).map((ticket) => {
                          const client = platformClients.find((item) => String(item.id || "") === String(ticket.client_id || ""));
                          return (
                            <tr key={ticket.id || ticket.ticket_no}>
                              <td>{ticket.ticket_no || ticket.title || "-"}</td>
                              <td>{client?.company_name || "-"}</td>
                              <td><Badge value={ticket.priority || "Medium"} /></td>
                              <td><Badge value={ticket.status || "Open"} /></td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </TableCard>
              </div>

              <VisualPanel title="🤖 Platform Intelligence Notes" subtitle="هذه البطاقات توضح فلسفة فصل إدارة المنصة عن بيانات الشركات التشغيلية." accent="#0f766e">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "14px" }}>
                  <FeaturePill icon="👑" title="Platform Only" text="هذه الشاشة للمالك العام فقط، وتعرض مؤشرات SaaS ولا تدخل في تفاصيل عمليات الشركات." color="#2563eb" />
                  <FeaturePill icon="📊" title="Company Reports Separated" text="AI Report Studio يبقى داخل حساب الشركة لإنتاج تقارير تنفيذية من بياناتها فقط." color="#14b8a6" />
                  <FeaturePill icon="🛡️" title="Governance Ready" text="التصميم يدعم الفصل بين الاشتراكات، الدعم، النسخ الاحتياطية، والمستخدمين." color="#a855f7" />
                </div>
              </VisualPanel>
            </>
          );
        })()}


        {activePage === "AI Report Studio" && (() => {
          const reportViz = getReportStudioVisualModel();
          return (
            <>
              <section
                style={{
                  position: "relative",
                  overflow: "hidden",
                  borderRadius: "34px",
                  padding: "34px",
                  background: "radial-gradient(circle at top right, rgba(249,115,22,0.30), transparent 34%), radial-gradient(circle at bottom left, rgba(20,184,166,0.32), transparent 35%), linear-gradient(135deg, #020617 0%, #1d4ed8 52%, #7c3aed 100%)",
                  color: "white",
                  boxShadow: "0 30px 90px rgba(30,64,175,0.25)",
                  marginBottom: "22px",
                }}
              >
                <div style={{ position: "absolute", right: "32px", bottom: "-20px", fontSize: "178px", opacity: 0.12 }}>📊</div>
                <div style={{ position: "relative", zIndex: 1, display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: "28px", alignItems: "center" }}>
                  <div>
                    <div style={{ display: "inline-flex", gap: "9px", alignItems: "center", padding: "10px 15px", borderRadius: "999px", background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.18)", marginBottom: "18px" }}>
                      <span>✨</span>
                      <b>PowerPoint · Word · PDF · Excel</b>
                    </div>
                    <h1 style={{ margin: "0 0 14px", fontSize: "44px", lineHeight: 1.05, letterSpacing: "-0.06em" }}>
                      AI Report Studio
                    </h1>
                    <p style={{ maxWidth: "820px", margin: 0, opacity: 0.92, lineHeight: 1.8, fontSize: "16px" }}>
                      اختر القالب، اللغة، الفترة ونوع الملف. الشاشة الآن تعطي تجربة Executive Report Studio برسوم بيانية حيّة وبطاقات ملونة قبل توليد التقرير.
                    </p>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "10px", marginTop: "24px" }}>
                      {REPORT_STUDIO_OUTPUTS.map((format) => (
                        <button
                          key={format}
                          type="button"
                          onClick={() => updateReportStudioForm("outputFormat", format)}
                          style={{
                            padding: "14px",
                            borderRadius: "18px",
                            border: reportStudioForm.outputFormat === format ? "2px solid white" : "1px solid rgba(255,255,255,0.25)",
                            background: reportStudioForm.outputFormat === format ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.10)",
                            color: "white",
                            cursor: "pointer",
                            fontWeight: 900,
                            boxShadow: reportStudioForm.outputFormat === format ? "0 14px 34px rgba(255,255,255,0.16)" : "none",
                          }}
                        >
                          {format === "PowerPoint" ? "📊" : format === "Word" ? "📄" : format === "PDF" ? "📕" : "📈"} {format}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: "14px" }}>
                    <DonutMetric title="Recruitment Progress" value={reportViz.progress} total={100} icon="🚀" color="#22c55e" label={`${formatCompactNumber(reportViz.totalCandidates)} active candidate(s) from ${formatCompactNumber(reportViz.totalRequired)} required`} />
                    <div style={{ borderRadius: "24px", padding: "18px", background: "rgba(255,255,255,0.13)", border: "1px solid rgba(255,255,255,0.20)", backdropFilter: "blur(14px)" }}>
                      <MiniBarChart rows={reportViz.riskRows} />
                    </div>
                  </div>
                </div>
              </section>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", marginBottom: "20px" }}>
                <VisualKpi icon="📚" title="Report Templates" value={REPORT_STUDIO_TEMPLATES.length} subtitle="Executive, Operations, Agencies, Finance" color="#2563eb" progress={100} />
                <VisualKpi icon="📋" title="Request Lines" value={buildRequestHealthRows().length} subtitle={`${formatCompactNumber(reportViz.totalRequired)} required manpower`} color="#14b8a6" progress={reportViz.progress} />
                <VisualKpi icon="⚠️" title="High Risk Lines" value={reportViz.highRiskLines} subtitle="Lines requiring management action" color="#e11d48" progress={Math.min(reportViz.highRiskLines * 12, 100)} />
                <VisualKpi icon="🛂" title="Visa / Auth Gaps" value={reportViz.visaGap + reportViz.authorizationGap} subtitle={`Visa ${reportViz.visaGap} · Auth ${reportViz.authorizationGap}`} color="#f97316" progress={Math.min((reportViz.visaGap + reportViz.authorizationGap) * 8, 100)} />
                <VisualKpi icon="✅" title="Joined" value={reportViz.totalJoined} subtitle={`${reportViz.joiningProgress}% joining progress`} color="#22c55e" progress={reportViz.joiningProgress} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(320px, 0.9fr)", gap: "18px", marginBottom: "18px" }}>
                <VisualPanel title="📈 Recruitment Funnel" subtitle="الرسم يوضح رحلة التقرير من الاحتياج إلى الانضمام." accent="#2563eb">
                  <MiniBarChart rows={reportViz.funnelRows} />
                </VisualPanel>

                <VisualPanel title="🎨 Template Categories" subtitle="توزيع قوالب التقارير المتاحة." accent="#a855f7">
                  <MiniBarChart rows={reportViz.categoryRows} />
                </VisualPanel>
              </div>

              <TableCard title="1) Select Report Template">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "14px" }}>
                  {REPORT_STUDIO_TEMPLATES.map((template, index) => {
                    const color = VIZ_COLORS[index % VIZ_COLORS.length];
                    const selected = reportStudioForm.templateId === template.id;
                    return (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => selectReportStudioTemplate(template)}
                        style={{
                          textAlign: "left",
                          borderRadius: "24px",
                          padding: "19px",
                          border: selected ? `2px solid ${color}` : "1px solid #e2e8f0",
                          background: selected ? `linear-gradient(180deg, ${color}12, white)` : "white",
                          cursor: "pointer",
                          boxShadow: selected ? `0 18px 45px ${color}26` : "0 12px 28px rgba(15,23,42,0.05)",
                          position: "relative",
                          overflow: "hidden",
                        }}
                      >
                        <div style={{ position: "absolute", right: "-18px", top: "-18px", width: "86px", height: "86px", borderRadius: "999px", background: color, opacity: 0.10 }} />
                        <div style={{ width: "48px", height: "48px", borderRadius: "17px", display: "grid", placeItems: "center", background: `linear-gradient(135deg, ${color}, #0f172a)`, color: "white", fontSize: "24px", marginBottom: "12px" }}>{template.icon}</div>
                        <h3 style={{ margin: "0 0 8px", color: "#0f172a" }}>{template.title}</h3>
                        <p style={{ margin: 0, color: "#64748b", lineHeight: 1.6 }}>{template.description}</p>
                        <div style={{ marginTop: "12px" }}><Badge value={template.category} /></div>
                      </button>
                    );
                  })}
                </div>
              </TableCard>

              <div className="grid">
                <TableCard title="2) Report Details">
                  <div className="form-grid">
                    <input value={reportStudioForm.reportName} onChange={(e) => updateReportStudioForm("reportName", e.target.value)} placeholder="Report Name" />
                    <select value={reportStudioForm.project} onChange={(e) => updateReportStudioForm("project", e.target.value)}>
                      {getReportStudioProjectOptions().map((project) => <option key={project}>{project}</option>)}
                    </select>
                    <input type="date" value={reportStudioForm.dateFrom} onChange={(e) => updateReportStudioForm("dateFrom", e.target.value)} />
                    <input type="date" value={reportStudioForm.dateTo} onChange={(e) => updateReportStudioForm("dateTo", e.target.value)} />
                    <select value={reportStudioForm.language} onChange={(e) => updateReportStudioForm("language", e.target.value)}>
                      {REPORT_STUDIO_LANGUAGES.map((language) => <option key={language}>{language}</option>)}
                    </select>
                    <select value={reportStudioForm.outputFormat} onChange={(e) => updateReportStudioForm("outputFormat", e.target.value)}>
                      {REPORT_STUDIO_OUTPUTS.map((format) => <option key={format}>{format}</option>)}
                    </select>
                  </div>
                </TableCard>

                <TableCard title="3) Include Sections">
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
                    {REPORT_STUDIO_SECTIONS.map((section) => {
                      const selected = (reportStudioForm.includeSections || []).includes(section);
                      return (
                        <label
                          key={section}
                          style={{
                            display: "flex",
                            gap: "8px",
                            alignItems: "center",
                            padding: "12px",
                            borderRadius: "16px",
                            background: selected ? "#eff6ff" : "#f8fafc",
                            border: selected ? "1px solid #2563eb" : "1px solid #e2e8f0",
                            cursor: "pointer",
                            fontWeight: selected ? 800 : 500,
                          }}
                        >
                          <input type="checkbox" checked={selected} onChange={() => toggleReportStudioSection(section)} />
                          <span>{section}</span>
                        </label>
                      );
                    })}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px", marginTop: "14px" }}>
                    <label><input type="checkbox" checked={reportStudioForm.confidential} onChange={(e) => updateReportStudioForm("confidential", e.target.checked)} /> Confidential Watermark</label>
                    <label><input type="checkbox" checked={reportStudioForm.companyLogo} onChange={(e) => updateReportStudioForm("companyLogo", e.target.checked)} /> Company Logo</label>
                    <label><input type="checkbox" checked={reportStudioForm.visaFlowLogo} onChange={(e) => updateReportStudioForm("visaFlowLogo", e.target.checked)} /> VisaFlow Logo</label>
                    <label><input type="checkbox" checked={reportStudioForm.aiRecommendations} onChange={(e) => updateReportStudioForm("aiRecommendations", e.target.checked)} /> AI Recommendations</label>
                  </div>
                </TableCard>
              </div>

              <TableCard title="4) Generate Report">
                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
                  <button className="save-btn" onClick={previewAIReportStudio}>Preview AI Report</button>
                  <button className="new-btn" onClick={exportAIReportStudio}>Generate {reportStudioForm.outputFormat}</button>
                  <button className="light-btn" onClick={() => updateReportStudioForm("outputFormat", "PowerPoint")}>Board Presentation</button>
                  <button className="light-btn" onClick={() => updateReportStudioForm("outputFormat", "Excel")}>Excel Dashboard</button>
                </div>

                <div style={{ marginTop: "16px", padding: "18px", borderRadius: "20px", background: "linear-gradient(135deg, #f8fafc, #eef2ff)", border: "1px solid #e2e8f0", lineHeight: 1.7 }}>
                  <b>Current Selection:</b> {reportStudioForm.reportName} · {reportStudioForm.project} · {reportStudioForm.language} · {reportStudioForm.outputFormat}
                </div>

                <div style={{ marginTop: "16px", minHeight: "260px", borderRadius: "24px", padding: "24px", background: "linear-gradient(135deg, #020617, #0f172a)", color: "#e2e8f0", whiteSpace: "pre-wrap", lineHeight: 1.75, fontSize: "14px", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)" }}>
                  {reportStudioResult || "Click Preview AI Report to see the executive narrative before generating the file."}
                </div>

                {reportStudioLastRun && <p style={{ color: "#64748b", marginTop: "10px" }}>Last generated: {reportStudioLastRun}</p>}
              </TableCard>
            </>
          );
        })()}

        {activePage === "Dashboard" && (
          <>
            <div className="dashboard-grid">
              <Stat title="Total Requests" value={requests.length} />
              <Stat title="Pending Approvals" value={stats.pendingApprovals} className="warning" />
              <Stat title="Approved Requests" value={stats.approvedRequests} className="passed" />
              <Stat title="Total Visa Qty" value={stats.totalQty} />
              <Stat title="Total Remaining" value={stats.totalRemaining} className="warning" />
              <Stat title="Total Mobilization Cost" value={Number(stats.totalMobilizationCost || 0).toLocaleString()} className="warning" />
              <Stat title="Budget Variance" value={Number(stats.costVariance || 0).toLocaleString()} className={stats.costVariance >= 0 ? "passed" : "danger"} />
<Stat title="Visa Process" value={stats.visaProcessCount} className="passed" />
              <Stat title="Joined Candidates" value={stats.joinedCandidates} className="passed" />
              <Stat title="Medical Pending" value={stats.pendingMedicalMobilizations} className="warning" />
              <Stat title="Tickets Issued" value={stats.ticketsIssuedMobilizations} className="passed" />
              <Stat title="Arrived KSA" value={stats.arrivedMobilizations} className="passed" />
              <Stat title="Joined Project" value={stats.joinedMobilizations} className="passed" />
              <Stat title="Active Agencies" value={stats.activeAgencies} />
            </div>
            <div className="grid">
              <SimpleList title="Latest Requests" rows={requests.slice(0, 6)} columns={["request_no", "profession", "gender", "quantity", "approval_status"]} />
              <SimpleList title="Latest Visa Records" rows={visaRecords.slice(0, 6)} columns={["visa_no", "project", "profession", "status"]} />
            </div>
          </>
        )}
        {activePage === "RequestDetails" && selectedRequest && (
  <div className="card">
  <h2>Request Details</h2>

  <div className="dashboard-grid">
    <Stat title="Request No" value={selectedRequest.request_no} />
    <Stat title="Profession" value={getRequestLineSummary(selectedRequest, "profession")} />
    <Stat title="Nationality" value={getRequestLineSummary(selectedRequest, "nationality")} />
    <Stat title="Qty" value={getRequestTotalQty(selectedRequest)} />
    <Stat
  title="Status"
  value={
    ((reports.requestLifecycle.find((x) => x.request_no === selectedRequest.request_no)?.completedCandidates || 0) >= (selectedRequest.qty || selectedRequest.quantity || 0))
      ? "Completed"
      : ((reports.requestLifecycle.find((x) => x.request_no === selectedRequest.request_no)?.completedCandidates || 0) > 0)
      ? "In Progress"
      : "Under Recruitment"
  }
/>
  </div>
  <TableCard title="Request Lines">
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Profession</th>
          <th>Nationality</th>
          <th>Gender</th>
          <th>Qty</th>
          <th>Interview</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        {getRequestLinesForRequest(selectedRequest).map((line, index) => (
          <tr key={line.id || index}>
            <td>{line.line_no || index + 1}</td>
            <td>{line.profession || "-"}</td>
            <td>{line.nationality || "-"}</td>
            <td>{line.gender || "-"}</td>
            <td>{line.quantity || 0}</td>
            <td>{line.interview_required === "No Interview" ? "No Interview" : line.interview_type || "Online"}</td>
            <td>{line.notes || "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </TableCard>
  <TableCard title="Linked Visas">
  <table>
    <thead>
      <tr>
        <th>Visa No</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      {visaRecords
        .filter((v) => v.request_no === selectedRequest.request_no)
        .map((v) => (
          <tr key={v.id}>
            <td>{v.visa_no || "-"}</td>
            <td>{v.status || "-"}</td>
          </tr>
        ))}
    </tbody>
  </table>
</TableCard>
<TableCard title="Linked Authorizations">
  <table>
    <thead>
      <tr>
        <th>Authorization No</th>
        <th>Agency</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      {visaAuthorizations
        .filter((a) =>
  visaRecords.some(
    (v) =>
      v.request_no === selectedRequest.request_no &&
      String(v.visa_no) === String(a.visa_no)
  )
)
        .map((a) => (
          <tr key={a.id}>
            <td>{a.authorization_no || "-"}</td>
            <td>{a.agency || "-"}</td>
            <td>{a.status || "-"}</td>
          </tr>
        ))}
    </tbody>
  </table>
</TableCard>
<TableCard title="Linked Candidates">
  
  <table>
    <thead>
      <tr>
        <th>Name</th>
<th>Profession</th>
<th>Nationality</th>
<th>Mobile</th>
<th>Passport / ID</th>
<th>Status</th>
<th>Action</th>
      </tr>
    </thead>
    <tbody>
      {candidates
 
.filter((c) => c.request_no === selectedRequest.request_no)
  .map((c) => (
          <tr key={c.id}>
            <td>{c.candidate_name || "-"}</td>
<td>{c.profession || "-"}</td>
<td>{c.nationality || "-"}</td>
<td>{c.mobile || "-"}</td>
<td>{c.passport_no || "-"}</td>
<td>{c.status || "-"}</td>
            <td>
  <button
    className="btn"
    onClick={() => {
      setInterviewForm({
        ...emptyInterview,
        candidate_id: c.id,
passport_no: c.passport_no || "",
mobile: c.mobile || "",
        candidate_name: c.candidate_name || "",
        profession: c.profession || "",
        nationality: c.nationality || "",
        agency: c.agency || "",
        project: c.project || "",
        request_no: selectedRequest.request_no,
      });

      setActivePage("Interviews");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }}
  >
    Add Interview
  </button>
</td>
           
          </tr>
        ))}
    </tbody>
  </table>
</TableCard>
<TableCard title="Linked Interviews">
  <table>
    <thead>
      <tr>
        <th>Candidate</th>
        <th>Result</th>
        <th>Date</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      {interviews
        .filter((i) => i.request_no === selectedRequest.request_no)
        .map((i) => (
          <tr key={i.id}>
            <td>{i.candidate_name || "-"}</td>
            <td>{i.result || "-"}</td>
            <td>{i.interview_date || "-"}</td>
            <td>{i.status || "-"}</td>
          </tr>
        ))}
    </tbody>
  </table>
</TableCard>
  <button className="btn" onClick={() => setActivePage("Reports")}>
    Back to Reports
  </button>
</div>
)}

        {activePage === "Requests" && (
          <>
            <div className="dashboard-grid">
              <Stat title="Open" value={stats.openRequests} />
              <Stat title="Urgent" value={stats.urgentRequests} className="warning" />
              <Stat title="Pending Approval" value={stats.pendingApprovals} className="warning" />
              <Stat title="Closed" value={requests.filter((x) => x.status === "Closed").length} className="passed" />
            </div>

            {canCreateRequest && (
            <FormCard title={requestEditingId ? "Edit Request" : "Create Request"}>
              <div className="form-grid">
                <Select value={requestForm.recruitment_type || "Foreign"} onChange={(v) => updateForm(setRequestForm, "recruitment_type", v)} placeholder="Recruitment Type" options={RECRUITMENT_TYPES} />
                <Select value={requestForm.request_type} onChange={(v) => updateForm(setRequestForm, "request_type", v)} placeholder="Request Type" options={["Project Recruitment", "Administration Recruitment", "Replacement", "Mobilization"]} />
                <Input placeholder="Project Name" value={requestForm.project_name} onChange={(v) => updateForm(setRequestForm, "project_name", v)} />
                <Input placeholder="Department" value={requestForm.department} onChange={(v) => updateForm(setRequestForm, "department", v)} />
                <Input placeholder="Salary Budget / Default Salary" value={requestForm.salary} onChange={(v) => updateForm(setRequestForm, "salary", v)} />
                <Select value={requestForm.priority} onChange={(v) => updateForm(setRequestForm, "priority", v)} placeholder="Priority" options={PRIORITIES} />
                <Select value={requestForm.status} onChange={(v) => updateForm(setRequestForm, "status", v)} placeholder="Status" options={REQUEST_STATUSES} />
                <Input placeholder="Requested By" value={requestForm.requested_by} onChange={(v) => updateForm(setRequestForm, "requested_by", v)} />

<label>Project Start Date</label>
<Input
type="date"
placeholder="Project Start Date"
value={requestForm.project_start || ""}
onChange={(v) => updateForm(setRequestForm, "project_start", v)}
/>

              </div>

              <div className="table-card" style={{ marginTop: 16 }}>
                <h2>Request Lines</h2>
                <p style={{ marginTop: 0, color: "#64748b" }}>
                  Add each profession / nationality / gender as a separate line under the same request number.
                </p>

                <div className="form-grid">
                  <Select
                    value={requestLineForm.profession}
                    onChange={(v) => updateForm(setRequestLineForm, "profession", v)}
                    placeholder="Profession"
                    searchable
                    options={professions.map((p) =>
                      p.name_en ? `${p.name_ar} - ${p.name_en}` : p.name_ar
                    )}
                  />
                  <Select
                    value={requestLineForm.nationality}
                    onChange={(v) => updateForm(setRequestLineForm, "nationality", v)}
                    placeholder="Nationality"
                    searchable
                    options={countries.map((c) =>
                      c.nationality ? `${c.nationality} (${c.name})` : c.name
                    )}
                  />
                  <Select
                    value={requestLineForm.gender}
                    onChange={(v) => updateForm(setRequestLineForm, "gender", v)}
                    placeholder="Gender"
                    options={GENDERS}
                  />
                  <Input
                    type="number"
                    placeholder="Quantity"
                    value={requestLineForm.quantity}
                    onChange={(v) => updateForm(setRequestLineForm, "quantity", v)}
                  />
                  <Input
                    placeholder="Salary / Line Budget"
                    value={requestLineForm.salary}
                    onChange={(v) => updateForm(setRequestLineForm, "salary", v)}
                  />
                  <Select
                    value={requestLineForm.interview_required || "Required"}
                    onChange={(v) =>
                      setRequestLineForm((prev) => ({
                        ...prev,
                        interview_required: v,
                        interview_type: v === "No Interview" ? "N/A" : prev.interview_type || "Online",
                      }))
                    }
                    placeholder="Interview Required"
                    options={["Required", "No Interview"]}
                  />
                  {requestLineForm.interview_required !== "No Interview" && (
                    <Select
                      value={requestLineForm.interview_type || "Online"}
                      onChange={(v) => updateForm(setRequestLineForm, "interview_type", v)}
                      placeholder="Interview Type"
                      options={["Online", "In-person"]}
                    />
                  )}
                  <Input
                    placeholder="Line Notes"
                    value={requestLineForm.notes}
                    onChange={(v) => updateForm(setRequestLineForm, "notes", v)}
                  />
                </div>

                <div className="actions-line">
                  <button type="button" className="btn" onClick={addRequestLineToDraft}>
                    Add Line
                  </button>
                </div>

                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Profession</th>
                      <th>Nationality</th>
                      <th>Gender</th>
                      <th>Qty</th>
                      <th>Salary</th>
                      <th>Interview</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requestLinesDraft.length === 0 ? (
                      <tr>
                        <td colSpan="8">No lines added yet.</td>
                      </tr>
                    ) : (
                      requestLinesDraft.map((line, index) => (
                        <tr key={index}>
                          <td>{index + 1}</td>
                          <td>{line.profession || "-"}</td>
                          <td>{line.nationality || "-"}</td>
                          <td><Badge value={line.gender || "-"} /></td>
                          <td>{line.quantity || 0}</td>
                          <td>{line.salary || "-"}</td>
                          <td>{line.interview_required === "No Interview" ? "No Interview" : line.interview_type || "Online"}</td>
                          <td>
                            <button type="button" className="danger" onClick={() => removeRequestLineFromDraft(index)}>
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>

                <div style={{ marginTop: 10, fontWeight: 700 }}>
                  Total Quantity: {requestLinesDraft.reduce((sum, line) => sum + Number(line.quantity || 0), 0)}
                </div>
              </div>

              <textarea rows="4" placeholder="Notes / Requirements / Experience Details" value={requestForm.notes} onChange={(e) => updateForm(setRequestForm, "notes", e.target.value)} />
              <div className="actions-line">
                <button className="save-btn" onClick={saveRequest}>{requestEditingId ? "Update Request" : "Save Request"}</button>
                <button className="light-btn" onClick={resetRequestForm}>Clear</button>
              </div>
            </FormCard>
            )}

            <TableCard title="Requests List">
              <table>
         <thead>
<tr>
<th>Request No</th>
<th>Type</th>
<th>Profession</th>
<th>Nationality</th>
<th>Gender</th>
<th>Salary</th>
<th>Qty</th>
<th>Remaining</th>
<th>Candidates</th>
<th>Project Start</th>
<th>Created</th>
<th>Priority</th>
<th>Status</th>
<th>Approval</th>
<th>Actions</th>
</tr>
</thead>
                <tbody>
                  {requests
  .filter((item) =>
    !search ||
    String(item.request_no || "").toLowerCase().includes(search.toLowerCase()) ||
    String(item.profession || "").toLowerCase().includes(search.toLowerCase()) ||
    String(item.nationality || "").toLowerCase().includes(search.toLowerCase()) ||
    String(item.project_name || "").toLowerCase().includes(search.toLowerCase())
  )
  .map((item) => (
                    <tr key={item.id}>
                      <td>
  <button
   onClick={() => {
  openRequestDetails(item);
}}
    style={{
      background: "none",
      border: "none",
      color: "#2563eb",
      cursor: "pointer",
      fontWeight: "bold",
    }}
  >
    {item.request_no}
  </button>
</td>
<td><Badge value={item.recruitment_type || (isSaudiNationality(item.nationality) ? "Saudi" : "Foreign")} /></td>
<td>{getRequestLineSummary(item, "profession")}</td>

<td>{getRequestLineSummary(item, "nationality")}</td>

<td>
<Badge value={getRequestLineSummary(item, "gender")} />
</td>

<td>{getRequestLineSummary(item, "salary")}</td>

<td>{getRequestTotalQty(item)}</td>

<td>
  {Math.max(
    getRequestTotalQty(item) -
      candidates.filter(
        (c) =>
          String(c.request_no || "") === String(item.request_no || "") &&
          !["Rejected", "Interview Failed", "Medical Failed", "Cancelled"].includes(c.status)
      ).length,
    0
  )}
</td>

<td>
  {
    candidates.filter(
      (c) =>
        String(c.request_no || "") === String(item.request_no || "") &&
        !["Rejected", "Interview Failed", "Medical Failed", "Cancelled"].includes(c.status)
    ).length
  }
</td>


<td>
{
item.project_start
? new Date(item.project_start).toLocaleDateString("en-GB")
: "-"
}
</td>
<td>
{
item.created_at
? new Date(item.created_at).toLocaleDateString("en-GB")
: "-"
}
</td>

<td><Badge value={item.priority} /></td>

<td>{item.status}</td>

<td><Badge value={item.approval_status} /></td>

                     <td className="table-actions">
  {canEditRequest && <button onClick={() => editRequest(item)}>Edit</button>}

  {canApproveRequest && <button onClick={() => approveRequest(item)}>Approve</button>}

  {canApproveRequest && <button onClick={() => rejectRequest(item)}>Reject</button>}

  {canManageCandidates && item.status !== "Completed" && (item.approval_status === "Approved by Recruitment" || item.approval_status === "Approved") && (
    <button onClick={() => createCandidateFromRequest(item)}>Add Candidate</button>
  )}

  {canManageCandidates && item.status !== "Completed" && (item.approval_status === "Approved by Recruitment" || item.approval_status === "Approved") && (
    <button onClick={() => startExcelUploadFromRequest(item)}>Upload Excel</button>
  )}

  {canManageVisas && !isSaudiRequest(item) && <button onClick={() => createVisaFromRequest(item)}>Visa</button>}

  {canDeleteRequest && (
    <button className="danger" onClick={() => deleteRequest(item.id)}>
      Delete
    </button>
  )}
</td>
</tr>
                  ))}
                </tbody>
              </table>
            </TableCard>
          </>
        )}

        {activePage === "Saudi Hiring" && (
          <>
            <div className="dashboard-grid">
              <Stat title="Saudi Requests" value={saudiHiringRows.length} className="passed" />
              <Stat title="Saudi Required" value={saudiHiringRows.reduce((sum, row) => sum + Number(row.qty || 0), 0)} />
              <Stat title="Saudi Candidates" value={candidates.filter((c) => isSaudiCandidate(c, requests) || isSaudiNationality(c.nationality)).length} className="passed" />
              <Stat title="Offers Accepted" value={candidates.filter((c) => (isSaudiCandidate(c, requests) || isSaudiNationality(c.nationality)) && ["Accepted", "Joined"].includes(c.offer_status)).length} className="passed" />
              <Stat title="Joined Saudis" value={candidates.filter((c) => (isSaudiCandidate(c, requests) || isSaudiNationality(c.nationality)) && (c.status === "Joined" || c.joining_date)).length} className="passed" />
            </div>

            <TableCard title="Saudi Hiring Requests">
              <table>
                <thead>
                  <tr>
                    <th>Request No</th>
                    <th>Project</th>
                    <th>Profession</th>
                    <th>Nationality</th>
                    <th>Gender</th>
                    <th>Qty</th>
                    <th>Candidates</th>
                    <th>Joined</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {saudiHiringRows.length === 0 ? (
                    <tr>
                      <td colSpan="10" style={{ textAlign: "center", color: "#64748b", padding: "24px" }}>
                        No Saudi hiring lines found.
                      </td>
                    </tr>
                  ) : (
                    saudiHiringRows.map((row) => {
                      const related = getSaudiHiringRowCandidates(row);
                      const joined = related.filter((c) => c.status === "Joined" || c.joining_date).length;
                      return (
                        <tr key={row.id}>
                          <td><button className="link-btn" onClick={() => openRequestDetails(row.request)}>{row.request_no}</button></td>
                          <td>{row.project_name || "-"}</td>
                          <td>{row.profession || "-"}</td>
                          <td>{row.nationality || "Saudi Arabia"}</td>
                          <td>{row.gender || "-"}</td>
                          <td>{row.qty || 0}</td>
                          <td>{related.length}</td>
                          <td>{joined}</td>
                          <td><Badge value={row.status || "-"} /></td>
                          <td className="table-actions">
                            {canManageCandidates && row.status !== "Completed" && (row.approval_status === "Approved by Recruitment" || row.approval_status === "Approved") && (
                              <button onClick={() => createCandidateFromRequest(row.request, row.line)}>Add Candidate</button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </TableCard>

            <TableCard title="Saudi Candidates">
              <table>
                <thead>
                  <tr>
                    <th>Request No</th>
                    <th>Name</th>
                    <th>Profession</th>
                    <th>Source</th>
                    <th>Offer</th>
                    <th>Joining Date</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.filter((c) => isSaudiCandidate(c, requests) || isSaudiNationality(c.nationality)).map((item) => (
                    <tr key={item.id}>
                      <td>{item.request_no || "-"}</td>
                      <td>{item.candidate_name || "-"}</td>
                      <td>{item.profession || "-"}</td>
                      <td>{item.source || "-"}</td>
                      <td><Badge value={item.offer_status || "Pending"} /></td>
                      <td>{item.joining_date || "-"}</td>
                      <td><Badge value={item.status || "New"} /></td>
                      <td className="table-actions">{canManageCandidates ? <button onClick={() => editCandidate(item)}>Edit</button> : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>
          </>
        )}

  {activePage === "Authorization" && (
<TableCard
title={
selectedVisa
? `Authorizations - ${selectedVisa.visa_no}`
: "Visa Authorizations"
}
>

{selectedVisa && (
<div style={{ marginBottom: "20px" }}>
  <b>Visa:</b> {selectedVisa.visa_no} |
  <b> Request:</b> {selectedVisa.request_no} |
  <b> Profession:</b> {selectedVisa.profession || "-"} |
  <b> Nationality:</b> {selectedVisa.nationality || "-"} |
  <b> Gender:</b> {selectedVisa.gender || "-"} |
  <b> Allocated:</b> {selectedVisa.allocated_qty || 0}
</div>
)}
<div className="actions-line">
{canManageVisas && <button onClick={() => setShowAuthForm(true)}>
+ Add Authorization
</button>}
{showAuthForm && (

<FormCard title="Add Authorization">

<div className="form-grid">
  <div className="form-grid">

  <select
    value={selectedVisa ? selectedVisa.id : ""}
    onChange={(e) => {
      const visa = visaAllocations.find(
        (v) => String(v.id) === String(e.target.value)
      );

      if (!visa) {
        setSelectedVisa(null);
        return;
      }

      const line = visaInventoryLines.find(
        (vLine) => String(vLine.id) === String(visa.visa_batch_line_id || "")
      );

      setSelectedVisa({
        id: visa.id,
        visa_no: visa.visa_no,
        request_no: visa.request_no,
        visa_batch_line_id: visa.visa_batch_line_id || "",
        profession: line?.profession || visa.profession || "-",
        nationality: line?.nationality || visa.nationality || "-",
        gender: line?.gender || visa.gender || "-",
        allocated_qty: Number(visa.allocated_qty || 0),
      });
    }}
  >
    <option value="">Select Visa Allocation</option>

    {visaAllocations.map((item) => {
      const line = visaInventoryLines.find(
        (vLine) => String(vLine.id) === String(item.visa_batch_line_id || "")
      );
      const profession = line?.profession || item.profession || "-";
      const nationality = line?.nationality || item.nationality || "-";
      const gender = line?.gender || item.gender || "-";

      return (
        <option key={item.id} value={item.id}>
          {item.request_no} | Visa {item.visa_no} | {profession} | {nationality} | {gender} | Qty {item.allocated_qty}
        </option>
      );
    })}
  </select>

  

<input
placeholder="Office / Agency"
onChange={(e)=>
setAuthForm({
...authForm,
agency:e.target.value
})
}
/>

<input
placeholder="Authorization No"
onChange={(e)=>
setAuthForm({
...authForm,
authorization_no:e.target.value
})
}
/>

<input
type="number"
placeholder="Allocated Qty"
onChange={(e)=>
setAuthForm({
...authForm,
allocated_qty:e.target.value
})
}
/>

<button
className="save-btn"
onClick={saveAuthorization}
>
Save Authorization
</button>

</div>
</div>
</FormCard>

)}
</div>

<table>
<thead>
<tr>
<th>Visa No</th>
<th>Profession</th>
<th>Nationality</th>
<th>Gender</th>
<th>Office</th>
<th>Authorization No</th>
<th>Allocated</th>
<th>Received</th>
<th>Interview Passed</th>
<th>Mobilized</th>
<th>Status</th>
<th>Cancellation No</th>
<th>Cancelled Date</th>
<th>Actions</th>
</tr>
</thead>
<tbody>

{console.log("Selected Visa:", selectedVisa)}
{console.log("Authorizations:", visaAuthorizations)}

{visaAuthorizations
  .filter((a) => {
    if (!selectedVisa) return true;

    if (a.visa_allocation_id) {
      return String(a.visa_allocation_id) === String(selectedVisa.id);
    }

    return (
      String(a.visa_no) === String(selectedVisa?.visa_no) &&
      String(a.request_no) === String(selectedVisa?.request_no) &&
      (!a.profession || !selectedVisa?.profession || normalize(a.profession) === normalize(selectedVisa.profession)) &&
      (!a.nationality || !selectedVisa?.nationality || normalize(a.nationality) === normalize(selectedVisa.nationality)) &&
      (!a.gender || !selectedVisa?.gender || normalize(a.gender) === normalize(selectedVisa.gender))
    );
  })
  .map((item) => (

<tr key={item.id}>
<td>{item.visa_no}</td>
<td>{item.profession || selectedVisa?.profession || "-"}</td>
<td>{item.nationality || selectedVisa?.nationality || "-"}</td>
<td>{item.gender || selectedVisa?.gender || "-"}</td>
<td>{item.agency}</td>
<td>{item.authorization_no}</td>
<td>{item.allocated_qty}</td>
<td>{item.received_candidates}</td>
<td>{item.interview_passed}</td>
<td>{item.mobilized}</td>
<td>{item.status}</td>
<td>{item.cancellation_no || "-"}</td>
<td>{item.cancelled_at || "-"}</td>

<td>
  {canManageVisas && item.status !== "Cancelled" ? (
    <button
      className="btn btn-sm"
      onClick={() => {
        if (window.confirm("Cancel this authorization?")) {
          cancelAuthorization(item.id);
        }
      }}
    >
      Cancel
    </button>
  ) : (
    "-"
  )}
</td>
</tr>

))}

</tbody>
</table>

</TableCard>
)}
  {activePage === "Cancellation Register" && (
  <TableCard title="Cancellation Register">
    <table>
      <thead>
        <tr>
          <th>Visa No</th>
          <th>Office</th>
          <th>Authorization No</th>
          <th>Cancellation No</th>
          <th>Cancelled Date</th>
          <th>Allocated</th>
          <th>Status</th>
        </tr>
      </thead>

      <tbody>
        {visaAuthorizations
          .filter(item => item.status === "Cancelled")
          .map(item => (
            <tr key={item.id}>
              <td>{item.visa_no}</td>
              <td>{item.agency}</td>
              <td>{item.authorization_no}</td>
              <td>{item.cancellation_no || "-"}</td>
              <td>{item.cancelled_at || "-"}</td>     
          


<td>{item.allocated_qty}</td>

<td>{item.status}</td>

</tr>
))
}
</tbody>

</table>

</TableCard>
)}


{activePage === "Visa Allocation" && (() => {
  const selectedAllocationSummary = getRequestAllocationSummary(allocationForm.request_no);
  const selectedAllocationRequest = selectedAllocationSummary.request;
  const requestLinesForAllocation = selectedAllocationSummary.lines;
  const matchingVisaLines = visaInventoryLines
    .filter((line) => {
      const remaining = getVisaLineRemainingQty(line);
      if (remaining <= 0) return false;

      const matchesRequest = requestLinesForAllocation.length === 0 || requestLinesForAllocation.some(
        (reqLine) => isCompatibleVisaLineForRequestLine(reqLine, line)
      );

      const keyword = allocationSearch.trim().toLowerCase();
      const matchesSearch = !keyword || [line.visa_no, line.profession, line.nationality, line.gender]
        .join(" ")
        .toLowerCase()
        .includes(keyword);

      return matchesRequest && matchesSearch;
    })
    .sort((a, b) => String(a.visa_no || "").localeCompare(String(b.visa_no || "")));

  const totalToAllocate = matchingVisaLines.reduce(
    (sum, line) => sum + getAllocationLineCurrentQty(line.id),
    0
  );

  return (
    <>
      {canManageVisas && (
        <>
          <FormCard title="1. Select Request">
            <div className="form-grid">
              <Select
                value={allocationForm.request_no}
                onChange={(v) => {
                  setAllocationForm({
                    request_no: v,
                    visa_no: "",
                    visa_batch_line_id: "",
                    allocated_qty: 0,
                  });
                  setAllocationDraft({});
                  setAllocationEditingId(null);
                }}
                placeholder="Select Request"
                searchable
                options={requests.filter((r) => !isSaudiRequest(r)).map((r) => r.request_no)}
              />

              <div className="stat-card">
                <h3>Request No</h3>
                <strong>{selectedAllocationRequest?.request_no || "-"}</strong>
              </div>
              <div className="stat-card">
                <h3>Total Requested</h3>
                <strong>{selectedAllocationSummary.totalRequested}</strong>
              </div>
              <div className="stat-card">
                <h3>Total Allocated</h3>
                <strong>{selectedAllocationSummary.totalAllocated}</strong>
              </div>
              <div className="stat-card">
                <h3>Remaining</h3>
                <strong>{selectedAllocationSummary.remaining}</strong>
              </div>
            </div>
          </FormCard>

          {allocationEditingId ? (
            <FormCard title="Edit Visa Allocation">
              <div className="form-grid">
                <Input placeholder="Request No" value={allocationForm.request_no} onChange={(v) => updateForm(setAllocationForm, "request_no", v)} />
                <Input placeholder="Visa No" value={allocationForm.visa_no} onChange={(v) => updateForm(setAllocationForm, "visa_no", v)} />
                <Input type="number" placeholder="Allocated Quantity" value={allocationForm.allocated_qty} onChange={(v) => updateForm(setAllocationForm, "allocated_qty", v)} />
                <button className="primary-btn" onClick={saveAllocation}>Update Allocation</button>
                <button
                  onClick={() => {
                    setAllocationEditingId(null);
                    setAllocationForm({ request_no: "", visa_no: "", visa_batch_line_id: "", allocated_qty: 0 });
                  }}
                >
                  Cancel Edit
                </button>
              </div>
            </FormCard>
          ) : (
            <FormCard title="2. Allocate Visa Lines">
              <div className="toolbar">
                <input
                  placeholder="Search visa lines..."
                  value={allocationSearch}
                  onChange={(e) => setAllocationSearch(e.target.value)}
                />
                <button className="primary-btn" onClick={saveSelectedAllocations} disabled={!allocationForm.request_no || totalToAllocate <= 0}>
                  Allocate Selected ({totalToAllocate})
                </button>
              </div>

              {!allocationForm.request_no ? (
                <p>Please select a request first.</p>
              ) : matchingVisaLines.length === 0 ? (
                <p>No matching available visa lines for this request.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Visa No</th>
                      <th>Profession</th>
                      <th>Nationality</th>
                      <th>Gender</th>
                      <th>Available</th>
                      <th>Already Allocated</th>
                      <th>To Allocate</th>
                      <th>After Allocation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matchingVisaLines.map((line) => {
                      const available = getVisaLineRemainingQty(line);
                      const qty = getAllocationLineCurrentQty(line.id);
                      const maxForLine = Math.min(available, selectedAllocationSummary.remaining);
                      return (
                        <tr key={line.id}>
                          <td>{line.visa_no}</td>
                          <td>{line.profession || "-"}</td>
                          <td>{line.nationality || "-"}</td>
                          <td>{line.gender || "-"}</td>
                          <td>{available}</td>
                          <td>{getVisaLineAllocatedQty(line.legacy ? "" : line.id, line.visa_no)}</td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              max={maxForLine}
                              value={qty}
                              onChange={(e) => updateAllocationDraft(line.id, e.target.value, maxForLine)}
                              style={{ maxWidth: 110 }}
                            />
                          </td>
                          <td>{available - qty}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              <div className="toolbar">
                <strong>Selected Lines: {Object.values(allocationDraft).filter((qty) => Number(qty || 0) > 0).length}</strong>
                <strong>Total To Allocate: {totalToAllocate}</strong>
                <strong>Request Remaining: {selectedAllocationSummary.remaining}</strong>
              </div>
            </FormCard>
          )}
        </>
      )}

      <TableCard title="3. Current Allocations for This Request">
        <p>
          Total Allocations: {
            allocationForm.request_no
              ? visaAllocations.filter((item) => String(item.request_no || "") === String(allocationForm.request_no || "")).length
              : visaAllocations.length
          }
        </p>
        <table>
          <thead>
            <tr>
              <th>Request No</th>
              <th>Visa No</th>
              <th>Profession</th>
              <th>Nationality</th>
              <th>Gender</th>
              <th>Allocated Qty</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(allocationForm.request_no
              ? visaAllocations.filter((item) => String(item.request_no || "") === String(allocationForm.request_no || ""))
              : visaAllocations
            ).length === 0 ? (
              <tr>
                <td colSpan="7">No allocations yet</td>
              </tr>
            ) : (
              (allocationForm.request_no
                ? visaAllocations.filter((item) => String(item.request_no || "") === String(allocationForm.request_no || ""))
                : visaAllocations
              ).map((item) => {
                const line = visaInventoryLines.find((vLine) => String(vLine.id) === String(item.visa_batch_line_id || ""));
                return (
                  <tr key={item.id}>
                    <td>{item.request_no}</td>
                    <td>{item.visa_no}</td>
                    <td>{line?.profession || "-"}</td>
                    <td>{line?.nationality || "-"}</td>
                    <td>{line?.gender || "-"}</td>
                    <td>{item.allocated_qty}</td>
                    <td>
                      {canManageVisas ? (
                        <>
                          <button
                            onClick={() => {
                              setAllocationForm({
                                request_no: item.request_no,
                                visa_no: item.visa_no,
                                visa_batch_line_id: item.visa_batch_line_id || "",
                                allocated_qty: item.allocated_qty,
                              });
                              setAllocationEditingId(item.id);
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                          >
                            Edit
                          </button>

                          <button className="danger" onClick={() => deleteAllocation(item.id)}>
                            Delete
                          </button>
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </TableCard>
    </>
  );
})()}

{activePage === "Visa Inventory" && (
  <div>
    <div className="dashboard-grid">
      <Stat title="Requests With Visa" value={requestsWithVisa.length} className="passed" />
      <Stat title="Requests Without Visa" value={requestsWithoutVisa.length} className="warning" />
      <Stat title="Extra Visa Lines" value={extraVisaRequests.length} className="danger" />
    </div>

    <div className="toolbar">
      <input
        placeholder="Search visa, MOI, project, profession, nationality, gender"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
        <option>All</option>
        {VISA_STATUSES.map((s) => <option key={s}>{s}</option>)}
      </select>
    </div>

    {canManageVisas && (
      <FormCard title={visaEditingId ? "Edit Visa Batch" : "Add Visa Batch"}>
        <div className="form-grid">
          <Input placeholder="Visa No" value={visaForm.visa_no} onChange={(v) => updateForm(setVisaForm, "visa_no", v)} />
          <Input placeholder="MOI No" value={visaForm.moi_no} onChange={(v) => updateForm(setVisaForm, "moi_no", v)} />
          <Input placeholder="Project" value={visaForm.project} onChange={(v) => updateForm(setVisaForm, "project", v)} />
                    
          <Input placeholder="Issue Date" type="date" value={visaForm.issue_date} onChange={(v) => updateForm(setVisaForm, "issue_date", v)} />
          <Input placeholder="Expiry Date" type="date" value={visaForm.expiry_date} onChange={(v) => updateForm(setVisaForm, "expiry_date", v)} />
          <Select value={visaForm.status} onChange={(v) => updateForm(setVisaForm, "status", v)} placeholder="Status" options={VISA_STATUSES} />
          <textarea rows="3" placeholder="Batch Notes" value={visaForm.notes} onChange={(e) => updateForm(setVisaForm, "notes", e.target.value)} />
        </div>

        <div className="card" style={{ marginTop: "12px" }}>
          <h3 style={{ marginBottom: "12px" }}>Visa Batch Lines</h3>
          <p>Use this section when one visa batch contains more than one profession, nationality, gender, or quantity.</p>
          <div className="form-grid">
            <Select
              value={visaLineForm.profession}
              onChange={(v) => updateForm(setVisaLineForm, "profession", v)}
              placeholder="Profession"
              searchable
              options={professions.length ? professions.map((p) => p.name_en ? `${p.name_ar} - ${p.name_en}` : p.name_ar) : PROFESSIONS}
            />
            <Select
              value={visaLineForm.nationality}
              onChange={(v) => updateForm(setVisaLineForm, "nationality", v)}
              placeholder="Nationality"
              searchable
              options={countries.length ? countries.map((c) => `${c.nationality} (${c.name})`) : COUNTRIES}
            />
            <Select value={visaLineForm.gender} onChange={(v) => updateForm(setVisaLineForm, "gender", v)} placeholder="Gender" options={GENDERS} />
            <Input type="number" placeholder="Line Quantity" value={visaLineForm.quantity} onChange={(v) => updateForm(setVisaLineForm, "quantity", v)} />
            <Input placeholder="Line Notes" value={visaLineForm.notes} onChange={(v) => updateForm(setVisaLineForm, "notes", v)} />
            <button type="button" className="light-btn" onClick={addVisaLineToDraft}>Add Line</button>
          </div>

          <div className="mini-table-scroll" style={{ marginTop: "12px", height: "auto", maxHeight: "260px" }}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Profession</th>
                  <th>Nationality</th>
                  <th>Gender</th>
                  <th>Qty</th>
                  <th>Notes</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visaLinesDraft.length === 0 ? (
                  <tr><td colSpan="7">No visa lines added yet</td></tr>
                ) : (
                  visaLinesDraft.map((line, index) => (
                    <tr key={`${line.profession}-${line.nationality}-${line.gender}-${index}`}>
                      <td>{index + 1}</td>
                      <td>{line.profession}</td>
                      <td>{line.nationality}</td>
                      <td>{line.gender}</td>
                      <td>{line.quantity}</td>
                      <td>{line.notes || "-"}</td>
                      <td><button className="danger" onClick={() => removeVisaLineFromDraft(index)}>Remove</button></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="actions-line">
          <button className="save-btn" onClick={saveVisa}>{visaEditingId ? "Update Visa Batch" : "Save Visa Batch"}</button>
          <button className="light-btn" onClick={resetVisaForm}>Clear</button>
        </div>
      </FormCard>
    )}

    <TableCard title="Visa Batches">
      <table>
        <thead>
          <tr>
            <th>Visa No</th>
            <th>MOI No</th>
            <th>Project</th>
            <th>Total Qty</th>
            <th>Allocated</th>
            <th>Remaining</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredVisaRecords.map((item) => (
            <tr key={item.id}>
              <td><button className="link-btn" onClick={() => editVisa(item)}>{item.visa_no || "-"}</button></td>
              <td>{item.moi_no || "-"}</td>
              <td>{item.project || "-"}</td>
              <td>{getVisaBatchTotalQty(item)}</td>
              <td>{getVisaBatchAllocatedQty(item)}</td>
              <td>{getVisaBatchRemainingQty(item)}</td>
              <td><Badge value={item.status} /></td>
              <td className="table-actions">
                {canManageVisas ? (
                  <>
                    <button onClick={() => editVisa(item)}>Edit</button>
                    <button onClick={() => openAuthorization(item)}>Authorizations</button>
                    <button className="danger" onClick={() => deleteVisa(item.id)}>Delete</button>
                  </>
                ) : (
                  <button onClick={() => openAuthorization(item)}>View</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>

    <TableCard title="Visa Batch Lines">
      <table>
        <thead>
          <tr>
            <th>Visa No</th>
            <th>Profession</th>
            <th>Nationality</th>
            <th>Gender</th>
            <th>Qty</th>
            <th>Allocated</th>
            <th>Remaining</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {visaInventoryLines.length === 0 ? (
            <tr><td colSpan="8">No visa lines found</td></tr>
          ) : (
            visaInventoryLines.map((line) => (
              <tr key={line.id}>
                <td>{line.visa_no || "-"}</td>
                <td>{line.profession || "-"}</td>
                <td>{line.nationality || "-"}</td>
                <td>{line.gender || "-"}</td>
                <td>{line.quantity || 0}</td>
                <td>{getVisaLineAllocatedQty(line.legacy ? "" : line.id, line.visa_no)}</td>
                <td>{getVisaLineRemainingQty(line)}</td>
                <td><Badge value={line.status} /></td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </TableCard>
  </div>
)}

            {activePage === "Candidates" && (
<>
            <div className="toolbar">
              <input placeholder="Search candidates" value={search} onChange={(e) => setSearch(e.target.value)} />
              {canManageCandidates && <button className="light-btn" onClick={downloadCandidateUploadTemplate}>Download Template</button>}
              {canManageCandidates && <button className="new-btn" onClick={startExcelUploadFromCandidates}>Upload Excel</button>}
            </div>
            {canManageCandidates && (
            <FormCard title={candidateEditingId ? "Edit Candidate" : "Add Candidate"}>
              <div className="form-grid">
                <Input placeholder="Candidate Name" value={candidateForm.candidate_name} onChange={(v) => updateForm(setCandidateForm, "candidate_name", v)} />
              <Select
  value={candidateForm.profession}
  onChange={(v) => updateForm(setCandidateForm, "profession", v)}
  placeholder="Profession"
  searchable
  options={professions.map((p) =>
    p.name_en ? `${p.name_ar} - ${p.name_en}` : p.name_ar
  )}
/>
<Select
  value={candidateForm.nationality}
  onChange={(v) => updateForm(setCandidateForm, "nationality", v)}
  placeholder="Search nationality..."
  searchable
  options={countries.map((c) => `${c.nationality} (${c.name})`)}
/>
<Select
  value={candidateForm.agency}
  onChange={(v) => updateForm(setCandidateForm, "agency", v)}
  placeholder="Search Agency / Office..."
  searchable
  options={agencies.map((a) => a.name)}
/><Input placeholder="Project" value={candidateForm.project} onChange={(v) => updateForm(setCandidateForm, "project", v)} readOnly={!!candidateForm.request_no} />
<Select
  value={candidateForm.request_no}
  onChange={(v) => {
    updateForm(setCandidateForm, "request_no", v);

    const req = requests.find(
      (r) => String(r.request_no) === String(v)
    );

    if (req) {
      setCandidateForm((prev) => ({
        ...prev,
        request_no: v,
        project: req.project_name || "",
        profession: req.profession || "",
        nationality: req.nationality || "",
        gender: req.gender || "",
        source: isSaudiRequest(req) ? (prev.source || "Jadarat") : prev.source || "",
        offer_status: prev.offer_status || "Pending",
      }));
    }
  }}
  placeholder="Search Request No..."
  searchable
  options={requests.map((r) => r.request_no)}
/><Input placeholder="Passport No" value={candidateForm.passport_no} onChange={(v) => updateForm(setCandidateForm, "passport_no", v)} />                
                <Input placeholder="Mobile" value={candidateForm.mobile} onChange={(v) => updateForm(setCandidateForm, "mobile", v)} />
                <Input
  placeholder="Email"
  value={candidateForm.email}
  onChange={(v) => updateForm(setCandidateForm, "email", v)}
/>
{isSaudiCandidate(candidateForm, requests) && (
  <>
    <Select value={candidateForm.source || ""} onChange={(v) => updateForm(setCandidateForm, "source", v)} placeholder="Saudi Source" options={SAUDI_SOURCES} />
    <Select value={candidateForm.offer_status || "Pending"} onChange={(v) => updateForm(setCandidateForm, "offer_status", v)} placeholder="Offer Status" options={OFFER_STATUSES} />
    <Input type="date" placeholder="Joining Date" value={candidateForm.joining_date || ""} onChange={(v) => updateForm(setCandidateForm, "joining_date", v)} />
  </>
)}
{!isSaudiCandidate(candidateForm, requests) && (
<>
<Input type="number" placeholder="Visa Fees" value={candidateForm.visa_fees} onChange={(v) => updateForm(setCandidateForm, "visa_fees", v)} />
<Input type="number" placeholder="Agency Commission" value={candidateForm.agency_commission} onChange={(v) => updateForm(setCandidateForm, "agency_commission", v)} />
<Input type="number" placeholder="Ticket Cost" value={candidateForm.ticket_cost} onChange={(v) => updateForm(setCandidateForm, "ticket_cost", v)} />
<Input type="number" placeholder="KSA Medical Cost" value={candidateForm.medical_ksa_cost} onChange={(v) => updateForm(setCandidateForm, "medical_ksa_cost", v)} />
<Select value={candidateForm.contract_status || "Pending"} onChange={(v) => updateForm(setCandidateForm, "contract_status", v)} placeholder="Contract Status" options={["Pending", "Sent", "Signed"]} />
<Input placeholder="Contract URL" value={candidateForm.contract_url} onChange={(v) => updateForm(setCandidateForm, "contract_url", v)} />
<Input type="number" placeholder="Visa Fees" value={candidateForm.visa_fees} onChange={(v) => updateForm(setCandidateForm, "visa_fees", v)} />
<Input type="number" placeholder="Agency Commission" value={candidateForm.agency_commission} onChange={(v) => updateForm(setCandidateForm, "agency_commission", v)} />
<Input type="number" placeholder="Ticket Cost" value={candidateForm.ticket_cost} onChange={(v) => updateForm(setCandidateForm, "ticket_cost", v)} />
<Input type="number" placeholder="KSA Medical Cost" value={candidateForm.medical_ksa_cost} onChange={(v) => updateForm(setCandidateForm, "medical_ksa_cost", v)} />
<Select value={candidateForm.contract_status || "Pending"} onChange={(v) => updateForm(setCandidateForm, "contract_status", v)} placeholder="Contract Status" options={["Pending", "Sent", "Signed"]} />
<Input placeholder="Contract URL" value={candidateForm.contract_url} onChange={(v) => updateForm(setCandidateForm, "contract_url", v)} />
</>
)}
                <Select value={candidateForm.status} onChange={(v) => updateForm(setCandidateForm, "status", v)} placeholder="Status" options={CANDIDATE_STATUSES} />
                  <Select
  value={candidateForm.medical_status}
  onChange={(v) => updateForm(setCandidateForm, "medical_status", v)}
  placeholder="Medical Status"
  options={["Pending", "Passed", "Failed"]}
/>

<Input
  placeholder="Medical Date"
  value={candidateForm.medical_date}
  onChange={(v) => updateForm(setCandidateForm, "medical_date", v)}
/>

<Input
  placeholder="Ticket No"
  value={candidateForm.ticket_no}
  onChange={(v) => updateForm(setCandidateForm, "ticket_no", v)}
/>

<Input
  placeholder="Flight Date"
  value={candidateForm.flight_date}
  onChange={(v) => updateForm(setCandidateForm, "flight_date", v)}
/>

<Input
  placeholder="Arrival Date"
  value={candidateForm.arrival_date}
  onChange={(v) => updateForm(setCandidateForm, "arrival_date", v)}
/>
              </div>

              {canViewCandidateIntelligence && selectedCandidateIntelligence.enabled && (
                <div style={{ marginTop: "14px", padding: "16px", border: "1px solid #dbeafe", borderRadius: "16px", background: "#f8fbff" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "12px" }}>
                    <div>
                      <h3 style={{ margin: 0 }}>Candidate Intelligence</h3>
                      <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: "13px" }}>
                        Decision support only — final hiring, interview, acceptance or rejection decision belongs to the company.
                      </p>
                    </div>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                      <Badge value={selectedCandidateIntelligence.level} />
                      <Badge value={selectedCandidateIntelligence.profile} />
                    </div>
                  </div>

                  <div className="form-grid">
                    <Input placeholder="Qualification" value={candidateTechnicalForm.qualification} onChange={(v) => updateForm(setCandidateTechnicalForm, "qualification", v)} />
                    <Input placeholder="Major / Specialization" value={candidateTechnicalForm.major} onChange={(v) => updateForm(setCandidateTechnicalForm, "major", v)} />
                    <Input placeholder="Specialization Details" value={candidateTechnicalForm.specialization} onChange={(v) => updateForm(setCandidateTechnicalForm, "specialization", v)} />
                    <Select
                      value={candidateTechnicalForm.institution_id}
                      onChange={(v) => {
                        const institution = getInstitutionById(v);
                        setCandidateTechnicalForm((prev) => ({
                          ...prev,
                          institution_id: v,
                          institution_name: institution?.institution_name || "",
                          institution_country: institution?.country || "",
                          institution_type: institution?.institution_type || "",
                        }));
                      }}
                      placeholder="Search university / institute..."
                      searchable
                      options={educationInstitutions.map((institution) => ({
                        value: institution.id,
                        label: `${institution.institution_name} - ${institution.country} (${institution.institution_type || "Institution"})`,
                      }))}
                    />
                    <Input type="number" placeholder="Graduation Year" value={candidateTechnicalForm.graduation_year} onChange={(v) => updateForm(setCandidateTechnicalForm, "graduation_year", v)} />
                    <Input type="number" placeholder="Years Experience" value={candidateTechnicalForm.years_experience} onChange={(v) => updateForm(setCandidateTechnicalForm, "years_experience", v)} />
                    <Input placeholder="Last Job Title" value={candidateTechnicalForm.last_job_title} onChange={(v) => updateForm(setCandidateTechnicalForm, "last_job_title", v)} />
                    <Input placeholder="Last Employer" value={candidateTechnicalForm.last_employer} onChange={(v) => updateForm(setCandidateTechnicalForm, "last_employer", v)} />
                    <Input placeholder="Last Project Type" value={candidateTechnicalForm.last_project_type} onChange={(v) => updateForm(setCandidateTechnicalForm, "last_project_type", v)} />
                    <Select value={candidateTechnicalForm.english_level} onChange={(v) => updateForm(setCandidateTechnicalForm, "english_level", v)} placeholder="English Level" options={LANGUAGE_LEVEL_OPTIONS} />
                    <Select value={candidateTechnicalForm.arabic_level} onChange={(v) => updateForm(setCandidateTechnicalForm, "arabic_level", v)} placeholder="Arabic Level" options={LANGUAGE_LEVEL_OPTIONS} />
                    <Select value={candidateTechnicalForm.final_company_decision} onChange={(v) => updateForm(setCandidateTechnicalForm, "final_company_decision", v)} placeholder="Final Company Decision" options={COMPANY_DECISION_OPTIONS} />
                  </div>

                  <div className="form-grid" style={{ marginTop: "10px" }}>
                    <label style={{ display: "flex", gap: "8px", alignItems: "center", fontWeight: 800 }}>
                      <input type="checkbox" checked={Boolean(candidateTechnicalForm.gulf_experience)} onChange={(e) => updateForm(setCandidateTechnicalForm, "gulf_experience", e.target.checked)} />
                      Gulf Experience
                    </label>
                    <label style={{ display: "flex", gap: "8px", alignItems: "center", fontWeight: 800 }}>
                      <input type="checkbox" checked={Boolean(candidateTechnicalForm.saudi_experience)} onChange={(e) => updateForm(setCandidateTechnicalForm, "saudi_experience", e.target.checked)} />
                      Saudi Experience
                    </label>
                  </div>

                  <textarea rows="2" placeholder="Technical Skills / المهارات الفنية" value={candidateTechnicalForm.technical_skills} onChange={(e) => updateForm(setCandidateTechnicalForm, "technical_skills", e.target.value)} />
                  <textarea rows="2" placeholder="Tools & Equipment / المعدات والأدوات" value={candidateTechnicalForm.tools_and_equipment} onChange={(e) => updateForm(setCandidateTechnicalForm, "tools_and_equipment", e.target.value)} />
                  <textarea rows="2" placeholder="Software Skills / البرامج والأنظمة" value={candidateTechnicalForm.software_skills} onChange={(e) => updateForm(setCandidateTechnicalForm, "software_skills", e.target.value)} />
                  <textarea rows="2" placeholder="Certifications / الشهادات" value={candidateTechnicalForm.certifications} onChange={(e) => updateForm(setCandidateTechnicalForm, "certifications", e.target.value)} />
                  <textarea rows="2" placeholder="Licenses / الرخص المهنية" value={candidateTechnicalForm.licenses} onChange={(e) => updateForm(setCandidateTechnicalForm, "licenses", e.target.value)} />
                  <textarea rows="2" placeholder="Project Experience / خبرة المشاريع" value={candidateTechnicalForm.project_experience} onChange={(e) => updateForm(setCandidateTechnicalForm, "project_experience", e.target.value)} />
                  <textarea rows="2" placeholder="Decision Notes / ملاحظات قرار الشركة" value={candidateTechnicalForm.decision_notes} onChange={(e) => updateForm(setCandidateTechnicalForm, "decision_notes", e.target.value)} />

                  {(() => {
                    const score = buildCandidateTechnicalScores(candidateTechnicalForm, selectedCandidateIntelligence);
                    return (
                      <div className="stats-grid" style={{ marginTop: "12px" }}>
                        <div className="stat-card"><h3>AI Score</h3><strong>{score.final_ai_score}%</strong></div>
                        <div className="stat-card"><h3>Priority</h3><strong>{score.interview_priority}</strong></div>
                        <div className="stat-card"><h3>Profile Status</h3><strong>{score.profile_completed ? "Complete" : "Missing Data"}</strong><p>{score.missing_fields.join(", ") || "Ready for review"}</p></div>
                      </div>
                    );
                  })()}
                </div>
              )}

              <textarea rows="3" placeholder="Notes" value={candidateForm.notes} onChange={(e) => updateForm(setCandidateForm, "notes", e.target.value)} />
              <div className="actions-line"><button className="save-btn" onClick={saveCandidate}>{candidateEditingId ? "Update Candidate" : "Save Candidate"}</button><button className="light-btn" onClick={resetCandidateForm}>Clear</button></div>
            </FormCard>
            )}
            <TableCard title="Candidates List">
  <table>
    <thead>
      <tr>
        <th>Request No</th>
        <th>Name</th>
        <th>Profession</th>
        <th>Nationality</th>
        <th>Gender</th>
        <th>Agency</th>
        <th>Project</th>
        <th>Passport</th>
        <th>Email</th>
        <th>Medical Status</th>
<th>Medical Date</th>
<th>Ticket No</th>
<th>Flight Date</th>
<th>Arrival Date</th>
{canViewCandidateIntelligence && <th>AI Score</th>}
{canViewCandidateIntelligence && <th>AI Priority</th>}
{canViewCandidateIntelligence && <th>Company Decision</th>}
<th>Total Cost</th>
<th>Contract</th>
<th>Source</th>
<th>Offer</th>
<th>Joining Date</th>
        <th>Status</th>
        <th>Actions</th>
      </tr>
    </thead>

    <tbody>
      {filteredCandidates.map((item) => (
        <tr key={item.id}>
          <td>{item.request_no}</td>
          <td>{item.candidate_name}</td>
          <td>{item.profession}</td>
          <td>{item.nationality}</td>
          <td><Badge value={item.gender} /></td>
          <td>{item.agency}</td>
          <td>{item.project}</td>
          <td>{item.passport_no}</td>
          <td>{item.email}</td>
          <td>{item.medical_status}</td>
<td>{item.medical_date}</td>
<td>{item.ticket_no}</td>
<td>{item.flight_date}</td>
<td>{item.arrival_date}</td>
{canViewCandidateIntelligence && <td>{item.technical_profile_required ? `${Number(item.ai_score || 0)}%` : "-"}</td>}
{canViewCandidateIntelligence && <td><Badge value={getCandidateIntelligenceBadge(item)} /></td>}
{canViewCandidateIntelligence && <td><Badge value={item.final_company_decision || "Pending Company Review"} /></td>}
<td>{getCandidateTotalCost(item).toLocaleString()}</td>
<td><Badge value={item.contract_status || "Pending"} /></td>
<td>{item.source || "-"}</td>
<td><Badge value={item.offer_status || "Pending"} /></td>
<td>{item.joining_date || "-"}</td>
          <td><Badge value={item.status} /></td>

          <td className="table-actions">
            {canManageCandidates ? (
              <>
                <button onClick={() => editCandidate(item)}>
                  Edit
                </button>

                {canManageInterviews && (
                  <button
                    onClick={() => {
                      setInterviewForm({
                        ...emptyInterview,
                        candidate_id: item.id,
                        candidate_name: item.candidate_name || "",
                        profession: item.profession || "",
                        nationality: item.nationality || "",
                        agency: item.agency || "",
                        project: item.project || "",
                        request_no: item.request_no || "",
                        passport_no: item.passport_no || "",
                        mobile: item.mobile || "",
                        status: "Waiting",
                      });

                      setInterviewEditingId(null);
                      setActivePage("Interviews");
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    Interview
                  </button>
                )}

                {canManageCandidates && ["Interview Passed", "Selected"].includes(item.status) && (
                  <button onClick={() => openOfferEmail(item)}>
                    Send Offer
                  </button>
                )}

                {canManageEmployees && ["Arrived KSA", "Arrived", "Joined"].includes(item.status) && !employees.some((employee) => String(employee.source_candidate_id || "") === String(item.id || "")) && (
                  <button onClick={() => convertCandidateToEmployee(item)}>
                    Convert To Employee
                  </button>
                )}

                <button onClick={() => openMobilizationFromCandidate(item)}>
                  Mobilization
                </button>

                <button
                  className="danger"
                  onClick={() => deleteCandidate(item.id)}
                >
                  Delete
                </button>
              </>
            ) : (
              "-"
            )}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
</TableCard>
          </>
        )}

        {activePage === "Interviews" && (
          <>
            {canManageInterviews && (
            <FormCard title={interviewEditingId ? "Edit Interview" : "Add Interview"}>
              <div className="form-grid">
                <Input placeholder="Candidate Name" value={interviewForm.candidate_name} onChange={(v) => updateForm(setInterviewForm, "candidate_name", v)} />
                <Input placeholder="Profession" value={interviewForm.profession} onChange={(v) => updateForm(setInterviewForm, "profession", v)} />
                <Input placeholder="Nationality" value={interviewForm.nationality} onChange={(v) => updateForm(setInterviewForm, "nationality", v)} />
                <Select value={interviewForm.agency} onChange={(v) => updateForm(setInterviewForm, "agency", v)} placeholder="Agency" options={agencies.map((x) => x.name)} />
                <Input placeholder="Project" value={interviewForm.project} onChange={(v) => updateForm(setInterviewForm, "project", v)} />
                <Input type="date" placeholder="Interview Date" value={interviewForm.interview_date} onChange={(v) => updateForm(setInterviewForm, "interview_date", v)} />
                <Select value={interviewForm.interview_type} onChange={(v) => updateForm(setInterviewForm, "interview_type", v)} placeholder="Interview Type" options={["Online", "In-person"]} />
                <Input placeholder="Interviewers" value={interviewForm.interviewers} onChange={(v) => updateForm(setInterviewForm, "interviewers", v)} />
                <Select value={interviewForm.score} onChange={(v) => updateForm(setInterviewForm, "score", v)} placeholder="Score" options={["Excellent", "Good", "Average", "Weak"]} />
                <Select value={interviewForm.status} onChange={(v) => updateForm(setInterviewForm, "status", v)} placeholder="Status" options={INTERVIEW_STATUSES} />
              </div>
              <textarea rows="3" placeholder="Interview Notes" value={interviewForm.notes} onChange={(e) => updateForm(setInterviewForm, "notes", e.target.value)} />
              <div className="actions-line"><button className="save-btn" onClick={saveInterview}>{interviewEditingId ? "Update Interview" : "Save Interview"}</button><button className="light-btn" onClick={resetInterviewForm}>Clear</button></div>
            </FormCard>
            )}
            <TableCard title="Interview Records">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Project</th>
                    <th>Name</th>
                    <th>Profession</th>
                    <th>Agency</th>
                    <th>Type</th>
                    <th>Score</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {interviews.map((item) => {
                    const interviewCandidate =
  candidates.find(
    (candidate) => String(candidate.id || "") === String(item.candidate_id || "")
  ) ||
  candidates.find(
    (candidate) =>
      String(candidate.passport_no || "") === String(item.passport_no || "") &&
      String(candidate.request_no || "") === String(item.request_no || "")
  ) ||
  candidates.find(
    (candidate) =>
      normalize(candidate.candidate_name) === normalize(item.candidate_name) &&
      String(candidate.request_no || "") === String(item.request_no || "")
  );

                    return (
                      <tr key={item.id}>
                        <td>{item.interview_date}</td>
                        <td>{item.project}</td>
                        <td>{item.candidate_name}</td>
                        <td>{item.profession}</td>
                        <td>{item.agency}</td>
                        <td>{item.interview_type}</td>
                        <td>{item.score}</td>
                        <td><Badge value={item.status} /></td>
                        <td className="table-actions">
                          {canManageInterviews ? (
                            <>
                              <button onClick={() => editInterview(item)}>Edit</button>
                              {item.status === "Passed" && interviewCandidate && (
                                <button onClick={() => openOfferEmail(interviewCandidate)}>Send Offer</button>
                              )}
                              <button className="danger" onClick={() => deleteInterview(item.id)}>Delete</button>
                            </>
                          ) : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableCard>
          </>
        )}
        
        {activePage === "Mobilization" && (
  <>
    <div className="toolbar">
      <Select
        value={selectedMobilizationRow?.request_no || ""}
        onChange={(v) => setSelectedMobilizationRequestNo(v)}
        placeholder="Select Request No"
        searchable
        options={mobilizationRequestRows.map((row) => row.request_no).filter(Boolean)}
      />
      <input
        placeholder="Search request, project, profession, nationality, stage"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
    </div>

    {selectedMobilizationRow && (
      <>
        <TableCard title={`Mobilization Dashboard - ${selectedMobilizationRow.request_no}`}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", flexWrap: "wrap", marginBottom: "14px" }}>
            <div>
              <b>Project:</b> {selectedMobilizationRow.project_name} |{" "}
              <b>Profession:</b> {selectedMobilizationRow.profession} |{" "}
              <b>Nationality:</b> {selectedMobilizationRow.nationality} |{" "}
              <b>Gender:</b> {selectedMobilizationRow.gender}
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <span style={{ fontSize: "13px", color: "#64748b" }}>Current Stage</span>
              <Badge value={selectedMobilizationRow.stage} />
            </div>
          </div>

          <div className="dashboard-grid">
            <Stat title="Required Qty" value={selectedMobilizationRow.qty} />
            <Stat title="Candidates" value={`${selectedMobilizationRow.candidates} / ${selectedMobilizationRow.qty} (${selectedMobilizationRow.candidatePercent}%)`} />
            <Stat
              title={selectedMobilizationRow.interviewRequired === "No Interview" ? "Interview" : "Interview Passed"}
              value={selectedMobilizationRow.interviewRequired === "No Interview" ? "Not Required" : `${selectedMobilizationRow.interviewPassed} / ${selectedMobilizationRow.qty} (${selectedMobilizationRow.interviewPercent}%)`}
              className={selectedMobilizationRow.interviewRequired === "No Interview" ? "warning" : "passed"}
            />
            <Stat title="Medical Done" value={`${selectedMobilizationRow.medicalDone} / ${selectedMobilizationRow.qty} (${selectedMobilizationRow.medicalPercent}%)`} className="warning" />

            {!selectedMobilizationRow.isSaudi && (
              <>
                <Stat title="Visa Allocated" value={`${selectedMobilizationRow.allocatedVisaQty} / ${selectedMobilizationRow.qty} (${selectedMobilizationRow.qty ? Math.min(Math.round((selectedMobilizationRow.allocatedVisaQty / selectedMobilizationRow.qty) * 100), 100) : 0}%)`} />
                <Stat title="Authorized Qty" value={`${selectedMobilizationRow.authorizedQty} / ${selectedMobilizationRow.qty} (${selectedMobilizationRow.qty ? Math.min(Math.round((selectedMobilizationRow.authorizedQty / selectedMobilizationRow.qty) * 100), 100) : 0}%)`} />
                <Stat title="Visa Ready" value={`${selectedMobilizationRow.visaReady} / ${selectedMobilizationRow.qty} (${selectedMobilizationRow.visaPercent}%)`} className="passed" />
              </>
            )}

            {selectedMobilizationRow.isSaudi && (
              <Stat title="Visa Requirement" value="Not Required" className="passed" />
            )}

            <Stat title={selectedMobilizationRow.isSaudi ? "Offer / Contract" : "Contract Signed"} value={`${selectedMobilizationRow.contractSigned} / ${selectedMobilizationRow.qty} (${selectedMobilizationRow.contractPercent}%)`} className="passed" />
            {!selectedMobilizationRow.isSaudi && (
              <>
                <Stat title="Ticket Issued" value={`${selectedMobilizationRow.ticketIssued} / ${selectedMobilizationRow.qty} (${selectedMobilizationRow.ticketPercent}%)`} className="passed" />
                <Stat title="Arrived KSA" value={`${selectedMobilizationRow.arrived} / ${selectedMobilizationRow.qty} (${selectedMobilizationRow.arrivalPercent}%)`} className="passed" />
              </>
            )}
            <Stat title="Joined" value={`${selectedMobilizationRow.joined} / ${selectedMobilizationRow.qty} (${selectedMobilizationRow.joinedPercent}%)`} className="passed" />
            <Stat title="Remaining Recruitment" value={selectedMobilizationRow.remaining} className="warning" />
            <Stat title="Remaining Joining" value={selectedMobilizationRow.remainingJoining} className="warning" />
            <Stat title="Current Stage" value={selectedMobilizationRow.stage} />
            <Stat title="Overall Progress" value={`${selectedMobilizationRow.progress}%`} className={selectedMobilizationRow.progress >= 100 ? "passed" : "warning"} />
          </div>

          <div style={{ marginTop: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px", fontSize: "13px", color: "#64748b" }}>
              <span>{selectedMobilizationRow.isSaudi ? "Progress based on Saudi hiring journey: Candidate → Interview → Offer → Joining" : "Progress based on full journey: Candidate → Interview → Medical → Visa/Authorization → Contract → Ticket → Arrival → Joining"}</span>
              <b>{selectedMobilizationRow.progress}%</b>
            </div>
            <div style={{ background: "#e5e7eb", borderRadius: "999px", overflow: "hidden", height: "16px" }}>
              <div
                style={{
                  width: `${Math.min(selectedMobilizationRow.progress, 100)}%`,
                  height: "100%",
                  background: selectedMobilizationRow.progress >= 100 ? "#16a34a" : selectedMobilizationRow.progress >= 70 ? "#2563eb" : "#f59e0b",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          </div>
        </TableCard>

        <TableCard title="Mobilization Candidate Details">
          <table>
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Passport / ID</th>
                <th>Agency</th>
                <th>Medical</th>
                <th>Medical Date</th>
                {!selectedMobilizationRow.isSaudi && <th>Visa Status</th>}
                <th>{selectedMobilizationRow.isSaudi ? "Offer" : "Contract"}</th>
                {selectedMobilizationRow.isSaudi && <th>Joining Date</th>}
                {!selectedMobilizationRow.isSaudi && <th>Ticket No</th>}
                {!selectedMobilizationRow.isSaudi && <th>Flight Date</th>}
                {!selectedMobilizationRow.isSaudi && <th>Arrival Date</th>}
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {selectedMobilizationCandidates.length === 0 ? (
                <tr>
                  <td colSpan={selectedMobilizationRow.isSaudi ? "11" : "12"}>No candidates linked to this request yet</td>
                </tr>
              ) : (
                selectedMobilizationCandidates.map((candidate) => {
                  const candidateMob = mobilizations.find(
                    (m) => String(m.candidate_id || "") === String(candidate.id || "")
                  );

                  return (
                    <tr key={candidate.id}>
                      <td>{candidate.candidate_name || "-"}</td>
                      <td>{candidate.passport_no || "-"}</td>
                      <td>{candidate.agency || "-"}</td>
                      <td><Badge value={candidate.medical_status || candidateMob?.medical_status || "Pending"} /></td>
                      <td>{candidate.medical_date || candidateMob?.medical_date || "-"}</td>
                      {!selectedMobilizationRow.isSaudi && (
                        <td><Badge value={candidateMob?.visa_status || (candidate.status === "Visa Stamped" ? "Stamped" : "Pending")} /></td>
                      )}
                      <td><Badge value={selectedMobilizationRow.isSaudi ? (candidate.offer_status || candidate.contract_status || "Pending") : (candidate.contract_status || "Pending")} /></td>
                      {selectedMobilizationRow.isSaudi && <td>{candidate.joining_date || candidateMob?.joining_date || "-"}</td>}
                      {!selectedMobilizationRow.isSaudi && <td>{candidate.ticket_no || candidateMob?.ticket_no || "-"}</td>}
                      {!selectedMobilizationRow.isSaudi && <td>{candidate.flight_date || candidateMob?.flight_date || "-"}</td>}
                      {!selectedMobilizationRow.isSaudi && <td>{candidate.arrival_date || candidateMob?.arrival_date || "-"}</td>}
                      <td><Badge value={candidate.status || candidateMob?.mobilization_status || "New"} /></td>
                      <td className="table-actions">
                        {canManageCandidates && <button onClick={() => editCandidate(candidate)}>Edit</button>}
                        {canManageMobilization && <button onClick={() => openMobilizationFromCandidate(candidate)}>Update Mobilization</button>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </TableCard>
      </>
    )}

    <TableCard title="All Requests Mobilization Summary">
      <table>
        <thead>
          <tr>
            <th>Request No</th>
            <th>Project</th>
            <th>Profession</th>
            <th>Nationality</th>
            <th>Qty</th>
            <th>Candidates</th>
            <th>Interview</th>
            <th>Medical</th>
            <th>Visa</th>
            <th>Contract</th>
            <th>Ticket</th>
            <th>Arrived</th>
            <th>Joined</th>
            <th>Remaining Recruitment</th>
            <th>Progress</th>
            <th>Stage</th>
          </tr>
        </thead>
        <tbody>
          {mobilizationRequestRows
            .filter((row) =>
              !search ||
              [
                row.request_no,
                row.project_name,
                row.profession,
                row.nationality,
                row.stage,
              ]
                .join(" ")
                .toLowerCase()
                .includes(search.toLowerCase())
            )
            .map((row) => (
              <tr key={row.request_no}>
                <td>
                  <button
                    className="link-btn"
                    onClick={() => {
                      setSelectedMobilizationRequestNo(row.request_no);
                      setSearch("");
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    {row.request_no}
                  </button>
                </td>
                <td>{row.project_name}</td>
                <td>{row.profession}</td>
                <td>{row.nationality}</td>
                <td>{row.qty}</td>
                <td>{row.candidates}</td>
                <td>{row.interviewRequired === "No Interview" ? "N/A" : row.interviewPassed}</td>
                <td>{row.medicalDone}</td>
                <td>{row.isSaudi ? "N/A" : row.visaReady}</td>
                <td>{row.contractSigned}</td>
                <td>{row.isSaudi ? "N/A" : row.ticketIssued}</td>
                <td>{row.isSaudi ? "N/A" : row.arrived}</td>
                <td>{row.joined}</td>
                <td>{row.remaining}</td>
                <td>
                  <div style={{ minWidth: "110px" }}>
                    <div style={{ fontWeight: "bold", marginBottom: "4px" }}>{row.progress}%</div>
                    <div style={{ background: "#e5e7eb", borderRadius: "999px", overflow: "hidden", height: "8px" }}>
                      <div
                        style={{
                          width: `${Math.min(row.progress, 100)}%`,
                          height: "100%",
                          background: row.progress >= 100 ? "#16a34a" : row.progress >= 70 ? "#2563eb" : "#f59e0b",
                        }}
                      />
                    </div>
                  </div>
                </td>
                <td><Badge value={row.stage} /></td>
              </tr>
            ))}
        </tbody>
      </table>
    </TableCard>
  </>
)}



{activePage === "Office Portal" && (
  <>
    <div className="dashboard-grid">
      <Stat title="Office Candidates" value={getOfficeVisibleCandidates().length} />
      <Stat
        title="Medical / Visa Process"
        value={getOfficeVisibleCandidates().filter((x) => ["Medical Scheduled", "Medical Passed", "Training", "Training Completed", "Embassy Submitted", "Visa Stamped", "Ticket Booked", "Departure", "Arrived", "Arrived KSA"].includes(x.status)).length}
        className="warning"
      />
      <Stat
        title="Joined"
        value={getOfficeVisibleCandidates().filter((x) => x.status === "Joined").length}
        className="passed"
      />
    </div>


    {currentRole === "Agency" && agencyPenalties.filter((item) => item.status !== "Pending Review").length > 0 && (
      <TableCard title="Labor SLA Delay Penalties / الغرامات المطلوبة لتأخير العمالة">
        <div className="mini-table-scroll" style={{ height: "auto", maxHeight: "420px" }}>
          <table>
            <thead>
              <tr>
                <th>Penalty No</th>
                <th>Agreement</th>
                <th>Candidate</th>
                <th>Request No</th>
                <th>SLA Delay</th>
                <th>Calculated</th>
                <th>Required Amount</th>
                <th>Status</th>
                <th>Justification</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {agencyPenalties
                .filter((item) => item.status !== "Pending Review")
                .map((item) => (
                  <tr key={item.id}>
                    <td>{item.penalty_no || "-"}</td>
                    <td>{item.agreement_no || "-"}</td>
                    <td>{item.candidate_name || "-"}</td>
                    <td>{item.request_no || "-"}</td>
                    <td>{item.delay_days || 0} days</td>
                    <td>{Number(item.calculated_amount || 0).toLocaleString()} SAR</td>
                    <td><b>{Number(item.approved_amount ?? item.calculated_amount ?? 0).toLocaleString()} SAR</b></td>
                    <td><Badge value={item.status || "-"} /></td>
                    <td>{item.agency_justification || item.decision_notes || "-"}</td>
                    <td className="table-actions">
                      {item.status === "Sent to Agency" ? (
                        <button className="save-btn" onClick={() => submitPenaltyJustification(item)}>Submit Justification</button>
                      ) : item.status === "Justification Submitted" ? (
                        <span>Under company review</span>
                      ) : ["Approved", "Reduced"].includes(item.status) ? (
                        <span>Finalized</span>
                      ) : item.status === "Waived" ? (
                        <span>Waived</span>
                      ) : "-"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </TableCard>
    )}

    {currentRole === "Agency" && agencyAgreements.length > 0 && (
      <TableCard title="Agency Agreements / Electronic Signature">
        <div className="mini-table-scroll" style={{ height: "auto", maxHeight: "420px" }}>
          <table>
            <thead>
              <tr>
                <th>Agreement No</th>
                <th>Company Workspace</th>
                <th>Template</th>
                <th>SLA</th>
                <th>Labor SLA Penalty</th>
                <th>Guarantee</th>
                <th>Status</th>
                <th>Agreement</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {agencyAgreements.map((item) => (
                <tr key={item.id}>
                  <td>{item.agreement_no || "-"}</td>
                  <td>{currentUser?.company_name || item.company_name || "Current Client"}</td>
                  <td>{item.template_type || "Standard"}</td>
                  <td>{item.sla_days || 60} days</td>
                  <td>{item.delay_penalty_type || "-"} / {item.delay_penalty_amount || 0}</td>
                  <td>{item.financial_guarantee_required || "No"}{item.financial_guarantee_amount ? ` / ${Number(item.financial_guarantee_amount).toLocaleString()} SAR` : ""}</td>
                  <td><Badge value={item.status || "Draft"} /></td>
                  <td>
                    <details>
                      <summary>View</summary>
                      <pre style={{ whiteSpace: "pre-wrap", maxWidth: 520, maxHeight: 260, overflow: "auto" }}>{item.terms || "No agreement terms"}</pre>
                    </details>
                  </td>
                  <td className="table-actions">
                    {item.status === "Pending Signature" ? (
                      <button className="save-btn" onClick={() => acceptAgreementByAgency(item)}>Accept & Sign</button>
                    ) : item.status === "Active" ? (
                      <span>Accepted</span>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TableCard>
    )}

    {canManageOfficePortal && (
      <div className="actions-line" style={{ margin: "0 0 14px" }}>
        <button className="new-btn" onClick={downloadCandidateUploadTemplate}>Download Candidate Template</button>
        <button className="new-btn" onClick={startExcelUploadFromCandidates}>Upload Candidate Excel</button>
        <span className="badge" title="AI results are company-only">AI results are hidden from agency users</span>
      </div>
    )}

    {canManageOfficePortal && (
    <FormCard title={candidateEditingId ? "Edit Office Candidate" : "Add Office Candidate"}>
      <div className="form-grid">
        <Input placeholder="Candidate Name" value={candidateForm.candidate_name} onChange={(v) => updateForm(setCandidateForm, "candidate_name", v)} />
<Select
  value={candidateForm.profession}
  onChange={(v) => updateForm(setCandidateForm, "profession", v)}
  placeholder="Profession"
  searchable
  options={professions.map((p) =>
    p.name_en
      ? `${p.name_ar} - ${p.name_en}`
      : p.name_ar
  )}
/>
<Select
value={candidateForm.nationality}
onChange={(v) => updateForm(setCandidateForm, "nationality", v)}
placeholder="Nationality"
options={countries.map((c) => c.nationality || c.name)}
/>
        <Input placeholder="Gender" value={candidateForm.gender} onChange={(v) => updateForm(setCandidateForm, "gender", v)} />
        
        <Select
  value={candidateForm.agency}
  onChange={(v) => updateForm(setCandidateForm, "agency", v)}
  placeholder="Search Agency / Office..."
  searchable
  options={agencies.map((a) => a.name)}
/>
        <Input placeholder="Project" value={candidateForm.project} onChange={(v) => updateForm(setCandidateForm, "project", v)} />
        <Input placeholder="Request No" value={candidateForm.request_no} onChange={(v) => updateForm(setCandidateForm, "request_no", v)} />
        <Input placeholder="Passport No" value={candidateForm.passport_no} onChange={(v) => updateForm(setCandidateForm, "passport_no", v)} />
        <Input placeholder="Mobile" value={candidateForm.mobile} onChange={(v) => updateForm(setCandidateForm, "mobile", v)} />
        <Input      
  placeholder="Email"
  value={candidateForm.email}
  onChange={(v) => updateForm(setCandidateForm, "email", v)}
/>

        
          
 <Select
  value={candidateForm.status}
  onChange={(v) => updateForm(setCandidateForm, "status", v)}
  placeholder="Recruitment Stage"
  options={OFFICE_STATUSES}
/>
<Select
value={candidateForm.medical_status}
onChange={(v) => updateForm(setCandidateForm, "medical_status", v)}
placeholder="Medical Status"
options={[
  "Pending",
  "Passed",
  "Failed"
]}
/>

<Input
placeholder="Medical Date"
type="date"
value={candidateForm.medical_date}
onChange={(v) => updateForm(setCandidateForm, "medical_date", v)}
/>
<Input
  placeholder="Ticket No"
  value={candidateForm.ticket_no}
  onChange={(v) => updateForm(setCandidateForm, "ticket_no", v)}
/>

<Input
  placeholder="Flight Date"
  type="date"
  value={candidateForm.flight_date}
  onChange={(v) => updateForm(setCandidateForm, "flight_date", v)}
/>

<Input
  placeholder="Arrival Date"
  type="date"
  value={candidateForm.arrival_date}
  onChange={(v) => updateForm(setCandidateForm, "arrival_date", v)}
/>
      </div>

      <textarea
        rows="3"
        placeholder="Office Remarks / Updates"
        value={candidateForm.notes}
        onChange={(e) => updateForm(setCandidateForm, "notes", e.target.value)}
      />

      <div className="actions-line">
        <button className="save-btn" onClick={saveCandidate}>
          {candidateEditingId ? "Update Candidate" : "Save Candidate"}
        </button>
        <button className="light-btn" onClick={resetCandidateForm}>Clear</button>
      </div>
    </FormCard>
    )}

    {canManageOfficePortal && (
      <FormCard title={`Bulk Candidate Update (${officeSelectedCandidateIds.length} selected)`}>
        <p style={{ marginTop: 0, color: "#64748b", fontSize: "13px" }}>
          Select candidates from the table, then apply one update to all selected candidates. Blank fields will not overwrite existing data.
        </p>
        <div className="form-grid">
          <Select
            value={officeBulkForm.status}
            onChange={(v) => updateForm(setOfficeBulkForm, "status", v)}
            placeholder="Bulk Stage / Status"
            options={["", ...OFFICE_STATUSES]}
          />
          <Select
            value={officeBulkForm.medical_status}
            onChange={(v) => updateForm(setOfficeBulkForm, "medical_status", v)}
            placeholder="Bulk Medical Status"
            options={["", "Pending", "Passed", "Failed"]}
          />
          <Input
            placeholder="Bulk Medical Date"
            type="date"
            value={officeBulkForm.medical_date}
            onChange={(v) => updateForm(setOfficeBulkForm, "medical_date", v)}
          />
          <Input
            placeholder="Bulk Ticket No / Reference"
            value={officeBulkForm.ticket_no}
            onChange={(v) => updateForm(setOfficeBulkForm, "ticket_no", v)}
          />
          <Input
            placeholder="Bulk Flight Date"
            type="date"
            value={officeBulkForm.flight_date}
            onChange={(v) => updateForm(setOfficeBulkForm, "flight_date", v)}
          />
          <Input
            placeholder="Bulk Arrival Date"
            type="date"
            value={officeBulkForm.arrival_date}
            onChange={(v) => updateForm(setOfficeBulkForm, "arrival_date", v)}
          />
        </div>

        <textarea
          rows="3"
          placeholder="Bulk Remarks / Update Note"
          value={officeBulkForm.notes}
          onChange={(e) => updateForm(setOfficeBulkForm, "notes", e.target.value)}
        />

        <div className="actions-line">
          <button
            className="save-btn"
            onClick={bulkUpdateOfficeCandidates}
            disabled={officeBulkLoading || officeSelectedCandidateIds.length === 0}
          >
            {officeBulkLoading ? "Updating..." : `Apply Bulk Update (${officeSelectedCandidateIds.length})`}
          </button>
          <button className="light-btn" onClick={resetOfficeBulkForm}>Clear Bulk Fields</button>
          <button className="light-btn" onClick={() => setOfficeSelectedCandidateIds([])}>Clear Selection</button>
        </div>
      </FormCard>
    )}

    <TableCard title="Office Candidates Tracking - Select Multiple for Bulk Update">
      <table>
        <thead>
          <tr>
            {canManageOfficePortal && (
              <th>
                <input
                  type="checkbox"
                  checked={getOfficeVisibleCandidates().length > 0 && getOfficeVisibleCandidates().every((item) => officeSelectedCandidateIds.includes(String(item.id)))}
                  onChange={toggleAllOfficeCandidates}
                  title="Select all visible candidates"
                />
              </th>
            )}
            <th>Request No</th>
            <th>Name</th>
            <th>Passport</th>
            <th>Profession</th>
            <th>Nationality</th>
            <th>Office</th>
            <th>Stage</th>
            <th>Mobile</th>
            <th>Remarks</th>
            <th>Timeline</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {getOfficeVisibleCandidates()
  .map((item) => (
            <tr key={item.id}>
              {canManageOfficePortal && (
                <td>
                  <input
                    type="checkbox"
                    checked={officeSelectedCandidateIds.includes(String(item.id))}
                    onChange={() => toggleOfficeCandidateSelection(item.id)}
                  />
                </td>
              )}
              <td>{item.request_no || "-"}</td>
              <td>{item.candidate_name || "-"}</td>
              <td>{item.passport_no || "-"}</td>
              <td>{item.profession || "-"}</td>
              <td>{item.nationality || "-"}</td>
              <td>{item.agency || "-"}</td>
              <td><Badge value={item.status} /></td>
              <td>{item.mobile || "-"}</td>
              <td>{item.notes || "-"}</td>
              <td>
  {(() => {
    let history = [];

    try {
      history = item.status_history ? JSON.parse(item.status_history) : [];
    } catch {
      history = [];
    }

    return history.length ? (
  <div className="timeline-box">
    {history.map((h, index) => (
      <div className="timeline-item" key={index}>
        <div className="timeline-dot">✓</div>
        <div>
          <div className="timeline-stage">{h.stage}</div>
          <div className="timeline-date">
            {new Date(h.date).toLocaleDateString("en-GB")}
          </div>
        </div>
      </div>
    ))}
  </div>
) : (
  "-"
);
  })()}
</td>
              <td className="table-actions">
  {canManageOfficePortal ? (
    <button onClick={() => editCandidate(item)}>
      Edit
    </button>
  ) : (
    "-"
  )}
</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  </>
)}



{activePage === "Workforce Marketplace" && (
  <>
    <div className="dashboard-grid">
      <Stat title="Available Workforce" value={marketplaceIntelligence.availableWorkforce} className="passed" />
      <Stat title="Open Client Requests" value={marketplaceIntelligence.openClientRequests} className="warning" />
      <Stat title="AI Matched Qty" value={marketplaceIntelligence.potentialMatches} className="passed" />
      <Stat title="Potential Revenue" value={`${Number(marketplaceIntelligence.potentialRevenue || 0).toLocaleString()} SAR`} className="passed" />
      <Stat title="Active Deals" value={marketplaceIntelligence.activeDeals} />
      <Stat title="Outstanding" value={`${Number(marketplaceIntelligence.outstanding || 0).toLocaleString()} SAR`} className="warning" />
    </div>

    {canManageMarketplace && (
      <FormCard title={marketplaceRequestEditingId ? "Edit Client Workforce Request" : "New Client Workforce Request"}>
        <div className="form-grid">
          <Input placeholder="Request No (Auto)" value={marketplaceRequestForm.request_no} onChange={(v) => updateForm(setMarketplaceRequestForm, "request_no", v)} />
          <Input placeholder="Client / Company Name" value={marketplaceRequestForm.client_name} onChange={(v) => updateForm(setMarketplaceRequestForm, "client_name", v)} />
          <Select
            value={marketplaceRequestForm.profession}
            onChange={(v) => updateForm(setMarketplaceRequestForm, "profession", v)}
            placeholder="Profession"
            searchable
            options={professions.map((p) => p.name_en ? `${p.name_ar} - ${p.name_en}` : p.name_ar)}
          />
          <Select
            value={marketplaceRequestForm.nationality}
            onChange={(v) => updateForm(setMarketplaceRequestForm, "nationality", v)}
            placeholder="Nationality"
            searchable
            options={countries.map((c) => c.nationality ? `${c.nationality} (${c.name})` : c.name)}
          />
          <Select value={marketplaceRequestForm.gender} onChange={(v) => updateForm(setMarketplaceRequestForm, "gender", v)} placeholder="Gender" options={["", ...GENDERS]} />
          <Input type="number" placeholder="Quantity" value={marketplaceRequestForm.quantity} onChange={(v) => updateForm(setMarketplaceRequestForm, "quantity", v)} />
          <Input type="number" placeholder="Duration Months" value={marketplaceRequestForm.duration_months} onChange={(v) => updateForm(setMarketplaceRequestForm, "duration_months", v)} />
          <Input type="number" placeholder="Monthly Rate / Employee" value={marketplaceRequestForm.monthly_rate} onChange={(v) => updateForm(setMarketplaceRequestForm, "monthly_rate", v)} />
          <Select value={marketplaceRequestForm.status} onChange={(v) => updateForm(setMarketplaceRequestForm, "status", v)} placeholder="Status" options={["Open", "Under Review", "Converted", "Closed", "Cancelled"]} />
        </div>
        <textarea rows="3" placeholder="Notes" value={marketplaceRequestForm.notes} onChange={(e) => updateForm(setMarketplaceRequestForm, "notes", e.target.value)} />
        <div className="actions-line">
          <button className="save-btn" onClick={saveMarketplaceRequest}>{marketplaceRequestEditingId ? "Update Request" : "Save Request"}</button>
          <button className="light-btn" onClick={resetMarketplaceRequestForm}>Clear</button>
        </div>
      </FormCard>
    )}

    <TableCard title="AI Available Workforce from Demobilization">
      <table>
        <thead>
          <tr>
            <th>Employee</th>
            <th>Profession</th>
            <th>Nationality</th>
            <th>Gender</th>
            <th>Current Project</th>
            <th>Status</th>
            <th>AI Note</th>
          </tr>
        </thead>
        <tbody>
          {demobilizations.filter((item) => ["Available", "Suggested"].includes(item.status || "Available")).length === 0 ? (
            <tr><td colSpan="7">No available demobilized workforce yet</td></tr>
          ) : (
            demobilizations
              .filter((item) => ["Available", "Suggested"].includes(item.status || "Available"))
              .slice(0, 30)
              .map((item) => (
                <tr key={item.id}>
                  <td>{item.employee_name || "-"}</td>
                  <td>{item.profession || "-"}</td>
                  <td>{item.nationality || "-"}</td>
                  <td>{item.gender || "-"}</td>
                  <td>{item.current_project || "-"}</td>
                  <td><Badge value={item.status || "Available"} /></td>
                  <td>{item.ai_recommendation || "Available for internal redeployment or marketplace deal."}</td>
                </tr>
              ))
          )}
        </tbody>
      </table>
    </TableCard>

    <TableCard title="Client Workforce Requests & AI Matching">
      <table>
        <thead>
          <tr>
            <th>Request No</th>
            <th>Client</th>
            <th>Profession</th>
            <th>Nationality</th>
            <th>Qty</th>
            <th>Matched</th>
            <th>Potential Revenue</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {marketplaceRequests.length === 0 ? (
            <tr><td colSpan="9">No marketplace client requests yet</td></tr>
          ) : (
            marketplaceRequests.map((item) => {
              const matches = getMarketplaceMatches(item);
              const matchedQty = Math.min(Number(item.quantity || 0), matches.total);
              const revenue = matchedQty * Number(item.monthly_rate || 0) * Number(item.duration_months || 1);
              return (
                <tr key={item.id}>
                  <td>{item.request_no || "-"}</td>
                  <td>{item.client_name || "-"}</td>
                  <td>{item.profession || "-"}</td>
                  <td>{item.nationality || "-"}</td>
                  <td>{item.quantity || 0}</td>
                  <td><Badge value={`${matchedQty} / ${item.quantity || 0}`} /></td>
                  <td>{Number(revenue || 0).toLocaleString()} SAR</td>
                  <td><Badge value={item.status || "Open"} /></td>
                  <td className="table-actions">
                    {canManageMarketplace && <button onClick={() => editMarketplaceRequest(item)}>Edit</button>}
                    {canManageMarketplace && <button onClick={() => createMarketplaceDeal(item)}>Create Deal</button>}
                    {canManageMarketplace && <button className="danger" onClick={() => deleteMarketplaceRequest(item.id)}>Delete</button>}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </TableCard>

    <TableCard title="Marketplace Deals">
      <table>
        <thead>
          <tr>
            <th>Deal No</th>
            <th>Client</th>
            <th>Service</th>
            <th>Profession</th>
            <th>Qty</th>
            <th>Duration</th>
            <th>Monthly Rate</th>
            <th>Total Value</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {marketplaceDeals.length === 0 ? (
            <tr><td colSpan="10">No marketplace deals yet</td></tr>
          ) : (
            marketplaceDeals.map((deal) => (
              <tr key={deal.id}>
                <td>{deal.deal_no || "-"}</td>
                <td>{deal.client_name || "-"}</td>
                <td>{deal.service_type || "-"}</td>
                <td>{deal.profession || "-"}</td>
                <td>{deal.quantity || 0}</td>
                <td>{deal.duration_months || 0} months</td>
                <td>{Number(deal.monthly_rate || 0).toLocaleString()} SAR</td>
                <td><b>{Number(deal.total_value || 0).toLocaleString()} SAR</b></td>
                <td><Badge value={deal.status || "Draft"} /></td>
                <td className="table-actions">
                  {canManageMarketplace && <button onClick={() => generateInvoiceFromDeal(deal)}>Generate Invoice</button>}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </TableCard>

    <TableCard title="Invoices & Collections">
      <table>
        <thead>
          <tr>
            <th>Invoice No</th>
            <th>Client</th>
            <th>Service</th>
            <th>Total</th>
            <th>Paid</th>
            <th>Balance</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {marketplaceInvoices.length === 0 ? (
            <tr><td colSpan="8">No invoices yet</td></tr>
          ) : (
            marketplaceInvoices.map((invoice) => (
              <tr key={invoice.id}>
                <td>{invoice.invoice_no || "-"}</td>
                <td>{invoice.client_name || "-"}</td>
                <td>{invoice.service_type || "-"}</td>
                <td>{Number(invoice.total_amount || 0).toLocaleString()} SAR</td>
                <td>{Number(invoice.paid_amount || 0).toLocaleString()} SAR</td>
                <td><b>{Number(invoice.balance_amount || 0).toLocaleString()} SAR</b></td>
                <td><Badge value={invoice.status || "Draft"} /></td>
                <td className="table-actions">
                  {canManageMarketplace && <button onClick={() => recordMarketplaceCollection(invoice)}>Record Collection</button>}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </TableCard>
  </>
)}

{activePage === "Agency Performance" && (
  <>
    <div className="dashboard-grid">
      <Stat title="Agencies Evaluated" value={calculateAgencyPerformanceRows().length} />
      <Stat title="Platinum" value={calculateAgencyPerformanceRows().filter((x) => x.rank === "Platinum").length} className="passed" />
      <Stat title="Gold" value={calculateAgencyPerformanceRows().filter((x) => x.rank === "Gold").length} className="passed" />
      <Stat title="Silver" value={calculateAgencyPerformanceRows().filter((x) => x.rank === "Silver").length} className="warning" />
      <Stat title="Under Review" value={calculateAgencyPerformanceRows().filter((x) => x.rank === "Under Review").length} className="danger" />
      <Stat title="SLA Alerts" value={getAgencySlaEscalationAlerts().length} className={getAgencySlaEscalationAlerts().length ? "danger" : "passed"} />
      <Stat title="Delayed by Agreement" value={calculateAgencyPerformanceRows().reduce((sum, x) => sum + Number(x.delayed_candidates || 0), 0)} className={calculateAgencyPerformanceRows().some((x) => Number(x.delayed_candidates || 0) > 0) ? "danger" : "passed"} />
      <Stat title="SLA Penalty Exposure" value={`${Number(calculateAgencyPerformanceRows().reduce((sum, x) => sum + Number(x.penalty_exposure || 0), 0)).toLocaleString()} SAR`} className={calculateAgencyPerformanceRows().some((x) => Number(x.penalty_exposure || 0) > 0) ? "warning" : "passed"} />
    </div>

    <TableCard title="Update Compliance Alerts (KPI Only)">
      <div className="actions-line" style={{ marginBottom: "14px" }}>
        {canManageAgencyAgreements && <button className="save-btn" onClick={generateSlaEscalationNotifications}>Generate Update Alerts</button>}
        <button className="light-btn" onClick={loadAll}>Refresh Data</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Risk</th>
            <th>Agency</th>
            <th>Candidate</th>
            <th>Request No</th>
            <th>Project</th>
            <th>Status</th>
            <th>Agreement</th>
            <th>Update Frequency</th>
            <th>Days Without Update</th>
            <th>KPI Deduction</th>
            <th>Recommendation</th>
          </tr>
        </thead>
        <tbody>
          {getAgencySlaEscalationAlerts().length === 0 ? (
            <tr><td colSpan="11">No update compliance alerts. Update frequency affects KPI only, not financial penalties.</td></tr>
          ) : (
            getAgencySlaEscalationAlerts().slice(0, 50).map((item) => (
              <tr key={`${item.candidate_id}-${item.days_without_update}`}>
                <td><Badge value={item.risk} /></td>
                <td>{item.agency}</td>
                <td>{item.candidate_name}</td>
                <td>{item.request_no}</td>
                <td>{item.project}</td>
                <td><Badge value={item.status} /></td>
                <td>{item.agreement_no || "Default Policy"}</td>
                <td>{item.update_frequency_days || 7} days</td>
                <td><b>{item.days_without_update}</b></td>
                <td>{item.kpi_deduction} pts</td>
                <td>{item.recommendation}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </TableCard>

    <TableCard title="Agency Performance Engine">
      <div className="actions-line" style={{ marginBottom: "14px" }}>
        {canManageAgencyAgreements && <button className="save-btn" onClick={saveAgencyPerformanceSnapshot}>Calculate & Save Score</button>}
        <button className="light-btn" onClick={loadAll}>Refresh Data</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Agency</th>
            <th>Agreement SLA</th>
            <th>Update Frequency</th>
            <th>Delayed</th>
            <th>Avg Delay</th>
            <th>SLA Penalty Exposure</th>
            <th>SLA 30%</th>
            <th>Response 10%</th>
            <th>Quality 20%</th>
            <th>Rejection 10%</th>
            <th>Mobilization 15%</th>
            <th>Update 10%</th>
            <th>Stale Updates</th>
            <th>Update KPI Deduction</th>
            <th>Agreement 5%</th>
            <th>Total</th>
            <th>Class</th>
          </tr>
        </thead>
        <tbody>
          {calculateAgencyPerformanceRows().length === 0 ? (
            <tr><td colSpan="18">No agency performance data yet</td></tr>
          ) : (
            calculateAgencyPerformanceRows().map((item, index) => (
              <tr key={item.agency_name}>
                <td>{index + 1}</td>
                <td>{item.agency_name}</td>
                <td>{item.agreement_sla_days || 60} days</td>
                <td>{item.update_frequency_days || 7} days</td>
                <td>{item.delayed_candidates || 0}</td>
                <td>{item.average_delay_days || 0}</td>
                <td>{Number(item.penalty_exposure || 0).toLocaleString()} SAR</td>
                <td>{item.sla_score}%</td>
                <td>{item.response_score}%</td>
                <td>{item.quality_score}%</td>
                <td>{item.rejection_score}%</td>
                <td>{item.mobilization_score}%</td>
                <td>{item.update_score}%</td>
                <td>{item.stale_candidates || 0}</td>
                <td>{item.stale_penalty || 0} pts</td>
                <td>{item.agreement_score}%</td>
                <td><b>{item.total_score}%</b></td>
                <td><Badge value={item.rank} /></td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </TableCard>

    <TableCard title="AI Recommendations for Agencies">
      <table>
        <thead>
          <tr>
            <th>Agency</th>
            <th>Agreement SLA</th>
            <th>Delayed</th>
            <th>SLA Penalty Exposure</th>
            <th>Total Score</th>
            <th>Class</th>
            <th>Recommendation</th>
          </tr>
        </thead>
        <tbody>
          {calculateAgencyPerformanceRows().length === 0 ? (
            <tr><td colSpan="7">No recommendations yet</td></tr>
          ) : (
            calculateAgencyPerformanceRows().map((item) => (
              <tr key={item.agency_name}>
                <td>{item.agency_name}</td>
                <td>{item.agreement_sla_days || 60} days</td>
                <td>{item.delayed_candidates || 0}</td>
                <td>{Number(item.penalty_exposure || 0).toLocaleString()} SAR</td>
                <td><b>{item.total_score}%</b></td>
                <td><Badge value={item.rank} /></td>
                <td>{item.recommendation}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </TableCard>

    <TableCard title="Saved Score History">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Agency ID</th>
            <th>Agreement SLA</th>
            <th>Delayed</th>
            <th>SLA Penalty</th>
            <th>SLA</th>
            <th>Quality</th>
            <th>Response</th>
            <th>Mobilization</th>
            <th>Update</th>
            <th>Agreement</th>
            <th>Total</th>
            <th>Rank</th>
          </tr>
        </thead>
        <tbody>
          {agencyScoreHistory.length === 0 ? (
            <tr><td colSpan="13">No saved score history yet</td></tr>
          ) : (
            agencyScoreHistory
              .slice()
              .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
              .slice(0, 50)
              .map((item) => (
                <tr key={item.id}>
                  <td>{item.created_at ? new Date(item.created_at).toLocaleDateString("en-GB") : "-"}</td>
                  <td>{item.agency_id}</td>
                  <td>{item.agreement_sla_days || "-"}</td>
                  <td>{item.delayed_candidates || 0}</td>
                  <td>{Number(item.penalty_exposure || 0).toLocaleString()} SAR</td>
                  <td>{item.sla_score || 0}%</td>
                  <td>{item.quality_score || 0}%</td>
                  <td>{item.response_score || 0}%</td>
                  <td>{item.mobilization_score || 0}%</td>
                  <td>{item.update_score || 0}%</td>
                  <td>{item.agreement_score || 0}%</td>
                  <td><b>{item.total_score || 0}%</b></td>
                  <td><Badge value={item.rank || "-"} /></td>
                </tr>
              ))
          )}
        </tbody>
      </table>
    </TableCard>
  </>
)}

{activePage === "Agency Agreements" && (
  <>
    <div className="dashboard-grid">
      <Stat title="Total Agreements" value={agencyAgreements.length} />
      <Stat title="Active Agreements" value={agencyAgreements.filter((x) => x.status === "Active").length} className="passed" />
      <Stat title="Pending Agency Signature" value={agencyAgreements.filter((x) => x.status === "Pending Signature").length} className="warning" />
      <Stat title="Financial Guarantees" value={agencyAgreements.filter((x) => x.financial_guarantee_required === "Yes").length} className="warning" />
      <Stat title="Avg SLA Days" value={agencyAgreements.length ? Math.round(agencyAgreements.reduce((sum, x) => sum + Number(x.sla_days || 0), 0) / agencyAgreements.length) : 60} />
    </div>

    {canManageAgencyAgreements && (
      <FormCard title={agreementEditingId ? "Edit Agency Agreement Policy" : "Create Agency Agreement Policy"}>
        <div className="form-grid">
          <Input placeholder="Agreement No (Auto-generated)" value={agreementEditingId ? agreementForm.agreement_no : (agreementForm.agreement_no || "Auto-generated on save")} readOnly onChange={() => {}} />
          <Select placeholder="Agency" value={agreementForm.agency_name} onChange={(v) => updateForm(setAgreementForm, "agency_name", v)} options={agencies.map((a) => a.name).filter(Boolean)} />
          <Select placeholder="Operational Template (does not set penalty or guarantee)" value={agreementForm.template_type} onChange={applyAgreementTemplate} options={AGREEMENT_TEMPLATE_TYPES} />
          <Input placeholder="Policy Name" value={agreementForm.policy_name} onChange={(v) => updateForm(setAgreementForm, "policy_name", v)} />
          <Input type="date" placeholder="Effective Date" value={agreementForm.effective_date} onChange={(v) => updateForm(setAgreementForm, "effective_date", v)} />
          <Input type="date" placeholder="Expiry Date" value={agreementForm.expiry_date} onChange={(v) => updateForm(setAgreementForm, "expiry_date", v)} />
          <Select placeholder="Status" value={agreementForm.status} onChange={(v) => updateForm(setAgreementForm, "status", v)} options={AGREEMENT_STATUSES} />
          <Input placeholder="Company Signatory Name" value={agreementForm.signed_by_company} onChange={(v) => updateForm(setAgreementForm, "signed_by_company", v)} />
        </div>

        <div className="card" style={{ marginTop: "12px" }}>
          <h3 style={{ marginBottom: "6px" }}>Company-Defined Financial Penalty - Labor SLA Delay Only</h3>
          <p style={{ marginBottom: "12px", color: "#64748b" }}>The template fills operational SLA/KPI fields only. The company manually defines the penalty value, grace period and guarantee. Updates, response speed and quality affect KPI only.</p>
          <div className="form-grid">
            <Input type="number" placeholder="Labor SLA Days" value={agreementForm.sla_days} onChange={(v) => updateForm(setAgreementForm, "sla_days", v)} />
            <Select placeholder="Labor SLA Penalty Type" value={agreementForm.delay_penalty_type} onChange={(v) => updateForm(setAgreementForm, "delay_penalty_type", v)} options={["Fixed Amount Per Delayed Day", "Warning Only"]} />
            <Input type="number" placeholder="Company Penalty Value Per Delayed Day SAR" value={agreementForm.delay_penalty_amount} onChange={(v) => updateForm(setAgreementForm, "delay_penalty_amount", v)} />
            <Input type="number" placeholder="Company Grace Period Before Penalty Days" value={agreementForm.delay_penalty_after_days} onChange={(v) => updateForm(setAgreementForm, "delay_penalty_after_days", v)} />
          </div>
        </div>

        <div className="card" style={{ marginTop: "12px" }}>
          <h3 style={{ marginBottom: "6px" }}>Performance KPI Rules - No Financial Penalty</h3>
          <p style={{ marginBottom: "12px", color: "#64748b" }}>These rules affect agency score, ranking, reports and future allocation decisions.</p>
          <div className="form-grid">
            <Input type="number" placeholder="Response Target Hours" value={agreementForm.response_sla_hours} onChange={(v) => updateForm(setAgreementForm, "response_sla_hours", v)} />
            <Input type="number" placeholder="Case Update Frequency Days" value={agreementForm.update_frequency_days} onChange={(v) => updateForm(setAgreementForm, "update_frequency_days", v)} />
            <Input type="number" placeholder="Replacement Guarantee Days" value={agreementForm.replacement_guarantee_days} onChange={(v) => updateForm(setAgreementForm, "replacement_guarantee_days", v)} />
          </div>
        </div>

        <div className="card" style={{ marginTop: "12px" }}>
          <h3 style={{ marginBottom: "6px" }}>Company-Defined Financial Guarantee</h3>
          <p style={{ marginBottom: "12px", color: "#64748b" }}>Financial guarantee is not controlled by the template. The company decides whether it is required and the amount.</p>
          <div className="form-grid">
            <Select placeholder="Financial Guarantee Required" value={agreementForm.financial_guarantee_required} onChange={(v) => updateForm(setAgreementForm, "financial_guarantee_required", v)} options={["No", "Yes", "Optional"]} />
            <Input type="number" placeholder="Financial Guarantee Amount SAR" value={agreementForm.financial_guarantee_amount} onChange={(v) => updateForm(setAgreementForm, "financial_guarantee_amount", v)} />
          </div>
        </div>

        <label>Payment Terms</label>
        <textarea rows="2" value={agreementForm.payment_terms} onChange={(e) => updateForm(setAgreementForm, "payment_terms", e.target.value)} />

        <label>Cancellation / Suspension Terms</label>
        <textarea rows="2" value={agreementForm.cancellation_terms} onChange={(e) => updateForm(setAgreementForm, "cancellation_terms", e.target.value)} />

        <div className="actions-line">
          <button className="light-btn" type="button" onClick={refreshAgreementTerms}>Build Terms From Policy</button>
        </div>

        <label>Agreement Terms / SLA Commitment</label>
        <textarea rows="13" dir="auto" value={agreementForm.terms} onChange={(e) => updateForm(setAgreementForm, "terms", e.target.value)} />

        <div className="form-grid">
          <Input placeholder="Company Signature" value={agreementForm.company_signature} onChange={(v) => updateForm(setAgreementForm, "company_signature", v)} />
          <Input placeholder="Agency Signature" value={agreementForm.agency_signature} onChange={(v) => updateForm(setAgreementForm, "agency_signature", v)} />
        </div>

        <div className="actions-line">
          <button className="light-btn" onClick={() => saveAgreement("Draft")}>Save Draft</button>
          <button className="save-btn" onClick={() => saveAgreement("Pending Signature")}>Send to Agency Portal</button>
          <button className="light-btn" onClick={resetAgreementForm}>Clear</button>
        </div>
      </FormCard>
    )}

    <TableCard title="Agency Agreements List">
      <table>
        <thead>
          <tr>
            <th>Agreement No</th>
            <th>Agency</th>
            <th>Template</th>
            <th>SLA</th>
            <th>Labor SLA Penalty</th>
            <th>Guarantee</th>
            <th>Status</th>
            <th>Agency Accepted</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {agencyAgreements.length === 0 ? (
            <tr><td colSpan="9">No agency agreements yet</td></tr>
          ) : (
            agencyAgreements.map((item) => (
              <tr key={item.id}>
                <td>{item.agreement_no || "-"}</td>
                <td>{item.agency_name || "-"}</td>
                <td>{item.template_type || "Standard"}</td>
                <td>{item.sla_days || 60} days</td>
                <td>{item.delay_penalty_type || "-"} / {item.delay_penalty_amount || 0}</td>
                <td>{item.financial_guarantee_required || "No"}{item.financial_guarantee_amount ? ` / ${Number(item.financial_guarantee_amount).toLocaleString()} SAR` : ""}</td>
                <td><Badge value={item.status || "Draft"} /></td>
                <td>{item.agency_accepted_at ? new Date(item.agency_accepted_at).toLocaleDateString("en-GB") : item.agency_signature || "-"}</td>
                <td className="table-actions">
                  {canManageAgencyAgreements && <button onClick={() => editAgreement(item)}>Edit</button>}
                  {canManageAgencyAgreements && item.status !== "Pending Signature" && item.status !== "Active" && <button onClick={() => sendExistingAgreementToAgency(item)}>Send</button>}
                  {canManageAgencyAgreements && <button className="danger" onClick={() => deleteAgreement(item.id)}>Delete</button>}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </TableCard>
  </>
)}


{activePage === "Penalty Register" && canApprovePenalties && (
  <>
    <div className="dashboard-grid">
      <Stat title="Calculated Penalties" value={getPenaltyRegisterDisplayRows().filter((x) => x.source === "live" || x.status === "Pending Review").length} className="warning" />
      <Stat title="Sent to Agency" value={agencyPenalties.filter((x) => x.status === "Sent to Agency").length} />
      <Stat title="Justifications" value={agencyPenalties.filter((x) => x.status === "Justification Submitted").length} className="warning" />
      <Stat title="Approved" value={`${Number(agencyPenalties.filter((x) => ["Approved", "Reduced"].includes(x.status)).reduce((sum, x) => sum + Number(x.approved_amount || 0), 0)).toLocaleString()} SAR`} className="danger" />
      <Stat title="Waived" value={`${Number(agencyPenalties.filter((x) => x.status === "Waived").reduce((sum, x) => sum + Number(x.calculated_amount || 0), 0)).toLocaleString()} SAR`} className="passed" />
    </div>

    <TableCard title="Labor SLA Delay Penalties / Approval Workflow">
      <div className="actions-line" style={{ marginBottom: "14px" }}>
        <button className="save-btn" onClick={generatePenaltyRegister}>Generate / Refresh Calculated Penalties</button>
        <button className="light-btn" onClick={loadAll}>Refresh Data</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Penalty No</th>
            <th>Agency</th>
            <th>Agreement</th>
            <th>Candidate</th>
            <th>Request No</th>
            <th>Project</th>
            <th>SLA</th>
            <th>Actual</th>
            <th>Delay</th>
            <th>Grace</th>
            <th>Penalty Days</th>
            <th>Calculated</th>
            <th>Approved / Required</th>
            <th>Status</th>
            <th>Agency Justification</th>
            <th>Decision Notes</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {getPenaltyRegisterDisplayRows().length === 0 ? (
            <tr><td colSpan="17">No labor SLA delay penalties calculated yet. Penalties are generated only for workers/candidates delayed beyond the agreed SLA.</td></tr>
          ) : (
            getPenaltyRegisterDisplayRows().map((item) => (
              <tr key={`${item.source}-${item.id || item.candidate_id}-${item.agreement_no}`}>
                <td>{item.penalty_no || "Auto"}</td>
                <td>{item.agency_name || "-"}</td>
                <td>{item.agreement_no || "-"}</td>
                <td>{item.candidate_name || "-"}</td>
                <td>{item.request_no || "-"}</td>
                <td>{item.project || "-"}</td>
                <td>{item.sla_days || 60} days</td>
                <td>{item.actual_days || 0} days</td>
                <td>{item.delay_days || 0} days</td>
                <td>{item.grace_days || 0} days</td>
                <td>{item.penalty_days || 0}</td>
                <td>{Number(item.calculated_amount || 0).toLocaleString()} SAR</td>
                <td><b>{Number(item.approved_amount ?? item.calculated_amount ?? 0).toLocaleString()} SAR</b></td>
                <td><Badge value={item.status || "Pending Review"} /></td>
                <td>{item.agency_justification || "-"}</td>
                <td>{item.decision_notes || "-"}</td>
                <td className="table-actions">
                  {item.source === "live" ? (
                    <span>Generate first</span>
                  ) : item.status === "Pending Review" ? (
                    <>
                      <button className="save-btn" onClick={() => sendPenaltyToAgency(item)}>Send to Agency</button>
                      <button onClick={() => reduceAndSendPenalty(item)}>Reduce & Send</button>
                      <button className="danger" onClick={() => waivePenalty(item)}>Waive</button>
                    </>
                  ) : item.status === "Sent to Agency" ? (
                    <>
                      <button className="save-btn" onClick={() => approveFinalPenalty(item, "No accepted justification received. Final penalty approved.")}>Approve Final</button>
                      <button onClick={() => reduceFinalPenalty(item)}>Reduce Final</button>
                      <button className="danger" onClick={() => waivePenalty(item)}>Waive</button>
                    </>
                  ) : item.status === "Justification Submitted" ? (
                    <>
                      <button className="save-btn" onClick={() => waivePenalty(item, "Agency justification accepted by company.")}>Accept Justification</button>
                      <button className="danger" onClick={() => approveFinalPenalty(item, "Agency justification rejected by company. Penalty approved.")}>Reject & Approve</button>
                      <button onClick={() => reduceFinalPenalty(item)}>Reduce Final</button>
                    </>
                  ) : ["Approved", "Reduced", "Waived"].includes(item.status) ? (
                    <span>Final</span>
                  ) : "-"}
                  {item.source !== "live" && <button className="danger" onClick={() => deletePenaltyRecord(item)}>Delete</button>}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </TableCard>
  </>
)}

{activePage === "Agency Ranking" && (
  <>
    <div className="dashboard-grid">
      <Stat title="Agencies in Live Scorecard" value={calculateAgencyPerformanceRows().length} />
      <Stat title="Excellent Agencies" value={calculateAgencyPerformanceRows().filter((x) => Number(x.total_score || 0) >= 90).length} className="passed" />
      <Stat title="Delayed by Agreement" value={calculateAgencyPerformanceRows().reduce((sum, x) => sum + Number(x.delayed_candidates || 0), 0)} className={calculateAgencyPerformanceRows().some((x) => Number(x.delayed_candidates || 0) > 0) ? "warning" : "passed"} />
      <Stat title="Signed Agreements" value={agencyAgreements.filter((x) => x.status === "Active").length} className="passed" />
    </div>

    <TableCard title="Live Agency Performance Scorecard">
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Agency</th>
            <th>Agreement SLA</th>
            <th>Delayed</th>
            <th>SLA Penalty Exposure</th>
            <th>Authorized Qty</th>
            <th>Candidates</th>
            <th>Submitted %</th>
            <th>Passed Interviews</th>
            <th>Arrived</th>
            <th>Joined</th>
            <th>Failed</th>
            <th>Score</th>
            <th>Risk</th>
          </tr>
        </thead>
        <tbody>
          {calculateAgencyPerformanceRows().length === 0 ? (
            <tr><td colSpan="14">No agency performance data</td></tr>
          ) : (
            calculateAgencyPerformanceRows().map((item, index) => (
              <tr key={item.agency_name}>
                <td>{index + 1}</td>
                <td>{item.agency_name}</td>
                <td>{item.agreement_sla_days || 60} days</td>
                <td>{item.delayed_candidates || 0}</td>
                <td>{Number(item.penalty_exposure || 0).toLocaleString()} SAR</td>
                <td>{item.authorizedQty}</td>
                <td>{item.candidates}</td>
                <td>{item.submittedPercent}%</td>
                <td>{item.passedInterviews}</td>
                <td>{item.arrived}</td>
                <td>{item.joined}</td>
                <td>{item.failed}</td>
                <td><b>{item.total_score}</b></td>
                <td><Badge value={item.rank} /></td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </TableCard>

    {agencyScores.length > 0 && (
      <TableCard title="Saved Agency Scores">
        <table>
          <thead>
            <tr>
              <th>Agency</th>
              <th>Agreement SLA</th>
              <th>Delayed</th>
              <th>SLA Penalty</th>
              <th>SLA</th>
              <th>Update</th>
              <th>Quality</th>
              <th>Arrival</th>
              <th>Total Score</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {[...agencyScores]
              .sort((a, b) => Number(b.total_score || 0) - Number(a.total_score || 0))
              .map((item) => (
                <tr key={item.id}>
                  <td>{item.agency_name}</td>
                  <td>{item.agreement_sla_days || "-"}</td>
                  <td>{item.delayed_candidates || 0}</td>
                  <td>{Number(item.penalty_exposure || 0).toLocaleString()} SAR</td>
                  <td>{item.sla_score || 0}%</td>
                  <td>{item.update_score || 0}%</td>
                  <td>{item.quality_score || 0}%</td>
                  <td>{item.arrival_score || 0}%</td>
                  <td><b>{item.total_score || 0}%</b></td>
                  <td>{item.updated_at ? new Date(item.updated_at).toLocaleDateString("en-GB") : "-"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </TableCard>
    )}
  </>
)}


{activePage === "Company Management" && canManageUsers && (
  <>
    <div className="dashboard-grid">
      <Stat title="Current Company" value={companies[0]?.name || "-"} />
      <Stat title="Subscription Plan" value={companies[0]?.subscription_plan || "Trial"} className="passed" />
      <Stat title="Subscription Status" value={companies[0]?.subscription_status || "Active"} className={(companies[0]?.subscription_status || "Active") === "Active" ? "passed" : "danger"} />
      <Stat title="Max Users" value={companies[0]?.max_users || 5} />
    </div>

    {companyEditingId && (
      <FormCard title="Edit Company & Subscription">
        <div className="form-grid">
          <Input placeholder="Company Name" value={companyForm.name || ""} onChange={(v) => setCompanyForm((p) => ({ ...p, name: v }))} />
          <Input placeholder="Domain" value={companyForm.domain || ""} onChange={(v) => setCompanyForm((p) => ({ ...p, domain: v }))} />
          <Select value={companyForm.status || "Active"} onChange={(v) => setCompanyForm((p) => ({ ...p, status: v }))} placeholder="Company Status" options={["Active", "Inactive", "Suspended"]} />
          <Select value={companyForm.subscription_plan || "Trial"} onChange={(v) => setCompanyForm((p) => ({ ...p, subscription_plan: v }))} placeholder="Subscription Plan" options={["Trial", "Basic", "Professional", "Enterprise"]} />
          <Select value={companyForm.subscription_status || "Active"} onChange={(v) => setCompanyForm((p) => ({ ...p, subscription_status: v }))} placeholder="Subscription Status" options={["Active", "Expired", "Suspended", "Cancelled"]} />
          <Input type="date" placeholder="Subscription Start" value={companyForm.subscription_start || ""} onChange={(v) => setCompanyForm((p) => ({ ...p, subscription_start: v }))} />
          <Input type="date" placeholder="Subscription End" value={companyForm.subscription_end || ""} onChange={(v) => setCompanyForm((p) => ({ ...p, subscription_end: v }))} />
          <Input type="number" placeholder="Max Users" value={companyForm.max_users || 5} onChange={(v) => setCompanyForm((p) => ({ ...p, max_users: v }))} />
        </div>
        <textarea rows="3" placeholder="Notes" value={companyForm.notes || ""} onChange={(e) => setCompanyForm((p) => ({ ...p, notes: e.target.value }))} />
        <div className="actions-line">
          <button className="save-btn" onClick={saveCompany}>Update Company</button>
          <button className="light-btn" onClick={cancelCompanyEdit}>Cancel</button>
        </div>
      </FormCard>
    )}

    <TableCard title="Company Management">
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>Domain</th>
            <th>Company Status</th>
            <th>Plan</th>
            <th>Subscription</th>
            <th>Start</th>
            <th>End</th>
            <th>Users</th>
            <th>Max Users</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {companies.length === 0 ? (
            <tr><td colSpan="10">No company data found</td></tr>
          ) : (
            companies.map((company) => {
              const companyUsers = users.filter((user) => String(user.company_id || "") === String(company.id || "")).length;
              return (
                <tr key={company.id}>
                  <td>{company.name || "-"}</td>
                  <td>{company.domain || "-"}</td>
                  <td><Badge value={company.status || "Active"} /></td>
                  <td><Badge value={company.subscription_plan || "Trial"} /></td>
                  <td><Badge value={company.subscription_status || "Active"} /></td>
                  <td>{company.subscription_start || "-"}</td>
                  <td>{company.subscription_end || "-"}</td>
                  <td>{companyUsers}</td>
                  <td>{company.max_users || 5}</td>
                  <td className="table-actions">
                    <button onClick={() => editCompany(company)}>Edit</button>
                    <button
                      className={(company.subscription_status || "Active") === "Active" ? "danger" : "save-btn"}
                      onClick={async () => {
                        const nextStatus = (company.subscription_status || "Active") === "Active" ? "Suspended" : "Active";
                        const { error } = await supabase
                          .from("companies")
                          .update({ subscription_status: nextStatus })
                          .eq("id", company.id)
                          .eq("id", currentCompanyId);
                        if (error) return alert(error.message);
                        await loadCompanies();
                      }}
                    >
                      {(company.subscription_status || "Active") === "Active" ? "Suspend" : "Activate"}
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </TableCard>
  </>
)}
{activePage === "Email Settings" && canManageUsers && (
  <>
    <div className="dashboard-grid">
      <Stat title="Email Mode" value={(companyEmailSettings?.mode || "platform") === "company" ? "Company Email" : "VisaFlow Default"} />
      <Stat title="Verified" value={companyEmailSettings?.is_verified ? "Yes" : "No"} className={companyEmailSettings?.is_verified ? "passed" : "warning"} />
      <Stat title="From Email" value={companyEmailSettings?.from_email || "admin@visaflowksa.com"} />
      <Stat title="Last Test" value={companyEmailSettings?.last_test_status || "Not Tested"} />
    </div>

    <FormCard title="Company Email Settings">
      <p className="muted-text">
        Choose whether this company sends operational emails using the VisaFlow default mailbox or its own SMTP email.
        Company SMTP settings are used only after a successful test. If not active or verified, VisaFlow falls back to the platform email.
      </p>

      <div className="form-grid">
        <Select
          placeholder="Email Sending Mode"
          value={emailSettingsForm.mode || "platform"}
          options={["platform", "company"]}
          onChange={(v) => setEmailSettingsForm((p) => ({ ...p, mode: v }))}
        />
        <Select
          placeholder="Provider"
          value={emailSettingsForm.provider || "SMTP"}
          options={["SMTP", "Namecheap Private Email", "Google Workspace", "Microsoft 365", "Zoho Mail", "Other"]}
          onChange={(v) => setEmailSettingsForm((p) => ({ ...p, provider: v }))}
        />
        <Input placeholder="From Name" value={emailSettingsForm.from_name || ""} onChange={(v) => setEmailSettingsForm((p) => ({ ...p, from_name: v }))} />
        <Input placeholder="From Email" value={emailSettingsForm.from_email || ""} onChange={(v) => setEmailSettingsForm((p) => ({ ...p, from_email: v }))} />
        <Input placeholder="Reply-To Email" value={emailSettingsForm.reply_to || ""} onChange={(v) => setEmailSettingsForm((p) => ({ ...p, reply_to: v }))} />
        <Input placeholder="Support Email" value={emailSettingsForm.support_email || ""} onChange={(v) => setEmailSettingsForm((p) => ({ ...p, support_email: v }))} />
        <Input placeholder="Agreements Email" value={emailSettingsForm.agreements_email || ""} onChange={(v) => setEmailSettingsForm((p) => ({ ...p, agreements_email: v }))} />
        <Input placeholder="Notifications Email" value={emailSettingsForm.notifications_email || ""} onChange={(v) => setEmailSettingsForm((p) => ({ ...p, notifications_email: v }))} />
      </div>

      <div className="section-title">SMTP Configuration</div>
      <div className="form-grid">
        <Input placeholder="SMTP Host" value={emailSettingsForm.smtp_host || ""} onChange={(v) => setEmailSettingsForm((p) => ({ ...p, smtp_host: v }))} />
        <Input type="number" placeholder="SMTP Port" value={emailSettingsForm.smtp_port || "465"} onChange={(v) => setEmailSettingsForm((p) => ({ ...p, smtp_port: v }))} />
        <Select placeholder="Secure Connection" value={String(emailSettingsForm.smtp_secure ?? "true")} options={["true", "false"]} onChange={(v) => setEmailSettingsForm((p) => ({ ...p, smtp_secure: v }))} />
        <Input placeholder="SMTP Username" value={emailSettingsForm.smtp_username || ""} onChange={(v) => setEmailSettingsForm((p) => ({ ...p, smtp_username: v }))} />
        <Input type="password" placeholder={emailSettingsForm.id ? "SMTP Password / App Password (leave blank to keep current)" : "SMTP Password / App Password"} value={emailSettingsForm.smtp_password || ""} onChange={(v) => setEmailSettingsForm((p) => ({ ...p, smtp_password: v }))} />
        <Input placeholder="Test Recipient Email" value={emailSettingsForm.test_email || ""} onChange={(v) => setEmailSettingsForm((p) => ({ ...p, test_email: v }))} />
      </div>

      <label className="check-row">
        <input
          type="checkbox"
          checked={Boolean(emailSettingsForm.is_active)}
          onChange={(e) => setEmailSettingsForm((p) => ({ ...p, is_active: e.target.checked }))}
        />
        Enable this email configuration
      </label>

      {emailSettingsMessage && <p className="muted-text">{emailSettingsMessage}</p>}

      <div className="actions-line">
        <button className="save-btn" disabled={emailSettingsLoading} onClick={() => saveCompanyEmailSettings()}>
          {emailSettingsLoading ? "Saving..." : "Save Email Settings"}
        </button>
        <button className="light-btn" disabled={emailSettingsLoading} onClick={testCompanyEmailSettings}>
          Send Test Email
        </button>
        <button className="light-btn" onClick={() => loadCompanyEmailSettings()}>Reload</button>
      </div>
    </FormCard>

    <TableCard title="Email Routing Rules">
      <table>
        <thead>
          <tr>
            <th>Event</th>
            <th>Recipient</th>
            <th>Sender</th>
            <th>Fallback</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Agreement sent to agency</td><td>Agency email from Agencies page</td><td>Company email if verified</td><td>VisaFlow default email</td></tr>
          <tr><td>Agency accepts agreement</td><td>Company Agreements Email</td><td>Company email if verified</td><td>agreements@visaflowksa.com</td></tr>
          <tr><td>Penalty sent to agency</td><td>Agency email from Agencies page</td><td>Company email if verified</td><td>VisaFlow default email</td></tr>
          <tr><td>Agency submits justification</td><td>Company Notifications Email</td><td>Company email if verified</td><td>notifications@visaflowksa.com</td></tr>
          <tr><td>Job offer email</td><td>Candidate email</td><td>Company email if verified</td><td>VisaFlow default email</td></tr>
        </tbody>
      </table>
    </TableCard>
  </>
)}

{activePage === "Permissions" && canManagePermissions && (
  <>
    <TableCard title="Role Permissions Matrix">
      <table>
        <thead>
          <tr>
            <th>Role</th>
            <th>Performance Category</th>
            <th>Recruitment Performance</th>
            <th>Description</th>
            <th>Allowed Pages</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {CLIENT_ROLE_OPTIONS.map((role) => (
            <tr key={role}>
              <td><Badge value={role} /></td>
              <td><Badge value={getRolePerformanceCategory(role)} /></td>
              <td>{isRecruitmentPerformanceRole(role) ? "Yes" : "No"}</td>
              <td>{ROLE_DESCRIPTIONS[role] || "-"}</td>
              <td>{(ROLE_PAGES[role] || []).join(", ")}</td>
              <td>{(ACTION_PERMISSIONS[role] || []).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>

    <TableCard title="Operational Rules">
      <table>
        <thead>
          <tr>
            <th>Rule</th>
            <th>Applied To</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Only Company Admin can manage users, permissions, master data and company setup.</td>
            <td>Users Management, Permissions</td>
          </tr>
          <tr>
            <td>CEO can view operational data and export reports, but cannot delete or modify records.</td>
            <td>Dashboard, Requests, Visas, Candidates, Interviews, Agencies, Reports</td>
          </tr>
          <tr>
            <td>Operations Manager follows manpower requests, mobilization, employees, demobilization and operational reports, but cannot manage visas or users.</td>
            <td>Requests, Mobilization, Employees, Demobilization, Reports</td>
          </tr>
          <tr>
            <td>Visa Team controls visa inventory, allocations, authorizations and cancellations.</td>
            <td>Visa Inventory, Visa Allocation, Authorization, Cancellation Register</td>
          </tr>
          <tr>
            <td>Recruitment Performance includes only Recruitment Manager and Recruitment Officer roles. Project, Operations, Visa, CEO, Agency and Viewer roles are excluded from recruiter KPI scoring.</td>
            <td>Recruitment Performance</td>
          </tr>
          <tr>
            <td>Agency can use Office Portal only.</td>
            <td>Office Portal</td>
          </tr>
        </tbody>
      </table>
    </TableCard>
  </>
)}

{activePage === "Users Management" && canManageUsers && (
  <>
    <FormCard title={userEditingId ? "Edit User" : "Add User"}>
      <div className="form-grid">
        <Input
          placeholder="Full Name"
          value={userForm?.name || ""}
          onChange={(v) =>
            setUserForm((p) => ({ ...p, name: v }))
          }
        />

        <Input
          placeholder="Email"
          value={userForm?.email || ""}
          onChange={(v) =>
            setUserForm((p) => ({ ...p, email: v }))
          }
        />

        <Input
          placeholder="Password"
          value={userForm?.password || ""}
          onChange={(v) =>
            setUserForm((p) => ({ ...p, password: v }))
          }
        />

        <Select
          value={userForm?.role || ""}
          onChange={(v) =>
            setUserForm((p) => ({
              ...p,
              role: v,
              agency_id: v === "Agency" ? p.agency_id : "",
              agency_name: v === "Agency" ? p.agency_name : "",
            }))
          }
          options={CLIENT_ROLE_OPTIONS}
          placeholder="Role"
        />

        {userForm?.role === "Agency" && (
          <Select
            value={userForm?.agency_name || ""}
            onChange={(v) => {
              const selectedAgency = agencies.find((agency) => agency.name === v);
              setUserForm((p) => ({
                ...p,
                agency_id: selectedAgency?.id || "",
                agency_name: selectedAgency?.name || v || "",
              }));
            }}
            options={(agencies || []).map((agency) => agency.name).filter(Boolean)}
            placeholder="Select Agency"
          />
        )}

        <Select
          value={userForm?.status || "Active"}
          onChange={(v) =>
            setUserForm((p) => ({ ...p, status: v }))
          }
          options={["Active", "Inactive"]}
          placeholder="Status"
        />
      </div>

      <div className="actions-line">
   <button
  className="save-btn"
  onClick={saveUser}
>
  {userForm.role === "Agency" ? (userEditingId ? "Update Agency Access" : "Grant Agency Access") : (userEditingId ? "Update User" : "Save User")}
</button>
{userEditingId && (
  <button
    className="light-btn"
    onClick={() => {
      setUserEditingId(null);
      setUserForm({
        name: "",
        email: "",
        password: "",
        role: "Viewer",
        status: "Active",
        agency_id: "",
        agency_name: "",
      });
    }}
  >
    Cancel
  </button>
)}
      </div>
    </FormCard>

    <TableCard title="Users List">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Agency</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {(users || []).map((user) => (
            <tr key={user.id}>
              <td>{user.name}</td>
              <td>{user.email}</td>
              <td>{user.role}</td>
              <td>{user.role === "Agency" ? (user.agency_name || "Not Linked") : "-"}</td>
              <td>{user.status}</td>
              <td>
  <button className="small-btn" onClick={() => editUser(user)}>
    Edit
  </button>
  <button className="danger-btn" onClick={() => deleteUser(user.id)}>
    Delete
  </button>
</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  </>
)}

        {activePage === "Agencies" && (
          <>
            {canManageAgencies && (
            <FormCard title={agencyEditingId ? "Edit Agency" : "Add Agency"}>
              <div className="form-grid">
                <Input placeholder="Agency Name" value={agencyForm.name} onChange={(v) => updateForm(setAgencyForm, "name", v)} />
                <Input placeholder="Country" value={agencyForm.country} onChange={(v) => updateForm(setAgencyForm, "country", v)} />
                <Input placeholder="Contact Person" value={agencyForm.contact_person} onChange={(v) => updateForm(setAgencyForm, "contact_person", v)} />
                <Input placeholder="Email" value={agencyForm.email} onChange={(v) => updateForm(setAgencyForm, "email", v)} />
                <Input placeholder="Phone" value={agencyForm.phone} onChange={(v) => updateForm(setAgencyForm, "phone", v)} />
                <Select value={agencyForm.status} onChange={(v) => updateForm(setAgencyForm, "status", v)} placeholder="Status" options={["Active", "Inactive", "Suspended"]} />
              </div>
              <div className="actions-line"><button className="save-btn" onClick={saveAgency}>{agencyEditingId ? "Update Agency" : "Save Agency"}</button><button className="light-btn" onClick={resetAgencyForm}>Clear</button></div>
            </FormCard>
            )}
            <TableCard title="Agencies List"><table><thead><tr><th>Name</th><th>Country</th><th>Contact</th><th>Email</th><th>Phone</th><th>Status</th><th>Actions</th></tr></thead><tbody>{agencies.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.country}</td><td>{item.contact_person}</td><td>{item.email}</td><td>{item.phone}</td><td><Badge value={item.status} /></td><td className="table-actions">{canManageAgencies ? <><button onClick={() => editAgency(item)}>Edit</button><button className="danger" onClick={() => deleteAgency(item.id)}>Delete</button></> : "-"}</td></tr>)}</tbody></table></TableCard>
          </>
        )}


{activePage === "Recruitment Performance" && (() => {
  const performance = getRecruitmentPerformanceSummary();
  const rows = performance.rows;
  return (
    <>
      <div className="dashboard-grid">
        <Stat title="Recruiters Tracked" value={rows.length} />
        <Stat title="Total Requests" value={performance.totalRequests} />
        <Stat title="Closed Requests" value={performance.closedRequests} className="passed" />
        <Stat title="Total Candidates" value={performance.totalCandidates} />
        <Stat title="Joined" value={performance.totalJoined} className="passed" />
        <Stat title="Average Score" value={`${performance.avgScore}%`} className={performance.avgScore >= 80 ? "passed" : performance.avgScore >= 70 ? "warning" : "danger"} />
        <Stat title="Top Performer" value={performance.topPerformer?.recruiter || "-"} className="passed" />
        <Stat title="Needs Support" value={performance.needsSupport} className={performance.needsSupport ? "warning" : "passed"} />
      </div>

      <TableCard title="🏆 Recruitment Leaderboard">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Recruiter</th>
              <th>Role</th>
              <th>Score</th>
              <th>Grade</th>
              <th>Requests</th>
              <th>Closed</th>
              <th>Candidates</th>
              <th>Passed</th>
              <th>Joined</th>
              <th>SLA</th>
              <th>AI Insight</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan="12">No recruitment performance data available.</td></tr>
            ) : rows.map((row, index) => (
              <tr key={row.recruiter}>
                <td>{index + 1}</td>
                <td><b>{row.recruiter}</b></td>
                <td><Badge value={row.role} /></td>
                <td><b>{row.total_score}%</b></td>
                <td><Badge value={row.grade} /></td>
                <td>{row.requests}</td>
                <td>{row.closed_requests}</td>
                <td>{row.candidates}</td>
                <td>{row.passed_interviews}</td>
                <td>{row.joined}</td>
                <td>{row.sla_score}%</td>
                <td>{row.ai_insight}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      <TableCard title="Recruitment Performance Scorecard">
        <table>
          <thead>
            <tr>
              <th>Recruiter</th>
              <th>Role</th>
              <th>Closure %</th>
              <th>Interview Pass %</th>
              <th>Mobilization %</th>
              <th>SLA %</th>
              <th>Productivity</th>
              <th>Rejection Penalty</th>
              <th>Total Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.recruiter}-scorecard`}>
                <td>{row.recruiter}</td>
                <td><Badge value={row.role} /></td>
                <td>{row.closure_rate}%</td>
                <td>{row.interview_pass_rate}%</td>
                <td>{row.mobilization_rate}%</td>
                <td>{row.sla_score}%</td>
                <td>{row.productivity_score}%</td>
                <td>{row.rejection_penalty}%</td>
                <td><b>{row.total_score}%</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      <div className="grid">
        <TableCard title="Top 5 Performers">
          <table>
            <thead><tr><th>Recruiter</th><th>Role</th><th>Score</th><th>Grade</th><th>Joined</th></tr></thead>
            <tbody>
              {rows.slice(0, 5).map((row) => (
                <tr key={`${row.recruiter}-top`}>
                  <td>{row.recruiter}</td>
                  <td><Badge value={row.role} /></td>
                  <td>{row.total_score}%</td>
                  <td><Badge value={row.grade} /></td>
                  <td>{row.joined}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>

        <TableCard title="AI Performance Insights">
          <div style={{ display: "grid", gap: "12px" }}>
            {rows.slice(0, 6).map((row) => (
              <div key={`${row.recruiter}-insight`} style={{ padding: "14px", borderRadius: "16px", background: "#f8fafc", border: "1px solid #e2e8f0", lineHeight: 1.7 }}>
                <b>{row.recruiter}</b> — {row.ai_insight}
              </div>
            ))}
            {rows.length === 0 && <p>No AI insights available yet.</p>}
          </div>
        </TableCard>
      </div>
    </>
  );
})()}

{activePage === "Reports" && (
<>
  <div className="dashboard-grid">
    <Stat title="Requests Without Visa" value={reports.requestsWithoutVisa.length} className="warning" />
    <Stat title="Visas Without Requests" value={reports.visasWithoutRequests.length} className="danger" />
    <Stat title="Visas Without Authorization" value={reports.visasWithoutAuthorization.length} className="warning" />
    <Stat title="Authorizations Without Candidates" value={reports.authorizationsWithoutCandidates.length} className="danger" />
    <Stat title="Candidates Without Interviews" value={reports.candidatesWithoutInterviews.length} className="warning" />
    <Stat title="Late SLA Items" value={reports.lateItems.length} className="danger" />
    <Stat title="Operational Changes" value={cleanOperationalChanges.length} className={cleanOperationalChanges.length ? "warning" : "passed"} />
</div>
<TableCard title="Recruitment Pipeline Summary">
  <table>
    <thead>
      <tr>
        <th>Request No</th>
        <th>Profession</th>
        <th>Nationality</th>
        <th>Qty</th>
        <th>Remaining</th>
        <th>Visa No</th>
<th>Progress %</th>
<th>Stage</th>
        
        
        <th>Candidates</th>
        
        <th>Status</th>
        
      </tr>
    </thead>
    <tbody>
      {reports.requestLifecycle.map((item) => (
        <tr key={item.request_no}>
          <td>
  <button
    className="link-btn"
    onClick={() => openRequestDetails(item)}
  >
    {item.request_no}
  </button>
</td>
          <td>{item.profession || "-"}</td>
          <td>{item.nationality || "-"}</td>
          <td>{item.qty || 0}</td>
          <td>{Math.max((item.qty || 0) - (item.candidates || 0), 0)}</td>
          <td>
  {item.visas ? (
    <button
      className="link-btn"
      onClick={() => {
        setSearch(item.request_no);
        setVisaForm((prev) => ({
          ...prev,
          request_no: item.request_no,
          project: item.project_name || "",
          profession: item.profession || "",
          nationality: item.nationality || "",
          quantity: Number(item.qty || 0),
        }));
        setActivePage("Visa Inventory");
      }}
    >
      {item.visas}
    </button>
  ) : (
    "-"
  )}
</td>
<td>
  {item.qty
  ? Math.round(((item.completedCandidates || 0) / item.qty) * 100)
  : 0}%
</td>

<td>
  {(() => {
    const progress = item.qty
  ? Math.round((item.completedCandidates || 0) / item.qty * 100)
  : 0;

    if (progress >= 100) return <span style={{ color: "green", fontWeight: "bold" }}>Completed</span>;
    if (progress >= 71) return <span style={{ color: "blue" }}>Interview / Mobilization</span>;
    if (progress >= 31) return <span style={{ color: "orange" }}>Candidate Pipeline</span>;
    if (progress >= 1) return <span style={{ color: "purple" }}>Sourcing</span>;

    return <span style={{ color: "red" }}>Not Started</span>;
  })()}
</td>      
<td>
  <button
    className="link-btn"
    onClick={() => {
      setSearch(item.request_no);
      setActivePage("Candidates");
    }}
  >
    {item.candidates}
  </button>
</td>

<td>
  {(item.completedCandidates || 0) >= (item.qty || 0)
    ? "Completed"
    : (item.completedCandidates || 0) > 0
    ? "In Progress"
    : "Under Recruitment"}
</td>
</tr>
))}
</tbody>
  </table>
</TableCard>

<div style={{
display:"flex",
gap:"10px",
flexWrap:"wrap",
margin:"20px 0"
}}>

<div className="report-cards">

<div className="report-card"
onClick={() => setActiveReport("all")}>
<h2>📊</h2>
<h4>All Reports</h4>
<p>Full Overview</p>
</div>

<div className="report-card danger"
onClick={() => setActiveReport("requestsWithoutVisa")}>
<h2>📄</h2>
<h4>Requests</h4>
<p>Without Visa</p>
</div>

<div className="report-card warning"
onClick={() => setActiveReport("visasWithoutRequest")}>
<h2>🛂</h2>
<h4>Visas</h4>
<p>No Request</p>
</div>

<div className="report-card danger"
onClick={() => setActiveReport("visasWithoutAuth")}>
<h2>✅</h2>
<h4>Authorization</h4>
<p>Missing</p>
</div>

<div className="report-card warning"
onClick={() => setActiveReport("authWithoutCandidates")}>
<h2>👥</h2>
<h4>Candidates</h4>
<p>Missing</p>
</div>

<div className="report-card warning"
onClick={() => setActiveReport("candidateNoInterview")}>
<h2>🎤</h2>
<h4>Interviews</h4>
<p>Pending</p>
</div>

<div className="report-card danger"
onClick={() => setActiveReport("lateSla")}>
<h2>⏰</h2>
<h4>SLA</h4>
<p>Late Items</p>
</div>

<div className="report-card"
onClick={() => setActiveReport("activityLog")}>
<h2>🧾</h2>
<h4>Activity Log</h4>
<p>Changes & Timeline</p>
</div>

</div>
{(activeReport === "all" || activeReport === "requestsWithoutVisa") ? (
<TableCard title="Requests Without Visa">
    <table>
      <thead>
        <tr>
          <th>Request No</th>
          <th>Project</th>
          <th>Profession</th>
          <th>Nationality</th>
          <th>Qty</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {reports.requestsWithoutVisa.map((item) => (
          <tr key={item.id}>
            <td>{item.request_no}</td>
            <td>{item.project_name || "-"}</td>
            <td>{item.profession || "-"}</td>
            <td>{item.nationality || "-"}</td>
            <td>{item.quantity || 0}</td>
            <td>{item.status || "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </TableCard>
) : null}
{(activeReport === "all" || activeReport === "visasWithoutRequest") ? (
<TableCard title="Visas Without Requests">
<table>
<thead>
<tr>
          <th>Visa No</th>
          <th>Project</th>
          <th>Profession</th>
          <th>Nationality</th>
          <th>Qty</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {reports.visasWithoutRequests.map((item) => (
          <tr key={item.id}>
            <td>{item.visa_no}</td>
            <td>{item.project || "-"}</td>
            <td>{item.profession || "-"}</td>
            <td>{item.nationality || "-"}</td>
            <td>{item.quantity || 0}</td>
            <td>{item.status || "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </TableCard>
) : null}

{(activeReport === "all" || activeReport === "visasWithoutAuth") ? (
<TableCard title="Visas Without Authorization">
    <table>
      <thead>
        <tr>
          <th>Visa No</th>
          <th>Request No</th>
          <th>Profession</th>
          <th>Nationality</th>
          <th>Qty</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {reports.visasWithoutAuthorization.map((item) => (
          <tr key={item.id}>
            <td>{item.visa_no}</td>
            <td>{item.request_no || "-"}</td>
            <td>{item.profession || "-"}</td>
            <td>{item.nationality || "-"}</td>
            <td>{item.quantity || 0}</td>
            <td>{item.status || "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </TableCard>
) : null}
  <TableCard title="Authorizations Without Candidates">
    <table>
      <thead>
        <tr>
          <th>Visa No</th>
          <th>Agency</th>
          <th>Authorization No</th>
          <th>Allocated</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {reports.authorizationsWithoutCandidates.map((item) => (
          <tr key={item.id}>
            <td>{item.visa_no}</td>
            <td>{item.agency || "-"}</td>
            <td>{item.authorization_no || "-"}</td>
            <td>{item.allocated_qty || 0}</td>
            <td>{item.status || "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </TableCard>

  <TableCard title="Candidates Without Interviews">
    <div className="mini-table-scroll">
    <table>
      <thead>
        <tr>
          <th>Candidate</th>
          <th>Passport</th>
          <th>Profession</th>
          <th>Nationality</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {reports.candidatesWithoutInterviews.map((item) => (
          <tr key={item.id}>
            <td>{item.candidate_name || "-"}</td>
            <td>{item.passport_no || "-"}</td>
            <td>{item.profession || "-"}</td>
            <td>{item.nationality || "-"}</td>
            <td>{item.status || "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  </TableCard>

  <TableCard title="Late SLA Items">
    <table>
      <thead>
        <tr>
          <th>Type</th>
          <th>Reference</th>
          <th>Name</th>
          <th>Days</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {reports.lateItems.map((item, index) => (
          <tr key={index}>
            <td>{item.type}</td>
            <td>{item.reference}</td>
            <td>{item.name}</td>
            <td>{item.days}</td>
            <td>{item.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </TableCard>

  {(activeReport === "all" || activeReport === "activityLog") ? (
    <TableCard title="Operational Activity Log / سجل الحركة التشغيلية">
      <div className="toolbar">
        <input
          placeholder="Filter by request no..."
          value={activityFilters.requestNo}
          onChange={(e) => setActivityFilters((prev) => ({ ...prev, requestNo: e.target.value }))}
        />
        <select
          value={activityFilters.moduleName}
          onChange={(e) => setActivityFilters((prev) => ({ ...prev, moduleName: e.target.value }))}
        >
          {activityModules.map((module) => (
            <option key={module} value={module}>{module}</option>
          ))}
        </select>
        <select
          value={activityFilters.actionType}
          onChange={(e) => setActivityFilters((prev) => ({ ...prev, actionType: e.target.value }))}
        >
          {activityActionTypes.map((action) => (
            <option key={action} value={action}>{action}</option>
          ))}
        </select>
        <input
          type="date"
          value={activityFilters.dateFrom}
          onChange={(e) => setActivityFilters((prev) => ({ ...prev, dateFrom: e.target.value }))}
        />
        <input
          type="date"
          value={activityFilters.dateTo}
          onChange={(e) => setActivityFilters((prev) => ({ ...prev, dateTo: e.target.value }))}
        />
        <button
          className="light-btn"
          onClick={() => setActivityFilters({ requestNo: "", moduleName: "All", actionType: "All", dateFrom: "", dateTo: "" })}
        >
          Clear
        </button>
      </div>
      <div className="mini-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Module</th>
              <th>Action</th>
              <th>Reference</th>
              <th>Request No</th>
              <th>Change Summary</th>
              <th>Changed By</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {filteredActivityLogs.length === 0 ? (
              <tr><td colSpan="8">No activity log records found.</td></tr>
            ) : filteredActivityLogs.slice(0, 200).map((item) => (
              <tr key={item.id}>
                <td>{formatActivityDate(item.created_at)}</td>
                <td>{item.module_name || "-"}</td>
                <td><Badge value={item.action_type || "-"} /></td>
                <td>{item.record_label || item.record_id || "-"}</td>
                <td>{item.request_no || "-"}</td>
                <td>
                  <b>{formatActivitySummary(item)}</b>
                  <div style={{ color: "#64748b", fontSize: "12px", marginTop: "4px" }}>
                    {formatActivityChangedFieldsText(item)}
                  </div>
                </td>
                <td>{item.changed_by_name || "-"}</td>
                <td>{item.source || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TableCard>
  ) : null}

  <TableCard title="Request Full Lifecycle">
    <table>
      <thead>
        <tr>
       <th>Request No</th>
<th>Profession</th>
<th>Nationality</th>
<th>Qty</th>
<th>Remaining</th>
<th>Progress %</th>
<th>Stage</th>
<th>Visas</th>
<th>Authorizations</th>
<th>Candidates</th>
<th>Interviews</th>
<th>Status</th>
<th>Approval</th>
        </tr>
      </thead>
      <tbody>
        {reports.requestLifecycle.map((item) => (
          <tr key={item.request_no}>
<td>
  <button
    className="link-btn"
    onClick={() => openRequestDetails(item)}
  >
    {item.request_no}
  </button>
</td>
            <td>{item.profession || "-"}</td>
            <td>{item.nationality || "-"}</td>
            <td>{item.qty || 0}</td>
            <td>{Math.max((item.qty || 0) - (item.completedCandidates || 0), 0)}</td>

<td>
 {item.qty
  ? Math.round(((item.completedCandidates || 0) / item.qty) * 100) + "%"
  : "0%"}
</td>
<td>
  {(() => {
    const progress = item.qty
  ? Math.round(((item.completedCandidates || 0) / item.qty) * 100)
  : 0;

    if (progress >= 100) return <span style={{ color: "green", fontWeight: "bold" }}>Completed</span>;
    if (progress >= 71) return <span style={{ color: "blue" }}>Interview / Mobilization</span>;
    if (progress >= 31) return <span style={{ color: "orange" }}>Candidate Pipeline</span>;
    if (progress >= 1) return <span style={{ color: "purple" }}>Sourcing</span>;

    return <span style={{ color: "red" }}>Not Started</span>;
  })()}
</td>
<td>{item.visas || 0}</td>
<td>{item.authorizations || 0}</td>
<td>{item.candidates || 0}</td>
<td>{item.interviews || 0}</td>
<td>
  {(item.completedCandidates || 0) >= (item.qty || 0)
    ? "Completed"
    : (item.completedCandidates || 0) > 0
    ? "In Progress"
    : "Under Recruitment"}
</td>
<td>{item.approval_status || "-"}</td>
        
          </tr>
        ))}
      </tbody>
    </table>
</TableCard>

</div>
</>
)}


        {activePage === "Employees" && (
          <>
            <TableCard title="AI Workforce Intelligence">
              <div className="dashboard-grid">
                <Stat title="Total Employees" value={employeeIntelligence.totalEmployees} />
                <Stat title="Active Employees" value={employeeIntelligence.activeEmployees} className="passed" />
                <Stat title="Contracts Expiring 60 Days" value={employeeIntelligence.expiringSoon} className={employeeIntelligence.expiringSoon > 0 ? "warning" : "passed"} />
                <Stat title="Redeployment Matches" value={employeeIntelligence.redeploymentMatches} className={employeeIntelligence.redeploymentMatches > 0 ? "passed" : "warning"} />
                <Stat title="Potential Saving" value={`${Number(employeeIntelligence.potentialSaving || 0).toLocaleString()} SAR`} className="passed" />
              </div>
              {employeeIntelligence.projectRisk && (
                <div style={{ marginTop: "14px", padding: "16px", borderRadius: "16px", background: "#f8fafc", border: "1px solid #e2e8f0", lineHeight: 1.7 }}>
                  <b>AI Risk Alert:</b> Project <b>{employeeIntelligence.projectRisk.project}</b> has <b>{employeeIntelligence.projectRisk.count}</b> employee(s) with contracts ending soon.
                  {employeeIntelligence.projectRisk.professions ? ` Professions: ${employeeIntelligence.projectRisk.professions}.` : ""}
                </div>
              )}
            </TableCard>

            {canManageEmployees && (
              <FormCard title={employeeEditingId ? "Edit Employee" : "Add Employee"}>
                <div className="actions-line" style={{ marginBottom: "14px" }}>
                  <button className="new-btn" onClick={downloadEmployeesTemplate}>Download Template</button>
                  <button className="save-btn" onClick={startEmployeesExcelUpload}>Import Employees</button>
                </div>
                <p style={{ color: "#64748b", marginTop: 0 }}>Use Excel import for bulk upload. Iqama No is used to prevent duplicate employees.</p>
                <div className="form-grid">
                  <Input placeholder="Employee No (Auto)" value={employeeForm.employee_no} onChange={(v) => updateForm(setEmployeeForm, "employee_no", v)} />
                  <Input placeholder="Employee Name" value={employeeForm.employee_name} onChange={(v) => updateForm(setEmployeeForm, "employee_name", v)} />
                  <Input placeholder="Iqama No" value={employeeForm.iqama_no} onChange={(v) => updateForm(setEmployeeForm, "iqama_no", v)} />
                  <Select value={employeeForm.nationality} onChange={(v) => updateForm(setEmployeeForm, "nationality", v)} placeholder="Nationality" searchable options={countries.map((c) => c.nationality ? `${c.nationality} (${c.name})` : c.name)} />
                  <Select value={employeeForm.gender} onChange={(v) => updateForm(setEmployeeForm, "gender", v)} placeholder="Gender" options={GENDERS} />
                  <Select value={employeeForm.profession} onChange={(v) => updateForm(setEmployeeForm, "profession", v)} placeholder="Profession" searchable options={professions.map((p) => p.name_en ? `${p.name_ar} - ${p.name_en}` : p.name_ar)} />
                  <Input placeholder="Project" value={employeeForm.project_name} onChange={(v) => updateForm(setEmployeeForm, "project_name", v)} />
                  <Input placeholder="Department" value={employeeForm.department} onChange={(v) => updateForm(setEmployeeForm, "department", v)} />
                  <Input type="date" placeholder="Joining Date" value={employeeForm.joining_date} onChange={(v) => updateForm(setEmployeeForm, "joining_date", v)} />
                  <Input type="date" placeholder="Contract End Date" value={employeeForm.contract_end_date} onChange={(v) => updateForm(setEmployeeForm, "contract_end_date", v)} />
                  <Select value={employeeForm.status} onChange={(v) => updateForm(setEmployeeForm, "status", v)} placeholder="Status" options={EMPLOYEE_STATUSES} />
                </div>
                <textarea rows="3" placeholder="Notes" value={employeeForm.notes} onChange={(e) => updateForm(setEmployeeForm, "notes", e.target.value)} />
                <div className="actions-line">
                  <button className="save-btn" onClick={saveEmployee}>{employeeEditingId ? "Update Employee" : "Save Employee"}</button>
                  <button className="light-btn" onClick={resetEmployeeForm}>Clear</button>
                </div>
              </FormCard>
            )}

            <TableCard title="Employees Master List">
              <div className="toolbar">
                <input placeholder="Search employee, iqama, profession, project" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Employee No</th>
                    <th>Name</th>
                    <th>Iqama</th>
                    <th>Profession</th>
                    <th>Nationality</th>
                    <th>Gender</th>
                    <th>Project</th>
                    <th>Joining</th>
                    <th>Contract End</th>
                    <th>Days Remaining</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {employees
                    .filter((item) =>
                      !search ||
                      [item.employee_no, item.employee_name, item.iqama_no, item.profession, item.nationality, item.project_name]
                        .join(" ")
                        .toLowerCase()
                        .includes(search.toLowerCase())
                    )
                    .map((item) => (
                      <tr key={item.id}>
                        <td>{item.employee_no || "-"}</td>
                        <td>{item.employee_name || "-"}</td>
                        <td>{item.iqama_no || "-"}</td>
                        <td>{item.profession || "-"}</td>
                        <td>{item.nationality || "-"}</td>
                        <td><Badge value={item.gender || "-"} /></td>
                        <td>{item.project_name || "-"}</td>
                        <td>{item.joining_date || "-"}</td>
                        <td>{item.contract_end_date || "-"}</td>
                        <td>{(() => {
                          if (!item.contract_end_date) return "-";
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          const endDate = new Date(item.contract_end_date);
                          const days = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
                          const color = days <= 30 ? "#dc2626" : days <= 90 ? "#f59e0b" : "#16a34a";
                          return <b style={{ color }}>{days} days</b>;
                        })()}</td>
                        <td><Badge value={item.status || "Active"} /></td>
                        <td className="table-actions">
                          {canManageEmployees ? (
                            <>
                              <button onClick={() => editEmployee(item)}>Edit</button>
                              {canManageDemobilization && <button onClick={() => createDemobilizationFromEmployee(item)}>Demobilize</button>}
                              <button className="danger" onClick={() => deleteEmployee(item.id)}>Delete</button>
                            </>
                          ) : "-"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </TableCard>
          </>
        )}

        {activePage === "Demobilization" && (
          <>
            <div className="dashboard-grid">
              <Stat title="Available Employees" value={demobilizationIntelligence.availableEmployees} className="warning" />
              <Stat title="Matched Employees" value={demobilizationIntelligence.suggestedEmployees + demobilizationIntelligence.reassignedEmployees} className="passed" />
              <Stat title="Potential Saving" value={`${Number(demobilizationIntelligence.potentialSaving || 0).toLocaleString()} SAR`} className="passed" />
              <Stat title="Recruitment Avoided" value={demobilizationIntelligence.recruitmentAvoided} className="passed" />
              <Stat title="Open Recruitment Gaps" value={demobilizationIntelligence.openRecruitmentGaps.length} className="warning" />
              <Stat title="Invoices Required" value={demobilizationIntelligence.invoicesRequired} className="warning" />
            </div>

            <TableCard title="Smart Demobilization AI Watch">
              <table>
                <thead>
                  <tr>
                    <th>Request No</th>
                    <th>Project</th>
                    <th>Profession</th>
                    <th>Remaining</th>
                    <th>Available Matches</th>
                    <th>Days Open</th>
                    <th>Estimated Saving</th>
                    <th>AI Alert</th>
                  </tr>
                </thead>
                <tbody>
                  {demobilizationIntelligence.smartAlerts.length === 0 ? (
                    <tr><td colSpan="8">No automatic redeployment alerts now</td></tr>
                  ) : demobilizationIntelligence.smartAlerts.map((alert) => (
                    <tr key={alert.request_no}>
                      <td>{alert.request_no}</td>
                      <td>{alert.project}</td>
                      <td>{alert.profession}</td>
                      <td>{alert.remaining}</td>
                      <td>{alert.available_matches}</td>
                      <td>{alert.days_open}</td>
                      <td>{Number(alert.estimated_saving || 0).toLocaleString()} SAR</td>
                      <td>{alert.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>

            {canManageDemobilization && (
              <FormCard title={demobilizationEditingId ? "Edit Demobilization Record" : "Add Demobilization Record"}>
                <div className="form-grid">
                  <Input placeholder="Employee Name" value={demobilizationForm.employee_name} onChange={(v) => updateForm(setDemobilizationForm, "employee_name", v)} />
                  <Input placeholder="Employee ID" value={demobilizationForm.employee_id} onChange={(v) => updateForm(setDemobilizationForm, "employee_id", v)} />
                  <Input placeholder="Iqama / ID No" value={demobilizationForm.iqama_no} onChange={(v) => updateForm(setDemobilizationForm, "iqama_no", v)} />
                  <Select
                    value={demobilizationForm.profession}
                    onChange={(v) => updateForm(setDemobilizationForm, "profession", v)}
                    placeholder="Profession"
                    searchable
                    options={professions.map((p) => p.name_en ? `${p.name_ar} - ${p.name_en}` : p.name_ar)}
                  />
                  <Select
                    value={demobilizationForm.nationality}
                    onChange={(v) => updateForm(setDemobilizationForm, "nationality", v)}
                    placeholder="Nationality"
                    searchable
                    options={countries.map((c) => c.nationality ? `${c.nationality} (${c.name})` : c.name)}
                  />
                  <Select value={demobilizationForm.gender} onChange={(v) => updateForm(setDemobilizationForm, "gender", v)} placeholder="Gender" options={GENDERS} />
                  <Input placeholder="Current Project" value={demobilizationForm.current_project} onChange={(v) => updateForm(setDemobilizationForm, "current_project", v)} />
                  <Input type="date" placeholder="Demobilization Date" value={demobilizationForm.demob_date || ""} onChange={(v) => updateForm(setDemobilizationForm, "demob_date", v)} />
                  <Select value={demobilizationForm.reason} onChange={(v) => updateForm(setDemobilizationForm, "reason", v)} placeholder="Reason" options={DEMOBILIZATION_REASONS} />
                  <Select value={demobilizationForm.status} onChange={(v) => updateForm(setDemobilizationForm, "status", v)} placeholder="Status" options={DEMOBILIZATION_STATUSES} />
                  <Input placeholder="Suggested Request No" value={demobilizationForm.suggested_request_no} onChange={(v) => updateForm(setDemobilizationForm, "suggested_request_no", v)} />
                  <Input placeholder="Suggested Project" value={demobilizationForm.suggested_project} onChange={(v) => updateForm(setDemobilizationForm, "suggested_project", v)} />
                  <Input type="number" placeholder="Match Score" value={demobilizationForm.match_score} onChange={(v) => updateForm(setDemobilizationForm, "match_score", v)} />
                  <Select value={demobilizationForm.invoice_required || "No"} onChange={(v) => updateForm(setDemobilizationForm, "invoice_required", v)} placeholder="Invoice Required" options={["No", "Yes"]} />
                  <Input placeholder="Invoice Type" value={demobilizationForm.invoice_type || "Redeployment Service"} onChange={(v) => updateForm(setDemobilizationForm, "invoice_type", v)} />
                  <Input type="number" placeholder="Invoice Amount" value={demobilizationForm.invoice_amount} onChange={(v) => updateForm(setDemobilizationForm, "invoice_amount", v)} />
                  <Input type="number" placeholder="Redeployment Cost" value={demobilizationForm.redeployment_cost} onChange={(v) => {
                    const cost = estimateRedeploymentCost({ ...demobilizationForm, redeployment_cost: v });
                    setDemobilizationForm((prev) => ({ ...prev, redeployment_cost: v, estimated_saving: String(cost.estimatedSaving) }));
                  }} />
                  <Input type="number" placeholder="New Recruitment Cost" value={demobilizationForm.estimated_new_recruitment_cost} onChange={(v) => {
                    const cost = estimateRedeploymentCost({ ...demobilizationForm, estimated_new_recruitment_cost: v });
                    setDemobilizationForm((prev) => ({ ...prev, estimated_new_recruitment_cost: v, estimated_saving: String(cost.estimatedSaving) }));
                  }} />
                  <Input type="number" placeholder="Estimated Saving" value={demobilizationForm.estimated_saving} onChange={(v) => updateForm(setDemobilizationForm, "estimated_saving", v)} />
                  <Select value={demobilizationForm.recruitment_avoided || "Yes"} onChange={(v) => updateForm(setDemobilizationForm, "recruitment_avoided", v)} placeholder="Recruitment Avoided" options={["Yes", "No"]} />
                </div>

                <textarea rows="3" placeholder="AI Recommendation" value={demobilizationForm.ai_recommendation} onChange={(e) => updateForm(setDemobilizationForm, "ai_recommendation", e.target.value)} />
                <textarea rows="3" placeholder="Notes" value={demobilizationForm.notes} onChange={(e) => updateForm(setDemobilizationForm, "notes", e.target.value)} />

                <div className="actions-line">
                  <button className="save-btn" onClick={saveDemobilization}>{demobilizationEditingId ? "Update Demobilization" : "Save Demobilization"}</button>
                  <button className="new-btn" onClick={runDemobAI}>AI Suggest Match</button>
                  <button className="light-btn" onClick={resetDemobilizationForm}>Clear</button>
                </div>
              </FormCard>
            )}

            {demobAiSuggestion && (
              <TableCard title="AI Redeployment Suggestions">
                <div style={{ padding: "14px", borderRadius: "16px", background: "#f8fafc", border: "1px solid #e2e8f0", marginBottom: "14px", lineHeight: 1.7 }}>
                  <b>AI Summary:</b> {demobAiSuggestion.summary}
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Request No</th>
                      <th>Project</th>
                      <th>Profession</th>
                      <th>Nationality</th>
                      <th>Remaining</th>
                      <th>Days Open</th>
                      <th>Score</th>
                      <th>Saving</th>
                      <th>AI Recommendation</th>
                      <th>Reason</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {demobAiSuggestion.suggestions.length === 0 ? (
                      <tr><td colSpan="11">No suggestions found</td></tr>
                    ) : demobAiSuggestion.suggestions.map((item) => (
                      <tr key={item.request_no}>
                        <td>{item.request_no}</td>
                        <td>{item.project}</td>
                        <td>{item.profession}</td>
                        <td>{item.nationality}</td>
                        <td>{item.remaining}</td>
                        <td>{item.days_open}</td>
                        <td><Badge value={`${item.score}%`} /></td>
                        <td>{Number(item.estimated_saving || 0).toLocaleString()} SAR</td>
                        <td>{item.recommendation}</td>
                        <td>{item.reason}</td>
                        <td><button className="light-btn" onClick={() => applyDemobSuggestion(item)}>Use</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableCard>
            )}

            <TableCard title="Demobilization List">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Iqama / ID</th>
                    <th>Profession</th>
                    <th>Nationality</th>
                    <th>Current Project</th>
                    <th>Demob Date</th>
                    <th>Status</th>
                    <th>Suggested Request</th>
                    <th>Match</th>
                    <th>Invoice</th>
                    <th>Saving</th>
                    <th>Recruitment Avoided</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {demobilizations.length === 0 ? (
                    <tr><td colSpan="13">No demobilization records yet</td></tr>
                  ) : demobilizations.map((item) => (
                    <tr key={item.id}>
                      <td>{item.employee_name || "-"}</td>
                      <td>{item.iqama_no || item.employee_id || "-"}</td>
                      <td>{item.profession || "-"}</td>
                      <td>{item.nationality || "-"}</td>
                      <td>{item.current_project || "-"}</td>
                      <td>{item.demob_date || "-"}</td>
                      <td><Badge value={item.status || "Available"} /></td>
                      <td>{item.suggested_request_no || "-"}</td>
                      <td>{item.match_score ? `${item.match_score}%` : "-"}</td>
                      <td>{item.invoice_required === "Yes" ? `${Number(item.invoice_amount || 0).toLocaleString()} SAR` : "No"}</td>
                      <td>{Number(item.estimated_saving || 0).toLocaleString()} SAR</td>
                      <td><Badge value={item.recruitment_avoided || "-"} /></td>
                      <td className="table-actions">
                        {canManageDemobilization ? (
                          <>
                            <button onClick={() => editDemobilization(item)}>Edit</button>
                            <button className="danger" onClick={() => deleteDemobilization(item.id)}>Delete</button>
                          </>
                        ) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>
          </>
        )}


{activePage === "Platform Dashboard" && canManagePlatform && (
  <div className="page-section">
    <div className="stats-grid">
      <div className="stat-card"><h3>Total Companies</h3><strong>{platformDashboard.totalClients}</strong><span>Registered clients</span></div>
      <div className="stat-card"><h3>Active Companies</h3><strong>{platformDashboard.activeClients}</strong><span>Active subscriptions</span></div>
      <div className="stat-card"><h3>Monthly Revenue</h3><strong>{Number(platformDashboard.monthlyRevenue || 0).toLocaleString()} SAR</strong><span>Expected MRR</span></div>
      <div className="stat-card"><h3>Overdue Invoices</h3><strong>{platformDashboard.overdueInvoices}</strong><span>Require follow-up</span></div>
      <div className="stat-card"><h3>Open Tickets</h3><strong>{platformDashboard.openTickets}</strong><span>Central support</span></div>
    </div>

    <div className="table-card">
      <h2>Latest Backups</h2>
      <table>
        <thead><tr><th>Type</th><th>Company</th><th>Status</th><th>Date</th><th>Notes</th></tr></thead>
        <tbody>
          {platformDashboard.latestBackups.length === 0 ? (
            <tr><td colSpan="5">No backups yet</td></tr>
          ) : platformDashboard.latestBackups.map((item) => (
            <tr key={item.id}>
              <td>{item.backup_type}</td>
              <td>{getPlatformClientName(item.client_id)}</td>
              <td><Badge value={item.status || "Completed"} /></td>
              <td>{item.created_at ? new Date(item.created_at).toLocaleString() : "-"}</td>
              <td>{item.notes || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
)}

{activePage === "Companies Management" && canManagePlatform && (
  <div className="page-section">
    <div className="executive-hero" style={{ marginBottom: 18 }}>
      <div>
        <p className="eyebrow">Platform Administration</p>
        <h1>Companies Management</h1>
        <p>Manage SaaS clients, subscriptions, renewal risks, user capacity and monthly billing from one control page.</p>
      </div>
      <div className="hero-actions">
        <button onClick={loadPlatformClients}>Refresh</button>
        <button onClick={() => setActivePage("Subscription Invoices")}>Invoices</button>
        <button onClick={() => setActivePage("Central Support")}>Support</button>
      </div>
    </div>

    <div className="stats-grid">
      <div className="stat-card"><h3>Total Companies</h3><strong>{platformDashboard.totalClients}</strong><span>All registered clients</span></div>
      <div className="stat-card"><h3>Active</h3><strong>{platformDashboard.activeClients}</strong><span>Paid active subscriptions</span></div>
      <div className="stat-card"><h3>Trial</h3><strong>{platformDashboard.trialClients}</strong><span>Trial accounts</span></div>
      <div className="stat-card"><h3>Renewal Soon</h3><strong>{platformDashboard.expiringThisMonth}</strong><span>Ending within 30 days</span></div>
      <div className="stat-card"><h3>Monthly Revenue</h3><strong>{Number(platformDashboard.monthlyRevenue || 0).toLocaleString()} SAR</strong><span>Current active MRR</span></div>
      <div className="stat-card"><h3>Unpaid Amount</h3><strong>{Number(platformDashboard.unpaidAmount || 0).toLocaleString()} SAR</strong><span>{platformDashboard.unpaidInvoices} unpaid invoice(s)</span></div>
    </div>

    <div className="form-card">
      <h2>{platformClientEditingId ? "Edit Company Subscription" : "Add Platform Company"}</h2>
      <div className="form-grid">
        <div>
          <label>Company Name</label>
          <input
            placeholder="Company Name"
            value={platformClientForm.company_name}
            onChange={(e) => updateForm(setPlatformClientForm, "company_name", e.target.value)}
          />
        </div>

        <div>
          <label>Domain</label>
          <input
            placeholder="example.com"
            value={platformClientForm.domain}
            onChange={(e) => updateForm(setPlatformClientForm, "domain", e.target.value)}
          />
        </div>

        <div>
          <label>Subscription Status</label>
          <select
            value={platformClientForm.subscription_status}
            onChange={(e) => updateForm(setPlatformClientForm, "subscription_status", e.target.value)}
          >
            {["Active", "Trial", "Suspended", "Expired", "Cancelled"].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>

        <div>
          <label>Users Allowed / Count</label>
          <input
            type="number"
            placeholder="Users Count"
            value={platformClientForm.users_count}
            onChange={(e) => updateForm(setPlatformClientForm, "users_count", e.target.value)}
          />
        </div>

        <div>
          <label>Subscription Start</label>
          <input
            type="date"
            value={platformClientForm.start_date}
            onChange={(e) => updateForm(setPlatformClientForm, "start_date", e.target.value)}
          />
        </div>

        <div>
          <label>Subscription End</label>
          <input
            type="date"
            value={platformClientForm.end_date}
            onChange={(e) => updateForm(setPlatformClientForm, "end_date", e.target.value)}
          />
        </div>

        <div>
          <label>Monthly Amount (SAR)</label>
          <input
            type="number"
            placeholder="Monthly Amount"
            value={platformClientForm.monthly_amount}
            onChange={(e) => updateForm(setPlatformClientForm, "monthly_amount", e.target.value)}
          />
        </div>

        <div>
          <label>Operational Company ID</label>
          <input
            placeholder="Link to companies.id for reports"
            value={platformClientForm.operational_company_id}
            onChange={(e) => updateForm(setPlatformClientForm, "operational_company_id", e.target.value)}
          />
        </div>

        {!platformClientEditingId && (
          <>
            <div style={{ gridColumn: "1 / -1", marginTop: 8 }}>
              <h3 style={{ margin: "8px 0 4px" }}>Primary Administrator</h3>
              <p className="muted">This is the first company admin who can login and add users for his company.</p>
            </div>

            <div>
              <label>Admin Name</label>
              <input
                placeholder="Primary Admin Name"
                value={platformClientForm.admin_name}
                onChange={(e) => updateForm(setPlatformClientForm, "admin_name", e.target.value)}
              />
            </div>

            <div>
              <label>Admin Email / Login</label>
              <input
                type="email"
                placeholder="admin@company.com"
                value={platformClientForm.admin_email}
                onChange={(e) => updateForm(setPlatformClientForm, "admin_email", e.target.value)}
              />
            </div>

            <div>
              <label>Temporary Password</label>
              <input
                type="text"
                placeholder="Temporary Password"
                value={platformClientForm.admin_password}
                onChange={(e) => updateForm(setPlatformClientForm, "admin_password", e.target.value)}
              />
            </div>

            <div>
              <label>Admin Role</label>
              <select
                value={platformClientForm.admin_role}
                onChange={(e) => updateForm(setPlatformClientForm, "admin_role", e.target.value)}
              >
                <option>Admin</option>
                <option>Admin</option>
                <option>CEO</option>
                <option>Operations Manager</option>
                <option>Recruitment Manager</option>
                <option>Recruitment Officer</option>
                <option>Viewer</option>
              </select>
            </div>
          </>
        )}
      </div>
      <div className="form-actions">
        <button className="save-btn" onClick={savePlatformClient}>{platformClientEditingId ? "Update Company" : "Save Company"}</button>
        {platformClientEditingId && <button className="ghost-btn" onClick={resetPlatformClientForm}>Cancel</button>}
      </div>
    </div>

    <div className="table-card">
      <div className="section-title-row">
        <div>
          <h2>Companies Portfolio</h2>
          <p>Subscription overview with renewal and invoice actions.</p>
        </div>
        <button onClick={() => exportRowsToExcel(platformClients, "VisaFlow_Platform_Companies", "Companies")}>Export</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>Domain</th>
            <th>Operational Link</th>
            <th>Primary Admin</th>
            <th>Admin Email</th>
            <th>Admin Role</th>
            <th>Status</th>
            <th>Users</th>
            <th>Start</th>
            <th>End</th>
            <th>Remaining</th>
            <th>Monthly</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {platformClients.length === 0 ? <tr><td colSpan="13">No companies yet</td></tr> : platformClients.map((item) => {
            const daysRemaining = getClientDaysRemaining(item);
            const renewalStatus = getClientRenewalStatus(item);
            const primaryAdmin = getPrimaryAdminForPlatformClient(item);
            const linkedUsers = getUsersForPlatformClient(item);
            return (
              <tr key={item.id}>
                <td>
                  <strong>{item.company_name}</strong>
                  <div className="muted">Annual: {Number((Number(item.monthly_amount || 0) * 12) || 0).toLocaleString()} SAR</div>
                </td>
                <td>{item.domain || "-"}</td>
                <td>{item.operational_company_id ? "Linked" : "Not Linked"}</td>
                <td>{primaryAdmin?.name || "-"}</td>
                <td>{primaryAdmin?.email || "-"}</td>
                <td>{primaryAdmin?.role || "-"}</td>
                <td><Badge value={renewalStatus} /></td>
                <td>{linkedUsers.length || item.users_count || 0}</td>
                <td>{item.start_date || "-"}</td>
                <td>{item.end_date || "-"}</td>
                <td>{daysRemaining === null ? "-" : daysRemaining < 0 ? "Expired" : `${daysRemaining} day(s)`}</td>
                <td>{Number(item.monthly_amount || 0).toLocaleString()} SAR</td>
                <td className="actions">
                  <button onClick={() => editPlatformClient(item)}>Edit</button>
                  <button onClick={() => extendPlatformClient(item, 1)}>Extend 30d</button>
<button onClick={() => extendPlatformClient(item, 12)}>Extend 1y</button>
                  <button onClick={() => createSubscriptionInvoiceForClient(item)}>Invoice</button>
                  <button onClick={() => openPlatformClientUsers(item)}>Users</button>
                  <button onClick={() => openCompanyRequestsReport(item)}>Report</button>
                  <button className="danger" onClick={() => deletePlatformClient(item.id)}>Delete</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    {selectedPlatformClientUsers && (
      <div className="table-card">
        <div className="section-title-row">
          <div>
            <h2>Company Users - {selectedPlatformClientUsers.company_name}</h2>
            <p>Users linked to this company. Primary Admin can add and manage users after login.</p>
          </div>
          <button className="ghost-btn" onClick={() => setSelectedPlatformClientUsers(null)}>Close</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email / Login</th>
              <th>Role</th>
              <th>Status</th>
              <th>Company ID</th>
            </tr>
          </thead>
          <tbody>
            {getUsersForPlatformClient(selectedPlatformClientUsers).length === 0 ? (
              <tr><td colSpan="5">No users linked to this company yet</td></tr>
            ) : (
              getUsersForPlatformClient(selectedPlatformClientUsers).map((user) => (
                <tr key={user.id}>
                  <td>{user.name || "-"}</td>
                  <td>{user.email || "-"}</td>
                  <td>{user.role || "-"}</td>
                  <td><Badge value={user.status || "Active"} /></td>
                  <td>{user.company_id || "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    )}
  </div>
)}
{activePage === "Platform Users" && canManagePlatformAccounts && (
  <div className="page-section">
    <div className="executive-hero">
      <div>
        <p className="eyebrow">Platform Administration</p>
        <h1>Platform Users</h1>
        <p>Add and manage internal platform users only.</p>
      </div>
    </div>

    <div className="stats-grid">
      <div className="stat-card">
        <h3>Total Platform Users</h3>
        <strong>{users.filter((u) => isPlatformRole(u.role)).length}</strong>
      </div>

      <div className="stat-card">
        <h3>Active Platform Users</h3>
        <strong>
          {
            users.filter(
              (u) =>
                isPlatformRole(u.role) &&
                String(u.status || "Active").trim().toLowerCase() === "active"
            ).length
          }
        </strong>
      </div>

      <div className="stat-card">
        <h3>Disabled Platform Users</h3>
        <strong>
          {
            users.filter(
              (u) =>
                isPlatformRole(u.role) &&
                String(u.status || "Active").trim().toLowerCase() !== "active"
            ).length
          }
        </strong>
      </div>
    </div>

    <div className="card">
      <h3>{userEditingId ? "Edit Platform User" : "Add Platform User"}</h3>

      <div className="form-grid">
        <input
          placeholder="Full Name"
          value={userForm.name}
          onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
        />

        <input
          placeholder="Email"
          value={userForm.email}
          onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
        />

        <input
          type="password"
          placeholder="Password"
          value={userForm.password}
          onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
        />

        <select
          value={isPlatformRole(userForm.role) ? userForm.role : "Platform Accounts User"}
          onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
        >
          <option value="Platform Owner">Platform Owner</option>
          <option value="Platform Accounts User">Platform Accounts User</option>
          <option value="Platform Support User">Platform Support User</option>
        </select>

        <select
          value={userForm.status || "Active"}
          onChange={(e) => setUserForm({ ...userForm, status: e.target.value })}
        >
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </select>

        <button onClick={saveUser}>
          {userEditingId ? "Update User" : "Add User"}
        </button>

        {userEditingId && (
          <button
            type="button"
            onClick={() => {
              setUserEditingId(null);
              setUserForm({
                name: "",
                email: "",
                password: "",
                role: "Platform Accounts User",
                status: "Active",
                agency_id: "",
                agency_name: "",
              });
            }}
          >
            Cancel Edit
          </button>
        )}
      </div>
    </div>

    <div className="card">
      <div className="section-title-row">
        <div>
          <h3>Platform Users List</h3>
          <p>Only Platform Owner, Platform Accounts User, and Platform Support User are shown here.</p>
        </div>
        <button onClick={loadUsers}>Refresh Users</button>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Company ID</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {users.filter((user) => isPlatformRole(user.role)).length === 0 ? (
            <tr>
              <td colSpan="6">No platform users found</td>
            </tr>
          ) : (
            users
              .filter((user) => isPlatformRole(user.role))
              .map((user) => (
                <tr key={user.id}>
                  <td>{user.name || "-"}</td>
                  <td>{user.email || "-"}</td>
                  <td>{user.role || "-"}</td>
                  <td><Badge value={user.status || "Active"} /></td>
                  <td>{user.company_id || "-"}</td>
                  <td>
                    <button onClick={() => editUser(user)}>Edit</button>
                    <button className="danger" onClick={() => deleteUser(user.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))
          )}
        </tbody>
      </table>
    </div>
  </div>
)}


{activePage === "Subscription Invoices" && canManagePlatform && (
  <div className="page-section">
    <div className="form-card">
      <h2>{subscriptionInvoiceEditingId ? "Edit Subscription Invoice" : "Add Subscription Invoice"}</h2>
      <div className="form-grid">
        <select value={subscriptionInvoiceForm.client_id} onChange={(e) => updateForm(setSubscriptionInvoiceForm, "client_id", e.target.value)}>
          <option value="">Select Company</option>
          {platformClients.map((client) => <option key={client.id} value={client.id}>{client.company_name}</option>)}
        </select>
        <input placeholder="Invoice No (Auto if empty)" value={subscriptionInvoiceForm.invoice_no} onChange={(e) => updateForm(setSubscriptionInvoiceForm, "invoice_no", e.target.value)} />
        <input type="number" placeholder="Amount" value={subscriptionInvoiceForm.amount} onChange={(e) => updateForm(setSubscriptionInvoiceForm, "amount", e.target.value)} />
        <select value={subscriptionInvoiceForm.status} onChange={(e) => updateForm(setSubscriptionInvoiceForm, "status", e.target.value)}>
          {['Paid','Unpaid','Overdue','Cancelled'].map((item) => <option key={item}>{item}</option>)}
        </select>
        <input type="date" value={subscriptionInvoiceForm.due_date} onChange={(e) => updateForm(setSubscriptionInvoiceForm, "due_date", e.target.value)} />
        <input type="date" value={subscriptionInvoiceForm.paid_at} onChange={(e) => updateForm(setSubscriptionInvoiceForm, "paid_at", e.target.value)} />
      </div>
      <div className="form-actions">
        <button className="save-btn" onClick={saveSubscriptionInvoice}>{subscriptionInvoiceEditingId ? "Update Invoice" : "Save Invoice"}</button>
        {subscriptionInvoiceEditingId && <button className="ghost-btn" onClick={resetSubscriptionInvoiceForm}>Cancel</button>}
      </div>
    </div>

    <div className="table-card">
      <h2>Subscription Invoices</h2>
      <table>
        <thead><tr><th>Invoice No</th><th>Company</th><th>Amount</th><th>Status</th><th>Due Date</th><th>Paid At</th><th>Actions</th></tr></thead>
        <tbody>
          {subscriptionInvoices.length === 0 ? <tr><td colSpan="7">No invoices yet</td></tr> : subscriptionInvoices.map((item) => (
            <tr key={item.id}>
              <td>{item.invoice_no}</td>
              <td>{getPlatformClientName(item.client_id)}</td>
              <td>{Number(item.amount || 0).toLocaleString()} SAR</td>
              <td><Badge value={item.status || "Unpaid"} /></td>
              <td>{item.due_date || "-"}</td>
              <td>{item.paid_at || "-"}</td>
              <td className="actions"><button onClick={() => printSubscriptionInvoice(item)}>Print</button><button onClick={() => editSubscriptionInvoice(item)}>Edit</button><button className="danger" onClick={() => deleteSubscriptionInvoice(item.id)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
)}


{activePage === "Company Requests Report" && canManagePlatform && (
  <div className="page-section">
    <div className="executive-hero" style={{ marginBottom: 18 }}>
      <div>
        <p className="eyebrow">Platform Administration</p>
        <h1>Company Requests Meeting Report</h1>
        <p>{companyReportClient?.company_name || "Select a company from Companies Management to generate the report."}</p>
      </div>
      <div className="hero-actions">
        <button onClick={() => setActivePage("Companies Management")}>Back to Companies</button>
        <button onClick={() => exportRowsToExcel(companyReportRows, "VisaFlow_Company_Requests_Report", "Requests Report")}>Export Excel</button>
        <button onClick={printCompanyRequestsReport}>Print</button>
      </div>
    </div>

    {companyReportLoading ? (
      <div className="table-card"><p>Loading company report...</p></div>
    ) : (
      <>
        {(() => {
          const summary = getCompanyReportSummary(companyReportRows);
          return (
            <div className="stats-grid">
              <div className="stat-card"><h3>Total Requests</h3><strong>{summary.totalRequests}</strong><span>All requests</span></div>
              <div className="stat-card"><h3>Required Qty</h3><strong>{summary.totalQty}</strong><span>Total required manpower</span></div>
              <div className="stat-card"><h3>Candidates</h3><strong>{summary.totalCandidates}</strong><span>Active candidates</span></div>
              <div className="stat-card"><h3>Arrived</h3><strong>{summary.totalArrived}</strong><span>Arrived KSA</span></div>
              <div className="stat-card"><h3>Joined</h3><strong>{summary.totalJoined}</strong><span>Joined project</span></div>
              <div className="stat-card"><h3>Completion</h3><strong>{summary.completion}%</strong><span>Joined vs required</span></div>
              <div className="stat-card"><h3>Open Requests</h3><strong>{summary.openRequests}</strong><span>Still active</span></div>
              <div className="stat-card"><h3>High Risk</h3><strong>{summary.highRisk}</strong><span>Need escalation</span></div>
            </div>
          );
        })()}

        <div className="table-card">
          <div className="section-title-row">
            <div>
              <h2>Requests Details</h2>
              <p>Meeting-ready view by request, progress and risk.</p>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Request No</th>
                <th>Project</th>
                <th>Profession</th>
                <th>Nationality</th>
                <th>Gender</th>
                <th>Qty</th>
                <th>Candidates</th>
                <th>Arrived</th>
                <th>Joined</th>
                <th>Remaining</th>
                <th>Progress</th>
                <th>Status</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {companyReportRows.length === 0 ? (
                <tr><td colSpan="13">No requests found for this company.</td></tr>
              ) : companyReportRows.map((row) => (
                <tr key={row.request_no}>
                  <td>{row.request_no}</td>
                  <td>{row.project}</td>
                  <td>{row.profession}</td>
                  <td>{row.nationality}</td>
                  <td>{row.gender}</td>
                  <td>{row.qty}</td>
                  <td>{row.candidates}</td>
                  <td>{row.arrived}</td>
                  <td>{row.joined}</td>
                  <td>{row.remaining}</td>
                  <td>{row.progress}%</td>
                  <td><Badge value={row.status} /></td>
                  <td><Badge value={row.risk} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    )}
  </div>
)}


{activePage === "Backup Center" && isPlatformOwner && (() => {
  const backupRows = [...systemBackups].sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );
  const restoreRows = [...systemRestoreRequests].sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );
  const pendingBackups = backupRows.filter((item) => normalize(item.status) === "pending").length;
  const completedBackups = backupRows.filter((item) => ["completed", "success", "done"].includes(normalize(item.status))).length;
  const failedBackups = backupRows.filter((item) => ["failed", "error"].includes(normalize(item.status))).length;
  const pendingRestores = restoreRows.filter((item) => normalize(item.status) === "pending").length;
  const latestBackup = backupRows[0] || null;

  function getRestoreSourceBackup(restoreRequest) {
    return backupRows.find((backup) => String(backup.id) === String(restoreRequest.backup_id)) || null;
  }

  return (
    <div className="page-section">
      <div className="executive-hero">
        <div>
          <p className="eyebrow">Platform Owner Administration</p>
          <h1>Backup Center</h1>
          <p>Platform Owner only: request backups, run secure backup processing, and create safe restore requests for client recovery.</p>
        </div>
        <div className="form-actions">
          <button className="save-btn" onClick={() => createSystemBackup(null)}>
            Request Full System Backup
          </button>
          <button className="ghost-btn" onClick={runBackupWorker}>
            Run Backup Worker
          </button>
          <button className="ghost-btn" onClick={runRestoreWorker}>
            Run Restore Worker
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <h3>Total Backup Requests</h3>
          <strong>{backupRows.length}</strong>
          <p>All backup records</p>
        </div>
        <div className="stat-card">
          <h3>Pending Backups</h3>
          <strong>{pendingBackups}</strong>
          <p>Waiting for backend processor</p>
        </div>
        <div className="stat-card">
          <h3>Completed Backups</h3>
          <strong>{completedBackups}</strong>
          <p>Ready for download or restore</p>
        </div>
        <div className="stat-card">
          <h3>Restore Requests</h3>
          <strong>{restoreRows.length}</strong>
          <p>{pendingRestores} pending restore request(s)</p>
        </div>
      </div>

      <div className="form-card">
        <h2>Create Backup Request</h2>
        <p>
          Backup requests are created by the Platform Owner. The secure Edge Function processes the request and stores the file in private Supabase Storage.
        </p>
        <div className="form-grid">
          <select
            defaultValue=""
            onChange={(e) => {
              if (!e.target.value) return;
              createSystemBackup(e.target.value);
              e.target.value = "";
            }}
          >
            <option value="">Request Company Backup</option>
            {platformClients.map((client) => (
              <option key={client.id} value={client.id}>{client.company_name}</option>
            ))}
          </select>
          <input readOnly value={latestBackup?.file_name || "No backup request yet"} />
          <input readOnly value={latestBackup?.created_at ? `Last request: ${new Date(latestBackup.created_at).toLocaleString()}` : "Last request: -"} />
        </div>
        <div className="form-actions">
          <button className="save-btn" onClick={() => createSystemBackup(null)}>
            Request Full System Backup
          </button>
          <button className="ghost-btn" onClick={runBackupWorker}>Run Backup Worker</button>
          <button className="ghost-btn" onClick={runRestoreWorker}>Run Restore Worker</button>
          <button className="ghost-btn" onClick={() => { loadSystemBackups(); loadSystemRestoreRequests(); }}>Refresh History</button>
        </div>
      </div>

      <div className="form-card">
        <h2>Client Restore Request</h2>
        <p>
          Use this only when a client asks to recover deleted data. The system creates a restore request using the latest completed company backup and creates a pre-restore backup request for safety.
        </p>
        <div className="form-grid">
          <select
            defaultValue=""
            onChange={(e) => {
              if (!e.target.value) return;
              requestLatestCompanyRestore(e.target.value);
              e.target.value = "";
            }}
          >
            <option value="">Restore Latest Completed Company Backup</option>
            {platformClients.map((client) => (
              <option key={client.id} value={client.id}>{client.company_name}</option>
            ))}
          </select>
          <input readOnly value="Mode: Safe Missing Records" />
          <input readOnly value="Access: Platform Owner only" />
        </div>
      </div>

      <div className="table-card">
        <h2>Backup History</h2>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Company</th>
              <th>Status</th>
              <th>File</th>
              <th>Size</th>
              <th>Tables</th>
              <th>Records</th>
              <th>Created By</th>
              <th>Created</th>
              <th>Completed</th>
              <th>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {backupRows.length === 0 ? (
              <tr><td colSpan="12">No backup records yet</td></tr>
            ) : backupRows.map((item) => (
              <tr key={item.id}>
                <td>{item.backup_type || "Company"}</td>
                <td>{getBackupCompanyName(item)}</td>
                <td><Badge value={item.status || "Pending"} /></td>
                <td>
                  {item.file_url || item.signed_url ? (
                    <a href={item.file_url || item.signed_url} target="_blank" rel="noreferrer">Download</a>
                  ) : (item.file_name || "-")}
                </td>
                <td>{item.file_size || "-"}</td>
                <td>{item.tables_count ?? 0}</td>
                <td>{item.records_count ?? 0}</td>
                <td>{item.created_by || "-"}</td>
                <td>{item.created_at ? new Date(item.created_at).toLocaleString() : "-"}</td>
                <td>{item.completed_at ? new Date(item.completed_at).toLocaleString() : "-"}</td>
                <td>{item.notes || "-"}</td>
                <td className="actions">
                  {(item.file_url || item.signed_url) && <button onClick={() => window.open(item.file_url || item.signed_url, "_blank")}>Download</button>}
                  <button onClick={() => deleteSystemBackup(item.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-card">
        <h2>Restore Requests</h2>
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Status</th>
              <th>Mode</th>
              <th>Source Backup</th>
              <th>Pre-Restore Backup</th>
              <th>Requested By</th>
              <th>Created</th>
              <th>Completed</th>
              <th>Restored Records</th>
              <th>Reason</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {restoreRows.length === 0 ? (
              <tr><td colSpan="11">No restore requests yet</td></tr>
            ) : restoreRows.map((item) => {
              const sourceBackup = getRestoreSourceBackup(item);

              return (
                <tr key={item.id}>
                  <td>{getRestoreCompanyName(item)}</td>
                  <td><Badge value={item.status || "Pending"} /></td>
                  <td>{item.restore_mode || "Safe Missing Records"}</td>
                  <td>{sourceBackup?.file_name || item.backup_id || "-"}</td>
                  <td>{item.pre_restore_backup_id || "-"}</td>
                  <td>{item.requested_by_name || "-"}</td>
                  <td>{item.created_at ? new Date(item.created_at).toLocaleString() : "-"}</td>
                  <td>{item.completed_at ? new Date(item.completed_at).toLocaleString() : "-"}</td>
                  <td>{item.restored_records_count ?? 0}</td>
                  <td>{item.reason || "-"}</td>
                  <td className="actions">
                    {normalize(item.status) === "pending" && (
                      <button onClick={() => cancelRestoreRequest(item.id)}>Cancel</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
})()}


{activePage === "Central Support" && canManagePlatform && (
  <div className="page-section">
    <div className="form-card">
      <h2>{supportTicketEditingId ? "Edit Support Ticket" : "Add Support Ticket"}</h2>
      <div className="form-grid">
        <select value={supportTicketForm.client_id} onChange={(e) => updateForm(setSupportTicketForm, "client_id", e.target.value)}>
          <option value="">Select Company</option>
          {platformClients.map((client) => <option key={client.id} value={client.id}>{client.company_name}</option>)}
        </select>
        <input placeholder="Ticket No (Auto if empty)" value={supportTicketForm.ticket_no} onChange={(e) => updateForm(setSupportTicketForm, "ticket_no", e.target.value)} />
        <input placeholder="Title" value={supportTicketForm.title} onChange={(e) => updateForm(setSupportTicketForm, "title", e.target.value)} />
        <select value={supportTicketForm.priority} onChange={(e) => updateForm(setSupportTicketForm, "priority", e.target.value)}>
          {['Low','Medium','High','Urgent'].map((item) => <option key={item}>{item}</option>)}
        </select>
        <select value={supportTicketForm.status} onChange={(e) => updateForm(setSupportTicketForm, "status", e.target.value)}>
          {['Open','In Progress','Resolved'].map((item) => <option key={item}>{item}</option>)}
        </select>
        <input placeholder="Created By" value={supportTicketForm.created_by} onChange={(e) => updateForm(setSupportTicketForm, "created_by", e.target.value)} />
        <textarea placeholder="Description" value={supportTicketForm.description} onChange={(e) => updateForm(setSupportTicketForm, "description", e.target.value)} />
      </div>
      <div className="form-actions">
        <button className="save-btn" onClick={saveSupportTicket}>{supportTicketEditingId ? "Update Ticket" : "Save Ticket"}</button>
        {supportTicketEditingId && <button className="ghost-btn" onClick={resetSupportTicketForm}>Cancel</button>}
      </div>
    </div>
    <div className="table-card">
      <h2>Central Support</h2>
      <table>
        <thead><tr><th>Ticket No</th><th>Company</th><th>Title</th><th>Priority</th><th>Status</th><th>Created By</th><th>Actions</th></tr></thead>
        <tbody>
          {supportTickets.length === 0 ? <tr><td colSpan="7">No support tickets yet</td></tr> : supportTickets.map((item) => (
            <tr key={item.id}>
              <td>{item.ticket_no}</td>
              <td>{getPlatformClientName(item.client_id)}</td>
              <td>{item.title}</td>
              <td><Badge value={item.priority || "Medium"} /></td>
              <td><Badge value={item.status || "Open"} /></td>
              <td>{item.created_by || "-"}</td>
              <td className="actions"><button onClick={() => editSupportTicket(item)}>Edit</button><button onClick={() => deleteSupportTicket(item.id)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
)}

{activePage === "Rejected Candidates" && (
  <TableCard title="Rejected Candidates">
    <table>
      <thead>
        <tr>
          <th>Request No</th>
          <th>Name</th>
          <th>Profession</th>
          <th>Nationality</th>
          <th>Agency</th>
          <th>Passport</th>
          <th>Status</th>
        </tr>
      </thead>

      <tbody>
        {candidates
          .filter(
            (item) =>
              item.status === "Rejected" ||
              item.status === "Interview Failed"
          )
          .map((item) => (
            <tr key={item.id}>
              <td>{item.request_no}</td>
              <td>{item.candidate_name}</td>
              <td>{item.profession}</td>
              <td>{item.nationality}</td>
              <td>{item.agency}</td>
              <td>{item.passport_no}</td>
              <td>
                <Badge value={item.status} />
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  </TableCard>
)}
{activePage === "Master Data" && (
  <>
    <div className="dashboard-grid">
      <Stat title="Countries" value={COUNTRIES.length} />
      <Stat title="Professions" value={PROFESSIONS.length} />
    </div>

    <TableCard title="Countries">
      <table>
        <thead>
          <tr>
            <th>Country / Nationality</th>
          </tr>
        </thead>
        <tbody>
          {COUNTRIES.map((item) => (
            <tr key={item}>
              <td>{item}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>

    <TableCard title="Professions">
      <table>
        <thead>
          <tr>
            <th>Profession</th>
          </tr>
        </thead>
        <tbody>
          {PROFESSIONS.map((item) => (
            <tr key={item}>
              <td>{item}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  </>
)}


        {offerModalOpen && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15, 23, 42, 0.62)",
              zIndex: 99999,
              display: "grid",
              placeItems: "center",
              padding: "24px",
            }}
          >
            <div
              style={{
                width: "min(980px, 96vw)",
                maxHeight: "92vh",
                overflow: "auto",
                background: "#fff",
                borderRadius: "28px",
                boxShadow: "0 35px 100px rgba(0,0,0,0.32)",
                border: "1px solid #e2e8f0",
              }}
            >
              <div
                style={{
                  padding: "26px 30px",
                  background: "linear-gradient(135deg, #061a3a, #0f3b82 58%, #10b981)",
                  color: "white",
                  borderRadius: "28px 28px 0 0",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "18px", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: "13px", opacity: 0.85, fontWeight: 800 }}>AI OFFER LETTER AUTOMATION</div>
                    <h2 style={{ margin: "8px 0 6px", fontSize: "30px", letterSpacing: "-0.04em" }}>
                      Generate & Send Job Offer
                    </h2>
                    <p style={{ margin: 0, opacity: 0.88 }}>
                      Candidate: <b>{offerCandidate?.candidate_name || "-"}</b> | Email: <b>{offerCandidate?.email || "Missing"}</b>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOfferModalOpen(false)}
                    style={{
                      border: "1px solid rgba(255,255,255,0.26)",
                      background: "rgba(255,255,255,0.12)",
                      color: "#fff",
                      borderRadius: "14px",
                      padding: "10px 14px",
                      cursor: "pointer",
                      fontWeight: 900,
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>

              <div style={{ padding: "28px 30px" }}>
                <div className="dashboard-grid" style={{ marginBottom: "18px" }}>
                  <Stat title="Candidate" value={offerCandidate?.candidate_name || "-"} />
                  <Stat title="Position" value={offerCandidate?.profession || "-"} className="passed" />
                  <Stat title="Request No" value={offerCandidate?.request_no || "-"} />
                  <Stat title="Offer Status" value={offerCandidate?.offer_status || "Pending"} className="warning" />
                </div>

                <label style={{ display: "block", fontWeight: 900, marginBottom: "8px" }}>Email Subject</label>
                <input
                  value={offerSubject}
                  onChange={(e) => setOfferSubject(e.target.value)}
                  style={{
                    width: "100%",
                    height: "48px",
                    borderRadius: "14px",
                    border: "1px solid #cbd5e1",
                    padding: "0 14px",
                    boxSizing: "border-box",
                    marginBottom: "16px",
                  }}
                />

                <label style={{ display: "block", fontWeight: 900, marginBottom: "8px" }}>Offer Email Body</label>
                <textarea
                  rows="15"
                  value={offerBody}
                  onChange={(e) => setOfferBody(e.target.value)}
                  style={{
                    width: "100%",
                    borderRadius: "18px",
                    border: "1px solid #cbd5e1",
                    padding: "16px",
                    boxSizing: "border-box",
                    lineHeight: 1.7,
                    fontFamily: "inherit",
                    resize: "vertical",
                  }}
                />

                {offerMessage && (
                  <div
                    style={{
                      marginTop: "14px",
                      padding: "14px 16px",
                      borderRadius: "16px",
                      background: offerMessage.startsWith("Failed") ? "#fef2f2" : "#f0fdf4",
                      color: offerMessage.startsWith("Failed") ? "#991b1b" : "#166534",
                      border: offerMessage.startsWith("Failed") ? "1px solid #fecaca" : "1px solid #bbf7d0",
                      fontWeight: 800,
                    }}
                  >
                    {offerMessage}
                  </div>
                )}

                <div className="actions-line" style={{ marginTop: "18px", justifyContent: "space-between" }}>
                  <div style={{ color: "#64748b", lineHeight: 1.6 }}>
                    <b>Note:</b> Offer emails are sent through the secure multi-tenant email dispatcher. If company email is not verified, VisaFlow default email is used.
                  </div>
                  <div style={{ display: "flex", gap: "10px" }}>
                    <button className="light-btn" onClick={() => openOfferEmail(offerCandidate)} disabled={offerLoading}>
                      {offerLoading ? "Generating..." : "Regenerate with AI"}
                    </button>
                    <button className="save-btn" onClick={sendOfferEmail} disabled={offerLoading}>
                      {offerLoading ? "Sending..." : "Send Offer Email"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

</main>
    </div>

);
}

function Stat({ title, value, className = "" }) {
  return <div className={`stat-card ${className}`}><h3>{title}</h3><h1>{value}</h1></div>;
}
function FormCard({ title, children }) {
  return <div className="form-card"><h2>{title}</h2>{children}</div>;
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  readOnly = false,
}) {
  const inputElement = (
    <input
      type={type}
      placeholder={placeholder}
      value={value || ""}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  if (type === "date" && placeholder) {
    return (
      <label style={{ display: "grid", gap: "6px", fontWeight: 800, color: "#0f172a" }}>
        <span>{placeholder}</span>
        {inputElement}
      </label>
    );
  }

  return inputElement;
}

function TableCard({ title, children, className = "" }) {
  return (
    <div className={`table-card ${className}`}>
      <h2>{title}</h2>
      {children}
    </div>
  );
}


function Select({ value, onChange, placeholder, options = [], searchable = false }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const getOptionValue = (option) => typeof option === "object" ? String(option.value ?? "") : String(option ?? "");
  const getOptionLabel = (option) => typeof option === "object" ? String(option.label ?? option.value ?? "") : String(option ?? "");
  const selectedOption = options.find((option) => getOptionValue(option) === String(value || ""));
  const selectedLabel = selectedOption ? getOptionLabel(selectedOption) : value || "";

  if (!searchable) {
    return (
      <select value={value || ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={getOptionValue(option)} value={getOptionValue(option)}>{getOptionLabel(option)}</option>
        ))}
      </select>
    );
  }

  const filtered = options.filter((option) =>
    getOptionLabel(option).toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div style={{ position: "relative" }}>
      <input
  value={open ? query : selectedLabel}
  placeholder={placeholder}
  onFocus={() => {
    setOpen(true);
    setQuery("");
  }}
  onBlur={() => {
    setTimeout(() => {
      setOpen(false);
      setQuery("");
    }, 150);
  }}
  onKeyDown={(e) => {
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      e.target.blur();
    }
  }}
  onChange={(e) => {
    setQuery(e.target.value);
    setOpen(true);
  }}
/>

      {open && (
        <div style={{ position: "absolute", background: "#fff", border: "1px solid #ddd", maxHeight: "250px", overflowY: "auto", width: "100%", zIndex: 9999 }}>
          {filtered.slice(0, 80).map((option) => (
            <div
              key={getOptionValue(option)}
              style={{ padding: "8px", cursor: "pointer" }}
              onMouseDown={() => {
                onChange(getOptionValue(option));
                setOpen(false);
                setQuery("");
              }}
            >
              {getOptionLabel(option)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Badge({ value }) {
  const text = value || "-";
  return <span className={`badge ${String(text).toLowerCase().replaceAll(" ", "-")}`}>{text}</span>;
}

function SimpleList({ title, rows, columns }) {
  return <div className="table-card"><h2>{title}</h2><table><thead><tr>{columns.map((c) => <th key={c}>{c.replaceAll("_", " ")}</th>)}</tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={columns.length}>No data</td></tr> : rows.map((row, index) => <tr key={row.id || index}>{columns.map((c) => <td key={c}>{String(row[c] ?? "")}</td>)}</tr>)}</tbody></table></div>;
}

export default App