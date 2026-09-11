-- Required registration consent for candidates who choose to expose their
-- complete profile and contact data to subscribed companies. Imported Excel
-- cards remain anonymous until the person completes their own registration.

alter table public.talent_candidates
  add column if not exists registration_company_data_consent boolean not null default false,
  add column if not exists registration_company_data_consent_version text,
  add column if not exists registration_company_data_consent_at timestamptz,
  add column if not exists registration_company_data_consent_language text;

alter table public.talent_candidates
  drop constraint if exists talent_candidates_registration_company_data_consent_check;
alter table public.talent_candidates
  add constraint talent_candidates_registration_company_data_consent_check check (
    registration_company_data_consent is false
    or (
      nullif(btrim(registration_company_data_consent_version), '') is not null
      and registration_company_data_consent_at is not null
    )
  );

create or replace function public.complete_my_talent_registration(
  p_consent_version text default '1.0',
  p_language text default 'AR'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate public.talent_candidates%rowtype;
  v_prospect public.talent_imported_prospects%rowtype;
  v_first_record boolean := false;
  v_claimed integer := 0;
  v_now timestamptz := now();
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Candidate authentication is required.';
  end if;
  if nullif(btrim(coalesce(p_consent_version, '')), '') is null then
    raise exception using errcode = '22023', message = 'Consent version is required.';
  end if;

  select candidate.* into v_candidate
  from public.talent_candidates candidate
  where candidate.auth_user_id = auth.uid()
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Candidate profile was not found.';
  end if;

  v_first_record := v_candidate.registration_company_data_consent_at is null;
  if v_first_record then
    update public.talent_candidates candidate
    set registration_company_data_consent = true,
        registration_company_data_consent_version = btrim(p_consent_version),
        registration_company_data_consent_at = v_now,
        registration_company_data_consent_language = upper(left(coalesce(nullif(btrim(p_language), ''), 'AR'), 5)),
        employer_sharing_consent = true,
        employer_contact_sharing_consent = true,
        profile_visibility = 'Public',
        updated_at = v_now
    where candidate.id = v_candidate.id;

    insert into public.talent_candidate_consents (
      candidate_id, consent_type, consent_version, is_granted,
      granted_at, withdrawn_at, source, metadata, updated_at
    ) values
      (v_candidate.id, 'Employer Sharing', btrim(p_consent_version), true,
       v_now, null, 'Candidate Registration',
       jsonb_build_object('language', upper(left(coalesce(nullif(btrim(p_language), ''), 'AR'), 5)),
         'scope', 'professional_profile_and_employment_history'), v_now),
      (v_candidate.id, 'Employer Contact Sharing', btrim(p_consent_version), true,
       v_now, null, 'Candidate Registration',
       jsonb_build_object('language', upper(left(coalesce(nullif(btrim(p_language), ''), 'AR'), 5)),
         'scope', 'name_email_phone'), v_now)
    on conflict (candidate_id, consent_type, consent_version) do update set
      is_granted = true,
      granted_at = excluded.granted_at,
      withdrawn_at = null,
      source = excluded.source,
      metadata = excluded.metadata,
      updated_at = v_now;
  end if;

  -- A person imported from Excel becomes the owner of that record when the
  -- authenticated account uses the same verified email. Preserve the already
  -- approved marketplace card while eliminating the duplicate imported card.
  select prospect.* into v_prospect
  from public.talent_imported_prospects prospect
  where prospect.email_normalized = lower(btrim(coalesce(v_candidate.email, '')))
    and prospect.claimed_candidate_id is null
    and exists (
      select 1 from auth.users auth_user
      where auth_user.id = auth.uid()
        and auth_user.email_confirmed_at is not null
        and lower(btrim(coalesce(auth_user.email, ''))) = prospect.email_normalized
    )
  limit 1
  for update;

  if found then
    update public.talent_candidates candidate
    set full_name = coalesce(nullif(btrim(candidate.full_name), ''), v_prospect.full_name),
        phone = coalesce(nullif(btrim(candidate.phone), ''), v_prospect.phone),
        city = coalesce(nullif(btrim(candidate.city), ''), v_prospect.general_location),
        country_of_residence = coalesce(nullif(btrim(candidate.country_of_residence), ''), v_prospect.general_location),
        profession = coalesce(nullif(btrim(candidate.profession), ''), v_prospect.cv_specialty, v_prospect.current_title),
        headline = coalesce(nullif(btrim(candidate.headline), ''), v_prospect.cv_specialty, v_prospect.headline),
        professional_summary = coalesce(nullif(btrim(candidate.professional_summary), ''), v_prospect.cv_professional_summary),
        years_experience = coalesce(candidate.years_experience, v_prospect.cv_years_experience),
        current_company = coalesce(nullif(btrim(candidate.current_company), ''), v_prospect.current_company),
        current_job_title = coalesce(nullif(btrim(candidate.current_job_title), ''), v_prospect.current_title),
        linkedin_url = coalesce(nullif(btrim(candidate.linkedin_url), ''), v_prospect.linkedin_url),
        profile_visibility = 'Public',
        marketplace_status = 'Approved',
        employer_sharing_consent = true,
        employer_contact_sharing_consent = true,
        is_verified = true,
        verified_at = coalesce(candidate.verified_at, v_now),
        published_at = coalesce(candidate.published_at, v_now),
        profile_completeness = greatest(candidate.profile_completeness, 75),
        updated_at = v_now
    where candidate.id = v_candidate.id;

    update public.talent_imported_prospects prospect
    set claimed_candidate_id = v_candidate.id,
        claimed_at = v_now,
        status = 'Claimed',
        updated_at = v_now
    where prospect.id = v_prospect.id;
    v_claimed := 1;
  end if;

  return jsonb_build_object(
    'candidate_id', v_candidate.id,
    'consent_recorded', v_first_record,
    'imported_profile_claimed', v_claimed
  );
end;
$$;

revoke all on function public.complete_my_talent_registration(text, text) from public, anon;
grant execute on function public.complete_my_talent_registration(text, text) to authenticated;
