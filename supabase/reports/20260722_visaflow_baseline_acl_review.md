# VisaFlow baseline ACL security review

Read-only comparison. No database changes were applied.

## Dump integrity

- Schema-only: yes
- Data sections / COPY / top-level INSERT: 0
- Connection strings, project references, JWTs, secret keys: 0
- Ownership commands: 0
- Production ACL statements: 451 GRANT and 28 REVOKE
- Production and Staging public-schema default privileges: equivalent for postgres/supabase_admin and anon/authenticated/service_role

## No-RLS table classification

Production currently grants anon access to 45 of the 46 tables that lack RLS. Only `users` is already ACL-protected from anon/authenticated.

### Must enable tenant-aware RLS (32)

- `agency_agreements`
- `agency_client_access`
- `agency_company_user_access`
- `agency_members`
- `agency_penalties`
- `agency_scores`
- `ai_interview_answers`
- `ai_interview_questions`
- `ai_interview_sessions`
- `candidate_technical_profiles`
- `candidates`
- `collections`
- `company_agency_access`
- `company_agency_users`
- `company_email_settings`
- `demobilizations`
- `employees`
- `interviews`
- `invoice_items`
- `invoices`
- `local_content_project_targets`
- `marketplace_deal_workers`
- `marketplace_deals`
- `marketplace_requests`
- `mobilizations`
- `onboarding_validations`
- `request_lines`
- `requests`
- `visa_allocations`
- `visa_authorizations`
- `visa_batch_lines`
- `visa_batches`

### Internal, ACL-only candidates (6)

- `users`
- `ai_agent_action_locks`
- `ai_agent_jobs`
- `ai_agent_worker_runs`
- `ai_interview_generation_runs`
- `platform_clients`

### Product/security decision required (8)

- `ai_agent_settings`
- `ai_interview_templates`
- `companies`
- `education_institutions`
- `email_templates`
- `local_content_settings`
- `profession_aliases`
- `subscription_invoices`

The local proposal is fail-closed: the 40 non-internal tables receive RLS plus an explicit deny policy until reviewed tenant policies replace it.

## SECURITY DEFINER execution in Production

| Function | PUBLIC | anon | authenticated | service_role |
|---|---:|---:|---:|---:|
| `add_candidates_to_ai_interview_campaign` | No | No | Yes | Yes |
| `ai_agent_emergency_stop` | Yes | Yes | Yes | Yes |
| `ai_agent_release_lock` | Yes | Yes | Yes | Yes |
| `ai_agent_try_acquire_lock` | Yes | Yes | Yes | Yes |
| `ai_interview_campaign_candidate_sync_session_trigger` | Yes | Yes | Yes | Yes |
| `ai_interview_campaign_sync_delivery_to_sessions_trigger` | Yes | Yes | Yes | Yes |
| `ai_interview_delivery_preflight` | No | Yes | Yes | Yes |
| `ai_interview_enforce_campaign_delivery_on_session` | Yes | Yes | Yes | Yes |
| `ai_interview_sync_linked_session_delivery` | Yes | Yes | Yes | Yes |
| `assign_request_no_before_insert` | Yes | Yes | Yes | Yes |
| `claim_ai_interview_analysis_job` | No | Yes | Yes | Yes |
| `claim_ai_interview_invitation_jobs` | No | No | No | Yes |
| `complete_ai_interview_analysis_job` | No | Yes | Yes | Yes |
| `complete_ai_interview_invitation_job` | No | No | No | Yes |
| `create_ai_interview_template_version` | Yes | Yes | Yes | Yes |
| `current_app_agency_id` | Yes | Yes | Yes | Yes |
| `current_app_company_id` | Yes | Yes | Yes | Yes |
| `current_app_role` | Yes | Yes | Yes | Yes |
| `current_app_user_agency_id` | Yes | Yes | Yes | Yes |
| `current_app_user_company_id` | Yes | Yes | Yes | Yes |
| `current_app_user_has_role` | Yes | Yes | Yes | Yes |
| `current_app_user_id` | Yes | Yes | Yes | Yes |
| `current_app_user_role` | Yes | Yes | Yes | Yes |
| `current_log_actor` | No | No | Yes | Yes |
| `enqueue_ai_interview_analysis_on_completion` | No | Yes | Yes | Yes |
| `fail_ai_interview_analysis_job` | No | Yes | Yes | Yes |
| `fail_ai_interview_invitation_job` | No | No | No | Yes |
| `get_ai_interview_invitation_queue_summary` | No | No | Yes | Yes |
| `get_authenticated_app_user` | No | No | Yes | Yes |
| `get_owner_talent_dashboard` | No | No | Yes | Yes |
| `get_talent_public_stats` | No | Yes | Yes | Yes |
| `guard_agency_company_user_access` | Yes | Yes | Yes | Yes |
| `guard_company_agency_access` | Yes | Yes | Yes | Yes |
| `guard_platform_user_roles` | Yes | Yes | Yes | Yes |
| `guard_users_security` | Yes | Yes | Yes | Yes |
| `handle_new_talent_candidate` | No | No | No | Yes |
| `is_agency_user` | Yes | Yes | Yes | Yes |
| `is_company_user` | Yes | Yes | Yes | Yes |
| `is_current_platform_user` | Yes | Yes | Yes | Yes |
| `is_platform_user` | Yes | Yes | Yes | Yes |
| `launch_ai_interview_campaign` | No | No | Yes | Yes |
| `legacy_app_login` | No | Yes | Yes | Yes |
| `list_manageable_app_users` | No | No | Yes | Yes |
| `log_system_activity` | Yes | Yes | Yes | Yes |
| `next_request_no` | Yes | Yes | Yes | Yes |
| `publish_ai_interview_template_version` | Yes | Yes | Yes | Yes |
| `queue_ai_interview_analysis` | No | Yes | Yes | Yes |
| `refresh_ai_interview_campaign_counts` | Yes | Yes | Yes | Yes |
| `remove_candidates_from_ai_interview_campaign` | No | No | Yes | Yes |
| `revalidate_ai_interview_campaign_candidates` | No | No | Yes | Yes |
| `sync_ai_interview_session_to_campaign` | Yes | Yes | Yes | Yes |
| `talent_after_candidate_profile_change` | No | No | No | Yes |
| `talent_after_profile_change` | No | No | No | Yes |
| `talent_calculate_profile_completeness` | No | No | No | Yes |
| `talent_guard_managed_fields` | No | No | No | Yes |
| `talent_is_privileged_actor` | No | No | No | Yes |
| `talent_refresh_profile_completeness` | No | No | No | Yes |
| `trg_refresh_ai_interview_campaign_counts` | Yes | Yes | Yes | Yes |

Local hardening revokes PUBLIC/anon/authenticated from every SECURITY DEFINER function, grants service_role, then restores only a reviewed browser allowlist. This is intentionally stricter than Production.

## Storage buckets

| Bucket | Public | Limit | MIME types |
|---|---:|---:|---|
| `ai-interview-audio` | false | 50 MiB | unrestricted |
| `talent-cv` | false | 10 MiB | PDF, DOC, DOCX |
| `talent-resume-versions` | false | 10 MiB | PDF, DOCX, HTML |

Bucket metadata is separated from Storage policies. Metadata migration sorts before the policy migration. No files or Storage object rows are included.

## Proposed application order

1. Backup and preflight on Staging.
2. `20260717000000_visaflow_schema_baseline.sql`.
3. `20260717000050_visaflow_storage_buckets.sql`.
4. `20260717000060_visaflow_storage_policies.sql` only after approving anon AI-audio access.
5. Existing repository migrations in chronological order.
6. Agency invitation migration from its PR only after the baseline sequence passes.
7. pgTAP, concurrency, tenant isolation, invitation, login, recovery, and Storage tests.

## Rollback

- Preferred rollback: restore the Staging snapshot taken immediately before migration application.
- Do not run destructive reverse SQL on Production.
- If only Storage policies fail, remove only policies created by the proposed policy migration; retain bucket metadata unless all three buckets are empty and deletion is explicitly approved.
- If ACL/RLS validation fails, stop traffic to Staging and restore its snapshot rather than guessing grants.

## Decision

FAIL until tenant-aware policies replace fail-closed placeholders and anon access to AI interview audio is explicitly approved or redesigned.
