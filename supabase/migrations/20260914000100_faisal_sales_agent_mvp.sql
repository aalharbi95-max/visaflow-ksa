-- VisaFlow KSA — Faisal AI Sales Agent MVP
-- Created: 2026-09-14
-- Purpose:
--   1) Multi-tenant sales pipeline
--   2) AI run/audit history
--   3) Human approval gate before any outbound send
--   4) RLS for company users; service-role Edge Functions bypass RLS
--
-- IMPORTANT:
-- This migration does NOT enable autonomous email sending.
-- Drafts are stored as approvals with status='pending'.



create table if not exists public.sales_leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,

  company_name text not null,
  website text,
  industry text,
  source text not null default 'manual',

  contact_name text,
  contact_title text,
  contact_email text,
  contact_phone text,

  lead_score integer not null default 0 check (lead_score between 0 and 100),
  lead_grade text not null default 'D' check (lead_grade in ('A','B','C','D')),
  stage text not null default 'NEW' check (
    stage in (
      'NEW',
      'CONTACT_IDENTIFIED',
      'READY_TO_CONTACT',
      'CONTACTED',
      'FOLLOW_UP',
      'REPLIED',
      'QUALIFIED',
      'DEMO_BOOKED',
      'PROPOSAL_SENT',
      'NEGOTIATION',
      'WON',
      'LOST',
      'NOT_FIT'
    )
  ),
  status text not null default 'active' check (status in ('active','paused','closed')),

  do_not_contact boolean not null default false,
  last_contacted_at timestamptz,
  last_replied_at timestamptz,
  next_follow_up_at timestamptz,

  qualification_summary text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,

  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_leads_company_stage_idx
  on public.sales_leads(company_id, stage, updated_at desc);

create index if not exists sales_leads_company_followup_idx
  on public.sales_leads(company_id, next_follow_up_at)
  where status = 'active' and do_not_contact = false;

create index if not exists sales_leads_company_email_idx
  on public.sales_leads(company_id, lower(contact_email))
  where contact_email is not null;

create table if not exists public.sales_interactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid not null,

  direction text not null check (direction in ('inbound','outbound','internal')),
  interaction_type text not null check (
    interaction_type in (
      'email',
      'call',
      'meeting',
      'linkedin',
      'note',
      'ai_draft',
      'status_change'
    )
  ),
  subject text,
  body text,
  classification text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,

  occurred_at timestamptz not null default now(),
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists sales_interactions_lead_idx
  on public.sales_interactions(company_id, lead_id, occurred_at desc);

create table if not exists public.sales_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid,

  task_type text not null check (
    task_type in ('FOLLOW_UP','RESEARCH','CALL','DEMO','PROPOSAL','CEO_REVIEW','OTHER')
  ),
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open','in_progress','done','cancelled')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  due_at timestamptz,

  assigned_to text not null default 'FAISAL_AI',
  metadata jsonb not null default '{}'::jsonb,

  created_by text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_tasks_company_status_due_idx
  on public.sales_tasks(company_id, status, due_at);

create table if not exists public.sales_agent_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid,

  agent_name text not null default 'FAISAL',
  action text not null check (
    action in ('qualify_lead','draft_outreach','classify_reply','daily_brief')
  ),
  status text not null default 'running' check (status in ('running','completed','failed')),

  model text,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error_message text,

  actor_auth_user_id uuid,
  actor_app_user_id text,

  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists sales_agent_runs_company_created_idx
  on public.sales_agent_runs(company_id, created_at desc);

create table if not exists public.sales_agent_approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid,
  run_id uuid,

  approval_type text not null check (
    approval_type in (
      'SEND_OUTREACH',
      'SEND_FOLLOW_UP',
      'PRICING',
      'DISCOUNT',
      'PROPOSAL',
      'CONTRACT',
      'CUSTOM_COMMITMENT'
    )
  ),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  payload jsonb not null default '{}'::jsonb,
  reason text,

  requested_by text not null default 'FAISAL_AI',
  decided_by text,
  decided_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_agent_approvals_company_status_idx
  on public.sales_agent_approvals(company_id, status, created_at desc);

create or replace function public.touch_sales_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_sales_leads_touch on public.sales_leads;
create trigger trg_sales_leads_touch
before update on public.sales_leads
for each row execute function public.touch_sales_updated_at();

drop trigger if exists trg_sales_tasks_touch on public.sales_tasks;
create trigger trg_sales_tasks_touch
before update on public.sales_tasks
for each row execute function public.touch_sales_updated_at();

drop trigger if exists trg_sales_agent_approvals_touch on public.sales_agent_approvals;
create trigger trg_sales_agent_approvals_touch
before update on public.sales_agent_approvals
for each row execute function public.touch_sales_updated_at();


-- All child relationships carry the tenant, including service-role writes.
alter table public.sales_leads add constraint sales_leads_tenant_key unique(company_id, id);
alter table public.sales_agent_runs add constraint sales_runs_tenant_key unique(company_id, id);
alter table public.sales_agent_runs add constraint sales_runs_lead_key unique(company_id, lead_id, id);
alter table public.sales_interactions add foreign key(company_id, lead_id) references public.sales_leads(company_id, id);
alter table public.sales_tasks add foreign key(company_id, lead_id) references public.sales_leads(company_id, id);
alter table public.sales_agent_runs add foreign key(company_id, lead_id) references public.sales_leads(company_id, id);
alter table public.sales_agent_approvals add foreign key(company_id, lead_id) references public.sales_leads(company_id, id);
alter table public.sales_agent_approvals add foreign key(company_id, run_id) references public.sales_agent_runs(company_id, id);
alter table public.sales_agent_approvals add foreign key(company_id, lead_id, run_id) references public.sales_agent_runs(company_id, lead_id, id);
alter table public.sales_agent_approvals add unique(run_id, approval_type);
alter table public.sales_interactions add constraint sales_mvp_no_outbound check(direction <> 'outbound');
alter table public.sales_leads add constraint sales_company_name_present check(length(trim(company_name)) between 1 and 300);

create function public.current_sales_actor() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor jsonb;
begin
  if auth.uid() is null or (select count(*) from public.users where auth_user_id = auth.uid()) <> 1 then return null; end if;
  select jsonb_build_object('id',u.id,'role',u.role,'company_id',u.company_id) into actor
  from public.users u where u.auth_user_id = auth.uid() and u.status = 'Active' and u.is_active is true;
  return actor;
end $$;

create function public.sales_can_access(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.companies c where c.id=p_company and c.status='Active') and (
    (public.current_sales_actor()->>'company_id'=p_company::text and public.current_sales_actor()->>'role' in ('Admin','Company Admin','CEO','Recruitment Manager','Recruitment Officer'))
    or (public.current_sales_actor()->>'role'='Platform Owner' and public.current_sales_actor()->>'company_id' is null)
  )
$$;

do $$ declare t text; begin
  foreach t in array array['sales_leads','sales_tasks','sales_interactions','sales_agent_runs','sales_agent_approvals'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('create policy sales_read on public.%I for select to authenticated using (public.sales_can_access(company_id))',t);
  end loop;
end $$;

grant insert(company_id,company_name,website,industry,source,contact_name,contact_title,contact_email,contact_phone,notes) on public.sales_leads to authenticated;
grant update(company_name,website,industry,contact_name,contact_title,contact_phone,notes,status,do_not_contact) on public.sales_leads to authenticated;
create policy sales_lead_insert on public.sales_leads for insert to authenticated with check(public.sales_can_access(company_id) and public.current_sales_actor()->>'role' <> 'CEO');
create policy sales_lead_update on public.sales_leads for update to authenticated using(public.sales_can_access(company_id) and public.current_sales_actor()->>'role' <> 'CEO') with check(public.sales_can_access(company_id));
grant insert(company_id,lead_id,task_type,title,description,priority,due_at), update(status,description,priority,due_at) on public.sales_tasks to authenticated;
create policy sales_task_insert on public.sales_tasks for insert to authenticated with check(public.sales_can_access(company_id) and public.current_sales_actor()->>'role' <> 'CEO');
create policy sales_task_update on public.sales_tasks for update to authenticated using(public.sales_can_access(company_id) and public.current_sales_actor()->>'role' <> 'CEO') with check(public.sales_can_access(company_id));

-- DNC is monotonic in the MVP. Re-consent requires a separately reviewed future workflow.
create function public.sales_enforce_dnc() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.do_not_contact and not new.do_not_contact then raise exception 'do_not_contact_cannot_be_cleared'; end if;
  if new.do_not_contact then
    new.next_follow_up_at := null;
    update public.sales_agent_approvals set status='cancelled', reason='Do not contact', decided_at=now(), decided_by='DNC_GUARD'
      where company_id=new.company_id and lead_id=new.id and status in ('pending','approved');
    update public.sales_tasks set status='cancelled' where company_id=new.company_id and lead_id=new.id and task_type='FOLLOW_UP' and status in ('open','in_progress');
  end if;
  return new;
end $$;
create trigger sales_dnc_guard before update on public.sales_leads for each row execute function public.sales_enforce_dnc();

-- Only this RPC can record a browser approval. Payload and requester are immutable.
create function public.sales_decide_approval(p_approval_id uuid,p_decision text,p_reason text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.sales_agent_approvals; actor jsonb; l public.sales_leads;
begin
  actor:=public.current_sales_actor();
  if p_decision not in ('approved','rejected') or p_decision is null then raise exception 'invalid_decision'; end if;
  select * into a from public.sales_agent_approvals where id=p_approval_id;
  if not found or not coalesce(public.sales_can_access(a.company_id),false) then raise exception 'forbidden'; end if;
  if actor->>'role' not in ('Admin','Company Admin','CEO','Platform Owner','Recruitment Manager') then raise exception 'forbidden'; end if;
  if a.approval_type not in ('SEND_OUTREACH','SEND_FOLLOW_UP') and actor->>'role' not in ('Admin','Company Admin','CEO','Platform Owner') then raise exception 'pricing_approval_forbidden'; end if;
  -- Same lock order as completion/unsubscribe to avoid a draft/approval race.
  select * into l from public.sales_leads where company_id=a.company_id and id=a.lead_id for update;
  select * into a from public.sales_agent_approvals where id=p_approval_id for update;
  if a.status <> 'pending' then raise exception 'approval_already_decided'; end if;
  if p_decision='approved' and (l.do_not_contact or l.status <> 'active') then raise exception 'lead_do_not_contact'; end if;
  update public.sales_agent_approvals set status=p_decision, reason=left(p_reason,2000), decided_at=now(), decided_by=actor->>'id' where id=a.id;
  return jsonb_build_object('id',a.id,'status',p_decision,'delivery_enabled',false);
end $$;

-- Atomic persistence: a failed operation leaves no orphan draft/approval or partial unsubscribe.
-- Edge service role only; never callable by browsers, anon, or PUBLIC.
create function public.sales_complete_run(p_company uuid,p_run uuid,p_result jsonb,p_model text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.sales_agent_runs; l public.sales_leads; approval_id uuid; interaction_id uuid; cls text; follow_days integer;
begin
  select * into r from public.sales_agent_runs where company_id=p_company and id=p_run for update;
  if not found then raise exception 'run_not_found'; end if;
  if r.status='completed' then return r.output; end if;
  if r.status <> 'running' then raise exception 'run_not_running'; end if;
  if r.lead_id is not null then
    select * into l from public.sales_leads where company_id=p_company and id=r.lead_id for update;
    if not found then raise exception 'lead_not_found'; end if;
  end if;
  if r.action='qualify_lead' then
    update public.sales_leads set lead_score=(p_result->>'score')::integer, lead_grade=p_result->>'grade',
      stage=case when do_not_contact then stage else p_result->>'recommended_stage' end,
      qualification_summary=p_result->>'fit_reason',updated_by='FAISAL_AI' where company_id=p_company and id=l.id;
  elsif r.action='draft_outreach' then
    if l.do_not_contact or l.status <> 'active' then raise exception 'lead_do_not_contact'; end if;
    if coalesce(l.contact_email,'')='' then raise exception 'valid_contact_email_required'; end if;
    if coalesce(p_result->>'subject','')='' or coalesce(p_result->>'body','')='' then raise exception 'invalid_draft'; end if;
    insert into public.sales_interactions(company_id,lead_id,direction,interaction_type,subject,body,classification,created_by)
      values(p_company,l.id,'internal','ai_draft',p_result->>'subject',p_result->>'body','PENDING_APPROVAL','FAISAL_AI') returning id into interaction_id;
    insert into public.sales_agent_approvals(company_id,lead_id,run_id,approval_type,payload)
      values(p_company,l.id,r.id,'SEND_OUTREACH',jsonb_build_object('to',l.contact_email,'subject',p_result->>'subject','body',p_result->>'body','interaction_id',interaction_id,'channel','email')) returning id into approval_id;
    p_result := p_result || jsonb_build_object('approval_id',approval_id,'status','pending','approval_required',true);
  elsif r.action='classify_reply' then
    cls:=p_result->>'classification';
    if cls not in ('INTERESTED','REQUEST_DEMO','REQUEST_PRICING','NEED_MORE_INFO','NOT_NOW','NOT_INTERESTED','WRONG_CONTACT','UNSUBSCRIBE','OUT_OF_OFFICE','REFERRAL') or cls is null then raise exception 'invalid_classification'; end if;
    follow_days:=(p_result->>'follow_up_days')::integer;
    insert into public.sales_interactions(company_id,lead_id,direction,interaction_type,body,classification,created_by)
      values(p_company,l.id,'inbound','email',r.input->>'reply_text',cls,r.actor_app_user_id);
    update public.sales_leads set do_not_contact=do_not_contact or cls='UNSUBSCRIBE',last_replied_at=now(),
      stage=case when do_not_contact or cls='UNSUBSCRIBE' then 'LOST' else 'REPLIED' end,
      next_follow_up_at=case when do_not_contact or cls='UNSUBSCRIBE' or follow_days is null then null else now()+make_interval(days=>greatest(0,least(365,follow_days))) end,
      updated_by='FAISAL_AI' where company_id=p_company and id=l.id;
    if cls <> 'UNSUBSCRIBE' and (cls='REQUEST_PRICING' or p_result->>'requires_ceo_approval'='true') then
      insert into public.sales_agent_approvals(company_id,lead_id,run_id,approval_type,payload)
        values(p_company,l.id,r.id,case when cls='REQUEST_PRICING' then 'PRICING' else 'CUSTOM_COMMITMENT' end,p_result) returning id into approval_id;
      p_result:=p_result||jsonb_build_object('approval_id',approval_id,'requires_ceo_approval',true);
    end if;
  end if;
  update public.sales_agent_runs set status='completed',model=p_model,output=p_result,completed_at=now() where company_id=p_company and id=p_run;
  return p_result;
end $$;

revoke all on function public.current_sales_actor(), public.sales_can_access(uuid), public.sales_decide_approval(uuid,text,text), public.sales_complete_run(uuid,uuid,jsonb,text), public.sales_enforce_dnc(), public.touch_sales_updated_at() from public, anon, authenticated;
grant execute on function public.current_sales_actor(), public.sales_can_access(uuid), public.sales_decide_approval(uuid,text,text) to authenticated;
grant execute on function public.sales_complete_run(uuid,uuid,jsonb,text) to service_role;
comment on table public.sales_agent_approvals is 'Draft-only MVP. Approval records a human decision; no email dispatch or scheduling exists.';

create function public.sales_start_run(p_company uuid,p_lead uuid,p_action text,p_actor uuid,p_input jsonb,p_compliance boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor public.users; run_id uuid;
begin
  if (select count(*) from public.users where auth_user_id=p_actor) <> 1 then raise exception 'forbidden'; end if;
  select * into actor from public.users where auth_user_id=p_actor and status='Active' and is_active is true;
  if not found then raise exception 'forbidden'; end if;
  if not coalesce(((actor.company_id=p_company and actor.role in ('Admin','Company Admin','CEO','Recruitment Manager','Recruitment Officer')) or (actor.company_id is null and actor.role='Platform Owner')),false) then raise exception 'forbidden'; end if;
  if actor.role='CEO' and p_action <> 'daily_brief' then raise exception 'forbidden'; end if;
  if p_action <> 'daily_brief' and p_lead is null then raise exception 'lead_required'; end if;
  perform 1 from public.companies where id=p_company and status='Active' for update;
  if not found then raise exception 'company_not_found'; end if;
  -- Compliance processing remains available when the AI daily budget is exhausted.
  if not p_compliance and (select count(*) from public.sales_agent_runs where company_id=p_company and created_at >= date_trunc('day',now())) >= 100 then raise exception 'rate_limit'; end if;
  insert into public.sales_agent_runs(company_id,lead_id,action,actor_auth_user_id,actor_app_user_id,input)
    values(p_company,p_lead,p_action,p_actor,actor.id::text,p_input) returning id into run_id;
  return run_id;
end $$;
revoke all on function public.sales_start_run(uuid,uuid,text,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.sales_start_run(uuid,uuid,text,uuid,jsonb,boolean) to service_role;
