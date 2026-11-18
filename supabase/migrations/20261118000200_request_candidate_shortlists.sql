-- An HR review list is separate from approved recruitment headcount and offers.
begin;
set local lock_timeout = '5s';
create table public.request_candidate_shortlists (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  request_id bigint not null references public.requests(id) on delete cascade,
  request_line_no integer not null check (request_line_no > 0),
  profession text not null,
  candidate_name text not null check (length(trim(candidate_name)) > 1),
  email text not null default '',
  mobile text not null default '',
  notes text not null default '',
  review_status text not null default 'Under Review'
    check (review_status in ('Under Review','Contacted','On Hold','Withdrawn')),
  cv_file_name text not null,
  cv_sha256 text not null check (cv_sha256 ~ '^[a-f0-9]{64}$'),
  cv_storage_path text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, request_id, request_line_no, cv_sha256),
  check (cv_storage_path ~ ('^' || company_id::text || '/' || cv_sha256 || '\.(pdf|docx|doc)$'))
);
create index request_shortlists_request_idx on public.request_candidate_shortlists(company_id,request_id,request_line_no);
create unique index request_shortlists_email_idx on public.request_candidate_shortlists(company_id,request_id,request_line_no,lower(email)) where trim(email)<>'';
alter table public.request_candidate_shortlists enable row level security;
revoke all on public.request_candidate_shortlists from anon;
grant select,insert,update on public.request_candidate_shortlists to authenticated;
grant all on public.request_candidate_shortlists to service_role;
create policy request_shortlists_hr on public.request_candidate_shortlists for all to authenticated
using (public.current_app_user_role()='Platform Owner' or
  (company_id=public.current_app_user_company_id() and public.current_app_user_role() in ('Admin','Recruitment Manager','Recruitment Officer')))
with check (public.current_app_user_role()='Platform Owner' or
  (company_id=public.current_app_user_company_id() and public.current_app_user_role() in ('Admin','Recruitment Manager','Recruitment Officer')));

create function public.validate_request_shortlist() returns trigger
language plpgsql security definer set search_path='' as $$
declare request_company uuid; line_profession text;
begin
  if TG_OP='UPDATE' and (new.company_id,new.request_id,new.request_line_no,new.cv_sha256,new.cv_storage_path,new.created_by)
    is distinct from (old.company_id,old.request_id,old.request_line_no,old.cv_sha256,old.cv_storage_path,old.created_by) then
    raise exception 'Shortlist ownership and CV cannot be changed' using errcode='23514';
  end if;
  select r.company_id into request_company from public.requests r where r.id=new.request_id;
  if request_company is null or request_company <> new.company_id then
    raise exception 'Shortlist request does not belong to this company' using errcode='23514';
  end if;
  if TG_OP='INSERT' then
    select l.profession into line_profession from public.request_lines l
      where l.request_id=new.request_id and l.company_id=new.company_id and l.line_no=new.request_line_no;
    if line_profession is null then raise exception 'Request line not found' using errcode='23514'; end if;
    new.profession:=line_profession;
    new.created_by:=auth.uid();
  end if;
  new.updated_at:=now();
  return new;
end $$;
revoke all on function public.validate_request_shortlist() from public;
create trigger validate_request_shortlist before insert or update on public.request_candidate_shortlists
for each row execute function public.validate_request_shortlist();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('request-shortlist-cvs','request-shortlist-cvs',false,20971520,
  array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- A restrictive guard also protects this bucket from unrelated legacy broad policies.
create policy request_shortlist_storage_guard on storage.objects as restrictive for all to public
using (bucket_id <> 'request-shortlist-cvs' or public.current_app_user_role()='Platform Owner' or
  (split_part(name,'/',1)=public.current_app_user_company_id()::text and public.current_app_user_role() in ('Admin','Recruitment Manager','Recruitment Officer')))
with check (bucket_id <> 'request-shortlist-cvs' or public.current_app_user_role()='Platform Owner' or
  (split_part(name,'/',1)=public.current_app_user_company_id()::text and public.current_app_user_role() in ('Admin','Recruitment Manager','Recruitment Officer')));
create policy request_shortlist_storage_hr on storage.objects for all to authenticated
using (bucket_id='request-shortlist-cvs' and (public.current_app_user_role()='Platform Owner' or
  (split_part(name,'/',1)=public.current_app_user_company_id()::text and public.current_app_user_role() in ('Admin','Recruitment Manager','Recruitment Officer'))))
with check (bucket_id='request-shortlist-cvs' and (public.current_app_user_role()='Platform Owner' or
  (split_part(name,'/',1)=public.current_app_user_company_id()::text and public.current_app_user_role() in ('Admin','Recruitment Manager','Recruitment Officer'))));
commit;
