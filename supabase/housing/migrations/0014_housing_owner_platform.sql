-- Apply ONLY to the dedicated Housing Supabase project after 0013.

alter table public.housing_companies
  add column if not exists subscription_plan text not null default 'Standard',
  add column if not exists subscription_status text not null default 'Active',
  add column if not exists subscription_start date,
  add column if not exists subscription_end date,
  add column if not exists users_limit integer not null default 10,
  add column if not exists sites_limit integer not null default 10,
  add column if not exists monthly_amount numeric(12,2) not null default 0,
  add column if not exists primary_admin_name text,
  add column if not exists primary_admin_email text;

create table if not exists public.housing_platform_owners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  email text not null unique,
  full_name text not null,
  status text not null default 'Active' check(status in ('Active','Inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.housing_platform_owners(email,full_name,status)
values('aalharbi95@gmail.com','Adel Alharbi','Active')
on conflict(email) do nothing;

create table if not exists public.housing_subscription_requests (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  admin_name text not null,
  email text not null,
  phone text,
  requested_plan text not null default 'Standard' check(requested_plan in ('Starter','Standard','Enterprise')),
  expected_users integer not null default 5 check(expected_users between 1 and 10000),
  expected_sites integer not null default 1 check(expected_sites between 1 and 10000),
  notes text,
  status text not null default 'Pending' check(status in ('Pending','Approved','Rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  company_id uuid references public.housing_companies(id) on delete set null,
  invitation_id uuid references public.housing_user_invitations(id) on delete set null,
  accepted_terms_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists housing_subscription_pending_email_uidx
on public.housing_subscription_requests(lower(email)) where status='Pending';
create index if not exists housing_subscription_requests_status_idx
on public.housing_subscription_requests(status,created_at desc);

create or replace function public.housing_is_platform_owner() returns boolean
language sql stable security definer set search_path=public,auth as $$
  select exists(
    select 1 from public.housing_platform_owners owner_row
    join auth.users auth_user on auth_user.id=auth.uid()
    where owner_row.status='Active'
      and (owner_row.user_id=auth.uid() or lower(owner_row.email)=lower(auth_user.email))
  )
$$;

create or replace function public.housing_submit_subscription_request(
  p_company_name text,
  p_admin_name text,
  p_email text,
  p_phone text default null,
  p_requested_plan text default 'Standard',
  p_expected_users integer default 5,
  p_expected_sites integer default 1,
  p_notes text default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_request public.housing_subscription_requests%rowtype; v_email text:=lower(trim(p_email));
begin
  if length(trim(coalesce(p_company_name,'')))<2 or length(trim(coalesce(p_admin_name,'')))<2 then
    raise exception 'Company and administrator names are required.';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'A valid business email is required.'; end if;
  if p_requested_plan not in ('Starter','Standard','Enterprise') then raise exception 'Unsupported plan.'; end if;
  if exists(select 1 from public.housing_subscription_requests where lower(email)=v_email and status in ('Pending','Approved')) then
    raise exception 'A housing subscription request already exists for this email.';
  end if;
  insert into public.housing_subscription_requests(company_name,admin_name,email,phone,requested_plan,expected_users,expected_sites,notes)
  values(trim(p_company_name),trim(p_admin_name),v_email,nullif(trim(coalesce(p_phone,'')),''),p_requested_plan,
    greatest(1,least(coalesce(p_expected_users,5),10000)),greatest(1,least(coalesce(p_expected_sites,1),10000)),nullif(trim(coalesce(p_notes,'')),''))
  returning * into v_request;
  return jsonb_build_object('id',v_request.id,'status',v_request.status,'created_at',v_request.created_at);
end $$;

create or replace function public.housing_owner_context() returns jsonb
language plpgsql stable security definer set search_path=public,auth as $$
declare v_owner jsonb;
begin
  if not public.housing_is_platform_owner() then raise exception 'Housing Platform Owner access is required.'; end if;
  select to_jsonb(o) into v_owner from public.housing_platform_owners o
  join auth.users u on u.id=auth.uid()
  where o.status='Active' and (o.user_id=auth.uid() or lower(o.email)=lower(u.email)) limit 1;
  return jsonb_build_object('owner',v_owner);
end $$;

create or replace function public.housing_owner_dashboard() returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.housing_is_platform_owner() then raise exception 'Housing Platform Owner access is required.'; end if;
  return jsonb_build_object(
    'stats',jsonb_build_object(
      'pending_requests',(select count(*) from public.housing_subscription_requests where status='Pending'),
      'active_companies',(select count(*) from public.housing_companies where status='Active'),
      'suspended_companies',(select count(*) from public.housing_companies where status='Suspended'),
      'monthly_revenue',(select coalesce(sum(monthly_amount),0) from public.housing_companies where status='Active' and subscription_status='Active')
    ),
    'requests',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from public.housing_subscription_requests r),'[]'::jsonb),
    'companies',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'name',c.name,'status',c.status,'plan',c.subscription_plan,'subscription_status',c.subscription_status,
      'subscription_start',c.subscription_start,'subscription_end',c.subscription_end,'users_limit',c.users_limit,
      'sites_limit',c.sites_limit,'monthly_amount',c.monthly_amount,'primary_admin_name',c.primary_admin_name,
      'primary_admin_email',c.primary_admin_email,'sites',(select count(*) from public.housing_sites s where s.company_id=c.id),
      'residents',(select count(*) from public.housing_assignments a where a.company_id=c.id and a.status='Active')
    ) order by c.created_at desc) from public.housing_companies c),'[]'::jsonb)
  );
end $$;

create or replace function public.housing_owner_review_request(
  p_request_id uuid,
  p_action text,
  p_plan text default 'Standard',
  p_subscription_start date default current_date,
  p_subscription_end date default (current_date+interval '30 days')::date,
  p_users_limit integer default 10,
  p_sites_limit integer default 10,
  p_monthly_amount numeric default 0,
  p_rejection_reason text default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_request public.housing_subscription_requests%rowtype;
  v_company_id uuid;
  v_invitation_id uuid;
  v_token uuid;
  v_recipient_id uuid;
  v_event_id uuid;
  v_invite_url text;
begin
  if not public.housing_is_platform_owner() then raise exception 'Housing Platform Owner access is required.'; end if;
  if p_action not in ('Approve','Reject') then raise exception 'Unsupported review action.'; end if;
  select * into v_request from public.housing_subscription_requests where id=p_request_id and status='Pending' for update;
  if v_request.id is null then raise exception 'Pending request was not found.'; end if;
  if p_action='Reject' then
    update public.housing_subscription_requests set status='Rejected',reviewed_by=auth.uid(),reviewed_at=now(),
      rejection_reason=nullif(trim(coalesce(p_rejection_reason,'')),''),updated_at=now() where id=v_request.id;
    return jsonb_build_object('status','Rejected');
  end if;
  if p_plan not in ('Starter','Standard','Enterprise') or p_subscription_end<p_subscription_start then raise exception 'Invalid subscription settings.'; end if;

  insert into public.housing_companies(name,status,email,phone,subscription_plan,subscription_status,subscription_start,subscription_end,
    users_limit,sites_limit,monthly_amount,primary_admin_name,primary_admin_email)
  values(v_request.company_name,'Active',v_request.email,v_request.phone,p_plan,'Active',p_subscription_start,p_subscription_end,
    greatest(1,p_users_limit),greatest(1,p_sites_limit),greatest(0,p_monthly_amount),v_request.admin_name,v_request.email)
  returning id into v_company_id;

  insert into public.housing_user_invitations(company_id,email,full_name,role,site_ids,invited_by)
  values(v_company_id,v_request.email,v_request.admin_name,'Admin','{}',null)
  returning id,token into v_invitation_id,v_token;
  v_invite_url:='https://www.visaflowksa.com/housing?invite='||v_token::text;

  insert into public.housing_notification_settings(company_id) values(v_company_id) on conflict do nothing;
  insert into public.housing_notification_recipients(company_id,name,role_label,email,channels,is_active)
  values(v_company_id,v_request.admin_name,'Primary Administrator',v_request.email,array['Email'],true)
  returning id into v_recipient_id;
  insert into public.housing_notification_events(company_id,event_type,severity,title_ar,title_en,body_ar,body_en,source_type,source_id,channels,dedupe_key,metadata)
  values(v_company_id,'SUBSCRIPTION_APPROVED','Info','تم اعتماد اشتراك منصة سكن','Sakan subscription approved',
    'تم اعتماد طلب شركتك. استخدم رابط الدعوة لإنشاء حساب المدير: '||v_invite_url,
    'Your company was approved. Use this invitation link to create the administrator account: '||v_invite_url,
    'housing_subscription_request',v_request.id,array['Email'],'subscription-approved:'||v_request.id::text,jsonb_build_object('invite_url',v_invite_url))
  returning id into v_event_id;
  insert into public.housing_notification_deliveries(company_id,event_id,recipient_id,channel,destination,dedupe_key)
  values(v_company_id,v_event_id,v_recipient_id,'Email',v_request.email,'subscription-approved:'||v_request.id::text||':email');

  update public.housing_subscription_requests set status='Approved',reviewed_by=auth.uid(),reviewed_at=now(),company_id=v_company_id,
    invitation_id=v_invitation_id,updated_at=now() where id=v_request.id;
  return jsonb_build_object('status','Approved','company_id',v_company_id,'invitation_id',v_invitation_id,'invite_url',v_invite_url);
end $$;

create or replace function public.housing_owner_set_company_status(p_company_id uuid,p_status text) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
  if not public.housing_is_platform_owner() then raise exception 'Housing Platform Owner access is required.'; end if;
  if p_status not in ('Active','Suspended','Inactive') then raise exception 'Invalid company status.'; end if;
  update public.housing_companies set status=p_status,updated_at=now() where id=p_company_id;
  if not found then raise exception 'Company was not found.'; end if;
  return jsonb_build_object('id',p_company_id,'status',p_status);
end $$;

create or replace function public.housing_create_workspace(p_company_name text,p_full_name text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  raise exception 'Owner approval and a valid housing invitation are required.';
end $$;

alter table public.housing_platform_owners enable row level security;
alter table public.housing_subscription_requests enable row level security;
revoke all on public.housing_platform_owners,public.housing_subscription_requests from public,anon,authenticated;
grant select on public.housing_platform_owners,public.housing_subscription_requests to authenticated;
create policy housing_platform_owners_owner_select on public.housing_platform_owners for select to authenticated using(public.housing_is_platform_owner());
create policy housing_subscription_requests_owner_select on public.housing_subscription_requests for select to authenticated using(public.housing_is_platform_owner());

drop policy if exists housing_companies_owner_select on public.housing_companies;
create policy housing_companies_owner_select on public.housing_companies for select to authenticated using(public.housing_is_platform_owner());

revoke execute on function public.housing_create_workspace(text,text) from authenticated;
revoke all on function public.housing_is_platform_owner(),public.housing_submit_subscription_request(text,text,text,text,text,integer,integer,text),
  public.housing_owner_context(),public.housing_owner_dashboard(),
  public.housing_owner_review_request(uuid,text,text,date,date,integer,integer,numeric,text),public.housing_owner_set_company_status(uuid,text) from public;
grant execute on function public.housing_submit_subscription_request(text,text,text,text,text,integer,integer,text) to anon,authenticated;
grant execute on function public.housing_is_platform_owner(),public.housing_owner_context(),public.housing_owner_dashboard(),
  public.housing_owner_review_request(uuid,text,text,date,date,integer,integer,numeric,text),public.housing_owner_set_company_status(uuid,text) to authenticated;
