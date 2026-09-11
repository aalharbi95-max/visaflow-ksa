-- Resolve the latest active Talent campaign assigned to the signed-in candidate.
-- This lets individual campaigns appear even when the candidate enters Talent
-- from a generic link that has no talent_campaign query parameter.

create or replace function public.get_my_latest_talent_campaign()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(result)
  from (
    select campaign.slug, campaign.name_en, campaign.name_ar,
      application.status, application.created_at
    from public.talent_public_campaign_applications application
    join public.talent_public_campaigns campaign on campaign.id = application.campaign_id
    join public.talent_candidates candidate on candidate.id = application.candidate_id
    where auth.uid() is not null
      and candidate.auth_user_id = auth.uid()
      and campaign.status = 'Active'
      and (campaign.registration_starts_at is null or campaign.registration_starts_at <= now())
      and (campaign.registration_ends_at is null or campaign.registration_ends_at >= now())
    order by application.created_at desc
    limit 1
  ) result;
$$;

revoke all on function public.get_my_latest_talent_campaign() from public, anon;
grant execute on function public.get_my_latest_talent_campaign() to authenticated;
