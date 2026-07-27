# VisaFlow Staging schema bootstrap

This directory records the reviewed, schema-only bootstrap used to initialize
the VisaFlow Staging project. The original Production schema snapshot is
preserved unchanged as source evidence; the Staging-compatible v2 snapshot is
the only final apply artifact.

## Fixed project identity

- Production source project ref: `zeocbftriydodzfgixjv`
- Staging destination project ref: `iijhdilfzndqlguefipn`

Stop immediately if the linked project ref does not match the intended step.
Use separate disposable CLI work directories or profiles for Production and
Staging. Never reuse an implicit link.

## Generate the schema-only snapshot

The locally verified Supabase CLI version is `2.108.0`. Its `db dump` help
supports `--linked`, `--schema`, `--file`, and `--dry-run`; schema-only is the
default because `--data-only` is not used.

1. Create a disposable working copy containing only `supabase/config.toml`.
2. Link it to Production and enter the database password only at the interactive
   prompt. Do not pass credentials on the command line or save them in files.
3. Confirm the linked project ref is exactly the Production ref above.
4. Preview the underlying dump command:

   ```text
   supabase db dump --linked --schema public,extensions --dry-run
   ```

5. Generate:

   ```text
   supabase db dump --linked --schema public,extensions --file supabase/bootstrap/staging/production-schema-snapshot-20260727.sql
   ```

6. Disconnect or delete the disposable Production link immediately.

The resulting file must contain definitions only: public tables, columns,
defaults, PK/FK/unique/check constraints, indexes, enums, functions/RPCs,
triggers, RLS flags, policies, required extensions, sequences, and identity
definitions. References to the platform-managed `auth` schema are allowed, but
definitions or rows from `auth`, `storage`, or other managed schemas are not.

## Mandatory snapshot review gate

Reject the snapshot if any check fails:

- No `COPY`, row `INSERT`, or data-only content.
- No email addresses, JWTs, tokens, API keys, passwords, SMTP values, connection
  strings, storage object paths, or secret values.
- No `auth.users` data or `storage.objects` data.
- No Production-specific database owner or personal-role ownership.
- No grants to personal roles. Grants to standard Supabase platform roles must
  be reviewed and retained only when required by the application.
- No role passwords, `CREATE ROLE`, `ALTER ROLE`, or role-only dump content.
- Every `SECURITY DEFINER` function has an explicit safe `search_path`.
- The file is outside `supabase/migrations`.
- Record the file byte count and SHA-256 checksum in the approval record.

Suggested local scans:

```text
rg -n -i "COPY |INSERT INTO|auth\\.users|storage\\.objects|password|secret|token|smtp|postgres(ql)?://" supabase/bootstrap/staging/production-schema-snapshot-20260727.sql
rg -n -i "CREATE ROLE|ALTER ROLE|OWNER TO|GRANT .* TO " supabase/bootstrap/staging/production-schema-snapshot-20260727.sql
rg -n -i "SECURITY DEFINER|SET search_path" supabase/bootstrap/staging/production-schema-snapshot-20260727.sql
```

The first two scans require human review rather than blind deletion because
object definitions may legitimately reference an Auth table, standard role, or
column name containing one of these words.

## Captured source snapshot review record

The source snapshot was captured on 2026-07-27 and is preserved unchanged:

- File: `production-schema-snapshot-20260727.sql`
- Scope: PostgreSQL schema-only dump of the `public` schema
- Size: 415,757 bytes
- SHA-256:
  `aeea6f62e44555c301e9922078be0bbf1bc7c980b97b04239ddca52ce3fb16dd`
- Source database: PostgreSQL 17.6
- Dump client: pg_dump 17.10

Object counts from pg_dump object headers:

| Object type | Count |
| --- | ---: |
| Tables | 75 |
| Functions | 69 |
| Policies | 110 |
| Triggers | 63 |
| Indexes | 163 |

The review found no table-data sections, `COPY` statements, top-level row-data
`INSERT INTO` statements, email-address literals, credential literals,
connection strings, or dumped personal data. Fourteen `INSERT INTO` statements
are present inside stored-function definitions; they are executable function
logic, not dumped rows. Password- and token-related names occur only as schema
identifiers and function parameters, with no matching literal values.

The detailed Auth, Storage, and extensions analysis is recorded in
`production-schema-dependency-report-20260727.md`. Important findings:

- Supabase-managed schemas are not created by this snapshot.
- Public functions, policies, and foreign keys depend on `auth.uid()`,
  `auth.jwt()`, and `auth.users`.
- `public.ai_interview_sessions.access_token` depends on
  `extensions.gen_random_bytes`.
- No `storage.*` references or Storage configuration are present.

The captured file is `public`-only and therefore does not include extension DDL.
It does not by itself satisfy a planned `--schema public,extensions` artifact.
Before any later apply is considered, the Staging preflight must verify the
required managed Auth objects, roles, and
`extensions.gen_random_bytes(integer)` separately.

## Final Staging-compatible snapshot and outcome

The final artifact is
`production-schema-snapshot-20260727-staging-v2.sql`:

- Size: 414,508 bytes
- SHA-256:
  `3a0c2275c8d99c9e6b32624e6a99df19775153ead044dc7357072dbf732ae33d`
- It differs from the unchanged source snapshot only through the reviewed
  Staging compatibility exclusions described below.
- The intermediate `production-schema-snapshot-20260727-staging.sql` was not
  retained because it failed its transactional apply and was fully rolled back.

The standalone `CREATE SCHEMA public;` statement was removed because Supabase
projects provision the `public` schema before application bootstrap. Retaining
that statement caused the first transactional apply to stop because the schema
already existed.

Twelve `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public`
statements were excluded from v2: four each for sequences, functions, and
tables. The Staging connection role is not permitted to change another role's
default privileges, and the required `supabase_admin` defaults already exist in
the managed Staging project. The corresponding default-privilege statements for
the `postgres` role remain in the final snapshot.

The v2 snapshot applied successfully in a single transaction to VisaFlow
Staging. Post-apply verification reported:

| Result | Count |
| --- | ---: |
| Public tables | 75 |
| Public functions | 69 |
| RLS policies | 110 |
| Non-internal triggers | 63 |

No Production application rows, user records, credentials, secrets, or other
business data were imported. The snapshot contains schema definitions only.

Migration history was initialized separately without replaying migration SQL.
Local and remote history contain exactly these five matching versions:

- `20260718000100`
- `20260719000100`
- `20260719000200`
- `20260719000300`
- `20260719000400`

The migration history workflow is retained in
`../../../scripts/staging-migration-history-repair.ps1`. It uses an explicit
Staging database URL, validates the Staging project ref, rejects the Production
ref, and does not use an implicit Supabase link.

The following four `SECURITY DEFINER` functions still require a separately
reviewed security-hardening migration to configure an explicit safe
`search_path`:

- `guard_agency_company_user_access`
- `guard_company_agency_access`
- `guard_platform_user_roles`
- `guard_users_security`

Do not alter these functions as part of the bootstrap artifact. Apply their
hardening only through a separately reviewed and approved migration.

## Approved bootstrap order

1. Confirm Staging is `iijhdilfzndqlguefipn` and remains empty.
2. Generate and review the snapshot using the Production read-only step above.
3. Test the snapshot against a disposable local Supabase database first.
4. Run `verify-staging-bootstrap.sql` locally before and after restore.
5. Obtain explicit approval for the reviewed snapshot and maintenance window.
6. Apply the reviewed snapshot once to Staging using a separately supplied,
   short-lived database connection. Never apply it to Production.
7. Run `verify-staging-bootstrap.sql` against Staging and compare schema object
   counts and names with the approved snapshot. Do not query business rows.
8. Link a separate disposable CLI work directory to Staging and confirm its ref.
9. Mark the five historical repository migrations as applied using the official
   history repair command:

   ```text
   supabase migration repair --linked --status applied 20260718000100 20260719000100 20260719000200 20260719000300 20260719000400
   ```

10. Verify alignment with:

    ```text
    supabase migration list --linked
    ```

11. After PR 17 is reviewed and its files are present locally, preview only:

    ```text
    supabase db push --linked --dry-run
    ```

    The preview must list only:

    - `20260726000100_secure_agency_access_baseline.sql`
    - `20260726000200_add_agency_provisioning.sql`

12. Stop for a separate approval before applying either new migration.
13. Configure Auth, Edge Function secrets, and Vercel variables only after the
    schema and migration-history verification is accepted.
14. Create synthetic test identities and records according to
    `staging-synthetic-seed-plan.md`; never import Production rows.

## Manual configuration checklist

### Supabase Auth in Staging

- Set Site URL to the approved Staging frontend origin.
- Add the exact agency invitation callback URL containing `?agency_invite=1`.
- Install and review a Staging-specific invite email template.
- Confirm no Production frontend origin is used for Staging invitations.

### Staging Edge Function

- Set `AGENCY_INVITE_REDIRECT_URL` to the approved Staging invitation callback.
- Set `AGENCY_PROVISIONER_ALLOWED_ORIGINS` to a comma-separated allowlist of
  approved Staging and local development origins.
- Never expose either setting through `VITE_*`.
- Deploy only after a separate approval and after migrations are applied.

### Vercel Preview/Staging

- `VITE_SUPABASE_URL`: Staging project URL.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: Staging publishable key.
- `VITE_APP_ENV`: `staging`.
- Scope all three variables to Preview/Staging, including PR 17 previews.
- Scope the independent Production values to Production only.
- Redeploy Preview after variables are configured; missing variables should
  produce a configuration error, never a Production connection.

## Rollback plan

Before bootstrap, rollback is simply to stop: this change contains only local
plans and frontend configuration code.

For a later Staging bootstrap:

1. Do not attempt an in-place rollback by replaying Production data.
2. If snapshot validation or migration preflight fails, stop before new
   migrations and preserve logs/checksums for review.
3. Because Staging must contain synthetic data only, the preferred recovery from
   a failed initial bootstrap is to pause Staging, confirm its project ref, and
   recreate or reset only the Staging database through an explicitly approved
   Supabase operation.
4. Re-run the approved snapshot and history alignment from the beginning.
5. Production and its Vercel variables remain untouched throughout.
