begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.agency_agreement_create_v1(p_agreement jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.users%rowtype;
  agency_row public.agencies%rowtype;
  agreement_row public.agency_agreements%rowtype;
  next_number integer;
  generated_number text;
  agreement_year integer := extract(year from current_date)::integer;
begin
  select app_user.* into actor from public.users app_user
  where app_user.auth_user_id = auth.uid() and app_user.status = 'Active'
    and app_user.is_active is true
    and app_user.role in ('Admin', 'Company Admin', 'Recruitment Manager')
    and app_user.company_id is not null;
  if actor.id is null then raise exception 'AGENCY_AGREEMENT_CREATE_UNAUTHORIZED'; end if;

  select agency.* into agency_row
  from public.agencies agency
  join public.company_agency_access access on access.agency_id = agency.id
    and access.company_id = actor.company_id and access.status = 'Active'
  where agency.id = nullif(p_agreement->>'agency_id', '')::uuid
    and agency.status = 'Active';
  if agency_row.id is null then raise exception 'AGENCY_AGREEMENT_AGENCY_UNAVAILABLE'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor.company_id::text || ':' || agreement_year::text, 0)
  );

  select coalesce(max(substring(agreement.agreement_no from '([0-9]+)$')::integer), 0) + 1
    into next_number
  from public.agency_agreements agreement
  where agreement.company_id = actor.company_id
    and agreement.agreement_no like 'AGR-' || agreement_year::text || '-%'
    and agreement.agreement_no ~ ('^AGR-' || agreement_year::text || '-[0-9]+$');
  generated_number := 'AGR-' || agreement_year::text || '-' || pg_catalog.lpad(next_number::text, 4, '0');

  insert into public.agency_agreements (
    company_id, agency_id, agreement_no, agency_name, signed_by_company,
    company_signature, status, sla_days, effective_date, expiry_date, terms,
    template_type, policy_name, response_sla_hours, update_frequency_days,
    delay_penalty_type, delay_penalty_amount, delay_penalty_after_days,
    financial_guarantee_required, financial_guarantee_amount,
    replacement_guarantee_days, payment_terms, cancellation_terms,
    sent_to_agency_at, updated_at
  ) values (
    actor.company_id, agency_row.id, generated_number, agency_row.name,
    nullif(p_agreement->>'signed_by_company', ''), nullif(p_agreement->>'company_signature', ''),
    coalesce(nullif(p_agreement->>'status', ''), 'Draft'),
    coalesce(nullif(p_agreement->>'sla_days', '')::integer, 60),
    nullif(p_agreement->>'effective_date', '')::date, nullif(p_agreement->>'expiry_date', '')::date,
    p_agreement->>'terms', nullif(p_agreement->>'template_type', ''), nullif(p_agreement->>'policy_name', ''),
    coalesce(nullif(p_agreement->>'response_sla_hours', '')::integer, 24),
    coalesce(nullif(p_agreement->>'update_frequency_days', '')::integer, 7),
    nullif(p_agreement->>'delay_penalty_type', ''), nullif(p_agreement->>'delay_penalty_amount', '')::numeric,
    coalesce(nullif(p_agreement->>'delay_penalty_after_days', '')::integer, 7),
    coalesce(nullif(p_agreement->>'financial_guarantee_required', ''), 'No'),
    nullif(p_agreement->>'financial_guarantee_amount', '')::numeric,
    coalesce(nullif(p_agreement->>'replacement_guarantee_days', '')::integer, 90),
    p_agreement->>'payment_terms', p_agreement->>'cancellation_terms',
    nullif(p_agreement->>'sent_to_agency_at', '')::timestamptz, pg_catalog.now()
  ) returning * into agreement_row;

  return pg_catalog.jsonb_build_object('id', agreement_row.id, 'company_id', agreement_row.company_id,
    'agency_id', agreement_row.agency_id, 'agreement_no', agreement_row.agreement_no, 'status', agreement_row.status);
end;
$function$;

revoke all on function public.agency_agreement_create_v1(jsonb) from public, anon;
grant execute on function public.agency_agreement_create_v1(jsonb) to authenticated;

commit;
