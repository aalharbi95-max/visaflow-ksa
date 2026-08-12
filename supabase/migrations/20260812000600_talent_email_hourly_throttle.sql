-- Keep Talent campaign traffic below the shared mailbox hourly allowance.
-- The throttle counts successful and in-flight messages in a rolling 60-minute window.

create or replace function public.claim_talent_prospect_email_invitation_job(p_worker text)
returns setof public.talent_imported_prospects
language plpgsql
security definer
set search_path = public
as $$
declare
  v_in_window integer;
begin
  -- Serialize claims so concurrent worker invocations cannot cross the limit.
  perform pg_advisory_xact_lock(hashtextextended('talent-prospect-email-hourly-throttle', 0));

  -- Recover only abandoned claims; an active worker has ten minutes to finish.
  update public.talent_imported_prospects
  set status = 'Invitation Queued',
      email_delivery_status = 'Queued',
      updated_at = now()
  where status = 'Invitation Sending'
    and email_delivery_status = 'Sending'
    and email_last_attempt_at < now() - interval '10 minutes';

  select count(*)
  into v_in_window
  from public.talent_imported_prospects p
  where (p.email_delivery_status = 'Sent'
         and p.invitation_sent_at >= now() - interval '60 minutes')
     or (p.email_delivery_status = 'Sending'
         and p.email_last_attempt_at >= now() - interval '10 minutes');

  if v_in_window >= 250 then
    return;
  end if;

  return query
  with candidate as (
    select p.id
    from public.talent_imported_prospects p
    where p.email_delivery_status = 'Queued'
      and p.status = 'Invitation Queued'
    order by p.created_at
    for update skip locked
    limit 1
  ), updated as (
    update public.talent_imported_prospects p
    set status = 'Invitation Sending',
        email_delivery_status = 'Sending',
        email_last_attempt_at = now(),
        updated_at = now()
    from candidate c
    where p.id = c.id
    returning p.*
  )
  select * from updated;
end $$;

revoke all on function public.claim_talent_prospect_email_invitation_job(text)
  from public, anon, authenticated;
grant execute on function public.claim_talent_prospect_email_invitation_job(text)
  to service_role;

-- Retry the provider-limit failures after the rolling window has cleared.
update public.talent_imported_prospects
set status = 'Invitation Queued',
    email_delivery_status = 'Queued',
    email_error_message = null,
    updated_at = now()
where email_delivery_status = 'Failed';

do $$
declare
  j bigint;
begin
  select jobid into j
  from cron.job
  where jobname = 'visaflow-talent-prospect-email-every-minute';

  if j is not null then
    perform cron.unschedule(j);
  end if;

  perform cron.schedule(
    'visaflow-talent-prospect-email-every-minute',
    '* * * * *',
    'select public.trigger_talent_prospect_email_worker();'
  );
end $$;

