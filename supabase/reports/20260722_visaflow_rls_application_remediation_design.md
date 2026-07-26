# VisaFlow RLS application-remediation design

Status: **PASS for local implementation planning; FAIL for Staging or Production deployment.**

This is a local, read-only design review. No SQL was executed against Production or Staging, no migration was applied, and no account, secret, deployment, commit, push, or PR was changed. The existing baseline, tenant-RLS, bucket, and storage-policy migrations were not edited.

## Security invariants

1. `auth.uid()` is the only browser identity. `company_id`, `agency_id`, role, email, and IDs stored in browser storage are hints only.
2. Every browser-executable server contract resolves the active actor from `auth.uid()` and the database, then derives its tenant. It never accepts a tenant ID as authority.
3. Public interview visitors receive no direct table or bucket privileges. Their one-time invitation proves possession only during exchange; a separate, short-lived authenticated portal capability authorizes later operations.
4. Workspace, Talent, and Interview Auth sessions use separate Supabase client instances and storage keys. A session for one audience is rejected by the other two.
5. Mutable agency names are display snapshots, not authorization keys. Authorization uses immutable `agency_id` plus active membership and company-access rows.
6. SMTP secrets never appear in a SELECT result, browser response, application state, log, or analytics event.
7. Every `SECURITY DEFINER` function has an explicit executor class: browser-authenticated, service-role worker, trigger-only, or the one approved anonymous aggregate. `PUBLIC` never has EXECUTE.

## 1. Public interview portal: current path and anonymous dependencies

The public route is selected before normal Workspace/Talent authentication by `getAIInterviewAccessToken()` and `AIInterviewCandidatePortal` in `src/App.jsx`. The current invitation is `?ai_interview=<session access_token>`.

| Stage | Current operation | Current authority | Conflict / risk |
|---|---|---|---|
| Open invitation | Read `ai_interview` from the query string | URL bearer token | Long-lived secret can reach browser history, referrers, screenshots, support logs, and analytics. |
| Load session | Direct SELECT from `ai_interview_sessions` by `access_token` | anon PostgREST | A table token is being used as authorization; the caller can alter query shape. |
| Expiry/open/ready/consent/device state | Direct UPDATE of `ai_interview_sessions` by ID/token | anon PostgREST | anon can mutate a sensitive state machine and counters. |
| Load content | Direct SELECT from `ai_interview_templates` and `ai_interview_questions` | anon PostgREST | Internal template and scoring rows require broad anonymous read. |
| Load/save answers | SELECT, INSERT, and UPDATE on `ai_interview_answers`; update session counts | anon PostgREST | Client controls session/question IDs, transcript/media paths, and lifecycle. |
| Live AI session | Fetch untracked `create-ai-realtime-session`; raw interview token in `X-AI-Interview-Token` | public Edge request | The function is not present in the repository and cannot be audited or reproduced. |
| Record audio | Direct upload to `ai-interview-audio` | anon Storage policy | Browser chooses an object path and uses bucket permissions directly. |
| Playback | Direct `createSignedUrl` | anon Storage policy | URL issuance is not bound server-side to the portal capability or expected object. |
| Complete/decline/skip | Direct answer/session mutations | anon PostgREST | Replay, invalid transitions, cross-question IDs, and client-computed counts are possible. |
| Invitations | Campaign/dispatcher embeds the stored `access_token` in the VisaFlow URL | service workflow creates a browser bearer secret | Resend/revocation and delivery logs can expose a reusable database token. |

All direct anonymous reads/writes above must be removed before the tenant-RLS and private Storage policies are enforced.

### Proposed secure portal protocol

#### Invitation issuance

- Generate 32 random bytes (256 bits) with a cryptographic RNG. Store only a keyed hash of the invitation secret, plus `issued_at`, `expires_at`, `revoked_at`, `consumed_at`, `session_id`, `candidate_id`, and a monotonically increasing invitation generation.
- Deliver the secret in the URL fragment, for example `/#/interview?invite=<secret>`, not in a query string. Fragments are not sent in HTTP requests or referrers. Before loading analytics or third-party scripts, read it once, exchange it, then remove it with `history.replaceState`.
- Treat URL cleanup and `Referrer-Policy: no-referrer` as defense in depth, not authorization.
- A resend transaction locks the interview session, revokes every previous active invitation, and creates exactly one new active generation. Old and concurrent-loser links fail with the same generic response.
- Recommended invitation redemption lifetime: 24 hours after issuance and never later than the interview window. After the first valid exchange, the raw secret is consumed immediately.

#### Exchange and session binding

1. Use a third browser Supabase client, `interviewSupabase`, with a distinct storage key such as `visaflow-interview-auth`, `sessionStorage`, and no sharing with Workspace or Talent.
2. Create an isolated Supabase anonymous Auth session. Its JWT supplies a non-forgeable `auth.uid()` but grants no table access.
3. Call `interview-portal-exchange` with the raw invitation secret once. The Edge Function validates the JWT, hashes the secret, rate-limits by invitation/IP, then in one transaction and under a row lock verifies the active generation, expiry, interview state, candidate, and session.
4. Bind the invitation to the anonymous `auth.uid()`, a server-created capability ID, a hashed device nonce, one interview session, and a short absolute lifetime. Consume the invitation atomically.
5. Return a safe portal projection and the opaque capability ID. Do not return the raw token, token hash, `company_id`, candidate internal IDs beyond what the UI needs, scoring configuration, or unrestricted object paths.
6. All subsequent calls require the Interview Auth JWT and capability. The server rechecks binding, expiry, revocation, and state on every operation. A supplied session/question ID is only a selector and must match the capability-bound graph.

If anonymous Auth is rejected because of account-retention cost, the alternative is a same-site, HttpOnly server capability cookie on a VisaFlow-controlled backend domain. A cookie set only by the default Supabase Functions domain cannot safely substitute for a VisaFlow-domain cookie, so this alternative requires an explicitly owned backend domain.

#### Server contracts

| Contract | Responsibility | Mandatory internal checks |
|---|---|---|
| `interview-portal-exchange` Edge + transactional RPC | Redeem once and bind a portal session | JWT, token hash, active generation, expiry, allowed interview state, row lock, rate limit, one binding. |
| `interview-portal-state` Edge/RPC | Return candidate-safe session, questions, and submitted-answer projection | Capability/JWT binding, exact template/session relationship, expiry/state. |
| `interview-portal-transition` Edge/RPC | Consent, device-ready, start, skip, answer metadata, decline, complete | Server-owned transition table, idempotency key, optimistic version, exact question order, server-computed counts. |
| `interview-media-sign-upload` Edge | Issue exact-path signed upload | Bound session/question, state, one pending upload nonce, MIME allowlist, byte limit, no overwrite, 2-minute URL. |
| `interview-media-finalize` Edge/RPC | Verify object then attach answer | Expected path/nonce, object size/type, ownership, transactionally upsert answer, invalidate nonce. |
| `interview-media-sign-read` Edge | Issue exact-object signed read | Bound session, answer ownership, 60-second URL. |
| `create-ai-realtime-session` Edge | Issue only short-lived provider credential | Audited source in repository, portal capability, correct live state, quota/rate limit; never accept the invitation secret header. |

Object paths are server-generated: `company/<company UUID>/session/<session UUID>/question/<question UUID>/<random UUID>.<ext>`. The bucket remains private. No anon SELECT/INSERT/UPDATE policy exists. Abandoned pending objects are cleaned by a service-role job after the retention window.

#### Failure handling

- Expired, revoked, consumed, guessed, wrong-session, and unknown invitations return one generic message and stable error code; no existence oracle.
- Two exchanges of one token race under a row lock: exactly one succeeds.
- Reuse of an exchanged link cannot recreate a capability. A still-valid bound browser resumes only through its Interview Auth session and capability.
- Session ID, question ID, candidate ID, media path, and company ID tampering is rejected because all are resolved through the server-side binding.
- Completion/decline is terminal. Retries with the same idempotency key return the prior result; different retries cannot reopen or overwrite it.

### Candidate experience impact

- The invitation still opens directly without a password or candidate account.
- First opening adds one short exchange step, normally invisible except for a brief “Securing interview” state.
- Refresh in the same tab resumes from `sessionStorage`; a different browser/device requires a newly issued invitation unless product explicitly allows transfer.
- Expired/revoked/used links show a generic recovery action to request a new invitation.
- Upload and playback remain browser-native but use short-lived signed URLs.

## 2. Company login and migration from `legacy_app_login`

### Current behavior

`handleLogin` first calls `signInWithPassword`, validates the returned/persisted session, then calls `get_authenticated_app_user`. On Auth failure it signs out and calls `legacy_app_login(email, password)`. That RPC compares `public.users.password` and returns an application user without creating a Supabase Auth session.

After login, `activateWorkspaceUser` stores `visaflow_user` JSON in either localStorage or sessionStorage. The cached record contains user/role/status/company/agency fields and company/subscription display data. Agency workspace choice is stored in `visaflow_agency_company_id` and `visaflow_agency_company_name` in sessionStorage. These values are useful UI caches but cannot satisfy Auth-backed RLS.

Workspace Auth itself uses the singleton in `src/supabase.js`, persists in localStorage under `visaflow-workspace-auth`, and is distinct from Talent Auth (`visaflow-talent-auth`). No `localStorage.clear()` or `sessionStorage.clear()` was found; logout removes named VisaFlow keys and signs out the relevant client.

### Target contract

- A Workspace is established only by a valid Workspace Supabase session and exactly one active `public.users` row with `auth_user_id = auth.uid()`.
- `get_authenticated_workspace_context()` returns a safe actor/company projection after checking user, company, role, status, and subscription. Browser storage never authorizes anything.
- The Workspace client rejects Talent/Interview account types. Talent rejects Workspace/Interview accounts. Interview accepts only its anonymous portal identity. Callback routing markers select a client but do not authorize it.
- Logout is scoped to one client/storage key; it never clears another audience's session.
- `visaflow_user` is either removed or reduced to non-sensitive display/cache fields and discarded whenever it conflicts with the authenticated context.

### Migration plan for existing company accounts

1. Preflight active legacy users: normalized-email duplicates, existing Auth links, incompatible account types, inactive companies/users, missing email, and ambiguous roles.
2. Never copy a legacy plaintext password into Supabase Auth and never link an existing Auth identity by email alone.
3. Create a server-owned pending migration record for each approved legacy user. Send a Supabase invite/password-setup link. Bind `public.users.auth_user_id` only after the trusted callback proves the invited Auth identity matches the pending migration record.
4. During rollout, replace browser `legacy_app_login` with an Edge `legacy-account-upgrade` bridge. It may validate the old credential server-side and issue/resend the one-time setup invitation, but it must not return workspace authorization or create an application-only login.
5. Roll out in cohorts with audit events, resend/support handling, and an explicit migration-complete metric.
6. After every active workspace user has a verified Auth link: revoke/drop `legacy_app_login`, remove/null legacy password material, and enforce non-null unique `auth_user_id` for active Workspace roles.

The legacy bridge can be feature-flagged off to roll back before RLS enforcement. Once Auth-backed RLS is enabled, returning to application-only sessions is not a safe rollback.

### Company experience impact

- Already linked users see the same password login and persistent session.
- Unlinked legacy users are directed once to secure password setup rather than entering the Workspace with no Auth session.
- Agency users retain a company chooser, but the choices come from an authenticated server projection. A remembered selection is only a preference and is revalidated on every load.
- Recovery continues through Supabase Auth and must preserve the Workspace/Talent callback audience.

## 3. Safe Workspace/company initialization

### Direct reads to replace

`src/App.jsx` directly reads `companies` after login, while loading an agency's authorized companies, and in platform/company management pages. The Email Dispatcher also reads `companies` using service role after it authenticates its caller; that server-side read can remain, but the caller contract must stay strict.

### Proposed projections

| API | Parameters | Result and authorization |
|---|---|---|
| `get_authenticated_workspace_context()` | None | Resolves `auth.uid()`; returns safe actor fields and the actor's own safe company summary. Rejects inactive/ambiguous links and incompatible audience. |
| `list_authenticated_agency_workspaces()` | None | Returns only active grants formed by matching `agency_members`, `company_agency_access`, and `agency_company_user_access`; exposes opaque `access_id`, display name, status, and capabilities. |
| `get_authenticated_agency_workspace(p_access_id uuid)` | Opaque grant ID | Re-resolves the actor and verifies that the access row belongs to that user/agency and an active company. It never accepts `company_id` as authority. |
| Platform company queries/mutations | Search/page/action fields only | Dedicated role-checked RPC/Edge projections; Platform Owner capabilities are explicit per operation, not a broad raw SELECT. |

The `companies` table remains denied to anon and ordinary authenticated callers. Subscription and active-company enforcement occurs inside the context helper and again in every mutation RPC; a missing browser company row can no longer be treated as permission to continue.

## 4. Agency-name to `agency_id` migration

### Current name-dependent paths

- Generic agency loading filters `candidates` and `interviews` using the mutable `agency` text and `currentUser.agency_name`.
- Candidate table search/filter, edit forms, manual insert/update, talent-pool uploads, and Excel bulk import read/write the `agency` name.
- Interview creation/edit/filter and agency notifications read/write the `agency` name.
- Dashboards, SLA/performance views, AI recommendations, and `aiagentworker` join/group candidates, interviews, and authorizations by normalized agency name.
- The Email Dispatcher resolves some agreement recipients through a unique agency name. That is a delivery lookup, not adequate authorization.

### Additive schema plan

1. Add nullable `agency_id uuid` to `candidates` and `interviews`.
2. Add named FKs to `agencies(id)`. Prefer `ON DELETE RESTRICT` and an agency archive state so historical ownership remains stable.
3. Add indexes:
   - `candidates(company_id, agency_id)`
   - `candidates(company_id, agency_id, status)`
   - `interviews(company_id, agency_id, candidate_id)`
   - `interviews(company_id, agency_id, status)`
4. Preflight/backfill by company, never globally: each non-empty normalized legacy name must resolve to exactly one agency with an active company relationship. Zero or multiple matches stop the backfill and enter a reviewed mapping table.
5. Agency-originated candidate writes use an authenticated RPC that derives `agency_id` from the actor and active selected workspace. It ignores a browser-supplied agency ID/name.
6. Company-originated writes may choose only an agency returned by the company's active `company_agency_access` projection.
7. Interview `agency_id` is derived from the selected candidate. A trigger/RPC enforces matching `company_id` and `agency_id`; a cross-table rule cannot be expressed as a simple CHECK.
8. Dual-write during transition: store immutable `agency_id` plus the current name as a display/audit snapshot. Reads, joins, worker grouping, and RLS use the UUID. Renaming an agency no longer changes ownership.
9. Validate all write paths and backfill counts, then require `agency_id` for agency-originated records. Direct/internal candidates may remain NULL if that product state is intentional.

No backfill is part of this design phase.

## 5. SMTP settings

### Current issue

The settings loader explicitly excludes `smtp_password`, but the save path writes it and then calls `.select().single()` without a safe column list. Therefore the secret can be returned over the network before the UI clears the form. The checked-in Email Dispatcher currently uses platform SMTP environment secrets, not the per-company password, so the tenant credential UI and actual delivery path are not aligned.

### Recommended design

- For the first secure release, keep platform SMTP and remove/disable tenant-password entry unless tenant SMTP is a confirmed requirement.
- If tenant SMTP is required, use two Edge Functions:
  - `manage-company-email-settings`: verifies JWT, active same-company Admin, and derives company from the actor. Non-secret settings are validated. The secret is stored in Supabase Vault or an external secret manager under an opaque credential reference; the application table stores only metadata such as `has_smtp_credential`, version, and rotation time.
  - `test-company-email-settings`: loads the credential server-side, sends only to the currently authenticated verified Admin email, records a safe status, and returns a small safe DTO.
- Neither endpoint accepts browser `company_id` as authority, logs the request body, provider secret, or connection string, or returns provider internals.
- Responses list explicit safe fields. There is no `SELECT *`, and `smtp_password` is not readable by anon/authenticated/Platform UI.
- If Vault is unavailable, block tenant SMTP rather than store a reversibly accessible secret in a broadly queryable table.

## 6. RPC and `SECURITY DEFINER` remediation

### Common authenticated executor guard

Every browser-executable definer function must:

1. require non-null `auth.uid()`;
2. resolve exactly one active `public.users` row;
3. verify active company/agency and explicit role allowlist;
4. load the target row first and derive its tenant;
5. reject a supplied `company_id` that differs, or remove the parameter;
6. lock target rows for mutations, validate state, and use idempotency keys where retried;
7. set a safe `search_path`, schema-qualify objects, and return an explicit projection;
8. emit a redacted audit event for privileged mutations.

### Exact application contracts requiring change

| Current function/path | Current problem | Target executor / fix |
|---|---|---|
| `legacy_app_login` | Password comparison with no Auth session | No direct executor; temporary authenticated upgrade Edge only, then remove. |
| `create_ai_interview_template_version` | Browser calls a function without sufficient internal actor/tenant checks | authenticated Admin/RM only; derive company and template parent server-side. |
| `add_candidates_to_ai_interview_campaign` | Campaign/candidate membership mutation needs strict role and same-tenant validation | authenticated Admin/RM/RO; load campaign, derive company, validate every candidate. |
| `remove_candidates_from_ai_interview_campaign` | Same tenant/role risk | authenticated Admin/RM/RO with target-row checks and row lock. |
| `revalidate_ai_interview_campaign_candidates` | Bulk tenant-sensitive mutation | authenticated Admin/RM/RO; server derives campaign company and candidate scope. |
| `launch_ai_interview_campaign` | Creates sessions/tokens/jobs and currently has an auth-null service bypass pattern | Separate authenticated launch contract from service worker internals; strict campaign ownership and role. Issue hashed one-time invitations. |
| `ai_interview_delivery_preflight` | Browser metadata/preflight call | authenticated only, explicit safe result; no tenant data. |
| `ai_agent_try_acquire_lock` / `ai_agent_release_lock` | Browser can call acquire with arbitrary company; functions are also worker contracts | service_role only. Browser calls a role-checked Edge action; worker derives company from actor/action payload already authorized. |
| `aiagentworker` | Groups candidates/interviews/authorizations by agency text | service_role, but migrate queries/grouping to `agency_id`; validate every job's company and allowed action before work. |
| `visaflow-ai-commander` | Privileged orchestration surface | Verify caller JWT, actor role, tenant, command allowlist and target rows. Never trust prompt/company fields as authority. Delegate writes only to guarded service contracts. |
| `create-ai-realtime-session` | Called publicly with raw interview token but source is absent | Add audited Edge source; require portal JWT/capability, live session state, quota, and exact session. |
| `visaflow-email-dispatcher` | Mostly caller-scoped, but invitation URL and some agency recipient resolution rely on secret/name patterns | Keep caller JWT checks; replace raw interview access token with invitation issuer and replace name authorization with immutable agency ID. |

The final grant model remains the reviewed 58-function allowlist: anon directly executes only `get_talent_public_stats`; authenticated executes only self-identity/context and internally guarded product contracts; service_role executes the named worker contracts; trigger functions have no direct client grant; `PUBLIC` receives none.

## 7. Precise implementation file inventory

### Existing application files to change

- `src/App.jsx`
  - replace public portal direct database/storage operations with portal APIs;
  - replace `legacy_app_login` flow and browser identity caches;
  - consume authenticated Workspace/company projections;
  - replace agency-name authorization/filtering with `agency_id`;
  - replace direct SMTP save/test;
  - remove direct AI lock acquisition and harden campaign/template callers.
- `src/supabase.js`
  - retain Workspace/Talent singletons and add an isolated Interview client/session-storage key and audience checks.
- `src/authSession.mjs` and `src/authSession.test.mjs`
  - extend audience/session continuity rules and prove isolation between Workspace, Talent, and Interview.
- `src/emailDispatcherContract.mjs` and its tests
  - forbid raw interview token URLs and define the non-secret invitation-delivery contract.

### Existing Edge Functions to change

- `supabase/functions/visaflow-email-dispatcher/index.ts`
- `supabase/functions/aiagentworker/index.ts`
- `supabase/functions/visaflow-ai-commander/index.ts`

### Edge Functions to add

- `supabase/functions/interview-portal-exchange/index.ts`
- `supabase/functions/interview-portal-state/index.ts`
- `supabase/functions/interview-portal-transition/index.ts`
- `supabase/functions/interview-media-sign-upload/index.ts`
- `supabase/functions/interview-media-finalize/index.ts`
- `supabase/functions/interview-media-sign-read/index.ts`
- `supabase/functions/create-ai-realtime-session/index.ts`
- `supabase/functions/legacy-account-upgrade/index.ts` (temporary)
- `supabase/functions/manage-company-email-settings/index.ts` (only if tenant SMTP is approved)
- `supabase/functions/test-company-email-settings/index.ts` (only if tenant SMTP is approved)

A smaller implementation may combine portal state/transition/media endpoints into one function, but authorization, rate limits, request schemas, and tests must remain operation-specific.

### Future migrations/RPCs to add—not implemented here

- Portal invitation hash/capability/device binding, state-transition RPCs, expiry/revocation indexes, retention cleanup, and private Storage grants.
- Auth migration ledger and trusted binding functions; later removal of legacy passwords/RPC.
- Workspace context and agency-workspace projection RPCs.
- Candidate/interview `agency_id`, indexes, FKs, preflight, mapping/backfill, dual-write guards.
- SMTP credential reference metadata and grants if tenant SMTP is approved.
- Strict browser campaign/template RPC replacements and service-only AI Agent locks.

The three/current migration design files are not the place to hide these application contracts. Add later, independently reviewable migrations so rollback and staging evidence are attributable.

## 8. Test plan and acceptance criteria

### Public portal

- Invitation URL contains no database ID/token in query parameters, no token hash, access token, refresh token, or provider credential; raw secret exists only in the initial fragment and is removed before analytics.
- Database stores only a hash; logs/errors/traces contain neither secret nor fragment.
- Valid exchange succeeds once; two concurrent exchanges produce exactly one capability.
- Expired, revoked, resent-old, consumed, guessed, and wrong-session invitations fail generically.
- Direct anon table and bucket calls fail.
- Capability cannot access another session/question/candidate/company or invalid state transition.
- Signed upload rejects wrong path, overwrite, MIME, size, stale nonce, and expired URL; signed read is exact-object and expires.
- Refresh resumes only the bound browser session; completion/decline is terminal and idempotent.
- Realtime credential endpoint accepts only the bound live session and rate limits issuance.

### Company Auth and Workspace

- Linked company user login/reload/recovery uses a real Supabase session; `getSession()` and `getUser()` agree.
- Legacy account upgrade creates no Workspace session before trusted Auth setup; duplicate/ambiguous/incompatible email cases stop safely.
- Browser changes to cached role/company/agency or agency workspace IDs grant nothing.
- Workspace, Talent, and Interview sessions cannot be accepted by another audience; logging out one does not erase another.
- Inactive user/company and mismatched `auth_user_id` are denied.
- Raw `companies` SELECT fails; context returns only the actor's authorized projection.
- Agency workspace tampering and arbitrary `company_id` fail; one agency/user with two active company grants succeeds for both.

### Agency migration

- Preflight detects unmatched, duplicate, ambiguous, cross-company, and inactive name mappings.
- Agency-originated insert derives `agency_id`; browser-supplied different IDs/names are ignored/rejected.
- Candidate/interview companies and agencies must match; moving `company_id` or `agency_id` across tenants fails.
- Agency rename does not change visibility; legacy display text cannot grant access.
- Worker dashboards and notifications group/resolve by UUID.

### SMTP

- Password is absent from SELECT, network response, application state snapshots, logs, analytics, and error payloads.
- Non-Admin, wrong company, inactive actor, and supplied-company tampering fail.
- Rotation preserves only safe metadata; test sends only to the authenticated verified Admin and returns a safe DTO.
- Platform SMTP remains functional if tenant SMTP is feature-disabled.

### RPC/worker matrix

- Each browser RPC is tested with anon, unrelated company, wrong role, inactive actor, permitted actor, and tampered target IDs.
- Each service-only function rejects anon/authenticated and succeeds only through the intended worker fixture.
- AI locks cannot be acquired directly by the browser.
- Campaign rows from mixed tenants are rejected atomically.
- Commander prompts/arguments cannot override actor tenant or allowed action.
- `PUBLIC` and anon have no EXECUTE on any definer function except the reviewed aggregate contract.

### Release acceptance criteria

1. All API integration tests use real anon/authenticated/service JWT classes in isolated Staging.
2. The current tenant RLS pgTAP suite plus the tests above passes; raw table/storage negative tests are mandatory.
3. No legacy active Workspace account relies on an application-only session when RLS is enabled.
4. No new interview invitation contains the existing `access_token` query parameter; all old active links are explicitly revoked or supported only behind a time-boxed, server-mediated compatibility path.
5. Every candidate/interview agency-owned row is backfilled or quarantined by preflight; no ambiguous row is guessed.
6. Secrets scan, browser Network inspection, Edge logs, database logs, and analytics inspection show no invitation/SMTP/provider secret.
7. Company and candidate login/recovery, agency two-company access, campaign launch, AI worker, email dispatch, interview completion, and audio playback pass end-to-end.

## 9. Functions likely to break during the transition

| Severity | Functionality | Why / containment |
|---|---|---|
| P0 | Public AI interview, audio, and realtime | Direct anon paths are incompatible. Keep old policies only in isolated development until the replacement is complete; do not enforce RLS partially. |
| P0 | Unlinked legacy company login | It has no Auth session. Migrate/upgrade before tenant RLS; do not treat cached `currentUser` as a bridge. |
| P0 | Workspace bootstrap/company chooser | Raw company reads close. Ship context RPC and caller together. |
| P1 | Agency candidate/interview create, edit, filters, reports | Name-based logic must dual-read/write UUID during migration. Feature-flag new UUID path and validate backfill. |
| P1 | Tenant SMTP save/test | Current returned `*` is unsafe and may fail under column ACL. Disable tenant credential UI or ship server functions first. |
| P1 | Campaign/template actions | Browser EXECUTE is removed until internal role/tenant guards exist. Roll out guarded replacements before grants are tightened. |
| P1 | AI Agent browser action and worker reports | Browser lock path must move server-side; name grouping must migrate to UUID. |
| P2 | Historic displays/exports | Legacy agency-name snapshots may differ after rename; preserve them as labels but not authorization. |

## 10. Incremental implementation and rollback

| Phase | Small deployable unit | Gate before next phase | Rollback |
|---|---|---|---|
| 0 | Add tests, feature flags, telemetry redaction, and preflight only | Tests prove current behavior and secret absence | Remove flags/tests; no data change. |
| 1 | Add Workspace context RPCs and change bootstrap/agency chooser | Linked users, two-company agency, platform scopes, login/recovery pass | Re-enable old read path only while RLS is not active. |
| 2 | Add trusted legacy-account upgrade and migrate cohorts | All active Workspace users linked; ambiguous cases resolved | Pause invitations and keep old login only before RLS; never auto-link by email. |
| 3 | Add candidate/interview `agency_id`, dual-write, preflight/backfill | No ambiguous/unmatched agency-owned row; all writers use UUID | Keep columns/data, switch reads temporarily to legacy display names; do not drop UUID. |
| 4 | Add SMTP Edge path or disable tenant SMTP | Network/log secret tests pass | Fall back to platform SMTP; revoke tenant credential feature. |
| 5 | Add secure interview portal in parallel; issue only new-format invitations | Full portal/media/realtime and concurrent exchange tests pass | Stop issuing invitations and revert issuance feature flag; do not restore broad anon access in Production. |
| 6 | Harden campaign/commander/worker RPC contracts and grants | Role/tenant/executor matrix passes | Disable affected features; restore only a reviewed prior allowlist, never PUBLIC. |
| 7 | Apply tenant RLS/private Storage to isolated Staging | pgTAP/API/E2E/log review all pass | Restore the pre-change Staging snapshot or reviewed fail-closed forward rollback. |
| 8 | Production change window after separate approval | Backup/restore point, migration dry-run, user migration metrics, operational owners | Snapshot restore/forward rollback runbook; halt invitations and privileged jobs during recovery. |

Do not enable tenant RLS before phases 1–6 are complete. Do not use a relaxation such as broad anon/authenticated grants as a rollback.

## 11. Remaining risks and decisions

- **P0:** The secure portal requires one approved backend capability model. This report recommends an isolated Supabase anonymous Auth session plus one-time exchange. Implementation must validate Supabase anonymous-user lifecycle/limits in Staging.
- **P0:** The number and condition of legacy unlinked company accounts is unknown until preflight. RLS cannot be released while any required user still depends on `legacy_app_login`.
- **P1:** Tenant SMTP product intent is unclear. Recommended default is platform SMTP only; tenant credentials remain disabled until Vault/external secret storage is approved.
- **P1:** Historic agency names can be ambiguous within a company. Backfill must quarantine rather than guess.
- **P1:** `create-ai-realtime-session` source is absent, so its current authorization/provider-secret behavior is unauditable until checked in.
- **P1:** Later migrations can re-grant definer EXECUTE; final ACL diff after the complete migration chain is mandatory.
- **P2:** Splitting a large `src/App.jsx` into route/services modules is advisable for testability but is not a security precondition if contracts are tested independently.

## Decision

**PASS — ready to begin the phased local implementation described here, after explicit approval.**

This is not a PASS for Staging or Production. Those remain **FAIL / blocked** until the P0 portal, Auth migration, and Workspace-context paths are implemented and tested, followed by the P1 agency, SMTP, and privileged-RPC work. Stop here and obtain approval before changing application code, Edge Functions, RPCs, or migrations.
