# Supabase security-permissions audit baseline

Generated for `feature/prelaunch-workflow-sprint1` on 2026-07-30. This is a
local evidence baseline; it did not query or change Staging or Production.

## Method and evidence

Run `node scripts/security-permissions-inventory.mjs` to reproduce the exact
resource list, operations, source files, and line numbers. The scanner walks
all JavaScript/TypeScript source below `src`, including the non-bundled
`src/New folder/App.jsx` and `src/App_Working_Backup.jsx` copies. It detects
Supabase table calls, RPC calls, Storage buckets, and Auth operations.

The audit compares that inventory with repository migrations, the 2026-07-27
Staging schema snapshot, protected-write scan, and executable PGlite
PostgreSQL tests. `VERIFIED` is used only where a behavioral database test or
an equally direct ACL assertion exists. A migration definition alone is not
treated as runtime verification.

| Status | Count |
|---|---:|
| VERIFIED | 7 |
| NEEDS TEST | 82 |
| BROKEN | 1 |
| UNUSED | 1 |

## Control evidence codes

| Code | Current GRANT, RLS, and policy evidence |
|---|---|
| AGENCY-R | `authenticated` has `SELECT` only on `agencies`, `companies`, `company_agency_access`, and `agency_company_user_access`; RLS policies are `agencies_tenant_select`, `companies_tenant_select`, `company_agency_access_tenant_select`, and `agency_company_user_access_tenant_select`. Direct DML is revoked. |
| AGENCY-C | New `company_agency_create(jsonb)` is `SECURITY DEFINER`, has empty `search_path`, derives the company from `auth.uid()`, rejects unknown fields, revokes `PUBLIC`/`anon`, and grants only `authenticated`. Ten executable tests cover its ACL and tenant behavior. |
| AUTHZ-R | `authenticated` has SELECT-only access to `visa_authorizations`, `authorization_events`, and `notification_events`; workflow DML is revoked. RLS policies are `visa_authorizations_select_prelaunch_workflow`, `authorization_events_select_prelaunch_workflow`, and `notification_events_recipient_select`. |
| AUTHZ-W | `notification_event_mutate(jsonb)` is the tested definer write path with empty `search_path` and authenticated-only execution. Authorization workflow writes are exercised by the existing eight PostgreSQL tests. |
| USERS-RPC | Direct `anon` and `authenticated` access to `public.users` is revoked by `20260719000200`; application reads/manages users through security-definer RPCs. Full behavioral role coverage is still missing. |
| SNAPSHOT | The resource exists in repository SQL or the Staging schema snapshot, but its effective GRANT/RLS/policy combination has not been behaviorally reconciled. |
| PROVIDER | Controlled by Supabase Auth or Storage policies rather than a public-table grant. Provider/bucket policy tests are still required. |
| N/A | Dynamic or non-production source usage has no single static database control. |

## Sensitive-resource review

| Resource | UI operations and screens | Expected roles | Current control | Gap / risk | Severity | Status |
|---|---|---|---|---|---|---|
| `companies` | Company setup and platform client screens in `src/App.jsx`; SELECT/INSERT/UPDATE | tenant Admin/Company Admin; platform roles only for cross-tenant administration | AGENCY-R | Live `saveCompany` still performs direct INSERT/UPDATE although the secure baseline grants SELECT only. A tenant-bound company mutation RPC/Edge path is required. | P1 | BROKEN |
| `users` | User/session management; direct table DML occurs only in `src/New folder/App.jsx` | Admin/Company Admin within tenant; platform account roles where applicable | USERS-RPC | RPC behavior is not fully tested against role and tenant combinations; stale direct-DML copy must not be shipped. | P1 | NEEDS TEST |
| `agencies` | Agencies list; historical DML in legacy copies | Admin, Company Admin, Recruitment Manager for create; tenant viewers for SELECT | AGENCY-R + AGENCY-C | Edit/delete intentionally have no browser write path. New create path is tested but migration is not applied. | P2 | VERIFIED |
| `company_agency_access` | Agency matching/list; historical DML in legacy copies | same tenant authorized creators/readers | AGENCY-R + AGENCY-C | Create/link is covered; edit/delete remain intentionally unavailable. | P2 | VERIFIED |
| `agency_company_user_access` | Agency/user access resolution; stale copy contains DML | Admin/Company Admin for management; assigned agency users for SELECT | AGENCY-R | Needs executable cross-company and actor-role matrix; current production source only reads it. | P1 | NEEDS TEST |
| `requests` | Request create/edit/approve/delete and operational dashboards | configured request roles, tenant-bound | SNAPSHOT | Direct multi-step writes need transaction/partial-failure and cross-tenant tests. | P1 | NEEDS TEST |
| `request_lines` | Request line create/delete and candidate flows | same company roles as parent request | SNAPSHOT | Parent-child tenant enforcement and delete behavior need PostgreSQL tests. | P1 | NEEDS TEST |
| `visa_batches`, `visa_batch_lines` | Visa inventory import/batch screens | Admin, Company Admin, Visa Team | SNAPSHOT | These are the code resources corresponding to “visa inventory”; DML and child-row isolation need tests. | P1 | NEEDS TEST |
| `visa_allocations` | Allocation and mobilization flows | Admin, Company Admin, Visa Team; approved workflow actors | SNAPSHOT | Direct DML remains and needs tenant, capacity, and concurrency tests. | P1 | NEEDS TEST |
| `visa_authorizations` | Authorization workflow; legacy copies contain old direct writes | Admin, Company Admin, Visa Team for mutations; scoped readers | AUTHZ-R + AUTHZ-W | Eight executable tests cover the new workflow; old source copies are not bundled. | P2 | VERIFIED |
| `authorization_events` | Authorization timeline SELECT | scoped tenant/agency recipient roles | AUTHZ-R + AUTHZ-W | RESTRICT/immutability and tenant reads are executable-test covered. | P2 | VERIFIED |
| `notification_events` | Notifications; production mutations use RPC | recipient or explicitly authorized same-company actor | AUTHZ-R + AUTHZ-W | Dedupe, tenant crossing, and recipient isolation are executable-test covered. | P2 | VERIFIED |
| `candidates` | Candidate CRUD, AI campaign and marketplace flows | recruitment roles within tenant/agency assignment | SNAPSHOT | Broad surface and direct DML require company, agency, and recipient behavioral matrix. | P1 | NEEDS TEST |
| `interviews` | Interview scheduling and candidate flows | recruitment/interview roles in tenant | SNAPSHOT | Direct DML needs ownership, candidate-company, and cross-tenant tests. | P1 | NEEDS TEST |
| `mobilizations` | Mobilization workflow | operations/recruitment roles in tenant | SNAPSHOT | Direct DML needs state-transition and cross-tenant tests. | P1 | NEEDS TEST |
| `employees` | Employee lifecycle and marketplace worker flow | HR/operations roles in tenant | SNAPSHOT | Direct DML needs company and candidate lineage tests. | P1 | NEEDS TEST |
| `demobilizations` | Demobilization workflow | authorized operations/HR roles in tenant | SNAPSHOT | Direct DML needs employee-company and state-transition tests. | P1 | NEEDS TEST |

## Complete inventory

Exact call-site lines are emitted by the scanner. “App” means the production
`src/App.jsx`; “legacy” means `src/New folder/App.jsx` or
`src/App_Working_Backup.jsx`, neither of which is imported by the production
entrypoint.

### Auth and Storage

| Type/resource | Operations | Files/screens | Expected roles | Current control | Gap | Severity | Status |
|---|---|---|---|---|---|---|---|
| Auth `getSession` | AUTH | App session bootstrap | signed-in user | PROVIDER | session-expiry behavior needs provider test | P2 | NEEDS TEST |
| Auth `onAuthStateChange` | AUTH | App and `supabase.js` session listeners | signed-in user | PROVIDER | duplicate-listener/session transition test needed | P2 | NEEDS TEST |
| Auth `resend` | AUTH | registration confirmation | pending user | PROVIDER | rate/error behavior untested | P2 | NEEDS TEST |
| Auth `resetPasswordForEmail` | AUTH | password recovery | public account owner | PROVIDER | redirect/abuse behavior untested | P2 | NEEDS TEST |
| Auth `signInWithPassword` | AUTH | login and legacy login surfaces | public account owner | PROVIDER | provider plus app-user linkage matrix needed | P1 | NEEDS TEST |
| Auth `signOut` | AUTH | session/logout paths | signed-in user | PROVIDER | multi-tab/session cleanup test needed | P2 | NEEDS TEST |
| Auth `signUp` | AUTH | registration | public | PROVIDER | creation/linking and abuse controls need test | P1 | NEEDS TEST |
| Auth `updateUser` | AUTH | password/profile auth update | signed-in account owner | PROVIDER | reauthentication behavior untested | P2 | NEEDS TEST |
| Bucket `AI_INTERVIEW_AUDIO_BUCKET` | UPLOAD, signed URL | AI interview recorder/player in App | interview participant and scoped reviewer | PROVIDER | dynamic bucket name and object ownership policies need executable tests | P1 | NEEDS TEST |
| Bucket `talent-cv` | UPLOAD, REMOVE | talent CV profile | talent account owner | PROVIDER | object path ownership/delete tests required | P1 | NEEDS TEST |
| Bucket `talent-resume-versions` | signed URL | resume history | talent account owner | PROVIDER | signed URL cross-user isolation test required | P1 | NEEDS TEST |

### RPCs

| Resource | Operations/files | Expected roles | Current control | Gap | Severity | Status |
|---|---|---|---|---|---|---|
| `add_candidates_to_ai_interview_campaign` | RPC, AI campaign App | campaign managers | SNAPSHOT | actor/tenant/candidate tests required | P1 | NEEDS TEST |
| `ai_agent_try_acquire_lock` | RPC, AI agent App + legacy | authenticated AI operators | snapshot grants include `anon` and `authenticated` | Client supplies company/agency identifiers; anon grant and cross-tenant lock acquisition require review. | P1 | NEEDS TEST |
| `ai_interview_delivery_preflight` | RPC, AI delivery App | campaign managers | SNAPSHOT | tenant/campaign ownership tests required | P1 | NEEDS TEST |
| `company_agency_create` | RPC, Agencies App | Admin, Company Admin, Recruitment Manager | AGENCY-C | pending application only | P2 | VERIFIED |
| `create_ai_interview_template_version` | RPC, AI templates App | template managers | SNAPSHOT | role/version race tests required | P1 | NEEDS TEST |
| `get_authenticated_app_user` | RPC, session App | authenticated | USERS-RPC | inactive/cross-client behavior needs full PG test | P1 | NEEDS TEST |
| `get_owner_talent_dashboard` | RPC, talent dashboard | talent owner | SNAPSHOT | owner isolation test required | P1 | NEEDS TEST |
| `get_talent_public_stats` | RPC, public/talent dashboard | public or talent | SNAPSHOT | data exposure boundary test required | P1 | NEEDS TEST |
| `launch_ai_interview_campaign` | RPC, AI campaign App | campaign managers | SNAPSHOT | tenant and idempotency tests required | P1 | NEEDS TEST |
| `legacy_app_login` | RPC, legacy login fallback | anon/authenticated during transition | migration grants anon/authenticated | Credential fallback remains reachable and needs retirement plan, throttling, and disclosure tests. | P1 | NEEDS TEST |
| `list_manageable_app_users` | RPC, Users App | Admin/Company Admin/platform account roles | USERS-RPC | cross-tenant role matrix required | P1 | NEEDS TEST |
| `notification_event_mutate` | RPC, Notifications App | recipient or authorized same-company actor | AUTHZ-W | covered by workflow PG suite | P2 | VERIFIED |
| `remove_candidates_from_ai_interview_campaign` | RPC, AI campaign App | campaign managers | SNAPSHOT | tenant/candidate tests required | P1 | NEEDS TEST |
| `revalidate_ai_interview_campaign_candidates` | RPC, AI campaign App | campaign managers | SNAPSHOT | tenant/state tests required | P1 | NEEDS TEST |

### Tables

For rows marked SNAPSHOT, current effective grants, RLS enablement, and policy
expressions must be captured from a temporary/local PostgreSQL catalog before
upgrading the row to `VERIFIED`.

| Resource | Operations found | Files/screens | Expected roles | Current control | Gap | Severity | Status |
|---|---|---|---|---|---|---|---|
| `[dynamic: table]` | SELECT | App loaders + legacy | caller-dependent tenant reader | N/A | resolve each runtime table argument in tests | P2 | NEEDS TEST |
| `agencies` | SELECT; legacy DML | Agencies | tenant readers; approved creators | AGENCY-R + AGENCY-C | edit/delete intentionally absent | P2 | VERIFIED |
| `agency_agreements` | INSERT/UPDATE/DELETE | Agency agreements | agency management roles | SNAPSHOT | tenant and lifecycle tests | P1 | NEEDS TEST |
| `agency_company_user_access` | SELECT; legacy UPSERT/DELETE | Agency access | tenant/agency admins | AGENCY-R | behavioral matrix absent | P1 | NEEDS TEST |
| `agency_members` | legacy UPSERT only | non-bundled legacy user path | none in current UI | N/A | remove/archive legacy source copy | P2 | UNUSED |
| `agency_penalties` | INSERT/UPDATE/DELETE | Agency penalties | recruitment management/approver | SNAPSHOT | approval and tenant tests | P1 | NEEDS TEST |
| `agency_score_history` | SELECT/INSERT | Agency performance | scoped readers; scoring service/admin | SNAPSHOT | append-only/tenant tests | P1 | NEEDS TEST |
| `agency_scores` | INSERT/UPDATE | Agency performance | scoring service/admin | SNAPSHOT | cross-tenant and overwrite tests | P1 | NEEDS TEST |
| `ai_agent_audit_logs` | INSERT | AI agent | AI service/operator | SNAPSHOT | append-only and spoofing tests | P1 | NEEDS TEST |
| `ai_agent_jobs` | INSERT | AI agent | AI service/operator | SNAPSHOT | company binding tests | P1 | NEEDS TEST |
| `ai_agent_settings` | SELECT/UPSERT | AI settings | tenant admins | SNAPSHOT | company scope tests | P1 | NEEDS TEST |
| `ai_interview_answers` | SELECT/INSERT/UPDATE | AI interview | participant/scoped reviewer | SNAPSHOT | session ownership tests | P1 | NEEDS TEST |
| `ai_interview_campaign_candidates` | SELECT/UPDATE | AI campaigns | campaign managers | SNAPSHOT | candidate/company tests | P1 | NEEDS TEST |
| `ai_interview_campaigns` | SELECT/INSERT/DELETE | AI campaigns | campaign managers | SNAPSHOT | tenant and delete tests | P1 | NEEDS TEST |
| `ai_interview_invitation_jobs` | SELECT | AI campaigns | campaign managers/service | SNAPSHOT | tenant visibility test | P1 | NEEDS TEST |
| `ai_interview_questions` | CRUD | AI templates/session | template managers; participants read assigned | SNAPSHOT | version/session scope tests | P1 | NEEDS TEST |
| `ai_interview_sessions` | SELECT/UPDATE | AI interview | participant/scoped reviewer | SNAPSHOT | token/session ownership tests | P1 | NEEDS TEST |
| `ai_interview_templates` | SELECT/INSERT/UPDATE | AI templates | template managers | SNAPSHOT | tenant/version tests | P1 | NEEDS TEST |
| `authorization_events` | SELECT | Authorization timeline | scoped tenant/agency actors | AUTHZ-R + AUTHZ-W | none in tested contract | P2 | VERIFIED |
| `candidate_technical_profiles` | CRUD/UPSERT | Candidates | recruitment roles in tenant | SNAPSHOT | candidate ownership tests | P1 | NEEDS TEST |
| `candidates` | CRUD | Candidates/AI/marketplace | recruitment roles in tenant/agency | SNAPSHOT | broad cross-tenant matrix absent | P1 | NEEDS TEST |
| `collections` | INSERT | Marketplace billing | finance/platform roles | SNAPSHOT | invoice/deal ownership test | P1 | NEEDS TEST |
| `companies` | SELECT/INSERT/UPDATE | Company/platform setup | tenant and platform admins | AGENCY-R | direct production writes conflict with SELECT-only grant | P1 | BROKEN |
| `company_agency_access` | SELECT; legacy UPSERT/DELETE | Agency matching | authorized tenant roles | AGENCY-R + AGENCY-C | edit/delete intentionally absent | P2 | VERIFIED |
| `company_email_settings` | SELECT/INSERT/UPDATE | Email settings | tenant Admin/Company Admin | SNAPSHOT | secret exposure and tenant tests | P1 | NEEDS TEST |
| `demobilizations` | INSERT/UPDATE/DELETE | Demobilization | operations/HR tenant roles | SNAPSHOT | lifecycle and tenant tests | P1 | NEEDS TEST |
| `education_institutions` | SELECT | candidate education | authenticated/public reference readers | SNAPSHOT | reference-data exposure test | P2 | NEEDS TEST |
| `email_logs` | SELECT/INSERT | email center | tenant admins/service | SNAPSHOT | body/recipient disclosure test | P1 | NEEDS TEST |
| `email_templates` | CRUD/UPSERT | email templates | tenant admins | SNAPSHOT | tenant/default-template tests | P1 | NEEDS TEST |
| `employees` | CRUD | employees/marketplace | HR/operations tenant roles | SNAPSHOT | employee-company lineage tests | P1 | NEEDS TEST |
| `interviews` | INSERT/UPDATE/DELETE | interviews/candidates | recruitment roles in tenant | SNAPSHOT | candidate/company tests | P1 | NEEDS TEST |
| `invoice_items` | INSERT | marketplace billing | finance/platform roles | SNAPSHOT | parent-invoice tenant test | P1 | NEEDS TEST |
| `invoices` | INSERT/UPDATE | marketplace billing | finance/platform roles | SNAPSHOT | payer/payee isolation test | P1 | NEEDS TEST |
| `local_content_project_targets` | CRUD | local-content settings | authorized tenant managers | SNAPSHOT | project/company tests | P1 | NEEDS TEST |
| `local_content_settings` | SELECT/UPSERT | local-content settings | tenant admins | SNAPSHOT | company scope test | P1 | NEEDS TEST |
| `marketplace_deal_workers` | INSERT | marketplace deals | authorized marketplace roles | SNAPSHOT | worker/deal company tests | P1 | NEEDS TEST |
| `marketplace_deals` | INSERT/UPDATE | marketplace deals | authorized counterparties | SNAPSHOT | counterparty isolation tests | P1 | NEEDS TEST |
| `marketplace_requests` | INSERT/UPDATE/DELETE | marketplace requests | request owner/marketplace roles | SNAPSHOT | owner/company tests | P1 | NEEDS TEST |
| `mobilizations` | CRUD | mobilization | operations/recruitment tenant roles | SNAPSHOT | state and tenant tests | P1 | NEEDS TEST |
| `notification_events` | SELECT; legacy/direct calls inventoried | notifications and domain events | recipient/authorized same-company actor | AUTHZ-R + AUTHZ-W | protected-write scan confirms production mutations use RPC | P2 | VERIFIED |
| `onboarding_validations` | SELECT/UPDATE | onboarding | authorized onboarding roles | SNAPSHOT | candidate/company tests | P1 | NEEDS TEST |
| `platform_clients` | CRUD | platform administration | platform owner/account roles | SNAPSHOT | platform-only role matrix needed | P1 | NEEDS TEST |
| `profession_aliases` | SELECT/INSERT | profession normalization | tenant/reference-data managers | SNAPSHOT | global-vs-tenant ownership test | P2 | NEEDS TEST |
| `professions` | SELECT/INSERT | profession master data | reference-data managers/readers | SNAPSHOT | global-vs-tenant ownership test | P2 | NEEDS TEST |
| `request_audit_logs` | SELECT/INSERT | requests | append service; scoped auditors | SNAPSHOT | append-only and tenant tests | P1 | NEEDS TEST |
| `request_lines` | SELECT/INSERT/DELETE | requests/candidates | request roles in tenant | SNAPSHOT | parent-child isolation test | P1 | NEEDS TEST |
| `requests` | CRUD | request workflow | configured tenant request roles | SNAPSHOT | transition/tenant/atomicity tests | P1 | NEEDS TEST |
| `subscription_invoices` | INSERT/UPDATE/DELETE | platform billing | platform accounts roles | SNAPSHOT | platform-only tests | P1 | NEEDS TEST |
| `support_tickets` | INSERT/UPDATE/DELETE | platform support | ticket owner/support roles | SNAPSHOT | owner/support isolation tests | P1 | NEEDS TEST |
| `system_activity_logs` | SELECT | platform audit | platform security/owner roles | SNAPSHOT | sensitive-log disclosure test | P1 | NEEDS TEST |
| `system_backups` | INSERT/DELETE | platform backup | platform owner/system service | SNAPSHOT | service-only mutation tests | P1 | NEEDS TEST |
| `system_restore_requests` | INSERT/UPDATE | platform restore | requester/platform owner | SNAPSHOT | approval/service boundary tests | P1 | NEEDS TEST |
| `talent_candidate_certifications` | SELECT | talent profile | talent owner/scoped recruiters | SNAPSHOT | owner isolation test | P1 | NEEDS TEST |
| `talent_candidate_consents` | SELECT/UPSERT | talent consent | talent owner | SNAPSHOT | immutable consent history test | P1 | NEEDS TEST |
| `talent_candidate_documents` | SELECT/INSERT/UPDATE | talent documents | talent owner/scoped recruiter | SNAPSHOT | row/bucket ownership tests | P1 | NEEDS TEST |
| `talent_candidate_education` | SELECT | talent profile | talent owner/scoped recruiter | SNAPSHOT | owner isolation test | P1 | NEEDS TEST |
| `talent_candidate_events` | INSERT | talent activity | talent owner/service | SNAPSHOT | spoofing/append-only test | P1 | NEEDS TEST |
| `talent_candidate_experience` | SELECT | talent profile | talent owner/scoped recruiter | SNAPSHOT | owner isolation test | P1 | NEEDS TEST |
| `talent_candidate_skills` | SELECT | talent profile | talent owner/scoped recruiter | SNAPSHOT | owner isolation test | P1 | NEEDS TEST |
| `talent_candidates` | SELECT/UPDATE/UPSERT | talent portal | talent owner | SNAPSHOT | owner/upsert identity tests | P1 | NEEDS TEST |
| `talent_resume_versions` | SELECT | resume history | talent owner | SNAPSHOT | row/bucket owner consistency test | P1 | NEEDS TEST |
| `users` | legacy direct CRUD | non-bundled legacy user screens; live app uses RPC | tenant/platform account admins | USERS-RPC | RPC role matrix and stale-source cleanup needed | P1 | NEEDS TEST |
| `visa_allocations` | INSERT/UPDATE/DELETE | visa allocation/mobilization | Visa Team and authorized admins | SNAPSHOT | capacity/concurrency/tenant tests | P1 | NEEDS TEST |
| `visa_authorizations` | legacy direct INSERT/UPDATE | authorization workflow | authorized company actors | AUTHZ-R + AUTHZ-W | production protected-write scan passes | P2 | VERIFIED |
| `visa_batch_lines` | INSERT/DELETE | visa inventory | Visa Team/admin | SNAPSHOT | batch parent/company tests | P1 | NEEDS TEST |
| `visa_batches` | INSERT/UPDATE/DELETE | visa inventory | Visa Team/admin | SNAPSHOT | tenant/import atomicity tests | P1 | NEEDS TEST |

## Prioritized follow-up

### P0

None identified in the locally reviewed and executable-tested scope.

### P1

1. Replace live direct `companies` INSERT/UPDATE with tenant/platform-bound
   server-side mutation paths; current SELECT-only grant makes that UI path
   broken.
2. Add executable PostgreSQL role/tenant matrices for
   `agency_company_user_access`, requests/request lines, visa inventory and
   allocations, candidates, interviews, mobilizations, employees, and
   demobilizations.
3. Verify `ai_agent_try_acquire_lock` cannot trust client-supplied company or
   agency IDs and remove the snapshot's `anon` execution grant unless a
   documented unauthenticated use case proves it necessary.
4. Retire or harden `legacy_app_login`; it remains callable by `anon` and
   `authenticated` as a transition path.
5. Execute bucket-policy tests for AI interview audio, talent CVs, and resume
   versions.

### P2

- Remove or archive the non-bundled `src/New folder/App.jsx` and
  `src/App_Working_Backup.jsx` copies; they contain historical direct writes
  and inflate static audit noise.
- Resolve dynamic table and bucket names into explicit resource declarations
  so future audits can prove coverage automatically.
- Promote a resource from `NEEDS TEST` only after its effective catalog ACL,
  RLS enablement, policy expressions, and cross-tenant behavior are captured
  by a repeatable local PostgreSQL test.
