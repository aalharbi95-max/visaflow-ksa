# VisaFlow tenant RLS design review

Status: **FAIL — design files are reviewable, but deployment is blocked.**

This review is local only. No SQL was executed against Production or Staging. The design is based on the schema baseline, current policies, `src/App.jsx`, and the checked-in Edge Functions.

## Identity model used by the proposal

- The only browser identity source is `auth.uid()`.
- `public.users.auth_user_id = auth.uid()` must resolve to exactly one active `public.users` row.
- Company identity comes from that row's `company_id`; a browser-supplied `company_id` is never accepted as identity.
- Agency identity comes from that row's `agency_id` and additionally requires all three active records: `agency_members`, `company_agency_access`, and `agency_company_user_access` for the same user, agency, and company.
- The proposal uses `current_log_actor()` because it rejects ambiguous links, inactive users, inactive companies/agencies, and platform users incorrectly attached to a company.
- `Platform Owner` is distinct from `Platform Accounts User` and `Platform Support User`. Only the owner receives the limited access stated below.
- `service_role` remains the only bypass for trusted workers and Edge Functions. No client metadata, email, role string, local storage value, or URL token is treated as identity.

Role abbreviations in the matrix:

- `Internal-R`: active same-company users in the explicitly listed domain roles.
- `Recruit-W`: Admin, Recruitment Manager, Recruitment Officer.
- `Request-W`: Admin, Operations Manager, Project Manager, Recruitment Manager, Recruitment Officer; delete is Admin only.
- `Visa-W`: Admin or Visa Team.
- `Workforce-W`: Admin, Operations Manager, Project Manager, Recruitment Manager, Recruitment Officer; delete excludes recruitment roles.
- `Market-W`: Admin, Operations Manager, Recruitment Manager.
- `Agency-W`: Admin or Recruitment Manager.
- `P-RO`: Platform Owner read-only across tenants.
- `SR`: service_role only.

## Decision matrix: the 32 tenant tables

| Table | Sensitivity / type | Isolation key | Read | Create | Update | Delete | Proposed policy / notes |
|---|---|---|---|---|---|---|---|
| `agency_agreements` | Contracts and commercial terms | Direct `company_id`; `agency_name` is not identity | Internal-R, P-RO | Agency-W | Agency-W | Agency-W | `visaflow_tenant_can(..., agency_management)`; agency denied until an immutable `agency_id` FK exists. |
| `agency_client_access` | Legacy access mapping | `company_id`; `user_id uuid` is incompatible with `users.id bigint` | Agency-W, P-RO | Agency-W / owner | Agency-W / owner | Agency-W / owner | Company/platform administration only; no agency self-access based on email/name/legacy UUID. |
| `agency_company_user_access` | Per-user agency capabilities | `company_id + agency_id + user_id` | Agency-W, matching agency user, P-RO | Agency-W / owner | Agency-W / owner | Agency-W / owner | Agency read requires active membership plus active office and user grants. Agency cannot self-grant. |
| `agency_members` | Agency membership root | Indirect `agency_id + user_id`, then active company grant | Matching agency user; managing company through a visible access row; P-RO | SR | SR | SR | No `company_id`; browser mutation is denied. Invitation RPC/Edge Function must mutate after its own tenant checks. |
| `agency_penalties` | Disciplinary/commercial records | `company_id + agency_id` | Internal-R, P-RO; matching agency only when not Pending Review | Agency-W | Admin/RM/CEO | Agency-W | Agency policy requires the immutable agency UUID and all active grants. |
| `agency_scores` | Agency performance | `company_id`; agency is only text | Internal-R, P-RO | Agency-W | Agency-W | Agency-W | Agency denied until `agency_id` is added/backfilled. Browser filtering by agency name is rejected. |
| `ai_interview_answers` | Biometric media paths, transcript, scoring | `company_id`, restricted by parent `session_id` company | Admin/CEO/Ops/RM/RO, P-RO | Recruit-W | Recruit-W | Recruit-W | Parent-company restrictive policy. No anon/candidate policy in this migration. |
| `ai_interview_questions` | Interview content and scoring model | Direct `company_id` | Admin/CEO/Ops/RM/RO, P-RO | Recruit-W | Recruit-W | Recruit-W | Candidate portal must receive a safe projection through a server endpoint, not table access. |
| `ai_interview_sessions` | PII, consent, tokens, media, AI decisions | Direct `company_id` | Admin/CEO/Ops/RM/RO, P-RO | Recruit-W | Recruit-W | Recruit-W | No anon policy. `access_token` must not be a PostgREST authorization mechanism. |
| `candidate_technical_profiles` | Candidate assessment | `company_id`, restricted by parent `candidate_id` | Internal-R, P-RO | Recruit-W | Recruit-W | Admin/RM | Parent-company restrictive policy; agency denied because candidate ownership is not keyed by agency UUID. |
| `candidates` | Passport/contact/employment PII | Direct `company_id`; agency is only text | Internal-R, P-RO | Recruit-W | Recruit-W | Admin/RM | Agency and candidate self-access denied until immutable ownership keys exist. |
| `collections` | Payment records | `company_id`, restricted by parent `invoice_id` | Admin/CEO/Ops/RM/Viewer, P-RO | Market-W | Market-W | Market-W | Parent invoice must have the same company. |
| `company_agency_access` | Office-to-company capability grant | `company_id + agency_id` | Agency-W, matching agency, P-RO | Agency-W / owner | Agency-W / owner | Agency-W / owner | Agency read requires matching active per-user grant too; no self-grant. |
| `company_agency_users` | Legacy company/agency/user map | `company_id + agency_id`; `user_id uuid` is legacy | Agency-W, P-RO | Agency-W / owner | Agency-W / owner | Agency-W / owner | No agency self-policy until the user key is migrated to the canonical app-user ID. |
| `company_email_settings` | SMTP configuration and password | Direct `company_id` | Admin, P-RO safe columns only | Admin | Admin | Admin | `smtp_password` is write-only for authenticated clients; service_role can read it. Current `.select()` after mutation must be changed before deployment. |
| `demobilizations` | Workforce operational data | Direct `company_id` | Internal workforce roles, P-RO | Workforce-W | Workforce-W | Admin/Ops/PM | Direct tenant policy. |
| `employees` | Employee PII and workforce records | Direct `company_id` | Internal workforce roles, P-RO | Workforce-W | Workforce-W | Admin/Ops/PM | Direct tenant policy. |
| `interviews` | Candidate PII and evaluation | `company_id`, restricted by candidate company | Internal-R, P-RO | Recruit-W | Recruit-W | Admin/RM | Agency scheduling is denied until `agency_id` ownership is added; parent-company restrictive policy. |
| `invoice_items` | Invoice detail | `company_id`, restricted by parent `invoice_id` | Admin/CEO/Ops/RM/Viewer, P-RO | Market-W | Market-W | Market-W | Parent invoice must have the same company. |
| `invoices` | Financial records | Direct `company_id` | Admin/CEO/Ops/RM/Viewer, P-RO | Market-W | Market-W | Market-W | Direct tenant policy. |
| `local_content_project_targets` | Regulatory targets | Direct `company_id` | Admin/CEO/Ops/PM/RM, P-RO | Admin/Ops/RM | Admin/Ops/RM | Admin/Ops/RM | Direct tenant policy. |
| `marketplace_deal_workers` | Employee identity attached to deals | `company_id`, restricted by text `deal_id -> marketplace_deals.id` | Admin/CEO/Ops/RM/Viewer, P-RO | Market-W | Market-W | Market-W | Restrictive parent check; text/bigint mismatch remains a schema debt. |
| `marketplace_deals` | Commercial workforce deals | Direct `company_id` | Admin/CEO/Ops/RM/Viewer, P-RO | Market-W | Market-W | Market-W | Direct tenant policy. |
| `marketplace_requests` | Client demand and pricing | Direct `company_id` | Admin/CEO/Ops/RM/Viewer, P-RO | Market-W | Market-W | Market-W | Direct tenant policy. |
| `mobilizations` | Candidate travel/onboarding PII | Direct `company_id`; `candidate_id bigint` cannot FK to UUID candidates | Internal workforce roles, P-RO | Workforce-W | Workforce-W | Admin/Ops/PM | Company isolation works; candidate relation cannot be validated until the type mismatch is migrated. |
| `onboarding_validations` | Candidate/agency performance | `company_id + candidate_id + optional agency_id` | Internal workforce roles, P-RO | Workforce-W | Workforce-W | Admin/Ops/PM | Agency browser access is not currently used and remains denied. Candidate FK should be enforced before agency access. |
| `request_lines` | Manpower request detail | `company_id`, restricted by parent `request_id` | Internal-R, P-RO | Request-W | Request-W | Admin | Parent request must have the same company; agencies remain on the notification/access workflow, not direct table access. |
| `requests` | Manpower plans and approvals | Direct `company_id` | Internal-R, P-RO | Request-W | Request-W | Admin | Direct tenant policy; Agency is explicitly blocked by current application logic too. |
| `visa_allocations` | Visa inventory allocation | `company_id`, restricted by batch-line company when present | Internal-R, P-RO | Visa-W | Visa-W | Visa-W | Restrictive parent check. |
| `visa_authorizations` | Visa authorization PII | Direct `company_id` | Internal-R, P-RO | Visa-W | Visa-W | Visa-W | Direct tenant policy. |
| `visa_batch_lines` | Visa batch detail | `company_id`, restricted by parent `visa_batch_id` | Internal-R, P-RO | Visa-W | Visa-W | Visa-W | Parent batch must have the same company. |
| `visa_batches` | Visa inventory | Direct `company_id` | Internal-R, P-RO | Visa-W | Visa-W | Visa-W | Direct tenant policy. |

The migration revokes every table privilege from `anon`, keeps `service_role` for trusted server work, and creates separate SELECT/INSERT/UPDATE/DELETE policies so a `company_id` change is checked against the new row. It adds restrictive parent checks where the schema provides a usable relation.

## Eight unresolved tables: remain fail-closed

| Table | Why unresolved | Safe options | Product impact while closed |
|---|---|---|---|
| `ai_agent_settings` | Company-keyed but read by both browser and `aiagentworker`; settings may drive privileged actions. | Admin read/write plus service worker, or service-only with an admin RPC that validates fields. Recommended: service-only writes and a redacted admin projection. | AI Agent settings page and worker configuration load fail. |
| `ai_interview_templates` | Company-keyed, but the unauthenticated candidate portal currently reads templates directly. | Split internal template metadata from a candidate-safe projection returned by a token-validating Edge endpoint. | Public AI interviews cannot load their template. |
| `companies` | The row ID is the tenant key; login, platform pages, agency workspace switch, and email dispatcher all read it. | Self-company projection for authenticated users; linked-company projection for agencies; platform RPCs for owner; service_role for dispatcher. Do not grant raw table SELECT broadly. | Company workspace bootstrap/login and agency company switch can fail. |
| `education_institutions` | Nullable `company_id` mixes global catalog and tenant overrides. | Add explicit `scope`/owner fields, or split global and tenant tables. Global rows need a reviewed public/authenticated read decision. | Education master-data lookups fail. |
| `email_templates` | Nullable `company_id` mixes platform defaults and tenant templates; dispatcher reads it. | Split/mark immutable platform defaults; same-company admin write; service dispatcher read. | Notification/email template screens and dispatch may fail. |
| `local_content_settings` | Company-keyed, but approval ownership and worker use are not documented. | Same-company read for approved roles, Admin/Ops/RM write, or server RPC if calculations are authoritative. | Local-content dashboard settings fail. |
| `profession_aliases` | Nullable `company_id` mixes global aliases and tenant overrides. | Split global/tenant catalogs or add explicit scope; global writes platform-only, tenant writes Admin. | Profession normalization and master-data lookups fail. |
| `subscription_invoices` | Uses `client_id`, not `company_id`; the relationship to `companies`/`platform_clients` is not constrained. | Add a trusted FK and decide whether clients can self-read; otherwise Platform Owner/service only. | Platform subscription invoice page fails. |

No policy in `20260717000040` opens these tables. The baseline deny policy remains in force.

## AI interview audio decision

Decision: **do not apply the current Storage policy migration.** The current browser flow in `src/App.jsx`:

1. accepts a long-lived `accessToken` from the public interview link;
2. queries and updates `ai_interview_sessions` directly as anon;
3. reads/writes `ai_interview_answers` directly;
4. uploads to `ai-interview-audio` and creates signed read URLs directly.

Removing anon Storage/table access now will stop the public candidate interview. Keeping it allows an untrusted browser to use a bearer URL token as database authorization and exposes a broad write surface.

Two safe product choices require approval before implementation:

- **Authenticated candidate (strongest):** require a Supabase magic-link/OTP session linked to the intended candidate, then issue exact-path signed upload/read URLs. This adds a login step to every interview.
- **Server-mediated public interview (lower friction):** an Edge Function validates a one-time invitation secret by hash, binds a short-lived server capability to the exact interview/session and nonce, and returns only candidate-safe fields. Every state transition is an RPC/Edge call; audio uses a short-lived signed upload URL for one exact path and a short-lived signed read URL. The browser never receives service credentials and receives no direct table privileges.

In both choices the object path must be generated server-side and bound to `company_id/session_id/question_id/random_uuid`; the server must reject overwrite, cross-session paths, completed/expired sessions, and replay. The existing anon read/insert/update policies in `20260717000060_visaflow_storage_policies.sql` are a concrete blocker, but that file was not changed in this phase as requested.

## SECURITY DEFINER allowlist review (58 functions)

`Y` means direct EXECUTE is proposed. `Trigger` means no client/service grant is needed after the trigger is created. Every function is revoked from `PUBLIC`; service jobs receive only the worker contracts listed here.

| Function | anon | authenticated | service_role | Decision |
|---|---:|---:|---:|---|
| `add_candidates_to_ai_interview_campaign` | N | N | Y | Browser grant removed until role/status checks are inside the function. |
| `ai_agent_emergency_stop` | N | N | Y | Worker/admin server contract only. |
| `ai_agent_release_lock` | N | N | Y | Called by `aiagentworker`. |
| `ai_agent_try_acquire_lock` | N | N | Y | Accepts arbitrary company IDs and has no caller check; current browser call must move server-side. |
| `ai_interview_campaign_candidate_sync_session_trigger` | N | N | Trigger | Trigger-only. |
| `ai_interview_campaign_sync_delivery_to_sessions_trigger` | N | N | Trigger | Trigger-only. |
| `ai_interview_delivery_preflight` | N | Y | Y | Read-only schema preflight. |
| `ai_interview_enforce_campaign_delivery_on_session` | N | N | Trigger | Trigger-only. |
| `ai_interview_sync_linked_session_delivery` | N | N | Y | Internal worker/server synchronization. |
| `assign_request_no_before_insert` | N | N | Trigger | Trigger-only. |
| `claim_ai_interview_analysis_job` | N | N | Y | Background worker contract. |
| `claim_ai_interview_invitation_jobs` | N | N | Y | Background worker contract. |
| `complete_ai_interview_analysis_job` | N | N | Y | Background worker contract. |
| `complete_ai_interview_invitation_job` | N | N | Y | Background worker contract. |
| `create_ai_interview_template_version` | N | N | Y | No caller authorization in function; browser grant removed. |
| `current_app_agency_id` | N | Y | Y | Returns only the current linked actor's agency. |
| `current_app_company_id` | N | Y | Y | Returns only the current linked actor's company. |
| `current_app_role` | N | Y | Y | Returns only the current linked actor's role. |
| `current_app_user_agency_id` | N | Y | Y | Self-scoped identity helper. |
| `current_app_user_company_id` | N | Y | Y | Self-scoped identity helper. |
| `current_app_user_has_role` | N | Y | Y | Self-scoped role predicate. |
| `current_app_user_id` | N | Y | Y | Self-scoped identity helper. |
| `current_app_user_role` | N | Y | Y | Self-scoped role helper. |
| `current_log_actor` | N | Y | Y | Canonical strict actor lookup used by policies. |
| `enqueue_ai_interview_analysis_on_completion` | N | N | Trigger | Trigger-only. |
| `fail_ai_interview_analysis_job` | N | N | Y | Background worker contract. |
| `fail_ai_interview_invitation_job` | N | N | Y | Background worker contract. |
| `get_ai_interview_invitation_queue_summary` | N | N | Y | Operational worker visibility; no current browser caller. |
| `get_authenticated_app_user` | N | Y | Y | Validates `auth.uid()` and unique active user linkage. |
| `get_owner_talent_dashboard` | N | Y | Y | Contains its own platform-role check. |
| `get_talent_public_stats` | Y | Y | Y | Only approved anonymous RPC; returns aggregate public counts. |
| `guard_agency_company_user_access` | N | N | Trigger | Trigger-only authorization guard. |
| `guard_company_agency_access` | N | N | Trigger | Trigger-only authorization guard. |
| `guard_platform_user_roles` | N | N | Trigger | Trigger-only authorization guard. |
| `guard_users_security` | N | N | Trigger | Trigger-only authorization guard. |
| `handle_new_talent_candidate` | N | N | Trigger | Auth trigger only. |
| `is_agency_user` | N | Y | Y | Self-scoped predicate. |
| `is_company_user` | N | Y | Y | Self-scoped predicate. |
| `is_current_platform_user` | N | Y | Y | Self-scoped predicate; does not itself grant table access. |
| `is_platform_user` | N | Y | Y | Self-scoped predicate. |
| `launch_ai_interview_campaign` | N | N | Y | Browser grant removed until role/status checks are complete and mandatory. |
| `legacy_app_login` | N | N | N | Incompatible with Auth-backed RLS and exposes a password-comparison RPC; migrate remaining users, then remove. |
| `list_manageable_app_users` | N | Y | Y | Contains company/platform management checks. |
| `log_system_activity` | N | N | Trigger | Trigger-only. |
| `next_request_no` | N | N | Trigger | Used by request-number generation path, not a browser API. |
| `publish_ai_interview_template_version` | N | N | Y | No proven browser caller; server only until in-function role check. |
| `queue_ai_interview_analysis` | N | N | Y | Worker/server queue contract. |
| `refresh_ai_interview_campaign_counts` | N | N | Y | Worker/trigger maintenance. |
| `remove_candidates_from_ai_interview_campaign` | N | N | Y | Browser grant removed until strict role/status guard. |
| `revalidate_ai_interview_campaign_candidates` | N | N | Y | Browser grant removed until strict role/status guard. |
| `sync_ai_interview_session_to_campaign` | N | N | Trigger | Trigger-only. |
| `talent_after_candidate_profile_change` | N | N | Trigger | Trigger-only. |
| `talent_after_profile_change` | N | N | Trigger | Trigger-only. |
| `talent_calculate_profile_completeness` | N | N | Y | Server maintenance helper only. |
| `talent_guard_managed_fields` | N | N | Trigger | Trigger-only. |
| `talent_is_privileged_actor` | N | N | Y | Internal/server predicate; browser does not need direct execute. |
| `talent_refresh_profile_completeness` | N | N | Y | Server maintenance helper only. |
| `trg_refresh_ai_interview_campaign_counts` | N | N | Trigger | Trigger-only. |

The migration additionally defines two policy helpers (`visaflow_tenant_can` and `visaflow_agency_can`), revoked from PUBLIC/anon and executable only by authenticated/service_role. The baseline's browser grants for legacy login, AI lock acquisition, template version creation, and campaign mutation are explicitly revoked.

## Local files prepared

- `supabase/migrations/20260717000040_visaflow_tenant_rls_policies.sql`: helper functions, deny-anon ACLs, operation-specific policies for 32 tables, agency capability checks, parent-company restrictive policies, SMTP password column ACL, and corrected SECURITY DEFINER grants.
- `supabase/tests/visaflow_tenant_rls_policies_test.sql`: 20 pgTAP assertions covering company isolation, agency isolation, candidate denial, anon denial, Platform Owner read-only behavior, service_role access, `company_id` mutation rejection, and cross-company parent rejection.
- This report: matrix, unresolved decisions, audio design, allowlist, breakage and rollback plan.

## Known product breakage if applied now

| Severity | Path | Cause / required remediation |
|---|---|---|
| P0 | Public AI interview and audio | Candidate has no Auth-backed policy; direct anon session/answer/Storage access is removed. Implement one of the approved server-mediated/authenticated designs first. |
| P0 | Company workspace bootstrap/login | `companies` remains fail-closed while `src/App.jsx` directly reads it after login. Add a safe self-company/agency projection RPC and update the caller. |
| P0 | Legacy company login | `legacy_app_login` cannot establish an Auth session and is revoked. Migrate every active workspace user to Supabase Auth before enforcing tenant RLS. |
| P1 | Agency Office Portal candidate/interview operations | `candidates` and `interviews` use mutable agency-name text, not `agency_id`; secure agency writes/reads are denied. Add/backfill constrained `agency_id`. |
| P1 | AI campaign actions | Several SECURITY DEFINER mutation RPCs trust any linked company user or lack checks; authenticated EXECUTE is revoked. Add strict role/status/tenant checks or server wrappers. |
| P1 | AI Agent browser action | `ai_agent_try_acquire_lock` has no caller validation and is called from the browser. Move it behind a trusted worker/Edge endpoint. |
| P1 | Email settings save/test | Browser mutations call `.select()` without a safe column list; column ACL hides `smtp_password`, so PostgREST will reject the returned `*`. Request explicit safe columns and move secret persistence to an Edge Function/vault. |
| P1 | Eight unresolved tables | Pages and workers listed above remain fail-closed until their ownership/scope decisions are approved. |
| P2 | Weak/missing relations | `mobilizations.candidate_id bigint` vs UUID candidate IDs and text marketplace deal IDs prevent complete FK-backed ownership checks. |

## Validation performed locally

- Confirmed all 32 tables are represented in the migration mapping (31 direct-company tables plus special `agency_members`).
- Confirmed all eight unresolved tables remain outside the migration mapping and retain fail-closed baseline policies.
- Confirmed no policy grants `anon` access to the 32 tables.
- Confirmed UPDATE policies use both `USING` and `WITH CHECK`, blocking tenant-key reassignment.
- Confirmed agency authorization requires canonical `auth.uid()` linkage and all active membership/access rows.
- Confirmed the current app's direct table/RPC paths and role gates were used to build the matrix.
- The pgTAP file was prepared but **not executed**, because running it requires applying the unapproved baseline/migration to an isolated local/Staging database.

## Proposed application order after remediation and approval

1. Fix the three P0 paths and the P1 browser RPC/secret paths in code and migrations.
2. Add preflight checks for missing/null tenant keys, orphan parents, candidate/interview agency backfill, and role values.
3. Snapshot isolated Staging.
4. Apply baseline, this RLS migration, bucket metadata, and only an approved replacement Storage policy (not the current anon policy file).
5. Apply later repository migrations and re-run a final function-ACL audit because later migrations can re-grant EXECUTE.
6. Run pgTAP, API tests with real anon/authenticated/service JWTs, public interview tests, agency multi-company tests, company/candidate login and recovery tests, then inspect PostgREST logs for permission errors.

## Rollback plan

- Preferred: restore the Staging snapshot taken immediately before application.
- If snapshot restore is unavailable, stop Staging traffic; do not relax policies ad hoc.
- A reviewed forward rollback may drop only `vf_*` policies and the two helper functions, then restore the baseline fail-closed policy on all 32 tables. It must not restore Production's broad anon grants.
- Restore prior function EXECUTE grants only from an approved allowlist, never `GRANT ... TO PUBLIC`.
- Storage rollback is separate; no Storage change is part of this migration.

## Decision

**FAIL — needs remediation before Staging.** The local RLS design is fail-closed and suitable for review, but the public interview flow, company bootstrap, and legacy login are P0 deployment blockers. No SQL was applied and no commit, push, or PR was created.
