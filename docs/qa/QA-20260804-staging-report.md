# VisaFlow KSA — Staging QA Report

Date: 2026-08-04  
Environment: Staging only  
Stable URL: https://visaflow-ksa-staging.vercel.app/?login=1  
Branch: `feature/prelaunch-workflow-sprint1`  
Test prefix: `QA-20260804`

## Executive result

The application builds successfully, the automated suite passes, all company-side navigation screens are reachable, the core request-to-authorization path works, and the agency account is UI-isolated to its authorized workspace pages.

The isolated Staging lifecycle is now proven from agency candidate creation through mobilization, arrival, joining, 90-day validation, employee conversion, demobilization, and Workforce Marketplace availability. AI Interview template, campaign, candidate-validation, and queue-read permissions are now proven on stable Staging. Agency-originated candidate notifications and the automatic penalty-to-agency-to-manager decision lifecycle are also proven. The release remains unsuitable for Production approval until the remaining outbound AI invitation launch is verified and the remaining usability findings are resolved.

A second live redeployment cycle now proves the full project-end path after the notification allowlist correction: employee creation, demobilization, an explainable 83% AI match, save, confirmation, employee-project reassignment, and a durable `REDEPLOYMENT_CONFIRMED` Notification Center event. Both Staging aliases resolve to the same deployment. Production data and configuration were not changed during this correction.

## Verified successfully

- Company authentication works on the isolated Staging project.
- Agency authentication works on the isolated Staging project.
- Agency navigation exposes only Office Portal, Notifications, and User Guide; company administration pages are not exposed.
- All visible company screens open without a navigation failure.
- Request creation, request-line creation, and Recruitment Approval were verified in the earlier preview workspace with `REQ-2026-0025`.
- Profession and nationality search lists work when the user selects a suggestion.
- Visa batch `QA-20260804-V001` was created with a matching request line.
- The visa line was allocated to `REQ-2026-0025` with quantity 2.
- Authorization `QA-20260804-AUTH01` was created with quantity 2.
- The Notification Center Split View, table filters, bulk/export helpers, demobilization filters, and redeployment matching are covered by passing automated tests.
- An illustrated, role-aware User Guide is now available from the sidebar for both company and agency users.
- The missing permanent Staging alias was repaired. The stable URL above now resolves to the latest Staging deployment.
- Authorization `2121222` was verified on isolated Staging through `New -> Acknowledged -> Accepted`, including actor names, timestamps, and QA notes in the timeline.
- The authorization action no longer depends on `window.prompt`; the agency now confirms acknowledge/accept/reject in an inline form.
- Supabase Edge Function CORS was corrected for the stable Staging origin and the preflight changed from HTTP 403 `origin_not_allowed` to HTTP 200.
- Agency candidate `QA-20260804 Staging Candidate` / passport `QA20260804STG01` was created in isolated Staging; the active candidate count changed from 198 to 199.
- The candidate was mobilized through `Arrived KSA` and `Joined`; the live request counters changed to 1 arrived and 1 joined.
- Joining now creates one idempotent `onboarding_validations` record automatically. The QA worker completed the 90-day validation with a 90% score, `Passed Validation`, and positive agency impact.
- The candidate was converted to employee `EMP-2026-000001`. Candidate UUID linkage was migrated to text and backfilled, and the UI no longer offers duplicate conversion for the same candidate.
- Demobilization was saved as `Available` with `Recruitment Avoided = No`. The same worker appeared in Workforce Marketplace with the AI no-match explanation.
- Live redeployment matching correctly rejected the two open requests because one had a different profession/nationality and the other required a different gender. The `Use` action remains covered by automated matching tests but was not presented in this live no-match case.
- Workspace horizontal overflow was contained and wide operational tables now scroll within their cards; primary form actions remain visible.
- Mobilization and Demobilization saves now show inline progress, success, warning, and database error feedback instead of opaque alerts.
- AI Interview template generation now calls the dedicated secure Edge Function. With the Staging AI secret absent, the UI fails safely with a configuration message and does not save an incomplete template.
- QA template `QA-20260804 AI Interview Template` was created with 10 bilingual questions, a verified 100% total weight, published by the Company Admin, and locked after approval.
- QA campaign `QA-20260804 AI Interview Campaign` was created with a default seven-day deadline. One QA candidate was added and revalidated as `Valid`, moving the campaign to `Ready`.
- `ai_interview_campaigns` insert, `ai_interview_campaign_candidates` insert/revalidation, and `ai_interview_invitation_jobs` read access were verified without the previous `permission denied for table users` diagnostics.
- The campaign was intentionally not launched, so no invitation job or external email was created during this test.
- Agency candidate `QA-20260804 Notification Retest` was created after a fresh load of the latest Staging bundle. Notification event `CANDIDATE_CREATED` was queued for the correct company workspace with recipient role `Company`.
- The Company Admin refreshed Notification Center and the new agency-originated candidate notification appeared in the Unread split-view folder. Database recipient isolation and company-side UI visibility were both verified.
- Penalty `PEN-2026-0001` was automatically created from controlled delayed-request source `QA-PEN-20260804`: two delayed workers, five chargeable days, 25 SAR per worker/day, calculated amount 250 SAR.
- The Recruitment Manager sent the penalty to the agency. It appeared in Office Portal with status `Sent to Agency`, the required amount, and a justification action.
- An authenticated agency objection changed the record to `Justification Submitted` and Office Portal showed `Under company review`. The manager then saw all three final actions: approve, reduce, and accept objection/cancel.
- The manager decision was tested with `Reduced`: approved amount 125 SAR, final role `Recruitment Manager`, and the register showed `Final`. The temporary QA role and agreement settings were restored afterward to Company Admin, 60-day SLA, zero default penalty, and seven-day grace period.
- Request `REQ-2026-0004` was created with the canonical bilingual Software Engineer profession and nationality `Filipino`, approved by Recruitment, delivered to the agency Notification Center, accepted by the agency, and started a 60-day SLA.
- Composite employee nationality `Filipino (Philippines)` is now safely matched to the canonical request nationality without arbitrary partial-string matches. Duplicate country master-data rows are canonicalized before matching.
- Employee `EMP-2026-000002` completed a live redeployment from `QA Ending Project` to `QA Master Data Validation` at 83%. The record became `Reassigned`, Recruitment Avoided became `Yes`, and no fabricated invoice or default financial saving was created.
- The missing `REDEPLOYMENT_CONFIRMED` database allowlist entry was identified as the reason the first confirmation did not appear in Notification Center. Migration `20260804000500_allow_redeployment_confirmed_notification.sql` was applied to isolated Staging and verified with `pg_get_functiondef`; the allowlist check returned `true`.
- Employee `EMP-2026-000003` then completed an independent post-migration live cycle from `QA Ending Project Notification` to `QA Master Data Validation`, again at 83%. The employee remained `Active`, the project was updated, and the confirmation created the ninth unread notification.
- Notification Center displayed the durable event type `REDEPLOYMENT_CONFIRMED`, title `Employee redeployment confirmed`, the employee name, old project, new project, request `REQ-2026-0004`, High priority, and Company audience.
- The stable default alias `visaflow-ksa-staging.vercel.app` and custom alias `staging.visaflowksa.com` were both unified on the deployment containing commit `115ac84`.

## Findings requiring follow-up

### High

1. Environment/link confusion
   - `visaflow-ksa-gc5t.vercel.app` was serving an older deployment and a different dataset from the isolated Staging project.
   - The supported QA URL is now `visaflow-ksa-staging.vercel.app`.
   - The old link should be clearly labelled Preview or retired to prevent tests being performed against the wrong data source.

### Medium

2. AI Interview outbound launch
   - Template approval, campaign creation, candidate insert/revalidation, and queue reads are verified.
   - Campaign launch and invitation delivery remain intentionally untested to avoid sending an external QA email without a dedicated controlled recipient.
   - The secure `generate-ai-interview-template` Edge Function is implemented and deployed to Staging, but Staging does not yet have the required `OPENAI_API_KEY` Edge Function secret. The UI fails safely, explains the missing configuration, and does not save an incomplete template. Configure the secret before Production approval.

3. Searchable select usability
   - Typing a profession or nationality is not enough; the user must click a matching suggestion.
   - This is documented in the guide, but the control should also show an inline validation message when text has not been selected.

4. Penalty objection input
   - The lifecycle and tenant permissions are verified, but the agency objection action still uses `window.prompt`.
   - Replace it with an inline bilingual form with required reason, attachment support, confirmation text, progress state, and durable success/error feedback.

## Screen coverage

Reviewed: Executive Dashboard, AI Commander, AI Agent, AI Report Studio, Dashboard, Requests, Saudi Hiring, Candidates, Interviews, AI Interview Center, Rejected Candidates, Visa Inventory, Visa Allocation, Authorization, Cancellation Register, Mobilization, Onboarding & Validation, Employees, Demobilization, Workforce Marketplace, Local Content, Office Portal, Agencies, Agency Agreements, Agency Ranking, Agency Performance, Penalty Register, Recruitment Performance, Reports, Notifications, Email Logs, Company Management, Email Settings, Users Management, Permissions, Master Data, and User Guide.

## Automated verification

- Build: passed (`vite build`).
- Tests: 190 passed, 0 failed, 1 skipped (191 total).
- The skipped browser component test explicitly requires Chrome or Edge.
- Existing non-blocking build observations: unresolved `/login-hero.jpg` at build time and a large application chunk warning.

## Database corrections applied to isolated Staging

- `mobilizations.candidate_id` changed from bigint to text so candidate UUIDs are accepted.
- `mobilizations.updated_at` added with a non-null timestamp default.
- `employees.source_candidate_id` changed from bigint to text and the QA employee was backfilled to the originating candidate UUID.
- Demobilization persistence now sends only columns supported by the operational table and does not claim recruitment was avoided when no eligible match exists.
- Notification mutation allowlist now accepts `REDEPLOYMENT_CONFIRMED`; the migration uses an exact guarded replacement and is idempotent.
- The application surfaces a partial-success warning if employee/demobilization updates succeed but confirmation-notification persistence fails.

## Evidence

Screenshots are stored under `public/user-guide/`:

1. Company requests
2. Agency notification selection
3. Candidate form
4. Visa inventory
5. Visa allocation
6. Authorization
7. Candidate submission
8. Agency Office Portal

No passwords, access tokens, or secret configuration values are stored in this report or the screenshots.
