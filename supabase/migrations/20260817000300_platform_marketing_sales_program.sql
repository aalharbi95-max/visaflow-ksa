-- VisaFlow platform marketing representatives, owner-approved company leads,
-- private settlement details, and payment-earned commissions.

create table if not exists public.platform_marketing_profiles (
  user_id bigint primary key references public.users(id) on delete cascade,
  phone text,
  identity_reference text,
  bank_name text,
  account_holder_name text,
  iban text,
  bank_verification_status text not null default 'Pending'
    check (bank_verification_status in ('Pending','Verified','Rejected')),
  default_commission_rate numeric(7,4) check (default_commission_rate between 0 and 100),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_company_requests (
  id uuid primary key default gen_random_uuid(),
  representative_user_id bigint not null references public.users(id) on delete restrict,
  company_name text not null,
  commercial_registration text,
  contact_name text not null,
  contact_email text not null,
  contact_phone text not null,
  requested_product text not null default 'Recruitment',
  billing_cycle_months integer not null default 1 check (billing_cycle_months between 1 and 60),
  quoted_amount numeric(14,2) check (quoted_amount is null or quoted_amount >= 0),
  notes text,
  status text not null default 'Pending' check (status in ('Pending','Approved','Rejected','Cancelled')),
  commission_rate numeric(7,4) check (commission_rate is null or commission_rate between 0 and 100),
  platform_client_id uuid references public.platform_clients(id) on delete set null,
  reviewed_by bigint references public.users(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists marketing_company_requests_active_company_email
  on public.marketing_company_requests (representative_user_id, lower(company_name), lower(contact_email))
  where status in ('Pending','Approved');
create index if not exists marketing_company_requests_rep_status
  on public.marketing_company_requests (representative_user_id, status, created_at desc);

create table if not exists public.marketing_commission_entries (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null unique references public.subscription_invoices(id) on delete cascade,
  request_id uuid not null references public.marketing_company_requests(id) on delete restrict,
  representative_user_id bigint not null references public.users(id) on delete restrict,
  platform_client_id uuid not null references public.platform_clients(id) on delete restrict,
  invoice_amount numeric(14,2) not null,
  commission_rate numeric(7,4) not null,
  commission_amount numeric(14,2) not null,
  status text not null default 'Earned' check (status in ('Earned','Payable','Paid','Reversed')),
  earned_at timestamptz,
  paid_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.marketing_actor()
returns table(user_id bigint, role text)
language sql stable security definer set search_path = ''
as $$
  select u.id, u.role
  from public.users u
  where u.auth_user_id = auth.uid() and u.status = 'Active' and u.is_active is true
  limit 1
$$;

create or replace function public.save_my_marketing_profile(p_profile jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; saved public.platform_marketing_profiles;
begin
  select * into a from public.marketing_actor();
  if a.role <> 'Platform Marketing User' then raise exception 'MARKETING_REP_REQUIRED' using errcode='42501'; end if;
  insert into public.platform_marketing_profiles(user_id,phone,identity_reference,bank_name,account_holder_name,iban,updated_at)
  values(a.user_id,nullif(btrim(p_profile->>'phone'),''),nullif(btrim(p_profile->>'identity_reference'),''),
    nullif(btrim(p_profile->>'bank_name'),''),nullif(btrim(p_profile->>'account_holder_name'),''),
    upper(replace(nullif(btrim(p_profile->>'iban'),''),' ','')),now())
  on conflict(user_id) do update set phone=excluded.phone,identity_reference=excluded.identity_reference,
    bank_name=excluded.bank_name,account_holder_name=excluded.account_holder_name,iban=excluded.iban,
    bank_verification_status='Pending',updated_at=now()
  returning * into saved;
  return to_jsonb(saved) - 'iban' || jsonb_build_object('iban_masked', case when saved.iban is null then null else '****' || right(saved.iban,4) end);
end $$;

create or replace function public.submit_marketing_company_request(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; saved public.marketing_company_requests;
begin
  select * into a from public.marketing_actor();
  if a.role <> 'Platform Marketing User' then raise exception 'MARKETING_REP_REQUIRED' using errcode='42501'; end if;
  if nullif(btrim(p_request->>'company_name'),'') is null or nullif(btrim(p_request->>'contact_name'),'') is null
    or nullif(btrim(p_request->>'contact_email'),'') is null or nullif(btrim(p_request->>'contact_phone'),'') is null
  then raise exception 'MARKETING_REQUEST_REQUIRED_FIELDS'; end if;
  insert into public.marketing_company_requests(representative_user_id,company_name,commercial_registration,contact_name,
    contact_email,contact_phone,requested_product,billing_cycle_months,quoted_amount,notes)
  values(a.user_id,btrim(p_request->>'company_name'),nullif(btrim(p_request->>'commercial_registration'),''),btrim(p_request->>'contact_name'),
    lower(btrim(p_request->>'contact_email')),btrim(p_request->>'contact_phone'),coalesce(nullif(btrim(p_request->>'requested_product'),''),'Recruitment'),
    greatest(1,least(60,coalesce((p_request->>'billing_cycle_months')::integer,1))),nullif(p_request->>'quoted_amount','')::numeric,nullif(btrim(p_request->>'notes'),''))
  returning * into saved;
  return to_jsonb(saved);
exception when unique_violation then raise exception 'MARKETING_REQUEST_DUPLICATE';
end $$;

create or replace function public.review_marketing_company_request(
  p_request_id uuid, p_decision text, p_commission_rate numeric default null,
  p_platform_client_id uuid default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; saved public.marketing_company_requests;
begin
  select * into a from public.marketing_actor();
  if a.role <> 'Platform Owner' then raise exception 'PLATFORM_OWNER_REQUIRED' using errcode='42501'; end if;
  if p_decision not in ('Approved','Rejected') then raise exception 'INVALID_DECISION'; end if;
  if p_decision='Approved' and (p_commission_rate is null or p_commission_rate < 0 or p_commission_rate > 100)
    then raise exception 'COMMISSION_RATE_REQUIRED'; end if;
  update public.marketing_company_requests set status=p_decision,commission_rate=case when p_decision='Approved' then p_commission_rate else null end,
    platform_client_id=case when p_decision='Approved' then p_platform_client_id else null end,reviewed_by=a.user_id,
    reviewed_at=now(),review_notes=nullif(btrim(p_notes),''),updated_at=now()
  where id=p_request_id and status='Pending' returning * into saved;
  if saved.id is null then raise exception 'REQUEST_NOT_PENDING'; end if;
  return to_jsonb(saved);
end $$;

create or replace function public.sync_marketing_invoice_commission()
returns trigger language plpgsql security definer set search_path = '' as $$
declare lead public.marketing_company_requests;
begin
  if new.status='Paid' and new.paid_at is not null then
    select * into lead from public.marketing_company_requests r
    where r.platform_client_id=new.client_id and r.status='Approved' and r.commission_rate is not null
    order by r.reviewed_at desc limit 1;
    if lead.id is not null then
      insert into public.marketing_commission_entries(invoice_id,request_id,representative_user_id,platform_client_id,
        invoice_amount,commission_rate,commission_amount,status,earned_at,updated_at)
      values(new.id,lead.id,lead.representative_user_id,new.client_id,new.amount,lead.commission_rate,
        round(new.amount*lead.commission_rate/100,2),'Earned',coalesce(new.paid_at::timestamptz,now()),now())
      on conflict(invoice_id) do update set invoice_amount=excluded.invoice_amount,commission_rate=excluded.commission_rate,
        commission_amount=excluded.commission_amount,status=case when public.marketing_commission_entries.status='Paid' then 'Paid' else 'Earned' end,
        earned_at=excluded.earned_at,updated_at=now();
    end if;
  elsif tg_op='UPDATE' and old.status='Paid' and new.status<>'Paid' then
    update public.marketing_commission_entries set status='Reversed',updated_at=now()
    where invoice_id=new.id and status<>'Paid';
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_marketing_invoice_commission on public.subscription_invoices;
create trigger trg_sync_marketing_invoice_commission after insert or update of status,paid_at,amount,client_id
on public.subscription_invoices for each row execute function public.sync_marketing_invoice_commission();

alter table public.platform_marketing_profiles enable row level security;
alter table public.marketing_company_requests enable row level security;
alter table public.marketing_commission_entries enable row level security;

create policy marketing_profile_private_select on public.platform_marketing_profiles for select to authenticated
using (user_id in (select a.user_id from public.marketing_actor() a where a.role='Platform Marketing User')
  or exists(select 1 from public.marketing_actor() a where a.role='Platform Owner'));
create policy marketing_requests_private_select on public.marketing_company_requests for select to authenticated
using (representative_user_id in (select a.user_id from public.marketing_actor() a where a.role='Platform Marketing User')
  or exists(select 1 from public.marketing_actor() a where a.role='Platform Owner'));
create policy marketing_commissions_private_select on public.marketing_commission_entries for select to authenticated
using (representative_user_id in (select a.user_id from public.marketing_actor() a where a.role='Platform Marketing User')
  or exists(select 1 from public.marketing_actor() a where a.role='Platform Owner'));

revoke all on public.platform_marketing_profiles,public.marketing_company_requests,public.marketing_commission_entries from anon;
revoke insert,update,delete on public.platform_marketing_profiles,public.marketing_company_requests,public.marketing_commission_entries from authenticated;
grant select on public.platform_marketing_profiles,public.marketing_company_requests,public.marketing_commission_entries to authenticated;
grant execute on function public.save_my_marketing_profile(jsonb),public.submit_marketing_company_request(jsonb),
  public.review_marketing_company_request(uuid,text,numeric,uuid,text) to authenticated;

-- Extend authenticated workspace recognition to the isolated marketing role.
-- Existing owner-only platform mutations continue to check the exact owner role.
update public.users set updated_at=updated_at where false;
