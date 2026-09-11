-- Housing users, invitations, site scopes and role-based permissions.
-- Apply ONLY to the dedicated Housing Supabase project after 0004.

create table if not exists public.housing_profile_sites (
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  profile_id uuid not null references public.housing_profiles(id) on delete cascade,
  site_id uuid not null references public.housing_sites(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(profile_id,site_id)
);

create table if not exists public.housing_user_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  email text not null,
  full_name text not null,
  role text not null check(role in ('Admin','Housing Manager','Housing Supervisor','Maintenance','Finance','Viewer')),
  site_ids uuid[] not null default '{}',
  token uuid not null default gen_random_uuid() unique,
  status text not null default 'Pending' check(status in ('Pending','Accepted','Revoked','Expired')),
  expires_at timestamptz not null default now()+interval '7 days',
  invited_by uuid references public.housing_profiles(id) on delete set null default auth.uid(),
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists housing_pending_invite_email_idx on public.housing_user_invitations(company_id,lower(email)) where status='Pending';

create or replace function public.housing_has_permission(p_module text,p_action text default 'read') returns boolean
language sql stable security definer set search_path=public as $$
  select case public.housing_current_role()
    when 'Admin' then true
    when 'Housing Manager' then p_module <> 'users'
    when 'Housing Supervisor' then p_module in ('dashboard','housing','occupancy','inspections','safety','welfare','operations','maintenance','assets','reports')
    when 'Maintenance' then p_module in ('dashboard','housing','maintenance','assets','reports')
    when 'Finance' then p_module in ('dashboard','housing','finance','reports')
    when 'Viewer' then p_action='read'
    else false end
$$;

create or replace function public.housing_can_access_site(p_site_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select case
    when public.housing_current_role() in ('Admin','Housing Manager','Finance','Viewer') then true
    else exists(select 1 from public.housing_profile_sites s where s.profile_id=auth.uid() and s.site_id=p_site_id and s.company_id=public.housing_current_company_id())
  end
$$;

create or replace function public.housing_can_manage() returns boolean
language sql stable security definer set search_path=public as $$ select public.housing_has_permission('occupancy','manage') $$;

create or replace function public.housing_create_user_invitation(p_email text,p_full_name text,p_role text,p_site_ids uuid[] default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_invite public.housing_user_invitations%rowtype; v_company uuid:=public.housing_current_company_id();
begin
  if public.housing_current_role()<>'Admin' then raise exception 'Only an administrator can invite users.'; end if;
  if p_role not in ('Admin','Housing Manager','Housing Supervisor','Maintenance','Finance','Viewer') then raise exception 'Unsupported role.'; end if;
  if nullif(trim(p_email),'') is null or nullif(trim(p_full_name),'') is null then raise exception 'Name and email are required.'; end if;
  if exists(select 1 from public.housing_profiles where company_id=v_company and lower(email)=lower(trim(p_email))) then raise exception 'This user already belongs to the workspace.'; end if;
  update public.housing_user_invitations set status='Revoked',updated_at=now() where company_id=v_company and lower(email)=lower(trim(p_email)) and status='Pending';
  insert into public.housing_user_invitations(company_id,email,full_name,role,site_ids)
  values(v_company,lower(trim(p_email)),trim(p_full_name),p_role,coalesce(p_site_ids,'{}')) returning * into v_invite;
  return jsonb_build_object('id',v_invite.id,'token',v_invite.token,'email',v_invite.email,'expires_at',v_invite.expires_at);
end $$;

create or replace function public.housing_accept_user_invitation(p_token uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_invite public.housing_user_invitations%rowtype; v_user uuid:=auth.uid(); v_email text;
begin
  if v_user is null then raise exception 'Authentication required.'; end if;
  if exists(select 1 from public.housing_profiles where id=v_user) then raise exception 'The account already belongs to a housing workspace.'; end if;
  select email into v_email from auth.users where id=v_user;
  select * into v_invite from public.housing_user_invitations where token=p_token and status='Pending' and expires_at>now() for update;
  if v_invite.id is null or lower(v_invite.email)<>lower(coalesce(v_email,'')) then raise exception 'Invitation is invalid, expired, or belongs to another email.'; end if;
  insert into public.housing_profiles(id,company_id,full_name,email,role,status) values(v_user,v_invite.company_id,v_invite.full_name,v_email,v_invite.role,'Active');
  insert into public.housing_profile_sites(company_id,profile_id,site_id)
    select v_invite.company_id,v_user,s.id from public.housing_sites s where s.company_id=v_invite.company_id and s.id=any(v_invite.site_ids) on conflict do nothing;
  update public.housing_user_invitations set status='Accepted',accepted_by=v_user,accepted_at=now(),updated_at=now() where id=v_invite.id;
  return jsonb_build_object('company_id',v_invite.company_id,'role',v_invite.role);
end $$;

create or replace function public.housing_update_user_access(p_profile_id uuid,p_role text,p_status text,p_site_ids uuid[] default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_company uuid:=public.housing_current_company_id();
begin
  if public.housing_current_role()<>'Admin' then raise exception 'Only an administrator can manage users.'; end if;
  if p_role not in ('Admin','Housing Manager','Housing Supervisor','Maintenance','Finance','Viewer') or p_status not in ('Active','Inactive') then raise exception 'Invalid role or status.'; end if;
  if p_profile_id=auth.uid() and (p_role<>'Admin' or p_status<>'Active') then raise exception 'You cannot remove your own administrator access.'; end if;
  update public.housing_profiles set role=p_role,status=p_status where id=p_profile_id and company_id=v_company;
  if not found then raise exception 'User was not found.'; end if;
  delete from public.housing_profile_sites where profile_id=p_profile_id and company_id=v_company;
  insert into public.housing_profile_sites(company_id,profile_id,site_id)
    select v_company,p_profile_id,s.id from public.housing_sites s where s.company_id=v_company and s.id=any(coalesce(p_site_ids,'{}')) on conflict do nothing;
  return jsonb_build_object('id',p_profile_id,'role',p_role,'status',p_status);
end $$;

create or replace function public.housing_revoke_user_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  if public.housing_current_role()<>'Admin' then raise exception 'Only an administrator can revoke invitations.'; end if;
  update public.housing_user_invitations set status='Revoked',updated_at=now() where id=p_invitation_id and company_id=public.housing_current_company_id() and status='Pending';
end $$;

alter table public.housing_profile_sites enable row level security;
alter table public.housing_user_invitations enable row level security;
create policy housing_profile_sites_select on public.housing_profile_sites for select to authenticated using(company_id=public.housing_current_company_id());
create policy housing_profile_sites_admin on public.housing_profile_sites for all to authenticated using(company_id=public.housing_current_company_id() and public.housing_current_role()='Admin') with check(company_id=public.housing_current_company_id() and public.housing_current_role()='Admin');
create policy housing_invitations_admin on public.housing_user_invitations for all to authenticated using(company_id=public.housing_current_company_id() and public.housing_current_role()='Admin') with check(company_id=public.housing_current_company_id() and public.housing_current_role()='Admin');

-- Replace broad company-level write policies with module and assigned-site policies.
do $$ declare r record; begin
  for r in select * from (values
    ('housing_buildings','housing'),('housing_rooms','housing'),('housing_beds','occupancy'),('housing_assignments','occupancy'),
    ('housing_maintenance_requests','maintenance'),('housing_inspections','inspections'),('housing_assets','assets'),
    ('housing_contracts','finance'),('housing_utility_accounts','finance'),('housing_incidents','safety'),
    ('housing_licenses','safety'),('housing_hse_reports','safety'),('housing_operation_schedules','operations'),
    ('housing_welfare_surveys','welfare'),('housing_compliance_alerts','safety')
  ) as x(table_name,module_name) loop
    execute format('drop policy if exists %I_select on public.%I',r.table_name,r.table_name);
    execute format('drop policy if exists %I_insert on public.%I',r.table_name,r.table_name);
    execute format('drop policy if exists %I_update on public.%I',r.table_name,r.table_name);
    execute format('drop policy if exists %I_delete on public.%I',r.table_name,r.table_name);
    execute format('create policy %I_select on public.%I for select to authenticated using(company_id=public.housing_current_company_id() and public.housing_has_permission(%L,''read'') and public.housing_can_access_site(site_id))',r.table_name,r.table_name,r.module_name);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check(company_id=public.housing_current_company_id() and public.housing_has_permission(%L,''manage'') and public.housing_can_access_site(site_id))',r.table_name,r.table_name,r.module_name);
    execute format('create policy %I_update on public.%I for update to authenticated using(company_id=public.housing_current_company_id() and public.housing_has_permission(%L,''manage'') and public.housing_can_access_site(site_id)) with check(company_id=public.housing_current_company_id() and public.housing_can_access_site(site_id))',r.table_name,r.table_name,r.module_name);
    execute format('create policy %I_delete on public.%I for delete to authenticated using(company_id=public.housing_current_company_id() and public.housing_current_role()=''Admin'')',r.table_name,r.table_name);
  end loop;
end $$;

drop policy if exists housing_sites_select on public.housing_sites;
drop policy if exists housing_sites_insert on public.housing_sites;
drop policy if exists housing_sites_update on public.housing_sites;
drop policy if exists housing_sites_delete on public.housing_sites;
create policy housing_sites_select on public.housing_sites for select to authenticated using(company_id=public.housing_current_company_id() and public.housing_has_permission('housing','read') and public.housing_can_access_site(id));
create policy housing_sites_insert on public.housing_sites for insert to authenticated with check(company_id=public.housing_current_company_id() and public.housing_current_role() in ('Admin','Housing Manager'));
create policy housing_sites_update on public.housing_sites for update to authenticated using(company_id=public.housing_current_company_id() and public.housing_current_role() in ('Admin','Housing Manager')) with check(company_id=public.housing_current_company_id());
create policy housing_sites_delete on public.housing_sites for delete to authenticated using(company_id=public.housing_current_company_id() and public.housing_current_role()='Admin');

drop policy if exists housing_utility_bills_select on public.housing_utility_bills;
drop policy if exists housing_utility_bills_insert on public.housing_utility_bills;
drop policy if exists housing_utility_bills_update on public.housing_utility_bills;
drop policy if exists housing_utility_bills_delete on public.housing_utility_bills;
create policy housing_utility_bills_select on public.housing_utility_bills for select to authenticated using(company_id=public.housing_current_company_id() and public.housing_has_permission('finance','read') and exists(select 1 from public.housing_utility_accounts a where a.id=utility_account_id and public.housing_can_access_site(a.site_id)));
create policy housing_utility_bills_insert on public.housing_utility_bills for insert to authenticated with check(company_id=public.housing_current_company_id() and public.housing_has_permission('finance','manage') and exists(select 1 from public.housing_utility_accounts a where a.id=utility_account_id and public.housing_can_access_site(a.site_id)));
create policy housing_utility_bills_update on public.housing_utility_bills for update to authenticated using(company_id=public.housing_current_company_id() and public.housing_has_permission('finance','manage')) with check(company_id=public.housing_current_company_id());
create policy housing_utility_bills_delete on public.housing_utility_bills for delete to authenticated using(company_id=public.housing_current_company_id() and public.housing_current_role()='Admin');

grant select,insert,update,delete on public.housing_profile_sites,public.housing_user_invitations to authenticated;
grant execute on function public.housing_has_permission(text,text),public.housing_can_access_site(uuid),public.housing_create_user_invitation(text,text,text,uuid[]),public.housing_accept_user_invitation(uuid),public.housing_update_user_access(uuid,text,text,uuid[]),public.housing_revoke_user_invitation(uuid) to authenticated;
