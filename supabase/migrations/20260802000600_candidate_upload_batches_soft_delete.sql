begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists public.candidate_upload_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  agency_id uuid references public.agencies(id),
  agency_name text,
  file_name text not null,
  file_hash text not null,
  row_count integer not null check (row_count > 0),
  uploaded_by_user_id bigint,
  uploaded_by_auth_user_id uuid,
  created_at timestamptz not null default now()
);

create unique index if not exists candidate_upload_batches_file_unique
  on public.candidate_upload_batches (
    company_id,
    coalesce(agency_id, '00000000-0000-0000-0000-000000000000'::uuid),
    file_hash
  );

alter table public.candidates
  add column if not exists upload_batch_id uuid references public.candidate_upload_batches(id),
  add column if not exists file_hash text,
  add column if not exists uploaded_by_agency_id uuid references public.agencies(id),
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists deletion_reason text,
  add column if not exists deleted_from_batch_id uuid references public.candidate_upload_batches(id);

create index if not exists candidates_active_company_idx
  on public.candidates(company_id) where deleted_at is null;
create index if not exists candidates_upload_batch_idx
  on public.candidates(upload_batch_id);

insert into public.candidate_upload_batches (
  id, company_id, agency_id, agency_name, file_name, file_hash, row_count, created_at
)
select
  gen_random_uuid(), grouped.company_id, grouped.agency_id, grouped.agency,
  'Legacy candidate upload ' || to_char(grouped.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') || ' UTC',
  'legacy:' || md5(grouped.company_id::text || ':' || coalesce(grouped.agency_id::text, '') || ':' || grouped.created_at::text),
  grouped.row_count, grouped.created_at
from (
  select c.company_id, c.agency, c.created_at, count(*)::integer row_count, min(a.id::text)::uuid agency_id
  from public.candidates c
  left join public.agencies a on lower(trim(a.name)) = lower(trim(c.agency))
  where c.upload_batch_id is null
  group by c.company_id, c.agency, c.created_at
) grouped;

update public.candidates c
set upload_batch_id = b.id,
    file_hash = b.file_hash,
    uploaded_by_agency_id = b.agency_id
from public.candidate_upload_batches b
where c.upload_batch_id is null
  and c.company_id = b.company_id
  and c.created_at = b.created_at
  and coalesce(c.agency, '') = coalesce(b.agency_name, '');

alter table public.candidate_upload_batches enable row level security;
revoke all on public.candidate_upload_batches from public, anon, authenticated;
grant select on public.candidate_upload_batches to authenticated;

drop policy if exists candidate_upload_batches_select on public.candidate_upload_batches;
create policy candidate_upload_batches_select on public.candidate_upload_batches
for select to authenticated using (
  (public.current_app_user_role() <> 'Agency' and company_id = public.current_app_user_company_id())
  or exists (
    select 1 from public.users u
    join public.agency_company_user_access ua
      on ua.user_id=u.id and ua.agency_id=u.agency_id and ua.company_id=candidate_upload_batches.company_id
     and ua.status='Active'
    where u.auth_user_id=auth.uid() and u.role='Agency' and u.status='Active' and u.is_active is true
      and u.agency_id=candidate_upload_batches.agency_id
  )
);

create or replace function public.candidate_upload_batch_begin_v1(
  p_company_id uuid, p_agency_id uuid, p_file_name text, p_file_hash text, p_row_count integer
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  actor public.users%rowtype;
  batch_row public.candidate_upload_batches%rowtype;
  actor_agency_name text;
begin
  select * into actor from public.users
  where auth_user_id=auth.uid() and status='Active' and is_active is true;
  if actor.id is null then raise exception 'authenticated workspace required' using errcode='42501'; end if;
  if nullif(trim(p_file_hash),'') is null or p_row_count < 1 then raise exception 'valid file hash and row count required'; end if;

  if actor.role='Agency' then
    if actor.agency_id is null or actor.agency_id is distinct from p_agency_id then
      raise exception 'agency identity mismatch' using errcode='42501';
    end if;
    if not exists (
      select 1 from public.company_agency_access ca
      join public.agency_company_user_access ua on ua.company_id=ca.company_id and ua.agency_id=ca.agency_id
      where ca.company_id=p_company_id and ca.agency_id=actor.agency_id and ca.status='Active'
        and ua.user_id=actor.id and ua.status='Active' and ua.can_upload_candidates is true
    ) then raise exception 'company workspace is not authorized' using errcode='42501'; end if;
    select name into actor_agency_name from public.agencies where id=actor.agency_id and status='Active';
  elsif actor.role not in ('Admin','Company Admin','Recruitment Manager','Recruitment Officer','HR/Recruitment')
     or actor.company_id is distinct from p_company_id then
    raise exception 'company upload access denied' using errcode='42501';
  end if;

  insert into public.candidate_upload_batches(
    company_id,agency_id,agency_name,file_name,file_hash,row_count,uploaded_by_user_id,uploaded_by_auth_user_id
  ) values (
    p_company_id,case when actor.role='Agency' then actor.agency_id else p_agency_id end,
    case when actor.role='Agency' then actor_agency_name else null end,
    coalesce(nullif(trim(p_file_name),''),'Candidate upload'),lower(trim(p_file_hash)),p_row_count,actor.id,auth.uid()
  ) returning * into batch_row;
  return jsonb_build_object('id',batch_row.id,'file_hash',batch_row.file_hash,'created_at',batch_row.created_at);
exception when unique_violation then
  raise exception 'This Excel file was already uploaded for this workspace and agency.' using errcode='23505';
end;
$function$;

create or replace function public.candidate_soft_delete_v1(
  p_company_id uuid, p_candidate_ids uuid[], p_reason text,
  p_confirm_linked boolean default false, p_allow_protected boolean default false
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  actor public.users%rowtype;
  affected integer;
  protected_count integer;
  linked_count integer;
  is_admin boolean;
begin
  select * into actor from public.users where auth_user_id=auth.uid() and status='Active' and is_active is true;
  if actor.id is null or coalesce(array_length(p_candidate_ids,1),0)=0 then raise exception 'candidate selection required'; end if;
  if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'deletion reason is required'; end if;
  is_admin := actor.role in ('Admin','Company Admin') and actor.company_id=p_company_id;
  if not is_admin and actor.role <> 'Agency' then raise exception 'delete access denied' using errcode='42501'; end if;
  if actor.role='Agency' and not exists (
    select 1 from public.agency_company_user_access ua
    where ua.user_id=actor.id and ua.agency_id=actor.agency_id and ua.company_id=p_company_id
      and ua.status='Active' and ua.can_update_candidates is true
  ) then raise exception 'agency workspace access denied' using errcode='42501'; end if;
  if exists (
    select 1 from public.candidates c where c.id=any(p_candidate_ids)
      and (c.company_id<>p_company_id or (actor.role='Agency' and c.uploaded_by_agency_id is distinct from actor.agency_id))
  ) then raise exception 'cross-company or cross-agency candidate selection blocked' using errcode='42501'; end if;

  select count(*) into protected_count from public.candidates c
  where c.id=any(p_candidate_ids) and c.deleted_at is null
    and lower(coalesce(c.status,'')) in ('visa stamped','arrived','arrived ksa','joined','employee','mobilization completed');
  if protected_count>0 and (not is_admin or not p_allow_protected) then
    raise exception 'protected candidate stage requires Company Admin warning confirmation';
  end if;
  select count(*) into linked_count from public.candidates c
  where c.id=any(p_candidate_ids) and c.deleted_at is null and nullif(trim(coalesce(c.request_no,'')),'') is not null;
  if linked_count>0 and not p_confirm_linked then raise exception 'active request or authorization confirmation required'; end if;

  update public.candidates c set
    deleted_at=now(), deleted_by=coalesce(actor.email,actor.name,actor.id::text),
    deletion_reason=trim(p_reason), deleted_from_batch_id=c.upload_batch_id, updated_at=now()
  where c.company_id=p_company_id and c.id=any(p_candidate_ids) and c.deleted_at is null
    and (is_admin or c.uploaded_by_agency_id=actor.agency_id);
  get diagnostics affected=row_count;

  insert into public.system_activity_logs(
    company_id,module_name,record_id,record_label,action_type,action_title,
    old_values,new_values,changed_fields,changed_by_user_id,changed_by_name,
    changed_by_email,changed_by_role,notes,source
  ) values (
    p_company_id,'Candidates',array_to_string(p_candidate_ids,','),affected||' candidate(s)',
    'SOFT_DELETE','Candidate soft delete','{}'::jsonb,
    jsonb_build_object('deleted_count',affected,'reason',trim(p_reason)),
    '["deleted_at","deleted_by","deletion_reason","deleted_from_batch_id"]'::jsonb,
    actor.id,actor.name,actor.email,actor.role,trim(p_reason),'candidate_soft_delete_v1'
  );
  return jsonb_build_object('deleted_count',affected);
end;
$function$;

create or replace function public.candidate_restore_v1(
  p_company_id uuid, p_candidate_ids uuid[], p_reason text
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare actor public.users%rowtype; affected integer;
begin
  select * into actor from public.users where auth_user_id=auth.uid() and status='Active' and is_active is true;
  if actor.role not in ('Admin','Company Admin') or actor.company_id is distinct from p_company_id then
    raise exception 'Company Admin restore access required' using errcode='42501';
  end if;
  update public.candidates set deleted_at=null,deleted_by=null,deletion_reason=null,deleted_from_batch_id=null,updated_at=now()
  where company_id=p_company_id and id=any(p_candidate_ids) and deleted_at is not null;
  get diagnostics affected=row_count;
  insert into public.system_activity_logs(
    company_id,module_name,record_id,record_label,action_type,action_title,
    old_values,new_values,changed_fields,changed_by_user_id,changed_by_name,
    changed_by_email,changed_by_role,notes,source
  ) values (
    p_company_id,'Candidates',array_to_string(p_candidate_ids,','),affected||' candidate(s)',
    'RESTORE','Candidate restore','{}'::jsonb,jsonb_build_object('restored_count',affected),
    '["deleted_at"]'::jsonb,actor.id,actor.name,actor.email,actor.role,trim(coalesce(p_reason,'')),'candidate_restore_v1'
  );
  return jsonb_build_object('restored_count',affected);
end;
$function$;

revoke all on function public.candidate_upload_batch_begin_v1(uuid,uuid,text,text,integer) from public,anon;
revoke all on function public.candidate_soft_delete_v1(uuid,uuid[],text,boolean,boolean) from public,anon;
revoke all on function public.candidate_restore_v1(uuid,uuid[],text) from public,anon;
grant execute on function public.candidate_upload_batch_begin_v1(uuid,uuid,text,text,integer) to authenticated,service_role;
grant execute on function public.candidate_soft_delete_v1(uuid,uuid[],text,boolean,boolean) to authenticated,service_role;
grant execute on function public.candidate_restore_v1(uuid,uuid[],text) to authenticated,service_role;

commit;
