# Production schema dependency report — 2026-07-27

## Scope

This report analyzes
`production-schema-snapshot-20260727.sql`, a schema-only pg_dump of the
Production `public` schema. It identifies dependencies on Supabase-managed
`auth`, `storage`, and `extensions` schemas. It is an inspection artifact, not an
apply plan.

The snapshot creates only the `public` schema. It contains no `CREATE SCHEMA
auth`, `CREATE SCHEMA storage`, `CREATE SCHEMA extensions`, or `CREATE
EXTENSION` statements.

## Dependency summary

| Managed dependency | Referencing public objects | Requirement |
| --- | ---: | --- |
| `auth.uid()` | 18 functions and 38 policies | Supabase Auth helper must exist before dependent objects are created |
| `auth.jwt()` | 1 of the same 18 functions | Supabase Auth JWT helper must exist |
| `auth.users` | 1 of the same 18 functions and 4 foreign keys | Managed Auth users table must exist |
| `storage.*` | 0 | Storage is not represented by this public-schema snapshot |
| `extensions.gen_random_bytes` | 1 table default | `pgcrypto` functionality must be available in the `extensions` schema |

The Supabase roles `anon`, `authenticated`, and `service_role` are also named in
ACL and policy statements. A compatible Supabase target must provide those roles
before those statements can succeed.

## Auth dependencies

### Functions

The following 18 distinct public functions reference `auth.uid()`,
`auth.jwt()`, or `auth.users`:

1. `add_candidates_to_ai_interview_campaign(uuid, text[])`
2. `current_app_agency_id()`
3. `current_app_company_id()`
4. `current_app_role()`
5. `current_app_user_agency_id()`
6. `current_app_user_company_id()`
7. `current_app_user_id()`
8. `current_app_user_role()`
9. `current_log_actor()`
10. `get_authenticated_app_user()`
11. `get_owner_talent_dashboard()`
12. `guard_platform_user_roles()`
13. `is_current_platform_user()`
14. `launch_ai_interview_campaign(uuid, text)`
15. `list_manageable_app_users()`
16. `remove_candidates_from_ai_interview_campaign(uuid, uuid[])`
17. `revalidate_ai_interview_campaign_candidates(uuid)`
18. `talent_is_privileged_actor()`

`get_owner_talent_dashboard()` joins `auth.users`.
`talent_is_privileged_actor()` uses both `auth.uid()` and `auth.jwt()`.
The remaining functions in this list use `auth.uid()`.

### Foreign keys

Four public foreign keys reference `auth.users(id)`:

| Public table | Constraint | Delete action |
| --- | --- | --- |
| `profiles` | `profiles_id_fkey` | `CASCADE` |
| `talent_candidate_events` | `talent_candidate_events_auth_user_id_fkey` | `SET NULL` |
| `talent_candidates` | `talent_candidates_auth_user_id_fkey` | `CASCADE` |
| `users` | `users_auth_user_id_fkey` | `SET NULL` |

### Policies

Thirty-eight policies use `auth.uid()`. They are distributed as follows:

| Public table | Policy count |
| --- | ---: |
| `agencies` | 1 |
| `ai_interview_campaign_candidates` | 1 |
| `ai_interview_campaigns` | 1 |
| `ai_interview_invitation_jobs` | 1 |
| `companies` | 1 |
| `profiles` | 1 |
| `talent_candidate_certifications` | 4 |
| `talent_candidate_consents` | 4 |
| `talent_candidate_documents` | 4 |
| `talent_candidate_education` | 4 |
| `talent_candidate_events` | 2 |
| `talent_candidate_experience` | 4 |
| `talent_candidate_skills` | 4 |
| `talent_candidates` | 3 |
| `talent_cv_analysis_runs` | 1 |
| `talent_resume_versions` | 2 |

## Storage dependencies

No `storage.*` references occur in the snapshot. Because the dump is scoped to
`public`, this does not prove that Production has no Storage configuration. It
means this snapshot does not carry:

- Storage schema objects;
- bucket metadata or rows;
- stored objects;
- policies on `storage.objects`; or
- Storage-specific grants.

Any Staging Storage bootstrap must therefore be inventoried and reviewed
separately.

## Extensions dependencies

`public.ai_interview_sessions.access_token` has this default:

```sql
encode(extensions.gen_random_bytes(24), 'hex'::text)
```

The snapshot does not install the providing extension or create the
`extensions` schema. On Supabase this functionality is normally supplied by
`pgcrypto`; the target must be checked for the exact
`extensions.gen_random_bytes(integer)` function before any apply plan is
approved.

## Bootstrap implications

A future Staging bootstrap plan must, at minimum:

1. Prove the target is Staging and not Production.
2. Confirm the Supabase-managed schemas and roles already exist.
3. Confirm `auth.uid()`, `auth.jwt()`, `auth.users`, and
   `extensions.gen_random_bytes(integer)` are available.
4. Treat Auth user rows, Storage configuration, extension installation, and
   application data as separate, explicitly reviewed scopes.
5. Dry-run the public-schema operation and resolve dependency ordering before any
   write.

This report does not authorize or perform any database change.
