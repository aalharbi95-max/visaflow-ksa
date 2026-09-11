-- Allow subscribed company users to read only candidate CV objects that were
-- explicitly shared with employers. The storage policy must not query private
-- Talent tables as the caller, otherwise Postgres raises permission denied.

create or replace function public.can_current_company_read_talent_cv(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and nullif(btrim(p_storage_path), '') is not null
    and exists (
      select 1
      from public.talent_candidate_documents as document
      join public.talent_candidates as candidate
        on candidate.id = document.candidate_id
      join public.talent_public_campaign_applications as application
        on application.cv_document_id = document.id
      join public.platform_clients as client
        on client.operational_company_id = public.current_app_user_company_id()
      where document.storage_path = p_storage_path
        and application.cv_sharing_consent is true
        and candidate.marketplace_status = 'Approved'
        and candidate.published_at is not null
        and candidate.employer_sharing_consent is true
        and candidate.employer_contact_sharing_consent is true
        and client.talent_access_enabled is true
        and lower(coalesce(client.subscription_status, '')) in ('active', 'trial')
    );
$$;

revoke all on function public.can_current_company_read_talent_cv(text) from public, anon;
grant execute on function public.can_current_company_read_talent_cv(text) to authenticated, service_role;

drop policy if exists talent_cv_subscribed_company_read on storage.objects;
create policy talent_cv_subscribed_company_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'talent-cv'
  and public.can_current_company_read_talent_cv(name)
);

