# VisaFlow pre-isolated-environment review

## Technical summary

The local package is suitable to begin validation on a new disposable Supabase environment, but it is not approved for current Staging or Production. Static review covered 31 implementation/test files plus eight preserved Baseline/RLS/report files. Four deterministic defects were corrected: interview capability CORS, SQL enforcement of anonymous interview identity, preflight compatibility before `agency_id` exists, and media bucket/MIME consistency. The package now has a repeatable static verifier and a 79-assertion pgTAP inventory.

## Large application change

`src/App.jsx` removes two named functions: `getAIInterviewInvitationUrl` and `refreshCandidateInterviewProgress`. Their responsibilities are replaced, not silently dropped: one-time links are issued/delivered only by the server and cannot be copied/opened from Workspace; portal state/progress is returned by guarded transition/state RPCs. Direct public interview table/Storage access, direct `companies` reads, browser `legacy_app_login`, company SMTP password entry, and direct privileged campaign/AI lock calls were replaced by authenticated RPC/Edge contracts. Platform SMTP remains available. Company SMTP credential mode is deliberately disabled until an approved vault-backed implementation exists.

`src/main.jsx` still imports the active `src/App.jsx`; the legacy copy under `src/New folder` is unchanged and is not the Vite entry. The large diff has 316 added and 719 removed lines, but a declaration comparison found only the two removed function names above and five replacement helpers/screens (`applyPortalState`, `secureTransition`, `getWorkspaceUpgradeId`, `completeUpgrade`, and `WorkspaceUpgradeScreen`).

The UI still references four pre-existing Edge functions whose source is absent from this repository: Talent CV analysis, Talent resume studio, backup worker, and restore worker. They were not removed by this change, but they cannot be deployed or type-checked in the isolated package and must be treated as unavailable during the temporary-environment run.

## Auth audience isolation

Workspace and Talent use different localStorage keys; Interview uses a third sessionStorage key and never detects URL Auth callbacks. Callback detection is routed by `auth_flow`; the interview client creates only anonymous tab-scoped sessions. A test-only URL/project-ref override now allows an isolated frontend build to fail immediately if the configured project does not match the expected temporary project.

## Migration and SQL findings

The 13 migration filenames sort in their required dependency order: Baseline, tenant RLS, bucket metadata, temporary storage policies, application contracts, removal of broad interview storage policies, guarded product contracts, historical migrations, then final security re-revocation. No migration edits `supabase_migrations`. All 32 tenant tables exist in the Baseline and the 31 generic-policy tables contain `company_id`. New SECURITY DEFINER functions use an empty `search_path`; referenced GRANT/REVOKE function names resolve in the chain. The three pgTAP files contain matching `plan()`/assertion counts of 37, 22, and 20.

The preflight previously referenced `c.agency_id`/`i.agency_id` before migration 70 created those columns. It now uses a JSON projection that is valid both before and after the additive columns. Actual SQL parsing/application and constraint execution remain unproven until the disposable database run.

## Edge review

Fourteen repository-owned changed/new Edge functions have local imports that resolve, OPTIONS handling, POST-only guards, bounded JSON bodies where applicable, server-side Auth validation, and redacted error responses. No reviewed function logs raw invitation secrets, JWTs, passwords, or signed URLs. Media finalization now compares actual object size and MIME with the prepared upload and removes an object that fails validation or confirmation. The bucket limit/allowlist now matches the application's 25MB audio and 100MB video contract.

Deno is not installed locally, so full type/import checking was not possible. Node 24 TypeScript syntax checks passed for all 16 repository Edge TypeScript files. The mandatory environment command is documented in the runbook and remains a gate.

## Final local evidence

- Static security-package verifier: PASS (13 migrations, 32 tenant tables, 14 changed/new Edge Functions, 16 TypeScript syntax checks, 79 planned assertions matching 79 assertion statements).
- Security tests: 31/31 PASS.
- Public-navigation tests: 3/3 PASS.
- Vite build: PASS. The pre-existing unresolved `/login-hero.jpg` warning and the 2.22MB JavaScript chunk warning remain.
- `git diff --check`: PASS; only Git's LF-to-CRLF working-copy notices were emitted.
- Changed/untracked-file credential-signature scan: zero findings across 44 files (the 31-file implementation scope, eight preserved artifacts, and five verification-package files).
- Portable report packaging: validation and packaging PASS; browser QA is structural-only because Chromium is unavailable locally.

## Reviewed 31-file implementation scope

| Layer | Files | Review outcome |
|---|---|---|
| Frontend/config (9) | `package.json`, `src/App.jsx`, `src/supabase.js`, `src/authSession.test.mjs`, `src/applicationSecurity.test.mjs`, `src/interviewPortalApi.mjs`, `src/interviewPortalApi.test.mjs`, `src/securityContracts.mjs`, `src/securityContracts.test.mjs` | Audience sessions, callback routing, Workspace context, portal transport, SMTP UI, and regression contracts reviewed. |
| Edge/shared (15) | `_shared/visaflow-security.ts`; invitation worker; realtime session; three media functions; three portal functions; review-media signer; legacy upgrade; company email settings; AI Agent action; AI Commander; Email Dispatcher | Imports resolve locally; custom/server Auth boundaries, POST/CORS, body bounds, redacted errors, and no-sensitive-log rules reviewed. |
| SQL/preflight/pgTAP (7) | Migrations `70`, `80`, `90`, and `20260722000100`; application-security preflight; application-security pgTAP; portal-behavior pgTAP | Dependency order, object references, grants/revokes, empty `search_path`, additive agency columns, and plan/assertion counts reviewed statically. |

Eight earlier local Baseline/RLS design artifacts were preserved and reviewed for compatibility rather than counted in the 31-file implementation scope. Migration 50 was changed only after proving that its 50MB/no-MIME bucket contract contradicted the new 100MB video/allowlist enforcement.

## Remaining risk

- **P1:** Full SQL application and all 79 pgTAP assertions are not executed locally because no disposable database/Docker runtime is present.
- **P1:** Seven fail-closed internal UI areas still rely on unresolved tables (`ai_agent_settings`, internal `ai_interview_templates`, `education_institutions`, `email_templates`, `local_content_settings`, `profession_aliases`, `subscription_invoices`); affected pages may be empty or show authorization errors. Service-role workers can still read their authorized tables.
- **P1:** The existing `aiagentworker` remains tenant-filtered but still uses agency display-name fallbacks for legacy rows; duplicate names inside one tenant may misattribute a recommendation until `agency_id` backfill is separately approved.
- **P1:** Realtime/portal Edge paths do not have a durable distributed request-rate table; Auth/capability checks limit authority but do not by themselves cap paid API request volume.
- **P1:** Four pre-existing UI-referenced Edge functions have no source in this repository, preventing isolated deployment/regression testing of those four features.
- **P2:** Remote Deno imports include floating Supabase JS major-version URLs and need Deno lock/type evidence in the disposable environment.
- **P2:** The frontend retains the historical Production URL/key as a compatibility fallback. Isolated tests must set all three Vite variables, including the expected-project-ref guard.

## Decision

**PASS to begin testing only on a newly created, disposable Supabase environment.** This is not a PASS for current Staging or Production. The Deno check, exact migration dry-runs, empty preflight, 79/79 pgTAP, Edge deployment, and acceptance matrix remain mandatory gates.
