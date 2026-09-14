-- Faisal sells VisaFlow subscriptions for the Platform Owner, not customer tenants.
-- Preserve existing tenant records in isolated legacy workspaces. No data is moved
-- into the platform pipeline, and no synthetic customer company is created.
create table public.sales_workspaces (
  id uuid primary key default gen_random_uuid(),
  scope text not null check(scope in ('platform','legacy_company')),
  legacy_company_id uuid unique references public.companies(id) on delete cascade,
  status text not null default 'Active' check(status in ('Active','Inactive')),
  check((scope='platform' and legacy_company_id is null) or (scope='legacy_company' and legacy_company_id is not null))
);
create unique index sales_one_platform_workspace on public.sales_workspaces(scope) where scope='platform';
insert into public.sales_workspaces(id,scope,legacy_company_id)
select company_id,'legacy_company',company_id from (
 select company_id from public.sales_leads union select company_id from public.sales_tasks
 union select company_id from public.sales_interactions union select company_id from public.sales_agent_runs
 union select company_id from public.sales_agent_approvals
) legacy;
insert into public.sales_workspaces(scope) values('platform');

do $$ declare t text; fk record; begin
 foreach t in array array['sales_leads','sales_tasks','sales_interactions','sales_agent_runs','sales_agent_approvals'] loop
  for fk in select conname from pg_constraint where conrelid=format('public.%I',t)::regclass and confrelid='public.companies'::regclass and contype='f' loop
   execute format('alter table public.%I drop constraint %I',t,fk.conname);
  end loop;
  execute format('alter table public.%I rename column company_id to workspace_id',t);
  execute format('alter table public.%I add foreign key(workspace_id) references public.sales_workspaces(id) on delete cascade',t);
 end loop;
end $$;

-- Parameter name retained for compatibility with the service RPC signature;
-- p_company now always identifies an explicit sales workspace, never a company.
create or replace function public.sales_can_access(p_company uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(public.current_sales_actor()->>'role'='Platform Owner'
   and public.current_sales_actor()->>'company_id' is null
   and exists(select 1 from public.sales_workspaces where id=p_company and scope='platform' and status='Active'),false)
$$;
alter table public.sales_workspaces enable row level security;
revoke all on public.sales_workspaces from public,anon,authenticated;
grant select on public.sales_workspaces to authenticated;
grant all on public.sales_workspaces to service_role;
create policy sales_workspace_read on public.sales_workspaces for select to authenticated using(public.sales_can_access(id));

create or replace function public.sales_enforce_dnc() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.do_not_contact and not new.do_not_contact then raise exception 'do_not_contact_cannot_be_cleared'; end if;
  if new.do_not_contact then
    new.next_follow_up_at := null;
    update public.sales_agent_approvals set status='cancelled', reason='Do not contact', decided_at=now(), decided_by='DNC_GUARD'
      where workspace_id=new.workspace_id and lead_id=new.id and status in ('pending','approved');
    update public.sales_tasks set status='cancelled' where workspace_id=new.workspace_id and lead_id=new.id and task_type='FOLLOW_UP' and status in ('open','in_progress');
  end if;
  return new;
end $$;

create or replace function public.sales_decide_approval(p_approval_id uuid,p_decision text,p_reason text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.sales_agent_approvals; actor jsonb; l public.sales_leads;
begin
  actor:=public.current_sales_actor();
  if p_decision not in ('approved','rejected') or p_decision is null then raise exception 'invalid_decision'; end if;
  select * into a from public.sales_agent_approvals where id=p_approval_id;
  if not found or not coalesce(public.sales_can_access(a.workspace_id),false) then raise exception 'forbidden'; end if;
  if actor->>'role' not in ('Admin','Company Admin','CEO','Platform Owner','Recruitment Manager') then raise exception 'forbidden'; end if;
  if a.approval_type not in ('SEND_OUTREACH','SEND_FOLLOW_UP') and actor->>'role' not in ('Admin','Company Admin','CEO','Platform Owner') then raise exception 'pricing_approval_forbidden'; end if;
  -- Same lock order as completion/unsubscribe to avoid a draft/approval race.
  select * into l from public.sales_leads where workspace_id=a.workspace_id and id=a.lead_id for update;
  select * into a from public.sales_agent_approvals where id=p_approval_id for update;
  if a.status <> 'pending' then raise exception 'approval_already_decided'; end if;
  if p_decision='approved' and (l.do_not_contact or l.status <> 'active') then raise exception 'lead_do_not_contact'; end if;
  update public.sales_agent_approvals set status=p_decision, reason=left(p_reason,2000), decided_at=now(), decided_by=actor->>'id' where id=a.id;
  return jsonb_build_object('id',a.id,'status',p_decision,'delivery_enabled',false);
end $$;

create or replace function public.sales_complete_run(p_company uuid,p_run uuid,p_result jsonb,p_model text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.sales_agent_runs; l public.sales_leads; approval_id uuid; interaction_id uuid; cls text; follow_days integer;
begin
  if not exists(select 1 from public.sales_workspaces where id=p_company and scope='platform' and status='Active') then raise exception 'forbidden'; end if;
  select * into r from public.sales_agent_runs where workspace_id=p_company and id=p_run for update;
  if not found then raise exception 'run_not_found'; end if;
  if r.status='completed' then return r.output; end if;
  if r.status <> 'running' then raise exception 'run_not_running'; end if;
  if r.lead_id is not null then
    select * into l from public.sales_leads where workspace_id=p_company and id=r.lead_id for update;
    if not found then raise exception 'lead_not_found'; end if;
  end if;
  if r.action='qualify_lead' then
    update public.sales_leads set lead_score=(p_result->>'score')::integer, lead_grade=p_result->>'grade',
      stage=case when do_not_contact then stage else p_result->>'recommended_stage' end,
      qualification_summary=p_result->>'fit_reason',updated_by='FAISAL_AI' where workspace_id=p_company and id=l.id;
  elsif r.action='draft_outreach' then
    if l.do_not_contact or l.status <> 'active' then raise exception 'lead_do_not_contact'; end if;
    if coalesce(l.contact_email,'')='' then raise exception 'valid_contact_email_required'; end if;
    if coalesce(p_result->>'subject','')='' or coalesce(p_result->>'body','')='' then raise exception 'invalid_draft'; end if;
    insert into public.sales_interactions(workspace_id,lead_id,direction,interaction_type,subject,body,classification,created_by)
      values(p_company,l.id,'internal','ai_draft',p_result->>'subject',p_result->>'body','PENDING_APPROVAL','FAISAL_AI') returning id into interaction_id;
    insert into public.sales_agent_approvals(workspace_id,lead_id,run_id,approval_type,payload)
      values(p_company,l.id,r.id,'SEND_OUTREACH',jsonb_build_object('to',l.contact_email,'subject',p_result->>'subject','body',p_result->>'body','interaction_id',interaction_id,'channel','email')) returning id into approval_id;
    p_result := p_result || jsonb_build_object('approval_id',approval_id,'status','pending','approval_required',true);
  elsif r.action='classify_reply' then
    cls:=p_result->>'classification';
    if cls not in ('INTERESTED','REQUEST_DEMO','REQUEST_PRICING','NEED_MORE_INFO','NOT_NOW','NOT_INTERESTED','WRONG_CONTACT','UNSUBSCRIBE','OUT_OF_OFFICE','REFERRAL') or cls is null then raise exception 'invalid_classification'; end if;
    follow_days:=(p_result->>'follow_up_days')::integer;
    insert into public.sales_interactions(workspace_id,lead_id,direction,interaction_type,body,classification,created_by)
      values(p_company,l.id,'inbound','email',r.input->>'reply_text',cls,r.actor_app_user_id);
    update public.sales_leads set do_not_contact=do_not_contact or cls='UNSUBSCRIBE',last_replied_at=now(),
      stage=case when do_not_contact or cls='UNSUBSCRIBE' then 'LOST' else 'REPLIED' end,
      next_follow_up_at=case when do_not_contact or cls='UNSUBSCRIBE' or follow_days is null then null else now()+make_interval(days=>greatest(0,least(365,follow_days))) end,
      updated_by='FAISAL_AI' where workspace_id=p_company and id=l.id;
    if cls <> 'UNSUBSCRIBE' and (cls='REQUEST_PRICING' or p_result->>'requires_ceo_approval'='true') then
      insert into public.sales_agent_approvals(workspace_id,lead_id,run_id,approval_type,payload)
        values(p_company,l.id,r.id,case when cls='REQUEST_PRICING' then 'PRICING' else 'CUSTOM_COMMITMENT' end,p_result) returning id into approval_id;
      p_result:=p_result||jsonb_build_object('approval_id',approval_id,'requires_ceo_approval',true);
    end if;
  end if;
  update public.sales_agent_runs set status='completed',model=p_model,output=p_result,completed_at=now() where workspace_id=p_company and id=p_run;
  return p_result;
end $$;

create or replace function public.sales_start_run(p_company uuid,p_lead uuid,p_action text,p_actor uuid,p_input jsonb,p_compliance boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor public.users; run_id uuid;
begin
 if (select count(*) from public.users where auth_user_id=p_actor) <> 1 then raise exception 'forbidden'; end if;
 select * into actor from public.users where auth_user_id=p_actor and status='Active' and is_active is true;
 if not found or actor.role <> 'Platform Owner' or actor.company_id is not null then raise exception 'forbidden'; end if;
 if p_action not in ('qualify_lead','draft_outreach','classify_reply','daily_brief') then raise exception 'invalid_action'; end if;
 if p_action <> 'daily_brief' and p_lead is null then raise exception 'lead_required'; end if;
 perform 1 from public.sales_workspaces where id=p_company and scope='platform' and status='Active' for update;
 if not found then raise exception 'workspace_not_found'; end if;
 if not p_compliance and (select count(*) from public.sales_agent_runs where workspace_id=p_company and created_at >= date_trunc('day',now())) >= 100 then raise exception 'rate_limit'; end if;
 insert into public.sales_agent_runs(workspace_id,lead_id,action,actor_auth_user_id,actor_app_user_id,input)
 values(p_company,p_lead,p_action,p_actor,actor.id::text,p_input) returning id into run_id;
 return run_id;
end $$;
-- CREATE OR REPLACE retains the original service-only function grants.
comment on table public.sales_workspaces is 'Platform-owned VisaFlow subscription sales. Legacy company records are preserved but inaccessible to browser users.';
comment on table public.sales_agent_approvals is 'Platform Owner decisions only. Draft-only: no sending, dispatch, subscription provisioning or billing.';
notify pgrst, 'reload schema';
