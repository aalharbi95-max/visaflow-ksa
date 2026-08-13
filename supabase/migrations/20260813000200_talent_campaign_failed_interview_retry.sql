-- Allow a candidate to retry only when interview processing failed and no score exists.
-- Previous sessions remain immutable and linked from the campaign application history.

alter table public.talent_public_campaign_applications
  add column if not exists retry_count integer not null default 0,
  add column if not exists last_retry_at timestamptz,
  add column if not exists previous_session_ids uuid[] not null default '{}'::uuid[];

alter table public.talent_public_campaign_applications
  drop constraint if exists talent_public_campaign_applications_retry_count_check;

alter table public.talent_public_campaign_applications
  add constraint talent_public_campaign_applications_retry_count_check
  check (retry_count between 0 and 2);

create or replace function public.get_my_talent_campaign_application(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(result)
  from (
    select application.id, application.status, application.profession,
      application.result_sharing_consent, application.created_at,
      application.retry_count, application.last_retry_at,
      session.id as session_id, session.invitation_url, session.status as interview_status,
      session.overall_score, session.ai_recommendation, session.analysis_status,
      session.analysis_error,
      (
        application.retry_count < 2
        and session.overall_score is null
        and (
          session.analysis_status = 'Failed'
          or session.status in ('Failed', 'Expired')
        )
      ) as can_retry
    from public.talent_public_campaign_applications application
    join public.talent_public_campaigns campaign on campaign.id = application.campaign_id
    join public.talent_candidates candidate on candidate.id = application.candidate_id
    left join public.ai_interview_sessions session on session.id = application.ai_interview_session_id
    where auth.uid() is not null
      and candidate.auth_user_id = auth.uid()
      and campaign.slug = nullif(btrim(p_slug), '')
    limit 1
  ) result;
$$;

create or replace function public.retry_my_talent_campaign_interview(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.talent_public_campaigns%rowtype;
  v_candidate public.talent_candidates%rowtype;
  v_application public.talent_public_campaign_applications%rowtype;
  v_template public.ai_interview_templates%rowtype;
  v_previous_session public.ai_interview_sessions%rowtype;
  v_new_session_id uuid;
  v_question_count integer;
  v_access_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_invitation_url text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Candidate authentication is required.';
  end if;

  select campaign.* into v_campaign
  from public.talent_public_campaigns campaign
  where campaign.slug = nullif(btrim(p_slug), '')
    and campaign.status = 'Active'
    and (campaign.registration_starts_at is null or campaign.registration_starts_at <= now())
    and (campaign.registration_ends_at is null or campaign.registration_ends_at >= now());
  if not found then
    raise exception using errcode = 'P0002', message = 'This Talent campaign is not available.';
  end if;

  select candidate.* into v_candidate
  from public.talent_candidates candidate
  where candidate.auth_user_id = auth.uid();
  if not found then
    raise exception using errcode = 'P0002', message = 'Talent profile was not found.';
  end if;

  select application.* into v_application
  from public.talent_public_campaign_applications application
  where application.campaign_id = v_campaign.id
    and application.candidate_id = v_candidate.id
  for update;
  if not found or v_application.ai_interview_session_id is null then
    raise exception using errcode = 'P0002', message = 'Campaign interview was not found.';
  end if;

  select session.* into v_previous_session
  from public.ai_interview_sessions session
  where session.id = v_application.ai_interview_session_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Interview session was not found.';
  end if;

  if v_previous_session.overall_score is not null then
    raise exception using errcode = '22023', message = 'A scored interview cannot be retried from this recovery action.';
  end if;
  if not (
    v_previous_session.analysis_status = 'Failed'
    or v_previous_session.status in ('Failed', 'Expired')
  ) then
    raise exception using errcode = '22023', message = 'This interview is not eligible for a technical retry.';
  end if;
  if v_application.retry_count >= 2 then
    raise exception using errcode = '22023', message = 'The technical retry limit has been reached.';
  end if;

  select template.* into v_template
  from public.ai_interview_templates template
  where template.id = v_application.template_id
    and public.talent_campaign_template_is_eligible(v_campaign.id, template.id);
  if not found then
    raise exception using errcode = '22023', message = 'The interview template is no longer available.';
  end if;

  select count(*)::integer into v_question_count
  from public.ai_interview_questions question
  where question.template_id = v_template.id and question.is_active is true;
  if v_question_count <= 0 then
    raise exception using errcode = '22023', message = 'The selected template has no active questions.';
  end if;

  v_invitation_url := 'https://www.visaflowksa.com/?ai_interview=' || v_access_token;

  insert into public.ai_interview_sessions (
    company_id, template_id, candidate_id, candidate_name, candidate_email,
    candidate_mobile, profession, nationality, language, interview_mode,
    interaction_mode, camera_mode, access_token, invitation_url, status,
    invitation_sent_at, expires_at, total_questions, employer_sharing_consent,
    employer_sharing_consent_at, created_by, updated_by
  ) values (
    v_template.company_id, v_template.id, v_candidate.id::text, v_candidate.full_name,
    coalesce(v_candidate.email, ''), coalesce(v_candidate.phone, ''), v_template.profession,
    coalesce(v_candidate.nationality, ''), v_template.language, v_template.interview_mode,
    v_template.interaction_mode, v_template.camera_mode, v_access_token, v_invitation_url, 'Invited',
    now(), least(coalesce(v_campaign.registration_ends_at, now() + interval '14 days'), now() + interval '14 days'),
    v_question_count, v_application.result_sharing_consent,
    case when v_application.result_sharing_consent then now() else null end,
    'Talent Campaign Technical Retry', 'Talent Campaign Technical Retry'
  ) returning id into v_new_session_id;

  update public.talent_public_campaign_applications
  set ai_interview_session_id = v_new_session_id,
      previous_session_ids = array_append(previous_session_ids, v_previous_session.id),
      retry_count = retry_count + 1,
      last_retry_at = now(),
      status = 'Invited',
      updated_at = now()
  where id = v_application.id;

  perform set_config('visaflow.talent_internal_update', '1', true);
  update public.talent_candidates
  set ai_interview_status = 'Invited',
      latest_ai_interview_session_id = v_new_session_id,
      last_active_at = now(),
      updated_at = now()
  where id = v_candidate.id;

  return jsonb_build_object(
    'application_id', v_application.id,
    'session_id', v_new_session_id,
    'invitation_url', v_invitation_url,
    'status', 'Invited',
    'retry_count', v_application.retry_count + 1
  );
end;
$$;

revoke all on function public.get_my_talent_campaign_application(text) from public, anon;
grant execute on function public.get_my_talent_campaign_application(text) to authenticated;
revoke all on function public.retry_my_talent_campaign_interview(text) from public, anon;
grant execute on function public.retry_my_talent_campaign_interview(text) to authenticated;

