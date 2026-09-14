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

All outreach remains draft-only. Approval records a decision; no message is sent, no trial/subscription is provisioned and no payment or demo booking is created. The legacy result field `requires_ceo_approval` continues to represent a pricing/commitment review request; it does not grant company CEOs access. The owner is the only approver in this version.

DNC is monotonic. Unsubscribe cancels outstanding decisions/follow-ups and blocks both new and in-flight drafts. No changes were made to the existing email dispatcher, orchestrator, subscription billing or provisioning services.

## Verification

The Sales suite passes 20 tests, including a real PGlite upgrade from the deployed tenant schema with existing data. Coverage includes owner-only access, denial to customer roles on populated sales tables, preserved legacy records, cross-workspace foreign keys, pending/idempotent drafts, owner pricing decisions, direct mutation denial, unsubscribe, stale-draft rejection and no outbound rows. Runtime tests verify subscription-specific prompts and denial before AI/audit execution.

The previous migration's tests remain as historical upgrade-baseline coverage; current authorization is defined by the second migration and platform test. `lint` and the isolated Production frontend build pass. Full release validation and live Staging reports are attached to PR #55.

The production frontend upgrade is prepared from the current deployed source manifest by `scripts/prepare-faisal-frontend.mjs`. Unrelated production files must remain byte-for-byte identical. Main is not merged. If a UI rollback becomes necessary after this schema upgrade, use the pre-Faisal deployment `dpl_B3VYQwiZsoWdW8eyNQ7LgiJJyYLM`, which has no Sales navigation, rather than the incompatible tenant-Sales version. Preserve all sales data and audit records.

## Release status on 2026-09-14

- [Live Staging acceptance](https://github.com/aalharbi95-max/visaflow-ksa/actions/runs/34854071948): 25 checks passed with a real temporary Platform Owner and customer identities; live scoring/drafting and owner pricing approval passed; fixtures cleaned up. Evidence: `docs/qa/faisal-platform-staging-20260914.json`.
- [Production preflight](https://github.com/aalharbi95-max/visaflow-ksa/actions/runs/34854159703): passed without mutation. Evidence: `docs/qa/faisal-platform-preflight-20260914.json`.
- [Production backend upgrade](https://github.com/aalharbi95-max/visaflow-ksa/actions/runs/34854404441): completed on `6ea933ad3fb1cbf8a5e29ebfd440a031700e4d5b`. 324 application tests, 64 PostgreSQL tests, 11 hardening tests, 20 Sales tests, lint and build passed. The platform workspace migration and revised Edge Function are deployed. Evidence: `docs/qa/faisal-platform-production-20260914.json`.
- **Frontend publication is pending.** Automatic approval review rejected the Vercel production deployment because it considered the user's request to modify the owner view insufficient authorization for this follow-up production publication. The rejected publisher was not executed. The prepared snapshot preserves 305 unrelated deployed files, builds successfully, and the actual Sales component was visually checked locally as Platform Owner with a mocked transport. The public frontend still uses the previous tenant-Sales navigation until publication is approved.
- Prepared source: `tmp/faisal-review/platform-frontend`. Prepared publisher: `tmp/faisal-review/publish-platform-frontend.ps1`. It first verifies current deployment `dpl_Ac6t5DSuxtXZXH3TgbdLKUEaPcGp`, uploads only the three Sales integration files, and builds with automatic custom-domain assignment disabled. Domain promotion remains a separate verified final operation after publication is authorized.
