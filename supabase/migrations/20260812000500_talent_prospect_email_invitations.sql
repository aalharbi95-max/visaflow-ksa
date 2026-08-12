-- Owner-controlled email-only invitations for imported Talent prospects.
-- Nothing is queued automatically; the Platform Owner must explicitly confirm.

alter table public.talent_imported_prospects
  add column if not exists invitation_token uuid,
  add column if not exists invitation_expires_at timestamptz,
  add column if not exists email_delivery_status text not null default 'Not Sent',
  add column if not exists email_last_attempt_at timestamptz,
  add column if not exists email_error_message text,
  add column if not exists email_provider_message_id text;

alter table public.talent_imported_prospects drop constraint if exists talent_imported_prospects_status_check;
alter table public.talent_imported_prospects add constraint talent_imported_prospects_status_check check (status in (
  'Awaiting Candidate', 'Invitation Queued', 'Invitation Sending', 'Invitation Sent', 'Claimed', 'Archived'
));
alter table public.talent_imported_prospects drop constraint if exists talent_imported_prospects_email_delivery_check;
alter table public.talent_imported_prospects add constraint talent_imported_prospects_email_delivery_check
  check (email_delivery_status in ('Not Sent', 'Queued', 'Sending', 'Sent', 'Failed'));

create unique index if not exists talent_imported_prospects_invitation_token_uidx
  on public.talent_imported_prospects(invitation_token) where invitation_token is not null;
create index if not exists talent_imported_prospects_email_queue_idx
  on public.talent_imported_prospects(email_delivery_status, created_at) where email_delivery_status in ('Queued', 'Failed');

create or replace function public.queue_talent_prospect_email_invitations()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_queued integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.users u where u.auth_user_id = auth.uid() and u.company_id is null
      and u.role = 'Platform Owner' and u.is_active is true and lower(coalesce(u.status,'')) = 'active'
  ) then raise exception using errcode='42501', message='platform owner access required'; end if;

  update public.talent_imported_prospects
  set status='Invitation Queued', email_delivery_status='Queued',
      invitation_token=gen_random_uuid(), invitation_expires_at=now()+interval '14 days',
      email_error_message=null, updated_at=now()
  where status='Awaiting Candidate' and email_delivery_status in ('Not Sent','Failed');
  get diagnostics v_queued = row_count;
  perform public.trigger_talent_prospect_email_worker();
  return jsonb_build_object('queued',v_queued);
end $$;

create or replace function public.claim_talent_prospect_email_invitation_job(p_worker text)
returns setof public.talent_imported_prospects language plpgsql security definer set search_path=public as $$
begin
  return query
  with candidate as (
    select p.id from public.talent_imported_prospects p
    where p.email_delivery_status='Queued' and p.status='Invitation Queued'
    order by p.created_at for update skip locked limit 1
  ), updated as (
    update public.talent_imported_prospects p set status='Invitation Sending', email_delivery_status='Sending',
      email_last_attempt_at=now(), updated_at=now() from candidate c where p.id=c.id returning p.*
  ) select * from updated;
end $$;

create or replace function public.complete_talent_prospect_email_invitation(p_id uuid,p_provider_id text)
returns void language sql security definer set search_path=public as $$
  update public.talent_imported_prospects set status='Invitation Sent',email_delivery_status='Sent',
    invitation_sent_at=now(),email_provider_message_id=p_provider_id,email_error_message=null,updated_at=now() where id=p_id;
$$;
create or replace function public.fail_talent_prospect_email_invitation(p_id uuid,p_error text)
returns void language sql security definer set search_path=public as $$
  update public.talent_imported_prospects set status='Awaiting Candidate',email_delivery_status='Failed',
    email_error_message=left(p_error,1000),updated_at=now() where id=p_id;
$$;

create or replace function public.trigger_talent_prospect_email_worker()
returns bigint language plpgsql security definer set search_path=public,extensions,vault,net as $$
declare v_url text; v_secret text; v_request bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name='visaflow_talent_prospect_email_worker_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='visaflow_ai_interview_worker_secret';
  if coalesce(v_url,'')='' or coalesce(v_secret,'')='' then return null; end if;
  select net.http_post(url:=v_url,headers:=jsonb_build_object('Content-Type','application/json','x-visaflow-worker-secret',v_secret),
    body:='{"max_jobs":20}'::jsonb,timeout_milliseconds:=300000) into v_request;
  return v_request;
end $$;

create or replace function public.list_owner_talent_prospects(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.users u where u.auth_user_id=auth.uid() and u.company_id is null
    and u.role in ('Platform Owner','Platform Accounts User','Platform Support User') and u.is_active and lower(coalesce(u.status,''))='active')
  then raise exception using errcode='42501',message='platform access required'; end if;
  select jsonb_build_object('total',count(*),'awaiting_candidate',count(*) filter(where status='Awaiting Candidate'),
    'queued',count(*) filter(where email_delivery_status in ('Queued','Sending')),
    'invited',count(*) filter(where email_delivery_status='Sent'),'failed',count(*) filter(where email_delivery_status='Failed'),
    'claimed',count(*) filter(where status='Claimed')) into v_result from public.talent_imported_prospects;
  return v_result;
end $$;

revoke all on function public.queue_talent_prospect_email_invitations() from public,anon,authenticated;
grant execute on function public.queue_talent_prospect_email_invitations() to authenticated;
revoke all on function public.claim_talent_prospect_email_invitation_job(text) from public,anon,authenticated;
revoke all on function public.complete_talent_prospect_email_invitation(uuid,text) from public,anon,authenticated;
revoke all on function public.fail_talent_prospect_email_invitation(uuid,text) from public,anon,authenticated;
revoke all on function public.trigger_talent_prospect_email_worker() from public,anon,authenticated;
grant execute on function public.claim_talent_prospect_email_invitation_job(text) to service_role;
grant execute on function public.complete_talent_prospect_email_invitation(uuid,text) to service_role;
grant execute on function public.fail_talent_prospect_email_invitation(uuid,text) to service_role;
grant execute on function public.trigger_talent_prospect_email_worker() to service_role;

do $$ declare j bigint; begin
 select jobid into j from cron.job where jobname='visaflow-talent-prospect-email-every-minute';
 if j is not null then perform cron.unschedule(j); end if;
 perform cron.schedule('visaflow-talent-prospect-email-every-minute','* * * * *','select public.trigger_talent_prospect_email_worker();');
end $$;
