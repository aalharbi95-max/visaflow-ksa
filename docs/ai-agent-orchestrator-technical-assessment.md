# VisaFlow Agent Orchestrator — technical assessment

Date: 17 August 2026

## Executive assessment

VisaFlow already has a useful automation substrate: a protected background Worker, tenant-filtered context reads, action locks, cooldowns, rate limits, audit logs, an email dispatcher with server-resolved recipients, AI credit enforcement, deterministic agency scoring, and Professional entitlements. The safe incremental path is to retain that substrate and add a case/run/step orchestration layer. Replacing the Worker or Commander would duplicate controls and create migration risk.

The Phase 1 implementation adds that layer and a complete recruitment-request review slice. It deliberately uses deterministic rules for quantities, SLA thresholds, risk gates, and tool authorization. The model is not given SQL or a Supabase client. External candidate/agency content remains data and is never promoted into system policy.

## 1. Existing functions that can become Agent tools

| Existing capability | Controlled tool use |
| --- | --- |
| `aiagentworker.safeSelect` and tenant-scoped context loader | Request, request-line, candidate, agency, authorization and interview read tools |
| `getRequestQty` and request-line logic | `get_request_blockers` and deterministic quantity gap |
| `buildAgencyScorecard` / `agencyFitScore` | `get_agency_performance` and evidence-backed YELLOW recommendation |
| `getAgencyFollowUpTasks` | Blocker and stale-candidate signals |
| `ai_agent_try_acquire_lock` / `ai_agent_release_lock` | Mutating-tool idempotency and cooldown |
| `visaflow-email-dispatcher` contracts | `send_agency_followup`; recipients remain database-resolved |
| `notification_events` | Internal follow-up and operational escalation evidence |
| authorization/interview workers and secure RPCs | Later interview, authorization and mobilization tool wrappers |

Phase 1 registers: `get_request`, `get_request_lines`, `get_request_candidates`, `get_request_agencies`, `get_agency_performance`, `get_request_blockers`, `send_agency_followup`, `create_followup_task`, `escalate_to_manager`, `verify_action`, and `create_manager_approval_request`.

## 2. Worker capabilities reused

- Internal scheduler authentication uses `AI_AGENT_WORKER_SECRET`, not the service-role key.
- Professional entitlement, monthly credit limit, action-per-run limit, hourly limit, retry count, cooldown lock and job queue remain in place.
- Existing agency daily digests and manager recommendation flows are unchanged.
- `orchestrator_request_review` and `orchestrator_approval_resume` jobs are routed by the same Worker to the Orchestrator; legacy job types still use `processCompany`.
- Existing email delivery and retry observability remains the source of delivery truth.

## 3. Commander capabilities reused

Commander remains the conversational surface and retains its current executive answer modes. A new `agent_goal` action passes the authenticated JWT and goal to the Orchestrator. The Commander does not choose tools, send `company_id`, or receive mutation credentials.

## 4. Current tables relevant to memory

Existing tables retained: `ai_agent_settings`, `ai_agent_jobs`, `ai_agent_action_locks`, `ai_agent_audit_logs`, `ai_agent_worker_runs`, `ai_agent_usage_ledger`, `notification_events`, and `email_logs`.

New normalized operational memory: `ai_agent_cases`, `ai_agent_runs`, `ai_agent_execution_steps`, `ai_agent_case_events`, and `ai_agent_case_memory`. Memory stores structured facts, decisions, evidence and action summaries only; it must not store hidden chain-of-thought.

## 5. Existing approval mechanisms

The existing Agent creates manager approval notifications for agency recommendations, while interview templates, authorization flows and hiring offers have their own approval states/RPCs. There was no durable generic Agent approval record tied to a case and run. `ai_agent_approval_requests` and `decide_ai_agent_approval` now add that link, capture human feedback, and queue the same case for review after approval. Phase 1 does not autonomously execute agency reassignment because the repository has no single authoritative, secure request-to-agency assignment mutation to wrap.

## 6. Existing audit mechanisms

`ai_agent_audit_logs` is retained as the append-oriented operational audit stream. The Orchestrator additionally records every tool in `ai_agent_execution_steps` and every case transition/action in `ai_agent_case_events`. Mutating tools return an entity identifier, before/after state where applicable, audit identifier, and explicit verification result.

## 7. Existing Agent settings

The current settings already cover activation, mode, manager notification, agency follow-up, outbound agency email, reminder/escalation days, run/action limits, cooldown, retries and daily brief time. Phase 1 extends the same row with allowed/blocked actions, maximum steps, daily action ceiling, working hours, language, stale/follow-up thresholds and internal-notification policy. Existing columns and defaults remain compatible.

## 8. Scheduling / Cron

The repository has a durable `ai_agent_jobs` queue and a Worker contract intended for an external cron call, but no AI Agent `pg_cron` installation migration. Other workers demonstrate the `pg_cron` + `pg_net` pattern. Phase 1 reuses the queue and Worker; production must continue invoking `aiagentworker` using its dedicated secret. A later deployment change can install an environment-specific cron without embedding secrets in source control.

## 9. Architecture conflicts found

- The Worker was batch-oriented: it did not persist a goal, plan, current step, termination reason, or resumable case state.
- Commander recommendations and Worker actions were separate; Commander had no controlled execution hand-off.
- Commander accepted a browser-provided snapshot for advisory answers. That remains suitable only for display; operational tools now re-read server-owned data.
- Older lock RPCs trusted caller-supplied company/agency identifiers, and snapshot grants exposed Agent tables to `anon`. The Phase 1 migration derives/validates tenant identity for authenticated lock calls, removes anonymous access, enables RLS, and limits browser operations.
- Agency responsibility is represented indirectly through candidate/authorization agency names rather than a single immutable request-agency assignment table. Phase 1 will not invent or mutate an assignment relation.
- `request_lines` are authoritative for quantity, profession, nationality and gender, while request headers contain legacy duplicates. The Orchestrator calculates quantities from lines.
- Existing source snapshots contain baseline tables that are not introduced by ordinary migrations. The Phase 1 migration therefore uses additive `if not exists` changes and assumes the documented production baseline.

## 10. Schema changes

- Add case, run, execution-step, event, structured-memory, follow-up-task and approval-request tables.
- Extend `ai_agent_settings` with policy fields and `ai_agent_usage_ledger` with case/tool/cost/execution dimensions.
- Add tenant indexes, status/risk constraints, RLS and least-privilege grants.
- Harden lock acquisition/release and add tenant-derived queue/approval RPCs.
- Add Agent-specific dispatcher contracts whose recipients are resolved from tenant-owned notification and agency/user records.

## 11. Proposed implementation phases

1. **Foundation and request vertical slice (implemented):** registry, deterministic planner, permission/risk checks, cases/runs/steps, verified mutation, memory, approvals, Worker and Commander hand-off.
2. **Recruitment expansion:** normalized request-agency assignment service, missing-document tools, candidate reminders, explicit SLA SOP records, event deduplication and approved reassignment execution.
3. **Interview and hiring:** wrap existing secure interview scheduling/invitation functions; keep salary/legal offer terms human-controlled.
4. **Mobilization:** visa, authorization, medical, ticket, travel, arrival and joining read/action wrappers.
5. **Long-running goals:** target/date forecasting, event ingestion, recurring next-check processing and daily operational review.
6. **Optimization:** environment-configurable model router, complete cost estimates, 200+ eval scenarios, safety gates and owner observability.

## 12. Security risks and controls

| Risk | Control |
| --- | --- |
| Cross-tenant `company_id` spoofing | Browser payload rejects `company_id`; server derives it from one active user. Internal calls derive it from a stored job/case. Every query filters it. |
| Model-issued raw mutation/SQL | No SQL tool exists. The registry is an allowlist and tools use fixed queries/business rules. |
| Prompt injection in CV/email/notes | Phase 1 planning and hard constraints are deterministic. Untrusted text is data only and dispatcher templates use bounded fields. |
| Unauthorized or RED action | Role gate, tenant policy, registry risk metadata and human-only RED rule are enforced outside model output. |
| Duplicate email/task/escalation | Stable action keys, unique constraints, locks, cooldown and dispatcher idempotency. |
| False success reporting | Mutation evidence is re-read; email-enabled follow-up also requires queued/sent `email_logs` evidence. |
| Infinite or costly loop | Structured plan with default 12 and hard maximum 20 steps; entitlement and existing credit controls remain active. |
| Service-role exposure | Service key is read only inside Edge Functions. Commander forwards the user's JWT, never privileged credentials. |
| Approval bypass | Approval only changes proposal state and queues the same case; it does not bypass the future action tool's permission, tenant and verification checks. |

## Known Phase 1 boundary

The vertical slice performs verified GREEN follow-ups, internal tasks and non-financial escalations, and creates a durable YELLOW reassignment proposal. It does not execute reassignment after approval until an authoritative request-agency assignment mutation is identified or added as a separately reviewed business service. This is intentional: modifying authorization/candidate records would not be an equivalent or safe substitute.
