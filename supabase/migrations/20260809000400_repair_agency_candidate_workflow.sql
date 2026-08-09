-- Repair production candidate creation for company and agency users.
--
-- 1. Synchronize per-user agency permissions with the active company/agency
--    access record. Older accepted invitations could leave the user row with
--    stale false permissions even though the office permissions were enabled.
-- 2. Avoid referencing NEW.candidate_id on the candidates table. The ownership
--    trigger is shared by candidates and interviews, so the value must be read
--    dynamically only for interview rows.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

update public.agency_company_user_access as user_access
set
  can_view_requests = office_access.can_view_requests,
  can_upload_candidates = office_access.can_upload_candidates,
  can_update_candidates = office_access.can_update_candidates,
  can_view_interviews = office_access.can_view_interviews
from public.company_agency_access as office_access
where user_access.company_id = office_access.company_id
  and user_access.agency_id = office_access.agency_id
  and lower(coalesce(user_access.status, '')) = 'active'
  and lower(coalesce(office_access.status, '')) = 'active'
  and (
    user_access.can_view_requests is distinct from office_access.can_view_requests
    or user_access.can_upload_candidates is distinct from office_access.can_upload_candidates
    or user_access.can_update_candidates is distinct from office_access.can_update_candidates
    or user_access.can_view_interviews is distinct from office_access.can_view_interviews
  );

create or replace function public.enforce_recruitment_agency_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.users%rowtype;
  v_candidate public.candidates%rowtype;
  v_candidate_id uuid;
  v_agency_name text;
  v_operation text := case when tg_op = 'INSERT' then 'insert' else 'update' end;
begin
  if auth.uid() is null then
    return new;
  end if;

  select * into v_actor
  from public.users as app_user
  where app_user.auth_user_id = auth.uid()
    and lower(coalesce(app_user.status, '')) = 'active'
    and app_user.is_active is true;

  if not found then
    raise exception using errcode = '42501', message = 'Active workspace account is required.';
  end if;

  if v_actor.role = 'Agency' then
    if v_actor.agency_id is null
       or not public.agency_recruitment_access_allowed(new.company_id, v_actor.agency_id, v_operation) then
      raise exception using errcode = '42501', message = 'Agency access to this company or action is not active.';
    end if;

    if tg_op = 'UPDATE'
       and (old.company_id is distinct from new.company_id or old.agency_id is distinct from v_actor.agency_id) then
      raise exception using errcode = '42501', message = 'Agency ownership cannot be changed.';
    end if;

    new.agency_id := v_actor.agency_id;
  elsif new.agency_id is not null and not exists (
    select 1
    from public.company_agency_access as office_access
    join public.agencies as agency on agency.id = office_access.agency_id
    where office_access.company_id = new.company_id
      and office_access.agency_id = new.agency_id
      and lower(coalesce(office_access.status, '')) = 'active'
      and lower(coalesce(agency.status, '')) = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Selected agency is not active for this company.';
  end if;

  if tg_table_name = 'interviews' then
    v_candidate_id := nullif(to_jsonb(new)->>'candidate_id', '')::uuid;

    if v_candidate_id is not null then
      select * into v_candidate
      from public.candidates as candidate
      where candidate.id = v_candidate_id;

      if not found
         or v_candidate.company_id is distinct from new.company_id
         or v_candidate.agency_id is distinct from new.agency_id then
        raise exception using errcode = '42501', message = 'Candidate ownership does not match the interview.';
      end if;
    end if;
  end if;

  if new.agency_id is not null then
    select agency.name into v_agency_name
    from public.agencies as agency
    where agency.id = new.agency_id;
    new.agency := v_agency_name;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_recruitment_agency_ownership() from public, anon, authenticated;

commit;
