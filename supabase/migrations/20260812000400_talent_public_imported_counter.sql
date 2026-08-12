-- Publish an aggregate-only imported prospect count on the public Talent page.
-- No prospect identity, contact detail, or row-level record is exposed.

drop function if exists public.get_talent_public_stats();

create function public.get_talent_public_stats()
returns table(
  registered_candidates bigint,
  marketplace_ready bigint,
  completed_ai_interviews bigint,
  imported_prospects bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*)::bigint from public.talent_candidates),
    (select count(*)::bigint
      from public.talent_candidates candidate
      where candidate.marketplace_status = 'Approved'
        and candidate.is_verified is true
        and candidate.published_at is not null
        and candidate.employer_sharing_consent = true
        and candidate.profile_visibility in ('Anonymized', 'Public')),
    (select count(*)::bigint
      from public.talent_candidates candidate
      where candidate.ai_interview_status = 'Completed'),
    (select count(*)::bigint
      from public.talent_imported_prospects prospect
      where prospect.status in ('Awaiting Candidate', 'Invitation Queued', 'Invitation Sent'));
$$;

revoke all on function public.get_talent_public_stats() from public;
grant execute on function public.get_talent_public_stats() to anon, authenticated, service_role;
