-- Automatic, fixed platform introductions only. AI drafts and prices remain gated.
alter table public.sales_leads add column intro_source_url text, add column intro_verified_at timestamptz;
create table public.sales_automation_settings (
 workspace_id uuid primary key references public.sales_workspaces(id),
 enabled boolean not null default false,
 daily_limit integer not null default 10 check(daily_limit between 1 and 20),
 hourly_limit integer not null default 2 check(hourly_limit between 1 and 5),
 owner_auth_id uuid not null,
 last_discovery_at timestamptz,
 updated_at timestamptz not null default now()
);
create table public.sales_email_suppressions (
 email text primary key check(email=lower(trim(email))),
 reason text not null,
 created_at timestamptz not null default now()
);
create table public.sales_intro_deliveries (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null,
 lead_id uuid not null,
 email text not null unique check(email=lower(trim(email))),
 template_version text not null default 'visaflow-platform-introduction-ar-v1' check(template_version='visaflow-platform-introduction-ar-v1'),
 unsubscribe_token text not null unique default replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),
 status text not null default 'queued' check(status in ('queued','sending','sent','needs_review','suppressed')),
 started_at timestamptz, sent_at timestamptz, provider_message_id text, error_code text,
 created_at timestamptz not null default now(),
 foreign key(workspace_id,lead_id) references public.sales_leads(workspace_id,id)
);
do $$ declare t text; begin
 foreach t in array array['sales_automation_settings','sales_email_suppressions','sales_intro_deliveries'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant select on public.sales_automation_settings to authenticated;
grant select(id,workspace_id,lead_id,email,template_version,status,started_at,sent_at,provider_message_id,error_code,created_at) on public.sales_intro_deliveries to authenticated;
create policy sales_automation_read on public.sales_automation_settings for select to authenticated using(public.sales_can_access(workspace_id));
create policy sales_delivery_read on public.sales_intro_deliveries for select to authenticated using(public.sales_can_access(workspace_id));

create function public.sales_configure_automation(p_enabled boolean,p_daily_limit integer default 10) returns public.sales_automation_settings
language plpgsql security definer set search_path='' as $$
declare w uuid; result public.sales_automation_settings;
begin
 select id into w from public.sales_workspaces where scope='platform' and status='Active';
 if not coalesce(public.sales_can_access(w),false) then raise exception 'forbidden'; end if;
 if p_enabled is null or p_daily_limit not between 1 and 20 then raise exception 'invalid_settings'; end if;
 insert into public.sales_automation_settings(workspace_id,enabled,daily_limit,owner_auth_id)
 values(w,p_enabled,p_daily_limit,auth.uid()) on conflict(workspace_id) do update
 set enabled=excluded.enabled,daily_limit=excluded.daily_limit,owner_auth_id=excluded.owner_auth_id,updated_at=now()
 returning * into result;
 return result;
end $$;
revoke all on function public.sales_configure_automation(boolean,integer) from public,anon,authenticated;
grant execute on function public.sales_configure_automation(boolean,integer) to authenticated;

create function public.sales_email_blocked(p_email text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare blocked boolean;
begin
 if exists(select 1 from public.sales_email_suppressions where email=lower(trim(p_email)))
 or exists(select 1 from public.sales_leads where lower(trim(contact_email))=lower(trim(p_email)) and do_not_contact) then return true; end if;
 if to_regclass('public.outreach_suppression_list') is not null then
  execute 'select exists(select 1 from public.outreach_suppression_list where email_normalized=$1 and lifted_at is null)' into blocked using lower(trim(p_email));
  if blocked then return true; end if;
 end if;
 return false;
end $$;

create function public.sales_intro_suppress(p_token text) returns void
language plpgsql security definer set search_path='' as $$
declare address text;
begin
 if p_token !~ '^[a-f0-9]{64}$' then return; end if;
 select email into address from public.sales_intro_deliveries where unsubscribe_token=p_token;
 if address is null then return; end if;
 insert into public.sales_email_suppressions(email,reason) values(address,'unsubscribe') on conflict do nothing;
 update public.sales_leads set do_not_contact=true where lower(trim(contact_email))=address;
 update public.sales_intro_deliveries set status='suppressed' where email=address and status='queued';
end $$;

create function public.sales_intro_dnc() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.do_not_contact and new.contact_email is not null then
  insert into public.sales_email_suppressions(email,reason) values(lower(trim(new.contact_email)),'do_not_contact') on conflict do nothing;
  update public.sales_intro_deliveries set status='suppressed' where email=lower(trim(new.contact_email)) and status='queued';
 end if;
 return new;
end $$;
create trigger sales_intro_dnc after insert or update of do_not_contact on public.sales_leads for each row execute function public.sales_intro_dnc();

create function public.sales_automation_claim(p_discovery boolean default false) returns public.sales_automation_settings
language plpgsql security definer set search_path='' as $$
declare s public.sales_automation_settings;
begin
 select cfg.* into s from public.sales_automation_settings cfg join public.sales_workspaces w on w.id=cfg.workspace_id
 where cfg.enabled and w.scope='platform' and w.status='Active' for update of cfg;
 if not found then return null; end if;
 if (select count(*) from public.users where auth_user_id=s.owner_auth_id)<>1
 or not exists(select 1 from public.users where auth_user_id=s.owner_auth_id and role='Platform Owner' and company_id is null and status='Active' and is_active) then return null; end if;
 if p_discovery then
  if s.last_discovery_at>now()-interval '24 hours' then return null; end if;
  update public.sales_automation_settings set last_discovery_at=now() where workspace_id=s.workspace_id;
 end if;
 return s;
end $$;

create function public.sales_register_discovered_intro(p_workspace uuid,p_name text,p_email text,p_website text,p_source text,p_industry text) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.sales_automation_settings; l uuid; address text:=lower(trim(p_email));
begin
 perform pg_advisory_xact_lock(hashtext('sales-intro-register'));
 s:=public.sales_automation_claim(false);
 if s.workspace_id is distinct from p_workspace then raise exception 'automation_disabled'; end if;
 if public.sales_email_blocked(address) then return null; end if;
 if exists(select 1 from public.sales_leads where lower(trim(contact_email))=address)
 or exists(select 1 from public.sales_intro_deliveries where email=address) then return null; end if;
 insert into public.sales_leads(workspace_id,company_name,contact_email,website,industry,source,intro_source_url,intro_verified_at)
 values(p_workspace,left(p_name,200),address,p_website,left(p_industry,200),'official_website',p_source,now()) returning id into l;
 insert into public.sales_intro_deliveries(workspace_id,lead_id,email) values(p_workspace,l,address);
 return l;
end $$;

create function public.sales_claim_intro_delivery() returns public.sales_intro_deliveries
language plpgsql security definer set search_path='' as $$
declare s public.sales_automation_settings; d public.sales_intro_deliveries;
begin
 perform pg_advisory_xact_lock(hashtext('sales-intro-delivery'));
 s:=public.sales_automation_claim(false);
 if s.workspace_id is null then return null; end if;
 if (select count(*) from public.sales_intro_deliveries where started_at >= (date_trunc('day',now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh'))>=s.daily_limit
 or (select count(*) from public.sales_intro_deliveries where started_at>now()-interval '1 hour')>=s.hourly_limit then return null; end if;
 select q.* into d from public.sales_intro_deliveries q join public.sales_leads l on l.id=q.lead_id and l.workspace_id=q.workspace_id
 where q.status='queued' and q.workspace_id=s.workspace_id and l.intro_verified_at is not null
 and l.status='active' and not l.do_not_contact and l.last_replied_at is null
 and lower(trim(l.contact_email))=q.email and not public.sales_email_blocked(q.email)
 order by q.created_at for update of q,l skip locked limit 1;
 if not found then return null; end if;
 update public.sales_intro_deliveries set status='sending',started_at=now() where id=d.id returning * into d;
 return d;
end $$;

create function public.sales_intro_may_send(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare s public.sales_automation_settings;
begin
 s:=public.sales_automation_claim(false);
 return s.workspace_id is not null and exists(select 1 from public.sales_intro_deliveries d join public.sales_leads l on l.id=d.lead_id
 where d.id=p_id and d.status='sending' and d.workspace_id=s.workspace_id and l.workspace_id=d.workspace_id and lower(trim(l.contact_email))=d.email and l.intro_verified_at is not null and not l.do_not_contact and l.status='active' and l.last_replied_at is null and not public.sales_email_blocked(d.email));
end $$;

revoke all on function public.sales_email_blocked(text),public.sales_intro_suppress(text),public.sales_intro_dnc(),public.sales_automation_claim(boolean),public.sales_register_discovered_intro(uuid,text,text,text,text,text),public.sales_claim_intro_delivery(),public.sales_intro_may_send(uuid) from public,anon,authenticated;
grant execute on function public.sales_email_blocked(text),public.sales_intro_suppress(text),public.sales_automation_claim(boolean),public.sales_register_discovered_intro(uuid,text,text,text,text,text),public.sales_claim_intro_delivery(),public.sales_intro_may_send(uuid) to service_role;
-- Keep the original no-outbound constraint: arbitrary AI drafts cannot be sent.
notify pgrst, 'reload schema';
