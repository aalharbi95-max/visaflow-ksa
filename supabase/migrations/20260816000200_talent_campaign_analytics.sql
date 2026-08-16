create extension if not exists pgcrypto;

create table if not exists public.talent_campaign_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.talent_public_campaigns(id) on delete cascade,
  event_type text not null check (event_type in ('page_view')),
  visitor_hash text not null,
  source text,
  medium text,
  utm_campaign text,
  event_date date not null default current_date,
  created_at timestamptz not null default now(),
  constraint talent_campaign_events_daily_unique unique (campaign_id, event_type, visitor_hash, event_date)
);

create index if not exists talent_campaign_events_campaign_created_idx
  on public.talent_campaign_events (campaign_id, created_at desc);

alter table public.talent_campaign_events enable row level security;

create or replace function public.track_public_talent_campaign_event(
  p_slug text,
  p_event_type text,
  p_visitor_id text,
  p_source text default null,
  p_medium text default null,
  p_utm_campaign text default null
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_campaign_id uuid;
  v_visitor_hash text;
begin
  if p_event_type <> 'page_view' or length(coalesce(p_visitor_id, '')) < 16 then
    return false;
  end if;

  select campaign.id into v_campaign_id
  from public.talent_public_campaigns campaign
  where campaign.slug = nullif(btrim(p_slug), '')
    and campaign.status = 'Active'
    and (campaign.registration_starts_at is null or campaign.registration_starts_at <= now())
    and (campaign.registration_ends_at is null or campaign.registration_ends_at >= now());

  if v_campaign_id is null then return false; end if;

  v_visitor_hash := encode(extensions.digest(p_visitor_id || ':' || v_campaign_id::text, 'sha256'), 'hex');
  insert into public.talent_campaign_events (
    campaign_id, event_type, visitor_hash, source, medium, utm_campaign
  ) values (
    v_campaign_id, p_event_type, v_visitor_hash,
    left(nullif(btrim(p_source), ''), 120),
    left(nullif(btrim(p_medium), ''), 120),
    left(nullif(btrim(p_utm_campaign), ''), 160)
  ) on conflict (campaign_id, event_type, visitor_hash, event_date) do nothing;
  return true;
end;
$$;

create or replace function public.get_owner_talent_campaign_dashboard(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.users platform_user
    where platform_user.auth_user_id = auth.uid() and platform_user.company_id is null
      and platform_user.is_active is true and lower(coalesce(platform_user.status, '')) = 'active'
      and platform_user.role in ('Platform Owner', 'Platform Accounts User', 'Platform Support User')) then
    raise exception using errcode = '42501', message = 'access denied';
  end if;

  select jsonb_build_object(
    'campaign', jsonb_build_object('id', campaign.id, 'slug', campaign.slug, 'name_en', campaign.name_en, 'name_ar', campaign.name_ar, 'status', campaign.status),
    'views', (select count(*) from public.talent_campaign_events event where event.campaign_id = campaign.id and event.event_type = 'page_view'),
    'unique_visitors', (select count(distinct event.visitor_hash) from public.talent_campaign_events event where event.campaign_id = campaign.id and event.event_type = 'page_view'),
    'registered', count(application.id),
    'started', count(application.id) filter (where application.status in ('Opened','In Progress','Processing','Completed')),
    'completed', count(application.id) filter (where application.status = 'Completed'),
    'result_sharing_granted', count(application.id) filter (where application.result_sharing_consent is true),
    'sources', coalesce((select jsonb_agg(source_row order by (source_row->>'visitors')::bigint desc) from (
      select jsonb_build_object(
        'source', coalesce(event.source, 'Direct'), 'medium', coalesce(event.medium, '-'),
        'visitors', count(distinct event.visitor_hash)
      ) source_row
      from public.talent_campaign_events event
      where event.campaign_id = campaign.id and event.event_type = 'page_view'
      group by coalesce(event.source, 'Direct'), coalesce(event.medium, '-')
    ) grouped_sources), '[]'::jsonb),
    'applications', coalesce(jsonb_agg(jsonb_build_object(
      'id', application.id, 'candidate_reference', candidate.public_reference,
      'candidate_name', candidate.full_name, 'profession', application.profession,
      'status', application.status, 'result_sharing_consent', application.result_sharing_consent,
      'score', case when application.result_sharing_consent then session.overall_score else null end,
      'created_at', application.created_at
    ) order by application.created_at desc) filter (where application.id is not null), '[]'::jsonb)
  ) into v_result
  from public.talent_public_campaigns campaign
  left join public.talent_public_campaign_applications application on application.campaign_id = campaign.id
  left join public.talent_candidates candidate on candidate.id = application.candidate_id
  left join public.ai_interview_sessions session on session.id = application.ai_interview_session_id
  where campaign.slug = nullif(btrim(p_slug), '') group by campaign.id;
  return v_result;
end;
$$;

revoke all on table public.talent_campaign_events from public, anon, authenticated;
revoke all on function public.track_public_talent_campaign_event(text,text,text,text,text,text) from public;
grant execute on function public.track_public_talent_campaign_event(text,text,text,text,text,text) to anon, authenticated, service_role;
revoke all on function public.get_owner_talent_campaign_dashboard(text) from public, anon;
grant execute on function public.get_owner_talent_campaign_dashboard(text) to authenticated;
