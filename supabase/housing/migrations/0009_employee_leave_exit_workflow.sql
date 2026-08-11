-- Employee leave, exit and end-of-service workflow.
-- Apply ONLY to the dedicated Housing Supabase project after 0008.

alter table public.housing_employee_status_events
  add column if not exists assignment_id uuid references public.housing_assignments(id) on delete set null,
  add column if not exists review_decision text check (review_decision in ('Checkout Approved','Keep Bed','Acknowledged','Cancelled')),
  add column if not exists review_note text,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists housing_employee_status_events_open_unique_idx
  on public.housing_employee_status_events(company_id,employee_id,event_type,effective_date)
  where status in ('Open','Acknowledged');

drop trigger if exists housing_employee_status_events_updated_at on public.housing_employee_status_events;
create trigger housing_employee_status_events_updated_at before update on public.housing_employee_status_events
for each row execute function public.housing_set_updated_at();

create or replace function public.housing_create_employee_status_event(
  p_employee_id uuid,
  p_event_type text,
  p_effective_date date,
  p_expected_return_date date default null,
  p_source text default 'Manual',
  p_source_reference text default null
) returns public.housing_employee_status_events
language plpgsql security definer set search_path=public as $$
declare
  v_company uuid:=public.housing_current_company_id();
  v_assignment_id uuid;
  v_checkout_required boolean;
  v_event public.housing_employee_status_events;
begin
  if v_company is null or not public.housing_has_permission('occupancy','manage') then raise exception 'Not authorized.'; end if;
  if p_event_type not in ('Annual Leave','Exit Reentry','Final Exit','Termination','Resignation','Transfer','Return to Work') then raise exception 'Unsupported employee event type.'; end if;
  if p_effective_date is null then raise exception 'Effective date is required.'; end if;
  if p_expected_return_date is not null and p_expected_return_date < p_effective_date then raise exception 'Expected return date cannot precede effective date.'; end if;
  if not exists(select 1 from public.housing_employees where id=p_employee_id and company_id=v_company) then raise exception 'Employee was not found.'; end if;

  select id into v_assignment_id from public.housing_assignments
  where company_id=v_company and employee_id=p_employee_id and status='Active' order by start_date desc limit 1;
  v_checkout_required := p_event_type in ('Annual Leave','Exit Reentry','Final Exit','Termination','Resignation','Transfer') and v_assignment_id is not null;

  if p_event_type='Return to Work' then
    update public.housing_employee_status_events set status='Completed',review_decision=coalesce(review_decision,'Acknowledged'),
      review_note=coalesce(review_note,'Closed automatically when return to work was registered'),reviewed_by=auth.uid(),reviewed_at=now()
    where company_id=v_company and employee_id=p_employee_id and status in ('Open','Acknowledged')
      and event_type in ('Annual Leave','Exit Reentry');
  end if;

  insert into public.housing_employee_status_events(
    company_id,employee_id,assignment_id,event_type,effective_date,expected_return_date,source,source_reference,checkout_required
  ) values(
    v_company,p_employee_id,v_assignment_id,p_event_type,p_effective_date,p_expected_return_date,
    coalesce(nullif(trim(p_source),''),'Manual'),nullif(trim(coalesce(p_source_reference,'')),''),v_checkout_required
  ) returning * into v_event;

  insert into public.housing_audit_log(company_id,entity_type,entity_id,action,after_data,actor_id)
  values(v_company,'housing_employee_status_events',v_event.id::text,'EMPLOYEE_STATUS_EVENT_CREATED',
    jsonb_build_object('employee_id',p_employee_id,'event_type',p_event_type,'effective_date',p_effective_date,
      'checkout_required',v_checkout_required,'assignment_id',v_assignment_id),auth.uid());
  return v_event;
end $$;

create or replace function public.housing_review_employee_status_event(
  p_event_id uuid,
  p_decision text,
  p_note text default null
) returns public.housing_employee_status_events
language plpgsql security definer set search_path=public as $$
declare
  v_company uuid:=public.housing_current_company_id();
  v_event public.housing_employee_status_events;
  v_assignment public.housing_assignments;
  v_status text;
begin
  if v_company is null or not public.housing_has_permission('occupancy','manage') then raise exception 'Not authorized.'; end if;
  if p_decision not in ('Checkout Approved','Keep Bed','Acknowledged','Cancelled') then raise exception 'Unsupported review decision.'; end if;
  select * into v_event from public.housing_employee_status_events
  where id=p_event_id and company_id=v_company for update;
  if v_event.id is null then raise exception 'Employee status event was not found.'; end if;
  if v_event.status not in ('Open','Acknowledged') then raise exception 'This event is already closed.'; end if;

  if p_decision='Checkout Approved' then
    if not v_event.checkout_required then raise exception 'This event does not require checkout.'; end if;
    select * into v_assignment from public.housing_assignments
    where id=v_event.assignment_id and company_id=v_company and status='Active' for update;
    if v_assignment.id is not null then
      update public.housing_assignments set status='Ended',
        end_date=greatest(v_event.effective_date,start_date),ended_by=auth.uid(),
        reason=coalesce(nullif(trim(coalesce(p_note,'')),''),v_event.event_type),updated_at=now()
      where id=v_assignment.id;
      update public.housing_beds set status='Available',updated_at=now() where id=v_assignment.bed_id and company_id=v_company;
      update public.housing_rooms set status='Available',updated_at=now() where id=v_assignment.room_id and company_id=v_company and status='Full';
    end if;
    v_status:='Completed';
  elsif p_decision='Cancelled' then v_status:='Cancelled';
  else v_status:='Acknowledged';
  end if;

  update public.housing_employee_status_events set status=v_status,review_decision=p_decision,
    review_note=nullif(trim(coalesce(p_note,'')),''),reviewed_by=auth.uid(),reviewed_at=now()
  where id=v_event.id returning * into v_event;

  insert into public.housing_audit_log(company_id,entity_type,entity_id,action,after_data,actor_id)
  values(v_company,'housing_employee_status_events',v_event.id::text,'EMPLOYEE_STATUS_EVENT_REVIEWED',
    jsonb_build_object('decision',p_decision,'status',v_status,'note',p_note,'assignment_id',v_event.assignment_id),auth.uid());
  return v_event;
end $$;

grant execute on function public.housing_create_employee_status_event(uuid,text,date,date,text,text) to authenticated;
grant execute on function public.housing_review_employee_status_event(uuid,text,text) to authenticated;
revoke execute on function public.housing_create_employee_status_event(uuid,text,date,date,text,text) from public,anon;
revoke execute on function public.housing_review_employee_status_event(uuid,text,text) from public,anon;
