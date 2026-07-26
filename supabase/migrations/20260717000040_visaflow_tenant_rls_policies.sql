-- VisaFlow tenant RLS policy proposal.
--
-- REVIEW GATE: this migration is intentionally not approved for deployment yet.
-- The companion report documents application paths that must be redesigned before
-- this file can be applied (public AI interviews, legacy login, and SMTP secrets).

create or replace function public.visaflow_tenant_can(
  p_company_id uuid,
  p_action text,
  p_domain text
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor jsonb := public.current_log_actor();
  v_role text := coalesce(v_actor ->> 'role', '');
  v_actor_company uuid;
begin
  if v_actor is null or p_company_id is null then
    return false;
  end if;

  if nullif(v_actor ->> 'company_id', '') is not null then
    v_actor_company := (v_actor ->> 'company_id')::uuid;
  end if;

  -- Platform support/accounts roles are deliberately excluded. The owner may
  -- inspect tenant rows, but may mutate only tenant/agency access records.
  if v_role = 'Platform Owner' and v_actor_company is null then
    return p_action = 'read'
      or (p_domain = 'agency_access' and p_action in ('create', 'update', 'delete'));
  end if;

  if v_role in ('Platform Accounts User', 'Platform Support User', 'Agency')
     or v_actor_company is distinct from p_company_id then
    return false;
  end if;

  return case p_domain
    when 'agency_access' then
      v_role in ('Admin', 'Recruitment Manager')
    when 'agency_management' then
      case
        when p_action = 'read' then v_role in (
          'Admin', 'CEO', 'Operations Manager', 'Project Manager',
          'Recruitment Manager', 'Recruitment Officer', 'Viewer'
        )
        when p_action = 'update' then v_role in ('Admin', 'Recruitment Manager', 'CEO')
        else v_role in ('Admin', 'Recruitment Manager')
      end
    when 'ai_interview' then
      case
        when p_action = 'read' then v_role in (
          'Admin', 'CEO', 'Operations Manager', 'Recruitment Manager', 'Recruitment Officer'
        )
        else v_role in ('Admin', 'Recruitment Manager', 'Recruitment Officer')
      end
    when 'recruitment' then
      case
        when p_action = 'read' then v_role in (
          'Admin', 'CEO', 'Operations Manager', 'Project Manager',
          'Recruitment Manager', 'Recruitment Officer', 'Visa Team', 'Viewer'
        )
        when p_action = 'delete' then v_role in ('Admin', 'Recruitment Manager')
        else v_role in ('Admin', 'Recruitment Manager', 'Recruitment Officer')
      end
    when 'requests' then
      case
        when p_action = 'read' then v_role in (
          'Admin', 'CEO', 'Operations Manager', 'Project Manager',
          'Recruitment Manager', 'Recruitment Officer', 'Visa Team', 'Viewer'
        )
        when p_action = 'delete' then v_role = 'Admin'
        else v_role in (
          'Admin', 'Operations Manager', 'Project Manager',
          'Recruitment Manager', 'Recruitment Officer'
        )
      end
    when 'visa' then
      case
        when p_action = 'read' then v_role in (
          'Admin', 'CEO', 'Operations Manager', 'Project Manager',
          'Recruitment Manager', 'Recruitment Officer', 'Visa Team', 'Viewer'
        )
        else v_role in ('Admin', 'Visa Team')
      end
    when 'workforce' then
      case
        when p_action = 'read' then v_role in (
          'Admin', 'CEO', 'Operations Manager', 'Project Manager',
          'Recruitment Manager', 'Recruitment Officer', 'Viewer'
        )
        when p_action = 'delete' then v_role in ('Admin', 'Operations Manager', 'Project Manager')
        else v_role in (
          'Admin', 'Operations Manager', 'Project Manager',
          'Recruitment Manager', 'Recruitment Officer'
        )
      end
    when 'marketplace' then
      case
        when p_action = 'read' then v_role in (
          'Admin', 'CEO', 'Operations Manager', 'Recruitment Manager', 'Viewer'
        )
        else v_role in ('Admin', 'Operations Manager', 'Recruitment Manager')
      end
    when 'local_content' then
      case
        when p_action = 'read' then v_role in (
          'Admin', 'CEO', 'Operations Manager', 'Project Manager', 'Recruitment Manager'
        )
        else v_role in ('Admin', 'Operations Manager', 'Recruitment Manager')
      end
    when 'email_settings' then v_role = 'Admin'
    else false
  end;
end;
$$;

create or replace function public.visaflow_agency_can(
  p_company_id uuid,
  p_agency_id uuid,
  p_capability text default 'read'
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select public.current_log_actor() as value
  )
  select exists (
    select 1
    from actor
    join public.agency_members membership
      on membership.user_id = ((actor.value ->> 'id')::bigint)
     and membership.agency_id = p_agency_id
     and lower(coalesce(membership.status, '')) = 'active'
    join public.company_agency_access office_access
      on office_access.company_id = p_company_id
     and office_access.agency_id = p_agency_id
     and lower(coalesce(office_access.status, '')) = 'active'
    join public.agency_company_user_access user_access
      on user_access.company_id = p_company_id
     and user_access.agency_id = p_agency_id
     and user_access.user_id = ((actor.value ->> 'id')::bigint)
     and lower(coalesce(user_access.status, '')) = 'active'
    where actor.value is not null
      and actor.value ->> 'role' = 'Agency'
      and (actor.value ->> 'agency_id')::uuid = p_agency_id
      and case p_capability
        when 'view_requests' then office_access.can_view_requests and user_access.can_view_requests
        when 'upload_candidates' then office_access.can_upload_candidates and user_access.can_upload_candidates
        when 'update_candidates' then office_access.can_update_candidates and user_access.can_update_candidates
        when 'view_interviews' then office_access.can_view_interviews and user_access.can_view_interviews
        when 'read' then true
        else false
      end
  );
$$;

revoke all on function public.visaflow_tenant_can(uuid, text, text) from public, anon;
revoke all on function public.visaflow_agency_can(uuid, uuid, text) from public, anon;
grant execute on function public.visaflow_tenant_can(uuid, text, text) to authenticated, service_role;
grant execute on function public.visaflow_agency_can(uuid, uuid, text) to authenticated, service_role;

-- Replace the baseline fail-closed placeholder with operation-specific policies.
do $policy_setup$
declare
  item record;
  action_name text;
begin
  for item in
    select * from (values
      ('agency_agreements', 'agency_management'),
      ('agency_client_access', 'agency_access'),
      ('agency_company_user_access', 'agency_access'),
      ('agency_penalties', 'agency_management'),
      ('agency_scores', 'agency_management'),
      ('ai_interview_answers', 'ai_interview'),
      ('ai_interview_questions', 'ai_interview'),
      ('ai_interview_sessions', 'ai_interview'),
      ('candidate_technical_profiles', 'recruitment'),
      ('candidates', 'recruitment'),
      ('collections', 'marketplace'),
      ('company_agency_access', 'agency_access'),
      ('company_agency_users', 'agency_access'),
      ('company_email_settings', 'email_settings'),
      ('demobilizations', 'workforce'),
      ('employees', 'workforce'),
      ('interviews', 'recruitment'),
      ('invoice_items', 'marketplace'),
      ('invoices', 'marketplace'),
      ('local_content_project_targets', 'local_content'),
      ('marketplace_deal_workers', 'marketplace'),
      ('marketplace_deals', 'marketplace'),
      ('marketplace_requests', 'marketplace'),
      ('mobilizations', 'workforce'),
      ('onboarding_validations', 'workforce'),
      ('request_lines', 'requests'),
      ('requests', 'requests'),
      ('visa_allocations', 'visa'),
      ('visa_authorizations', 'visa'),
      ('visa_batch_lines', 'visa'),
      ('visa_batches', 'visa')
    ) as mapping(table_name, domain_name)
  loop
    execute format('alter table public.%I enable row level security', item.table_name);
    execute format('revoke all on table public.%I from anon', item.table_name);
    execute format('drop policy if exists baseline_deny_all_until_review on public.%I', item.table_name);

    foreach action_name in array array['select', 'insert', 'update', 'delete']
    loop
      execute format('drop policy if exists %I on public.%I',
        'vf_' || item.table_name || '_' || action_name, item.table_name);
    end loop;

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.visaflow_tenant_can(company_id, %L, %L))',
      'vf_' || item.table_name || '_select', item.table_name, 'read', item.domain_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.visaflow_tenant_can(company_id, %L, %L))',
      'vf_' || item.table_name || '_insert', item.table_name, 'create', item.domain_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.visaflow_tenant_can(company_id, %L, %L)) with check (public.visaflow_tenant_can(company_id, %L, %L))',
      'vf_' || item.table_name || '_update', item.table_name,
      'update', item.domain_name, 'update', item.domain_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.visaflow_tenant_can(company_id, %L, %L))',
      'vf_' || item.table_name || '_delete', item.table_name, 'delete', item.domain_name
    );
  end loop;
end;
$policy_setup$;

-- agency_members has no company_id. Direct company-admin mutation is therefore
-- unsafe; company workflows must use a server-side, tenant-checked invitation RPC.
alter table public.agency_members enable row level security;
revoke all on table public.agency_members from anon;
drop policy if exists baseline_deny_all_until_review on public.agency_members;
drop policy if exists vf_agency_members_select on public.agency_members;
drop policy if exists vf_agency_members_platform_manage on public.agency_members;
create policy vf_agency_members_select on public.agency_members
  for select to authenticated
  using (
    public.visaflow_agency_can(
      (select access.company_id
       from public.agency_company_user_access access
       where access.agency_id = agency_members.agency_id
         and access.user_id = agency_members.user_id
         and lower(coalesce(access.status, '')) = 'active'
       order by access.created_at
       limit 1),
      agency_id,
      'read'
    )
    or public.visaflow_tenant_can(
      (select access.company_id
       from public.agency_company_user_access access
       where access.agency_id = agency_members.agency_id
         and access.user_id = agency_members.user_id
       order by access.created_at
       limit 1),
      'read',
      'agency_access'
    )
  );

-- An agency may see only its own per-user and per-office grants. It cannot grant
-- itself access; mutation remains company-admin/platform-owner or service-role.
drop policy if exists vf_agency_company_user_access_agency_select on public.agency_company_user_access;
create policy vf_agency_company_user_access_agency_select on public.agency_company_user_access
  for select to authenticated
  using (public.visaflow_agency_can(company_id, agency_id, 'read')
         and user_id = public.current_app_user_id());

drop policy if exists vf_company_agency_access_agency_select on public.company_agency_access;
create policy vf_company_agency_access_agency_select on public.company_agency_access
  for select to authenticated
  using (public.visaflow_agency_can(company_id, agency_id, 'read'));

-- Penalties are the only current 32-table agency view with a trustworthy agency_id.
drop policy if exists vf_agency_penalties_agency_select on public.agency_penalties;
create policy vf_agency_penalties_agency_select on public.agency_penalties
  for select to authenticated
  using (
    agency_id is not null
    and lower(coalesce(status, '')) <> 'pending review'
    and public.visaflow_agency_can(company_id, agency_id, 'read')
  );

-- Cross-table company consistency. These restrictive policies prevent a caller
-- from pairing its company_id with a parent row owned by a different company.
drop policy if exists vf_ai_answers_parent_company on public.ai_interview_answers;
create policy vf_ai_answers_parent_company on public.ai_interview_answers
  as restrictive for all to authenticated
  using (exists (select 1 from public.ai_interview_sessions s where s.id = ai_interview_answers.session_id and s.company_id = ai_interview_answers.company_id))
  with check (exists (select 1 from public.ai_interview_sessions s where s.id = ai_interview_answers.session_id and s.company_id = ai_interview_answers.company_id));

drop policy if exists vf_candidate_profile_parent_company on public.candidate_technical_profiles;
create policy vf_candidate_profile_parent_company on public.candidate_technical_profiles
  as restrictive for all to authenticated
  using (exists (select 1 from public.candidates c where c.id = candidate_technical_profiles.candidate_id and c.company_id = candidate_technical_profiles.company_id))
  with check (exists (select 1 from public.candidates c where c.id = candidate_technical_profiles.candidate_id and c.company_id = candidate_technical_profiles.company_id));

drop policy if exists vf_interviews_parent_company on public.interviews;
create policy vf_interviews_parent_company on public.interviews
  as restrictive for all to authenticated
  using (interviews.candidate_id is null or exists (select 1 from public.candidates c where c.id = interviews.candidate_id and c.company_id = interviews.company_id))
  with check (interviews.candidate_id is null or exists (select 1 from public.candidates c where c.id = interviews.candidate_id and c.company_id = interviews.company_id));

drop policy if exists vf_request_lines_parent_company on public.request_lines;
create policy vf_request_lines_parent_company on public.request_lines
  as restrictive for all to authenticated
  using (request_lines.request_id is null or exists (select 1 from public.requests r where r.id = request_lines.request_id and r.company_id = request_lines.company_id))
  with check (request_lines.request_id is null or exists (select 1 from public.requests r where r.id = request_lines.request_id and r.company_id = request_lines.company_id));

drop policy if exists vf_invoice_items_parent_company on public.invoice_items;
create policy vf_invoice_items_parent_company on public.invoice_items
  as restrictive for all to authenticated
  using (invoice_items.invoice_id is null or exists (select 1 from public.invoices i where i.id = invoice_items.invoice_id and i.company_id = invoice_items.company_id))
  with check (invoice_items.invoice_id is null or exists (select 1 from public.invoices i where i.id = invoice_items.invoice_id and i.company_id = invoice_items.company_id));

drop policy if exists vf_collections_parent_company on public.collections;
create policy vf_collections_parent_company on public.collections
  as restrictive for all to authenticated
  using (collections.invoice_id is null or exists (select 1 from public.invoices i where i.id = collections.invoice_id and i.company_id = collections.company_id))
  with check (collections.invoice_id is null or exists (select 1 from public.invoices i where i.id = collections.invoice_id and i.company_id = collections.company_id));

drop policy if exists vf_marketplace_workers_parent_company on public.marketplace_deal_workers;
create policy vf_marketplace_workers_parent_company on public.marketplace_deal_workers
  as restrictive for all to authenticated
  using (marketplace_deal_workers.deal_id is null or exists (select 1 from public.marketplace_deals d where d.id::text = marketplace_deal_workers.deal_id and d.company_id = marketplace_deal_workers.company_id))
  with check (marketplace_deal_workers.deal_id is null or exists (select 1 from public.marketplace_deals d where d.id::text = marketplace_deal_workers.deal_id and d.company_id = marketplace_deal_workers.company_id));

drop policy if exists vf_visa_batch_lines_parent_company on public.visa_batch_lines;
create policy vf_visa_batch_lines_parent_company on public.visa_batch_lines
  as restrictive for all to authenticated
  using (exists (select 1 from public.visa_batches b where b.id = visa_batch_lines.visa_batch_id and b.company_id = visa_batch_lines.company_id))
  with check (exists (select 1 from public.visa_batches b where b.id = visa_batch_lines.visa_batch_id and b.company_id = visa_batch_lines.company_id));

drop policy if exists vf_visa_allocations_parent_company on public.visa_allocations;
create policy vf_visa_allocations_parent_company on public.visa_allocations
  as restrictive for all to authenticated
  using (visa_allocations.visa_batch_line_id is null or exists (select 1 from public.visa_batch_lines l where l.id = visa_allocations.visa_batch_line_id and l.company_id = visa_allocations.company_id))
  with check (visa_allocations.visa_batch_line_id is null or exists (select 1 from public.visa_batch_lines l where l.id = visa_allocations.visa_batch_line_id and l.company_id = visa_allocations.company_id));

-- SMTP credentials are write-only to browser roles. The current UI's mutation
-- `.select()` must request an explicit safe column list before deployment.
revoke all on table public.company_email_settings from authenticated;
grant insert, update, delete on table public.company_email_settings to authenticated;
grant select (
  id, company_id, mode, provider, smtp_host, smtp_port, smtp_secure,
  smtp_username, from_name, from_email, reply_to, agreements_email,
  notifications_email, support_email, is_active, is_verified, last_test_at,
  last_test_status, last_error, created_at, updated_at
) on public.company_email_settings to authenticated;

-- Correct the baseline browser allowlist. Mutating SECURITY DEFINER functions
-- without complete in-function role/tenant checks remain service_role-only.
revoke execute on function public.legacy_app_login(text, text) from public, anon, authenticated;
revoke execute on function public.ai_agent_try_acquire_lock(uuid, text, text, text, text, uuid, integer) from public, anon, authenticated;
revoke execute on function public.create_ai_interview_template_version(uuid, text) from public, anon, authenticated;
revoke execute on function public.add_candidates_to_ai_interview_campaign(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.launch_ai_interview_campaign(uuid, text) from public, anon, authenticated;
revoke execute on function public.remove_candidates_from_ai_interview_campaign(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.revalidate_ai_interview_campaign_candidates(uuid) from public, anon, authenticated;

-- The only intentionally anonymous SECURITY DEFINER entry point.
grant execute on function public.get_talent_public_stats() to anon;
