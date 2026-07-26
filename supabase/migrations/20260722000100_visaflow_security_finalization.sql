-- Final deny layer. This migration intentionally sorts after the historical
-- 20260719 compatibility migrations so later legacy grants cannot reopen the
-- browser attack surface.

revoke all on table public.users from public, anon, authenticated;
revoke all on table public.companies from public, anon, authenticated;
revoke all on table public.company_email_settings from public, anon, authenticated;

revoke execute on function public.legacy_app_login(text, text) from public, anon, authenticated;
revoke execute on function public.ai_agent_try_acquire_lock(uuid, text, text, text, text, uuid, integer) from public, anon, authenticated;
revoke execute on function public.ai_agent_release_lock(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.claim_ai_interview_invitation_jobs(integer, text) from public, anon, authenticated;
revoke execute on function public.complete_ai_interview_invitation_job(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.fail_ai_interview_invitation_job(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.issue_secure_ai_interview_invitation(uuid, text) from public, anon, authenticated;
revoke execute on function public.confirm_ai_interview_media_upload(uuid) from public, anon, authenticated;
revoke execute on function public.cleanup_ai_interview_portal_security_records(integer) from public, anon, authenticated;
revoke execute on function public.consume_workspace_upgrade_rate_limit(text) from public, anon, authenticated;

revoke execute on function public.create_ai_interview_template_version(uuid, text) from public, anon, authenticated;
revoke execute on function public.add_candidates_to_ai_interview_campaign(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.remove_candidates_from_ai_interview_campaign(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.revalidate_ai_interview_campaign_candidates(uuid) from public, anon, authenticated;
revoke execute on function public.launch_ai_interview_campaign(uuid, text) from public, anon, authenticated;

grant execute on function public.ai_agent_try_acquire_lock(uuid, text, text, text, text, uuid, integer) to service_role;
grant execute on function public.ai_agent_release_lock(uuid, text, text, text) to service_role;
grant execute on function public.claim_ai_interview_invitation_jobs(integer, text) to service_role;
grant execute on function public.complete_ai_interview_invitation_job(uuid, text, text) to service_role;
grant execute on function public.fail_ai_interview_invitation_job(uuid, text, integer) to service_role;
grant execute on function public.issue_secure_ai_interview_invitation(uuid, text) to service_role;
grant execute on function public.confirm_ai_interview_media_upload(uuid) to service_role;
grant execute on function public.cleanup_ai_interview_portal_security_records(integer) to service_role;
grant execute on function public.consume_workspace_upgrade_rate_limit(text) to service_role;

-- Explicit browser allowlist: only self-scoped/tenant-checked wrappers.
grant execute on function public.get_authenticated_workspace_context() to authenticated;
grant execute on function public.list_authenticated_agency_workspaces() to authenticated;
grant execute on function public.get_authenticated_agency_workspace(uuid) to authenticated;
grant execute on function public.list_authorized_companies() to authenticated;
grant execute on function public.update_authorized_company(uuid, jsonb) to authenticated;
grant execute on function public.list_authorized_ai_interview_sessions() to authenticated;
grant execute on function public.list_authorized_ai_interview_invitation_jobs() to authenticated;

do $assert_final_denies$
begin
  if has_function_privilege('anon', 'public.legacy_app_login(text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.legacy_app_login(text,text)', 'EXECUTE') then
    raise exception 'legacy_app_login remained browser executable';
  end if;
  if has_table_privilege('authenticated', 'public.users', 'SELECT')
     or has_table_privilege('authenticated', 'public.companies', 'SELECT')
     or has_table_privilege('authenticated', 'public.company_email_settings', 'SELECT') then
    raise exception 'raw sensitive table access remained browser executable';
  end if;
end
$assert_final_denies$;
