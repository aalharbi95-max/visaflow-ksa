# Faisal — Platform subscription sales

Faisal works for the VisaFlow Platform Owner to qualify prospective company subscribers, draft subscription outreach, classify replies and prepare daily briefs. It does not work for customer-company recruitment teams. This corrects the initial company-workspace interpretation in PR #55.

## Access and data

The Sales Command Center appears in the Platform Owner navigation and does not require selecting or creating a customer company. An active, uniquely linked Auth identity with role `Platform Owner` and no company association is required by both the Edge handler and SQL authorization. Company Admin, CEO, recruitment roles and other platform roles are denied.

Migration `20260914000200_faisal_platform_sales_workspace.sql` introduces `sales_workspaces`. Exactly one workspace has scope `platform`; the five sales tables now use `workspace_id` and retain their composite foreign keys. No fake company is inserted. Existing tenant sales records remain in separate `legacy_company` workspaces; they are not copied into the platform pipeline and are not browser-readable after this correction. No records are deleted by the upgrade.

The frontend resolves the platform workspace through authenticated RLS. The Edge handler independently resolves the active platform workspace and rejects legacy company scope and workspace overrides. Service RPC parameter `p_company` retains its deployed signature for compatibility, but now validates a Sales workspace. It cannot start a run for a customer-company workspace.

## Owner workflow

1. Sign in as Platform Owner and open **Sales Command Center**.
2. Add a prospective company subscriber and factual context.
3. Score the prospect and generate a VisaFlow subscription outreach draft.
4. Review pending approvals; pricing/custom commitments can only be decided by the owner.
5. Paste received replies for classification, or request the daily brief.

AI-generated outreach and quotes remain draft-only. Approval records a decision; no quote is sent by the automatic introduction worker. No trial/subscription is provisioned and no payment or demo booking is created. The new automatic introduction phase below sends only a fixed platform overview. The legacy result field `requires_ceo_approval` continues to represent a pricing/commitment review request; it does not grant company CEOs access. The owner is the only approver in this version.

DNC is monotonic. Unsubscribe cancels outstanding decisions/follow-ups and blocks both new and in-flight drafts. No changes were made to the existing email dispatcher, orchestrator, subscription billing or provisioning services.

## Verification

The Sales suite passes 20 tests, including a real PGlite upgrade from the deployed tenant schema with existing data. Coverage includes owner-only access, denial to customer roles on populated sales tables, preserved legacy records, cross-workspace foreign keys, pending/idempotent drafts, owner pricing decisions, direct mutation denial, unsubscribe, stale-draft rejection and no outbound rows. Runtime tests verify subscription-specific prompts and denial before AI/audit execution.

The previous migration's tests remain as historical upgrade-baseline coverage; current authorization is defined by the second migration and platform test. `lint` and the isolated Production frontend build pass. Full release validation and live Staging reports are attached to PR #55.

The production frontend upgrade is prepared from the current deployed source manifest by `scripts/prepare-faisal-frontend.mjs`. Unrelated production files must remain byte-for-byte identical. Main is not merged. If a UI rollback becomes necessary after this schema upgrade, use the pre-Faisal deployment `dpl_B3VYQwiZsoWdW8eyNQ7LgiJJyYLM`, which has no Sales navigation, rather than the incompatible tenant-Sales version. Preserve all sales data and audit records.

## Release status on 2026-09-14

- [Live Staging acceptance](https://github.com/aalharbi95-max/visaflow-ksa/actions/runs/34854071948): 25 checks passed with a real temporary Platform Owner and customer identities; live scoring/drafting and owner pricing approval passed; fixtures cleaned up. Evidence: `docs/qa/faisal-platform-staging-20260914.json`.
- [Production preflight](https://github.com/aalharbi95-max/visaflow-ksa/actions/runs/34854159703): passed without mutation. Evidence: `docs/qa/faisal-platform-preflight-20260914.json`.
- [Production backend upgrade](https://github.com/aalharbi95-max/visaflow-ksa/actions/runs/34854404441): completed on `6ea933ad3fb1cbf8a5e29ebfd440a031700e4d5b`. 324 application tests, 64 PostgreSQL tests, 11 hardening tests, 20 Sales tests, lint and build passed. The platform workspace migration and revised Edge Function are deployed. Evidence: `docs/qa/faisal-platform-production-20260914.json`.
- **Frontend publication completed after explicit user approval.** The earlier automatic approval rejection was resolved by the user's explicit consent to publish and activate the owner interface on the live site. Deployment `dpl_Fn7WnxgNct81jTba4cCyZ9eNWmVE` built successfully, was promoted, and both `www.visaflowksa.com` and `visaflowksa.com` were verified to point to it. The snapshot preserves 305 unrelated deployed files.
- The existing authenticated Platform Owner session was refreshed on the public site. **Sales Command Center** appeared in owner navigation and loaded without a customer-company selection. **Generate Daily Brief** succeeded with zero initial leads/approvals and a completed audit entry. No prospect was added and no outbound email was sent during this Production browser check. Evidence: `docs/qa/faisal-platform-frontend-20260914.json`.
- Published source: `tmp/faisal-review/platform-frontend`. Publisher: `tmp/faisal-review/publish-platform-frontend.ps1`. It verified prior deployment `dpl_Ac6t5DSuxtXZXH3TgbdLKUEaPcGp`, uploaded only the three Sales integration files, built with automatic custom-domain assignment disabled, and was promoted only after the build passed. Do not replay this publisher without checking the new deployed baseline.

## Automatic platform introductions (implementation prepared)

The owner requested autonomous prospect research and comprehensive platform introductions, while retaining personal approval of every price offer. Migration 20260914000300 adds owner-only automation settings, a separate introduction delivery ledger, and service-only global email suppression. The original no-outbound constraint on AI drafts remains intact.

The isolated visaflow-sales-outreach function uses the configured OpenAI model and web search to discover up to five Saudi FM, O&M and contracting prospects per 24 hours. Only published role inboxes on the company's own HTTPS domain pass independent source verification. Private IPs, redirects, non-HTTPS, arbitrary ports and DNS rebinding are rejected. Discovery is conservative and can yield fewer prospects. Email addresses are deduplicated permanently. Default caps are ten reservations per Riyadh day and two per hour; this is an upper bound, not a promised volume.

Only the versioned Arabic introduction in salesIntroduction.mjs can be sent. It describes recruitment requests, visas, agencies, candidates, interviews, mobilization, employees, housing, reporting, AI assistance and permissions. No prices, discounts, trial provisioning or custom commitments are included. Arbitrary model output never becomes SMTP content. Both deployment configuration and an active Platform Owner's setting must enable live sending. The UI provides preview, fixed-owner-inbox test, pause/resume and manual cycle controls. A dedicated hourly pg_cron worker runs only after the explicit Production release step.

Reply-To is the owner's existing adel@visaflowksa.com inbox. Automatic inbound mailbox ingestion is not implemented: the owner pastes replies into Sales Command Center for classification and pricing approval. Quote approval records the owner's decision; quote sending remains manual. Recipients can stop future messages through an unguessable unsubscribe token: GET redirects to a dedicated frontend confirmation page, POST suppresses, and one-click List-Unsubscribe is supported. DNC and existing outreach opt-outs are checked again immediately before SMTP. A message already accepted by SMTP cannot be recalled. Ambiguous sends are held for human review and never retried automatically.

Authentication: the sender validates a Supabase user JWT and unique active Platform Owner, or a dedicated secret used by the scheduler. The public unsubscribe endpoint accepts only an unguessable 64-character token. These two isolated endpoints disable gateway JWT verification intentionally; existing endpoints retain their authentication. Secrets are stored only in Supabase Secrets/Vault. Tokens are not browser-readable. No customer company's records are made available to this pipeline.

Validation so far: 29 Sales tests passed, including real PostgreSQL RLS, caps, suppression, sender isolation, immutable template and SMTP ambiguity behavior. Local lint and build passed; the full local suite passed 370 tests before the final two additional tests. Live Staging search and owner-only SMTP acceptance are required before enabling Production. No production activation is claimed by this implementation record.


### Current release gate

Production still runs the earlier owner-only draft version. Automatic introductions have been deployed only to Staging with live prospect sending disabled. Main remains unmerged. The reviewed frontend snapshot preserves 307 deployed files, changes only SalesCommandCenterLazyPage.jsx, and adds two standalone unsubscribe assets; its build passes.

Funded discovery acceptance is blocked by an actual HTTP 429 response with code credit_balance_exhausted from the configured OpenAI endpoint. Evidence: [search acceptance run](https://github.com/aalharbi95-max/visaflow-ksa/actions/runs/34858324659). Refill the API account associated with Staging's OPENAI_API_KEY and rerun the isolated release with verify_search=true. Do not paste API keys into the task. Infrastructure-only verification is allowed on Staging; the release script rejects that bypass on Production.

SMTP accepted fixed-template tests addressed only to adel@visaflowksa.com. Provider acceptance does not prove inbox delivery. No prospective company was emailed, and no automatic trial was created. Public-source reading in the older Edge runtime required native Deno TCP-to-TLS upgrade: the connection stays pinned to the validated public IP and uses the original hostname for TLS certificate verification. No certificate checks were disabled. Automated tests cover HTTP framing, redirects, truncated responses, ambiguous framing and the unsubscribe page's click-only behavior.

Final infrastructure acceptance passed on ad085fc: [Staging run](https://github.com/aalharbi95-max/visaflow-ksa/actions/runs/34859629098). CI passed 333 application tests, 64 PostgreSQL tests, 11 release-hardening tests, 29 Sales tests, lint and build. Evidence: docs/qa/faisal-intro-infrastructure-20260914.json and docs/qa/faisal-intro-credit-block-20260914.json. The funded discovery check remains explicitly blocked; this successful infrastructure run is not full release acceptance.
