-- Release blocker fix: atomic manager escalation and an explicit safe terminal
-- state for approved YELLOW proposals that have no supported executor.

alter table public.ai_agent_cases drop constraint if exists ai_agent_cases_status_check;
alter table public.ai_agent_cases add constraint ai_agent_cases_status_check
check (status in (
  'open','in_progress','awaiting_external_response','awaiting_human_approval',
  'approved_awaiting_supported_execution','blocked','failed','closed'
));

alter table public.ai_agent_runs drop constraint if exists ai_agent_runs_status_check;
alter table public.ai_agent_runs add constraint ai_agent_runs_status_check
check (status in (
  'in_progress','completed','awaiting_external_response','awaiting_human_approval',
  'approved_awaiting_supported_execution','blocked','failed'
));

alter table public.ai_agent_runs drop constraint if exists ai_agent_runs_termination_check;
alter table public.ai_agent_runs add constraint ai_agent_runs_termination_check
check (termination_reason is null or termination_reason in (
  'completed','awaiting_external_response','awaiting_human_approval',
  'approved_awaiting_supported_execution','blocked','failed','max_steps_reached'
));

create or replace function public.ai_agent_create_manager_escalation(
  p_company_id uuid,
  p_request_id bigint,
  p_case_id uuid,
  p_run_id uuid,
  p_request_no text,
  p_title text,
  p_message text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request_no text;
  v_action_key text;
  v_event public.notification_events%rowtype;
  v_created boolean := false;
begin
  if auth.uid() is not null and (
    public.current_app_user_company_id() is distinct from p_company_id
    or not public.current_app_user_has_role(array['Admin','Company Admin','Recruitment Manager','Recruitment Officer'])
  ) then
    raise exception 'AI_AGENT_TENANT_OR_ROLE_DENIED' using errcode = '42501';
  end if;

  select r.request_no into v_request_no
  from public.requests r
  where r.id = p_request_id and r.company_id = p_company_id;
  if v_request_no is null or v_request_no is distinct from nullif(trim(p_request_no), '') then
    raise exception 'AI_AGENT_REQUEST_TENANT_MISMATCH' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.ai_agent_cases c
    where c.id = p_case_id and c.company_id = p_company_id
      and c.target_type = 'request' and c.target_id = p_request_id::text
  ) then
    raise exception 'AI_AGENT_CASE_TENANT_MISMATCH' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.ai_agent_runs r
    where r.id = p_run_id and r.company_id = p_company_id and r.case_id = p_case_id
  ) then
    raise exception 'AI_AGENT_RUN_TENANT_MISMATCH' using errcode = '42501';
  end if;

  v_action_key := p_company_id::text || ':' || p_request_id::text
    || ':manager_escalation:' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD');

  insert into public.notification_events(
    company_id,type,title,message,priority,status,related_table,related_id,
    request_no,dedupe_key,data
  ) values (
    p_company_id,'AI_AGENT_OPERATIONAL_ESCALATION',left(coalesce(p_title,''),500),
    left(coalesce(p_message,''),4000),'High','Unread','requests',p_request_id::text,
    v_request_no,v_action_key,
    jsonb_build_object(
      'source','VisaFlow Agent Orchestrator','case_id',p_case_id,'run_id',p_run_id,
      'non_financial',true
    )
  )
  on conflict (company_id,dedupe_key) where dedupe_key is not null do nothing
  returning * into v_event;

  if v_event.id is not null then
    v_created := true;
  else
    select * into v_event
    from public.notification_events e
    where e.company_id = p_company_id and e.dedupe_key = v_action_key
      and e.type = 'AI_AGENT_OPERATIONAL_ESCALATION'
    limit 1;
  end if;

  if v_event.id is null then
    raise exception 'AI_AGENT_ESCALATION_ATOMIC_STATE_UNAVAILABLE';
  end if;

  return jsonb_build_object(
    'ok',true,
    'created',v_created,
    'skipped',not v_created,
    'reason',case when v_created then 'created' else 'cooldown_or_duplicate' end,
    'action_key',v_action_key,
    'event',jsonb_build_object(
      'id',v_event.id,'company_id',v_event.company_id,'type',v_event.type,
      'dedupe_key',v_event.dedupe_key
    )
  );
end;
$function$;

revoke all on function public.ai_agent_create_manager_escalation(uuid,bigint,uuid,uuid,text,text,text)
from public, anon, authenticated;
grant execute on function public.ai_agent_create_manager_escalation(uuid,bigint,uuid,uuid,text,text,text)
to service_role;

comment on function public.ai_agent_create_manager_escalation(uuid,bigint,uuid,uuid,text,text,text)
is 'Atomically creates or reuses one tenant-owned daily manager escalation. Duplicate/replay returns cooldown_or_duplicate.';
