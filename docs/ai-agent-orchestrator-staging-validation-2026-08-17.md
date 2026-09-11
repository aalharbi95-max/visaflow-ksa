# VisaFlow KSA — Agent Orchestrator Staging Validation

Date: 2026-08-17

Environment: Supabase **VisaFlow Staging** (`iijhdilfzndqlguefipn`)

Branch: `codex/ai-agent-orchestrator-phase1-staging`

Pull request: https://github.com/aalharbi95-max/visaflow-ksa/pull/51 (Draft, target `main`)

## Release controls

- No merge was performed.
- No Production deployment or Production database operation was performed.
- No request-to-agency reassignment was executed.
- Agency email delivery was disabled for the QA tenant during the test, so no external email was sent.

## Release-blocker revalidation (PR #51, commits `56ef177` and `5a65d43`)

This section supersedes the earlier replay/resume failures retained below as the original defect record.

Only the new migration `20260817000600_agent_orchestrator_resume_idempotency.sql` and the updated `visaflow-agent-orchestrator` Edge Function were deployed to Supabase Staging. No other function was redeployed in this revalidation, the PR was not merged, and Production was not accessed.

Staging fixture: request `REQ-2026-0006`, case `e8e6f2b0-e867-4be5-bce2-9da7116be879`, approval `5f89538c-12fe-4078-aae0-3285fffdff4d`.

| Scenario | Result | Evidence |
| --- | --- | --- |
| First run | PASS | HTTP 200; terminated `awaiting_human_approval`; one agency follow-up, one follow-up task, and one atomic manager escalation were created and verified. |
| Replay while Pending | PASS | HTTP 200; remained `awaiting_human_approval`; the same approval was reused and all three prior GREEN mutations were re-read, verified, and saved as `skipped / previously_completed_and_verified`. |
| Atomic manager escalation duplicate | PASS | Repeated direct RPC calls returned `created=false`, `skipped=true`, `reason=cooldown_or_duplicate`; no unique-constraint failure and no duplicate notification row occurred. |
| YELLOW approval | PASS | `decide_ai_agent_approval` returned `Approved` for the existing approval and queued one stable resume job. The approval was not recreated or reset. |
| Approval resume | PASS | HTTP 200; terminated `approved_awaiting_supported_execution`; completed GREEN mutations were not repeated. |
| Replay after resume | PASS | HTTP 200; remained `approved_awaiting_supported_execution`; business-row counts and the Approved approval remained unchanged. |
| Duplicate business actions | PASS | Two notification actions total (agency follow-up plus manager escalation), one follow-up task, zero duplicate notification dedupe keys, and zero duplicate task action keys across four successful runs. |
| Failed steps/runs | PASS | Four successful lifecycle runs, zero failed runs, and zero failed execution steps. |
| Verification persistence | PASS | Each GREEN tool has one `completed` step and three `skipped` reuse steps, one distinct action key, and `verification.verified=true` for every step. |
| Duplicate approvals | PASS | Exactly one case approval throughout first run, replay, approval, resume, and post-resume replay. |
| Tenant isolation | PASS | Zero execution steps and zero approvals for the case carried a company other than `90aea850-0215-4e7a-9f8e-5537a6cc86d6`; reusable-step selection is also company- and case-scoped. |
| No reassignment | PASS | Approval status is `Approved`, `executed_at IS NULL`, and the request has zero authorizations for the proposed target agency. No reassignment executor exists or ran. |

Local regression evidence after the Staging-discovered schema-compatibility correction:

- Agent Orchestrator suite: 19/19 passed.
- Full application suite: 296/296 passed.
- Production build: passed (only the existing large-chunk warning).
- Lifecycle regression covers first run, replay, approval, resume, and replay after resume.

Two deployment/test incidents did not mutate the clean final fixture: the first dashboard edit appended code and caused a `BOOT_ERROR`; the content was replaced fully and redeployed. The first runtime attempt then exposed that the approval table uses `requested_by_agent_at`, not `created_at`; commit `5a65d43` corrected the query before the clean lifecycle was run.

## Staging Security Advisor verification

The findings for `employees`, `interviews`, `mobilizations`, and `agency_client_access` are genuine, not false positives. Catalog inspection reported `relrowsecurity=false` and `relforcerowsecurity=false` for all four tables. `anon` has `SELECT`, and `authenticated` has all table privileges on each table.

| Table | RLS | Policies | Staging rows / null company | Minimum safe remediation proposal |
| --- | --- | ---: | ---: | --- |
| `employees` | Disabled | 4 tenant/role policies already exist | 13 / 0 | Revoke all from `anon`, enable RLS, retain and regression-test the existing authenticated tenant/role policies. |
| `interviews` | Disabled | 4 tenant/role policies already exist | 0 / 0 | Revoke all from `anon`, enable RLS, retain and regression-test the existing authenticated tenant/role policies. |
| `mobilizations` | Disabled | 4 tenant/role policies already exist | 1 / 0 | Revoke all from `anon`, enable RLS, retain and regression-test the existing authenticated tenant/role policies. |
| `agency_client_access` | Disabled | 0 | 0 / 0 | Enable RLS and revoke all from both `anon` and `authenticated` (deny by default); add narrowly scoped policies only when a real workflow is defined. |

No RLS or grant change was applied to Staging or Production during this inspection. Before applying the three existing-policy fixes anywhere, test platform-admin, company-admin, operational-role, cross-tenant denial, and service-role behavior in Staging. The `agency_client_access` deny-by-default change should also be checked against any non-repository integration before rollout.

## Updated release recommendation

The replay and approval-resume Release Blocker is resolved on Staging. PR #51 remains Draft and unmerged. Production remains on hold pending review of the PR and a separately reviewed RLS remediation migration; the unsupported reassignment action must remain non-executable until the unified secure request-to-agency service exists.

## Original Phase 1 deployment result

The migration `20260817000500_autonomous_ai_agent_foundation.sql` was applied to Staging and registered in `supabase_migrations.schema_migrations` as `autonomous_ai_agent_foundation`.

Post-migration verification returned:

| Check | Result |
| --- | ---: |
| Required Agent tables | 8/8 |
| Required tables with RLS enabled | 8/8 |
| Professional entitlement columns | 4/4 |
| Enqueue RPC | Present |
| Approval RPC | Present |
| Action-lock RPC | Present |

The following Edge Functions were deployed to Staging:

| Function | Deployment | Runtime validation |
| --- | --- | --- |
| `visaflow-agent-orchestrator` | Deployed and subsequently repaired/redeployed | HTTP 200 on full E2E run |
| `aiagentworker` | Deployed | HTTP 200; queue processing exercised |
| `visaflow-ai-commander` | Deployed | Boot/auth boundary returned expected HTTP 401 for anonymous caller |
| `visaflow-email-dispatcher` | Updated | Boot/auth boundary returned expected HTTP 401 for anonymous caller |

The first dashboard-built Orchestrator bundle omitted its two external imports and exited with `WORKER_ERROR`/HTTP 500. The Staging bundle was corrected and redeployed; subsequent full runs returned HTTP 200. The canonical repository source already contains the imports, so this was a dashboard bundling/deployment artifact rather than a source-code regression.

## E2E scenario results

| Scenario | Result | Evidence |
| --- | --- | --- |
| Multi-step planning and execution | PASS | Run `e9df8f04-6c9c-4d02-8065-20879f90c20b` completed all 11 planned steps with 10 `completed`, 1 intentional `skipped`, and 0 failed steps. |
| Read tool calls | PASS | Request, request lines, candidates, responsible agencies, agency performance, and deterministic blockers were loaded in sequence. |
| GREEN actions | PASS (first execution) | Follow-up notification `28`, follow-up task `6f139c00-2545-4587-8328-f421978b0553`, and manager escalation `29` were created and verified. |
| Mutation verification | PASS | All 11 execution-step verification records were true on the successful GREEN run; the final `verify_action` re-read the last mutation by tenant and entity ID. |
| Audit logs and case events | PASS | Successful GREEN run produced 3 append-only audit rows and 3 case events. YELLOW run produced 4 audit rows and 5 case events. |
| Tenant RLS isolation | PASS | Under the QA Company Admin JWT context, 3 own-company Agent cases were visible and 0 rows from a transactional second tenant were visible. The transaction was rolled back. |
| Function tenant injection | PASS | Supplying a caller-controlled `company_id` was rejected with HTTP 400 / `company_id_not_allowed`. |
| Follow-up cooldown/dedup | PASS | Replay preserved a single agency follow-up event and step 7 returned `cooldown_or_duplicate`. |
| Whole-run dedup/replay | **FAIL** | Replay run `911ee53d-07b0-44f5-a542-1966ce0936d0` failed at step 9. `escalate_to_manager` attempted a duplicate insert against `notification_events_company_dedupe_key_unique` instead of treating it as an idempotent skip/upsert. |
| YELLOW proposal creation | PASS | Run `f968932d-b4ba-4901-8fee-653e2995f74f` ended `awaiting_human_approval`; approval `353701b5-cf55-4a87-97d0-602c4202ad75` proposed `REASSIGN_REQUEST_QUANTITY` with risk `YELLOW` and confidence `0.85`. |
| Authorized approval | PASS | QA Company Admin approved the proposal through `decide_ai_agent_approval`; status became `Approved` and resume job `5aaba8ed-d886-4f6d-a9d8-f3209620006f` was queued. |
| Approval resume | **FAIL** | Worker picked the resume job, but run `686e6ff6-6def-4d65-83d5-174cd092898e` failed at step 9 for the same duplicate manager-escalation path. The job remains queued for retry. |
| No reassignment execution | PASS | Approval `executed_at` remains null; the source authorization count remains 1 and the proposed target-agency authorization count remains 0. |
| External email delivery | NOT RUN (safety control) | `allow_auto_agency_emails=false`; no email-log row was created for test follow-ups. Dispatcher boot and authentication boundary were smoke-tested only. |

## Defects found

### P1 — Resume and replay are not idempotent at manager escalation

`send_agency_followup` correctly uses the action-lock cooldown, but `escalate_to_manager` performs a plain insert using a daily stable `dedupe_key`. On replay, the database unique index rejects the duplicate. This fails the complete run before the existing approval can be resumed safely.

Required fix before Production:

1. Acquire/release an Agent action lock for manager escalation, or use an insert/upsert path that converts the unique conflict into a verified `cooldown_or_duplicate` skip.
2. Ensure approval-resume plans do not blindly repeat already verified GREEN actions, or make every repeated action fully idempotent.
3. Add an integration regression test covering first run, duplicate run, approval, and resume.

### P2 — Staging deployment path is not reproducible enough

Supabase Management API/CLI access was unavailable from the current environment, so the migration and functions were deployed through the Supabase dashboard. The Orchestrator had to be deployed as a single-file inline bundle because the dashboard editor could not preserve the repository's shared-module layout. Migration history was aligned manually after the SQL succeeded.

Before Production, deploy the canonical repository files through a working CLI/CI path and verify migration history without manual repair.

## Risks before Production

- **Release blocker:** fix the manager-escalation replay/resume defect above.
- Build the requested unified, tenant-safe request-to-agency reassignment service before enabling any execution path. Phase 1 currently creates a proposal only.
- Run a controlled email-delivery E2E test with a designated non-human QA mailbox before Production; this validation intentionally did not send email.
- Re-run multi-tenant isolation against two persistent representative tenants in a dedicated QA database, in addition to the successful transactional RLS probe.
- Resolve the pre-existing Supabase Security Advisor findings observed on Staging, including RLS-disabled tables such as `employees`, `interviews`, `mobilizations`, and `agency_client_access`, before a Production release review.
- Remove or archive the clearly tagged `AI Agent E2E` Staging fixtures after review if long-term traceability is not required.

## Production recommendation

The original **NO-GO** below was the decision before the release-blocker fix. The revalidation section above now records PASS for whole-run idempotency and approval resume. Production nevertheless remains on hold for PR review and the separately reviewed RLS remediation; reassignment remains intentionally non-executable.
