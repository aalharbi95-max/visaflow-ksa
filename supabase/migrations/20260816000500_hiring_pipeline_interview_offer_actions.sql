-- Actionable interview scheduling and job offers from the hiring pipeline.

create table if not exists public.company_hiring_offers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  application_id uuid not null references public.company_hiring_pipeline(id) on delete cascade,
  candidate_name_snapshot text not null,
  recipient_email text not null,
  position_title text not null,
  salary numeric(14,2) not null,
  currency text not null default 'SAR',
  joining_date date,
  expires_at date not null,
  notes text,
  status text not null default 'Draft',
  created_by_auth_user_id uuid not null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_hiring_offer_salary_check check (salary > 0),
  constraint company_hiring_offer_currency_check check (currency in ('SAR','USD','AED','EUR')),
  constraint company_hiring_offer_status_check check (status in ('Draft','Sent','Accepted','Declined','Expired','Cancelled'))
);

create index if not exists company_hiring_offers_application_idx
  on public.company_hiring_offers(company_id, application_id, created_at desc);
alter table public.company_hiring_offers enable row level security;
revoke all on public.company_hiring_offers from public, anon, authenticated;

create or replace function public.create_company_hiring_offer(
  p_application_id uuid,
  p_salary numeric,
  p_currency text default 'SAR',
  p_joining_date date default null,
  p_expires_at date default null,
  p_notes text default null
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company_id uuid := public.current_app_user_company_id();
  v_application public.company_hiring_pipeline;
  v_job public.company_hiring_jobs;
  v_name text;
  v_email text;
  v_offer_id uuid;
begin
  if auth.uid() is null or v_company_id is null or not public.current_app_user_has_role(array['Admin','Company Admin','Recruitment Manager','Recruitment Officer','HR/Recruitment']) then
    raise exception using errcode = '42501', message = 'Recruitment permission is required.';
  end if;
  select application.* into v_application from public.company_hiring_pipeline application
  where application.id = p_application_id and application.company_id = v_company_id for update;
  if v_application.id is null or v_application.stage <> 'Interview' then
    raise exception using errcode = '22023', message = 'The candidate must be in the Interview stage.';
  end if;
  select job.* into v_job from public.company_hiring_jobs job
  where job.id = v_application.job_id and job.company_id = v_company_id;
  if p_salary is null or p_salary <= 0 then raise exception using errcode = '22023', message = 'A valid salary is required.'; end if;
  if p_currency not in ('SAR','USD','AED','EUR') then raise exception using errcode = '22023', message = 'Unsupported currency.'; end if;
  if coalesce(p_expires_at, current_date + 7) < current_date then raise exception using errcode = '22023', message = 'Offer expiry cannot be in the past.'; end if;

  if v_application.candidate_source = 'Imported Talent' then
    select prospect.full_name, prospect.email into v_name, v_email
    from public.talent_imported_prospects prospect
    join public.talent_company_contact_requests contact on contact.prospect_id = prospect.id
      and contact.company_id = v_company_id and contact.status = 'Approved'
    where prospect.id = v_application.candidate_id;
  elsif v_application.candidate_source = 'Registered Talent' then
    select candidate.full_name, candidate.email into v_name, v_email
    from public.talent_candidates candidate
    where candidate.id = v_application.candidate_id and candidate.employer_contact_sharing_consent is true;
  else
    select candidate.candidate_name, candidate.email into v_name, v_email
    from public.candidates candidate
    where candidate.id = v_application.candidate_id and candidate.company_id = v_company_id;
  end if;
  if nullif(btrim(v_email), '') is null then
    raise exception using errcode = '42501', message = 'Approved candidate email is required before creating an offer.';
  end if;

  insert into public.company_hiring_offers(
    company_id, application_id, candidate_name_snapshot, recipient_email, position_title,
    salary, currency, joining_date, expires_at, notes, created_by_auth_user_id
  ) values (
    v_company_id, v_application.id, coalesce(nullif(btrim(v_name), ''), 'Candidate'), v_email,
    v_job.title, p_salary, p_currency, p_joining_date, coalesce(p_expires_at, current_date + 7),
    nullif(btrim(p_notes), ''), auth.uid()
  ) returning id into v_offer_id;
  return v_offer_id;
end;
$$;

create or replace function public.mark_company_hiring_offer_sent(p_offer_id uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_company_id uuid := public.current_app_user_company_id();
  v_offer public.company_hiring_offers;
  v_application public.company_hiring_pipeline;
begin
  if auth.uid() is null or v_company_id is null or not public.current_app_user_has_role(array['Admin','Company Admin','Recruitment Manager','Recruitment Officer','HR/Recruitment']) then
    raise exception using errcode = '42501', message = 'Recruitment permission is required.';
  end if;
  select offer.* into v_offer from public.company_hiring_offers offer
  where offer.id = p_offer_id and offer.company_id = v_company_id for update;
  if v_offer.id is null then raise exception using errcode = 'P0002', message = 'Hiring offer was not found.'; end if;
  select application.* into v_application from public.company_hiring_pipeline application
  where application.id = v_offer.application_id and application.company_id = v_company_id for update;
  if v_application.stage <> 'Interview' then raise exception using errcode = '22023', message = 'Candidate is no longer in the Interview stage.'; end if;

  update public.company_hiring_offers set status = 'Sent', sent_at = now(), updated_at = now() where id = v_offer.id;
  update public.company_hiring_pipeline set stage = 'Offer', stage_entered_at = now(), updated_at = now() where id = v_application.id;
  insert into public.company_hiring_pipeline_events(company_id, application_id, from_stage, to_stage, note, changed_by_auth_user_id)
  values(v_company_id, v_application.id, 'Interview', 'Offer', 'Job offer created and sent from Hiring Pipeline.', auth.uid());
  return 'Offer';
end;
$$;

revoke all on function public.create_company_hiring_offer(uuid,numeric,text,date,date,text) from public, anon;
grant execute on function public.create_company_hiring_offer(uuid,numeric,text,date,date,text) to authenticated;
revoke all on function public.mark_company_hiring_offer_sent(uuid) from public, anon;
grant execute on function public.mark_company_hiring_offer_sent(uuid) to authenticated;
