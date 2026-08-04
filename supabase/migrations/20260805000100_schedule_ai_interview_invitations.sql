-- Securely trigger the shared invitation worker after a company launches a campaign.
-- The recurring pg_cron job is environment configuration and is installed separately
-- because its URL and Vault secret differ between Staging and Production.

create or replace function public.trigger_ai_interview_invitation_worker(
  p_campaign_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault, net
as $$
declare
  v_company_id uuid;
  v_worker_url text;
  v_worker_secret text;
  v_request_id bigint;
begin
  select u.company_id
  into v_company_id
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.status = 'Active'
    and u.is_active = true
    and u.company_id is not null;

  if v_company_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform 1
  from public.ai_interview_campaigns c
  where c.id = p_campaign_id
    and c.company_id = v_company_id;

  if not found then
    raise exception 'campaign_not_found' using errcode = 'P0002';
  end if;

  select ds.decrypted_secret
  into v_worker_url
  from vault.decrypted_secrets ds
  where ds.name = 'visaflow_ai_interview_worker_url';

  select ds.decrypted_secret
  into v_worker_secret
  from vault.decrypted_secrets ds
  where ds.name = 'visaflow_ai_interview_worker_secret';

  if coalesce(v_worker_url, '') = '' or coalesce(v_worker_secret, '') = '' then
    raise exception 'invitation_worker_not_configured' using errcode = '55000';
  end if;

  select net.http_post(
    url := v_worker_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-visaflow-worker-secret', v_worker_secret
    ),
    body := jsonb_build_object(
      'source', 'campaign-launch',
      'company_id', v_company_id,
      'campaign_id', p_campaign_id
    ),
    timeout_milliseconds := 30000
  )
  into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.trigger_ai_interview_invitation_worker(uuid) from public, anon;
grant execute on function public.trigger_ai_interview_invitation_worker(uuid) to authenticated;

