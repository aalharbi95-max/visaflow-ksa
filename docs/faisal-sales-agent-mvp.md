# Faisal AI Sales Agent MVP

Implemented from the supplied `VisaFlow_Faisal_Sales_Agent_MVP.zip`, reviewed against the existing orchestrator, email dispatcher, company role names, workspace Supabase client and tenant authorization patterns. The archive's deployment commands are reference material; no deployment was performed.

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

Configure `OPENAI_API_KEY` and **an explicitly chosen API-compatible** `OPENAI_SALES_AGENT_MODEL` in a future local/staging environment. No Codex-only model name is assumed as an API default. Supabase supplies its URL/service key. Do not add keys to browser Vite variables. Keep the Edge Function JWT gateway verification enabled; the handler independently verifies the user through Auth.

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

The differing totals come from pre-existing uncommitted features in the working workspace, which are excluded from the PR. PostgreSQL security tests execute the migration in PGlite with real authenticated/anon/service roles and JWT subject settings. Edge tests execute the production handler with mocked Auth, database transport and OpenAI, including failures and a stale DNC commit. No paid model call, remote Supabase migration, Production access, or outbound email was performed. A live staging Auth/gateway/model/UI smoke test remains an operational acceptance step before deployment.

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

No existing orchestrator, email dispatcher, production release workflow, or other pending local feature is part of this change. No merge to main or deployment is authorized by this implementation.
