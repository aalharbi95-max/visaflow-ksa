-- Synchronize imported Talent contact decisions with company hiring pipelines.

create or replace function public.sync_imported_talent_contact_decision_to_pipeline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application public.company_hiring_pipeline;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'Declined' then
    for v_application in
      select application.*
      from public.company_hiring_pipeline application
      where application.company_id = new.company_id
        and application.candidate_source = 'Imported Talent'
        and application.candidate_id = new.prospect_id
        and application.stage <> 'Rejected'
      for update
    loop
      update public.company_hiring_pipeline
      set stage = 'Rejected',
          stage_entered_at = now(),
          notes = coalesce(notes || E'\n', '') || 'Candidate declined company contact sharing.',
          updated_at = now()
      where id = v_application.id;

      insert into public.company_hiring_pipeline_events(
        company_id, application_id, from_stage, to_stage, note, changed_by_auth_user_id
      ) values (
        v_application.company_id, v_application.id, v_application.stage, 'Rejected',
        'Candidate declined company contact sharing.', v_application.created_by_auth_user_id
      );
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_imported_talent_contact_decision_to_pipeline
  on public.talent_company_contact_requests;
create trigger sync_imported_talent_contact_decision_to_pipeline
after update of status on public.talent_company_contact_requests
for each row
when (new.status is distinct from old.status)
execute function public.sync_imported_talent_contact_decision_to_pipeline();

create or replace function public.list_company_hiring_pipeline()
returns jsonb
language plpgsql security definer stable set search_path = '' as $$
declare v_company_id uuid := public.current_app_user_company_id(); v_jobs jsonb; v_applications jsonb;
begin
  if auth.uid() is null or v_company_id is null then raise exception using errcode = '42501', message = 'Company authentication is required.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', job.id, 'job_code', job.job_code, 'title', job.title, 'department', job.department, 'location', job.location, 'source', job.source, 'external_job_id', job.external_job_id, 'status', job.status, 'created_at', job.created_at) order by job.created_at desc), '[]'::jsonb)
  into v_jobs from public.company_hiring_jobs job where job.company_id = v_company_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', application.id, 'job_id', application.job_id, 'candidate_source', application.candidate_source,
    'candidate_id', application.candidate_id, 'stage', application.stage, 'stage_entered_at', application.stage_entered_at,
    'notes', application.notes, 'created_at', application.created_at,
    'candidate_name', case application.candidate_source
      when 'Registered Talent' then coalesce(case when registered.employer_contact_sharing_consent then registered.full_name end, registered.public_reference, 'Confidential candidate')
      when 'Imported Talent' then coalesce(case when contact.status = 'Approved' then imported.full_name end, 'VF-IMP-' || upper(substr(replace(imported.id::text, '-', ''), 1, 10)))
      else coalesce(company_candidate.candidate_name, 'Candidate') end,
    'profession', coalesce(registered.profession, imported.current_title, imported.source_job_title, company_candidate.profession),
    'contact_status', case application.candidate_source when 'Registered Talent' then case when registered.employer_contact_sharing_consent then 'Shared' else 'Private' end when 'Imported Talent' then coalesce(contact.status, 'Private') else 'Shared' end,
    'email', case application.candidate_source
      when 'Registered Talent' then case when registered.employer_contact_sharing_consent then registered.email end
      when 'Imported Talent' then case when contact.status = 'Approved' then imported.email end
      else company_candidate.email end,
    'phone', case application.candidate_source
      when 'Registered Talent' then case when registered.employer_contact_sharing_consent then registered.phone end
      when 'Imported Talent' then case when contact.status = 'Approved' then imported.phone end
      else company_candidate.mobile end
  ) order by application.updated_at desc), '[]'::jsonb)
  into v_applications
  from public.company_hiring_pipeline application
  left join public.talent_candidates registered on application.candidate_source = 'Registered Talent' and registered.id = application.candidate_id
  left join public.talent_imported_prospects imported on application.candidate_source = 'Imported Talent' and imported.id = application.candidate_id
  left join public.talent_company_contact_requests contact on application.candidate_source = 'Imported Talent' and contact.company_id = v_company_id and contact.prospect_id = application.candidate_id
  left join public.candidates company_candidate on application.candidate_source = 'Company Candidate' and company_candidate.company_id = v_company_id and company_candidate.id = application.candidate_id
  where application.company_id = v_company_id;
  return jsonb_build_object('jobs', v_jobs, 'applications', v_applications);
end;
$$;

revoke all on function public.list_company_hiring_pipeline() from public, anon;
grant execute on function public.list_company_hiring_pipeline() to authenticated;
