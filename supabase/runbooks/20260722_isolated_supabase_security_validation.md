# VisaFlow isolated Supabase security validation

## Purpose and stop conditions

This runbook validates the local Tenant RLS/application-remediation package on a disposable Supabase project. It must not be run against Production or the existing Staging project. Stop before any write if the project reference, database host, dashboard project name, or billing context is ambiguous; if creation requires payment or an upgrade; if the database is not empty; if the migration dry-run differs from the exact list below; or if any Production/Staging credential is present in the shell, CLI link, environment file, or browser session.

Expected migration order (13 files):

1. `20260717000000_visaflow_schema_baseline.sql`
2. `20260717000040_visaflow_tenant_rls_policies.sql`
3. `20260717000050_visaflow_storage_buckets.sql`
4. `20260717000060_visaflow_storage_policies.sql`
5. `20260717000070_visaflow_application_security_contracts.sql`
6. `20260717000080_visaflow_private_interview_storage.sql`
7. `20260717000090_visaflow_guarded_product_contracts.sql`
8. `20260718000100_owner_talent_dashboard.sql`
9. `20260719000100_add_secure_public_users_rpcs.sql`
10. `20260719000200_revoke_public_users_browser_access.sql`
11. `20260719000300_add_secure_log_policies.sql`
12. `20260719000400_enforce_secure_log_access.sql`
13. `20260722000100_visaflow_security_finalization.sql`

Never insert, update, or delete rows in `supabase_migrations.schema_migrations` manually.

## Prerequisites

- A newly created, disposable Supabase project with no application data and a unique project ref.
- A separate test web origin over HTTPS and a sandbox email inbox/SMTP account.
- Node.js/npm, the repository-pinned Supabase CLI, PostgreSQL 17 client (`psql`), Deno 2.x, and a browser with two isolated profiles.
- Permission to delete the temporary project after evidence is captured. If deletion or project creation has a cost, stop for approval.
- Test-only identities and `.invalid` or sandbox inbox addresses. Never import Production users or rows.

Required frontend configuration (publishable, but keep local):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_EXPECTED_PROJECT_REF`

Required test-only Edge secrets/configuration:

- `VISAFLOW_APP_URL` (the HTTPS test origin)
- `VISAFLOW_EMAIL_DISPATCHER_SECRET` (random test-only value)
- `AI_AGENT_WORKER_SECRET` (different random test-only value)
- `SMTP_HOSTNAME`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_REPLY_TO` for a sandbox mailbox only
- `OPENAI_API_KEY` with a test-only, budget-limited project; `OPENAI_MODEL`; `OPENAI_REALTIME_MODEL`

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are platform-provided Edge secrets. Do not copy values from another project. Never place database passwords, service-role keys, SMTP credentials, worker secrets, JWTs, invitation fragments, or signed URLs in Git, screenshots, test reports, command arguments, shell history, or CI logs. Use a restricted temporary secret file outside the repository for `supabase secrets set --env-file`, then destroy it after the CLI confirms the secret names. Do not print its contents.

## 1. Local pre-check

From the repository root:

```powershell
npm.cmd run test:security-package
npm.cmd run test:security
npm.cmd run test:public-navigation
npm.cmd run build
git diff --check
deno check (Get-ChildItem supabase/functions -Recurse -Filter *.ts | Select-Object -ExpandProperty FullName)
```

The Deno command is the required type/import check. It must resolve all remote imports and return zero errors. The local Node syntax check is not a substitute.

## 2. Create and prove the disposable target

Create a new project from the Supabase dashboard. Record only its non-secret project name/ref/region in the evidence sheet. Confirm it is neither Production nor the existing Staging project. Open **Connect** inside that project and copy its Session Pooler host, port, database, and full username directly. Do not reuse saved connection data.

Run one interactive read-only identity check with `psql -X`; allow it to prompt for the temporary database password. Do not use `PGPASSWORD` or `.pgpass`.

```powershell
psql -X -h TEST_SESSION_POOLER_HOST -p TEST_PORT -U TEST_FULL_POOLER_USERNAME -d postgres -c "select current_database(), current_user;"
```

Stop if the returned user/host evidence does not map to the new project. Link a disposable CLI harness, not the main repository's existing `supabase/.temp` state:

```powershell
$VisaFlowTestHarness = Join-Path $env:TEMP ("visaflow-isolated-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $VisaFlowTestHarness | Out-Null
Push-Location $VisaFlowTestHarness
npx.cmd supabase init
npx.cmd supabase link --project-ref TEST_PROJECT_REF
Pop-Location
```

## 3. Apply the migration chain in two recorded waves

Copy only migrations 00/40/50/60 into `$VisaFlowTestHarness\supabase\migrations`. Run:

```powershell
Push-Location $VisaFlowTestHarness
npx.cmd supabase db push --linked --dry-run --include-all
npx.cmd supabase db push --linked --include-all
Pop-Location
```

The first dry-run must list exactly the first four migrations. Any extra, missing, renamed, or destructive migration is a stop condition.

Run the repository preflight interactively against the temporary database:

```powershell
psql -X -v ON_ERROR_STOP=1 -h TEST_SESSION_POOLER_HOST -p TEST_PORT -U TEST_FULL_POOLER_USERNAME -d postgres -f supabase/preflight/20260717000070_visaflow_application_security_preflight.sql
```

Expected before migration 70: every query returns zero rows. Stop for duplicate normalized emails, duplicate answer orders, ambiguous/unmapped agency names, candidate/interview tenant mismatch, duplicate Auth links, or legacy active accounts. The use of `to_jsonb(row)->>'agency_id'` is intentional so this preflight works before those columns exist.

Copy migrations 70/80/90 and the six later migrations (20260718 through 20260722) into the harness. Run a second dry-run. It must list exactly the remaining nine files, in order. Then push them. Re-run the same preflight before creating fixtures; all result sets must still be empty.

## 4. Run database and static contracts

Copy the three SQL tests into `$VisaFlowTestHarness\supabase\tests`, then run:

```powershell
Push-Location $VisaFlowTestHarness
npx.cmd supabase test db --linked
Pop-Location
```

Required result: 79/79 assertions pass (37 application-security, 22 interview behavior, 20 tenant RLS), no `Bail out!`, and every test transaction rolls back. Capture counts and test names only; redact database hosts, JWTs, invitation URLs, and signed URLs.

## 5. Auth and Edge configuration

In the temporary project's Auth settings only:

- Enable Anonymous Sign-Ins.
- Set the Site URL to the test origin.
- Add exact test redirect URLs for Workspace upgrade, company recovery, candidate login, and candidate recovery. Do not add Production URLs.
- Keep invite/recovery templates based on Supabase's confirmation URL; do not inject application tokens.
- Keep email delivery pointed to the sandbox provider.

Deploy repository-owned functions to the temporary project only. Deploy `legacy-account-upgrade`, `ai-interview-invitation-worker`, `aiagentworker`, and `visaflow-email-dispatcher` with `--no-verify-jwt` because each implements its own server-side caller verification and has a service-to-service path. Deploy the remaining functions with gateway JWT verification enabled. Do not deploy the four UI-referenced functions whose source is absent from this repository (`visaflow-talent-cv-analyzer`, `visaflow-talent-resume-studio`, `visaflowbackupworker`, `visaflowrestoreworker`); record those features as unavailable in this test.

After setting test-only secrets, list secret **names only**. Never print values. Verify that no test function points to a Production URL, SMTP account, OpenAI project, or Supabase project.

## 6. Synthetic fixtures

Create only synthetic records:

- Company A and Company B.
- Agency A linked to Company A and Agency B linked to Company B.
- Agency A user access to Company A; a second active Company B access row for the same office/user only in the explicit multi-company case.
- Auth-backed Company Admin A/B with exact `public.users.auth_user_id = auth.users.id`.
- One legacy Company user with `auth_user_id IS NULL`, a unique sandbox email, and a synthetic legacy password.
- Candidate A/B and an Auth-backed Talent candidate for each tenant where needed.
- One active AI interview campaign/template/session/question for Company A and one for Company B.
- One test-only AI Agent settings row per company and sandbox recipients.

Never derive fixture identifiers or emails from Production.

## 7. Acceptance matrix

| ID | Scenario | Expected result / evidence |
|---|---|---|
| AUTH-01 | New company user signs in | `signInWithPassword` returns a real session; `getSession` and `getUser` agree; Workspace RPC returns only the linked actor/company. |
| AUTH-02 | Legacy user submits correct old credentials | A Supabase invite is sent; no Auth link exists until the exact invited Auth id is recorded and the user completes setup. |
| AUTH-03 | Existing Auth email with blank legacy `auth_user_id` | Upgrade stops safely; no email-only link and no role/tenant grant. |
| AUTH-04 | Workspace/Talent/Interview in isolated profiles | Storage keys are `visaflow-workspace-auth`, `visaflow-talent-auth`, and tab-scoped `visaflow-interview-auth`; signing out one audience does not remove another audience's key. Record booleans only, never tokens. |
| AUTH-05 | Company and Talent recovery links | Correct audience completes recovery; cross-audience callback is rejected; existing recovery behavior remains usable. |
| TENANT-01 | Company A reads/writes A then requests B | A succeeds; B returns zero rows/403; changing `company_id` is rejected. |
| TENANT-02 | Agency A accesses linked/unlinked companies | Active office + member + per-user access succeeds; missing/inactive relation fails. |
| TENANT-03 | Agency/user same office with two approved companies | Both approved access rows work; a different office fails `agency_mismatch`/authorization. |
| TENANT-04 | Talent candidate A requests candidate/interview B | Zero rows/403; no identifiers or media paths leak. |
| TENANT-05 | Unauthenticated browser queries internal tables/Storage | All direct reads/writes fail, including AI interview sessions/answers/audio. |
| PORTAL-01 | Valid 256-bit fragment invitation | Fragment is removed before analytics; anonymous Auth session is created; one capability is bound to that exact Auth uid/session. |
| PORTAL-02 | Used invitation | Second exchange fails; no second capability is issued. |
| PORTAL-03 | Expired/revoked invitation | Generic invalid/expired response; no token/hash appears in response or logs. |
| PORTAL-04 | Tampered capability/session/question/company | 403/42501; state and rows remain unchanged. |
| PORTAL-05 | Non-anonymous authenticated user calls portal RPC directly | Rejected by the SQL `is_anonymous` claim check even without passing through Edge. |
| MEDIA-01 | Allowed audio <=25MB and video <=100MB | Exact-path signed upload succeeds; finalization verifies stored size and MIME; short signed read works only for the bound session. |
| MEDIA-02 | Oversize, bad MIME, wrong path, overwrite, or other session | Rejected; failed uploaded object is removed; no object path is returned to the browser. |
| INVITE-01 | Two independent callers issue invitation concurrently | Session row lock serializes requests; exactly one active invitation remains; only the newest received link exchanges successfully. |
| SMTP-01 | Platform SMTP save/test | Response, Network panel, function logs, and table projection contain no `smtp_password`; Company SMTP credential mode remains disabled. |
| WORKER-01 | Invitation worker with valid/invalid worker secret | Valid test secret claims only test jobs; invalid/missing secret is 401; replay does not create multiple active links. |
| WORKER-02 | AI Agent scheduled/queue run | Only test service path/Platform Owner can invoke; every row and action remains scoped to its `company_id`; cross-tenant job input is rejected. |
| REALTIME-01 | Valid live capability / invalid capability | Valid in-progress conversational session obtains SDP; invalid/expired/other-session capability is rejected; paid test project rate is monitored. |
| COMMAND-01 | AI Commander caller sends fake company/snapshot | Request is rejected as `untrusted_tenant_context`; verified counts are derived server-side from the actor tenant. |

For concurrency use two browser profiles or two independent Supabase clients. Do not copy a JWT between them. Query only aggregate invitation counts and timestamps for evidence; never select `token_hash` or capture raw links.

## 8. Exit and rollback

Pass requires: both dry-runs exact, preflight empty before and after, 79/79 pgTAP, Deno check clean, all applicable matrix rows pass, and logs contain no secrets/signed URLs/raw invitation fragments.

On any failure, stop Edge schedules and test traffic. Preferred rollback is deletion of the entire disposable project after exporting redacted evidence. If deletion requires payment/approval, revoke test secrets, disable Anonymous Auth, remove redirect URLs, pause the project, and request approval. Do not repair by granting broad `anon`/`authenticated` access, do not copy the temporary migration history to another project, and do not use Production or current Staging as a fallback.
