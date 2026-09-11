-- Sakan Management Center: dashboard metrics and direct company invitations.
-- Apply ONLY to the dedicated Housing Supabase project after 0014.

create or replace function public.housing_owner_dashboard() returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.housing_is_platform_owner() then raise exception 'Housing Platform Owner access is required.'; end if;
  return jsonb_build_object(
    'stats',jsonb_build_object(
      'pending_requests',(select count(*) from public.housing_subscription_requests where status='Pending'),
      'active_companies',(select count(*) from public.housing_companies where status='Active'),
      'suspended_companies',(select count(*) from public.housing_companies where status='Suspended'),
      'monthly_revenue',(select coalesce(sum(monthly_amount),0) from public.housing_companies where status='Active' and subscription_status='Active'),
      'total_sites',(select count(*) from public.housing_sites),
      'active_residents',(select count(*) from public.housing_assignments where status='Active'),
      'expiring_subscriptions',(select count(*) from public.housing_companies where subscription_end between current_date and current_date+30 and status='Active')
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

create or replace function public.housing_owner_create_direct_invitation(
  p_company_name text,
  p_domain text,
  p_admin_name text,
  p_admin_email text,
  p_phone text default null,
  p_plan text default 'Standard',
  p_subscription_start date default current_date,
  p_subscription_end date default (current_date+interval '30 days')::date,
  p_users_limit integer default 10,
  p_sites_limit integer default 10,
  p_monthly_amount numeric default 0
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_email text:=lower(trim(coalesce(p_admin_email,'')));
  v_company_id uuid;
  v_invitation_id uuid;
  v_token uuid;
  v_recipient_id uuid;
  v_event_id uuid;
  v_invite_url text;
begin
  if not public.housing_is_platform_owner() then raise exception 'Housing Platform Owner access is required.'; end if;
  if length(trim(coalesce(p_company_name,'')))<2 or length(trim(coalesce(p_admin_name,'')))<2 then
    raise exception 'Company and administrator names are required.';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'A valid administrator email is required.'; end if;
  if p_plan not in ('Starter','Standard','Enterprise') or p_subscription_end<p_subscription_start then
    raise exception 'Invalid subscription settings.';
  end if;
  if exists(select 1 from public.housing_companies where lower(primary_admin_email)=v_email) then
    raise exception 'A housing company already exists for this administrator email.';
  end if;
  if exists(select 1 from public.housing_user_invitations where lower(email)=v_email and status='Pending' and expires_at>now()) then
    raise exception 'An active housing invitation already exists for this email.';
  end if;

  insert into public.housing_companies(name,status,email,phone,subscription_plan,subscription_status,subscription_start,subscription_end,
    users_limit,sites_limit,monthly_amount,primary_admin_name,primary_admin_email)
  values(trim(p_company_name),'Active',v_email,nullif(trim(coalesce(p_phone,'')),''),p_plan,'Active',p_subscription_start,p_subscription_end,
    greatest(1,p_users_limit),greatest(1,p_sites_limit),greatest(0,p_monthly_amount),trim(p_admin_name),v_email)
  returning id into v_company_id;

  insert into public.housing_user_invitations(company_id,email,full_name,role,site_ids,invited_by)
  values(v_company_id,v_email,trim(p_admin_name),'Admin','{}',null)
  returning id,token into v_invitation_id,v_token;
  v_invite_url:='https://www.visaflowksa.com/housing?invite='||v_token::text;

  insert into public.housing_notification_settings(company_id) values(v_company_id) on conflict do nothing;
  insert into public.housing_notification_recipients(company_id,name,role_label,email,channels,is_active)
  values(v_company_id,trim(p_admin_name),'Primary Administrator',v_email,array['Email'],true)
  returning id into v_recipient_id;
  insert into public.housing_notification_events(company_id,event_type,severity,title_ar,title_en,body_ar,body_en,source_type,source_id,channels,dedupe_key,metadata)
  values(v_company_id,'DIRECT_COMPANY_INVITATION','Info','دعوة مباشرة إلى منصة سكن','Direct invitation to Sakan',
    'أنشأ مركز إدارة سكن اشتراك شركتك. استخدم رابط الدعوة لإنشاء حساب المدير: '||v_invite_url,
    'Sakan Management Center created your company subscription. Use this invitation link to create the administrator account: '||v_invite_url,
    'housing_company',v_company_id,array['Email'],'direct-company-invitation:'||v_invitation_id::text,
    jsonb_build_object('invite_url',v_invite_url,'domain',nullif(trim(coalesce(p_domain,'')),'')))
  returning id into v_event_id;
  insert into public.housing_notification_deliveries(company_id,event_id,recipient_id,channel,destination,dedupe_key)
  values(v_company_id,v_event_id,v_recipient_id,'Email',v_email,'direct-company-invitation:'||v_invitation_id::text||':email');

  return jsonb_build_object('status','Invited','company_id',v_company_id,'invitation_id',v_invitation_id,
    'invite_url',v_invite_url,'expires_at',(select expires_at from public.housing_user_invitations where id=v_invitation_id));
end $$;

revoke all on function public.housing_owner_create_direct_invitation(text,text,text,text,text,text,date,date,integer,integer,numeric) from public;
grant execute on function public.housing_owner_create_direct_invitation(text,text,text,text,text,text,date,date,integer,integer,numeric) to authenticated;

