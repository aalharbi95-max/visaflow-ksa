-- Automatically invoke the private analysis worker when an interview completes,
-- with a one-minute cron fallback for retries and interrupted browser sessions.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema extensions;

create or replace function public.trigger_ai_interview_analysis_worker()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault, net
as $$
declare
  v_worker_url text;
  v_worker_secret text;
  v_request_id bigint;
begin
  select ds.decrypted_secret into v_worker_url
  from vault.decrypted_secrets ds
  where ds.name = 'visaflow_ai_interview_analysis_worker_url';

  select ds.decrypted_secret into v_worker_secret
  from vault.decrypted_secrets ds
  where ds.name = 'visaflow_ai_interview_worker_secret';

  if coalesce(v_worker_url, '') = '' or coalesce(v_worker_secret, '') = '' then
    return null;
  end if;

  select net.http_post(
    url := v_worker_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-visaflow-worker-secret', v_worker_secret
    ),
    body := jsonb_build_object('source', 'automatic-analysis', 'max_jobs', 1),
    timeout_milliseconds := 300000
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function public.trigger_ai_interview_analysis_worker() from public, anon, authenticated;
grant execute on function public.trigger_ai_interview_analysis_worker() to service_role;

revoke all on function public.claim_ai_interview_analysis_job(text) from public, anon, authenticated;
grant execute on function public.claim_ai_interview_analysis_job(text) to service_role;
revoke all on function public.complete_ai_interview_analysis_job(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_ai_interview_analysis_job(uuid, jsonb) to service_role;
revoke all on function public.fail_ai_interview_analysis_job(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_ai_interview_analysis_job(uuid, text) to service_role;
revoke all on function public.queue_ai_interview_analysis(uuid) from public, anon, authenticated;
grant execute on function public.queue_ai_interview_analysis(uuid) to service_role;

create or replace function public.enqueue_ai_interview_analysis_on_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.queue_ai_interview_analysis(new.id);
  perform public.trigger_ai_interview_analysis_worker();
  return new;
exception when others then
  update public.ai_interview_sessions
  set analysis_status = 'Failed', analysis_error = left(sqlerrm, 2000), updated_at = now()
  where id = new.id;
  return new;
end;
$$;

do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'visaflow-ai-interview-analysis-every-minute';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'visaflow-ai-interview-analysis-every-minute',
    '* * * * *',
    'select public.trigger_ai_interview_analysis_worker();'
  );
end $$;

do $$
declare v_session record;
begin
  for v_session in
    select s.id from public.ai_interview_sessions s
    where s.status = 'Completed' and s.analysis_status in ('Pending', 'Failed', 'Needs Review')
  loop
    perform public.queue_ai_interview_analysis(v_session.id);
  end loop;
end $$;
