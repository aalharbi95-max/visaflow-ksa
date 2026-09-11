import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAgentActionKey,
  resolveAgentApprovalState,
  selectReusableAgentStep,
} from "../supabase/functions/_shared/aiAgentOrchestratorCore.mjs";

test("E2E lifecycle is idempotent across first run, replay, approval, resume, and replay after resume", () => {
  const companyId = "tenant-a";
  const otherCompanyId = "tenant-b";
  const caseId = "case-1";
  const requestId = "request-1";
  const agencyId = "agency-1";
  const period = "2026-08-17";
  const businessActions = new Map();
  const approvals = new Map();
  const persistedSteps = [{
    id: "foreign-step",
    company_id: otherCompanyId,
    case_id: caseId,
    run_id: "foreign-run",
    tool_name: "escalate_to_manager",
    status: "completed",
    input: { request_id: requestId },
    output: { entity_id: "foreign-event" },
    verification: { verified: true, entity_id: "foreign-event" },
    idempotency_key: buildAgentActionKey({ toolName: "escalate_to_manager", companyId, caseId, requestId, period }),
    created_at: "2026-08-17T23:59:59Z",
  }];
  const runs = [];

  function executeLifecycle(label) {
    const runId = `run-${runs.length + 1}`;
    const steps = [];
    const greenTools = ["send_agency_followup", "create_followup_task", "escalate_to_manager"];
    for (const toolName of greenTools) {
      const actionKey = buildAgentActionKey({ toolName, companyId, caseId, requestId, agencyId, period });
      const input = { request_id: requestId, ...(toolName === "escalate_to_manager" ? {} : { agency_id: agencyId }) };
      const reusable = selectReusableAgentStep(persistedSteps, { companyId, toolName, actionKey, agencyId: input.agency_id || "" });
      if (reusable) {
        assert.equal(businessActions.has(actionKey), true);
        steps.push({
          company_id: companyId, case_id: caseId, run_id: runId, tool_name: toolName,
          status: "skipped", input, output: { entity_id: reusable.verification.entity_id, reused: true },
          verification: { verified: true, entity_id: reusable.verification.entity_id },
          idempotency_key: actionKey, created_at: `${label}Z`,
        });
      } else {
        const entityId = `${toolName}-entity`;
        businessActions.set(actionKey, { company_id: companyId, entity_id: entityId });
        steps.push({
          company_id: companyId, case_id: caseId, run_id: runId, tool_name: toolName,
          status: "completed", input, output: { entity_id: entityId },
          verification: { verified: true, entity_id: entityId },
          idempotency_key: actionKey, created_at: `${label}Z`,
        });
      }
    }

    const approvalKey = `${caseId}:REASSIGN_REQUEST_QUANTITY:agency-1:agency-2`;
    if (!approvals.has(approvalKey)) {
      approvals.set(approvalKey, {
        id: "approval-1", company_id: companyId, approval_status: "Pending",
        stable_action_key: approvalKey, executed_at: null,
      });
    }
    const approval = approvals.get(approvalKey);
    const lifecycle = resolveAgentApprovalState(approval.approval_status);
    steps.push({
      company_id: companyId, case_id: caseId, run_id: runId,
      tool_name: "create_manager_approval_request",
      status: approval.approval_status === "Pending" ? "awaiting_approval" : "skipped",
      output: { entity_id: approval.id, approval_status: approval.approval_status, approval_state: lifecycle.state },
      verification: { verified: true, entity_id: approval.id },
      idempotency_key: approvalKey, created_at: `${label}Z`,
    });
    persistedSteps.push(...steps);
    const run = { id: runId, company_id: companyId, steps, termination_reason: lifecycle.state };
    runs.push(run);
    return run;
  }

  const firstRun = executeLifecycle("2026-08-17T01:00:00");
  assert.equal(firstRun.termination_reason, "awaiting_human_approval");
  const replay = executeLifecycle("2026-08-17T02:00:00");
  assert.equal(replay.termination_reason, "awaiting_human_approval");

  approvals.get("case-1:REASSIGN_REQUEST_QUANTITY:agency-1:agency-2").approval_status = "Approved";
  const resume = executeLifecycle("2026-08-17T03:00:00");
  assert.equal(resume.termination_reason, "approved_awaiting_supported_execution");
  const replayAfterResume = executeLifecycle("2026-08-17T04:00:00");
  assert.equal(replayAfterResume.termination_reason, "approved_awaiting_supported_execution");

  assert.equal(businessActions.size, 3, "no duplicate business actions");
  assert.equal(approvals.size, 1, "no duplicate approvals");
  assert.equal(runs.flatMap((run) => run.steps).some((step) => step.status === "failed"), false, "no failed steps");
  assert.equal(runs.flatMap((run) => run.steps).every((step) => step.verification.verified), true, "all mutations remain verified");
  assert.equal([...businessActions.values()].every((row) => row.company_id === companyId), true, "tenant isolation remains intact");
  assert.equal(persistedSteps.some((step) => step.company_id === companyId && step.output?.entity_id === "foreign-event"), false, "foreign tenant evidence is never reused");
  assert.equal(approvals.values().next().value.executed_at, null, "reassignment remains non-executable");
  assert.equal(resume.steps.filter((step) => ["send_agency_followup", "create_followup_task", "escalate_to_manager"].includes(step.tool_name)).every((step) => step.status === "skipped"), true);
});
