# Faisal AI Sales Agent MVP

Implemented from the supplied `VisaFlow_Faisal_Sales_Agent_MVP.zip`, reviewed against the existing orchestrator, email dispatcher, company role names, workspace Supabase client and tenant authorization patterns. The archive's deployment commands are reference material, not authorization. Subsequent user-approved Staging and Production releases are recorded below.

## Behavior

- Five company-scoped tables: `sales_leads`, `sales_tasks`, `sales_interactions`, `sales_agent_runs`, `sales_agent_approvals`.
- `visaflow-sales-agent` accepts `qualify_lead`, `draft_outreach`, `classify_reply`, `daily_brief` with a verified user JWT.
- Scores use the supplied 100-point rubric; grades are derived server-side (A ≥75, B ≥55, C ≥30, D otherwise).
- Every generated email is an internal `ai_draft` with exactly one `pending` approval per run. Both records and the completed run commit atomically.
- Approving records a human decision only. **No dispatcher, SMTP, worker, delivery queue, scheduling, or outbound email integration exists.** The sales interactions table also rejects `outbound` rows.
- Reply classification includes all ten archive categories. Explicit English/Arabic unsubscribe and pricing intent bypass AI, so these safety paths work without an API key. A request for a demo never claims a booking occurred.
- Unsubscribe sets irreversible-in-this-MVP DNC, clears follow-up dates, cancels open follow-up tasks and pending/approved approvals. Draft completion rechecks DNC under a row lock to reject results generated before an unsubscribe.
- Pricing classification always creates a pending PRICING approval, even when the model says approval is unnecessary.
- Daily brief is deterministic, tenant-scoped and uses Riyadh calendar-day boundaries. It shows active leads, contactable grade A leads, pending approvals, today's replies and up to 25 due follow-ups.
- Sales Command Center uses the existing lazy-loading/page/sidebar patterns, company context and CSS cards. It supports lead creation, lead scoring, draft review, reply classification, DNC, a daily brief, approval decisions and recent audit runs. Lists explicitly show their bounded scope (200 leads, 100 approvals, 25 runs).

## Authorization and security

| Role | Access |
| --- | --- |
| Admin / Company Admin | Own-tenant sales work and all approval decisions |
| CEO | Own-tenant read, daily brief, all approval decisions |
| Recruitment Manager | Own-tenant work and outreach decisions; cannot decide pricing/custom commitments |
| Recruitment Officer | Own-tenant work; cannot decide approvals |
| Platform Owner without company | API requires explicit active company; RLS retains owner oversight; company workspace UI is tenant-only |
| Agency, Viewer, support/marketing platform roles, inactive or ambiguous identities | Denied |

- RLS checks exactly one linked `public.users` identity, active user, allowlisted role and active company. Company callers cannot override `company_id`.
- Composite foreign keys enforce matching company and lead/run relationships, including privileged backend writes.
- Browser writes cannot alter scores, run audits, approval payloads, decision attribution, lead company, or contact email after creation. `sales_decide_approval` is the only browser decision route and records actor/time. Decision replay is rejected.
- Service-only `sales_start_run` and `sales_complete_run` revoke PUBLIC/anon/authenticated access. Definer functions use an empty search path. All five tables revoke anonymous access.
- A serialized company-level run-start budget allows 100 ordinary runs per UTC day. Unsubscribe processing bypasses the AI budget. Request bodies are capped at 16 KiB; AI calls time out after 45 seconds.
- The model receives selected lead facts, bounded notes/instructions and the submitted reply. It receives no database tools, sender tools, service keys or recipient email field. Input data is explicitly untrusted. Prompts cannot override the database approval gate.
- Provider errors are returned/audited as safe codes; provider bodies/contact details are not logged. Replies and draft bodies are retained in the tenant's protected sales tables; define a retention policy before a live pilot.
- OpenAI request uses `store: false`, explicit JSON mode and server validation; schema/model compatibility follows the [official Responses reference](https://developers.openai.com/api/reference/resources/responses/methods/create). Model output can still be factually wrong: human review remains necessary.

## Configuration and local acceptance

For additional environments configure `OPENAI_API_KEY` and **an explicitly chosen API-compatible** `OPENAI_SALES_AGENT_MODEL`. The deployed Staging/Production model is recorded below. No Codex-only model name is assumed as an API default. Supabase supplies its URL/service key. Do not add keys to browser Vite variables. Keep the Edge Function JWT gateway verification enabled; the handler independently verifies the user through Auth.

Use a company Admin/Recruitment Manager/Officer workspace and open **Sales Command Center**. Add a lead with a contact email and source facts, score it, create a draft and inspect its pending approval. Paste `UNSUBSCRIBE` to cancel approvals and prevent further drafts. Use a second tenant and an Agency identity to verify access denial. Use a CEO/Admin for pricing decisions.

## Verification on 2026-09-14

| Check | Working workspace | Isolated PR snapshot based on main |
| --- | --- | --- |
| `npm test` | 362 passed; 0 failed/skipped | 321 passed; 0 failed/skipped |
| `npm run test:sales-agent` | 17 passed (included in full suite) | Included in full suite |
| `npm run test:postgres` | 64 passed; 0 failed/skipped | 64 passed; 0 failed/skipped |
| `npm run test:release-hardening` | 11 passed | 11 passed |
| `npm run lint` | Passed | Passed |
| `npm run build` | Passed | Passed |
| Migration inventory | 90 unique migrations | 78 unique migrations |

The differing totals come from pre-existing uncommitted features in the working workspace, which are excluded from the PR. PostgreSQL security tests execute the migration in PGlite with real authenticated/anon/service roles and JWT subject settings. Edge tests execute the production handler with mocked Auth, database transport and OpenAI, including failures and a stale DNC commit. These counts describe initial PR verification, before the subsequently authorized Staging trial below.

ESLint is introduced for the new Sales JavaScript/JSX modules and tests, not the existing monolithic application. Build warnings about existing large bundles remain. Existing dependency versions are unchanged; the lockfile adds ESLint and its development dependencies.

The existing interview-token static security test was updated to follow the lazy portal import when present, or inspect the original monolithic view otherwise. Its exact token-client assertion is unchanged. This resolves a stale-test failure against the pre-existing local component extraction without modifying the portal.

## Changed files

- `src/App.jsx` — small page/sidebar/role/lazy-view integration only.
- `src/SalesCommandCenterLazyPage.jsx`, `src/salesCommandCenter.css` — Sales UI.
- `supabase/functions/visaflow-sales-agent/index.ts` — Edge entry point.
- `supabase/functions/_shared/salesAgentCore.mjs`, `salesAgentRuntime.mjs` — shared validation and request lifecycle.
- `supabase/migrations/20260914000100_faisal_sales_agent_mvp.sql` — schema, RLS, approval and transactional RPCs.
- `src/salesAgent.test.mjs`, `src/salesAgentRuntime.test.mjs`, `src/salesAgent.postgres.test.mjs` — tests.
- `src/fullSensitiveRls.test.mjs` — follow the actual interview portal source in both supported layouts.
- `eslint.config.mjs`, `package.json`, `package-lock.json` — lint and test integration.
- `docs/faisal-sales-agent-mvp.md` — review, security, test results and limits.

No existing orchestrator, email dispatcher, or other pending local feature is modified by this feature. The subsequently authorized release adds a separate scope to the existing release workflow; its original release path is preserved. The PR remains unmerged.

## Authorized live Staging trial

The user subsequently authorized a Staging trial. The dedicated `.github/workflows/faisal-staging-smoke.yml` and `scripts/faisal-staging-smoke.mjs` pin the project to `iijhdilfzndqlguefipn` (`VisaFlow Staging`), verify its management identity, apply only the exact Faisal migration, and deploy only `visaflow-sales-agent`. Recorded migration content is checked before any rerun. No Production project is accessed.

The [first live acceptance run](https://github.com/aalharbi95-max/visaflow-ksa/actions/runs/34847347862) passed 22 checks: real Auth password sign-in, anonymous denial, cross-tenant override/insert/lead denial, daily brief, pricing classification and role-restricted decisions, isolation for all five tables, unsubscribe/DNC and cancelled approvals. There were zero outbound interactions and zero email logs for the test companies. All temporary companies and Auth/application users were removed.

Initial live scoring returned an OpenAI HTTP 400 configuration error. Adding an explicit JSON instruction to the Responses `input` resolved the failure; the system instruction alone was insufficient for the live request. The input requirement is now covered by a regression assertion. Provider diagnostics return only safe allowlisted categories, never response bodies or credentials (18 Sales tests pass).

The [final Staging acceptance run](https://github.com/aalharbi95-max/visaflow-ksa/actions/runs/34848133185), completed at 2026-09-14 13:17 UTC, **passed all 25 checks**, including live OpenAI scoring, live outreach draft creation as `pending`, and denial of direct approval mutation. No email was sent; both outbound interactions and email logs remained zero for the fixture tenants. Cleanup completed. The [application release validation](https://github.com/aalharbi95-max/visaflow-ksa/actions/runs/34848133266) also passed.

The Staging model was explicitly configured as `gpt-4.1-mini-2025-04-14` using the existing Staging OpenAI key. Machine-readable evidence is in `docs/qa/faisal-staging-20260914.json`. The Staging workflow is scoped to this same-repository PR branch and Sales files; it never deploys to Production.

## Authorized Production release — 2026-09-14

Following the user's approval, the [read-only Production preflight](https://github.com/aalharbi95-max/visaflow-ksa/actions/runs/34850159593) verified the exact healthy project, existing Auth/company column compatibility, absence of conflicting Sales objects, and presence of the existing OpenAI secret. It did not apply SQL or deploy functions. Evidence: `docs/qa/faisal-production-preflight-20260914.json`.

The [isolated Production release](https://github.com/aalharbi95-max/visaflow-ksa/actions/runs/34850378812) passed on commit `79778e9c381ea6855551aa75b664200bbf0b119b`: 322 application tests, 64 PostgreSQL tests, 11 release-hardening tests, 18 Sales tests, lint and build. Sales tests overlap the application suite. The release applied only migration `20260914000100`, recorded its exact contents atomically, configured the Staging-validated Sales model, and deployed only `visaflow-sales-agent` to `zeocbftriydodzfgixjv`. Verification confirmed RLS on all five tables and rejection of anonymous Edge requests. Evidence: `docs/qa/faisal-production-20260914.json`.

Production execution is an explicit manual `Supabase release` dispatch with environment `production` and scope `faisal-release`. Scope `faisal-preflight` is read-only. The existing deploy job is excluded for both scopes, so unrelated migrations/functions are not run. Migration collisions fail closed; existing migration contents must match; SQL uses a transaction and bounded lock/statement timeouts. Existing gateway authentication stays enabled. No email worker or dispatcher was deployed or invoked.

Visual acceptance exercised the actual Sales component using a local mocked transport with fictional data: lead selection, pending draft display, record-only approval, daily brief, unsubscribe display and disabled drafting after DNC. Desktop and 390px mobile layouts were inspected; scoped summary-card/action layout was improved. This is UI acceptance, separate from the live Staging Auth/AI/RLS tests. Production public landing and company-login pages were also inspected in the browser. Sign-in with the existing saved account succeeded as Platform Owner; the unscoped owner dashboard correctly does not expose company Sales navigation. No Production customer lead/AI action was submitted in this browser check.

The existing Production frontend was a separately deployed snapshot, newer than the PR's main baseline. `scripts/prepare-faisal-frontend.mjs` validates every source file against the Vercel deployment's SHA-1 manifest before adding only the Sales page/CSS and narrowly patching App navigation. It preserved 305 unrelated files byte-for-byte, including existing accounting/interview functionality. The isolated snapshot built locally and on Vercel. No dirty local features were copied.

- Previous deployment: `dpl_B3VYQwiZsoWdW8eyNQ7LgiJJyYLM`.
- New deployment: `dpl_Ac6t5DSuxtXZXH3TgbdLKUEaPcGp`.
- Production project: `prj_kRrzSyTXK89zTz5hG3TuLCY0m2dX`.
- The new deployment was built with automatic custom-domain assignment disabled, then promoted after backend/build checks passed. Both `www.visaflowksa.com` and `visaflowksa.com` were verified to point to the new deployment.
- Main remains at `6978a358269f432e0a7f67c340eeace9fddff9ea`; PR #55 remains open. Future full frontend releases must retain the independently deployed features rather than overwrite Production with an older main snapshot.

Rollback: promote the previous Vercel deployment in the same Production project to remove the new navigation. Preserve the Sales tables and audit records; do not drop them to roll back a UI issue. If backend disablement is needed, remove only `visaflow-sales-agent` through a separately authorized operation; existing services are independent. No customer records were migrated or removed by this release.

Additional release files: `.github/workflows/supabase-release.yml`, `scripts/faisal-production-release.mjs`, `scripts/prepare-faisal-frontend.mjs`, the dedicated Staging workflow/script, and the QA reports listed above.
