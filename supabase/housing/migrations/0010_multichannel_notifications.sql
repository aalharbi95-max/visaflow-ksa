-- Multi-channel notifications for the standalone Housing platform.
-- Apply ONLY to the dedicated Housing Supabase project after 0009.

create table public.housing_notification_settings (
  company_id uuid primary key references public.housing_companies(id) on delete cascade,
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default true,
  sms_enabled boolean not null default false,
  whatsapp_enabled boolean not null default false,
  critical_incident_channels text[] not null default array['In App'],
  weekly_digest_channels text[] not null default array['In App','Email'],
  license_days_before integer not null default 30 check(license_days_before between 1 and 365),
  maintenance_sla_hours integer not null default 24 check(maintenance_sla_hours between 1 and 720),
  digest_weekday integer not null default 0 check(digest_weekday between 0 and 6),
  digest_hour integer not null default 8 check(digest_hour between 0 and 23),
  timezone text not null default 'Asia/Riyadh',
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(critical_incident_channels <@ array['In App','Email','SMS','WhatsApp']::text[]),
  check(weekly_digest_channels <@ array['In App','Email','SMS','WhatsApp']::text[])
);

create table public.housing_notification_recipients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  profile_id uuid references public.housing_profiles(id) on delete set null,
  site_id uuid references public.housing_sites(id) on delete cascade,
  name text not null,
  role_label text,
  email text,
  phone_e164 text,
  whatsapp_e164 text,
  channels text[] not null default array['In App'],
  critical_only boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(channels <@ array['In App','Email','SMS','WhatsApp']::text[]),
  check(email is not null or phone_e164 is not null or whatsapp_e164 is not null or profile_id is not null)
);

create table public.housing_notification_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  site_id uuid references public.housing_sites(id) on delete cascade,
  event_type text not null,
  severity text not null default 'Info' check(severity in ('Info','Warning','High','Critical')),
  title_ar text not null,
  title_en text not null,
  body_ar text not null,
  body_en text not null,
  source_type text,
  source_id uuid,
  channels text[] not null default array['In App'],
  status text not null default 'Unread' check(status in ('Unread','Read','Archived')),
  read_at timestamptz,
  read_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,dedupe_key)
);

create table public.housing_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  event_id uuid not null references public.housing_notification_events(id) on delete cascade,
  recipient_id uuid references public.housing_notification_recipients(id) on delete set null,
  channel text not null check(channel in ('Email','SMS','WhatsApp')),
  destination text not null,
  status text not null default 'Queued' check(status in ('Queued','Processing','Sent','Failed','Skipped')),
  attempts integer not null default 0 check(attempts >= 0),
  available_at timestamptz not null default now(),
  provider text,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,dedupe_key)
);

create index housing_notification_events_feed_idx on public.housing_notification_events(company_id,status,created_at desc);
create index housing_notification_deliveries_queue_idx on public.housing_notification_deliveries(status,available_at) where status in ('Queued','Failed');
create index housing_notification_recipients_company_idx on public.housing_notification_recipients(company_id,is_active);

create trigger housing_notification_settings_updated_at before update on public.housing_notification_settings
for each row execute function public.housing_set_updated_at();
create trigger housing_notification_recipients_updated_at before update on public.housing_notification_recipients
for each row execute function public.housing_set_updated_at();
create trigger housing_notification_events_updated_at before update on public.housing_notification_events
for each row execute function public.housing_set_updated_at();
create trigger housing_notification_deliveries_updated_at before update on public.housing_notification_deliveries
for each row execute function public.housing_set_updated_at();

create or replace function public.housing_emit_notification(
  p_company_id uuid,
  p_site_id uuid,
  p_event_type text,
  p_severity text,
  p_title_ar text,
  p_title_en text,
  p_body_ar text,
  p_body_en text,
  p_source_type text,
  p_source_id uuid,
  p_channels text[],
  p_dedupe_key text,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_event_id uuid;
  v_recipient public.housing_notification_recipients;
  v_channel text;
  v_destination text;
  v_settings public.housing_notification_settings;
begin
  insert into public.housing_notification_settings(company_id) values(p_company_id) on conflict do nothing;
  select * into v_settings from public.housing_notification_settings where company_id=p_company_id;

  insert into public.housing_notification_events(
    company_id,site_id,event_type,severity,title_ar,title_en,body_ar,body_en,
    source_type,source_id,channels,dedupe_key,metadata
  ) values(
    p_company_id,p_site_id,p_event_type,p_severity,p_title_ar,p_title_en,p_body_ar,p_body_en,
    p_source_type,p_source_id,coalesce(p_channels,array['In App']),p_dedupe_key,coalesce(p_metadata,'{}'::jsonb)
  ) on conflict(company_id,dedupe_key) do update set metadata=excluded.metadata
  returning id into v_event_id;

  for v_recipient in
    select * from public.housing_notification_recipients
    where company_id=p_company_id and is_active
      and (site_id is null or site_id=p_site_id)
      and (not critical_only or p_severity in ('High','Critical'))
  loop
    foreach v_channel in array coalesce(p_channels,'{}') loop
      if not (v_channel=any(v_recipient.channels)) or v_channel='In App' then continue; end if;
      if v_channel='Email' and v_settings.email_enabled then v_destination:=v_recipient.email;
      elsif v_channel='SMS' and v_settings.sms_enabled then v_destination:=v_recipient.phone_e164;
      elsif v_channel='WhatsApp' and v_settings.whatsapp_enabled then v_destination:=v_recipient.whatsapp_e164;
      else v_destination:=null; end if;
      if nullif(trim(coalesce(v_destination,'')),'') is not null then
        insert into public.housing_notification_deliveries(
          company_id,event_id,recipient_id,channel,destination,dedupe_key
        ) values(
          p_company_id,v_event_id,v_recipient.id,v_channel,v_destination,
          p_dedupe_key||':'||v_recipient.id::text||':'||v_channel
        ) on conflict(company_id,dedupe_key) do nothing;
      end if;
    end loop;
  end loop;
  return v_event_id;
end $$;

create or replace function public.housing_notify_critical_incident() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_channels text[]; v_site_name text;
begin
  if new.severity not in ('High','Critical') or new.status='Closed' then return new; end if;
  if tg_op='UPDATE' and old.severity=new.severity and old.status=new.status then return new; end if;
  insert into public.housing_notification_settings(company_id) values(new.company_id) on conflict do nothing;
  select critical_incident_channels into v_channels from public.housing_notification_settings where company_id=new.company_id;
  select name into v_site_name from public.housing_sites where id=new.site_id;
  perform public.housing_emit_notification(
    new.company_id,new.site_id,'CRITICAL_INCIDENT',new.severity,
    'حادث عاجل في السكن: '||new.incident_no,
    'Urgent housing incident: '||new.incident_no,
    coalesce(v_site_name,'-')||' — '||new.description,
    coalesce(v_site_name,'-')||' — '||new.description,
    'housing_incidents',new.id,v_channels,
    'incident:'||new.id::text||':'||new.severity||':'||new.status,
    jsonb_build_object('incident_no',new.incident_no,'incident_type',new.incident_type,'status',new.status)
  );
  return new;
end $$;

drop trigger if exists housing_incident_multichannel_notification on public.housing_incidents;
create trigger housing_incident_multichannel_notification
after insert or update of severity,status on public.housing_incidents
for each row execute function public.housing_notify_critical_incident();

create or replace function public.housing_prepare_weekly_digest() returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_company uuid:=public.housing_current_company_id();
  v_settings public.housing_notification_settings;
  v_license_count integer;
  v_maintenance_count integer;
  v_period text:=to_char(date_trunc('week',current_date),'YYYY-MM-DD');
begin
  if v_company is null or not public.housing_has_permission('notifications','manage') then raise exception 'Not authorized.'; end if;
  insert into public.housing_notification_settings(company_id) values(v_company) on conflict do nothing;
  select * into v_settings from public.housing_notification_settings where company_id=v_company;
  select count(*)::integer into v_license_count from public.housing_licenses
    where company_id=v_company and status not in ('Cancelled','Suspended')
      and expiry_date<=current_date+v_settings.license_days_before;
  select count(*)::integer into v_maintenance_count from public.housing_maintenance_requests
    where company_id=v_company and status in ('Open','Assigned','In Progress')
      and coalesce(due_at,created_at+make_interval(hours=>v_settings.maintenance_sla_hours))<now();
  return public.housing_emit_notification(
    v_company,null,'WEEKLY_DIGEST',case when v_license_count+v_maintenance_count>0 then 'Warning' else 'Info' end,
    'الملخص الأسبوعي للسكنات','Weekly housing digest',
    'تراخيص قريبة/منتهية: '||v_license_count||'، وصيانة متأخرة: '||v_maintenance_count,
    'Licenses due/expired: '||v_license_count||'; overdue maintenance: '||v_maintenance_count,
    'housing_weekly_digest',null,v_settings.weekly_digest_channels,'weekly-digest:'||v_period,
    jsonb_build_object('license_count',v_license_count,'overdue_maintenance_count',v_maintenance_count,'period',v_period)
  );
end $$;

create or replace function public.housing_mark_notification_read(p_event_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  if not public.housing_has_permission('notifications','read') then raise exception 'Not authorized.'; end if;
  update public.housing_notification_events set status='Read',read_at=now(),read_by=auth.uid()
  where id=p_event_id and company_id=public.housing_current_company_id();
end $$;

create or replace function public.housing_retry_notification_delivery(p_delivery_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  if not public.housing_has_permission('notifications','manage') then raise exception 'Not authorized.'; end if;
  update public.housing_notification_deliveries
  set status='Queued',available_at=now(),last_error=null
  where id=p_delivery_id and company_id=public.housing_current_company_id() and status='Failed';
end $$;

create or replace function public.housing_claim_notification_deliveries(p_limit integer default 20)
returns setof public.housing_notification_deliveries
language plpgsql security definer set search_path=public as $$
begin
  return query
  with claimed as (
    select id from public.housing_notification_deliveries
    where status in ('Queued','Failed') and available_at<=now() and attempts<5
    order by available_at,created_at
    for update skip locked limit greatest(1,least(coalesce(p_limit,20),100))
  )
  update public.housing_notification_deliveries d
  set status='Processing',attempts=d.attempts+1,updated_at=now()
  from claimed where d.id=claimed.id returning d.*;
end $$;

create or replace function public.housing_prepare_due_weekly_digests() returns integer
language plpgsql security definer set search_path=public as $$
declare
  v_settings public.housing_notification_settings;
  v_local timestamp;
  v_period text;
  v_license_count integer;
  v_maintenance_count integer;
  v_created integer:=0;
begin
  for v_settings in select * from public.housing_notification_settings loop
    v_local:=now() at time zone v_settings.timezone;
    if extract(dow from v_local)::integer<>v_settings.digest_weekday or extract(hour from v_local)::integer<>v_settings.digest_hour then continue; end if;
    v_period:=to_char(date_trunc('week',v_local::date),'YYYY-MM-DD');
    if exists(select 1 from public.housing_notification_events where company_id=v_settings.company_id and dedupe_key='weekly-digest:'||v_period) then continue; end if;
    select count(*)::integer into v_license_count from public.housing_licenses
      where company_id=v_settings.company_id and status not in ('Cancelled','Suspended')
        and expiry_date<=v_local::date+v_settings.license_days_before;
    select count(*)::integer into v_maintenance_count from public.housing_maintenance_requests
      where company_id=v_settings.company_id and status in ('Open','Assigned','In Progress')
        and coalesce(due_at,created_at+make_interval(hours=>v_settings.maintenance_sla_hours))<now();
    perform public.housing_emit_notification(
      v_settings.company_id,null,'WEEKLY_DIGEST',case when v_license_count+v_maintenance_count>0 then 'Warning' else 'Info' end,
      'الملخص الأسبوعي للسكنات','Weekly housing digest',
      'تراخيص قريبة/منتهية: '||v_license_count||'، وصيانة متأخرة: '||v_maintenance_count,
      'Licenses due/expired: '||v_license_count||'; overdue maintenance: '||v_maintenance_count,
      'housing_weekly_digest',null,v_settings.weekly_digest_channels,'weekly-digest:'||v_period,
      jsonb_build_object('license_count',v_license_count,'overdue_maintenance_count',v_maintenance_count,'period',v_period)
    );
    v_created:=v_created+1;
  end loop;
  return v_created;
end $$;

create or replace function public.housing_has_permission(p_module text,p_action text default 'read') returns boolean
language sql stable security definer set search_path=public as $$
  select case public.housing_current_role()
    when 'Admin' then true
    when 'Housing Manager' then p_module <> 'users'
    when 'Housing Supervisor' then p_module in ('dashboard','housing','occupancy','inspections','safety','welfare','operations','maintenance','assets','reports','notifications')
    when 'Maintenance' then p_module in ('dashboard','housing','maintenance','assets','reports') or (p_module='notifications' and p_action='read')
    when 'Finance' then p_module in ('dashboard','housing','finance','reports') or (p_module='notifications' and p_action='read')
    when 'Viewer' then p_action='read'
    else false end
$$;

alter table public.housing_notification_settings enable row level security;
alter table public.housing_notification_recipients enable row level security;
alter table public.housing_notification_events enable row level security;
alter table public.housing_notification_deliveries enable row level security;

create policy housing_notification_settings_select on public.housing_notification_settings for select to authenticated
using(company_id=public.housing_current_company_id() and public.housing_has_permission('notifications','read'));
create policy housing_notification_settings_manage on public.housing_notification_settings for all to authenticated
using(company_id=public.housing_current_company_id() and public.housing_has_permission('notifications','manage'))
with check(company_id=public.housing_current_company_id() and public.housing_has_permission('notifications','manage'));
create policy housing_notification_recipients_select on public.housing_notification_recipients for select to authenticated
using(company_id=public.housing_current_company_id() and public.housing_has_permission('notifications','read'));
create policy housing_notification_recipients_manage on public.housing_notification_recipients for all to authenticated
using(company_id=public.housing_current_company_id() and public.housing_has_permission('notifications','manage'))
with check(company_id=public.housing_current_company_id() and public.housing_has_permission('notifications','manage'));
create policy housing_notification_events_select on public.housing_notification_events for select to authenticated
using(company_id=public.housing_current_company_id() and public.housing_has_permission('notifications','read'));
create policy housing_notification_deliveries_select on public.housing_notification_deliveries for select to authenticated
using(company_id=public.housing_current_company_id() and public.housing_has_permission('notifications','read'));

grant select,insert,update,delete on public.housing_notification_settings,public.housing_notification_recipients to authenticated;
grant select on public.housing_notification_events,public.housing_notification_deliveries to authenticated;
grant execute on function public.housing_prepare_weekly_digest(),public.housing_mark_notification_read(uuid),public.housing_retry_notification_delivery(uuid) to authenticated;
grant execute on function public.housing_claim_notification_deliveries(integer) to service_role;
grant execute on function public.housing_prepare_due_weekly_digests() to service_role;
revoke execute on function public.housing_emit_notification(uuid,uuid,text,text,text,text,text,text,text,uuid,text[],text,jsonb) from public,anon,authenticated;
revoke execute on function public.housing_notify_critical_incident() from public,anon,authenticated;
revoke execute on function public.housing_claim_notification_deliveries(integer) from public,anon,authenticated;
revoke execute on function public.housing_prepare_due_weekly_digests() from public,anon,authenticated;
