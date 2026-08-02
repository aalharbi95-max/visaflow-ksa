begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.bulk_assignment_request_lines_v1()
returns table (
  request_line_id uuid, request_no text, line_no integer, profession text,
  nationality text, gender text, required_quantity bigint, linked_quantity bigint,
  remaining_quantity bigint, project_name text
)
language sql stable security definer set search_path = ''
as $function$
  with actor as (
    select u.* from public.users u
    where u.auth_user_id = auth.uid() and u.status = 'Active' and u.is_active is true
  )
  select rl.id, rl.request_no, rl.line_no, rl.profession, rl.nationality, rl.gender,
    coalesce(rl.quantity, 0), count(c.id), greatest(coalesce(rl.quantity, 0) - count(c.id), 0), rl.project_name
  from public.request_lines rl
  join public.requests r on r.company_id = rl.company_id and r.request_no = rl.request_no
  join public.companies co on co.id = rl.company_id and lower(coalesce(co.status, 'active')) = 'active'
  cross join actor a
  left join public.candidates c on c.request_line_id = rl.id and c.deleted_at is null
  where lower(coalesce(rl.status, 'open')) not in ('cancelled','canceled','closed','completed')
    and lower(coalesce(r.status, r.request_status, 'open')) not in ('cancelled','canceled','closed','completed','rejected')
    and (
      (a.role <> 'Agency' and a.company_id = rl.company_id)
      or (a.role = 'Agency' and exists (
        select 1 from public.agency_company_user_access ua
        where ua.user_id = a.id and ua.agency_id = a.agency_id and ua.company_id = rl.company_id
          and ua.status = 'Active' and ua.can_update_candidates is true
      ))
    )
  group by rl.id, rl.request_no, rl.line_no, rl.profession, rl.nationality, rl.gender, rl.quantity, rl.project_name
  having greatest(coalesce(rl.quantity, 0) - count(c.id), 0) > 0
  order by rl.request_no, rl.line_no
$function$;

create or replace function public.bulk_assign_candidates_v1(p_candidate_ids uuid[], p_request_line_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  actor public.users%rowtype; target public.request_lines%rowtype; target_request public.requests%rowtype;
  selected_count integer; linked_count integer; affected integer; rejected jsonb;
begin
  select * into actor from public.users where auth_user_id = auth.uid() and status = 'Active' and is_active is true;
  if actor.id is null then raise exception 'authenticated workspace required' using errcode='42501'; end if;
  if coalesce(array_length(p_candidate_ids, 1), 0) = 0 or p_request_line_id is null then raise exception 'candidate selection and request line are required'; end if;
  if cardinality(p_candidate_ids) <> (select count(distinct id) from unnest(p_candidate_ids) id) then raise exception 'duplicate candidate ids are not allowed'; end if;

  select rl.* into target from public.request_lines rl where rl.id = p_request_line_id for update;
  if target.id is null then raise exception 'request line is not available'; end if;
  select r.* into target_request from public.requests r where r.company_id=target.company_id and r.request_no=target.request_no for update;
  if target_request.id is null or not exists (select 1 from public.companies c where c.id=target.company_id and lower(coalesce(c.status,'active'))='active')
     or lower(coalesce(target.status,'open')) in ('cancelled','canceled','closed','completed')
     or lower(coalesce(target_request.status,target_request.request_status,'open')) in ('cancelled','canceled','closed','completed','rejected')
  then raise exception 'request is not open and active'; end if;

  if actor.role = 'Agency' then
    if actor.agency_id is null or not exists (
      select 1 from public.agency_company_user_access ua where ua.user_id=actor.id and ua.agency_id=actor.agency_id
        and ua.company_id=target.company_id and ua.status='Active' and ua.can_update_candidates is true
    ) then raise exception 'agency workspace access denied' using errcode='42501'; end if;
  elsif actor.company_id is distinct from target.company_id or actor.role not in ('Admin','Company Admin','Recruitment Manager','Recruitment Officer','HR/Recruitment') then
    raise exception 'company workspace access denied' using errcode='42501';
  end if;

  perform 1 from public.candidates c where c.id=any(p_candidate_ids) order by c.id for update;
  select count(*) into selected_count from public.candidates c where c.id=any(p_candidate_ids);
  if selected_count <> cardinality(p_candidate_ids) then raise exception 'one or more candidates do not exist'; end if;
  if exists (select 1 from public.candidates c where c.id=any(p_candidate_ids) and (
    c.company_id is distinct from target.company_id or c.deleted_at is not null
    or (actor.role='Agency' and c.uploaded_by_agency_id is distinct from actor.agency_id)
  )) then raise exception 'cross-tenant, cross-agency, or deleted candidate blocked' using errcode='42501'; end if;

  select jsonb_agg(jsonb_build_object('candidate_id',c.id,'candidate_name',c.candidate_name,'reasons',
    array_remove(array[
      case when nullif(trim(coalesce(c.request_no,'')),'') is not null or c.request_line_id is not null then 'Already assigned to an active request' end,
      case when lower(trim(coalesce(c.profession,''))) <> lower(trim(coalesce(target.profession,''))) then 'Profession mismatch' end,
      case when lower(trim(coalesce(c.nationality,''))) <> lower(trim(coalesce(target.nationality,''))) then 'Nationality mismatch' end,
      case when lower(trim(coalesce(c.gender,''))) <> lower(trim(coalesce(target.gender,''))) then 'Gender mismatch' end
    ],null))) into rejected
  from public.candidates c where c.id=any(p_candidate_ids) and (
    nullif(trim(coalesce(c.request_no,'')),'') is not null or c.request_line_id is not null
    or lower(trim(coalesce(c.profession,''))) <> lower(trim(coalesce(target.profession,'')))
    or lower(trim(coalesce(c.nationality,''))) <> lower(trim(coalesce(target.nationality,'')))
    or lower(trim(coalesce(c.gender,''))) <> lower(trim(coalesce(target.gender,'')))
  );
  if rejected is not null then raise exception 'candidate match validation failed: %', rejected; end if;

  select count(*) into linked_count from public.candidates c where c.request_line_id=target.id and c.deleted_at is null;
  if linked_count + selected_count > coalesce(target.quantity,0) then raise exception 'requested quantity capacity exceeded'; end if;

  update public.candidates c set request_line_id=target.id, request_no=target.request_no,
    project=coalesce(target.project_name,target_request.project_name,c.project), updated_at=now(),
    updated_by_name=actor.name, updated_by_email=actor.email, updated_by_role=actor.role
  where c.id=any(p_candidate_ids);
  get diagnostics affected=row_count;

  insert into public.system_activity_logs(company_id,request_no,module_name,record_id,record_label,action_type,action_title,
    old_values,new_values,changed_fields,changed_by_user_id,changed_by_name,changed_by_email,changed_by_role,notes,source)
  values(target.company_id,target.request_no,'Candidates',array_to_string(p_candidate_ids,','),affected||' candidate(s)',
    'BULK_ASSIGN','Bulk assignment to request line','{}'::jsonb,
    jsonb_build_object('assigned_count',affected,'request_line_id',target.id,'request_no',target.request_no,'line_no',target.line_no),
    '["request_line_id","request_no","project"]'::jsonb,actor.id,actor.name,actor.email,actor.role,
    'Atomic bulk candidate assignment','bulk_assign_candidates_v1');
  return jsonb_build_object('assigned_count',affected,'request_no',target.request_no,'request_line_id',target.id,'remaining_quantity',coalesce(target.quantity,0)-linked_count-affected);
end;
$function$;

create or replace function public.bulk_unassign_candidates_v1(p_candidate_ids uuid[], p_reason text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare actor public.users%rowtype; tenant_id uuid; affected integer;
begin
  select * into actor from public.users where auth_user_id=auth.uid() and status='Active' and is_active is true;
  if actor.id is null then raise exception 'authenticated workspace required' using errcode='42501'; end if;
  if coalesce(cardinality(p_candidate_ids),0)=0 or length(trim(coalesce(p_reason,'')))<3 then raise exception 'candidate selection and unassignment reason are required'; end if;
  perform 1 from public.candidates c where c.id=any(p_candidate_ids) order by c.id for update;
  select company_id into tenant_id from public.candidates where id=any(p_candidate_ids) limit 1;
  if (select count(*) from public.candidates where id=any(p_candidate_ids)) <> cardinality(p_candidate_ids)
    or exists(select 1 from public.candidates c where c.id=any(p_candidate_ids) and (c.company_id is distinct from tenant_id or c.deleted_at is not null or c.request_line_id is null))
  then raise exception 'invalid candidate selection'; end if;
  if actor.role='Agency' then
    if exists(select 1 from public.candidates c where c.id=any(p_candidate_ids) and c.uploaded_by_agency_id is distinct from actor.agency_id)
      or not exists(select 1 from public.agency_company_user_access ua where ua.user_id=actor.id and ua.agency_id=actor.agency_id and ua.company_id=tenant_id and ua.status='Active' and ua.can_update_candidates is true)
    then raise exception 'agency workspace access denied' using errcode='42501'; end if;
  elsif actor.company_id is distinct from tenant_id or actor.role not in ('Admin','Company Admin','Recruitment Manager','Recruitment Officer','HR/Recruitment') then raise exception 'company workspace access denied' using errcode='42501'; end if;
  if exists(select 1 from public.candidates c where c.id=any(p_candidate_ids) and lower(coalesce(c.status,'')) in ('authorization','authorized','mobilization','medical','visa ready','ticket issued','arrived','arrived ksa','joined'))
    or exists(
      select 1 from public.visa_authorizations va
      join public.candidates c on c.id=any(p_candidate_ids) and c.company_id=va.company_id and c.request_no=va.request_no
       and lower(trim(coalesce(c.profession,'')))=lower(trim(coalesce(va.profession,'')))
       and lower(trim(coalesce(c.nationality,'')))=lower(trim(coalesce(va.nationality,'')))
       and lower(trim(coalesce(c.gender,'')))=lower(trim(coalesce(va.gender,'')))
      where lower(coalesce(va.status,'open')) not in ('cancelled','canceled')
    )
    or exists(
      select 1 from public.mobilizations m
      join public.candidates c on c.id=any(p_candidate_ids)
       and c.company_id=m.company_id
       and (m.request_line_id=c.request_line_id or (m.request_no=c.request_no and lower(trim(coalesce(m.candidate_name,'')))=lower(trim(c.candidate_name))))
    )
  then raise exception 'unassign is allowed only before Authorization or Mobilization starts'; end if;
  update public.candidates set request_line_id=null,request_no=null,project=null,updated_at=now(),updated_by_name=actor.name,updated_by_email=actor.email,updated_by_role=actor.role where id=any(p_candidate_ids);
  get diagnostics affected=row_count;
  insert into public.system_activity_logs(company_id,module_name,record_id,record_label,action_type,action_title,old_values,new_values,changed_fields,changed_by_user_id,changed_by_name,changed_by_email,changed_by_role,notes,source)
  values(tenant_id,'Candidates',array_to_string(p_candidate_ids,','),affected||' candidate(s)','BULK_UNASSIGN','Bulk unassign candidates','{}'::jsonb,jsonb_build_object('unassigned_count',affected,'reason',trim(p_reason)),'["request_line_id","request_no","project"]'::jsonb,actor.id,actor.name,actor.email,actor.role,trim(p_reason),'bulk_unassign_candidates_v1');
  return jsonb_build_object('unassigned_count',affected);
end;
$function$;

revoke all on function public.bulk_assignment_request_lines_v1() from public,anon;
revoke all on function public.bulk_assign_candidates_v1(uuid[],uuid) from public,anon;
revoke all on function public.bulk_unassign_candidates_v1(uuid[],text) from public,anon;
grant execute on function public.bulk_assignment_request_lines_v1() to authenticated,service_role;
grant execute on function public.bulk_assign_candidates_v1(uuid[],uuid) to authenticated,service_role;
grant execute on function public.bulk_unassign_candidates_v1(uuid[],text) to authenticated,service_role;

commit;
