# VisaFlow KSA — Staging QA Report

Date: 2026-08-04  
Environment: Staging only  
Stable URL: https://visaflow-ksa-staging.vercel.app/?login=1  
Branch: `feature/prelaunch-workflow-sprint1`  
Test prefix: `QA-20260804`

## Executive result

The application builds successfully, the automated suite passes, all company-side navigation screens are reachable, the core request-to-authorization path works, and the agency account is UI-isolated to its authorized workspace pages.

The release is suitable for continued Staging verification, but not yet for Production approval because the AI Interview tables still report database permission errors and the complete candidate-to-joining-to-demobilization lifecycle could not be proven end to end in the isolated Staging database during this run.

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

## Findings requiring follow-up

### High

1. AI Interview permissions
   - Browser diagnostics repeatedly report `permission denied for table users` for `ai_interview_campaigns`, `ai_interview_campaign_candidates`, and `ai_interview_invitation_jobs`.
   - Impact: AI Interview Center data may be incomplete or unusable for otherwise authorized company users.

2. Environment/link confusion
   - `visaflow-ksa-gc5t.vercel.app` was serving an older deployment and a different dataset from the isolated Staging project.
   - The supported QA URL is now `visaflow-ksa-staging.vercel.app`.
   - The old link should be clearly labelled Preview or retired to prevent tests being performed against the wrong data source.

### Medium

3. Candidate save feedback
   - The previous order displayed a blocking alert before clearing the form and reloading candidate data, making the result appear incomplete.
   - The code now clears the form and awaits request/candidate reloads before displaying success. Retest the saved row on the stable Staging URL.

4. Agency notification proof
   - On the older preview dataset, the selected agency notification did not appear in Notification Center after sending.
   - Re-run this on the stable isolated Staging URL and verify three outputs: notification row, agency visibility, and email log status.

5. Searchable select usability
   - Typing a profession or nationality is not enough; the user must click a matching suggestion.
   - This is documented in the guide, but the control should also show an inline validation message when text has not been selected.

## Screen coverage

Reviewed: Executive Dashboard, AI Commander, AI Agent, AI Report Studio, Dashboard, Requests, Saudi Hiring, Candidates, Interviews, AI Interview Center, Rejected Candidates, Visa Inventory, Visa Allocation, Authorization, Cancellation Register, Mobilization, Onboarding & Validation, Employees, Demobilization, Workforce Marketplace, Local Content, Office Portal, Agencies, Agency Agreements, Agency Ranking, Agency Performance, Penalty Register, Recruitment Performance, Reports, Notifications, Email Logs, Company Management, Email Settings, Users Management, Permissions, Master Data, and User Guide.

## Automated verification

- Build: passed (`vite build`).
- Tests: 184 passed, 0 failed, 1 skipped.
- The skipped browser component test explicitly requires Chrome or Edge.
- Existing non-blocking build observations: unresolved `/login-hero.jpg` at build time and a large application chunk warning.

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
