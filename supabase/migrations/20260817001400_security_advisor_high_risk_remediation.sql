-- Close high-impact Security Advisor findings without widening application access.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter view public.ai_agent_hourly_activity set (security_invoker = true);
revoke all on public.ai_agent_hourly_activity from public, anon, authenticated;
grant select on public.ai_agent_hourly_activity to service_role;

-- Emergency stop and queue lifecycle RPCs are internal worker operations.
revoke all on function public.ai_agent_emergency_stop(uuid) from public, anon, authenticated;
grant execute on function public.ai_agent_emergency_stop(uuid) to service_role;
revoke all on function public.claim_ai_interview_invitation_jobs(integer,text) from public, anon, authenticated;
grant execute on function public.claim_ai_interview_invitation_jobs(integer,text) to service_role;
revoke all on function public.complete_ai_interview_invitation_job(uuid,text,text) from public, anon, authenticated;
grant execute on function public.complete_ai_interview_invitation_job(uuid,text,text) to service_role;
revoke all on function public.fail_ai_interview_invitation_job(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.fail_ai_interview_invitation_job(uuid,text,integer) to service_role;
revoke all on function public.sync_ai_agent_professional_settings() from public, anon, authenticated;
grant execute on function public.sync_ai_agent_professional_settings() to service_role;

-- These SECURITY DEFINER RPCs are signed-in workspace operations, never public APIs.
revoke all on function public.add_candidates_to_ai_interview_campaign(uuid,text[]) from public, anon;
grant execute on function public.add_candidates_to_ai_interview_campaign(uuid,text[]) to authenticated, service_role;
revoke all on function public.ai_interview_delivery_preflight() from public, anon;
grant execute on function public.ai_interview_delivery_preflight() to authenticated, service_role;
revoke all on function public.create_ai_interview_template_version(uuid,text) from public, anon;
grant execute on function public.create_ai_interview_template_version(uuid,text) to authenticated, service_role;
revoke all on function public.get_ai_interview_invitation_queue_summary(uuid) from public, anon;
grant execute on function public.get_ai_interview_invitation_queue_summary(uuid) to authenticated, service_role;
revoke all on function public.launch_ai_interview_campaign(uuid,text) from public, anon;
grant execute on function public.launch_ai_interview_campaign(uuid,text) to authenticated, service_role;
revoke all on function public.list_manageable_app_users() from public, anon;
grant execute on function public.list_manageable_app_users() to authenticated, service_role;
revoke all on function public.publish_ai_interview_template_version(uuid) from public, anon;
grant execute on function public.publish_ai_interview_template_version(uuid) to authenticated, service_role;
revoke all on function public.remove_candidates_from_ai_interview_campaign(uuid,uuid[]) from public, anon;
grant execute on function public.remove_candidates_from_ai_interview_campaign(uuid,uuid[]) to authenticated, service_role;
revoke all on function public.revalidate_ai_interview_campaign_candidates(uuid) from public, anon;
grant execute on function public.revalidate_ai_interview_campaign_candidates(uuid) to authenticated, service_role;
revoke all on function public.review_marketing_company_request(uuid,text,numeric,uuid,text) from public, anon;
grant execute on function public.review_marketing_company_request(uuid,text,numeric,uuid,text) to authenticated, service_role;

commit;
