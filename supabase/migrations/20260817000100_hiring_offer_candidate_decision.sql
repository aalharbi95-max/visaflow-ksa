-- Secure candidate accept/decline flow for Hiring Pipeline job offers.
alter table public.company_hiring_offers
  add column if not exists decision_token uuid not null default gen_random_uuid(),
  add column if not exists responded_at timestamptz,
  add column if not exists decline_reason text;

create unique index if not exists company_hiring_offers_decision_token_uidx
  on public.company_hiring_offers(decision_token);

create or replace function public.respond_company_hiring_offer(p_token text, p_response text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_token uuid;
  v_offer public.company_hiring_offers;
  v_application public.company_hiring_pipeline;
  v_message text;
begin
  if p_response not in ('Accepted','Declined') then
    raise exception using errcode = '22023', message = 'Response must be Accepted or Declined.';
  end if;
  begin v_token := p_token::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'The offer response link is invalid.';
  end;

  select offer.* into v_offer from public.company_hiring_offers offer
  where offer.decision_token = v_token for update;
  if v_offer.id is null then raise exception using errcode = 'P0002', message = 'The offer response link is invalid.'; end if;
  if v_offer.status in ('Accepted','Declined') then
    return jsonb_build_object('status',v_offer.status,'position_title',v_offer.position_title,'already_decided',true);
  end if;
  if v_offer.status <> 'Sent' then raise exception using errcode = '22023', message = 'This offer is no longer awaiting a response.'; end if;
  if v_offer.expires_at < current_date then
    update public.company_hiring_offers set status='Expired',updated_at=now() where id=v_offer.id;
    raise exception using errcode = '22023', message = 'This offer has expired.';
  end if;

  update public.company_hiring_offers set
    status=p_response, responded_at=now(),
    decline_reason=case when p_response='Declined' then nullif(left(btrim(p_reason),500),'') else null end,
    updated_at=now()
  where id=v_offer.id;

  select application.* into v_application from public.company_hiring_pipeline application
  where application.id=v_offer.application_id and application.company_id=v_offer.company_id for update;

  if p_response='Declined' and v_application.id is not null and v_application.stage='Offer' then
    update public.company_hiring_pipeline set stage='Rejected',stage_entered_at=now(),updated_at=now()
    where id=v_application.id;
    insert into public.company_hiring_pipeline_events(company_id,application_id,from_stage,to_stage,note,changed_by_auth_user_id)
    values(v_offer.company_id,v_application.id,'Offer','Rejected','Candidate declined the job offer.',null);
  end if;

  v_message := v_offer.candidate_name_snapshot || case when p_response='Accepted' then ' accepted' else ' declined' end
    || ' the job offer for ' || v_offer.position_title || '.';
  if p_response='Declined' and nullif(btrim(p_reason),'') is not null then
    v_message := v_message || ' Reason: ' || left(btrim(p_reason),500);
  end if;

  insert into public.notification_events(
    company_id,recipient_role,type,title,message,priority,status,related_table,related_id,
    response_status,response_at,dedupe_key,data
  ) values (
    v_offer.company_id,null,
    case when p_response='Accepted' then 'HIRING_OFFER_ACCEPTED' else 'HIRING_OFFER_DECLINED' end,
    case when p_response='Accepted' then 'Job offer accepted' else 'Job offer declined' end,
    v_message,case when p_response='Declined' then 'High' else 'Medium' end,'Unread',
    'company_hiring_offers',v_offer.id::text,p_response,now(),
    'hiring-offer:'||v_offer.id::text||':candidate:'||lower(p_response),
    jsonb_build_object('offer_id',v_offer.id,'application_id',v_offer.application_id,'candidate_name',v_offer.candidate_name_snapshot,'position_title',v_offer.position_title,'decision',p_response,'decline_reason',case when p_response='Declined' then nullif(left(btrim(p_reason),500),'') else null end)
  ) on conflict (company_id,dedupe_key) where dedupe_key is not null do nothing;

  return jsonb_build_object('status',p_response,'position_title',v_offer.position_title,'candidate_name',v_offer.candidate_name_snapshot);
end; $$;

revoke all on function public.respond_company_hiring_offer(text,text,text) from public,authenticated;
grant execute on function public.respond_company_hiring_offer(text,text,text) to anon;

create or replace function public.list_company_hiring_pipeline()
returns jsonb language plpgsql security definer stable set search_path = '' as $$
declare v_company_id uuid := public.current_app_user_company_id(); v_jobs jsonb; v_applications jsonb;
begin
  if auth.uid() is null or v_company_id is null then raise exception using errcode='42501',message='Company authentication is required.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',job.id,'job_code',job.job_code,'title',job.title,'department',job.department,'location',job.location,'source',job.source,'external_job_id',job.external_job_id,'status',job.status,'created_at',job.created_at) order by job.created_at desc),'[]'::jsonb)
  into v_jobs from public.company_hiring_jobs job where job.company_id=v_company_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',application.id,'job_id',application.job_id,'candidate_source',application.candidate_source,'candidate_id',application.candidate_id,
    'stage',application.stage,'stage_entered_at',application.stage_entered_at,'notes',application.notes,'created_at',application.created_at,
    'candidate_name',case application.candidate_source
      when 'Registered Talent' then coalesce(case when registered.employer_contact_sharing_consent then registered.full_name end,registered.public_reference,'Confidential candidate')
      when 'Imported Talent' then coalesce(case when contact.status='Approved' then imported.full_name end,'VF-IMP-'||upper(substr(replace(imported.id::text,'-',''),1,10)))
      else coalesce(company_candidate.candidate_name,'Candidate') end,
    'profession',coalesce(registered.profession,imported.current_title,imported.source_job_title,company_candidate.profession),
    'contact_status',case application.candidate_source when 'Registered Talent' then case when registered.employer_contact_sharing_consent then 'Shared' else 'Private' end when 'Imported Talent' then coalesce(contact.status,'Private') else 'Shared' end,
    'email',case application.candidate_source when 'Registered Talent' then case when registered.employer_contact_sharing_consent then registered.email end when 'Imported Talent' then case when contact.status='Approved' then imported.email end else company_candidate.email end,
    'phone',case application.candidate_source when 'Registered Talent' then case when registered.employer_contact_sharing_consent then registered.phone end when 'Imported Talent' then case when contact.status='Approved' then imported.phone end else company_candidate.mobile end,
    'offer_id',latest_offer.id,'offer_status',latest_offer.status,'offer_responded_at',latest_offer.responded_at,'offer_decline_reason',latest_offer.decline_reason
  ) order by application.updated_at desc),'[]'::jsonb) into v_applications
  from public.company_hiring_pipeline application
  left join public.talent_candidates registered on application.candidate_source='Registered Talent' and registered.id=application.candidate_id
  left join public.talent_imported_prospects imported on application.candidate_source='Imported Talent' and imported.id=application.candidate_id
  left join public.talent_company_contact_requests contact on application.candidate_source='Imported Talent' and contact.company_id=v_company_id and contact.prospect_id=application.candidate_id
  left join public.candidates company_candidate on application.candidate_source='Company Candidate' and company_candidate.company_id=v_company_id and company_candidate.id=application.candidate_id
  left join lateral (select offer.id,offer.status,offer.responded_at,offer.decline_reason from public.company_hiring_offers offer where offer.company_id=v_company_id and offer.application_id=application.id order by offer.created_at desc limit 1) latest_offer on true
  where application.company_id=v_company_id;
  return jsonb_build_object('jobs',v_jobs,'applications',v_applications);
end; $$;

revoke all on function public.list_company_hiring_pipeline() from public,anon;
grant execute on function public.list_company_hiring_pipeline() to authenticated;
