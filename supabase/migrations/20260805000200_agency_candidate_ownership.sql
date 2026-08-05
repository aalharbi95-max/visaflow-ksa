-- Give agency-originated candidate and interview rows immutable UUID ownership.
-- This removes the fragile dependency on a mutable agency display name.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.candidates
  add column if not exists agency_id uuid;

alter table public.interviews
  add column if not exists agency_id uuid;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'candidates_agency_id_fkey'
      and conrelid = 'public.candidates'::regclass
  ) then
    alter table public.candidates
      add constraint candidates_agency_id_fkey
      foreign key (agency_id) references public.agencies(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'interviews_agency_id_fkey'
      and conrelid = 'public.interviews'::regclass
  ) then
    alter table public.interviews
      add constraint interviews_agency_id_fkey
      foreign key (agency_id) references public.agencies(id) on delete restrict;
  end if;
end $$;

create index if not exists candidates_company_agency_created_idx
  on public.candidates (company_id, agency_id, created_at desc);

create index if not exists interviews_company_agency_candidate_idx
  on public.interviews (company_id, agency_id, candidate_id);

-- Backfill only deterministic name matches. Ambiguous or unmatched legacy rows stay
-- null and remain visible to the owning company, but not to an agency account.
update public.candidates as candidate
set agency_id = matched.id
from (
  select lower(trim(name)) as normalized_name, min(id) as id
  from public.agencies
  where nullif(trim(name), '') is not null
  group by lower(trim(name))
  having count(*) = 1
) as matched
where candidate.agency_id is null
  and nullif(trim(candidate.agency), '') is not null
  and lower(trim(candidate.agency)) = matched.normalized_name;

update public.interviews as interview
set agency_id = candidate.agency_id
from public.candidates as candidate
where interview.agency_id is null
  and interview.candidate_id = candidate.id
  and interview.company_id = candidate.company_id
  and candidate.agency_id is not null;

update public.interviews as interview
set agency_id = matched.id
from (
  select lower(trim(name)) as normalized_name, min(id) as id
  from public.agencies
  where nullif(trim(name), '') is not null
  group by lower(trim(name))
  having count(*) = 1
) as matched
where interview.agency_id is null
  and nullif(trim(interview.agency), '') is not null
  and lower(trim(interview.agency)) = matched.normalized_name;

create or replace function public.agency_recruitment_access_allowed(
  p_company_id uuid,
  p_agency_id uuid,
  p_operation text default 'select'
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users as app_user
    join public.agencies as agency
      on agency.id = app_user.agency_id
     and agency.id = p_agency_id
     and lower(coalesce(agency.status, '')) = 'active'
    join public.agency_members as membership
      on membership.user_id = app_user.id
     and membership.agency_id = agency.id
     and lower(coalesce(membership.status, '')) = 'active'
    join public.company_agency_access as office_access
      on office_access.company_id = p_company_id
     and office_access.agency_id = agency.id
     and lower(coalesce(office_access.status, '')) = 'active'
    join public.agency_company_user_access as user_access
      on user_access.company_id = p_company_id
     and user_access.agency_id = agency.id
     and user_access.user_id = app_user.id
     and lower(coalesce(user_access.status, '')) = 'active'
    where app_user.auth_user_id = auth.uid()
      and app_user.role = 'Agency'
      and lower(coalesce(app_user.status, '')) = 'active'
      and app_user.is_active is true
      and case lower(coalesce(p_operation, 'select'))
        when 'insert' then office_access.can_upload_candidates is true and user_access.can_upload_candidates is true
        when 'update' then office_access.can_update_candidates is true and user_access.can_update_candidates is true
        when 'view_interviews' then office_access.can_view_interviews is true and user_access.can_view_interviews is true
        else true
      end
  );
$$;

revoke all on function public.agency_recruitment_access_allowed(uuid, uuid, text) from public, anon;
grant execute on function public.agency_recruitment_access_allowed(uuid, uuid, text) to authenticated, service_role;

create or replace function public.enforce_recruitment_agency_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.users%rowtype;
  v_candidate public.candidates%rowtype;
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

  if tg_table_name = 'interviews' and new.candidate_id is not null then
    select * into v_candidate
    from public.candidates as candidate
    where candidate.id = new.candidate_id;

    if not found
       or v_candidate.company_id is distinct from new.company_id
       or v_candidate.agency_id is distinct from new.agency_id then
      raise exception using errcode = '42501', message = 'Candidate ownership does not match the interview.';
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

drop trigger if exists candidates_enforce_recruitment_agency on public.candidates;
create trigger candidates_enforce_recruitment_agency
before insert or update of company_id, agency_id, agency on public.candidates
for each row execute function public.enforce_recruitment_agency_ownership();

drop trigger if exists interviews_enforce_recruitment_agency on public.interviews;
create trigger interviews_enforce_recruitment_agency
before insert or update of company_id, agency_id, agency, candidate_id on public.interviews
for each row execute function public.enforce_recruitment_agency_ownership();

drop policy if exists vf_candidates_agency_select on public.candidates;
drop policy if exists vf_candidates_agency_insert on public.candidates;
drop policy if exists vf_candidates_agency_update on public.candidates;
drop policy if exists vf_interviews_agency_select on public.interviews;
drop policy if exists vf_interviews_agency_insert on public.interviews;
drop policy if exists vf_interviews_agency_update on public.interviews;
drop policy if exists candidates_select_tenant_policy on public.candidates;
drop policy if exists candidates_insert_tenant_policy on public.candidates;
drop policy if exists candidates_update_tenant_policy on public.candidates;
drop policy if exists candidates_delete_tenant_policy on public.candidates;

create policy candidates_select_tenant_policy on public.candidates
for select to authenticated using (
  public.is_current_platform_user()
  or (public.current_app_user_role() <> 'Agency' and company_id = public.current_app_user_company_id())
  or (agency_id is not null and public.agency_recruitment_access_allowed(company_id, agency_id, 'select'))
);
create policy candidates_insert_tenant_policy on public.candidates
for insert to authenticated with check (
  public.is_current_platform_user()
  or (
    public.current_app_user_role() <> 'Agency'
    and company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array['Admin','Company Admin','Operations Manager','Project Manager','Recruitment Manager','Recruitment Officer','HR/Recruitment'])
  )
  or (agency_id is not null and public.agency_recruitment_access_allowed(company_id, agency_id, 'insert'))
);
create policy candidates_update_tenant_policy on public.candidates
for update to authenticated using (
  public.is_current_platform_user()
  or (
    public.current_app_user_role() <> 'Agency'
    and company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array['Admin','Company Admin','Operations Manager','Project Manager','Recruitment Manager','Recruitment Officer','HR/Recruitment'])
  )
  or (agency_id is not null and public.agency_recruitment_access_allowed(company_id, agency_id, 'update'))
) with check (
  public.is_current_platform_user()
  or (public.current_app_user_role() <> 'Agency' and company_id = public.current_app_user_company_id())
  or (agency_id is not null and public.agency_recruitment_access_allowed(company_id, agency_id, 'update'))
);
create policy candidates_delete_tenant_policy on public.candidates
for delete to authenticated using (
  public.is_current_platform_user()
  or (
    public.current_app_user_role() <> 'Agency'
    and company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array['Admin','Company Admin','Recruitment Manager'])
  )
);

drop policy if exists interviews_select_tenant_policy on public.interviews;
drop policy if exists interviews_insert_tenant_policy on public.interviews;
drop policy if exists interviews_update_tenant_policy on public.interviews;
drop policy if exists interviews_delete_tenant_policy on public.interviews;

create policy interviews_select_tenant_policy on public.interviews
for select to authenticated using (
  public.is_current_platform_user()
  or (public.current_app_user_role() <> 'Agency' and company_id = public.current_app_user_company_id())
  or (agency_id is not null and public.agency_recruitment_access_allowed(company_id, agency_id, 'view_interviews'))
);
create policy interviews_insert_tenant_policy on public.interviews
for insert to authenticated with check (
  public.is_current_platform_user()
  or (
    public.current_app_user_role() <> 'Agency'
    and company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array['Admin','Company Admin','Operations Manager','Recruitment Manager','Recruitment Officer','HR/Recruitment'])
  )
  or (agency_id is not null and public.agency_recruitment_access_allowed(company_id, agency_id, 'update'))
);
create policy interviews_update_tenant_policy on public.interviews
for update to authenticated using (
  public.is_current_platform_user()
  or (
    public.current_app_user_role() <> 'Agency'
    and company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array['Admin','Company Admin','Operations Manager','Recruitment Manager','Recruitment Officer','HR/Recruitment'])
  )
  or (agency_id is not null and public.agency_recruitment_access_allowed(company_id, agency_id, 'update'))
) with check (
  public.is_current_platform_user()
  or (public.current_app_user_role() <> 'Agency' and company_id = public.current_app_user_company_id())
  or (agency_id is not null and public.agency_recruitment_access_allowed(company_id, agency_id, 'update'))
);
create policy interviews_delete_tenant_policy on public.interviews
for delete to authenticated using (
  public.is_current_platform_user()
  or (
    public.current_app_user_role() <> 'Agency'
    and company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array['Admin','Company Admin','Recruitment Manager'])
  )
);

commit;

