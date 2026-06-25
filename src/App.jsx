import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "./supabase";
import "./style.css";


const PAGES = [
  "Executive Dashboard",
  "AI Commander",
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
  "Recruitment Performance",
  "Company Management",
  "Users Management",
  "Permissions",
  "Master Data",
  "Office Portal",
  "Notifications",
  "Reports",
 "Platform Dashboard",
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
    pages: ["Executive Dashboard", "AI Commander", "Dashboard"],
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
    pages: ["Office Portal", "Agencies", "Agency Agreements", "Agency Ranking", "Agency Performance"],
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
    pages: ["Notifications", "Company Management", "Users Management", "Permissions", "Master Data"],
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

function isSaudiNationality(value) {
  const text = normalize(value || "");

  return [
    "saudi",
    "saudiarabia",
    "ksa",
    "kingdomofsaudiarabia",
    "سعودي",
    "سعودية",
    "السعودية",
    "السعوديه",
    "المملكةالعربيةالسعودية",
    "المملكهالعربيهالسعوديه",
  ].includes(text);
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
const [agreementEditingId, setAgreementEditingId] = useState(null);

const emptyAgreement = {
  agreement_no: "",
  agency_name: "",
  signed_by_company: "",
  signed_by_agency: "",
  company_signature: "",
  agency_signature: "",
  status: "Draft",
  sla_days: 60,
  effective_date: "",
  expiry_date: "",
  terms: `AGENCY SERVICE LEVEL AGREEMENT

The Recruitment Agency agrees to:
1. Update all candidate records continuously through VisaFlow KSA.
2. Maintain accurate candidate status information.
3. Respond to requests within agreed SLA timelines.
4. Complete recruitment cycle within 60 calendar days.
5. Keep all documents and recruitment data updated.
6. Accept that lack of timely updates will affect agency ranking and future allocation priority.

Failure to update records for more than 7 consecutive days may negatively impact agency performance evaluation and future allocation opportunities.`,
};

const [agreementForm, setAgreementForm] = useState(emptyAgreement);

const [marketplaceRequests, setMarketplaceRequests] = useState([]);
const [marketplaceDeals, setMarketplaceDeals] = useState([]);
const [marketplaceInvoices, setMarketplaceInvoices] = useState([]);
const [marketplaceCollections, setMarketplaceCollections] = useState([]);
const [notifications, setNotifications] = useState([]);
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
const DEFAULT_COMPANY_ID = "bed19b89-b71c-4bd3-ac64-f5f1fa734a18";
const currentCompanyId = currentUser?.company_id || DEFAULT_COMPANY_ID;

function withCompany(payload = {}) {
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
const [aiQuestion, setAiQuestion] = useState("What are the most important recruitment risks today?");
const [aiAnswer, setAiAnswer] = useState("");
const [aiLoading, setAiLoading] = useState(false);
const [aiLastRun, setAiLastRun] = useState("");
const [aiAgentLoading, setAiAgentLoading] = useState(false);
const [aiAgentLastRun, setAiAgentLastRun] = useState("");
const [aiAgentLog, setAiAgentLog] = useState("");
const [offerModalOpen, setOfferModalOpen] = useState(false);
const [offerCandidate, setOfferCandidate] = useState(null);
const [offerSubject, setOfferSubject] = useState("");
const [offerBody, setOfferBody] = useState("");
const [offerLoading, setOfferLoading] = useState(false);
const [offerMessage, setOfferMessage] = useState("");

const [platformClients, setPlatformClients] = useState([]);
const [subscriptionInvoices, setSubscriptionInvoices] = useState([]);
const [supportTickets, setSupportTickets] = useState([]);
const [systemBackups, setSystemBackups] = useState([]);
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
  "Companies Management",
  "Platform Users",
  "Subscription Invoices",
  "Company Requests Report",
  "Backup Center",
  "Central Support",
];

const PLATFORM_ACCOUNT_PAGES = [
  "Platform Dashboard",
  "Companies Management",
  "Platform Users",
  "Subscription Invoices",
  "Company Requests Report",
  "Backup Center",
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
    "Dashboard",
    "Recruitment Performance",
    "Agency Ranking",
    "Agency Performance",
    "Reports",
    "Notifications",
  ],

  // Operations Manager: operational delivery, workforce, mobilization and demobilization.
  "Operations Manager": [
    "Executive Dashboard",
    "AI Commander",
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
    "Recruitment Performance",
    "Notifications",
    "Reports",
  ],

  // Recruiter / Recruitment Officer: daily recruitment operation only.
  "Recruitment Officer": [
    "Dashboard",
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
const canViewAgenciesOnly = ["CEO", "Operations Manager"].includes(currentRole);

const canCreateRequest = ["Admin", "Operations Manager", "Project Manager", "Recruitment Manager", "Recruitment Officer"].includes(currentRole);
const canEditRequest = ["Admin", "Operations Manager", "Project Manager", "Recruitment Manager", "Recruitment Officer"].includes(currentRole);
const canApproveRequest = ["Admin", "Recruitment Manager"].includes(currentRole);
const canDeleteRequest = currentRole === "Admin";

const canManageVisas = ["Admin", "Visa Team"].includes(currentRole);
const canManageCandidates = ["Admin", "Recruitment Manager", "Recruitment Officer"].includes(currentRole);
const canManageOfficePortal = ["Admin", "Agency"].includes(currentRole);
const canManageInterviews = ["Admin", "Recruitment Manager", "Recruitment Officer"].includes(currentRole);
const canManageMobilization = ["Admin", "Recruitment Manager", "Recruitment Officer", "Operations Manager", "Project Manager"].includes(currentRole);
const canManageDemobilization = ["Admin", "Operations Manager", "Project Manager"].includes(currentRole);
const canManageEmployees = ["Admin", "Operations Manager", "Project Manager"].includes(currentRole);
const canManageMarketplace = ["Admin", "Recruitment Manager", "Operations Manager"].includes(currentRole);
const canExport = hasAction("export") || ["Admin", "CEO", "Operations Manager", "Project Manager", "Recruitment Manager", "Visa Team", "Viewer"].includes(currentRole);

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
  .filter(
    (a) =>
      String(a.visa_no) === String(selectedVisa?.visa_no) &&
      String(a.request_no) === String(selectedVisa?.request_no) &&
      a.status !== "Cancelled"
  )
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
  setSelectedVisa(item);
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

  if (
    normalize(req.profession) !== normalize(selectedLine.profession) ||
    normalize(req.nationality) !== normalize(selectedLine.nationality) ||
    normalize(req.gender) !== normalize(selectedLine.gender)
  ) {
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
       loadCountries(),
  loadProfessions(),
      loadCandidates(),
      loadInterviews(),
      loadUsers(),
      loadCompanies(),
      loadAuditLogs(),
      loadMobilizations(),
      loadEmployees(),
      loadDemobilizations(),
      loadMarketplaceRequests(),
      loadMarketplaceDeals(),
      loadMarketplaceInvoices(),
      loadMarketplaceCollections(),
      loadNotifications(),
      loadPlatformClients(),
      loadSubscriptionInvoices(),
      loadSupportTickets(),
      loadSystemBackups(),
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

  if (currentRole === "Agency" && agencyBlockedTables.includes(table)) {
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
  const loadAgencies = () => loadTable("agencies", setAgencies);
  const loadAgencyAgreements = () => loadTable("agency_agreements", setAgencyAgreements);
  const loadAgencyScores = () => loadTable("agency_scores", setAgencyScores);
  const loadAgencyScoreHistory = () => loadTable("agency_score_history", setAgencyScoreHistory);
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

    return loadTable("users", setUsers);
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

  async function loadNotifications() {
    if (!currentCompanyId) return setNotifications([]);

    let query = supabase
      .from("notification_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (currentCompanyId) {
      query = query.eq("company_id", currentCompanyId);
    }

    if (currentRole === "Agency" && currentUser?.agency_id) {
      query = query.eq("agency_id", currentUser.agency_id);
    }

    const { data, error } = await query;

    if (error) {
      console.warn("notification_events:", error.message);
      setNotifications([]);
      return;
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
  if (currentUser) loadAll();
}, [currentUser]);

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
  if (!userForm.password) return alert("Password is required.");
  if (userForm.role === "Agency" && !userForm.agency_name) {
    return alert("Please select the agency for this Agency user.");
  }
  const existingUser = users.find(
  (u) =>
    u.email?.trim().toLowerCase() === userForm.email?.trim().toLowerCase() &&
    u.id !== userEditingId
);

if (existingUser) {
  return alert("Email already exists");
}

  const savingPlatformUser =
    canManagePlatformAccounts && activePage === "Platform Users";

  const effectiveRole = savingPlatformUser
    ? (isPlatformRole(userForm.role) ? userForm.role : "Platform Accounts User")
    : (userForm.role || "Viewer");

  const payload = {
    name: userForm.name,
    email: userForm.email.trim().toLowerCase(),
    password: userForm.password.trim(),
    role: effectiveRole,
    status: userForm.status || "Active",
    agency_id: effectiveRole === "Agency" ? (userForm.agency_id || null) : null,
    agency_name: effectiveRole === "Agency" ? (userForm.agency_name || "") : "",
  };

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
  loadUsers();
}
  async function saveAgency() {
    if (!agencyForm.name) return alert("Agency name is required.");
    const payload = { ...agencyForm, updated_at: new Date().toISOString() };
    const result = agencyEditingId
      ? await supabase.from("agencies").update(payload).eq("id", agencyEditingId)
      : await supabase.from("agencies").insert([withCompany(payload)]);
    if (result.error) return alert(result.error.message);
    resetAgencyForm();
    loadAgencies();
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
    if (!window.confirm("Delete this agency?")) return;
    const { error } = await supabase.from("agencies").delete().eq("id", id);
    if (error) return alert(error.message);
    loadAgencies();
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
    signed_by_company: item.signed_by_company || "",
    signed_by_agency: item.signed_by_agency || "",
    company_signature: item.company_signature || "",
    agency_signature: item.agency_signature || "",
    status: item.status || "Draft",
    sla_days: item.sla_days || 60,
    effective_date: item.effective_date || "",
    expiry_date: item.expiry_date || "",
    terms: item.terms || emptyAgreement.terms,
  });
  setActivePage("Agency Agreements");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function saveAgreement() {
  if (!canManageAgencyAgreements) return alert("You do not have permission to manage agency agreements.");
  if (!agreementForm.agency_name) return alert("Agency name is required.");

  const payload = {
    ...agreementForm,
    sla_days: Number(agreementForm.sla_days || 60),
    effective_date: agreementForm.effective_date || null,
    expiry_date: agreementForm.expiry_date || null,
    updated_at: new Date().toISOString(),
  };

  const result = agreementEditingId
    ? await supabase
        .from("agency_agreements")
        .update(payload)
        .eq("id", agreementEditingId)
        .eq("company_id", currentCompanyId)
    : await supabase.from("agency_agreements").insert([withCompany(payload)]);

  if (result.error) return alert(result.error.message);

  alert(agreementEditingId ? "Agreement updated successfully" : "Agreement saved successfully");
  resetAgreementForm();
  await loadAgencyAgreements();
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
    setCandidateEditingId(null);
  }

  function editCandidate(item) {
    setCandidateEditingId(item.id);
    setCandidateForm({
      candidate_name: item.candidate_name || "",
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

const payload = {
  ...candidateForm,
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
  updated_at: new Date().toISOString(),
};
    const result = candidateEditingId
      ? await supabase.from("candidates").update(payload).eq("id", candidateEditingId)
      : await supabase.from("candidates").insert([withCompany(payload)]);

    if (result.error) return alert(result.error.message);

    await supabase.from("notification_events").insert([withCompany({
      user_id: null,
      agency_id: currentRole === "Agency" ? currentUser?.agency_id || null : null,
      type: candidateEditingId ? "CANDIDATE_UPDATED" : "CANDIDATE_CREATED",
      title: candidateEditingId ? "Candidate Updated" : "New Candidate Added",
      message: `${candidateForm.candidate_name || "Candidate"} / ${candidateForm.request_no || "No Request"} / ${autoStatus}`,
      priority: "Medium",
      status: "Unread",
      related_table: "candidates",
      related_id: String(candidateEditingId || result.data?.[0]?.id || ""),
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
  }

  async function deleteCandidate(id) {
    if (!canManageCandidates) return alert("You do not have permission to delete candidates.");
    if (!window.confirm("Delete this candidate?")) return;
    const { error } = await supabase.from("candidates").delete().eq("id", id);
    if (error) return alert(error.message);
    loadCandidates();
    loadRequests();
  }

  function startExcelUploadFromRequest(item) {
    setExcelRequestNo(item.request_no || "");
    setTimeout(() => requestExcelInputRef.current?.click(), 0);
  }

  function startExcelUploadFromCandidates() {
    setExcelRequestNo("");
    setTimeout(() => candidateExcelInputRef.current?.click(), 0);
  }

  async function handleExcelUpload(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    if (!rows.length) return alert("Excel file is empty.");

    const requestNoFromExcel = getRowValue(rows[0], ["Request No", "RequestNo", "request_no"]);
    const requestNo = excelRequestNo ? excelRequestNo : requestNoFromExcel;

    if (!requestNo) {
      return alert("Request No is required. Please upload from the Request row.");
    }

    const { data: requestData, error: requestError } = await supabase
      .from("requests")
      .select("request_no, quantity, profession, nationality, gender, project_name, approval_status")
      .eq("request_no", requestNo)
      .eq("company_id", currentCompanyId)
      .single();

    if (requestError || !requestData) return alert("Request not found.");
if (requestData.approval_status !== "Approved by Recruitment" && requestData.approval_status !== "Approved") {
  return alert("Candidates cannot be uploaded until the request is approved.");
}
    const { count, error: countError } = await supabase
      .from("candidates")
      .select("*", { count: "exact", head: true })
      .eq("request_no", requestNo)
      .eq("company_id", currentCompanyId);

    if (countError) return alert(countError.message);

    const remaining = Number(requestData.quantity || 0) - Number(count || 0);

    if (rows.length > remaining) {
      alert(`لا يمكن رفع عدد أكبر من المتبقي.\n\nالمتبقي: ${remaining}\nعدد الملف: ${rows.length}`);
      return;
    }

    let inserted = 0;
    let skipped = 0;
    const errors = [];

    for (const row of rows) {
      const candidateName = getRowValue(row, ["Name", "Candidate Name", "candidate_name"]);

      if (!candidateName) {
        skipped++;
        errors.push("Unnamed row: Candidate name is missing");
        continue;
      }
const passportNo = getRowValue(
  row,
  ["Passport No", "Passport", "PassportNo"]
);

if (passportNo) {
  const { data: existing } = await supabase
    .from("candidates")
    .select("id")
    .eq("passport_no", passportNo)
    .eq("nationality", requestData.nationality)
    .eq("company_id", currentCompanyId)
    .limit(1);

  if (existing && existing.length > 0) {
    skipped++;
    errors.push(
      `${candidateName}: Passport already exists (${passportNo})`
    );
    continue;
  }
}
let autoStatus = candidateForm.status;

if (candidateForm.arrival_date) {
  autoStatus = "Arrived KSA";
} else if (candidateForm.flight_date) {
  autoStatus = "Departure";
} else if (candidateForm.ticket_no) {
  autoStatus = "Ticket Booked";
} else if (candidateForm.medical_status === "Passed") {
  autoStatus = "Medical Passed";
}

      const payload = {
        candidate_name: candidateName,
        

        profession: requestData.profession || "",
        nationality: requestData.nationality || "",
        gender: requestData.gender || "",
        project: requestData.project_name || "",
        request_no: requestData.request_no || requestNo,

        agency: currentRole === "Agency" ? (currentUser?.agency_name || "") : getRowValue(row, ["Agency", "Office"]),
        passport_no: passportNo,
        mobile: getRowValue(row, ["Mobile", "Phone"]),
        notes: getRowValue(row, ["Notes", "Note", "ملاحظات"]),
        status: "New",
      };

      const { error } = await supabase.from("candidates").insert([withCompany(payload)]);

      if (error) {
        skipped++;
errors.push("[" + candidateName + "] - " + error.message);      } else {
        inserted++;
      }
    }
alert(
"Uploaded: " + inserted + " candidate(s)\n\n" +
"Skipped: " + skipped + " candidate(s)\n\n" +
(errors.length
 ? "Reasons:\n" + errors.slice(0,5).join("\n")
 : "")
);
   const newRemaining = Math.max(
0,
Number(requestData.quantity || 0) -
(Number(count || 0) + inserted)
);

await supabase
.from("requests")
.update({
    remaining: newRemaining,
    status: newRemaining === 0
        ? "Visa Process"
        : "Under Recruitment",
    updated_at: new Date().toISOString(),
})
.eq("request_no", requestNo)
.eq("company_id", currentCompanyId);

loadCandidates();
loadRequests();
setActivePage("Candidates");
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
  function createCandidateFromRequest(item) {
  if (!canManageCandidates) return alert("You do not have permission to add candidates.");
  resetCandidateForm();

  const lines = getRequestLinesForRequest(item);
  const firstLine = lines[0] || item;

  setCandidateForm({
    ...emptyCandidate,
    profession: firstLine.profession || item.profession || "",
    nationality: firstLine.nationality || item.nationality || "",
    gender: firstLine.gender || item.gender || "",
    project: item.project_name || "",
    request_no: item.request_no || "",
    source: isSaudiRequest(item) ? "Jadarat" : "",
    offer_status: "Pending",
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


function getCandidateSlaStagnation(candidate) {
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
    return { days: 0, isStale: false, risk: "Low", lastUpdate: lastUpdate || "", stage: status };
  }

  const days = Math.floor((new Date() - new Date(lastUpdate)) / (1000 * 60 * 60 * 24));
  const isTracked = trackedStatuses.includes(status) || Boolean(candidate?.agency);
  const isStale = isTracked && days > 7;
  const risk = days >= 14 ? "High" : days > 7 ? "Medium" : "Low";

  return { days: Number.isFinite(days) ? days : 0, isStale, risk, lastUpdate, stage: status };
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
        penalty: Math.min(Math.max(stagnation.days - 7, 1) * 2, 15),
        recommendation:
          stagnation.risk === "High"
            ? "Escalate immediately to Recruitment Manager and hold new agency allocation until update is received."
            : "Send follow-up to agency and require candidate status update within 24 hours.",
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.days_without_update || 0) - Number(a.days_without_update || 0));
}

async function generateSlaEscalationNotifications() {
  const alerts = getAgencySlaEscalationAlerts();
  if (!alerts.length) return alert("No SLA escalation alerts. All agency updates are within the 7-day rule.");

  const payload = alerts.slice(0, 50).map((item) => {
    const agency = agencies.find((a) => normalize(a.name) === normalize(item.agency));
    return {
      company_id: currentCompanyId,
      agency_id: agency?.id || null,
      type: "SLA_ESCALATION_ALERT",
      title: "SLA Escalation Alert",
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

  alert(`SLA escalation alerts generated: ${payload.length}`);
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
      const agencyCandidates = candidates.filter((candidate) => normalize(candidate.agency) === normalize(agencyName));
      const agencyInterviews = interviews.filter((interview) => normalize(interview.agency) === normalize(agencyName));
      const agencyAuthorizations = visaAuthorizations.filter((authorization) => normalize(authorization.agency) === normalize(agencyName));
      const activeAuthorizations = agencyAuthorizations.filter((authorization) => authorization.status !== "Cancelled");
      const signedAgreement = agencyAgreements.some((agreement) => normalize(agreement.agency_name) === normalize(agencyName) && agreement.status === "Active");

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
      const stalePenalty = Math.min(staleCandidates.length * 5, 30);

      const recentUpdates = agencyCandidates.filter((candidate) => {
        const updated = candidate.updated_at || candidate.created_at;
        if (!updated) return false;
        const days = Math.floor((today - new Date(updated)) / (1000 * 60 * 60 * 24));
        return days <= 7;
      }).length;
      const rawUpdateScore = submitted ? Math.round((recentUpdates / submitted) * 100) : 0;
      const updateScore = Math.max(0, rawUpdateScore - stalePenalty);

      const baseSlaScore = agencyCandidates.length
        ? Math.round(
            (agencyCandidates.filter((candidate) => {
              const req = requests.find((request) => String(request.request_no || "") === String(candidate.request_no || ""));
              const start = req?.created_at || candidate.created_at;
              const end = candidate.joining_date || candidate.arrival_date || candidate.updated_at || candidate.created_at;
              if (!start || !end) return false;
              const days = Math.floor((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24));
              return days <= 60;
            }).length / agencyCandidates.length) * 100
          )
        : 0;
      const slaScore = Math.max(0, baseSlaScore - stalePenalty);

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
      if (rank === "Platinum") recommendation = "Preferred agency. Increase allocations for matching professions and countries.";
      else if (rank === "Gold") recommendation = "Strong agency. Continue allocations with normal follow-up.";
      else if (rank === "Silver") recommendation = "Acceptable agency. Follow up on weak indicators before increasing volume.";
      else recommendation = "Under review. Hold new allocations until performance improves.";
      if (staleCandidates.length > 0) {
        recommendation = `${staleCandidates.length} stale candidate update(s) over 7 days. Escalate to agency and Recruitment Manager before new allocation.`;
      }

      return {
        agency_id: agency?.id || null,
        agency_name: agencyName,
        authorizedQty,
        candidates: submitted,
        passedInterviews,
        rejectedInterviews,
        arrived,
        joined,
        failed,
        stale_candidates: staleCandidates.length,
        stale_penalty: stalePenalty,
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

function buildRequestHealthRows() {
  return mobilizationRequestRows
    .map((row) => {
      const visaGap = row.isSaudi ? 0 : Math.max(Number(row.qty || 0) - Number(row.allocatedVisaQty || 0), 0);
      const candidateGap = Math.max(Number(row.qty || 0) - Number(row.candidates || 0), 0);
      const joiningGap = Math.max(Number(row.qty || 0) - Number(row.joined || 0), 0);
      const riskPoints =
        (row.progress < 30 ? 35 : row.progress < 60 ? 20 : 0) +
        (candidateGap > 0 ? 15 : 0) +
        (visaGap > 0 ? 20 : 0) +
        (joiningGap > 0 ? 10 : 0) +
        (row.status === "Cancelled" ? 30 : 0);

      const riskScore = Math.min(100, riskPoints);
      const riskLevel = riskScore >= 60 ? "High" : riskScore >= 30 ? "Medium" : "Low";

      let recommendation = "Keep monitoring until joining is completed.";
      if (visaGap > 0) recommendation = "Secure matching visa balance or change nationality/profession plan.";
      else if (candidateGap > 0) recommendation = "Push sourcing and agency submissions immediately.";
      else if (row.interviewRequired !== "No Interview" && row.interviewPassed < row.qty) recommendation = "Schedule/complete interviews and close selection gap.";
      else if (!row.isSaudi && row.medicalDone < row.qty) recommendation = "Accelerate medical and embassy readiness.";
      else if (!row.isSaudi && row.ticketIssued < row.qty) recommendation = "Finalize ticketing plan for ready candidates.";
      else if (joiningGap > 0) recommendation = "Follow up arrival, onboarding, and site joining.";

      return {
        ...row,
        visaGap,
        candidateGap,
        joiningGap,
        riskScore,
        riskLevel,
        recommendation,
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore);
}

function buildRecruitmentForecast() {
  const openRows = mobilizationRequestRows.filter((row) => row.status !== "Completed" && row.status !== "Closed");
  const totalRemainingRecruitment = openRows.reduce((sum, row) => sum + Number(row.remaining || 0), 0);
  const totalRemainingJoining = openRows.reduce((sum, row) => sum + Number(row.remainingJoining || 0), 0);
  const arrivingNext30 = executiveDashboard.arrivalsNext30Days.length;
  const avgProgress = openRows.length
    ? Math.round(openRows.reduce((sum, row) => sum + Number(row.progress || 0), 0) / openRows.length)
    : 0;
  const highRiskRequests = buildRequestHealthRows().filter((row) => row.riskLevel === "High").length;

  let forecastMessage = "Pipeline is stable if current pace continues.";
  if (highRiskRequests > 0) forecastMessage = "High-risk requests may affect project mobilization unless escalated.";
  else if (totalRemainingRecruitment > 0) forecastMessage = "Recruitment still requires active sourcing to close open gaps.";
  else if (totalRemainingJoining > 0) forecastMessage = "Main focus should shift from recruitment to joining and site onboarding.";

  return {
    openRequests: openRows.length,
    totalRemainingRecruitment,
    totalRemainingJoining,
    arrivingNext30,
    avgProgress,
    highRiskRequests,
    forecastMessage,
  };
}

function buildAICommanderSnapshot() {
  const agencyScorecard = buildAgencyScorecard();
  const requestHealth = buildRequestHealthRows();
  const forecast = buildRecruitmentForecast();

  const topDelayed = reports.lateItems.slice(0, 10).map((item) => ({
    type: item.type,
    reference: item.reference,
    name: item.name,
    days: item.days,
    status: item.status,
  }));

  const visaShortage = requestsWithoutVisa.slice(0, 10).map((request) => ({
    request_no: request.request_no,
    project: request.project_name || request.project || "-",
    profession: request.profession || "-",
    nationality: request.nationality || "-",
    gender: request.gender || "-",
    required: Number(request.quantity || 0),
    available: getVisaBalanceForRequest(request),
    shortage: Math.max(Number(request.quantity || 0) - getVisaBalanceForRequest(request), 0),
  }));

  return {
    generated_at: new Date().toISOString(),
    company_system: "VisaFlow KSA",
    executive_dashboard: {
      total_required: executiveDashboard.totalRequired,
      open_requests: executiveDashboard.openRequests,
      under_recruitment: executiveDashboard.underRecruitment,
      completed_requests: executiveDashboard.completedRequests,
      active_candidates: executiveDashboard.activeCandidates,
      recruitment_progress: `${executiveDashboard.recruitmentProgress}%`,
      saudi_requests: executiveDashboard.saudiRequests,
      foreign_requests: executiveDashboard.foreignRequests,
      saudization_rate: `${executiveDashboard.saudizationRate}%`,
      available_visas: executiveDashboard.availableVisas,
      allocated_visas: executiveDashboard.allocatedVisas,
      open_authorizations: executiveDashboard.openAuthorizations,
      cancelled_authorizations: executiveDashboard.cancelledAuthorizations,
      medical_passed: executiveDashboard.medicalPassed,
      tickets_issued: executiveDashboard.ticketsIssued,
      arrived_ksa: executiveDashboard.arrived,
      joined: executiveDashboard.joined,
    },
    forecast,
    critical_alerts: {
      delayed_items: topDelayed,
      visa_shortage: visaShortage,
      authorizations_without_candidates: reports.authorizationsWithoutCandidates.slice(0, 10).map((a) => ({
        visa_no: a.visa_no,
        authorization_no: a.authorization_no,
        agency: a.agency,
        allocated_qty: a.allocated_qty,
        status: a.status,
      })),
      candidates_without_interviews: reports.candidatesWithoutInterviews.slice(0, 10).map((c) => ({
        candidate: c.candidate_name,
        request_no: c.request_no,
        profession: c.profession,
        status: c.status,
      })),
    },
    request_health: requestHealth.slice(0, 12),
    agency_scorecard: agencyScorecard.slice(0, 12),
    top_projects: executiveDashboard.topProjects,
    arrivals_next_30_days: executiveDashboard.arrivalsNext30Days,
  };
}

function getLocalAICommanderBrief() {
  const agencyScorecard = buildAgencyScorecard();
  const requestHealth = buildRequestHealthRows();
  const forecast = buildRecruitmentForecast();
  const delayed = reports.lateItems.length;
  const shortage = requestsWithoutVisa.length;
  const noCandidates = reports.authorizationsWithoutCandidates.length;
  const highRiskRequests = requestHealth.filter((row) => row.riskLevel === "High").length;
  const topAgency = agencyScorecard[0];
  const weakestAgency = agencyScorecard[agencyScorecard.length - 1];

  return [
    `VisaFlow AI Commander - Executive Brief`,
    ``,
    `Overall risk: ${delayed + shortage + noCandidates + highRiskRequests} item(s) require management attention.`,
    `- Open requests: ${executiveDashboard.openRequests}`,
    `- Recruitment progress: ${executiveDashboard.recruitmentProgress}%`,
    `- Delayed SLA items: ${delayed}`,
    `- Foreign requests with visa shortage: ${shortage}`,
    `- Authorizations without candidates: ${noCandidates}`,
    `- High-risk requests: ${highRiskRequests}`,
    `- Saudization rate: ${executiveDashboard.saudizationRate}%`,
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
    `1. Escalate high-risk requests and assign an owner for each request today.`,
    `2. Resolve visa shortages before adding more candidates to foreign requests.`,
    `3. Push offices/agencies with open authorizations but no submitted candidates.`,
    `4. Move ready candidates from medical/visa stages to ticketing and arrival.`,
    `5. Use Saudi Hiring path for Saudi positions and hide visa/ticket steps from the Saudi workflow.`,
  ].filter(Boolean).join("\n");
}

async function runAICommander(question = aiQuestion) {
  const apiKey = import.meta.env?.VITE_OPENAI_API_KEY;
  const snapshot = buildAICommanderSnapshot();

  if (!apiKey) {
    setAiAnswer(getLocalAICommanderBrief());
    setAiLastRun(new Date().toLocaleString());
    return;
  }

  setAiLoading(true);
  setAiAnswer("");

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.15,
        max_output_tokens: 1200,
        input: [
          {
            role: "system",
            content:
              "You are VisaFlow AI Commander for a Saudi recruitment, visa authorization, manpower mobilization, and O&M workforce platform. Act like a Recruitment Director briefing a CEO. Use only the provided data. Provide: Executive Summary, Critical Risks, Root Causes, Recommended Actions, Agency Follow-up, and Forecast. Keep it practical, decisive, and concise. Never invent numbers beyond the JSON.",
          },
          {
            role: "user",
            content: `Question: ${question}\n\nOperational snapshot JSON:\n${JSON.stringify(snapshot, null, 2)}`,
          },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error?.message || "OpenAI request failed");
    }

    const outputText =
      data.output_text ||
      data.output
        ?.flatMap((item) => item.content || [])
        ?.map((content) => content.text || "")
        ?.join("\n") ||
      "No AI response returned.";

    setAiAnswer(outputText);
    setAiLastRun(new Date().toLocaleString());
  } catch (error) {
    setAiAnswer(`AI connection failed: ${error.message}\n\nFallback local summary:\n\n${getLocalAICommanderBrief()}`);
  } finally {
    setAiLoading(false);
  }
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

async function runAIAgentAgencyFollowUp() {
  if (!canManageAgencyAgreements && !canManageCandidates && !canManageVisas) {
    return alert("You do not have permission to run AI Agent follow-up.");
  }

  const tasks = getAIAgentAgencyTasks();
  if (!tasks.length) {
    setAiAgentLog("No agency follow-up tasks found. All agencies are within current follow-up rules.");
    setAiAgentLastRun(new Date().toLocaleString());
    return alert("No agency follow-up tasks found.");
  }

  setAiAgentLoading(true);
  setAiAgentLog("");

  try {
    const selectedTasks = tasks.slice(0, 50);

    for (const task of selectedTasks) {
      const email = buildAIAgentAgencyEmail(task);
      await triggerExternalNotification("AI_AGENT_AGENCY_FOLLOWUP", {
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
        source: "AI Commander / AI Agent",
        delivery_channel: "Notification + Webhook/Email Automation",
        task,
      });
    }

    const summary = `AI Agent completed follow-up preparation for ${selectedTasks.length} item(s).\n\n` +
      selectedTasks.slice(0, 10).map((task, index) => `${index + 1}. [${task.priority}] ${task.agency} - ${task.title}`).join("\n") +
      (selectedTasks.length > 10 ? `\n...and ${selectedTasks.length - 10} more.` : "");

    setAiAgentLog(summary);
    setAiAgentLastRun(new Date().toLocaleString());
    alert(`AI Agent follow-up created: ${selectedTasks.length} item(s).`);
    await loadNotifications();
  } catch (error) {
    setAiAgentLog(`AI Agent failed: ${error.message}`);
    alert(error.message);
  } finally {
    setAiAgentLoading(false);
  }
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
  const apiKey = import.meta.env?.VITE_OPENAI_API_KEY;
  const data = getCandidateOfferData(candidate);

  if (!apiKey) return buildOfferBody(candidate);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.2,
        max_output_tokens: 600,
        input: [
          {
            role: "system",
            content:
              "You are an HR Recruitment Director. Generate a professional job offer email in clear business English. Keep it concise, formal, and ready to send. Do not invent benefits or legal terms beyond the provided data.",
          },
          {
            role: "user",
            content: `Generate a job offer email using this data:\n${JSON.stringify(data, null, 2)}`,
          },
        ],
      }),
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result?.error?.message || "OpenAI offer generation failed");

    return (
      result.output_text ||
      result.output
        ?.flatMap((item) => item.content || [])
        ?.map((content) => content.text || "")
        ?.join("\n") ||
      buildOfferBody(candidate)
    );
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
    const offerWebhookUrl = import.meta.env?.VITE_OFFER_EMAIL_WEBHOOK_URL;
    console.log("OFFER WEBHOOK URL =", offerWebhookUrl);
console.log("OFFER PAYLOAD =", payload);
    const resendApiKey = import.meta.env?.VITE_RESEND_API_KEY;
    const fromEmail = import.meta.env?.VITE_RESEND_FROM_EMAIL || "VisaFlow KSA <onboarding@resend.dev>";

    let deliveryStatus = "QUEUED";
    let providerMessage = "Offer email request has been saved.";

    if (offerWebhookUrl) {
      const response = await fetch(offerWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error(`Email webhook failed: ${response.status}`);
      deliveryStatus = "SENT_TO_WEBHOOK";
      providerMessage = "Offer email sent to email automation webhook.";
    } else if (resendApiKey) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [offerCandidate.email],
          subject: offerSubject,
          text: offerBody,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || data?.error?.message || "Resend email failed");
      deliveryStatus = "SENT";
      providerMessage = `Offer email sent successfully${data?.id ? ` (${data.id})` : ""}.`;
    } else {
      providerMessage = "Offer email prepared and logged. Add VITE_OFFER_EMAIL_WEBHOOK_URL or VITE_RESEND_API_KEY to send automatically.";
    }

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
  if (!canManagePlatform) return alert("You do not have permission to create backups.");

  const payload = {
    client_id: clientId || null,
    backup_type: clientId ? "Company" : "Full System",
    status: "Completed",
    file_url: "",
    notes: clientId ? `Manual backup record for ${getPlatformClientName(clientId)}` : "Manual full system backup record",
  };

  const { error } = await supabase.from("system_backups").insert([payload]);
  if (error) return alert(error.message);

  await loadSystemBackups();
  alert("Backup record created successfully");
}

async function deleteSystemBackup(id) {
  if (!canManagePlatform) return alert("You do not have permission to delete backups.");
  if (!window.confirm("Delete this backup record?")) return;
  const { error } = await supabase.from("system_backups").delete().eq("id", id);
  if (error) return alert(error.message);
  await loadSystemBackups();
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
  if (activePage === "Reports") return exportRowsToExcel(reports.requestLifecycle, "VisaFlow_Recruitment_Pipeline", "Pipeline");
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
        </div>
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
              {activePage === "Candidates" && canManageCandidates && <button className="new-btn" onClick={startExcelUploadFromCandidates}>Upload Excel</button>}
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
            <TableCard title="Notification Center">
              <div className="actions-line" style={{ marginBottom: "14px" }}>
                <button className="new-btn" onClick={loadNotifications}>Refresh Notifications</button>
                <button className="new-btn" onClick={markAllNotificationsRead}>Mark All as Read</button>
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
                    {notifications.length === 0 ? (
                      <tr>
                        <td colSpan="7" style={{ textAlign: "center", color: "#64748b", padding: "24px" }}>
                          No notifications found.
                        </td>
                      </tr>
                    ) : (
                      notifications.map((item) => (
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
                        ["Visa Gaps", requestsWithoutVisa.length],
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
                      requestsWithoutVisa.length +
                      reports.authorizationsWithoutCandidates.length +
                      buildRequestHealthRows().filter((row) => row.riskLevel === "High").length
                    }
                    className={executiveAlertClass(
                      reports.lateItems.length +
                      requestsWithoutVisa.length +
                      reports.authorizationsWithoutCandidates.length +
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

            <TableCard title="💬 Ask VisaFlow AI Commander">
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "12px", marginBottom: "12px" }}>
                <input
                  value={aiQuestion}
                  onChange={(e) => setAiQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runAICommander()}
                  placeholder="Ask about delayed requests, visa shortages, agency performance, project risk, Saudization, forecast..."
                  style={{ height: "50px", borderRadius: "14px", border: "1px solid #cbd5e1", padding: "0 14px", fontSize: "15px" }}
                />
                <button className="save-btn" onClick={() => runAICommander()} disabled={aiLoading}>
                  {aiLoading ? "Analyzing..." : "Run AI Analysis"}
                </button>
              </div>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px" }}>
                {[
                  "Give me a CEO executive summary.",
                  "Which requests are at highest risk and why?",
                  "Rank agencies and show who needs follow-up.",
                  "Show visa shortages and recommended actions.",
                  "Forecast recruitment and joining gaps for the next 30 days.",
                  "Analyze Saudization and local hiring progress."
                ].map((prompt) => (
                  <button
                    key={prompt}
                    className="light-btn"
                    onClick={() => {
                      setAiQuestion(prompt);
                      runAICommander(prompt);
                    }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              <div
                style={{
                  minHeight: "260px",
                  borderRadius: "20px",
                  padding: "22px",
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.75,
                  color: "#0f172a",
                  fontSize: "15px",
                }}
              >
                {aiAnswer || "Click Run AI Analysis to generate a CEO-ready executive brief from your live VisaFlow data."}
              </div>

              {aiLastRun && <p style={{ color: "#64748b", marginTop: "10px" }}>Last AI run: {aiLastRun}</p>}
            </TableCard>

            <div className="grid">
              <TableCard title="🔥 Request Health Analyzer">
                <table>
                  <thead>
                    <tr>
                      <th>Request No</th>
                      <th>Project</th>
                      <th>Qty</th>
                      <th>Candidates</th>
                      <th>Joined</th>
                      <th>Progress</th>
                      <th>Risk</th>
                      <th>AI Recommendation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buildRequestHealthRows().slice(0, 10).length === 0 ? (
                      <tr><td colSpan="8">No request health data</td></tr>
                    ) : (
                      buildRequestHealthRows().slice(0, 10).map((row) => (
                        <tr key={row.request_no}>
                          <td>
                            <button className="link-btn" onClick={() => {
                              const req = requests.find((request) => request.request_no === row.request_no);
                              if (req) openRequestDetails(req);
                            }}>
                              {row.request_no}
                            </button>
                          </td>
                          <td>{row.project_name}</td>
                          <td>{row.qty}</td>
                          <td>{row.candidates}</td>
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
                          <td><Badge value={`${row.riskLevel} (${row.riskScore})`} /></td>
                          <td>{row.recommendation}</td>
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
              <TableCard title="🛂 AI Detected Visa Shortage">
                <table>
                  <thead>
                    <tr>
                      <th>Request No</th>
                      <th>Project</th>
                      <th>Profession</th>
                      <th>Nationality</th>
                      <th>Required</th>
                      <th>Available</th>
                      <th>Shortage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requestsWithoutVisa.length === 0 ? (
                      <tr><td colSpan="7">No visa shortage detected</td></tr>
                    ) : (
                      requestsWithoutVisa.slice(0, 8).map((request) => {
                        const available = getVisaBalanceForRequest(request);
                        const required = Number(request.quantity || 0);
                        return (
                          <tr key={request.id}>
                            <td>{request.request_no}</td>
                            <td>{request.project_name || "-"}</td>
                            <td>{request.profession || "-"}</td>
                            <td>{request.nationality || "-"}</td>
                            <td>{required}</td>
                            <td>{available}</td>
                            <td><Badge value={Math.max(required - available, 0)} /></td>
                          </tr>
                        );
                      })
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
              <Stat title="Saudi Requests" value={requests.filter(isSaudiRequest).length} className="passed" />
              <Stat title="Saudi Required" value={requests.filter(isSaudiRequest).reduce((sum, r) => sum + Number(r.quantity || r.qty || 0), 0)} />
              <Stat title="Saudi Candidates" value={candidates.filter((c) => isSaudiCandidate(c, requests)).length} className="passed" />
              <Stat title="Offers Accepted" value={candidates.filter((c) => isSaudiCandidate(c, requests) && ["Accepted", "Joined"].includes(c.offer_status)).length} className="passed" />
              <Stat title="Joined Saudis" value={candidates.filter((c) => isSaudiCandidate(c, requests) && (c.status === "Joined" || c.joining_date)).length} className="passed" />
            </div>

            <TableCard title="Saudi Hiring Requests">
              <table>
                <thead>
                  <tr>
                    <th>Request No</th>
                    <th>Project</th>
                    <th>Profession</th>
                    <th>Qty</th>
                    <th>Candidates</th>
                    <th>Joined</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.filter(isSaudiRequest).map((item) => {
                    const related = candidates.filter((c) => String(c.request_no || "") === String(item.request_no || "") && !["Rejected", "Interview Failed", "Medical Failed", "Cancelled"].includes(c.status));
                    const joined = related.filter((c) => c.status === "Joined" || c.joining_date).length;
                    return (
                      <tr key={item.id}>
                        <td><button className="link-btn" onClick={() => openRequestDetails(item)}>{item.request_no}</button></td>
                        <td>{item.project_name || "-"}</td>
                        <td>{item.profession || "-"}</td>
                        <td>{item.quantity || 0}</td>
                        <td>{related.length}</td>
                        <td>{joined}</td>
                        <td><Badge value={item.status || "-"} /></td>
                        <td className="table-actions">
                          {canManageCandidates && <button onClick={() => createCandidateFromRequest(item)}>Add Candidate</button>}
                        </td>
                      </tr>
                    );
                  })}
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
                  {candidates.filter((c) => isSaudiCandidate(c, requests)).map((item) => (
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
<div style={{marginBottom:"20px"}}>
<b>Visa:</b> {selectedVisa.visa_no} |
<b> Profession:</b> {selectedVisa.profession} |
<b> Nationality:</b> {selectedVisa.nationality}
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
        (v) => String(v.id) === e.target.value
      );

      if (visa) {
        setSelectedVisa({
          id: visa.id,
          visa_no: visa.visa_no,
          request_no: visa.request_no,
        });
      }
    }}
  >
    <option value="">Select Visa Allocation</option>

    {visaAllocations.map((item) => (
      <option key={item.id} value={item.id}>
        {item.request_no} - Visa {item.visa_no}
      </option>
    ))}
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
  .filter(
    (a) =>
      !selectedVisa ||
      (
        String(a.visa_no) === String(selectedVisa?.visa_no) &&
        String(a.request_no) === String(selectedVisa?.request_no)
      )
  )
  .map((item) => (

<tr key={item.id}>
<td>{item.visa_no}</td>
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
        (reqLine) =>
          normalize(reqLine.profession) === normalize(line.profession) &&
          normalize(reqLine.nationality) === normalize(line.nationality) &&
          normalize(reqLine.gender) === normalize(line.gender)
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
      <Stat title="Office Candidates" value={candidates.length} />
      <Stat
        title="Medical / Visa Process"
        value={candidates.filter((x) => ["Visa Process", "Arrived"].includes(x.status)).length}
        className="warning"
      />
      <Stat
        title="Joined"
        value={candidates.filter((x) => x.status === "Joined").length}
        className="passed"
      />
    </div>

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

    <TableCard title="Office Candidates Tracking">
      <table>
        <thead>
          <tr>
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
          {candidates
  .filter((item) => item.status !== "Rejected" && item.status !== "Interview Failed")
  .map((item) => (
            <tr key={item.id}>
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
      <Stat title="SLA Alerts > 7 Days" value={getAgencySlaEscalationAlerts().length} className={getAgencySlaEscalationAlerts().length ? "danger" : "passed"} />
    </div>

    <TableCard title="SLA Auto-Escalation Alerts">
      <div className="actions-line" style={{ marginBottom: "14px" }}>
        {canManageAgencyAgreements && <button className="save-btn" onClick={generateSlaEscalationNotifications}>Generate Escalation Alerts</button>}
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
            <th>Days Without Update</th>
            <th>Penalty</th>
            <th>Recommendation</th>
          </tr>
        </thead>
        <tbody>
          {getAgencySlaEscalationAlerts().length === 0 ? (
            <tr><td colSpan="9">No stale agency updates. All records are within the 7-day SLA update rule.</td></tr>
          ) : (
            getAgencySlaEscalationAlerts().slice(0, 50).map((item) => (
              <tr key={`${item.candidate_id}-${item.days_without_update}`}>
                <td><Badge value={item.risk} /></td>
                <td>{item.agency}</td>
                <td>{item.candidate_name}</td>
                <td>{item.request_no}</td>
                <td>{item.project}</td>
                <td><Badge value={item.status} /></td>
                <td><b>{item.days_without_update}</b></td>
                <td>{item.penalty} pts</td>
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
            <th>SLA 30%</th>
            <th>Response 10%</th>
            <th>Quality 20%</th>
            <th>Rejection 10%</th>
            <th>Mobilization 15%</th>
            <th>Update 10%</th>
            <th>Stale Updates</th>
            <th>Penalty</th>
            <th>Agreement 5%</th>
            <th>Total</th>
            <th>Class</th>
          </tr>
        </thead>
        <tbody>
          {calculateAgencyPerformanceRows().length === 0 ? (
            <tr><td colSpan="13">No agency performance data yet</td></tr>
          ) : (
            calculateAgencyPerformanceRows().map((item, index) => (
              <tr key={item.agency_name}>
                <td>{index + 1}</td>
                <td>{item.agency_name}</td>
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
            <th>Total Score</th>
            <th>Class</th>
            <th>Recommendation</th>
          </tr>
        </thead>
        <tbody>
          {calculateAgencyPerformanceRows().length === 0 ? (
            <tr><td colSpan="4">No recommendations yet</td></tr>
          ) : (
            calculateAgencyPerformanceRows().map((item) => (
              <tr key={item.agency_name}>
                <td>{item.agency_name}</td>
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
            <tr><td colSpan="10">No saved score history yet</td></tr>
          ) : (
            agencyScoreHistory
              .slice()
              .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
              .slice(0, 50)
              .map((item) => (
                <tr key={item.id}>
                  <td>{item.created_at ? new Date(item.created_at).toLocaleDateString("en-GB") : "-"}</td>
                  <td>{item.agency_id}</td>
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
      <Stat title="Pending Signature" value={agencyAgreements.filter((x) => x.status === "Pending Signature").length} className="warning" />
      <Stat title="Default SLA Days" value="60" />
    </div>

    {canManageAgencyAgreements && (
      <FormCard title={agreementEditingId ? "Edit Agency Agreement" : "New Agency Agreement"}>
        <div className="form-grid">
          <Input placeholder="Agreement No" value={agreementForm.agreement_no} onChange={(v) => updateForm(setAgreementForm, "agreement_no", v)} />
          <Select placeholder="Agency" value={agreementForm.agency_name} onChange={(v) => updateForm(setAgreementForm, "agency_name", v)} options={agencies.map((a) => a.name).filter(Boolean)} />
          <Input type="number" placeholder="SLA Days" value={agreementForm.sla_days} onChange={(v) => updateForm(setAgreementForm, "sla_days", v)} />
          <Input type="date" placeholder="Effective Date" value={agreementForm.effective_date} onChange={(v) => updateForm(setAgreementForm, "effective_date", v)} />
          <Input type="date" placeholder="Expiry Date" value={agreementForm.expiry_date} onChange={(v) => updateForm(setAgreementForm, "expiry_date", v)} />
          <Select placeholder="Status" value={agreementForm.status} onChange={(v) => updateForm(setAgreementForm, "status", v)} options={["Draft", "Pending Signature", "Active", "Expired", "Terminated"]} />
          <Input placeholder="Company Signatory Name" value={agreementForm.signed_by_company} onChange={(v) => updateForm(setAgreementForm, "signed_by_company", v)} />
          <Input placeholder="Agency Signatory Name" value={agreementForm.signed_by_agency} onChange={(v) => updateForm(setAgreementForm, "signed_by_agency", v)} />
        </div>

        <label>Agreement Terms / SLA Commitment</label>
        <textarea rows="9" value={agreementForm.terms} onChange={(e) => updateForm(setAgreementForm, "terms", e.target.value)} />

        <div className="form-grid">
          <Input placeholder="Company Signature" value={agreementForm.company_signature} onChange={(v) => updateForm(setAgreementForm, "company_signature", v)} />
          <Input placeholder="Agency Signature" value={agreementForm.agency_signature} onChange={(v) => updateForm(setAgreementForm, "agency_signature", v)} />
        </div>

        <div className="actions-line">
          <button className="save-btn" onClick={saveAgreement}>{agreementEditingId ? "Update Agreement" : "Save Agreement"}</button>
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
            <th>SLA Days</th>
            <th>Effective</th>
            <th>Expiry</th>
            <th>Status</th>
            <th>Company Signature</th>
            <th>Agency Signature</th>
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
                <td>{item.sla_days || 60}</td>
                <td>{item.effective_date || "-"}</td>
                <td>{item.expiry_date || "-"}</td>
                <td><Badge value={item.status || "Draft"} /></td>
                <td>{item.company_signature || "-"}</td>
                <td>{item.agency_signature || "-"}</td>
                <td className="table-actions">
                  {canManageAgencyAgreements && <button onClick={() => editAgreement(item)}>Edit</button>}
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

{activePage === "Agency Ranking" && (
  <>
    <div className="dashboard-grid">
      <Stat title="Agencies in Live Scorecard" value={buildAgencyScorecard().length} />
      <Stat title="Excellent Agencies" value={buildAgencyScorecard().filter((x) => Number(x.score || 0) >= 90).length} className="passed" />
      <Stat title="Medium / High Risk" value={buildAgencyScorecard().filter((x) => x.risk !== "Low").length} className="warning" />
      <Stat title="Signed Agreements" value={agencyAgreements.filter((x) => x.status === "Active").length} className="passed" />
    </div>

    <TableCard title="Live Agency Performance Scorecard">
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Agency</th>
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
          {buildAgencyScorecard().length === 0 ? (
            <tr><td colSpan="11">No agency performance data</td></tr>
          ) : (
            buildAgencyScorecard().map((item, index) => (
              <tr key={item.agency}>
                <td>{index + 1}</td>
                <td>{item.agency}</td>
                <td>{item.authorizedQty}</td>
                <td>{item.candidates}</td>
                <td>{item.submittedPercent}%</td>
                <td>{item.passedInterviews}</td>
                <td>{item.arrived}</td>
                <td>{item.joined}</td>
                <td>{item.failed}</td>
                <td><b>{item.score}</b></td>
                <td><Badge value={item.risk} /></td>
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
  {userEditingId ? "Update User" : "Save User"}
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


{activePage === "Backup Center" && canManagePlatform && (
  <div className="page-section">
    <div className="form-card">
      <h2>Backup Center</h2>
      <p>Create a backup log record for the full system or for a specific company.</p>
      <div className="form-actions">
        <button className="save-btn" onClick={() => createSystemBackup(null)}>Create Full System Backup Record</button>
        <select onChange={(e) => e.target.value && createSystemBackup(e.target.value)} defaultValue="">
          <option value="">Backup Specific Company</option>
          {platformClients.map((client) => <option key={client.id} value={client.id}>{client.company_name}</option>)}
        </select>
      </div>
    </div>
    <div className="table-card">
      <h2>System Backups</h2>
      <table>
        <thead><tr><th>Type</th><th>Company</th><th>Status</th><th>Date</th><th>File URL</th><th>Notes</th><th>Actions</th></tr></thead>
        <tbody>
          {systemBackups.length === 0 ? <tr><td colSpan="7">No backup records yet</td></tr> : systemBackups.map((item) => (
            <tr key={item.id}>
              <td>{item.backup_type || "Company"}</td>
              <td>{getPlatformClientName(item.client_id)}</td>
              <td><Badge value={item.status || "Completed"} /></td>
              <td>{item.created_at ? new Date(item.created_at).toLocaleString() : "-"}</td>
              <td>{item.file_url || "-"}</td>
              <td>{item.notes || "-"}</td>
              <td className="actions"><button onClick={() => deleteSystemBackup(item.id)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
)}

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
                    <b>Note:</b> For real sending, add <code>VITE_OFFER_EMAIL_WEBHOOK_URL</code> or <code>VITE_RESEND_API_KEY</code> in .env.
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

export default App;
