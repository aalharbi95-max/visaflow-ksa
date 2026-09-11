import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "./supabase";
import "./style.css";

const PAGES = [
  "Dashboard",
  "Requests",
  "Authorization",
  "Cancellation Register",
  "Visa Inventory",
  "Visa Allocation",
  "Candidates",
  "Interviews",
  "Agencies",
  "Reports",
];

const VISA_STATUSES = ["Pending", "Authorized", "Under Process", "Stamped", "Arrived", "Joined", "Cancelled"];
const REQUEST_STATUSES = ["Open", "Under Recruitment", "Interview Stage", "Visa Process", "Closed", "Cancelled"];
const APPROVAL_STATUSES = ["Draft", "Pending Recruitment Approval", "Approved by Recruitment", "Rejected by Recruitment"];
const PRIORITIES = ["Urgent", "High", "Medium", "Low", "Normal"];
const GENDERS = ["Male", "Female"];
const CANDIDATE_STATUSES = ["New", "Shortlisted", "Interview Scheduled", "Selected", "Rejected", "Visa Process", "Arrived", "Joined"];
const INTERVIEW_STATUSES = ["Passed", "Rejected", "Waiting", "Re-Interview"];

const emptyRequest = {
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
  agency: "",
  office_country: "",
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


function getRowValue(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") return String(row[key]).trim();
  }
  return "";
}

function App() {
  const [activePage, setActivePage] = useState("Dashboard");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const [requests, setRequests] = useState([]);
  const [visaRecords, setVisaRecords] = useState([]);
  const [visaAuthorizations, setVisaAuthorizations] = useState([]);
  const [visaAllocations, setVisaAllocations] = useState([]);
const [agencies, setAgencies] = useState([]);
const [candidates, setCandidates] = useState([]);
const [interviews, setInterviews] = useState([]);
const [selectedVisa,setSelectedVisa] = useState(null);
const [selectedRequest, setSelectedRequest] = useState(null);
const [showAuthForm,setShowAuthForm] = useState(false);

const [activeReport, setActiveReport] = useState("all");

const [authForm,setAuthForm] = useState({

  agency:"",
  authorization_no:"",
  allocated_qty:0
});
const [allocationForm, setAllocationForm] = useState({
  request_no: "",
  visa_no: "",
  allocated_qty: 0,
});

async function saveAuthorization(){
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
.insert([payload]);

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
const getVisaBalanceForRequest = (req) => {
  if (isSaudiNationality(req.nationality)) return 0;

  return visaRecords
    .filter(
      (v) =>
        normalize(v.profession) === normalize(req.profession) &&
        normalize(v.nationality) === normalize(req.nationality) &&
        normalize(v.gender) === normalize(req.gender)
    )
    .reduce((sum, v) => sum + Number(v.quantity || 0), 0);
};

const nonSaudiRequests = requests.filter(
  (r) => !isSaudiNationality(r.nationality)
);

const requestsWithVisa = nonSaudiRequests.filter(
  (r) => getVisaBalanceForRequest(r) >= Number(r.quantity || 0)
);

const requestsWithoutVisa = nonSaudiRequests.filter(
  (r) => getVisaBalanceForRequest(r) < Number(r.quantity || 0)
);

const extraVisaRequests = visaRecords.filter((v) => {
  if (isSaudiNationality(v.nationality)) return false;

  const matchingRequestQty = requests
    .filter(
      (r) =>
        !isSaudiNationality(r.nationality) &&
        normalize(r.profession) === normalize(v.profession) &&
        normalize(r.nationality) === normalize(v.nationality) &&
        normalize(r.gender) === normalize(v.gender)
    )
    .reduce((sum, r) => sum + Number(r.quantity || 0), 0);

  return Number(v.quantity || 0) > matchingRequestQty;
});
  async function deleteAllocation(id) {
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
  if (!allocationForm.request_no || !allocationForm.visa_no || !allocationForm.allocated_qty) {
    alert("Please select request, visa, and allocated quantity");
    return;
  }
  const req = requests.find((r) => String(r.request_no) === String(allocationForm.request_no));
const visa = visaRecords.find((v) => String(v.visa_no) === String(allocationForm.visa_no));

if (
  !allocationEditingId &&
  (
    !req ||
    !visa ||
    normalize(req.profession) !== normalize(visa.profession) ||
    normalize(req.nationality) !== normalize(visa.nationality) ||
    normalize(req.gender) !== normalize(visa.gender)
  )
) {
  alert("Selected visa does not match request profession, nationality, and gender");
  return;
}
const available = getVisaAvailableQty(allocationForm.visa_no);

if (Number(allocationForm.allocated_qty) > available) {
  alert(`Only ${available} visas are available`);
  return;
}
  const newAllocation = {
    id: Date.now(),
    request_no: allocationForm.request_no,
    visa_no: allocationForm.visa_no,
    allocated_qty: Number(allocationForm.allocated_qty),
  };

if (allocationEditingId) {
  const { error } = await supabase
    .from("visa_allocations")
    .update({
      request_no: allocationForm.request_no,
      visa_no: allocationForm.visa_no,
      allocated_qty: Number(allocationForm.allocated_qty),
    })
    .eq("id", allocationEditingId);

  if (error) {
    alert(error.message);
    return;
  }

  setAllocationEditingId(null);
  await loadVisaAllocations();

  alert("Allocation updated");
  return;
}
const { error } = await supabase
  .from("visa_allocations")
  .insert([{
    request_no: allocationForm.request_no,
    visa_no: allocationForm.visa_no,
    allocated_qty: Number(allocationForm.allocated_qty)
  }]);

if (error) {
  alert(error.message);
  return;
}

await loadAll();

alert("Allocation saved");

  setAllocationForm({
    request_no: "",
    visa_no: "",
    allocated_qty: 0,
  });
}

  const [auditLogs, setAuditLogs] = useState([]);

  const [requestForm, setRequestForm] = useState(emptyRequest);
  const [requestEditingId, setRequestEditingId] = useState(null);
  const [visaForm, setVisaForm] = useState(emptyVisa);
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
  const [excelRequestNo, setExcelRequestNo] = useState("");

  function updateForm(setter, field, value) {
    setter((prev) => ({ ...prev, [field]: value }));
  }

  async function loadAll() {
    setLoading(true);
    await Promise.all([
      loadRequests(),
      loadVisaRecords(),
      loadVisaAuthorizations(),
      loadVisaAllocations(),
      loadAgencies(),
      loadCandidates(),
      loadInterviews(),
      loadAuditLogs(),
    ]);
    setLoading(false);
  }

  async function loadTable(table, setter) {
    const { data, error } = await supabase.from(table).select("*").order("created_at", { ascending: false });
    if (error) {
      alert(`${table}: ${error.message}`);
      return;
    }
    setter(data || []);
  }

  const loadRequests = () => loadTable("requests", setRequests);
  const loadVisaRecords = () => loadTable("visa_batches", setVisaRecords);
  const loadVisaAuthorizations = () => loadTable("visa_authorizations", setVisaAuthorizations);
  const loadVisaAllocations = () => loadTable("visa_allocations", setVisaAllocations);
  const loadAgencies = () => loadTable("agencies", setAgencies);
  const loadCandidates = () => loadTable("candidates", setCandidates);
  const loadInterviews = () => loadTable("interviews", setInterviews);
  const loadAuditLogs = () => loadTable("request_audit_logs", setAuditLogs);
useEffect(() => {
  loadAll();
}, []);
  
const getVisaAvailableQty = (visaNo) => {
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
      const matchesSearch = [item.visa_no, item.request_no, item.project, item.profession, item.nationality, item.agency]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
      const matchesStatus = filterStatus === "All" || item.status === filterStatus;
      return matchesSearch && matchesStatus;
    });
  }, [visaRecords, search, filterStatus]);

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
   return {
  totalQty,
  totalCandidates,
  totalRemaining,
  underRecruitmentCount,
  visaProcessCount,

  approvedRequests: requests.filter((item) => item.approval_status === "Approved by Recruitment").length,
  pendingApprovals: requests.filter((item) => item.approval_status === "Pending Recruitment Approval").length,
  joinedCandidates: candidates.filter((item) => item.status === "Joined").length,
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
  }, [visaRecords, agencies, requests, candidates, interviews]);
  const reports = useMemo(() => {
  const today = new Date();

  const daysBetween = (date) => {
    if (!date) return 0;
    const d = new Date(date);
    return Math.floor((today - d) / (1000 * 60 * 60 * 24));
  };

  const requestHasVisa = (req) =>
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
      const completedCandidates = relatedCandidates.filter((c) =>
  c.status === "Passed"
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
        status: r.status,
        approval_status: r.approval_status,
      };
    }),
  };
}, [requests, visaRecords, visaAuthorizations, candidates, interviews]);

 async function generateRequestNo() {
  const year = new Date().getFullYear();

  const { data, error } = await supabase
    .from("requests")
    .select("request_no")
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
    await supabase.from("request_audit_logs").insert([{ request_id: requestId, action, details, changed_by: "Recruitment" }]);
    loadAuditLogs();
  }

  function resetRequestForm() {
    setRequestForm(emptyRequest);
    setRequestEditingId(null);
  }

  function editRequest(item) {
    setRequestEditingId(item.id);
    setRequestForm({
      request_type: item.request_type || "",
      project_name: item.project_name || "",
      department: item.department || "",
      profession: item.profession || "",
      quantity: item.quantity || "",
      nationality: item.nationality || "",
      gender: item.gender || "",
      salary: item.salary || "",
      priority: item.priority || "Normal",
      status: item.status || "Open",
      requested_by: item.requested_by || "",
      notes: item.notes || "",
    });
    setActivePage("Requests");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveRequest() {
    if (!requestForm.request_type || !requestForm.profession || !requestForm.quantity) {
      alert("Please fill Request Type, Profession and Quantity.");
      return;
    }

    const payload = {
      ...requestForm,
      quantity: Number(requestForm.quantity || 0),
      project_start: requestForm.project_start || null,
      request_no: requestEditingId ? undefined : await generateRequestNo(),
      approval_status: requestEditingId ? undefined : "Pending Recruitment Approval",
      request_status: requestEditingId ? undefined : "Draft",
      updated_at: new Date().toISOString(),
    };

    Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

    const result = requestEditingId
      ? await supabase.from("requests").update(payload).eq("id", requestEditingId).select().single()
      : await supabase.from("requests").insert([payload]).select().single();

    if (result.error) return alert(result.error.message);

    await addAudit(
      result.data.id,
      requestEditingId ? "Updated" : "Created",
      requestEditingId ? "Request information was updated" : "Request was created"
    );
    alert(requestEditingId ? "Request updated successfully" : `Request saved successfully: ${result.data.request_no}`);
    resetRequestForm();
    loadRequests();
  }

  async function approveRequest(item) {
    const { error } = await supabase
      .from("requests")
      .update({ approval_status: "Approved by Recruitment", request_status: "Approved", updated_at: new Date().toISOString() })
      .eq("id", item.id);
    if (error) return alert(error.message);
    await addAudit(item.id, "Approved", "Final approval by Recruitment Department");
    loadRequests();
  }

  async function rejectRequest(item) {
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
    if (!window.confirm("Delete this request?")) return;
    const { error } = await supabase.from("requests").delete().eq("id", id);
    if (error) return alert(error.message);
    loadRequests();
  }

  function resetVisaForm() {
    setVisaForm(emptyVisa);
    setVisaEditingId(null);
  }

  function editVisa(item) {
    setVisaEditingId(item.id);
    setVisaForm({
      visa_no: item.visa_no || "",
      project: item.project || "",
      profession: item.profession || "",
    nationality: item.nationality || "",
gender: item.gender || "",
agency: item.agency || "",
      quantity: item.quantity || "",
      status: item.status || "Pending",
      request_no: item.request_no || "",
    });
    setActivePage("Visa Inventory");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

async function saveVisa() {
  const payload = {
    ...visaForm,
    quantity: Number(visaForm.quantity || 0),
    authorized: Number(visaForm.authorized || 0),
    allocated_qty: Number(visaForm.allocated_qty || 0),
    remaining_qty: Number(visaForm.remaining_qty || 0),
    issue_date: visaForm.issue_date || null,
    expiry_date: visaForm.expiry_date || null,
    updated_at: new Date().toISOString(),
  };

  const result = visaEditingId
    ? await supabase.from("visa_batches").update(payload).eq("id", visaEditingId).select().single()
    : await supabase.from("visa_batches").insert([payload]).select().single();

  if (result.error) return alert(result.error.message);

  alert(visaEditingId ? "Visa updated successfully" : "Visa saved successfully");
  resetVisaForm();
  loadVisaRecords();
}

  async function deleteVisa(id) {
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

  async function saveAgency() {
    if (!agencyForm.name) return alert("Agency name is required.");
    const payload = { ...agencyForm, updated_at: new Date().toISOString() };
    const result = agencyEditingId
      ? await supabase.from("agencies").update(payload).eq("id", agencyEditingId)
      : await supabase.from("agencies").insert([payload]);
    if (result.error) return alert(result.error.message);
    resetAgencyForm();
    loadAgencies();
  }

  async function deleteAgency(id) {
    if (!window.confirm("Delete this agency?")) return;
    const { error } = await supabase.from("agencies").delete().eq("id", id);
    if (error) return alert(error.message);
    loadAgencies();
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
      status: item.status || "New",
      notes: item.notes || "",
    });
    setActivePage("Candidates");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveCandidate() {
    const { data: requestData } = await supabase
  .from("requests")
  .select("approval_status")
  .eq("request_no", candidateForm.request_no)
  .single();

if (
  requestData &&
  requestData.approval_status !== "Approved by Recruitment" &&
  requestData.approval_status !== "Approved"
) {
  return alert("Candidates cannot be added until the request is approved.");
}
    if (!candidateForm.candidate_name) return alert("Candidate name is required.");
    const payload = { ...candidateForm, updated_at: new Date().toISOString() };
    const result = candidateEditingId
      ? await supabase.from("candidates").update(payload).eq("id", candidateEditingId)
      : await supabase.from("candidates").insert([payload]);
      const { count: updatedCount } = await supabase
  .from("candidates")
  .select("*", { count: "exact", head: true })
  .eq("request_no", candidateForm.request_no);

const requestRemaining =
  Number(requestData?.quantity || 0) - Number(updatedCount || 0);

if (requestRemaining <= 0) {
  await supabase
    .from("requests")
    .update({
      status: "Completed",
      updated_at: new Date().toISOString(),
    })
    .eq("request_no", candidateForm.request_no);

  await loadRequests();
}
    if (result.error) return alert(result.error.message);
    alert(candidateEditingId ? "Candidate updated successfully" : "Candidate saved successfully");
    resetCandidateForm();
    loadCandidates();
  }

  async function deleteCandidate(id) {
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
      .single();

    if (requestError || !requestData) return alert("Request not found.");
if (requestData.approval_status !== "Approved by Recruitment" && requestData.approval_status !== "Approved") {
  return alert("Candidates cannot be uploaded until the request is approved.");
}
    const { count, error: countError } = await supabase
      .from("candidates")
      .select("*", { count: "exact", head: true })
      .eq("request_no", requestNo);

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
    .limit(1);

  if (existing && existing.length > 0) {
    skipped++;
    errors.push(
      `${candidateName}: Passport already exists (${passportNo})`
    );
    continue;
  }
}

      const payload = {
        candidate_name: candidateName,

        profession: requestData.profession || "",
        nationality: requestData.nationality || "",
        gender: requestData.gender || "",
        project: requestData.project_name || "",
        request_no: requestData.request_no || requestNo,

        agency: getRowValue(row, ["Agency", "Office"]),
        passport_no: passportNo,
        mobile: getRowValue(row, ["Mobile", "Phone"]),
        notes: getRowValue(row, ["Notes", "Note", "ملاحظات"]),
        status: "New",
      };

      const { error } = await supabase.from("candidates").insert([payload]);

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
.eq("request_no", requestNo);

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
    if (!interviewForm.candidate_id)
  return alert("Candidate is required.");
    const payload = { ...interviewForm, interview_date: interviewForm.interview_date || null, updated_at: new Date().toISOString() };
    const result = interviewEditingId
      ? await supabase.from("interviews").update(payload).eq("id", interviewEditingId)
      : await supabase.from("interviews").insert([payload]);
    if (result.error) return alert(result.error.message);
    
     
    await supabase
  .from("candidates")
  .update({
    status: interviewForm.status,
    updated_at: new Date().toISOString(),
  })
  .eq("id", interviewForm.candidate_id);
    loadInterviews();
    loadCandidates();
    resetInterviewForm();
  }

  async function deleteInterview(id) {
    if (!window.confirm("Delete this interview?")) return;
    const { error } = await supabase.from("interviews").delete().eq("id", id);
    if (error) return alert(error.message);
    loadInterviews();
  }

async function createVisaFromRequest(item) {
  if (isSaudiNationality(item.nationality)) {
    return alert("Saudi request does not require visa.");
  }

  const neededQty = Number(item.quantity || 0);

  const matchedVisa = visaRecords.find(
    (v) =>
      !isSaudiNationality(v.nationality) &&
      normalize(v.profession).includes(normalize(item.profession)) &&
normalize(v.nationality) === normalize(item.nationality) &&
(
  !item.gender ||
  !v.gender ||
  normalize(v.gender) === normalize(item.gender)
) &&
      Number(v.quantity || 0) >= neededQty
  );

  if (!matchedVisa) {
    return alert("No available visa balance matching this request.");
  }

  const remainingVisaQty = Number(matchedVisa.quantity || 0) - neededQty;

  const { error: visaError } = await supabase
    .from("visa_batches")
    .update({
      quantity: remainingVisaQty,
      updated_at: new Date().toISOString(),
    })
    .eq("id", matchedVisa.id);

  if (visaError) return alert(visaError.message);

  const { error: requestError } = await supabase
    .from("requests")
    .update({
   status: "Visa Process",
visa_no: matchedVisa.visa_no,
allocated_visa_qty: neededQty,
updated_at: new Date().toISOString(),
    })
    .eq("id", item.id);

  if (requestError) return alert(requestError.message);

  alert(`Visa allocated successfully. Remaining visa balance: ${remainingVisaQty}`);

  loadAll();
  setActivePage("Visa Inventory");
}
  function createCandidateFromRequest(item) {
  resetCandidateForm();

  setCandidateForm({
    ...emptyCandidate,
    profession: item.profession || "",
    nationality: item.nationality || "",
    gender: item.gender || "",
    project: item.project_name || "",
    request_no: item.request_no || "",
  });

  setActivePage("Candidates");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function openRequestDetails(item) {
  setSelectedRequest(item);
  setActivePage("RequestDetails");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
  return (
    <div className="layout">
      <input ref={candidateExcelInputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleExcelUpload} />
      <input ref={requestExcelInputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleExcelUpload} />

      <aside className="sidebar">
        <div className="logo">
          <div className="logo-icon">VF</div>
          <div>
            <h2>VisaFlow KSA</h2>
            <p>Recruitment & Visa Operations</p>
          </div>
        </div>
        <nav>
          {PAGES.map((page) => (
            <button key={page} className={activePage === page ? "active" : ""} onClick={() => setActivePage(page)}>
              {page}
            </button>
          ))}
        </nav>
      </aside>

      <main className="content">
        <div className="topbar sticky">
          <div>
            <h1>{activePage}</h1>
            <p>{loading ? "Loading data..." : "Saudi company recruitment, visa authorization and manpower tracking system."}</p>
          </div>
          <div className="actions-line">
            {activePage === "Candidates" && <button className="new-btn" onClick={startExcelUploadFromCandidates}>Upload Excel</button>}
            <button className="new-btn" onClick={loadAll}>Refresh</button>
          </div>
        </div>

        {activePage === "Dashboard" && (
          <>
            <div className="dashboard-grid">
              <Stat title="Total Requests" value={requests.length} />
              <Stat title="Pending Approvals" value={stats.pendingApprovals} className="warning" />
              <Stat title="Approved Requests" value={stats.approvedRequests} className="passed" />
              <Stat title="Total Visa Qty" value={stats.totalQty} />
              <Stat title="Total Remaining" value={stats.totalRemaining} className="warning" />
<Stat title="Visa Process" value={stats.visaProcessCount} className="passed" />
              <Stat title="Joined Candidates" value={stats.joinedCandidates} className="passed" />
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
    <Stat title="Profession" value={selectedRequest.profession || "-"} />
    <Stat title="Nationality" value={selectedRequest.nationality || "-"} />
    <Stat title="Qty" value={selectedRequest.qty || selectedRequest.quantity || 0} />
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

            <FormCard title={requestEditingId ? "Edit Request" : "Create Request"}>
              <div className="form-grid">
                <Select value={requestForm.request_type} onChange={(v) => updateForm(setRequestForm, "request_type", v)} placeholder="Request Type" options={["Project Recruitment", "Administration Recruitment", "Replacement", "Mobilization"]} />
                <Input placeholder="Project Name" value={requestForm.project_name} onChange={(v) => updateForm(setRequestForm, "project_name", v)} />
                <Input placeholder="Department" value={requestForm.department} onChange={(v) => updateForm(setRequestForm, "department", v)} />
                <Input placeholder="Profession" value={requestForm.profession} onChange={(v) => updateForm(setRequestForm, "profession", v)} />
                <Input type="number" placeholder="Quantity" value={requestForm.quantity} onChange={(v) => updateForm(setRequestForm, "quantity", v)} />
                <Input placeholder="Nationality" value={requestForm.nationality} onChange={(v) => updateForm(setRequestForm, "nationality", v)} />
     
                <Select value={requestForm.gender} onChange={(v) => updateForm(setRequestForm, "gender", v)} placeholder="Gender" options={GENDERS} />
                <Input placeholder="Salary Budget" value={requestForm.salary} onChange={(v) => updateForm(setRequestForm, "salary", v)} />
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
              <textarea rows="4" placeholder="Notes / Requirements / Experience Details" value={requestForm.notes} onChange={(e) => updateForm(setRequestForm, "notes", e.target.value)} />
              <div className="actions-line">
                <button className="save-btn" onClick={saveRequest}>{requestEditingId ? "Update Request" : "Save Request"}</button>
                <button className="light-btn" onClick={resetRequestForm}>Clear</button>
              </div>
            </FormCard>

            <TableCard title="Requests List">
              <table>
         <thead>
<tr>
<th>Request No</th>
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
<td>{item.profession}</td>

<td>{item.nationality || "-"}</td>

<td>
<Badge value={item.gender} />
</td>

<td>{item.salary || "-"}</td>

<td>{item.quantity}</td>

<td>
  {Number(item.quantity || 0) -
    candidates.filter(
      (c) => c.request_no === item.request_no && c.status === "Passed"
    ).length}
</td>

<td>
  {
    candidates.filter(
      (c) => c.request_no === item.request_no && c.status === "Passed"
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
  <button onClick={() => editRequest(item)}>Edit</button>

  <button onClick={() => approveRequest(item)}>Approve</button>

  <button onClick={() => rejectRequest(item)}>Reject</button>

  {item.status !== "Completed" && (item.approval_status === "Approved by Recruitment" || item.approval_status === "Approved") && (
    <button onClick={() => createCandidateFromRequest(item)}>Add Candidate</button>
  )}

  {item.status !== "Completed" && (item.approval_status === "Approved by Recruitment" || item.approval_status === "Approved") && (
    <button onClick={() => startExcelUploadFromRequest(item)}>Upload Excel</button>
  )}

  <button onClick={() => createVisaFromRequest(item)}>Visa</button>

  <button className="danger" onClick={() => deleteRequest(item.id)}>
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
<button onClick={() => setShowAuthForm(true)}>
+ Add Authorization
</button>
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
  {item.status !== "Cancelled" ? (
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


{activePage === "Visa Allocation" && (
  <>
 
    <FormCard title="Allocate Visa to Request">
      <div className="form-grid">

        <Select
          value={allocationForm.request_no}
          onChange={(v) =>
            updateForm(setAllocationForm, "request_no", v)
          }
          placeholder="Request"
          options={requests.map((r) => r.request_no)}
        />

        <Select
          value={allocationForm.visa_no}
          onChange={(v) =>
            updateForm(setAllocationForm, "visa_no", v)
          }
          placeholder="Visa Number"
          options={visaRecords.map((v) => v.visa_no)}
        />

        <Input
          type="number"
          placeholder="Allocated Quantity"
          value={allocationForm.allocated_qty}
          onChange={(v) =>
            updateForm(setAllocationForm, "allocated_qty", v)
          }
        />

        <button
          className="primary-btn"
          onClick={saveAllocation}
        >
          {allocationEditingId ? "Update Allocation" : "Allocate"}
        </button>

      </div>
    </FormCard>
    
  <TableCard title="Visa Allocations List">
    <p>Total Allocations: {visaAllocations.length}</p>
  <table>
    <thead>
      <tr>
        <th>Request No</th>
        <th>Visa No</th>
        <th>Allocated Qty</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      {visaAllocations.length === 0 ? (
  <tr>
    <td colSpan="3">No allocations yet</td>
  </tr>
) : (
  visaAllocations.map((item) => (
        <tr key={item.id}>
          <td>{item.request_no}</td>
          <td>{item.visa_no}</td>
          <td>{item.allocated_qty}</td>
          <td>
  <button
 onClick={() => {
  setAllocationForm({
    request_no: item.request_no,
    visa_no: item.visa_no,
    allocated_qty: item.allocated_qty,
  });

  setAllocationEditingId(item.id);

  window.scrollTo({ top: 0, behavior: "smooth" });
}}>
    Edit
  </button>

  <button
    className="danger"
    onClick={() => deleteAllocation(item.id)}
  >
    Delete
  </button>
</td>
        </tr>
      ))
)}
    </tbody>
  </table>
</TableCard>
</>
)}
{activePage === "Visa Inventory" && (
  <div>
    <div className="dashboard-grid">
  <Stat title="Requests With Visa" value={requestsWithVisa.length} className="passed" />
  <Stat title="Requests Without Visa" value={requestsWithoutVisa.length} className="warning" />
  <Stat title="Extra Visa Requests" value={extraVisaRequests.length} className="danger" />
</div>
            <div className="toolbar"><input placeholder="Search visa, request no, project, profession, nationality, agency" value={search} onChange={(e) => setSearch(e.target.value)} /><select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}><option>All</option>{VISA_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></div>
            <FormCard title={visaEditingId ? "Edit Visa Batch" : "Add Visa Batch"}>
              <div className="form-grid">
<Input
  placeholder="Request No"
  value={visaForm.request_no}
  onChange={(v) => {
    const req = requests.find((r) => String(r.request_no) === String(v));

    setVisaForm((prev) => ({
      ...prev,
      request_no: v,
      project: req?.project_name || "",
      profession: req?.profession || "",
      nationality: req?.nationality || "",
      gender: req?.gender || "",
      quantity: Number(req?.quantity || 0),
allocated_qty: Number(req?.allocated_visa_qty || 0),
remaining_qty:
Number(req?.quantity || 0)
-
Number(req?.allocated_visa_qty || 0),
    }));
}}
/>
<Input placeholder="Visa No"
value={visaForm.visa_no}
onChange={(v)=>updateForm(setVisaForm,"visa_no",v)}
/>

<Input placeholder="MOI No"
value={visaForm.moi_no}
onChange={(v)=>updateForm(setVisaForm,"moi_no",v)}
/>

<Input placeholder="Project"
value={visaForm.project}
onChange={(v)=>updateForm(setVisaForm,"project",v)}
/>

<Input placeholder="Profession"
value={visaForm.profession}
onChange={(v)=>updateForm(setVisaForm,"profession",v)}
/>

<Input placeholder="Nationality"
value={visaForm.nationality}
onChange={(v)=>updateForm(setVisaForm,"nationality",v)}
/>

<Select
value={visaForm.gender}
onChange={(v)=>updateForm(setVisaForm,"gender",v)}
placeholder="Gender"
options={GENDERS}
/>

<Select
value={visaForm.agency}
onChange={(v)=>updateForm(setVisaForm,"agency",v)}
placeholder="Agency"
options={agencies.map(x=>x.name)}
/>

<Input placeholder="Office Country"
value={visaForm.office_country}
onChange={(v)=>updateForm(setVisaForm,"office_country",v)}
/>

<Input type="number"
placeholder="Quantity"
value={visaForm.quantity}
onChange={(v)=>updateForm(setVisaForm,"quantity",v)}
/>

<Input type="number"
placeholder="Authorized Qty"
value={visaForm.authorized}
onChange={(v)=>updateForm(setVisaForm,"authorized",v)}
/>

<Input type="number"
placeholder="Allocated Qty"
value={visaForm.allocated_qty}
onChange={(v)=>updateForm(setVisaForm,"allocated_qty",v)}
/>

<Input type="number"
placeholder="Remaining Qty"
value={visaForm.remaining_qty}
onChange={(v)=>updateForm(setVisaForm,"remaining_qty",v)}
/>

<Input placeholder="Authorization No"
value={visaForm.authorization_no}
onChange={(v)=>updateForm(setVisaForm,"authorization_no",v)}
/>

<label>Issue Date</label>
<Input
type="date"
value={visaForm.issue_date}
onChange={(v)=>updateForm(setVisaForm,"issue_date",v)}
/>

<label>Expiry Date</label>
<Input
type="date"
value={visaForm.expiry_date}
onChange={(v)=>updateForm(setVisaForm,"expiry_date",v)}
/>

<Select
value={visaForm.status}
onChange={(v)=>updateForm(setVisaForm,"status",v)}
placeholder="Status"
options={VISA_STATUSES}
/>

<textarea
rows="3"
placeholder="Notes"
value={visaForm.notes}
onChange={(e)=>updateForm(setVisaForm,"notes",e.target.value)}
/>
              </div>
              <div className="actions-line"><button className="save-btn" onClick={saveVisa}>{visaEditingId ? "Update Visa" : "Save Visa"}</button><button className="light-btn" onClick={resetVisaForm}>Clear</button></div>
            </FormCard>
<TableCard title="Visa Records">
<table>
<thead>
<tr>
<th>Request No</th>
<th>Visa No</th>
<th>Project</th>
<th>Profession</th>
<th>Nationality</th>
<th>Gender</th>
<th>Agency</th>
<th>Qty</th>
<th>Status</th>
<th>Actions</th>
</tr>
</thead>

<tbody>
{filteredVisaRecords.map((item) => (

<tr key={item.id}>
<td>{item.request_no || "-"}</td>
<td>
  <button
    className="link-btn"
    onClick={() => editVisa(item)}
  >
    {item.visa_no || "-"}
  </button>
</td>
<td>{item.project || "-"}</td>
<td>{item.profession || "-"}</td>
<td>{item.nationality || "-"}</td>
<td>{item.gender || "-"}</td>
<td>{item.agency || "-"}</td>
<td>{item.quantity || 0}</td>

<td>
<Badge value={item.status}/>
</td>

<td className="table-actions">

<button onClick={() => editVisa(item)}>
Edit
</button>

<button onClick={() => openAuthorization(item)}>
Authorizations
</button>

<button
className="danger"
onClick={() => deleteVisa(item.id)}
>
Delete
</button>

</td>
</tr>

))}
</tbody>
</table>
</TableCard>        
       
</div>
)}

            <div className="toolbar"><input placeholder="Search candidates" value={search} onChange={(e) => setSearch(e.target.value)} /><button className="new-btn" onClick={startExcelUploadFromCandidates}>Upload Excel</button></div>
            {activePage === "Candidates" && (
<>
            <FormCard title={candidateEditingId ? "Edit Candidate" : "Add Candidate"}>
              <div className="form-grid">
                <Input placeholder="Candidate Name" value={candidateForm.candidate_name} onChange={(v) => updateForm(setCandidateForm, "candidate_name", v)} />
                <Input placeholder="Profession" value={candidateForm.profession} onChange={(v) => updateForm(setCandidateForm, "profession", v)} readOnly={!!candidateForm.request_no} />
<Input placeholder="Nationality" value={candidateForm.nationality} onChange={(v) => updateForm(setCandidateForm, "nationality", v)} readOnly={!!candidateForm.request_no} />
<Input placeholder="Gender" value={candidateForm.gender} onChange={(v) => updateForm(setCandidateForm, "gender", v)} readOnly={!!candidateForm.request_no} />
<Input placeholder="Project" value={candidateForm.project} onChange={(v) => updateForm(setCandidateForm, "project", v)} readOnly={!!candidateForm.request_no} />
<Input placeholder="Request No" value={candidateForm.request_no} onChange={(v) => updateForm(setCandidateForm, "request_no", v)} readOnly={!!candidateForm.request_no} />
<Input placeholder="Passport No" value={candidateForm.passport_no} onChange={(v) => updateForm(setCandidateForm, "passport_no", v)} />                
                <Input placeholder="Mobile" value={candidateForm.mobile} onChange={(v) => updateForm(setCandidateForm, "mobile", v)} />
                <Select value={candidateForm.status} onChange={(v) => updateForm(setCandidateForm, "status", v)} placeholder="Status" options={CANDIDATE_STATUSES} />
              </div>
              <textarea rows="3" placeholder="Notes" value={candidateForm.notes} onChange={(e) => updateForm(setCandidateForm, "notes", e.target.value)} />
              <div className="actions-line"><button className="save-btn" onClick={saveCandidate}>{candidateEditingId ? "Update Candidate" : "Save Candidate"}</button><button className="light-btn" onClick={resetCandidateForm}>Clear</button></div>
            </FormCard>
            <TableCard title="Candidates List"><table><thead><tr><th>Request No</th><th>Name</th><th>Profession</th><th>Nationality</th><th>Gender</th><th>Agency</th><th>Project</th><th>Passport</th><th>Status</th><th>Actions</th></tr></thead><tbody>{filteredCandidates.map((item) => <tr key={item.id}><td>{item.request_no}</td><td>{item.candidate_name}</td><td>{item.profession}</td><td>{item.nationality}</td><td><Badge value={item.gender} /></td><td>{item.agency}</td><td>{item.project}</td><td>{item.passport_no}</td><td><Badge value={item.status} /></td><td className="table-actions"><button onClick={() => editCandidate(item)}>Edit</button><button className="danger" onClick={() => deleteCandidate(item.id)}>Delete</button></td></tr>)}</tbody></table></TableCard>
          </>
        )}

        {activePage === "Interviews" && (
          <>
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
            <TableCard title="Interview Records"><table><thead><tr><th>Date</th><th>Project</th><th>Name</th><th>Profession</th><th>Agency</th><th>Type</th><th>Score</th><th>Status</th><th>Actions</th></tr></thead><tbody>{interviews.map((item) => <tr key={item.id}><td>{item.interview_date}</td><td>{item.project}</td><td>{item.candidate_name}</td><td>{item.profession}</td><td>{item.agency}</td><td>{item.interview_type}</td><td>{item.score}</td><td><Badge value={item.status} /></td><td className="table-actions"><button onClick={() => editInterview(item)}>Edit</button><button className="danger" onClick={() => deleteInterview(item.id)}>Delete</button></td></tr>)}</tbody></table></TableCard>
          </>
        )}

        {activePage === "Agencies" && (
          <>
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
            <TableCard title="Agencies List"><table><thead><tr><th>Name</th><th>Country</th><th>Contact</th><th>Email</th><th>Phone</th><th>Status</th><th>Actions</th></tr></thead><tbody>{agencies.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.country}</td><td>{item.contact_person}</td><td>{item.email}</td><td>{item.phone}</td><td><Badge value={item.status} /></td><td className="table-actions"><button onClick={() => editAgency(item)}>Edit</button><button className="danger" onClick={() => deleteAgency(item.id)}>Delete</button></td></tr>)}</tbody></table></TableCard>
          </>
        )}

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
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value || ""}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function TableCard({ title, children, className = "" }) {
  return (
    <div className={`table-card ${className}`}>
      <h2>{title}</h2>
      {children}
    </div>
  );
}


function Select({ value, onChange, placeholder, options }) {
  return <select value={value || ""} onChange={(e) => onChange(e.target.value)}><option value="">{placeholder}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
}

function Badge({ value }) {
  const text = value || "-";
  return <span className={`badge ${String(text).toLowerCase().replaceAll(" ", "-")}`}>{text}</span>;
}

function SimpleList({ title, rows, columns }) {
  return <div className="table-card"><h2>{title}</h2><table><thead><tr>{columns.map((c) => <th key={c}>{c.replaceAll("_", " ")}</th>)}</tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={columns.length}>No data</td></tr> : rows.map((row, index) => <tr key={row.id || index}>{columns.map((c) => <td key={c}>{String(row[c] ?? "")}</td>)}</tr>)}</tbody></table></div>;
}

export default App;
