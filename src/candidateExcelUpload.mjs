function clean(value) {
  return String(value || "").trim();
}

export function resolveAgencyUploadWorkspace({
  currentUser,
  activeAgencyCompanyId,
  agencyClientAccess = [],
} = {}) {
  if (clean(currentUser?.role).toLowerCase() !== "agency" || !currentUser?.auth_user_id) {
    return { ok: false, message: "An authenticated Agency user is required for candidate upload." };
  }

  const agencyId = clean(currentUser.agency_id);
  if (!agencyId) {
    return { ok: false, message: "Agency identity is missing from the authenticated session." };
  }

  const companyId = clean(activeAgencyCompanyId || currentUser.active_company_id);
  if (!companyId) {
    return { ok: false, message: "Company Workspace is not selected. Please select a client workspace before uploading." };
  }

  const access = agencyClientAccess.find((item) => (
    clean(item?.company_id) === companyId
    && (!item?.agency_id || clean(item.agency_id) === agencyId)
    && (!item?.user_id || clean(item.user_id) === clean(currentUser.id))
    && clean(item?.status || "Active").toLowerCase() === "active"
  ));

  if (!access) {
    return { ok: false, message: "The selected Company Workspace is not authorized for this Agency user." };
  }

  const agencyName = clean(currentUser.agency_name || access.agency_name);
  if (!agencyName) {
    return { ok: false, message: "Agency name is missing from the authenticated workspace." };
  }

  return { ok: true, companyId, agencyId, agencyName, access };
}

export function secureAgencyCandidatePayload(rowPayload = {}, workspace, assignment = null) {
  if (!workspace?.ok || !workspace.companyId || !workspace.agencyId) {
    throw new Error("Complete Agency and Company Workspace identity is required before upload.");
  }

  const {
    company_id: _untrustedCompanyId,
    agency_id: _untrustedAgencyId,
    agency: _untrustedAgencyName,
    request_no: _untrustedRequestNo,
    request_line_id: _untrustedRequestLineId,
    ...safeRowPayload
  } = rowPayload;
  const requestNo = clean(assignment?.requestNo);
  return {
    ...safeRowPayload,
    company_id: workspace.companyId,
    agency: workspace.agencyName,
    request_no: requestNo,
    request_line_id: requestNo ? (assignment?.requestLineId || null) : null,
    project: requestNo
      ? clean(assignment?.project || safeRowPayload.project)
      : clean(safeRowPayload.project) || "Agency Talent Pool",
  };
}

export function getCandidateUploadValidationSummary(payloads = [], errors = []) {
  const accepted = payloads.length;
  const rejected = errors.length;
  return {
    accepted,
    rejected,
    canInsert: accepted > 0 && rejected === 0,
    message:
      `Accepted rows: ${accepted}\nRejected rows: ${rejected}`
      + (rejected ? `\n\nReasons:\n${errors.join("\n")}` : ""),
  };
}

export function isAgencyRequestAssignmentInWorkspace({ requestNo, request, notification, workspace } = {}) {
  if (!workspace?.ok || !clean(requestNo)) return false;
  const requestMatches = !request || (
    clean(request.request_no) === clean(requestNo)
    && clean(request.company_id) === workspace.companyId
  );
  const notificationMatches = Boolean(notification)
    && clean(notification.company_id) === workspace.companyId
    && clean(notification.agency_id) === workspace.agencyId
    && clean(notification.request_no || notification.data?.request_no) === clean(requestNo);
  return requestMatches && notificationMatches;
}
