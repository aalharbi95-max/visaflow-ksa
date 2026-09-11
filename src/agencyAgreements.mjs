export const AGENCY_AGREEMENT_CREATE_RPC = "agency_agreement_create_v1";

export function isSameAgencyWorkspace(currentCompanyId, workspace) {
  const requestedCompanyId = String(workspace?.company_id || "");
  return Boolean(requestedCompanyId) && requestedCompanyId === String(currentCompanyId || "");
}

export function shouldShowAgencyAgreements({ role, loading, agreements = [] }) {
  return role === "Agency" && (loading || agreements.length > 0);
}

export function getAgencyAgreementSaveError(error) {
  if (String(error?.code || "") === "23505") {
    return "Agreement could not be saved because its number conflicted. Please try again.";
  }
  return error?.message || "Agreement could not be saved.";
}

export async function createAgencyAgreement(supabase, payload) {
  const { agreement_no: _browserGeneratedNumber, company_id: _browserCompanyId, id: _browserId, ...serverPayload } = payload || {};
  return supabase.rpc(AGENCY_AGREEMENT_CREATE_RPC, { p_agreement: serverPayload });
}

export async function retryAgreementDelivery(sendEmail, agreement) {
  if (!agreement?.id) throw new Error("A saved agreement record is required before email can be retried.");
  return sendEmail({ type: "AGENCY_AGREEMENT_SENT", identifiers: { agreement_id: agreement.id } });
}
